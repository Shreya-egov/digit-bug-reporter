// Forwards events from page-hook.js (page world) to the service worker, which keeps the last few minutes per tab.
window.addEventListener('message', (e) => {
  if (e.source !== window || e.data?.__digitBug !== 1) return;
  chrome.runtime.sendMessage({ type: 'event', event: e.data.event }).catch(() => {});
});
