export const SKIP_SELECTOR = [
  'script', 'style', 'noscript', 'textarea', 'input', 'select', 'option',
  'code', 'pre', 'kbd', 'samp', 'svg', 'canvas', 'iframe', 'button', 'nav',
  '[contenteditable="true"]', '[aria-hidden="true"]', '[role="tooltip"]', '[role="button"]', '[role="menu"]', '[role="navigation"]',
  '.xlat-translation', '.xlat-selection-overlay'
].join(',');

export const BLOCK_SELECTOR = 'p,li,blockquote,h1,h2,h3,h4,h5,h6,td,th,figcaption,caption,article,section,div';

export function normalizeText(text) {
  return String(text ?? '').replace(/\s+/g, ' ').trim();
}

export function stableBlockId(index, text) {
  let hash = 5381;
  for (const char of text) hash = ((hash << 5) + hash) ^ char.charCodeAt(0);
  return `xlat-${index}-${(hash >>> 0).toString(36)}`;
}

export function shouldSkipElement(element) {
  if (!element || element.nodeType !== 1) return false;
  if (element.matches(SKIP_SELECTOR) || element.closest(SKIP_SELECTOR)) return true;
  const style = globalThis.getComputedStyle?.(element);
  return style?.display === 'none' || style?.visibility === 'hidden';
}

export function collectTranslatableBlocks(root = document.body, { minLength = 2, maxBlocks = 160 } = {}) {
  if (!root) return [];
  const blockMap = new Map();
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
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
