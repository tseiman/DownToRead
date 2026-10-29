const { contextBridge, ipcRenderer, webUtils } = require('electron');

const api = Object.freeze({
  onDocument(callback) {
    if (typeof callback !== 'function') return () => {};
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('document', listener);
    return () => ipcRenderer.removeListener('document', listener);
  },
  onCopyImageRequest(callback) {
    if (typeof callback !== 'function') return () => {};
    const listener = (_event, imageIndex) => callback(imageIndex);
    ipcRenderer.on('copy-image-request', listener);
    return () => ipcRenderer.removeListener('copy-image-request', listener);
  },
  assetUrl: (source) => ipcRenderer.invoke('asset-url', source),
  openDroppedFile(file) {
    try {
      const filePath = webUtils.getPathForFile(file);
      return filePath ? ipcRenderer.invoke('open-dropped-file', filePath) : Promise.resolve(false);
    } catch { return Promise.resolve(false); }
  },
  openLink: (href) => ipcRenderer.invoke('open-link', href),
  showContextMenu: (context) => ipcRenderer.invoke('show-context-menu', context),
  copyImageToClipboard: (dataUrl) => ipcRenderer.invoke('copy-image-to-clipboard', dataUrl),
  ready: () => ipcRenderer.send('renderer-ready'),
  rendered: (result) => ipcRenderer.send('renderer-rendered', result)
});

contextBridge.exposeInMainWorld('downToRead', api);
