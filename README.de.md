# Glanceline

**Ein Teleprompter-Begleiter für Streamer und Vortragende.** Gebaut für den Elgato Prompter, funktioniert mit jedem Teleprompter-Display.

Glanceline zeigt auf deinem Prompter, was du vor der Kamera brauchst:

- deinen **Twitch-Chat**, auch mit 7TV-, BTTV- und FFZ-Emotes,
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
| **Chat** | Twitch-Chat, anonym gelesen (kein Login): <br>• Emotes von Twitch, **7TV**, BTTV und FFZ, inklusive Zero-Width-Emotes <br>• **7TV live**: neue oder entfernte Emotes erscheinen sofort <br>• Subs, Gift-Subs, Raids, Bits und @Erwähnungen hervorgehoben <br>• Filter für Bots und !Befehle |
| **Skript** | Teleprompter, der **deiner Stimme folgen** kann – offline, ohne Grafikkarte, Deutsch/Englisch/Französisch/Spanisch. Er wartet, wenn du abschweifst, und holt auf, wenn du etwas überspringst. Außerdem: <br>• Lesezeile und Countdown <br>• Tempo-Regelung <br>• Markdown-Abschnitten, zu denen du per Hotkey springst <br>• Regie-Schildern wie `[Pause]` |
| **OBS** | LIVE-/REC-Zeiten, Szene, FPS, CPU, Bitrate und Drops (über obs-websocket) |
| **PowerPoint** | Notizen der **aktuellen Folie**, automatisch synchron, auch mit Presenter-Clicker. Die Schrift passt sich an, dazu Titel der nächsten Folie und Vortragstimer. Schaltet sich beim Start der Präsentation selbst ein. |
| **Kamera** | Dein Kamerabild als Kontrollmonitor |

Außerdem:

- **Kamerabild hinter dem Text.** Der Text bleibt lesbar, Abdunkelung und Hinterlegung sind einstellbar. Quelle ist eine Webcam oder eine beliebige OBS-Quelle.
- **Statusleiste in jedem Modus** mit LIVE-/REC-Anzeige und Uhr. Raids und Subs werden auch eingeblendet, während du ein Skript liest.
- **Steuerung von überall:** Panel mit Live-Vorschau, Handy (QR-Code scannen, zum Startbildschirm hinzufügen), OBS-Dock oder **globale Hotkeys** (Stream Deck: Aktion „Hotkey“).
- **Prompter-Erkennung** über Name oder Auflösung. Windows-Skalierung wird berücksichtigt, Spiegelung ist optional.
- **Deutsch & Englisch**, Tray-Symbol und Autostart mit Windows. Bis auf Chat und Emotes läuft alles offline. **Keine Telemetrie.**

## Voraussetzungen

- **Windows 10/11.** PowerPoint läuft über Windows-COM, macOS ist geplant.
- Optional: OBS Studio 28+ (obs-websocket ist eingebaut) und Microsoft PowerPoint.

## Installation

Installer oder portable `.exe` von der [Releases](../../releases)-Seite laden und starten.

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

Strg+Alt+Buchstabe ist bewusst ausgespart, weil das auf deutschen Tastaturen AltGr ist (@, €, {, [ …).

### Tipps

- **Kamera belegt?** OBS hält Webcams meist exklusiv. Dann als Quelle „OBS-Quelle“ wählen (bis 15 fps).
- **PowerPoint:** Unter *Bildschirmpräsentation → Monitor* den Beamer oder Hauptmonitor wählen, nicht den Prompter.
- **Text im Glas seitenverkehrt?** *Einstellungen → Prompter-Anzeige → Bild horizontal spiegeln.*

## Daten & Datenschutz

- Einstellungen und Skripte liegen in `%APPDATA%\Glanceline`.
- Die Sprachsteuerung läuft komplett auf deinem PC, kein Ton verlässt den Rechner. Das Sprachmodell (~70 MB, Kroko ASR von Banafo, CC BY-SA 4.0) wird beim ersten Gebrauch von Hugging Face geladen.
- Verbindungen gehen nur zu:
  - Twitch-Chat (anonym, nur lesend),
  - den öffentlichen Emote-APIs von 7TV, BTTV und FFZ sowie zur 7TV-EventAPI,
  - deinem lokalen OBS.
- Es gibt keine Telemetrie und kein Konto. Die Schriften sind mitgeliefert.

## Lizenz

Siehe [LICENSE](LICENSE). Die mitgelieferten Schriften stehen unter der SIL Open Font License 1.1, siehe [`public/fonts/LICENSES`](public/fonts/LICENSES).
