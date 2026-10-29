const { contextBridge, ipcRenderer, webUtils } = require('electron');
const allowedEvents = new Set(['document']);
const api = Object.freeze({
  onDocument(callback) {
    if (typeof callback !== 'function') return () => {};
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('document', listener);
    return () => ipcRenderer.removeListener('document', listener);
  },
  assetUrl: (source) => ipcRenderer.invoke('asset-url', source),
  openDroppedFile(file) {
    try {
      const filePath = webUtils.getPathForFile(file);
      return filePath ? ipcRenderer.invoke('open-dropped-file', filePath) : Promise.resolve(false);
    } catch { return Promise.resolve(false); }
  },
  openDocumentLink: (href) => ipcRenderer.invoke('open-document-link', href),
  openExternal: (url) => ipcRenderer.invoke('open-external', url),
  ready: () => ipcRenderer.send('renderer-ready'),
  rendered: (result) => ipcRenderer.send('renderer-rendered', result)
});
void allowedEvents;
contextBridge.exposeInMainWorld('downToRead', api);
