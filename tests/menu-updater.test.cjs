const test = require('node:test');
const assert = require('node:assert/strict');
const { buildMenuTemplate, COMMANDS } = require('../src/menu.cjs');
const { configureUpdater } = require('../src/updater.cjs');

test('native menu exposes open, print, zoom, update and no editing controls', () => {
  const called = [];
  const template = buildMenuTemplate({ platform: 'darwin', command: (name) => called.push(name) });
  const flattened = template.flatMap((menu) => menu.submenu || []);
  for (const label of ['Open…', 'Print…', 'Zoom In', 'Zoom Out', 'Actual Size', 'Check for Updates…']) assert.ok(flattened.some((item) => item.label === label));
  assert.equal(template.some((menu) => menu.label === 'Edit'), false);
  const applicationMenu = template.find((menu) => menu.label === 'DownToRead').submenu;
  for (const role of ['services', 'hide', 'hideOthers', 'unhide']) assert.ok(applicationMenu.some((entry) => entry.role === role));
  assert.ok(template.some((menu) => menu.label === 'Window'));
  flattened.find((item) => item.label === 'Print…').click();
  assert.deepEqual(called, [COMMANDS.PRINT]);
});

test('updater disables silent download/install and reports manual outcomes through dialogs', async () => {
  const events = new Map();
  const updater = { autoDownload: true, autoInstallOnAppQuit: true, on: (name, fn) => events.set(name, fn), checkForUpdates: async () => ({ updateInfo: { version: '2.0.0' } }) };
  const dialogs = [];
  const check = configureUpdater(updater, { showMessageBox: async (options) => dialogs.push(options), showErrorBox: (...args) => dialogs.push(args) });
  assert.equal(updater.autoDownload, false);
  assert.equal(updater.autoInstallOnAppQuit, false);
  await check();
  events.get('update-not-available')();
  assert.equal(dialogs.length, 1);
});

test('automatic update checks stay quiet when no update is available or the network fails', async () => {
  const events = new Map();
  const updater = { autoDownload: true, autoInstallOnAppQuit: true, on: (name, fn) => events.set(name, fn), checkForUpdates: async () => ({ updateInfo: { version: '0.1.0' } }) };
  const dialogs = [];
  const check = configureUpdater(updater, { showMessageBox: async (options) => dialogs.push(options), showErrorBox: (...args) => dialogs.push(args) });

  await check({ silent: true });
  events.get('update-not-available')();
  assert.deepEqual(dialogs, []);

  await check({ silent: true });
  events.get('error')(new Error('offline'));
  assert.deepEqual(dialogs, []);
});

test('available updates require a deliberate non-default download choice', async () => {
  const events = new Map();
  const updater = { autoDownload: true, autoInstallOnAppQuit: true, on: (name, fn) => events.set(name, fn), checkForUpdates: async () => null, downloadUpdate: async () => {} };
  const dialogs = [];
  configureUpdater(updater, { showMessageBox: async (options) => { dialogs.push(options); return { response: 1 }; }, showErrorBox: () => {} });

  await events.get('update-available')({ version: '2.0.0' });
  assert.equal(dialogs[0].buttons[dialogs[0].defaultId], 'Later');
});
