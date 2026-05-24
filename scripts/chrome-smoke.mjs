import assert from 'node:assert/strict';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';

const chromePath = process.env.CHROME_BIN || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const userDataDir = await mkdtemp(join(tmpdir(), 'xlat-chrome-smoke-'));
const port = 9333 + Math.floor(Math.random() * 1000);
const fixtureUrl = `file://${resolve('test-fixtures/pages/simple-article.html')}`;
const chrome = spawn(chromePath, [
  '--headless=new',
  '--disable-gpu',
  '--no-first-run',
  '--no-default-browser-check',
  `--user-data-dir=${userDataDir}`,
  `--remote-debugging-port=${port}`,
  fixtureUrl
], { stdio: ['ignore', 'pipe', 'pipe'] });

let stderr = '';
chrome.stderr.on('data', (chunk) => { stderr += chunk.toString(); });

async function waitForJson() {
  const url = `http://127.0.0.1:${port}/json`;
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return response.json();
    } catch (_) {}
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error(`Chrome DevTools endpoint did not become ready. ${stderr.slice(0, 500)}`);
}

async function cdp(wsUrl) {
  const ws = new WebSocket(wsUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true });
    ws.addEventListener('error', reject, { once: true });
  });
  let id = 0;
  const pending = new Map();
  ws.addEventListener('message', (event) => {
    const message = JSON.parse(event.data);
    if (!message.id) return;
    const callbacks = pending.get(message.id);
    if (!callbacks) return;
    pending.delete(message.id);
    if (message.error) callbacks.reject(new Error(message.error.message));
    else callbacks.resolve(message.result);
  });
  return {
    send(method, params = {}) {
      const requestId = ++id;
      const promise = new Promise((resolve, reject) => pending.set(requestId, { resolve, reject }));
      ws.send(JSON.stringify({ id: requestId, method, params }));
      return promise;
    },
    close() { ws.close(); }
  };
}

async function evaluate(client, expression) {
  const result = await client.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text || 'Runtime evaluation failed');
  }
  return result.result.value;
}

try {
  const targets = await waitForJson();
  const page = targets.find((target) => target.type === 'page' && target.url.includes('simple-article.html')) || targets.find((target) => target.type === 'page');
  if (!page?.webSocketDebuggerUrl) throw new Error('No debuggable Chrome page target found.');
  const client = await cdp(page.webSocketDebuggerUrl);
  await client.send('Runtime.enable');

  const contentScript = await readFile('src/content/content-script.js', 'utf8');

  await evaluate(client, `
    globalThis.__xlatRuntimeMessages = [];
    if (!globalThis.chrome) globalThis.chrome = {};
    globalThis.chrome.runtime = {
      getURL(path) { return 'about:blank#' + path; },
      onMessage: { addListener(listener) { globalThis.__xlatMessageListener = listener; } }
    };
    globalThis.LanguageDetector = { create: async () => ({ detect: async () => [{ detectedLanguage: 'en', confidence: 0.99 }] }) };
    globalThis.Translator = {
      availability: async () => 'available',
      create: async () => ({ translate: async (text) => '[ko] ' + text })
    };
    undefined;
  `);

  await evaluate(client, `${contentScript}\nundefined;`);

  const smoke = await evaluate(client, `(async () => {
    function send(message) {
      return new Promise((resolve) => __xlatMessageListener(message, {}, resolve));
    }
    const page = await send({ type: 'XLAT_TRANSLATE_PAGE', targetLanguage: 'ko', maxBlocks: 10 });
    const originals = [...document.querySelectorAll('article h1, article p')].map((node) => node.textContent);
    const translations = [...document.querySelectorAll('.xlat-translation')].map((node) => ({ text: node.textContent, status: node.dataset.xlatStatus, lang: node.lang }));
    const selection = await send({ type: 'XLAT_TRANSLATE_SELECTION', text: 'Selected text', targetLanguage: 'ko' });
    const overlay = document.querySelector('.xlat-selection-overlay')?.textContent || '';
    const clear = await send({ type: 'XLAT_CLEAR_TRANSLATIONS' });
    return { page, originals, translations, selection, overlay, clear, remaining: document.querySelectorAll('.xlat-translation,.xlat-selection-overlay').length };
  })()`);
  if (!smoke.page.ok) console.log('Chrome smoke debug', JSON.stringify(smoke, null, 2));
  assert.equal(smoke.page.ok, true);
  assert.equal(smoke.page.summary.total, 3);
  assert.deepEqual(smoke.originals, ['Hello world', 'This is a local translation fixture.', 'Este párrafo comprueba una página multilingüe simple.']);
  assert.equal(smoke.translations.length, 3);
  assert.ok(smoke.translations.every((entry) => entry.text.startsWith('[ko] ') && entry.status === 'translated' && entry.lang === 'ko'));
  assert.equal(smoke.selection.ok, true);
  assert.equal(smoke.selection.summary.translated, '[ko] Selected text');
  assert.equal(smoke.overlay, '[ko] Selected text');
  assert.equal(smoke.clear.ok, true);
  assert.equal(smoke.remaining, 0);

  client.close();
  console.log('Chrome smoke passed: multilingual fixture, content-script page append-below-original, selection overlay, clear flow with mocked local Translator APIs.');
} finally {
  if (!chrome.killed) chrome.kill('SIGTERM');
  await new Promise((resolve) => {
    const timeout = setTimeout(resolve, 2000);
    chrome.once('exit', () => { clearTimeout(timeout); resolve(); });
  });
  await rm(userDataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
