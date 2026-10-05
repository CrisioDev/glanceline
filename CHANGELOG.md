# Changelog

All notable changes to Glanceline are listed here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/).

New entries go under **Unreleased**. `npm version <x.y.z>` turns that section into the release section (see [docs/RELEASING.md](docs/RELEASING.md)).

## [Unreleased]

## [0.5.0] – 2026-10-05

First public release.

### Prompter modes

- **Chat:** Twitch, YouTube and Kick in one list, read anonymously (no login, no API key), with platform icons and viewer counts. Emotes from Twitch, 7TV (with live updates), BTTV and FFZ, including zero-width emotes. Subs, gift subs, raids, bits, @mentions, channel-point messages, first-time and returning chatters, Shared Chat, YouTube Super Chats and memberships, Kick subs, gifts and Kicks. Pause and rewind by hotkey, bot and !command filters.
- **Optional Twitch login** (device-code flow, read-only) for follows, all channel-point redemptions, hype trains, polls, predictions and ad breaks with a countdown on the prompter.
- **Script:** smooth scrolling teleprompter with reading line, countdown, speed control, Markdown sections, stage-direction tags, right-to-left scripts and reverse scrolling. Run of show with target times per section and a show countdown. Quick inserts by hotkey.
- **Voice tracking (beta):** follows your voice offline on any CPU – English, German, French and Spanish, plus 26 more languages with an optional larger model. No audio leaves the computer.
- **Script import:** Word (.docx), Markdown and text files, paste from Word or Google Docs with formatting, or a linked folder that stays in sync.
- **OBS:** LIVE/REC timers, scene, FPS, CPU, bitrate and dropped frames via obs-websocket; scene-based mode switching, recording with the script and chapter markers.
- **Slides:** speaker notes of the current slide from PowerPoint (Windows and Mac), Keynote (Mac) and Google Slides (Chrome extension), with next-slide title and talk timer.
- **Camera:** webcam or OBS source as a confidence monitor or behind the text.

### Control

- Global hotkeys, clicker and foot-pedal mode with hold-to-scroll, phone remote via QR code, OBS custom dock, MIDI controllers, Stream Deck plugin with live state on the keys, and a documented local HTTP API.
- Profiles for look and feel, switchable by click, hotkey, mode or script.
- Director messages from the panel or a phone.

### Display

- Automatic Elgato Prompter detection, Windows display scaling handled, optional mirroring.
- Virtual prompter: a floating window under the webcam that screen capture and OBS can't see.
- More outputs for a second prompter, co-host or camera operator.
- Prompter off (standby) that survives sleep, pass-through mode, eye-line aids (crosshair, narrow column, centered text), any installed font, OpenDyslexic, high contrast and a software dimmer.

### Platform

- Windows 10/11 (installer and portable) and macOS 12+ on Apple Silicon.
- English and German UI, system tray, start with the system.
- No telemetry. Fonts are bundled; the app only talks to the chats, emote APIs and OBS you set up, plus a daily update check on GitHub that you can turn off.
- Update notice: when a new version is out, the panel shows it at the top with a link to the release.
- Hardened local server (token for home-network access, CSRF and DNS-rebinding protection, Content Security Policy), Electron fuses, automatic recovery when a prompter window crashes, and a local log file for bug reports.
