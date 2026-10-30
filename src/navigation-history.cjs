class NavigationHistory {
  constructor() {
    this._entries = [];
    this._index = -1;
  }

  push(filePath, fragment = '') {
    const entry = { path: filePath, fragment };
    this._entries.splice(this._index + 1);
    this._entries.push(entry);
    this._index = this._entries.length - 1;
    return { ...entry };
  }

  move(action) {
    let target = this._index;
    if (action === 'back' && this._index > 0) target -= 1;
    else if (action === 'forward' && this._index + 1 < this._entries.length) target += 1;
    else if (action === 'home' && this._entries.length && this._index !== 0) target = 0;
    else return null;
    this._index = target;
    return { ...this._entries[this._index] };
  }

  restore(index) {
    if (Number.isInteger(index) && index >= 0 && index < this._entries.length) this._index = index;
  }

  position() { return this._index; }
  current() { return this._index >= 0 ? { ...this._entries[this._index] } : null; }
  entries() { return this._entries.map((entry) => ({ ...entry })); }
  state() {
    return {
      canBack: this._index > 0,
      canHome: this._index > 0,
      canForward: this._index >= 0 && this._index + 1 < this._entries.length
    };
  }
}

module.exports = { NavigationHistory };
