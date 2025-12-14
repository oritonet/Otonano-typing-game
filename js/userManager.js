// js/userManager.js
import {
  doc,
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
    storageKeyPrefix = "typing_users_v4"
  }) {
    this.db = db;
    this.selectEl = selectEl;
    this.addBtn = addBtn;
    this.renameBtn = renameBtn;
    this.deleteBtn = deleteBtn;

    this.storageUsersKey = `${storageKeyPrefix}__users`;
    this.storageLastKey = `${storageKeyPrefix}__last`;

    this.users = this._loadUsers();
    this.current = null;

    this._bindEvents();

    // 初期ユーザー生成は async
    this._init();
  }

  /* =========================
     初期化
  ========================= */
  async _init() {
    if (this.users.length === 0) {
      const guest = await this._createInitialGuest();
      this.users = [guest];
      this.current = guest;
      this._saveUsers();
      localStorage.setItem(this.storageLastKey, guest);
    } else {
      const last = localStorage.getItem(this.storageLastKey);
      this.current = (last && this.users.includes(last)) ? last : this.users[0];
    }

    this._render();
    this.onChange?.(this.current);
  }

  _bindEvents() {
    this.selectEl.addEventListener("change", () => {
      this.current = this.selectEl.value;
      localStorage.setItem(this.storageLastKey, this.current);
      this.onChange?.(this.current);
    });

    this.addBtn.addEventListener("click", () => this.addUser());
    this.renameBtn.addEventListener("click", () => this.renameUser());
    this.deleteBtn.addEventListener("click", () => this.deleteUser());
  }

  /* =========================
     正規化・検証
  ========================= */
  _normalize(name) {
    return name
      .trim()
      .normalize("NFKC")
      .toLowerCase();
  }

  _validate(name) {
    const raw = name.trim();
    if (!raw) return "ユーザー名を10字以内で入力してください。";
    if (raw.length > 10) return "ユーザー名は10文字以内にしてください。";
    return null;
  }

  /* =========================
     ゲスト生成
  ========================= */
  _generateGuestName() {
    const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
    let s = "";
    for (let i = 0; i < 7; i++) {
      s += chars[Math.floor(Math.random() * chars.length)];
    }
    return `guest-${s}`;
  }

  async _createInitialGuest() {
    for (;;) {
      const name = this._generateGuestName();
      try {
        await this._reserve(name);
        return name;
      } catch {
        // 衝突したら再生成（理論上ほぼ起きない）
      }
    }
  }

  /* =========================
     Firestore 一意予約
  ========================= */
  async _reserve(rawName) {
    const key = this._normalize(rawName);
    const ref = doc(this.db, "userNames", key);

    await runTransaction(this.db, async tx => {
      const snap = await tx.get(ref);
      if (snap.exists()) {
        throw new Error("DUPLICATE");
      }
      tx.set(ref, {
        displayName: rawName,
        createdAt: Date.now()
      });
    });
  }

  async _renameOnServer(oldRaw, newRaw) {
    const oldKey = this._normalize(oldRaw);
    const newKey = this._normalize(newRaw);

    const oldRef = doc(this.db, "userNames", oldKey);
    const newRef = doc(this.db, "userNames", newKey);

    await runTransaction(this.db, async tx => {
      const snap = await tx.get(newRef);
      if (snap.exists()) {
        throw new Error("DUPLICATE");
      }
      tx.delete(oldRef);
      tx.set(newRef, {
        displayName: newRaw,
        createdAt: Date.now()
      });
    });
  }

  async _release(rawName) {
    const key = this._normalize(rawName);
    await deleteDoc(doc(this.db, "userNames", key));
  }

  /* =========================
     LocalStorage
  ========================= */
  _loadUsers() {
    try {
      const raw = localStorage.getItem(this.storageUsersKey);
      const arr = raw ? JSON.parse(raw) : [];
      return Array.isArray(arr) ? arr : [];
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

  /* =========================
     Actions
  ========================= */
  async addUser() {
    const name = prompt("ユーザー名を10字以内で入力してください");
    if (!name) return;

    const err = this._validate(name);
    if (err) {
      alert(err);
      return;
    }

    try {
      await this._reserve(name);
    } catch {
      alert("このユーザー名は既に使われています。");
      return;
    }

    const n = name.trim();
    this.users.push(n);
    this._saveUsers();
    this.current = n;
    localStorage.setItem(this.storageLastKey, n);
    this._render();
    this.onChange?.(this.current);
  }

  async renameUser() {
    const cur = this.current;
    if (!cur) return;

    const name = prompt("新しいユーザー名を10字以内で入力してください", cur);
    if (!name) return;

    const err = this._validate(name);
    if (err) {
      alert(err);
      return;
    }

    if (name.trim() === cur) return;

    try {
      await this._renameOnServer(cur, name);
    } catch {
      alert("このユーザー名は既に使われています。");
      return;
    }

    const n = name.trim();
    this.users = this.users.map(u => (u === cur ? n : u));
    this._saveUsers();
    this.current = n;
    localStorage.setItem(this.storageLastKey, n);
    this._render();
    this.onChange?.(this.current);
  }

  async deleteUser() {
    if (this.users.length <= 1) {
      alert("最後のユーザーは削除できません。");
      return;
    }

    const cur = this.current;
    const ok = confirm(`ユーザー「${cur}」を削除しますか？`);
    if (!ok) return;

    await this._release(cur);

    this.users = this.users.filter(u => u !== cur);
    this.current = this.users[0];
    this._saveUsers();
    localStorage.setItem(this.storageLastKey, this.current);
    this._render();
    this.onChange?.(this.current);
  }
}
