'use strict';

const { contextBridge, ipcRenderer } = require('electron');

const listeners = new Set();
ipcRenderer.on('vumiro:message', (_event, data) => {
  for (const callback of [...listeners]) {
    try { callback({ data }); } catch { /* A page listener cannot affect the bridge. */ }
  }
});

function allowedMessage(message) {
  if (!message || typeof message !== 'object' || Array.isArray(message)) return false;
  const keys = Object.keys(message).sort();
  if (keys.join(',') !== 'action,type' || typeof message.action !== 'string') return false;
  if (message.type === 'updates') return ['state', 'check', 'install', 'download'].includes(message.action);
  return message.type === 'window' && ['state', 'close', 'minimize', 'maximize', 'notify'].includes(message.action);
}

contextBridge.exposeInMainWorld('vumiroDesktop', Object.freeze({
  platform: 'linux',
  capabilities: Object.freeze({ nativeWindowFrame: true, systemAudio: false, manualUpdates: true }),
  postMessage(message) {
    if (allowedMessage(message)) ipcRenderer.send('vumiro:post-message', { type: message.type, action: message.action });
  },
  addEventListener(type, callback) {
    if (type === 'message' && typeof callback === 'function') listeners.add(callback);
  },
  removeEventListener(type, callback) {
    if (type === 'message' && typeof callback === 'function') listeners.delete(callback);
  },
  secureStore: Object.freeze({
    async get() { return ipcRenderer.invoke('vumiro:secure-store', { action: 'get' }); },
    async set(value) { return ipcRenderer.invoke('vumiro:secure-store', { action: 'set', value }); },
    async delete() { return ipcRenderer.invoke('vumiro:secure-store', { action: 'delete' }); }
  }),
  oauth: Object.freeze({
    async signIn(request) {
      return ipcRenderer.invoke('vumiro:oauth', { authUrl: request?.authUrl, provider: request?.provider, codeChallenge: request?.codeChallenge });
    }
  })
}));
