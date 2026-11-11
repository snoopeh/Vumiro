import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
test('gaming view uses real form controls for quality, input and live preview',()=>{
 const view=require('../Vumiro.Client/WebServer/gaming-view.js');const html=view.markup()+view.labMarkup();
 assert.match(html,/<input[^>]+id="gamingStreamBitrate"[^>]+type="range"/);
 assert.match(html,/<input[^>]+id="gamingMonitorEnabled"[^>]+type="checkbox"/);
 for(const id of ['gamingKeyboardMode','gamingPhysicalMode'])assert.match(html,new RegExp(`<input[^>]+id="${id}"[^>]+type="radio"`));
 for(const id of ['gamingLabTransport','gamingLabCapture','gamingLabLan','gamingLabController','gamingLabCancel','gamingLabResults'])assert.ok(html.includes(`id="${id}"`));
 assert.match(html,/aria-live="polite"/);assert.doesNotMatch(html,/<a[^>]+href="https?:/);
});
