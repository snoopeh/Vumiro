/* Local room layout only. Media tracks stay attached to their existing tiles. */
(() => {
  'use strict';
  const gap = 12;
  const fallbackAspect = 16 / 9;

  function aspect(value) {
    return Number.isFinite(value) && value >= 0.25 && value <= 6 ? value : fallbackAspect;
  }

  function plan(ratios, availableWidth, availableHeight) {
    const count = ratios.length;
    if (!count) return {columns: 1, rowHeight: 0};
    const width = Math.max(1, Number.isFinite(availableWidth) ? availableWidth : 320);
    const height = Math.max(240, Number.isFinite(availableHeight) ? availableHeight : 600);
    const maxColumns = width < 560 ? 1 : Math.min(4, count);
    let best = null;
    for (let columns = 1; columns <= maxColumns; columns++) {
      // A pair of streams belongs side by side once the scene is wide enough.
      if (count === 2 && width >= 800 && columns === 1) continue;
      const cellWidth = (width - gap * (columns - 1)) / columns;
      if (cellWidth < 180) continue;
      const rows = Math.ceil(count / columns);
      const heightBudget = (height - gap * (rows - 1)) / rows;
      const naturalHeight = Math.max(...ratios.map(ratio => cellWidth / aspect(ratio)));
      const rowHeight = Math.max(150, Math.min(heightBudget, naturalHeight));
      const score = ratios.reduce((total, ratio) => {
        const visibleWidth = Math.min(cellWidth, rowHeight * aspect(ratio));
        return total + visibleWidth * visibleWidth / aspect(ratio);
      }, 0);
      if (!best || score > best.score + 1) best = {columns, rowHeight, score};
    }
    return {columns: best?.columns || 1, rowHeight: Math.round(best?.rowHeight || 150)};
  }

  function create({root, grid, strip}) {
    if (!grid || !strip || typeof grid.insertBefore !== 'function' || typeof strip.insertBefore !== 'function') return null;
    let entries = [];
    let disposed = false;
    function replan() {
      if (disposed) return;
      const sharing = entries.filter(item => item.tile.sharing);
      const visible = sharing.length ? sharing : entries;
      if (!visible.length) return;
      const box = root.getBoundingClientRect();
      const width = box.width || root.clientWidth || 320;
      const height = Math.max(240, Math.min(760, window.innerHeight - box.top - 160));
      const ratios = visible.map(item => {
        const {videoWidth, videoHeight} = item.tile.video;
        return item.tile.sharing && videoWidth > 0 && videoHeight > 0 ? videoWidth / videoHeight : fallbackAspect;
      });
      const result = plan(ratios, width, height);
      grid.style.setProperty('--mosaic-columns', String(result.columns));
      grid.style.setProperty('--mosaic-row-height', result.rowHeight + 'px');
    }
    function place(target, items) {
      items.forEach((item, index) => {
        const element = item.tile.element;
        if (target.children[index] !== element) target.insertBefore(element, target.children[index] || null);
      });
    }
    function update(nextEntries, focusedId) {
      if (disposed) return;
      entries = nextEntries;
      const sharing = entries.filter(item => item.tile.sharing);
      const idle = entries.filter(item => !item.tile.sharing);
      for (const item of entries) {
        item.tile.element.classList.toggle('focused', item.id === focusedId);
        item.tile.element.classList.toggle('sharing', !!item.tile.sharing);
        item.tile.selectButton?.setAttribute('aria-pressed', String(item.id === focusedId));
      }
      place(grid, sharing.length ? sharing : idle);
      place(strip, sharing.length ? idle : []);
      grid.hidden = entries.length === 0;
      strip.hidden = sharing.length === 0 || idle.length === 0;
      replan();
    }
    let observedWidth = 0;
    const observer = typeof window.ResizeObserver === 'function' ? new window.ResizeObserver(records => {
      const width = records[0]?.contentRect?.width;
      if (width > 0 && width !== observedWidth) { observedWidth = width; replan(); }
    }) : null;
    observer?.observe(root);
    window.addEventListener('resize', replan);
    return {update, replan, dispose() { disposed = true; observer?.disconnect(); window.removeEventListener('resize', replan); }};
  }

  window.VumiroStreamMosaic = {plan, create};
})();
