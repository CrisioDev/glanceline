# Glanceline

**Ein Teleprompter-Begleiter für Streamer und Vortragende.** Gebaut für den Elgato Prompter, funktioniert mit jedem Teleprompter-Display.

Glanceline zeigt auf deinem Prompter, was du vor der Kamera brauchst:

- deinen **Twitch-, YouTube- und Kick-Chat** in einer Liste, auch mit 7TV-, BTTV- und FFZ-Emotes,
- ein **Scroll-Skript**,
- deinen **OBS-Stream-Status**,
- oder die **PowerPoint-Notizen** der aktuellen Folie.

Umschalten geht per Klick oder globalem Hotkey. Auf Wunsch liegt dein eigenes Kamerabild hinter dem Text.

> 🇬🇧 [English README](README.md)
>
> Glanceline ist ein unabhängiges, inoffizielles Projekt und steht in keiner Verbindung zu Elgato oder Corsair. „Elgato“ und „Prompter“ sind Marken der jeweiligen Inhaber.

## Funktionen

| Modus | Was auf dem Prompter erscheint |
|---|---|
| **Chat** | **Twitch, YouTube und Kick** in einem Chat, anonym gelesen (kein Login, kein API-Key), mit Plattform-Symbolen und Zuschauerzahlen: <br>• YouTube-Super-Chats, Mitgliedschaften und Geschenke; Kick-Abos, Geschenke, Hosts und Kicks <br>• Optionaler Twitch-Login für Follows, alle Kanalpunkte-Einlösungen, Hype Trains, Umfragen, Vorhersagen und Werbepausen (mit Countdown auf dem Prompter) <br>• Emotes von Twitch, **7TV**, BTTV und FFZ, inklusive Zero-Width-Emotes <br>• **7TV live**: neue oder entfernte Emotes erscheinen sofort <br>• Subs, Gift-Subs, Raids, Bits und @Erwähnungen hervorgehoben <br>• Kanalpunkte-Nachrichten, Erst- und Wiederkehrer, Shared Chat markiert <br>• Chat per Hotkey **pausieren und zurückspulen** <br>• Filter für Bots und !Befehle |
| **Skript** | Teleprompter, der **deiner Stimme folgen** kann – offline, ohne Grafikkarte, Deutsch/Englisch/Französisch/Spanisch und mit einem optionalen größeren Modell 26 weitere Sprachen. Er gleitet flüssig mit, statt zeilenweise zu springen. Er wartet, wenn du abschweifst, und holt auf, wenn du etwas überspringst. Außerdem: <br>• Lesezeile und Countdown <br>• Tempo-Regelung <br>• Markdown-Abschnitten, zu denen du per Hotkey springst <br>• Regie-Schildern wie `[Pause]` <br>• **Clicker & Fußpedal** (Bild↑/Bild↓ oder beliebige Tasten) <br>• **Einschübe**: ein Hotkey schiebt ein kurzes Skript dazwischen (Raid-Dank, Werbung) und springt danach an die alte Stelle zurück <br>• Rechts-nach-links-Schrift und Rückwärtslauf <br>• **Run of Show**: Zielzeiten je Abschnitt (`## Intro {2:00}`), Vorsprung/Rückstand und Show-Countdown <br>• **Import** von Word (.docx), Markdown und Text, Einfügen aus Word oder Google Docs mit Formatierung, oder ein **verknüpfter Ordner**, der beim Bearbeiten in Obsidian, VS Code oder Word live synchron bleibt |
| **OBS** | LIVE-/REC-Zeiten, Szene, FPS, CPU, Bitrate und Drops (über obs-websocket) |
| **Folien** | Notizen der **aktuellen Folie** aus **PowerPoint**, **Google Slides** (kleine Chrome-Erweiterung) oder **Keynote** (Mac), automatisch synchron, auch mit Presenter-Clicker. Die Schrift passt sich an, dazu Titel der nächsten Folie und Vortragstimer. Schaltet sich beim Start der Präsentation selbst ein. |
| **Kamera** | Dein Kamerabild als Kontrollmonitor |

Außerdem:

