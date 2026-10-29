const path = require('node:path');
const { fileURLToPath } = require('node:url');

const MARKDOWN_EXTENSIONS = new Set(['.md', '.markdown']);
const IMAGE_EXTENSIONS = new Set(['.svg', '.png', '.jpg', '.jpeg', '.webp', '.gif']);
const TEXT_EXTENSIONS = new Set([
  '.txt', '.text', '.log', '.csv', '.tsv', '.json', '.jsonl', '.xml', '.yaml', '.yml', '.toml',
  '.ini', '.cfg', '.conf', '.properties', '.env', '.exp', '.st', '.scl', '.il', '.ld', '.html', '.htm',
  '.css', '.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx', '.py', '.rb', '.php', '.pl', '.pm', '.java',
  '.kt', '.kts', '.c', '.h', '.cc', '.cpp', '.cxx', '.hpp', '.hh', '.cs', '.go', '.rs', '.swift',
  '.sql', '.graphql', '.gql', '.proto', '.diff', '.patch', '.rst', '.adoc', '.tex', '.sh', '.bash',
  '.zsh', '.fish', '.command', '.bat', '.cmd', '.ps1', '.psm1', '.vbs', '.vbe', '.jse', '.wsf',
  '.wsh', '.desktop'
]);
const EXECUTABLE_EXTENSIONS = new Set([
  '.exe', '.com', '.msi', '.msp', '.scr', '.pif', '.cpl', '.hta', '.reg', '.lnk', '.url',
  '.app', '.appimage', '.run', '.bin', '.deb', '.rpm', '.pkg', '.dmg', '.jar', '.jnlp', '.class',
  '.apk', '.ipa', '.dll', '.sys', '.drv', '.ocx', '.so', '.dylib', '.wasm', '.workflow', '.action'
]);

function hasExtension(filePath, extensions) {
  return typeof filePath === 'string' && extensions.has(path.extname(filePath).toLowerCase());
}

function isMarkdownPath(filePath) { return hasExtension(filePath, MARKDOWN_EXTENSIONS); }
function isAllowedImagePath(filePath) { return hasExtension(filePath, IMAGE_EXTENSIONS); }

function classifyLocalPath(filePath) {
  if (isMarkdownPath(filePath)) return 'markdown';
  if (isAllowedImagePath(filePath)) return 'image';
  if (hasExtension(filePath, TEXT_EXTENSIONS)) return 'text';
  if (hasExtension(filePath, EXECUTABLE_EXTENSIONS)) return 'executable';
  return 'unknown';
}

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
  if (typeof documentPath !== 'string' || typeof input !== 'string') return null;
  try {
    const scheme = /^[a-z][a-z0-9+.-]*:/i.exec(input)?.[0].toLowerCase();
    if (scheme && scheme !== 'file:') return null;
    const assetPath = scheme === 'file:'
      ? fileURLToPath(new URL(input))
      : path.resolve(path.dirname(documentPath), decodeURIComponent(input.split(/[?#]/, 1)[0]));
    return isAllowedImagePath(assetPath) ? path.normalize(assetPath) : null;
  } catch { return null; }
}

function resolveLocalFileLink(documentPath, input, repositoryRoot = null, repositorySlug = null) {
  if (typeof documentPath !== 'string' || typeof input !== 'string' || !input || input.startsWith('#')) return null;
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
    } else if (/^file:/i.test(input)) {
      const url = new URL(input);
      decodedPath = fileURLToPath(url);
      fragment = decodeURIComponent(url.hash.slice(1));
    } else {
      if (/^[a-z][a-z0-9+.-]*:/i.test(input)) return null;
      const parts = input.split('#', 2);
      decodedPath = decodeURIComponent(parts[0].split('?', 1)[0]);
      fragment = decodeURIComponent(parts[1] || '');
    }

    let target;
    if (path.isAbsolute(decodedPath) && /^file:/i.test(input)) {
      target = path.resolve(decodedPath);
    } else if (decodedPath.startsWith('/')) {
      if (typeof repositoryRoot !== 'string') return null;
      target = path.resolve(repositoryRoot, `.${decodedPath}`);
    } else {
      target = path.resolve(path.dirname(documentPath), decodedPath);
    }

    return { path: path.normalize(target), fragment, kind: classifyLocalPath(target) };
  } catch { return null; }
}

function resolveDocumentLink(documentPath, input, repositoryRoot = null, repositorySlug = null) {
  const target = resolveLocalFileLink(documentPath, input, repositoryRoot, repositorySlug);
  return target?.kind === 'markdown' ? { path: target.path, fragment: target.fragment } : null;
}

module.exports = {
  EXECUTABLE_EXTENSIONS,
  IMAGE_EXTENSIONS,
  MARKDOWN_EXTENSIONS,
  TEXT_EXTENSIONS,
  classifyLocalPath,
  isAllowedImagePath,
  isMarkdownPath,
  parseLaunchPaths,
  resolveDocumentAsset,
  resolveDocumentLink,
  resolveLocalFileLink
};
