'use strict';

const { app, BrowserWindow, Menu, Tray, nativeImage, protocol, session, desktopCapturer, ipcMain, shell, dialog, Notification, powerMonitor, safeStorage } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { pathToFileURL } = require('node:url');

const APP_SCHEME = 'vumiro';
const APP_HOST = 'app';
const APP_URL = `${APP_SCHEME}://${APP_HOST}`;
const WEB_ROOT = path.join(app.getAppPath(), 'webserver');
const RELEASES_API = 'https://api.github.com/repos/snoopeh/Vumiro/releases/latest';
const RELEASE_URL = 'https://github.com/snoopeh/Vumiro/releases/tag/';
const ASSET_PATHS = new Map([
  ['/friends.html', 'text/html; charset=utf-8'],
  ['/friends-client.js', 'text/javascript; charset=utf-8'],
  ['/call.html', 'text/html; charset=utf-8'],
  ['/call-client.js', 'text/javascript; charset=utf-8'],
  ['/local-profile.js', 'text/javascript; charset=utf-8'],
  ['/peer-profile.js', 'text/javascript; charset=utf-8'],
  ['/account-client.js', 'text/javascript; charset=utf-8'],
  ['/identity-recovery.js', 'text/javascript; charset=utf-8']
]);
const CSP = [
  "default-src 'none'",
  "base-uri 'none'",
  "form-action 'self'",
  "frame-ancestors 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self' data:",
  "img-src 'self' data: blob:",
  "media-src 'self' blob:",
  "connect-src 'self' https: wss: blob:",
  "frame-src vumiro://app",
  "object-src 'none'"
].join('; ');

protocol.registerSchemesAsPrivileged([{
  scheme: APP_SCHEME,
  privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true }
}]);

app.setName('Vumiro Linux');
app.setPath('userData', path.join(app.getPath('appData'), 'Vumiro-Linux'));

let mainWindow = null;
let splashWindow = null;
let tray = null;
let quitting = false;
let updateBusy = false;
let updateSnapshot = null;
let capturePicker = null;
let permittedCaptureSources = new Map();
let finishCapturePicker = null;
let captureRequestBusy = false;
const appVersion = app.getVersion() || '1.21.1';
const DEFAULT_SIGNALING = 'wss://vumiro-rooms.vumiro-signaling.workers.dev/call-signaling';

const MIME = new Map([
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8']
]);

function parseAppUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === `${APP_SCHEME}:` && url.hostname === APP_HOST && !url.username && !url.password && !url.port && !url.hash ? url : null;
  } catch { return null; }
}

function isTrustedPage(value, pathname) {
  const url = parseAppUrl(value);
  return !!url && url.pathname === pathname;
}

function isTrustedPermissionFrame(contents, requestingUrl) {
  if (!mainWindow || contents !== mainWindow.webContents) return false;
  const url = parseAppUrl(requestingUrl);
  return !!url && ['', '/', '/friends.html', '/call.html'].includes(url.pathname);
}

function response(body, status = 200, contentType = 'text/plain; charset=utf-8') {
  return new Response(body, {
    status,
    headers: {
      'Content-Type': contentType,
      'Content-Security-Policy': CSP,
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
      'X-Frame-Options': 'SAMEORIGIN',
      'Permissions-Policy': 'camera=(), microphone=(self), display-capture=(self)'
    }
  });
}

async function serveAppAsset(request) {
  const url = parseAppUrl(request.url);
  if (!url || !['GET', 'HEAD'].includes(request.method)) return response('Not found', 404);
  if (!['/friends.html', '/call.html'].includes(url.pathname) && url.search) return response('Not found', 404);
  const contentType = ASSET_PATHS.get(url.pathname);
  if (!contentType) return response('Not found', 404);
  const filename = path.join(WEB_ROOT, path.basename(url.pathname));
  try {
    const content = await fs.promises.readFile(filename);
    return response(request.method === 'HEAD' ? null : content, 200, MIME.get(path.extname(filename)) || contentType);
  } catch {
    return response('Vumiro interface files are missing. Reinstall the application and try again.', 500);
  }
}

function validMainFrame(contents, senderFrame = contents && contents.mainFrame, pathname = '/friends.html') {
  if (!mainWindow || contents !== mainWindow.webContents) return false;
  const frame = contents.mainFrame;
  return !!frame && senderFrame === frame && isTrustedPage(frame.url, pathname);
}

function sendToPage(message) {
  if (mainWindow && !mainWindow.isDestroyed() && validMainFrame(mainWindow.webContents)) {
    mainWindow.webContents.send('vumiro:message', message);
  }
}

