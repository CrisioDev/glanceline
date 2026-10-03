# Glanceline local API

Glanceline runs a small web server on your PC. The panel, the phone remote, the OBS dock and the Stream Deck plugin all use the same API, and you can use it too: from Bitfocus Companion, Touch Portal, AutoHotkey, a shell script or your own tools.

- **Base address:** `http://127.0.0.1:4890`. If port 4890 is taken, Glanceline uses the next free port; the panel shows the real address under *Settings → Stream Deck & API*.
- **Format:** JSON in, JSON out. Requests with a body must send `Content-Type: application/json`.

## Access and security

| Where the request comes from | What is needed |
|---|---|
| The same PC (`127.0.0.1`) | Nothing. |
| Another device on your network | Turn on *Settings → Phone & network*, then add the access token as `?t=TOKEN` to every URL. The phone link in the panel already contains it. |

Glanceline blocks requests that a **web page in your browser** tries to send to it, so a random website can't remote-control your prompter. This is checked through the `Origin` and `Host` headers. Tools that are not browsers (curl, Companion, scripts, the Stream Deck plugin) don't send an `Origin` header and are not affected.

*Create new access link* in the panel replaces the token and locks out every device that used the old one.

## Endpoints

| Method & path | Purpose |
|---|---|
| `POST /api/action` | Run an action, e.g. `{"type":"script:toggle"}`. See [Actions](#actions). |
| `GET /api/state` | Everything at once: `settings`, `scripts`, `live` (current state) and the recent chat history. |
| `GET /events?role=api` | Live updates as [Server-Sent Events](#live-updates-server-sent-events). |
| `GET /api/actions?lang=en` | All bindable actions and modes with display names (`en` or `de`). Handy for building menus. |
| `POST /api/settings` | Change settings. Send only the keys you want to change, e.g. `{"script":{"speed":90}}`. Unknown keys are ignored, values are range-checked. |
| `POST /api/scripts` | Manage scripts, see [Scripts](#scripts). |
| `GET /api/streamdeck-plugin` | Download the Stream Deck plugin (`.streamDeckPlugin`). |
| `POST /api/slides` | Report the current slide from an external source: `{ slide, total, notes, presentation }`, or `{ running: false }` at the end. Send it at least every 8 s while presenting. Used by the Google Slides extension – the only endpoint that also accepts requests from browser extensions. |

Every response has `ok: true` on success, or `ok: false` with an `error` message.

## Actions

Send them as `POST /api/action` with a JSON body. `type` is required; some actions take more fields.

### Modes and display

| `type` | Extra fields | What it does |
|---|---|---|
| `mode:chat`, `mode:script`, `mode:obs`, `mode:ppt`, `mode:camera` | | Switch the prompter mode. |
| `blackout` | `value` (optional, `true`/`false`) | Blank the prompter. Toggles when `value` is missing. |
| `passthrough` | | Hide Glanceline on the prompter so other apps can use the screen. Switching modes brings it back. |
| `camera:toggle` | | Camera image behind the text on/off. |
| `mirror:toggle` | | Mirror the prompter image. |
| `font:bigger`, `font:smaller` | `target` (optional: `chat`, `script`, `ppt`) | Change the font size of the current or given mode. |
| `prompter:place` | | Search for the prompter display again. |
| `prompter:power` | `on` (optional, `true`/`false`) | Turn the prompter display off (disconnect it in Windows) or on again. Toggles when `on` is missing. |
| `output:add`, `output:update`, `output:remove` | `id`, `patch` (`name`, `display`, `mode`, `mirror`, `enabled`) | Manage extra outputs. |

### Script

| `type` | Extra fields | What it does |
|---|---|---|
| `script:toggle` | | Start or pause. |
| `script:play`, `script:pause` | | Start or pause explicitly. |
| `script:restart` | | Back to the beginning. |
| `script:reverse` | | Reverse the scroll direction. |
| `script:faster`, `script:slower` | | Change the reading speed by about 12 %. |
| `script:prevSection`, `script:nextSection` | | Jump to the previous / next heading. |
| `script:section` | `index` (0-based) | Jump to a heading by number. |
| `script:seek` | `frac` (0–1) | Jump to a position, e.g. `0.5` = middle. |
| `script:select` | `id` | Put another script on the prompter. |
| `view:back`, `view:forward` | `target` (`script`, `ppt`, `chat`), `amount` (`line` or `page`) | Scroll a bit. In chat mode this rewinds the chat. |
| `script:hold` | `dir` (`1`, `-1` or `0`) | Smooth scrolling while a key is held. Send it every ~150 ms while held and `dir: 0` on release; the prompter stops by itself if the messages stop. |
| `insert:1` … `insert:4` | | Show an insert script (set up in the settings), then return to where you were. |
| `insert:return` | | End the insert early. |
| `voice:toggle` | | Voice tracking on/off. |

### Timers, chat, director and more

| `type` | Extra fields | What it does |
|---|---|---|
| `show:toggle`, `show:reset` | | Start/pause or reset the show timer. |
| `ppt:timerToggle`, `ppt:timerReset` | | Start/pause or reset the PowerPoint talk timer. |
| `director:send` | `text` (max. 200 characters), `seconds` (optional, 3–300) | Flash a message on the prompter. |
| `director:clear` | | Remove the director message. |
| `chat:pause` | | Pause or resume the chat. |
| `chat:clear` | | Clear the chat on the prompter. |
| `chat:demo` | | Show some test messages. |
| `chat:reconnect` | | Reconnect Twitch, YouTube and Kick. |
| `emotes:reload` | | Reload 7TV, BTTV and FFZ emotes. |
| `obs:reconnect` | | Reconnect to OBS. |
| `hotkeys:suspend`, `hotkeys:resume` | | Pause the global hotkeys, e.g. while gaming. |

### Profiles, MIDI, accounts and files

| `type` | Extra fields | What it does |
|---|---|---|
| `profile:1` … `profile:4`, `profile:next` | | Apply a profile by position, or the next one. |
| `profile:apply` | `id` (empty = no profile) | Apply a profile. |
| `profile:save` | `name` | Save the current look as a new profile. Returns `{ ok, id }`. |
| `profile:update` | `id` (optional, default: active) | Overwrite a profile with the current settings. |
| `profile:rename`, `profile:delete` | `id`, `name` | |
| `midi:learn` | `target` (an action type or `script:speed`; empty = cancel) | Assign the next key pressed on a MIDI controller. |
| `midi:unmap` | `key`, e.g. `note:1:60` | Remove a MIDI assignment. |
| `twitch:login`, `twitch:loginCancel`, `twitch:logout` | | Optional Twitch login for EventSub (device code shown in `live.eventsub`). |
| `library:pick`, `library:open`, `library:clear` | | Choose, open or unlink the script folder (desktop app). |
| `streamdeck:install` | | Install or update the Stream Deck plugin (desktop app). |

## Live updates (Server-Sent Events)

`GET /events?role=api` keeps the connection open and sends named events:

| Event | Data |
|---|---|
| `init` | Once after connecting: the same object as `GET /api/state`. |
| `live` | The full `live` state whenever something changes (mode, script position, OBS status, timers …). Up to ~25 times per second while a script is running. |
| `settings` | The full settings after a change. |
| `scripts` | The script list after a change. |

Useful fields in `live`:

| Field | Meaning |
|---|---|
| `mode` | `chat`, `script`, `obs`, `ppt` or `camera`. |
| `blackout`, `passthrough` | `true` while active. |
| `script.playing`, `script.pos`, `script.max` | Script state; progress = `pos / max`. |
| `show.running`, `show.startedAt`, `show.acc` | Show timer. Elapsed ms = `acc + (running ? now - startedAt : 0)`; the countdown length is `settings.timers.minutes`. |
| `section` | Current script section for the run of show: `index`, `title`, `at` (show time when it started). |
| `obs.streaming`, `obs.recording`, `obs.scene` | OBS status. |
| `twitch.viewers`, `youtube.viewers`, `kick.viewers` | Viewer counts (`null` when offline). `youtube.state` and `kick.state` tell whether the stream is live. |
| `director` | Director message on the prompter: `text`, `until`; `countdown: true` for ad breaks. |
| `eventsub` | Twitch login: `state` (`off`, `pending`, `connecting`, `connected`, `error`), `login`, `userCode` while pending. |
| `midi` | Connected MIDI `devices`, `learn` while learning, `last` key received. |
| `ppt.slide`, `ppt.total` | Current slide in a running PowerPoint show. |
| `now` | Server time in ms – use `now - Date.now()` as clock offset for running timers. |

Use `role=api` for integrations: these clients don't receive the chat stream and don't count as an open panel.

## Scripts

`POST /api/scripts` with an `op`:

| `op` | Fields | Result |
|---|---|---|
| `create` | `title`, `body` | `{ ok, id, item }` |
| `save` | `id`, `title` and/or `body` | Scripts from a linked folder can't be changed here – edit the file instead. |
| `activate` | `id` | Puts the script on the prompter. |
| `delete` | `id` | |

Script syntax: `# Heading` (also `##`, `###`), `**bold**`, `*italic*`, `==highlight==`, `[stage direction]`, and a target time at the end of a heading for the run of show, e.g. `## Intro {2:00}`.

## Examples

**curl**

```bash
curl -X POST http://127.0.0.1:4890/api/action -H "Content-Type: application/json" -d '{"type":"mode:script"}'
curl -X POST http://127.0.0.1:4890/api/action -H "Content-Type: application/json" -d '{"type":"director:send","text":"2 minutes left"}'
```

**PowerShell**

```powershell
Invoke-RestMethod -Method Post -Uri http://127.0.0.1:4890/api/action -ContentType 'application/json' -Body '{"type":"script:toggle"}'
```

**Bitfocus Companion** – module *Generic HTTP Requests*, action *POST*:

- URL: `http://127.0.0.1:4890/api/action` (from another PC: the phone link's address plus `/api/action?t=TOKEN`)
- Body: `{"type":"blackout"}`
- Content type: `application/json`

**AutoHotkey v2**

```ahk
F13:: {
    req := ComObject("WinHttp.WinHttpRequest.5.1")
    req.Open("POST", "http://127.0.0.1:4890/api/action")
    req.SetRequestHeader("Content-Type", "application/json")
    req.Send('{"type":"script:toggle"}')
}
```

**JavaScript (Node 18+)** – follow the live state:

```js
const res = await fetch('http://127.0.0.1:4890/events?role=api');
const decoder = new TextDecoder();
let buf = '';
for await (const chunk of res.body) {
  buf += decoder.decode(chunk, { stream: true });
  let i;
  while ((i = buf.indexOf('\n\n')) >= 0) {
    const block = buf.slice(0, i);
    buf = buf.slice(i + 2);
    const event = /^event: (.*)$/m.exec(block)?.[1];
    const data = /^data: (.*)$/m.exec(block)?.[1];
    if (event === 'live') console.log(JSON.parse(data).mode);
  }
}
```

## Stream Deck

The Stream Deck plugin lives in [`integrations/streamdeck`](../integrations/streamdeck). It uses only this API. Install it from the panel (*Settings → Stream Deck & API → Install plugin*), or double-click the downloaded `.streamDeckPlugin` file.
