import json, shutil, time, sys, os, tempfile
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
TMP = tempfile.mkdtemp(prefix='formdrill-lang-e2e-')

from playwright.sync_api import sync_playwright

SRC = ROOT
shutil.rmtree(TMP + '/ext', ignore_errors=True)
shutil.copytree(SRC + '/extension', TMP + '/ext')
results = []
errors = []

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
        check('extension loaded', bool(ext))

        app = ctx.new_page()
        app.on('console', lambda m: errors.append('APP:' + m.text) if m.type == 'error' else None)
        app.goto(f'chrome-extension://{ext}/app.html')
        app.wait_for_selector('text=Welcome to FormDrill')
        app.click('text=Start with a minimal profile')
        app.wait_for_selector('text=Your profile')

        # 1. Initially empty state
        check('helper text visible', app.is_visible('text=Add 1–7 languages you are proficient in.'))
        check('empty state message shown', app.is_visible('text=No languages added yet.'))

        # 2. Add first language
        app.click('button:has-text("+ Add Language")')
        check('first language input created', app.is_visible('input[aria-label="Language 1"]'))
        check('first delete button created', app.is_visible('button[aria-label="Remove language 1"]'))

        # Check alignment: same row, input on left, button on right, vertically aligned
        inp_box = app.locator('input[aria-label="Language 1"]').bounding_box()
        btn_box = app.locator('button[aria-label="Remove language 1"]').bounding_box()
        check('input is to the left of delete button', inp_box['x'] < btn_box['x'], f"inp x={inp_box['x']}, btn x={btn_box['x']}")
        check('input and delete button are vertically aligned on same row', abs(inp_box['y'] - btn_box['y']) < 5, f"inp y={inp_box['y']}, btn y={btn_box['y']}")
        check('delete button is compact square', abs(btn_box['width'] - btn_box['height']) < 4, f"w={btn_box['width']}, h={btn_box['height']}")

        # 3. Type text with comma into row 1 - must not split or auto-create another row
        app.fill('input[aria-label="Language 1"]', 'Hindi, English')
        rows = app.locator('.lang-row').count()
        check('typing does not create extra rows', rows == 1, f"rows={rows}")
        check('comma-separated text stays in single row as entered', app.input_value('input[aria-label="Language 1"]') == 'Hindi, English')

        # 4. Add second language
        app.click('button:has-text("+ Add Language")')
        rows = app.locator('.lang-row').count()
        check('second row added', rows == 2, f"rows={rows}")
        check('row 1 value preserved after adding row 2', app.input_value('input[aria-label="Language 1"]') == 'Hindi, English')
        check('row 2 aria-label correct', app.is_visible('input[aria-label="Language 2"]'))
        check('row 2 delete button aria-label correct', app.is_visible('button[aria-label="Remove language 2"]'))

        app.fill('input[aria-label="Language 2"]', 'French')

        # 5. Add up to 7 languages
        for i in range(3, 8):
            app.click('button:has-text("+ Add Language")')
            app.fill(f'input[aria-label="Language {i}"]', f'Language {i}')

        check('7 language rows present', app.locator('.lang-row').count() == 7)
        check('+ Add Language button disabled at 7', app.is_disabled('button.lang-add-btn'))
        check('7 of 7 counter displayed', app.is_visible('text=7 of 7 languages added'))

        # 6. Remove row 2 (French)
        app.click('button[aria-label="Remove language 2"]')
        check('row count decreased to 6', app.locator('.lang-row').count() == 6)
        check('row 1 value still preserved', app.input_value('input[aria-label="Language 1"]') == 'Hindi, English')
        check('former row 3 is now row 2', app.input_value('input[aria-label="Language 2"]') == 'Language 3')
        check('+ Add Language button re-enabled', not app.is_disabled('button.lang-add-btn'))
        check('counter removed when below 7', not app.is_visible('text=7 of 7 languages added'))

        # 7. Save profile and verify persistence
        app.click('button:has-text("Save profile")')
        app.wait_for_selector('text=Profile saved on this device')
        stored = app.evaluate("FD.get('profile')")
        langs = stored['lists']['languages']
        check('profile persisted 6 languages', len(langs) == 6, f"len={len(langs)}")
        check('first persisted language is Hindi, English', langs[0]['name'] == 'Hindi, English')

        ctx.close()
finally:
    shutil.rmtree(TMP, ignore_errors=True)

fails = [n for n, ok in results if not ok]
print(f"\n{len(results)-len(fails)}/{len(results)} passed")
if fails:
    print("FAILED:", fails)
    sys.exit(1)
