import { loadSettings, saveSettings } from '../shared/settings.js';

const targetLanguage = document.querySelector('#targetLanguage');
const maxBlocks = document.querySelector('#maxBlocks');
const viewportOnly = document.querySelector('#viewportOnly');
const settings = await loadSettings();
targetLanguage.value = settings.targetLanguage;
maxBlocks.value = settings.maxBlocks;
viewportOnly.checked = settings.viewportOnly;
targetLanguage.addEventListener('change', () => saveSettings({ targetLanguage: targetLanguage.value.trim() || 'ko' }));
maxBlocks.addEventListener('change', () => saveSettings({ maxBlocks: Math.max(1, Math.min(500, Number(maxBlocks.value || 80))) }));
viewportOnly.addEventListener('change', () => saveSettings({ viewportOnly: Boolean(viewportOnly.checked) }));