- **Kamerabild hinter dem Text.** Der Text bleibt lesbar, Abdunkelung und Hinterlegung sind einstellbar. Quelle ist eine Webcam oder eine beliebige OBS-Quelle.
- **Statusleiste in jedem Modus** mit LIVE-/REC-Anzeige und Uhr. Raids und Subs werden auch eingeblendet, während du ein Skript liest.
- **Steuerung von überall:** Panel mit Live-Vorschau, Handy (QR-Code scannen, zum Startbildschirm hinzufügen), OBS-Dock, **globale Hotkeys**, MIDI-Controller oder das **Stream-Deck-Plugin** mit Live-Zustand auf den Tasten (Installation per Klick im Panel).
- **Halten zum Scrollen:** Clicker, Pedal, Hotkey, Stream-Deck-Taste oder MIDI-Pad halten, und das Skript läuft flüssig weiter.
- **Virtueller Prompter:** Keine Prompter-Hardware? Ein schwebendes Fenster unter deiner Webcam, das OBS, Zoom und Bildschirmfreigaben nicht sehen.
- **Weitere Ausgaben:** ein zweiter Prompter, ein Monitor für Co-Host oder Kamerateam – jede Ausgabe zeigt den Hauptmodus oder einen festen Modus (z. B. den Chat, während du das Skript liest).
- **Prompter aus:** Das Prompter-Display per Klick oder Hotkey abmelden, damit es dunkel bleibt, auch nach dem Ruhezustand des PCs – oder ihn nur anlassen, solange Glanceline läuft (Windows).
- **Profile:** das Aussehen (Schriften, Größen, Tempo, Kamera, Timer) als „Stream“, „Vortrag“ oder „Aufnahme“ speichern und per Klick, Hotkey oder automatisch je Modus oder Skript wechseln.
- **Lokale API** für Companion, Touch Portal und eigene Skripte – siehe [docs/API.md](docs/API.md).
- **Blickkontakt-Hilfen:** Linsen-Fadenkreuz, schmale Textspalte, zentrierter Text. Jede installierte Schrift, OpenDyslexic, Hochkontrast und Software-Dimmer gegen Spiegelungen.
- **OBS-Automatik:** Ein Szenenwechsel in OBS schaltet den Prompter-Modus um (z. B. *Just Chatting* → Chat). Optional startet die Aufnahme mit dem Skript, mit Kapitelmarken pro Abschnitt und Folie.
- **Regie-Nachrichten:** Eine kurze Notiz vom Panel oder Handy („Noch 2 Minuten“) erscheint auf dem Prompter.
- **Durchreichen:** Glanceline auf dem Prompter ausblenden, um dort andere Programme zu nutzen (Zoom, Browser).
- **Prompter-Erkennung** über Name oder Auflösung. Windows-Skalierung wird berücksichtigt, Spiegelung ist optional.
- **Deutsch & Englisch**, Tray-Symbol und Autostart mit Windows. Bis auf Chat und Emotes läuft alles offline. **Keine Telemetrie.**

## Voraussetzungen

- **Windows 10/11** oder **macOS 12+** auf Apple Silicon. Unter Windows läuft PowerPoint über COM, auf dem Mac werden Keynote und PowerPoint per AppleScript gelesen (macOS fragt einmal nach der Erlaubnis).
- Optional: OBS Studio 28+ (obs-websocket ist eingebaut), Microsoft PowerPoint, Keynote oder Chrome für Google Slides.

## Installation

Installer oder portable `.exe` (Windows) bzw. `.dmg` (Mac) von der [Releases](../../releases)-Seite laden und starten.

Die Builds sind noch nicht code-signiert, deshalb braucht der erste Start einen Klick mehr:

- **Windows:** „Der Computer wurde durch Windows geschützt“ → *Weitere Informationen* → *Trotzdem ausführen*.
- **macOS 15 oder neuer:** Glanceline einmal öffnen, dann *Systemeinstellungen → Datenschutz & Sicherheit* → *Dennoch öffnen*. Unter macOS 12–14: Rechtsklick auf die App → *Öffnen*.

