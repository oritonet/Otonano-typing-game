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
// groupService.js は現状 index.html にUIが無いので「落ちないために import はしても、使うのはUIがある場合のみ」
// import { GroupService } from "./groupService.js";

/* =========================
   Firebase init
========================= */
const firebaseConfig = {
  apiKey: "AIzaSyAqDSPE_HkPbi-J-SqPL4Ys-wR4RaA8wKA",
  authDomain: "otonano-typing-game.firebaseapp.com",
  projectId: "otonano-typing-game",
  storageBucket: "otonano-typing-game.firebasestorage.app",
  messagingSenderId: "475283850178",
  appId: "1:475283850178:web:193d28f17be20a232f4c5b",
  measurementId: "G-JE1X0NCNHB"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);

/* =========================
   DOM
========================= */
const authBadge = document.getElementById("authBadge");
const metaInfoEl = document.getElementById("metaInfo");

// user manager
const userSelect = document.getElementById("userSelect");
const addUserBtn = document.getElementById("addUserBtn");
const renameUserBtn = document.getElementById("renameUserBtn");
const deleteUserBtn = document.getElementById("deleteUserBtn");

// filters
const difficultyEl = document.getElementById("difficulty");
const lengthGroupEl = document.getElementById("lengthGroup");
const categoryEl = document.getElementById("category");
const themeEl = document.getElementById("theme");
const dailyTaskEl = document.getElementById("dailyTask");
const dailyInfoEl = document.getElementById("dailyInfo");

// typing area
const skipBtn = document.getElementById("skipBtn");
const startBtn = document.getElementById("startBtn");
const inputEl = document.getElementById("input");
const textEl = document.getElementById("text");
const resultEl = document.getElementById("result");

// ranking
const dailyRankLabel = document.getElementById("dailyRankLabel");
const dailyRankingUL = document.getElementById("dailyRanking");

const overallLabel = document.getElementById("overallLabel");
const rankingUL = document.getElementById("ranking");

// analytics
const analyticsTitle = document.getElementById("analyticsTitle");
const analyticsLabel = document.getElementById("analyticsLabel");
const bestByDifficultyUL = document.getElementById("bestByDifficulty");
const scoreChart = document.getElementById("scoreChart");
const myRecentUL = document.getElementById("myRecent");

// compareToday は index.html に無い場合がある
const compareTodayEl = document.getElementById("compareToday");

// modal
const modalBackdrop = document.getElementById("resultModalBackdrop");
const closeModalBtn = document.getElementById("closeModalBtn");
const nextBtn = document.getElementById("nextBtn");

const mRank = document.getElementById("mRank");
const mCPM = document.getElementById("mCPM");
const mTimeSec = document.getElementById("mTimeSec");
const mLen = document.getElementById("mLen");
const mMeta = document.getElementById("mMeta");

// unified diff tabs (成績・分析用)
const diffTabsUnified = document.getElementById("diffTabsUnified");

/* =========================
   Services
========================= */
const userMgr = new UserManager({
  selectEl: userSelect,
  addBtn: addUserBtn,
  renameBtn: renameUserBtn,
  deleteBtn: deleteUserBtn,
  db
});

const rankingSvc = new RankingService({ db });

/* =========================
   State
========================= */
let allTrivia = [];
let pool = [];
let currentItem = null;

let activeDiffTab = "normal"; // easy/normal/hard  (成績・分析の表示側の難度タブ)
let currentDaily = {
  enabled: false,
  dateKey: "",
  dailyTaskKey: "",
  difficulty: "normal",
  lengthGroup: "medium",
  // 今日の課題に固定される「本文」
  text: "",
  meta: {}
};

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

function mapDifficultyToFixedLength(diff) {
  // 要件：易=極短 / 普=中 / 難=極長 に固定
  if (diff === "easy") return "xs";
  if (diff === "hard") return "xl";
  return "medium";
}

function safeText(v) {
  return (typeof v === "string") ? v : "";
}

function showModal() {
  if (!modalBackdrop) return;
  modalBackdrop.style.display = "flex";
}

function hideModal() {
  if (!modalBackdrop) return;
  modalBackdrop.style.display = "none";
}

