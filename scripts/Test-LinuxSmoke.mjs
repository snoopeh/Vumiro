import { spawn } from 'node:child_process';
import { access, mkdtemp, open, readFile, rm, stat } from 'node:fs/promises';
import { constants } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const requiredChecks = ['account-gate', 'fixture-authentication', 'packaged-assets', 'local-profile', 'legacy-ui-absent', 'offline-contact',
  'nickname-no-edit', 'nickname-modal-narrow', 'nickname-save', 'profile-backdrop', 'direct-room', 'secure-store'];

export function buildLaunch(executable, directory, environment = process.env) {
  const env = { ...environment, VUMIRO_SMOKE_DIR: directory,
    VUMIRO_SMOKE_DRIVER: path.join(scriptDir, 'linux-smoke.cjs'),
    XDG_CONFIG_HOME: path.join(directory, 'config'), XDG_CACHE_HOME: path.join(directory, 'cache'),
    XDG_DATA_HOME: path.join(directory, 'data') };
  delete env.ELECTRON_RUN_AS_NODE;
  return { executable, args: ['--vumiro-smoke'], env };
}

export async function validatePackage(executable, platform = process.platform) {
  if (platform !== 'linux') throw new Error('The packaged smoke check must run on Linux under Xvfb.');
  try { await access(executable, constants.X_OK); }
  catch { throw new Error(`Build the Linux packages first; executable is missing or not executable: ${executable}`); }
  const handle = await open(executable, 'r');
  try {
    const header = Buffer.alloc(4);
    await handle.read(header, 0, 4, 0);
    if (!header.equals(Buffer.from([0x7f, 0x45, 0x4c, 0x46]))) throw new Error('Expected the packaged Linux ELF executable.');
  } finally { await handle.close(); }
  const asar = path.join(path.dirname(executable), 'resources', 'app.asar');
  try { if (!(await stat(asar)).isFile()) throw new Error(); }
  catch { throw new Error(`Packaged app resources are missing: ${asar}`); }
}

export function validateReport(report) {
  if (report?.ok !== true) throw new Error(report?.error || 'The app did not produce a passing smoke report.');
  if (report.packaged !== true) throw new Error('The smoke check did not run the packaged app.');
  if (!Array.isArray(report.rendererErrors) || report.rendererErrors.length) throw new Error('The renderer reported a JavaScript exception.');
  if (!Number.isSafeInteger(report.blockedRequests) || report.blockedRequests < 1) throw new Error('The offline network guard was not exercised.');
  if (report.mediaRequests !== 0) throw new Error('The smoke check attempted media capture.');
  if (!Number.isSafeInteger(report.authFixtureRequests) || report.authFixtureRequests < 4) throw new Error('The authentication fixture was not exercised.');
  if (!Number.isSafeInteger(report.memorySessionWrites) || report.memorySessionWrites < 1) throw new Error('The memory session adapter was not exercised.');
  for (const check of requiredChecks) if (!report.checks?.includes(check)) throw new Error(`Missing smoke assertion: ${check}`);
}

async function runChild(launch) {
  return new Promise((resolve, reject) => {
    const child = spawn(launch.executable, launch.args, { env: launch.env, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
    let output = '', timedOut = false;
    const retain = chunk => { output = (output + chunk).slice(-6000); };
    child.stdout.on('data', retain); child.stderr.on('data', retain);
    const killGroup = () => { if (child.pid) { try { process.kill(-child.pid, 'SIGKILL'); } catch { /* Already exited. */ } } };
    const timer = setTimeout(() => { timedOut = true; killGroup(); }, 55000);
    const interrupt = () => { killGroup(); };
    process.once('SIGINT', interrupt); process.once('SIGTERM', interrupt);
    child.once('error', error => { clearTimeout(timer); process.removeListener('SIGINT', interrupt); process.removeListener('SIGTERM', interrupt); reject(error); });
    child.once('close', (code, signal) => {
      clearTimeout(timer); killGroup();
      process.removeListener('SIGINT', interrupt); process.removeListener('SIGTERM', interrupt);
      resolve({ code, signal, timedOut, output });
    });
  });
}

export async function main() {
  let directory;
  try {
    const args = process.argv.slice(2);
    if (args.length) throw new Error('Usage: xvfb-run -a node scripts/Test-LinuxSmoke.mjs');
    const executable = path.resolve(scriptDir, '..', 'dist', 'linux-release', 'linux-unpacked', 'vumiro');
    await validatePackage(executable);
    if (!process.env.DISPLAY) throw new Error('DISPLAY is missing. Run with xvfb-run -a.');
    directory = await mkdtemp(path.join(os.tmpdir(), 'vumiro-smoke-'));
    const result = await runChild(buildLaunch(executable, directory));
    let report;
    try { report = JSON.parse(await readFile(path.join(directory, 'report.json'), 'utf8')); }
    catch { throw new Error(`No app smoke report (exit ${result.code ?? result.signal}${result.timedOut ? ', timeout' : ''}). ${result.output}`); }
    validateReport(report);
    if (result.code !== 0 || result.timedOut) throw new Error(`App failed after smoke assertions (exit ${result.code ?? result.signal}).`);
    console.log(JSON.stringify({ type: 'linux-smoke', ...report }));
  } catch (error) {
    console.error(JSON.stringify({ type: 'linux-smoke', ok: false, error: error.message }));
    process.exitCode = 1;
  } finally { if (directory) await rm(directory, { recursive: true, force: true }); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
