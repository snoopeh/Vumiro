import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const source=readFileSync(new URL('../Vumiro.Client/WebServer/friends-client.js',import.meta.url),'utf8');
function policy(window={}){const start=source.indexOf('function normalizeService('),end=source.indexOf('\nfunction serviceState(',start);const context={URL,window,migrateRoomHost:value=>value};vm.runInNewContext(source.slice(start,end),context);return context.normalizeService;}
test('private LAN signaling is limited to the immutable native LOCAL QA override',()=>{
 assert.throws(()=>policy()('ws://192.168.1.8:8787/call-signaling'),/wss/);
 const override='ws://192.168.1.8:8787/call-signaling',qa=policy({__VUMIRO_LOCAL_QA__:true,__VUMIRO_LOCAL_QA_SIGNALING__:override});
 assert.equal(qa(override),override);assert.throws(()=>qa('ws://192.168.1.9:8787/call-signaling'),/wss/);assert.throws(()=>qa('ws://192.168.1.8:9000/call-signaling'),/wss/);
 assert.throws(()=>policy({__VUMIRO_LOCAL_QA__:false,__VUMIRO_LOCAL_QA_SIGNALING__:override})(override),/wss/);
 assert.equal(policy()('wss://qa.example.test/call-signaling'),'wss://qa.example.test/call-signaling');
});