Jedes Release enthält SHA-256-Prüfsummen und Herkunftsnachweise (Build-Provenance), siehe [SECURITY.md](SECURITY.md#verifying-downloads).

Aus dem Quellcode: `npm install`, dann `npm start`.

## Schnellstart

1. Prompter anschließen und Glanceline starten. Die Anzeige legt sich randlos auf den Prompter. Ohne Prompter öffnet sich ein Testfenster.
2. Der Willkommens-Dialog fragt nach Sprache und, optional, Twitch-Kanal. Er prüft auch, ob Prompter und OBS erkannt wurden.
3. Im Panel einen Modus wählen oder einen Hotkey drücken. Wenn du das Panel schließt, läuft Glanceline im Infobereich weiter.

**Standard-Hotkeys:**

| Kürzel | Aktion |
|---|---|
| Strg+Alt+F1–F5 | Modi |
| Strg+Alt+F6 | Blackout |
| Strg+Alt+F7 | Kamerabild an/aus |
| Strg+Alt+F8 | PowerPoint-Timer zurücksetzen |
| Strg+Alt+Num 5 | Skript Start/Pause |
| Strg+Alt+Num 8 / 2 | zurück-/vorscrollen |
| Strg+Alt+Num 4 / 6 | Tempo |
| Strg+Alt+Num 7 / 9 | Abschnitte |
| Strg+Alt+Num 1 | Skript an den Anfang |
| Strg+Alt+Num + / − | Schriftgröße |
| Strg+Alt+Num 3 | Sprachsteuerung an/aus |
| Strg+Alt+F9 | Durchreichen an/aus |
| Strg+Alt+F10 | Chat pausieren/fortsetzen |
| Strg+Alt+F11 / F12 | Einschub 1 / 2 |
| Strg+Alt+Num 0 | Show-Timer Start/Pause |

Clicker-Tasten (Bild↓ / Bild↑ / B) sind anfangs aus und werden unter *Einstellungen → Clicker & Fußpedal* eingeschaltet. Sie gelten nur im Skript-Modus, PowerPoint behält also seine Tasten.

Strg+Alt+Buchstabe ist bewusst ausgespart, weil das auf deutschen Tastaturen AltGr ist (@, €, {, [ …).

### Tipps

- **Kamera belegt?** OBS hält Webcams meist exklusiv. Dann als Quelle „OBS-Quelle“ wählen (bis 15 fps).
- **PowerPoint:** Unter *Bildschirmpräsentation → Monitor* den Beamer oder Hauptmonitor wählen, nicht den Prompter.
- **Text im Glas seitenverkehrt?** *Einstellungen → Prompter-Anzeige → Bild horizontal spiegeln.*

## Daten & Datenschutz

- Einstellungen und Skripte liegen in `%APPDATA%\Glanceline` (macOS: `~/Library/Application Support/Glanceline`).
- Für Fehlerberichte gibt es eine Protokolldatei im Unterordner `logs` (*Einstellungen → Über Glanceline → Protokoll-Ordner öffnen*). Sie verlässt den Rechner nie, außer du hängst sie selbst an.
- Die Sprachsteuerung läuft komplett auf deinem PC, kein Ton verlässt den Rechner. Das Sprachmodell (~70 MB, Kroko ASR von Banafo, CC BY-SA 4.0) wird beim ersten Gebrauch von Hugging Face geladen.
- Verbindungen gehen nur zu:
  - den eingerichteten Chats: Twitch (anonym, nur lesend), YouTube (öffentlicher Livechat-Endpunkt, kein API-Key) und Kick (öffentlicher Chat-Websocket),
  - den öffentlichen Emote-APIs von 7TV, BTTV und FFZ sowie zur 7TV-EventAPI,
  - Twitch-Login und EventSub, nur wenn du dein Twitch-Konto verbindest (nur lesend; die Anmeldung liegt getrennt von den Einstellungen in `twitch-auth.json`),
  - deinem lokalen OBS,
  - GitHub, einmal am Tag, um nach einer neuen Version zu sehen (abschaltbar unter *Einstellungen → Start → Nach Updates suchen*).
- Es gibt keine Telemetrie und keine Cloud. Ein Twitch-Login ist optional. Die Schriften sind mitgeliefert.

## Lizenz

Siehe [LICENSE](LICENSE). Die mitgelieferten Schriften stehen unter der SIL Open Font License 1.1, siehe [`public/fonts/LICENSES`](public/fonts/LICENSES).
