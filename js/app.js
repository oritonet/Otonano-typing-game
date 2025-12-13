// js/app.js
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import {
  getFirestore,
  collection,
  addDoc,
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
const diffChart = document.getElementById("diffChart");
const myRecentUL = document.getElementById("myRecent");

const modalBackdrop = document.getElementById("resultModalBackdrop");
const closeModalBtn = document.getElementById("closeModalBtn");
const nextBtn = document.getElementById("nextBtn");

const mRank = document.getElementById("mRank");
const mEff = document.getElementById("mEff");
const mCPM = document.getElementById("mCPM");
const mKPM = document.getElementById("mKPM");
const mDiff = document.getElementById("mDiff");
const mScore = document.getElementById("mScore");
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

function katakanaRatio(text) {
  const total = (text.match(/[ぁ-んァ-ヶー一-龥A-Za-z0-9]/g) || []).length;
  if (total === 0) return 0;
  const kata = (text.match(/[ァ-ヶー]/g) || []).length;
  return kata / total;
}

const PUNCT_WEIGHT = 6;
const KATA_WEIGHT = 80;
const EASY_SCORE_MAX = 145;
const NORMAL_SCORE_MAX = 190;

function difficultyByFeatures(len, pCount, kRatio) {
  const score = Math.round(len + (pCount * PUNCT_WEIGHT) + (kRatio * KATA_WEIGHT));
  let diff = "むずかしい";
  if (score <= EASY_SCORE_MAX) diff = "かんたん";
  else if (score <= NORMAL_SCORE_MAX) diff = "ふつう";
  return { diff, score };
}

function showModal() {
  modalBackdrop.style.display = "flex";
  modalBackdrop.setAttribute("aria-hidden", "false");
}
function hideModal() {
  modalBackdrop.style.display = "none";
  modalBackdrop.setAttribute("aria-hidden", "true");
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
  // GitHub Pagesの repo 配下でも壊れにくい
  // /Otonano-typing-game/ のような末尾 / を維持
  const p = location.pathname;
  if (p.endsWith("/")) return p.slice(0, -1);
  return p.replace(/\/index\.html$/, "");
}

async function loadTrivia() {
  // まず相対で試す → ダメなら basePath で試す（更新で読み込み中になりやすい問題の対策）
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
      const p = punctCount(x.text);
      const kr = katakanaRatio(x.text);
      const { diff, score } = difficultyByFeatures(len, p, kr);
      return {
        genre: x.genre ?? "",
        category: x.category ?? "",
        theme: x.theme ?? "",
        text: x.text,
        length: len,
        punct: p,
        kataRatio: kr,
        difficulty: diff,
        diffScore: score
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
    <option value="かんたん">難易度：かんたん</option>
    <option value="ふつう">難易度：ふつう</option>
    <option value="むずかしい">難易度：むずかしい</option>
  `;

  categoryEl.innerHTML =
    `<option value="all">カテゴリ：すべて</option>` +
    categories.map(c => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join("");

  themeEl.innerHTML = `<option value="all">テーマ：すべて</option>`;

  rankScopeEl.innerHTML = `
    <option value="overall">ランキング：全体</option>
    <option value="category">ランキング：カテゴリ別（現在のカテゴリ）</option>
    <option value="theme">ランキング：テーマ別（現在のテーマ）</option>
  `;
}

function escapeHtml(s) {
  return String(s)
    .replaceAll("&","&amp;")
    .replaceAll("<","&lt;")
    .replaceAll(">","&gt;")
    .replaceAll('"',"&quot;")
    .replaceAll("'","&#039;");
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
  const category = daily ? "all" : categoryEl.value;
  const theme = daily ? dailyTheme : themeEl.value;
  return { daily, difficulty, category, theme };
}

function filterPool() {
  const { daily, difficulty, category, theme } = getActiveFilters();
  return items.filter(x => {
    if (difficulty !== "all" && x.difficulty !== difficulty) return false;
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
    // 完了 → 自動保存 → ランキング/分析更新 → ポップアップ
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

  // カウント中に連打させない
  startBtn.disabled = true;
  skipBtn.disabled = true;

  // 入力欄内に 3,2,1,0
  engine.showCountdownInTextarea(3);
  let n = 3;

  // すでに開始済みのものはリセット
  if (countdownTimer) clearInterval(countdownTimer);

  countdownTimer = setInterval(() => {
    n--;
    if (n >= 0) {
      engine.showCountdownInTextarea(n);
    }
    if (n <= 0) {
      clearInterval(countdownTimer);
      countdownTimer = null;

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
    return;
  }

  const pick = pickNextItem(pool);
  currentItem = pick;

  pushHistory(pick.text);

  engine.setTarget(pick.text, pick);

  // スタートを押すまで入力禁止
  inputEl.value = "スタートを押してください";
  inputEl.disabled = true;

  // ラベル更新
  updateLabels();
}

/* =========================
   Ranking + Analytics
========================= */
function updateLabels() {
  const { difficulty, category, theme } = getActiveFilters();
  dailyRankLabel.textContent = `🏆 今日のテーマ「${dailyTheme ?? "—"}」TOP10（rankingScore順）`;
  const scope = rankScopeEl.value;
  if (scope === "overall") rankLabel.textContent = `全体TOP10（難易度：${difficulty === "all" ? "すべて" : difficulty}）`;
  if (scope === "category") rankLabel.textContent = `カテゴリ「${category === "all" ? "すべて" : category}」TOP10（難易度：${difficulty === "all" ? "すべて" : difficulty}）`;
  if (scope === "theme") rankLabel.textContent = `テーマ「${theme === "all" ? "すべて" : theme}」TOP10（難易度：${difficulty === "all" ? "すべて" : difficulty}）`;
}

async function loadDailyRanking() {
  try {
    const { difficulty } = getActiveFilters();
    const rows = await rankingSvc.loadDailyTheme({
      theme: dailyTheme,
      dateKey: todayKey(),
      difficulty
    });
    rankingSvc.renderList(dailyRankingUL, rows);
  } catch (e) {
    console.error("daily ranking load error", e);
    dailyRankingUL.innerHTML = "<li>ランキングの読み込みに失敗しました</li>";
  }
}

async function loadRanking() {
  try {
    const { difficulty, category, theme } = getActiveFilters();
    const scope = rankScopeEl.value;

    let rows = [];
    if (scope === "overall") rows = await rankingSvc.loadOverall({ difficulty });
    if (scope === "category") rows = await rankingSvc.loadByCategory({ category, difficulty });
    if (scope === "theme") rows = await rankingSvc.loadByTheme({ theme, difficulty });

    rankingSvc.renderList(rankingUL, rows);
  } catch (e) {
    console.error("ranking load error", e);
    rankingUL.innerHTML = "<li>ランキングの読み込みに失敗しました</li>";
  }
}

/* =========================
   Analytics (選択ユーザーの scores から集計)
   - 複合index回避：uid== のみで取得し、ユーザー名はクライアントでフィルタ
========================= */
import {
  getDocs,
  query,
  where
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

function avg(arr) {
  if (!arr.length) return null;
  return Math.round(arr.reduce((s, x) => s + x, 0) / arr.length);
}

function drawDiffChart(values) {
  const canvas = diffChart;
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
  ctx.fillText("KPM−CPM 差（小さいほど効率的）", 12, 14);

  if (!values.length) {
    ctx.fillText("履歴がありません。", 12, 34);
    return;
  }

  const pad = 24;
  const w = cssW - pad * 2;
  const h = cssH - pad * 2;

  const maxV = Math.max(...values, 10);
  const minV = Math.min(...values, 0);

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

  const n = values.length;
  for (let i = 0; i < n; i++) {
    const x = pad + (n === 1 ? 0 : (i / (n - 1)) * w);
    const norm = (values[i] - minV) / (maxV - minV || 1);
    const y = pad + h - norm * h;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();
}

function rankScoreValue(r) {
  const map = { D:1, C:2, B:3, A:4, S:5, SS:6, SSS:7 };
  return map[r] ?? 0;
}

function betterRank(a, b) {
  return rankScoreValue(a) >= rankScoreValue(b) ? a : b;
}

function renderBestByDifficulty(histories) {
  bestByDifficultyUL.innerHTML = "";
  const diffs = ["かんたん", "ふつう", "むずかしい"];
  const best = {};
  for (const d of diffs) best[d] = { bestCpm: null, bestRank: "D", bestKpm: null };

  for (const h of histories) {
    const d = h.difficulty;
    if (!best[d]) continue;
    if (best[d].bestCpm === null || h.cpm > best[d].bestCpm) {
      best[d].bestCpm = h.cpm;
      best[d].bestKpm = h.kpm;
    }
    best[d].bestRank = betterRank(h.rank, best[d].bestRank);
  }

  for (const d of diffs) {
    const li = document.createElement("li");
    if (best[d].bestCpm === null) li.textContent = `${d}：まだ履歴がありません`;
    else li.textContent = `${d}：TOP CPM ${best[d].bestCpm}（KPM ${best[d].bestKpm}） / TOPランク ${best[d].bestRank}`;
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
    li.textContent = `${h.dateKey}｜${h.difficulty}｜CPM ${h.cpm} / KPM ${h.kpm}｜${h.rank}｜差 ${h.diff}`;
    myRecentUL.appendChild(li);
  }
}

function summarizeToday(histories) {
  const tKey = todayKey();
  const todays = histories.filter(h => h.dateKey === tKey);
  if (!todays.length) return null;

  const cpm = avg(todays.map(h => h.cpm));
  const kpm = avg(todays.map(h => h.kpm));
  const eff = (kpm > 0) ? cpm / kpm : 0;

  // ランク再推定（typingEngineと同じ基準）
  const rank = (() => {
    if (cpm >= 420 && eff >= 0.92) return "SSS";
    if (cpm >= 360 && eff >= 0.88) return "SS";
    if (cpm >= 320 && eff >= 0.84) return "S";
    if (cpm >= 260 && eff >= 0.78) return "A";
    if (cpm >= 200 && eff >= 0.72) return "B";
    if (cpm >= 150) return "C";
    return "D";
  })();

  return { cpm, kpm, eff, rank };
}

function summarize7days(histories) {
  const now = Date.now();
  const cutoff = now - 7 * 24 * 60 * 60 * 1000;
  const last7 = histories.filter(h => h.createdAtMs && h.createdAtMs >= cutoff);
  if (!last7.length) return null;

  const cpm = avg(last7.map(h => h.cpm));
  const kpm = avg(last7.map(h => h.kpm));
  const eff = (kpm > 0) ? cpm / kpm : 0;

  const rank = (() => {
    if (cpm >= 420 && eff >= 0.92) return "SSS";
    if (cpm >= 360 && eff >= 0.88) return "SS";
    if (cpm >= 320 && eff >= 0.84) return "S";
    if (cpm >= 260 && eff >= 0.78) return "A";
    if (cpm >= 200 && eff >= 0.72) return "B";
    if (cpm >= 150) return "C";
    return "D";
  })();

  return { cpm, kpm, eff, rank };
}

function formatCompare(todayObj, avg7Obj) {
  if (!todayObj || !avg7Obj) {
    compareTodayEl.textContent = "データが不足しています（履歴が増えると表示されます）。";
    return;
  }
  const cpmDelta = todayObj.cpm - avg7Obj.cpm;
  const kpmDelta = todayObj.kpm - avg7Obj.kpm;
  const effDelta = Math.round((todayObj.eff - avg7Obj.eff) * 1000) / 10;

  const sign = (n) => (n > 0 ? `+${n}` : `${n}`);

  compareTodayEl.innerHTML =
    `今日：CPM ${todayObj.cpm} / KPM ${todayObj.kpm} / ランク ${todayObj.rank} / 効率 ${(todayObj.eff*100).toFixed(1)}%<br>` +
    `過去7日平均：CPM ${avg7Obj.cpm} / KPM ${avg7Obj.kpm} / ランク ${avg7Obj.rank} / 効率 ${(avg7Obj.eff*100).toFixed(1)}%<br>` +
    `差分：CPM ${sign(cpmDelta)} / KPM ${sign(kpmDelta)} / 効率 ${sign(effDelta)}%`;
}

async function loadMyAnalytics(uid, userName) {
  try {
    const colRef = collection(db, "scores");
    // 複合indexを避けるため uid== だけで取る → userName はクライアントで絞る
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
        cpm: Number(d.cpm ?? 0),
        kpm: Number(d.kpm ?? 0),
        diff: Number(d.diff ?? 0),
        rank: d.rank ?? "D",
        createdAtMs: ms
      });
    });

    const mine = rows.filter(r => r.userName === userName);

    // 新しい順に揃える
    mine.sort((a, b) => (b.createdAtMs ?? 0) - (a.createdAtMs ?? 0));

    renderRecent(mine);
    renderBestByDifficulty(mine);

    const diffSeries = mine.slice(0, 60).reverse().map(h => h.diff);
    drawDiffChart(diffSeries.slice(-30));

    const t = summarizeToday(mine);
    const a7 = summarize7days(mine);
    formatCompare(t, a7);
  } catch (e) {
    console.error("analytics load error", e);
    bestByDifficultyUL.innerHTML = "<li>分析の読み込みに失敗しました</li>";
    myRecentUL.innerHTML = "<li>分析の読み込みに失敗しました</li>";
    compareTodayEl.textContent = "分析の読み込みに失敗しました。";
    drawDiffChart([]);
  }
}

/* =========================
   Save score (auto)
========================= */
async function saveScoreToScoresCollection({ uid, userName, metrics, item, filters }) {
  // scores一本化：ランキングも分析もこれだけで成立
  await addDoc(collection(db, "scores"), {
    uid,
    userName,

    cpm: metrics.cpm,
    kpm: metrics.kpm,
    eff: Math.round(metrics.eff * 10000) / 10000,
    diff: metrics.diff,
    rank: metrics.rank,
    rankingScore: metrics.rankingScore,

    // 出題メタ
    difficulty: item?.difficulty ?? (filters.difficulty === "all" ? "（すべて）" : filters.difficulty),
    category: item?.category ?? (filters.category === "all" ? "（すべて）" : filters.category),
    theme: item?.theme ?? (filters.theme === "all" ? "（すべて）" : filters.theme),
    length: item?.length ?? (item?.text?.length ?? 0),

    // 今日のテーマ厳密分離に使う
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
  const filters = getActiveFilters();

  // 保存
  try {
    await saveScoreToScoresCollection({
      uid: user.uid,
      userName,
      metrics,
      item: meta,
      filters
    });
  } catch (e) {
    console.error("save score failed", e);
  }

  // モーダル表示（見える/消えない）
  const effPct = (metrics.eff * 100).toFixed(1);
  mRank.textContent = metrics.rank;
  mEff.textContent = `${effPct}%`;
  mCPM.textContent = String(metrics.cpm);
  mKPM.textContent = String(metrics.kpm);
  mDiff.textContent = String(metrics.diff);
  mScore.textContent = String(metrics.rankingScore);

  const cat = meta?.category ?? "-";
  const th = meta?.theme ?? "-";
  const df = meta?.difficulty ?? "-";
  mMeta.textContent = `ユーザー：${userName} / 難易度：${df} / カテゴリ：${cat} / テーマ：${th} / 日付：${todayKey()}`;

  showModal();

  // ランキング更新
  updateLabels();
  await loadDailyRanking();
  await loadRanking();

  // 分析更新（選択ユーザーに連動）
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
});

difficultyEl.addEventListener("change", () => {
  setNewText();
  updateLabels();
  loadDailyRanking();
  loadRanking();
});

categoryEl.addEventListener("change", () => {
  applyThemeOptionsByCategory();
  setNewText();
  updateLabels();
  loadDailyRanking();
  loadRanking();
});

themeEl.addEventListener("change", () => {
  setNewText();
  updateLabels();
  loadDailyRanking();
  loadRanking();
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

/* =========================
   Init
========================= */
async function init() {
  // ranking scope initial
  updateLabels();

  // UI初期値の整備
  textEl.textContent = "初期化中...";
  inputEl.value = "";
  inputEl.disabled = true;

  // JSON読み込み
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

  // 日替わりチェック時はテーマ固定
  applyThemeOptionsByCategory();

  // 最初の文章
  setNewText();

  // 今日のテーマランキングは常にTOP固定
  await loadDailyRanking();
  await loadRanking();
}

// 匿名認証必須（セキュリティ）
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
