import {
  collection,
  getDocs,
  setDoc,
  deleteDoc,
  doc,
  runTransaction
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
     - ユーザー0人なら guest を自動作成（衝突なし）
  ========================= */

  async init() {
    this.users = await this.listUsers();

    // ★ ユーザーが0人の場合は Firestore transaction で一意 guest を作成
    if (this.users.length === 0) {
      const guest = await this._createUniqueGuestUser();

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

    await setDoc(doc(this.db, "userNames", newName), {
      createdAt: Date.now()
    });

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

    if (this.currentUserName) {
      this._emitUserChanged();
    }
  }

  /* =========================
     UI 制御
  ========================= */

  render() {
    this.userSelect.innerHTML = "";

    for (const name of this.users) {
      const opt = document.createElement("option");
      opt.value = name;
      opt.textContent = name;
      this.userSelect.appendChild(opt);
    }

    this.userSelect.value = this.currentUserName || "";

    // 見た目上の混乱防止
    this.userSelect.disabled = (this.users.length === 0);
  }

  bindUI() {
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

  // ★ Math.random を使わない guest 名生成（Firestore auto ID）
  _generateGuestName() {
    const id = doc(this.db, "_").id;
    return `guest-${id.slice(0, 10)}`;
  }

  // ★ Firestore transaction で一意に guest を作成
  async _createUniqueGuestUser() {
    while (true) {
      const guest = this._generateGuestName();
      const ref = doc(this.db, "userNames", guest);

      try {
        await runTransaction(this.db, async (tx) => {
          const snap = await tx.get(ref);
          if (snap.exists()) {
            throw new Error("collision");
          }
          tx.set(ref, { createdAt: Date.now() });
        });
        return guest; // 成功
      } catch (e) {
        // 衝突したら再生成
      }
    }
  }
}
