const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const files = [];
for (const directory of ['src', 'scripts', 'tests']) {
  const walk = (base) => { for (const entry of fs.readdirSync(base, { withFileTypes: true })) { const full = path.join(base, entry.name); if (entry.isDirectory()) walk(full); else if (/\.(?:js|cjs)$/.test(entry.name)) files.push(full); } };
  walk(path.join(root, directory));
}
for (const file of files) {
  const result = spawnSync(process.execPath, ['--check', file], { stdio: 'inherit' });
  if (result.status !== 0) process.exit(result.status || 1);
}
console.log(`Syntax OK: ${files.length} JavaScript files`);
