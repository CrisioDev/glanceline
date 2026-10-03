# Glanceline

**A teleprompter companion for streamers and presenters.** Built for the Elgato Prompter, works with any teleprompter display.

Glanceline puts what you need while you are on camera onto your prompter:

- your **Twitch chat**, including 7TV, BTTV and FFZ emotes,
- a **scrolling script**,
- your **OBS stream status**,
- or the **PowerPoint speaker notes** of the current slide.

You switch between them with one click or a global hotkey. You can also place your own camera image behind the text.

> 🇩🇪 [Deutsche Anleitung](README.de.md)
>
> Glanceline is an independent, unofficial project. It is not affiliated with, endorsed or sponsored by Elgato or Corsair. “Elgato” and “Prompter” are trademarks of their respective owners.

## Features

| Mode | What you see on the prompter |
|---|---|
| **Chat** | Twitch chat, read anonymously (no login): <br>• Emotes from Twitch, **7TV**, BTTV and FFZ, including zero-width emotes <br>• **Live 7TV updates**: added or removed emotes show up instantly <br>• Highlighted subs, gift subs, raids, bits and @mentions <br>• Channel-point messages, first-time and returning chatters, Shared Chat marked <br>• **Pause and rewind** the chat by hotkey <br>• Bot and !command filters |
| **Script** | Teleprompter that can **follow your voice** – offline, any CPU, English/German/French/Spanish. It waits while you ad-lib and catches up when you skip ahead. Also includes: <br>• a reading line and a countdown <br>• speed control <br>• Markdown sections you can jump between by hotkey <br>• stage-direction tags like `[Pause]` <br>• **Clicker & foot pedal** support (PageUp/PageDown or any key you choose) <br>• **Quick inserts**: a hotkey drops in a short script (raid thank-you, ad read), then jumps back to where you were <br>• right-to-left scripts and reverse scrolling |
| **OBS** | LIVE/REC timers, current scene, FPS, CPU, bitrate and dropped frames (via obs-websocket) |
| **PowerPoint** | Speaker notes of the **current slide**, synced automatically, presenter clickers included. Text auto-fits, with next-slide title and talk timer. Switches on when the slideshow starts. |
| **Camera** | Your camera image as a confidence monitor |

Also included:

- **Camera image behind the text.** Text stays readable with adjustable darkening and a backdrop. The source is a webcam or any OBS source.
- **Status bar in every mode** with LIVE/REC indicator and clock. Raids and subs pop up even while you read a script.
- **Control from anywhere.** Desktop panel with a live preview, your phone (scan a QR code, add to home screen), an OBS custom dock, or **global hotkeys** (Stream Deck: use the “Hotkey” action).
- **Eye-line aids:** lens crosshair, narrow text column, centered text. Any installed font, OpenDyslexic, high-contrast mode and a software dimmer against reflections.
- **OBS automation:** switching OBS scenes switches the prompter mode (e.g. *Just Chatting* → chat). Optionally start a recording with the script and add chapter markers for every section and slide.
- **Director messages:** send a short note from the panel or a phone (“2 minutes left”) that flashes on the prompter.
- **Pass-through:** hide Glanceline on the prompter to use other apps there (Zoom, browser).
- **Prompter detection** by name or resolution, Windows display scaling handled, optional horizontal mirroring.
- **English & German** UI, system tray, start with Windows. Runs fully offline except chat and emotes. **No telemetry.**

## Requirements

- **Windows 10/11.** PowerPoint sync uses Windows COM. macOS support is planned.
- Optional: OBS Studio 28+ (obs-websocket is built in) and Microsoft PowerPoint.

## Installation

Download the installer or the portable `.exe` from the [Releases](../../releases) page and run it.

### Run from source

```bash
npm install
npm start
```

`npm run server` starts only the web server, without Electron. The panel is then at `http://127.0.0.1:4890/` and the prompter view at `/prompter`.

## Quick start

1. Connect the prompter and start Glanceline. It places itself full-screen on the prompter. Without a prompter it opens a 1024×600 test window instead.
2. The welcome dialog asks for your language and (optionally) your Twitch channel. It also checks whether the prompter and OBS were detected.
3. Pick a mode in the panel or press a hotkey. Closing the panel keeps Glanceline running in the system tray.

