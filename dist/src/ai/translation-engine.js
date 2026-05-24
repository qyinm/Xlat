/**
 * @typedef {Object} TranslationEngine
 * @property {(pair: {sourceLanguage: string, targetLanguage: string}) => Promise<object>} checkAvailability
 * @property {(text: string) => Promise<object>} detectLanguage
 * @property {(input: {text: string, sourceLanguage: string, targetLanguage: string}) => Promise<string>} translate
 * @property {() => void} cancel
 */

export class TranslationEngineUnavailableError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'TranslationEngineUnavailableError';
    this.details = details;
  }
}
