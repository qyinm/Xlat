import { TranslationEngineUnavailableError } from './translation-engine.js';

export class ContentDocumentTranslationEngine {
  #translatorCache = new Map();

  async checkAvailability({ sourceLanguage, targetLanguage }) {
    if (!('Translator' in globalThis)) {
      return { state: 'unsupported', reason: 'Translator constructor missing in this document context.' };
    }
    const availability = await globalThis.Translator.availability({ sourceLanguage, targetLanguage });
    return { state: availability };
  }

  async detectLanguage(text) {
    if (!('LanguageDetector' in globalThis)) {
      return { language: undefined, confidence: 0, unavailable: true };
    }
    const detector = await globalThis.LanguageDetector.create();
    const results = await detector.detect(text);
    return Array.isArray(results) ? results[0] : results;
  }

  async translate({ text, sourceLanguage, targetLanguage, monitor }) {
    if (!('Translator' in globalThis)) {
      throw new TranslationEngineUnavailableError('Translator is unavailable in this document context.');
    }
    const key = `${sourceLanguage}->${targetLanguage}`;
    let translator = this.#translatorCache.get(key);
    if (!translator) {
      translator = await globalThis.Translator.create({ sourceLanguage, targetLanguage, monitor });
      this.#translatorCache.set(key, translator);
    }
    return translator.translate(text);
  }

  cancel() {
    this.#translatorCache.clear();
  }
}
