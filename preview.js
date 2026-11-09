import * as db from './db.js';
import { redact } from './redact.js';
import { getToken, listAssignees, listRepos } from './github-api.js';
import { createCombo } from './combo.js';

const $ = (id) => document.getElementById(id);
const id = new URLSearchParams(location.search).get('id');

const ENVIRONMENTS = {
  'unified-qa.digit.org': 'qa',
  'unified-uat.digit.org': 'uat',
  'unified-dev.digit.org': 'dev',
  'health-demo.digit.org': 'demo',
  'hcm-demo.digit.org': 'demo',
};
const UI_REPO = 'egovernments/DIGIT-Frontend';
const SERVICE_REPO = 'egovernments/health-campaign-services';
const MAX_STEPS = 25;
const REPO_RE = /^[\w.-]+\/[\w.-]+$/;

const counts = {};
const clean = (s) => redact(s, counts).text;

function environmentLine(url, events) {
  let u;
  try { u = new URL(url); } catch { return ''; }
  const env = ENVIRONMENTS[u.host];
  const tenant = [...events].reverse().find((e) => e.kind === 'meta')?.tenant;
  const campaign = u.searchParams.get('campaignNumber');
  const flow = u.searchParams.get('flow');
  const chrome = navigator.userAgent.match(/Chrome\/(\d+)/)?.[1];
  return [
    `${u.host}${env ? ` (${env})` : ''}`,
    tenant && `tenant ${tenant}`,
    campaign && `campaign ${campaign}${flow ? ` / flow ${flow}` : ''}`,
    chrome && `Chrome ${chrome}`,
  ].filter(Boolean).join(', ');
}

function draftSteps(url, events) {
  const steps = [];
  let first;
  try { first = new URL(url); } catch { /* no url */ }
  const firstNav = events.find((e) => e.kind === 'nav');
  const start = firstNav?.url || (first ? first.pathname + first.search : '');
  if (first) steps.push(`Open https://${first.host}${start}`);
  const repeats = [1];
  for (const e of events) {
    let text;
    if (e.kind === 'action') text = e.text;
    else if (e.kind === 'nav' && e !== firstNav) text = `Page changes to ${e.url}`;
    if (!text) continue;
    // repeated clicks (e.g. "Next" through a wizard) are real steps, so count them rather than drop them
    if (text === steps[steps.length - 1]) repeats[repeats.length - 1]++;
    else { steps.push(text); repeats.push(1); }
  }
  const lines = steps.map((s, i) => (repeats[i] > 1 ? `${s} (×${repeats[i]})` : s));
  const shown = lines.slice(0, MAX_STEPS);
  if (lines.length > MAX_STEPS) shown.push(`… ${lines.length - MAX_STEPS} more actions not listed`);
  return shown.map((s, i) => `${i + 1}. ${s}`).join('\n');
}

// Collapse repeats so a retry loop doesn't fill the ticket.
function dedupe(lines) {
  const seen = new Map();
  for (const l of lines) seen.set(l, (seen.get(l) || 0) + 1);
  return [...seen].map(([l, n]) => (n > 1 ? `${l}  (×${n})` : l));
}

const MAX_CALLS = 10;
const shellQuote = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;

// The failing request as a curl command (secrets were stripped when it was recorded, the rest is redacted).
function curlOf(e) {
  const lines = [`curl -X ${e.method} ${shellQuote(e.fullUrl)}`];
  for (const [name, value] of Object.entries(e.reqHeaders || {})) lines.push(`  -H ${shellQuote(`${name}: ${value}`)}`);
  if (e.reqBody) lines.push(`  --data-raw ${shellQuote(e.reqBody)}`);
  return lines.join(' \\\n');
}

const prettyJson = (text) => {
  try { return JSON.stringify(JSON.parse(text), null, 2); } catch { return text; } // cut-off or not JSON
};