function setUpdateState(patch) {
  updateSnapshot = { type: 'updates', current: appVersion, version: appVersion, latest: null, available: false, busy: updateBusy, message: 'Check GitHub for updates.', progress: 0, ...updateSnapshot, ...patch };
  updateSnapshot.busy = updateBusy;
  sendToPage(updateSnapshot);
}

function versionParts(value) {
  const match = /^client-v(\d+)\.(\d+)\.(\d+)$/.exec(value || '');
  return match ? match.slice(1).map(Number) : null;
}

function compareVersions(a, b) {
  for (let index = 0; index < 3; index++) if (a[index] !== b[index]) return a[index] - b[index];
  return 0;
}

async function checkForUpdate() {
  const result = await fetch(RELEASES_API, {
    headers: { Accept: 'application/vnd.github+json', 'User-Agent': `Vumiro-Linux/${appVersion}` },
    redirect: 'error', signal: AbortSignal.timeout(20000)
  });
  if (result.status === 403 || result.status === 429) throw new Error("GitHub's request limit was reached. Try again later.");
  if (!result.ok) throw new Error(`GitHub returned HTTP ${result.status}.`);
  const text = await result.text();
  if (text.length > 1024 * 1024) throw new Error('GitHub returned unexpectedly large release metadata.');
  const release = JSON.parse(text);
  const parts = versionParts(release?.tag_name);
  const assets = Array.isArray(release?.assets) ? release.assets : [];
  const linuxPackage = assets.some(asset => ['Vumiro-linux-x64.AppImage', 'Vumiro-linux-x64.deb', 'Vumiro-linux-x64.rpm'].includes(asset?.name));
  if (!parts || release.draft || release.prerelease || !linuxPackage) return null;
  return { tag: release.tag_name, parts };
}

async function handleUpdateAction(action) {
  if (action === 'state') {
    sendToPage(updateSnapshot || { type: 'updates', current: appVersion, version: appVersion, latest: null, available: false, busy: updateBusy, message: 'Check GitHub for updates.', progress: 0 });
    return;
  }
  if (updateBusy || !['check', 'install', 'download'].includes(action)) return;
  updateBusy = true;
  setUpdateState({ message: action === 'check' ? 'Checking GitHub…' : 'Opening the Linux downloads…', progress: 0 });
  try {
    const latest = await checkForUpdate();
    if (!latest) {
      updateBusy = false;
      setUpdateState({ latest: null, available: false, message: 'No published Linux update is available yet.', progress: 0 });
      return;
    }
    const currentParts = appVersion.split('.').slice(0, 3).map(value => Number.parseInt(value, 10));
    const available = compareVersions(latest.parts, currentParts) > 0;
    if ((action === 'install' || action === 'download') && available) {
      const fixedReleaseUrl = `${RELEASE_URL}${latest.tag}`;
      await shell.openExternal(fixedReleaseUrl);
    }
    updateBusy = false;
    setUpdateState({ latest: latest.tag.slice('client-v'.length), available, message: (action === 'install' || action === 'download') && available ? 'Choose the Linux package for your distribution on the trusted Vumiro release page.' : available ? `Vumiro ${latest.tag.slice('client-v'.length)} is available.` : "You're up to date.", progress: 0 });
  } catch (error) {
    updateBusy = false;
    setUpdateState({ busy: false, message: `Update unavailable: ${error.message || 'Could not reach GitHub.'}`, progress: 0 });
  }
}

function makeTrayIcon() {
  const candidates = [
    path.join(app.getAppPath(), 'resources', 'icon.png'),
    path.join(process.resourcesPath || '', 'resources', 'icon.png'),
    path.join(__dirname, 'resources', 'icon.png')
  ];
  const file = candidates.find(candidate => candidate && fs.existsSync(candidate));
  return file ? nativeImage.createFromPath(file) : nativeImage.createEmpty();
}

function restoreWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  if (!mainWindow.isVisible()) mainWindow.show();
  mainWindow.focus();
}

function createTray() {
  try {
    const icon = makeTrayIcon();
    if (icon.isEmpty()) return false;
    tray = new Tray(icon);
    tray.setToolTip('Vumiro');
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: 'Open Vumiro', click: restoreWindow },
      { type: 'separator' },
      { label: 'Quit Vumiro', accelerator: 'CommandOrControl+Q', click: () => quitApplication() }
    ]));
    tray.on('click', restoreWindow);
    return true;
  } catch {
    tray = null;
    return false;
  }
}

