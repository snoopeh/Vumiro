'use strict';

const { app, BrowserWindow, Menu, Tray, nativeImage, protocol, session, desktopCapturer, ipcMain, shell, dialog, Notification, powerMonitor, safeStorage, screen } = require('electron');
let nativeNudge;
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID, randomBytes, createHash } = require('node:crypto');
const launchId = randomUUID();
const http = require('node:http');
const { pathToFileURL } = require('node:url');

const APP_SCHEME = 'vumiro';
const APP_HOST = 'app';
const APP_URL = `${APP_SCHEME}://${APP_HOST}`;
const WEB_ROOT = path.join(app.getAppPath(), 'webserver');
const RELEASES_API = 'https://api.github.com/repos/snoopeh/Vumiro/releases/latest';
const RELEASE_URL = 'https://github.com/snoopeh/Vumiro/releases/tag/';
const ASSET_PATHS = new Map([
  ['/auth.html', 'text/html; charset=utf-8'],
  ['/chat-storage.js', 'text/javascript; charset=utf-8'],
  ['/incoming-call.js', 'text/javascript; charset=utf-8'],
  ['/direct-messages.js', 'text/javascript; charset=utf-8'],
  ['/direct-chat.js', 'text/javascript; charset=utf-8'],
  ['/server-workspace.js', 'text/javascript; charset=utf-8'],
  ['/community-themes.js', 'text/javascript; charset=utf-8'],
  ['/profile-cosmetics.js', 'text/javascript; charset=utf-8'],
  ['/community-studio.js', 'text/javascript; charset=utf-8'],
  ['/marketplace-studio-entry.js', 'text/javascript; charset=utf-8'],
  ['/marketplace-model.js', 'text/javascript; charset=utf-8'],
  ['/marketplace-external.js', 'text/javascript; charset=utf-8'],
  ['/marketplace-client.js', 'text/javascript; charset=utf-8'],
  ['/marketplace-entry.js', 'text/javascript; charset=utf-8'],


  ['/app-extras.js', 'text/javascript; charset=utf-8'],
  ['/friends.html', 'text/html; charset=utf-8'],
  ['/ui-controls.js', 'text/javascript; charset=utf-8'],
  ['/controller-art.js', 'text/javascript; charset=utf-8'],
  ['/gaming-view.js', 'text/javascript; charset=utf-8'],
  ['/gaming-lab.js', 'text/javascript; charset=utf-8'],
  ['/controller-mapping.js', 'text/javascript; charset=utf-8'],
  ['/gaming-directory.js', 'text/javascript; charset=utf-8'],
  ['/gaming-session.js', 'text/javascript; charset=utf-8'],
  ['/gaming-client.js', 'text/javascript; charset=utf-8'],
  ['/friends-client.js', 'text/javascript; charset=utf-8'],
  ['/call.html', 'text/html; charset=utf-8'],
  ['/call-client.js', 'text/javascript; charset=utf-8'],
  ['/stream-mosaic.js', 'text/javascript; charset=utf-8'],
  ['/chat-pane.js', 'text/javascript; charset=utf-8'],
  ['/chat-scrollbar.js', 'text/javascript; charset=utf-8'],
  ['/local-profile.js', 'text/javascript; charset=utf-8'],
  ['/profile-cover.js', 'text/javascript; charset=utf-8'],
  ['/profile-crop.js', 'text/javascript; charset=utf-8'],
  ['/cover-editor.js', 'text/javascript; charset=utf-8'],
  ['/cover-transfer.js', 'text/javascript; charset=utf-8'],
  ['/notification-center.js', 'text/javascript; charset=utf-8'],
  ['/settings-drafts.js', 'text/javascript; charset=utf-8'],
  ['/motion.js', 'text/javascript; charset=utf-8'],
  ['/nudge.js', 'text/javascript; charset=utf-8'],
  ['/friend-nudges.js', 'text/javascript; charset=utf-8'],
  ['/i18n.js', 'text/javascript; charset=utf-8'],
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
// Explicit packaged smoke runs use the runner's disposable data and offline driver.
const smoke = process.argv.includes('--vumiro-smoke')
  ? require(process.env.VUMIRO_SMOKE_DRIVER).install({ app, session }) : null;
if (!smoke) app.setPath('userData', path.join(app.getPath('appData'), 'Vumiro-Linux'));

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
let cancelOAuth = null;
const desktopNotifications = new Map();
const desktopNotificationSeen = new Set();
const appVersion = app.getVersion() || '1.21.1';
const DEFAULT_SIGNALING = 'wss://vumiro-rooms.vumiro-signaling.workers.dev/call-signaling';

const MIME = new Map([
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8']
]);

function parseNotification(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).sort().join(',') !== 'avatar,body,category,id,senderName') return null;
  if (typeof value.id !== 'string' || !/^[A-Za-z0-9:_-]{1,128}$/.test(value.id) || !['friend', 'roomInvite', 'call', 'roomActivity', 'message'].includes(value.category)) return null;
  if (typeof value.senderName !== 'string' || !value.senderName.trim() || value.senderName.length > 80 || typeof value.body !== 'string' || !value.body.trim() || value.body.length > 320) return null;
  if (typeof value.avatar !== 'string' || value.avatar.length > 32768 || value.avatar && !/^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(value.avatar)) return null;
  return {id: value.id, category: value.category, senderName: value.senderName, body: value.body, avatar: value.avatar};
}
function showDesktopNotification(input) {
  const data = parseNotification(input);
  if (!data || !Notification.isSupported() || desktopNotificationSeen.has(data.id)) return;
  desktopNotificationSeen.add(data.id);
  if (desktopNotificationSeen.size > 256) desktopNotificationSeen.delete(desktopNotificationSeen.values().next().value);
  while (desktopNotifications.size >= 3) {
    const oldest = desktopNotifications.entries().next().value;
    desktopNotifications.delete(oldest[0]); clearTimeout(oldest[1].timer); oldest[1].notice.close();
  }
  // The page controls all sound, independently of visual notification settings.
  const options = {title: data.senderName, body: data.body, silent: true, timeoutType: 'default'};
  if (data.avatar.startsWith('data:image/png;base64,')) {
    const bytes = Buffer.from(data.avatar.slice(22), 'base64');
    if (bytes.length >= 24 && bytes.readUInt32BE(0) === 0x89504e47 && bytes.readUInt32BE(16) > 0 && bytes.readUInt32BE(16) <= 512 && bytes.readUInt32BE(20) > 0 && bytes.readUInt32BE(20) <= 512) {
      const icon = nativeImage.createFromDataURL(data.avatar); if (!icon.isEmpty()) options.icon = icon;
    }
  }
  const notice = new Notification(options), entry = {notice, timer: null};
  notice.on('click', () => {
    if (!mainWindow || mainWindow.isDestroyed() || !validMainFrame(mainWindow.webContents)) return;
    restoreWindow(); mainWindow.webContents.send('vumiro:message', {type: 'notification-activate', id: data.id}); notice.close();
  });
  notice.on('close', () => { clearTimeout(entry.timer); desktopNotifications.delete(data.id); });
  desktopNotifications.set(data.id, entry);
  entry.timer = setTimeout(() => { desktopNotifications.delete(data.id); notice.close(); }, data.category === 'call' ? 12000 : 7000);
  entry.timer.unref?.();
  notice.show();
}
function clearDesktopNotifications() {
  for (const {notice, timer} of desktopNotifications.values()) { clearTimeout(timer); notice.close(); }
  desktopNotifications.clear(); desktopNotificationSeen.clear();
}

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
  if (!['/auth.html', '/friends.html', '/call.html'].includes(url.pathname) && url.search) return response('Not found', 404);
  const contentType = ASSET_PATHS.get(url.pathname);
  if (!contentType) return response('Not found', 404);
  const filename = path.join(WEB_ROOT, path.basename(url.pathname));
  try {
    const content = await fs.promises.readFile(filename);
    if (smoke) smoke.assetLoaded(url.pathname);
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

function validAccountFrame(contents, senderFrame) {
  return validMainFrame(contents, senderFrame, '/friends.html') || validMainFrame(contents, senderFrame, '/auth.html');
}

const OAUTH_RETURN_SCRIPT = "history.replaceState(null,'',location.pathname);window.close();";
const OAUTH_CALLBACK_CSP = "default-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; style-src 'unsafe-inline'; script-src 'sha256-" + createHash('sha256').update(OAUTH_RETURN_SCRIPT).digest('base64') + "'";
function oauthCallbackBody(success) {
  return '<!doctype html><html lang=en><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1"><title>Vumiro sign-in</title>' +
    '<style>html{color-scheme:dark}body{font:16px/1.6 system-ui,sans-serif;max-width:32rem;margin:18vh auto;padding:2rem;background:#171416;color:#f7f4f4}h1{font-size:1.7rem}p{color:#c7bec1}</style>' +
    (success ? '<h1>Continue in Vumiro.</h1><p>Your browser sign-in has returned to the app. If this tab stays open, you can close it and return to Vumiro.</p><script>' + OAUTH_RETURN_SCRIPT + '</script>' :
      '<h1>Sign-in was not completed.</h1><p>Return to Vumiro to try again. You can close this tab.</p>') + '</html>';
}

function startOAuth(request) {
  if (!request || typeof request !== 'object' || Array.isArray(request) || Object.keys(request).sort().join(',') !== 'authUrl,codeChallenge,provider' ||
      !['google', 'azure'].includes(request.provider) || typeof request.codeChallenge !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(request.codeChallenge) ||
      typeof request.authUrl !== 'string' || !/^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/.test(request.authUrl))
    return Promise.reject(new Error('Invalid account sign-in request.'));
  if (cancelOAuth) return Promise.reject(new Error('An account sign-in is already open in your browser.'));
  return new Promise((resolve, reject) => {
    const callbackPath = `/vumiro-auth/${randomBytes(24).toString('base64url')}/`;
    const sockets = new Set();
    let finished = false;
    const finish = (error, code) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      if (cancelOAuth === cancel) cancelOAuth = null;
      server.close();
      for (const socket of sockets) socket.destroy();
      if (error) reject(new Error(error)); else { restoreWindow(); resolve({ code }); }
    };
    const cancel = () => finish('Account sign-in expired or was cancelled. Try again.');
    const server = http.createServer({ maxHeaderSize: 8192 }, (incoming, outgoing) => {
      const hostCount = incoming.rawHeaders.filter((_value, index) => index % 2 === 0 && incoming.rawHeaders[index].toLowerCase() === 'host').length;
      let code, error, valid = false;
      if (incoming.method === 'GET' && hostCount === 1 && incoming.headers.host === '127.0.0.1:43821' &&
          typeof incoming.url === 'string' && incoming.url.startsWith(`${callbackPath}?`) && incoming.url.length <= 8192 && !incoming.url.includes('#')) {
        const params = new URLSearchParams(incoming.url.slice(callbackPath.length + 1));
        const duplicate = [...params.keys()].some(key => params.getAll(key).length !== 1);
        code = params.get('code'); error = params.get('error');
        valid = !duplicate && !(code !== null && error !== null) &&
          ((code !== null && /^[A-Za-z0-9._~-]{1,2048}$/.test(code)) || (error !== null && error.length > 0 && error.length <= 2048));
      }
      outgoing.writeHead(valid ? 200 : 400, {
        'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer',
        'Content-Security-Policy': OAUTH_CALLBACK_CSP, 'Connection': 'close'
      });
      outgoing.end(valid ? oauthCallbackBody(error === null) : 'Invalid callback.');
      if (valid) outgoing.once('finish', () => finish(error ? 'The account provider cancelled or declined sign-in. Return to Vumiro and try again.' : null, code));
    });
    server.headersTimeout = 5000;
    server.requestTimeout = 5000;
    server.on('connection', socket => {
      sockets.add(socket);
      socket.setTimeout(5000, () => socket.destroy());
      socket.once('close', () => sockets.delete(socket));
    });
    server.on('error', () => finish('The sign-in callback port is busy. Close other Vumiro sign-in windows and try again.'));
    const timer = setTimeout(cancel, 5 * 60 * 1000);
    cancelOAuth = cancel;
    server.listen(43821, '127.0.0.1', async () => {
      const authorize = new URL('/auth/v1/authorize', request.authUrl);
      authorize.search = new URLSearchParams({ provider: request.provider, redirect_to: `http://127.0.0.1:43821${callbackPath}`,
        code_challenge: request.codeChallenge, code_challenge_method: 's256', scopes: request.provider === 'azure' ? 'email' : 'openid email profile' }).toString();
      try { await shell.openExternal(authorize.href); }
      catch { finish('Vumiro could not open account sign-in in your browser. Try again.'); }
    });
  });
}

