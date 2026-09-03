(() => {
  const BRAND = 'JM WorkLog';
  const BRAND_UPPER = 'JM WORKLOG';

  const replaceBrandText = value => {
    if (typeof value !== 'string' || !value) return value;
    return value
      .replace(/Employee\s*\/\s*VA/gi, 'Personal')
      .replace(/Virtual Assistants?/gi, 'User')
      .replace(/VA Name/gi, 'Name')
      .replace(/VA Time Record/gi, 'Work Record')
      .replace(/\bVA\b/g, 'Personal')
      .replace(/WORKWATCH/g, BRAND_UPPER)
      .replace(/WorkWatch/g, BRAND);
  };

  const replaceFilenameBrand = value => {
    if (typeof value !== 'string' || !value) return value;
    return value
      .replace(/WorkWatch/g, 'JM_WorkLog')
      .replace(/WORKWATCH/g, 'JM_WORKLOG')
      .replace(/_VA_/g, '_')
      .replace(/\bVA\b/g, '');
  };

  function patchElementAttributes(root) {
    const elements = [];
    if (root?.nodeType === Node.ELEMENT_NODE) elements.push(root);
    if (root?.querySelectorAll) elements.push(...root.querySelectorAll('*'));

    elements.forEach(el => {
      ['title', 'placeholder', 'aria-label', 'data-label'].forEach(attr => {
        if (!el.hasAttribute?.(attr)) return;
        const current = el.getAttribute(attr);
        const next = replaceBrandText(current);
        if (next !== current) el.setAttribute(attr, next);
      });
    });
  }

  function patchTextNodes(root) {
    if (!root) return;
    if (root.nodeType === Node.TEXT_NODE) {
      const next = replaceBrandText(root.nodeValue || '');
      if (next !== root.nodeValue) root.nodeValue = next;
      return;
    }

    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const nodes = [];
    let node;
    while ((node = walker.nextNode())) nodes.push(node);
    nodes.forEach(textNode => {
      const next = replaceBrandText(textNode.nodeValue || '');
      if (next !== textNode.nodeValue) textNode.nodeValue = next;
    });
  }

  function patchBrand(root = document.body) {
    if (!root) return;
    patchTextNodes(root);
    patchElementAttributes(root);

    document.querySelectorAll('.wordmark-mark').forEach(mark => {
      if (mark.textContent !== 'JM') mark.textContent = 'JM';
    });
  }

  document.title = 'JM WorkLog — Personal Work Record';
  const description = document.querySelector('meta[name="description"]');
  if (description) description.setAttribute('content', 'Personal task time tracking, work evidence, and client-ready reporting.');

  try {
    if (typeof CONFIG !== 'undefined') CONFIG.APP_NAME = BRAND;
    if (window.WORKWATCH_CONFIG) window.WORKWATCH_CONFIG.APP_NAME = BRAND;
  } catch {}

  // Generated reports are opened in a new window and written as HTML strings.
  // Rewrite only their user-facing branding before the content is rendered.
  const nativeOpen = window.open.bind(window);
  window.open = function (...args) {
    const child = nativeOpen(...args);
    if (!child) return child;
    try {
      const nativeWrite = child.document.write.bind(child.document);
      child.document.write = (...parts) => nativeWrite(...parts.map(part => typeof part === 'string' ? replaceBrandText(part) : part));
    } catch {}
    return child;
  };

  // Keep downloaded CSV/report filenames aligned with the personal brand.
  const nativeAnchorClick = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function () {
    if (this.download) this.download = replaceFilenameBrand(this.download);
    return nativeAnchorClick.call(this);
  };

  const observer = new MutationObserver(records => {
    for (const record of records) {
      if (record.type === 'characterData') patchTextNodes(record.target);
      record.addedNodes?.forEach(node => {
        if (node.nodeType === Node.TEXT_NODE || node.nodeType === Node.ELEMENT_NODE) patchBrand(node);
      });
    }
    document.querySelectorAll('.wordmark-mark').forEach(mark => {
      if (mark.textContent !== 'JM') mark.textContent = 'JM';
    });
  });

  observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true });
  queueMicrotask(() => patchBrand(document.body));

  const style = document.createElement('style');
  style.textContent = '.wordmark-mark{font-size:10px;letter-spacing:-.02em}';
  document.head.appendChild(style);
})();
