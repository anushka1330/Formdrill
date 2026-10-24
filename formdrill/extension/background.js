'use strict';
// Minimal service worker: first-run onboarding only. No network, no page access, no tracking.
chrome.runtime.onInstalled.addListener((d) => {
  if (d.reason === 'install') chrome.tabs.create({ url: chrome.runtime.getURL('app.html#assistant') });
});
