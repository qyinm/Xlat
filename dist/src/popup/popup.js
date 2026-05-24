import { MessageType } from '../shared/messages.js';
import { loadSettings, saveSettings } from '../shared/settings.js';

const LANGUAGES = [
  { code: 'auto', label: 'Auto detect' },
  { code: 'en', label: 'English' },
  { code: 'ko', label: 'Korean' },
  { code: 'ja', label: 'Japanese' },
  { code: 'zh-Hans', label: 'Chinese (Simplified)' },
  { code: 'zh-Hant', label: 'Chinese (Traditional)' },
  { code: 'es', label: 'Spanish' },
  { code: 'fr', label: 'French' },
  { code: 'de', label: 'German' },
  { code: 'it', label: 'Italian' },
  { code: 'pt', label: 'Portuguese' },
  { code: 'ru', label: 'Russian' },
  { code: 'ar', label: 'Arabic' },
  { code: 'vi', label: 'Vietnamese' },
  { code: 'th', label: 'Thai' },
  { code: 'id', label: 'Indonesian' },
  { code: 'ms', label: 'Malay' },
  { code: 'tl', label: 'Filipino' },
  { code: 'hi', label: 'Hindi' },
  { code: 'bn', label: 'Bengali' },
  { code: 'ne', label: 'Nepali' },
  { code: 'mn', label: 'Mongolian' },
  { code: 'km', label: 'Khmer' },
  { code: 'my', label: 'Burmese' },
  { code: 'lo', label: 'Lao' },
  { code: 'nl', label: 'Dutch' },
  { code: 'pl', label: 'Polish' },
  { code: 'tr', label: 'Turkish' },
  { code: 'sv', label: 'Swedish' },
  { code: 'da', label: 'Danish' },
  { code: 'no', label: 'Norwegian' },
  { code: 'fi', label: 'Finnish' },
  { code: 'cs', label: 'Czech' },
  { code: 'hu', label: 'Hungarian' },
  { code: 'ro', label: 'Romanian' },
  { code: 'uk', label: 'Ukrainian' },
];

const statusEl = document.querySelector('#status');
const statusBar = document.querySelector('.status-bar');
const outputEl = document.querySelector('#output');
const sourceLanguageEl = document.querySelector('#sourceLanguage');
const targetLanguageEl = document.querySelector('#targetLanguage');
const translatePageButton = document.querySelector('#translatePage');
const translateSelectionButton = document.querySelector('#translateSelection');
const clearTranslationsButton = document.querySelector('#clearTranslations');
const displayModeEl = document.querySelector('#displayMode');
const maxBlocksEl = document.querySelector('#maxBlocks');
const viewportOnlyEl = document.querySelector('#viewportOnly');
const advancedDetails = document.querySelectorAll('.advanced');

function populateSelect(el, languages) {
  el.innerHTML = languages.map(l =>
    `<option value="${l.code}">${l.label}</option>`
  ).join('');
}

function setStatus(text, state = 'ready') {
  statusEl.textContent = text;
  statusBar.dataset.state = state;
}

function setBusy(isBusy) {
  for (const btn of [translatePageButton, translateSelectionButton, clearTranslationsButton]) {
    btn.disabled = isBusy;
  }
}

function show(value) {
  outputEl.textContent = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
}

function showSummary(title, details = {}) {
  show({ title, ...details });
}

async function runCommand({ busyText, failureText, success, task }) {
  setBusy(true);
  setStatus(busyText, 'busy');
  show('');
  try {
    const result = await task();
    success(result);
  } catch (error) {
    show({ error: String(error?.message ?? error) });
    setStatus(failureText, 'error');
  } finally {
    setBusy(false);
  }
}

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) throw new Error('No active tab.');
  return tab;
}

async function ensureContentScript(tabId) {
  const response = await chrome.runtime.sendMessage({ type: 'XLAT_ENSURE_CONTENT_SCRIPT', tabId });
  if (!response?.ok) throw new Error(response?.error || 'Failed to inject content script.');
}

