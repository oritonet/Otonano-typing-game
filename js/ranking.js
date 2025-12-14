// js/ranking.js
import {
  collection,
  getDocs,
  query,
  where,
  orderBy,
  limit
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

export class RankingService {
  constructor({ db }) {
    this.db = db;
  }

  /* =========================
     今日の課題ランキング
  ========================= */
  async loadDailyTask({ dailyTaskKey, dateKey, difficulty, max = 200 }) {
    if (!dailyTaskKey || !dateKey) return [];

    const colRef = collection(this.db, "scores");
    const q = query(
      colRef,
      where("isDailyTask", "==", true),
      where("dailyTaskKey", "==", dailyTaskKey),
      where("dateKey", "==", dateKey),
      where("difficulty", "==", difficulty),
      orderBy("cpm", "desc"),
      limit(max)
    );

    const snap = await getDocs(q);
    return snap.docs.map(d => d.data());
  }

  /* =========================
     全国ランキング（難度のみ）
  ========================= */
  async loadOverall({ difficulty, max = 200 }) {
    if (!difficulty) return [];

    const colRef = collection(this.db, "scores");
    const q = query(
      colRef,
      where("difficulty", "==", difficulty),
      orderBy("cpm", "desc"),
      limit(max)
    );

    const snap = await getDocs(q);
    return snap.docs.map(d => d.data());
  }

  /* =========================
     描画
  ========================= */
  renderList(ul, rows, options = {}) {
    if (!ul) return;

    const highlightName = options.highlightUserName || null;

    ul.innerHTML = "";

    if (!rows || rows.length === 0) {
      const li = document.createElement("li");
      li.textContent = "まだスコアがありません。";
      ul.appendChild(li);
      return;
    }

    // uid ごとのベストを抽出
    const bestMap = new Map();
    for (const r of rows) {
      const uid = r.uid || "";
      if (!uid) continue;
      const prev = bestMap.get(uid);
      if (!prev || Number(r.cpm) > Number(prev.cpm)) {
        bestMap.set(uid, r);
      }
    }

    const list = Array.from(bestMap.values())
      .sort((a, b) => Number(b.cpm) - Number(a.cpm))
      .slice(0, 10);

    list.forEach((r, idx) => {
      const li = document.createElement("li");

      const rank = idx + 1;
      const name = r.userName || "NoName";
      const cpm = Number(r.cpm || 0);

      li.textContent = `${rank}. ${name} - ${cpm} CPM`;

      if (highlightName && name === highlightName) {
        li.style.fontWeight = "bold";
      }

      ul.appendChild(li);
    });
  }
}
