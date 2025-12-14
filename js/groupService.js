import {
  collection,
  addDoc,
  getDocs,
  getDoc,
  query,
  where,
  deleteDoc,
  doc,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

/*
  コレクション設計（確定）:

  groups
    { name, ownerUid, ownerName, createdAt }

  groupMembers         // 承認済みメンバーのみ
    { groupId, uid, userName, role, createdAt }

  groupJoinRequests    // 承認待ちのみ
    { groupId, uid, userName, createdAt }
*/

export class GroupService {
  constructor(db) {
    this.db = db;
  }

  /* =========================================================
     グループ作成（誰でも可）
     - 作成者は owner として即参加
  ========================================================= */
  async createGroup(groupName, ownerUid, ownerName) {
    // グループ本体
    const groupRef = await addDoc(collection(this.db, "groups"), {
      name: groupName,
      ownerUid,
      ownerName,
      createdAt: serverTimestamp()
    });

    // owner を groupMembers に登録
    await addDoc(collection(this.db, "groupMembers"), {
      groupId: groupRef.id,
      uid: ownerUid,
      userName: ownerName,
      role: "owner",
      createdAt: serverTimestamp()
    });

    return groupRef.id;
  }

  /* =========================================================
     グループ削除（ownerのみ）
     - groups / groupMembers / groupJoinRequests を削除
  ========================================================= */
  async deleteGroup(groupId) {
    // members
    const membersSnap = await getDocs(
      query(collection(this.db, "groupMembers"), where("groupId", "==", groupId))
    );
    for (const d of membersSnap.docs) {
      await deleteDoc(d.ref);
    }

    // pending requests
    const reqSnap = await getDocs(
      query(collection(this.db, "groupJoinRequests"), where("groupId", "==", groupId))
    );
    for (const d of reqSnap.docs) {
      await deleteDoc(d.ref);
    }

    // group itself
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
     - groupJoinRequests に追加
  ========================================================= */
  async requestJoin(groupId, uid, userName) {
    // すでに member なら何もしない
    const memberSnap = await getDocs(
      query(
        collection(this.db, "groupMembers"),
        where("groupId", "==", groupId),
        where("uid", "==", uid)
      )
    );
    if (!memberSnap.empty) return;

    // 二重申請防止
    const reqSnap = await getDocs(
      query(
        collection(this.db, "groupJoinRequests"),
        where("groupId", "==", groupId),
        where("uid", "==", uid)
      )
    );
    if (!reqSnap.empty) return;

    await addDoc(collection(this.db, "groupJoinRequests"), {
      groupId,
      uid,
      userName,
      createdAt: serverTimestamp()
    });
  }

  /* =========================================================
     承認待ち一覧（owner専用）
  ========================================================= */
  async getPendingRequests(groupId) {
    const snap = await getDocs(
      query(
        collection(this.db, "groupJoinRequests"),
        where("groupId", "==", groupId)
      )
    );

    return snap.docs.map(d => ({
      id: d.id,
      ...d.data()
    }));
  }

  /* =========================================================
     承認（ownerのみ）
     - groupMembers に追加
     - groupJoinRequests を削除
  ========================================================= */
  async approveMember(request) {
    // request = { id, groupId, uid, userName }

    await addDoc(collection(this.db, "groupMembers"), {
      groupId: request.groupId,
      uid: request.uid,
      userName: request.userName,
      role: "member",
      createdAt: serverTimestamp()
    });

    await deleteDoc(doc(this.db, "groupJoinRequests", request.id));
  }

  /* =========================================================
     却下（ownerのみ）
     - groupJoinRequests を削除
  ========================================================= */
  async rejectMember(requestId) {
    await deleteDoc(doc(this.db, "groupJoinRequests", requestId));
  }

  /* =========================================================
     退出（memberのみ）
     - owner は deleteGroup を使う
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
     自分が参加しているグループ一覧
     - groupMembers のみ参照
  ========================================================= */
  async getMyGroups(uid) {
    const memberSnap = await getDocs(
      query(
        collection(this.db, "groupMembers"),
        where("uid", "==", uid)
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
     owner 判定（補助）
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