function evidenceText(events) {
  // one entry per call; repeats of the same call and status are counted, not listed again
  const calls = new Map();
  for (const e of events.filter((x) => x.kind === 'network')) {
    const key = `${e.method} ${e.url.split('?')[0]} ${e.status}`;
    const seen = calls.get(key);
    if (seen) seen.count++;
    else calls.set(key, { e, count: 1 });
  }
  const blocks = [...calls.values()].slice(0, MAX_CALLS).map(({ e, count }, i) => [
    `${i + 1}. ${e.method} ${e.url} → ${e.status || 'failed'}${e.error ? `  ${e.error}` : ''}${count > 1 ? `  (×${count})` : ''}`,
    e.fullUrl && curlOf(e),
    e.response && `Response ${e.status}:\n${prettyJson(e.response)}`,
  ].filter(Boolean).join('\n'));
  if (calls.size > MAX_CALLS) blocks.push(`… ${calls.size - MAX_CALLS} more failing calls not listed`);

  const errors = dedupe(events.filter((e) => e.kind === 'console').map((e) => e.text));
  const parts = [];
  if (blocks.length) parts.push('Failing API calls:\n\n' + blocks.join('\n\n'));
  if (errors.length) parts.push('Console errors:\n' + errors.slice(0, 20).join('\n'));
  return parts.join('\n\n') || 'No failing API calls or console errors were captured.';
}

