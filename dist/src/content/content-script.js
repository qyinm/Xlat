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
const SKIP_SELECTOR = 'script,style,noscript,textarea,input,select,option,code,pre,kbd,samp,svg,canvas,iframe,[contenteditable="true"],[aria-hidden="true"],.xlat-translation,.xlat-selection-overlay';
const BLOCK_SELECTOR = 'p,li,blockquote,h1,h2,h3,h4,h5,h6,td,th,figcaption,caption,article,section,div';
const translatorCache = new Map();

let brokerFrame = null;
let brokerReadyPromise = null;
let brokerSeq = 0;
const brokerPending = new Map();

function ensureBrokerFrame() {
  if (brokerReadyPromise) return brokerReadyPromise;
  brokerReadyPromise = new Promise((resolve, reject) => {
    const frame = document.createElement('iframe');
    frame.hidden = true;
    frame.title = 'Xlat local translation broker';
    frame.dataset.xlatOwned = 'true';
    frame.className = 'xlat-broker-frame';
    frame.src = chrome.runtime.getURL('src/broker/broker.html');
    const timeout = setTimeout(() => reject(new Error('Broker frame did not become ready.')), 5000);
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
      reject(new Error('Broker translation timed out.'));
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
  else pending.reject(new Error(message.error?.message || 'Broker translation failed.'));
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
function collectBlocks({ minLength = 2, maxBlocks = 160, viewportOnly = false } = {}) {
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
function appendTranslation(block, translatedText, { targetLanguage = 'unknown', status = 'translated' } = {}) {
  const existing = block.element.parentElement?.querySelector(`.xlat-translation[data-xlat-id="${CSS.escape(block.id)}"]`);
  const node = existing || document.createElement('div');
  node.className = 'xlat-translation';
  node.dataset.xlatOwned = 'true';
  node.dataset.xlatId = block.id;
  node.dataset.xlatStatus = status;
  node.lang = targetLanguage;
  node.textContent = translatedText;
  if (!existing) block.element.insertAdjacentElement('afterend', node);
  return node;
}
function clearTranslations() { const nodes = document.querySelectorAll('.xlat-translation,.xlat-selection-overlay'); nodes.forEach((node) => node.remove()); return nodes.length; }
function showSelectionOverlay(text) {
  document.querySelectorAll('.xlat-selection-overlay').forEach((node) => node.remove());
  const selection = getSelection();
  const rect = selection?.rangeCount ? selection.getRangeAt(0).getBoundingClientRect() : { left: 12, bottom: 12 };
  const overlay = document.createElement('div');
  overlay.className = 'xlat-selection-overlay';
  overlay.dataset.xlatOwned = 'true';
  overlay.textContent = text;
  overlay.style.left = `${Math.max(8, rect.left + scrollX)}px`;
  overlay.style.top = `${Math.max(8, rect.bottom + scrollY + 8)}px`;
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
    if (availability === 'unavailable') throw new Error(`Translation unavailable for ${key}.`);
    translator = await globalThis.Translator.create({ sourceLanguage: source, targetLanguage });
    translatorCache.set(key, translator);
  }
  return translator.translate(text);
}
async function translatePage(options = {}) {
  if (isRestrictedPage()) throw new Error(`Unsupported page for content script translation: ${location.href}`);
  const targetLanguage = options.targetLanguage || 'ko';
  const blocks = collectBlocks({ maxBlocks: options.maxBlocks || 80, viewportOnly: Boolean(options.viewportOnly) });
  setStatus({ state: 'translating-page', completed: 0, total: blocks.length, error: null });
  for (const block of blocks) {
    try {
      appendTranslation(block, `Translating to ${targetLanguage}...`, { targetLanguage, status: 'loading' });
      const translated = await translateLocal(block.text, { targetLanguage });
      appendTranslation(block, translated, { targetLanguage, status: 'translated' });
    } catch (error) {
      appendTranslation(block, `Xlat unavailable locally: ${String(error?.message ?? error)}`, { targetLanguage, status: 'error' });
    }
    setStatus({ completed: currentStatus.completed + 1 });
  }
  setStatus({ state: 'idle' });
  return { total: blocks.length, completed: blocks.length };
}
async function translateSelection(options = {}) {
  const text = normalizeText(options.text || getSelection()?.toString() || '');
  if (!text) throw new Error('No selected text to translate.');
  const targetLanguage = options.targetLanguage || 'ko';
  setStatus({ state: 'translating-selection', total: 1, completed: 0, error: null });
  try {
    const translated = await translateLocal(text, { targetLanguage });
    showSelectionOverlay(translated);
    setStatus({ state: 'idle', completed: 1 });
    return { text, translated };
  } catch (error) {
    const message = `Xlat unavailable locally: ${String(error?.message ?? error)}`;
    showSelectionOverlay(message);
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
