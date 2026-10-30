'use strict';
const crypto = require('node:crypto');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { PLAN_SCHEMA } = require('./mac-update-helper.cjs');
const { downloadAndVerify, fetchManifest, macAppPathFromExecutable, preflightWritability } = require('./mac-update-transaction.cjs');

const RESULT_NAME = 'mac-update-result.json';
const UPDATE_DIRECTORY = 'mac-updates';

function pathInside(parent, candidate) {
  const relative = path.relative(parent, candidate);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

async function writeHealthAcknowledgement(app, env = process.env, { _fsp = fsp } = {}) {
  const healthPath = env.DTR_UPDATE_HEALTH_PATH;
  const token = env.DTR_UPDATE_HEALTH_TOKEN;
  if (!healthPath && !token) return false;
  if (typeof healthPath !== 'string' || typeof token !== 'string' || !/^[0-9a-f]{64}$/.test(token)) return false;
  let userData;
  try { userData = app.getPath('userData'); } catch { return false; }
  if (!path.isAbsolute(healthPath) || !pathInside(userData, healthPath)) return false;
  try {
    await _fsp.mkdir(path.dirname(healthPath), { recursive: true, mode: 0o700 });
    await _fsp.writeFile(healthPath, `${token}\n`, { flag: 'wx', mode: 0o600 });
    return true;
  } catch { return false; }
}

async function consumeResult(app, dialog, shell, { _fsp = fsp } = {}) {
  let userData;
  try { userData = app.getPath('userData'); } catch { return; }
  const resultPath = path.join(userData, UPDATE_DIRECTORY, RESULT_NAME);
  let result;
  try {
    const stat = await _fsp.lstat(resultPath);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 4096) throw new Error('invalid result file');
    result = JSON.parse(await _fsp.readFile(resultPath, 'utf8'));
  } catch { return; }
  await _fsp.rm(resultPath, { force: true }).catch(() => {});
  if (result.success) return;
  const restored = result.rollbackComplete === true;
  const buttons = result.verifiedArchive ? ['Show Verified ZIP', 'OK'] : ['OK'];
  const response = await dialog.showMessageBox({
    type: restored ? 'warning' : 'error',
    title: restored ? 'Update Rolled Back' : 'Update Needs Manual Recovery',
    buttons,
    defaultId: buttons.length - 1,
    cancelId: buttons.length - 1,
    noLink: true,
    message: restored
      ? `The update failed and the previous DownToRead version was restored.\n\n${String(result.error || '').slice(0, 512)}`
      : `The update failed and the previous app could not be restored automatically. Reinstall DownToRead from the verified release ZIP.\n\n${String(result.error || '').slice(0, 512)}`,
  });
  if (result.verifiedArchive && response.response === 0) shell?.showItemInFolder(result.verifiedArchive);
}

function startHelper(executablePath, helperPath, planPath) {
  return new Promise((resolve, reject) => {
    const child = spawn(executablePath, [helperPath, planPath], {
      detached: true,
      stdio: 'ignore',
      shell: false,
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    });
    child.once('error', reject);
    child.once('spawn', () => { child.unref(); resolve(child.pid); });
  });
}

async function showManualUpdate(dialog, shell, artifactPath, reason) {
  const answer = await dialog.showMessageBox({
    type: 'info',
    title: 'Manual macOS Update Required',
    buttons: ['Show Verified ZIP', 'Later'],
    defaultId: 1,
    cancelId: 1,
    noLink: true,
    message: `DownToRead verified the update but cannot replace this installation automatically because ${reason}.\n\nTo update manually:\n1. Show and unzip the verified ZIP\n2. Quit DownToRead\n3. Drag DownToRead.app to the Applications folder and replace the old copy`,
  });
  if (answer.response === 0) shell?.showItemInFolder(artifactPath);
}

