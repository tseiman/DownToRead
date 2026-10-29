(() => {
  const root = document.getElementById('document');
  const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const renderer = {
    html({ text }) { return escapeHtml(text); },
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

  async function renderDocument(payload) {
    document.title = payload.title ? `${payload.title} — DownToRead` : 'DownToRead';
    const dirty = marked.parse(payload.markdown || '');
    root.innerHTML = DOMPurify.sanitize(dirty, { USE_PROFILES: { html: true }, FORBID_TAGS: ['script','style','iframe','object','embed','form'], FORBID_ATTR: ['style'] });
    assignHeadingIds();
    const imageLoads = [];
    for (const image of root.querySelectorAll('img')) {
      const source = image.getAttribute('src') || '';
      const safe = await window.downToRead.assetUrl(source);
      if (!safe) {
        image.removeAttribute('src');
        image.title = `Local image not found: ${source}`;
        imageLoads.push(Promise.resolve(false));
        continue;
      }
      image.src = safe;
      imageLoads.push(image.decode().then(() => true).catch(() => {
        image.removeAttribute('src');
        image.title = `Local image could not be decoded: ${source}`;
        return false;
      }));
    }
    for (const anchor of root.querySelectorAll('a')) {
      const href = anchor.getAttribute('href') || '';
      if (!href.startsWith('#')) anchor.addEventListener('click', async (event) => {
        event.preventDefault();
        const opened = await window.downToRead.openDocumentLink(href);
        if (!opened && /^https?:\/\//i.test(href)) await window.downToRead.openExternal(href);
      });
    }
    try { await mermaid.run({ nodes: root.querySelectorAll('.mermaid'), suppressErrors: false }); }
    catch (error) { for (const node of root.querySelectorAll('.mermaid[data-processed]')) node.classList.add('mermaid-error'); }
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
  document.addEventListener('dragover', (event) => event.preventDefault());
  document.addEventListener('drop', async (event) => {
    event.preventDefault();
    if (event.dataTransfer?.files?.length !== 1) return;
    await window.downToRead.openDroppedFile(event.dataTransfer.files[0]);
  });
  window.downToRead.onDocument(renderDocument);
  window.downToRead.ready();
})();
