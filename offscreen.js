// Records the tab stream handed over by the service worker. Lives in an offscreen document because
// service workers can't use MediaRecorder.
import * as db from './db.js';

const MAX_MS = 120_000; // ~9 MB at the bitrate below; GitHub's video limit is 10 MB on free plans

let recorder = null;
let stream = null;
let chunks = [];
let timer = null;

async function start(streamId) {
  stream = await navigator.mediaDevices.getUserMedia({
    audio: false,
    video: {
      mandatory: {
        chromeMediaSource: 'tab',
        chromeMediaSourceId: streamId,
        maxWidth: 1440,
        maxHeight: 900,
        maxFrameRate: 12,
      },
    },
  });
  const mimeType = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm']
    .find((t) => MediaRecorder.isTypeSupported(t));
  recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 600_000 });
  chunks = [];
  recorder.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
  recorder.start(1000);
  timer = setTimeout(() => chrome.runtime.sendMessage({ type: 'auto-stop' }), MAX_MS);
}

async function stop(id) {
  clearTimeout(timer);
  if (!recorder) return { size: 0 };
  await new Promise((resolve) => { recorder.onstop = resolve; recorder.stop(); });
  stream.getTracks().forEach((t) => t.stop());
  const video = new Blob(chunks, { type: 'video/webm' });
  recorder = null; stream = null; chunks = [];
  await db.update(id, { video });
  return { size: video.size };
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.target !== 'offscreen') return;
  const run = msg.type === 'start' ? start(msg.streamId) : stop(msg.id);
  run.then((r) => sendResponse({ ok: true, ...r }), (err) => sendResponse({ ok: false, error: String(err?.message || err) }));
  return true;
});
