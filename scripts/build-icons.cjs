const fs = require('node:fs/promises');
const path = require('node:path');
const sharp = require('sharp');
const pngToIcoModule = require('png-to-ico');
const pngToIco = pngToIcoModule.default || pngToIcoModule;
const png2icons = require('png2icons');
const root = path.resolve(__dirname, '..');
const sizes = [16, 32, 48, 64, 128, 256, 512, 1024];
(async () => {
  const source = path.join(root, 'assets/icon.svg');
  const directory = path.join(root, 'build/icons');
  await fs.mkdir(directory, { recursive: true });
  const pngs = [];
  for (const size of sizes) {
    const target = path.join(directory, `${size}x${size}.png`);
    await sharp(source, { density: 384 }).resize(size, size).png().toFile(target);
    if ([16, 32, 48, 64, 128, 256].includes(size)) pngs.push(target);
  }
  await fs.copyFile(path.join(directory, '512x512.png'), path.join(root, 'build/icon.png'));
  await fs.writeFile(path.join(root, 'build/icon.ico'), await pngToIco(pngs));
  const icon1024 = await fs.readFile(path.join(directory, '1024x1024.png'));
  const icns = png2icons.createICNS(icon1024, png2icons.BILINEAR, 0);
  if (!icns) throw new Error('ICNS generation failed');
  await fs.writeFile(path.join(root, 'build/icon.icns'), icns);
})().catch((error) => { console.error(error); process.exitCode = 1; });
