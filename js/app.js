// js/app.js
import { initFirebase } from "./firebase.js";
import { TypingEngine } from "./typingEngine.js";
import { RankingService } from "./ranking.js";
import { UserManager } from "./userManager.js";

function $(id){ return document.getElementById(id); }

function todayKey(){
  const d=new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
}
function hashString(str){
  let h=2166136261;
  for(let i=0;i<str.length;i++){
    h ^= str.charCodeAt(i);
    h = Math.imul(h,16777619);
  }
  return (h>>>0);
}

async function loadTrivia(){
  const res = await fetch("./data/trivia.json",{cache:"no-store"});
  if(!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = await res.json();
  if(!Array.isArray(json)) throw new Error("JSON配列ではありません");
  return json;
}

window.addEventListener("DOMContentLoaded", async () => {
  const authStateEl = $("authState");
  const todayThemeEl = $("todayTheme");

  const { db, onAuthReady, getUid } = initFirebase({
    onAuthState: (t) => { if (authStateEl) authStateEl.textContent = t; }
  });

  let items = [];
  try {
    items = await loadTrivia();
  } catch (e) {
    alert(`JSON読み込み失敗: ${e?.message ?? e}\nfile://直開きは不可。GitHub Pagesかローカルサーバで開いてください。`);
    return;
  }

  const themes = Array.from(new Set(items.map(x => x?.theme).filter(Boolean)));
  if (!themes.length) {
    alert("theme が見つかりません。trivia.json の各要素に theme を入れてください。");
    return;
  }

  const dailyTheme = themes[hashString(todayKey()) % themes.length];
  if (todayThemeEl) todayThemeEl.textContent = `今日のテーマ：${dailyTheme}`;

  // 今日テーマの問題だけ出す（混入しない）
  const dailyPool = () => items.filter(x => x?.text && x?.theme === dailyTheme);

  let currentItem = null;
  const pick = () => {
    const pool = dailyPool();
    if (!pool.length) return null;
    return pool[Math.floor(Math.random() * pool.length)];
  };

  currentItem = pick();
  if (!currentItem) {
    alert("今日のテーマに該当する問題がありません。trivia.json を確認してください。");
    return;
  }

  // 端末ユーザー
  const users = new UserManager($("userSelect"));
  $("addUser")?.addEventListener("click", () => {
    const n = prompt("ユーザー名（端末内最大10名）");
    if (n) users.add(n);
  });
  $("userSelect")?.addEventListener("change", (e) => users.select(e.target.value));

  // Ranking
  const ranking = new RankingService({ db });

  // Typing
  const engine = new TypingEngine({
    textEl: $("text"),
    inputEl: $("input"),
    getTargetText: () => currentItem?.text ?? "",
    onComplete: async (m) => {
      await onAuthReady();
      const uid = getUid();
      if (!uid) { alert("匿名認証が未完了です。再読み込みしてください。"); return; }

      const name = users.current || "NoName";

      // ★日替わりテーマ以外は保存しない（ranking側で遮断）
      await ranking.saveDaily({
        uid,
        name,
        dailyTheme,
        itemTheme: currentItem.theme,
        difficultyKey: "diff_all", // 完全版の難易度キーに接続するならここを差し替え
        cpm: m.cpm,
        kpm: m.kpm,
        rank: m.rank
      });

      // 今日のテーマTOP10を表示（DOMがある場合）
      const listEl = $("dailyRanking");
      if (listEl) {
        const rows = await ranking.loadDailyTop10({ dailyTheme, difficultyKey: "diff_all" });
        listEl.innerHTML = "";
        if (!rows.length) {
          const li = document.createElement("li");
          li.textContent = "まだスコアがありません。";
          listEl.appendChild(li);
        } else {
          for (const r of rows) {
            const li = document.createElement("li");
            li.textContent = RankingService.formatRow(r);
            listEl.appendChild(li);
          }
        }
      }

      // 次の問題
      currentItem = pick();
      if (!currentItem) return;
      engine.setText(currentItem.text);
    }
  });

  engine.setText(currentItem.text);
  engine.bind();

  $("startBtn")?.addEventListener("click", () => engine.startCountdown());
  $("nextBtn")?.addEventListener("click", () => {
    currentItem = pick();
    if (currentItem) engine.setText(currentItem.text);
  });

  // 初回ランキング表示
  try {
    const listEl = $("dailyRanking");
    if (listEl) {
      const rows = await ranking.loadDailyTop10({ dailyTheme, difficultyKey: "diff_all" });
      listEl.innerHTML = "";
      for (const r of rows) {
        const li = document.createElement("li");
        li.textContent = RankingService.formatRow(r);
        listEl.appendChild(li);
      }
    }
  } catch {}
});
