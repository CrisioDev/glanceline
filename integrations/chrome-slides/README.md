# Glanceline for Google Slides

A small Chrome extension (Manifest V3) that sends the speaker notes of the current Google Slides slide to Glanceline. The prompter then works like with PowerPoint: notes of the current slide, slide counter, talk timer and automatic switching when the presentation starts and ends.

## Install

1. In Glanceline: *Settings → Stream Deck & API → Open extension folder*.
2. In Chrome (or Edge): open `chrome://extensions`, turn on *Developer mode*, click *Load unpacked* and pick that folder.

`npm run pack:slides` builds `dist/glanceline-google-slides.zip` for the Chrome Web Store.

## Use

1. Start Glanceline.
2. Open the presentation in Google Slides and click *Slideshow*.
3. Press **S** (or ⋮ → *Open speaker notes*). The speaker notes window opens, and from now on the prompter follows every slide.

Closing the speaker notes window ends the presentation in Glanceline. If PowerPoint is open at the same time, Google Slides wins while its notes window is open.

## How it works

- `content.js` runs only in the speaker notes window (an `about:blank` popup of `docs.google.com`, hence `match_about_blank`). It reads the slide counter (`.punch-viewer-speakernotes-text-header`, “Slide 3 of 12”) and the notes (`.punch-viewer-speakernotes-text-body`), and reports changes plus a heartbeat every 3 s.
- `background.js` posts them to `http://127.0.0.1:4890/api/slides`. Web pages are not allowed to reach localhost, the extension's service worker is.
- Glanceline accepts extension origins **only** on `/api/slides`; every other endpoint still rejects foreign origins.
- No data leaves your PC. The extension needs no access to your Google account or files – it only reads the window you opened.
