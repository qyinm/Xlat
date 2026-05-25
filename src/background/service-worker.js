import { MessageType, XLAT_CONTEXT_MENU_TRANSLATE_SELECTION } from '../shared/messages.js';
import { loadSettings } from '../shared/settings.js';

const translatedTabs = new Map();

async function ensureContentScript(tabId) {
  try {
    const pong = await chrome.tabs.sendMessage(tabId, { type: MessageType.PING });
    if (pong?.injected) return;
  } catch (_) {
    // Not injected yet.
  }
  await chrome.scripting.executeScript({ target: { tabId }, files: ['src/content/content-script.js'] });
  await chrome.scripting.insertCSS({ target: { tabId }, files: ['src/styles/content.css'] });
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({ id: XLAT_CONTEXT_MENU_TRANSLATE_SELECTION, title: 'Translate selected text with Xlat', contexts: ['selection'] });
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
