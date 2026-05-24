import { TranslationEngineUnavailableError } from './translation-engine.js';

export class ExtensionDocumentBrokerTranslationEngine {
  async checkAvailability() {
    return { state: 'broker-not-implemented', reason: 'Broker engine is the planned fallback if the content-script spike fails.' };
  }

  async detectLanguage() {
    throw new TranslationEngineUnavailableError('Extension document broker is not implemented in the spike scaffold.');
  }

  async translate() {
    throw new TranslationEngineUnavailableError('Extension document broker is not implemented in the spike scaffold.');
  }

  cancel() {}
}
