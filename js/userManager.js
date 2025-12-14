// js/userManager.js
import {
  doc,
  getDoc,
  runTransaction,
  deleteDoc
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

export class UserManager {
  constructor({
    selectEl,
    addBtn,
    renameBtn,
    deleteBtn,
    db,
    storageKeyPrefix = "typing_users_v2"
  }) {
    this.db = db;
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

  /* =========================
     Firestore helpers
  ========================= */
  async _reserveName(name) {
    const ref = doc(this.db, "userNames", name);
    await runTransaction(this.db, async tx => {
      const snap = await tx.get(ref);
      if (snap.exists()) throw new Error("DUPLICATE");
      tx.set(ref, { createdAt: Date.now() });
    });
  }

  async _releaseName(name) {
    const ref = doc(this.db, "userNames", name);
    await deleteDoc(ref);
  }

  async _renameOnServer(oldName, newName) {
    const oldRef = doc(this.db, "userNames", oldName);
    const newRef = doc(this.db, "userNames", newName);

    await runTransaction(this.db, async tx => {
      const snap = await tx.get(newRef);
      if (snap.exists()) throw new Error("DUPLICATE");
      tx.delete(oldRef);
      tx.set(newRef, { createdAt: Date.now() });
    });
  }

  /* =========================
     Local storage
  ========================= */
  _loadUsers() {
    try {
      const raw = localStorage.getItem(this.storageUsersKey);
      const arr = raw ? JSON.parse(raw) : [];
      return Array.isArray(arr)
        ? arr.filter(v => typeof v === "string" && v.trim())
        : [];
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

  /* =========================
     Validation
  ========================= */
  _validateName(name) {
    const n = name.trim();
    if (!n) return "ユーザー名を入力してください。";
    if (n.length > 10) return "ユーザー名は10文字以内にしてください。";
    return null;
  }

  /* =========================
     Actions
  ========================= */
  async addUser() {
    if (this.users.length >= 10) {
      alert("この端末では最大10名まで追加できます。");
      return;
    }

    const name = prompt("追加するユーザー名を入力してください");
    if (!name) return;

    const err = this._validateName(name);
    if (err) {
      alert(err);
      return;
    }

    const n = name.trim();

    try {
      await this._reserveName(n);
    } catch {
      alert("このユーザー名は既に使われています。");
      return;
    }

    this.users.push(n);
    this._saveUsers();
    this.setCurrentUserName(n);
  }

  async renameUser() {
    const cur = this.current;
    if (!cur) return;

    const name = prompt(`ユーザー名を変更します（現在：${cur}）`, cur);
    if (!name) return;

    const err = this._validateName(name);
    if (err) {
      alert(err);
      return;
    }

    const n = name.trim();
    if (n === cur) return;

    try {
      await this._renameOnServer(cur, n);
    } catch {
      alert("このユーザー名は既に使われています。");
      return;
    }

    this.users = this.users.map(u => (u === cur ? n : u));
    this._saveUsers();
    this.setCurrentUserName(n);
  }

  async deleteUser() {
    const cur = this.current;
    if (!cur) return;

    if (this.users.length <= 1) {
      alert("最後の1名は削除できません。");
      return;
    }

    const ok = confirm(`ユーザー「${cur}」を削除しますか？`);
    if (!ok) return;

    await this._releaseName(cur);

    this.users = this.users.filter(u => u !== cur);
    this._saveUsers();
    this.setCurrentUserName(this.users[0]);
  }
}
