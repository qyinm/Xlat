export const ENGINE_DECISION = Object.freeze({
  CONTENT_SCRIPT: 'content-script',
  BROKER: 'extension-document-broker',
  UNKNOWN: 'unknown'
});

export const SPIKE_REQUIRED_CHECKS = Object.freeze([
  'translatorVisible',
  'languageDetectorVisible',
  'availabilityCallable',
  'createCallableAfterUserGesture',
  'sampleTranslateCallable'
]);

export function decideEngine(checks) {
  const failures = SPIKE_REQUIRED_CHECKS.filter((key) => checks[key]?.ok !== true);
  return failures.length === 0 ? ENGINE_DECISION.CONTENT_SCRIPT : ENGINE_DECISION.BROKER;
}

export function nowIso() {
  return new Date().toISOString();
}
