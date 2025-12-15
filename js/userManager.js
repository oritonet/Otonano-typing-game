import {
  collection,
  doc,
  getDocs,
  getDoc,
  setDoc,
  deleteDoc,
  serverTimestamp,
  runTransaction,
  query,
  where
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

export class UserManager {
  constructor({ selectEl, addBtn, renameBtn, deleteBtn, db }) {
    if (!db) throw new Error("UserManager: Firestore db is required");

    this.db = db;

    this.userSelect = selectEl || null;
    this.addBtn = addBtn || null;
    this.renameBtn = renameBtn || null;
    this.deleteBtn = deleteBtn || null;

    this.users = [];
    this.currentUserName = "";
    this._authUid = "";
    this._listeners = new Set();

    this._bindEvents();
  }

  /* =========================
     init
  ========================= */
  async init(authUid) {
    this._authUid = (authUid || "").toString();
    if (!this._authUid) throw new Error("UserManager.init: authUid is required");

    this.users = await this.listUsers();

    const last = this._getLastUserName();

    if (last && this.users.includes(last)) {
      this.currentUserName = last;
    } else if (this.users.length > 0) {
      this.currentUserName = this.users[0];
    } else {
      const guest = await this._createUniqueGuestUser();
      this.currentUserName = guest;
      this.users = await this.listUsers();
    }

    this._setLastUserName(this.currentUserName);
    this.render();
    this._emitChanged();

    return this.currentUserName;
  }

  /* =========================
     イベント
  ========================= */
  onUserChanged(fn) {
    if (typeof fn !== "function") return () => {};
    this._listeners.add(fn);
    return () => this._listeners.delete(fn);
  }

  _emitChanged() {
    for (const fn of this._listeners) {
      try {
        fn(this.currentUserName);
      } catch (e) {
        console.error("onUserChanged handler error:", e);
      }
    }
  }

  _bindEvents() {
    if (this.userSelect) {
      this.userSelect.addEventListener("change", () => {
        const v = (this.userSelect.value || "").toString();
        if (!v || !this.users.includes(v)) return;

        this.currentUserName = v;
        this._setLastUserName(v);
        this._emitChanged();
      });
    }

    if (this.addBtn) {
      this.addBtn.addEventListener("click", async () => {
        const name = prompt("ユーザー名を入力してください（全体で一意）");
        if (!name) return;
        try {
          await this.addUser(name);
        } catch (e) {
          alert(e.message || "ユーザー作成に失敗しました");
        }
      });
    }

    if (this.renameBtn) {
      this.renameBtn.addEventListener("click", async () => {
        if (!this.currentUserName) return;
        const newName = prompt("新しいユーザー名", this.currentUserName);
        if (!newName || newName === this.currentUserName) return;
        try {
          await this.renameUser(this.currentUserName, newName);
        } catch (e) {
          alert(e.message || "改名に失敗しました");
        }
      });
    }

    if (this.deleteBtn) {
      this.deleteBtn.addEventListener("click", async () => {
        if (!this.currentUserName) return;
        if (!confirm(`ユーザー「${this.currentUserName}」を削除しますか？`)) return;
        try {
          await this.deleteUser(this.currentUserName);
        } catch (e) {
          alert(e.message || "削除に失敗しました");
        }
      });
    }
  }

  /* =========================
     UI
  ========================= */
  render() {
    if (!this.userSelect) return;

    this.userSelect.innerHTML = "";
    for (const name of this.users) {
      const opt = document.createElement("option");
      opt.value = name;
      opt.textContent = name;
      this.userSelect.appendChild(opt);
    }

    if (this.currentUserName) {
      this.userSelect.value = this.currentUserName;
    }
  }

  getCurrentUserName() {
    return this.currentUserName;
  }

  /* =========================
     Firestore
  ========================= */

  // ★ ここが最大の修正点
  async listUsers() {
    const q = query(
      collection(this.db, "userUserNames"),
      where("uid", "==", this._authUid)
    );
    const snap = await getDocs(q);
    return snap.docs.map(d => d.data().userName).sort();
  }

  async addUser(nameRaw) {
    const name = nameRaw.trim();
    if (!name) throw new Error("ユーザー名が空です");

    const nameRef = doc(this.db, "userNames", name);
    if ((await getDoc(nameRef)).exists()) {
      throw new Error("このユーザー名は既に使われています");
    }

    await setDoc(nameRef, {
      createdAt: serverTimestamp(),
      createdByUid: this._authUid
    });

    await setDoc(
      doc(this.db, "userUserNames", `${this._authUid}_${name}`),
      {
        uid: this._authUid,
        userName: name,
        createdAt: serverTimestamp()
      }
    );

    this.users = await this.listUsers();
    this.currentUserName = name;
    this._setLastUserName(name);
    this.render();
    this._emitChanged();
  }

  async renameUser(oldName, newName) {
    if (!this.users.includes(oldName)) throw new Error("権限がありません");

    const oldRef = doc(this.db, "userNames", oldName);
    const newRef = doc(this.db, "userNames", newName);

    if ((await getDoc(newRef)).exists()) {
      throw new Error("新しいユーザー名は既に使われています");
    }

    await setDoc(newRef, {
      createdAt: serverTimestamp(),
      createdByUid: this._authUid
    });
    await deleteDoc(oldRef);

    await deleteDoc(doc(this.db, "userUserNames", `${this._authUid}_${oldName}`));
    await setDoc(
      doc(this.db, "userUserNames", `${this._authUid}_${newName}`),
      {
        uid: this._authUid,
        userName: newName,
        createdAt: serverTimestamp()
      }
    );

    this._cleanupLocalStorageForUser(oldName);

    this.users = await this.listUsers();
    this.currentUserName = newName;
    this._setLastUserName(newName);
    this.render();
    this._emitChanged();
  }

  async deleteUser(name) {
    if (!this.users.includes(name)) return;

    await deleteDoc(doc(this.db, "userNames", name));
    await deleteDoc(doc(this.db, "userUserNames", `${this._authUid}_${name}`));

    this._cleanupLocalStorageForUser(name);

    this.users = await this.listUsers();

    if (this.users.length === 0) {
      const guest = await this._createUniqueGuestUser();
      this.users = await this.listUsers();
      this.currentUserName = guest;
    } else {
      this.currentUserName = this.users[0];
    }

    this._setLastUserName(this.currentUserName);
    this.render();
    this._emitChanged();
  }

  /* =========================
     guest 生成
  ========================= */
  async _createUniqueGuestUser() {
    for (let i = 0; i < 30; i++) {
      const name = `guest-${this._randBase36(10)}`;
      const ref = doc(this.db, "userNames", name);

      const ok = await runTransaction(this.db, async (tx) => {
        if ((await tx.get(ref)).exists()) return null;
        tx.set(ref, { createdAt: serverTimestamp(), createdByUid: this._authUid });
        return name;
      });

      if (ok) {
        await setDoc(
          doc(this.db, "userUserNames", `${this._authUid}_${ok}`),
          {
            uid: this._authUid,
            userName: ok,
            createdAt: serverTimestamp()
          }
        );
        return ok;
      }
    }
    throw new Error("guest 作成失敗");
  }

  _randBase36(n) {
    const bytes = new Uint8Array(n);
    crypto.getRandomValues(bytes);
    return Array.from(bytes).map(b => (b % 36).toString(36)).join("");
  }

  /* =========================
     localStorage
  ========================= */
  _lastKey() {
    return `lastUserName_v1:${this._authUid}`;
  }

  _getLastUserName() {
    return localStorage.getItem(this._lastKey()) || "";
  }

  _setLastUserName(name) {
    localStorage.setItem(this._lastKey(), name);
  }

  _cleanupLocalStorageForUser(userName) {
    localStorage.removeItem(`currentGroupId_v1:${userName}`);
  }
}
