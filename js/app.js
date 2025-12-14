// js/app.js
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import {
  getFirestore,
  collection,
  addDoc,
  getDocs,
  query,
  where,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import {
  getAuth,
  signInAnonymously,
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";

import { UserManager } from "./userManager.js";
import { TypingEngine } from "./typingEngine.js";
import { RankingService } from "./ranking.js";
import { GroupService } from "./groupService.js";

/* =========================
   Firebase
========================= */
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

/* =========================
   DOM
========================= */
const authBadge = document.getElementById("authBadge");
const metaInfoEl = document.getElementById("metaInfo");

const userSelect = document.getElementById("userSelect");
const addUserBtn = document.getElementById("addUserBtn");
const renameUserBtn = document.getElementById("renameUserBtn");
const deleteUserBtn = document.getElementById("deleteUserBtn");

const difficultyEl = document.getElementById("difficulty");
const lengthGroupEl = document.getElementById("lengthGroup");
const categoryEl = document.getElementById("category");
const themeEl = document.getElementById("theme");

// 元の app.js は dailyThemeEl を参照しているため残す（HTML 側に無い場合も落ちないよう後でガード）
const dailyThemeEl = document.getElementById("dailyTask");
// 元の index.html では dailyTask だが、ここは元コードを維持する
const dailyInfoEl = document.getElementById("dailyInfo");

const skipBtn = document.getElementById("skipBtn");
const startBtn = document.getElementById("startBtn");
const inputEl = document.getElementById("input");
const textEl = document.getElementById("text");
const resultEl = document.getElementById("result");

const dailyRankLabel = document.getElementById("dailyRankLabel");
const dailyRankingUL = document.getElementById("dailyRanking");

// 元の app.js は rankScopeEl / rankLabel を参照しているため残す（HTML 側に無い場合も落ちないよう後でガード）
const rankScopeEl = document.getElementById("rankScope");
const rankLabel = document.getElementById("rankLabel");
const rankingUL = document.getElementById("ranking");

const bestByDifficultyUL = document.getElementById("bestByDifficulty");
const compareTodayEl = document.getElementById("compareToday");
const scoreChart = document.getElementById("scoreChart");
const myRecentUL = document.getElementById("myRecent");
const analyticsLabel = document.getElementById("analyticsLabel");

const modalBackdrop = document.getElementById("resultModalBackdrop");
const closeModalBtn = document.getElementById("closeModalBtn");
const nextBtn = document.getElementById("nextBtn");

const mRank = document.getElementById("mRank");
const mCPM = document.getElementById("mCPM");
const mTimeSec = document.getElementById("mTimeSec");
const mLen = document.getElementById("mLen");
const mMeta = document.getElementById("mMeta");

/* =========================
   DOM（グループ機能 追加）
   ※HTMLに無い場合は null のままなので、後で必ずガードする
========================= */
const currentGroupSelect = document.getElementById("currentGroupSelect");
const leaveGroupBtn = document.getElementById("leaveGroupBtn");
const deleteGroupBtn = document.getElementById("deleteGroupBtn");

const groupCreateNameEl = document.getElementById("groupCreateName");
const groupCreateBtn = document.getElementById("groupCreateBtn");

const groupSearchInput = document.getElementById("groupSearchInput");
const groupSearchBtn = document.getElementById("groupSearchBtn");
const groupSearchResult = document.getElementById("groupSearchResult");

const pendingBox = document.getElementById("pendingBox");
const pendingList = document.getElementById("pendingList");

/* =========================
   表示用：難度（統合タブ 1つ）
========================= */
let activeDiffTab = "normal"; // easy/normal/hard

function setActiveDiffTab(diff, { syncDifficultySelect = false } = {}) {
  if (!diff) return;
  activeDiffTab = diff;

  // 統合タブの見た目更新
  document.querySelectorAll("#diffTabsUnified .diffTab").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.diff === activeDiffTab);
  });

  // 出題側セレクトと同期（必要時）
  if (syncDifficultySelect && difficultyEl) {
    difficultyEl.value = activeDiffTab;
  }
}

/* =========================
   Utils
========================= */
function getDailyLengthByDifficulty(diff) {
  if (diff === "easy") return "xs";       // 易 → 極短
  if (diff === "normal") return "medium"; // 普 → 中
  if (diff === "hard") return "xl";       // 難 → 極長
  return null;
}

function pickDailyItem(pool, difficulty, dateKey) {
  if (!pool.length) return null;
  const seed = `${dateKey}-${difficulty}`;
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  }
  const idx = hash % pool.length;
  return pool[idx];
}

