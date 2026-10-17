'use strict';

const fs = require('node:fs');

const resultPath = process.argv[2];
const exitPath = process.argv[3];

if (!resultPath || !exitPath) {
  console.error('Usage: node summarize-test-result.js <result-file> <exit-file>');
  process.exitCode = 2;
} else if (!fs.existsSync(exitPath)) {
  console.log('CAPTURE_RUNNING');
  process.exitCode = 2;
} else {
  const capturedExit = Number.parseInt(fs.readFileSync(exitPath, 'utf8').trim(), 10);
  const result = fs.existsSync(resultPath) ? fs.readFileSync(resultPath, 'utf8') : '';
  const lines = result.split(/\r?\n/).filter(line => line.trim());
  console.log(`CAPTURE_EXIT=${Number.isNaN(capturedExit) ? 'INVALID' : capturedExit}`);
  console.log(lines.slice(-15).join('\n'));
  process.exitCode = Number.isNaN(capturedExit) ? 2 : capturedExit;
}