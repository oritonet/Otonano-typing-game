// js/groupService.js
import {
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  addDoc,
  deleteDoc,
  query,
  where,
  limit,
  serverTimestamp,
  writeBatch
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

function memberIdOf(uid, userName, groupId) {
  return `${uid}::${userName}::${groupId}`;
}

function joinReqIdOf(uid, userName, groupId) {
  return `${uid}::${userName}::${groupId}`;
}

export class GroupService {
  constructor(db) {
    if (!db) throw new Error("GroupService: db required");
    this.db = db;
  }

  /* =========================
     グループ作成（owner）
  ========================= */
  async createGroup({ groupName, ownerUid, ownerUserName }) {
    const name = (groupName || "").toString().trim();
    if (!name) throw new Error("グループ名が空です");
    if (!ownerUid || !ownerUserName) throw new Error("owner情報が不正です");

    const groupRef = doc(collection(this.db, "groups"));
    const groupId = groupRef.id;

    // groups
    await setDoc(groupRef, {
      name,
      ownerUid,
      ownerUserName,
      createdAt: serverTimestamp()
    });

    // groupMembers(owner)
    const memRef = doc(this.db, "groupMembers", memberIdOf(ownerUid, ownerUserName, groupId));
    await setDoc(memRef, {
      groupId,
      uid: ownerUid,
      userName: ownerUserName,
      role: "owner",
      createdAt: serverTimestamp()
    });

    return { groupId, name };
  }

  /* =========================
     自分の所属グループ一覧
  ========================= */
  async getMyGroups(uid, userName) {
    if (!uid || !userName) return [];

    const q = query(
      collection(this.db, "groupMembers"),
      where("uid", "==", uid),
      where("userName", "==", userName)
    );
    const snap = await getDocs(q);

    const rows = [];
    for (const d of snap.docs) {
      const m = d.data();
      const groupId = m.groupId;

      let gName = "(no name)";
      let ownerUid = null;
      let ownerUserName = null;

      try {
        const gSnap = await getDoc(doc(this.db, "groups", groupId));
        if (gSnap.exists()) {
          const g = gSnap.data();
          gName = g.name ?? gName;
          ownerUid = g.ownerUid ?? null;
          ownerUserName = g.ownerUserName ?? null;
        }
      } catch {
        // ignore
      }

      rows.push({
        groupId,
        name: gName,
        role: m.role || "member",
        ownerUid,
        ownerUserName
      });
    }

    rows.sort((a, b) => (a.name || "").localeCompare(b.name || ""));
    return rows;
  }

  /* =========================
     グループ検索（名前完全一致の簡易版）
  ========================= */
  async searchGroupsByName(nameRaw) {
    const name = (nameRaw || "").toString().trim();
    if (!name) return [];

    const q = query(
      collection(this.db, "groups"),
      where("name", "==", name),
      limit(10)
    );
    const snap = await getDocs(q);

    return snap.docs.map(d => ({ groupId: d.id, ...(d.data() || {}) }));
  }

  /* =========================
     参加申請
     - 同一(uid,userName,groupId)で重複しないよう、ID固定で setDoc
  ========================= */
  async requestJoin({ groupId, uid, userName, targetOwnerUserName }) {
    const reqRef = doc(
      this.db,
      "groupJoinRequests",
      `${uid}::${userName}::${groupId}`
    );
  
    await setDoc(reqRef, {
      groupId,
      uid,
      userName,
      targetOwnerUserName,   // ★保存
      createdAt: serverTimestamp()
    });
  }


  /* =========================
     承認待ち一覧（owner用）
  ========================= */
  async getPendingRequests(groupId) {
    if (!groupId) return [];

    const q = query(
      collection(this.db, "groupJoinRequests"),
      where("groupId", "==", groupId)
    );
    const snap = await getDocs(q);

    return snap.docs.map(d => ({ id: d.id, ...(d.data() || {}) }));
  }

  /* =========================
     承認（ownerが実行）
     - groupMembers 作成
     - joinRequests 削除
  ========================= */
  async approveMember({ requestId, ownerUid, ownerUserName }) {
    if (!requestId) throw new Error("approveMember: requestId required");

    const reqRef = doc(this.db, "groupJoinRequests", requestId);
    const reqSnap = await getDoc(reqRef);
    if (!reqSnap.exists()) throw new Error("申請が存在しません");

    const r = reqSnap.data();
    const groupId = r.groupId;
    const uid = r.uid;
    const userName = r.userName;

    if (!groupId || !uid || !userName) throw new Error("申請データが不正です");

    const memRef = doc(this.db, "groupMembers", memberIdOf(uid, userName, groupId));

    const batch = writeBatch(this.db);
    batch.set(memRef, {
      groupId,
      uid,
      userName,
      role: "member",
      approvedByUid: ownerUid || null,
      approvedByUserName: ownerUserName || null,
      createdAt: serverTimestamp()
    });
    batch.delete(reqRef);

    await batch.commit();
  }

  /* =========================
     却下（ownerが実行）
  ========================= */
  async rejectMember({ requestId }) {
    if (!requestId) throw new Error("rejectMember: requestId required");
    await deleteDoc(doc(this.db, "groupJoinRequests", requestId));
  }

  /* =========================
     退出（自分のmember docを削除）
  ========================= */
  async leaveGroup({ groupId, uid, userName }) {
    if (!groupId || !uid || !userName) throw new Error("leaveGroup: params invalid");
    const memRef = doc(this.db, "groupMembers", memberIdOf(uid, userName, groupId));
    await deleteDoc(memRef);
  }

  /* =========================
     グループ削除（owner想定）
     - groups/{groupId}
     - groupMembers: groupId一致を全削除
     - joinRequests: groupId一致を全削除
  ========================= */
  async deleteGroup({ groupId }) {
    if (!groupId) throw new Error("deleteGroup: groupId required");

    // groups doc
    await deleteDoc(doc(this.db, "groups", groupId));

    // groupMembers 削除
    {
      const q = query(collection(this.db, "groupMembers"), where("groupId", "==", groupId));
      const snap = await getDocs(q);
      await this._batchDeleteDocs(snap.docs.map(d => d.ref));
    }

    // joinRequests 削除
    {
      const q = query(collection(this.db, "groupJoinRequests"), where("groupId", "==", groupId));
      const snap = await getDocs(q);
      await this._batchDeleteDocs(snap.docs.map(d => d.ref));
    }
  }

  async _batchDeleteDocs(refs) {
    const chunkSize = 450; // 500未満で安全側
    for (let i = 0; i < refs.length; i += chunkSize) {
      const batch = writeBatch(this.db);
      for (const ref of refs.slice(i, i + chunkSize)) {
        batch.delete(ref);
      }
      await batch.commit();
    }
  }
}

