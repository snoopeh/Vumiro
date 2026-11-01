'use strict';

const { contextBridge, ipcRenderer } = require('electron');

let sourceListener = null;
ipcRenderer.on('capture-picker:sources', (_event, sources) => {
  if (sourceListener && Array.isArray(sources)) sourceListener(sources);
});

contextBridge.exposeInMainWorld('capturePicker', Object.freeze({
  onSources(callback) {
    if (typeof callback !== 'function') return;
    sourceListener = callback;
    ipcRenderer.send('capture-picker:ready');
  },
  selectSource(id) {
    if (typeof id === 'string') ipcRenderer.send('capture-picker:select', id);
  },
  cancel() { ipcRenderer.send('capture-picker:cancel'); }
}));
