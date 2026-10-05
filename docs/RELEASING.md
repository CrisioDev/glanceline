# Releasing

## One version for everything

`package.json` holds the version. The Stream Deck plugin (`x.y.z.0`) and the Chrome extension (`x.y.z`) follow it automatically; `npm run check` fails if they drift.

## Steps

1. Make sure `main` is green in CI and **Unreleased** in `CHANGELOG.md` describes the release.
2. Bump the version. This updates `package.json`, both manifests and `CHANGELOG.md` (Unreleased → `## [x.y.z] – date`), commits and tags:

   ```bash
   npm version 0.6.0          # or: npm version patch | minor | 1.0.0-beta.1
   git push --follow-tags
   ```

3. The tag starts the **Release** workflow:
   - checks tag = `package.json` = manifests, a CHANGELOG section exists, tests and `npm audit` pass,
   - builds Windows (installer + portable) and macOS (Apple Silicon DMG + ZIP),
   - starts each **built** app in a smoke test,
   - attaches the Stream Deck plugin, the Chrome extension, `SHA256SUMS.txt` and build-provenance attestations,
   - creates a **draft** release with the CHANGELOG section as notes. Versions with a hyphen (`1.0.0-beta.1`) become pre-releases.
4. Download the installer from the draft, try it on a real machine (prompter, hotkeys, chat), then **Publish**.

To build packages without releasing: *Actions → Release → Run workflow*. The packages appear as workflow artifacts.

## Code signing (not set up yet)

Unsigned builds work, but Windows SmartScreen warns (“Windows protected your PC” → *More info* → *Run anyway*) and macOS Gatekeeper blocks the first start (README explains the workaround). Signing removes both.

- **Windows:** [SignPath Foundation](https://signpath.org/) signs open-source projects for free (apply with the repo; they sign in their CI via a GitHub Action). Alternatives: Azure Artifact Signing (paid, eligibility depends on country) or an OV/EV certificate on a hardware token.
- **macOS:** Apple Developer Program (99 USD/year) → *Developer ID Application* certificate. Add the repository secrets `CSC_LINK` (base64 .p12), `CSC_KEY_PASSWORD`, `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`, pass them to the macOS build step, remove `CSC_IDENTITY_AUTO_DISCOVERY: false`, and set `"notarize": true` under `build.mac` in `package.json`. electron-builder then signs and notarizes.

## Store listings (optional)

- **Chrome Web Store:** upload `glanceline-google-slides.zip` from the release (one-time 5 USD developer fee). Until then, users load the extension unpacked from the panel.
- **Elgato Marketplace:** submit `Glanceline.streamDeckPlugin` via the Elgato Maker Console. Until then, the panel installs it with one click.
