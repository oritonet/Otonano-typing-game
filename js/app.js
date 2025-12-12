// ===============================
// app.js（完全統合・修正版）
// ===============================

import { initTypingEngine } from "./typingEngine.js";
import { initRanking } from "./ranking.js";
import { initUserManager } from "./userManager.js";

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import {
  getFirestore
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import {
  getAuth,
  signInAnonymously,
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";

/* ===============================
   Firebase 初期化
=============================== */
const firebaseConfig = {
  apiKey: "AIzaSyAqDSPE_HkPbi-J-SqPL4Ys-wR4RaA8wKA",
  authDomain: "otonano-typing-game.firebaseapp.com",
  projectId: "otonano-typing-game",
  storageBucket: "otonano-typing-game.appspot.com",
  messagingSenderId: "475283850178",
  appId: "1:475283850178:web:193d28f17be20a232f4c5b"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);

/* ===============================
   DOM
=============================== */
const difficultySelect = document.getElementById("difficulty");
const categorySelect   = document.getElementById("category");
const themeSelect      = document.getElementById("theme");
const dailyThemeChk    = document.getElementById("dailyTheme");
const dailyInfo        = document.getElementById("dailyInfo");

const textEl   = document.getElementById("text");
const inputEl  = document.getElementById("input");
const startBtn = document.getElementById("startBtn");
const skipBtn  = document.getElementById("skipBtn");

const authBadge = document.getElementById("authBadge");

/* ===============================
   状態
=============================== */
let uid = null;
let trivia = [];
let currentItem = null;
let typingEngine = null;
let ranking = null;
let userManager = null;

/* ===============================
   Utils
=============================== */
function todayKey() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
}

/* ===============================
   JSON 読み込み
=============================== */
async function loadTrivia() {
  const res = await fetch("./data/trivia.json", { cache: "no-store" });
  trivia = await res.json();
}

/* ===============================
   Select 初期化（空対策）
=============================== */
function initSelects() {
  // 難易度
  difficultySelect.innerHTML = `
    <option value="all">難易度：すべて</option>
    <option value="easy">かんたん</option>
    <option value="normal">ふつう</option>
    <option value="hard">むずかしい</option>
  `;

  // カテゴリ
  const categories = [...new Set(trivia.map(t => t.category).filter(Boolean))];
  categorySelect.innerHTML =
    `<option value="all">カテゴリ：すべて</option>` +
    categories.map(c => `<option value="${c}">${c}</option>`).join("");

  // テーマ
  const themes = [...new Set(trivia.map(t => t.theme).filter(Boolean))];
  themeSelect.innerHTML =
    `<option value="all">テーマ：すべて</option>` +
    themes.map(t => `<option value="${t}">${t}</option>`).join("");
}

/* ===============================
   今日のテーマ
=============================== */
function getTodayTheme() {
  const themes = [...new Set(trivia.map(t => t.theme))];
  if (!themes.length) return null;
  const idx = Math.abs(
    [...todayKey()].reduce((a,c)=>a+c.charCodeAt(0),0)
  ) % themes.length;
  return themes[idx];
}

/* ===============================
   出題選択
=============================== */
function pickItem() {
  let pool = [...trivia];

  if (dailyThemeChk.checked) {
    const todayTheme = getTodayTheme();
    pool = pool.filter(t => t.theme === todayTheme);
    dailyInfo.textContent = `今日（${todayKey()}）のテーマ：${todayTheme}`;
    dailyInfo.style.display = "block";
  } else {
    dailyInfo.style.display = "none";
  }

  if (categorySelect.value !== "all") {
    pool = pool.filter(t => t.category === categorySelect.value);
  }
  if (themeSelect.value !== "all") {
    pool = pool.filter(t => t.theme === themeSelect.value);
  }

  if (!pool.length) return null;
  return pool[Math.floor(Math.random() * pool.length)];
}

/* ===============================
   新しい文章
=============================== */
function setNewText() {
  currentItem = pickItem() || trivia[0];
  if (!currentItem) return;

  textEl.textContent = "";
  typingEngine.setText(currentItem.text);
  inputEl.value = "";
  inputEl.disabled = true;
}

/* ===============================
   メイン初期化
=============================== */
window.addEventListener("DOMContentLoaded", async () => {

  textEl.textContent = "読み込み中...";

  // Firebase 認証
  await signInAnonymously(auth);
  onAuthStateChanged(auth, user => {
    if (user) {
      uid = user.uid;
      authBadge.textContent = "認証：OK（匿名）";
    }
  });

  // JSON
  await loadTrivia();
  initSelects();

  // ユーザー管理
  userManager = initUserManager(db, auth);
  userManager.init();

  // ランキング
  ranking = initRanking(db);

  // タイピングエンジン
  typingEngine = initTypingEngine({
    inputEl,
    textEl,
    onFinish: (result) => {
      ranking.saveScore({
        uid,
        user: userManager.getCurrentUser(),
        item: currentItem,
        result
      });
      ranking.reload();
    }
  });

  // UI イベント
  startBtn.addEventListener("click", () => {
    typingEngine.start();
  });

  skipBtn.addEventListener("click", () => {
    setNewText();
  });

  difficultySelect.addEventListener("change", setNewText);
  categorySelect.addEventListener("change", setNewText);
  themeSelect.addEventListener("change", setNewText);
  dailyThemeChk.addEventListener("change", setNewText);

  setNewText();
});
