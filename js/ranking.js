// js/ranking.js
import {
  getFirestore, collection, addDoc, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

export class RankingService {
  constructor(app) {
    this.db = getFirestore(app);
  }

  calcRankingScore(cpm, kpm) {
    return Math.round(
      cpm + (cpm / kpm) * 100 - (kpm - cpm) * 0.3
    );
  }

  async saveDaily({ name, theme, dailyTheme, metrics }) {
    // ★ 今日のテーマ以外は絶対に保存しない
    if (theme !== dailyTheme) return;

    const score = {
      name,
      theme,
      cpm: metrics.cpm,
      kpm: metrics.kpm,
      rank: metrics.rank,
      rankingScore: this.calcRankingScore(metrics.cpm, metrics.kpm),
      timestamp: serverTimestamp()
    };

    await addDoc(
      collection(this.db, `scores__daily__${dailyTheme}`),
      score
    );
  }
}
