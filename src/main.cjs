const path = require('node:path');
const { pathToFileURL } = require('node:url');
const fs = require('node:fs/promises');
const { app, BrowserWindow, Menu, dialog, ipcMain, protocol, shell } = require('electron');
const { autoUpdater } = require('electron-updater');
const { buildMenuTemplate, COMMANDS } = require('./menu.cjs');
const { configureUpdater } = require('./updater.cjs');
const { isMarkdownPath, parseLaunchPaths, resolveDocumentAsset } = require('./path-policy.cjs');

protocol.registerSchemesAsPrivileged([{ scheme: 'downtoread-asset', privileges: { secure: true, standard: true, supportFetchAPI: true } }]);
let mainWindow = null;
let currentDocument = null;
let rendererReady = false;
// This is a single-document viewer: the most recent request before renderer
// readiness is the document the user most recently asked to see.
let pendingPath = null;

function mimeFor(filePath) {
  return ({ '.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp','.gif':'image/gif' })[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
}
async function regularFile(filePath) {
  try { const stat = await fs.stat(filePath); return stat.isFile(); } catch { return false; }
}
async function openDocument(filePath) {
  const absolute = path.resolve(filePath);
  if (!isMarkdownPath(absolute) || !(await regularFile(absolute))) {
    if (app.isReady()) dialog.showErrorBox('Cannot open document', 'Choose an existing .md or .markdown file.');
    return false;
  }
  currentDocument = absolute;
  const markdown = await fs.readFile(absolute, 'utf8');
  if (!mainWindow) createWindow();
  if (rendererReady) mainWindow.webContents.send('document', { title: path.basename(absolute), markdown });
  else pendingPath = absolute;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show(); mainWindow.focus();
  return true;
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
  const result = await dialog.showOpenDialog(mainWindow, { properties: ['openFile'], filters: [{ name: 'Markdown', extensions: ['md','markdown'] }] });
  if (!result.canceled && result.filePaths[0]) await openDocument(result.filePaths[0]);
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

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) app.quit();
else {
  app.on('second-instance', (_event, argv) => { const paths = parseLaunchPaths(argv); if (paths[0] && app.isReady()) openDocument(paths[0]); else if (paths[0]) pendingPath = paths[0]; else if (mainWindow) mainWindow.focus(); });
  app.on('open-file', (event, filePath) => { event.preventDefault(); if (app.isReady()) openDocument(filePath); else pendingPath = filePath; });
  app.whenReady().then(async () => {
    protocol.handle('downtoread-asset', async (request) => {
      try {
        const encoded = new URL(request.url).pathname.slice(1);
        const candidate = Buffer.from(encoded, 'base64url').toString('utf8');
        if (!resolveDocumentAsset(currentDocument, pathToFileURL(candidate).href) || !(await regularFile(candidate))) return new Response('Not found', { status: 404 });
        return new Response(await fs.readFile(candidate), { headers: { 'Content-Type': mimeFor(candidate), 'Cache-Control': 'no-store' } });
      } catch { return new Response('Bad request', { status: 400 }); }
    });
    ipcMain.handle('asset-url', async (_event, source) => {
      if (typeof source !== 'string' || source.length > 8192 || !currentDocument) return null;
      const asset = resolveDocumentAsset(currentDocument, source);
      if (!asset || !(await regularFile(asset))) return null;
      return `downtoread-asset://local/${Buffer.from(asset).toString('base64url')}`;
    });
    ipcMain.handle('open-external', async (_event, value) => {
      if (typeof value !== 'string' || value.length > 8192) return false;
      try { const url = new URL(value); if (!['http:','https:'].includes(url.protocol)) return false; await shell.openExternal(url.href); return true; } catch { return false; }
    });
    ipcMain.on('renderer-ready', async () => {
      rendererReady = true;
      const next = pendingPath; pendingPath = null;
      if (next) await openDocument(next);
    });
    ipcMain.on('renderer-rendered', (_event, result) => {
      if (process.env.DTR_SMOKE !== '1') return;
      const passed = result && result.markdown === true && result.mermaid === true && result.relativeImage === true;
      console.log(passed ? 'SMOKE PASS: Markdown, Mermaid, and relative SVG are ready.' : `SMOKE FAIL: ${JSON.stringify(result)}`);
      app.exit(passed ? 0 : 1);
    });
    Menu.setApplicationMenu(Menu.buildFromTemplate(buildMenuTemplate({ platform: process.platform, command: executeCommand })));
    createWindow();
    const launchPath = parseLaunchPaths(process.argv)[0];
    if (launchPath) await openDocument(launchPath);
    if (app.isPackaged) setTimeout(() => checkForUpdates({ silent: true }), 10000);
  });
  app.on('activate', () => { if (!BrowserWindow.getAllWindows().length) createWindow(); });
  app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
}
