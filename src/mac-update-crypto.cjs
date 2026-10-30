'use strict';
const crypto = require('node:crypto');
const fs = require('node:fs');

const SIGNATURE_BYTES = 64;

function decodeSignature(text) {
  if (typeof text !== 'string' || !/^[A-Za-z0-9_-]{86}$/.test(text)) throw new Error('Invalid update signature encoding');
  const signature = Buffer.from(text, 'base64url');
  if (signature.length !== SIGNATURE_BYTES || signature.toString('base64url') !== text) throw new Error('Invalid update signature length');
  return signature;
}

function verifyManifest(manifestBytes, signatureText, publicKeyPath) {
  try {
    if (!Buffer.isBuffer(manifestBytes) || manifestBytes.length === 0) return false;
    const key = crypto.createPublicKey(fs.readFileSync(publicKeyPath));
    return crypto.verify(null, manifestBytes, key, decodeSignature(signatureText));
  } catch {
    return false;
  }
}

function sha256File(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const input = fs.createReadStream(filePath);
    input.on('data', (chunk) => hash.update(chunk));
    input.on('end', () => resolve(hash.digest('hex')));
    input.on('error', reject);
  });
}

function equalHex(left, right) {
  if (typeof left !== 'string' || typeof right !== 'string' || !/^[0-9a-f]{64}$/.test(left) || !/^[0-9a-f]{64}$/.test(right)) return false;
  return crypto.timingSafeEqual(Buffer.from(left, 'hex'), Buffer.from(right, 'hex'));
}

module.exports = { decodeSignature, equalHex, sha256File, verifyManifest };
