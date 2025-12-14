import {
  collection,
  addDoc,
  getDocs,
  getDoc,
  query,
  where,
  updateDoc,
  deleteDoc,
  doc,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

export class GroupService {
  constructor(db) {
    this.db = db;
  }

  /* =========================================================
     グループ作成（誰でも可）
     - 作成者は owner / approved で自動参加
  ========================================================= */
  async createGroup(groupName, ownerUid, ownerName) {
    const groupRef = await addDoc(collection(this.db, "groups"), {
      name: groupName,
      ownerUid,
      ownerName,
      createdAt: serverTimestamp()
    });

    await addDoc(collection(this.db, "groupMembers"), {
      groupId: groupRef.id,
      uid: ownerUid,
      userName: ownerName,
      role: "owner",
      status: "approved",
      joinedAt: serverTimestamp()
    });

    return groupRef.id;
  }

  /* =========================================================
     グループ削除（ownerのみ）
     - groups / groupMembers をまとめて削除
  ========================================================= */
  async deleteGroup(groupId) {
    const membersSnap = await getDocs(
      query(
        collection(this.db, "groupMembers"),
        where("groupId", "==", groupId)
      )
    );

    for (const d of membersSnap.docs) {
      await deleteDoc(d.ref);
    }

    await deleteDoc(doc(this.db, "groups", groupId));
  }

  /* =========================================================
     グループ検索（前方一致）
  ========================================================= */
  async searchGroups(keyword) {
    if (!keyword) return [];

    const q = query(
      collection(this.db, "groups"),
      where("name", ">=", keyword),
      where("name", "<=", keyword + "\uf8ff")
    );

    const snap = await getDocs(q);
    return snap.docs.map(d => ({
      id: d.id,
      ...d.data()
    }));
  }

  /* =========================================================
     参加申請（承認制）
     - status: pending
  ========================================================= */
  async requestJoin(groupId, uid, userName) {
    // 二重申請防止
    const exists = await getDocs(
      query(
        collection(this.db, "groupMembers"),
        where("groupId", "==", groupId),
        where("uid", "==", uid)
      )
    );
    if (!exists.empty) return;

    await addDoc(collection(this.db, "groupMembers"), {
      groupId,
      uid,
      userName,
      role: "member",
      status: "pending",
      joinedAt: serverTimestamp()
    });
  }

  /* =========================================================
     招待制（owner → 直接 approved）
  ========================================================= */
  async inviteUser(groupId, uid, userName) {
    await addDoc(collection(this.db, "groupMembers"), {
      groupId,
      uid,
      userName,
      role: "member",
      status: "approved",
      joinedAt: serverTimestamp()
    });
  }

  /* =========================================================
     承認待ち一覧（owner専用UI用）
  ========================================================= */
  async getPendingRequests(groupId) {
    const snap = await getDocs(
      query(
        collection(this.db, "groupMembers"),
        where("groupId", "==", groupId),
        where("status", "==", "pending")
      )
    );

    return snap.docs.map(d => ({
      id: d.id,
      ...d.data()
    }));
  }

  /* =========================================================
     承認 / 却下（ownerのみ）
  ========================================================= */
  async approveMember(memberDocId) {
    await updateDoc(
      doc(this.db, "groupMembers", memberDocId),
      { status: "approved" }
    );
  }

  async rejectMember(memberDocId) {
    await deleteDoc(
      doc(this.db, "groupMembers", memberDocId)
    );
  }

  /* =========================================================
     退出（member / owner 両対応）
     - owner が退出する場合は deleteGroup を使う
  ========================================================= */
  async leaveGroup(groupId, uid) {
    const snap = await getDocs(
      query(
        collection(this.db, "groupMembers"),
        where("groupId", "==", groupId),
        where("uid", "==", uid)
      )
    );

    for (const d of snap.docs) {
      await deleteDoc(d.ref);
    }
  }

  /* =========================================================
     自分が参加しているグループ一覧（approved のみ）
     - UI の「現在参加中グループ切替」に使用
  ========================================================= */
  async getMyGroups(uid) {
    const memberSnap = await getDocs(
      query(
        collection(this.db, "groupMembers"),
        where("uid", "==", uid),
        where("status", "==", "approved")
      )
    );

    const results = [];

    for (const m of memberSnap.docs) {
      const groupRef = doc(this.db, "groups", m.data().groupId);
      const groupSnap = await getDoc(groupRef);
      if (!groupSnap.exists()) continue;

      results.push({
        groupId: groupSnap.id,
        role: m.data().role,
        ...groupSnap.data()
      });
    }

    return results;
  }

  /* =========================================================
     自分が owner かどうか判定
  ========================================================= */
  async isOwner(groupId, uid) {
    const snap = await getDocs(
      query(
        collection(this.db, "groupMembers"),
        where("groupId", "==", groupId),
        where("uid", "==", uid),
        where("role", "==", "owner")
      )
    );
    return !snap.empty;
  }
}
