import json, shutil, subprocess, time, sys, os
import os, tempfile
ROOT=os.path.abspath(os.path.join(os.path.dirname(__file__),'..','..'))
TMP=tempfile.mkdtemp(prefix='formdrill-e2e-')

from playwright.sync_api import sync_playwright
SRC=ROOT
shutil.rmtree(TMP+'/ext',ignore_errors=True); shutil.copytree(SRC+'/extension',TMP+'/ext')
m=json.load(open(TMP+'/ext/manifest.json')); m['host_permissions']=['http://localhost/*']; json.dump(m,open(TMP+'/ext/manifest.json','w'))
srv=subprocess.Popen([sys.executable,'-m','http.server','8765','--directory',SRC+'/sample'],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL); time.sleep(1)
results=[]; errors=[]
def check(name,cond,detail=''):
    results.append((name,bool(cond))); print(('PASS ' if cond else 'FAIL ')+name+(' :: '+str(detail) if (detail and not cond) else ''))
try:
  with sync_playwright() as p:
    ext_path=os.path.normpath(TMP+'/ext')
    ctx=p.chromium.launch_persistent_context(TMP+'/profile',headless=False,args=['--headless=new',f'--disable-extensions-except={ext_path}',f'--load-extension={ext_path}','--no-sandbox'])
    sw=ctx.service_workers[0] if ctx.service_workers else ctx.wait_for_event('serviceworker',timeout=10000)
    ext=sw.url.split('/')[2]; check('extension loaded, service worker running',ext)
    page=ctx.new_page(); submits=[]; page.on('console',lambda m: errors.append(m.text+' @ '+m.location.get('url','')) if m.type=='error' else None); page.on('pageerror',lambda e: errors.append(str(e)))
    page.expose_function('onSubmitSeen',lambda: submits.append(1))
    page.goto('http://localhost:8765/forms.html'); page.evaluate("document.querySelectorAll('form').forEach(f=>f.addEventListener('submit',()=>onSubmitSeen()))")
    app=ctx.new_page(); app.on('console',lambda m: errors.append('APP:'+m.text+' @ '+m.location.get('url','')) if m.type=='error' else None); app.on('pageerror',lambda e: errors.append('APP:'+str(e)))
    app.goto(f'chrome-extension://{ext}/app.html'); app.wait_for_selector('text=Welcome to FormDrill'); check('onboarding shows on first run',True)
    app.click('text=Start with a minimal profile'); app.wait_for_selector('text=Your profile'); check('onboarding -> profile tab',True)
    # profile editor via real UI
    app.fill('input[maxlength="500"] >> nth=0','Test Person'); 
    labels={'Email':'test@example.com','Institution':'Example University','Graduation year':'2027','Phone':'555-0100','Country':'India'}
    for lab,val in labels.items(): app.get_by_label(lab,exact=True).fill(val)
    app.fill('input[aria-label="New fact"]','Built a campus event-finder app used by 40 students'); app.click('text=Add fact'); app.click('text=Save profile')
    app.wait_for_selector('text=Profile saved on this device'); check('profile saves via UI',True)
    stored=app.evaluate("FD.get('profile')"); check('profile persisted with fact',len(stored['facts'])==1 and stored['fields'].get('email')=='test@example.com',stored)
    # point active-tab lookup at the sample page
    tabid=app.evaluate("chrome.tabs.query({url:'http://localhost:8765/*'}).then(t=>t[0].id)"); app.evaluate(f"FD.activeTab=async()=>({{id:{tabid}}})")
    app.click('text=Assistant'); app.click('text=Scan current page'); app.wait_for_selector('text=Recognized fields')
    body=app.inner_text('main'); check('scan lists recognized fields and essay questions','Questions to answer' in body and 'Why do you deserve this scholarship' in body,body[:400])
    scan=app.evaluate(f"FD.send({tabid},{{type:'scan'}})")
    byl={f['label']:f for f in scan['fields']}
    check('password field never scanned',not any(f['type']=='password' for f in scan['fields']))
    check('Applicant name -> fullName',byl['Applicant name']['key']=='fullName',byl['Applicant name']['key'])
    check('College name -> institution',byl['College name']['key']=='institution')
    check('E-mail address -> email (high)',byl['E-mail address']['key']=='email' and byl['E-mail address']['classification']['level']=='high')
    check('Legal name -> fullName',byl['Legal name']['key']=='fullName')
    check('Expected graduation -> gradYear',byl['Expected graduation']['key']=='gradYear')
    ess=[f for f in scan['fields'] if f['key'].startswith('essay.')]; check('6 visible essays detected (hidden step-2 field correctly skipped)',len(ess)==6,len(ess))
    lim=[f for f in ess if f['wordLimit']==250]; check('250-word limit extracted from label',len(lim)==1)
    check('radio group detected as one field with options',any(f['type']=='radio' and len(f['options'])==2 for f in scan['fields']))
    cat=scan['category']['category']; check('category suggested (scholarship on first form mix)',cat in ('scholarship','club','internship'),cat)
    # autofill: approved only
    prof=app.evaluate("FD.get('profile')"); plan=app.evaluate("(p)=>FormDrillCore.planAutofill(window.__s,p)",prof) if False else None
    plan=app.evaluate(f"FD.send({tabid},{{type:'scan'}}).then(r=>FormDrillCore.planAutofill(r.fields,{json.dumps(prof)}))")
    check('autofill plan has items',len(plan['items'])>=4,len(plan['items']))
    before=page.input_value('#s1'); check('page untouched before approval',before=='')
    bad=app.evaluate(f"FD.send({tabid},{{type:'apply',items:[]}})"); check('empty apply rejected',bad.get('ok') is False)
    chosen=[i for i in plan['items'] if i['level']=='high' and i['key'] in ('email','country','institution')]
    r=app.evaluate(f"FD.send({tabid},{{type:'apply',items:{json.dumps([{'id':i['id'],'value':i['value']} for i in chosen])}}})")
    check('apply reports success',r['ok'] and all(x['ok'] for x in r['results']),r)
    check('text fields filled',page.input_value('#s3')=='Example University' and page.input_value('#s2')=='test@example.com',page.input_value('#s3'))
    check('select filled (India)',page.input_value('#s4')=='India' or page.eval_on_selector('#s4','e=>e.value')=='India')
    check('unapproved fields left alone (name fields untouched)',page.input_value('#s1')=='' and page.input_value('#i1')=='')
    u=app.evaluate(f"FD.send({tabid},{{type:'undo'}})"); check('undo restores',u['ok'] and page.input_value('#s3')=='',u)
    # radio/checkbox
    scan=app.evaluate(f"FD.send({tabid},{{type:'scan'}})"); rid=[f for f in scan['fields'] if f['type']=='radio'][0]['id']; cid=[f for f in scan['fields'] if f['type']=='checkbox'][0]['id']
    r=app.evaluate(f"FD.send({tabid},{{type:'apply',items:[{{id:'{rid}',value:'yes'}},{{id:'{cid}',value:true}}]}})")
    check('radio selected',page.is_checked('input[name=need][value=yes]')); check('checkbox ticked',page.is_checked('input[name=agree]'))
    # essay apply + react-style events
    page.evaluate("window.__ev=[];document.querySelector('#s5').addEventListener('input',()=>__ev.push('input'));document.querySelector('#s5').addEventListener('change',()=>__ev.push('change'))")
    sid=[f for f in scan['fields'] if f['label'].startswith('Why do you deserve')][0]['id']
    app.evaluate(f"FD.send({tabid},{{type:'apply',items:[{{id:'{sid}',value:'hello essay'}}]}})"); check('textarea filled and input/change events fired',page.input_value('#s5')=='hello essay' and page.evaluate('__ev')==['input','change'])
    # malformed message rejected
    bad=app.evaluate(f"FD.send({tabid},{{type:'apply',items:[{{id:5,value:{{}}}}]}})"); check('malformed apply rejected',bad.get('ok') is False,bad)
    # snapshot save/restore with sensitive exclusion
    page.fill('#i7','hunter2-secret'); page.fill('#i1','Snap Person'); page.fill('#s3','Snap Uni')
    scan=app.evaluate(f"FD.send({tabid},{{type:'scan'}})"); snap=app.evaluate(f"(r)=>FormDrillCore.buildSnapshot(r.fields,{{name:'t',origin:'x'}})",scan)
    check('snapshot excludes password',('hunter2-secret' not in json.dumps(snap)) and any(i['value']=='Snap Person' for i in snap['items']))
    page.fill('#i1',''); page.fill('#s3','')
    r=app.evaluate(f"FD.send({tabid},{{type:'scan'}}).then(s=>FD.send({tabid},{{type:'restore',items:{json.dumps([{'fieldKey':i['fieldKey'],'value':i['value']} for i in snap['items']])}}}))")
    check('restore refills values',page.input_value('#i1')=='Snap Person' and page.input_value('#s3')=='Snap Uni',r)
    # dynamic fields
    app.evaluate(f"FD.send({tabid},{{type:'scan'}})"); st=app.evaluate(f"FD.send({tabid},{{type:'status'}})"); check('dirty false right after scan',st['dirty'] is False,st)
    page.click('text=Next'); page.click('#addref'); page.wait_for_timeout(300)
    st=app.evaluate(f"FD.send({tabid},{{type:'status'}})"); check('dirty true after dynamic change',st['dirty'] is True)
    scan=app.evaluate(f"FD.send({tabid},{{type:'scan'}})"); check('dynamic reference field found on rescan',any(f['name']=='ref1' and f['type']=='email' for f in scan['fields']))
    check('step hint read from aria-current',scan['page']['step'].startswith('Step 2'),scan['page']['step'])
    # UI: essay card flow
    page.reload(); app.get_by_role('button',name='Rescan page').click(); app.wait_for_selector('text=Questions to answer')
    card=app.locator('article.card').filter(has_text='Why do you deserve').first
    card.locator('summary').click(); card.locator('input[type=checkbox]').first.check(); card.get_by_text('Build outline from selected facts').click()
    ta=card.locator('textarea'); v=ta.input_value(); check('outline built from selected fact, placeholders present','Built a campus event-finder' in v and '[Opening' in v)
    check('apply disabled while placeholders remain',card.get_by_role('button',name='Apply to page').is_disabled())
    ta.fill('I built a campus event-finder app used by 40 students. It taught me to ship. I want to study HCI next.'); card.get_by_label('I have reviewed this answer').check()
    check('apply enabled after real text + review',card.get_by_role('button',name='Apply to page').is_enabled())
    check('word counter shows limit',('/ 250 words' in card.inner_text()))
    app.on('dialog',lambda d:d.accept()); card.get_by_role('button',name='Apply to page').click(); app.wait_for_selector('text=Answer applied to the page'); check('essay applied to page after confirm',page.input_value('#s5').startswith('I built a campus'))
    ta.fill('word '*300); check('over-limit disables apply',card.get_by_role('button',name='Apply to page').is_disabled())
    # readiness UI
    app.click('role=tab[name="Review"]'); app.click('text=Run check on current page'); app.wait_for_selector('text=Check complete'); rt=app.inner_text('main'); check('readiness lists required-empty issue','Required field is empty' in rt,rt[:200])
    # save draft + snapshot listing
    app.click('role=tab[name="Assistant"]');
    check('workspace undo button enabled after essay applied', not app.eval_on_selector('#workspace-undo', 'e => e.disabled'))
    app.click('#workspace-undo'); app.wait_for_selector('text=Undone.')
    check('workspace undo restores textarea', page.input_value('#s5') == '')
    check('workspace undo button disabled after undo', app.eval_on_selector('#workspace-undo', 'e => e.disabled'))
    # settings: AI off, endpoint validation, export, delete
    app.click('role=tab[name="Settings & privacy"]'); app.fill('input[type=url]','http://evil.example'); app.click('text=Save AI settings'); app.wait_for_selector('text=Endpoint must start with https'); check('insecure AI endpoint rejected',True)
    with app.expect_download() as dl: app.click('text=Export profile')
    check('export downloads a file',dl.value.suggested_filename=='formdrill-profile.json')
    check('no form submitted during entire run',len(submits)==0,len(submits))
    # popup page loads without errors
    pop=ctx.new_page(); pop.on('pageerror',lambda e: errors.append('POP:'+str(e))); pop.goto(f'chrome-extension://{ext}/popup.html'); pop.wait_for_timeout(800); check('popup renders',pop.inner_text('h1')=='FormDrill'); print('popup status text:',pop.inner_text('#status')[:120])
    ctx.close()
finally: srv.terminate()
print('\nconsole/page errors:',[e for e in errors if 'favicon' not in e])
f=[n for n,ok in results if not ok]; print(f'\n{len(results)-len(f)}/{len(results)} passed'); print('FAILED:',f)
