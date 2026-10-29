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

  async function renderDocument(payload) {
    document.title = payload.title ? `${payload.title} — DownToRead` : 'DownToRead';
    const dirty = marked.parse(payload.markdown || '');
    root.innerHTML = DOMPurify.sanitize(dirty, { USE_PROFILES: { html: true }, FORBID_TAGS: ['script','style','iframe','object','embed','form'], FORBID_ATTR: ['style'] });
    for (const image of root.querySelectorAll('img')) {
      const safe = await window.downToRead.assetUrl(image.getAttribute('src') || '');
      if (safe) image.src = safe; else image.removeAttribute('src');
    }
    for (const anchor of root.querySelectorAll('a')) {
      const href = anchor.getAttribute('href') || '';
      if (/^https?:\/\//i.test(href)) anchor.addEventListener('click', (event) => { event.preventDefault(); window.downToRead.openExternal(href); });
      else if (!href.startsWith('#')) anchor.removeAttribute('href');
    }
    try { await mermaid.run({ nodes: root.querySelectorAll('.mermaid'), suppressErrors: false }); }
    catch (error) { for (const node of root.querySelectorAll('.mermaid[data-processed]')) node.classList.add('mermaid-error'); }
    document.documentElement.dataset.ready = 'true';
    window.downToRead.rendered({
      markdown: Boolean(root.querySelector('h1')),
      mermaid: Boolean(root.querySelector('.mermaid svg')),
      relativeImage: Boolean(root.querySelector('img[src^="downtoread-asset:"]'))
    });
  }
  window.downToRead.onDocument(renderDocument);
  window.downToRead.ready();
})();
