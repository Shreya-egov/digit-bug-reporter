# DIGIT Bug Reporter (Chrome extension)

Record a bug on the DIGIT HCM console the way you would with a screen recorder. When you press **Stop**, the
extension opens a review page with the video, a screenshot, the steps drafted from your clicks, and the failing API
calls and console errors, already redacted. After you review it, **Open on GitHub** fills in the new-issue form and
uploads the media. You click **Create**.

## Install (once)
1. Get the code:
   ```bash
   git clone https://github.com/Shreya-egov/digit-bug-reporter.git
   ```
   or download it as a ZIP from GitHub (**Code → Download ZIP**) and unzip it.
2. Open `chrome://extensions` and turn on **Developer mode** (top right).
3. Click **Load unpacked** and choose the `digit-bug-reporter` folder.
4. Pin the extension: click the puzzle icon in the toolbar, then the pin next to **DIGIT Bug Reporter**.
5. Reload any DIGIT tabs that are already open, so that capture starts on them.

## Use
1. On the DIGIT page, click the extension icon (or press **Alt+Shift+B**) and choose what to capture:
   **Video + screenshot**, **Video only** or **Screenshot only**. The popup remembers your choice.
2. Click **● Start recording** and reproduce the bug. Recording stops by itself after 2 minutes.
   With **Screenshot only**, click **📷 Take screenshot** instead; the review page opens straight away.
3. Click the icon again, then **■ Stop & review**.
4. On the review page:
   - Write the title, the expected result and the actual result.
   - Check the drafted steps, and add the values you typed. Typed text is never recorded.
   - Watch the video. Tick the box confirming that no personal data is visible.
5. Click **Open on GitHub**. Wait for the "done" banner, check the issue, then click **Create**.

Other options: **Copy as Markdown** for Jira or Slack, **Download video**, and **Discard**.

## What is captured
- **Captured:** failing API calls (method, path, status, and the DIGIT `Errors[].code/message`); console errors;
  button and option clicks; select and checkbox changes; page changes; the tenant.
  Events start 1 minute before you press Start, so errors from page load are included.
- **Never captured:** request bodies (they contain the auth token), what you type into text fields, and audio.
- **Redaction:** tokens, JWTs, passwords, OTPs, phone numbers, emails, personal-data fields and non-essential query
  parameters are masked automatically. Free text and the video can't be redacted, so check them before filing.
- **Storage:** only the last 10 reports are kept, in the extension's own storage.

## Limits
- The UI build/image tag isn't captured. Add it to the Environment line yourself if it matters.
- GitHub's video limit is 10 MB on free plans. Two minutes is about 9 MB. The review page warns you if a video is larger.
- If the repository shows a template chooser, pick **Blank issue**. If the upload fails, the banner gives you a
  download link so you can drag the file in yourself.
- Capture works on `*.digit.org` tabs only.

## Updating
`git pull` in the folder (or download the ZIP again), then click the reload icon (↻) on **DIGIT Bug Reporter** in
`chrome://extensions`.
