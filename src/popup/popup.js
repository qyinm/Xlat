import { MessageType } from '../shared/messages.js';
import { loadSettings, saveSettings } from '../shared/settings.js';

const statusEl = document.querySelector('#status');
const outputEl = document.querySelector('#output');
const targetLanguageEl = document.querySelector('#targetLanguage');
const runSpikeButton = document.querySelector('#runSpike');
const displayModeEl = document.querySelector('#displayMode');
const maxBlocksEl = document.querySelector('#maxBlocks');
const viewportOnlyEl = document.querySelector('#viewportOnly');
const translatePageButton = document.querySelector('#translatePage');
const translateSelectionButton = document.querySelector('#translateSelection');
const clearTranslationsButton = document.querySelector('#clearTranslations');

function setStatus(text) { statusEl.textContent = text; }
function show(value) { outputEl.textContent = typeof value === 'string' ? value : JSON.stringify(value, null, 2); }
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
  const targetLanguage = targetLanguageEl.value.trim() || 'ko';
  const displayMode = displayModeEl.value || 'append-below-original';
  const maxBlocks = Math.max(1, Math.min(500, Number(maxBlocksEl.value || 80)));
  const viewportOnly = Boolean(viewportOnlyEl.checked);
  await saveSettings({ targetLanguage, displayMode, maxBlocks, viewportOnly });
  return { targetLanguage, displayMode, maxBlocks, viewportOnly };
}
async function sendToActiveTab(message) {
  const tab = await getActiveTab();
  await ensureContentScript(tab.id);
  return chrome.tabs.sendMessage(tab.id, message);
}
async function init() {
  const settings = await loadSettings();
  targetLanguageEl.value = settings.targetLanguage;
  displayModeEl.value = settings.displayMode;
  maxBlocksEl.value = settings.maxBlocks;
  viewportOnlyEl.checked = settings.viewportOnly;
  targetLanguageEl.addEventListener('change', () => saveSettings({ targetLanguage: targetLanguageEl.value.trim() || 'ko' }));
  displayModeEl.addEventListener('change', () => saveSettings({ displayMode: displayModeEl.value }));
  maxBlocksEl.addEventListener('change', () => saveSettings({ maxBlocks: Math.max(1, Math.min(500, Number(maxBlocksEl.value || 80))) }));
  viewportOnlyEl.addEventListener('change', () => saveSettings({ viewportOnly: Boolean(viewportOnlyEl.checked) }));
}

translatePageButton.addEventListener('click', async () => {
  setStatus('Translating page locally...'); show('');
  try {
    const response = await sendToActiveTab({ type: MessageType.TRANSLATE_PAGE, ...(await currentCommandOptions()) });
    if (!response?.ok) throw new Error(response?.error || 'Page translation failed.');
    show(response.summary); setStatus(`Page translation finished: ${response.summary.completed}/${response.summary.total}`);
  } catch (error) { show({ error: String(error?.message ?? error) }); setStatus('Page translation failed.'); }
});
translateSelectionButton.addEventListener('click', async () => {
  setStatus('Translating selection locally...'); show('');
  try {
    const response = await sendToActiveTab({ type: MessageType.TRANSLATE_SELECTION, ...(await currentCommandOptions()) });
    if (!response?.ok) throw new Error(response?.error || 'Selection translation failed.');
    show(response.summary); setStatus(response.summary.error ? 'Selection translation unavailable locally.' : 'Selection translation finished.');
  } catch (error) { show({ error: String(error?.message ?? error) }); setStatus('Selection translation failed.'); }
});
clearTranslationsButton.addEventListener('click', async () => {
  setStatus('Clearing translations...'); show('');
  try {
    const response = await sendToActiveTab({ type: MessageType.CLEAR_TRANSLATIONS });
    if (!response?.ok) throw new Error(response?.error || 'Clear failed.');
    show(response); setStatus(`Removed ${response.removed} Xlat nodes.`);
  } catch (error) { show({ error: String(error?.message ?? error) }); setStatus('Clear failed.'); }
});
runSpikeButton.addEventListener('click', async () => {
  setStatus('Running content-script AI context spike...'); show('');
  try {
    const response = await sendToActiveTab({ type: MessageType.RUN_AI_CONTEXT_SPIKE, ...(await currentCommandOptions()) });
    if (!response?.ok) throw new Error(response?.error || 'Spike failed.');
    await chrome.storage.local.set({ lastAiContextSpike: response.spike });
    show(response.spike); setStatus(`Spike complete. Decision: ${response.spike.decision}`);
  } catch (error) {
    const failure = { ok: false, error: String(error?.message ?? error), decision: 'extension-document-broker' };
    await chrome.storage.local.set({ lastAiContextSpike: failure });
    show(failure); setStatus('Spike failed; broker fallback is selected unless rerun succeeds.');
  }
});

init().catch((error) => setStatus(String(error?.message ?? error)));
