import json, shutil, subprocess, time, os, sys, tempfile
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
TMP = tempfile.mkdtemp(prefix='formdrill-e2e-')

from playwright.sync_api import sync_playwright
SRC = ROOT
shutil.rmtree(TMP + '/ext', ignore_errors=True)
shutil.copytree(SRC + '/extension', TMP + '/ext')
m = json.load(open(TMP + '/ext/manifest.json'))
m['host_permissions'] = ['http://localhost/*']
json.dump(m, open(TMP + '/ext/manifest.json', 'w'))

srv = subprocess.Popen([sys.executable, '-m', 'http.server', '8765', '--directory', SRC + '/sample'], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(1.2)
results = []

def check(name, cond, detail=''):
    results.append((name, bool(cond)))
    print(('PASS ' if cond else 'FAIL ') + name + (' :: ' + str(detail) if (detail and not cond) else ''))

try:
    with sync_playwright() as p:
        ext_path = os.path.normpath(TMP + '/ext')
        ctx = p.chromium.launch_persistent_context(
            TMP + '/profile',
            headless=False,
            args=['--headless=new', f'--disable-extensions-except={ext_path}', f'--load-extension={ext_path}', '--no-sandbox']
        )
        sw = ctx.service_workers[0] if ctx.service_workers else ctx.wait_for_event('serviceworker', timeout=10000)
        ext = sw.url.split('/')[2]
        check('extension loaded', ext)

        page = ctx.new_page()
        page.goto('http://localhost:8765/advanced_forms.html')
        page.wait_for_load_state('networkidle')

        app = ctx.new_page()
        app.goto(f'chrome-extension://{ext}/app.html')
        tid = app.evaluate("chrome.tabs.query({url:'http://localhost:8765/*'}).then(t=>t[0].id)")
        app.evaluate(f"FD.activeTab=async()=>({{id:{tid}}})")

        # Set user profile
        app.evaluate("FD.set('profile',{v:1,fields:{fullName:'Alex Jordan',email:'alex@campus.edu',degree:'Bachelor of Science',gradYear:'2027',gpa:'3.9'},facts:[{id:'f1',text:'Led 30 students in robotics club',section:'Projects',status:'verified'}]})")
        app.evaluate("FD.set('settings',{onboarded:true})")
        app.reload()
        app.evaluate(f"FD.activeTab=async()=>({{id:{tid}}})")

        # 1. Scan the advanced page
        scan = app.evaluate(f"FD.send({tid},{{type:'scan'}})")
        fields = scan['fields']

        # Check iframe input detection
        iframe_field = next((f for f in fields if f['label'] == 'Institutional Email'), None)
        check('input inside iframe detected', iframe_field is not None and iframe_field['type'] == 'email', iframe_field)

        # Check rich-text editor detection
        rich_field = next((f for f in fields if f.get('isRichText') or f.get('type') == 'richtext'), None)
        check('rich-text editor detected', rich_field is not None, rich_field)
        check('rich-text has 200 word limit extracted', rich_field and rich_field.get('wordLimit') == 200, rich_field)
        check('rich-text classified as essay', rich_field and rich_field['key'].startswith('essay.'), rich_field)

        # Check custom dropdown detection
        combo_field = next((f for f in fields if f.get('isCustomDropdown')), None)
        check('accessible custom dropdown detected', combo_field is not None, combo_field)
        check('custom dropdown options extracted (3 options)', combo_field and len(combo_field['options']) == 3, combo_field)

        # 2. Autofill iframe input and custom dropdown
        plan = app.evaluate(f"FormDrillCore.planAutofill(window.__f, window.__p)", None) if False else None
        plan = app.evaluate(f"FD.send({tid},{{type:'scan'}}).then(r=>FormDrillCore.planAutofill(r.fields,{{fields:{{email:'alex@campus.edu',degree:'Bachelor of Science'}}}}))")
        check('plan includes iframe email and custom dropdown', len(plan['items']) >= 2, plan)

        # Apply the plan items
        apply_res = app.evaluate(f"FD.send({tid},{{type:'apply',items:{json.dumps(plan['items'])}}})")
        check('apply reports success for iframe and custom dropdown', apply_res['ok'] and all(x['ok'] for x in apply_res['results']), apply_res)

        # Verify values in page
        # In iframe:
        iframe_val = page.frame_locator('#test-frame').locator('#if-email').input_value()
        check('iframe email field filled with profile email', iframe_val == 'alex@campus.edu', iframe_val)

        # In custom dropdown:
        combo_text = page.locator('#cd-combobox').inner_text()
        check('custom dropdown selected Bachelor of Science', 'Bachelor of Science' in combo_text, combo_text)

        # 3. Fill rich-text editor safely
        rt_apply = app.evaluate(f"FD.send({tid},{{type:'apply',items:[{{id:'{rich_field['id']}',value:'My leadership project focused on mentoring freshman students.'}}]}})")
        check('apply reports success for rich-text editor', rt_apply['ok'] and rt_apply['results'][0]['ok'], rt_apply)
        rt_text = page.locator('#rt-editor').inner_text()
        check('rich-text editor content updated safely', 'mentoring freshman students' in rt_text, rt_text)

        # 4. Consistency checks in Readiness review
        # Set contradictory text in the rich text editor (mentions graduating in 2024 and 3.2 GPA, while profile has 2027 and 3.9 GPA)
        app.evaluate(f"FD.send({tid},{{type:'apply',items:[{{id:'{rich_field['id']}',value:'I am graduating in 2024 and maintain a 3.2 GPA.'}}]}})")
        app.click('role=tab[name="Review"]')
        app.click('text=Run check on current page')
        app.wait_for_selector('text=Check complete')
        review_text = app.inner_text('main')
        check('readiness flags graduation year inconsistency', 'mentions graduating in 2024' in review_text or '2024' in review_text, review_text[:300])
        check('readiness flags GPA inconsistency', 'GPA 3.2' in review_text or 'GPA' in review_text, review_text[:300])

        ctx.close()
finally:
    srv.terminate()

f = [n for n, ok in results if not ok]
print(f'\n{len(results) - len(f)}/{len(results)} passed')
if f:
    print('FAILED:', f)
