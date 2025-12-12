// js/ranking.js
import {
  getFirestore,
  collection,
  query,
  where,
  orderBy,
  limit,
  getDocs
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

export class RankingManager {
  constructor(app) {
    this.db = getFirestore(app);
  }

  async loadRanking({ theme = null, category = null, limitCount = 10 }) {
    let q = collection(this.db, "scores");

    const conditions = [];
    if (theme) conditions.push(where("theme", "==", theme));
    if (category) conditions.push(where("category", "==", category));

    q = query(
      q,
      ...conditions,
      orderBy("rankingScore", "desc"),
      limit(limitCount)
    );

    const snap = await getDocs(q);
    return snap.docs.map(d => d.data());
  }
}
