(() => {
  const root = document.getElementById('document');
  const historyZone = document.getElementById('history-hover-zone');
  const historyBack = document.getElementById('history-back');
  const historyHome = document.getElementById('history-home');
  const historyForward = document.getElementById('history-forward');
  const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const renderer = {
    code({ text, lang }) {
      return (lang || '').trim().toLowerCase() === 'mermaid'
        ? `<div class="mermaid">${escapeHtml(text)}</div>`
        : `<pre><code>${escapeHtml(text)}</code></pre>`;
    }
  };
  marked.use({ gfm: true, renderer });
  mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme: 'neutral' });

  function assignHeadingIds() {
    const seen = new Map();
    for (const heading of root.querySelectorAll('h1,h2,h3,h4,h5,h6')) {
      if (heading.id) continue;
      const base = (heading.textContent || '').trim().toLowerCase()
        .replace(/[^\p{L}\p{N}\s-]/gu, '')
        .replace(/\s+/g, '-')
        .replace(/-+/g, '-');
      if (!base) continue;
      const count = seen.get(base) || 0;
      seen.set(base, count + 1);
      heading.id = count ? `${base}-${count}` : base;
    }
  }

  async function loadLocalImage(image, source) {
    const safe = await window.downToRead.assetUrl(source);
    if (!safe) {
      image.removeAttribute('src');
      image.title = `Local image not found: ${source}`;
      return false;
    }
    image.crossOrigin = 'anonymous';
    image.src = safe;
    try {
      await image.decode();
      return true;
    } catch {
      image.removeAttribute('src');
      image.title = `Local image could not be decoded: ${source}`;
      return false;
    }
  }

  function setHistoryState(state) {
    historyBack.disabled = !state?.canBack;
    historyHome.disabled = !state?.canHome;
    historyForward.disabled = !state?.canForward;
  }

  async function renderDocument(payload) {
    document.title = payload.title ? `${payload.title} — DownToRead` : 'DownToRead';
    setHistoryState(payload.history);
    document.documentElement.dataset.ready = 'false';
    root.className = 'markdown-body';

    if (payload.mode === 'text') {
      root.className = 'markdown-body plain-text';
      root.textContent = payload.text || '';
      document.documentElement.dataset.ready = 'true';
      return;
    }

    if (payload.mode === 'image') {
      root.className = 'markdown-body image-document';
      root.replaceChildren();
      const image = document.createElement('img');
      image.alt = payload.title || 'Image';
      root.append(image);
      await loadLocalImage(image, payload.source || '');
      document.documentElement.dataset.ready = 'true';
      return;
    }

    const dirty = marked.parse(payload.markdown || '');
    root.innerHTML = DOMPurify.sanitize(dirty, { USE_PROFILES: { html: true }, FORBID_TAGS: ['script','style','iframe','object','embed','form'], FORBID_ATTR: ['style'] });
    assignHeadingIds();
    const imageLoads = [];
    for (const image of root.querySelectorAll('img')) {
      const source = image.getAttribute('src') || '';
      imageLoads.push(loadLocalImage(image, source));
    }
    for (const anchor of root.querySelectorAll('a[href]')) {
      const href = anchor.getAttribute('href') || '';
      if (!href.startsWith('#')) anchor.addEventListener('click', async (event) => {
        event.preventDefault();
        await window.downToRead.openLink(href);
      });
    }
    try { await mermaid.run({ nodes: root.querySelectorAll('.mermaid'), suppressErrors: false }); }
    catch { for (const node of root.querySelectorAll('.mermaid[data-processed]')) node.classList.add('mermaid-error'); }
    const localImagesLoaded = (await Promise.all(imageLoads)).every(Boolean);
    if (payload.fragment) document.getElementById(payload.fragment)?.scrollIntoView();
    document.documentElement.dataset.ready = 'true';
    window.downToRead.rendered({
      markdown: Boolean(root.querySelector('h1')),
      mermaid: Boolean(root.querySelector('.mermaid svg')),
      relativeImage: Boolean(root.querySelector('img[src^="downtoread-asset:"]')),
      localImagesLoaded
    });
  }

  async function copyImage(imageIndex) {
    if (!Number.isInteger(imageIndex) || imageIndex < 0) return;
    const image = root.querySelectorAll('img')[imageIndex];
    if (!image || !image.complete || !image.naturalWidth || !image.naturalHeight) return;
    if (image.naturalWidth * image.naturalHeight > 40_000_000) return;
    const canvas = document.createElement('canvas');
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const context = canvas.getContext('2d');
    if (!context) return;
    try {
      context.drawImage(image, 0, 0);
      await window.downToRead.copyImageToClipboard(canvas.toDataURL('image/png'));
    } catch { /* A failed copy leaves the clipboard unchanged. */ }
  }

  document.addEventListener('contextmenu', async (event) => {
    event.preventDefault();
    const element = event.target instanceof Element ? event.target : null;
    const anchor = element?.closest('a[href]');
    const image = element?.closest('img');
    const images = Array.from(root.querySelectorAll('img'));
    await window.downToRead.showContextMenu({
      selectionText: String(window.getSelection()?.toString() || '').slice(0, 8192),
      linkHref: String(anchor?.getAttribute('href') || '').slice(0, 8192),
      imageIndex: image ? images.indexOf(image) : -1
    });
  });
  window.downToRead.onCopyImageRequest(copyImage);
  historyZone.addEventListener('pointermove', (event) => {
    const box = historyZone.getBoundingClientRect();
    const lightX = Math.max(0, Math.min(100, ((event.clientX - box.left) / box.width) * 100));
    historyZone.style.setProperty('--light-x', `${lightX}%`);
  });
  historyBack.addEventListener('click', () => window.downToRead.navigateHistory('back'));
  historyHome.addEventListener('click', () => window.downToRead.navigateHistory('home'));
  historyForward.addEventListener('click', () => window.downToRead.navigateHistory('forward'));

  document.addEventListener('dragover', (event) => event.preventDefault());
  document.addEventListener('drop', async (event) => {
    event.preventDefault();
    if (event.dataTransfer?.files?.length !== 1) return;
    await window.downToRead.openDroppedFile(event.dataTransfer.files[0]);
  });
  window.downToRead.onDocument(renderDocument);
  window.downToRead.ready();
})();
