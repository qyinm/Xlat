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

function t(key) {
  if (customMessages && customMessages[key] !== undefined) return customMessages[key];
  return chrome.i18n.getMessage(key) || key;
}

function localizeHtml() {
  document.querySelectorAll('[data-i18n]').forEach((el) => {
    const key = el.getAttribute('data-i18n');
    const msg = t(key);
    if (el.tagName === 'LABEL') {
      const textNode = Array.from(el.childNodes).find((n) => n.nodeType === 3 && n.textContent.trim());
      if (textNode) textNode.textContent = ` ${msg} `;
    } else {
      el.textContent = msg;
    }
  });
}

const targetLanguage = document.querySelector('#targetLanguage');
const maxBlocks = document.querySelector('#maxBlocks');
const viewportOnly = document.querySelector('#viewportOnly');
const uiLanguage = document.querySelector('#uiLanguage');
const saveState = document.querySelector('#saveState');
const settings = await loadSettings();
targetLanguage.value = settings.targetLanguage;
maxBlocks.value = settings.maxBlocks;
viewportOnly.checked = settings.viewportOnly;
uiLanguage.value = settings.uiLanguage || '';
await loadMessages(settings.uiLanguage);
localizeHtml();

function markSaved() {
  saveState.textContent = t('saved');
  setTimeout(() => { saveState.textContent = t('ready'); }, 1200);
}
async function persist(patch) {
  await saveSettings(patch);
  markSaved();
  if ('uiLanguage' in patch) location.reload();
}
targetLanguage.addEventListener('change', () => persist({ targetLanguage: targetLanguage.value.trim() || 'ko' }));
maxBlocks.addEventListener('change', () => persist({ maxBlocks: Math.max(1, Math.min(500, Number(maxBlocks.value || 80))) }));
viewportOnly.addEventListener('change', () => persist({ viewportOnly: Boolean(viewportOnly.checked) }));
uiLanguage.addEventListener('change', () => persist({ uiLanguage: uiLanguage.value }));