/* =========================
   TypingEngine setup
========================= */
function onTypingFinish(metrics) {
  // metrics: typingEngine.js の computeMetrics() が返す想定の値
  // 例：{ cpm, timeSec, typed, total, accuracy, ... }
  try {
    const cpm = Math.round(Number(metrics?.cpm ?? 0));
    const timeSec = Math.round(Number(metrics?.timeSec ?? 0) * 10) / 10;

    const lengthGroup = getEffectiveLengthGroup();
    const difficulty = getEffectiveDifficulty();
    const category = safeText(categoryEl?.value ?? "");
    const theme = safeText(themeEl?.value ?? "");

    const isDailyTask = !!currentDaily.enabled;
    const dailyTaskKey = isDailyTask ? currentDaily.dailyTaskKey : null;
    const dateKey = todayKey();

    const user = auth.currentUser;
    const userName = userMgr.getCurrentUserName() || "Guest";

    const rank = rankByScore(cpm);

    // modal 表示
    if (mRank) mRank.textContent = rank;
    if (mCPM) mCPM.textContent = String(cpm);
    if (mTimeSec) mTimeSec.textContent = String(timeSec);
    if (mLen) mLen.textContent = lengthLabel(lengthGroup);

    const metaParts = [];
    metaParts.push(`難度:${diffLabel(difficulty)}`);
    metaParts.push(`長さ:${lengthLabel(lengthGroup)}`);
    if (isDailyTask) metaParts.push(`今日の課題`);
    if (theme) metaParts.push(`テーマ:${theme}`);
    if (mMeta) mMeta.textContent = metaParts.join(" / ");

    showModal();

    // スコア保存
    if (user) {
      submitScore({
        uid: user.uid,
        userName,
        cpm,
        rank,
        timeSec,
        difficulty,
        lengthGroup,
        category,
        theme,
        dateKey,
        isDailyTask,
        dailyTaskKey
      }).catch(e => console.error("submitScore error:", e));
    }

    // ランキング/分析更新
    refreshAllAfterPlay().catch(e => console.error(e));

  } catch (e) {
    console.error("onTypingFinish error:", e);
  }
}

const engine = new TypingEngine({
  textEl,
  inputEl,
  resultEl,
  onFinish: onTypingFinish
});
engine.attach();

/* =========================
   Filters (practice side)
========================= */
function getEffectiveDifficulty() {
  const d = safeText(difficultyEl?.value ?? "normal");
  return (d === "easy" || d === "hard" || d === "normal") ? d : "normal";
}

function getEffectiveLengthGroup() {
  // 今日の課題がONなら固定値
  if (currentDaily.enabled) return currentDaily.lengthGroup;
  return safeText(lengthGroupEl?.value ?? "medium") || "medium";
}

/* =========================
   Trivia load / pick
========================= */
async function loadTrivia() {
  const res = await fetch("./trivia.json", { cache: "no-cache" });
  if (!res.ok) throw new Error("trivia.json load failed");
  const json = await res.json();
  if (!Array.isArray(json)) throw new Error("trivia.json must be an array");

  // 期待：{ text, difficulty, lengthGroup, category, theme, ... } の配列
  allTrivia = json.map(x => ({
    ...x,
    text: safeText(x.text),
    difficulty: safeText(x.difficulty || "normal"),
    lengthGroup: safeText(x.lengthGroup || "medium"),
    category: safeText(x.category || "all"),
    theme: safeText(x.theme || "all")
  }));
}

function buildPool() {
  const diff = getEffectiveDifficulty();
  const len = getEffectiveLengthGroup();

  // 今日の課題ONなら「今日の課題テキストのみ」に固定
  if (currentDaily.enabled && currentDaily.text) {
    pool = [{
      text: currentDaily.text,
      difficulty: currentDaily.difficulty,
      lengthGroup: currentDaily.lengthGroup,
      category: currentDaily.meta?.category ?? "all",
      theme: currentDaily.meta?.theme ?? "all",
      _isDaily: true
    }];
    return;
  }

  const category = safeText(categoryEl?.value ?? "all");
  const theme = safeText(themeEl?.value ?? "all");

  pool = allTrivia.filter(t => {
    if (!t.text) return false;
    if (t.difficulty && t.difficulty !== diff) return false;
    if (t.lengthGroup && t.lengthGroup !== len) return false;
    if (category && category !== "all" && t.category !== category) return false;
    if (theme && theme !== "all" && t.theme !== theme) return false;
    return true;
  });

  // 0件なら難度だけ一致に緩和
  if (pool.length === 0) {
    pool = allTrivia.filter(t => t.text && t.difficulty === diff);
  }
}

