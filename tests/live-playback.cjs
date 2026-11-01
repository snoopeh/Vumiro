const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../ScreenTask/WebServer/live-playback.js'), 'utf8');

function fixture(overrides = {}, options) {
  const listeners = new Map(), intervals = new Map(), cleared = [], seeks = [];
  let nextTimer = 0, time = overrides.currentTime ?? 1;
  const video = {
    readyState: 2, paused: false, ended: false, seeking: false, playbackRate: 1,
    buffered: ranges([[0, 10]]), ...overrides
  };
  Object.defineProperty(video, 'currentTime', {get: () => time, set: value => { seeks.push(value); time = value; }, configurable: true});
  const document = {
    visibilityState: 'visible',
    addEventListener(event, listener) { assert.equal(event, 'visibilitychange'); listeners.set(event, listener); },
    removeEventListener(event, listener) { assert.equal(listeners.get(event), listener); listeners.delete(event); }
  };
  const window = {};
  vm.runInNewContext(source, {
    window, document,
    setInterval(callback, interval) { intervals.set(++nextTimer, {callback, interval}); return nextTimer; },
    clearInterval(timer) { cleared.push(timer); intervals.delete(timer); }
  });
  const controller = window.ScreenTaskLivePlayback.attach(video, options);
  const tick = () => { for (const timer of intervals.values()) timer.callback(); };
  const visibility = state => { document.visibilityState = state; listeners.get('visibilitychange')?.(); };
  return {video, controller, seeks, intervals, listeners, cleared, tick, visibility};
}
function ranges(values) {
  return {length: values.length, start: index => values[index][0], end: index => values[index][1]};
}

// The timer catches up even if an append queue is idle or playback was throttled.
const backlog = fixture();
assert.equal([...backlog.intervals.values()][0].interval, 250);
backlog.tick();
assert.deepEqual(backlog.seeks, [9.8]);
assert.equal(backlog.video.playbackRate, 1);
backlog.video.buffered = ranges([[0, 12]]);
backlog.tick();
assert.deepEqual(backlog.seeks, [9.8, 11.8]);

// The default threshold is 0.8 seconds and leaves a 0.2-second safety buffer.
const healthy = fixture({currentTime: 9.3});
healthy.tick();
assert.deepEqual(healthy.seeks, []);
const threshold = fixture({currentTime: 9.19});
threshold.controller.sync();
assert.deepEqual(threshold.seeks, [9.8]);

// Seek into the newest range, including when the requested margin falls in a gap.
const gap = fixture({currentTime: 1, buffered: ranges([[0, 2], [20, 20.1]])});
gap.tick();
assert.deepEqual(gap.seeks, [20]);
const latest = fixture({currentTime: 1, buffered: ranges([[0, 2], [20, 30]])});
latest.tick();
assert.deepEqual(latest.seeks, [29.8]);

for (const state of [{paused: true}, {ended: true}, {seeking: true}, {readyState: 1}, {buffered: ranges([])}]) {
  const blocked = fixture(state);
  blocked.tick(); blocked.controller.sync(); blocked.visibility('visible');
  assert.deepEqual(blocked.seeks, [], JSON.stringify(state));
}
const paused = fixture({paused: true});
paused.tick();
assert.equal(paused.video.paused, true);
paused.video.paused = false;
paused.tick();
assert.deepEqual(paused.seeks, [9.8]);

const resumed = fixture();
resumed.visibility('hidden');
assert.deepEqual(resumed.seeks, []);
resumed.visibility('visible');
assert.deepEqual(resumed.seeks, [9.8]);

// Resetting/removing a source can invalidate its ranges or reject a pending seek.
const resetting = fixture({buffered: {length: 1, start() { throw new Error('Range removed'); }, end: () => 10}});
assert.doesNotThrow(resetting.tick);
assert.deepEqual(resetting.seeks, []);
const invalid = fixture({buffered: ranges([[5, Number.NaN]])});
invalid.tick();
assert.deepEqual(invalid.seeks, []);
const rejected = fixture();
Object.defineProperty(rejected.video, 'currentTime', {get: () => 1, set() { throw new Error('Source removed'); }});
assert.doesNotThrow(rejected.tick);

const customized = fixture({}, {maxLag: 2, targetLag: 0.5, intervalMs: 100});
customized.tick();
assert.equal([...customized.intervals.values()][0].interval, 100);
assert.deepEqual(customized.seeks, [9.5]);
const invalidOptions = fixture({}, {maxLag: -1, targetLag: 5, intervalMs: 0});
invalidOptions.tick();
assert.equal([...invalidOptions.intervals.values()][0].interval, 250);
assert.deepEqual(invalidOptions.seeks, [9.8]);

// A queued timer/listener must become harmless after the owning session stops.
const stopped = fixture();
const staleTimer = [...stopped.intervals.values()][0].callback;
const staleVisibility = stopped.listeners.get('visibilitychange');
stopped.controller.stop(); stopped.controller.stop();
assert.equal(stopped.intervals.size, 0);
assert.equal(stopped.listeners.size, 0);
assert.deepEqual(stopped.cleared, [1]);
staleTimer(); staleVisibility(); stopped.controller.sync(); stopped.tick(); stopped.visibility('visible');
assert.deepEqual(stopped.seeks, []);
console.log('PASS: live playback catches idle backlog, targets the newest range, preserves pause and cleans up stale callbacks');
