const MessageType = Object.freeze({
  RUN_AI_CONTEXT_SPIKE: 'XLAT_RUN_AI_CONTEXT_SPIKE',
  TRANSLATE_PAGE: 'XLAT_TRANSLATE_PAGE',
  TRANSLATE_SELECTION: 'XLAT_TRANSLATE_SELECTION',
  CLEAR_TRANSLATIONS: 'XLAT_CLEAR_TRANSLATIONS',
  GET_STATUS: 'XLAT_GET_STATUS',
  PING: 'XLAT_PING'
});
const ENGINE_DECISION = Object.freeze({ CONTENT_SCRIPT: 'content-script', BROKER: 'extension-document-broker' });
const REQUIRED_CHECKS = Object.freeze(['translatorVisible', 'languageDetectorVisible', 'availabilityCallable', 'createCallableAfterUserGesture', 'sampleTranslateCallable']);
const SAMPLE_PAIR = Object.freeze({ sourceLanguage: 'en', targetLanguage: 'ko' });
const SAMPLE_TEXT = 'Hello from Xlat local translation spike.';
const SKIP_SELECTOR = 'script,style,noscript,textarea,input,select,option,code,pre,kbd,samp,svg,canvas,iframe,button,nav,[contenteditable="true"],[aria-hidden="true"],[role="tooltip"],[role="button"],[role="menu"],[role="navigation"],.xlat-translation,.xlat-selection-overlay';
const BLOCK_SELECTOR = 'p,li,blockquote,h1,h2,h3,h4,h5,h6,td,th,figcaption,caption,article,section,div';
const translatorCache = new Map();
const originalContentMap = new Map();

let brokerFrame = null;
let brokerReadyPromise = null;
let brokerSeq = 0;
const brokerPending = new Map();

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

function t(key, ...args) {
  if (customMessages && customMessages[key] !== undefined) {
    let msg = customMessages[key];
    if (args.length) args.forEach((arg, i) => { msg = msg.replace(`$${i + 1}`, arg); });
    return msg;
  }
  return chrome.i18n.getMessage(key, args) || key;
}

if (chrome?.storage?.sync) chrome.storage.sync.get('uiLanguage').then(({ uiLanguage }) => loadMessages(uiLanguage));

function ensureBrokerFrame() {
  if (brokerReadyPromise) return brokerReadyPromise;
  brokerReadyPromise = new Promise((resolve, reject) => {
    const frame = document.createElement('iframe');
    frame.hidden = true;
    frame.title = t('brokerTitle');
    frame.dataset.xlatOwned = 'true';
    frame.className = 'xlat-broker-frame';
    frame.src = chrome.runtime.getURL('src/broker/broker.html');
    const timeout = setTimeout(() => reject(new Error(t('brokerNotReady'))), 5000);
    function onMessage(event) {
      if (event.source !== frame.contentWindow) return;
      if (event.data?.type === 'XLAT_BROKER_READY') {
        clearTimeout(timeout);
        removeEventListener('message', onMessage);
        brokerFrame = frame;
        resolve(frame);
      }
    }
    addEventListener('message', onMessage);
    document.documentElement.appendChild(frame);
  });
  return brokerReadyPromise;
}

async function translateViaBroker(text, { targetLanguage = 'ko', sourceLanguage } = {}) {
  const frame = await ensureBrokerFrame();
  const id = `xlat-broker-${++brokerSeq}`;
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      brokerPending.delete(id);
      reject(new Error(t('brokerTimedOut')));
    }, 60000);
    brokerPending.set(id, { resolve, reject, timeout });
    frame.contentWindow.postMessage({ type: 'XLAT_BROKER_TRANSLATE', id, text, sourceLanguage, targetLanguage }, '*');
  });
}

addEventListener('message', (event) => {
  if (!brokerFrame || event.source !== brokerFrame.contentWindow) return;
  const message = event.data;
  if (message?.type === 'XLAT_BROKER_PROGRESS') return;
  if (message?.type !== 'XLAT_BROKER_RESULT') return;
  const pending = brokerPending.get(message.id);
  if (!pending) return;
  clearTimeout(pending.timeout);
  brokerPending.delete(message.id);
  if (message.ok) pending.resolve(message);
  else pending.reject(new Error(message.error?.message || t('brokerFailed')));
});

let currentStatus = { state: 'idle', completed: 0, total: 0, error: null };

