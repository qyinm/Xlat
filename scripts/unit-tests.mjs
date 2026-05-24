import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { normalizeText, stableBlockId, SKIP_SELECTOR, BLOCK_SELECTOR, shouldSkipElement, collectTranslatableBlocks } from '../src/content/dom-walker.js';
import { clearTranslations, appendTranslation, showSelectionOverlay } from '../src/content/renderer.js';
import { ENGINE_DECISION, decideEngine } from '../src/shared/status.js';
import { DEFAULT_SETTINGS } from '../src/shared/settings.js';
import { MessageType } from '../src/shared/messages.js';

assert.equal(normalizeText('  hello\n\tworld  '), 'hello world');
assert.equal(stableBlockId(0, 'same'), stableBlockId(0, 'same'));
assert.notEqual(stableBlockId(0, 'same'), stableBlockId(1, 'same'));
assert.ok(SKIP_SELECTOR.includes('script'));
assert.ok(SKIP_SELECTOR.includes('.xlat-translation'));
assert.ok(BLOCK_SELECTOR.includes('blockquote'));
assert.equal(DEFAULT_SETTINGS.targetLanguage, 'ko');
assert.equal(DEFAULT_SETTINGS.displayMode, 'append-below-original');
assert.equal(MessageType.TRANSLATE_PAGE, 'XLAT_TRANSLATE_PAGE');
assert.equal(MessageType.TRANSLATE_SELECTION, 'XLAT_TRANSLATE_SELECTION');
assert.equal(MessageType.CLEAR_TRANSLATIONS, 'XLAT_CLEAR_TRANSLATIONS');
const passing = {
  translatorVisible: { ok: true },
  languageDetectorVisible: { ok: true },
  availabilityCallable: { ok: true },
  createCallableAfterUserGesture: { ok: true },
  sampleTranslateCallable: { ok: true }
};
assert.equal(decideEngine(passing), ENGINE_DECISION.CONTENT_SCRIPT);
assert.equal(decideEngine({ ...passing, sampleTranslateCallable: { ok: false } }), ENGINE_DECISION.BROKER);

class FakeTextNode {
  constructor(text, parentElement) {
    this.nodeValue = text;
    this.parentElement = parentElement;
  }
}

class FakeElement {
  constructor(tagName, { parentElement = null, hidden = false, translated = false } = {}) {
    this.tagName = tagName.toLowerCase();
    this.nodeType = 1;
    this.parentElement = parentElement;
    this.children = [];
    this.textNodes = [];
    this.hidden = hidden;
    this.translated = translated;
    if (parentElement) parentElement.children.push(this);
  }
  appendText(text) {
    const node = new FakeTextNode(text, this);
    this.textNodes.push(node);
    return node;
  }
  matches(selector) {
    return selector.split(',').map((part) => part.trim()).includes(this.tagName) ||
      (selector.includes('.xlat-translation') && this.className === 'xlat-translation');
  }
  closest(selector) {
    for (let node = this; node; node = node.parentElement) {
      if (selector.split(',').map((part) => part.trim()).includes(node.tagName)) return node;
      if (selector.includes('.xlat-translation') && node.className === 'xlat-translation') return node;
    }
    return null;
  }
  querySelector(selector) {
    if (selector === ':scope > .xlat-translation' && this.translated) return { className: 'xlat-translation' };
    return null;
  }
}

function flattenTextNodes(root) {
  const nodes = [...root.textNodes];
  for (const child of root.children) nodes.push(...flattenTextNodes(child));
  return nodes;
}

