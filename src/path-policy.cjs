const path = require('node:path');
const { fileURLToPath } = require('node:url');

const MARKDOWN_EXTENSIONS = new Set(['.md', '.markdown']);
const IMAGE_EXTENSIONS = new Set(['.svg', '.png', '.jpg', '.jpeg', '.webp', '.gif']);

function hasExtension(filePath, extensions) {
  return typeof filePath === 'string' && extensions.has(path.extname(filePath).toLowerCase());
}

function isMarkdownPath(filePath) { return hasExtension(filePath, MARKDOWN_EXTENSIONS); }
function isAllowedImagePath(filePath) { return hasExtension(filePath, IMAGE_EXTENSIONS); }

function parseLaunchPaths(argv) {
  const seen = new Set();
  const output = [];
  for (const value of argv) {
    if (typeof value !== 'string' || value.startsWith('-') || !isMarkdownPath(value)) continue;
    const absolute = path.resolve(value);
    if (!seen.has(absolute)) { seen.add(absolute); output.push(absolute); }
  }
  return output;
}

function resolveDocumentAsset(documentPath, input) {
  if (!isMarkdownPath(documentPath) || typeof input !== 'string') return null;
  try {
    const scheme = /^[a-z][a-z0-9+.-]*:/i.exec(input)?.[0].toLowerCase();
    if (scheme && scheme !== 'file:') return null;
    const assetPath = scheme === 'file:'
      ? fileURLToPath(new URL(input))
      : path.resolve(path.dirname(documentPath), decodeURIComponent(input.split(/[?#]/, 1)[0]));
    return isAllowedImagePath(assetPath) ? path.normalize(assetPath) : null;
  } catch { return null; }
}

module.exports = { IMAGE_EXTENSIONS, MARKDOWN_EXTENSIONS, isAllowedImagePath, isMarkdownPath, parseLaunchPaths, resolveDocumentAsset };
