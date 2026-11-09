// Forwards events from page-hook.js (page world) to the service worker, which keeps the last few minutes per tab.
// Wrapped in a function so it can be injected again into an open tab (see ensureCapture) without clashing.
(() => {
  // Must match VERSION in page-hook.js: events from an older copy still running in the page are ignored.
  const HOOK_VERSION = 2;

  function relay(e) {
    if (e.source !== window || e.data?.__digitBug !== HOOK_VERSION) return;
    // After the extension is reloaded or updated, this copy in an already-open tab is cut off and sendMessage
    // throws "Extension context invalidated" synchronously. Stop listening; reloading the tab starts a fresh copy.
    if (!chrome.runtime?.id) {
      window.removeEventListener('message', relay);
      return;
    }
    try {
      chrome.runtime.sendMessage({ type: 'event', event: e.data.event }).catch(() => {});
    } catch {
      window.removeEventListener('message', relay);
    }
  }

  window.addEventListener('message', relay);

  // Lets the service worker check that this copy is still connected (see ensureCapture in background.js).
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg?.type === 'relay-ping') sendResponse(true);
  });
})();
