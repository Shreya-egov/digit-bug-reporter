import { clearCache, getToken, whoami } from './github-api.js';

const $ = (id) => document.getElementById(id);

function status(text, isError = false) {
  $('status').textContent = text;
  $('status').classList.toggle('error', isError);
}

$('form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const token = $('token').value.trim();
  if (!token) { status('Paste a token first.', true); return; }
  status('Testing…');
  try {
    const login = await whoami(token);
    await chrome.storage.local.set({ githubToken: token });
    await clearCache();
    $('token').value = '';
    status(`Saved. Connected as ${login}.`);
  } catch (err) {
    status(`Not saved: ${err.message}`, true);
  }
});

$('remove').addEventListener('click', async () => {
  await chrome.storage.local.remove('githubToken');
  await clearCache();
  status('Token removed.');
});

getToken().then((t) => status(t ? 'A token is saved. Paste a new one to replace it.' : 'No token saved.'));