function pickRandomFromPool(seedStr = "") {
  if (!pool.length) return null;
  if (!seedStr) {
    const idx = Math.floor(Math.random() * pool.length);
    return pool[idx];
  }
  // seed で安定選択（今日の課題）
  const h = hashString(seedStr);
  const idx = h % pool.length;
  return pool[idx];
}

function setTextItem(item) {
  currentItem = item;
  if (textEl) textEl.textContent = item?.text ?? "";

  // typingEngine にターゲット設定
  engine.setTarget(item?.text ?? "");
  engine.enableReadyState();
  if (inputEl) {
    inputEl.value = "";
    inputEl.disabled = true; // Start押すまで無効
    inputEl.focus();
  }

  updateMetaInfo();
}

function updateMetaInfo() {
  if (!metaInfoEl) return;

  const diff = currentDaily.enabled ? currentDaily.difficulty : getEffectiveDifficulty();
  const len = getEffectiveLengthGroup();
  const category = safeText(categoryEl?.value ?? "all");
  const theme = safeText(themeEl?.value ?? "all");

  const parts = [];
  parts.push(`難度：${diffLabel(diff)}`);
  parts.push(`長さ：${lengthLabel(len)}`);
  if (currentDaily.enabled) parts.push("今日の課題：ON");
  if (category && category !== "all") parts.push(`カテゴリ：${category}`);
  if (theme && theme !== "all") parts.push(`テーマ：${theme}`);

  metaInfoEl.textContent = parts.join(" / ");
}

function refreshText({ forceNew = false } = {}) {
  buildPool();

  if (currentDaily.enabled) {
    // 今日の課題は seed で毎回同じ（ただし forceNew は別seedにする）
    const seedBase = `${currentDaily.dateKey}|${currentDaily.difficulty}|${currentDaily.lengthGroup}`;
    const seed = forceNew ? `${seedBase}|alt|${Date.now()}` : seedBase;
    const item = pickRandomFromPool(seed);
    setTextItem(item);
    return;
  }

  // 通常：forceNew なら現 item と被りにくいように複数回トライ
  if (!forceNew) {
    const item = pickRandomFromPool("");
    setTextItem(item);
    return;
  }

  let item = null;
  for (let i = 0; i < 6; i++) {
    const cand = pickRandomFromPool("");
    if (!cand) break;
    if (!currentItem || cand.text !== currentItem.text) {
      item = cand;
      break;
    }
  }
  if (!item) item = pickRandomFromPool("");
  setTextItem(item);
}

/* =========================
   Daily Task logic
========================= */
function applyDailyDifficultyFix() {
  // 今日の課題ON時：難度に応じて長さ固定し、表示も同期
  currentDaily.difficulty = getEffectiveDifficulty();
  currentDaily.lengthGroup = mapDifficultyToFixedLength(currentDaily.difficulty);

  // lengthGroup のUI表示も強制同期（要件の「表示が元のまま」を潰す）
  if (lengthGroupEl) {
    lengthGroupEl.value = currentDaily.lengthGroup;
  }

  // 今日の課題情報表示
  if (dailyInfoEl) {
    const theme = safeText(themeEl?.value ?? "-");
    dailyInfoEl.textContent =
      `今日：${currentDaily.dateKey} / 難度：${diffLabel(currentDaily.difficulty)} / 長さ：${lengthLabel(currentDaily.lengthGroup)} / テーマ：${theme || "-"}`;
  }
}

function enableDailyTask() {
  currentDaily.enabled = true;
  currentDaily.dateKey = todayKey();

  // 今日の課題キー：日付+難度で固定（難度ごとに別課題）
  currentDaily.difficulty = getEffectiveDifficulty();
  currentDaily.lengthGroup = mapDifficultyToFixedLength(currentDaily.difficulty);
  currentDaily.dailyTaskKey = `${currentDaily.dateKey}|${currentDaily.difficulty}|${currentDaily.lengthGroup}`;

  applyDailyDifficultyFix();

  // 今日の課題文を選定（seed固定）
  buildPool();
  const item = pickRandomFromPool(`${currentDaily.dailyTaskKey}`);
  currentDaily.text = item?.text ?? "";

  // 固定文を表示
  refreshText({ forceNew: false });
}