function isXlatMessage(message) { return Boolean(message && typeof message === 'object' && typeof message.type === 'string' && message.type.startsWith('XLAT_')); }
function decideEngine(checks) { return REQUIRED_CHECKS.every((key) => checks[key]?.ok === true) ? ENGINE_DECISION.CONTENT_SCRIPT : ENGINE_DECISION.BROKER; }
function nowIso() { return new Date().toISOString(); }
function result(ok, details = {}) { return { ok, ...details }; }
function normalizeText(text) { return String(text ?? '').replace(/\s+/g, ' ').trim(); }
function stableBlockId(index, text) { let hash = 5381; for (const char of text) hash = ((hash << 5) + hash) ^ char.charCodeAt(0); return `xlat-${index}-${(hash >>> 0).toString(36)}`; }
function setStatus(next) { currentStatus = { ...currentStatus, ...next, updatedAt: nowIso() }; }
function isRestrictedPage() { return /^(chrome|edge|about|devtools):/.test(location.protocol) || location.href.startsWith('https://chromewebstore.google.com/'); }
function shouldSkipElement(element) {
  if (!element || element.nodeType !== 1) return false;
  if (element.matches(SKIP_SELECTOR) || element.closest(SKIP_SELECTOR)) return true;
  const style = getComputedStyle(element);
  return style.display === 'none' || style.visibility === 'hidden';
}
function isInViewport(element) {
  const rect = element.getBoundingClientRect();
  return rect.bottom >= 0 && rect.right >= 0 && rect.top <= innerHeight && rect.left <= innerWidth;
}
function collectBlocks({ minLength = 2, maxBlocks = Infinity, viewportOnly = false } = {}) {
  if (!document.body) return [];
  const blockMap = new Map();
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const parent = node.parentElement;
      if (!parent || shouldSkipElement(parent)) return NodeFilter.FILTER_REJECT;
      return normalizeText(node.nodeValue).length >= minLength ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
    }
  });
  while (walker.nextNode() && blockMap.size < maxBlocks) {
    const textNode = walker.currentNode;
    const block = textNode.parentElement?.closest(BLOCK_SELECTOR) || textNode.parentElement;
    if (!block || shouldSkipElement(block)) continue;
    if (viewportOnly && !isInViewport(block)) continue;
    if (block.querySelector(':scope > .xlat-translation')) continue;
    if (block.dataset.xlatReplaced) continue;
    const previous = blockMap.get(block) || '';
    blockMap.set(block, normalizeText(`${previous} ${textNode.nodeValue}`));
  }
  const blocks = [];
  const seen = new Set();
  for (const [element, text] of blockMap.entries()) {
    const normalized = normalizeText(text);
    if (normalized.length < minLength || seen.has(normalized)) continue;
    seen.add(normalized);
    blocks.push({ id: stableBlockId(blocks.length, normalized), element, text: normalized });
  }
  return blocks;
}
function appendTranslation(block, translatedText, { targetLanguage = 'unknown', status = 'translated', displayMode } = {}) {
  if (displayMode === 'replace-text') {
    if (status === 'loading') return;
    originalContentMap.set(block.element, block.element.innerHTML);
    block.element.textContent = translatedText;
    block.element.dataset.xlatReplaced = 'true';
    block.element.lang = targetLanguage;
    return block.element;
  }
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
function clearTranslations() {
  removeSelectionDot();
  const nodes = document.querySelectorAll('.xlat-translation,.xlat-selection-overlay');
  nodes.forEach((node) => node.remove());
  const replaced = document.querySelectorAll('[data-xlat-replaced]');
  replaced.forEach((el) => {
    const original = originalContentMap.get(el);
    if (original !== undefined) el.innerHTML = original;
    delete el.dataset.xlatReplaced;
    el.lang = '';
  });
  return nodes.length + replaced.length;
}
const SELECTION_OVERLAY_MARGIN = 8;
const SELECTION_OVERLAY_GAP = 8;
const SELECTION_OVERLAY_WIDTH = 360;
const SELECTION_POINTER_MAX_AGE_MS = 120000;
let lastSelectionPointer = null;
let selectionDot = null;
let dotTranslateSeq = 0;
let pendingSelectionRect = null;
let pendingSelectionText = '';
let lastDotSuppressedText = '';
function clamp(value, min, max) {
  return Math.min(Math.max(value, min), Math.max(min, max));
}
function viewportBounds() {
  const width = innerWidth || document.documentElement?.clientWidth || SELECTION_OVERLAY_WIDTH;
  const height = innerHeight || document.documentElement?.clientHeight || 240;
  return {
    left: scrollX + SELECTION_OVERLAY_MARGIN,
    top: scrollY + SELECTION_OVERLAY_MARGIN,
    right: scrollX + width - SELECTION_OVERLAY_MARGIN,
    bottom: scrollY + height - SELECTION_OVERLAY_MARGIN
  };
}
function formatSelectionOverlayText(text) {
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
  const left = clamp(scrollX + selectionRight + SELECTION_OVERLAY_GAP, bounds.left, bounds.right - SELECTION_OVERLAY_WIDTH);
  const top = clamp(scrollY + selectionTop, bounds.top, bounds.bottom - 120);
  overlay.style.left = `${left}px`;
  overlay.style.top = `${top}px`;
}
function rememberSelectionPointer(event) {
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
  const width = innerWidth || document.documentElement?.clientWidth || SELECTION_OVERLAY_WIDTH;
  const height = innerHeight || document.documentElement?.clientHeight || 240;
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
    const startLeft = parseFloat(overlay.style.left) || scrollX;
    const startTop = parseFloat(overlay.style.top) || scrollY;
    function move(moveEvent) {
      const bounds = viewportBounds();
      const width = overlay.offsetWidth || SELECTION_OVERLAY_WIDTH;
      const height = overlay.offsetHeight || 120;
      overlay.style.left = `${clamp(startLeft + moveEvent.clientX - startX, bounds.left, bounds.right - width)}px`;
      overlay.style.top = `${clamp(startTop + moveEvent.clientY - startY, bounds.top, bounds.bottom - height)}px`;
    }
    function stop() {
      removeEventListener('pointermove', move);
      removeEventListener('pointerup', stop);
      removeEventListener('pointercancel', stop);
    }
    addEventListener('pointermove', move);
    addEventListener('pointerup', stop, { once: true });
    addEventListener('pointercancel', stop, { once: true });
  });
}
addEventListener('pointerup', rememberSelectionPointer, true);
addEventListener('mouseup', rememberSelectionPointer, true);
addEventListener('contextmenu', rememberSelectionPointer, true);