// A failing HCM service call points at the backend; everything else is UI behaviour.
function suggestRepo(events) {
  const svc = events.find((e) => e.kind === 'network' && e.status >= 500 && /\/_(search|create|update|delete)|\/v\d\//.test(e.url));
  return svc
    ? [SERVICE_REPO, `Suggested because ${svc.method} ${svc.url.split('?')[0]} returned ${svc.status}.`]
    : [UI_REPO, 'Suggested because no HCM service returned a 5xx error. Change it if the data saved is wrong.'];
}

function componentOf(url) {
  try { return new URL(url).pathname.split('/').filter(Boolean)[0] || ''; } catch { return ''; }
}

function buildBody() {
  const v = (k) => $(k).value.trim();
  const section = (h, text) => `## ${h}\n${text || '_not provided_'}\n`;
  const media = [$('includeShot').checked && report.screenshot && 'screenshot', $('includeVideo').checked && report.video?.size && 'screen recording']
    .filter(Boolean).join(' and ');
  return [
    `**Environment:** ${v('env')}\n`,
    section('Summary', v('summary')),
    section('Steps to reproduce', v('steps')),
    section('Expected', v('expected')),
    section('Actual', v('actual')),
    section('Evidence', `${media ? `The ${media} ${media.includes(' and ') ? 'are' : 'is'} attached below.\n\n` : ''}\`\`\`text\n${v('evidence')}\n\`\`\``),
    section('Notes', v('notes')),
    `**Severity:** ${v('severity')}   **Component:** ${v('component') || 'not set'}`,
    '',
    '<sub>Captured with DIGIT Bug Reporter. Evidence was redacted automatically and reviewed by the reporter.</sub>',
    '',
  ].join('\n');
}

function updateDupLink() {
  const words = $('title').value.replace(/[^\w\s-]/g, ' ').split(/\s+/).filter((w) => w.length > 3).slice(0, 5).join(' ');
  $('dupLink').href = `https://github.com/${$('repo').value}/issues?q=${encodeURIComponent(`is:issue ${words}`)}`;
}

// ---- GitHub fields: repo dropdown, then the chosen repo's assignees ----
let token = '';
let fieldsLoad = 0;
let repos = [UI_REPO, SERVICE_REPO]; // the main two are usable straight away; the full list takes a few pages
let currentRepo = '';

async function loadRepos() {
  try {
    const listed = await listRepos(token);
    repos = [...new Set([UI_REPO, SERVICE_REPO, ...listed])];
  } catch (err) {
    $('githubConn').textContent = `Repo list unavailable (${err.message}). You can still type owner/name.`;
  }
  repoCombo.refresh();
}

// Assignees are not carried over between reports: pre-filled people from an old report were surprising.
// Only reopening the same report brings back its own picks. Clears what older versions remembered.
chrome.storage.local.remove('lastChoice');
const ownPicks = (repo) => (report?.repo === repo ? report.assignees || [] : []);

// Setting the field fires 'change', which reloads assignees and re-checks the field.
function setRepo(value) {
  $('repo').value = value;
  $('repo').dispatchEvent(new Event('change'));
  updateDupLink();
}

const repoCombo = createCombo({
  input: $('repo'),
  listbox: $('repoOptions'),
  toggle: $('repoToggle'),
  container: $('repoCombo'),
  items: () => repos,
  pinned: 2,
  isCurrent: (value) => value === currentRepo,
  onPick: setRepo,
  onEnter: setRepo,
  emptyText: (q) => (q ? `No listed repo matches "${q}". Press Enter to use it as typed (owner/name).` : 'Loading repos…'),
});

// ---- Assignees: the dropdown closes after each pick; picked people show as removable chips ----
const MAX_ASSIGNEES = 10; // GitHub's limit per issue
let people = [];
let picked = [];

const assigneeCombo = createCombo({
  input: $('assigneeInput'),
  listbox: $('assigneeOptions'),
  toggle: $('assigneeToggle'),
  container: $('assigneeCombo'),
  items: () => people.filter((login) => !picked.includes(login)),
  onPick: pick,
  emptyText: (q) => (q ? `Nobody matches "${q}".` : people.length ? 'Everyone is already picked.' : 'Nobody can be assigned in this repo.'),
});

function pick(login) {
  if (picked.length >= MAX_ASSIGNEES) {
    $('assigneeHint').textContent = `GitHub allows at most ${MAX_ASSIGNEES} assignees.`;
  } else if (!picked.includes(login)) {
    picked.push(login);
  }
  $('assigneeInput').value = '';
  renderChips();
}

function unpick(login) {
  picked = picked.filter((l) => l !== login);
  $('assigneeHint').textContent = '';
  renderChips();
  assigneeCombo.refresh(); // they're pickable again
}

function renderChips() {
  $('assigneeChips').replaceChildren(...picked.map((login) => {
    const li = document.createElement('li');
    const remove = Object.assign(document.createElement('button'), { type: 'button', textContent: '×' });
    remove.setAttribute('aria-label', `Remove ${login}`);
    remove.addEventListener('click', () => { unpick(login); $('assigneeInput').focus(); });
    li.append(login, remove);
    return li;
  }));
  // the list closes after each pick, so say that more people can be added
  $('assigneeInput').placeholder = picked.length >= MAX_ASSIGNEES ? `Limit of ${MAX_ASSIGNEES} reached`
    : picked.length ? 'Add another person…' : 'Search people…';
  updateAssigneeCount();
}

function useAssigneeText(hint, value = []) {
  assigneeCombo.close();
  $('assigneeCombo').hidden = true;
  $('assigneeChips').hidden = true;
  $('assigneeText').hidden = false;
  $('assigneeText').value = value.join(', ');
  $('assigneeHint').textContent = hint;
  $('assigneeCount').textContent = '';
}

function renderAssignees(logins, selected) {
  people = logins;
  picked = selected.filter((l) => logins.includes(l));
  $('assigneeInput').value = '';
  assigneeCombo.close();
  $('assigneeCombo').hidden = false;
  $('assigneeChips').hidden = false;
  $('assigneeText').hidden = true;
  $('assigneeHint').textContent = logins.length ? '' : 'Nobody can be assigned in this repo.';
  renderChips();
}

function updateAssigneeCount() {
  const n = assigneeValues().length;
  $('assigneeCount').textContent = n ? `· ${n} selected` : '';
}

const assigneeValues = () => ($('assigneeText').hidden
  ? [...picked]
  : $('assigneeText').value.split(/[\s,]+/).map((s) => s.replace(/^@/, '')).filter(Boolean));

async function loadRepoFields() {
  const repo = $('repo').value.trim();
  if (!REPO_RE.test(repo)) return;
  currentRepo = repo;
  const load = ++fieldsLoad; // a slower lookup for a previous repo must not overwrite this one
  $('assigneeHint').textContent = 'Loading people…';
  try {
    const logins = await listAssignees(repo, token);
    if (load === fieldsLoad) renderAssignees(logins, ownPicks(repo));
  } catch (err) {
    if (load === fieldsLoad) useAssigneeText(`Couldn't list people (${err.message}). Type GitHub usernames instead.`, ownPicks(repo));
  }
}

async function initGithubFields() {
  token = await getToken();
  const conn = $('githubConn');
  conn.replaceChildren(token ? 'Connected to GitHub. ' : 'Not connected to GitHub: only public egovernments repos are listed. ');
  const link = Object.assign(document.createElement('a'), { href: '#', textContent: token ? 'Settings' : 'Connect GitHub' });
  link.addEventListener('click', (e) => { e.preventDefault(); chrome.runtime.openOptionsPage(); });
  conn.append(link);

  $('repo').addEventListener('change', loadRepoFields);
  // Backspace in the empty field removes the last picked person
  $('assigneeInput').addEventListener('keydown', (e) => {
    if (e.key === 'Backspace' && !$('assigneeInput').value && picked.length) unpick(picked[picked.length - 1]);
  });
  await Promise.all([loadRepos(), loadRepoFields()]);
}

// ---- Field validation: each message sits under its own field and clears once that field is fixed ----
const LOGIN_RE = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;

const CHECKS = [
  ['repo', () => REPO_RE.test($('repo').value.trim()) || 'Pick a repository in the form owner/name, e.g. egovernments/DIGIT-Frontend.'],
  ['assigneeText', () => {
    if ($('assigneeText').hidden) return true;
    const bad = assigneeValues().filter((l) => !LOGIN_RE.test(l));
    return !bad.length || `Not a GitHub username: ${bad.join(', ')}.`;
  }],
  ['title', () => !!$('title').value.trim() || 'Add a title.'],
  ['pii', () => $('pii').checked || 'Tick this box after checking the video, screenshot and text for personal data.'],
];

function setFieldError(id, message) {
  const field = $(id);
  const errorId = `${id}Error`;
  let el = $(errorId);
  if (!message) {
    el?.remove();
    field.removeAttribute('aria-invalid');
    return;
  }
  if (!el) {
    el = Object.assign(document.createElement('p'), { id: errorId, className: 'field-error' });
    (field.closest('label, .combo') || field).after(el);
  }
  el.textContent = message;
  field.setAttribute('aria-invalid', 'true');
  field.setAttribute('aria-describedby', errorId);
}

// Shows every problem at once and returns the first field that needs fixing.
function validate() {
  let first = null;
  for (const [id, check] of CHECKS) {
    const result = check();
    setFieldError(id, result === true ? '' : result);
    if (result !== true) first ??= id;
  }
  return first;
}

// Re-check a field as soon as it changes, so its message goes away when fixed.
for (const [id, check] of CHECKS) {
  for (const type of ['input', 'change']) {
    $(id).addEventListener(type, () => { if ($(`${id}Error`)) { const r = check(); setFieldError(id, r === true ? '' : r); } });
  }
}

function status(text, isError = false) {
  $('status').textContent = text;
  $('status').classList.toggle('error', isError);
}

const showFailure = (err) => status(`Something went wrong: ${err?.message || err}. Use "Copy as Markdown" instead.`, true);
window.addEventListener('error', (e) => showFailure(e.error || e.message));
window.addEventListener('unhandledrejection', (e) => showFailure(e.reason));

let report = await db.get(id);

if (!report) {
  $('missing').hidden = false;
  $('form').hidden = true;
} else {
  const events = (report.events || []).map((e) => ({
    ...e,
    url: e.url && clean(e.url),
    fullUrl: e.fullUrl && clean(e.fullUrl),
    text: e.text && clean(e.text),
    error: e.error && clean(e.error),
    reqBody: e.reqBody && clean(e.reqBody),
    response: e.response && clean(e.response),
    reqHeaders: e.reqHeaders && Object.fromEntries(Object.entries(e.reqHeaders).map(([k, v]) => [k, clean(v)])),
  }));
  const tabUrl = clean(report.tabUrl);

  if (report.video?.size) {
    $('videoBox').hidden = false;
    $('video').src = URL.createObjectURL(report.video);
    const mb = report.video.size / 1e6;
    $('videoSize').textContent = `${mb.toFixed(1)} MB${mb > 10 ? ' · over GitHub’s 10 MB limit on free plans' : ''}`;
  } else {
    $('includeVideo').checked = false;
  }
  if (report.screenshot) {
    $('shotBox').hidden = false;
    $('shot').src = report.screenshot;
  } else {
    $('includeShot').checked = false;
  }

  const [repo, why] = suggestRepo(events);
  $('repo').value = report.repo || repo;
  $('repoWhy').textContent = why;
  $('env').value = environmentLine(report.tabUrl, events);
  $('steps').value = draftSteps(tabUrl, events);
  $('evidence').value = evidenceText(events);
  $('component').value = componentOf(report.tabUrl);
  if (report.title) $('title').value = report.title;

  const masked = Object.entries(counts).map(([k, n]) => `${n} ${k}`).join(', ');
  $('redactions').textContent = masked ? `Redacted automatically: ${masked}.` : 'Nothing needed redacting.';
  if (report.captureRestartedAt) {
    $('captureNote').hidden = false;
    $('captureNote').textContent = `API and console capture wasn't running in this tab (it was open when the extension was `
      + `installed or updated) and was restarted at ${new Date(report.captureRestartedAt).toLocaleTimeString()}. `
      + 'Calls before that are missing: reproduce the bug again if they matter.';
  }

  updateDupLink();
  for (const el of ['title', 'repo']) $(el).addEventListener('input', updateDupLink);
  initGithubFields();

  $('form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const invalid = validate();
    if (invalid) {
      status('');
      $(invalid).focus();
      $(invalid).scrollIntoView({ block: 'center', behavior: 'smooth' });
      return;
    }
    try {
      const repo = $('repo').value.trim();
      const assignees = assigneeValues();
      await db.update(id, {
        title: $('title').value.trim(),
        body: buildBody(),
        repo,
        assignees,
        includeVideo: $('includeVideo').checked,
        includeScreenshot: $('includeShot').checked,
      });
      report = await db.get(id);
      // GitHub's new-issue URL pre-selects assignees (applied only if you have triage/write access)
      const params = new URLSearchParams();
      // GitHub's own pre-fill for the title; the GitHub page script checks it arrived
      params.set('title', $('title').value.trim());
      if (assignees.length) params.set('assignees', assignees.join(','));
      const query = params.toString();
      // tabs.create, not window.open: a popup blocker can swallow window.open after the await above
      await chrome.tabs.create({ url: `https://github.com/${repo}/issues/new${query ? `?${query}` : ''}#digitbug=${id}` });
      status('GitHub opened in a new tab. Check the filled form there, wait for the uploads to finish, then click Create.');
    } catch (err) {
      showFailure(err);
    }
  });

  $('copy').addEventListener('click', async () => {
    await navigator.clipboard.writeText(`# ${$('title').value.trim()}\n\n${buildBody()}`);
    status('Copied. Attach the video and screenshot yourself if you paste it somewhere else.');
  });

  $('downloadVideo').disabled = !report.video?.size;
  $('downloadVideo').addEventListener('click', () => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(report.video);
    a.download = `digit-bug-${new Date(report.createdAt).toISOString().slice(0, 16).replace(/[:T]/g, '')}.webm`;
    a.click();
  });

  $('discard').addEventListener('click', async () => {
    if (!confirm('Delete this recording and draft?')) return;
    await db.remove(id);
    window.close();
  });
}