function disableDailyTask() {
  currentDaily.enabled = false;
  currentDaily.text = "";
  currentDaily.dailyTaskKey = "";
  if (dailyInfoEl) dailyInfoEl.textContent = "";
}

/* =========================
   Firestore: submit score
========================= */
async function submitScore({
  uid,
  userName,
  cpm,
  rank,
  timeSec,
  difficulty,
  lengthGroup,
  category,
  theme,
  dateKey,
  isDailyTask,
  dailyTaskKey
}) {
  await addDoc(collection(db, "scores"), {
    uid,
    userName,
    cpm,
    rank,
    timeSec,
    difficulty,
    lengthGroup,
    category,
    theme,
    dateKey,
    isDailyTask: !!isDailyTask,
    dailyTaskKey: dailyTaskKey || null,
    createdAt: serverTimestamp()
  });
}

/* =========================
   Rankings
========================= */
function renderSimpleRanking(ul, rows) {
  if (!ul) return;
  ul.innerHTML = "";
  if (!rows || rows.length === 0) {
    const li = document.createElement("li");
    li.textContent = "まだスコアがありません。";
    ul.appendChild(li);
    return;
  }
  rankingSvc.renderList(ul, rows, { highlightUserName: userMgr.getCurrentUserName() || null });
}

async function loadDailyRanking() {
  if (!dailyRankingUL) return;

  try {
    // 今日の課題ランキングは「チェックON/OFFに関係なく常に表示」
    // → 今日の課題キーは「今日の難度タブ(activeDiffTab)」ではなく、
    //   UIの難度タブ(activeDiffTab)に合わせて表示する（あなたの画面仕様に合わせる）
    const dateKey = todayKey();
    const diff = activeDiffTab;
    const len = mapDifficultyToFixedLength(diff);
    const dailyTaskKey = `${dateKey}|${diff}|${len}`;

    if (dailyRankLabel) {
      dailyRankLabel.textContent = `今日の課題ランキング（${dateKey} / 難度：${diffLabel(diff)} / 長さ：${lengthLabel(len)}）`;
    }

    const rows = await rankingSvc.loadDailyTask({
      dailyTaskKey,
      dateKey,
      difficulty: diff
    });

    renderSimpleRanking(dailyRankingUL, rows);

  } catch (e) {
    console.error("loadDailyRanking error:", e);
    dailyRankingUL.innerHTML = "<li>ランキングの読み込みに失敗しました</li>";
  }
}

async function loadOverallRanking() {
  if (!rankingUL) return;

  try {
    // 全国ランキング：長さ/テーマ/カテゴリでフィルタしない（難度のみ）
    const rows = await rankingSvc.loadOverall({ difficulty: activeDiffTab });

    if (overallLabel) {
      overallLabel.textContent = `全国ランキング（難度：${diffLabel(activeDiffTab)}）`;
    }

    renderSimpleRanking(rankingUL, rows);

  } catch (e) {
    console.error("loadOverallRanking error:", e);
    rankingUL.innerHTML = "<li>ランキングの読み込みに失敗しました</li>";
  }
}

/* =========================
   Analytics (最低限：落ちない + 表示)
========================= */
async function loadMyAnalytics(uid, userName) {
  // userManager.js が histories を持っている想定がないため、ここは「存在するUIだけ更新」に留める
  // 追加で分析を作る場合は users/{uid}/profiles/... を使って拡張
  if (analyticsTitle) analyticsTitle.textContent = "成績・分析";
  if (analyticsLabel) analyticsLabel.textContent = `表示難度：${diffLabel(activeDiffTab)}`;

  // bestByDifficulty は空でもOK
  if (bestByDifficultyUL) {
    bestByDifficultyUL.innerHTML = "";
    const li = document.createElement("li");
    li.textContent = "（分析は今後拡張）";
    bestByDifficultyUL.appendChild(li);
  }
}

/* =========================
   After play refresh
========================= */
async function refreshAllAfterPlay() {
  await loadDailyRanking();
  await loadOverallRanking();

  const user = auth.currentUser;
  if (user) {
    await loadMyAnalytics(user.uid, userMgr.getCurrentUserName());
  }
}