function quitApplication() {
  if (quitting) return;
  quitting = true;
  if (tray) {
    tray.destroy();
    tray = null;
  }
  app.quit();
}

function configurePermissions() {
  const ses = session.defaultSession;
  ses.setPermissionCheckHandler((contents, permission, requestingOrigin, details = {}) => {
    const origin = details.securityOrigin || requestingOrigin;
    if (!isTrustedPermissionFrame(contents, origin)) return false;
    if (permission === 'media') return details.mediaType === 'audio';
    if (permission === 'display-capture') return isTrustedPage(details.requestingUrl, '/call.html');
    return ['clipboard-sanitized-write', 'fullscreen'].includes(permission);
  });
  ses.setPermissionRequestHandler((contents, permission, callback, details = {}) => {
    const requestingUrl = details.requestingUrl || details.securityOrigin || '';
    if (!isTrustedPermissionFrame(contents, requestingUrl)) return callback(false);
    if (permission === 'clipboard-sanitized-write') return callback(true);
    if (permission === 'fullscreen') return callback(true);
    if (permission === 'media') {
      const types = Array.isArray(details.mediaTypes) ? details.mediaTypes : [];
      return callback(types.length === 1 && types[0] === 'audio');
    }
    if (permission === 'display-capture') return callback(isTrustedPage(details.requestingUrl, '/call.html'));
    return callback(false);
  });
}

function frameIsTrustedCall(frame) {
  if (!frame || !mainWindow || mainWindow.isDestroyed()) return false;
  try {
    return frame.top === mainWindow.webContents.mainFrame && isTrustedPage(frame.url, '/call.html');
  } catch { return false; }
}

