# Contributing

Thanks for helping! Bug reports, translations and pull requests are welcome.

## Reporting bugs

Use the [bug report form](https://github.com/CrisioDev/glanceline/issues/new/choose). Please attach the log file – it stays on your computer until you share it:

- Windows: `%APPDATA%\Glanceline\logs\glanceline.log`
- macOS: `~/Library/Application Support/Glanceline/logs/glanceline.log`

Security problems: see [SECURITY.md](SECURITY.md), not the issue tracker.

## Development

Requirements: Node.js 24 and npm. Windows 10/11 or macOS on Apple Silicon.

```bash
npm install
npm start          # app from source
npm run check      # translations, syntax, version numbers
npm test           # unit tests (node --test)
npm run smoke      # starts the app, clicks through panel and prompter, fails on console errors
```

`npm run smoke` opens real windows for about 30 seconds. It uses its own data folder and doesn't touch a running Glanceline.

CI runs the same checks on Windows and macOS for every pull request.

## Pull requests

- One topic per pull request. Describe what changes for users.
- Every UI text goes into [`public/i18n.js`](public/i18n.js) in **all** languages (`npm run check` verifies this).
- Add a line under **Unreleased** in [CHANGELOG.md](CHANGELOG.md) for anything users notice.
- Match the surrounding code: CommonJS, no build step, no framework, few dependencies. New dependencies need a good reason.
- No telemetry, no new network connections without a setting and a note in the README's privacy section.

## Translations

Copy the `en` block in `public/i18n.js`, translate it, add the language to `LANGUAGE_OPTIONS`, and run `npm run check`.
