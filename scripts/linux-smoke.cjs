'use strict';

// Loaded only by the packaged main process with --vumiro-smoke. No product globals are replaced.
const fs = require('node:fs');
const path = require('node:path');
const { generateKeyPairSync } = require('node:crypto');

function allowSmokeRequest(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'vumiro:' && url.hostname === 'app' && !url.username && !url.password && !url.port;
  } catch { return false; }
}

function install({ app, session }) {
  const directory = process.env.VUMIRO_SMOKE_DIR;
  if (!directory || !path.isAbsolute(directory) || !fs.statSync(directory).isDirectory()) throw new Error('Smoke mode needs a disposable runner directory.');
  const report = { ok: false, packaged: app.isPackaged, checks: [], rendererErrors: [], blockedRequests: 0, mediaRequests: 0 };
  let finished = false;
  const finish = error => {
    if (finished) return;
    finished = true; clearTimeout(timer);
    report.ok = !error;
    if (error) report.error = error.message || String(error);
    fs.writeFileSync(path.join(directory, 'report.json'), JSON.stringify(report));
    app.exit(error ? 1 : 0);
  };
  const timer = setTimeout(() => finish(new Error('Smoke UI timed out after 45 seconds.')), 45000);
  for (const [name, folder] of [['userData', 'user-data'], ['sessionData', 'session-data']]) {
    const target = path.join(directory, folder);
    fs.mkdirSync(target, { recursive: true });
    app.setPath(name, target);
  }
  app.commandLine.appendSwitch('disable-background-networking');
  app.commandLine.appendSwitch('host-resolver-rules', 'MAP * ~NOTFOUND');
  // The only Node network caller used during startup is the update check; fail closed if one is added.
  globalThis.fetch = async () => { report.blockedRequests++; throw new Error('Offline smoke mode blocks network access.'); };
  process.on('uncaughtException', finish);
  process.on('unhandledRejection', finish);
  const assets = new Set();
  function configure() {
    const ses = session.defaultSession;
    ses.webRequest.onBeforeRequest((details, callback) => {
      const allowed = allowSmokeRequest(details.url);
      if (!allowed) report.blockedRequests++;
      callback({ cancel: !allowed });
    });
    ses.setPermissionCheckHandler((_contents, permission) => { if (['media', 'display-capture'].includes(permission)) report.mediaRequests++; return false; });
    ses.setPermissionRequestHandler((_contents, permission, callback) => { if (['media', 'display-capture'].includes(permission)) report.mediaRequests++; callback(false); });
    ses.setDisplayMediaRequestHandler((_request, callback) => { report.mediaRequests++; callback(null); });
  }
  async function observe(window) {
    window.webContents.on('render-process-gone', (_event, details) => finish(new Error(`Renderer exited: ${details.reason}`)));
    window.webContents.debugger.on('message', (_event, method, params) => {
      if (method === 'Runtime.exceptionThrown') {
        const details = params.exceptionDetails;
        report.rendererErrors.push(details.exception?.description || details.text);
      }
    });
    window.webContents.debugger.attach('1.3');
    await window.webContents.debugger.sendCommand('Runtime.enable');
  }
  async function run(window) {
    try {
      if (!app.isPackaged) throw new Error('Smoke mode requires packaged app resources.');
      const evaluate = (fn, ...args) => window.webContents.executeJavaScript(`(${fn.toString()})(...${JSON.stringify(args)})`, true);
      const wait = async (fn, label, ...args) => {
        const deadline = Date.now() + 5000;
        do {
          if (report.rendererErrors.length) throw new Error(`Renderer exception: ${report.rendererErrors[0]}`);
          if (await evaluate(fn, ...args)) return;
          await new Promise(resolve => setTimeout(resolve, 50));
        } while (Date.now() < deadline);
        throw new Error(`UI assertion timed out: ${label}`);
      };
      const check = name => report.checks.push(name);
      await wait(() => document.querySelector('#setupDialog')?.open || !!document.querySelector('#continueLocal'), 'local setup');
      if (await evaluate(() => !!document.querySelector('#continueLocal'))) {
        await evaluate(() => document.querySelector('#continueLocal').click());
        await wait(() => document.querySelector('#setupDialog')?.open, 'local setup after continue');
      }
      await evaluate(() => { document.querySelector('#setupName').value = 'Linux Smoke'; document.querySelector('#createProfile').click(); });
      await wait(() => !document.querySelector('#setupDialog')?.open && document.querySelector('#selfName')?.textContent === 'Linux Smoke', 'local profile creation');
      check('local-profile');
      if (!await evaluate(() => !document.querySelector('#topSettings, #TechnicalIdentity, #technicalIdentity, .technicalIdentity, #contactIdentity, #createRoomDialog'))) throw new Error('Retired UI is present.');
      check('legacy-ui-absent');
      // Disposable public fixture only; its private key is discarded before import.
      const publicKey = generateKeyPairSync('ec', { namedCurve: 'prime256v1' }).publicKey.export({ format: 'jwk' });
      const compressed = Buffer.concat([Buffer.from([2 | (Buffer.from(publicKey.y, 'base64url')[31] & 1)]), Buffer.from(publicKey.x, 'base64url')]);
      const code = `vm1.${compressed.toString('base64url')}`;
      await evaluate(contactCode => {
        document.querySelector('#addFriend').click();
        document.querySelector('#friendCode').value = contactCode;
        document.querySelector('#friendNickname').value = 'Smoke Friend';
        document.querySelector('#importFriend').click();
      }, code);
      await wait(() => !document.querySelector('#addDialog').open && document.querySelector('.friendNameButton')?.textContent === 'Smoke Friend', 'offline contact import');
      check('offline-contact');
      await evaluate(() => document.querySelector('.friendNameButton').click());
      if (!await evaluate(() => !document.querySelector('#nicknameDialog').open && !document.querySelector('#userCardDialog').open)) throw new Error('Nickname click opened an editor or profile.');
      check('nickname-no-edit');
      window.setMinimumSize(480, 640); window.setContentSize(540, 760);
      await wait(() => innerWidth <= 570, 'narrow viewport');
      await evaluate(() => document.querySelector('.friendEdit').click());
      await wait(() => {
        const dialog = document.querySelector('#nicknameDialog'), input = document.querySelector('#nickname');
        const rect = dialog.getBoundingClientRect(), style = getComputedStyle(dialog);
        return dialog.open && style.display !== 'none' && style.visibility === 'visible' && rect.width > 0 && rect.left >= 0 && rect.right <= innerWidth && rect.top >= 0 && rect.bottom <= innerHeight && document.activeElement === input && input.value === 'Smoke Friend';
      }, 'visible narrow nickname modal');
      check('nickname-modal-narrow');
      await evaluate(() => { document.querySelector('#nickname').value = 'Renamed Smoke'; document.querySelector('#saveNickname').click(); });
      await wait(() => !document.querySelector('#nicknameDialog').open && document.querySelector('.friendNameButton')?.textContent === 'Renamed Smoke', 'nickname persisted');
      check('nickname-save');
      await evaluate(() => document.querySelector('#friendsList .friend').click());
      await wait(() => document.querySelector('#userCardDialog').open, 'friend profile opens');
      // Send real pointer events through Chromium so the dialog backdrop is hit-tested.
      const point = await evaluate(() => { const rect = document.querySelector('#userCardDialog').getBoundingClientRect(); return { x: Math.max(1, rect.left / 2), y: Math.max(1, rect.top / 2) }; });
      await window.webContents.debugger.sendCommand('Input.dispatchMouseEvent', { type: 'mousePressed', button: 'left', clickCount: 1, ...point });
      await window.webContents.debugger.sendCommand('Input.dispatchMouseEvent', { type: 'mouseReleased', button: 'left', clickCount: 1, ...point });
      await wait(() => !document.querySelector('#userCardDialog').open, 'profile backdrop dismissal');
      check('profile-backdrop');
      const secure = await evaluate(async () => {
        try { return { value: await window.vumiroDesktop.secureStore.get() }; }
        catch (error) { return { error: error.message }; }
      });
      if (secure.value !== '' && !/secure storage service is unavailable|GNOME Keyring or KWallet/.test(secure.error || '')) throw new Error('Unexpected secure-store result in disposable profile.');
      if (fs.existsSync(path.join(app.getPath('userData'), 'account-session.bin'))) throw new Error('Smoke profile unexpectedly contains account credentials.');
      check('secure-store');
      await evaluate(() => document.querySelector('#createRoom').click());
      await wait(() => {
        const frame = document.querySelector('#callFrameSlot iframe'), doc = frame?.contentDocument;
        return !document.querySelector('#callArea').hidden && document.body.classList.contains('room-view') &&
          !document.querySelector('dialog[open]') && doc?.querySelector('#mic') && doc?.querySelector('#share') &&
          doc.querySelector('#captureInfo')?.textContent.includes('Choose Share screen or Microphone');
      }, 'direct room entry and packaged call UI');
      check('direct-room');
      for (const asset of ['/friends.html', '/friends-client.js', '/local-profile.js', '/peer-profile.js', '/account-client.js', '/identity-recovery.js', '/call.html', '/call-client.js']) {
        if (!assets.has(asset)) throw new Error(`Packaged asset did not load: ${asset}`);
      }
      if (report.rendererErrors.length) throw new Error(`Renderer exception: ${report.rendererErrors[0]}`);
      if (report.mediaRequests) throw new Error('Smoke UI attempted media capture.');
      if (!report.blockedRequests) throw new Error('The offline network guard was not exercised.');
      check('packaged-assets'); finish();
    } catch (error) { finish(error); }
  }
  return { configure, observe, run, fail: finish, assetLoaded: value => assets.add(value) };
}

module.exports = { allowSmokeRequest, install };
