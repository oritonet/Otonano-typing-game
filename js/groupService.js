// js/groupService.js
import {
  collection,
  doc,
  addDoc,
  getDocs,
  getDoc,
  query,
  where,
  deleteDoc,
  serverTimestamp,
  runTransaction
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

/*
  Firestore 構成（前提）

  groups
    - name
    - ownerUid
    - ownerName
    - createdAt

  groupMembers
    - groupId
    - uid
    - userName
    - role: "owner" | "member"
    - createdAt

  groupJoinRequests
    - groupId
    - uid
    - userName
    - createdAt
*/

export class GroupService {
  constructor(db) {
    this.db = db;
  }

  /* =========================
     グループ作成
  ========================= */
  async createGroup(name, ownerUid, ownerName) {
    if (!name || !ownerUid) {
      throw new Error("invalid arguments");
    }

    // 1) group 作成
    const groupRef = await addDoc(collection(this.db, "groups"), {
      name,
      ownerUid,
      ownerName,
      createdAt: serverTimestamp()
    });

    // 2) owner を member として追加
    await addDoc(collection(this.db, "groupMembers"), {
      groupId: groupRef.id,
      uid: ownerUid,
      userName: ownerName || "Owner",
      role: "owner",
      createdAt: serverTimestamp()
    });

    return groupRef.id;
  }

  /* =========================
     グループ検索
  ========================= */
  async searchGroups(keyword) {
    if (!keyword) return [];

    // 完全一致ではなく prefix 検索（簡易）
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

  /* =========================
     参加申請
  ========================= */
  async requestJoin(groupId, uid, userName) {
    if (!groupId || !uid) {
      throw new Error("invalid arguments");
    }

    // 二重申請防止
    const q = query(
      collection(this.db, "groupJoinRequests"),
      where("groupId", "==", groupId),
      where("uid", "==", uid)
    );
    const snap = await getDocs(q);
    if (!snap.empty) {
      throw new Error("already requested");
    }

    await addDoc(collection(this.db, "groupJoinRequests"), {
      groupId,
      uid,
      userName: userName || "Guest",
      createdAt: serverTimestamp()
    });
  }

  /* =========================
     自分が所属するグループ一覧
  ========================= */
  async getMyGroups(uid) {
    if (!uid) return [];

    const q = query(
      collection(this.db, "groupMembers"),
      where("uid", "==", uid)
    );
    const snap = await getDocs(q);

    const groups = [];
    for (const d of snap.docs) {
      const m = d.data();
      const gRef = doc(this.db, "groups", m.groupId);
      const gSnap = await getDoc(gRef);
      if (!gSnap.exists()) continue;

      groups.push({
        groupId: m.groupId,
        role: m.role,
        ...gSnap.data()
      });
    }
    return groups;
  }

  /* =========================
     承認待ち一覧（ownerのみ）
  ========================= */
  async getPendingRequests(groupId) {
    if (!groupId) return [];

    const q = query(
      collection(this.db, "groupJoinRequests"),
      where("groupId", "==", groupId)
    );

    const snap = await getDocs(q);
    return snap.docs.map(d => ({
      id: d.id,
      ...d.data()
    }));
  }

  /* =========================
     承認（transaction）
     - member 追加
     - request 削除
  ========================= */
  async approveMember(requestId) {
    if (!requestId) throw new Error("invalid requestId");

    const reqRef = doc(this.db, "groupJoinRequests", requestId);

    await runTransaction(this.db, async (tx) => {
      const reqSnap = await tx.get(reqRef);
      if (!reqSnap.exists()) {
        throw new Error("request not found");
      }

      const req = reqSnap.data();

      // member 追加
      const memberRef = doc(collection(this.db, "groupMembers"));
      tx.set(memberRef, {
        groupId: req.groupId,
        uid: req.uid,
        userName: req.userName || "Member",
        role: "member",
        createdAt: serverTimestamp()
      });

      // request 削除
      tx.delete(reqRef);
    });
  }

  /* =========================
     却下
  ========================= */
  async rejectMember(requestId) {
    if (!requestId) throw new Error("invalid requestId");
    await deleteDoc(doc(this.db, "groupJoinRequests", requestId));
  }

  /* =========================
     グループ退出
  ========================= */
  async leaveGroup(groupId, uid) {
    if (!groupId || !uid) return;

    const q = query(
      collection(this.db, "groupMembers"),
      where("groupId", "==", groupId),
      where("uid", "==", uid)
    );

    const snap = await getDocs(q);
    for (const d of snap.docs) {
      await deleteDoc(d.ref);
    }
  }

  /* =========================
     グループ削除（owner）
  ========================= */
  async deleteGroup(groupId) {
    if (!groupId) throw new Error("invalid groupId");

    // members 削除
    const mSnap = await getDocs(
      query(collection(this.db, "groupMembers"), where("groupId", "==", groupId))
    );
    for (const d of mSnap.docs) {
      await deleteDoc(d.ref);
    }

    // pending 削除
    const pSnap = await getDocs(
      query(collection(this.db, "groupJoinRequests"), where("groupId", "==", groupId))
    );
    for (const d of pSnap.docs) {
      await deleteDoc(d.ref);
    }

    // group 本体削除
    await deleteDoc(doc(this.db, "groups", groupId));
  }
}
