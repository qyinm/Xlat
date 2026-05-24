import { MessageType, XLAT_CONTEXT_MENU_TRANSLATE_SELECTION } from '../shared/messages.js';

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
