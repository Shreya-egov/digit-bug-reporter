// Runs in the DIGIT page's own JS world from document_start. Records failing API calls (with the request,
// so the review page can show a curl command, and the response), console errors and the user's clicks and
// navigation, and hands them to relay.js. Secrets are stripped here, before anything leaves the page; what is
// typed into text fields is never recorded.
(() => {
  // Bump with HOOK_VERSION in relay.js whenever what this records changes. A tab that was open when the
  // extension updated still runs the old copy; the new one installs on top and relay.js ignores the old one's events.
  const VERSION = 2;
  if (window.__digitBugHook >= VERSION) return;
  window.__digitBugHook = VERSION;

  const post = (event) => {
    try {
      window.postMessage({ __digitBug: VERSION, event: { ts: Date.now(), ...event } }, location.origin);
    } catch { /* page navigating away */ }
  };
  const short = (s, n = 300) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, n);

  const pathOf = (url) => {
    try {
      const u = new URL(url, location.href);
      return (u.origin === location.origin ? '' : u.host) + u.pathname + u.search;
    } catch { return short(url, 200); }
  };

  const fullUrl = (url) => {
    try { return new URL(url, location.href).href; } catch { return String(url); }
  };

  // ---- secrets: the auth token rides in DIGIT request bodies (RequestInfo), the login form carries the
  // password. Strip them now; names, phone numbers etc. are masked later, on the review page.
  const MAX_BODY = 5000;
  const MAX_RESPONSE = 2000;
  const SECRET_KEY = /^(auth-?token|access_?token|refresh_?token|id_?token|password|pwd|otp|pin|client_?secret|userInfo)$/i;

  const scrubValue = (v) => {
    if (Array.isArray(v)) return v.map(scrubValue);
    if (v && typeof v === 'object') {
      return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, SECRET_KEY.test(k) ? '<redacted>' : scrubValue(x)]));
    }
    return v;
  };

  const scrubText = (text, max) => {
    try { return JSON.stringify(scrubValue(JSON.parse(text))).slice(0, max); } catch { /* not JSON */ }
    if (/^[\w.%-]+=[^&]*(&[\w.%-]+=[^&]*)*$/.test(text.trim())) {
      const form = new URLSearchParams(text);
      for (const k of [...form.keys()]) if (SECRET_KEY.test(k)) form.set(k, '<redacted>');
      return form.toString().replace(/%3Credacted%3E/g, '<redacted>').slice(0, max);
    }
    return text.slice(0, max);
  };

  const scrubBody = (body) => {
    if (body == null) return '';
    if (typeof body === 'string') return scrubText(body, MAX_BODY);
    if (body instanceof URLSearchParams) return scrubText(body.toString(), MAX_BODY);
    if (body instanceof FormData) return '<multipart form data, not recorded>';
    return '<binary body, not recorded>';
  };

  const headersOf = (h) => {
    if (!h) return {};
    if (h instanceof Headers) return Object.fromEntries(h.entries());
    if (Array.isArray(h)) return Object.fromEntries(h);
    return { ...h };
  };

  // Cookies are dropped; credentials keep only their scheme ("Basic <redacted>").
  const scrubHeaders = (h) => Object.fromEntries(Object.entries(h)
    .filter(([k]) => !/^cookie$/i.test(k))
    .map(([k, v]) => [k, /^(authorization|proxy-authorization|auth-?token|x-[\w-]*token)$/i.test(k)
      ? String(v).replace(/^(\w+)\s+.*$/, '$1 <redacted>').replace(/^[^ ]*$/, '<redacted>') : String(v)]));

  // DIGIT services answer with { Errors: [{ code, message }] }; keep just that.
  const errorSummary = (text) => {
    try {
      const j = JSON.parse(text);
      const errs = j.Errors || j.errors;
      if (Array.isArray(errs) && errs.length) {
        return short(errs.slice(0, 3).map((e) => [e.code, e.message].filter(Boolean).join(': ')).join(' | '), 400);
      }
      if (j.message || j.error) return short(j.message || j.error);
    } catch { /* not JSON */ }
    // gateway error pages (504 Gateway Time-out, 502 Bad Gateway) are HTML; their title says it all
    const title = /<title>([^<]*)<\/title>|<h1>([^<]*)<\/h1>/i.exec(text);
    if (title) return short(title[1] || title[2]);
    return short(text, 200);
  };

  const fmt = (a) => {
    if (a instanceof Error) return `${a.name}: ${a.message}`;
    if (a && typeof a === 'object') { try { return JSON.stringify(a); } catch { return String(a); } }
    return String(a);
  };

  // console errors and uncaught exceptions
  const origError = console.error;
  console.error = function (...args) {
    post({ kind: 'console', text: short(args.map(fmt).join(' '), 500) });
    return origError.apply(this, args);
  };
  window.addEventListener('error', (e) => {
    if (e.message) post({ kind: 'console', text: short(`Uncaught ${e.message} (${pathOf(e.filename || '')}:${e.lineno})`, 500) });
  });
  window.addEventListener('unhandledrejection', (e) => {
    post({ kind: 'console', text: short(`Unhandled rejection: ${fmt(e.reason)}`, 500) });
  });

  // fetch
  const origFetch = window.fetch;
  window.fetch = async function (input, init) {
    let request = null;
    let reqBody = Promise.resolve('');
    try {
      const method = String(init?.method || input?.method || 'GET').toUpperCase();
      const raw = typeof input === 'string' ? input : input?.url ?? String(input);
      request = {
        method,
        url: pathOf(raw),
        fullUrl: fullUrl(raw),
        reqHeaders: scrubHeaders({ ...headersOf(input?.headers), ...headersOf(init?.headers) }),
      };
      // a Request object's body can only be read asynchronously, and before fetch consumes it
      reqBody = init?.body === undefined && input instanceof Request && !['GET', 'HEAD'].includes(method)
        ? input.clone().text().then(scrubBody).catch(() => '')
        : Promise.resolve(scrubBody(init?.body));
    } catch { /* not recorded; the request itself goes ahead */ }
    if (!request) return origFetch.apply(this, arguments);
    try {
      const res = await origFetch.apply(this, arguments);
      if (res.status >= 400) {
        Promise.all([reqBody, res.clone().text().catch(() => '')]).then(([body, text]) => post({
          kind: 'network', ...request, reqBody: body, status: res.status,
          error: errorSummary(text), response: scrubText(text, MAX_RESPONSE),
        }));
      }
      return res;
    } catch (err) {
      reqBody.then((body) => post({ kind: 'network', ...request, reqBody: body, status: 0, error: short(err?.message) }));
      throw err;
    }
  };

  // XMLHttpRequest (axios, which the DIGIT UI uses). Recording never gets in the app's way: every recorder step is
  // guarded, and each version keeps its notes under its own key because an older copy may wrap the same methods.
  const REQ = `__digitBugReq${VERSION}`;
  const origOpen = XMLHttpRequest.prototype.open;
  const origSend = XMLHttpRequest.prototype.send;
  const origSetHeader = XMLHttpRequest.prototype.setRequestHeader;
  XMLHttpRequest.prototype.open = function (method, url) {
    try {
      this[REQ] = { method: String(method).toUpperCase(), url: pathOf(url), fullUrl: fullUrl(url), headers: {} };
    } catch { /* not recorded */ }
    return origOpen.apply(this, arguments);
  };
  XMLHttpRequest.prototype.setRequestHeader = function (name, value) {
    try { if (this[REQ]) this[REQ].headers[name] = value; } catch { /* not recorded */ }
    return origSetHeader.apply(this, arguments);
  };
  XMLHttpRequest.prototype.send = function (body) {
    try {
      const info = this[REQ];
      if (info) {
        const reqBody = scrubBody(body);
        let timedOut = false;
        this.addEventListener('timeout', () => { timedOut = true; });
        this.addEventListener('loadend', () => {
          if (this.status && this.status < 400) return;
          let text = '';
          try {
            if (this.responseType === '' || this.responseType === 'text') text = this.responseText;
            else if (this.responseType === 'json') text = JSON.stringify(this.response);
          } catch { /* unreadable body */ }
          post({
            kind: 'network', method: info.method, url: info.url, fullUrl: info.fullUrl,
            reqHeaders: scrubHeaders(info.headers), reqBody, status: this.status,
            error: this.status ? errorSummary(text)
              : timedOut ? `timed out after ${this.timeout / 1000} s` : 'request failed (network error, CORS or aborted)',
            response: this.status ? scrubText(text, MAX_RESPONSE) : '',
          });
        });
      }
    } catch { /* not recorded */ }
    return origSend.apply(this, arguments);
  };

  // user actions, for the repro steps
  const labelOf = (el) => short(
    el.getAttribute('aria-label') || el.innerText || el.getAttribute('title') || el.value || '', 60);

  const fieldName = (el) => short(
    el.getAttribute('aria-label') || el.labels?.[0]?.innerText || el.placeholder || el.name || el.id || el.tagName.toLowerCase(), 60);

  const CLICKABLE = 'button,a,summary,label,[role=button],[role=tab],[role=menuitem],[role=option],[role=checkbox],[role=radio],[role=link]';

  // DIGIT dropdowns are plain divs, so fall back to the nearest element with a pointer cursor.
  const clickTarget = (t) => {
    const el = t.closest(CLICKABLE);
    if (el) return el;
    for (let n = t, i = 0; n && n !== document.body && i < 4; n = n.parentElement, i++) {
      if (getComputedStyle(n).cursor === 'pointer') return n;
    }
    return null;
  };

  document.addEventListener('click', (e) => {
    const t = e.target;
    if (!(t instanceof Element) || t.closest('input[type=text],input:not([type]),textarea,[contenteditable=true]')) return;
    const el = clickTarget(t);
    const text = el && labelOf(el);
    if (text) post({ kind: 'action', text: `Click "${text}"` });
  }, true);

  document.addEventListener('change', (e) => {
    const el = e.target;
    if (!(el instanceof HTMLElement)) return;
    const name = fieldName(el);
    let text;
    if (el.tagName === 'SELECT') text = `Select "${short(el.selectedOptions?.[0]?.text, 60)}" in "${name}"`;
    else if (el.type === 'checkbox' || el.type === 'radio') text = `${el.checked ? 'Tick' : 'Untick'} "${name}"`;
    else if (el.type === 'file') text = `Upload a file in "${name}"`;
    else text = `Fill in "${name}"`;
    post({ kind: 'action', text });
  }, true);

  // SPA navigation
  let lastPath = '';
  const nav = () => {
    const p = location.pathname + location.search;
    if (p !== lastPath) { lastPath = p; post({ kind: 'nav', url: p }); }
  };
  for (const fn of ['pushState', 'replaceState']) {
    const orig = history[fn];
    history[fn] = function () { const r = orig.apply(this, arguments); nav(); return r; };
  }
  window.addEventListener('popstate', nav);
  nav();

  document.addEventListener('DOMContentLoaded', () => {
    let tenant = null;
    try { tenant = localStorage.getItem('Employee.tenant-id'); } catch { /* storage blocked */ }
    if (tenant) post({ kind: 'meta', tenant: short(tenant, 40) });
  });
})();
