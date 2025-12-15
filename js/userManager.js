import {
  collection,
  getDocs,
  setDoc,
  deleteDoc,
  doc
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

export class UserManager {
  constructor(db, userSelect) {
    this.db = db;
    this.userSelect = userSelect;

    this.users = [];
    this.currentUserName = "";

    // ★ 変更通知リスナー
    this._listeners = [];
  }

  /* =========================
     外部公開API
  ========================= */

  onUserChanged(cb) {
    this._listeners.push(cb);
  }

  getCurrentUserName() {
    return this.currentUserName;
  }

  /* =========================
     初期化
     - ユーザー0人なら guest を自動作成
  ========================= */

  async init() {
    this.users = await this.listUsers();

    // ★ ユーザーが0人の場合は自動で guest を作成
    if (this.users.length === 0) {
      let guest;
      do {
        guest = this._generateGuestName();
      } while (this.users.includes(guest));

      await setDoc(doc(this.db, "userNames", guest), {
        createdAt: Date.now()
      });

      this.users = [guest];
      this.currentUserName = guest;

      this.render();
      this._emitUserChanged();
      return;
    }

    // 通常ケース
    this.currentUserName = this.users[0];
    this.render();
    this._emitUserChanged();
  }

  /* =========================
     Firestore 操作
  ========================= */

  async listUsers() {
    const snap = await getDocs(collection(this.db, "userNames"));
    return snap.docs.map(d => d.id).sort();
  }

  async addUser(name) {
    if (!name) return;

    await setDoc(doc(this.db, "userNames", name), {
      createdAt: Date.now()
    });

    this.users = await this.listUsers();
    this.currentUserName = name;

    this.render();
    this._emitUserChanged();
  }

  async renameUser(oldName, newName) {
    if (!oldName || !newName || oldName === newName) return;

    // 新しい名前を作成
    await setDoc(doc(this.db, "userNames", newName), {
      createdAt: Date.now()
    });

    // 古い名前を削除
    await deleteDoc(doc(this.db, "userNames", oldName));

    this.users = await this.listUsers();
    this.currentUserName = newName;

    this.render();
    this._emitUserChanged();
  }

  async deleteUser(name) {
    if (!name) return;

    await deleteDoc(doc(this.db, "userNames", name));

    this.users = await this.listUsers();
    this.currentUserName = this.users[0] || "";

    this.render();

    // ★ 削除後に0人なら、次回リロード時に guest が自動作成される
    if (this.currentUserName) {
      this._emitUserChanged();
    }
  }

  /* =========================
     UI 制御
  ========================= */

  render() {
    // select を作り直す
    this.userSelect.innerHTML = "";

    for (const name of this.users) {
      const opt = document.createElement("option");
      opt.value = name;
      opt.textContent = name;
      this.userSelect.appendChild(opt);
    }

    this.userSelect.value = this.currentUserName || "";

    // 見た目上の混乱防止（任意）
    this.userSelect.disabled = (this.users.length === 0);
  }

  bindUI() {
    // select 変更 → 即通知
    this.userSelect.addEventListener("change", () => {
      const selected = this.userSelect.value;
      if (selected === this.currentUserName) return;

      this.currentUserName = selected;
      this._emitUserChanged();
    });
  }

  /* =========================
     内部ユーティリティ
  ========================= */

  _emitUserChanged() {
    for (const cb of this._listeners) {
      try {
        cb(this.currentUserName);
      } catch (e) {
        console.error("onUserChanged listener error", e);
      }
    }
  }

  _generateGuestName() {
    const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
    let s = "";
    for (let i = 0; i < 8; i++) {
      s += chars[Math.floor(Math.random() * chars.length)];
    }
    return `guest-${s}`;
  }
}
