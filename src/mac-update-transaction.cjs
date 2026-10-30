'use strict';
const crypto = require('node:crypto');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const https = require('node:https');
const path = require('node:path');
const { Transform } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const { equalHex, sha256File, verifyManifest } = require('./mac-update-crypto.cjs');

const OWNER = 'tseiman';
const REPO = 'DownToRead';
const SCHEMA = 'downtoread-mac-update-v1';
const MAX_MANIFEST_BYTES = 64 * 1024;
const MAX_SIGNATURE_BYTES = 1024;
const MAX_ARTIFACT_BYTES = 512 * 1024 * 1024;
const MAX_REDIRECTS = 5;
const DOWNLOAD_HOSTS = new Set(['github.com', 'objects.githubusercontent.com', 'release-assets.githubusercontent.com']);
const MANIFEST_KEYS = ['artifacts', 'schema', 'tag', 'version'];
const ARTIFACT_KEYS = ['name', 'sha256', 'size', 'url'];

function exactKeys(value, expected) {
  return value && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).sort().join('\0') === [...expected].sort().join('\0');
}

function parseVersion(value) {
  if (typeof value !== 'string' || !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(value)) throw new Error(`Invalid version: ${String(value)}`);
  return value.split('.').map((part) => Number(part));
}

function isNewerVersion(candidate, current) {
  const left = parseVersion(candidate);
  const right = parseVersion(current);
  for (let index = 0; index < 3; index += 1) {
    if (left[index] !== right[index]) return left[index] > right[index];
  }
  return false;
}

function expectedArtifactName(version, arch) {
  return arch === 'arm64' ? `DownToRead-${version}-arm64-mac.zip` : `DownToRead-${version}-mac.zip`;
}

function validateArtifact(artifact, manifest, arch) {
  if (!exactKeys(artifact, ARTIFACT_KEYS)) throw new Error(`Invalid ${arch} artifact fields`);
  const expectedName = expectedArtifactName(manifest.version, arch);
  if (artifact.name !== expectedName) throw new Error(`Unexpected ${arch} artifact name`);
  if (!Number.isSafeInteger(artifact.size) || artifact.size <= 0 || artifact.size > MAX_ARTIFACT_BYTES) throw new Error(`Invalid ${arch} artifact size`);
  if (typeof artifact.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(artifact.sha256)) throw new Error(`Invalid ${arch} artifact SHA-256`);
  let url;
  try { url = new URL(artifact.url); } catch { throw new Error(`Invalid ${arch} artifact URL`); }
  if (url.protocol !== 'https:' || url.hostname !== 'github.com' || url.port || url.username || url.password || url.search || url.hash) throw new Error(`Untrusted ${arch} artifact origin`);
  const expectedPath = `/${OWNER}/${REPO}/releases/download/${manifest.tag}/${expectedName}`;
  if (url.pathname !== expectedPath) throw new Error(`Unexpected ${arch} artifact URL path`);
}

function validateManifest(manifest, currentVersion, selectedArch) {
  if (!exactKeys(manifest, MANIFEST_KEYS)) throw new Error('Invalid update manifest fields');
  if (manifest.schema !== SCHEMA) throw new Error('Unsupported update manifest schema');
  parseVersion(manifest.version);
  parseVersion(currentVersion);
  if (manifest.tag !== `v${manifest.version}`) throw new Error('Update tag does not match its version');
  if (!exactKeys(manifest.artifacts, ['arm64', 'x64'])) throw new Error('Update manifest must contain x64 and arm64 artifacts');
  validateArtifact(manifest.artifacts.x64, manifest, 'x64');
  validateArtifact(manifest.artifacts.arm64, manifest, 'arm64');
  if (!['x64', 'arm64'].includes(selectedArch)) throw new Error(`Unsupported architecture: ${selectedArch}`);
  if (!isNewerVersion(manifest.version, currentVersion)) throw new Error(`No upgrade available: ${manifest.version} <= ${currentVersion}`);
  return manifest.artifacts[selectedArch];
}

function isAllowedDownloadHost(hostname) { return DOWNLOAD_HOSTS.has(hostname); }

function requestStream(url, redirectsLeft = MAX_REDIRECTS) {
  return new Promise((resolve, reject) => {
    let parsed;
    try { parsed = new URL(url); } catch { reject(new Error('Invalid download URL')); return; }
    if (parsed.protocol !== 'https:' || !isAllowedDownloadHost(parsed.hostname) || parsed.port || parsed.username || parsed.password) {
      reject(new Error('Untrusted download URL'));
      return;
    }
    const request = https.get(parsed, { timeout: 120000, headers: { 'User-Agent': 'DownToRead-Updater' } }, (response) => {
      const status = response.statusCode || 0;
      if (status >= 300 && status < 400 && response.headers.location) {
        response.resume();
        if (redirectsLeft <= 0) { reject(new Error('Too many update redirects')); return; }
        let redirected;
        try { redirected = new URL(response.headers.location, parsed).href; } catch { reject(new Error('Invalid update redirect')); return; }
        requestStream(redirected, redirectsLeft - 1).then(resolve, reject);
        return;
      }
      if (status !== 200) { response.resume(); reject(new Error(`Update server returned HTTP ${status}`)); return; }
      resolve(response);
    });
    request.on('timeout', () => request.destroy(new Error('Update request timed out')));
    request.on('error', reject);
  });
}

