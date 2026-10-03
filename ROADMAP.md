# Roadmap

This roadmap is based on research done in October 2026. It covers:

- about 650 Prompter posts and 1,200 comments on r/elgato (Sep 2023 – Oct 2026)
- the Elgato Studio 2.0 beta megathreads
- press reviews
- GitHub issues of open-source teleprompters (QPrompt, Imaginary Teleprompter, Textream)
- App Store reviews of commercial prompter apps

Effort estimates: **S** = small, **M** = medium, **L** = large.

## Positioning

**Elgato Studio 2.0** (public beta since July 2026) is replacing Camera Hub for the Prompter. It covers the following, so we don't compete head-on there:

- editing scripts without the hardware
- importing script files
- a combined Twitch/YouTube/Kick chat
- an operator preview
- multiple prompters
- a crosshair and a "virtual prompter"
- Voice Sync, which keeps improving

**Glanceline is the streamer's prompter.** It focuses on what users ask for and Elgato doesn't offer (or not yet):

| Gap in Elgato's software (as of Oct 2026) | Glanceline |
|---|---|
| Hotkeys / Stream Deck missing in Studio 2.0 — top complaint in every beta thread | ✅ global hotkeys, phone, OBS dock, Stream Deck plugin, MIDI |
| Camera image behind the script — Elgato cameras only, missing in Studio | ✅ any webcam or OBS source |
| Full-fidelity chat: 7TV/BTTV/FFZ, subs, raids, bits | ✅ Twitch + YouTube + Kick, incl. live 7TV updates |
| OBS status on the prompter | ✅ |
| PowerPoint notes synced to the current slide | ✅ |
| Windows 10 (dropped by Studio 2.0) | ✅ |
| Light, portable, no telemetry | ✅ |

## Phase 0 — First public release (v0.2)

- [x] English + German UI, i18n check
- [x] First-run setup, neutral defaults
- [x] Data in `%APPDATA%\Glanceline`, migration of old data
- [x] Bundled fonts (offline, no Google requests)
- [x] Installer + portable build, GitHub Actions release workflow
- [x] License (MIT), final name, app ID
- [ ] Public repo (private for now)
- [ ] README screenshots / GIF
- [ ] Code signing (e.g. SignPath Foundation for OSS) — avoids the SmartScreen warning
- [ ] Auto-update via GitHub Releases (`electron-updater`)

## Phase 1 — Quick wins against real pain points (v0.3)

✅ **Done in Oct 2026**, except hold-to-scroll from 1.1 (moved to Phase 2).

| # | Feature | Why (evidence) | Effort |
|---|---|---|---|
| 1.1 | ✅ **Clicker & pedal mode** — while active, plain keys (PgUp/PgDn, arrows, Space, B) control the prompter, so cheap USB/Bluetooth clickers and foot pedals work. Also: hold-to-scroll, small line steps, reverse speed, jump to top. | "Even cheap Chinese prompters come with a remote"; about 77 threads ask for remote/pedal/phone, about 22 for precise navigation on retakes | S |
| 1.2 | ✅ **Pass-through mode** — hide Glanceline on the prompter so other apps (Zoom, browser) can be used and clicked; software dimmer against glare | about 13 threads on clicks being swallowed; brightness floor of 30 % causes reflections | S |
| 1.3 | ✅ **Eye-line aids** — lens crosshair (position, size, opacity) and adjustable side margins for a narrow column (hides eye movement); center alignment | Crosshair re-added by Elgato after backlash; "please allow more than 30 % margin" | S |
| 1.4 | ✅ **Fonts & accessibility** — any installed system font, bundled OpenDyslexic, right-to-left scripts, high-contrast mode without fade | about 29 threads on fonts/accessibility, about 11 on RTL (Arabic input hangs Camera Hub) | S |
| 1.5 | ✅ **Chat details** — pause/rewind chat by hotkey; channel-point messages, first-time and returning chatters marked; badge for Shared Chat source | "the ability to rewind chat (would buy a foot pedal for this)"; "channel point redemptions … won't show at all" | S |
| 1.6 | ✅ **Director messages** — send a short message from panel or phone that flashes on the prompter ("2 minutes left", "check the mic") | Director/"message to stage" features in Textream, Stagetimer, Ontime | S |
| 1.7 | ✅ **OBS automation** — switch Glanceline's mode when the OBS scene changes (e.g. *Just Chatting* → chat, *Starting soon* → script); optionally start recording with the script and add chapter markers per section/slide | Streamers juggle scenes and prompter separately; obs-websocket offers everything needed | S |
| 1.8 | ✅ **Quick-insert scripts** — a hotkey shows a short script (raid thank-you, ad read, sponsor), then returns to the previous mode and position | Asked for on r/obs; no tool does it | S |

