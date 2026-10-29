const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
function find(command) {
  return (process.env.PATH || '').split(path.delimiter).map((dir) => path.join(dir, command)).find((file) => { try { fs.accessSync(file, fs.constants.X_OK); return true; } catch { return false; } });
}
const xvfb = find('xvfb-run');
if (process.platform !== 'linux' || !xvfb) {
  console.log('SKIP Electron smoke: xvfb-run is not available on this host.');
  process.exit(0);
}
const electron = path.join(root, 'node_modules', '.bin', 'electron');
const fixture = path.join(root, 'tests', 'fixtures', 'smoke.md');
const result = spawnSync(xvfb, ['-a', electron, '.', fixture], { cwd: root, stdio: 'inherit', env: { ...process.env, DTR_SMOKE: '1' }, timeout: 60000 });
if (result.error) throw result.error;
process.exit(result.status ?? 1);
