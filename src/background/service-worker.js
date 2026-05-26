import { MessageType, XLAT_CONTEXT_MENU_TRANSLATE_SELECTION } from '../shared/messages.js';
import { loadSettings } from '../shared/settings.js';

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

loadSettings().then((s) => loadMessages(s.uiLanguage));

const translatedTabs = new Map();

async function ensureContentScript(tabId) {
  for (let i = 0; i < 5; i++) {
    try {
      const pong = await chrome.tabs.sendMessage(tabId, { type: MessageType.PING });
      if (pong?.injected) return;
    } catch (_) {}
    await new Promise(r => setTimeout(r, 200));
  }
  throw new Error(t('contentScriptNotReady'));
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({ id: XLAT_CONTEXT_MENU_TRANSLATE_SELECTION, title: t('contextMenuTitle'), contexts: ['selection'] });
});

chrome.tabs.onUpdated.addListener((tabId) => {
  translatedTabs.delete(tabId);
});
chrome.tabs.onRemoved.addListener((tabId) => {
  translatedTabs.delete(tabId);
});

chrome.commands.onCommand.addListener(async (command) => {
  if (command !== 'translate-page') return;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return;

  if (translatedTabs.get(tab.id)) {
    translatedTabs.delete(tab.id);
    await ensureContentScript(tab.id);
    await chrome.tabs.sendMessage(tab.id, { type: MessageType.CLEAR_TRANSLATIONS });
    return;
  }

  await ensureContentScript(tab.id);
  const settings = await loadSettings();
  await chrome.tabs.sendMessage(tab.id, {
    type: MessageType.TRANSLATE_PAGE,
    sourceLanguage: settings.sourceLanguage,
    targetLanguage: settings.targetLanguage,
    maxBlocks: settings.maxBlocks,
    viewportOnly: settings.viewportOnly,
  });
  translatedTabs.set(tab.id, true);
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== XLAT_CONTEXT_MENU_TRANSLATE_SELECTION || !tab?.id) return;
  await ensureContentScript(tab.id);
  await chrome.tabs.sendMessage(tab.id, { type: MessageType.TRANSLATE_SELECTION, text: info.selectionText ?? '' });
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === 'XLAT_ENSURE_CONTENT_SCRIPT' && typeof message.tabId === 'number') {
    ensureContentScript(message.tabId)
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ ok: false, error: String(error?.message ?? error) }));
    return true;
  }
  return false;
});
