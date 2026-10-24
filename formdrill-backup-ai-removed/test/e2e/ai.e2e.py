import json, shutil, subprocess, time, os, sys, tempfile
from playwright.sync_api import sync_playwright
ROOT=os.path.abspath(os.path.join(os.path.dirname(__file__),'..','..')); TMP=tempfile.mkdtemp(prefix='formdrill-e2e-')
shutil.copytree(ROOT+'/extension',TMP+'/ext'); m=json.load(open(TMP+'/ext/manifest.json')); m['host_permissions']=['http://localhost/*']; json.dump(m,open(TMP+'/ext/manifest.json','w'))
web=subprocess.Popen([sys.executable,'-m','http.server','8765','--directory',ROOT+'/sample'],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
api=subprocess.Popen(['node',ROOT+'/server/server.js'],env={**os.environ,'MOCK':'1'},stdout=subprocess.DEVNULL); time.sleep(1.2)
res=[]
def check(n,c,d=''): res.append(bool(c)); print(('PASS ' if c else 'FAIL ')+n+(' :: '+str(d)[:300] if not c and d else ''))
def count():
    import urllib.request; return json.load(urllib.request.urlopen('http://localhost:8787/_count'))['count']
try:
  with sync_playwright() as p:
    ext_path=os.path.normpath(TMP+'/ext')
    ctx=p.chromium.launch_persistent_context(TMP+'/profile',headless=False,args=['--headless=new',f'--disable-extensions-except={ext_path}',f'--load-extension={ext_path}','--no-sandbox'])
    sw=ctx.service_workers[0] if ctx.service_workers else ctx.wait_for_event('serviceworker'); ext=sw.url.split('/')[2]
    page=ctx.new_page(); page.goto('http://localhost:8765/forms.html'); app=ctx.new_page(); app.goto(f'chrome-extension://{ext}/app.html')
    tid=app.evaluate("chrome.tabs.query({url:'http://localhost:8765/*'}).then(t=>t[0].id)")
    app.evaluate("FD.set('profile',{v:1,fields:{email:'private.person@example.com',phone:'555-0100'},facts:[{id:'f1',text:'Tutored 12 students in maths',section:'Projects',status:'verified'},{id:'f2',text:'Unselected secret fact',section:'Awards',status:'unverified'}]})")
    app.evaluate("FD.set('settings',{onboarded:true,aiEnabled:true,aiEndpoint:'http://localhost:8787/improve'})")
    app.reload(); app.evaluate(f"FD.activeTab=async()=>({{id:{tid}}})"); app.click('text=Scan current page'); app.wait_for_selector('article.card')
    card=app.locator('article.card').filter(has_text='Why do you deserve').first
    card.locator('summary').click(); card.locator('label.fact').first.locator('input').check()
    card.locator('textarea').fill('I tutored students and want to keep learning.')
    check('AI button only visible because AI is enabled',card.get_by_text('Improve with AI…').count()==1)
    card.get_by_text('Improve with AI…').click(); app.wait_for_selector('dialog[open]'); d=app.inner_text('dialog'); payload=app.inner_text('dialog pre')
    check('dialog shows destination and exact payload','localhost:8787' in d and 'Tutored 12 students' in payload)
    check('payload excludes unselected facts and contact details','Unselected secret' not in payload and 'private.person' not in payload and '555-0100' not in payload)
    check('nothing sent before the user clicks Send',count()==0)
    app.get_by_role('button',name='Cancel').click(); check('cancel sends nothing',count()==0)
    card.get_by_text('Improve with AI…').click(); app.wait_for_selector('dialog[open]'); app.get_by_role('button',name='Send this to localhost:8787').click()
    app.wait_for_selector('text=Suggested rewrite'); check('exactly one request after consent',count()==1,count())
    check('unsupported claim warning shown (invented award)','National Merit Scholarship' in app.inner_text('dialog') and 'Not found in your text' in app.inner_text('dialog'),app.inner_text('dialog'))
    app.get_by_text('Use as draft').click(); ta=card.locator('textarea')
    check('suggestion goes into draft box, not the page','National Merit' in ta.input_value() and page.input_value('#s5')=='')
    check('using a suggestion clears reviewed state (apply disabled)',card.get_by_role('button',name='Apply to page').is_disabled())
    # provider error handled
    app.locator('article.card').filter(has_text='Why do you deserve').first.locator('textarea').fill('TRIGGER_500 text')
    card2=app.locator('article.card').filter(has_text='Why do you deserve').first; card2.get_by_text('Improve with AI…').click(); app.wait_for_selector('dialog[open]'); app.get_by_role('button',name='Send this to localhost:8787').click()
    app.wait_for_selector('text=returned an error'); check('provider HTTP error shown with recovery (Send re-enabled)',app.get_by_role('button',name='Send this to localhost:8787').is_enabled())
    ctx.close()
finally: web.terminate(); api.terminate()
print(f'{sum(res)}/{len(res)} passed')
