// js/app.js
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import {
  getFirestore,
  collection,
  addDoc,
  getDocs,
  query,
  where,
  limit,
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
const metaInfoEl = document.getElementById("metaInfo");

const userSelect = document.getElementById("userSelect");
const addUserBtn = document.getElementById("addUserBtn");
const renameUserBtn = document.getElementById("renameUserBtn");
const deleteUserBtn = document.getElementById("deleteUserBtn");

const difficultyEl = document.getElementById("difficulty");
const lengthGroupEl = document.getElementById("lengthGroup");
const categoryEl = document.getElementById("category");
const themeEl = document.getElementById("theme");
const dailyTaskEl = document.getElementById("dailyTask");
const dailyInfoEl = document.getElementById("dailyInfo");

const skipBtn = document.getElementById("skipBtn");
const startBtn = document.getElementById("startBtn");
const inputEl = document.getElementById("input");
const textEl = document.getElementById("text");
const resultEl = document.getElementById("result");

const dailyRankLabel = document.getElementById("dailyRankLabel");
const dailyRankingUL = document.getElementById("dailyRanking");

const overallLabel = document.getElementById("overallLabel");
const rankingUL = document.getElementById("ranking");

const analyticsTitle = document.getElementById("analyticsTitle");
const analyticsLabel = document.getElementById("analyticsLabel");
const bestByDifficultyUL = document.getElementById("bestByDifficulty");
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
   成績・分析：難度タブ（練習とは非連動）
========================= */
let activeDiffTab = "normal"; // easy/normal/hard

function setActiveDiffTab(diff) {
  if (!diff) return;
  activeDiffTab = diff;
  document.querySelectorAll("#diffTabsUnified .diffTab").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.diff === activeDiffTab);
  });
}

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

function rankByScore(score) {
  if (score >= 800) return "SSS";
  if (score >= 700) return "SS";
  if (score >= 600) return "S";
  if (score >= 500) return "A";
  if (score >= 400) return "B";
  if (score >= 300) return "C";
  return "D";
}

function diffLabel(v) {
  if (v === "easy") return "易";
  if (v === "normal") return "普";
  if (v === "hard") return "難";
  return "-";
}

function lengthLabel(v) {
  if (v === "xs") return "極短";
  if (v === "short") return "短";
  if (v === "medium") return "中";
  if (v === "long") return "長";
  if (v === "xl") return "極長";
  return "-";
}

