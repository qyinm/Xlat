# Xlat Local Page Translator

Xlat is a Manifest V3 Chrome extension scaffold for local-only page translation using Chrome built-in `Translator` and `LanguageDetector` APIs.

## Privacy and scope

- Local-only translation path: no cloud translation API, server proxy, BYO key, native messaging, or external translation host.
- Chrome browser-managed model download is the only network-adjacent exception — it must not send page or selected text.
- Broad host permission (`<all_urls>`) is declared for content script auto-injection but translation only fires on explicit user action (click translate button or press keyboard shortcut).
- MVP target: Chrome 138+ desktop Chrome.
- Non-goals: mobile, non-Chrome browsers, PDF translation, image OCR.

## Permissions

The manifest uses:

- `activeTab`
- `scripting`
- `storage`
- `contextMenus`
- `host_permissions: ["<all_urls>"]` — required for auto-injecting the content script into any page the user may translate
- `content_scripts` — static injection on all pages so the content script is ready before the user clicks translate

## Development

```sh
npm run build
npm test
npm run verify
```

Load `dist/` as an unpacked extension in Chrome 138+ desktop.

## Current architecture

- `src/background/service-worker.js`: context menu, keyboard shortcut routing.
- `src/content/content-script.js`: DOM extraction (block grouping), append-below or replace-text rendering, selection overlay, local content-script AI path, broker fallback client.
- `src/broker/broker.html` / `src/broker/broker.js`: extension-document broker fallback for built-in AI calls when the content script lacks user activation.
- `src/popup/*`: source/target language selectors, translate/clear commands, display mode, UI language selector, AI context spike.
- `src/options/*`: persisted defaults (target language, viewport-only, UI language).
- `_locales/*`: 28 locale files (en, ko, ja, zh-Hans, es, fr, de, it, pt, ru, ar, hi, bn, vi, th, id, ms, tr, nl, pl, sv, da, no, fi, cs, hu, ro, uk).