/* =========================
   UI Events
========================= */
function bindUnifiedDiffTabs() {
  if (!diffTabsUnified) return;
  diffTabsUnified.querySelectorAll(".diffTab").forEach(btn => {
    btn.addEventListener("click", () => {
      const diff = btn.dataset.diff;
      if (!diff) return;
      activeDiffTab = diff;
      diffTabsUnified.querySelectorAll(".diffTab").forEach(b => {
        b.classList.toggle("active", b.dataset.diff === activeDiffTab);
      });

      // ランキングは難度タブで切り替える
      loadDailyRanking();
      loadOverallRanking();

      const user = auth.currentUser;
      if (user) loadMyAnalytics(user.uid, userMgr.getCurrentUserName());
    });
  });
}

function bindPracticeFilters() {
  if (difficultyEl) {
    difficultyEl.addEventListener("change", () => {
      if (currentDaily.enabled) {
        // 今日の課題中：難度変更→長さ固定→今日の課題キーも変わるので再選定
        enableDailyTask();
        updateMetaInfo();
      } else {
        refreshText({ forceNew: false });
      }
    });
  }

  if (lengthGroupEl) {
    lengthGroupEl.addEventListener("change", () => {
      if (currentDaily.enabled) {
        // 今日の課題では長さ固定なので UI の変更は無効化（表示を戻す）
        applyDailyDifficultyFix();
        return;
      }
      refreshText({ forceNew: false });
    });
  }

  if (categoryEl) {
    categoryEl.addEventListener("change", () => {
      if (!currentDaily.enabled) refreshText({ forceNew: false });
      updateMetaInfo();
    });
  }

  if (themeEl) {
    themeEl.addEventListener("change", () => {
      if (!currentDaily.enabled) refreshText({ forceNew: false });
      updateMetaInfo();
      loadDailyRanking();
      loadOverallRanking();
    });
  }

  if (dailyTaskEl) {
    dailyTaskEl.addEventListener("change", () => {
      if (dailyTaskEl.checked) {
        enableDailyTask();
      } else {
        disableDailyTask();
        refreshText({ forceNew: false });
      }
      updateMetaInfo();
      loadDailyRanking();
      loadOverallRanking();
    });
  }
}

function bindTypingButtons() {
  if (startBtn) {
    startBtn.addEventListener("click", async () => {
      // Start で入力を有効化 + カウントダウン
      if (inputEl) {
        inputEl.disabled = false;
        inputEl.value = "";
        inputEl.focus();
      }
      await engine.showCountdownInTextarea(3);
      engine.startNow();
    });
  }

  if (skipBtn) {
    skipBtn.addEventListener("click", () => {
      // 「別の文章にする」
      // 要件：今日の課題を一度チェックしていても、別の文章にするを押したら
      //      チェックが自動で外れて別文にする（固定解除）
      if (dailyTaskEl && dailyTaskEl.checked) {
        dailyTaskEl.checked = false;
        disableDailyTask();
      }
      refreshText({ forceNew: true });
      updateMetaInfo();
    });
  }
}

function bindModal() {
  if (closeModalBtn) closeModalBtn.addEventListener("click", hideModal);
  if (nextBtn) {
    nextBtn.addEventListener("click", () => {
      hideModal();
      // 次の文章（通常は別文、今日の課題中なら固定のまま）
      refreshText({ forceNew: !currentDaily.enabled });
    });
  }
  if (modalBackdrop) {
    modalBackdrop.addEventListener("click", (e) => {
      if (e.target === modalBackdrop) hideModal();
    });
  }
}

/* =========================
   Init
========================= */
async function initApp() {
  // タブ初期状態
  if (diffTabsUnified) {
    diffTabsUnified.querySelectorAll(".diffTab").forEach(b => {
      b.classList.toggle("active", b.dataset.diff === activeDiffTab);
    });
  }

  // trivia load
  await loadTrivia();

  // 初期出題
  refreshText({ forceNew: false });

  // events
  bindUnifiedDiffTabs();
  bindPracticeFilters();
  bindTypingButtons();
  bindModal();

  // ランキング初回ロード
  await loadDailyRanking();
  await loadOverallRanking();
}

signInAnonymously(auth).catch(e => console.error("signInAnonymously error:", e));

onAuthStateChanged(auth, async (user) => {
  if (authBadge) authBadge.textContent = user ? "認証済" : "未認証";
  if (!user) return;

  // 初回起動
  try {
    await initApp();
    await loadMyAnalytics(user.uid, userMgr.getCurrentUserName());
  } catch (e) {
    console.error("initApp error:", e);
  }
});
