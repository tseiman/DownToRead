const path = require('node:path');
const { pathToFileURL } = require('node:url');
const fs = require('node:fs/promises');
const { app, BrowserWindow, ClipboardItem, Menu, clipboard, dialog, ipcMain, protocol, shell } = require('electron');
const { autoUpdater } = require('electron-updater');
const { buildMenuTemplate, COMMANDS } = require('./menu.cjs');
const { configureUpdater } = require('./updater.cjs');
const { classifyLocalPath, parseLaunchPaths, resolveDocumentAsset, resolveLocalFileLink } = require('./path-policy.cjs');
const { discoverRepository } = require('./repository-context.cjs');

const MAX_TEXT_BYTES = 32 * 1024 * 1024;
const MAX_IMAGE_BYTES = 100 * 1024 * 1024;
const MAX_CLIPBOARD_DATA_URL = 64 * 1024 * 1024;
const BLOCKED_EXTERNAL_PROTOCOLS = new Set([
  'javascript:', 'data:', 'blob:', 'ms-msdt:', 'search-ms:', 'mhtml:', 'ms-officecmd:',
  'ms-appinstaller:', 'shell:', 'powershell:', 'cmd:', 'vscode:', 'vscode-insiders:'
]);
protocol.registerSchemesAsPrivileged([{ scheme: 'downtoread-asset', privileges: { secure: true, standard: true, supportFetchAPI: true, corsEnabled: true } }]);
let mainWindow = null;
let currentDocument = null;
let allowedAssets = new Set();
let rendererReady = false;
let pendingPath = null;
let pendingFragment = '';

function mimeFor(filePath) {
  return ({ '.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp','.gif':'image/gif' })[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
}

async function fileInfo(filePath) {
  try {
    const stat = await fs.stat(filePath);
    return stat.isFile() ? stat : null;
  } catch { return null; }
}

function decodeReadableText(buffer) {
  if (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe) {
    if ((buffer.length - 2) % 2) throw new TypeError('Invalid UTF-16LE byte length');
    return new TextDecoder('utf-16le', { fatal: true }).decode(buffer.subarray(2));
  }
  if (buffer.length >= 2 && buffer[0] === 0xfe && buffer[1] === 0xff) {
    if ((buffer.length - 2) % 2) throw new TypeError('Invalid UTF-16BE byte length');
    const swapped = Buffer.alloc(buffer.length - 2);
    for (let index = 2; index + 1 < buffer.length; index += 2) { swapped[index - 2] = buffer[index + 1]; swapped[index - 1] = buffer[index]; }
    return new TextDecoder('utf-16le', { fatal: true }).decode(swapped);
  }
  const offset = buffer.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf ? 3 : 0;
  return new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(offset));
}

function looksExecutable(buffer, stat, filePath) {
  if (classifyLocalPath(filePath) === 'executable') return true;
  if (buffer.length >= 4) {
    const hex = buffer.subarray(0, 4).toString('hex');
    if (hex.startsWith('7f454c46') || hex.startsWith('4d5a') || ['feedface','feedfacf','cefaedfe','cffaedfe','cafebabe'].includes(hex)) return true;
  }
  if (process.platform !== 'win32' && (stat.mode & 0o111)) {
    try { decodeReadableText(buffer); } catch { return true; }
  }
  return false;
}

async function readPrefix(filePath, length = 4096) {
  const handle = await fs.open(filePath, 'r');
  try {
    const buffer = Buffer.alloc(length);
    const { bytesRead } = await handle.read(buffer, 0, length, 0);
    return buffer.subarray(0, bytesRead);
  } finally { await handle.close(); }
}

