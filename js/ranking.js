// js/ranking.js
// - ランキングは rankingScore で降順
// - 表示は name / rankingScore / CPM / KPM / Rank
// - 今日のテーマランキングは「今日のテーマ」以外が混ざらない（保存先を完全分離）
// - Firestore: 匿名認証必須（読み書きは auth != null 前提）
//
// コレクション設計（全部 auth.uid の端末ID1つでOK）
//   rankings__overall__diff_xxx
//   rankings__category__<categoryKey>__diff_xxx
//   rankings__theme__<themeKey>__diff_xxx
//   rankings__daily__<todayThemeKey>__diff_xxx   ← 今日テーマ専用

import {
  collection, addDoc, getDocs, query, orderBy, limit, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

export class RankingService {
  constructor({ db }) {
    this.db = db;
  }

  // 安全キー化
  toKey(s) {
    return String(s ?? "")
      .normalize("NFKC")
      .replace(/\s+/g, "_")
      .replace(/[\/\\?%*:|"<>]/g, "_")
      .replace(/[^0-9A-Za-zぁ-んァ-ン一-龥_（）()・、。-]/g, "_")
      .slice(0, 120) || "empty";
  }

  diffKey(difficulty) {
    return (difficulty === "all") ? "diff_all" : `diff_${difficulty}`;
  }

  // rankingScore（並び順の主軸）
  calcRankingScore({ cpm, kpm }) {
    const eff = (kpm > 0) ? (cpm / kpm) : 0;
    const waste = Math.max(0, kpm - cpm);
    return Math.round(
      cpm * 1.0 +
      eff * 100 -
      waste * 0.3
    );
  }

  // スコープ別コレクション名
  collectionName({ scope, difficulty, category, theme, todayTheme }) {
    const d = this.diffKey(difficulty);

    if (scope === "overall") return `rankings__overall__${d}`;
    if (scope === "category") return `rankings__category__${this.toKey(category)}__${d}`;
    if (scope === "theme") return `rankings__theme__${this.toKey(theme)}__${d}`;
    if (scope === "daily") return `rankings__daily__${this.toKey(todayTheme)}__${d}`;

    return `rankings__overall__${d}`;
  }

  // 保存：複数ボードへ同時保存
  async saveToBoards({
    name,
    uid,
    metrics,     // {cpm,kpm,rank,eff,wpm,diff,seconds,typedLength,keystrokes}
    filters,     // {difficulty, category, theme, dailyEnabled, todayTheme}
    itemMeta     // {itemDifficulty,itemCategory,itemTheme,itemLength,itemPunct,itemKataRatio}
  }) {
    const { difficulty, category, theme, todayTheme } = filters;

    const rankingScore = this.calcRankingScore({ cpm: metrics.cpm, kpm: metrics.kpm });

    const payload = {
      name,
      uid,
      rankingScore,
      cpm: metrics.cpm,
      kpm: metrics.kpm,
      rank: metrics.rank,
      eff: Math.round(metrics.eff * 10000) / 10000,
      wpm: metrics.wpm,
      diff: metrics.diff,
      seconds: metrics.seconds,
      typedLength: metrics.typedLength,
      keystrokes: metrics.keystrokes,
      createdAt: serverTimestamp(),

      // 出題メタ（表示/分析用）
      itemDifficulty: itemMeta.itemDifficulty ?? "",
      itemCategory: itemMeta.itemCategory ?? "",
      itemTheme: itemMeta.itemTheme ?? "",
      itemLength: itemMeta.itemLength ?? 0,
      itemPunct: itemMeta.itemPunct ?? 0,
      itemKataRatio: itemMeta.itemKataRatio ?? 0
    };

    const boards = [
      { scope: "overall" },
      { scope: "category" },
      { scope: "theme" },
      { scope: "daily" }
    ];

    const tasks = boards.map(({ scope }) => {
      const col = this.collectionName({
        scope,
        difficulty,
        category,
        theme,
        todayTheme
      });
      return addDoc(collection(this.db, col), payload);
    });

    await Promise.allSettled(tasks);
    return { ok: true, rankingScore };
  }

  // TOP10取得
  async loadTop10({ scope, difficulty, category, theme, todayTheme }) {
    const col = this.collectionName({ scope, difficulty, category, theme, todayTheme });
    const q = query(
      collection(this.db, col),
      orderBy("rankingScore", "desc"),
      orderBy("cpm", "desc"),
      limit(10)
    );
    const snap = await getDocs(q);
    const rows = [];
    snap.forEach(d => rows.push({ id: d.id, ...d.data() }));
    return rows;
  }

  // 描画
  renderList(ul, rows) {
    ul.innerHTML = "";
    if (!rows.length) {
      const li = document.createElement("li");
      li.textContent = "まだスコアがありません。";
      ul.appendChild(li);
      return;
    }
    for (const r of rows) {
      const li = document.createElement("li");
      li.textContent =
        `${r.name}｜Score ${r.rankingScore}｜CPM ${r.cpm}｜KPM ${r.kpm}｜${r.rank}`;
      ul.appendChild(li);
    }
  }
}