function configureUpdater(_unusedNativeUpdater, dialog, {
  _app = (() => { try { return require('electron').app; } catch { return null; } })(),
  _downloadAndVerify = downloadAndVerify,
  _execPath = process.execPath,
  _fetchManifest = fetchManifest,
  _fsp = fsp,
  _platform = process.platform,
  _preflightWritability = preflightWritability,
  _resourcesPath = process.resourcesPath,
  _shell = (() => { try { return require('electron').shell; } catch { return null; } })(),
  _startHelper = startHelper,
} = {}) {
  let checking = false;

  if (_app) _app.whenReady().then(() => consumeResult(_app, dialog, _shell, { _fsp })).catch(() => {});

  return async function checkForUpdates({ silent = false } = {}) {
    if (!_app || checking) return null;
    checking = true;
    try {
      const userData = _app.getPath('userData');
      const resourceDirectory = _app.isPackaged ? path.join(_resourcesPath, 'update') : __dirname;
      const publicKeyPath = _app.isPackaged
        ? path.join(resourceDirectory, 'mac-update-ed25519-public.pem')
        : path.join(__dirname, '..', 'build', 'mac-update-ed25519-public.pem');
      const helperPath = path.join(resourceDirectory, 'mac-update-helper.cjs');
      const arch = process.arch === 'arm64' ? 'arm64' : 'x64';
      let update;
      try {
        update = await _fetchManifest({ currentVersion: _app.getVersion(), arch, publicKeyPath });
      } catch (error) {
        if (String(error?.message).startsWith('No upgrade available:')) {
          if (!silent) await dialog.showMessageBox({ type: 'info', title: 'DownToRead', buttons: ['OK'], defaultId: 0, message: 'DownToRead is up to date.' });
        } else if (!silent) dialog.showErrorBox('Update check failed', String(error?.message || error).slice(0, 512));
        return null;
      }

      const downloadChoice = await dialog.showMessageBox({
        type: 'info', title: 'DownToRead Update', buttons: ['Download', 'Later'], defaultId: 1, cancelId: 1, noLink: true,
        message: `DownToRead ${update.manifest.version} is available.`,
      });
      if (downloadChoice.response !== 0) return null;

      const updateRoot = path.join(userData, UPDATE_DIRECTORY);
      await _fsp.mkdir(updateRoot, { recursive: true, mode: 0o700 });
      const staging = await _fsp.mkdtemp(path.join(updateRoot, 'download-'));
      const artifactPath = path.join(staging, update.artifact.name);
      try { await _downloadAndVerify(update.artifact, artifactPath); }
      catch (error) {
        dialog.showErrorBox('Update download rejected', String(error?.message || error).slice(0, 512));
        return null;
      }
      const manifestPath = path.join(staging, 'mac-update-v1.json');
      const signaturePath = path.join(staging, 'mac-update-v1.sig');
      await _fsp.writeFile(manifestPath, update.manifestBytes, { flag: 'wx', mode: 0o600 });
      await _fsp.writeFile(signaturePath, `${update.signature}\n`, { flag: 'wx', mode: 0o600 });

      const installChoice = await dialog.showMessageBox({
        type: 'info', title: 'Install Verified Update?', buttons: ['Install and Restart', 'Later'], defaultId: 1, cancelId: 1, noLink: true,
        message: `DownToRead ${update.manifest.version} was downloaded and verified with the built-in release key.`,
      });
      if (installChoice.response !== 0) return { verifiedArchive: artifactPath };

      if (_platform !== 'darwin') return null;
      const targetApp = macAppPathFromExecutable(_execPath);
      const preflight = await _preflightWritability(targetApp);
      if (!preflight.ok) {
        await showManualUpdate(dialog, _shell, artifactPath, preflight.reason);
        return { manual: true, verifiedArchive: artifactPath };
      }

      const healthPath = path.join(staging, 'health');
      const resultPath = path.join(updateRoot, RESULT_NAME);
      const planPath = path.join(staging, 'install-plan.json');
      const plan = {
        arch,
        artifactPath,
        currentVersion: _app.getVersion(),
        healthPath,
        healthToken: crypto.randomBytes(32).toString('hex'),
        manifestPath,
        parentPid: process.pid,
        resultPath,
        schema: PLAN_SCHEMA,
        signaturePath,
        targetApp,
      };
      await _fsp.writeFile(planPath, `${JSON.stringify(plan)}\n`, { flag: 'wx', mode: 0o600 });
      try { await _startHelper(_execPath, helperPath, planPath); }
      catch (error) {
        await showManualUpdate(dialog, _shell, artifactPath, `the update helper could not start (${String(error?.message || error).slice(0, 160)})`);
        return { manual: true, verifiedArchive: artifactPath };
      }
      _app.quit();
      return { installing: true };
    } finally { checking = false; }
  };
}

module.exports = { RESULT_NAME, UPDATE_DIRECTORY, configureUpdater, consumeResult, pathInside, showManualUpdate, startHelper, writeHealthAcknowledgement };
