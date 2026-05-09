// Runs on arxiv.org/abs/* at document_idle. Bundled as IIFE (see vite.content.config.ts).
(function injectPaperFlowButton() {
  if (document.querySelector('.pf-open-btn')) return;

  // Pick the first matching insertion point. arXiv's abs page class/id names
  // have churned over the years; cover the common ones plus `main` as a catch-all.
  const header =
    document.querySelector<HTMLElement>('.extra-services') ||
    document.querySelector<HTMLElement>('.abstract') ||
    document.querySelector<HTMLElement>('.full-text') ||
    document.querySelector<HTMLElement>('#abs') ||
    document.querySelector<HTMLElement>('main') ||
    document.body;
  if (!header) return;

  const btn = document.createElement('button');
  btn.className = 'pf-open-btn';
  btn.textContent = 'Open in PaperFlow →';
  Object.assign(btn.style, {
    display: 'inline-block',
    padding: '6px 14px',
    margin: '8px 0',
    background: '#8B6B3E',
    color: '#FBF7EE',
    border: 'none',
    borderRadius: '4px',
    cursor: 'pointer',
    fontSize: '13px',
    fontWeight: '500',
  });

  btn.addEventListener('click', () => {
    const absUrl = location.href;
    const htmlUrl = absUrl.replace('/abs/', '/html/');
    // Use #src= (fragment) to match DNR rules — avoids URL & splitting.
    // No encoding needed because fragment survives as-is.
    const readerUrl = chrome.runtime.getURL(`reader/index.html#src=${htmlUrl}`);
    location.href = readerUrl;
  });

  header.prepend(btn);
})();
