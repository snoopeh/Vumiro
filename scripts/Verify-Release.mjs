#!/usr/bin/env node
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { verifyRelease, writeReports } from './lib/release-verification.mjs';

export const USAGE = 'node scripts/Verify-Release.mjs --tag client-vX.Y.Z --sha FULLSHA --repo owner/name --output DIR [--assets-dir DIR] [--draft-check]';

export function parseArgs(argv) {
  const options = {};
  const flags = { '--tag': 'tag', '--sha': 'sha', '--repo': 'repo', '--output': 'output', '--assets-dir': 'assetsDir' };
  if (argv.length === 1 && ['--help', '-h'].includes(argv[0])) return { help: true };
  for (let i = 0; i < argv.length;) {
    if (argv[i] === '--draft-check' && !options.draftCheck) { options.draftCheck = true; i++; continue; }
    const key = flags[argv[i]];
    if (!key || options[key] !== undefined || !argv[i + 1] || argv[i + 1].startsWith('--')) throw new Error('Unknown, duplicate, or incomplete CLI option.');
    options[key] = argv[i + 1];
    i += 2;
  }
  if (!options.output || !options.tag || !options.sha || !options.repo) throw new Error('Required options: --tag, --sha, --repo, --output.');
  return options;
}

export async function main(argv = process.argv.slice(2)) {
  let options;
  try { options = parseArgs(argv); } catch (error) { console.error(`${error.message}\nUsage: ${USAGE}`); return 2; }
  if (options.help) { console.log(USAGE); return 0; }
  const report = await verifyRelease(options);
  try { await writeReports(report, path.resolve(options.output)); }
  catch { console.error('Unable to write release reports or GitHub step summary.'); return 1; }
  console.log(`Release verification ${report.status.toUpperCase()}: ${options.tag}`);
  for (const check of report.checks.filter(c => c.status === 'failed')) console.error(`${check.name}: ${check.message}`);
  console.log(`Reports: ${path.resolve(options.output, 'release-report.json')} and release-report.md`);
  return report.status === 'passed' ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().then(code => { process.exitCode = code; }).catch(() => { console.error('Release verification failed unexpectedly.'); process.exitCode = 1; });
}