const originalDocument = globalThis.document;
const originalNodeFilter = globalThis.NodeFilter;
const originalGetComputedStyle = globalThis.getComputedStyle;
globalThis.NodeFilter = { SHOW_TEXT: 4, FILTER_ACCEPT: 1, FILTER_REJECT: 2 };
globalThis.getComputedStyle = (element) => ({ display: element.hidden ? 'none' : 'block', visibility: element.hidden ? 'hidden' : 'visible' });
globalThis.document = {
  createTreeWalker(root, _show, filter) {
    const accepted = flattenTextNodes(root).filter((node) => filter.acceptNode(node) === globalThis.NodeFilter.FILTER_ACCEPT);
    let index = -1;
    return {
      currentNode: null,
      nextNode() {
        index += 1;
        this.currentNode = accepted[index] ?? null;
        return Boolean(this.currentNode);
      }
    };
  }
};
try {
  const root = new FakeElement('body');
  const article = new FakeElement('article', { parentElement: root });
  const paragraph = new FakeElement('p', { parentElement: article });
  const span = new FakeElement('span', { parentElement: paragraph });
  span.appendText(' Hello ');
  const strong = new FakeElement('strong', { parentElement: paragraph });
  strong.appendText(' world ');
  const code = new FakeElement('code', { parentElement: paragraph });
  code.appendText('doNotTranslate()');
  const hidden = new FakeElement('p', { parentElement: article, hidden: true });
  hidden.appendText('invisible text');
  const alreadyTranslated = new FakeElement('p', { parentElement: article, translated: true });
  alreadyTranslated.appendText('already handled');
  const duplicateOne = new FakeElement('p', { parentElement: article });
  duplicateOne.appendText('duplicate');
  const duplicateTwo = new FakeElement('p', { parentElement: article });
  duplicateTwo.appendText('duplicate');

  assert.equal(shouldSkipElement(code), true);
  assert.equal(shouldSkipElement(hidden), true);
  assert.equal(shouldSkipElement(span), false);
  const blocks = collectTranslatableBlocks(root, { minLength: 2, maxBlocks: 20 });
  assert.deepEqual(blocks.map((block) => block.text), ['Hello world', 'duplicate']);
  assert.equal(blocks[0].element, paragraph);
} finally {
  globalThis.document = originalDocument;
  globalThis.NodeFilter = originalNodeFilter;
  globalThis.getComputedStyle = originalGetComputedStyle;
}

class RenderNode {
  constructor(tagName = 'div') {
    this.tagName = tagName;
    this.children = [];
    this.parentElement = null;
    this.dataset = {};
    this.style = {};
    this.className = '';
    this.lang = '';
    this.textContent = '';
    this.removed = false;
    this.attributes = {};
    this.listeners = {};
  }
  setAttribute(name, value) {
    this.attributes[name] = String(value);
  }
  addEventListener(type, listener) {
    this.listeners[type] = listener;
  }
  insertAdjacentElement(_position, node) {
    const siblings = this.parentElement.children;
    const index = siblings.indexOf(this);
    node.parentElement = this.parentElement;
    siblings.splice(index + 1, 0, node);
  }
  querySelector(selector) {
    const id = selector.match(/data-xlat-id="([^"]+)"/)?.[1];
    return this.children.find((child) => child.className === 'xlat-translation' && child.dataset.xlatId === id) ?? null;
  }
  querySelectorAll(selector) {
    if (selector !== '.xlat-translation,.xlat-selection-overlay' && selector !== '.xlat-selection-overlay') return [];
    return this.children.filter((child) => selector.split(',').includes(`.${child.className}`));
  }
  appendChild(node) {
    node.parentElement = this;
    this.children.push(node);
  }
  remove() {
    this.removed = true;
    if (this.parentElement) this.parentElement.children = this.parentElement.children.filter((child) => child !== this);
  }
}

