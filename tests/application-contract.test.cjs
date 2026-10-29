const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const read = (name) => fs.readFileSync(path.join(root, name), 'utf8');

test('BrowserWindow and CSP use a sandboxed isolated renderer', () => {
  const main = read('src/main.cjs');
  assert.match(main, /contextIsolation:\s*true/);
  assert.match(main, /sandbox:\s*true/);
  assert.match(main, /nodeIntegration:\s*false/);
  assert.match(main, /setWindowOpenHandler/);
  const html = read('src/index.html');
  assert.match(html, /Content-Security-Policy/);
  assert.doesNotMatch(html, /<script[^>]+src="https?:/);
  assert.doesNotMatch(html, /toolbar/i);
});

test('preload exposes a narrow frozen API without Electron primitives', () => {
  const preload = read('src/preload.cjs');
  assert.match(preload, /contextBridge\.exposeInMainWorld/);
  assert.doesNotMatch(preload, /exposeInMainWorld\([^,]+,\s*(ipcRenderer|require)/);
});

test('main process handles cold start, open-file and second-instance', () => {
  const main = read('src/main.cjs');
  assert.match(main, /requestSingleInstanceLock/);
  assert.match(main, /second-instance/);
  assert.match(main, /second-instance[^\n]*app\.isReady\(\)/);
  assert.match(main, /open-file/);
  assert.match(main, /parseLaunchPaths/);
  assert.match(main, /pendingPath\s*=\s*absolute/);
  assert.doesNotMatch(main, /pendingPaths\.(pop|shift)/);
});

test('CSP permits only the private asset protocol for rendered local images', () => {
  const html = read('src/index.html');
  assert.match(html, /img-src 'self' downtoread-asset:/);
  assert.doesNotMatch(html, /img-src[^;]*data:/);
});

test('Markdown link navigation is delegated through the validated main-process path', () => {
  const preload = read('src/preload.cjs');
  const renderer = read('src/renderer.js');
  const main = read('src/main.cjs');
  assert.match(preload, /openDocumentLink:\s*\(href\)\s*=>\s*ipcRenderer\.invoke\('open-document-link', href\)/);
  assert.match(renderer, /downToRead\.openDocumentLink\(href\)/);
  assert.match(main, /ipcMain\.handle\('open-document-link'/);
  assert.match(main, /discoverRepository\(sourceDocument\)/);
  assert.match(main, /resolveDocumentLink\(sourceDocument/);
  assert.match(main, /regularFile\(target\.path\)/);
});

test('document fragments use generated heading IDs after rendering', () => {
  const renderer = read('src/renderer.js');
  assert.match(renderer, /assignHeadingIds\(\)/);
  assert.match(renderer, /getElementById\(payload\.fragment\)/);
  assert.match(renderer, /scrollIntoView\(\)/);
});
