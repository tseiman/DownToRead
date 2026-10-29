const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');

test('original icon source contains folded document, Markdown and eye motifs', () => {
  const svg = fs.readFileSync(path.join(root, 'assets/icon.svg'), 'utf8');
  assert.match(svg, /<svg/); assert.match(svg, /fold/i); assert.match(svg, /eye/i); assert.match(svg, />M</);
});

test('committed PNG icons have their declared square dimensions and ICO has entries', () => {
  for (const size of [16, 32, 48, 64, 128, 256, 512, 1024]) {
    const data = fs.readFileSync(path.join(root, `build/icons/${size}x${size}.png`));
    assert.equal(data.toString('ascii', 1, 4), 'PNG');
    assert.equal(data.readUInt32BE(16), size); assert.equal(data.readUInt32BE(20), size);
  }
  const ico = fs.readFileSync(path.join(root, 'build/icon.ico'));
  assert.equal(ico.readUInt16LE(0), 0); assert.equal(ico.readUInt16LE(2), 1); assert.ok(ico.readUInt16LE(4) >= 4);
});

test('package and release workflow cover every requested platform and artifact', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json')));
  assert.equal(pkg.build.appId, 'de.tseiman.downtoread');
  assert.deepEqual(pkg.build.linux.target, ['AppImage', 'deb']);
  assert.match(pkg.build.linux.maintainer, /@/);
  assert.deepEqual(pkg.build.mac.target, ['dmg', 'zip']);
  assert.deepEqual(pkg.build.win.target, ['nsis']);
  assert.equal(pkg.build.nsis.artifactName, '${productName}-Setup-${version}.${ext}');
  assert.deepEqual(pkg.build.fileAssociations.map((x) => x.ext), ['md', 'markdown']);
  const workflow = fs.readFileSync(path.join(root, '.github/workflows/release.yml'), 'utf8');
  for (const text of ['windows-latest','macos-latest','ubuntu-latest','workflow_dispatch','tags:','CSC_LINK','latest-linux.yml','actions/checkout@v7','actions/setup-node@v7','actions/upload-artifact@v7','actions/download-artifact@v7','softprops/action-gh-release@v2','CSC_IDENTITY_AUTO_DISCOVERY','--publish never','needs: build','merge-multiple: true']) assert.match(workflow, new RegExp(text));
  assert.doesNotMatch(workflow, /--publish always/);
  assert.doesNotMatch(workflow, /latest\*\.yaml/);
  const releaseJobPattern = /release:\r?\n\s+if: startsWith\(github\.ref, 'refs\/tags\/'\)\r?\n\s+needs: build\r?\n\s+permissions:\r?\n\s+contents: write/;
  const permissionFloorPattern = /^permissions:\r?\n  contents: read/m;
  for (const source of [workflow, workflow.replace(/\r?\n/g, '\r\n')]) {
    assert.match(source, releaseJobPattern);
    assert.match(source, permissionFloorPattern);
  }
  assert.match(workflow, /secrets\.MAC_CERTIFICATE\s*!=\s*''/);
  assert.match(workflow, /env\.HAS_MAC_CERTIFICATE\s*!=\s*'true'/);
  assert.match(workflow, /env\.HAS_MAC_CERTIFICATE\s*==\s*'true'/);
});
