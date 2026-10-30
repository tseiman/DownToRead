const test = require('node:test');
const assert = require('node:assert/strict');
const { NavigationHistory } = require('../src/navigation-history.cjs');

test('navigation history supports back, forward, and session start', () => {
  const history = new NavigationHistory();
  history.push('/repo/README.md', '');
  history.push('/repo/image.svg', '');
  history.push('/repo/notes.txt', 'section');

  assert.deepEqual(history.state(), { canBack: true, canHome: true, canForward: false });
  assert.deepEqual(history.move('back'), { path: '/repo/image.svg', fragment: '' });
  assert.deepEqual(history.move('home'), { path: '/repo/README.md', fragment: '' });
  assert.deepEqual(history.move('forward'), { path: '/repo/image.svg', fragment: '' });
  assert.deepEqual(history.state(), { canBack: true, canHome: true, canForward: true });
});

test('opening a new file after going back discards forward history', () => {
  const history = new NavigationHistory();
  history.push('/repo/one.md', '');
  history.push('/repo/two.md', '');
  history.move('back');
  history.push('/repo/three.md', '');

  assert.deepEqual(history.entries(), [
    { path: '/repo/one.md', fragment: '' },
    { path: '/repo/three.md', fragment: '' }
  ]);
  assert.deepEqual(history.state(), { canBack: true, canHome: true, canForward: false });
  assert.equal(history.move('forward'), null);
});

test('restore rolls back a traversal and rejects invalid positions', () => {
  const empty = new NavigationHistory();
  assert.equal(empty.current(), null);
  for (const action of ['back', 'home', 'forward']) assert.equal(empty.move(action), null);

  const history = new NavigationHistory();
  history.push('/repo/one.md', '');
  history.push('/repo/two.md', '');
  const previousIndex = history.position();
  history.move('back');
  history.restore(previousIndex);
  assert.deepEqual(history.current(), { path: '/repo/two.md', fragment: '' });
  history.restore(99);
  assert.deepEqual(history.current(), { path: '/repo/two.md', fragment: '' });
});
