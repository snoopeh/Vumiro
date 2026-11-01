const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../ScreenTask/WebServer/rtc-client.js'), 'utf8');

async function capture({width, height, rejectPreference = false, textSupported = true, hintSupported = true}) {
  const elements = new Map();
  const element = id => {
    if (!elements.has(id)) elements.set(id, {value: '', textContent: '', disabled: false, checked: false, style: {}, removeAttribute() {}});
    return elements.get(id);
  };
  let hint = '', captureOptions, socket, transaction = 0;
  const updates = [], accepted = [];
  const track = {kind: 'video', getSettings: () => ({width, height}), addEventListener() {}, stop() {}};
  if (hintSupported) Object.defineProperty(track, 'contentHint', {
    get: () => hint,
    set: value => { if (value !== 'text' || textSupported) hint = value; }
  });
  const stream = {getTracks: () => [track], getVideoTracks: () => [track]};
  const sender = {
    track,
    getParameters: () => ({transactionId: String(++transaction), encodings: [{}]}),
    async setParameters(parameters) {
      updates.push(structuredClone(parameters));
      if (rejectPreference && parameters.degradationPreference) throw new TypeError('Unsupported preference');
      accepted.push(parameters);
    }
  };
  class Socket {
    static OPEN = 1;
    constructor() { socket = this; this.readyState = 1; }
    send() {}
  }
  class Peer {
    addTrack() {}
    getSenders() { return [sender]; }
    async createOffer() { return {type: 'offer', sdp: ''}; }
    async setLocalDescription(description) { this.localDescription = description; }
  }
  vm.runInNewContext(source, {
    document: {getElementById: element},
    window: {isSecureContext: true, RTCPeerConnection: Peer, addEventListener() {}},
    navigator: {mediaDevices: {async getDisplayMedia(options) { captureOptions = options; return stream; }}},
    location: {href: 'http://localhost:17871/host', origin: 'http://localhost:17871', host: 'localhost:17871', protocol: 'http:'},
    crypto: {getRandomValues: bytes => bytes.fill(1)},
    fetch: async () => ({ok: false}),
    WebSocket: Socket, RTCPeerConnection: Peer, URL, Uint8Array,
    setTimeout: () => 1, clearTimeout() {}, setInterval: () => 1, clearInterval() {}
  });
  await element('start').onclick();
  assert.deepEqual(JSON.parse(JSON.stringify(captureOptions.video)), {frameRate: {ideal: 60, max: 60}}, 'Capture should honor frame rate without imposing a smaller resolution');
  assert.equal(hint, hintSupported ? textSupported ? 'text' : 'detail' : '');
  socket.onmessage({data: JSON.stringify({type: 'peer-ready'})});
  await new Promise(setImmediate);
  assert.equal(accepted.length, 1, 'A supported encoding update should survive an unsupported preference');
  const parameters = accepted[0];
  assert.equal(parameters.encodings[0].maxFramerate, 60);
  assert.equal(parameters.encodings[0].scaleResolutionDownBy, 1);
  assert.equal(parameters.degradationPreference, rejectPreference ? undefined : 'maintain-resolution');
  if (rejectPreference) {
    assert.equal(updates.length, 2);
    assert.notEqual(updates[0].transactionId, updates[1].transactionId, 'Fallback must use fresh sender parameters');
  }
  return parameters.encodings[0].maxBitrate;
}

(async () => {
  for (const [width, height, bitrate] of [[1280, 720, 6000000], [1920, 1080, 12000000], [2560, 1440, 20000000], [3840, 2160, 32000000]]) {
    assert.equal(await capture({width, height}), bitrate);
  }
  assert.equal(await capture({width: 3840, height: 2160, rejectPreference: true, textSupported: false}), 32000000);
  assert.equal(await capture({width: 1920, height: 1080, hintSupported: false}), 12000000);
  console.log('PASS: text/detail hints, 60 FPS capture, resolution-aware bitrate and maintain-resolution compatibility fallback');
})().catch(error => { console.error(error); process.exitCode = 1; });