function showWindow() {
  if (!mainWindow) createWindow();
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

function sendDocument(absolute, payload) {
  currentDocument = absolute;
  allowedAssets = new Set();
  mainWindow.webContents.send('document', { title: path.basename(absolute), ...payload });
  showWindow();
}

async function confirmRisk(title, message) {
  const result = await dialog.showMessageBox(mainWindow, {
    type: 'warning', title, message, buttons: ['No', 'Yes'], defaultId: 0, cancelId: 0, noLink: true
  });
  return result.response === 1;
}

async function pathIsInside(root, target) {
  try {
    const [realRoot, realTarget] = await Promise.all([fs.realpath(root), fs.realpath(target)]);
    const relative = path.relative(realRoot, realTarget);
    return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
  } catch { return false; }
}

async function openWithSystemApplication(filePath) {
  const accepted = await confirmRisk('Open potentially active content?', `This file is not a plain text or image format. Opening it starts another application and the file may contain active content.\n\n${filePath}\n\nAre you sure?`);
  if (!accepted) return false;
  const error = await shell.openPath(filePath);
  if (error) { dialog.showErrorBox('Cannot open file', error); return false; }
  return true;
}

async function openReadableFile(filePath, fragment = '') {
  const absolute = path.resolve(filePath);
  const stat = await fileInfo(absolute);
  if (!stat) {
    if (app.isReady()) dialog.showErrorBox('Cannot open file', 'The linked file does not exist or is not a regular file.');
    return false;
  }
  const kind = classifyLocalPath(absolute);
  const prefix = await readPrefix(absolute);
  if (looksExecutable(prefix, stat, absolute)) {
    dialog.showErrorBox('Executable files are blocked', 'DownToRead never opens or runs executable files. Readable scripts can still be displayed as plain text.');
    return false;
  }

  if (!rendererReady) {
    currentDocument = absolute;
    pendingPath = absolute;
    pendingFragment = fragment;
    showWindow();
    return true;
  }

  if (kind === 'image') {
    if (stat.size > MAX_IMAGE_BYTES) { dialog.showErrorBox('Image is too large', 'Images larger than 100 MiB are not loaded.'); return false; }
    sendDocument(absolute, { mode: 'image', source: pathToFileURL(absolute).href });
    return true;
  }

  if (kind === 'markdown' || kind === 'text') {
    if (stat.size > MAX_TEXT_BYTES) { dialog.showErrorBox('Text file is too large', 'Text files larger than 32 MiB are not loaded.'); return false; }
    try {
      const text = decodeReadableText(await fs.readFile(absolute));
      sendDocument(absolute, kind === 'markdown' ? { mode: 'markdown', markdown: text, fragment } : { mode: 'text', text });
      return true;
    } catch {
      dialog.showErrorBox('Cannot read text file', 'The file is not valid UTF-8, UTF-16LE, or UTF-16BE text.');
      return false;
    }
  }

  if (stat.size <= MAX_TEXT_BYTES) {
    try {
      const text = decodeReadableText(await fs.readFile(absolute));
      sendDocument(absolute, { mode: 'text', text });
      return true;
    } catch { /* Binary, non-executable files require confirmation below. */ }
  }
  return openWithSystemApplication(absolute);
}

function createWindow() {
  mainWindow = new BrowserWindow({ width: 1080, height: 780, minWidth: 480, minHeight: 360, show: false, title: 'DownToRead', webPreferences: {
    preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, sandbox: true, nodeIntegration: false, webSecurity: true, allowRunningInsecureContent: false
  }});
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.on('will-navigate', (event, url) => { if (url !== mainWindow.webContents.getURL()) event.preventDefault(); });
  mainWindow.on('closed', () => { mainWindow = null; rendererReady = false; });
  mainWindow.loadFile(path.join(__dirname, 'index.html'));
  mainWindow.once('ready-to-show', () => mainWindow.show());
}

async function chooseDocument() {
  const result = await dialog.showOpenDialog(mainWindow, { properties: ['openFile'], filters: [
    { name: 'Readable documents and images', extensions: ['md','markdown','txt','text','log','csv','json','xml','yaml','yml','toml','ini','cfg','conf','exp','svg','png','jpg','jpeg','webp','gif'] },
    { name: 'All files', extensions: ['*'] }
  ] });
  if (!result.canceled && result.filePaths[0]) await openReadableFile(result.filePaths[0]);
}

function executeCommand(name) {
  if (name === COMMANDS.OPEN) return chooseDocument();
  if (!mainWindow) return undefined;
  if (name === COMMANDS.PRINT) return mainWindow.webContents.print({ printBackground: true });
  if (name === COMMANDS.ZOOM_IN) mainWindow.webContents.setZoomLevel(mainWindow.webContents.getZoomLevel() + 0.5);
  if (name === COMMANDS.ZOOM_OUT) mainWindow.webContents.setZoomLevel(mainWindow.webContents.getZoomLevel() - 0.5);
  if (name === COMMANDS.ZOOM_RESET) mainWindow.webContents.setZoomLevel(0);
  if (name === COMMANDS.UPDATE) return checkForUpdates();
  return undefined;
}
const checkForUpdates = configureUpdater(autoUpdater, dialog);

async function openExternalLink(value) {
  let url;
  try { url = new URL(value); } catch { return false; }
  if (url.protocol === 'file:') {
    dialog.showErrorBox('Unsafe link blocked', 'A file URL must resolve through the validated local-file reader.');
    return false;
  }
  if (BLOCKED_EXTERNAL_PROTOCOLS.has(url.protocol)) {
    dialog.showErrorBox('Unsafe link blocked', `DownToRead cannot open ${url.protocol} links.`);
    return false;
  }
  if (url.protocol !== 'https:') {
    const accepted = await confirmRisk('Open external link?', `This link uses the ${url.protocol} protocol and will open another application or an unencrypted connection.\n\n${url.href}\n\nAre you sure?`);
    if (!accepted) return false;
  }
  try { await shell.openExternal(url.href); return true; }
  catch { dialog.showErrorBox('Cannot open link', 'No application accepted this link.'); return false; }
}

function contextMenuFor(event, context) {
  if (!context || typeof context !== 'object') return false;
  const selectionText = typeof context.selectionText === 'string' ? context.selectionText.slice(0, 8192) : '';
  const linkHref = typeof context.linkHref === 'string' ? context.linkHref.slice(0, 8192) : '';
  const imageIndex = Number.isInteger(context.imageIndex) && context.imageIndex >= 0 ? context.imageIndex : -1;
  const template = [];
  if (selectionText) template.push({ label: 'Copy', role: 'copy' });
  if (imageIndex >= 0) template.push({ label: 'Copy Image', click: () => event.sender.send('copy-image-request', imageIndex) });
  if (linkHref) template.push({ label: 'Copy Link', click: () => clipboard.writeText(linkHref) });
  if (!template.length) template.push({ label: 'Select All', role: 'selectAll' });
  Menu.buildFromTemplate(template).popup({ window: BrowserWindow.fromWebContents(event.sender) || mainWindow });
  return true;
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) app.quit();
else {
  app.on('second-instance', (_event, argv) => { const paths = parseLaunchPaths(argv); if (paths[0] && app.isReady()) openReadableFile(paths[0]); else if (paths[0]) pendingPath = paths[0]; else if (mainWindow) mainWindow.focus(); });
  app.on('open-file', (event, filePath) => { event.preventDefault(); if (app.isReady()) openReadableFile(filePath); else pendingPath = filePath; });
  app.whenReady().then(async () => {
    protocol.handle('downtoread-asset', async (request) => {
      try {
        const encoded = new URL(request.url).pathname.slice(1);
        const candidate = Buffer.from(encoded, 'base64url').toString('utf8');
        const stat = await fileInfo(candidate);
        if (!allowedAssets.has(path.resolve(candidate)) || !resolveDocumentAsset(currentDocument, pathToFileURL(candidate).href) || !stat || stat.size > MAX_IMAGE_BYTES) return new Response('Not found', { status: 404 });
        return new Response(await fs.readFile(candidate), { headers: { 'Content-Type': mimeFor(candidate), 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' } });
      } catch { return new Response('Bad request', { status: 400 }); }
    });
    ipcMain.handle('asset-url', async (_event, source) => {
      if (typeof source !== 'string' || source.length > 8192 || !currentDocument) return null;
      const asset = resolveDocumentAsset(currentDocument, source);
      const stat = asset ? await fileInfo(asset) : null;
      if (!asset || !stat || stat.size > MAX_IMAGE_BYTES) return null;
      allowedAssets.add(path.resolve(asset));
      return `downtoread-asset://local/${Buffer.from(asset).toString('base64url')}`;
    });
    ipcMain.handle('open-link', async (_event, href) => {
      if (typeof href !== 'string' || href.length > 8192 || !currentDocument) return false;
      const sourceDocument = currentDocument;
      const repository = await discoverRepository(sourceDocument);
      const target = resolveLocalFileLink(sourceDocument, href, repository?.root, repository?.slug);
      if (target) {
        const trustedRoot = repository?.root || path.dirname(sourceDocument);
        if (!(await pathIsInside(trustedRoot, target.path))) {
          const accepted = await confirmRisk('Open file outside this document?', `This link reads a file outside the current ${repository?.root ? 'repository' : 'document folder'}. It may expose private local data.\n\n${target.path}\n\nAre you sure?`);
          if (!accepted) return false;
        }
        return openReadableFile(target.path, target.fragment);
      }
      return openExternalLink(href);
    });
    ipcMain.handle('open-dropped-file', async (_event, filePath) => {
      if (typeof filePath !== 'string' || filePath.length > 8192) return false;
      return openReadableFile(filePath);
    });
    ipcMain.handle('show-context-menu', (event, context) => contextMenuFor(event, context));
    ipcMain.handle('copy-image-to-clipboard', async (_event, dataUrl) => {
      const prefix = 'data:image/png;base64,';
      if (typeof dataUrl !== 'string' || dataUrl.length > MAX_CLIPBOARD_DATA_URL || !dataUrl.startsWith(prefix)) return false;
      try {
        const bytes = Buffer.from(dataUrl.slice(prefix.length), 'base64');
        if (!bytes.length) return false;
        const blob = new Blob([bytes], { type: 'image/png' });
        await clipboard.write([new ClipboardItem({ 'image/png': blob })]);
        return true;
      } catch { return false; }
    });
    ipcMain.on('renderer-ready', async () => {
      rendererReady = true;
      const next = pendingPath;
      const fragment = pendingFragment;
      pendingPath = null;
      pendingFragment = '';
      if (next) await openReadableFile(next, fragment);
    });
    ipcMain.on('renderer-rendered', (_event, result) => {
      if (process.env.DTR_SMOKE !== '1') return;
      const passed = result && result.markdown === true && result.mermaid === true && result.relativeImage === true && result.localImagesLoaded === true;
      console.log(passed ? 'SMOKE PASS: Markdown, Mermaid, and decoded relative SVG are ready.' : `SMOKE FAIL: ${JSON.stringify(result)}`);
      app.exit(passed ? 0 : 1);
    });
    Menu.setApplicationMenu(Menu.buildFromTemplate(buildMenuTemplate({ platform: process.platform, command: executeCommand })));
    createWindow();
    const launchPath = parseLaunchPaths(process.argv)[0];
    if (launchPath) await openReadableFile(launchPath);
    if (app.isPackaged) setTimeout(() => checkForUpdates({ silent: true }), 10000);
  });
  app.on('activate', () => { if (!BrowserWindow.getAllWindows().length) createWindow(); });
  app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
}
