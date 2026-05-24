# Xlat Local Page Translator

Xlat is a Manifest V3 Chrome extension scaffold for local-only page translation using Chrome built-in `Translator` and `LanguageDetector` APIs.

## Privacy and scope

- Local-only translation path: no cloud translation API, server proxy, BYO key, native messaging, or external translation host.
- Chrome browser-managed model download is the only network-adjacent exception and must not send page or selected text.
- MVP target: Chrome 138+ desktop Chrome.
- Non-goals: mobile, non-Chrome browsers, PDF translation, image OCR.

## Permissions

The MVP manifest uses only:

- `activeTab`
- `scripting`
- `storage`
- `contextMenus`

It intentionally omits broad host permissions and static content scripts.

## Development

```sh
npm run build
npm test
npm run verify
```

Load `dist/` as an unpacked extension in Chrome 138+ desktop.

## Current architecture

- `src/background/service-worker.js`: context menu, script/CSS injection, routing only.
- `src/content/content-script.js`: DOM extraction, append-below rendering, selection overlay, local content-script AI path, broker fallback client.
- `src/broker/broker.html` / `src/broker/broker.js`: extension-document broker fallback for built-in AI calls.
- `src/popup/*`: target language, display mode, advanced limits, commands, AI spike UI.
- `src/options/*`: persisted defaults.

See `.omx/evidence/implementation-status.md` and `.omx/evidence/ai-context-spike.md` for current evidence and remaining manual smoke requirements.
