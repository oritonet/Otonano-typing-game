export class UserManager {
  constructor({ maxUsers = 10, storagePrefix = "otonano_typing" } = {}) {
    this.maxUsers = maxUsers;
    this.keyUsers = `${storagePrefix}__users`;
    this.keyLast = `${storagePrefix}__last_user`;
    this.users = this._loadUsers();
    this.current = this._loadLast() ?? (this.users[0] ?? null);
    this._listeners = new Set();

    if (this.current && !this.users.includes(this.current)) {
      this.users.unshift(this.current);
      this.users = this.users.slice(0, this.maxUsers);
      this._saveUsers();
    }
    if (this.current) this._saveLast(this.current);
  }

  onChange(cb) {
    this._listeners.add(cb);
    return () => this._listeners.delete(cb);
  }

  _emit() {
    for (const cb of this._listeners) cb(this.getState());
  }

  getState() {
    return { users: [...this.users], current: this.current };
  }

  _loadUsers() {
    try {
      const raw = localStorage.getItem(this.keyUsers);
      const arr = raw ? JSON.parse(raw) : [];
      if (!Array.isArray(arr)) return [];
      return arr.filter(x => typeof x === "string" && x.trim().length > 0).slice(0, this.maxUsers);
    } catch {
      return [];
    }
  }

  _saveUsers() {
    localStorage.setItem(this.keyUsers, JSON.stringify(this.users.slice(0, this.maxUsers)));
  }

  _loadLast() {
    const s = localStorage.getItem(this.keyLast);
    return (s && s.trim().length > 0) ? s : null;
  }

  _saveLast(name) {
    localStorage.setItem(this.keyLast, name);
  }

  setCurrent(name) {
    const n = (name ?? "").trim();
    if (!n) return false;
    if (!this.users.includes(n)) {
      this.users.unshift(n);
      this.users = this.users.slice(0, this.maxUsers);
      this._saveUsers();
    }
    this.current = n;
    this._saveLast(n);
    this._emit();
    return true;
  }

  addUser(name) {
    const n = (name ?? "").trim();
    if (!n) return { ok: false, reason: "empty" };
    if (this.users.includes(n)) {
      this.setCurrent(n);
      return { ok: true, existed: true };
    }
    this.users.unshift(n);
    this.users = this.users.slice(0, this.maxUsers);
    this._saveUsers();
    this.current = n;
    this._saveLast(n);
    this._emit();
    return { ok: true, existed: false };
  }

  renameUser(oldName, newName) {
    const o = (oldName ?? "").trim();
    const n = (newName ?? "").trim();
    if (!o || !n) return { ok: false, reason: "empty" };
    if (!this.users.includes(o)) return { ok: false, reason: "not_found" };
    if (this.users.includes(n)) return { ok: false, reason: "duplicate" };

    this.users = this.users.map(x => (x === o ? n : x));
    this._saveUsers();

    if (this.current === o) {
      this.current = n;
      this._saveLast(n);
    }
    this._emit();
    return { ok: true };
  }

  deleteUser(name) {
    const n = (name ?? "").trim();
    if (!n) return { ok: false, reason: "empty" };
    if (!this.users.includes(n)) return { ok: false, reason: "not_found" };

    this.users = this.users.filter(x => x !== n);
    this._saveUsers();

    if (this.current === n) {
      this.current = this.users[0] ?? null;
      if (this.current) this._saveLast(this.current);
      else localStorage.removeItem(this.keyLast);
    }
    this._emit();
    return { ok: true };
  }
}
