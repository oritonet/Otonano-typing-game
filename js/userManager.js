// js/userManager.js
export class UserManager {
  constructor({ selectEl, addBtn, renameBtn, deleteBtn, storageKeyPrefix = "typing_users_v1" }) {
    this.selectEl = selectEl;
    this.addBtn = addBtn;
    this.renameBtn = renameBtn;
    this.deleteBtn = deleteBtn;
    this.storageUsersKey = `${storageKeyPrefix}__users`;
    this.storageLastKey = `${storageKeyPrefix}__last`;

    this.users = this._loadUsers();
    if (this.users.length === 0) {
      this.users = ["ゲスト"];
      this._saveUsers();
    }

    const last = localStorage.getItem(this.storageLastKey);
    this.current = (last && this.users.includes(last)) ? last : this.users[0];
    this._render();

    this.selectEl.addEventListener("change", () => {
      this.current = this.selectEl.value;
      localStorage.setItem(this.storageLastKey, this.current);
      this._render();
      this.onChange?.(this.current);
    });

    this.addBtn.addEventListener("click", () => this.addUser());
    this.renameBtn.addEventListener("click", () => this.renameUser());
    this.deleteBtn.addEventListener("click", () => this.deleteUser());
  }

  _loadUsers() {
    try {
      const raw = localStorage.getItem(this.storageUsersKey);
      const arr = raw ? JSON.parse(raw) : [];
      return Array.isArray(arr) ? arr.filter(s => typeof s === "string" && s.trim()) : [];
    } catch {
      return [];
    }
  }

  _saveUsers() {
    localStorage.setItem(this.storageUsersKey, JSON.stringify(this.users));
  }

  _render() {
    this.selectEl.innerHTML = "";
    for (const u of this.users) {
      const opt = document.createElement("option");
      opt.value = u;
      opt.textContent = u;
      this.selectEl.appendChild(opt);
    }
    this.selectEl.value = this.current;
  }

  getCurrentUserName() {
    return this.current;
  }

  setCurrentUserName(name) {
    if (!this.users.includes(name)) return;
    this.current = name;
    localStorage.setItem(this.storageLastKey, this.current);
    this._render();
    this.onChange?.(this.current);
  }

  addUser() {
    if (this.users.length >= 10) {
      alert("この端末では最大10名まで追加できます。");
      return;
    }
    const name = prompt("追加するユーザー名を入力してください（例：太郎）");
    if (!name) return;
    const n = name.trim();
    if (!n) return;
    if (this.users.includes(n)) {
      alert("同名ユーザーが既に存在します。");
      return;
    }
    this.users.push(n);
    this._saveUsers();
    this.setCurrentUserName(n);
  }

  renameUser() {
    const cur = this.current;
    if (!cur) return;
    const name = prompt(`ユーザー名を変更します（現在：${cur}）`, cur);
    if (!name) return;
    const n = name.trim();
    if (!n) return;
    if (n === cur) return;
    if (this.users.includes(n)) {
      alert("同名ユーザーが既に存在します。");
      return;
    }
    this.users = this.users.map(u => (u === cur ? n : u));
    this._saveUsers();
    this.setCurrentUserName(n);
  }

  deleteUser() {
    const cur = this.current;
    if (!cur) return;
    if (this.users.length <= 1) {
      alert("最後の1名は削除できません。");
      return;
    }
    const ok = confirm(`ユーザー「${cur}」を削除しますか？（この端末の選択リストから削除されます）`);
    if (!ok) return;
    this.users = this.users.filter(u => u !== cur);
    this._saveUsers();
    const next = this.users[0];
    this.setCurrentUserName(next);
  }
}
