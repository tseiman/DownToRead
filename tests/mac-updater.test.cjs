'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { Readable } = require('node:stream');

const { decodeSignature, sha256File, verifyManifest } = require('../src/mac-update-crypto.cjs');
const {
  SCHEMA, downloadAndVerify, expectedArtifactName, fetchManifest, isAllowedDownloadHost,
  isNewerVersion, macAppPathFromExecutable, preflightWritability, requestStream, validateManifest,
  verifyArtifactFile,
} = require('../src/mac-update-transaction.cjs');
const { PLAN_SCHEMA, machOArchitectures, runUpdate, waitForPidExit } = require('../src/mac-update-helper.cjs');
const { configureUpdater, consumeResult, writeHealthAcknowledgement } = require('../src/mac-updater.cjs');
const { signRelease } = require('../scripts/sign-mac-update.cjs');

async function withTemporaryDirectory(callback, prefix = 'downtoread update ') {
  const directory = await fsp.mkdtemp(path.join(os.tmpdir(), prefix));
  try { return await callback(directory); }
  finally { await fsp.rm(directory, { recursive: true, force: true }); }
}

function keyPair() { return crypto.generateKeyPairSync('ed25519'); }
function hash(bytes) { return crypto.createHash('sha256').update(bytes).digest('hex'); }

function artifact(version, arch, bytes) {
  const name = expectedArtifactName(version, arch);
  return {
    name,
    sha256: hash(bytes),
    size: bytes.length,
    url: `https://github.com/tseiman/DownToRead/releases/download/v${version}/${name}`,
  };
}

function manifestFor(version, x64Bytes = Buffer.from('x64 archive'), arm64Bytes = Buffer.from('arm archive')) {
  return {
    artifacts: { arm64: artifact(version, 'arm64', arm64Bytes), x64: artifact(version, 'x64', x64Bytes) },
    schema: SCHEMA,
    tag: `v${version}`,
    version,
  };
}

