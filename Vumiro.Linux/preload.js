'use strict';

const { contextBridge, ipcRenderer } = require('electron');

const listeners = new Set();
ipcRenderer.on('vumiro:message', (_event, data) => {
  for (const callback of [...listeners]) {
    try { callback({ data }); } catch { /* A page listener cannot affect the bridge. */ }
  }
});

function notificationPayload(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).sort().join(',') !== 'avatar,body,category,id,senderName') return null;
  if (typeof value.id !== 'string' || !/^[A-Za-z0-9:_-]{1,128}$/.test(value.id) || !['friend', 'roomInvite', 'call', 'roomActivity', 'message'].includes(value.category)) return null;
  if (typeof value.senderName !== 'string' || !value.senderName.trim() || value.senderName.length > 80 || typeof value.body !== 'string' || !value.body.trim() || value.body.length > 320) return null;
  if (typeof value.avatar !== 'string' || value.avatar.length > 32768 || value.avatar && !/^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(value.avatar)) return null;
  return {id: value.id, category: value.category, senderName: value.senderName, body: value.body, avatar: value.avatar};
}
function allowedMessage(message) {
  if (!message || typeof message !== 'object' || Array.isArray(message)) return false;
  const keys = Object.keys(message).sort();
  if (message.type === 'window' && message.action === 'notify') return keys.join(',') === 'action,notification,type' && !!notificationPayload(message.notification);
  if (keys.join(',') !== 'action,type' || typeof message.action !== 'string') return false;
  if (message.type === 'updates') return ['state', 'check', 'install', 'download'].includes(message.action);
  return message.type === 'window' && ['state', 'close', 'minimize', 'maximize', 'notify-clear'].includes(message.action);
}

contextBridge.exposeInMainWorld('vumiroDesktop', Object.freeze({
  platform: 'linux',
  capabilities: Object.freeze({ nativeWindowFrame: true, systemAudio: false, manualUpdates: true }),
  postMessage(message) {
    if (allowedMessage(message)) {
      const safe = { type: message.type, action: message.action };
      if (message.action === 'notify') safe.notification = notificationPayload(message.notification);
      ipcRenderer.send('vumiro:post-message', safe);
    }
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
