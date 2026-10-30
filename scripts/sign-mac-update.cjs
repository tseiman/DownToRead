#!/usr/bin/env node
'use strict';
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { expectedArtifactName, OWNER, REPO, SCHEMA, parseVersion } = require('../src/mac-update-transaction.cjs');

function parseArgs(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key.startsWith('--') || !value || value.startsWith('--')) throw new Error(`Invalid argument: ${key}`);
    result[key.slice(2)] = value;
    index += 1;
  }
  return result;
}

function sha256FileSync(filePath) {
  const hash = crypto.createHash('sha256');
  const descriptor = fs.openSync(filePath, 'r');
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  try {
    let bytesRead;
    do {
      bytesRead = fs.readSync(descriptor, buffer, 0, buffer.length, null);
      if (bytesRead) hash.update(buffer.subarray(0, bytesRead));
    } while (bytesRead);
  } finally { fs.closeSync(descriptor); }
  return hash.digest('hex');
}

function artifactRecord(assetsDirectory, version, tag, arch) {
  const name = expectedArtifactName(version, arch);
  const filePath = path.join(assetsDirectory, name);
  const stat = fs.statSync(filePath);
  if (!stat.isFile() || stat.size <= 0) throw new Error(`Missing finished ${arch} ZIP: ${name}`);
  return {
    name,
    sha256: sha256FileSync(filePath),
    size: stat.size,
    url: `https://github.com/${OWNER}/${REPO}/releases/download/${tag}/${name}`,
  };
}

function buildManifest(assetsDirectory, tag) {
  if (typeof tag !== 'string' || !/^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(tag)) throw new Error('Tag must be vMAJOR.MINOR.PATCH');
  const version = tag.slice(1);
  parseVersion(version);
  return {
    artifacts: {
      arm64: artifactRecord(assetsDirectory, version, tag, 'arm64'),
      x64: artifactRecord(assetsDirectory, version, tag, 'x64'),
    },
    schema: SCHEMA,
    tag,
    version,
  };
}

function loadMatchingPrivateKey(encoded, publicKeyPath) {
  if (typeof encoded !== 'string' || encoded.length < 40) throw new Error('MAC_UPDATE_PRIVATE_KEY_B64 is not set');
  let privateKey;
  try { privateKey = crypto.createPrivateKey(Buffer.from(encoded, 'base64').toString('utf8')); }
  catch { throw new Error('MAC_UPDATE_PRIVATE_KEY_B64 is not a valid Ed25519 private key'); }
  if (privateKey.asymmetricKeyType !== 'ed25519') throw new Error('The update signing key must be Ed25519');
  const expected = crypto.createPublicKey(fs.readFileSync(publicKeyPath)).export({ type: 'spki', format: 'der' });
  const actual = crypto.createPublicKey(privateKey).export({ type: 'spki', format: 'der' });
  if (expected.length !== actual.length || !crypto.timingSafeEqual(expected, actual)) throw new Error('The private update key does not match the public key embedded in DownToRead');
  return privateKey;
}

function signRelease({ assetsDirectory, outputDirectory, publicKeyPath, tag, privateKeyBase64 }) {
  const privateKey = loadMatchingPrivateKey(privateKeyBase64, publicKeyPath);
  const manifest = buildManifest(assetsDirectory, tag);
  const manifestBytes = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  const signature = crypto.sign(null, manifestBytes, privateKey).toString('base64url');
  const publicKey = crypto.createPublicKey(fs.readFileSync(publicKeyPath));
  if (!crypto.verify(null, manifestBytes, publicKey, Buffer.from(signature, 'base64url'))) throw new Error('Update signature self-check failed');
  fs.mkdirSync(outputDirectory, { recursive: true });
  fs.writeFileSync(path.join(outputDirectory, 'mac-update-v1.json'), manifestBytes, { mode: 0o644 });
  fs.writeFileSync(path.join(outputDirectory, 'mac-update-v1.sig'), `${signature}\n`, { mode: 0o644 });
  return manifest;
}

function main() {
  try {
    const args = parseArgs(process.argv.slice(2));
    if (!args.assets || !args.out || !args.tag) throw new Error('Usage: sign-mac-update.cjs --assets DIR --out DIR --tag vMAJOR.MINOR.PATCH');
    const repositoryRoot = path.resolve(__dirname, '..');
    const manifest = signRelease({
      assetsDirectory: path.resolve(args.assets),
      outputDirectory: path.resolve(args.out),
      publicKeyPath: path.join(repositoryRoot, 'build', 'mac-update-ed25519-public.pem'),
      tag: args.tag,
      privateKeyBase64: process.env.MAC_UPDATE_PRIVATE_KEY_B64,
    });
    process.stdout.write(`Signed macOS update manifest for ${manifest.tag} (${manifest.artifacts.x64.size} x64 bytes, ${manifest.artifacts.arm64.size} arm64 bytes)\n`);
  } catch (error) {
    process.stderr.write(`macOS update signing failed: ${String(error?.message || error).slice(0, 512)}\n`);
    process.exitCode = 1;
  }
}

if (require.main === module) main();
module.exports = { artifactRecord, buildManifest, loadMatchingPrivateKey, parseArgs, sha256FileSync, signRelease };
