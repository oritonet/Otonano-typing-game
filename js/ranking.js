// js/ranking.js
import {
  collection, addDoc, getDocs, query, orderBy, limit
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

function toSafeKey(s) {
  return String(s)
    .normalize("NFKC")
    .replace(/\s+/g, "_")
    .replace(/[\/\\?%*:|"<>]/g, "_")
    .slice(0, 120);
}

export class RankingService {
  constructor({ db }) {
    this.db = db;
  }

  calcRankingScore(cpm, kpm) {
    const eff = (kpm > 0) ? (cpm / kpm) : 0;
    const waste = kpm - cpm;
    return Math.round(cpm * 1.0 + eff * 100 - waste * 0.3);
  }

  // コレクション名生成（完全版に合わせて拡張可能）
  colDaily(dailyTheme, diffKey = "diff_all") {
    return `scores__daily__${toSafeKey(dailyTheme)}__${toSafeKey(diffKey)}`;
  }

  // ★日替わりランキング：今日テーマ以外は保存しない（完全遮断）
  async saveDaily({
    uid,
    name,
    dailyTheme,
    itemTheme,
    difficultyKey = "diff_all",
    cpm, kpm, rank
  }) {
    if (!uid || !name) return;
    if (!dailyTheme) return;

    if (itemTheme !== dailyTheme) {
      // ここで混入を完全に防ぐ
      return;
    }

    const rankingScore = this.calcRankingScore(cpm, kpm);

    await addDoc(
      collection(this.db, this.colDaily(dailyTheme, difficultyKey)),
      {
        uid,
        name,
        dailyTheme,
        theme: itemTheme,
        cpm, kpm, rank,
        rankingScore,
        createdAt: Date.now()
      }
    );
  }

  // 取得（rankingScoreで並び替え）
  async loadDailyTop10({ dailyTheme, difficultyKey = "diff_all" }) {
    const colName = this.colDaily(dailyTheme, difficultyKey);
    const q = query(
      collection(this.db, colName),
      orderBy("rankingScore", "desc"),
      limit(10)
    );
    const snap = await getDocs(q);
    const rows = [];
    snap.forEach(d => rows.push(d.data()));
    return rows;
  }

  // 表示用フォーマット
  static formatRow(row) {
    return `${row.name}｜Score ${row.rankingScore}｜CPM ${row.cpm} / KPM ${row.kpm}｜${row.rank}`;
  }
}
