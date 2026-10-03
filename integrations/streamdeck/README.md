# Glanceline for Stream Deck

Control the Glanceline teleprompter from an Elgato Stream Deck, with live state on the keys.

| Action | Key shows | Press |
|---|---|---|
| **Prompter mode** | the mode, lit while active | switch to chat, script, OBS, PowerPoint or camera |
| **Script start / pause** | play/pause, progress and speed | start or pause |
| **Scroll (hold)** | direction | tap = one line, hold = smooth scrolling |
| **Show timer** | running time or countdown, orange near the end, red when over | start/pause; hold for one second to reset |
| **Blackout** | lit while the prompter is dark | toggle |
| **Glanceline action** | the action's name, lit while active (pass-through, voice tracking, inserts …) | any Glanceline action |
| **Script speed** (Stream Deck +) | speed on the touch strip | turn = speed, push = start/pause |

## Install

- In Glanceline: *Settings → Stream Deck & API → Install plugin*. The Stream Deck app asks for confirmation.
- Or double-click `Glanceline.streamDeckPlugin` (download it in the same place, or build it with `npm run pack:streamdeck`).

Glanceline on **another PC**: open the property inspector of any Glanceline key and paste that PC's phone link (with `?t=…`) as the address.

## How it works

- `bin/plugin.js` runs in the Node.js 20 that ships with the Stream Deck software and has no dependencies: a small built-in WebSocket client talks to the Stream Deck app, and `fetch` talks to Glanceline's [local API](../../docs/API.md).
- Key images are SVGs drawn from the live state; they are only sent when something changes.
- `npm run icons:streamdeck` renders the PNG icons from the same SVG symbols.

Requires Stream Deck 6.6 or later.
