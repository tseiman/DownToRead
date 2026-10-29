const { Marked } = require('marked');

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
}

function classifyLink(value) {
  if (typeof value !== 'string') return 'blocked';
  if (value.startsWith('#')) return 'internal';
  try { return ['http:', 'https:'].includes(new URL(value).protocol) ? 'external' : 'blocked'; }
  catch { return 'blocked'; }
}

function createMarkdownRenderer() {
  const renderer = {
    html({ text }) { return escapeHtml(text); },
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
