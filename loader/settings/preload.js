'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('wfs', {
  get: () => ipcRenderer.invoke('settings:get'),
  set: (patch) => ipcRenderer.invoke('settings:set', patch),
  gpu: () => ipcRenderer.invoke('settings:gpu'),
  selftest: () => ipcRenderer.invoke('settings:selftest'),
  integration: (action) => ipcRenderer.invoke('settings:integration', action),
  restart: () => ipcRenderer.invoke('settings:restart'),
  startWfs: () => ipcRenderer.invoke('settings:start-wfs'),
  install: () => ipcRenderer.invoke('settings:install'),
  rollback: () => ipcRenderer.invoke('settings:rollback'),
  reset: () => ipcRenderer.invoke('settings:reset'),
  openPath: (which) => ipcRenderer.invoke('settings:open-path', which),
  openUrl: (which) => ipcRenderer.invoke('settings:open-url', which),
});
