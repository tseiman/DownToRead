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

function resolveDocumentLink(documentPath, input, repositoryRoot = null, repositorySlug = null) {
  if (!isMarkdownPath(documentPath) || typeof input !== 'string') return null;
  try {
    let decodedPath;
    let fragment = '';
    if (/^https?:/i.test(input)) {
      if (typeof repositoryRoot !== 'string' || typeof repositorySlug !== 'string') return null;
      const url = new URL(input);
      const segments = url.pathname.split('/').filter(Boolean).map(decodeURIComponent);
      const linkedSlug = segments.slice(0, 2).join('/');
      if (url.protocol !== 'https:' || url.hostname.toLowerCase() !== 'github.com' || linkedSlug.toLowerCase() !== repositorySlug.toLowerCase() || segments[2] !== 'blob' || segments.length < 5) return null;
      decodedPath = `/${segments.slice(4).join('/')}`;
      fragment = decodeURIComponent(url.hash.slice(1));
    } else {
      if (/^[a-z][a-z0-9+.-]*:/i.test(input) || input.startsWith('#')) return null;
      const parts = input.split('#', 2);
      decodedPath = decodeURIComponent(parts[0].split('?', 1)[0]);
      fragment = decodeURIComponent(parts[1] || '');
    }
    let target;
    if (decodedPath.startsWith('/')) {
      if (typeof repositoryRoot !== 'string') return null;
      target = path.resolve(repositoryRoot, `.${decodedPath}`);
      const relative = path.relative(path.resolve(repositoryRoot), target);
      if (relative.startsWith('..') || path.isAbsolute(relative)) return null;
    } else {
      target = path.resolve(path.dirname(documentPath), decodedPath);
    }
    if (typeof repositoryRoot === 'string') {
      const relative = path.relative(path.resolve(repositoryRoot), target);
      if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) return null;
    }
    return isMarkdownPath(target) ? { path: path.normalize(target), fragment } : null;
  } catch { return null; }
}

module.exports = { IMAGE_EXTENSIONS, MARKDOWN_EXTENSIONS, isAllowedImagePath, isMarkdownPath, parseLaunchPaths, resolveDocumentAsset, resolveDocumentLink };