function removeSelectionDot() {
  if (selectionDot) { selectionDot.remove(); selectionDot = null; }
}
function showSelectionDot() {
  if (document.querySelector('.xlat-selection-overlay')) return;
  const selection = getSelection();
  const text = normalizeText(selection?.toString() || '');
  if (!text || !selection?.rangeCount) { removeSelectionDot(); return; }
  if (text === lastDotSuppressedText) return;
  pendingSelectionText = text;
  const rect = selection.getRangeAt(0).getBoundingClientRect();
  if (isUsableSelectionRect(rect)) pendingSelectionRect = rect;
  removeSelectionDot();
  const dot = document.createElement('div');
  dot.className = 'xlat-selection-dot';
  dot.dataset.xlatOwned = 'true';
  const viewW = innerWidth || document.documentElement?.clientWidth || 1200;
  const viewH = innerHeight || document.documentElement?.clientHeight || 800;
  dot.style.cssText = `position: fixed; left: ${clamp((rect.right || 0) + SELECTION_OVERLAY_GAP, 0, viewW - 16)}px; top: ${clamp((rect.top || 0) - 10, 0, viewH - 16)}px`;
  document.body.appendChild(dot);
  selectionDot = dot;
  setTimeout(() => {
    if (!selectionDot) return;
    dot.addEventListener('mouseenter', async () => {
      if (!pendingSelectionText) return;
      const capturedText = pendingSelectionText;
      const capturedRect = pendingSelectionRect;
      removeSelectionDot();
      lastDotSuppressedText = capturedText;
      const seq = ++dotTranslateSeq;
      try {
        const { targetLanguage } = await chrome.storage.sync.get('targetLanguage');
        const translated = await translateLocal(capturedText, { targetLanguage: targetLanguage || 'ko' });
        if (seq !== dotTranslateSeq) return;
        showSelectionOverlay(translated, capturedRect);
      } catch (error) {
        if (seq !== dotTranslateSeq) return;
        showSelectionOverlay(String(error?.message ?? error), capturedRect);
      }
    });
  }, 150);
}

function tryShowSelectionDot(e) {
  if (e?.target?.closest?.('.xlat-selection-overlay, .xlat-selection-dot')) return;
  showSelectionDot();
}
addEventListener('pointerup', tryShowSelectionDot, true);
addEventListener('mouseup', tryShowSelectionDot, true);

let selChangeTimer = null;
if (typeof document?.addEventListener === 'function') document.addEventListener('selectionchange', () => {
  clearTimeout(selChangeTimer);
  selChangeTimer = setTimeout(() => {
    const selection = getSelection();
    const text = normalizeText(selection?.toString() || '');
    if (!text && !document.querySelector('.xlat-selection-overlay')) {
      removeSelectionDot();
    }
  }, 300);
});

