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

const userSelect = document.getElementById("userSelect");
const addUserBtn = document.getElementById("addUserBtn");
const renameUserBtn = document.getElementById("renameUserBtn");
const deleteUserBtn = document.getElementById("deleteUserBtn");

const difficultyEl = document.getElementById("difficulty");
const lengthGroupEl = document.getElementById("lengthGroup");
const categoryEl = document.getElementById("category");
const themeEl = document.getElementById("theme");
const dailyThemeEl = document.getElementById("dailyTheme");
const dailyInfoEl = document.getElementById("dailyInfo");

const skipBtn = document.getElementById("skipBtn");
const startBtn = document.getElementById("startBtn");
const inputEl = document.getElementById("input");
const textEl = document.getElementById("text");
const resultEl = document.getElementById("result");

const dailyRankLabel = document.getElementById("dailyRankLabel");
const dailyRankingUL = document.getElementById("dailyRanking");

const rankScopeEl = document.getElementById("rankScope");
const rankLabel = document.getElementById("rankLabel");
const rankingUL = document.getElementById("ranking");

const bestByDifficultyUL = document.getElementById("bestByDifficulty");
const compareTodayEl = document.getElementById("compareToday");
const scoreChart = document.getElementById("scoreChart");
const myRecentUL = document.getElementById("myRecent");

const modalBackdrop = document.getElementById("resultModalBackdrop");
const closeModalBtn = document.getElementById("closeModalBtn");
const nextBtn = document.getElementById("nextBtn");

const mRank = document.getElementById("mRank");
const mCPM = document.getElementById("mCPM");
const mTimeSec = document.getElementById("mTimeSec");
const mLen = document.getElementById("mLen");
const mMeta = document.getElementById("mMeta");

/* =========================
   Utils
========================= */
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

function punctCount(text) {
  const m = text.match(/[、。,.!！?？]/g);
  return m ? m.length : 0;
}
function digitCount(text) {
  const m = text.match(/[0-9]/g);
  return m ? m.length : 0;
}
function kanjiRatio(text) {
  const total = text.length || 1;
  const kanji = (text.match(/[一-龥]/g) || []).length;
  return kanji / total;
}

// ★難易度：文章長は含めない（漢字率/記号/数字）
function difficultyByText(text) {
  const kr = kanjiRatio(text);       // 0..1
  const p = punctCount(text);        // 記号数
  const d = digitCount(text);        // 数字数
  const score = kr * 100 + p * 6 + d * 10;

  if (score < 25) return "easy";
  if (score < 55) return "normal";
  return "hard";
}

