// js/ranking.js
import {
  collection,
  getDocs,
  query,
  where,
  limit
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

/* =========================
   Utils
========================= */
function lengthLabel(v) {
  if (v === "xs") return "極短";
  if (v === "short") return "短";
  if (v === "medium") return "中";
  if (v === "long") return "長";
  if (v === "xl") return "極長";
  return "-";
}

function safeNum(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

/* =========================
   Ranking Service
========================= */
export class RankingService {
  constructor({ db }) {
    this.db = db;
  }

  /* -------------------------
     Firestore fetch
     - 原則: ランキングは「長さではフィルタしない」
     - 今日の課題ランキングは isDailyTask + dailyTaskKey + dateKey で絞る
  ------------------------- */
  async _fetchScores({
    difficulty = null,
    category = null,
    theme = null,
    dateKey = null,
    isDailyTask = null,
    dailyTaskKey = null,
    maxFetch = 800
  }) {
    const colRef = collection(this.db, "scores");
    const filters = [];

    if (difficulty) filters.push(where("difficulty", "==", difficulty));
    if (category) filters.push(where("category", "==", category));
    if (theme) filters.push(where("theme", "==", theme));
    if (dateKey) filters.push(where("dateKey", "==", dateKey));

    if (isDailyTask !== null && isDailyTask !== undefined) {
      filters.push(where("isDailyTask", "==", !!isDailyTask));
    }
    if (dailyTaskKey) filters.push(where("dailyTaskKey", "==", dailyTaskKey));

    const q = query(colRef, ...filters, limit(maxFetch));
    const snap = await getDocs(q);

    const rows = [];
    snap.forEach(docu => rows.push({ id: docu.id, ...docu.data() }));
    return rows;
  }

  /* -------------------------
     Sort + Top10
  ------------------------- */
  _sortAndTop10(rows) {
    return rows
      .slice()
      .sort((a, b) => {
        const ac = safeNum(a.cpm, -999999);
        const bc = safeNum(b.cpm, -999999);
        if (bc !== ac) return bc - ac;

        const at = a.createdAt?.toMillis?.() ?? 0;
        const bt = b.createdAt?.toMillis?.() ?? 0;
        return bt - at;
      })
      .slice(0, 10);
  }

  /* -------------------------
     Public loaders
  ------------------------- */
  async loadOverall({ difficulty }) {
    const rows = await this._fetchScores({ difficulty });
    return this._sortAndTop10(rows);
  }

  async loadByCategory({ category, difficulty }) {
    if (!category || category === "all") return this.loadOverall({ difficulty });
    const rows = await this._fetchScores({ category, difficulty });
    return this._sortAndTop10(rows);
  }

  async loadByTheme({ theme, difficulty }) {
    if (!theme || theme === "all") return this.loadOverall({ difficulty });
    const rows = await this._fetchScores({ theme, difficulty });
    return this._sortAndTop10(rows);
  }

  async loadDailyTask({ dailyTaskKey, dateKey, difficulty }) {
    if (!dailyTaskKey || !dateKey) return [];
    const rows = await this._fetchScores({
      isDailyTask: true,
      dailyTaskKey,
      dateKey,
      difficulty
    });
    return this._sortAndTop10(rows);
  }

  /* -------------------------
     Render
  ------------------------- */
  renderList(ul, rows, { highlightUserName = null } = {}) {
    ul.innerHTML = "";

    if (!rows.length) {
      const li = document.createElement("li");
      li.textContent = "まだスコアがありません。";
      ul.appendChild(li);
      return;
    }

    rows.forEach((r, i) => {
      const li = document.createElement("li");

      const userName = r.userName ?? "-";
      const rank = r.rank ?? "-";
      const score = safeNum(r.cpm, 0);
      const lg = lengthLabel(r.lengthGroup);
      const theme = r.theme ?? "-";

      li.textContent =
        `${i + 1}位：${userName}` +
        `｜ランク：${rank}` +
        `｜スコア：${score}` +
        `｜長さ：${lg}` +
        `｜テーマ：${theme}`;

      if (highlightUserName && userName === highlightUserName) {
        li.style.fontWeight = "900";
        li.style.color = "#c00";
      }

      ul.appendChild(li);
    });
  }
}
