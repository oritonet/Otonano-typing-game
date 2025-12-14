// js/ranking.js
import {
  collection,
  getDocs,
  query,
  where,
  limit
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

function lengthLabel(v) {
  if (v === "xs") return "極短";
  if (v === "short") return "短";
  if (v === "medium") return "中";
  if (v === "long") return "長";
  if (v === "xl") return "極長";
  return "-";
}

export class RankingService {
  constructor({ db }) {
    this.db = db;
  }

  async _fetchScores({
    theme = null,
    category = null,
    dateKey = null,
    difficulty,
    lengthGroup,
    maxFetch = 800
  }) {
    const colRef = collection(this.db, "scores");
    const filters = [];

    if (theme) filters.push(where("theme", "==", theme));
    if (category) filters.push(where("category", "==", category));
    if (dateKey) filters.push(where("dateKey", "==", dateKey));
    if (difficulty) filters.push(where("difficulty", "==", difficulty));
    if (lengthGroup) filters.push(where("lengthGroup", "==", lengthGroup));

    const q = query(colRef, ...filters, limit(maxFetch));
    const snap = await getDocs(q);

    const rows = [];
    snap.forEach(d => rows.push({ id: d.id, ...d.data() }));
    return rows;
  }

  _sortAndTop10(rows) {
    return rows
      .slice()
      .sort((a, b) => {
        const ac = Number(a.cpm ?? -999999);
        const bc = Number(b.cpm ?? -999999);
        if (bc !== ac) return bc - ac;
        const at = a.createdAt?.toMillis?.() ?? 0;
        const bt = b.createdAt?.toMillis?.() ?? 0;
        return bt - at;
      })
      .slice(0, 10);
  }

  async loadOverall({ difficulty, lengthGroup }) {
    const rows = await this._fetchScores({ difficulty, lengthGroup });
    return this._sortAndTop10(rows);
  }

  async loadDailyTheme({ theme, dateKey, difficulty, lengthGroup }) {
    if (!theme || !dateKey) return [];
    const rows = await this._fetchScores({
      theme,
      dateKey,
      difficulty,
      lengthGroup
    });
    return this._sortAndTop10(rows);
  }

  renderList(ul, rows) {
    ul.innerHTML = "";
    if (!rows.length) {
      const li = document.createElement("li");
      li.textContent = "まだスコアがありません。";
      ul.appendChild(li);
      return;
    }

    rows.forEach((r, i) => {
      const li = document.createElement("li");
      li.textContent =
        `${i + 1}位：${r.userName ?? "-"}` +
        `｜ランク：${r.rank ?? "-"}` +
        `｜スコア：${Number(r.cpm ?? 0)}` +
        `｜長さ：${lengthLabel(r.lengthGroup)}` +
        `｜テーマ：${r.theme ?? "-"}`;
      ul.appendChild(li);
    });
  }
}
