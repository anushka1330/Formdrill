'use strict';
window.FD = (() => {
  const S = {};
  S.DEFAULT_SETTINGS = { onboarded: false, aiEnabled: false, aiEndpoint: '' };
  S.get = async (k, d) => { const r = await chrome.storage.local.get(k); return r[k] === undefined ? d : r[k]; };
  S.set = (k, v) => chrome.storage.local.set({ [k]: v });
  S.activeTab = async () => {
    let [t] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!t || !t.id) [t] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    return t;
  };
  S.send = async (tabId, msg) => {
    try { return await chrome.tabs.sendMessage(tabId, msg); } catch (e) {
      try { await chrome.scripting.executeScript({ target: { tabId }, files: ['core.js', 'content.js'] }); return await chrome.tabs.sendMessage(tabId, msg); }
      catch (e2) { return { ok: false, error: 'FormDrill cannot access this page. Click the FormDrill toolbar icon while the page is open (Chrome grants access only after that click). Browser pages such as chrome:// and the Web Store are always off-limits.' }; }
    }
  };
  // Safe DOM builder: text is always added as text nodes, never as HTML.
  S.h = (tag, attrs, ...kids) => {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v; else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else if (['value', 'checked', 'disabled', 'hidden'].includes(k)) el[k] = v; else el.setAttribute(k, v === true ? '' : v);
    }
    for (const kid of kids.flat()) if (kid != null && kid !== false) el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
    return el;
  };
  S.download = (name, text) => { const a = S.h('a', { href: URL.createObjectURL(new Blob([text], { type: 'application/json' })), download: name }); document.body.append(a); a.click(); a.remove(); };
  return S;
})();
