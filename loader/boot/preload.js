'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('boot', {
  info: () => ipcRenderer.invoke('boot:info'),
  tools: () => ipcRenderer.invoke('boot:tools'),
  updates: () => ipcRenderer.invoke('boot:updates'),
  start: () => ipcRenderer.invoke('boot:start'),
  settings: () => ipcRenderer.invoke('boot:settings'),
  quit: () => ipcRenderer.invoke('boot:quit'),
  wfsDownload: () => ipcRenderer.invoke('boot:wfs-download'),
  wfsSkip: () => ipcRenderer.invoke('boot:wfs-skip'),
  launcherRelease: () => ipcRenderer.invoke('boot:launcher-release'),
  launcherSkip: () => ipcRenderer.invoke('boot:launcher-skip'),
});
