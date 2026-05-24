export function clearTranslations(root = document) {
  const owned = root.querySelectorAll?.('.xlat-translation,.xlat-selection-overlay') ?? [];
  let count = 0;
  owned.forEach((node) => { node.remove(); count += 1; });
  return count;
}

export function appendTranslation(block, translatedText, { targetLanguage = 'unknown', status = 'translated' } = {}) {
  const existing = block.element.parentElement?.querySelector(`.xlat-translation[data-xlat-id="${CSS.escape(block.id)}"]`);
  const node = existing || document.createElement('span');
  node.className = 'xlat-translation';
  node.dataset.xlatOwned = 'true';
  node.dataset.xlatId = block.id;
  node.dataset.xlatStatus = status;
  node.lang = targetLanguage;
  node.textContent = translatedText;
  if (!existing) block.element.insertAdjacentElement('afterend', node);
  return node;
}

export function showSelectionOverlay(text) {
  document.querySelectorAll('.xlat-selection-overlay').forEach((node) => node.remove());
  const range = globalThis.getSelection?.()?.rangeCount ? globalThis.getSelection().getRangeAt(0) : null;
  const rect = range?.getBoundingClientRect?.() ?? { left: 12, bottom: 12 };
  const overlay = document.createElement('div');
  overlay.className = 'xlat-selection-overlay';
  overlay.dataset.xlatOwned = 'true';

  const content = document.createElement('span');
  content.className = 'xlat-selection-text';
  content.textContent = text;
  overlay.appendChild(content);

  const close = document.createElement('button');
  close.className = 'xlat-selection-close';
  close.textContent = '\u00d7';
  close.setAttribute('aria-label', 'Close translation');
  close.addEventListener('click', () => overlay.remove());
  overlay.appendChild(close);

  overlay.style.left = `${Math.max(8, rect.left + window.scrollX)}px`;
  overlay.style.top = `${Math.max(8, rect.bottom + window.scrollY + 8)}px`;
  document.body.appendChild(overlay);
  return overlay;
}
