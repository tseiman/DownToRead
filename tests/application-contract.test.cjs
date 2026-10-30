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
  assert.match(preload, /webUtils\.getPathForFile/);
  assert.match(preload, /openDroppedFile/);
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
  const main = read('src/main.cjs');
  assert.match(html, /img-src 'self' downtoread-asset:/);
  assert.doesNotMatch(html, /img-src[^;]*data:/);
  assert.match(main, /allowedAssets\.add\(path\.resolve\(asset\)\)/);
  assert.match(main, /allowedAssets\.has\(path\.resolve\(candidate\)\)/);
});

test('Mermaid adopts its generated theme stylesheet without weakening CSP', () => {
  const html = read('src/index.html');
  const renderer = read('src/renderer.js');
  assert.doesNotMatch(html, /style-src[^;]*'unsafe-inline'/);
  assert.match(renderer, /new CSSStyleSheet\(\)/);
  assert.match(renderer, /replaceSync\(style\.textContent/);
  assert.match(renderer, /document\.adoptedStyleSheets/);
  assert.match(renderer, /adoptMermaidStyles\(\)/);
});

test('Markdown link navigation is delegated through the validated main-process path', () => {
  const preload = read('src/preload.cjs');
  const renderer = read('src/renderer.js');
  const main = read('src/main.cjs');
  assert.match(preload, /openLink:\s*\(href\)\s*=>\s*ipcRenderer\.invoke\('open-link', href\)/);
  assert.match(renderer, /downToRead\.openLink\(href\)/);
  assert.match(main, /ipcMain\.handle\('open-link'/);
  assert.match(main, /discoverRepository\(sourceDocument\)/);
  assert.match(main, /resolveLocalFileLink\(sourceDocument/);
  assert.match(main, /openReadableFile\(target\.path/);
});

test('document fragments use generated heading IDs after rendering', () => {
  const renderer = read('src/renderer.js');
  assert.match(renderer, /assignHeadingIds\(\)/);
  assert.match(renderer, /getElementById\(payload\.fragment\)/);
  assert.match(renderer, /scrollIntoView\(\)/);
});

test('filesystem drag and drop opens one validated readable file', () => {
  const renderer = read('src/renderer.js');
  const main = read('src/main.cjs');
  assert.match(renderer, /addEventListener\('dragover'/);
  assert.match(renderer, /addEventListener\('drop'/);
  assert.match(renderer, /downToRead\.openDroppedFile/);
  assert.match(main, /ipcMain\.handle\('open-dropped-file'/);
  assert.match(main, /return openReadableFile\(filePath\)/);
});

test('smoke readiness requires styled Mermaid and decoded local images', () => {
  const renderer = read('src/renderer.js');
  const main = read('src/main.cjs');
  assert.match(renderer, /image\.decode\(\)/);
  assert.match(renderer, /localImagesLoaded/);
  assert.match(renderer, /mermaidStyled/);
  assert.match(main, /result\.mermaidStyled === true/);
  assert.match(main, /result\.localImagesLoaded === true/);
});

test('safe raw HTML is sanitized instead of rendered as escaped source text', () => {
  const renderer = read('src/renderer.js');
  assert.doesNotMatch(renderer, /html\(\{ text \}\)/);
  assert.match(renderer, /DOMPurify\.sanitize/);
  assert.match(renderer, /FORBID_TAGS:\s*\['script','style','iframe','object','embed','form'\]/);
});

test('native context menu copies selection, links, and rasterized images', () => {
  const preload = read('src/preload.cjs');
  const renderer = read('src/renderer.js');
  const main = read('src/main.cjs');
  assert.match(renderer, /addEventListener\('contextmenu'/);
  assert.match(preload, /showContextMenu/);
  assert.match(preload, /copyImageToClipboard/);
  assert.match(main, /Copy Link/);
  assert.match(main, /Copy Image/);
  assert.match(main, /clipboard\.writeText/);
  assert.match(main, /clipboard\.write\(/);
  assert.match(main, /new ClipboardItem/);
});

test('hover navigation exposes session back, start, and forward without print or copy output', () => {
  const html = read('src/index.html');
  const css = read('src/reader.css');
  const preload = read('src/preload.cjs');
  const renderer = read('src/renderer.js');
  const main = read('src/main.cjs');
  for (const id of ['history-hover-zone', 'history-back', 'history-home', 'history-forward']) assert.match(html, new RegExp(`id="${id}"`));
  assert.match(html, /class="history-core"/);
  assert.match(html, /<svg[^>]+viewBox="0 0 24 24"/);
  assert.match(css, /\.history-controls\{[^}]*opacity:0/);
  assert.match(css, /transition:opacity \.75s ease-in-out/);
  assert.match(css, /var\(--light-x,35%\)/);
  assert.match(css, /@media\(hover:none\)/);
  assert.match(css, /\.history-hover-zone:hover/);
  assert.match(css, /@media print\{[^}]*\.history-hover-zone\{display:none!important\}/);
  assert.match(css, /user-select:none/);
  assert.match(renderer, /addEventListener\('pointermove'/);
  assert.match(renderer, /style\.setProperty\('--light-x'/);
  assert.match(preload, /navigateHistory:\s*\(action\)\s*=>\s*ipcRenderer\.invoke\('navigate-history', action\)/);
  assert.match(renderer, /setHistoryState\(payload\.history\)/);
  assert.match(renderer, /history-back/);
  assert.match(renderer, /history-home/);
  assert.match(renderer, /history-forward/);
  assert.match(main, /new NavigationHistory\(\)/);
  assert.match(main, /ipcMain\.handle\('navigate-history'/);
});

test('executables are never opened and uncertain links require explicit confirmation', () => {
  const main = read('src/main.cjs');
  assert.match(main, /looksExecutable/);
  assert.match(main, /Executable files are blocked/);
  assert.match(main, /await pathIsInside\(trustedRoot, target\.path\)/);
  assert.match(main, /It may expose private local data/);
  assert.match(main, /BLOCKED_EXTERNAL_PROTOCOLS/);
  assert.match(main, /ms-msdt:/);
  assert.match(main, /buttons:\s*\['No', 'Yes'\]/);
  assert.match(main, /defaultId:\s*0/);
  assert.match(main, /cancelId:\s*0/);
});
