// js/ranking.js
import {
  collection,
  getDocs,
  query,
  where,
  limit
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

export class RankingService {
  constructor({ db }) {
    if (!db) throw new Error("RankingService: db required");
    this.db = db;
  }

  /**
   * 全国（難度のみ）
   * - 「同一端末で userName を変えたら別扱い」に合わせ、best集計は userName 単位
   */
  async loadOverall({ difficulty, maxFetch = 800 } = {}) {
    const colRef = collection(this.db, "scores");

    const filters = [];
    if (difficulty) filters.push(where("difficulty", "==", difficulty));

    const q = query(colRef, ...filters, limit(maxFetch));
    const snap = await getDocs(q);
    const rows = snap.docs.map(d => d.data());

    return this._bestByUserName(rows).slice(0, 10);
  }

  /**
   * 今日の課題ランキング（dailyTaskKeyで絞る）
   */
  async loadDailyTask({ dailyTaskKey, difficulty, maxFetch = 800 } = {}) {
    if (!dailyTaskKey) return [];

    const colRef = collection(this.db, "scores");
    const q = query(
      colRef,
      where("isDailyTask", "==", true),
      where("dailyTaskKey", "==", dailyTaskKey),
      ...(difficulty ? [where("difficulty", "==", difficulty)] : []),
      limit(maxFetch)
    );

    const snap = await getDocs(q);
    const rows = snap.docs.map(d => d.data());

    return this._bestByUserName(rows).slice(0, 10);
  }

  renderList(ul, rows, { highlightUserName = null } = {}) {
    if (!ul) return;
    ul.innerHTML = "";

    if (!rows || rows.length === 0) {
      const li = document.createElement("li");
      li.textContent = "記録がありません";
      ul.appendChild(li);
      return;
    }

    rows.forEach((r, idx) => {
      const li = document.createElement("li");

      const name = (r.userName || "").toString() || (r.uid || "").toString() || "(unknown)";
      const cpm = Number(r.cpm ?? 0);

      li.textContent = `${idx + 1}位  ${name}  ${cpm.toFixed(0)} CPM`;

      if (highlightUserName && name === highlightUserName) {
        li.style.fontWeight = "bold";
      }

      ul.appendChild(li);
    });
  }

  _bestByUserName(rows) {
    const best = new Map(); // userName -> row

    for (const r of rows) {
      const userName = (r.userName || "").toString();
      if (!userName) continue;

      const prev = best.get(userName);
      if (!prev || Number(r.cpm ?? 0) > Number(prev.cpm ?? 0)) {
        best.set(userName, r);
      }
    }

    return Array.from(best.values()).sort((a, b) => Number(b.cpm ?? 0) - Number(a.cpm ?? 0));
  }
}
