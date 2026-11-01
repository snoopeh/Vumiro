/* Keep live viewers near the newest buffered frames, even when no new fragment
   is being appended. Pausing remains a deliberate viewer action. */
(() => {
  'use strict';
  function attach(video, options = {}) {
    const maxLag = Number.isFinite(options.maxLag) && options.maxLag > 0 ? options.maxLag : 0.8;
    const targetLag = Number.isFinite(options.targetLag) && options.targetLag >= 0 && options.targetLag < maxLag ? options.targetLag : Math.min(0.2, maxLag / 2);
    const intervalMs = Number.isFinite(options.intervalMs) && options.intervalMs > 0 ? options.intervalMs : 250;
    let stopped = false;
    function sync() {
      if (stopped) return;
      try {
        if (video.readyState < 2 || video.paused || video.ended || video.seeking) return;
        const buffered = video.buffered;
        if (!buffered.length) return;
        const latest = buffered.length - 1;
        const start = buffered.start(latest), end = buffered.end(latest), current = video.currentTime;
        if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start || !Number.isFinite(current)) return;
        if (end - current > maxLag) {
          try { options.onBeforeSeek?.(); } catch { /* Visual cover is optional. */ }
          video.currentTime = Math.min(end, Math.max(start, end - targetLag));
        }
      } catch { /* Ranges may disappear while a decoder or stream is resetting. */ }
    }
    function onVisibilityChange() {
      if (document.visibilityState === 'visible') sync();
    }
    const timer = setInterval(sync, intervalMs);
    document.addEventListener('visibilitychange', onVisibilityChange);
    return {
      sync,
      stop() {
        if (stopped) return;
        stopped = true;
        clearInterval(timer);
        document.removeEventListener('visibilitychange', onVisibilityChange);
      }
    };
  }
  window.ScreenTaskLivePlayback = {attach};
})();
