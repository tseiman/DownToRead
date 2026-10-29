const test = require('node:test');
const assert = require('node:assert/strict');
const { createMarkdownRenderer, classifyLink } = require('../src/markdown-policy.cjs');

test('renders GFM, safe HTML candidates, and Mermaid source for browser sanitization', () => {
  const render = createMarkdownRenderer();
  const html = render('# Hello\n\n- [x] done\n\n<details><summary>More</summary><a href="notes.txt">Notes</a></details>\n\n```mermaid\ngraph TD; A-->B\n```');
  assert.match(html, /<h1>Hello<\/h1>/);
  assert.match(html, /type="checkbox"/);
  assert.match(html, /<details>/);
  assert.match(html, /<a href="notes.txt">Notes<\/a>/);
  assert.match(html, /class="mermaid"/);
  assert.match(html, /graph TD; A--&gt;B/);
});

test('classifies local, external, confirmation, and blocked links', () => {
  assert.equal(classifyLink('https://example.com'), 'external');
  assert.equal(classifyLink('http://example.com'), 'confirmation');
  assert.equal(classifyLink('mailto:reader@example.com'), 'confirmation');
  assert.equal(classifyLink('notes/readme.md'), 'local');
  assert.equal(classifyLink('file:///tmp/a.txt'), 'local');
  assert.equal(classifyLink('#section'), 'internal');
  for (const unsafe of ['javascript:alert(1)', 'data:text/html,x', 'blob:https://example.com/id']) assert.equal(classifyLink(unsafe), 'blocked');
});
