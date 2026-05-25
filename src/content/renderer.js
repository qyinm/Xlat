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

const SELECTION_OVERLAY_MARGIN = 8;
const SELECTION_OVERLAY_GAP = 8;
const SELECTION_OVERLAY_WIDTH = 360;
const SELECTION_POINTER_MAX_AGE_MS = 120000;

let lastSelectionPointer = null;

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), Math.max(min, max));
}

function viewportBounds() {
  const width = window.innerWidth || document.documentElement?.clientWidth || SELECTION_OVERLAY_WIDTH;
  const height = window.innerHeight || document.documentElement?.clientHeight || 240;
  return {
    left: window.scrollX + SELECTION_OVERLAY_MARGIN,
    top: window.scrollY + SELECTION_OVERLAY_MARGIN,
    right: window.scrollX + width - SELECTION_OVERLAY_MARGIN,
    bottom: window.scrollY + height - SELECTION_OVERLAY_MARGIN
  };
}

export function formatSelectionOverlayText(text) {
  return String(text ?? '')
    .replace(/\r\n?/g, '\n')
    .split(/\n{2,}/)
    .map((paragraph) => paragraph
      .replace(/[ \t\f\v]+/g, ' ')
      .replace(/([.!?。！？]+)\s+/g, '$1\n')
      .trim())
    .filter(Boolean)
    .join('\n\n');
}

function positionSelectionOverlay(overlay, rect) {
  const bounds = viewportBounds();
  const selectionRight = Number.isFinite(rect.right) ? rect.right : rect.left;
  const selectionTop = Number.isFinite(rect.top) ? rect.top : rect.bottom;
  const left = clamp(window.scrollX + selectionRight + SELECTION_OVERLAY_GAP, bounds.left, bounds.right - SELECTION_OVERLAY_WIDTH);
  const top = clamp(window.scrollY + selectionTop, bounds.top, bounds.bottom - 120);
  overlay.style.left = `${left}px`;
  overlay.style.top = `${top}px`;
}

export function rememberSelectionPointer(event) {
  if (event?.target?.closest?.('.xlat-selection-overlay')) return;
  if (!Number.isFinite(event?.clientX) || !Number.isFinite(event?.clientY)) return;
  lastSelectionPointer = { clientX: event.clientX, clientY: event.clientY, at: Date.now() };
}

function recentPointerRect() {
  if (!lastSelectionPointer || Date.now() - lastSelectionPointer.at > SELECTION_POINTER_MAX_AGE_MS) return null;
  return {
    left: lastSelectionPointer.clientX,
    right: lastSelectionPointer.clientX,
    top: lastSelectionPointer.clientY,
    bottom: lastSelectionPointer.clientY
  };
}

function fallbackSelectionRect() {
  const width = window.innerWidth || document.documentElement?.clientWidth || SELECTION_OVERLAY_WIDTH;
  const height = window.innerHeight || document.documentElement?.clientHeight || 240;
  const pointerRect = recentPointerRect();
  if (pointerRect) return pointerRect;
  return {
    left: width - SELECTION_OVERLAY_WIDTH - SELECTION_OVERLAY_MARGIN - SELECTION_OVERLAY_GAP,
    right: width - SELECTION_OVERLAY_WIDTH - SELECTION_OVERLAY_MARGIN - SELECTION_OVERLAY_GAP,
    top: height * 0.35,
    bottom: height * 0.35
  };
}

function isUsableSelectionRect(rect) {
  if (!rect) return false;
  return [rect.left, rect.right, rect.top, rect.bottom].every(Number.isFinite) &&
    (rect.left !== 0 || rect.right !== 0 || rect.top !== 0 || rect.bottom !== 0);
}

function makeSelectionOverlayDraggable(overlay, handle) {
  handle.addEventListener('pointerdown', (event) => {
    if (event.button !== undefined && event.button !== 0) return;
    event.preventDefault?.();
    handle.setPointerCapture?.(event.pointerId);
    const startX = event.clientX;
    const startY = event.clientY;
    const startLeft = parseFloat(overlay.style.left) || window.scrollX;
    const startTop = parseFloat(overlay.style.top) || window.scrollY;

    function move(moveEvent) {
      const bounds = viewportBounds();
      const width = overlay.offsetWidth || SELECTION_OVERLAY_WIDTH;
      const height = overlay.offsetHeight || 120;
      overlay.style.left = `${clamp(startLeft + moveEvent.clientX - startX, bounds.left, bounds.right - width)}px`;
      overlay.style.top = `${clamp(startTop + moveEvent.clientY - startY, bounds.top, bounds.bottom - height)}px`;
    }

    function stop() {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', stop);
      window.removeEventListener('pointercancel', stop);
    }

    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', stop, { once: true });
    window.addEventListener('pointercancel', stop, { once: true });
  });
}

globalThis.addEventListener?.('pointerup', rememberSelectionPointer, true);
globalThis.addEventListener?.('mouseup', rememberSelectionPointer, true);
globalThis.addEventListener?.('contextmenu', rememberSelectionPointer, true);

export function showSelectionOverlay(text) {
  document.querySelectorAll('.xlat-selection-overlay').forEach((node) => node.remove());
  const range = globalThis.getSelection?.()?.rangeCount ? globalThis.getSelection().getRangeAt(0) : null;
  const selectionRect = range?.getBoundingClientRect?.();
  const rect = isUsableSelectionRect(selectionRect) ? selectionRect : fallbackSelectionRect();
  const overlay = document.createElement('div');
  overlay.className = 'xlat-selection-overlay';
  overlay.dataset.xlatOwned = 'true';

  const dragHandle = document.createElement('div');
  dragHandle.className = 'xlat-selection-drag-handle';
  dragHandle.setAttribute('role', 'button');
  dragHandle.setAttribute('aria-label', 'Move translation window');
  overlay.appendChild(dragHandle);

  const content = document.createElement('div');
  content.className = 'xlat-selection-text';
  content.textContent = formatSelectionOverlayText(text);
  overlay.appendChild(content);

  const close = document.createElement('button');
  close.className = 'xlat-selection-close';
  close.setAttribute('aria-label', 'Close translation');
  close.addEventListener('click', () => overlay.remove());
  overlay.appendChild(close);

  makeSelectionOverlayDraggable(overlay, dragHandle);
  positionSelectionOverlay(overlay, rect);
  document.body.appendChild(overlay);
  return overlay;
}