## Phase 2 — Reach & integrations (v0.4)

✅ **Done in Oct 2026.**

| # | Feature | Why | Effort |
|---|---|---|---|
| 2.1 | ✅ **YouTube + Kick chat** merged with Twitch, with platform badges and viewer counts. No API key or quota, no dependency: YouTube via the live-chat endpoint the browser popout uses, Kick via its public Pusher websocket (channel lookup through Electron’s network stack, plain Node requests are blocked). | One of the most requested features; Elgato's YouTube login keeps breaking on API quota | M |
| 2.2 | ✅ **Documented local API** (HTTP + Server-Sent Events) and a **Stream Deck plugin** showing live state on the keys (mode, speed, timer); Bitfocus Companion and MIDI | Elgato's plugin is "in testing" with no ETA; QPrompt's most-reacted issue is Companion support | M |
| 2.3 | ✅ **Script import & sync** — .docx with formatting, paste from Word keeping bold/italic, and a watched folder of .md files (edit in Obsidian/VS Code, prompter updates live) | "biggest gripe … copy and pasting from a Word doc"; about 39 threads on import/export/backup | S–M |
| 2.4 | ✅ **Virtual prompter** — always-on-top floating window under the webcam, invisible to screen capture and OBS | Two of the three most-starred OSS prompters are overlay prompters; opens Glanceline to webcam-only users | S–M |
| 2.5 | ✅ **Twitch EventSub (optional login)** — follows, channel points, hype trains, polls, predictions, ad breaks with a countdown on the prompter | Needs OAuth (device-code flow); anonymous chat stays the default | M |
| 2.6 | ✅ **Run-of-show timers** — target time per section with ahead/behind display, show countdown in a corner, reset by hotkey | QPrompt #70; Elgato threads ask for a show countdown | M |
| 2.7 | ✅ **Profiles** — per-script or per-mode settings, quick switching | "settings are universal across modes … no profile functionality" | M |
| 2.8 | ✅ **Hold-to-scroll** for clickers, pedals and hotkeys (scroll while the key is held) | Left over from 1.1. No keyboard hook needed after all: Windows auto-repeats held keys for global shortcuts too, so repeats faster than 100 ms mean “held” | S |

## Phase 3 — Big bets (v0.5+)

| # | Feature | Why | Effort |
|---|---|---|---|
| 3.1 | ✅ **Beta since Oct 2026.** Feasibility spike done: 3 % CPU, about 1 s delay, robust to ad-libs and skipped sentences. Next: real-microphone tuning, smoother look-ahead scrolling, more languages. <br>**Offline voice tracking**, built in four steps: <br>1. Local speech recognition with sherpa-onnx, works on any GPU or CPU, starting with German and English <br>2. Fuzzy matching against the script, ignoring `[cues]` <br>3. Waits during ad-libs <br>4. Dims text that has already been read <br>*Start with a feasibility spike.* | The #1 complaint about the Elgato Prompter (about 80 threads); tools in the browser need Chrome and Google | L |
| 3.2 | **macOS build** (PowerPoint/Keynote via AppleScript) | Repeated requests; the most popular OSS prompter is Mac-only | M–L |
| 3.3 | **Multiple prompter outputs** with different content | Multi-camera and two-host setups | M |
| 3.4 | **Google Slides / Keynote notes** | about 20 threads on presentations | M–L |
| 3.5 | **Prompter standby/off** (detach the display in Windows, no wake-up after sleep) | about 56 threads on power; only command-line hacks exist today | M |

## Not planned

| Feature | Why not |
|---|---|
| Built-in recording | OBS does this better; Elgato decided the same |
| TTS queues, Discord voice overlay, AI script writing | No evidence that anyone wants these on a prompter screen |
