import {
  collection, addDoc, getDocs, query, orderBy, limit, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

function toSafeKey(s) {
  return String(s)
    .normalize("NFKC")
    .replace(/\s+/g, "_")
    .replace(/[\/\\?%*:|"<>]/g, "_")
    .replace(/[^0-9A-Za-zぁ-んァ-ン一-龥_（）()・、。-]/g, "_")
    .slice(0, 120);
}
function todayKey() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export class RankingService {
  constructor({ db, auth }) {
    this.db = db;
    this.auth = auth;
  }

  // スコープ別コレクション名（scores__***）
  // daily は「今日」だけのランキングにするため日付を含める
  getCollectionName({ scope, difficultyKey, categoryKey, themeKey, dailyThemeKey }) {
    const diffKey = difficultyKey || "diff_all";

    if (scope === "overall") {
      return `scores__rk_overall__${diffKey}`;
    }
    if (scope === "daily") {
      // 今日のテーマ（テーマ + 日付で日別固定）
      const t = dailyThemeKey || "no_theme";
      return `scores__rk_daily__${toSafeKey(t)}__${todayKey()}__${diffKey}`;
    }
    if (scope === "category") {
      const c = categoryKey || "all";
      return `scores__rk_category__${toSafeKey(c)}__${diffKey}`;
    }
    if (scope === "theme") {
      const t = themeKey || "all";
      return `scores__rk_theme__${toSafeKey(t)}__${diffKey}`;
    }
    return `scores__rk_overall__${diffKey}`;
  }

  // ①②：rankingScoreで並べる・CPM/KPM/ランク表示
  async loadTop10({ scope, keys }) {
    const colName = this.getCollectionName({ scope, ...keys });
    const q = query(collection(this.db, colName), orderBy("rankingScore", "desc"), limit(10));
    const snap = await getDocs(q);

    const rows = [];
    snap.forEach(docu => rows.push(docu.data()));
    return rows;
  }

  // ⑥：完了時に自動記録（スコア送信ボタン不要）
  // 1回の完了で、4ボード（overall/daily/category/theme）へ保存
  async saveScoreToBoards({ score, keys }) {
    const user = this.auth.currentUser;
    if (!user) throw new Error("auth_not_ready");

    // 認証必須（本番ルール）
    const targets = ["overall", "daily", "category", "theme"].map(scope => {
      const colName = this.getCollectionName({ scope, ...keys });
      return addDoc(collection(this.db, colName), {
        ...score,
        createdAt: serverTimestamp()
      });
    });

    await Promise.allSettled(targets);
  }

  // 個人履歴：users/{uid}/histories に保存（端末=auth.uid、内部にlocalUser）
  historiesRef() {
    const uid = this.auth.currentUser?.uid;
    if (!uid) throw new Error("auth_not_ready");
    return collection(this.db, `users/${uid}/histories`);
  }

  async saveHistory({ record }) {
    const ref = this.historiesRef();
    await addDoc(ref, { ...record, createdAt: serverTimestamp() });
  }

  // 選択ユーザーのみの履歴を取得（localUserでフィルタはクライアント側）
  async loadHistories({ max = 300 }) {
    const ref = this.historiesRef();
    const q = query(ref, orderBy("createdAt", "desc"), limit(max));
    const snap = await getDocs(q);
    const rows = [];
    snap.forEach(docu => rows.push(docu.data()));
    return rows;
  }
}
