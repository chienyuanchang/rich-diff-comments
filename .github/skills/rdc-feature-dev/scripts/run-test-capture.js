'use strict';

const fs = require('node:fs');
const { spawn } = require('node:child_process');

function option(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

const separator = process.argv.indexOf('--');
const resultPath = option('--result');
const exitPath = option('--exit');
const cwd = option('--cwd');
const command = separator >= 0 ? process.argv[separator + 1] : null;
const args = separator >= 0 ? process.argv.slice(separator + 2) : [];

if (!resultPath || !exitPath || !cwd || !command) {
  console.error('Usage: node run-test-capture.js --result <file> --exit <file> --cwd <dir> -- <command> [args...]');
  process.exit(2);
}

for (const filePath of [resultPath, exitPath]) {
  try { fs.rmSync(filePath, { force: true }); } catch (_) {}
}

const output = fs.createWriteStream(resultPath, { encoding: 'utf8' });
const startedAt = Date.now();
const child = spawn(command, args, {
  cwd,
  env: process.env,
  shell: false,
  stdio: ['ignore', 'pipe', 'pipe'],
});

child.stdout.pipe(output, { end: false });
child.stderr.pipe(output, { end: false });

console.log(`CAPTURE_STARTED pid=${child.pid}`);
const heartbeat = setInterval(() => {
  const elapsedSeconds = Math.round((Date.now() - startedAt) / 1000);
  console.log(`CAPTURE_RUNNING pid=${child.pid} elapsed=${elapsedSeconds}s`);
}, 5000);

function stopChild(signal) {
  if (!child.killed) child.kill(signal);
}
process.once('SIGINT', () => stopChild('SIGINT'));
process.once('SIGTERM', () => stopChild('SIGTERM'));

child.once('error', (error) => {
  output.write(`\n[capture error] ${error.stack || error.message}\n`);
});

child.once('close', (code, signal) => {
  clearInterval(heartbeat);
  const exitCode = Number.isInteger(code) ? code : 1;
  if (signal) output.write(`\n[capture signal] ${signal}\n`);
  output.end(() => {
    fs.writeFileSync(exitPath, `${exitCode}\n`, 'utf8');
    const result = fs.readFileSync(resultPath, 'utf8');
    const lines = result.split(/\r?\n/).filter(line => line.trim());
    console.log(`CAPTURE_EXIT=${exitCode}`);
    console.log(lines.slice(-15).join('\n'));
    process.exitCode = exitCode;
  });
});