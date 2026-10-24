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
      h('ul', {}, h('li', {}, 'Your profile is stored only in this browser (chrome.storage.local). Nothing is uploaded.'), h('li', {}, 'Autofill and applying a drafted answer happen only after you review and click Apply.'), h('li', {}, 'FormDrill works entirely locally on your device with no remote servers or external network requests.')),
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
      factBox, apprSel, h('div', { class: 'row' }, outline), ta, h('div', { class: 'row between' }, counter, hint), flags,
      h('div', { class: 'row' }, h('label', {}, rv, ' I have reviewed this answer'), save2, applyBtn));
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
    const draft = JSON.parse(JSON.stringify(profile));
    // Ensure lists exist (backward compat with old saved profiles)
    draft.lists = draft.lists || {};
    for (const k of C.LIST_SECTIONS) if (!Array.isArray(draft.lists[k])) draft.lists[k] = [];

    const inputs = {}; // profile.fields inputs keyed by field key
    const sect = (title, ...kids) => h('details', { class: 'card psect', open: '' }, h('summary', {}, h('h2', { class: 'psect-title' }, title)), ...kids);
    const field = (key, label, type = 'text', extra = {}) => {
      const el = h('input', { type, 'aria-label': label, value: draft.fields[key] || '', maxlength: '500', ...extra });
      inputs[key] = el;
      return h('label', { class: 'f' }, h('span', {}, label), el);
    };
    const emptyState = (msg) => h('p', { class: 'mut psect-empty' }, msg);
    const uid = () => 'x' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
    let syncLanguages = () => {};

    // ---- 1. Personal Information ----
    function langSection() {
      const wrap = h('div', { class: 'lang-list' });
      const actions = h('div', { class: 'lang-actions' });
      const root = h('div', { class: 'lang-section' },
        h('p', { class: 'mut lang-help' }, 'Add 1–7 languages you are proficient in.'),
        wrap,
        actions
      );

      const syncFromDOM = () => {
        const currentInputs = wrap.querySelectorAll('input.lang-input');
        currentInputs.forEach((inp, idx) => {
          if (draft.lists.languages[idx]) {
            draft.lists.languages[idx].name = inp.value;
          }
        });
      };
      syncLanguages = syncFromDOM;

      const draw = () => {
        wrap.replaceChildren();
        if (!draft.lists.languages.length) {
          wrap.append(emptyState('No languages added yet.'));
        }
        draft.lists.languages.forEach((lang, i) => {
          const rowNum = i + 1;
          const inp = h('input', {
            type: 'text',
            class: 'lang-input',
            'aria-label': 'Language ' + rowNum,
            placeholder: 'e.g. English',
            value: lang.name || '',
            maxlength: '80',
            oninput: (e) => {
              draft.lists.languages[i].name = e.target.value;
            }
          });

          const trashSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
          trashSvg.setAttribute('viewBox', '0 0 16 16');
          trashSvg.setAttribute('width', '14');
          trashSvg.setAttribute('height', '14');
          trashSvg.setAttribute('aria-hidden', 'true');
          trashSvg.setAttribute('fill', 'currentColor');
          const trashPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
          trashPath.setAttribute('d', 'M5.5 5.5A.5.5 0 0 1 6 6v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5zm2.5 0a.5.5 0 0 1 .5.5v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5zm3 .5a.5.5 0 0 0-1 0v6a.5.5 0 0 0 1 0V6z M14.5 3a1 1 0 0 1-1 1H13v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V4h-.5a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1H6a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1h3.5a1 1 0 0 1 1 1v1zM4.118 4 4 4.059V13a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1V4.059L11.882 4H4.118zM2.5 3V2h11v1h-11z');
          trashSvg.append(trashPath);

          const delBtn = h('button', {
            type: 'button',
            class: 'danger lang-del-btn',
            'aria-label': 'Remove language ' + rowNum,
            title: 'Remove language ' + rowNum,
            onclick: () => {
              syncFromDOM();
              draft.lists.languages.splice(i, 1);
              draw();
            }
          }, trashSvg);

          wrap.append(h('div', { class: 'lang-row' }, inp, delBtn));
        });

        actions.replaceChildren();
        const count = draft.lists.languages.length;
        const atMax = count >= 7;
        const addBtn = h('button', {
          type: 'button',
          class: 'lang-add-btn',
          disabled: atMax,
          onclick: () => {
            if (draft.lists.languages.length >= 7) {
              return notify('A maximum of 7 languages is supported.', 'err');
            }
            syncFromDOM();
            draft.lists.languages.push({ id: uid(), name: '' });
            draw();
            const inputs = wrap.querySelectorAll('input.lang-input');
            if (inputs.length) inputs[inputs.length - 1].focus();
          }
        }, '+ Add Language');

        actions.append(addBtn);
        if (atMax) {
          actions.append(h('span', { class: 'mut lang-counter' }, '7 of 7 languages added'));
        }
      };

      draw();
      return root;
    }
    const personalFields = C.PROFILE_FIELDS.filter((p) => p.section === 'Personal');
    const personalSection = sect('Personal Information',
      h('div', { class: 'grid' }, personalFields.map((p) => field(p.key, p.label,
        p.key === 'dob' ? 'date' : 'text'))),
      h('div', { class: 'card-inner' }, h('h3', {}, 'Proficient Languages'), langSection()));

    // ---- 2. Education ----
    function eduFields(prefix, title) {
      const pf = (k, lbl) => { const key = prefix + '_' + k; return field(key, lbl); };
      const streamSel = h('label', { class: 'f' }, h('span', {}, 'Stream'),
        inputs[prefix + '_stream'] = h('select', { 'aria-label': 'Stream for ' + title, value: draft.fields[prefix + '_stream'] || '' },
          h('option', { value: '' }, '— Select —'),
          C.EDUCATION_STREAMS.map((s) => h('option', { value: s, selected: draft.fields[prefix + '_stream'] === s }, s))));
      return h('div', { class: 'card-inner' },
        h('h3', {}, title),
        h('div', { class: 'grid' },
          pf('school', 'School Name and Board'),
          streamSel,
          pf('year', 'Passing Year'),
          pf('result', 'Result (percentage or CGPA/GPA)')));
    }
    const higherEduFields = C.PROFILE_FIELDS.filter((p) => p.section === 'Education');
    const eduSection = sect('Education',
      h('div', { class: 'card-inner' },
        h('h3', {}, 'Higher Education / College'),
        h('div', { class: 'grid' }, higherEduFields.map((p) => field(p.key, p.label)))),
      eduFields('edu10', '10th Standard'),
      eduFields('edu12', '12th Standard'));

    // ---- 3. Certificates & Skills ----
    function certList() {
      const wrap = h('div', { class: 'plist' });
      const draw = () => {
        wrap.replaceChildren();
        if (!draft.lists.certificates.length) wrap.append(emptyState('No certificates added yet.'));
        draft.lists.certificates.forEach((cert, i) => {
          const nm = h('input', { type: 'text', 'aria-label': 'Certificate name', value: cert.name || '', maxlength: '200', oninput: (e) => { draft.lists.certificates[i].name = e.target.value; } });
          const org = h('input', { type: 'text', 'aria-label': 'Issuing organisation', value: cert.org || '', maxlength: '200', oninput: (e) => { draft.lists.certificates[i].org = e.target.value; } });
          const fileNote = h('small', { class: 'mut' }, cert.fileName ? `Document: ${cert.fileName}` : 'No document attached (optional).');
          const fileIn = h('input', { type: 'file', accept: 'image/*,.pdf', 'aria-label': 'Certificate document', style: 'display:none',
            onchange: (e) => {
              const f = e.target.files[0]; if (!f) return;
              if (f.size > 5e6) { notify('File is too large (max 5 MB).', 'err'); return; }
              const reader = new FileReader();
              reader.onload = (ev) => { draft.lists.certificates[i].fileName = f.name; draft.lists.certificates[i].fileData = ev.target.result; fileNote.textContent = `Document: ${f.name}`; };
              reader.readAsDataURL(f);
            } });
          const attachBtn = h('button', { type: 'button', onclick: () => fileIn.click() }, 'Attach document');
          wrap.append(h('div', { class: 'card-inner plist-entry' },
            h('div', { class: 'grid' }, h('label', { class: 'f' }, h('span', {}, 'Certificate Name'), nm), h('label', { class: 'f' }, h('span', {}, 'Issuing Organisation'), org)),
            h('div', { class: 'plist-row' }, attachBtn, fileIn, fileNote,
              h('button', { type: 'button', class: 'danger', 'aria-label': 'Remove certificate', onclick: () => { draft.lists.certificates.splice(i, 1); draw(); } }, 'Remove'))));
        });
      };
      draw();
      return h('div', {}, wrap, h('button', { type: 'button', onclick: () => { draft.lists.certificates.push({ id: uid(), name: '', org: '' }); draw(); } }, '+ Add Certificate'));
    }
    function skillList() {
      const wrap = h('div', { class: 'plist' });
      const draw = () => {
        wrap.replaceChildren();
        if (!draft.lists.skills.length) wrap.append(emptyState('No skills added yet.'));
        draft.lists.skills.forEach((sk, i) => {
          const nm = h('input', { type: 'text', 'aria-label': 'Skill name', value: sk.name || '', maxlength: '150', oninput: (e) => { draft.lists.skills[i].name = e.target.value; } });
          const cat = h('select', { 'aria-label': 'Skill category',
            onchange: (e) => { draft.lists.skills[i].category = e.target.value; } },
            C.SKILL_CATEGORIES.map((c) => h('option', { value: c, selected: sk.category === c }, c)));
          wrap.append(h('div', { class: 'plist-row' },
            h('label', { class: 'f plist-flex' }, h('span', {}, 'Skill name'), nm),
            h('label', { class: 'f plist-flex' }, h('span', {}, 'Category'), cat),
            h('button', { type: 'button', class: 'danger', 'aria-label': 'Remove skill', onclick: () => { draft.lists.skills.splice(i, 1); draw(); } }, '✕')));
        });
      };
      draw();
      return h('div', {}, wrap, h('button', { type: 'button', onclick: () => { draft.lists.skills.push({ id: uid(), name: '', category: C.SKILL_CATEGORIES[0] }); draw(); } }, '+ Add Skill'));
    }
    const certSkillSection = sect('Certificates and Skills',
      h('div', { class: 'card-inner' }, h('h3', {}, 'Certificates'), certList()),
      h('div', { class: 'card-inner' }, h('h3', {}, 'Skills'), skillList()));

    // ---- 4. Hobbies & Interests ----
    function hobbyList() {
      const wrap = h('div', { class: 'plist' });
      const draw = () => {
        wrap.replaceChildren();
        if (!draft.lists.hobbies.length) wrap.append(emptyState('No hobbies added yet.'));
        draft.lists.hobbies.forEach((hb, i) => {
          const nm = h('input', { type: 'text', 'aria-label': 'Hobby name', value: hb.name || '', maxlength: '150', oninput: (e) => { draft.lists.hobbies[i].name = e.target.value; } });
          const cat = h('select', { 'aria-label': 'Hobby category', onchange: (e) => { draft.lists.hobbies[i].category = e.target.value; } },
            C.HOBBY_CATEGORIES.map((c) => h('option', { value: c, selected: hb.category === c }, c)));
          const ach = h('input', { type: 'text', 'aria-label': 'Achievements related to this hobby (optional)', value: hb.achievements || '', maxlength: '500', oninput: (e) => { draft.lists.hobbies[i].achievements = e.target.value; } });
          wrap.append(h('div', { class: 'card-inner plist-entry' },
            h('div', { class: 'grid' },
              h('label', { class: 'f' }, h('span', {}, 'Hobby Name'), nm),
              h('label', { class: 'f' }, h('span', {}, 'Category'), cat),
              h('label', { class: 'f' }, h('span', {}, 'Achievements (optional)'), ach)),
            h('div', { class: 'plist-row' },
              h('button', { type: 'button', class: 'danger', 'aria-label': 'Remove hobby', onclick: () => { draft.lists.hobbies.splice(i, 1); draw(); } }, 'Remove'))));
        });
      };
      draw();
      return h('div', {}, wrap, h('button', { type: 'button', onclick: () => { draft.lists.hobbies.push({ id: uid(), name: '', category: C.HOBBY_CATEGORIES[0], achievements: '' }); draw(); } }, '+ Add Hobby'));
    }
    const hobbySection = sect('Hobbies and Interests', hobbyList());

    // ---- 5. Government & Competitive Exams ----
    function examList() {
      const wrap = h('div', { class: 'plist' });
      const draw = () => {
        wrap.replaceChildren();
        if (!draft.lists.exams.length) wrap.append(emptyState('No exams added yet. Examples: UPSC, JEE, NEET, GATE, SSC, banking exams, state PSC.'));
        draft.lists.exams.forEach((ex, i) => {
          const nm = h('input', { type: 'text', 'aria-label': 'Exam name', value: ex.name || '', maxlength: '200', oninput: (e) => { draft.lists.exams[i].name = e.target.value; } });
          const yr = h('input', { type: 'text', 'aria-label': 'Exam year', value: ex.year || '', maxlength: '10', oninput: (e) => { draft.lists.exams[i].year = e.target.value; } });
          const fileNote = h('small', { class: 'mut' }, ex.fileName ? `Document: ${ex.fileName}` : 'No scorecard attached (optional).');
          const fileIn = h('input', { type: 'file', accept: 'image/*,.pdf', 'aria-label': 'Scorecard or certificate', style: 'display:none',
            onchange: (e) => {
              const f = e.target.files[0]; if (!f) return;
              if (f.size > 5e6) { notify('File is too large (max 5 MB).', 'err'); return; }
              const reader = new FileReader();
              reader.onload = (ev) => { draft.lists.exams[i].fileName = f.name; draft.lists.exams[i].fileData = ev.target.result; fileNote.textContent = `Document: ${f.name}`; };
              reader.readAsDataURL(f);
            } });
          wrap.append(h('div', { class: 'card-inner plist-entry' },
            h('div', { class: 'grid' },
              h('label', { class: 'f' }, h('span', {}, 'Exam Name'), nm),
              h('label', { class: 'f' }, h('span', {}, 'Exam Year'), yr)),
            h('div', { class: 'plist-row' },
              h('button', { type: 'button', onclick: () => fileIn.click() }, 'Attach scorecard'), fileIn, fileNote,
              h('button', { type: 'button', class: 'danger', 'aria-label': 'Remove exam', onclick: () => { draft.lists.exams.splice(i, 1); draw(); } }, 'Remove'))));
        });
      };
      draw();
      return h('div', {}, wrap, h('button', { type: 'button', onclick: () => { draft.lists.exams.push({ id: uid(), name: '', year: '' }); draw(); } }, '+ Add Exam'));
    }
    const examSection = sect('Government and Competitive Exams', examList());

    // ---- 6. Work & Experience ----
    function workList() {
      const wrap = h('div', { class: 'plist' });
      const draw = () => {
        wrap.replaceChildren();
        if (!draft.lists.work.length) wrap.append(emptyState('No work experience added yet.'));
        draft.lists.work.forEach((wk, i) => {
          const val = (k) => wk[k] || '';
          const inp = (key, lbl, t = 'text') => h('label', { class: 'f' }, h('span', {}, lbl),
            h('input', { type: t, 'aria-label': lbl, value: val(key), maxlength: '300', oninput: (e) => { draft.lists.work[i][key] = e.target.value; } }));
          const roleArea = h('label', { class: 'f' }, h('span', {}, 'Role or Responsibilities'),
            h('textarea', { rows: '3', 'aria-label': 'Role or responsibilities', maxlength: '2000', oninput: (e) => { draft.lists.work[i].role = e.target.value; } }, val('role')));
          const fileNote = h('small', { class: 'mut' }, wk.fileName ? `Document: ${wk.fileName}` : 'No document attached (optional).');
          const fileIn = h('input', { type: 'file', accept: 'image/*,.pdf', 'aria-label': 'Supporting document', style: 'display:none',
            onchange: (e) => {
              const f = e.target.files[0]; if (!f) return;
              if (f.size > 5e6) { notify('File is too large (max 5 MB).', 'err'); return; }
              const reader = new FileReader();
              reader.onload = (ev) => { draft.lists.work[i].fileName = f.name; draft.lists.work[i].fileData = ev.target.result; fileNote.textContent = `Document: ${f.name}`; };
              reader.readAsDataURL(f);
            } });
          wrap.append(h('div', { class: 'card-inner plist-entry' },
            h('div', { class: 'grid' },
              inp('company', 'Company Name'),
              inp('title', 'Job Title'),
              inp('startDate', 'Start Date', 'month'),
              inp('endDate', 'End Date (leave blank if current)', 'month')),
            roleArea,
            h('div', { class: 'plist-row' },
              h('button', { type: 'button', onclick: () => fileIn.click() }, 'Attach document'), fileIn, fileNote,
              h('button', { type: 'button', class: 'danger', 'aria-label': 'Remove experience', onclick: () => { draft.lists.work.splice(i, 1); draw(); } }, 'Remove'))));
        });
      };
      draw();
      return h('div', {}, wrap, h('button', { type: 'button', onclick: () => { draft.lists.work.push({ id: uid(), company: '', title: '', startDate: '', endDate: '', role: '' }); draw(); } }, '+ Add Experience'));
    }
    const workSection = sect('Work and Experience', workList());

    // ---- 7. Links & Online Profiles ----
    function linksList() {
      const wrap = h('div', { class: 'plist' });
      const draw = () => {
        wrap.replaceChildren();
        if (!draft.lists.links.length) wrap.append(emptyState('No links added yet.'));
        draft.lists.links.forEach((lk, i) => {
          const labelSel = h('select', { 'aria-label': 'Link type', onchange: (e) => { draft.lists.links[i].label = e.target.value; } },
            C.LINK_LABELS.map((l) => h('option', { value: l, selected: lk.label === l }, l)));
          const url = h('input', { type: 'url', 'aria-label': 'URL', value: lk.url || '', maxlength: '500', placeholder: 'https://…', oninput: (e) => { draft.lists.links[i].url = e.target.value; } });
          wrap.append(h('div', { class: 'plist-row' },
            h('label', { class: 'f plist-flex' }, h('span', {}, 'Type'), labelSel),
            h('label', { class: 'f plist-flex' }, h('span', {}, 'URL'), url),
            h('button', { type: 'button', class: 'danger', 'aria-label': 'Remove link', onclick: () => { draft.lists.links.splice(i, 1); draw(); } }, '✕')));
        });
      };
      draw();
      return h('div', {}, wrap, h('button', { type: 'button', onclick: () => { draft.lists.links.push({ id: uid(), label: C.LINK_LABELS[0], url: '' }); draw(); } }, '+ Add Link'));
    }
    const linksFields = C.PROFILE_FIELDS.filter((p) => p.section === 'Links');
    const linksSection = sect('Links and Online Profiles',
      h('div', { class: 'grid' }, linksFields.map((p) => field(p.key, p.label, 'url', { placeholder: 'https://…' }))),
      h('div', { class: 'card-inner' }, h('h3', {}, 'Additional Links'), linksList()));

    // ---- 8. General Form Details ----
    function customFieldsList() {
      const wrap = h('div', { class: 'plist' });
      const draw = () => {
        wrap.replaceChildren();
        if (!draft.lists.customFields.length) wrap.append(emptyState('No custom fields yet. Add reusable answers for fields FormDrill does not recognise automatically.'));
        draft.lists.customFields.forEach((cf, i) => {
          const nm = h('input', { type: 'text', 'aria-label': 'Field name', value: cf.name || '', maxlength: '100', oninput: (e) => { draft.lists.customFields[i].name = e.target.value; } });
          const val = h('input', { type: 'text', 'aria-label': 'Field value', value: cf.value || '', maxlength: '500', oninput: (e) => { draft.lists.customFields[i].value = e.target.value; } });
          wrap.append(h('div', { class: 'plist-row' },
            h('label', { class: 'f plist-flex' }, h('span', {}, 'Field Name'), nm),
            h('label', { class: 'f plist-flex' }, h('span', {}, 'Value'), val),
            h('button', { type: 'button', class: 'danger', 'aria-label': 'Remove custom field', onclick: () => { draft.lists.customFields.splice(i, 1); draw(); } }, '✕')));
        });
      };
      draw();
      return h('div', {}, wrap, h('button', { type: 'button', onclick: () => { draft.lists.customFields.push({ id: uid(), name: '', value: '' }); draw(); } }, '+ Add Custom Field'));
    }
    const generalFields = C.PROFILE_FIELDS.filter((p) => p.section === 'General');
    const generalSection = sect('General Form Details',
      h('div', { class: 'grid' }, generalFields.map((p) => field(p.key, p.label))),
      h('label', { class: 'f card-inner' }, h('span', {}, 'Reusable short answers / notes'),
        inputs['shortAnswers'] = h('textarea', { rows: '3', 'aria-label': 'Reusable short answers', value: draft.fields.shortAnswers || '', maxlength: '2000' })),
      h('div', { class: 'card-inner' }, h('h3', {}, 'Custom Fields'), customFieldsList()));

    // ---- Facts section (unchanged) ----
    const factList = h('div', {}), nf = h('input', { type: 'text', 'aria-label': 'New fact', maxlength: '2000' });
    const nsec = h('select', { 'aria-label': 'Fact section' }, C.FACT_SECTIONS.map((s) => h('option', { value: s }, s)));
    const nst = h('select', { 'aria-label': 'Fact status' }, h('option', { value: 'verified' }, 'Verified (I can prove it)'), h('option', { value: 'unverified' }, 'Unverified (my own claim)'));
    const drawFacts = () => factList.replaceChildren(...(draft.facts.length ? draft.facts.map((x) => h('div', { class: 'fact' }, h('span', {}, `[${x.section}] ${x.text} `, badge(x.status)), h('button', { class: 'danger', type: 'button', 'aria-label': 'Remove fact', onclick: () => { draft.facts = draft.facts.filter((y) => y.id !== x.id); drawFacts(); } }, 'Remove'))) : [h('p', { class: 'mut' }, 'No facts yet. Add real experiences, projects and achievements. Drafts are built only from these.')]));
    drawFacts();
    const factsSection = sect('Facts, Achievements \u0026 Experiences',
      h('p', { class: 'mut' }, 'Used by the Assistant to build essay outlines. Add one clear fact per entry.'),
      factList,
      h('div', { class: 'grid' }, h('label', { class: 'f' }, h('span', {}, 'Fact'), nf), h('label', { class: 'f' }, h('span', {}, 'Section'), nsec), h('label', { class: 'f' }, h('span', {}, 'Status'), nst)),
      h('button', { type: 'button', onclick: () => { const t = nf.value.trim(); if (!t) return notify('Type a fact first.', 'err'); draft.facts.push({ id: 'f' + Date.now().toString(36), text: t, section: nsec.value, status: nst.value }); nf.value = ''; drawFacts(); } }, 'Add fact'));

    // ---- Save ----
    const saveBtn = h('button', { class: 'primary', type: 'button', onclick: async () => {
      // Collect simple field inputs
      for (const [k, el] of Object.entries(inputs)) {
        const v = typeof el.value === 'string' ? el.value.trim() : '';
        if (v) draft.fields[k] = v; else delete draft.fields[k];
      }
      syncLanguages();
      if (draft.lists && Array.isArray(draft.lists.languages)) {
        draft.lists.languages.forEach((l) => {
          if (l && typeof l.name === 'string') l.name = l.name.trim();
        });
      }
      const v = C.validateProfile(draft);
      if (!v.ok) return notify('Not saved: ' + v.errors.join(' '), 'err');
      profile = draft;
      if (await save('profile', profile)) notify('Profile saved on this device.');
    } }, 'Save profile');

    return h('section', {},
      h('h1', {}, 'Your profile'),
      h('p', { class: 'mut' }, 'Stored locally in this browser. FormDrill never saves form answers here unless you add them yourself. All sections are optional.'),
      personalSection, eduSection, certSkillSection, hobbySection, examSection, workSection, linksSection, generalSection, factsSection,
      saveBtn);
  }

  /* ---------- settings ---------- */
  function settingsView() {
    const file = h('input', { type: 'file', accept: 'application/json', 'aria-label': 'Import profile file' });
    return h('section', {}, h('h1', {}, 'Settings & privacy'),
      h('div', { class: 'card' }, h('h3', {}, 'Your data'),
        h('div', { class: 'row' }, h('button', { type: 'button', onclick: async () => { if (!confirm('Export your profile as a file? It contains personal information; keep it safe.')) return; FD.download('formdrill-profile.json', JSON.stringify(profile, null, 2)); notify('Profile exported to your downloads.'); } }, 'Export profile'), file,
          h('button', { type: 'button', onclick: async () => { const f = file.files[0]; if (!f) return notify('Choose a JSON file first.', 'err'); if (f.size > 1e6) return notify('File is too large to be a FormDrill profile.', 'err'); try { const p = JSON.parse(await f.text()), v = C.validateProfile(p); if (!v.ok) return notify('Import rejected: ' + v.errors.join(' '), 'err'); if (!confirm(`Replace your profile with ${Object.keys(p.fields).length} fields and ${p.facts.length} facts from this file?`)) return; profile = C.normalizeProfile(p); if (await save('profile', profile)) notify('Profile imported.'); } catch (e) { notify('Import failed: that file is not valid JSON.', 'err'); } } }, 'Import profile')),
        h('p', {}, h('button', { class: 'danger', type: 'button', onclick: async () => { if (!confirm('Delete your profile, snapshots, drafts and settings? This cannot be undone.')) return; await chrome.storage.local.clear(); profile = C.emptyProfile(); settings = { ...FD.DEFAULT_SETTINGS, onboarded: true }; await save('settings', settings); notify('All FormDrill data was deleted.'); } }, 'Delete all data'))),
      h('div', { class: 'card' }, h('h3', {}, 'Permissions explained'), h('ul', {},
        h('li', {}, h('strong', {}, 'activeTab + scripting: '), 'lets FormDrill read and fill the page you are viewing, only after you click its icon. No all-sites access.'),
        h('li', {}, h('strong', {}, 'storage: '), 'keeps your profile, snapshots and drafts on this device.'),
        h('li', {}, h('strong', {}, 'sidePanel: '), 'shows this workspace beside the page.')),
        h('p', {}, 'Stored locally: profile, snapshots (never passwords, tokens or payment fields), drafts, settings. Nothing is ever uploaded or shared remotely.')));
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