async function signedFixture(directory, { artifactBytes = Buffer.from('x64 archive'), version = '0.1.12' } = {}) {
  const { privateKey, publicKey } = keyPair();
  const publicKeyPath = path.join(directory, 'public.pem');
  const manifestPath = path.join(directory, 'mac-update-v1.json');
  const signaturePath = path.join(directory, 'mac-update-v1.sig');
  const artifactPath = path.join(directory, expectedArtifactName(version, 'x64'));
  const manifest = manifestFor(version, artifactBytes);
  const manifestBytes = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`);
  const signature = crypto.sign(null, manifestBytes, privateKey).toString('base64url');
  await Promise.all([
    fsp.writeFile(publicKeyPath, publicKey.export({ type: 'spki', format: 'pem' })),
    fsp.writeFile(manifestPath, manifestBytes),
    fsp.writeFile(signaturePath, `${signature}\n`),
    fsp.writeFile(artifactPath, artifactBytes),
  ]);
  return { artifactPath, manifest, manifestBytes, privateKey, publicKeyPath, signature, signaturePath, manifestPath };
}

function installPlan(directory, fixture, targetApp, overrides = {}) {
  return {
    arch: 'x64', artifactPath: fixture.artifactPath, currentVersion: '0.1.11',
    healthPath: path.join(directory, 'user data', 'health'), healthToken: 'a'.repeat(64),
    manifestPath: fixture.manifestPath, parentPid: 12345,
    resultPath: path.join(directory, 'user data', 'mac-updates', 'mac-update-result.json'),
    schema: PLAN_SCHEMA, signaturePath: fixture.signaturePath, targetApp, ...overrides,
  };
}

async function createAppBundle(appPath, marker) {
  const executable = path.join(appPath, 'Contents', 'MacOS', 'DownToRead');
  await fsp.mkdir(path.dirname(executable), { recursive: true });
  await fsp.writeFile(executable, marker, { mode: 0o755 });
  return executable;
}

test('Ed25519 manifest verification rejects tampering and malformed signatures', async () => {
  await withTemporaryDirectory(async (directory) => {
    const fixture = await signedFixture(directory);
    assert.equal(verifyManifest(fixture.manifestBytes, fixture.signature, fixture.publicKeyPath), true);
    assert.equal(verifyManifest(Buffer.from('tampered'), fixture.signature, fixture.publicKeyPath), false);
    assert.throws(() => decodeSignature('not-base64url'), /encoding/);
  });
});

test('strict manifest validation selects x64 and arm64 and rejects origin, tag, schema, extras, and downgrade', () => {
  const manifest = manifestFor('0.1.12');
  assert.equal(validateManifest(manifest, '0.1.11', 'x64').name, 'DownToRead-0.1.12-mac.zip');
  assert.equal(validateManifest(manifest, '0.1.11', 'arm64').name, 'DownToRead-0.1.12-arm64-mac.zip');
  assert.equal(isNewerVersion('1.0.0', '0.99.99'), true);
  assert.equal(isNewerVersion('0.1.11', '0.1.11'), false);
  assert.throws(() => isNewerVersion('1.2', '1.1.0'), /Invalid version/);
  assert.throws(() => validateManifest({ ...manifest, schema: 1 }, '0.1.11', 'x64'), /schema/);
  assert.throws(() => validateManifest({ ...manifest, tag: 'v9.9.9' }, '0.1.11', 'x64'), /tag/);
  assert.throws(() => validateManifest({ ...manifest, extra: true }, '0.1.11', 'x64'), /fields/);
  assert.throws(() => validateManifest(manifest, '0.1.12', 'x64'), /No upgrade/);
  const wrongOrigin = structuredClone(manifest);
  wrongOrigin.artifacts.x64.url = wrongOrigin.artifacts.x64.url.replace('github.com', 'example.com');
  assert.throws(() => validateManifest(wrongOrigin, '0.1.11', 'x64'), /origin/);
  assert.equal(isAllowedDownloadHost('github.com'), true);
  assert.equal(isAllowedDownloadHost('release-assets.githubusercontent.com'), true);
  assert.equal(isAllowedDownloadHost('github.com.example.org'), false);
});

test('fetchManifest verifies exact signed bytes before parsing', async () => {
  await withTemporaryDirectory(async (directory) => {
    const fixture = await signedFixture(directory);
    const result = await fetchManifest({
      currentVersion: '0.1.11', arch: 'x64', publicKeyPath: fixture.publicKeyPath,
      _getSmall: async (url) => url.endsWith('.sig') ? Buffer.from(fixture.signature) : fixture.manifestBytes,
    });
    assert.equal(result.artifact.name, fixture.manifest.artifacts.x64.name);
    await assert.rejects(() => fetchManifest({
      currentVersion: '0.1.11', arch: 'x64', publicKeyPath: fixture.publicKeyPath,
      _getSmall: async (url) => url.endsWith('.sig') ? Buffer.from(fixture.signature) : Buffer.from('{}'),
    }), /signature/);
  });
});

test('downloadAndVerify streams a correct artifact and rejects corrupt or truncated bytes', async () => {
  await withTemporaryDirectory(async (directory) => {
    const bytes = Buffer.from('verified update bytes');
    const metadata = artifact('0.1.12', 'x64', bytes);
    const goodPath = path.join(directory, 'good.zip');
    await downloadAndVerify(metadata, goodPath, { _requestStream: async () => Readable.from([bytes.subarray(0, 5), bytes.subarray(5)]) });
    assert.deepEqual(await fsp.readFile(goodPath), bytes);
    const corruptPath = path.join(directory, 'corrupt.zip');
    await assert.rejects(() => downloadAndVerify(metadata, corruptPath, { _requestStream: async () => Readable.from([Buffer.alloc(bytes.length, 0x41)]) }), /SHA-256/);
    await assert.rejects(() => fsp.access(corruptPath));
    const shortPath = path.join(directory, 'short.zip');
    await assert.rejects(() => downloadAndVerify(metadata, shortPath, { _requestStream: async () => Readable.from([bytes.subarray(0, 4)]) }), /size/);
  });
});

test('mac app path and writable preflight handle spaces, translocation, and permission failure', async () => {
  await withTemporaryDirectory(async (directory) => {
    const appPath = path.join(directory, 'Applications With Spaces', 'DownToRead.app');
    await fsp.mkdir(appPath, { recursive: true });
    assert.equal(macAppPathFromExecutable(path.join(appPath, 'Contents', 'MacOS', 'DownToRead')), appPath);
    assert.equal((await preflightWritability(appPath)).ok, true);
    const symlinkPath = path.join(directory, 'Linked DownToRead.app');
    await fsp.symlink(appPath, symlinkPath);
    const linked = await preflightWritability(symlinkPath);
    assert.equal(linked.ok, false);
    assert.match(linked.reason, /symbolic link/);
    const translocated = await preflightWritability(appPath, { _realpath: async () => '/private/var/folders/x/AppTranslocation/y/DownToRead.app' });
    assert.equal(translocated.ok, false);
    const denied = await preflightWritability(appPath, { _fsp: { stat: fsp.stat, open: async () => { throw Object.assign(new Error('denied'), { code: 'EACCES' }); }, rm: async () => {} }, _realpath: async (value) => value });
    assert.equal(denied.ok, false);
  });
});

test('helper performs complete old-to-new replacement in a path with spaces', async () => {
  await withTemporaryDirectory(async (directory) => {
    const fixture = await signedFixture(directory);
    const target = path.join(directory, 'Applications With Spaces', 'DownToRead.app');
    const targetExecutable = await createAppBundle(target, 'old-version');
    const plan = installPlan(directory, fixture, target);
    const launched = [];
    await runUpdate(plan, {
      publicKeyPath: fixture.publicKeyPath,
      _waitForPidExit: async () => {},
      _extractArchive: async (_archive, staging) => { await createAppBundle(path.join(staging, 'DownToRead.app'), 'new-version'); },
      _validateMachO: () => true,
      _launchExecutable: (executable, env) => { launched.push({ executable, env }); return 98765; },
      _waitForHealth: async (_health, token) => token === plan.healthToken,
    });
    assert.equal(await fsp.readFile(targetExecutable, 'utf8'), 'new-version');
    assert.equal(launched.length, 1);
    assert.equal(launched[0].env.DTR_UPDATE_HEALTH_TOKEN, plan.healthToken);
    assert.equal(JSON.parse(await fsp.readFile(plan.resultPath, 'utf8')).success, true);
    assert.equal((await fsp.readdir(path.dirname(target))).some((entry) => entry.includes('.backup-')), false);
  });
});

test('post-commit backup cleanup failure keeps the healthy new version installed', async () => {
  await withTemporaryDirectory(async (directory) => {
    const fixture = await signedFixture(directory);
    const target = path.join(directory, 'DownToRead.app');
    const executable = await createAppBundle(target, 'old-version');
    const plan = installPlan(directory, fixture, target);
    const wrapped = Object.create(fsp);
    wrapped.rm = async (value, options) => {
      if (String(value).includes('.DownToRead.backup-')) throw new Error('injected backup cleanup failure');
      return fsp.rm(value, options);
    };
    const result = await runUpdate(plan, {
      publicKeyPath: fixture.publicKeyPath, _fsp: wrapped, _waitForPidExit: async () => {},
      _extractArchive: async (_archive, staging) => { await createAppBundle(path.join(staging, 'DownToRead.app'), 'new-version'); },
      _validateMachO: () => true, _launchExecutable: () => 98765, _waitForHealth: async () => true,
    });
    assert.equal(result.success, true);
    assert.equal(await fsp.readFile(executable, 'utf8'), 'new-version');
    assert.equal(JSON.parse(await fsp.readFile(plan.resultPath, 'utf8')).success, true);
  });
});

test('helper rejects a symbolic-link target bundle before replacement', async () => {
  await withTemporaryDirectory(async (directory) => {
    const fixture = await signedFixture(directory);
    const realTarget = path.join(directory, 'Real DownToRead.app');
    await createAppBundle(realTarget, 'old-version');
    const target = path.join(directory, 'DownToRead.app');
    await fsp.symlink(realTarget, target);
    const plan = installPlan(directory, fixture, target);
    await assert.rejects(() => runUpdate(plan, {
      publicKeyPath: fixture.publicKeyPath, _waitForPidExit: async () => {}, _launchExecutable: () => 1,
    }), /symbolic link/);
    assert.equal((await fsp.lstat(target)).isSymbolicLink(), true);
    assert.equal(await fsp.readFile(path.join(realTarget, 'Contents', 'MacOS', 'DownToRead'), 'utf8'), 'old-version');
  });
});

test('Mach-O architecture parser rejects fat binaries that omit the requested CPU', () => {
  const thinX64 = Buffer.alloc(8);
  thinX64.writeUInt32LE(0xfeedfacf, 0);
  thinX64.writeUInt32LE(0x01000007, 4);
  assert.deepEqual(machOArchitectures(thinX64), new Set(['x64']));
  const fatX64 = Buffer.alloc(8 + 20);
  fatX64.writeUInt32BE(0xcafebabe, 0);
  fatX64.writeUInt32BE(1, 4);
  fatX64.writeUInt32BE(0x01000007, 8);
  assert.deepEqual(machOArchitectures(fatX64), new Set(['x64']));
  assert.equal(machOArchitectures(fatX64).has('arm64'), false);
});

test('helper rejects a corrupted artifact before replacement and relaunches the old app', async () => {
  await withTemporaryDirectory(async (directory) => {
    const fixture = await signedFixture(directory);
    await fsp.writeFile(fixture.artifactPath, 'corrupted after verification');
    const target = path.join(directory, 'DownToRead.app');
    const executable = await createAppBundle(target, 'old-version');
    const plan = installPlan(directory, fixture, target);
    const launches = [];
    await assert.rejects(() => runUpdate(plan, {
      publicKeyPath: fixture.publicKeyPath, _waitForPidExit: async () => {},
      _extractArchive: async () => assert.fail('corrupt archive must not be extracted'),
      _launchExecutable: (value) => { launches.push(value); return 1; },
    }), /size|SHA-256/);
    assert.equal(await fsp.readFile(executable, 'utf8'), 'old-version');
    assert.equal(launches.length, 1);
    const result = JSON.parse(await fsp.readFile(plan.resultPath, 'utf8'));
    assert.equal(result.success, false);
    assert.equal(result.rollbackComplete, true);
  });
});

test('helper rejects an invalid update signature before replacement', async () => {
  await withTemporaryDirectory(async (directory) => {
    const fixture = await signedFixture(directory);
    await fsp.writeFile(fixture.signaturePath, `${'A'.repeat(86)}\n`);
    const target = path.join(directory, 'DownToRead.app');
    const executable = await createAppBundle(target, 'old-version');
    const plan = installPlan(directory, fixture, target);
    await assert.rejects(() => runUpdate(plan, {
      publicKeyPath: fixture.publicKeyPath, _waitForPidExit: async () => {}, _launchExecutable: () => 1,
    }), /signature/);
    assert.equal(await fsp.readFile(executable, 'utf8'), 'old-version');
  });
});

test('failed candidate rename restores the old app', async () => {
  await withTemporaryDirectory(async (directory) => {
    const fixture = await signedFixture(directory);
    const target = path.join(directory, 'DownToRead.app');
    const executable = await createAppBundle(target, 'old-version');
    const plan = installPlan(directory, fixture, target);
    const wrapped = Object.create(fsp);
    wrapped.rename = async (from, to) => {
      if (from.endsWith(`${path.sep}DownToRead.app`) && from.includes('.downtoread-update-') && to === target) throw new Error('injected install failure');
      return fsp.rename(from, to);
    };
    await assert.rejects(() => runUpdate(plan, {
      publicKeyPath: fixture.publicKeyPath, _fsp: wrapped, _waitForPidExit: async () => {},
      _extractArchive: async (_archive, staging) => { await createAppBundle(path.join(staging, 'DownToRead.app'), 'new-version'); },
      _validateMachO: () => true, _launchExecutable: () => 1,
    }), /injected install failure/);
    assert.equal(await fsp.readFile(executable, 'utf8'), 'old-version');
    assert.equal(JSON.parse(await fsp.readFile(plan.resultPath, 'utf8')).rollbackComplete, true);
  });
});

test('missing startup health marker removes candidate and restores old app', async () => {
  await withTemporaryDirectory(async (directory) => {
    const fixture = await signedFixture(directory);
    const target = path.join(directory, 'DownToRead.app');
    const executable = await createAppBundle(target, 'old-version');
    const plan = installPlan(directory, fixture, target);
    const launches = [];
    await assert.rejects(() => runUpdate(plan, {
      publicKeyPath: fixture.publicKeyPath, _waitForPidExit: async () => {},
      _extractArchive: async (_archive, staging) => { await createAppBundle(path.join(staging, 'DownToRead.app'), 'new-version'); },
      _validateMachO: () => true, _launchExecutable: (value) => { launches.push(value); return 999999; },
      _waitForHealth: async () => false, _kill: () => { throw Object.assign(new Error('gone'), { code: 'ESRCH' }); },
    }), /startup/);
    assert.equal(await fsp.readFile(executable, 'utf8'), 'old-version');
    assert.equal(launches.length, 2, 'new candidate and restored old app should both be launched');
  });
});

test('process wait treats EPERM as alive and ESRCH as actual exit', async () => {
  const events = [Object.assign(new Error('not permitted'), { code: 'EPERM' }), Object.assign(new Error('gone'), { code: 'ESRCH' })];
  let sleeps = 0;
  await waitForPidExit(42, 1000, {
    _kill: () => { throw events.shift(); },
    _sleep: async () => { sleeps += 1; },
  });
  assert.equal(sleeps, 1);
});

test('health acknowledgement is restricted to userData and uses exclusive creation', async () => {
  await withTemporaryDirectory(async (directory) => {
    const healthPath = path.join(directory, 'mac-updates', 'health');
    const app = { getPath: () => directory };
    assert.equal(await writeHealthAcknowledgement(app, { DTR_UPDATE_HEALTH_PATH: healthPath, DTR_UPDATE_HEALTH_TOKEN: 'c'.repeat(64) }), true);
    assert.equal((await fsp.readFile(healthPath, 'utf8')).trim(), 'c'.repeat(64));
    assert.equal(await writeHealthAcknowledgement(app, { DTR_UPDATE_HEALTH_PATH: '/outside/health', DTR_UPDATE_HEALTH_TOKEN: 'c'.repeat(64) }), false);
  });
});

test('unwritable installation offers verified manual flow without quitting', async () => {
  await withTemporaryDirectory(async (directory) => {
    const bytes = Buffer.from('x64 archive');
    const manifest = manifestFor('0.1.12', bytes);
    const choices = [0, 0, 0];
    const dialogs = [];
    const dialog = {
      showMessageBox: async (options) => { dialogs.push(options); return { response: choices.shift() ?? options.cancelId ?? 0 }; },
      showErrorBox: (title, message) => dialogs.push({ title, message }),
    };
    let quit = false;
    let revealed = null;
    const app = { isPackaged: true, getPath: () => directory, getVersion: () => '0.1.11', quit: () => { quit = true; }, whenReady: () => Promise.resolve() };
    const check = configureUpdater(null, dialog, {
      _app: app, _execPath: '/Applications With Spaces/DownToRead.app/Contents/MacOS/DownToRead', _platform: 'darwin', _resourcesPath: '/resources',
      _fetchManifest: async () => ({ artifact: manifest.artifacts.x64, manifest, manifestBytes: Buffer.from(JSON.stringify(manifest)), signature: 'A'.repeat(86) }),
      _downloadAndVerify: async (_artifact, destination) => { await fsp.writeFile(destination, bytes); },
      _preflightWritability: async () => ({ ok: false, reason: 'the installation folder is not writable' }),
      _shell: { showItemInFolder: (value) => { revealed = value; } },
    });
    const result = await check();
    assert.equal(result.manual, true);
    assert.equal(quit, false);
    assert.ok(revealed?.endsWith('.zip'));
    assert.ok(dialogs.some((entry) => entry.title === 'Manual macOS Update Required'));
  });
});

test('release signer signs finished x64 and arm64 ZIP bytes and rejects a different key', async () => {
  await withTemporaryDirectory(async (directory) => {
    const assets = path.join(directory, 'release assets');
    const output = path.join(directory, 'signed metadata');
    await fsp.mkdir(assets, { recursive: true });
    await fsp.writeFile(path.join(assets, expectedArtifactName('1.2.3', 'x64')), 'x64 finished bytes');
    await fsp.writeFile(path.join(assets, expectedArtifactName('1.2.3', 'arm64')), 'arm64 finished bytes');
    const { privateKey, publicKey } = keyPair();
    const publicPath = path.join(directory, 'public.pem');
    await fsp.writeFile(publicPath, publicKey.export({ type: 'spki', format: 'pem' }));
    const encoded = Buffer.from(privateKey.export({ type: 'pkcs8', format: 'pem' })).toString('base64');
    const manifest = signRelease({ assetsDirectory: assets, outputDirectory: output, publicKeyPath: publicPath, tag: 'v1.2.3', privateKeyBase64: encoded });
    const manifestBytes = await fsp.readFile(path.join(output, 'mac-update-v1.json'));
    const signature = (await fsp.readFile(path.join(output, 'mac-update-v1.sig'), 'utf8')).trim();
    assert.equal(manifest.artifacts.x64.sha256, await sha256File(path.join(assets, expectedArtifactName('1.2.3', 'x64'))));
    assert.equal(verifyManifest(manifestBytes, signature, publicPath), true);
    const wrong = keyPair().privateKey;
    await assert.rejects(async () => signRelease({ assetsDirectory: assets, outputDirectory: output, publicKeyPath: publicPath, tag: 'v1.2.3', privateKeyBase64: Buffer.from(wrong.export({ type: 'pkcs8', format: 'pem' })).toString('base64') }), /does not match/);
  });
});

test('candidate launch failure restores the old application', async () => {
  await withTemporaryDirectory(async (directory) => {
    const fixture = await signedFixture(directory);
    const target = path.join(directory, 'DownToRead.app');
    const executable = await createAppBundle(target, 'old-version');
    const plan = installPlan(directory, fixture, target);
    await assert.rejects(() => runUpdate(plan, {
      publicKeyPath: fixture.publicKeyPath, _waitForPidExit: async () => {},
      _extractArchive: async (_archive, staging) => { await createAppBundle(path.join(staging, 'DownToRead.app'), 'new-version'); },
      _validateMachO: () => true,
      _launchExecutable: async (value) => {
        if (value.includes(`${path.sep}DownToRead.app${path.sep}`)) throw new Error('injected launch failure');
        return 1;
      },
      _waitForHealth: async () => assert.fail('health wait must not begin after launch failure'),
    }), /injected launch failure/);
    assert.equal(await fsp.readFile(executable, 'utf8'), 'old-version');
    assert.equal(JSON.parse(await fsp.readFile(plan.resultPath, 'utf8')).rollbackComplete, true);
  });
});

test('download transport rejects allowed hostnames on non-standard ports', async () => {
  await assert.rejects(() => requestStream('https://objects.githubusercontent.com:8443/update.zip'), /Untrusted download URL/);
});

test('staged artifact verification rejects symbolic links', async () => {
  await withTemporaryDirectory(async (directory) => {
    const bytes = Buffer.from('signed bytes');
    const target = path.join(directory, 'target.zip');
    const linked = path.join(directory, 'linked.zip');
    await fsp.writeFile(target, bytes);
    await fsp.symlink(target, linked);
    await assert.rejects(() => verifyArtifactFile(linked, { size: bytes.length, sha256: hash(bytes) }), /symbolic link/);
  });
});

test('rollback failure is recorded for guided manual recovery', async () => {
  await withTemporaryDirectory(async (directory) => {
    const fixture = await signedFixture(directory);
    const target = path.join(directory, 'DownToRead.app');
    await createAppBundle(target, 'old-version');
    const plan = installPlan(directory, fixture, target);
    const wrapped = Object.create(fsp);
    wrapped.rm = async (value, options) => {
      if (value === target && options?.recursive) throw new Error('injected rollback removal failure');
      return fsp.rm(value, options);
    };
    let recoveryAlerts = 0;
    await assert.rejects(() => runUpdate(plan, {
      publicKeyPath: fixture.publicKeyPath, _fsp: wrapped, _waitForPidExit: async () => {},
      _extractArchive: async (_archive, staging) => { await createAppBundle(path.join(staging, 'DownToRead.app'), 'new-version'); },
      _validateMachO: () => true, _launchExecutable: () => 999999, _waitForHealth: async () => false,
      _kill: () => { throw Object.assign(new Error('gone'), { code: 'ESRCH' }); },
      _platform: 'darwin', _showRecoveryAlert: async () => { recoveryAlerts += 1; },
    }), /startup/);
    const result = JSON.parse(await fsp.readFile(plan.resultPath, 'utf8'));
    assert.equal(result.success, false);
    assert.equal(result.rollbackComplete, false);
    assert.equal(result.verifiedArchive, fixture.artifactPath);
    assert.equal(recoveryAlerts, 1);
  });
});

test('successful helper result is consumed silently and removed', async () => {
  await withTemporaryDirectory(async (directory) => {
    const resultPath = path.join(directory, 'mac-updates', 'mac-update-result.json');
    await fsp.mkdir(path.dirname(resultPath), { recursive: true });
    await fsp.writeFile(resultPath, JSON.stringify({ success: true, version: '0.1.12' }));
    let dialogs = 0;
    await consumeResult({ getPath: () => directory }, { showMessageBox: async () => { dialogs += 1; } }, null);
    assert.equal(dialogs, 0);
    await assert.rejects(() => fsp.access(resultPath));
  });
});

test('rolled-back result offers the verified ZIP with a warning', async () => {
  await withTemporaryDirectory(async (directory) => {
    const archive = path.join(directory, 'verified.zip');
    const resultPath = path.join(directory, 'mac-updates', 'mac-update-result.json');
    await fsp.mkdir(path.dirname(resultPath), { recursive: true });
    await fsp.writeFile(resultPath, JSON.stringify({ success: false, rollbackComplete: true, error: 'failed', verifiedArchive: archive }));
    let options;
    let revealed;
    await consumeResult({ getPath: () => directory }, { showMessageBox: async (value) => { options = value; return { response: 0 }; } }, { showItemInFolder: (value) => { revealed = value; } });
    assert.equal(options.type, 'warning');
    assert.deepEqual(options.buttons, ['Show Verified ZIP', 'OK']);
    assert.equal(revealed, archive);
  });
});

test('incomplete rollback result displays manual recovery as an error', async () => {
  await withTemporaryDirectory(async (directory) => {
    const resultPath = path.join(directory, 'mac-updates', 'mac-update-result.json');
    await fsp.mkdir(path.dirname(resultPath), { recursive: true });
    await fsp.writeFile(resultPath, JSON.stringify({ success: false, rollbackComplete: false, error: 'restore failed' }));
    let options;
    await consumeResult({ getPath: () => directory }, { showMessageBox: async (value) => { options = value; return { response: 0 }; } }, null);
    assert.equal(options.type, 'error');
    assert.match(options.message, /could not be restored/);
  });
});
