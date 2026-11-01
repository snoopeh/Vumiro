/* Snapshot only at decoder transitions. The old frame covers seeks/source resets
   until the replacement has rendered, without copying every high-resolution frame. */
(() => {
  'use strict';
  function attach(stage) {
    const canvas = document.createElement('canvas');
    canvas.className = 'frame-hold'; canvas.hidden = true;
    canvas.setAttribute('aria-hidden', 'true');
    stage.appendChild(canvas);
    let stopped = false, held = false, generation = 0, fadeTimer = null, pendingFrame = null, pendingVideo = null;
    function cancelPending() {
      ++generation;
      if (fadeTimer != null) clearTimeout(fadeTimer); fadeTimer = null;
      if (pendingFrame != null) {
        if (pendingVideo) pendingVideo.cancelVideoFrameCallback?.(pendingFrame);
        else cancelAnimationFrame(pendingFrame);
      }
      pendingFrame = pendingVideo = null;
    }
    function clear() {
      cancelPending(); held = false; canvas.hidden = true;
      canvas.style.transition = 'none'; canvas.style.opacity = '1';
    }
    function hold(media) {
      if (stopped) return false;
      cancelPending();
      if (held) { canvas.style.transition = 'none'; canvas.style.opacity = '1'; return true; }
      try {
        if (!media || media.hidden) return false;
        const width = media.videoWidth || media.naturalWidth, height = media.videoHeight || media.naturalHeight;
        if (!width || !height || ('readyState' in media && media.readyState < 2)) return false;
        canvas.width = width; canvas.height = height;
        canvas.getContext('2d', {alpha: false}).drawImage(media, 0, 0, width, height);
        held = true; canvas.hidden = false; canvas.style.transition = 'none'; canvas.style.opacity = '1';
        return true;
      } catch { return false; /* Tainted/removed media must never interrupt playback. */ }
    }
    function releaseAfterFrame(media) {
      if (stopped || !held) return;
      if (pendingFrame != null || fadeTimer != null) return;
      cancelPending(); const current = generation;
      function release() {
        if (stopped || current !== generation) return;
        pendingFrame = pendingVideo = null;
        if (media.hidden || media.seeking || ('readyState' in media && media.readyState < 2)) return;
        canvas.style.transition = 'opacity 100ms linear'; canvas.style.opacity = '0';
        fadeTimer = setTimeout(() => {
          if (stopped || current !== generation) return;
          canvas.hidden = true; held = false; fadeTimer = null;
        }, 110);
      }
      if (typeof media.requestVideoFrameCallback === 'function') {
        pendingVideo = media; pendingFrame = media.requestVideoFrameCallback(release);
      } else {
        // loadeddata/onload means decoded; wait for composition in older browsers.
        pendingFrame = requestAnimationFrame(() => {
          if (!stopped && current === generation) pendingFrame = requestAnimationFrame(release);
        });
      }
    }
    return {
      hold, releaseAfterFrame, clear,
      get holding() { return held; },
      stop() { if (stopped) return; stopped = true; clear(); canvas.remove(); }
    };
  }
  window.ScreenTaskFrameHold = {attach};
})();
