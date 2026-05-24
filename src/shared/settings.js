export const DEFAULT_SETTINGS = Object.freeze({
  targetLanguage: 'ko',
  displayMode: 'append-below-original',
  maxBlocks: 80,
  viewportOnly: false,
  includeCode: false
});

export async function loadSettings() {
  if (!globalThis.chrome?.storage?.sync) return { ...DEFAULT_SETTINGS };
  const stored = await chrome.storage.sync.get(DEFAULT_SETTINGS);
  return { ...DEFAULT_SETTINGS, ...stored };
}

export async function saveSettings(next) {
  if (!globalThis.chrome?.storage?.sync) return;
  await chrome.storage.sync.set(next);
}
