'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('setup', {
  info: () => ipcRenderer.invoke('setup:info'),
  release: () => ipcRenderer.invoke('setup:release'),
  installFile: () => ipcRenderer.invoke('setup:install-file'),
  openDownloadPage: () => ipcRenderer.invoke('setup:open-download-page'),
  launch: () => ipcRenderer.invoke('setup:launch'),
  rollback: () => ipcRenderer.invoke('setup:rollback'),
  quit: () => ipcRenderer.invoke('setup:quit'),
  onProgress: (cb) => ipcRenderer.on('setup:progress', (_e, s) => cb(s)),
});
