'use strict';
(async () => {
  const C = FormDrillCore, { h } = FD, $ = (i) => document.getElementById(i);
  const profile = C.normalizeProfile(await FD.get('profile', null));
  const settings = { ...FD.DEFAULT_SETTINGS, ...(await FD.get('settings', {})) };
  $('privacy').textContent = 'Local only · no AI';
  const tab = await FD.activeTab(); let scan = null;
  const say = (m, err) => { $('status').textContent = m; $('status').className = err ? 'err' : ''; };
  $('snapname').value = 'Draft ' + new Date().toLocaleDateString();

  async function load(keepStatus) {
    if (!tab || !tab.id) return say('No active tab found.', true);
    const r = await FD.send(tab.id, { type: 'scan' });
    if (!r.ok) return say(r.error, true);
    scan = r; const rec = r.fields.filter((f) => f.key).length;
    if (!keepStatus) say(r.fields.length ? 'Page scanned. Nothing has been changed.' : 'No fillable fields found on this page.');
    $('cat').textContent = C.CATEGORIES[r.category.category] + ' (suggested)'; $('count').textContent = `${rec} of ${r.fields.length} fields`;
    $('facts').hidden = false; $('fill').disabled = !r.fields.length; $('save').disabled = !r.fields.length;
    if ($('undo')) $('undo').disabled = !r.canUndo;
  }
  if ($('undo')) {
    $('undo').onclick = async () => {
      const u = await FD.send(tab.id, { type: 'undo' });
      say(u.ok ? (u.failed ? `Undone (${u.failed} could not be restored).` : 'Undone.') : (u.error || 'Nothing to undo.'), !u.ok);
      if ($('undo')) $('undo').disabled = !u.canUndo;
      $('review').hidden = true;
      if (u.ok) await load(true);
    };
  }
  $('fill').onclick = () => {
    const plan = C.planAutofill(scan.fields, profile);
    if (!plan.items.length) return say('Nothing to fill: no recognized field has a saved profile value. Add details in Profile.', true);
    const rows = plan.items.map((it) => {
      const f = scan.fields.find((x) => x.id === it.id);
      const cb = h('input', { type: 'checkbox', checked: it.level === 'high', 'data-id': it.id, id: 'c' + it.id });
      return h('label', { class: 'rev', for: 'c' + it.id }, cb, h('span', {}, h('strong', {}, f.label || f.name || it.key), h('small', {}, ` → ${String(it.value).slice(0, 40)} · ${it.level} confidence (${Math.round(it.confidence * 100)}%)`)));
    });
    const apply = h('button', { class: 'primary', type: 'button', onclick: async () => {
      const chosen = [...$('review').querySelectorAll('input:checked')].map((c) => c.dataset.id);
      const items = plan.items.filter((i) => chosen.includes(i.id)).map(({ id, value }) => ({ id, value }));
      if (!items.length) return say('Select at least one field to fill.', true);
      const r = await FD.send(tab.id, { type: 'apply', items });
      if (!r.ok) return say(r.error, true);
      const n = r.results.filter((x) => x.ok).length, bad = r.results.filter((x) => !x.ok).length;
      say(`Filled ${n} field${n === 1 ? '' : 's'}${bad ? `; ${bad} could not be filled and need manual entry` : ''}. Review the page before submitting; FormDrill never submits.`, bad > 0 && n === 0);
      if ($('undo')) $('undo').disabled = false;
      $('review').replaceChildren(h('button', { type: 'button', onclick: async () => {
        const u = await FD.send(tab.id, { type: 'undo' });
        say(u.ok ? (u.failed ? `Undone (${u.failed} could not be restored).` : 'Undone.') : (u.error || 'Nothing to undo.'), !u.ok);
        $('review').hidden = true;
        if ($('undo')) $('undo').disabled = !u.canUndo;
        if (u.ok) await load(true);
      } }, 'Undo this fill'));
    } }, 'Apply selected');
    $('review').replaceChildren(h('p', {}, 'Choose what to fill. Only high-confidence matches are pre-selected.'), ...rows, apply); $('review').hidden = false;
  };
  $('save').onclick = async () => {
    const name = $('snapname').value.trim(); if (!name) return say('Give the snapshot a name first.', true);
    const r = await FD.send(tab.id, { type: 'scan' }); if (!r.ok) return say(r.error, true);
    const snap = C.buildSnapshot(r.fields, { name, origin: r.page.url, step: $('stepname').value.trim() || r.page.step });
    if (!snap.items.length) return say('No filled-in fields to save yet.', true);
    const all = await FD.get('snapshots', []);
    try { await FD.set('snapshots', [snap, ...all].slice(0, 50)); say(`Saved "${name}" locally (${snap.items.length} values; passwords and payment fields are never stored).`); }
    catch (e) { say('Could not save the snapshot (storage error). Try deleting old snapshots in the workspace.', true); }
  };
  $('profile').onclick = () => chrome.tabs.create({ url: chrome.runtime.getURL('app.html#profile') });
  $('workspace').onclick = () => {
    chrome.sidePanel.open({ windowId: tab.windowId }).then(() => window.close()).catch(() => chrome.tabs.create({ url: chrome.runtime.getURL('app.html#assistant') }));
  };
  $('stepname').placeholder = 'Step label (optional), e.g. Step 2: Essays';
  load();
})();
