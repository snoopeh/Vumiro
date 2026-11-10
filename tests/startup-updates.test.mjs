import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('Windows startup completes automatic updating before enabling the call interface', () => {
  const source = readFileSync(new URL('../Vumiro.Client/Program.cs', import.meta.url), 'utf8');
  const navigation = source.slice(source.indexOf('browser.CoreWebView2.NavigationCompleted +='), source.indexOf('var signaling = DefaultSignaling;'));
  assert.ok(navigation.indexOf('await updates.StartAsync()') >= 0);
  assert.ok(navigation.indexOf('await updates.StartAsync()') < navigation.indexOf('DismissStartupOverlay()'), 'A slow boot update must finish before a user can start a call.');
  assert.match(source, /WebView2 browser = new WebView2 \{[^\r\n]*Enabled = false/);
  assert.match(navigation, /await updates\.StartAsync\(\);\s*if \(IsDisposed\) return;\s*browser\.Enabled = true;/);
});

test('only failed updater restarts skip automatic installation once', () => {
  const helper = readFileSync(new URL('../Vumiro.Client.Updater/Program.cs', import.meta.url), 'utf8');
  assert.match(helper, /Start\(executable, install\);/);
  assert.match(helper, /Start\(Path\.Combine\(install, "Vumiro\.exe"\), install, true\);/);
  assert.match(helper, /if \(recovering\) start\.EnvironmentVariables\["VUMIRO_SKIP_STARTUP_UPDATE"\] = "1"/);
});

test('boot metadata checks have a short timeout independent of package downloads', () => {
  const updater = readFileSync(new URL('../Vumiro.Client/ClientUpdates.cs', import.meta.url), 'utf8');
  assert.match(updater, /CheckAsync\(\)[\s\S]*?using \(var http = Client\(TimeSpan\.FromSeconds\(20\)\)\)/);
  assert.match(updater, /DownloadAsync\([^\r\n]*\)[\s\S]*?using \(var http = Client\(\)\)/);
  assert.match(updater, /CheckAsync\(\)[\s\S]*?using \(var timeout = new CancellationTokenSource\(TimeSpan\.FromSeconds\(20\)\)\)/);
  assert.match(updater, /ReadBoundedAsync\(response, 4 \* 1024 \* 1024, timeout\.Token\)/);
  assert.match(updater, /ReadBoundedAsync\([^\r\n]*CancellationToken cancellationToken\)[\s\S]*?input\.ReadAsync\(buffer, 0, buffer\.Length, cancellationToken\)/);
  assert.match(updater, /DownloadAsync\([^\r\n]*\)[\s\S]*?new CancellationTokenSource\(TimeSpan\.FromMinutes\(5\)\)/);
  assert.match(updater, /input\.ReadAsync\(buffer, 0, buffer\.Length, timeout\.Token\)/);
  assert.match(updater, /ReadBoundedAsync\([^\r\n]*CancellationToken cancellationToken\)[\s\S]*?using \(cancellationToken\.Register\(response\.Dispose\)\)/);
  assert.match(updater, /DownloadAsync\([^\r\n]*\)[\s\S]*?using \(timeout\.Token\.Register\(response\.Dispose\)\)/);
});