### Default hotkeys

All hotkeys work globally and can be changed under *Settings → Keyboard shortcuts*.

| Shortcut | Action |
|---|---|
| Ctrl+Alt+F1 … F5 | Chat / Script / OBS / PowerPoint / Camera only |
| Ctrl+Alt+F6 | Blackout |
| Ctrl+Alt+F7 | Camera image on/off |
| Ctrl+Alt+F8 | Reset PowerPoint timer |
| Ctrl+Alt+Num 5 | Script start/pause |
| Ctrl+Alt+Num 8 / Num 2 | Scroll back / forward (script & long notes) |
| Ctrl+Alt+Num 4 / Num 6 | Slower / faster |
| Ctrl+Alt+Num 7 / Num 9 | Previous / next section |
| Ctrl+Alt+Num 1 | Script back to start |
| Ctrl+Alt+Num + / Num − | Font bigger / smaller |
| Ctrl+Alt+Num 3 | Voice tracking on/off |
| Ctrl+Alt+F9 | Pass-through on/off |
| Ctrl+Alt+F10 | Pause/resume chat |
| Ctrl+Alt+F11 / F12 | Insert 1 / 2 |

Clicker keys (PageDown / PageUp / B) are off by default. Turn them on under *Settings → Clicker & foot pedal*. They only apply in script mode, so PowerPoint keeps its keys.

The defaults avoid Ctrl+Alt+letter on purpose. On many European keyboards that combination is AltGr (@, €, {, [ …).

### Tips

- **Camera busy?** OBS usually holds webcams exclusively. Choose *OBS source* as the camera source (up to 15 fps). Alternatively, set OBS's virtual camera to output that source and pick “OBS Virtual Camera”.
- **PowerPoint:** under *Slide Show → Monitor*, choose your projector or main screen, not the prompter.
- **Text reversed in the glass?** Turn on *Settings → Prompter display → Mirror image horizontally*.
- **Phone access:** the link contains a secret token. *Create new access link* locks out all previously connected devices.

## Data & privacy

- Settings and scripts live in `%APPDATA%\Glanceline`. You can override the location with the `GLANCELINE_DATA` environment variable.
- Voice tracking runs completely on your PC: no audio leaves your computer. The speech model (~70 MB, Kroko ASR by Banafo, CC BY-SA 4.0) is downloaded from Hugging Face on first use.
- Glanceline talks only to:
  - Twitch chat (anonymous read-only IRC),
  - the public 7TV / BTTV / FFZ emote APIs and the 7TV EventAPI,
  - your local OBS.
- There is no telemetry, no account and no cloud. Fonts are bundled.
- The local web server binds to `127.0.0.1`. Home-network access is opt-in and token-protected.

## Development

```
main.js                   Electron: prompter window, hotkeys, tray, autostart
server/index.js           HTTP + Server-Sent Events, state, actions
server/twitch.js          Twitch IRC (anonymous) + emote tokenizer
server/emotes.js          7TV / BTTV / FFZ
server/seventv-events.js  7TV EventAPI (live emote updates)
server/obs.js             obs-websocket v5
server/powerpoint.js      PowerPoint bridge (server/ppt-bridge.ps1, COM)
server/voice*.js          voice tracking: sherpa-onnx worker, model download, script tracker
public/                   panel, prompter view, i18n.js, qr.js, fonts
tools/                    icon generator, i18n check, dev shortcuts
```

- `npm run dist` builds the Windows installer and the portable `.exe` into `dist/`.
- `node tools/check-i18n.js` verifies that every UI text exists in every language.
- `electron . --snapshot <dir> --snapshot-steps "chat:demo,wait3000,mode:chat,tab:live"` saves screenshots of the prompter and panel, then exits. Handy for visual checks.

### Translations

All texts live in [`public/i18n.js`](public/i18n.js). To add a language:

1. Copy the `en` block and translate it.
2. Add the language to `LANGUAGE_OPTIONS`.
3. Run the i18n check.

## License

See [LICENSE](LICENSE). Bundled fonts (Atkinson Hyperlegible, Inter, Cormorant Garamond) are licensed under the SIL Open Font License 1.1; see [`public/fonts/LICENSES`](public/fonts/LICENSES).