const originalCss = globalThis.CSS;
const originalWindow = globalThis.window;
const originalSelection = globalThis.getSelection;
const renderDocument = {
  body: new RenderNode('body'),
  createElement: (tag) => new RenderNode(tag),
  querySelectorAll(selector) { return this.body.querySelectorAll(selector); }
};
globalThis.CSS = { escape: (value) => String(value).replace(/"/g, '\\"') };
globalThis.window = { scrollX: 0, scrollY: 0 };
globalThis.document = renderDocument;
globalThis.getSelection = () => ({ rangeCount: 1, getRangeAt: () => ({ getBoundingClientRect: () => ({ left: 20, bottom: 40 }) }) });
try {
  const parent = new RenderNode('section');
  const original = new RenderNode('p');
  original.parentElement = parent;
  parent.children.push(original);
  const block = { id: 'block-1', element: original, text: 'Original text' };
  const first = appendTranslation(block, '첫 번역', { targetLanguage: 'ko', status: 'translated' });
  const second = appendTranslation(block, '수정 번역', { targetLanguage: 'ko', status: 'translated' });
  assert.equal(first, second);
  assert.equal(parent.children.filter((child) => child.className === 'xlat-translation').length, 1);
  assert.equal(parent.children[0], original);
  assert.equal(parent.children[1].textContent, '수정 번역');

  renderDocument.body.appendChild(parent.children[1]);
  const overlayA = showSelectionOverlay('선택 번역 A');
  const overlayB = showSelectionOverlay('선택 번역 B');
  assert.notEqual(overlayA, overlayB);
  assert.equal(renderDocument.body.children.filter((child) => child.className === 'xlat-selection-overlay').length, 1);
  assert.equal(clearTranslations(renderDocument), 2);
  assert.equal(renderDocument.body.children.length, 0);
} finally {
  globalThis.CSS = originalCss;
  globalThis.window = originalWindow;
  globalThis.getSelection = originalSelection;
  globalThis.document = originalDocument;
}

const contentScript = await readFile(new URL('../src/content/content-script.js', import.meta.url), 'utf8');
const listeners = [];
let lastResponse = null;
const sandbox = {
  console,
  Map,
  Set,
  Date,
  Error,
  Promise,
  RegExp,
  String,
  Boolean,
  Object,
  Array,
  Math,
  setTimeout,
  clearTimeout,
  addEventListener: () => {},
  removeEventListener: () => {},
  chrome: {
    runtime: {
      getURL: (path) => `chrome-extension://xlat/${path}`,
      onMessage: { addListener: (listener) => listeners.push(listener) }
    }
  },
  location: { protocol: 'https:', href: 'https://example.test/article' },
  document: {
    body: { querySelectorAll: () => [] },
    documentElement: { appendChild: () => {} },
    createElement: () => ({ hidden: false, dataset: {}, className: '', contentWindow: {}, set title(value) { this._title = value; }, set src(value) { this._src = value; } }),
    querySelectorAll: () => []
  },
  getComputedStyle: () => ({ display: 'block', visibility: 'visible' }),
  NodeFilter: { SHOW_TEXT: 4, FILTER_REJECT: 2, FILTER_ACCEPT: 1 },
  getSelection: () => ({ toString: () => '', rangeCount: 0 }),
  innerHeight: 800,
  innerWidth: 1200,
  scrollX: 0,
  scrollY: 0,
  CSS: { escape: (value) => value }
};
vm.createContext(sandbox);
vm.runInContext(contentScript, sandbox, { filename: 'src/content/content-script.js' });
assert.equal(listeners.length, 1);
assert.equal(listeners[0]({ type: MessageType.PING }, {}, (response) => { lastResponse = response; }), false);
assert.equal(lastResponse.ok, true);
assert.equal(lastResponse.injected, true);
assert.equal(listeners[0]({ type: MessageType.GET_STATUS }, {}, (response) => { lastResponse = response; }), false);
assert.equal(lastResponse.ok, true);
assert.equal(lastResponse.status.state, 'idle');
assert.equal(listeners[0]({ type: MessageType.CLEAR_TRANSLATIONS }, {}, (response) => { lastResponse = response; }), false);
assert.equal(lastResponse.ok, true);
assert.equal(lastResponse.removed, 0);
assert.equal(listeners[0]({ type: 'IGNORED' }, {}, () => {}), false);

console.log('Unit tests passed: shared contracts, DOM walker skip/group rules, renderer idempotency/cleanup, mocked content-script message handling, engine decision.');