// ★文章長グループ：ユーザー選択で絞り込みに使う
function lengthGroupOf(len) {
  if (len <= 40) return "short";
  if (len <= 80) return "medium";
  return "long";
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

function diffLabel(v) {
  if (v === "easy") return "かんたん";
  if (v === "normal") return "ふつう";
  if (v === "hard") return "むずかしい";
  return v ?? "-";
}

function lengthLabel(v) {
  if (v === "short") return "短";
  if (v === "medium") return "中";
  if (v === "long") return "長";
  return v ?? "-";
}

/* =========================
   Services
========================= */
const userMgr = new UserManager({
  selectEl: userSelect,
  addBtn: addUserBtn,
  renameBtn: renameUserBtn,
  deleteBtn: deleteUserBtn
});

const rankingSvc = new RankingService({ db });

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
      const lengthGroup = lengthGroupOf(len);       // short/medium/long

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
    <option value="all">難易度：すべて</option>
    <option value="easy">難易度：かんたん</option>
    <option value="normal">難易度：ふつう</option>
    <option value="hard">難易度：むずかしい</option>
  `;

  lengthGroupEl.innerHTML = `
    <option value="all">文章長：すべて</option>
    <option value="short">文章長：短</option>
    <option value="medium">文章長：中</option>
    <option value="long">文章長：長</option>
  `;

  categoryEl.innerHTML =
    `<option value="all">カテゴリ：すべて</option>` +
    categories.map(c => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join("");

  themeEl.innerHTML = `<option value="all">テーマ：すべて</option>`;

  rankScopeEl.innerHTML = `
    <option value="overall">ランキング：全体</option>
    <option value="category">ランキング：現在のカテゴリ</option>
    <option value="theme">ランキング：現在のテーマ</option>
  `;
}

function applyThemeOptionsByCategory() {
  const daily = dailyThemeEl.checked && !!dailyTheme;
  if (daily) {
    themeEl.disabled = true;
    categoryEl.disabled = true;
    themeEl.innerHTML = `<option value="${escapeHtml(dailyTheme)}">${escapeHtml(dailyTheme)}</option>`;
    themeEl.value = dailyTheme;
    dailyInfoEl.style.display = "block";
    dailyInfoEl.textContent = `今日（${todayKey()}）のテーマ：${dailyTheme}（固定中）`;
    return;
  }

  themeEl.disabled = false;
  categoryEl.disabled = false;
  dailyInfoEl.style.display = "none";
  dailyInfoEl.textContent = "";

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
  const daily = dailyThemeEl.checked && !!dailyTheme;
  const difficulty = difficultyEl.value;
  const lengthGroup = lengthGroupEl.value;
  const category = daily ? "all" : categoryEl.value;
  const theme = daily ? dailyTheme : themeEl.value;
  return { daily, difficulty, lengthGroup, category, theme };
}

function filterPool() {
  const { daily, difficulty, lengthGroup, category, theme } = getActiveFilters();
  return items.filter(x => {
    if (difficulty !== "all" && x.difficulty !== difficulty) return false;
    if (lengthGroup !== "all" && x.lengthGroup !== lengthGroup) return false;
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
    engine.setTarget("該当する文章がありません。条件を変更してください。", null);
    textEl.textContent = "該当する文章がありません。条件を変更してください。";
    inputEl.value = "";
    inputEl.disabled = true;
    startBtn.style.display = "none";
    return;
  }

  const pick = pickNextItem(pool);
  currentItem = pick;

  pushHistory(pick.text);

  engine.setTarget(pick.text, pick);

  inputEl.value = "スペース or スタートボタンで入力開始";
  inputEl.disabled = true;
  inputEl.classList.add("input-guide");

  // 次の問題ではスタートボタンを再表示
  startBtn.style.display = "block";

  updateLabels();
}

/* =========================
   Ranking + Analytics
========================= */
function updateLabels() {
  const { difficulty, lengthGroup, category, theme } = getActiveFilters();

  dailyRankLabel.textContent =
    `🏆 今日のテーマ「${dailyTheme ?? "—"}」TOP10（Score順）`;

  const scope = rankScopeEl.value;
  const diffTxt = (difficulty === "all") ? "すべて" : diffLabel(difficulty);
  const lenTxt = (lengthGroup === "all") ? "すべて" : lengthLabel(lengthGroup);

  if (scope === "overall") {
    rankLabel.textContent = `全体TOP10（難易度：${diffTxt} / 文章長：${lenTxt}）`;
  }
  if (scope === "category") {
    rankLabel.textContent = `カテゴリ「${category === "all" ? "すべて" : category}」TOP10（難易度：${diffTxt} / 文章長：${lenTxt}）`;
  }
  if (scope === "theme") {
    rankLabel.textContent = `テーマ「${theme === "all" ? "すべて" : theme}」TOP10（難易度：${diffTxt} / 文章長：${lenTxt}）`;
  }
}

async function loadDailyRanking() {
  try {
    const { difficulty, lengthGroup } = getActiveFilters();
    const rows = await rankingSvc.loadDailyTheme({
      theme: dailyTheme,
      dateKey: todayKey(),
      difficulty,
      lengthGroup
    });
    rankingSvc.renderList(dailyRankingUL, rows);
  } catch (e) {
    console.error("daily ranking load error", e);
    dailyRankingUL.innerHTML = "<li>ランキングの読み込みに失敗しました</li>";
  }
}

async function loadRanking() {
  try {
    const { difficulty, lengthGroup, category, theme } = getActiveFilters();
    const scope = rankScopeEl.value;

    let rows = [];
    if (scope === "overall") rows = await rankingSvc.loadOverall({ difficulty, lengthGroup });
    if (scope === "category") rows = await rankingSvc.loadByCategory({ category, difficulty, lengthGroup });
    if (scope === "theme") rows = await rankingSvc.loadByTheme({ theme, difficulty, lengthGroup });

    rankingSvc.renderList(rankingUL, rows);
  } catch (e) {
    console.error("ranking load error", e);
    rankingUL.innerHTML = "<li>ランキングの読み込みに失敗しました</li>";
  }
}

/* =========================
   Analytics（選択ユーザー）
========================= */
function avg(arr) {
  if (!arr.length) return null;
  return Math.round(arr.reduce((s, x) => s + x, 0) / arr.length);
}

function renderBestByDifficulty(histories) {
  bestByDifficultyUL.innerHTML = "";

  const diffs = ["easy", "normal", "hard"];
  const best = {};
  for (const d of diffs) best[d] = { bestCpm: null };

  for (const h of histories) {
    const d = h.difficulty;
    if (!best[d]) continue;
    if (best[d].bestCpm === null || h.cpm > best[d].bestCpm) best[d].bestCpm = h.cpm;
  }

  for (const d of diffs) {
    const li = document.createElement("li");
    if (best[d].bestCpm === null) li.textContent = `${diffLabel(d)}：まだ履歴がありません`;
    else li.textContent = `${diffLabel(d)}：TOP スコア ${best[d].bestCpm}`;
    bestByDifficultyUL.appendChild(li);
  }
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
    const lenTxt = h.lengthGroup ? `｜${lengthLabel(h.lengthGroup)}` : "";
    li.textContent = `${h.dateKey}｜${diffLabel(h.difficulty)}${lenTxt}｜Score ${h.cpm}`;
    myRecentUL.appendChild(li);
  }
}

// 日付ごとの「その日のベストスコア」を折れ線にする
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

  // axes
  ctx.strokeStyle = "#ddd";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(pad, pad);
  ctx.lineTo(pad, pad + h);
  ctx.lineTo(pad + w, pad + h);
  ctx.stroke();

  // line
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

  // date labels (downsample)
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
        cpm: Number(d.cpm ?? 0),
        createdAtMs: ms
      });
    });

    const mine = rows.filter(r => r.userName === userName);

    // 新しい順
    mine.sort((a, b) => (b.createdAtMs ?? 0) - (a.createdAtMs ?? 0));

    renderRecent(mine);
    renderBestByDifficulty(mine);

    // ★難易度選択で絞った系列をグラフ化（難易度別保存に対応）
    const selectedDiff = difficultyEl.value; // all/easy/normal/hard
    let view = mine;
    if (selectedDiff !== "all") view = mine.filter(r => r.difficulty === selectedDiff);

    const series = buildDailyBestSeries(view);
    drawScoreChart(series);

    const t = summarizeTodayScore(view);
    const a7 = summarize7daysScore(view);
    formatCompareScore(t, a7);
  } catch (e) {
    console.error("analytics load error", e);
    bestByDifficultyUL.innerHTML = "<li>分析の読み込みに失敗しました</li>";
    myRecentUL.innerHTML = "<li>分析の読み込みに失敗しました</li>";
    compareTodayEl.textContent = "分析の読み込みに失敗しました。";
    drawScoreChart([]);
  }
}

/* =========================
   Save score (auto)
========================= */
async function saveScoreToScoresCollection({ uid, userName, metrics, item }) {
  await addDoc(collection(db, "scores"), {
    uid,
    userName,

    // ★スコア本体（=CPM）
    cpm: metrics.cpm,
    rank: metrics.rank,

    // ★難易度別で保存
    difficulty: item?.difficulty ?? "normal",

    // ★文章長は難易度に含めず、別軸で保存・絞り込み
    lengthGroup: item?.lengthGroup ?? "medium",

    // 出題メタ
    category: item?.category ?? "（不明）",
    theme: item?.theme ?? "（不明）",
    length: item?.length ?? (item?.text?.length ?? 0),

    // 分析の横軸（日付）
    dateKey: todayKey(),

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

  // モーダル
  mRank.textContent = metrics.rank;
  mCPM.textContent = String(metrics.cpm);
  mTimeSec.textContent = String(metrics.seconds ?? "-");
  mLen.textContent = String(metrics.length ?? "-");

  const cat = meta?.category ?? "-";
  const th = meta?.theme ?? "-";
  const df = meta?.difficulty ?? "-";
  const lg = meta?.lengthGroup ?? "-";
  mMeta.textContent = `ユーザー：${userName} / 難易度：${diffLabel(df)} / 文章長：${lengthLabel(lg)} / カテゴリ：${cat} / テーマ：${th} / 日付：${todayKey()}`;

  showModal();

  // ランキング更新
  updateLabels();
  await loadDailyRanking();
  await loadRanking();

  // 分析更新
  await loadMyAnalytics(user.uid, userName);
}

/* =========================
   Events
========================= */
skipBtn.addEventListener("click", () => {
  hideModal();
  setNewText();
});

startBtn.addEventListener("click", async () => {
  hideModal();
  await startWithCountdown();
});

dailyThemeEl.addEventListener("change", () => {
  applyThemeOptionsByCategory();
  setNewText();
  updateLabels();
  loadDailyRanking();
  loadRanking();
  const user = auth.currentUser;
  if (user) loadMyAnalytics(user.uid, userMgr.getCurrentUserName());
});

difficultyEl.addEventListener("change", () => {
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

rankScopeEl.addEventListener("change", () => {
  updateLabels();
  loadRanking();
});

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

  applyThemeOptionsByCategory();

  setNewText();

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

  await init();
  await loadMyAnalytics(user.uid, userMgr.getCurrentUserName());
});
