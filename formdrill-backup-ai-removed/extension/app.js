'use strict';
(async () => {
  const C = FormDrillCore, { h } = FD;
  const main = document.getElementById('main'), tabsEl = document.getElementById('tabs'), live = document.getElementById('live');
  const TABS = [['assistant', 'Assistant'], ['review', 'Review'], ['saved', 'Saved'], ['profile', 'Profile'], ['settings', 'Settings & privacy']];
  let tab = location.hash.slice(1); if (!TABS.some((t) => t[0] === tab)) tab = 'assistant';
  let profile = C.normalizeProfile(await FD.get('profile', null));
  let settings = { ...FD.DEFAULT_SETTINGS, ...(await FD.get('settings', {})) };
  let scan = null, notice = null, issues = null;
  const S = { drafts: {}, selected: {}, reviewed: new Set(), approach: {}, category: null, catUrl: '' };

  const notify = (msg, kind = 'ok') => { notice = { msg, kind }; live.textContent = msg; render(); window.scrollTo(0, 0); };
  const save = async (key, val) => { try { await FD.set(key, val); return true; } catch (e) { notify('Could not save (browser storage error). Free up space by deleting old snapshots or drafts, then retry.', 'err'); return false; } };
  const badge = (lvl, text) => h('span', { class: 'badge ' + lvl }, text || lvl);

  async function doScan(quiet) {
    const t = await FD.activeTab();
    if (!t || !t.id) { notify('No active tab found.', 'err'); return false; }
    const r = await FD.send(t.id, { type: 'scan' });
    if (!r.ok) { notify(r.error || 'Scan failed.', 'err'); return false; }
    scan = { ...r, tabId: t.id };
    if (!S.category || S.catUrl !== r.page.url) { S.category = r.category.category; S.catUrl = r.page.url; }
    document.getElementById('changed').hidden = true;
    if (!quiet) notify(`Scanned ${r.fields.length} fields. Nothing on the page was changed.`);
    return true;
  }

  /* ---------- onboarding ---------- */
  function onboarding() {
    const done = async (next) => { settings.onboarded = true; if (await save('settings', settings)) { tab = next; notify('Welcome to FormDrill.'); } };
    return h('section', { class: 'card' }, h('h1', {}, 'Welcome to FormDrill'),
      h('p', {}, 'FormDrill helps you reuse your real details across long applications and write clearer answers from your real experience. It never invents qualifications and never submits a form.'),
      h('ul', {}, h('li', {}, 'Your profile is stored only in this browser (chrome.storage.local). Nothing is uploaded.'), h('li', {}, 'Autofill and applying a drafted answer happen only after you review and click Apply.'), h('li', {}, 'AI help is off by default. If you turn it on, you see exactly what will be sent before anything leaves your device.')),
      h('div', { class: 'row' }, h('button', { class: 'primary', type: 'button', onclick: () => done('profile') }, 'Start with a minimal profile'), h('button', { type: 'button', onclick: () => done('assistant') }, 'Skip for now')));
  }

  /* ---------- assistant ---------- */
  function essayCard(f) {
    const limit = f.wordLimit || null, sel = (S.selected[f.id] = S.selected[f.id] || new Set());
    if (S.drafts[f.id] === undefined) S.drafts[f.id] = typeof f.value === 'string' ? f.value : '';
    const counter = h('span', { class: 'count' }), flags = h('ul', { class: 'flags' }), hint = h('small', { class: 'mut' });
    const ta = h('textarea', { rows: '8', 'aria-label': 'Draft answer: ' + f.label, value: S.drafts[f.id] });
    const rv = h('input', { type: 'checkbox', id: 'rv' + f.id, checked: S.reviewed.has(f.id) });
    const applyBtn = h('button', { class: 'primary', type: 'button' }, 'Apply to page');
    function refresh() {
      const t = ta.value; S.drafts[f.id] = t; const n = C.countWords(t);
      counter.textContent = limit ? `${n} / ${limit} words` : `${n} words`; counter.className = 'count' + (limit && n > limit ? ' over' : '');
      flags.replaceChildren(...C.genericFlags(t).map((x) => h('li', {}, x)));
      const why = !t.trim() ? 'Write or paste an answer first.' : C.hasPlaceholders(t) ? 'Replace the [bracketed] outline placeholders first.' : limit && n > limit ? 'Shorten the answer to the word limit first.' : !rv.checked ? 'Tick "I have reviewed this answer" first.' : '';
      applyBtn.disabled = !!why; hint.textContent = why;
    }
    ta.oninput = refresh; rv.onchange = () => { rv.checked ? S.reviewed.add(f.id) : S.reviewed.delete(f.id); refresh(); };
    const chosen = () => profile.facts.filter((x) => sel.has(x.id));
    const outline = h('button', { type: 'button', onclick: () => {
      if (ta.value.trim() && !confirm('Replace your current text with a fresh outline?')) return;
      ta.value = C.scaffold({ key: f.key, category: S.category, approach: S.approach[f.id], facts: chosen(), wordLimit: limit }); rv.checked = false; S.reviewed.delete(f.id); refresh();
    } }, 'Build outline from selected facts');
    applyBtn.onclick = async () => {
      if (!confirm('Write this answer into the page field? You can undo it afterwards.')) return;
      const r = await FD.send(scan.tabId, { type: 'apply', items: [{ id: f.id, value: ta.value }] });
      notify(r.ok && r.results[0].ok ? 'Answer applied to the page. Review it there before submitting.' : (r.error || r.results[0].reason || 'Could not apply. Paste it manually.'), r.ok && r.results[0].ok ? 'ok' : 'err');
      if (r.ok && r.results[0].ok) {
        if (await doScan(true)) render();
      }
    };
    const ai = settings.aiEnabled ? h('button', { type: 'button', onclick: () => aiDialog(f, ta, rv, refresh, chosen) }, 'Improve with AI…') : null;
    const factBox = h('details', {}, h('summary', {}, `Facts to use (${sel.size} selected)`), profile.facts.length ? profile.facts.map((x) => h('label', { class: 'fact' }, h('input', { type: 'checkbox', checked: sel.has(x.id), onchange: (e) => { e.target.checked ? sel.add(x.id) : sel.delete(x.id); } }), h('span', {}, x.text, ' ', badge(x.status))))
      : h('p', { class: 'mut' }, 'No facts saved yet. Add some in Profile; they are the only material drafts are built from.'));
    const prompts = C.brainstormPrompts(S.category, f.label + ' ' + f.nearby);
    const apprSel = S.category === 'club' ? h('label', { class: 'f' }, h('span', {}, 'Approach'), h('select', { onchange: (e) => { S.approach[f.id] = e.target.value; } }, h('option', { value: '' }, 'No preference'), Object.keys(C.APPROACHES).map((a) => h('option', { value: a, selected: S.approach[f.id] === a }, a)))) : null;
    refresh();
    const save2 = h('button', { type: 'button', onclick: async () => {
      if (!ta.value.trim()) return notify('Nothing to save yet.', 'err');
      const d = await FD.get('drafts', []); if (await save('drafts', [{ id: 'd' + Date.now().toString(36), question: f.label, text: ta.value, savedAt: new Date().toISOString(), origin: scan.page.url }, ...d].slice(0, 100))) notify('Draft saved locally.');
    } }, 'Save draft');
    return h('article', { class: 'card' }, h('h3', {}, f.label || 'Untitled question'), h('small', { class: 'mut' }, limit ? `Word limit detected: ${limit}. ` : '', f.required ? 'Required.' : ''),
      h('ul', {}, prompts.map((p) => h('li', {}, p.kind === 'idea' ? h('em', {}, p.text) : p.text))),
      factBox, apprSel, h('div', { class: 'row' }, outline, ai), ta, h('div', { class: 'row between' }, counter, hint), flags,
      h('div', { class: 'row' }, h('label', {}, rv, ' I have reviewed this answer'), save2, applyBtn));
  }

  function aiDialog(f, ta, rv, refresh, chosen) {
    const facts = chosen();
    const payload = { task: 'improve_draft', category: S.category, question: f.label, wordLimit: f.wordLimit || null, draft: ta.value, facts: facts.map((x) => ({ text: x.text, status: x.status })) };
    if (!C.isValidEndpoint(settings.aiEndpoint)) return notify('Set a valid AI endpoint (https, or http://localhost) in Settings first.', 'err');
    const dlg = h('dialog', {}), out = h('div', { role: 'status' });
    const send = h('button', { class: 'primary', type: 'button' }, 'Send this to ' + new URL(settings.aiEndpoint).host);
    send.onclick = async () => {
      let granted = false;
      try { granted = await chrome.permissions.request({ origins: [new URL(settings.aiEndpoint).origin + '/*'] }); } catch (e) { /* handled below */ }
      if (!granted) { out.textContent = 'Permission to contact that server was not granted. Nothing was sent.'; return; }
      send.disabled = true; out.textContent = 'Sending…';
      const r = await C.callProvider(settings.aiEndpoint, C.buildAiRequest(payload, true));
      if (!r.ok) { out.textContent = r.error; send.disabled = false; return; }
      const v = C.validateAiResponse(r.data, [ta.value, ...facts.map((x) => x.text)]);
      if (!v.ok) { out.textContent = v.error; send.disabled = false; return; }
      out.replaceChildren(h('h3', {}, 'Suggested rewrite'), h('pre', { class: 'payload' }, v.draft),
        v.unsupported.length ? h('p', { class: 'err', role: 'alert' }, 'Not found in your text or selected facts, so verify or remove: ' + v.unsupported.join(', ')) : h('p', {}, 'No unsupported numbers, awards or titles detected (a simple check, not a guarantee).'),
        h('button', { type: 'button', onclick: () => { ta.value = v.draft; rv.checked = false; S.reviewed.delete(f.id); refresh(); dlg.close(); notify('Suggestion placed in the draft box. Review and edit it before applying.'); } }, 'Use as draft'));
    };
    dlg.append(h('h2', {}, 'Review what will be sent'), h('p', {}, 'Only the text below leaves your device, to ', h('strong', {}, settings.aiEndpoint), '. Nothing else from your profile or the page is included.'), h('pre', { class: 'payload' }, JSON.stringify(payload, null, 2)), out, h('div', { class: 'row' }, send, h('button', { type: 'button', onclick: () => dlg.close() }, 'Cancel')));
    dlg.addEventListener('close', () => dlg.remove()); document.body.append(dlg); dlg.showModal();
  }

  function assistant() {
    const root = h('section', {}, h('h1', {}, 'Application assistant'),
      h('p', { class: 'mut' }, 'Scan the page you have open. FormDrill reads field labels only to suggest mappings and prompts.'),
      h('div', { class: 'row' },
        h('button', { class: 'primary', type: 'button', onclick: async () => { if (await doScan()) render(); } }, scan ? 'Rescan page' : 'Scan current page'),
        h('button', { type: 'button', id: 'workspace-undo', disabled: !(scan && scan.canUndo), onclick: async () => {
          const u = await FD.send(scan.tabId, { type: 'undo' });
          notify(u.ok ? (u.failed ? `Undone (${u.failed} field could not be restored).` : 'Undone.') : (u.error || 'Nothing to undo.'), u.ok ? 'ok' : 'err');
          if (await doScan(true)) render();
        } }, 'Undo last fill')
      ));
    if (!scan) return root;
    const essays = scan.fields.filter((f) => f.key.startsWith('essay.')), others = scan.fields.filter((f) => !f.key.startsWith('essay.'));
    root.append(h('p', {}, h('strong', {}, scan.page.title || 'Untitled page'), scan.page.step ? ` · step: ${scan.page.step}` : ''),
      h('label', { class: 'f' }, h('span', {}, 'Application category (auto-detected suggestion; change if wrong)'), h('select', { onchange: (e) => { S.category = e.target.value; render(); } }, Object.entries(C.CATEGORIES).map(([k, v]) => h('option', { value: k, selected: S.category === k }, v)))),
      h('h2', {}, `Recognized fields (${others.length})`),
      others.length ? h('table', {}, h('tbody', {}, others.map((f) => h('tr', {}, h('td', {}, f.label || f.name || f.placeholder || '(no label)'),
        h('td', {}, h('select', { 'aria-label': 'Maps to for ' + (f.label || f.name), onchange: (e) => { f.key = e.target.value; f.classification = { ...f.classification, key: e.target.value, level: 'high', confidence: 1 }; } }, h('option', { value: '' }, 'Not mapped'), C.PROFILE_FIELDS.map((p) => h('option', { value: p.key, selected: f.key === p.key }, p.label)))),
        h('td', {}, badge(f.classification.level, f.classification.ambiguous ? 'ambiguous' : f.classification.level)))))) : h('p', { class: 'mut' }, 'None.'),
      h('h2', {}, `Questions to answer (${essays.length})`), ...(essays.length ? essays.map(essayCard) : [h('p', { class: 'mut' }, 'No long-answer questions found. Rich-text editors and custom widgets are not detected; enter those manually.')]));
    return root;
  }

  /* ---------- review ---------- */
  function review() {
    const list = issues ? (issues.length ? ['error', 'warn', 'info'].map((s) => { const g = issues.filter((i) => i.severity === s); return g.length ? h('div', { class: 'card' }, h('h3', {}, { error: 'Fix before submitting', warn: 'Worth a look', info: 'Suggestions (optional)' }[s]), h('ul', {}, g.map((i) => h('li', {}, i.message)))) : null; }) : h('p', { class: 'notice ok' }, 'No problems found by these checks. It cannot predict outcomes or see the organisation\'s own rules.')) : null;
    return h('section', {}, h('h1', {}, 'Readiness check'), h('p', { class: 'mut' }, 'Checks required fields, word limits, formats, placeholders, profile fact consistency and generic wording. It does not block you and does not predict any decision.'),
      h('button', { class: 'primary', type: 'button', onclick: async () => { if (await doScan(true)) { scan.fields.forEach((f) => { if (S.drafts[f.id] && !f.value) f.value = ''; }); issues = C.readiness(scan.fields, { reviewed: S.reviewed, profile }); notify(`Check complete: ${issues.length} item${issues.length === 1 ? '' : 's'}.`); } } }, 'Run check on current page'), list);
  }

  /* ---------- saved ---------- */
  async function restoreFlow(snap) {
    if (!(await doScan(true))) return;
    const d = C.diffSnapshot(snap, scan.fields), dlg = h('dialog', {});
    const rows = d.matched.map((i, n) => h('label', { class: 'fact' }, h('input', { type: 'checkbox', checked: true, 'data-n': String(n) }), h('span', {}, h('strong', {}, i.label || i.fieldKey), ': ', typeof i.value === 'string' ? i.value.slice(0, 80) : String(i.value))));
    dlg.append(h('h2', {}, 'Restore "' + snap.name + '"'),
      d.structureChanged ? h('p', { class: 'err', role: 'alert' }, `This form has changed since you saved it (${d.missing.length} saved fields missing, ${d.added.length} new). Values may be outdated.`) : h('p', {}, 'The form structure matches the snapshot.'),
      h('p', { class: 'mut' }, 'Saved ' + new Date(snap.savedAt).toLocaleString() + '. Files, passwords and payment details are never restored.'),
      ...(rows.length ? rows : [h('p', {}, 'No saved values match fields on this page.')]),
      h('div', { class: 'row' }, h('button', { class: 'primary', type: 'button', disabled: !rows.length, onclick: async () => {
        const items = [...dlg.querySelectorAll('input:checked')].map((c) => d.matched[Number(c.dataset.n)]).map((i) => ({ fieldKey: i.fieldKey, value: i.value }));
        if (!items.length) return;
        const r = await FD.send(scan.tabId, { type: 'restore', items }); dlg.close();
        notify(r.ok ? `Restored ${r.results.filter((x) => x.ok).length} of ${items.length} values. Check the page before continuing.` : r.error, r.ok ? 'ok' : 'err');
        if (r.ok) {
          if (await doScan(true)) render();
        }
      } }, 'Restore selected'), h('button', { type: 'button', onclick: () => dlg.close() }, 'Cancel')));
    dlg.addEventListener('close', () => dlg.remove()); document.body.append(dlg); dlg.showModal();
  }
  function saved() {
    const root = h('section', {}, h('h1', {}, 'Saved progress & drafts'), h('p', { class: 'mut' }, 'Everything here is stored only in this browser. Some sites expire forms server-side or use custom controls that cannot be restored.'), h('h2', {}, 'Snapshots'));
    const wrap = h('div', {}), wrap2 = h('div', {}); root.append(wrap, h('h2', {}, 'Saved drafts'), wrap2);
    FD.get('snapshots', []).then((list) => wrap.append(...(list.length ? list.map((s) => h('div', { class: 'card' }, h('h3', {}, s.name), h('small', {}, `${new Date(s.savedAt).toLocaleString()} · ${s.items.length} values · ${s.origin}${s.step ? ' · ' + s.step : ''}`),
      h('div', { class: 'row' }, h('button', { type: 'button', onclick: () => restoreFlow(s) }, 'Review & restore'), h('button', { class: 'danger', type: 'button', onclick: async () => { if (confirm('Delete this snapshot?') && await save('snapshots', list.filter((x) => x.id !== s.id))) notify('Snapshot deleted.'); } }, 'Delete')))) : [h('p', { class: 'mut' }, 'No snapshots yet. Use "Save progress" in the popup on a form page.')])));
    FD.get('drafts', []).then((list) => wrap2.append(...(list.length ? list.map((d) => h('div', { class: 'card' }, h('h3', {}, d.question), h('small', {}, new Date(d.savedAt).toLocaleString()), h('p', {}, d.text.slice(0, 300) + (d.text.length > 300 ? '…' : '')),
      h('div', { class: 'row' }, h('button', { type: 'button', onclick: async () => { try { await navigator.clipboard.writeText(d.text); notify('Draft copied to clipboard.'); } catch (e) { notify('Clipboard access was denied. Select the text and copy manually.', 'err'); } } }, 'Copy'), h('button', { class: 'danger', type: 'button', onclick: async () => { if (confirm('Delete this draft?') && await save('drafts', list.filter((x) => x.id !== d.id))) notify('Draft deleted.'); } }, 'Delete')))) : [h('p', { class: 'mut' }, 'No saved drafts.')])));
    return root;
  }

  /* ---------- profile ---------- */
  function profileView() {
    const draft = JSON.parse(JSON.stringify(profile)), inputs = {};
    const groups = [...new Set(C.PROFILE_FIELDS.map((p) => p.section))];
    const factList = h('div', {}), nf = h('input', { type: 'text', 'aria-label': 'New fact', maxlength: '2000' });
    const nsec = h('select', { 'aria-label': 'Fact section' }, C.FACT_SECTIONS.map((s) => h('option', { value: s }, s)));
    const nst = h('select', { 'aria-label': 'Fact status' }, h('option', { value: 'verified' }, 'Verified (I can prove it)'), h('option', { value: 'unverified' }, 'Unverified (my own claim)'));
    const drawFacts = () => factList.replaceChildren(...(draft.facts.length ? draft.facts.map((x) => h('div', { class: 'fact' }, h('span', {}, `[${x.section}] ${x.text} `, badge(x.status)), h('button', { class: 'danger', type: 'button', 'aria-label': 'Remove fact', onclick: () => { draft.facts = draft.facts.filter((y) => y.id !== x.id); drawFacts(); } }, 'Remove'))) : [h('p', { class: 'mut' }, 'No facts yet. Add real experiences, projects and achievements. Drafts are built only from these.')]));
    drawFacts();
    return h('section', {}, h('h1', {}, 'Your profile'), h('p', { class: 'mut' }, 'Stored locally. FormDrill never saves form answers here unless you add them yourself.'),
      groups.map((g) => h('div', { class: 'card' }, h('h3', {}, g), h('div', { class: 'grid' }, C.PROFILE_FIELDS.filter((p) => p.section === g).map((p) => h('label', { class: 'f' }, h('span', {}, p.label), inputs[p.key] = h('input', { type: 'text', value: draft.fields[p.key] || '', maxlength: '500' })))))),
      h('div', { class: 'card' }, h('h3', {}, 'Facts, achievements & experiences'), factList,
        h('div', { class: 'grid' }, h('label', { class: 'f' }, h('span', {}, 'Fact'), nf), h('label', { class: 'f' }, h('span', {}, 'Section'), nsec), h('label', { class: 'f' }, h('span', {}, 'Status'), nst)),
        h('button', { type: 'button', onclick: () => { const t = nf.value.trim(); if (!t) return notify('Type a fact first.', 'err'); draft.facts.push({ id: 'f' + Date.now().toString(36), text: t, section: nsec.value, status: nst.value }); nf.value = ''; drawFacts(); } }, 'Add fact')),
      h('button', { class: 'primary', type: 'button', onclick: async () => {
        for (const [k, el] of Object.entries(inputs)) { const v = el.value.trim(); if (v) draft.fields[k] = v; else delete draft.fields[k]; }
        const v = C.validateProfile(draft); if (!v.ok) return notify('Not saved: ' + v.errors.join(' '), 'err');
        profile = draft; if (await save('profile', profile)) notify('Profile saved on this device.');
      } }, 'Save profile'));
  }

  /* ---------- settings ---------- */
  function settingsView() {
    const ep = h('input', { type: 'url', value: settings.aiEndpoint, placeholder: 'https://your-server.example/formdrill', 'aria-label': 'AI endpoint URL' });
    const on = h('input', { type: 'checkbox', checked: settings.aiEnabled });
    const file = h('input', { type: 'file', accept: 'application/json', 'aria-label': 'Import profile file' });
    return h('section', {}, h('h1', {}, 'Settings & privacy'),
      h('div', { class: 'card' }, h('h3', {}, 'Optional AI help (off by default)'),
        h('p', { class: 'mut' }, 'FormDrill has no built-in AI and no API key. If you run your own compatible server, enter its URL. Each request shows the exact text first and needs your click; Chrome also asks permission for that one server.'),
        h('label', {}, on, ' Enable AI help'), h('label', { class: 'f' }, h('span', {}, 'Endpoint (https, or http://localhost)'), ep),
        h('button', { type: 'button', onclick: async () => { if (ep.value && !C.isValidEndpoint(ep.value)) return notify('Endpoint must start with https:// (or http://localhost).', 'err'); if (on.checked && !ep.value) return notify('Enter an endpoint to enable AI help.', 'err'); settings = { ...settings, aiEnabled: on.checked, aiEndpoint: ep.value.trim() }; if (await save('settings', settings)) notify('Settings saved.'); } }, 'Save AI settings')),
      h('div', { class: 'card' }, h('h3', {}, 'Your data'),
        h('div', { class: 'row' }, h('button', { type: 'button', onclick: async () => { if (!confirm('Export your profile as a file? It contains personal information; keep it safe.')) return; FD.download('formdrill-profile.json', JSON.stringify(profile, null, 2)); notify('Profile exported to your downloads.'); } }, 'Export profile'), file,
          h('button', { type: 'button', onclick: async () => { const f = file.files[0]; if (!f) return notify('Choose a JSON file first.', 'err'); if (f.size > 1e6) return notify('File is too large to be a FormDrill profile.', 'err'); try { const p = JSON.parse(await f.text()), v = C.validateProfile(p); if (!v.ok) return notify('Import rejected: ' + v.errors.join(' '), 'err'); if (!confirm(`Replace your profile with ${Object.keys(p.fields).length} fields and ${p.facts.length} facts from this file?`)) return; profile = C.normalizeProfile(p); if (await save('profile', profile)) notify('Profile imported.'); } catch (e) { notify('Import failed: that file is not valid JSON.', 'err'); } } }, 'Import profile')),
        h('p', {}, h('button', { class: 'danger', type: 'button', onclick: async () => { if (!confirm('Delete your profile, snapshots, drafts and settings? This cannot be undone.')) return; await chrome.storage.local.clear(); profile = C.emptyProfile(); settings = { ...FD.DEFAULT_SETTINGS, onboarded: true }; await save('settings', settings); notify('All FormDrill data was deleted.'); } }, 'Delete all data'))),
      h('div', { class: 'card' }, h('h3', {}, 'Permissions explained'), h('ul', {},
        h('li', {}, h('strong', {}, 'activeTab + scripting: '), 'lets FormDrill read and fill the page you are viewing, only after you click its icon. No all-sites access.'),
        h('li', {}, h('strong', {}, 'storage: '), 'keeps your profile, snapshots and drafts on this device.'),
        h('li', {}, h('strong', {}, 'sidePanel: '), 'shows this workspace beside the page.'),
        h('li', {}, h('strong', {}, 'Optional host access: '), 'requested one server at a time, only if you use AI help.')),
        h('p', {}, 'Stored locally: profile, snapshots (never passwords, tokens or payment fields), drafts, settings. Stored remotely: nothing, unless you send text to your own AI endpoint.')));
  }

  function render() {
    tabsEl.replaceChildren(...TABS.map(([id, label]) => h('button', { type: 'button', role: 'tab', 'aria-selected': String(tab === id), class: tab === id ? 'tab on' : 'tab', onclick: () => { tab = id; notice = null; location.hash = id; render(); } }, label)));
    const view = !settings.onboarded ? onboarding : { assistant, review, saved, profile: profileView, settings: settingsView }[tab];
    main.replaceChildren(...(notice ? [h('div', { class: 'notice ' + notice.kind, role: notice.kind === 'err' ? 'alert' : 'status' }, notice.msg)] : []), view());
  }
  document.getElementById('home').onclick = () => { tab = 'assistant'; notice = null; render(); };
  window.addEventListener('hashchange', () => { const t = location.hash.slice(1); if (t !== tab && TABS.some((x) => x[0] === t)) { tab = t; notice = null; render(); } });
  // Dynamic forms: poll a cheap dirty flag (set by a read-only MutationObserver); never auto-rescans or edits the page.
  setInterval(async () => {
    const el = document.getElementById('changed');
    if (!scan || document.hidden) return;
    try { const r = await chrome.tabs.sendMessage(scan.tabId, { type: 'status' }); el.hidden = !(r && r.dirty); } catch (e) { el.hidden = true; }
  }, 3000);
  render();
})();
