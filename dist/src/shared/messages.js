export const XLAT_CONTEXT_MENU_TRANSLATE_SELECTION = 'xlat-translate-selection';

export const MessageType = Object.freeze({
  RUN_AI_CONTEXT_SPIKE: 'XLAT_RUN_AI_CONTEXT_SPIKE',
  TRANSLATE_PAGE: 'XLAT_TRANSLATE_PAGE',
  TRANSLATE_SELECTION: 'XLAT_TRANSLATE_SELECTION',
  CLEAR_TRANSLATIONS: 'XLAT_CLEAR_TRANSLATIONS',
  GET_STATUS: 'XLAT_GET_STATUS',
  PING: 'XLAT_PING'
});

export function isXlatMessage(message) {
  return Boolean(message && typeof message === 'object' && typeof message.type === 'string' && message.type.startsWith('XLAT_'));
}
