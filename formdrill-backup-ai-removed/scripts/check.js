'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const extDir = path.join(__dirname, '..', 'extension');
const files = fs.readdirSync(extDir).filter((f) => f.endsWith('.js'));

let failed = false;
for (const file of files) {
  const fullPath = path.join(extDir, file);
  try {
    execFileSync(process.execPath, ['--check', fullPath], { stdio: 'pipe' });
    console.log(`OK: ${file}`);
  } catch (err) {
    console.error(`Syntax error in ${file}:`, err.stderr ? err.stderr.toString() : err.message);
    failed = true;
  }
}

if (failed) {
  process.exit(1);
} else {
  console.log(`All ${files.length} extension scripts passed syntax check.`);
}