async function currentCommandOptions() {
  const sourceLanguage = sourceLanguageEl.value;
  const targetLanguage = targetLanguageEl.value.trim() || 'ko';
  const displayMode = displayModeEl.value || 'append-below-original';
  const maxBlocks = Math.max(1, Math.min(500, Number(maxBlocksEl.value || 80)));
  const viewportOnly = Boolean(viewportOnlyEl.checked);
  await saveSettings({ sourceLanguage, targetLanguage, displayMode, maxBlocks, viewportOnly });
  return { sourceLanguage, targetLanguage, displayMode, maxBlocks, viewportOnly };
}

async function sendToActiveTab(message) {
  const tab = await getActiveTab();
  await ensureContentScript(tab.id);
  return chrome.tabs.sendMessage(tab.id, message);
}

async function init() {
  populateSelect(sourceLanguageEl, LANGUAGES);
  populateSelect(targetLanguageEl, LANGUAGES.filter(l => l.code !== 'auto'));

  const settings = await loadSettings();
  sourceLanguageEl.value = settings.sourceLanguage || 'auto';
  targetLanguageEl.value = settings.targetLanguage;
  displayModeEl.value = settings.displayMode;
  maxBlocksEl.value = settings.maxBlocks;
  viewportOnlyEl.checked = settings.viewportOnly;

  sourceLanguageEl.addEventListener('change', () => saveSettings({ sourceLanguage: sourceLanguageEl.value }));
  targetLanguageEl.addEventListener('change', () => saveSettings({ targetLanguage: targetLanguageEl.value.trim() || 'ko' }));
  displayModeEl.addEventListener('change', () => saveSettings({ displayMode: displayModeEl.value }));
  maxBlocksEl.addEventListener('change', () => saveSettings({ maxBlocks: Math.max(1, Math.min(500, Number(maxBlocksEl.value || 80))) }));
  viewportOnlyEl.addEventListener('change', () => saveSettings({ viewportOnly: Boolean(viewportOnlyEl.checked) }));
}

// --- event handlers ---

translatePageButton.addEventListener('click', () => runCommand({
  busyText: 'Translating page...',
  failureText: 'Page translation failed.',
  task: async () => {
    const response = await sendToActiveTab({ type: MessageType.TRANSLATE_PAGE, ...(await currentCommandOptions()) });
    if (!response?.ok) throw new Error(response?.error || 'Page translation failed.');
    return response.summary;
  },
  success(summary) {
    showSummary('Page translation finished', summary);
    setStatus(`Translated ${summary.completed}/${summary.total} page blocks.`, 'ready');
  }
}));

translateSelectionButton.addEventListener('click', () => runCommand({
  busyText: 'Translating selection...',
  failureText: 'Selection translation failed.',
  task: async () => {
    const response = await sendToActiveTab({ type: MessageType.TRANSLATE_SELECTION, ...(await currentCommandOptions()) });
    if (!response?.ok) throw new Error(response?.error || 'Selection translation failed.');
    return response.summary;
  },
  success(summary) {
    showSummary('Selection translation finished', summary);
    setStatus(summary.error ? 'Selection translation unavailable locally.' : 'Selection translation shown.', summary.error ? 'error' : 'ready');
  }
}));

clearTranslationsButton.addEventListener('click', () => runCommand({
  busyText: 'Clearing translations...',
  failureText: 'Clear failed.',
  task: async () => {
    const response = await sendToActiveTab({ type: MessageType.CLEAR_TRANSLATIONS });
    if (!response?.ok) throw new Error(response?.error || 'Clear failed.');
    return response;
  },
  success(response) {
    showSummary('Translations cleared', response);
    setStatus(`Removed ${response.removed} Xlat nodes.`, 'ready');
  }
}));

init().catch((error) => setStatus(String(error?.message ?? error)));