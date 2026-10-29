const fs = require('node:fs/promises');
const path = require('node:path');

function githubSlug(remoteUrl) {
  if (typeof remoteUrl !== 'string') return null;
  const match = /^(?:git@github\.com:|https:\/\/github\.com\/|ssh:\/\/git@github\.com\/)([^/\s]+\/[^/\s]+?)(?:\.git)?$/.exec(remoteUrl.trim());
  return match ? match[1] : null;
}

function originUrl(config) {
  const section = /\[remote\s+"origin"\]([\s\S]*?)(?=\n\[|$)/i.exec(config)?.[1];
  return /^\s*url\s*=\s*(.+?)\s*$/im.exec(section || '')?.[1] || null;
}

async function discoverRepository(documentPath) {
  let directory = path.dirname(path.resolve(documentPath));
  while (true) {
    const dotGit = path.join(directory, '.git');
    try {
      const stat = await fs.stat(dotGit);
      if (stat.isDirectory()) {
        const config = await fs.readFile(path.join(dotGit, 'config'), 'utf8').catch(() => '');
        return { root: directory, slug: githubSlug(originUrl(config)) };
      }
      if (stat.isFile()) {
        const marker = await fs.readFile(dotGit, 'utf8').catch(() => '');
        const gitdir = /^gitdir:\s*(.+?)\s*$/im.exec(marker)?.[1];
        if (gitdir) {
          const worktreeGit = path.resolve(directory, gitdir);
          const commonMarker = await fs.readFile(path.join(worktreeGit, 'commondir'), 'utf8').catch(() => '');
          const commonGit = commonMarker.trim() ? path.resolve(worktreeGit, commonMarker.trim()) : worktreeGit;
          const config = await fs.readFile(path.join(commonGit, 'config'), 'utf8').catch(() => '');
          return { root: directory, slug: githubSlug(originUrl(config)) };
        }
      }
    } catch {}
    const parent = path.dirname(directory);
    if (parent === directory) return null;
    directory = parent;
  }
}

module.exports = { discoverRepository, githubSlug };
