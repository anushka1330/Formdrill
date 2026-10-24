'use strict';
/* FormDrill content script. Injected on demand (activeTab). Reads fields, writes values ONLY when the extension UI sends an approved apply/restore message. Never submits, never clicks submit buttons. */
(() => {
  if (window.__formDrillLoaded) return;
  window.__formDrillLoaded = true;
  const C = window.FormDrillCore;
  const els = new Map(), ids = new WeakMap();
  let seq = 0, lastFields = [], undoStack = [], dirty = false;
  const EXCLUDE = new Set(['password', 'file', 'submit', 'button', 'reset', 'image', 'hidden', 'search']);
  const txt = (n) => ((n && n.textContent) || '').replace(/\s+/g, ' ').trim();
  const visible = (el) => {
    try {
      const r = el.getBoundingClientRect(), s = getComputedStyle(el);
      return s.visibility !== 'hidden' && s.display !== 'none' && (r.width > 0 || r.height > 0);
    } catch (e) { return true; }
  };
  const byIds = (el, attr) => {
    const doc = el.ownerDocument || document;
    return (el.getAttribute(attr) || '').split(/\s+/).filter(Boolean).map((i) => txt(doc.getElementById(i))).join(' ');
  };
  const labelOf = (el) => {
    const p = [];
    if (el.labels) for (const l of el.labels) p.push(txt(l));
    p.push(byIds(el, 'aria-labelledby'));
    if (el.getAttribute('aria-label')) p.push(el.getAttribute('aria-label'));
    return p.join(' ').trim().slice(0, 300);
  };
  const nearbyOf = (el) => {
    const p = [byIds(el, 'aria-describedby')];
    const fs = el.closest('fieldset'); if (fs && fs.querySelector('legend')) p.push(txt(fs.querySelector('legend')));
    const prev = el.previousElementSibling || (el.parentElement && el.parentElement.previousElementSibling);
    if (prev && !/^(INPUT|TEXTAREA|SELECT|FORM)$/.test(prev.tagName)) p.push(txt(prev));
    return p.join(' ').slice(0, 300);
  };
  const idFor = (el) => { if (!ids.has(el)) ids.set(el, 'fd' + (++seq)); return ids.get(el); };

  function getAccessibleDocuments() {
    const docs = [document];
    const seen = new Set(docs);
    for (let i = 0; i < docs.length; i++) {
      const d = docs[i];
      try {
        const frames = d.querySelectorAll('iframe, frame');
        for (const frame of frames) {
          try {
            const cd = frame.contentDocument || (frame.contentWindow && frame.contentWindow.document);
            if (cd && !seen.has(cd)) {
              seen.add(cd);
              docs.push(cd);
            }
          } catch (e) {
            // Cross-origin restriction: handle gracefully without throwing
          }
        }
      } catch (e) {
        // Ignored
      }
    }
    return docs;
  }

  function extractCustomDropdownOptions(el) {
    const doc = el.ownerDocument || document;
    const optEls = [];
    for (const o of el.querySelectorAll('[role="option"]')) optEls.push(o);
    const ctrlId = el.getAttribute('aria-controls') || el.getAttribute('aria-owns');
    if (ctrlId) {
      const ctrl = doc.getElementById(ctrlId);
      if (ctrl) {
        for (const o of ctrl.querySelectorAll('[role="option"]')) {
          if (!optEls.includes(o)) optEls.push(o);
        }
      }
    }
    if (!optEls.length && el.parentElement) {
      const popup = el.parentElement.querySelector('[role="listbox"]');
      if (popup) {
        for (const o of popup.querySelectorAll('[role="option"]')) {
          if (!optEls.includes(o)) optEls.push(o);
        }
      }
    }
    return optEls.map((o) => {
      const v = o.getAttribute('data-value') || o.getAttribute('value') || o.getAttribute('data-key') || txt(o);
      const l = txt(o) || o.getAttribute('aria-label') || v;
      return { value: v, label: l, el: o };
    }).filter((o) => o.value !== '');
  }

  function readCustomDropdown(el, customOptions) {
    const doc = el.ownerDocument || document;
    const selectedOpt = customOptions && customOptions.find((o) => o.el && o.el.getAttribute('aria-selected') === 'true');
    if (selectedOpt) return selectedOpt.value;
    const activeId = el.getAttribute('aria-activedescendant');
    if (activeId) {
      const activeEl = doc.getElementById(activeId);
      if (activeEl) return activeEl.getAttribute('data-value') || activeEl.getAttribute('value') || txt(activeEl);
    }
    const val = el.getAttribute('aria-valuetext') || el.getAttribute('aria-valuenow');
    if (val) return val;
    const text = txt(el);
    if (customOptions && customOptions.length) {
      const match = C.matchOption(customOptions, text);
      if (match) return match.value;
      return '';
    }
    return text;
  }

  const read = (t) => {
    if (!t) return '';
    if (t.isCustomDropdown) return readCustomDropdown(t.el, t.options);
    if (Array.isArray(t)) return ((t.find((r) => r.checked) || {}).value || '');
    if (t.type === 'checkbox') return t.checked;
    if (t.isRichText || t.isContentEditable || (t.getAttribute && t.getAttribute('contenteditable') !== null && t.getAttribute('contenteditable') !== 'false')) {
      return (t.innerText || t.textContent || '').trim();
    }
    return t.value;
  };

  function setCustomDropdownValue(targetWrapper, value) {
    const { el, options } = targetWrapper;
    if (value === '') {
      try {
        options.forEach((other) => {
          if (other.el && other.el.setAttribute) other.el.setAttribute('aria-selected', 'false');
        });
        if (el.removeAttribute) el.removeAttribute('aria-activedescendant');
        if (el.setAttribute) {
          el.setAttribute('aria-expanded', 'false');
          if (el.hasAttribute('aria-valuetext')) el.setAttribute('aria-valuetext', '');
        }
        const ph = el.getAttribute('placeholder') || el.getAttribute('data-placeholder') || 'Select...';
        if (el.textContent && !el.querySelector('*')) el.textContent = ph;
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
      } catch (e) { return false; }
    }
    const o = C.matchOption(options, String(value));
    if (!o) return false;
    const match = options.find((x) => x.value === o.value);
    if (!match) return false;
    if (match.el && typeof match.el.click === 'function') {
      try {
        match.el.click();
        if (match.el.setAttribute) match.el.setAttribute('aria-selected', 'true');
        options.forEach((other) => {
          if (other !== match && other.el && other.el.setAttribute) other.el.setAttribute('aria-selected', 'false');
        });
        if (el.setAttribute) {
          el.setAttribute('aria-expanded', 'false');
          if (match.el.id) el.setAttribute('aria-activedescendant', match.el.id);
        }
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
      } catch (e) { return false; }
    }
    return false;
  }

  function setValue(target, value) {
    try {
      if (target && target.isCustomDropdown) return setCustomDropdownValue(target, value);
      if (Array.isArray(target) && value === '') {
        target.forEach((r) => { r.checked = false; });
        if (target[0]) target[0].dispatchEvent(new Event('change', { bubbles: true }));
        return true;
      }
      if (target.tagName === 'SELECT' && (value === '' || value == null)) {
        target.value = '';
        if (target.options && target.options.length && target.options[0].value === '') {
          target.selectedIndex = 0;
        }
        target.dispatchEvent(new Event('input', { bubbles: true }));
        target.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
      }
      if (Array.isArray(target)) {
        const o = C.matchOption(target.map((r) => ({ value: r.value, label: labelOf(r) || r.value })), String(value));
        const r = o && target.find((x) => x.value === o.value);
        if (!r) return false;
        if (!r.checked) {
          r.checked = true;
          try { r.click(); } catch (e) {}
          r.dispatchEvent(new Event('change', { bubbles: true }));
        }
        return true;
      }
      if (target.type === 'checkbox') {
        const want = value === true || /^(true|yes|on|1)$/i.test(String(value));
        if (target.checked !== want) {
          target.checked = want;
          target.dispatchEvent(new Event('input', { bubbles: true }));
          target.dispatchEvent(new Event('change', { bubbles: true }));
        }
        return true;
      }
      if (target.tagName === 'SELECT') {
        const o = C.matchOption([...target.options].map((x) => ({ value: x.value, label: txt(x) })), String(value));
        if (!o) return false;
        target.value = o.value;
      } else if (target.isRichText || target.isContentEditable || (target.getAttribute && target.getAttribute('contenteditable') !== null && target.getAttribute('contenteditable') !== 'false')) {
        target.innerText = String(value);
      } else {
        const str = String(value);
        try {
          const proto = target.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
          const desc = Object.getOwnPropertyDescriptor(proto, 'value');
          if (desc && desc.set) desc.set.call(target, str);
        } catch (e) {}
        target.value = str;
      }
      target.dispatchEvent(new Event('input', { bubbles: true }));
      target.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    } catch (e) { return false; }
  }

  function scan() {
    els.clear(); const seen = new Set(), out = [];
    const docs = getAccessibleDocuments();
    for (const doc of docs) {
      // 1. Inputs, textareas, selects
      for (const el of doc.querySelectorAll('input,textarea,select')) {
        const type = (el.type || el.tagName).toLowerCase();
        if (el.disabled || EXCLUDE.has(type) || !visible(el)) continue;
        if (C.isSensitive({ type, name: el.name, id: el.id, autocomplete: el.getAttribute('autocomplete') })) continue;
        let target = el, label = labelOf(el), options = null;
        if (type === 'radio' && el.name) {
          const formIdx = el.form ? [...doc.forms].indexOf(el.form) : -1;
          const k = formIdx + ':' + el.name;
          if (seen.has(k)) continue; seen.add(k);
          target = [...doc.querySelectorAll('input[type=radio]')].filter((r) => r.name === el.name && r.form === el.form && !r.disabled);
          const fs = el.closest('fieldset,[role=radiogroup]');
          label = fs ? txt(fs.querySelector('legend')) || fs.getAttribute('aria-label') || '' : '';
          options = target.map((r) => ({ value: r.value, label: labelOf(r) || r.value }));
        } else if (el.tagName === 'SELECT') options = [...el.options].filter((o) => o.value !== '').map((o) => ({ value: o.value, label: txt(o) }));
        const id = idFor(el); els.set(id, target);
        const f = { id, tag: el.tagName.toLowerCase(), type: type === 'select-one' ? 'select' : type === 'select-multiple' ? 'select' : type, label, aria: el.getAttribute('aria-label') || '', name: el.name || '', idAttr: el.id || '', placeholder: el.getAttribute('placeholder') || '', autocomplete: el.getAttribute('autocomplete') || '', nearby: nearbyOf(el), required: el.required || el.getAttribute('aria-required') === 'true', maxlength: el.maxLength > 0 ? el.maxLength : 0, value: read(target), options };
        f.id = id; f.wordLimit = C.extractWordLimit([label, f.nearby, f.placeholder].join(' '));
        f.classification = C.classifyField({ ...f, id: f.idAttr });
        f.key = f.classification.key; f.fieldKey = C.fieldKey(f);
        out.push(f);
      }

      // 2. Rich-text editors
      for (const el of doc.querySelectorAll('[contenteditable]:not([contenteditable="false"]), [role="textbox"][contenteditable]:not([contenteditable="false"])')) {
        if (el.parentElement && el.parentElement.closest('[contenteditable]:not([contenteditable="false"])')) continue;
        if (el.getAttribute('aria-disabled') === 'true' || !visible(el)) continue;
        if (C.isSensitive({ type: 'text', name: el.getAttribute('name'), id: el.id, autocomplete: el.getAttribute('autocomplete') })) continue;
        const id = idFor(el);
        el.isRichText = true;
        els.set(id, el);
        const label = labelOf(el) || el.getAttribute('aria-label') || '';
        const nearby = nearbyOf(el);
        const ph = el.getAttribute('placeholder') || el.getAttribute('data-placeholder') || '';
        const f = {
          id, tag: el.tagName.toLowerCase(), type: 'richtext',
          isRichText: true,
          label, aria: el.getAttribute('aria-label') || '',
          name: el.getAttribute('name') || '', idAttr: el.id || '',
          placeholder: ph, autocomplete: '',
          nearby, required: el.getAttribute('aria-required') === 'true',
          maxlength: 0, value: (el.innerText || el.textContent || '').trim(),
          options: null
        };
        f.wordLimit = C.extractWordLimit([label, nearby, ph].join(' '));
        f.classification = C.classifyField({ ...f, id: f.idAttr });
        f.key = f.classification.key; f.fieldKey = C.fieldKey(f);
        out.push(f);
      }

      // 3. Accessible Custom Dropdowns
      for (const el of doc.querySelectorAll('[role="combobox"], [role="listbox"]:not(select), [aria-haspopup="listbox"]')) {
        if (['SELECT', 'INPUT', 'TEXTAREA'].includes(el.tagName)) continue;
        if (el.getAttribute('aria-disabled') === 'true' || !visible(el)) continue;
        if (C.isSensitive({ type: 'select', name: el.getAttribute('name'), id: el.id })) continue;
        const customOptions = extractCustomDropdownOptions(el);
        if (!customOptions.length) continue;
        const id = idFor(el);
        const targetWrapper = { isCustomDropdown: true, el, options: customOptions };
        els.set(id, targetWrapper);
        const label = labelOf(el) || el.getAttribute('aria-label') || '';
        const f = {
          id, tag: el.tagName.toLowerCase(), type: 'select',
          isCustomDropdown: true,
          label, aria: el.getAttribute('aria-label') || '',
          name: el.getAttribute('name') || '', idAttr: el.id || '',
          placeholder: el.getAttribute('placeholder') || '',
          autocomplete: '', nearby: nearbyOf(el),
          required: el.getAttribute('aria-required') === 'true',
          maxlength: 0,
          value: readCustomDropdown(el, customOptions),
          options: customOptions.map((o) => ({ value: o.value, label: o.label }))
        };
        f.classification = C.classifyField({ ...f, id: f.idAttr });
        f.key = f.classification.key; f.fieldKey = C.fieldKey(f);
        out.push(f);
      }
    }

    lastFields = out; dirty = false;
    const heads = [...document.querySelectorAll('h1,h2,legend')].slice(0, 20).map(txt).join(' ');
    const step = txt(document.querySelector('[aria-current="step"]')) || '';
    const category = C.detectCategory([document.title, heads, out.map((f) => f.label + ' ' + f.nearby).join(' ')].join(' '));
    return { ok: true, page: { title: document.title, url: location.origin + location.pathname, step }, fields: out, category, structureChanged: false };
  }

  const validItem = (i) => i && typeof i.id === 'string' && (typeof i.value === 'string' || typeof i.value === 'boolean');

  let toastEl = null, toastTimer = null;

  function showUndoToast(count) {
    try {
      if (toastEl && toastEl.parentElement) toastEl.remove();
      if (toastTimer) clearTimeout(toastTimer);
      const div = document.createElement('div');
      div.id = 'formdrill-toast';
      div.setAttribute('style', 'position:fixed;bottom:24px;right:24px;z-index:2147483647;background:#2B2824;color:#F0EAE1;border:1px solid #403A33;padding:10px 16px;border-radius:10px;font:14px/1.4 system-ui,-apple-system,sans-serif;box-shadow:0 8px 24px rgba(0,0,0,0.4);display:flex;align-items:center;gap:12px;cursor:default;');

      const text = document.createElement('span');
      text.textContent = `FormDrill: Filled ${count} field${count === 1 ? '' : 's'}.`;

      const undoBtn = document.createElement('button');
      undoBtn.type = 'button';
      undoBtn.id = 'formdrill-toast-undo';
      undoBtn.textContent = 'Undo';
      undoBtn.setAttribute('style', 'background:#D2B48C;color:#1D1B19;border:none;padding:5px 12px;border-radius:6px;font-weight:600;font-size:13px;cursor:pointer;');
      undoBtn.onclick = () => {
        const u = undoLast();
        if (u.ok) {
          text.textContent = 'FormDrill: Autofill undone.';
          undoBtn.remove();
          setTimeout(() => { if (div.parentElement) div.remove(); }, 2000);
        }
      };

      const closeBtn = document.createElement('button');
      closeBtn.type = 'button';
      closeBtn.textContent = 'x';
      closeBtn.setAttribute('aria-label', 'Dismiss');
      closeBtn.setAttribute('style', 'background:none;border:none;color:#B8AEA1;cursor:pointer;font-size:14px;padding:0 4px;');
      closeBtn.onclick = () => div.remove();

      div.append(text, undoBtn, closeBtn);
      (document.body || document.documentElement).append(div);
      toastEl = div;
      toastTimer = setTimeout(() => { if (div.parentElement) div.remove(); }, 12000);
    } catch (e) {}
  }

  function dismissUndoToast() {
    if (toastEl && toastEl.parentElement) toastEl.remove();
    if (toastTimer) clearTimeout(toastTimer);
  }

  function undoLast() {
    const batch = undoStack.pop();
    if (!batch) return { ok: false, error: 'Nothing to undo.' };
    let restoredCount = 0, failCount = 0;
    batch.forEach((b) => {
      const t = b.target || els.get(b.id);
      if (t && setValue(t, b.prev)) restoredCount++;
      else failCount++;
    });
    dismissUndoToast();
    return { ok: true, count: restoredCount, failed: failCount, canUndo: undoStack.length > 0 };
  }

  function applyItems(items) {
    const results = [], batch = [];
    for (const it of items) {
      const t = els.get(it.id);
      if (!t) { results.push({ id: it.id, ok: false, reason: 'Field is no longer on the page. Scan again.' }); continue; }
      const prev = read(t), ok = setValue(t, it.value);
      if (ok && prev !== it.value) batch.push({ id: it.id, target: t, prev });
      results.push({ id: it.id, ok, reason: ok ? '' : 'This control could not be filled. Enter it manually.' });
    }
    if (batch.length) {
      undoStack.push(batch);
      showUndoToast(batch.length);
    }
    return { ok: true, results };
  }

  chrome.runtime.onMessage.addListener((msg, sender, send) => {
    if (sender.id !== chrome.runtime.id || !msg || typeof msg.type !== 'string') return;
    try {
      if (msg.type === 'scan') send({ ...scan(), dirty, canUndo: undoStack.length > 0 });
      else if (msg.type === 'status') send({ ok: true, dirty, canUndo: undoStack.length > 0 });
      else if (msg.type === 'apply' && Array.isArray(msg.items) && msg.items.length && msg.items.every(validItem)) {
        const r = applyItems(msg.items); send({ ...r, canUndo: undoStack.length > 0 });
      }
      else if (msg.type === 'restore' && Array.isArray(msg.items) && msg.items.every((i) => i && typeof i.fieldKey === 'string' && (typeof i.value === 'string' || typeof i.value === 'boolean'))) {
        const r = applyItems(msg.items.map((i) => { const f = lastFields.find((x) => x.fieldKey === i.fieldKey); return f ? { id: f.id, value: i.value } : null; }).filter(Boolean));
        send({ ...r, canUndo: undoStack.length > 0 });
      } else if (msg.type === 'undo') {
        send(undoLast());
      } else send({ ok: false, error: 'Unsupported or malformed request.' });
    } catch (e) { send({ ok: false, error: 'Unexpected error while reading the page.' }); }
  });

  // Observe page and any accessible iframes for DOM changes
  try {
    const observer = new MutationObserver(() => { dirty = true; });
    getAccessibleDocuments().forEach((d) => {
      if (d && (d.documentElement || d.body)) observer.observe(d.documentElement || d.body, { childList: true, subtree: true });
    });
  } catch (e) {}
})();
