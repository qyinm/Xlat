import { MessageType } from '../shared/messages.js';
import { loadSettings, saveSettings } from '../shared/settings.js';

let customMessages = null;

async function loadMessages(locale) {
  if (!locale) { customMessages = null; return; }
  try {
    const res = await fetch(chrome.runtime.getURL(`_locales/${locale}/messages.json`));
    const data = await res.json();
    customMessages = {};
    for (const [key, val] of Object.entries(data)) {
      customMessages[key] = val.message;
    }
  } catch (_) { customMessages = null; }
}

function t(key, ...args) {
  if (customMessages && customMessages[key] !== undefined) {
    let msg = customMessages[key];
    if (args.length) { args.forEach((arg, i) => { msg = msg.replace(`$${i + 1}`, arg); }); }
    return msg;
  }
  return chrome.i18n.getMessage(key, args) || key;
}

function localizeHtml() {
  document.querySelectorAll('[data-i18n]').forEach((el) => {
    const key = el.getAttribute('data-i18n');
    const msg = t(key);
    if (el.tagName === 'LABEL' || el.tagName === 'SUMMARY') {
      const textNode = Array.from(el.childNodes).find((n) => n.nodeType === 3 && n.textContent.trim());
      if (textNode) textNode.textContent = ` ${msg} `;
    } else {
      el.textContent = msg;
    }
  });
}

let uiLanguageOverride = '';

function uiLang() {
  return uiLanguageOverride || chrome.i18n.getUILanguage();
}

function languageLabel(code) {
  if (code === 'auto') return t('langAuto');
  if (code === 'tl') return t('langTl');
  try {
    const name = new Intl.DisplayNames([uiLang()], { type: 'language', languageDisplay: 'standard' }).of(code);
    return name || code;
  } catch (_) {
    return code;
  }
}

const LANGUAGE_CODES = [
  'auto', 'en', 'ko', 'ja', 'zh-Hans', 'zh-Hant',
  'es', 'fr', 'de', 'it', 'pt', 'ru', 'ar',
  'vi', 'th', 'id', 'ms', 'tl', 'hi', 'bn',
  'ne', 'mn', 'km', 'my', 'lo',
  'nl', 'pl', 'tr', 'sv', 'da', 'no', 'fi', 'cs', 'hu', 'ro', 'uk',
];

const statusEl = document.querySelector('#status');
const statusBar = document.querySelector('.status-bar');
const sourceLanguageEl = document.querySelector('#sourceLanguage');
const targetLanguageEl = document.querySelector('#targetLanguage');
const translatePageButton = document.querySelector('#translatePage');
const clearTranslationsButton = document.querySelector('#clearTranslations');
const displayModeEl = document.querySelector('#displayMode');
const viewportOnlyEl = document.querySelector('#viewportOnly');
const uiLanguageEl = document.querySelector('#uiLanguage');
const advancedDetails = document.querySelectorAll('.advanced');

function populateSelect(el) {
  el.innerHTML = LANGUAGE_CODES.map(code =>
    `<option value="${code}">${languageLabel(code)}</option>`
  ).join('');
}

function setStatus(text, state = 'ready') {
  statusEl.textContent = text;
  statusBar.dataset.state = state;
}

function setBusy(isBusy) {
  for (const btn of [translatePageButton, clearTranslationsButton]) {
    btn.disabled = isBusy;
  }
}

async function runCommand({ busyText, failureText, success, task }) {
  setBusy(true);
  setStatus(busyText, 'busy');
  try {
    const result = await task();
    success(result);
  } catch (error) {
    setStatus(failureText, 'error');
  } finally {
    setBusy(false);
  }
}

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) throw new Error(t('noActiveTab'));
  return tab;
}

async function ensureContentScript(tabId) {
  const response = await chrome.runtime.sendMessage({ type: 'XLAT_ENSURE_CONTENT_SCRIPT', tabId });
  if (!response?.ok) throw new Error(t('contentScriptNotReady'));
}

async function currentCommandOptions() {
  const sourceLanguage = sourceLanguageEl.value;
  const targetLanguage = targetLanguageEl.value.trim() || 'ko';
  const displayMode = displayModeEl.value || 'append-below-original';
  const viewportOnly = Boolean(viewportOnlyEl.checked);
  await saveSettings({ sourceLanguage, targetLanguage, displayMode, viewportOnly });
  return { sourceLanguage, targetLanguage, displayMode, viewportOnly };
}

async function sendToActiveTab(message) {
  const tab = await getActiveTab();
  await ensureContentScript(tab.id);
  return chrome.tabs.sendMessage(tab.id, message);
}

async function init() {
  const settings = await loadSettings();

  uiLanguageOverride = settings.uiLanguage || '';
  await loadMessages(settings.uiLanguage);

  populateSelect(sourceLanguageEl);
  populateSelect(targetLanguageEl);
  targetLanguageEl.querySelector('[value="auto"]')?.remove();

  sourceLanguageEl.value = settings.sourceLanguage || 'auto';
  targetLanguageEl.value = settings.targetLanguage;
  displayModeEl.value = settings.displayMode;
  viewportOnlyEl.checked = settings.viewportOnly;
  uiLanguageEl.value = settings.uiLanguage || '';

  localizeHtml();

  sourceLanguageEl.addEventListener('change', () => saveSettings({ sourceLanguage: sourceLanguageEl.value }));
  targetLanguageEl.addEventListener('change', () => saveSettings({ targetLanguage: targetLanguageEl.value.trim() || 'ko' }));
  displayModeEl.addEventListener('change', () => saveSettings({ displayMode: displayModeEl.value }));
  viewportOnlyEl.addEventListener('change', () => saveSettings({ viewportOnly: Boolean(viewportOnlyEl.checked) }));
  uiLanguageEl.addEventListener('change', async () => {
    await saveSettings({ uiLanguage: uiLanguageEl.value });
    uiLanguageOverride = uiLanguageEl.value;
    await loadMessages(uiLanguageEl.value);
    const sv = sourceLanguageEl.value;
    const tv = targetLanguageEl.value;
    populateSelect(sourceLanguageEl);
    populateSelect(targetLanguageEl);
    targetLanguageEl.querySelector('[value="auto"]')?.remove();
    sourceLanguageEl.value = sv;
    targetLanguageEl.value = tv;
    localizeHtml();
  });
}

// --- event handlers ---

translatePageButton.addEventListener('click', () => runCommand({
  busyText: t('translatingPage'),
  failureText: t('pageTranslationFailed'),
  task: async () => {
    const response = await sendToActiveTab({ type: MessageType.TRANSLATE_PAGE, ...(await currentCommandOptions()) });
    if (!response?.ok) throw new Error(response?.error || t('pageTranslationFailed'));
    return response.summary;
  },
  success(summary) {
    setStatus(t('translatedBlocks', String(summary.completed), String(summary.total)), 'ready');
  }
}));

clearTranslationsButton.addEventListener('click', () => runCommand({
  busyText: t('clearingTranslations'),
  failureText: t('clearFailed'),
  task: async () => {
    const response = await sendToActiveTab({ type: MessageType.CLEAR_TRANSLATIONS });
    if (!response?.ok) throw new Error(response?.error || t('clearFailed'));
    return response;
  },
  success(response) {
    setStatus(t('removedNodes', String(response.removed)), 'ready');
  }
}));

init().catch((error) => setStatus(String(error?.message ?? error)));