function rankByScore(score) {
  if (score >= 800) return "SSS";
  if (score >= 700) return "SS";
  if (score >= 600) return "S";
  if (score >= 500) return "A";
  if (score >= 400) return "B";
  if (score >= 300) return "C";
  return "D";
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

// 記号スコア（IME入力の負荷を反映）
// 強・中・弱・基本の4段階
function punctScore(text) {
  // 強い記号：ペア管理・判断負荷が高い
  const strong = (text.match(/[（）「」『』［］【】＜＞”’]/g) || []).length;

  // 中程度：Shift必須・意味は明確
  const middle = (text.match(/[￥＄：；]/g) || []).length;

  // 軽め：頻出だがミス源
  const weak = (text.match(/[ー・＃％＆＋－＝／]/g) || []).length;

  // 基本的な句読点
  const basic = (text.match(/[、。,.!！?？]/g) || []).length;

  // 重み付け（中で合算 → 難易度側でまとめて評価）
  return strong * 3 + middle * 2 + weak * 1 + basic * 1;
}

function digitCount(text) {
  return (text.match(/[0-9]/g) || []).length;
}

function kanjiRatio(text) {
  const total = text.length || 1;
  const kanji = (text.match(/[一-龥]/g) || []).length;
  return kanji / total;
}

/* =========================
   難易度：3段階（出題用）
========================= */
function difficultyByText(text) {
  const score =
    kanjiRatio(text) * 100 +
    punctScore(text) * 6 +
    digitCount(text) * 10;

  if (score < 35) return "easy";     // 易
  if (score < 65) return "normal";   // 普
  return "hard";                     // 難
}

function diffLabel(v) {
  if (v === "easy") return "易";
  if (v === "normal") return "普";
  if (v === "hard") return "難";
  return "-";
}

/* =========================
   文章長：5段階
========================= */
function lengthGroupOf(len) {
  if (len <= 20) return "xs";        // 極短
  if (len <= 40) return "short";     // 短
  if (len <= 80) return "medium";    // 中
  if (len <= 140) return "long";     // 長
  return "xl";                       // 極長
}

function lengthLabel(v) {
  if (v === "xs") return "極短";
  if (v === "short") return "短";
  if (v === "medium") return "中";
  if (v === "long") return "長";
  if (v === "xl") return "極長";
  return "-";
}

function showModal() {
  modalBackdrop.style.display = "flex";
  modalBackdrop.setAttribute("aria-hidden", "false");
}
function hideModal() {
  modalBackdrop.style.display = "none";
  modalBackdrop.setAttribute("aria-hidden", "true");
}

function escapeHtml(s) {
  return String(s)
    .replaceAll("&","&amp;")
    .replaceAll("<","&lt;")
    .replaceAll(">","&gt;")
    .replaceAll('"',"&quot;")
    .replaceAll("'","&#039;");
}

/* =========================
   Services
========================= */
// userManager.js が db を必要とする版でも動くよう db を渡す
const userMgr = new UserManager({
  selectEl: userSelect,
  addBtn: addUserBtn,
  renameBtn: renameUserBtn,
  deleteBtn: deleteUserBtn,
  db
});

const rankingSvc = new RankingService({ db });
const groupSvc = new GroupService(db);

/* =========================
   グループ状態（追加）
========================= */
const GROUP_STORAGE_KEY = "typing_current_group_v1";
let currentGroupId = "";      // "" = 個人
let currentGroupRole = null;  // owner/member/null

function hasGroupUI() {
  return !!(currentGroupSelect && leaveGroupBtn && deleteGroupBtn && groupCreateBtn && groupSearchBtn && groupSearchResult && pendingBox && pendingList);
}

/* =========================
   Trivia data
========================= */
let items = []; // enriched
let categories = [];
let themeByCategory = new Map();
let allThemes = [];
let dailyTheme = null;

function getBasePath() {
  const p = location.pathname;
  if (p.endsWith("/")) return p.slice(0, -1);
  return p.replace(/\/index\.html$/, "");
}

async function loadTrivia() {
  const tryUrls = [
    "./data/trivia.json",
    `${getBasePath()}/data/trivia.json`
  ];

  let lastErr = null;
  for (const url of tryUrls) {
    try {
      const res = await fetch(url, { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status} (${url})`);
      const json = await res.json();
      if (!Array.isArray(json)) throw new Error(`JSON is not array (${url})`);
      return json;
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr ?? new Error("fetch failed");
}

function buildIndices(raw) {
  items = raw
    .filter(x => x && typeof x.text === "string")
    .map(x => {
      const len = (typeof x.length === "number") ? x.length : x.text.length;

      const difficulty = difficultyByText(x.text);  // easy/normal/hard
      const lengthGroup = lengthGroupOf(len);       // xs/short/medium/long/xl

      return {
        genre: x.genre ?? "",
        category: x.category ?? "",
        theme: x.theme ?? "",
        text: x.text,
        length: len,
        difficulty,
        lengthGroup
      };
    });

  categories = Array.from(new Set(items.map(x => x.category).filter(Boolean)))
    .sort((a, b) => a.localeCompare(b, "ja"));

  themeByCategory = new Map();
  for (const c of categories) themeByCategory.set(c, new Set());
  for (const it of items) {
    if (!it.category || !it.theme) continue;
    if (!themeByCategory.has(it.category)) themeByCategory.set(it.category, new Set());
    themeByCategory.get(it.category).add(it.theme);
  }

  allThemes = Array.from(new Set(items.map(x => x.theme).filter(Boolean)))
    .sort((a, b) => a.localeCompare(b, "ja"));

  dailyTheme = (allThemes.length > 0)
    ? allThemes[hashString(todayKey()) % allThemes.length]
    : null;
}

/* =========================
   UI Hydrate
========================= */
function hydrateSelects() {
  difficultyEl.innerHTML = `
    <option value="easy">難度：易</option>
    <option value="normal" selected>難度：普</option>
    <option value="hard">難度：難</option>
  `;

  lengthGroupEl.innerHTML = `
    <option value="xs">長さ：極短</option>
    <option value="short">長さ：短</option>
    <option value="medium" selected>長さ：中</option>
    <option value="long">長さ：長</option>
    <option value="xl">長さ：極長</option>
  `;

  categoryEl.innerHTML =
    `<option value="all">カテゴリ：すべて</option>` +
    categories.map(c => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join("");

  themeEl.innerHTML = `<option value="all">テーマ：すべて</option>`;

  // rankScopeEl が存在するHTMLの場合のみ初期化（存在しない場合は何もしない）
  if (rankScopeEl) {
    rankScopeEl.innerHTML = `
      <option value="overall">ランキング：全体</option>
      <option value="category">ランキング：現在のカテゴリ</option>
      <option value="theme">ランキング：現在のテーマ</option>
    `;
  }
}

function applyThemeOptionsByCategory() {
  // dailyThemeEl が無いHTMLの場合は「今日テーマ固定」機能をオフとして扱う
  const daily = !!(dailyThemeEl && dailyThemeEl.checked && !!dailyTheme);
  // ★今日の課題中は文章長を固定（操作不可）
  if (lengthGroupEl) {
    lengthGroupEl.disabled = daily;
  }


  if (daily) {
    themeEl.disabled = true;
    categoryEl.disabled = true;
    themeEl.innerHTML = `<option value="${escapeHtml(dailyTheme)}">${escapeHtml(dailyTheme)}</option>`;
    themeEl.value = dailyTheme;
    if (dailyInfoEl) {
      dailyInfoEl.style.display = "block";
      dailyInfoEl.textContent = `今日（${todayKey()}）のテーマ：${dailyTheme}（固定中）`;
    }
    return;
  }

  themeEl.disabled = false;
  categoryEl.disabled = false;
  if (dailyInfoEl) {
    dailyInfoEl.style.display = "none";
    dailyInfoEl.textContent = "";
  }

  const cat = categoryEl.value;
  const current = themeEl.value;

  let themes = [];
  if (cat === "all") {
    themes = allThemes;
  } else {
    const set = themeByCategory.get(cat);
    themes = set ? Array.from(set).sort((a, b) => a.localeCompare(b, "ja")) : [];
  }

  themeEl.innerHTML =
    `<option value="all">テーマ：すべて</option>` +
    themes.map(t => `<option value="${escapeHtml(t)}">${escapeHtml(t)}</option>`).join("");

  themeEl.value = themes.includes(current) ? current : "all";
}

function getActiveFilters() {
  const daily = !!(dailyThemeEl && dailyThemeEl.checked && !!dailyTheme);
  const difficulty = difficultyEl.value;

  // ★今日の課題中は lengthGroup を難度で強制
  const lengthGroup = daily
    ? getDailyLengthByDifficulty(difficulty)
    : lengthGroupEl.value;

  const category = daily ? "all" : categoryEl.value;
  const theme = daily ? dailyTheme : themeEl.value;

  return { daily, difficulty, lengthGroup, category, theme };
}


function filterPool() {
  const { daily, difficulty, lengthGroup, category, theme } = getActiveFilters();
  return items.filter(x => {
    if (x.difficulty !== difficulty) return false;
    if (x.lengthGroup !== lengthGroup) return false;
    if (!daily && category !== "all" && x.category !== category) return false;
    if (theme !== "all" && x.theme !== theme) return false;
    return true;
  });
}

/* =========================
   Recent history (10問再出題回避)
========================= */
const HISTORY_MAX = 10;
const recentTexts = [];
function pushHistory(text) {
  if (!text) return;
  recentTexts.unshift(text);
  if (recentTexts.length > HISTORY_MAX) recentTexts.length = HISTORY_MAX;
}
function isRecentlyUsed(text) {
  return recentTexts.includes(text);
}
function pickNextItem(pool) {
  if (pool.length === 0) return null;
  const notRecent = pool.filter(x => !isRecentlyUsed(x.text));
  const candidates = (notRecent.length > 0) ? notRecent : pool;
  return candidates[Math.floor(Math.random() * candidates.length)];
}

/* =========================
   Typing Engine
========================= */
let currentItem = null;

const engine = new TypingEngine({
  textEl,
  inputEl,
  resultEl,
  onFinish: async ({ metrics, meta }) => {
    await onFinished(metrics, meta);
  }
});

engine.attach();

/* =========================
   Countdown + Start
========================= */
let countdownTimer = null;

async function startWithCountdown() {
  if (!currentItem) return;

  // スタートボタンを隠す（入力欄クリックを邪魔しない）
  startBtn.style.display = "none";

  // カウント中に連打させない
  startBtn.disabled = true;
  skipBtn.disabled = true;

  // 開始前ガイドの中央揃えを解除
  inputEl.classList.remove("input-guide");

  engine.showCountdownInTextarea(3);
  let n = 3;

  if (countdownTimer) clearInterval(countdownTimer);

  countdownTimer = setInterval(() => {
    n--;
    if (n >= 0) engine.showCountdownInTextarea(n);

    if (n <= 0) {
      clearInterval(countdownTimer);
      countdownTimer = null;

      // カウントダウン用スタイル解除（上下中央寄せを元に戻す）
      inputEl.classList.remove("countdown");
      inputEl.style.paddingTop = "";
      inputEl.style.paddingBottom = "";

      engine.enableReadyState();
      engine.startNow();

      startBtn.disabled = false;
      skipBtn.disabled = false;
    }
  }, 800);
}

/* =========================
   New question
========================= */
function setNewText() {
  const pool = filterPool();

  if (pool.length === 0) {
    currentItem = null;
    metaInfoEl.textContent = "- / -";
    engine.setTarget("該当する文章がありません。条件を変更してください。", null);
    textEl.textContent = "該当する文章がありません。条件を変更してください。";
    inputEl.value = "";
    inputEl.disabled = true;
    startBtn.style.display = "none";
    return;
  }

  const { daily, difficulty } = getActiveFilters();
  
  // ★今日の課題は「日付×難度」で1文固定
  const pick = daily
    ? pickDailyItem(pool, difficulty, todayKey())
    : pickNextItem(pool);

  currentItem = pick;

  // メタ情報表示（出題）
  const cat = pick.category ?? "-";
  const theme = pick.theme ?? "-";
  metaInfoEl.textContent = `${cat} / ${theme}`;

  pushHistory(pick.text);
  engine.setTarget(pick.text, pick);

  inputEl.value = "スペース or スタートボタンで入力開始";
  inputEl.disabled = true;
  inputEl.classList.add("input-guide");
  startBtn.style.display = "block";

  updateLabels();
}

/* =========================
   Ranking + Analytics
========================= */
function updateLabels() {
  const { lengthGroup, category, theme, daily } = getActiveFilters();
  const lenTxt = lengthLabel(lengthGroup);
  const diffTxt = diffLabel(activeDiffTab);

  const dailyThemeTxt = dailyTheme ?? "—";
  if (dailyRankLabel) {
    dailyRankLabel.textContent =
      `今日：${todayKey()} / 難度：${diffTxt} / 長さ：${lenTxt} / テーマ：${dailyThemeTxt}`;
  }

  // rankScopeEl が無いHTMLの場合は「全体」扱いでラベル更新を最低限にする
  const scope = rankScopeEl ? rankScopeEl.value : "overall";
  if (rankLabel) {
    if (scope === "overall") {
      rankLabel.textContent = `全体（難度：${diffTxt} / 長さ：${lenTxt}）`;
    }
    if (scope === "category") {
      const catTxt = (daily ? "（今日テーマ固定）" : (category === "all" ? "すべて" : category));
      rankLabel.textContent = `カテゴリ：${catTxt}（難度：${diffTxt} / 長さ：${lenTxt}）`;
    }
    if (scope === "theme") {
      const thTxt = (daily ? dailyThemeTxt : (theme === "all" ? "すべて" : theme));
      rankLabel.textContent = `テーマ：${thTxt}（難度：${diffTxt} / 長さ：${lenTxt}）`;
    }
  }

  if (analyticsLabel) {
    const thTxt = daily ? dailyThemeTxt : (theme === "all" ? "すべて" : theme);
    analyticsLabel.textContent = `難度：${diffTxt} / 長さ：${lenTxt} / テーマ：${thTxt}`;
  }
}

async function loadDailyRanking() {
  try {
    const { lengthGroup, difficulty } = getActiveFilters();

    // rankingSvc.loadDailyTheme があなたの ranking.js に存在する前提のコード（元のまま）
    // もし存在しない場合は、次ステップで ranking.js 側を合わせます
    const rows = await rankingSvc.loadDailyTheme({
      theme: dailyTheme,
      dateKey: todayKey(),
      difficulty: activeDiffTab,
      lengthGroup,
      groupId: currentGroupId ? currentGroupId : null
    });

    rankingSvc.renderList(dailyRankingUL, rows);
  } catch (e) {
    console.error("daily ranking load error", e);
    if (dailyRankingUL) dailyRankingUL.innerHTML = "<li>ランキングの読み込みに失敗しました</li>";
  }
}

async function loadRanking() {
  try {
    const { lengthGroup, category, theme, daily } = getActiveFilters();
    const scope = rankScopeEl ? rankScopeEl.value : "overall";

    const th = daily ? dailyTheme : theme;

    let rows = [];
    
    if (scope === "overall") {
      rows = await rankingSvc.loadOverall({
        difficulty: activeDiffTab,
        lengthGroup,
        groupId: currentGroupId ? currentGroupId : null
      });
    }
    
    if (scope === "category") {
      rows = await rankingSvc.loadByCategory({
        category,
        difficulty: activeDiffTab,
        lengthGroup,
        groupId: currentGroupId ? currentGroupId : null
      });
    }
    
    if (scope === "theme") {
      rows = await rankingSvc.loadByTheme({
        theme: th,
        difficulty: activeDiffTab,
        lengthGroup,
        groupId: currentGroupId ? currentGroupId : null
      });
    }


    rankingSvc.renderList(rankingUL, rows);
  } catch (e) {
    console.error("ranking load error", e);
    if (rankingUL) rankingUL.innerHTML = "<li>ランキングの読み込みに失敗しました</li>";
  }
}

/* =========================
   Analytics（選択ユーザー）
========================= */
function avg(arr) {
  if (!arr.length) return null;
  return Math.round(arr.reduce((s, x) => s + x, 0) / arr.length);
}

function renderBestForSelectedDifficulty(histories) {
  bestByDifficultyUL.innerHTML = "";
  if (!histories.length) {
    const li = document.createElement("li");
    li.textContent = `${diffLabel(activeDiffTab)}：まだ履歴がありません`;
    bestByDifficultyUL.appendChild(li);
    return;
  }
  const best = Math.max(...histories.map(h => Number(h.cpm ?? 0)));
  const li = document.createElement("li");
  li.textContent = `${diffLabel(activeDiffTab)}：TOP スコア ${best}`;
  bestByDifficultyUL.appendChild(li);
}

function renderRecent(histories) {
  myRecentUL.innerHTML = "";
  const slice = histories.slice(0, 12);
  if (!slice.length) {
    const li = document.createElement("li");
    li.textContent = "まだ履歴がありません。";
    myRecentUL.appendChild(li);
    return;
  }
  for (const h of slice) {
    const li = document.createElement("li");
    const userName = h.userName ?? "-";
    const rank = h.rank ?? "-";
    const score = Number(h.cpm ?? 0);
    const lg = lengthLabel(h.lengthGroup);
    const theme = h.theme ?? "-";

    // ★統一フォーマット：ユーザー名｜ランク｜スコア｜文章長｜テーマ
    li.textContent = `${userName}｜${rank}｜${score}｜${lg}｜${theme}`;
    myRecentUL.appendChild(li);
  }
}

function buildDailyBestSeries(histories) {
  const map = new Map(); // dateKey -> best cpm
  for (const h of histories) {
    if (!h.dateKey) continue;
    const v = Number(h.cpm ?? 0);
    if (!map.has(h.dateKey) || v > map.get(h.dateKey)) map.set(h.dateKey, v);
  }
  return Array.from(map.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([dateKey, score]) => ({ dateKey, score }));
}

function drawScoreChart(points) {
  const canvas = scoreChart;
  const ctx = canvas.getContext("2d");

  const cssW = canvas.clientWidth;
  const cssH = canvas.clientHeight;
  const dpr = window.devicePixelRatio || 1;

  canvas.width = Math.floor(cssW * dpr);
  canvas.height = Math.floor(cssH * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  ctx.clearRect(0, 0, cssW, cssH);

  ctx.fillStyle = "#555";
  ctx.font = "12px system-ui";
  ctx.fillText("スコア（CPM）推移：縦=スコア / 横=日付", 12, 14);

  if (!points.length) {
    ctx.fillText("履歴がありません。", 12, 34);
    return;
  }

  const pad = 28;
  const w = cssW - pad * 2;
  const h = cssH - pad * 2;

  const ys = points.map(p => p.score);
  const maxV = Math.max(...ys, 10);
  const minV = Math.min(...ys, 0);

  ctx.strokeStyle = "#ddd";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(pad, pad);
  ctx.lineTo(pad, pad + h);
  ctx.lineTo(pad + w, pad + h);
  ctx.stroke();

  ctx.strokeStyle = "#0b5ed7";
  ctx.lineWidth = 2;
  ctx.beginPath();

  const n = points.length;
  for (let i = 0; i < n; i++) {
    const x = pad + (n === 1 ? 0 : (i / (n - 1)) * w);
    const norm = (points[i].score - minV) / (maxV - minV || 1);
    const y = pad + h - norm * h;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();

  ctx.fillStyle = "#666";
  ctx.font = "10px system-ui";
  const step = Math.max(1, Math.floor(n / 6));
  for (let i = 0; i < n; i += step) {
    const x = pad + (n === 1 ? 0 : (i / (n - 1)) * w);
    const label = points[i].dateKey.slice(5); // MM-DD
    ctx.fillText(label, x - 12, pad + h + 14);
  }
}

function summarizeTodayScore(histories) {
  const tKey = todayKey();
  const todays = histories.filter(h => h.dateKey === tKey);
  if (!todays.length) return null;
  return { avg: avg(todays.map(h => h.cpm)), best: Math.max(...todays.map(h => h.cpm)) };
}

function summarize7daysScore(histories) {
  const now = Date.now();
  const cutoff = now - 7 * 24 * 60 * 60 * 1000;
  const last7 = histories.filter(h => h.createdAtMs && h.createdAtMs >= cutoff);
  if (!last7.length) return null;
  return { avg: avg(last7.map(h => h.cpm)), best: Math.max(...last7.map(h => h.cpm)) };
}

function formatCompareScore(todayObj, avg7Obj) {
  if (!compareTodayEl) return;

  if (!todayObj || !avg7Obj) {
    compareTodayEl.textContent = "データが不足しています（履歴が増えると表示されます）。";
    return;
  }
  const sign = (n) => (n > 0 ? `+${n}` : `${n}`);
  const avgDelta = todayObj.avg - avg7Obj.avg;
  const bestDelta = todayObj.best - avg7Obj.best;

  compareTodayEl.innerHTML =
    `今日：平均 ${todayObj.avg} / ベスト ${todayObj.best}<br>` +
    `過去7日平均：平均 ${avg7Obj.avg} / ベスト ${avg7Obj.best}<br>` +
    `差分：平均 ${sign(avgDelta)} / ベスト ${sign(bestDelta)}`;
}

async function loadMyAnalytics(uid, userName) {
  try {
    const colRef = collection(db, "scores");
    const q = query(colRef, where("uid", "==", uid));
    const snap = await getDocs(q);

    const rows = [];
    snap.forEach(docu => {
      const d = docu.data();
      const ts = d.createdAt;
      const ms = ts && typeof ts.toMillis === "function" ? ts.toMillis() : null;
      rows.push({
        userName: d.userName ?? "",
        dateKey: d.dateKey ?? "",
        difficulty: d.difficulty ?? "",
        lengthGroup: d.lengthGroup ?? "",
        theme: d.theme ?? "",
        rank: d.rank ?? "-",
        cpm: Number(d.cpm ?? 0),
        createdAtMs: ms
      });
    });

    const mineAll = rows.filter(r => r.userName === userName);

    mineAll.sort((a, b) => (b.createdAtMs ?? 0) - (a.createdAtMs ?? 0));

    const view = mineAll.filter(r => r.difficulty === activeDiffTab);

    renderRecent(view);
    renderBestForSelectedDifficulty(view);

    const series = buildDailyBestSeries(view);
    drawScoreChart(series);

    const t = summarizeTodayScore(view);
    const a7 = summarize7daysScore(view);
    formatCompareScore(t, a7);

    updateLabels();
  } catch (e) {
    console.error("analytics load error", e);
    if (bestByDifficultyUL) bestByDifficultyUL.innerHTML = "<li>分析の読み込みに失敗しました</li>";
    if (myRecentUL) myRecentUL.innerHTML = "<li>分析の読み込みに失敗しました</li>";
    if (compareTodayEl) compareTodayEl.textContent = "分析の読み込みに失敗しました。";
    drawScoreChart([]);
  }
}

/* =========================
   Save score (auto)
   ★ groupId を追加（ここが今回の要点）
========================= */
async function saveScoreToScoresCollection({ uid, userName, metrics, item }) {
  const score = metrics.cpm;
  const rank = rankByScore(score);

  await addDoc(collection(db, "scores"), {
    uid,
    userName,
    cpm: score,
    rank,
    difficulty: item.difficulty,
    lengthGroup: item.lengthGroup,
    category: item.category,
    theme: item.theme,
    dateKey: todayKey(),
    groupId: currentGroupId ? currentGroupId : null, // ★追加
    createdAt: serverTimestamp()
  });
}

/* =========================
   Finish handler
========================= */
async function onFinished(metrics, meta) {
  const user = auth.currentUser;
  if (!user) return;

  const userName = userMgr.getCurrentUserName() || "ゲスト";

  try {
    await saveScoreToScoresCollection({
      uid: user.uid,
      userName,
      metrics,
      item: meta
    });
  } catch (e) {
    console.error("save score failed", e);
  }

  const rank = rankByScore(metrics.cpm);
  mRank.textContent = rank;
  mCPM.textContent = String(metrics.cpm);
  mTimeSec.textContent = String(metrics.seconds ?? "-");
  mLen.textContent = String(metrics.length ?? "-");

  const th = meta?.theme ?? "-";
  const df = meta?.difficulty ?? "-";
  const lg = meta?.lengthGroup ?? "-";
  const groupTxt = currentGroupId ? ` / グループ：参加中` : ` / グループ：個人`;
  mMeta.textContent =
    `ユーザー：${userName} / 難度：${diffLabel(df)} / 文長：${lengthLabel(lg)} / テーマ：${th} / 日付：${todayKey()}${groupTxt}`;

  showModal();

  updateLabels();
  await loadDailyRanking();
  await loadRanking();
  await loadMyAnalytics(user.uid, userName);
}

/* =========================
   グループ機能（追加）
========================= */
async function refreshMyGroups() {
  if (!hasGroupUI()) return;

  const user = auth.currentUser;
  if (!user) return;

  // 参加中グループ一覧（approved）
  let groups = [];
  try {
    groups = await groupSvc.getMyGroups(user.uid);
  } catch (e) {
    console.error("getMyGroups failed", e);
    groups = [];
  }

  // select を構築
  currentGroupSelect.innerHTML = "";
  {
    const opt = document.createElement("option");
    opt.value = "";
    opt.textContent = "（個人）";
    opt.dataset.role = "";
    currentGroupSelect.appendChild(opt);
  }

  for (const g of groups) {
    const opt = document.createElement("option");
    opt.value = g.groupId;
    opt.textContent = g.name ?? "(no name)";
    opt.dataset.role = g.role ?? "member";
    currentGroupSelect.appendChild(opt);
  }

  // 前回選択を復元
  const saved = localStorage.getItem(GROUP_STORAGE_KEY) || "";
  const exists = Array.from(currentGroupSelect.options).some(o => o.value === saved);
  currentGroupSelect.value = exists ? saved : "";

  await onGroupChanged();
}

async function onGroupChanged() {
  if (!hasGroupUI()) return;

  const sel = currentGroupSelect.selectedOptions[0];
  currentGroupId = sel?.value ?? "";
  currentGroupRole = sel?.dataset?.role ?? null;

  localStorage.setItem(GROUP_STORAGE_KEY, currentGroupId);

  // ボタン活性
  leaveGroupBtn.disabled = !currentGroupId;

  // owner のときだけ削除可能
  deleteGroupBtn.disabled = !(currentGroupId && currentGroupRole === "owner");

  // owner のときだけ承認待ち一覧を表示
  if (currentGroupId && currentGroupRole === "owner") {
    pendingBox.style.display = "block";
    await loadPendingRequests();
  } else {
    pendingBox.style.display = "none";
    pendingList.innerHTML = "";
  }
  // ★グループ切替に応じてランキングを再読込
  await loadDailyRanking();
  await loadRanking();
}

async function loadPendingRequests() {
  if (!hasGroupUI()) return;
  if (!currentGroupId) return;

  pendingList.innerHTML = "";

  let reqs = [];
  try {
    reqs = await groupSvc.getPendingRequests(currentGroupId);
  } catch (e) {
    console.error("getPendingRequests failed", e);
    pendingList.innerHTML = "<li>読み込みに失敗しました</li>";
    return;
  }

  if (!reqs.length) {
    pendingList.innerHTML = "<li>承認待ちはありません。</li>";
    return;
  }

  for (const r of reqs) {
    const li = document.createElement("li");
    li.textContent = `${r.userName ?? "(no name)"} `;

    const approveBtn = document.createElement("button");
    approveBtn.type = "button";
    approveBtn.textContent = "承認";
    approveBtn.addEventListener("click", async () => {
      try {
        await groupSvc.approveMember(r);
        await loadPendingRequests();
        await refreshMyGroups(); // 承認後の状態反映
      } catch (e) {
        console.error("approve failed", e);
        alert("承認に失敗しました");
      }
    });

    const rejectBtn = document.createElement("button");
    rejectBtn.type = "button";
    rejectBtn.textContent = "却下";
    rejectBtn.addEventListener("click", async () => {
      try {
        await groupSvc.rejectMember(r.id);
        await loadPendingRequests();
      } catch (e) {
        console.error("reject failed", e);
        alert("却下に失敗しました");
      }
    });

    li.appendChild(approveBtn);
    li.appendChild(rejectBtn);
    pendingList.appendChild(li);
  }
}

function bindGroupEventsOnce() {
  if (!hasGroupUI()) return;

  // 二重バインド防止
  if (bindGroupEventsOnce._done) return;
  bindGroupEventsOnce._done = true;

  currentGroupSelect.addEventListener("change", () => {
    onGroupChanged();
  });

  groupCreateBtn.addEventListener("click", async () => {
    const user = auth.currentUser;
    if (!user) return;

    const raw = groupCreateNameEl ? groupCreateNameEl.value : "";
    const name = String(raw ?? "").trim();
    if (!name) {
      alert("グループ名を入力してください");
      return;
    }

    try {
      await groupSvc.createGroup(name, user.uid, userMgr.getCurrentUserName());
      if (groupCreateNameEl) groupCreateNameEl.value = "";
      await refreshMyGroups();
      alert("グループを作成しました");
    } catch (e) {
      console.error("createGroup failed", e);
      alert("グループ作成に失敗しました");
    }
  });

  groupSearchBtn.addEventListener("click", async () => {
    const key = String(groupSearchInput?.value ?? "").trim();
    groupSearchResult.innerHTML = "";

    if (!key) {
      groupSearchResult.innerHTML = "<li>検索キーワードを入力してください。</li>";
      return;
    }

    let list = [];
    try {
      list = await groupSvc.searchGroups(key);
    } catch (e) {
      console.error("searchGroups failed", e);
      groupSearchResult.innerHTML = "<li>検索に失敗しました。</li>";
      return;
    }

    if (!list.length) {
      groupSearchResult.innerHTML = "<li>見つかりませんでした。</li>";
      return;
    }

    for (const g of list) {
      const li = document.createElement("li");
      const name = g.name ?? "(no name)";
      const owner = g.ownerName ?? "";
      li.textContent = owner ? `${name}（作成者：${owner}） ` : `${name} `;

      const btn = document.createElement("button");
      btn.type = "button";
      btn.textContent = "参加申請";
      btn.addEventListener("click", async () => {
        const user = auth.currentUser;
        if (!user) return;
        try {
          await groupSvc.requestJoin(g.id, user.uid, userMgr.getCurrentUserName());
          alert("参加申請を送信しました（承認されると参加できます）");
        } catch (e) {
          console.error("requestJoin failed", e);
          alert("参加申請に失敗しました");
        }
      });

      li.appendChild(btn);
      groupSearchResult.appendChild(li);
    }
  });

  leaveGroupBtn.addEventListener("click", async () => {
    const user = auth.currentUser;
    if (!user) return;
    if (!currentGroupId) return;

    if (currentGroupRole === "owner") {
      alert("owner は退出できません。削除する場合は「グループ削除」を使ってください。");
      return;
    }

    const ok = confirm("このグループから退出しますか？");
    if (!ok) return;

    try {
      await groupSvc.leaveGroup(currentGroupId, user.uid);
      await refreshMyGroups();
      alert("退出しました");
    } catch (e) {
      console.error("leaveGroup failed", e);
      alert("退出に失敗しました");
    }
  });

  deleteGroupBtn.addEventListener("click", async () => {
    if (!currentGroupId) return;
    if (currentGroupRole !== "owner") return;

    const ok = confirm("このグループを削除しますか？（メンバー情報も削除されます）");
    if (!ok) return;

    try {
      await groupSvc.deleteGroup(currentGroupId);
      await refreshMyGroups();
      alert("グループを削除しました");
    } catch (e) {
      console.error("deleteGroup failed", e);
      alert("グループ削除に失敗しました");
    }
  });
}

/* =========================
   Events（既存）
========================= */
skipBtn.addEventListener("click", () => {
  // ★今日の課題が ON なら自動で OFF にする
  if (dailyThemeEl && dailyThemeEl.checked) {
    dailyThemeEl.checked = false;

    // 今日の課題用テーマも解除
    dailyTheme = null;

    // lengthGroup セレクトを復帰
    if (lengthGroupEl) {
      lengthGroupEl.disabled = false;
    }
  }

  // 通常モードで別の文章を出す
  setNewText();
});


startBtn.addEventListener("click", async () => {
  hideModal();
  await startWithCountdown();
});

if (dailyThemeEl) {
  dailyThemeEl.addEventListener("change", () => {
    applyThemeOptionsByCategory();
    setNewText();
    updateLabels();
    loadDailyRanking();
    loadRanking();
    const user = auth.currentUser;
    if (user) loadMyAnalytics(user.uid, userMgr.getCurrentUserName());
  });
}

// 出題難度の変更 → 統合タブにも反映
difficultyEl.addEventListener("change", () => {
  setActiveDiffTab(difficultyEl.value); // 表示側難度も同じにする
  setNewText();
  updateLabels();
  loadDailyRanking();
  loadRanking();
  const user = auth.currentUser;
  if (user) loadMyAnalytics(user.uid, userMgr.getCurrentUserName());
});

lengthGroupEl.addEventListener("change", () => {
  setNewText();
  updateLabels();
  loadDailyRanking();
  loadRanking();
  const user = auth.currentUser;
  if (user) loadMyAnalytics(user.uid, userMgr.getCurrentUserName());
});

categoryEl.addEventListener("change", () => {
  applyThemeOptionsByCategory();
  setNewText();
  updateLabels();
  loadDailyRanking();
  loadRanking();
  const user = auth.currentUser;
  if (user) loadMyAnalytics(user.uid, userMgr.getCurrentUserName());
});

themeEl.addEventListener("change", () => {
  setNewText();
  updateLabels();
  loadDailyRanking();
  loadRanking();
  const user = auth.currentUser;
  if (user) loadMyAnalytics(user.uid, userMgr.getCurrentUserName());
});

if (rankScopeEl) {
  rankScopeEl.addEventListener("change", () => {
    updateLabels();
    loadRanking();
  });
}

closeModalBtn.addEventListener("click", () => hideModal());
nextBtn.addEventListener("click", () => {
  hideModal();
  setNewText();
});

userMgr.onChange = async () => {
  const user = auth.currentUser;
  if (user) await loadMyAnalytics(user.uid, userMgr.getCurrentUserName());
};

// Spaceキーでスタート
document.addEventListener("keydown", (e) => {
  if (e.code !== "Space") return;
  if (!currentItem) return;
  if (engine.started || countdownTimer) return;
  if (!inputEl.disabled) return;

  e.preventDefault();
  startWithCountdown();
});

/* =========================
   ★統合タブ（ここだけ）イベント
   タブ変更 → 出題難度セレクトも同期 → 全再描画
========================= */
function attachUnifiedDiffTabs() {
  const root = document.getElementById("diffTabsUnified");
  if (!root) return;

  root.querySelectorAll(".diffTab").forEach(btn => {
    btn.addEventListener("click", async () => {
      const diff = btn.dataset.diff;

      // 表示側難度
      setActiveDiffTab(diff, { syncDifficultySelect: true });

      // 出題難度も同じにする（1つにまとめる）
      setNewText();

      updateLabels();
      await loadDailyRanking();
      await loadRanking();

      const user = auth.currentUser;
      if (user) {
        await loadMyAnalytics(user.uid, userMgr.getCurrentUserName());
      }
    });
  });
}

/* =========================
   Init
========================= */
async function init() {
  updateLabels();

  textEl.textContent = "初期化中...";
  inputEl.value = "";
  inputEl.disabled = true;

  let raw = null;
  try {
    raw = await loadTrivia();
  } catch (e) {
    console.error("trivia load failed", e);
    textEl.textContent = "見本文の初期化に失敗しました。Consoleを確認してください。";
    inputEl.disabled = true;
    return;
  }

  buildIndices(raw);
  hydrateSelects();

  // 初期難度は出題セレクトに合わせて、統合タブも同期
  setActiveDiffTab(difficultyEl.value, { syncDifficultySelect: false });

  applyThemeOptionsByCategory();
  setNewText();

  // 統合タブだけ有効化
  attachUnifiedDiffTabs();

  await loadDailyRanking();
  await loadRanking();
}

// 匿名認証必須
authBadge.textContent = "認証：準備中…";
signInAnonymously(auth).catch((e) => {
  console.error("anonymous auth failed", e);
  authBadge.textContent = "認証：失敗（Consoleを確認）";
});

onAuthStateChanged(auth, async (user) => {
  if (!user) return;
  authBadge.textContent = `認証：OK（匿名）`;

  // グループUIがある場合だけイベントを貼る
  bindGroupEventsOnce();

  await init();
  await loadMyAnalytics(user.uid, userMgr.getCurrentUserName());

  // グループUIがある場合だけ参加中グループをロード
  if (hasGroupUI()) {
    await refreshMyGroups();
  }
});





