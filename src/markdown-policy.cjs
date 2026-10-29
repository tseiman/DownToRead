const { Marked } = require('marked');

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
}

function classifyLink(value) {
  if (typeof value !== 'string' || !value) return 'blocked';
  if (value.startsWith('#')) return 'internal';
  if (!/^[a-z][a-z0-9+.-]*:/i.test(value)) return 'local';
  try {
    const protocol = new URL(value).protocol;
    if (protocol === 'file:') return 'local';
    if (protocol === 'https:') return 'external';
    if (['javascript:', 'data:', 'blob:'].includes(protocol)) return 'blocked';
    return 'confirmation';
  } catch { return 'blocked'; }
}

function createMarkdownRenderer() {
  const renderer = {
    code({ text, lang }) {
      if ((lang || '').trim().toLowerCase() === 'mermaid') return `<div class="mermaid">${escapeHtml(text)}</div>\n`;
      const language = lang ? ` class="language-${escapeHtml(lang)}"` : '';
      return `<pre><code${language}>${escapeHtml(text)}</code></pre>\n`;
    }
  };
  const marked = new Marked({ gfm: true, breaks: false, renderer });
  return (source) => marked.parse(String(source));
}

module.exports = { classifyLink, createMarkdownRenderer, escapeHtml };
