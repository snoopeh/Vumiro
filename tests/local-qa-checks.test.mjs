import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const launcher = fileURLToPath(new URL('../scripts/Run-Local.ps1', import.meta.url));
const shell = ['pwsh', 'powershell'].find(command => spawnSync(command, ['-NoProfile', '-Command', 'exit 0']).status === 0);

function runLauncher(t, options = {}) {
  const root = mkdtempSync(join(tmpdir(), 'vumiro-local-checks-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, 'scripts'));
  mkdirSync(join(root, 'Vumiro.Client', 'WebServer'), { recursive: true });
  writeFileSync(join(root, 'scripts', 'Run-Local.ps1'), readFileSync(launcher));
  writeFileSync(join(root, 'Vumiro.Client', 'WebServer', 'app.js'), 'const fixture = true;');
  const trace = join(root, 'commands.jsonl');
  const wrapper = join(root, 'harness.ps1');
  writeFileSync(wrapper, `
function global:node {
  @{ command = 'node'; arguments = @($args) } | ConvertTo-Json -Compress -Depth 5 | Add-Content -LiteralPath $env:LOCAL_QA_TEST_TRACE
  $global:LASTEXITCODE = if ($env:LOCAL_QA_TEST_FAIL_CHECKS -eq '1') { 42 } else { 0 }
}
function global:dotnet {
  @{ command = 'dotnet'; arguments = @($args) } | ConvertTo-Json -Compress -Depth 5 | Add-Content -LiteralPath $env:LOCAL_QA_TEST_TRACE
  $global:LASTEXITCODE = if ($args[0] -eq 'build') { 77 } else { 0 }
}
# Never inspect or close a real window. The build sentinel stops before startup.
function global:Get-Process { param($Name, $ErrorAction) @() }
$settings = $env:LOCAL_QA_TEST_OPTIONS | ConvertFrom-Json
$parameters = @{}
foreach ($setting in $settings.PSObject.Properties) { $parameters[$setting.Name] = $setting.Value }
& (Join-Path $PSScriptRoot 'scripts/Run-Local.ps1') @parameters
exit $LASTEXITCODE
`);
  const { failChecks = false, ...parameters } = options;
  const result = spawnSync(shell, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', wrapper], {
    cwd: root, encoding: 'utf8', timeout: 30_000,
    env: { ...process.env, LOCAL_QA_TEST_TRACE: trace, LOCAL_QA_TEST_OPTIONS: JSON.stringify(parameters), LOCAL_QA_TEST_FAIL_CHECKS: failChecks ? '1' : '0' }
  });
  assert.ifError(result.error);
  assert.equal(result.status, 1, result.stdout + result.stderr);
  const calls = readFileSync(trace, 'utf8').trim().split(/\r?\n/).map(line => JSON.parse(line.replace(/^\uFEFF/, '')));
  return { root, calls, output: result.stdout + result.stderr };
}

test('LOCAL QA runs one full client/native check command before its native build', { skip: !shell }, t => {
  const { root, calls, output } = runLauncher(t);
  assert.deepEqual(calls[0], { command: 'node', arguments: ['scripts/Check-Client.mjs', '--skip-backend', '--native', '--output', join(root, 'dist/local-qa/checks')] });
  assert.equal(calls.length, 2, 'checks must not duplicate syntax, client tests or native projects');
  assert.equal(calls[1].command, 'dotnet');
  assert.equal(calls[1].arguments[0], 'build');
  assert.match(output, /Incremental native build failed/);
});

test('LOCAL QA forwards focused selection and opt-in receipt reuse', { skip: !shell }, t => {
  const { calls } = runLauncher(t, { Group: ['streaming', 'friends'], ChangedSince: 'HEAD~1', ReuseChecks: true });
  assert.deepEqual(calls[0].arguments.slice(5), ['--group', 'streaming', '--group', 'friends', '--changed-since', 'HEAD~1', '--reuse']);
  assert.equal(calls.length, 2);
});

test('failed client checks stop LOCAL QA before building or launching', { skip: !shell }, t => {
  const { calls, output } = runLauncher(t, { failChecks: true });
  assert.equal(calls.length, 1);
  assert.match(calls[0].arguments[0], /Check-Client\.mjs$/);
  assert.match(output, /failed.*Full output:/);
});

test('presentation-only launch retains JavaScript syntax and native build checks', { skip: !shell }, t => {
  const { root, calls, output } = runLauncher(t, { SkipTests: true });
  assert.deepEqual(calls[0], { command: 'node', arguments: ['--check', join(root, 'Vumiro.Client/WebServer/app.js')] });
  assert.equal(calls.length, 2);
  assert.equal(calls[1].arguments[0], 'build');
  assert.match(output, /Incremental native build failed/);
});

test('Run-Local.ps1 parses with the available PowerShell parser', { skip: !shell }, () => {
  const result = spawnSync(shell, ['-NoProfile', '-NonInteractive', '-Command', '$errors = $null; [System.Management.Automation.Language.Parser]::ParseFile($env:LOCAL_QA_TEST_LAUNCHER, [ref]$null, [ref]$errors) | Out-Null; if ($errors.Count) { $errors | Out-String | Write-Error; exit 1 }'], {
    encoding: 'utf8', env: { ...process.env, LOCAL_QA_TEST_LAUNCHER: launcher }, timeout: 30_000
  });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stdout + result.stderr);
});
