import { loadSettings, saveSettings } from '../shared/settings.js';

const targetLanguage = document.querySelector('#targetLanguage');
const maxBlocks = document.querySelector('#maxBlocks');
const viewportOnly = document.querySelector('#viewportOnly');
const saveState = document.querySelector('#saveState');
const settings = await loadSettings();
targetLanguage.value = settings.targetLanguage;
maxBlocks.value = settings.maxBlocks;
viewportOnly.checked = settings.viewportOnly;
function markSaved() {
  saveState.textContent = 'Saved.';
  setTimeout(() => { saveState.textContent = 'Ready.'; }, 1200);
}
async function persist(patch) {
  await saveSettings(patch);
  markSaved();
}
targetLanguage.addEventListener('change', () => persist({ targetLanguage: targetLanguage.value.trim() || 'ko' }));
maxBlocks.addEventListener('change', () => persist({ maxBlocks: Math.max(1, Math.min(500, Number(maxBlocks.value || 80))) }));
viewportOnly.addEventListener('change', () => persist({ viewportOnly: Boolean(viewportOnly.checked) }));
