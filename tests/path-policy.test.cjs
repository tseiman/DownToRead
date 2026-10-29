const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { discoverRepository } = require('../src/repository-context.cjs');
const { isMarkdownPath, isAllowedImagePath, parseLaunchPaths, resolveDocumentAsset, resolveDocumentLink } = require('../src/path-policy.cjs');

test('accepts Markdown extensions case-insensitively and rejects other files', () => {
  assert.equal(isMarkdownPath('/tmp/readme.MD'), true);
  assert.equal(isMarkdownPath('/tmp/readme.markdown'), true);
  assert.equal(isMarkdownPath('/tmp/readme.html'), false);
});

test('allows only supported local image extensions', () => {
  for (const name of ['a.svg', 'a.PNG', 'a.jpeg', 'a.webp', 'a.gif']) assert.equal(isAllowedImagePath(name), true);
  assert.equal(isAllowedImagePath('a.html'), false);
});

test('launch parsing ignores switches, duplicates, and non-Markdown paths', () => {
  assert.deepEqual(parseLaunchPaths(['electron', '--inspect=1', 'a.md', 'a.md', 'b.txt', 'c.markdown']), [path.resolve('a.md'), path.resolve('c.markdown')]);
});

test('asset resolution decodes file URLs and rejects unsupported or malformed assets', () => {
  const doc = path.resolve('/tmp/docs/readme.md');
  const absoluteImage = path.resolve('/tmp/picture.svg');
  assert.equal(resolveDocumentAsset(doc, './img/picture.png'), path.resolve('/tmp/docs/img/picture.png'));
  assert.equal(resolveDocumentAsset(doc, pathToFileURL(absoluteImage).href), absoluteImage);
  assert.equal(resolveDocumentAsset(doc, 'https://example.com/x.png'), null);
  assert.equal(resolveDocumentAsset(doc, './page.html'), null);
  assert.equal(resolveDocumentAsset(doc, '%E0%A4%A'), null);
});

test('resolves relative Markdown links against the current document', () => {
  const doc = path.resolve('repository', 'docs', 'readme.md');
  assert.deepEqual(resolveDocumentLink(doc, '../CONTRIBUTING.markdown'), {
    path: path.resolve('repository', 'CONTRIBUTING.markdown'),
    fragment: ''
  });
});

test('resolves repository-root Markdown links inside the detected checkout', () => {
  const repository = path.resolve('repository');
  const doc = path.join(repository, 'docs', 'readme.md');
  assert.deepEqual(resolveDocumentLink(doc, '/guides/setup.md#install', repository), {
    path: path.join(repository, 'guides', 'setup.md'),
    fragment: 'install'
  });
});

test('maps same-repository GitHub blob links to the local checkout', () => {
  const repository = path.resolve('repository');
  const doc = path.join(repository, 'README.md');
  assert.deepEqual(
    resolveDocumentLink(doc, 'https://github.com/example/project/blob/main/docs/setup.md#usage', repository, 'example/project'),
    { path: path.join(repository, 'docs', 'setup.md'), fragment: 'usage' }
  );
  assert.equal(
    resolveDocumentLink(doc, 'https://github.com/other/project/blob/main/docs/setup.md', repository, 'example/project'),
    null
  );
});

test('rejects relative Markdown links that escape a detected checkout', () => {
  const repository = path.resolve('repository');
  const doc = path.join(repository, 'docs', 'readme.md');
  assert.equal(resolveDocumentLink(doc, '../../outside.md', repository), null);
});

test('discovers the checkout root and GitHub slug from .git metadata', async (t) => {
  const root = await fs.mkdtemp(path.join(process.env.TMPDIR || os.tmpdir(), 'downtoread-repo-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.mkdir(path.join(root, '.git'));
  await fs.writeFile(path.join(root, '.git', 'config'), '[remote "origin"]\n\turl = git@github.com:example/project.git\n');
  const document = path.join(root, 'docs', 'guide.md');
  assert.deepEqual(await discoverRepository(document), { root, slug: 'example/project' });
});

test('discovers repository metadata from a linked worktree .git file', async (t) => {
  const base = await fs.mkdtemp(path.join(process.env.TMPDIR || os.tmpdir(), 'downtoread-worktree-'));
  t.after(() => fs.rm(base, { recursive: true, force: true }));
  const root = path.join(base, 'checkout');
  const commonGit = path.join(base, 'main.git');
  const worktreeGit = path.join(commonGit, 'worktrees', 'checkout');
  await fs.mkdir(worktreeGit, { recursive: true });
  await fs.mkdir(root);
  await fs.writeFile(path.join(root, '.git'), `gitdir: ${worktreeGit}\n`);
  await fs.writeFile(path.join(worktreeGit, 'commondir'), '../..\n');
  await fs.writeFile(path.join(commonGit, 'config'), '[remote "origin"]\n\turl = https://github.com/example/worktree.git\n');
  assert.deepEqual(await discoverRepository(path.join(root, 'docs', 'guide.md')), {
    root,
    slug: 'example/worktree'
  });
});
