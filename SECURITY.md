# Security policy

## Supported versions

Only the latest release gets security fixes. Please update before reporting.

## Reporting a vulnerability

Please **do not open a public issue** for security problems. Report them privately via GitHub: [Security → Report a vulnerability](https://github.com/CrisioDev/glanceline/security/advisories/new).

Include the Glanceline version, your OS and steps to reproduce. Once a fix is released, the advisory is published and you are credited, unless you prefer otherwise.

## Scope

Glanceline runs a local web server for its panel, the prompter view, the phone remote and the local API. Of particular interest:

- Access to the local server from other websites in your browser (CSRF, DNS rebinding) or from other devices without the access token.
- Code or markup injection through chat messages, emote names, script files, slide notes or OBS data.
- Anything that lets a remote party read files, start programs or change settings.

Out of scope: attacks that need prior access to your user account or data folder, and the third-party services Glanceline connects to (Twitch, YouTube, Kick, 7TV, BTTV, FFZ, OBS).

## Verifying downloads

Every release lists SHA-256 checksums in `SHA256SUMS.txt`, and every file carries a build-provenance attestation from GitHub Actions. With the [GitHub CLI](https://cli.github.com/):

```bash
gh attestation verify Glanceline-Setup-<version>.exe --repo CrisioDev/glanceline
```
