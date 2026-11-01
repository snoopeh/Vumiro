const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.join(__dirname, '../ScreenTask/WebServer');

function fixture() {
  const timers = new Map(), frames = new Map(), videoFrames = new Map();
  let sequence = 0, draws = 0;
  const canvas = {hidden: true, style: {}, setAttribute() {}, remove() { this.removed = true; }, getContext: () => ({drawImage() { draws++; }})};
  const window = {}, stage = {appendChild(element) { assert.equal(element, canvas); }};
  vm.runInNewContext(fs.readFileSync(path.join(root, 'frame-hold.js'), 'utf8'), {
    window, document: {createElement: type => { assert.equal(type, 'canvas'); return canvas; }},
    setTimeout(callback, duration) { assert.equal(duration, 110); timers.set(++sequence, callback); return sequence; },
    clearTimeout(id) { timers.delete(id); },
    requestAnimationFrame(callback) { frames.set(++sequence, callback); return sequence; },
    cancelAnimationFrame(id) { frames.delete(id); }
  });
  const video = {
    videoWidth: 3840, videoHeight: 2160, readyState: 2, hidden: false, seeking: false,
    requestVideoFrameCallback(callback) { videoFrames.set(++sequence, callback); return sequence; },
    cancelVideoFrameCallback(id) { videoFrames.delete(id); }
  };
  const controller = window.ScreenTaskFrameHold.attach(stage);
  const run = collection => { const callbacks = [...collection.values()]; collection.clear(); callbacks.forEach(callback => callback()); };
  return {controller, canvas, video, timers, frames, videoFrames, run, get draws() { return draws; }};
}

const cover = fixture();
assert.equal(cover.controller.hold({...cover.video, readyState: 1}), false);
assert.equal(cover.canvas.hidden, true);
assert.equal(cover.controller.hold(cover.video), true);
assert.equal(cover.canvas.hidden, false);
assert.equal(cover.canvas.width, 3840);
assert.equal(cover.canvas.height, 2160);
assert.equal(cover.draws, 1);
// Source resets and JPEG retries cannot replace the valid snapshot with a blank.
cover.controller.hold({...cover.video, readyState: 0, videoWidth: 0});
assert.equal(cover.draws, 1);
cover.controller.releaseAfterFrame(cover.video);
assert.equal(cover.canvas.style.opacity, '1', 'Keep the last frame until the replacement actually renders');
cover.run(cover.videoFrames);
assert.equal(cover.canvas.style.opacity, '0');
assert.equal(cover.canvas.hidden, false, 'Crossfade before hiding the old frame');
assert.equal(cover.canvas.style.transition, 'opacity 100ms linear');
cover.run(cover.timers);
assert.equal(cover.canvas.hidden, true);
assert.equal(cover.controller.holding, false);

const interrupted = fixture();
interrupted.controller.hold(interrupted.video);
interrupted.controller.releaseAfterFrame(interrupted.video);
interrupted.run(interrupted.videoFrames);
const staleFade = [...interrupted.timers.values()][0];
interrupted.controller.hold(interrupted.video);
assert.equal(interrupted.canvas.style.opacity, '1');
assert.equal(interrupted.draws, 1, 'Transitions must not copy a 4K frame on every callback');
staleFade();
assert.equal(interrupted.canvas.hidden, false);
interrupted.controller.releaseAfterFrame(interrupted.video);
const staleFrame = [...interrupted.videoFrames.values()][0];
interrupted.controller.stop(); interrupted.controller.stop();
assert.equal(interrupted.videoFrames.size, 0);
assert.equal(interrupted.timers.size, 0);
assert.equal(interrupted.canvas.removed, true);
staleFrame();
assert.equal(interrupted.canvas.hidden, true);
assert.equal(interrupted.controller.hold(interrupted.video), false);

const jpeg = fixture(), image = {naturalWidth: 1920, naturalHeight: 1080, hidden: false};
jpeg.controller.hold(image);
jpeg.controller.releaseAfterFrame(image);
jpeg.controller.releaseAfterFrame(image);
assert.equal(jpeg.frames.size, 1, 'Repeated JPEG onload events must not restart a pending crossfade');
jpeg.run(jpeg.frames);
assert.equal(jpeg.canvas.style.opacity, '1');
jpeg.run(jpeg.frames);
assert.equal(jpeg.canvas.style.opacity, '0');
jpeg.controller.releaseAfterFrame(image);
assert.equal(jpeg.timers.size, 1);
jpeg.run(jpeg.timers);
assert.equal(jpeg.canvas.hidden, true);

async function hdrRetainsCanvas() {
  const events = new Map(), scheduledFrames = new Map(), canvases = [];
  let sequence = 0;
  const video = {
    style: {}, videoWidth: 640, videoHeight: 360, readyState: 2, seeking: false, color: 'old',
    addEventListener(name, callback) { events.set(name, callback); },
    async play() {}, pause() {}, removeAttribute() {}, load() { this.readyState = 0; }, remove() {},
    requestVideoFrameCallback(callback) { scheduledFrames.set(++sequence, callback); return sequence; },
    cancelVideoFrameCallback(id) { scheduledFrames.delete(id); }
  };
  const track = {requestFrame() {}, stop() { this.stopped = true; }};
  function canvas() {
    const result = {width: 300, height: 150, color: null, captureStream: () => ({getTracks: () => [track], getVideoTracks: () => [track]}),
      getContext: () => ({drawImage(source) { if (source.failDraw) throw new Error('Replacement not decoded'); result.color = source.color; }})};
    canvases.push(result); return result;
  }
  class MediaSource { addEventListener() {} }
  const window = {MediaSource};
  vm.runInNewContext(fs.readFileSync(path.join(root, 'hdr-source.js'), 'utf8'), {
    window, MediaSource, HTMLCanvasElement: {prototype: {captureStream() {}}}, AbortController,
    document: {createElement: name => name === 'video' ? video : canvas(), body: {appendChild() {}}},
    URL: {createObjectURL: () => 'blob:test', revokeObjectURL() {}},
    setTimeout: () => ++sequence, clearTimeout() {}, cancelAnimationFrame() {}
  });
  const source = window.ScreenTaskHdrSource.create(), output = canvases[0];
  await events.get('loadeddata')(); await source.ready;
  assert.equal(output.color, 'old');
  assert.deepEqual([output.width, output.height], [640, 360]);
  events.get('error')();
  assert.equal(output.color, 'old', 'Decoder cleanup must leave the previous canvas pixels visible');
  assert.deepEqual([output.width, output.height], [640, 360]);
  video.readyState = 2; video.videoWidth = 1280; video.videoHeight = 720; video.color = 'new';
  await events.get('loadeddata')();
  assert.equal(output.color, 'new');
  assert.deepEqual([output.width, output.height], [1280, 720]);
  events.get('error')();
  video.readyState = 2; video.videoWidth = 1920; video.videoHeight = 1080; video.failDraw = true;
  await events.get('loadeddata')();
  assert.equal(output.color, 'new', 'A failed replacement draw must preserve the old canvas');
  assert.deepEqual([output.width, output.height], [1280, 720], 'Do not clear the output dimensions until a replacement draw succeeds');
  source.stop();
  assert.equal(track.stopped, true);
}
hdrRetainsCanvas().then(() => console.log('PASS: transition-only frame hold, first-render crossfade, JPEG retries, stale callback cleanup and native HDR frame retention')).catch(error => { console.error(error); process.exitCode = 1; });
