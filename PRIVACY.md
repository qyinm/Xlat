# Privacy Policy

**Xlat** — a local-only Chrome extension for translating web page text using Chrome's built-in Translator API.

_Last updated: 2026-05-24_

---

## Data Collection

**Xlat does not collect, transmit, or store any personal data.**

All translation processing is performed **entirely on your device** using the Translator API and LanguageDetector API built into the Chrome browser. No text you translate is ever sent to an external server, cloud service, or third party.

## Data Storage

The only data Xlat stores are your **user preferences**, saved locally via `chrome.storage.sync`:

- Target language (e.g., "ko", "en")
- Source language preference ("auto" by default)
- Display mode
- Max blocks per run
- Viewport-only toggle

This data never leaves your browser and is used solely to restore your settings across sessions. It is not accessible to Xlat's developers or any third party.

## Permissions

Xlat requests the following Chrome permissions, each used exclusively for local functionality:

| Permission | Purpose |
|---|---|
| `activeTab` | Read text from the currently active tab when you click "Translate page" or "Translate selection" |
| `scripting` | Inject the local translation engine into the current page |
| `storage` | Save your language and display preferences locally |
| `contextMenus` | Add a right-click "Translate selection" option |

## Network Access

Xlat makes **no network requests**. It has no backend server, no analytics, no telemetry, and no external dependencies. The extension is fully self-contained and operates offline.

## Third-Party Services

Xlat does not integrate any third-party services, SDKs, or APIs beyond the standard Chrome Extension APIs and Chrome's built-in Translator API — both of which run locally on your device.

## Data Retention & Deletion

Since no personal data is collected, there is nothing to retain or delete. User preferences stored in `chrome.storage.sync` can be cleared at any time via Chrome's extension management settings.

## Changes to This Policy

If this policy changes, the "Last updated" date at the top will be revised. Given Xlat's local-only architecture, material changes are unlikely.

## Contact

For questions about this privacy policy, open an issue on the project repository.