function createCapturePicker(sources) {
  return new Promise(resolve => {
    if (!sources.length || !mainWindow || mainWindow.isDestroyed()) return resolve(null);
    permittedCaptureSources = new Map(sources.map(source => [source.id, source]));
    const pickerPath = path.join(__dirname, 'capture-picker.html');
    capturePicker = new BrowserWindow({
      parent: mainWindow,
      modal: true,
      width: 680,
      height: 560,
      minWidth: 520,
      minHeight: 420,
      title: 'Choose what to share',
      icon: makeTrayIcon(),
      backgroundColor: '#0b0b0c',
      show: false,
      autoHideMenuBar: true,
      webPreferences: {
        preload: path.join(__dirname, 'capture-picker-preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        webviewTag: false
      }
    });
    const activePicker = capturePicker;
    const finish = source => {
      if (capturePicker === activePicker) capturePicker = null;
      if (finishCapturePicker === finish) finishCapturePicker = null;
      permittedCaptureSources = new Map();
      resolve(source || null);
      if (!activePicker.isDestroyed()) activePicker.close();
    };
    activePicker.once('closed', () => {
      if (capturePicker === activePicker) capturePicker = null;
      if (finishCapturePicker === finish) finishCapturePicker = null;
      permittedCaptureSources = new Map();
      resolve(null);
    });
    activePicker.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    activePicker.webContents.on('will-frame-navigate', event => {
      if (event.url !== pathToFileURL(pickerPath).href) event.preventDefault();
    });
    finishCapturePicker = finish;
    activePicker.loadFile(pickerPath).then(() => {
      if (!activePicker.isDestroyed()) activePicker.show();
    }).catch(() => finish(null));
  });
}

function configureDisplayCapture() {
  session.defaultSession.setDisplayMediaRequestHandler(async (request, callback) => {
    if (captureRequestBusy) return callback(null);
    if (!request.userGesture || !request.videoRequested || request.audioRequested || !frameIsTrustedCall(request.frame)) return callback(null);
    captureRequestBusy = true;
    const complete = streams => { try { callback(streams); } catch { /* The requesting frame may have closed. */ } };
    // Linux does not offer system loopback audio. Ignore any requested display audio.
    try {
      const sources = await desktopCapturer.getSources({ types: ['screen', 'window'], thumbnailSize: { width: 320, height: 200 }, fetchWindowIcons: false });
      if (!sources.length || !frameIsTrustedCall(request.frame)) return complete(null);
      const wayland = process.env.XDG_SESSION_TYPE === 'wayland' || !!process.env.WAYLAND_DISPLAY;
      if (wayland && sources.length === 1) return complete({ video: sources[0] });
      const selected = await createCapturePicker(sources);
      if (!selected || !frameIsTrustedCall(request.frame)) return complete(null);
      return complete({ video: selected });
    } catch {
      return complete(null);
    } finally {
      captureRequestBusy = false;
    }
  });
}

function registerIpc() {
  ipcMain.handle('vumiro:secure-store', async (event, request) => {
    if (!mainWindow || event.sender !== mainWindow.webContents || event.senderFrame !== event.sender.mainFrame || !request || !['get', 'set', 'delete'].includes(request.action)) throw new Error('Secure account storage is available only to Vumiro.');
    if (!safeStorage.isEncryptionAvailable()) throw new Error('The operating system secure storage service is unavailable.');
    if (process.platform === 'linux' && safeStorage.getSelectedStorageBackend() === 'basic_text') throw new Error('Set up GNOME Keyring or KWallet to keep your account session securely on this device.');
    const file = path.join(app.getPath('userData'), 'account-session.bin');
    if (request.action === 'get') {
      try { return safeStorage.decryptString(await fs.promises.readFile(file)); }
      catch (error) { if (error.code === 'ENOENT') return ''; throw new Error('Could not read the secure account session.'); }
    }
    if (request.action === 'set') {
      if (typeof request.value !== 'string' || request.value.length > 8192) throw new Error('Invalid secure account session.');
      await fs.promises.mkdir(path.dirname(file), { recursive: true });
      const temporary = `${file}.${randomUUID()}.tmp`;
      let handle;
      try {
        handle = await fs.promises.open(temporary, 'wx', 0o600);
        await handle.writeFile(safeStorage.encryptString(request.value));
        await handle.sync();
        await handle.close();handle = null;
        await fs.promises.rename(temporary, file);
      } catch (error) {
        if (handle) await handle.close().catch(() => {});
        await fs.promises.unlink(temporary).catch(unlinkError => { if (unlinkError.code !== 'ENOENT') throw unlinkError; });
        throw error;
      }
      return true;
    }
    try { await fs.promises.unlink(file); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    return true;
  });
  ipcMain.on('vumiro:post-message', (event, message) => {
    if (!mainWindow || event.sender !== mainWindow.webContents || !validMainFrame(event.sender, event.senderFrame) || !message || typeof message !== 'object' || Array.isArray(message)) return;
    const keys = Object.keys(message).sort();
    if (message.type === 'updates' && keys.join(',') === 'action,type' && ['state', 'check', 'install', 'download'].includes(message.action)) {
      void handleUpdateAction(message.action);
      return;
    }
    if (message.type === 'window' && keys.join(',') === 'action,type' && message.action === 'notify') {
      if (Notification.isSupported()) new Notification({ title: 'Vumiro', body: 'You have new activity.' }).show();
    }
  });

  ipcMain.on('capture-picker:ready', event => {
    if (!capturePicker || event.sender !== capturePicker.webContents || event.senderFrame !== event.sender.mainFrame || capturePicker.isDestroyed()) return;
    const safeSources = [...permittedCaptureSources.values()].map(source => ({ id: source.id, name: source.name, thumbnail: source.thumbnail.toDataURL() }));
    capturePicker.webContents.send('capture-picker:sources', safeSources);
  });
  ipcMain.on('capture-picker:select', (event, id) => {
    if (!capturePicker || event.sender !== capturePicker.webContents || event.senderFrame !== event.sender.mainFrame || typeof id !== 'string' || !finishCapturePicker) return;
    finishCapturePicker(permittedCaptureSources.get(id) || null);
  });
  ipcMain.on('capture-picker:cancel', event => {
    if (!capturePicker || event.sender !== capturePicker.webContents || event.senderFrame !== event.sender.mainFrame || !finishCapturePicker) return;
    finishCapturePicker(null);
  });
}

function splashHtml() {
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"><style>html,body{margin:0;width:100%;height:100%;background:#0b0b0c;color:#ddd;font:14px system-ui,sans-serif}body{display:grid;place-items:center}.box{text-align:center}.spinner{width:36px;height:36px;margin:0 auto 19px;border:3px solid #30191e;border-top-color:#e11d2e;border-radius:50%;animation:spin .8s linear infinite}@keyframes spin{to{transform:rotate(360deg)}}p{margin:0}</style></head><body><div class="box"><div class="spinner"></div><p>Opening Vumiro…</p></div></body></html>`;
}

async function createWindows() {
  mainWindow = new BrowserWindow({
    width: 1160,
    height: 800,
    minWidth: 940,
    minHeight: 640,
    title: 'Vumiro',
    icon: makeTrayIcon(),
    show: false,
    backgroundColor: '#0b0b0c',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webviewTag: false,
      backgroundThrottling: false
    }
  });
  const window = mainWindow;
  const canHide = createTray();
  window.on('close', event => {
    if (!quitting && canHide) {
      event.preventDefault();
      window.hide();
    }
  });
  window.on('closed', () => {
    if (mainWindow === window) mainWindow = null;
    if (!canHide && !quitting) quitApplication();
  });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-frame-navigate', event => {
    const url = parseAppUrl(event.url);
    if (!url || !['/friends.html', '/call.html'].includes(url.pathname)) event.preventDefault();
  });
  window.webContents.on('did-finish-load', () => {
    if (window !== mainWindow || window.isDestroyed() || !validMainFrame(window.webContents)) return;
    if (splashWindow && !splashWindow.isDestroyed()) splashWindow.close();
    splashWindow = null;
    window.show();
    sendToPage({ type: 'window-state', maximized: window.isMaximized(), fullscreen: window.isFullScreen(), backdrop: false });
    void handleUpdateAction('check');
  });
  window.webContents.on('did-fail-load', (_event, code, description, validatedURL, isMainFrame) => {
    if (isMainFrame && code !== -3 && window === mainWindow && !window.isDestroyed()) {
      if (splashWindow && !splashWindow.isDestroyed()) splashWindow.close();
      splashWindow = null;
      window.show();
      void dialog.showMessageBox(window, { type: 'error', title: 'Vumiro could not start', message: 'Vumiro could not load its local interface.', detail: `${description}\n${validatedURL}` });
    }
  });
  window.on('enter-full-screen', () => sendToPage({ type: 'window-state', maximized: window.isMaximized(), fullscreen: true, backdrop: false }));
  window.on('leave-full-screen', () => sendToPage({ type: 'window-state', maximized: window.isMaximized(), fullscreen: false, backdrop: false }));
  window.on('maximize', () => sendToPage({ type: 'window-state', maximized: true, fullscreen: window.isFullScreen(), backdrop: false }));
  window.on('unmaximize', () => sendToPage({ type: 'window-state', maximized: false, fullscreen: window.isFullScreen(), backdrop: false }));

  splashWindow = new BrowserWindow({
    width: 360,
    height: 190,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    frame: false,
    alwaysOnTop: true,
    backgroundColor: '#0b0b0c',
    icon: makeTrayIcon(),
    show: false,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true }
  });
  splashWindow.once('ready-to-show', () => splashWindow && !splashWindow.isDestroyed() && splashWindow.show());
  splashWindow.center();
  await splashWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(splashHtml())}`);
  const initialUrl = new URL(`${APP_URL}/friends.html`);
  initialUrl.searchParams.set('signaling', DEFAULT_SIGNALING);
  initialUrl.searchParams.set('fps', '60');
  initialUrl.searchParams.set('mbps', '20');
  await window.loadURL(initialUrl.href);
}

function setApplicationMenu() {
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: 'Vumiro', submenu: [
      { label: 'About Vumiro', click: () => dialog.showMessageBox(mainWindow, { type: 'info', title: 'About Vumiro', message: `Vumiro ${appVersion}`, detail: 'Private screen sharing with friends.' }) },
      { type: 'separator' },
      { label: 'Quit Vumiro', accelerator: 'CommandOrControl+Q', click: () => quitApplication() }
    ] }
  ]));
}

const hasLock = app.requestSingleInstanceLock();
if (!hasLock) {
  app.quit();
} else {
  app.on('second-instance', restoreWindow);
  app.on('before-quit', () => { quitting = true; });
  app.on('will-quit', () => {
    if (tray) tray.destroy();
  });
  app.on('window-all-closed', () => {
    // The main window remains alive when hidden to the tray. Explicit quit owns shutdown.
  });
  app.on('activate', restoreWindow);
  app.whenReady().then(() => powerMonitor.on('shutdown', quitApplication));
  app.on('web-contents-created', (_event, contents) => {
    contents.on('will-attach-webview', event => event.preventDefault());
    contents.setWindowOpenHandler(() => ({ action: 'deny' }));
  });
  process.on('SIGTERM', quitApplication);
  process.on('SIGINT', quitApplication);
  app.whenReady().then(async () => {
    protocol.handle(APP_SCHEME, serveAppAsset);
    registerIpc();
    configurePermissions();
    configureDisplayCapture();
    setApplicationMenu();
    await createWindows();
  }).catch(error => {
    dialog.showErrorBox('Vumiro could not start', error.message || String(error));
    quitApplication();
  });
}