function fixedLengthByDifficulty(diff) {
  if (diff === "easy") return "xs";
  if (diff === "normal") return "medium";
  if (diff === "hard") return "xl";
  return "medium";
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
const userMgr = new UserManager({
  selectEl: userSelect,
  addBtn: addUserBtn,
  renameBtn: renameUserBtn,
  deleteBtn: deleteUserBtn
});
const rankingSvc = new RankingService({ db });

/* =========================
   Trivia
========================= */
let items = [];
let categories = [];
let themeByCategory = new Map();
let allThemes = [];

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

// 強・中・弱・基本の4段階
function punctScore(text) {
  const strong = (text.match(/[（）「」『』［］【】＜＞”’]/g) || []).length;
  const middle = (text.match(/[￥＄：；]/g) || []).length;
  const weak = (text.match(/[ー・＃％＆＋－＝／]/g) || []).length;
  const basic = (text.match(/[、。,.!！?？]/g) || []).length;
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
function difficultyByText(text) {
  const score =
    kanjiRatio(text) * 100 +
    punctScore(text) * 6 +
    digitCount(text) * 10;
  if (score < 35) return "easy";
  if (score < 65) return "normal";
  return "hard";
}
function lengthGroupOf(len) {
  if (len <= 20) return "xs";
  if (len <= 40) return "short";
  if (len <= 80) return "medium";
  if (len <= 140) return "long";
  return "xl";
}

/* =========================
   今日の課題（難度別に1日1文）
========================= */
const dailyTaskByDiff = new Map(); // diff -> item
function dailyTaskKeyOf(diff) {
  return `${todayKey()}::${diff}`;
}
function computeDailyTaskForDiff(diff) {
  const lg = fixedLengthByDifficulty(diff);
  const pool = items.filter(x => x.difficulty === diff && x.lengthGroup === lg);
  if (!pool.length) return null;
  const idx = hashString(`${todayKey()}::${diff}`) % pool.length;
  return pool[idx];
}
function refreshDailyTasks() {
  dailyTaskByDiff.set("easy", computeDailyTaskForDiff("easy"));
  dailyTaskByDiff.set("normal", computeDailyTaskForDiff("normal"));
  dailyTaskByDiff.set("hard", computeDailyTaskForDiff("hard"));
}

function buildIndices(raw) {
  items = raw
    .filter(x => x && typeof x.text === "string")
    .map(x => {
      const len = (typeof x.length === "number") ? x.length : x.text.length;
      const difficulty = difficultyByText(x.text);
      const lengthGroup = lengthGroupOf(len);
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

  refreshDailyTasks();
}

/* =========================
   UI
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
  applyThemeOptionsByCategory();
}

function applyThemeOptionsByCategory() {
  const cat = categoryEl.value;
  const current = themeEl.value;

  let themes = [];
  if (cat === "all") themes = allThemes;
  else {
    const set = themeByCategory.get(cat);
    themes = set ? Array.from(set).sort((a, b) => a.localeCompare(b, "ja")) : [];
  }

  themeEl.innerHTML =
    `<option value="all">テーマ：すべて</option>` +
    themes.map(t => `<option value="${escapeHtml(t)}">${escapeHtml(t)}</option>`).join("");

  themeEl.value = themes.includes(current) ? current : "all";
}

function applyDailyTaskModeUI() {
  const on = !!dailyTaskEl?.checked;

  if (on) {
    const diff = difficultyEl.value;
    const lg = fixedLengthByDifficulty(diff);

    lengthGroupEl.value = lg;
    lengthGroupEl.disabled = true;
    categoryEl.disabled = true;
    themeEl.disabled = true;

    const task = dailyTaskByDiff.get(diff);
    const name = task ? (task.theme || task.category || "—") : "—";
    dailyInfoEl.style.display = "block";
    dailyInfoEl.textContent = `今日（${todayKey()}）の課題：${name}`;

    skipBtn.disabled = true;
  } else {
    lengthGroupEl.disabled = false;
    categoryEl.disabled = false;
    themeEl.disabled = false;
    dailyInfoEl.style.display = "none";
    dailyInfoEl.textContent = "";
    skipBtn.disabled = false;
  }
}

/* =========================
   出題フィルタ
========================= */
function getPracticeFilters() {
  const dailyTask = !!dailyTaskEl?.checked;
  const difficulty = difficultyEl.value;
  const lengthGroup = dailyTask ? fixedLengthByDifficulty(difficulty) : lengthGroupEl.value;
  const category = categoryEl.value;
  const theme = themeEl.value;
  return { dailyTask, difficulty, lengthGroup, category, theme };
}

function filterPool() {
  const { dailyTask, difficulty, lengthGroup, category, theme } = getPracticeFilters();

  if (dailyTask) {
    const it = dailyTaskByDiff.get(difficulty);
    return it ? [it] : [];
  }

  return items.filter(x => {
    if (x.difficulty !== difficulty) return false;
    if (x.lengthGroup !== lengthGroup) return false;
    if (category !== "all" && x.category !== category) return false;
    if (theme !== "all" && x.theme !== theme) return false;
    return true;
  });
}

/* =========================
   Recent history（通常モードのみ）
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
  if (!pool.length) return null;
  const notRecent = pool.filter(x => !isRecentlyUsed(x.text));
  const candidates = notRecent.length ? notRecent : pool;
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
   Paste/Drop 禁止
========================= */
inputEl.addEventListener("paste", (e) => e.preventDefault());
inputEl.addEventListener("drop", (e) => e.preventDefault());
inputEl.addEventListener("dragover", (e) => e.preventDefault());

/* =========================
   Countdown + Start
========================= */
let countdownTimer = null;

async function startWithCountdown() {
  if (!currentItem) return;

  startBtn.style.display = "none";
  startBtn.disabled = true;
  skipBtn.disabled = true;

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

  if (!pool.length) {
    currentItem = null;
    metaInfoEl.textContent = "- / -";
    const msg = "該当する文章がありません。条件を変更してください。";
    engine.setTarget(msg, null);
    textEl.textContent = msg;
    inputEl.value = "";
    inputEl.disabled = true;
    startBtn.style.display = "none";
    return;
  }

  const { dailyTask } = getPracticeFilters();
  const pick = dailyTask ? pool[0] : pickNextItem(pool);
  currentItem = pick;

  metaInfoEl.textContent = `${pick.category ?? "-"} / ${pick.theme ?? "-"}`;

  if (!dailyTask) pushHistory(pick.text);

  engine.setTarget(pick.text, pick);

  inputEl.value = "スペース or スタートボタンで入力開始";
  inputEl.disabled = true;
  inputEl.classList.add("input-guide");
  startBtn.style.display = "block";

  updateLabels();
}

/* =========================
   Save score + Modal
========================= */
async function onFinished(metrics, meta) {
  try {
    const user = auth.currentUser;
    if (!user) return;

    const uid = user.uid;
    const userName = userMgr.getCurrentUserName();

    const cpm = Math.max(0, Math.round(Number(metrics?.cpm ?? 0)));
    const timeSec = Math.max(0, Number(metrics?.timeSec ?? 0));
    const len = Math.max(0, Number(meta?.length ?? currentItem?.length ?? 0));

    const rank = rankByScore(cpm);

    const { dailyTask, difficulty, lengthGroup } = getPracticeFilters();
    const dateKey = todayKey();

    const category = currentItem?.category ?? "";
    const theme = currentItem?.theme ?? "";

    const dailyTaskKey = dailyTask ? dailyTaskKeyOf(difficulty) : null;
    const dailyTaskName = dailyTask ? (theme || category || "") : null;

    await addDoc(collection(db, "scores"), {
      uid,
      userName,
      cpm,
      rank,
      timeSec,
      length: len,
      lengthGroup,
      difficulty,
      category,
      theme,
      dateKey,
      isDailyTask: !!dailyTask,
      dailyTaskKey,
      dailyTaskName,
      createdAt: serverTimestamp()
    });

    mRank.textContent = rank;
    mCPM.textContent = String(cpm);
    mTimeSec.textContent = timeSec.toFixed(2);
    mLen.textContent = String(len);
    mMeta.textContent = `${dateKey} / ${userName}`;

    showModal();

    await loadDailyRanking();
    await loadRanking();
    await loadMyAnalytics(uid, userName);
  } catch (e) {
    console.error("save score failed", e);
  }
}

/* =========================
   Labels
========================= */
function updateLabels() {
  const tabDiffTxt = diffLabel(activeDiffTab);
  const tabTask = dailyTaskByDiff.get(activeDiffTab);
  const tabName = tabTask ? (tabTask.theme || tabTask.category || "—") : "—";
  dailyRankLabel.textContent = `今日（${todayKey()}）の課題：${tabName} / 難度：${tabDiffTxt}`;

  overallLabel.textContent = `全体 上位10 / 難度：${tabDiffTxt}`;

  if (analyticsTitle) analyticsTitle.textContent = `入力分析（${userMgr.getCurrentUserName()}）`;
  if (analyticsLabel) analyticsLabel.textContent = `難度：${tabDiffTxt}`;
}

/* =========================
   Rankings
========================= */
async function loadDailyRanking() {
  try {
    const myName = userMgr.getCurrentUserName();

    const diff = activeDiffTab;
    const task = dailyTaskByDiff.get(diff);
    if (!task) {
      dailyRankingUL.innerHTML = "<li>今日の課題が見つかりません。</li>";
      return;
    }

    const rows = await rankingSvc.loadDailyTask({
      dailyTaskKey: dailyTaskKeyOf(diff),
      dateKey: todayKey(),
      difficulty: diff
    });

    rankingSvc.renderList(dailyRankingUL, rows, { highlightUserName: myName });
  } catch (e) {
    console.error("daily ranking load error", e);
    dailyRankingUL.innerHTML = "<li>読み込みに失敗しました</li>";
  }
}

async function loadRanking() {
  try {
    const myName = userMgr.getCurrentUserName();
    const rows = await rankingSvc.loadOverall({ difficulty: activeDiffTab });
    rankingSvc.renderList(rankingUL, rows, { highlightUserName: myName });
  } catch (e) {
    console.error("ranking load error", e);
    rankingUL.innerHTML = "<li>読み込みに失敗しました</li>";
  }
}

/* =========================
   Analytics
========================= */
function renderBest(histories) {
  bestByDifficultyUL.innerHTML = "";

  if (!histories.length) {
    const li = document.createElement("li");
    li.textContent = "まだ履歴がありません";
    bestByDifficultyUL.appendChild(li);
    return;
  }

  const best = Math.max(...histories.map(h => Number(h.cpm ?? 0)));
  const li = document.createElement("li");
  li.textContent = `ベスト：${best}`;
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
    li.textContent = `${userName}｜ランク：${rank}｜スコア：${score}｜長さ：${lg}｜テーマ：${theme}`;
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

  ctx.strokeStyle = "#222";
  ctx.lineWidth = 2;
  ctx.beginPath();

  points.forEach((p, i) => {
    const x = pad + (w * (points.length === 1 ? 0 : i / (points.length - 1)));
    const y = pad + h - (h * ((p.score - minV) / (maxV - minV || 1)));
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.stroke();
}

async function loadMyAnalytics(uid, userName) {
  try {
    const colRef = collection(db, "scores");
    const q = query(colRef, where("uid", "==", uid), limit(800));
    const snap = await getDocs(q);

    const rows = [];
    snap.forEach(docu => rows.push({ id: docu.id, ...docu.data() }));

    const filtered = rows
      .filter(r => r.difficulty === activeDiffTab)
      .sort((a, b) => {
        const at = a.createdAt?.toMillis?.() ?? 0;
        const bt = b.createdAt?.toMillis?.() ?? 0;
        return bt - at;
      });

    renderBest(filtered);
    renderRecent(filtered);

    drawScoreChart(buildDailyBestSeries(filtered));

    if (analyticsTitle) analyticsTitle.textContent = `入力分析（${userName}）`;
  } catch (e) {
    console.error("loadMyAnalytics error", e);
  }
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

dailyTaskEl.addEventListener("change", () => {
  applyDailyTaskModeUI();
  setNewText();
  updateLabels();
  loadDailyRanking();
  loadRanking();

  const user = auth.currentUser;
  if (user) loadMyAnalytics(user.uid, userMgr.getCurrentUserName());
});

difficultyEl.addEventListener("change", () => {
  applyDailyTaskModeUI();
  setNewText();
  updateLabels();
});

lengthGroupEl.addEventListener("change", () => {
  setNewText();
});

categoryEl.addEventListener("change", () => {
  applyThemeOptionsByCategory();
  setNewText();
});

themeEl.addEventListener("change", () => {
  setNewText();
});

closeModalBtn.addEventListener("click", () => hideModal());
nextBtn.addEventListener("click", () => {
  hideModal();
  setNewText();
});

userMgr.onChange = async () => {
  const user = auth.currentUser;
  if (user) await loadMyAnalytics(user.uid, userMgr.getCurrentUserName());
  updateLabels();
  await loadDailyRanking();
  await loadRanking();
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
   成績・分析タブイベント（非連動）
========================= */
function attachUnifiedDiffTabs() {
  const root = document.getElementById("diffTabsUnified");
  if (!root) return;

  root.querySelectorAll(".diffTab").forEach(btn => {
    btn.addEventListener("click", async () => {
      setActiveDiffTab(btn.dataset.diff);
      updateLabels();
      await loadDailyRanking();
      await loadRanking();

      const user = auth.currentUser;
      if (user) await loadMyAnalytics(user.uid, userMgr.getCurrentUserName());
    });
  });
}

/* =========================
   Init
========================= */
async function init() {
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

  setActiveDiffTab("normal");

  applyDailyTaskModeUI();
  setNewText();

  attachUnifiedDiffTabs();

  updateLabels();
  await loadDailyRanking();
  await loadRanking();
}

/* =========================
   Auth
========================= */
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