function showSelectionOverlay(text, positionRect) {
  document.querySelectorAll('.xlat-selection-overlay').forEach((node) => node.remove());
  let rect;
  if (positionRect && isUsableSelectionRect(positionRect)) {
    rect = positionRect;
  } else {
    const selection = getSelection();
    const selectionRect = selection?.rangeCount ? selection.getRangeAt(0).getBoundingClientRect() : null;
    rect = isUsableSelectionRect(selectionRect) ? selectionRect : fallbackSelectionRect();
  }
  const overlay = document.createElement('div');
  overlay.className = 'xlat-selection-overlay';
  overlay.dataset.xlatOwned = 'true';

  const dragHandle = document.createElement('div');
  dragHandle.className = 'xlat-selection-drag-handle';
  dragHandle.setAttribute('role', 'button');
  dragHandle.setAttribute('aria-label', t('moveWindow'));
  overlay.appendChild(dragHandle);

  const content = document.createElement('div');
  content.className = 'xlat-selection-text';
  content.textContent = formatSelectionOverlayText(text);
  overlay.appendChild(content);

  const close = document.createElement('button');
  close.className = 'xlat-selection-close';
  close.setAttribute('aria-label', t('closeTranslation'));
  close.addEventListener('click', () => {
    overlay.remove();
    if (pendingSelectionText) lastDotSuppressedText = pendingSelectionText;
    removeSelectionDot();
  });
  overlay.appendChild(close);

  makeSelectionOverlayDraggable(overlay, dragHandle);
  if (rect) positionSelectionOverlay(overlay, rect);
  document.body.appendChild(overlay);
  return overlay;
}
async function detectSourceLanguage(text, fallback = 'en') {
  if (!('LanguageDetector' in globalThis)) return fallback;
  try {
    const detector = await globalThis.LanguageDetector.create();
    const detections = await detector.detect(text);
    const first = Array.isArray(detections) ? detections[0] : detections;
    return first?.detectedLanguage || first?.language || fallback;
  } catch (_) { return fallback; }
}
async function translateLocal(text, { targetLanguage = 'ko', sourceLanguage } = {}) {
  if (!('Translator' in globalThis)) {
    const broker = await translateViaBroker(text, { targetLanguage, sourceLanguage });
    return broker.translatedText;
  }
  const source = sourceLanguage || await detectSourceLanguage(text);
  if (source === targetLanguage) return text;
  const key = `${source}->${targetLanguage}`;
  let translator = translatorCache.get(key);
  if (!translator) {
    const availability = await globalThis.Translator.availability({ sourceLanguage: source, targetLanguage });
    if (availability === 'unavailable') throw new Error(t('translationUnavailable', key));
    try {
      translator = await globalThis.Translator.create({ sourceLanguage: source, targetLanguage });
    } catch (createError) {
      const msg = String(createError?.message ?? createError);
      if (/user gesture/i.test(msg)) {
        // content script lacks user activation — fall back via broker
        const broker = await translateViaBroker(text, { targetLanguage, sourceLanguage });
        return broker.translatedText;
      }
      throw createError;
    }
    translatorCache.set(key, translator);
  }
  return translator.translate(text);
}
async function translatePage(options = {}) {
  if (isRestrictedPage()) throw new Error(t('unsupportedPage', location.href));
  const targetLanguage = options.targetLanguage || 'ko';
  const displayMode = options.displayMode || 'append-below-original';
  const blocks = collectBlocks({ viewportOnly: Boolean(options.viewportOnly) });
  setStatus({ state: 'translating-page', completed: 0, total: blocks.length, error: null });
  for (const block of blocks) {
    try {
      appendTranslation(block, t('translatingTo', targetLanguage), { targetLanguage, status: 'loading', displayMode });
      const translated = await translateLocal(block.text, { targetLanguage });
      appendTranslation(block, translated, { targetLanguage, status: 'translated', displayMode });
    } catch (error) {
      appendTranslation(block, String(error?.message ?? error), { targetLanguage, status: 'error', displayMode });
    }
    setStatus({ completed: currentStatus.completed + 1 });
  }
  setStatus({ state: 'idle' });
  return { total: blocks.length, completed: blocks.length };
}
async function translateSelection(options = {}) {
  const text = normalizeText(options.text || getSelection()?.toString() || '');
  if (!text) throw new Error(t('noSelectedText'));
  const targetLanguage = options.targetLanguage || 'ko';
  setStatus({ state: 'translating-selection', total: 1, completed: 0, error: null });
  try {
    const translated = await translateLocal(text, { targetLanguage });
    showSelectionOverlay(translated, options.positionRect);
    setStatus({ state: 'idle', completed: 1 });
    return { text, translated };
  } catch (error) {
    const message = String(error?.message ?? error);
    showSelectionOverlay(message, options.positionRect);
    setStatus({ state: 'idle', completed: 0, error: message });
    return { text, error: message };
  }
}
async function runAiContextSpike() {
  const checks = {};
  const events = [];
  const startedAt = nowIso();
  const userActivation = { isActive: globalThis.navigator?.userActivation?.isActive ?? null, hasBeenActive: globalThis.navigator?.userActivation?.hasBeenActive ?? null };
  checks.translatorVisible = result('Translator' in globalThis, { type: typeof globalThis.Translator });
  checks.languageDetectorVisible = result('LanguageDetector' in globalThis, { type: typeof globalThis.LanguageDetector });
  if (checks.translatorVisible.ok) {
    try { checks.availabilityCallable = result(true, { availability: await globalThis.Translator.availability(SAMPLE_PAIR) }); }
    catch (error) { checks.availabilityCallable = result(false, { error: String(error?.message ?? error) }); }
  } else checks.availabilityCallable = result(false, { error: 'Translator is not visible.' });
  if (checks.translatorVisible.ok) {
    try {
      const translator = await globalThis.Translator.create({ ...SAMPLE_PAIR, monitor(monitorTarget) { try { monitorTarget.addEventListener('downloadprogress', (event) => events.push({ type: 'downloadprogress', loaded: event.loaded, total: event.total ?? null, at: nowIso() })); } catch (error) { events.push({ type: 'downloadprogress-listener-error', error: String(error?.message ?? error), at: nowIso() }); } } });
      checks.createCallableAfterUserGesture = result(true);
      try { const translated = await translator.translate(SAMPLE_TEXT); checks.sampleTranslateCallable = result(true, { input: SAMPLE_TEXT, outputPreview: typeof translated === 'string' ? translated.slice(0, 160) : translated }); }
      catch (error) { checks.sampleTranslateCallable = result(false, { error: String(error?.message ?? error) }); }
    } catch (error) {
      checks.createCallableAfterUserGesture = result(false, { error: String(error?.message ?? error) });
      checks.sampleTranslateCallable = result(false, { error: 'Skipped because Translator.create() failed.' });
    }
  } else {
    checks.createCallableAfterUserGesture = result(false, { error: 'Translator is not visible.' });
    checks.sampleTranslateCallable = result(false, { error: 'Translator is not visible.' });
  }
  if (checks.languageDetectorVisible.ok) {
    try { const detector = await globalThis.LanguageDetector.create(); checks.languageDetectorCreateAndDetect = result(true, { detections: await detector.detect(SAMPLE_TEXT) }); }
    catch (error) { checks.languageDetectorCreateAndDetect = result(false, { error: String(error?.message ?? error) }); }
  } else checks.languageDetectorCreateAndDetect = result(false, { error: 'LanguageDetector is not visible.' });
  const decision = decideEngine(checks);
  return { kind: 'xlat-ai-context-spike-result', startedAt, completedAt: nowIso(), url: location.href, documentContext: 'injected-content-script-isolated-world', samplePair: SAMPLE_PAIR, userActivation, checks, events, decision, switchCondition: decision === ENGINE_DECISION.CONTENT_SCRIPT ? 'All required content-script checks passed.' : 'Use extension-document broker because at least one required content-script check failed.' };
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!isXlatMessage(message)) return false;
  if (message.type === MessageType.PING) { sendResponse({ ok: true, injected: true }); return false; }
  if (message.type === MessageType.GET_STATUS) { sendResponse({ ok: true, status: currentStatus }); return false; }
  if (message.type === MessageType.CLEAR_TRANSLATIONS) { sendResponse({ ok: true, removed: clearTranslations() }); return false; }
  if (message.type === MessageType.RUN_AI_CONTEXT_SPIKE) { runAiContextSpike().then((spike) => sendResponse({ ok: true, spike })).catch((error) => sendResponse({ ok: false, error: String(error?.message ?? error) })); return true; }
  if (message.type === MessageType.TRANSLATE_PAGE) { translatePage(message).then((summary) => sendResponse({ ok: true, summary })).catch((error) => sendResponse({ ok: false, error: String(error?.message ?? error) })); return true; }
  if (message.type === MessageType.TRANSLATE_SELECTION) { translateSelection(message).then((summary) => sendResponse({ ok: true, summary })).catch((error) => sendResponse({ ok: false, error: String(error?.message ?? error) })); return true; }
  return false;
});
