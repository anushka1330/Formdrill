import json, shutil, subprocess, time, os, sys, tempfile
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
TMP = tempfile.mkdtemp(prefix='formdrill-undo-e2e-')

from playwright.sync_api import sync_playwright
shutil.rmtree(TMP + '/ext', ignore_errors=True)
shutil.copytree(ROOT + '/extension', TMP + '/ext')
m = json.load(open(TMP + '/ext/manifest.json'))
m['host_permissions'] = ['http://localhost/*']
json.dump(m, open(TMP + '/ext/manifest.json', 'w'))

srv = subprocess.Popen([sys.executable, '-m', 'http.server', '8765', '--directory', ROOT + '/sample'], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(1.2)
results = []
submits = []

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

        app = ctx.new_page()
        app.goto(f'chrome-extension://{ext}/app.html')
        app.evaluate("FD.set('settings', { onboarded: true })")

        # ---------------------------------------------------------
        # Part 1: Standard form fields (text, textarea, select, checkbox, radio)
        # ---------------------------------------------------------
        page = ctx.new_page()
        page.on('dialog', lambda d: d.accept())
        page.goto('http://localhost:8765/forms.html')
        page.wait_for_load_state('networkidle')
        page.evaluate("document.querySelectorAll('form').forEach(f => f.addEventListener('submit', () => { window.__submitted = (window.__submitted || 0) + 1; }))")

        tid = app.evaluate("chrome.tabs.query({url:'http://localhost:8765/forms.html'}).then(t=>t[0].id)")

        # Verify initial states (empty / unchecked)
        check('s1 initially empty', page.input_value('#s1') == '')
        check('s2 initially empty', page.input_value('#s2') == '')
        check('s3 initially empty', page.input_value('#s3') == '')
        check('s4 select initially empty', page.input_value('#s4') == '')
        check('s5 textarea initially empty', page.input_value('#s5') == '')
        check('agree checkbox initially unchecked', not page.is_checked('input[name=agree]'))
        check('need radio initially unchecked', not page.is_checked('input[name=need][value=yes]') and not page.is_checked('input[name=need][value=no]'))

        # User edits an unrelated field on the page
        page.fill('#i5', 'https://example.com/unrelated-portfolio')

        # Scan and apply autofill
        scan = app.evaluate(f"FD.send({tid}, {{ type: 'scan' }})")
        id_s1 = [f for f in scan['fields'] if f['idAttr'] == 's1'][0]['id']
        id_s2 = [f for f in scan['fields'] if f['idAttr'] == 's2'][0]['id']
        id_s3 = [f for f in scan['fields'] if f['idAttr'] == 's3'][0]['id']
        id_s4 = [f for f in scan['fields'] if f['idAttr'] == 's4'][0]['id']
        id_s5 = [f for f in scan['fields'] if f['idAttr'] == 's5'][0]['id']
        id_chk = [f for f in scan['fields'] if f['type'] == 'checkbox'][0]['id']
        id_rad = [f for f in scan['fields'] if f['type'] == 'radio'][0]['id']

        apply_items = [
            {'id': id_s1, 'value': 'Alice Smith'},
            {'id': id_s2, 'value': 'alice@example.com'},
            {'id': id_s3, 'value': 'Metro University'},
            {'id': id_s4, 'value': 'Canada'},
            {'id': id_s5, 'value': 'I am dedicated to computer science and civic engineering.'},
            {'id': id_chk, 'value': True},
            {'id': id_rad, 'value': 'yes'}
        ]

        apply_res = app.evaluate(f"FD.send({tid}, {{ type: 'apply', items: {json.dumps(apply_items)} }})")
        check('apply succeeded for all items', apply_res['ok'] and all(r['ok'] for r in apply_res['results']))
        check('canUndo is True after apply', apply_res.get('canUndo') is True)

        # Verify fields changed
        check('s1 filled', page.input_value('#s1') == 'Alice Smith')
        check('s2 filled', page.input_value('#s2') == 'alice@example.com')
        check('s3 filled', page.input_value('#s3') == 'Metro University')
        check('s4 select filled', page.input_value('#s4') == 'Canada')
        check('s5 textarea filled', 'dedicated to computer science' in page.input_value('#s5'))
        check('agree checkbox checked', page.is_checked('input[name=agree]'))
        check('need radio selected', page.is_checked('input[name=need][value=yes]'))

        # Verify unrelated field was not touched
        check('unrelated field untouched after apply', page.input_value('#i5') == 'https://example.com/unrelated-portfolio')

        # Execute Undo
        undo_res = app.evaluate(f"FD.send({tid}, {{ type: 'undo' }})")
        check('undo succeeded', undo_res['ok'] and undo_res.get('count') == 7)

        # Verify all fields restored to their initial empty states
        check('s1 restored to empty', page.input_value('#s1') == '')
        check('s2 restored to empty', page.input_value('#s2') == '')
        check('s3 restored to empty', page.input_value('#s3') == '')
        check('s4 select restored to empty', page.input_value('#s4') == '')
        check('s5 textarea restored to empty', page.input_value('#s5') == '')
        check('agree checkbox restored to unchecked', not page.is_checked('input[name=agree]'))
        check('need radio restored to unselected', not page.is_checked('input[name=need][value=yes]'))

        # Verify unrelated field was preserved during undo
        check('unrelated field preserved after undo', page.input_value('#i5') == 'https://example.com/unrelated-portfolio')

        # ---------------------------------------------------------
        # Part 2: Advanced form fields (custom dropdown, rich text, iframe)
        # ---------------------------------------------------------
        adv_page = ctx.new_page()
        adv_page.goto('http://localhost:8765/advanced_forms.html')
        adv_page.wait_for_load_state('networkidle')
        adv_page.evaluate("document.querySelectorAll('form').forEach(f => f.addEventListener('submit', () => { window.__submitted = (window.__submitted || 0) + 1; }))")

        adv_tid = app.evaluate("chrome.tabs.query({url:'http://localhost:8765/advanced_forms.html'}).then(t=>t[0].id)")
        adv_scan = app.evaluate(f"FD.send({adv_tid}, {{ type: 'scan' }})")

        id_cd = [f for f in adv_scan['fields'] if f.get('isCustomDropdown')][0]['id']
        id_rt = [f for f in adv_scan['fields'] if f.get('isRichText')][0]['id']
        id_iframe = [f for f in adv_scan['fields'] if f['label'] == 'Institutional Email'][0]['id']

        adv_apply_res = app.evaluate(f"FD.send({adv_tid}, {{ type: 'apply', items: [{{ id: '{id_cd}', value: 'Master of Science' }}, {{ id: '{id_rt}', value: 'My rich text leadership essay.' }}, {{ id: '{id_iframe}', value: 'adv_iframe@example.com' }}] }})")
        check('advanced apply succeeded', adv_apply_res['ok'] and all(r['ok'] for r in adv_apply_res['results']))

        check('custom dropdown applied', adv_page.eval_on_selector('#opt-ms', 'el => el.getAttribute("aria-selected")') == 'true')
        check('rich-text editor applied', 'My rich text leadership essay.' in adv_page.inner_text('#rt-editor'))
        iframe_val = adv_page.frame_locator('#test-frame').locator('#if-email').input_value()
        check('iframe email applied', iframe_val == 'adv_iframe@example.com')

        # Execute Undo on advanced forms
        adv_undo_res = app.evaluate(f"FD.send({adv_tid}, {{ type: 'undo' }})")
        check('advanced undo reported ok', adv_undo_res['ok'] and adv_undo_res.get('count') == 3)

        check('custom dropdown restored to unselected', adv_page.eval_on_selector('#opt-ms', 'el => el.getAttribute("aria-selected")') == 'false')
        check('rich-text editor restored to empty', adv_page.inner_text('#rt-editor').strip() == '')
        iframe_restored = adv_page.frame_locator('#test-frame').locator('#if-email').input_value()
        check('iframe email restored to empty', iframe_restored == '')

        # ---------------------------------------------------------
        # Part 3: Repeated undo operations and safe stack handling
        # ---------------------------------------------------------
        # At this point, undoStack for adv_page should be empty
        empty_undo = app.evaluate(f"FD.send({adv_tid}, {{ type: 'undo' }})")
        check('undo on empty stack safely returns ok: false', empty_undo['ok'] is False and 'Nothing to undo' in empty_undo['error'])

        # Multi-batch repeated operations
        b1 = app.evaluate(f"FD.send({tid}, {{ type: 'apply', items: [{{ id: '{id_s1}', value: 'Batch 1' }}] }})")
        check('batch 1 applied', page.input_value('#s1') == 'Batch 1')
        b2 = app.evaluate(f"FD.send({tid}, {{ type: 'apply', items: [{{ id: '{id_s1}', value: 'Batch 2' }}] }})")
        check('batch 2 applied', page.input_value('#s1') == 'Batch 2')

        # Undo 1 pops batch 2, restores to Batch 1
        u1 = app.evaluate(f"FD.send({tid}, {{ type: 'undo' }})")
        check('first undo restores batch 1 value', u1['ok'] and page.input_value('#s1') == 'Batch 1' and u1.get('canUndo') is True)

        # Undo 2 pops batch 1, restores to empty
        u2 = app.evaluate(f"FD.send({tid}, {{ type: 'undo' }})")
        check('second undo restores original empty value', u2['ok'] and page.input_value('#s1') == '' and u2.get('canUndo') is False)

        # Undo 3 pops empty stack
        u3 = app.evaluate(f"FD.send({tid}, {{ type: 'undo' }})")
        check('third undo refuses safely', u3['ok'] is False and 'Nothing to undo' in u3['error'])

        # ---------------------------------------------------------
        # Part 4: Never submits forms
        # ---------------------------------------------------------
        submitted1 = page.evaluate('window.__submitted || 0')
        submitted2 = adv_page.evaluate('window.__submitted || 0')
        check('no forms submitted during testing', submitted1 == 0 and submitted2 == 0, (submitted1, submitted2))

        ctx.close()
finally:
    srv.terminate()

f = [n for n, ok in results if not ok]
print(f'\n{len(results) - len(f)}/{len(results)} passed')
print('FAILED:', f)
