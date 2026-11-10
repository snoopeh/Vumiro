/* Shared, source-pixel crop geometry. Encoding and profile persistence belong to callers. */
(() => {
  'use strict';
  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
  const positive = value => Number.isFinite(value) && value > 0;
  function create({imageWidth, imageHeight, viewportWidth, viewportHeight, maxZoom = 4}) {
    if (![imageWidth, imageHeight, viewportWidth, viewportHeight, maxZoom].every(positive) || maxZoom < 1)
      throw new TypeError('Crop dimensions must be positive and maximum zoom at least one.');
    let width = viewportWidth, height = viewportHeight, zoom = 1, x = 0, y = 0;
    const base = () => Math.max(width / imageWidth, height / imageHeight);
    const scale = () => base() * zoom;
    function constrain() {
      x = clamp(x, width - imageWidth * scale(), 0);
      y = clamp(y, height - imageHeight * scale(), 0);
    }
    function snapshot() {
      return Object.freeze({imageWidth, imageHeight, width, height, zoom, maxZoom, scale: scale(), x, y});
    }
    function reset() {
      zoom = 1;
      x = (width - imageWidth * scale()) / 2;
      y = (height - imageHeight * scale()) / 2;
      constrain();
      return snapshot();
    }
    function pan(dx, dy) {
      if (!Number.isFinite(dx) || !Number.isFinite(dy)) return snapshot();
      x += dx; y += dy; constrain();
      return snapshot();
    }
    function zoomTo(value, anchorX = width / 2, anchorY = height / 2) {
      if (![value, anchorX, anchorY].every(Number.isFinite)) return snapshot();
      anchorX = clamp(anchorX, 0, width); anchorY = clamp(anchorY, 0, height);
      const previous = scale();
      zoom = clamp(value, 1, maxZoom);
      x = anchorX - (anchorX - x) * scale() / previous;
      y = anchorY - (anchorY - y) * scale() / previous;
      constrain();
      return snapshot();
    }
    function resize(nextWidth, nextHeight) {
      if (!positive(nextWidth) || !positive(nextHeight)) return snapshot();
      const centerX = (width / 2 - x) / scale(), centerY = (height / 2 - y) / scale();
      width = nextWidth; height = nextHeight;
      x = width / 2 - centerX * scale(); y = height / 2 - centerY * scale();
      constrain();
      return snapshot();
    }
    function sourceRect() {
      const sw = Math.min(imageWidth, width / scale()), sh = Math.min(imageHeight, height / scale());
      return Object.freeze({x: clamp(-x / scale(), 0, imageWidth - sw), y: clamp(-y / scale(), 0, imageHeight - sh), width: sw, height: sh});
    }
    function restoreCrop(rect) {
      if (!rect || ![rect.x, rect.y, rect.width, rect.height].every(Number.isFinite) ||
          rect.width <= 0 || rect.height <= 0)
        throw new TypeError('Saved crop must contain finite coordinates and positive dimensions.');
      // Permit floating-point round trips, never silently accept a different framing.
      const epsilon = Math.max(imageWidth, imageHeight) * 1e-9;
      const expectedHeight = rect.width * height / width;
      const nextZoom = width / rect.width / base();
      if (rect.x < -epsilon || rect.y < -epsilon ||
          rect.x + rect.width > imageWidth + epsilon || rect.y + rect.height > imageHeight + epsilon ||
          Math.abs(rect.height - expectedHeight) > epsilon ||
          nextZoom < 1 - 1e-9 || nextZoom > maxZoom + 1e-9)
        throw new RangeError('Saved crop is outside the image, aspect ratio or zoom limits.');
      zoom = clamp(nextZoom, 1, maxZoom);
      x = -rect.x * scale(); y = -rect.y * scale();
      constrain();
      return snapshot();
    }
    function outputSize(maxWidth = 3840, maxHeight = 1280) {
      if (!positive(maxWidth) || !positive(maxHeight) || maxWidth < 1 || maxHeight < 1) throw new TypeError('Output limits must be at least one pixel.');
      const rect = sourceRect(), ratio = Math.min(1, maxWidth / rect.width, maxHeight / rect.height);
      // Exact 3:1 cover dimensions avoid distortion from independently rounded axes.
      if (Math.abs(width / height - 3) < 1e-9) {
        const outputHeight = Math.floor(Math.min(rect.height, rect.width / 3, maxHeight, maxWidth / 3));
        if (outputHeight < 1) throw new RangeError('This crop is too small to export without upscaling.');
        return Object.freeze({width: outputHeight * 3, height: outputHeight});
      }
      if (rect.width * ratio < 1 || rect.height * ratio < 1)
        throw new RangeError('This crop is too small to export without upscaling.');
      return Object.freeze({width: Math.floor(rect.width * ratio), height: Math.floor(rect.height * ratio)});
    }
    reset();
    return Object.freeze({snapshot, reset, pan, zoomTo, resize, sourceRect, restoreCrop, outputSize});
  }

  // The owning dialog handles Cancel/Save and destroys these bindings on every exit.
  // A model is draft-only: none of these controls mutates the stored profile.
  function bindControls({model, viewport, image, zoomInput, zoomOutput, resetButton, onChange = () => {}}) {
    let pointer = null, point = null, disposed = false;
    const aspect = model.snapshot().width / model.snapshot().height;
    const removers = [];
    function listen(target, name, callback, options) {
      if (!target) return;
      target.addEventListener(name, callback, options);
      removers.push(() => target.removeEventListener(name, callback, options));
    }
    function render() {
      if (disposed) return;
      const state = model.snapshot();
      image.style.width = `${state.imageWidth}px`; image.style.height = `${state.imageHeight}px`;
      image.style.left = image.style.top = '0'; image.style.transformOrigin = 'top left';
      image.style.transform = `translate(${state.x}px,${state.y}px) scale(${state.scale})`;
      if (zoomInput) {
        zoomInput.min = '1'; zoomInput.max = String(state.maxZoom); zoomInput.step = '0.01';
        zoomInput.value = String(state.zoom); zoomInput.setAttribute('aria-valuetext', `${Math.round(state.zoom * 100)} percent`);
      }
      if (zoomOutput) zoomOutput.textContent = `${state.zoom.toFixed(2)}x`;
      onChange(state, model.sourceRect(), model.outputSize());
    }
    function release() {
      const id = pointer; pointer = null; point = null;
      if (id !== null && viewport.hasPointerCapture?.(id)) viewport.releasePointerCapture(id);
    }
    listen(viewport, 'pointerdown', event => {
      if (event.button !== 0 || pointer !== null) return;
      pointer = event.pointerId; point = {x: event.clientX, y: event.clientY};
      viewport.setPointerCapture?.(pointer); viewport.focus(); event.preventDefault();
    });
    listen(viewport, 'pointermove', event => {
      if (event.pointerId !== pointer || !point) return;
      const rect = viewport.getBoundingClientRect(), state = model.snapshot();
      model.pan((event.clientX - point.x) * state.width / rect.width,
        (event.clientY - point.y) * state.height / rect.height);
      point = {x: event.clientX, y: event.clientY}; render();
    });
    for (const name of ['pointerup', 'pointercancel', 'lostpointercapture'])
      listen(viewport, name, event => { if (event.pointerId === pointer) release(); });
    listen(viewport, 'keydown', event => {
      const step = event.shiftKey ? 24 : 8, state = model.snapshot();
      const moves = {ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step]};
      if (moves[event.key]) model.pan(...moves[event.key]);
      else if (event.key === '+' || event.key === '=') model.zoomTo(state.zoom + .1);
      else if (event.key === '-') model.zoomTo(state.zoom - .1);
      else if (event.key === 'Home') model.reset();
      else return;
      event.preventDefault(); render();
    });
    listen(viewport, 'wheel', event => {
      // Preserve system/browser pinch zoom and modified navigation gestures.
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      const rect = viewport.getBoundingClientRect(), state = model.snapshot();
      const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? state.height : 1);
      model.zoomTo(state.zoom * Math.exp(-clamp(delta, -200, 200) * .002),
        (event.clientX - rect.left) * state.width / rect.width,
        (event.clientY - rect.top) * state.height / rect.height);
      event.preventDefault(); render();
    }, {passive: false});
    listen(zoomInput, 'input', () => { model.zoomTo(Number(zoomInput.value)); render(); });
    listen(resetButton, 'click', () => { release(); model.reset(); render(); });
    let observer;
    if (typeof ResizeObserver === 'function') {
      observer = new ResizeObserver(() => {
        if (!disposed && viewport.clientWidth > 0 && viewport.clientHeight > 0) {
          release(); model.resize(viewport.clientWidth, viewport.clientWidth / aspect); render();
        }
      });
      observer.observe(viewport);
    }
    render();
    return Object.freeze({render, destroy() {
      if (disposed) return;
      disposed = true; release(); observer?.disconnect(); removers.splice(0).forEach(remove => remove());
    }});
  }
  globalThis.VumiroProfileCrop = Object.freeze({create, bindControls});
})();
