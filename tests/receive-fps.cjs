const assert = require('node:assert/strict');
const {createRequire} = require('node:module');
const runtime = process.env.SCREENTASK_NODE_MODULES ? createRequire(process.env.SCREENTASK_NODE_MODULES + '/package.json') : require;
const {chromium} = runtime('playwright');
(async () => {
  const browser = await chromium.launch({channel: 'chrome', headless: true});
  try {
    const page = await browser.newPage();
    await page.goto(process.env.SCREENTASK_TEST_ORIGIN || 'http://localhost:17871');
    await page.waitForFunction(() => document.getElementById('streamVideo').readyState >= 2, null, {timeout: 30000});
    const measurement = await page.evaluate(async () => {
      const video = document.getElementById('streamVideo');
      const before = video.getVideoPlaybackQuality(), start = performance.now();
      await new Promise(resolve => setTimeout(resolve, 3000));
      const after = video.getVideoPlaybackQuality(), seconds = (performance.now() - start) / 1000;
      const stats = await (await fetch('/stats')).json();
      return {decodedFps: (after.totalVideoFrames - before.totalVideoFrames) / seconds,
        droppedFps: (after.droppedVideoFrames - before.droppedVideoFrames) / seconds,
        codec: stats.codec, backend: stats.backend, targetFps: stats.targetFps, captureFps: stats.captureFps};
    });
    assert.equal(measurement.codec, 'H.264');
    assert(measurement.decodedFps > 0, 'No frames decoded during the measurement');
    console.log('MEASURED: actual HTTP viewer frame delivery', JSON.stringify(measurement));
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
