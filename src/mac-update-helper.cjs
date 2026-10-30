'use strict';
const crypto = require('node:crypto');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const { verifyManifest } = require('./mac-update-crypto.cjs');
const { validateManifest, verifyArtifactFile } = require('./mac-update-transaction.cjs');

const PLAN_SCHEMA = 'downtoread-mac-install-v1';
const RESULT_LIMIT = 4096;

function sleep(milliseconds) { return new Promise((resolve) => setTimeout(resolve, milliseconds)); }

async function waitForPidExit(pid, timeoutMs = 60000, { _kill = process.kill, _sleep = sleep } = {}) {
  if (!Number.isSafeInteger(pid) || pid <= 0) throw new Error('Invalid parent process ID');
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try { _kill(pid, 0); }
    catch (error) {
      if (error?.code === 'ESRCH') return;
      if (error?.code !== 'EPERM') throw error;
    }
    await _sleep(250);
  }
  throw new Error('DownToRead did not exit before the update timeout');
}

function validatePlan(plan) {
  const expected = ['arch', 'artifactPath', 'currentVersion', 'healthPath', 'healthToken', 'manifestPath', 'parentPid', 'resultPath', 'schema', 'signaturePath', 'targetApp'];
  if (!plan || typeof plan !== 'object' || Array.isArray(plan) || Object.keys(plan).sort().join('\0') !== expected.sort().join('\0')) throw new Error('Invalid update plan fields');
  if (plan.schema !== PLAN_SCHEMA || !['x64', 'arm64'].includes(plan.arch)) throw new Error('Invalid update plan');
  if (!Number.isSafeInteger(plan.parentPid) || plan.parentPid <= 0) throw new Error('Invalid parent process ID');
  for (const key of ['artifactPath', 'healthPath', 'manifestPath', 'resultPath', 'signaturePath', 'targetApp']) {
    if (typeof plan[key] !== 'string' || !path.isAbsolute(plan[key])) throw new Error(`Invalid ${key}`);
  }
  if (!plan.targetApp.endsWith('.app')) throw new Error('Invalid target app path');
  if (typeof plan.healthToken !== 'string' || !/^[0-9a-f]{64}$/.test(plan.healthToken)) throw new Error('Invalid health token');
  return plan;
}

