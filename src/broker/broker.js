const statusEl = document.querySelector('#status');
const translatorCache = new Map();
function setStatus(text) { if (statusEl) statusEl.textContent = text; }
function serializeError(error) { return { message: String(error?.message ?? error), name: error?.name ?? 'Error' }; }
async function detectLanguage(text, fallback = 'en') {
  if (!('LanguageDetector' in globalThis)) return { language: fallback, unavailable: true };
  const detector = await globalThis.LanguageDetector.create();
  const detections = await detector.detect(text);
  const first = Array.isArray(detections) ? detections[0] : detections;
  return { language: first?.detectedLanguage || first?.language || fallback, raw: detections };
}
async function getTranslator(sourceLanguage, targetLanguage, monitor) {
  if (!('Translator' in globalThis)) throw new Error('Translator unavailable in extension broker document.');
  const key = `${sourceLanguage}->${targetLanguage}`;
  if (translatorCache.has(key)) return translatorCache.get(key);
  const availability = await globalThis.Translator.availability({ sourceLanguage, targetLanguage });
  if (availability === 'unavailable') throw new Error(`Translation unavailable for ${key}.`);
  const translator = await globalThis.Translator.create({ sourceLanguage, targetLanguage, monitor });
  translatorCache.set(key, translator);
  return translator;
}
async function handleTranslate(payload) {
  const { id, text, sourceLanguage, targetLanguage = 'ko' } = payload;
  setStatus(`Translating ${id} locally...`);
  const detected = sourceLanguage ? { language: sourceLanguage } : await detectLanguage(text);
  if (detected.language === targetLanguage) return { id, ok: true, translatedText: text, sourceLanguage: detected.language, skipped: 'same-language' };
  const progress = [];
  const translator = await getTranslator(detected.language || 'en', targetLanguage, (monitorTarget) => {
    monitorTarget.addEventListener?.('downloadprogress', (event) => {
      const entry = { type: 'downloadprogress', loaded: event.loaded, total: event.total ?? null };
      progress.push(entry);
      parent.postMessage({ id, type: 'XLAT_BROKER_PROGRESS', progress: entry }, '*');
    });
  });
  const translatedText = await translator.translate(text);
  return { id, ok: true, translatedText, sourceLanguage: detected.language, progress };
}
addEventListener('message', (event) => {
  if (event.source !== parent) return;
  const message = event.data;
  if (!message || message.type !== 'XLAT_BROKER_TRANSLATE') return;
  handleTranslate(message)
    .then((response) => { parent.postMessage({ type: 'XLAT_BROKER_RESULT', ...response }, '*'); setStatus('Ready.'); })
    .catch((error) => { parent.postMessage({ type: 'XLAT_BROKER_RESULT', id: message.id, ok: false, error: serializeError(error) }, '*'); setStatus('Broker translation failed.'); });
});
setStatus('Ready.');
parent.postMessage({ type: 'XLAT_BROKER_READY' }, '*');
