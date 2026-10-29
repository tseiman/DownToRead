const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { isMarkdownPath, isAllowedImagePath, parseLaunchPaths, resolveDocumentAsset } = require('../src/path-policy.cjs');

test('accepts Markdown extensions case-insensitively and rejects other files', () => {
  assert.equal(isMarkdownPath('/tmp/readme.MD'), true);
  assert.equal(isMarkdownPath('/tmp/readme.markdown'), true);
  assert.equal(isMarkdownPath('/tmp/readme.html'), false);
});

test('allows only supported local image extensions', () => {
  for (const name of ['a.svg', 'a.PNG', 'a.jpeg', 'a.webp', 'a.gif']) assert.equal(isAllowedImagePath(name), true);
  assert.equal(isAllowedImagePath('a.html'), false);
});

test('launch parsing ignores switches, duplicates, and non-Markdown paths', () => {
  assert.deepEqual(parseLaunchPaths(['electron', '--inspect=1', 'a.md', 'a.md', 'b.txt', 'c.markdown']), [path.resolve('a.md'), path.resolve('c.markdown')]);
});

test('asset resolution decodes file URLs and rejects unsupported or malformed assets', () => {
  const doc = path.resolve('/tmp/docs/readme.md');
  const absoluteImage = path.resolve('/tmp/picture.svg');
  assert.equal(resolveDocumentAsset(doc, './img/picture.png'), path.resolve('/tmp/docs/img/picture.png'));
  assert.equal(resolveDocumentAsset(doc, pathToFileURL(absoluteImage).href), absoluteImage);
  assert.equal(resolveDocumentAsset(doc, 'https://example.com/x.png'), null);
  assert.equal(resolveDocumentAsset(doc, './page.html'), null);
  assert.equal(resolveDocumentAsset(doc, '%E0%A4%A'), null);
});
