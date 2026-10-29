const { contextBridge, ipcRenderer } = require('electron');
const allowedEvents = new Set(['document']);
const api = Object.freeze({
  onDocument(callback) {
    if (typeof callback !== 'function') return () => {};
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('document', listener);
    return () => ipcRenderer.removeListener('document', listener);
  },
  assetUrl: (source) => ipcRenderer.invoke('asset-url', source),
  openDocumentLink: (href) => ipcRenderer.invoke('open-document-link', href),
  openExternal: (url) => ipcRenderer.invoke('open-external', url),
  ready: () => ipcRenderer.send('renderer-ready'),
  rendered: (result) => ipcRenderer.send('renderer-rendered', result)
});
void allowedEvents;
contextBridge.exposeInMainWorld('downToRead', api);