async function getSmall(url, maxBytes, _requestStream = requestStream) {
  const response = await _requestStream(url);
  const chunks = [];
  let total = 0;
  for await (const chunk of response) {
    total += chunk.length;
    if (total > maxBytes) { response.destroy(); throw new Error('Update metadata is too large'); }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

async function fetchManifest({ currentVersion, arch, publicKeyPath, _getSmall = getSmall }) {
  const base = `https://github.com/${OWNER}/${REPO}/releases/latest/download`;
  const [manifestBytes, signatureBytes] = await Promise.all([
    _getSmall(`${base}/mac-update-v1.json`, MAX_MANIFEST_BYTES),
    _getSmall(`${base}/mac-update-v1.sig`, MAX_SIGNATURE_BYTES),
  ]);
  const signature = signatureBytes.toString('ascii').trim();
  if (!verifyManifest(manifestBytes, signature, publicKeyPath)) throw new Error('The update manifest has an invalid signature');
  let manifest;
  try { manifest = JSON.parse(manifestBytes.toString('utf8')); } catch { throw new Error('The signed update manifest is not valid JSON'); }
  const artifact = validateManifest(manifest, currentVersion, arch);
  return { artifact, manifest, manifestBytes, signature };
}

async function downloadAndVerify(artifact, destination, { _requestStream = requestStream } = {}) {
  await fsp.mkdir(path.dirname(destination), { recursive: true, mode: 0o700 });
  const temporary = `${destination}.part-${crypto.randomUUID()}`;
  const hash = crypto.createHash('sha256');
  let total = 0;
  const counter = new Transform({
    transform(chunk, _encoding, callback) {
      total += chunk.length;
      if (total > artifact.size) { callback(new Error('Downloaded update exceeds its signed size')); return; }
      hash.update(chunk);
      callback(null, chunk);
    },
  });
  try {
    const response = await _requestStream(artifact.url);
    await pipeline(response, counter, fs.createWriteStream(temporary, { flags: 'wx', mode: 0o600 }));
    const digest = hash.digest('hex');
    if (total !== artifact.size) throw new Error('Downloaded update size does not match the signed manifest');
    if (!equalHex(digest, artifact.sha256)) throw new Error('Downloaded update SHA-256 does not match the signed manifest');
    await fsp.rename(temporary, destination);
    return { sha256: digest, size: total };
  } catch (error) {
    await fsp.rm(temporary, { force: true }).catch(() => {});
    await fsp.rm(destination, { force: true }).catch(() => {});
    throw error;
  }
}

async function verifyArtifactFile(filePath, artifact) {
  const stat = await fsp.lstat(filePath);
  if (stat.isSymbolicLink()) throw new Error('Staged update must not be a symbolic link');
  if (!stat.isFile() || stat.size !== artifact.size) throw new Error('Staged update size does not match the signed manifest');
  const digest = await sha256File(filePath);
  if (!equalHex(digest, artifact.sha256)) throw new Error('Staged update SHA-256 does not match the signed manifest');
  return true;
}

function macAppPathFromExecutable(executablePath) {
  if (typeof executablePath !== 'string' || !path.isAbsolute(executablePath)) return null;
  const candidate = path.resolve(path.dirname(executablePath), '..', '..');
  return candidate.endsWith('.app') ? candidate : null;
}

async function preflightWritability(targetApp, { _fsp = fsp, _realpath = (value) => fsp.realpath(value) } = {}) {
  if (!targetApp || !path.isAbsolute(targetApp) || !targetApp.endsWith('.app')) return { ok: false, reason: 'invalid installation path' };
  try {
    const direct = await _fsp.lstat(targetApp);
    if (direct.isSymbolicLink()) return { ok: false, reason: 'the installed app path is a symbolic link' };
    if (!direct.isDirectory()) return { ok: false, reason: 'the installation is not an app bundle' };
    const real = await _realpath(targetApp);
    if (real.includes('/AppTranslocation/')) return { ok: false, reason: 'the app is running from macOS App Translocation' };
  } catch { return { ok: false, reason: 'the installed app cannot be inspected' }; }
  const parent = path.dirname(targetApp);
  const probe = path.join(parent, `.downtoread-write-test-${crypto.randomUUID()}`);
  try {
    const handle = await _fsp.open(probe, 'wx', 0o600);
    await handle.close();
    await _fsp.unlink(probe);
    return { ok: true };
  } catch {
    await _fsp.rm(probe, { force: true }).catch(() => {});
    return { ok: false, reason: 'the installation folder is not writable' };
  }
}

module.exports = {
  MAX_ARTIFACT_BYTES, OWNER, REPO, SCHEMA, downloadAndVerify, expectedArtifactName,
  fetchManifest, getSmall, isAllowedDownloadHost, isNewerVersion, macAppPathFromExecutable,
  parseVersion, preflightWritability, requestStream, validateManifest, verifyArtifactFile,
};
