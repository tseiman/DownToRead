const test = require('node:test');
const assert = require('node:assert/strict');
const { createMarkdownRenderer, classifyLink } = require('../src/markdown-policy.cjs');

test('renders GFM while escaping raw HTML and preserving Mermaid source as text', () => {
  const render = createMarkdownRenderer();
  const html = render('# Hello\n\n- [x] done\n\n<script>alert(1)</script>\n\n```mermaid\ngraph TD; A-->B\n```');
  assert.match(html, /<h1>Hello<\/h1>/);
  assert.match(html, /type="checkbox"/);
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /class="mermaid"/);
  assert.match(html, /graph TD; A--&gt;B/);
});

test('classifies only http(s) as external and hashes as internal', () => {
  assert.equal(classifyLink('https://example.com'), 'external');
  assert.equal(classifyLink('http://example.com'), 'external');
  assert.equal(classifyLink('#section'), 'internal');
  for (const unsafe of ['javascript:alert(1)', 'data:text/html,x', 'file:///tmp/a']) assert.equal(classifyLink(unsafe), 'blocked');
});
