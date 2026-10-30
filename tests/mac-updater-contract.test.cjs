'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const read = (name) => fs.readFileSync(path.join(root, name), 'utf8');

test('macOS uses the custom updater while other platforms retain electron-updater', () => {
  const main = read('src/main.cjs');
  assert.match(main, /process\.platform === 'darwin'/);
  assert.match(main, /require\('\.\/mac-updater\.cjs'\)/);
  assert.match(main, /configureUpdater\(process\.platform === 'darwin' \? null : autoUpdater, dialog\)/);
  assert.match(main, /ipcMain\.on\('renderer-ready',[\s\S]*writeHealthAcknowledgement\(app\)/);
});

test('packaged macOS helper carries its verifier and fixed public key outside ASAR', () => {
  const pkg = JSON.parse(read('package.json'));
  const resources = pkg.build.extraResources || [];
  const targets = resources.map((entry) => entry.to);
  for (const target of [
    'update/mac-update-helper.cjs',
    'update/mac-update-crypto.cjs',
    'update/mac-update-transaction.cjs',
    'update/mac-update-ed25519-public.pem',
  ]) assert.ok(targets.includes(target), `missing extraResource ${target}`);
});

test('tag releases require the private update key and publish signed metadata', () => {
  const workflow = read('.github/workflows/release.yml');
  assert.match(workflow, /MAC_UPDATE_PRIVATE_KEY_B64:\s*\$\{\{ secrets\.MAC_UPDATE_PRIVATE_KEY_B64 \}\}/);
  assert.match(workflow, /node scripts\/sign-mac-update\.cjs/);
  assert.match(workflow, /\/usr\/bin\/ditto -x -k/);
  assert.match(workflow, /lipo -archs/);
  assert.match(workflow, /mac-update-v1\.json/);
  assert.match(workflow, /mac-update-v1\.sig/);
});

test('mac updater never bypasses macOS security controls or quarantine', () => {
  const sources = ['src/mac-updater.cjs', 'src/mac-update-helper.cjs', 'src/mac-update-transaction.cjs'].map(read).join('\n');
  assert.doesNotMatch(sources, /--noqtn|xattr|spctl|csrutil|\bsudo\b/);
  assert.match(sources, /ELECTRON_RUN_AS_NODE/);
  assert.match(sources, /DTR_UPDATE_HEALTH_PATH/);
});
