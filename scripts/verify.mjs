import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';

const manifest = JSON.parse(await readFile('manifest.json', 'utf8'));
const expected = ['activeTab', 'contextMenus', 'scripting', 'storage'];
const actual = [...(manifest.permissions ?? [])].sort();
if (JSON.stringify(actual) !== JSON.stringify(expected.sort())) throw new Error(`Unexpected permissions: ${actual.join(',')}`);
if (manifest.minimum_chrome_version !== '138') throw new Error('minimum_chrome_version must be 138.');
if (!manifest.host_permissions?.length) throw new Error('host_permissions required for auto content script injection.');
if (!manifest.content_scripts?.length) throw new Error('Static content_scripts required for auto-injection on all pages.');
if (!manifest.default_locale) throw new Error('default_locale required for i18n (e.g. "en").');
const locales = await readdir('_locales');
if (!locales.includes('en')) throw new Error('_locales/en/ with messages.json is required.');
const webResources = manifest.web_accessible_resources ?? [];
const resourceList = webResources.flatMap((entry) => entry.resources ?? []);
for (const required of ['src/broker/broker.html', 'src/broker/broker.js']) {
  if (!resourceList.includes(required)) throw new Error(`Manifest missing broker web accessible resource: ${required}`);
}

const contentScript = await readFile('src/content/content-script.js', 'utf8');
if (/^\s*import\s/m.test(contentScript) || /^\s*export\s/m.test(contentScript)) {
  throw new Error('Content script must be a standalone classic script; bundle or remove import/export.');
}
for (const required of ['XLAT_TRANSLATE_PAGE', 'XLAT_TRANSLATE_SELECTION', 'XLAT_CLEAR_TRANSLATIONS', 'collectBlocks', 'appendTranslation', 'showSelectionOverlay', 'ensureBrokerFrame', 'XLAT_BROKER_TRANSLATE']) {
  if (!contentScript.includes(required)) throw new Error(`Content script missing required translation capability: ${required}`);
}

const serviceWorker = await readFile('src/background/service-worker.js', 'utf8');
if (/\bTranslator\b|\bLanguageDetector\b|content-engine|translation-engine/.test(serviceWorker)) {
  throw new Error('Service worker must not import or instantiate AI translation engines.');
}
if (/OPEN_BROKER|BROKER_TRANSLATE|onConnect|chrome\.tabs\.create/.test(serviceWorker)) {
  throw new Error('Service worker must not own broker translation; the MVP broker is an iframe extension document owned by the content script.');
}

async function collect(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...await collect(path));
    else files.push(path);
  }
  return files;
}

const productionFiles = (await collect('src')).filter((path) => /\.(js|html|css)$/.test(path));
const forbidden = [/XMLHttpRequest/, /WebSocket/, /sendNativeMessage/, /translate\.googleapis/i, /deepl/i, /papago/i, /openai/i, /anthropic/i];
for (const file of productionFiles) {
  const text = await readFile(file, 'utf8');
  for (const pattern of forbidden) {
    if (pattern.test(text)) throw new Error(`Forbidden network/native pattern ${pattern} in ${file}`);
  }
  const fetchLines = text.split('\n').filter((l) => /fetch\s*\(/.test(l));
  for (const fl of fetchLines) {
    if (!fl.includes('chrome.runtime.getURL')) throw new Error(`fetch() in ${file} must only load bundled extension resources (use chrome.runtime.getURL).`);
  }
}
const broker = await readFile('src/broker/broker.js', 'utf8');
for (const required of ['Translator.availability', 'Translator.create', 'LanguageDetector.create', 'XLAT_BROKER_RESULT']) {
  if (!broker.includes(required)) throw new Error(`Broker missing required local AI behavior: ${required}`);
}
if (/fetch\s*\(|XMLHttpRequest|WebSocket|sendNativeMessage/.test(broker)) {
  throw new Error('Broker must not use external network or native messaging primitives.');
}

const popup = await readFile('src/popup/popup.html', 'utf8');
const popupJs = await readFile('src/popup/popup.js', 'utf8');
for (const id of ['sourceLanguage', 'targetLanguage', 'translatePage', 'clearTranslations', 'displayMode', 'maxBlocks', 'viewportOnly']) {
  if (!popup.includes(`id="${id}"`)) throw new Error(`Popup missing control: ${id}`);
}
if (/openBroker|OPEN_BROKER/.test(popupJs + popup)) {
  throw new Error('Popup must not expose a separate broker-open flow; broker fallback is automatic.');
}
if (!popupJs.includes('chrome.i18n.getMessage')) {
  throw new Error('Popup JS must use chrome.i18n.getMessage for i18n.');
}
if (!serviceWorker.includes('chrome.i18n.getMessage')) {
  throw new Error('Service worker must use chrome.i18n.getMessage for i18n.');
}
console.log('Static verification passed: manifest permissions, min Chrome, auto-injection, i18n locales, content capabilities, iframe broker fallback, service worker boundary, no remote translation primitives.');
