'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  configGet:   () => ipcRenderer.invoke('config:get'),
  appVersion:  () => ipcRenderer.invoke('app:version'),
  cacheRead:  (filename) => ipcRenderer.invoke('cache:read', filename),
  cacheWrite: (filename, data) => ipcRenderer.invoke('cache:write', filename, data),
  onControl:  (callback) => ipcRenderer.on('control:command', (_event, data) => callback(data)),
  offControl: (callback) => ipcRenderer.removeListener('control:command', callback),
});
