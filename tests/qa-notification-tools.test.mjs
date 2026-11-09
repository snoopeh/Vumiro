import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const html = fs.readFileSync(new URL('../Vumiro.Client/WebServer/friends.html', import.meta.url), 'utf8');
const client = fs.readFileSync(new URL('../Vumiro.Client/WebServer/friends-client.js', import.meta.url), 'utf8');
const program = fs.readFileSync(new URL('../Vumiro.Client/Program.cs', import.meta.url), 'utf8');
const styles = html.match(/<style[^>]*>([\s\S]*?)<\/style>/)?.[1] || '';

test('notification test controls are hidden by default and cover call, friend, and room events', () => {
  const panel = html.match(/<details id="qaNotificationTools"[\s\S]*?<\/details>/)?.[0] || '';
  assert.ok(panel, 'QA notification tools panel exists');
  assert.match(panel, /id="qaNotificationTools"[^>]*hidden/);
  assert.match(panel, /data-qa-notification="call"/);
  assert.match(panel, /data-qa-notification="friend"/);
  assert.match(panel, /data-qa-notification="room"/);
  assert.match(panel, /data-qa-notification-stop/);
});

test('notification test actions are gated by LOCAL QA and never send synthetic events to the service', () => {
  const start = client.indexOf('function showQaNotification(');
  const end = client.indexOf("$('acceptInvite').onclick", start);
  assert.ok(start >= 0 && end > start, 'QA event dispatcher exists before invite controls');
  const qa = client.slice(start, end);
  assert.match(qa, /window\.__VUMIRO_LOCAL_QA__!==true/);
  assert.match(qa, /host\?\.postMessage\(\{type:'window',action:'notify'\}\)/);
  assert.doesNotMatch(qa, /send\(|social\(|answer\(/);
  assert.match(qa, /qa:true/);
  assert.match(client.slice(end), /if\(value\.qa\)\{clearPending\(/);
});

test('QA notification tools get their own QA-only settings destination', () => {
  assert.ok(/if\s*\(window\.__VUMIRO_LOCAL_QA__\s*===\s*true\)\s*sections\.push\(\['qa',\s*'QA notification tests'\]\)/.test(client));
  assert.ok(/node\.id\s*===\s*'qaNotificationTools'\s*\?\s*'qa'/.test(client));
});

test('settings profile and multi-column controls collapse based on content width', () => {
  assert.ok(/#profileDialog\.settingsScreen form#profileForm\{display:grid;grid-template-columns:minmax\(0,1fr\)/.test(styles));
  assert.ok(/@container settings-content \(min-width: 900px\)/.test(styles));
  assert.ok(/@container settings-content \(max-width: 650px\)/.test(styles));
});

test('LOCAL QA desktop windows start maximized without changing installed app startup', () => {
  assert.ok(/if\s*\(ClientRuntime\.Current\.IsLocalQa\)\s*WindowState\s*=\s*FormWindowState\.Maximized/.test(program));
});