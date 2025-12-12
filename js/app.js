// js/app.js
import { initFirebase } from "./firebase.js";
import { TypingEngine } from "./typingEngine.js";
import { RankingService } from "./ranking.js";
import { UserManager } from "./userManager.js";

function $(id) { return document.getElementById(id); }

function showError(msg) {
  const box = $("errorBox");
  box.style.display = "block";
  box.textContent = msg;
}

function clearError() {
  const box = $("errorBox");
  box.style.display = "none";
  box.textContent = "";
}

function todayKey() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function hashString(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0);
}

async function loadTriviaJson() {
  // 重要：file:// だとここが失敗しやすい。必ず http(s) で開く。
  const res = await fetch("./data/trivia.json", { cache: "no-store" });
  if (!res.ok) throw new Error(`JSON取得に失敗: HTTP ${res.status}`);
  const json = await res.json();
  if (!Array.isArray(json)) throw new Error("trivia.json が配列(JSON array)ではありません");
  return json;
}

window.addEventListener("DOMContentLoaded", async () => {
  clearError();

  // UI
  const authStateEl = $("authState");
  const todayThemeEl = $("todayTheme");
  const textEl = $("text");
  const inputEl = $("input");

  // 端末ユーザー（localStorage）
  const users = new UserManager($("userSelect"));
  $("addUser").addEventListener("click", () => {
    const n = prompt("この端末で使うユーザー名（最大10名）");
    if (n) users.add(n.trim());
  });
  $("userSelect").addEventListener("change", (e) => users.select(e.target.value));

  // Firebase 初期化（匿名認証必須）
  const { app, db, auth, onAuthReady, getUid } = initFirebase({
    onAuthState: (stateText) => { authStateEl.textContent = stateText; }
  });

  // JSON 読込
  let items = [];
  try {
    items = await loadTriviaJson();
  } catch (e) {
    showError(
      "trivia.json の読み込みに失敗しました。\n" +
      "・GitHub Pages かローカルサーバで開いていますか？（file:// は不可）\n" +
      "・data/trivia.json の場所は index.html と同階層の data/ ですか？\n\n" +
      `詳細: ${e?.message ?? e}`
    );
    textEl.textContent = "データ読み込みエラー";
    inputEl.disabled = true;
    return;
  }

  // theme一覧 -> 今日のテーマ
  const themes = Array.from(new Set(items.map(x => x?.theme).filter(Boolean)));
  if (themes.length === 0) {
    showError("trivia.json に theme が見つかりません。各要素に theme を入れてください。");
    textEl.textContent = "theme がありません";
    inputEl.disabled = true;
    return;
  }
  const dailyTheme = themes[hashString(todayKey()) % themes.length];
  todayThemeEl.textContent = `今日のテーマ：${dailyTheme}`;

  // 出題プール（今日テーマのみ）
  function pickDailyItem() {
    const pool = items.filter(x => x?.text && x?.theme === dailyTheme);
    if (pool.length === 0) return null;
    return pool[Math.floor(Math.random() * pool.length)];
  }

  let currentItem = pickDailyItem();
  if (!currentItem) {
    showError("今日のテーマに該当する文章がありません。trivia.json の theme を確認してください。");
    textEl.textContent = "出題できません";
    inputEl.disabled = true;
    return;
  }

  // ランキング（今日テーマ専用・混入防止）
  const ranking = new RankingService({ db });

  // TypingEngine（IME対応・カウント表示・確定後のみ判定・一致即終了）
  const engine = new TypingEngine({
    textEl,
    inputEl,
    getTargetText: () => currentItem?.text ?? "",
    onComplete: async (metrics) => {
      // 認証準備完了まで待つ（ここが抜けると「認証できない」に見える）
      await onAuthReady();

      const uid = getUid();
      if (!uid) {
        showError("匿名認証が完了していません。ページを再読み込みしてください。");
        return;
      }

      // ★ 今日テーマ以外は保存しない（厳密）
      await ranking.saveDailyOnly({
        uid,
        displayName: users.current || "NoName",
        dailyTheme,
        itemTheme: currentItem.theme,
        metrics
      });

      // 次の問題へ
      currentItem = pickDailyItem();
      if (!currentItem) {
        showError("次の問題が選べません（今日テーマの文章がありません）。");
        return;
      }
      engine.setText(currentItem.text);
    }
  });

  engine.setText(currentItem.text);
  engine.bind();

  $("startBtn").addEventListener("click", async () => {
    await engine.startCountdown();
  });

  $("nextBtn").addEventListener("click", () => {
    currentItem = pickDailyItem();
    if (!currentItem) return;
    engine.setText(currentItem.text);
    // 自動開始したいならここで startCountdown() を呼ぶ
  });

  // 認証の完了を待てるようにする（表示更新）
  onAuthReady().catch((e) => {
    showError(`匿名認証に失敗: ${e?.message ?? e}`);
  });
});