function sendToPage(message) {
  if (mainWindow && !mainWindow.isDestroyed() && validMainFrame(mainWindow.webContents)) {
    mainWindow.webContents.send('vumiro:message', message);
  }
}

function sendWindowState() {
  if (mainWindow && !mainWindow.isDestroyed() && validAccountFrame(mainWindow.webContents, mainWindow.webContents.mainFrame))
    mainWindow.webContents.send('vumiro:message', { type: 'window-state', minimized: mainWindow.isMinimized(), maximized: mainWindow.isMaximized(), fullscreen: mainWindow.isFullScreen(), backdrop: false });
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
    if (permission === 'speaker-selection') return true; // Only the trusted local frames checked above.
    if (permission === 'display-capture') return isTrustedPage(details.requestingUrl, '/call.html');
    return ['clipboard-sanitized-write', 'fullscreen'].includes(permission);
  });
  ses.setPermissionRequestHandler((contents, permission, callback, details = {}) => {
    const requestingUrl = details.requestingUrl || details.securityOrigin || '';
    if (!isTrustedPermissionFrame(contents, requestingUrl)) return callback(false);
    if (permission === 'speaker-selection') return callback(true); // Only the trusted local frames checked above.
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
  ipcMain.handle('vumiro:marketplace-external', async (event, request) => {
    if(!validMainFrame(event.sender,event.senderFrame)||!request||Object.keys(request).join(',')!=='url'||typeof request.url!=='string'||request.url.length>8192||/[\s\\\u0000-\u001f]/.test(request.url))throw Error('Invalid marketplace browser request.');
    let url;try{url=new URL(request.url);}catch{throw Error('Invalid hosted payment URL.');}
    if(url.protocol!=='https:'||url.username||url.password||url.port||!((url.hostname==='checkout.stripe.com'&&url.pathname.startsWith('/c/pay/'))||(url.hostname==='connect.stripe.com'&&url.pathname.startsWith('/setup/'))))throw Error('Only hosted payment and seller onboarding URLs are supported.');
    await shell.openExternal(url.href);return true;
  });
  ipcMain.handle('vumiro:oauth', async (event, request) => {
    if (smoke) throw new Error('Account sign-in is disabled during offline smoke checks.');
    if (!validAccountFrame(event.sender, event.senderFrame)) throw new Error('Account sign-in is available only to Vumiro.');
    return startOAuth(request);
  });
  ipcMain.handle('vumiro:secure-store', async (event, request) => {
    if (!validAccountFrame(event.sender, event.senderFrame) || !request || !['get', 'set', 'delete'].includes(request.action)) throw new Error('Secure account storage is available only to Vumiro.');
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
    if (!mainWindow || event.sender !== mainWindow.webContents || !validAccountFrame(event.sender, event.senderFrame) || !message || typeof message !== 'object' || Array.isArray(message)) return;
    const keys = Object.keys(message).sort();
    if (message.type === 'window' && keys.join(',') === 'action,type' && ['state', 'close', 'minimize', 'maximize'].includes(message.action)) {
      if (message.action === 'close') mainWindow.close();
      else if (message.action === 'minimize') mainWindow.minimize();
      else if (message.action === 'maximize' && !mainWindow.isFullScreen()) {
        if (mainWindow.isMaximized()) mainWindow.unmaximize(); else mainWindow.maximize();
      }
      sendWindowState();
      return;
    }
    if (!validMainFrame(event.sender, event.senderFrame)) return;
    if (message.type === 'updates' && keys.join(',') === 'action,type' && ['state', 'check', 'install', 'download'].includes(message.action)) {
      void handleUpdateAction(message.action);
      return;
    }
    if (message.type === 'window' && keys.join(',') === 'action,silent,type' && message.action === 'nudge' && typeof message.silent === 'boolean') nativeNudge.start(mainWindow, message.silent);
    if (message.type === 'window' && keys.join(',') === 'action,type' && message.action === 'nudge-cancel') nativeNudge.cancel();
    if (message.type === 'window' && keys.join(',') === 'action,notification,type' && message.action === 'notify') showDesktopNotification(message.notification);
    if (message.type === 'window' && keys.join(',') === 'action,type' && message.action === 'notify-clear') clearDesktopNotifications();
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
  const createNudge = require('./native-nudge.cjs');
  nativeNudge = createNudge({BrowserWindow, screen, positioningSupported:createNudge.positioningSupported(process.env, app.commandLine.getSwitchValue('ozone-platform'))});
  mainWindow = new BrowserWindow({
    width: 1160,
    height: 800,
    minWidth: smoke ? 480 : 940,
    minHeight: 640,
    title: 'Vumiro',
    icon: makeTrayIcon(),
    show: false,
    backgroundColor: '#0b0b0c',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      additionalArguments: ['--vumiro-launch-id='+launchId,...(nativeNudge.positioningSupported ? ['--vumiro-native-nudge'] : [])],
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webviewTag: false,
      backgroundThrottling: false
    }
  });
  const window = mainWindow;
  if (smoke) await smoke.observe(window);
  const canHide = smoke ? false : createTray();
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
    if (!url || !['/friends.html', '/auth.html', '/call.html'].includes(url.pathname)) event.preventDefault();
    else if (event.isMainFrame && cancelOAuth) cancelOAuth();
  });
  window.webContents.on('did-finish-load', () => {
    if (window !== mainWindow || window.isDestroyed() || !validAccountFrame(window.webContents, window.webContents.mainFrame)) return;
    if (splashWindow && !splashWindow.isDestroyed()) splashWindow.close();
    splashWindow = null;
    if (!smoke) window.show();
    sendWindowState();
    if (!smoke) void handleUpdateAction('check');
  });
  window.webContents.on('did-fail-load', (_event, code, description, validatedURL, isMainFrame) => {
    if (isMainFrame && code !== -3 && window === mainWindow && !window.isDestroyed()) {
      if (smoke) { smoke.fail(new Error(`Local interface load failed: ${description}`)); return; }
      if (splashWindow && !splashWindow.isDestroyed()) splashWindow.close();
      splashWindow = null;
      window.show();
      void dialog.showMessageBox(window, { type: 'error', title: 'Vumiro could not start', message: 'Vumiro could not load its local interface.', detail: `${description}\n${validatedURL}` });
    }
  });
  window.on('enter-full-screen', sendWindowState);
  window.on('leave-full-screen', sendWindowState);
  window.on('maximize', sendWindowState);
  window.on('unmaximize', sendWindowState);
  window.on('minimize', sendWindowState);
  window.on('restore', sendWindowState);
  window.on('closed', () => { clearDesktopNotifications(); nativeNudge.cancel(); });
  window.on('minimize', () => nativeNudge.cancel());
  window.on('hide', () => nativeNudge.cancel());
  window.webContents.on('did-start-navigation', (_event, _url, isInPlace, isMainFrame) => { if (isMainFrame && !isInPlace) { clearDesktopNotifications(); nativeNudge.cancel(); } });

  if (!smoke) {
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
  }
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
  app.on('before-quit', () => { quitting = true; if (cancelOAuth) cancelOAuth(); });
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
    if (smoke) smoke.configure();
    setApplicationMenu();
    await createWindows();
    if (smoke) await smoke.run(mainWindow);
  }).catch(error => {
    if (smoke) { smoke.fail(error); return; }
    dialog.showErrorBox('Vumiro could not start', error.message || String(error));
    quitApplication();
  });
}