function runCommand(command, args) {
  const result = spawnSync(command, args, { encoding: 'utf8', shell: false });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${path.basename(command)} failed: ${(result.stderr || result.stdout || '').trim().slice(0, 300)}`);
}

async function extractArchive(artifactPath, stagingDirectory) {
  runCommand('/usr/bin/ditto', ['-x', '-k', artifactPath, stagingDirectory]);
}

function cpuName(value) {
  if (value === 0x01000007) return 'x64';
  if (value === 0x0100000c) return 'arm64';
  return null;
}

function machOArchitectures(bytes) {
  const architectures = new Set();
  if (!Buffer.isBuffer(bytes) || bytes.length < 8) return architectures;
  const magicBE = bytes.readUInt32BE(0);
  const magicLE = bytes.readUInt32LE(0);
  if (magicLE === 0xfeedfacf || magicBE === 0xfeedfacf) {
    const cpu = cpuName(magicLE === 0xfeedfacf ? bytes.readUInt32LE(4) : bytes.readUInt32BE(4));
    if (cpu) architectures.add(cpu);
    return architectures;
  }
  const fat64 = magicBE === 0xcafebabf || magicLE === 0xcafebabf;
  const fat32 = magicBE === 0xcafebabe || magicLE === 0xcafebabe;
  if (!fat32 && !fat64) return architectures;
  const littleEndian = magicLE === (fat64 ? 0xcafebabf : 0xcafebabe);
  const read32 = littleEndian ? Buffer.prototype.readUInt32LE : Buffer.prototype.readUInt32BE;
  const count = read32.call(bytes, 4);
  const stride = fat64 ? 32 : 20;
  if (count < 1 || count > 32 || 8 + count * stride > bytes.length) return new Set();
  for (let index = 0; index < count; index += 1) {
    const cpu = cpuName(read32.call(bytes, 8 + index * stride));
    if (cpu) architectures.add(cpu);
  }
  return architectures;
}

function validateMachO(appPath, arch) {
  if (process.platform !== 'darwin') return true;
  const executable = path.join(appPath, 'Contents', 'MacOS', 'DownToRead');
  const descriptor = fs.openSync(executable, 'r');
  const bytes = Buffer.alloc(1032);
  let length;
  try { length = fs.readSync(descriptor, bytes, 0, bytes.length, 0); }
  finally { fs.closeSync(descriptor); }
  return machOArchitectures(bytes.subarray(0, length)).has(arch);
}

function launchExecutable(executable, env = process.env) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, [], { detached: true, stdio: 'ignore', shell: false, env });
    child.once('error', reject);
    child.once('spawn', () => {
      child.unref();
      resolve(child.pid);
    });
  });
}

async function waitForHealth(healthPath, token, timeoutMs = 30000, { _fsp = fsp, _sleep = sleep } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      if ((await _fsp.readFile(healthPath, 'utf8')).trim() === token) return true;
    } catch { /* The new app has not acknowledged startup yet. */ }
    await _sleep(250);
  }
  return false;
}

async function writeResult(resultPath, result, { _fsp = fsp } = {}) {
  const body = `${JSON.stringify(result).slice(0, RESULT_LIMIT - 1)}\n`;
  const temporary = `${resultPath}.tmp-${crypto.randomUUID()}`;
  await _fsp.mkdir(path.dirname(resultPath), { recursive: true, mode: 0o700 });
  try {
    await _fsp.writeFile(temporary, body, { flag: 'wx', mode: 0o600 });
    await _fsp.rename(temporary, resultPath);
  } finally { await _fsp.rm(temporary, { force: true }).catch(() => {}); }
}

async function readSignedUpdate(plan, publicKeyPath, { _fsp = fsp, _verifyManifest = verifyManifest, _validateManifest = validateManifest, _verifyArtifactFile = verifyArtifactFile } = {}) {
  const [manifestStat, signatureStat] = await Promise.all([_fsp.lstat(plan.manifestPath), _fsp.lstat(plan.signaturePath)]);
  if (!manifestStat.isFile() || manifestStat.isSymbolicLink() || manifestStat.size > 64 * 1024) throw new Error('Signed update manifest is invalid');
  if (!signatureStat.isFile() || signatureStat.isSymbolicLink() || signatureStat.size > 1024) throw new Error('Update signature file is invalid');
  const [manifestBytes, signatureText] = await Promise.all([_fsp.readFile(plan.manifestPath), _fsp.readFile(plan.signaturePath, 'ascii')]);
  if (!_verifyManifest(manifestBytes, signatureText.trim(), publicKeyPath)) throw new Error('Update manifest signature verification failed after shutdown');
  let manifest;
  try { manifest = JSON.parse(manifestBytes.toString('utf8')); } catch { throw new Error('Signed update manifest is invalid'); }
  const artifact = _validateManifest(manifest, plan.currentVersion, plan.arch);
  await _verifyArtifactFile(plan.artifactPath, artifact);
  return manifest;
}

async function runUpdate(planInput, {
  publicKeyPath = path.join(__dirname, 'mac-update-ed25519-public.pem'),
  _extractArchive = extractArchive,
  _fsp = fsp,
  _kill = process.kill,
  _launchExecutable = launchExecutable,
  _readSignedUpdate = readSignedUpdate,
  _validateMachO = validateMachO,
  _waitForHealth = waitForHealth,
  _waitForPidExit = waitForPidExit,
  _writeResult = writeResult,
} = {}) {
  const plan = validatePlan(planInput);
  const parent = path.dirname(plan.targetApp);
  let backupPath = null;
  let candidatePid = null;
  let stagingDirectory = null;
  let installedCandidate = false;
  let rollbackComplete = true;
  let version = 'unknown';

  const relaunchOld = async () => {
    const executable = path.join(plan.targetApp, 'Contents', 'MacOS', 'DownToRead');
    const environment = { ...process.env };
    delete environment.ELECTRON_RUN_AS_NODE;
    try { await _launchExecutable(executable, environment); } catch { /* The result file guides manual recovery on next launch. */ }
  };

  try {
    await _waitForPidExit(plan.parentPid);
    const manifest = await _readSignedUpdate(plan, publicKeyPath);
    version = manifest.version;
    const targetStat = await _fsp.lstat(plan.targetApp);
    if (targetStat.isSymbolicLink()) throw new Error('The installed application is a symbolic link and cannot be replaced automatically');
    if (!targetStat.isDirectory()) throw new Error('The installed application is not an app bundle directory');
    stagingDirectory = await _fsp.mkdtemp(path.join(parent, '.downtoread-update-'));
    await _extractArchive(plan.artifactPath, stagingDirectory);
    const entries = await _fsp.readdir(stagingDirectory);
    const applications = entries.filter((entry) => entry.endsWith('.app'));
    if (applications.length !== 1 || applications[0] !== 'DownToRead.app') throw new Error('The verified archive does not contain exactly one DownToRead.app');
    const candidate = path.join(stagingDirectory, 'DownToRead.app');
    const executable = path.join(candidate, 'Contents', 'MacOS', 'DownToRead');
    const [candidateStat, executableStat] = await Promise.all([_fsp.lstat(candidate), _fsp.lstat(executable)]);
    if (candidateStat.isSymbolicLink() || !candidateStat.isDirectory() || executableStat.isSymbolicLink() || !executableStat.isFile() || !_validateMachO(candidate, plan.arch)) throw new Error(`The update does not contain a valid ${plan.arch} application`);

    backupPath = path.join(parent, `.DownToRead.backup-${crypto.randomUUID()}.app`);
    await _fsp.rename(plan.targetApp, backupPath);
    try {
      await _fsp.rename(candidate, plan.targetApp);
      installedCandidate = true;
    } catch (error) {
      await _fsp.rename(backupPath, plan.targetApp);
      backupPath = null;
      throw error;
    }

    await _fsp.rm(plan.healthPath, { force: true });
    const newExecutable = path.join(plan.targetApp, 'Contents', 'MacOS', 'DownToRead');
    const environment = { ...process.env, DTR_UPDATE_HEALTH_PATH: plan.healthPath, DTR_UPDATE_HEALTH_TOKEN: plan.healthToken };
    delete environment.ELECTRON_RUN_AS_NODE;
    candidatePid = await _launchExecutable(newExecutable, environment);
    if (!(await _waitForHealth(plan.healthPath, plan.healthToken))) throw new Error('The new version did not complete startup; the previous version will be restored');

    const success = { success: true, version };
    try {
      await _fsp.rm(backupPath, { recursive: true, force: true });
    } catch (cleanupError) {
      success.cleanupWarning = `The old backup could not be removed: ${String(cleanupError?.message || cleanupError).slice(0, 256)}`;
    }
    backupPath = null;
    await _writeResult(plan.resultPath, success).catch(() => {});
    return success;
  } catch (error) {
    if (candidatePid) {
      try { _kill(candidatePid, 'SIGTERM'); } catch { /* already stopped */ }
      await sleep(500);
      try { _kill(candidatePid, 'SIGKILL'); } catch { /* already stopped */ }
    }
    if (backupPath) {
      try {
        if (installedCandidate) await _fsp.rm(plan.targetApp, { recursive: true, force: true });
        await _fsp.rename(backupPath, plan.targetApp);
        backupPath = null;
      } catch { rollbackComplete = false; }
    }
    const result = {
      success: false,
      version,
      rollbackComplete,
      error: String(error?.message || error).slice(0, 512),
      verifiedArchive: plan.artifactPath,
    };
    await _writeResult(plan.resultPath, result).catch(() => {});
    if (rollbackComplete) await relaunchOld();
    else if (process.platform === 'darwin') {
      try { runCommand('/usr/bin/osascript', ['-e', 'display alert "DownToRead update failed" message "The previous app could not be restored automatically. Reinstall DownToRead from the verified release package." as critical']); } catch { /* no UI remains */ }
    }
    throw error;
  } finally {
    if (stagingDirectory) await _fsp.rm(stagingDirectory, { recursive: true, force: true }).catch(() => {});
  }
}

async function main(argv) {
  if (argv.length !== 1 || !path.isAbsolute(argv[0])) throw new Error('Usage: mac-update-helper.cjs /absolute/path/to/install-plan.json');
  const planPath = argv[0];
  let plan;
  try { plan = JSON.parse(await fsp.readFile(planPath, 'utf8')); }
  finally { await fsp.rm(planPath, { force: true }).catch(() => {}); }
  await runUpdate(plan);
}

if (require.main === module) main(process.argv.slice(2)).catch((error) => {
  process.stderr.write(`mac-update-helper: ${String(error?.message || error).slice(0, 512)}\n`);
  process.exitCode = 1;
});

module.exports = { PLAN_SCHEMA, machOArchitectures, main, readSignedUpdate, runUpdate, validateMachO, validatePlan, waitForHealth, waitForPidExit, writeResult };
