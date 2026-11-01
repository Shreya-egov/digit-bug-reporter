import * as db from './db.js';
import { redact } from './redact.js';

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
    'UI build: not captured',
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

function evidenceText(events) {
  const calls = dedupe(events.filter((e) => e.kind === 'network')
    .map((e) => `${e.method} ${e.url} → ${e.status || 'failed'}${e.error ? `  ${e.error}` : ''}`));
  const errors = dedupe(events.filter((e) => e.kind === 'console').map((e) => e.text));
  const parts = [];
  if (calls.length) parts.push('Failing API calls:\n' + calls.join('\n'));
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

// Say what is still missing instead of silently disabling the button.
function missingBeforeOpen() {
  if (!$('title').value.trim()) return ['title', 'Add a title first.'];
  if (!$('pii').checked) return ['pii', 'Tick the box confirming the video, screenshot and text have no personal data.'];
  return null;
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
    text: e.text && clean(e.text),
    error: e.error && clean(e.error),
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

  updateDupLink();
  for (const el of ['title', 'repo']) $(el).addEventListener('input', updateDupLink);

  $('form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const missing = missingBeforeOpen();
    if (missing) {
      status(missing[1], true);
      $(missing[0]).focus();
      $(missing[0]).scrollIntoView({ block: 'center', behavior: 'smooth' });
      return;
    }
    try {
      await db.update(id, {
        title: $('title').value.trim(),
        body: buildBody(),
        repo: $('repo').value,
        includeVideo: $('includeVideo').checked,
        includeScreenshot: $('includeShot').checked,
      });
      report = await db.get(id);
      // tabs.create, not window.open: a popup blocker can swallow window.open after the await above
      await chrome.tabs.create({ url: `https://github.com/${$('repo').value}/issues/new#digitbug=${id}` });
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
