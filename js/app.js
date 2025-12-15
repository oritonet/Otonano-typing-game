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
import { GroupService } from "./groupService.js";

/* =========================================================
   Firebase init
========================================================= */
const firebaseConfig = {
  apiKey: "AIzaSyAqDSPE_HkPbi-J-SqPL4Ys-wR4RaA8wKA",
  authDomain: "otonano-typing-game.firebaseapp.com",
  projectId: "otonano-typing-game",
  storageBucket: "otonano-typing-game.appspot.com",
  messagingSenderId: "475283850178",
  appId: "1:475283850178:web:193d28f17be20a232f4c5b",
  measurementId: "G-JE1X0NCNHB"
};

const fbApp = initializeApp(firebaseConfig);
const db = getFirestore(fbApp);
const auth = getAuth(fbApp);

/* =========================================================
   DOM helpers
========================================================= */
function $(id) {
  return document.getElementById(id);
}
function on(el, ev, fn) {
  if (!el) return;
  el.addEventListener(ev, fn);
}
function setText(el, txt) {
  if (!el) return;
  el.textContent = (txt ?? "").toString();
}

/* =========================================================
   DOM refs
========================================================= */
// header/status
const authBadge = $("authBadge");
const metaInfoEl = $("metaInfo");

// user manager
const userSelect = $("userSelect");
const addUserBtn = $("addUserBtn");
const renameUserBtn = $("renameUserBtn");
const deleteUserBtn = $("deleteUserBtn");

// practice filters
const difficultyEl = $("difficulty");
const lengthGroupEl = $("lengthGroup");
const categoryEl = $("category");
const themeEl = $("theme");
const dailyTaskEl = $("dailyTask");
const dailyInfoEl = $("dailyInfo");

// typing UI
const skipBtn = $("skipBtn");
const startBtn = $("startBtn");
const inputEl = $("input");
const textEl = $("text");
const resultEl = $("result");

// modal
const modalBackdrop = $("resultModalBackdrop");
const closeModalBtn = $("closeModalBtn");
const nextBtn = $("nextBtn");
const mRank = $("mRank");
const mCPM = $("mCPM");
const mTimeSec = $("mTimeSec");
const mLen = $("mLen");
const mMeta = $("mMeta");

// rankings
const dailyRankLabel = $("dailyRankLabel");
const dailyRankingUL = $("dailyRanking");
const overallLabel = $("overallLabel");
const rankingUL = $("ranking");
const groupRankingBox = $("groupRankingBox");
const groupRankLabel = $("groupRankLabel");
const groupRankingUL = $("groupRanking");

// analytics (最低限：落ちない＋表示は維持)
const analyticsTitle = $("analyticsTitle");
const analyticsLabel = $("analyticsLabel");
const bestByDifficultyUL = $("bestByDifficulty");
const myRecentUL = $("myRecent");

// difficulty tabs (ranking side)
const diffTabsUnified = $("diffTabsUnified");

// group UI
const groupCreateName = $("groupCreateName");
const groupCreateBtn = $("groupCreateBtn");
const groupSearchInput = $("groupSearchInput");
const groupSearchBtn = $("groupSearchBtn");
const groupSearchResult = $("groupSearchResult");
const currentGroupSelect = $("currentGroupSelect");
const leaveGroupBtn = $("leaveGroupBtn");
const deleteGroupBtn = $("deleteGroupBtn");
const pendingBox = $("pendingBox");
const pendingList = $("pendingList");

/* =========================================================
   Services
========================================================= */
const userMgr = new UserManager({
  selectEl: userSelect,
  addBtn: addUserBtn,
  renameBtn: renameUserBtn,
  deleteBtn: deleteUserBtn,
  db
});

const rankingSvc = new RankingService({ db });
const groupSvc = new GroupService(db);

// userName切替時：グループSelect即更新 + ランキング更新
userMgr.onUserChanged(async () => {
  await refreshMyGroups();
  await reloadAllRankings();
});


/* =========================================================
   State
========================================================= */
const State = {
  authUser: null,

  // 出題側（practice）
  currentItem: null,
  allItems: [],
  pool: [],

  // 成績・分析側（ランキングのタブ）
  activeRankDiff: "normal", // easy|normal|hard

  // 今日の課題
  daily: {
    enabled: false,
    dateKey: "",
    diff: "normal",
    lengthGroup: "medium",
    dailyTaskKey: "",
    text: "",
    meta: null
  },

  // グループ
  currentGroupId: "",
  currentGroupRole: null
};

const GROUP_STORAGE_KEY = "currentGroupId_v1";

function currentUserNameSafe() {
  return (userMgr.getCurrentUserName?.() ?? "").toString();
}

function groupStorageKeyOf(userName) {
  return `currentGroupId_v1:${userName}`;
}

function getSavedGroupIdFor(userName) {
  if (!userName) return "";
  return localStorage.getItem(groupStorageKeyOf(userName)) || "";
}

function setSavedGroupIdFor(userName, groupId) {
  if (!userName) return;
  const key = groupStorageKeyOf(userName);
  if (groupId) localStorage.setItem(key, groupId);
  else localStorage.removeItem(key);
}

function bindUserSwitchHooks() {
  // userName切替 → グループ即更新 + ランキング更新
  on(userSelect, "change", async () => {
    // userMgr側の状態反映が先に走る前提で、選択後に再描画
    await refreshMyGroups();
    await reloadAllRankings();
  });
}


/* =========================================================
   Labels / mapping
========================================================= */
function todayKey() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
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

/* =========================================================
   文章解析ユーティリティ（難易度・文章長 自動判定）
========================================================= */

// 記号スコア（IME入力の負荷を反映）
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

/* =========================
   難易度：3段階
========================= */
function difficultyByText(text) {
  const score =
    kanjiRatio(text) * 100 +
    punctScore(text) * 6 +
    digitCount(text) * 10;

  if (score < 35) return "easy";
  if (score < 65) return "normal";
  return "hard";
}

/* =========================
   文章長：5段階
========================= */
function lengthGroupOf(len) {
  if (len <= 50) return "xs";
  if (len <= 100) return "short";
  if (len <= 150) return "medium";
  if (len <= 200) return "long";
  return "xl";
}


function fixedLengthByDifficulty(diff) {
  // 要件：易=極短 / 普=中 / 難=極長
  if (diff === "easy") return "xs";
  if (diff === "hard") return "xl";
  return "medium";
}

function rankByCPM(cpm) {
  if (cpm >= 800) return "SSS";
  if (cpm >= 700) return "SS";
  if (cpm >= 600) return "S";
  if (cpm >= 500) return "A";
  if (cpm >= 400) return "B";
  if (cpm >= 300) return "C";
  return "D";
}

/* =========================================================
   Modal
========================================================= */
function showModal() {
  if (!modalBackdrop) return;
  modalBackdrop.style.display = "flex";
}
function hideModal() {
  if (!modalBackdrop) return;
  modalBackdrop.style.display = "none";
}

/* =========================================================
   Trivia load
========================================================= */
async function loadTrivia() {
  const res = await fetch("./trivia.json", { cache: "no-cache" });
  if (!res.ok) throw new Error("trivia.json load failed");
  const json = await res.json();
  if (!Array.isArray(json)) throw new Error("trivia.json must be an array");

  State.allItems = json.map((x) => {
    const text = (x?.text ?? "").toString();
    const len = text.length;
  
    return {
      ...x,
      text,
  
      // ★ 難易度：trivia.json に無ければ自動判定
      difficulty: x?.difficulty
        ? x.difficulty.toString()
        : difficultyByText(text),
  
      // ★ 文章長：trivia.json に無ければ文字数から自動判定
      lengthGroup: x?.lengthGroup
        ? x.lengthGroup.toString()
        : lengthGroupOf(len),
  
      category: (x?.category ?? "all").toString(),
      theme: (x?.theme ?? "all").toString()
    };
  });

}

/* =========================================================
   Practice filter options init（select 初期化）
========================================================= */
function initFilterOptions() {
  if (!State.allItems || State.allItems.length === 0) return;

  // 難度
  if (difficultyEl) {
    difficultyEl.innerHTML = `
      <option value="easy">難度：易</option>
      <option value="normal" selected>難度：普</option>
      <option value="hard">難度：難</option>
    `;
  }

  // 長さ
  if (lengthGroupEl) {
    lengthGroupEl.innerHTML = `
      <option value="xs">長さ：極短</option>
      <option value="short">長さ：短</option>
      <option value="medium" selected>長さ：中</option>
      <option value="long">長さ：長</option>
      <option value="xl">長さ：極長</option>
    `;
  }

  // カテゴリ
  if (categoryEl) {
    const set = new Set(State.allItems.map(x => x.category).filter(Boolean));
    categoryEl.innerHTML = `<option value="all">すべて</option>`;
    for (const v of Array.from(set).sort()) {
      const opt = document.createElement("option");
      opt.value = v;
      opt.textContent = v;
      categoryEl.appendChild(opt);
    }
  }

  // テーマ（初期：カテゴリ all）
  updateThemeOptionsByCategory();
}


/* =========================================================
   Category → Theme 連動
========================================================= */
function updateThemeOptionsByCategory() {
  if (!categoryEl || !themeEl) return;
  if (!State.allItems || State.allItems.length === 0) return;

  const selectedCategory = categoryEl.value;

  const filtered =
    selectedCategory === "all"
      ? State.allItems
      : State.allItems.filter(x => x.category === selectedCategory);

  const themeSet = new Set(filtered.map(x => x.theme).filter(Boolean));

  themeEl.innerHTML = `<option value="all">すべて</option>`;
  for (const v of Array.from(themeSet).sort()) {
    const opt = document.createElement("option");
    opt.value = v;
    opt.textContent = v;
    themeEl.appendChild(opt);
  }

  // 通常モードのみ theme をリセット
  if (!State.daily.enabled) {
    themeEl.value = "all";
  }
}



function getPracticeDifficulty() {
  const d = (difficultyEl?.value ?? "normal").toString();
  return (d === "easy" || d === "normal" || d === "hard") ? d : "normal";
}

function getPracticeLengthGroup() {
  if (State.daily.enabled) return State.daily.lengthGroup;
  const v = (lengthGroupEl?.value ?? "medium").toString();
  return v || "medium";
}

function getPracticeCategory() {
  return (categoryEl?.value ?? "all").toString();
}

function getPracticeTheme() {
  return (themeEl?.value ?? "all").toString();
}

/* =========================================================
   今日の課題
========================================================= */
function dailyTaskKeyOf(diff) {
  // 既存の保存形式に合わせる（ranking.js が dailyTaskKey を使う）
  return `${todayKey()}::${diff}`;
}

function syncDailyInfoLabel() {
  if (!dailyInfoEl) return;

  if (!State.daily.enabled) {
    dailyInfoEl.textContent = "";
    return;
  }

  const th = getPracticeTheme();
  dailyInfoEl.textContent =
    `今日：${State.daily.dateKey} / 難度：${diffLabel(State.daily.diff)} / 長さ：${lengthLabel(State.daily.lengthGroup)} / テーマ：${th || "-"}`;
}

function enableDailyTask() {
  State.daily.enabled = true;
  State.daily.dateKey = todayKey();

  const diff = getPracticeDifficulty();
  const lg = fixedLengthByDifficulty(diff);

  State.daily.diff = diff;
  State.daily.lengthGroup = lg;
  State.daily.dailyTaskKey = dailyTaskKeyOf(diff);

  const item = pickDailyItemFor(diff);

  State.daily.meta = item;
  State.daily.text = item?.text ?? "";

  setCurrentItem(item, { daily: true });

  if (lengthGroupEl) {
    lengthGroupEl.value = lg;
    lengthGroupEl.disabled = true;
  }

  if (categoryEl) {
    categoryEl.value = item?.category ?? "all";
    categoryEl.disabled = true;
  }

  if (themeEl) {
    updateThemeOptionsByCategory();
    themeEl.value = item?.theme ?? "all";
    themeEl.disabled = true;
  }

  syncDailyInfoLabel();
  updateMetaInfo();

      // 今日の課題中はカテゴリ・テーマをロック
  if (categoryEl) categoryEl.disabled = true;
  if (themeEl) themeEl.disabled = true;
  // 今日の課題中は操作不可（難度で固定されるため）
  if (lengthGroupEl) lengthGroupEl.disabled = true;
}

function disableDailyTask() {
  State.daily.enabled = false;
  State.daily.dateKey = "";
  State.daily.diff = getPracticeDifficulty();
  State.daily.lengthGroup = fixedLengthByDifficulty(State.daily.diff);
  State.daily.dailyTaskKey = "";
  State.daily.text = "";
  State.daily.meta = null;

  syncDailyInfoLabel();
    // 通常モードに戻す：カテゴリ・テーマを解放
  if (categoryEl) categoryEl.disabled = false;
  if (themeEl) themeEl.disabled = false;
    // 通常モードに戻す：長さも操作可
  if (lengthGroupEl) lengthGroupEl.disabled = false;

  buildPool();


}

function pickDailyItemForCurrent() {
  // daily: difficulty と固定length を満たす pool から安定選択
  // さらに theme/category を絞ると0件になることがあるので、段階的に緩和
  const dateKey = State.daily.dateKey || todayKey();
  const diff = State.daily.diff;
  const lg = State.daily.lengthGroup;

  const theme = getPracticeTheme();
  const category = getPracticeCategory();

  // 1) diff + lg + theme + category
  let candidates = State.allItems.filter(x =>
    x.text &&
    x.difficulty === diff &&
    x.lengthGroup === lg &&
    (category === "all" || x.category === category) &&
    (theme === "all" || x.theme === theme)
  );

  // 2) diff + lg + theme
  if (candidates.length === 0) {
    candidates = State.allItems.filter(x =>
      x.text &&
      x.difficulty === diff &&
      x.lengthGroup === lg &&
      (theme === "all" || x.theme === theme)
    );
  }

  // 3) diff + lg
  if (candidates.length === 0) {
    candidates = State.allItems.filter(x =>
      x.text &&
      x.difficulty === diff &&
      x.lengthGroup === lg
    );
  }

  if (candidates.length === 0) return null;

  const seed = `${dateKey}::${diff}::${lg}::${theme}::${category}`;
  const idx = stableIndex(seed, candidates.length);
  return candidates[idx];
}

function pickDailyItemFor(diff) {
  const dateKey = todayKey();
  const lg = fixedLengthByDifficulty(diff);

  const candidates = State.allItems.filter(x =>
    x.text &&
    x.difficulty === diff &&
    x.lengthGroup === lg
  );

  if (candidates.length === 0) return null;

  const seed = `${dateKey}::${diff}`;
  const idx = stableIndex(seed, candidates.length);
  return candidates[idx];
}

function stableIndex(seed, mod) {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) % mod;
}

/* =========================================================
   pool / pick / set item
========================================================= */
function buildPool() {
  State.hasNoItem = false;

  if (State.daily.enabled) {
    State.pool = [];
    return;
  }

  const diff = getPracticeDifficulty();
  const lg = getPracticeLengthGroup();
  const category = getPracticeCategory();
  const theme = getPracticeTheme();

  const arr = State.allItems.filter(x => {
    if (!x.text) return false;
    if (x.difficulty !== diff) return false;
    if (x.lengthGroup !== lg) return false;
    if (category !== "all" && x.category !== category) return false;
    if (theme !== "all" && x.theme !== theme) return false;
    return true;
  });

  State.pool = arr;

  if (arr.length === 0) {
    State.hasNoItem = true;
    showNoItemMessage(diff, lg, category, theme);
  }
}



function pickRandomDifferentText() {
  if (State.pool.length === 0) return null;
  if (State.pool.length === 1) return State.pool[0];

  for (let i = 0; i < 8; i++) {
    const cand = State.pool[Math.floor(Math.random() * State.pool.length)];
    if (!State.currentItem || cand.text !== State.currentItem.text) return cand;
  }
  return State.pool[Math.floor(Math.random() * State.pool.length)];
}

function setCurrentItem(item, { daily = false } = {}) {
  State.currentItem = item;

  const text = item?.text ?? "";
  if (textEl) textEl.textContent = text;

  // TypingEngine target
  engine.setTarget(text, {
    daily,
    dateKey: todayKey(),
    dailyTaskKey: daily ? State.daily.dailyTaskKey : null,
    difficulty: daily ? State.daily.diff : getPracticeDifficulty(),
    lengthGroup: daily ? State.daily.lengthGroup : getPracticeLengthGroup(),
    category: getPracticeCategory(),
    theme: getPracticeTheme(),
    groupId: State.currentGroupId || null
  });

  engine.enableReadyState();

  if (inputEl) {
    inputEl.value = "";
    inputEl.disabled = true; // Start押すまで無効
  }

  if (startBtn) {
  startBtn.disabled = false;
  }

}

/* =========================================================
   meta display
========================================================= */
function updateMetaInfo() {
  if (!metaInfoEl) return;

  const daily = State.daily.enabled;
  const diff = daily ? State.daily.diff : getPracticeDifficulty();
  const lg = daily ? State.daily.lengthGroup : getPracticeLengthGroup();

  const selectedCategory = getPracticeCategory();
  const selectedTheme = getPracticeTheme();

  const item = State.currentItem;

  const parts = [];
  parts.push(`${diffLabel(diff)}`);
  parts.push(`${lengthLabel(lg)}`);
  if (daily) parts.push("今日の課題：ON");

  // ★ カテゴリ表示
  if (selectedCategory !== "all") {
    parts.push(`カテゴリ：${selectedCategory}`);
  } else if (item?.category && item.category !== "all") {
    parts.push(`カテゴリ：${item.category}`);
  }

  // ★ テーマ表示
  if (selectedTheme !== "all") {
    parts.push(`テーマ：${selectedTheme}`);
  } else if (item?.theme && item.theme !== "all") {
    parts.push(`テーマ：${item.theme}`);
  }

  metaInfoEl.textContent = parts.join(" / ");
}


function showNoItemMessage(diff, lg, category, theme) {
  if (textEl) {
    textEl.textContent = "該当する文章がありません。";
  }

  if (inputEl) {
    inputEl.value = "";
    inputEl.disabled = true;
  }

  if (startBtn) {
    startBtn.disabled = true;
  }

  if (metaInfoEl) {
    metaInfoEl.textContent =
      `難度：${diffLabel(diff)} / 長さ：${lengthLabel(lg)} / ※該当文章なし`;
  }
}



/* =========================================================
   Typing engine setup
========================================================= */
function setModalMetrics({ cpm, rank, timeSec, difficulty, lengthGroup, isDailyTask, theme, category }) {
  setText(mRank, rank);
  setText(mCPM, String(cpm));
  setText(mTimeSec, String(timeSec));
  setText(mLen, lengthLabel(lengthGroup));

  const metaParts = [];
  metaParts.push(`難度:${diffLabel(difficulty)}`);
  metaParts.push(`長さ:${lengthLabel(lengthGroup)}`);
  if (isDailyTask) metaParts.push("今日の課題");
  if (theme && theme !== "all") metaParts.push(`テーマ:${theme}`);
  if (category && category !== "all") metaParts.push(`カテゴリ:${category}`);
  if (State.currentGroupId) metaParts.push(`グループ:${State.currentGroupId}`);
  setText(mMeta, metaParts.join(" / "));
}

async function submitScoreDoc({
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
  dailyTaskKey,
  dailyTaskName,
  groupId
}) {
  await addDoc(collection(db, "scores"), {
    uid,
    userName,
    cpm,
    rank,
    timeSec,
    length: (State.currentItem?.text ?? "").length,
    lengthGroup,
    difficulty,
    category,
    theme,
    dateKey,
    isDailyTask: !!isDailyTask,
    dailyTaskKey: dailyTaskKey || null,
    dailyTaskName: dailyTaskName || null,
    groupId: groupId || null,
    createdAt: serverTimestamp()
  });
}

/* =========================================================
   Ranking fetch (group ranking needs custom fetch)
========================================================= */
async function fetchScoresGroup({ groupId, difficulty, maxFetch = 800 }) {
  if (!groupId) return [];

  const colRef = collection(db, "scores");
  const filters = [
    where("groupId", "==", groupId)
  ];
  if (difficulty) filters.push(where("difficulty", "==", difficulty));

  const q = query(colRef, ...filters, limit(maxFetch));
  const snap = await getDocs(q);
  return snap.docs.map(d => d.data());
}

function sortAndTop10(rows) {
  const best = new Map(); // uid -> best row
  for (const r of rows) {
    const uid = r.uid || "";
    if (!uid) continue;
    const prev = best.get(uid);
    if (!prev || Number(r.cpm ?? 0) > Number(prev.cpm ?? 0)) {
      best.set(uid, r);
    }
  }
  return Array.from(best.values())
    .sort((a, b) => Number(b.cpm ?? 0) - Number(a.cpm ?? 0))
    .slice(0, 10);
}

/* =========================================================
   Ranking loaders
========================================================= */
async function loadDailyRanking() {
  if (!dailyRankingUL) return;

  const dateKey = todayKey();
  const diff = State.activeRankDiff;
  const dailyTaskKey = dailyTaskKeyOf(diff);
  const lg = fixedLengthByDifficulty(diff);

  if (dailyRankLabel) {
    // 「チェックしてなくても表示」
    const th = getPracticeTheme();
    setText(
      dailyRankLabel,
      `今日の課題ランキング（${dateKey} / 難度：${diffLabel(diff)} / 長さ：${lengthLabel(lg)} / テーマ：${th || "-"}）`
    );
  }

  try {
    const rows = await rankingSvc.loadDailyTask({
      dailyTaskKey,
      dateKey,
      difficulty: diff
    });
    rankingSvc.renderList(dailyRankingUL, rows, { highlightUserName: userMgr.getCurrentUserName?.() ?? null });
  } catch (e) {
    console.error("loadDailyRanking error:", e);
    dailyRankingUL.innerHTML = "<li>ランキングの読み込みに失敗しました</li>";
  }
}

async function loadOverallRanking() {
  if (!rankingUL) return;

  if (overallLabel) setText(overallLabel, `全国ランキング（難度：${diffLabel(State.activeRankDiff)}）`);

  try {
    // 全国ランキング：長さ/テーマでフィルタしない（ranking.js の方針に合わせる）
    const rows = await rankingSvc.loadOverall({ difficulty: State.activeRankDiff });
    rankingSvc.renderList(rankingUL, rows, { highlightUserName: userMgr.getCurrentUserName?.() ?? null });
  } catch (e) {
    console.error("loadOverallRanking error:", e);
    rankingUL.innerHTML = "<li>ランキングの読み込みに失敗しました</li>";
  }
}

async function loadGroupRanking() {
  if (!groupRankingBox || !groupRankingUL) return;

  if (!State.currentGroupId) {
    groupRankingBox.style.display = "none";
    groupRankingUL.innerHTML = "";
    setText(groupRankLabel, "");
    return;
  }

  groupRankingBox.style.display = "block";
  setText(groupRankLabel, `グループランキング（難度：${diffLabel(State.activeRankDiff)}）`);

  try {
    const rowsRaw = await fetchScoresGroup({
      groupId: State.currentGroupId,
      difficulty: State.activeRankDiff
    });

    const rows = sortAndTop10(rowsRaw);
    rankingSvc.renderList(groupRankingUL, rows, { highlightUserName: userMgr.getCurrentUserName?.() ?? null });
  } catch (e) {
    console.error("loadGroupRanking error:", e);
    groupRankingUL.innerHTML = "<li>ランキングの読み込みに失敗しました</li>";
  }
}

async function reloadAllRankings() {
  await loadDailyRanking();
  await loadOverallRanking();
  await loadGroupRanking();
}

/* =========================================================
   Analytics (最低限で落ちない)
========================================================= */
async function loadMyAnalytics() {
  if (analyticsTitle) setText(analyticsTitle, "成績・分析");
  if (analyticsLabel) setText(analyticsLabel, `表示難度：${diffLabel(State.activeRankDiff)}`);

  if (bestByDifficultyUL) {
    bestByDifficultyUL.innerHTML = "";
    const li = document.createElement("li");
    li.textContent = "（分析は今後拡張）";
    bestByDifficultyUL.appendChild(li);
  }

  if (myRecentUL) {
    myRecentUL.innerHTML = "";
    const li = document.createElement("li");
    li.textContent = "（最近の記録は今後拡張）";
    myRecentUL.appendChild(li);
  }
}

/* =========================================================
   Group UI
========================================================= */
async function refreshMyGroups() {
  if (!State.authUser) return;
  if (!currentGroupSelect) return;

  const uid = State.authUser.uid;
  const userName = userMgr.getCurrentUserName();

  let groups = [];
  try {
    groups = await groupSvc.getMyGroups(uid, userName);
  } catch (e) {
    console.error("getMyGroups failed:", e);
    groups = [];
  }

  currentGroupSelect.innerHTML = "";

  // empty option
  {
    const opt = document.createElement("option");
    opt.value = "";
    opt.textContent = "（グループ未選択）";
    currentGroupSelect.appendChild(opt);
  }

  for (const g of groups) {
    const opt = document.createElement("option");
    opt.value = g.groupId;
    opt.textContent = g.name ?? "(no name)";
    opt.dataset.role = g.role ?? "member";
    currentGroupSelect.appendChild(opt);
  }

  // ★ 保存・復元は「userName単位」でOK
  const saved = getSavedGroupIdFor(userName);
  const optionValues = Array.from(currentGroupSelect.options).map(o => o.value);

  let nextGroupId = null;
  if (saved && optionValues.includes(saved)) {
    nextGroupId = saved;
  } else if (groups.length > 0) {
    nextGroupId = groups[0].groupId;
  }

  currentGroupSelect.value = nextGroupId || "";
  State.currentGroupId = nextGroupId;

  setSavedGroupIdFor(userName, nextGroupId);

  await onGroupChanged();
}


async function loadPendingRequests() {
  if (!pendingList) return;
  pendingList.innerHTML = "";

  if (!State.currentGroupId || State.currentGroupRole !== "owner") {
    const li = document.createElement("li");
    li.textContent = "owner のみ表示されます。";
    pendingList.appendChild(li);
    return;
  }

  try {
    const reqs = await groupSvc.getPendingRequests(State.currentGroupId);

    if (!reqs || reqs.length === 0) {
      const li = document.createElement("li");
      li.textContent = "承認待ちはありません。";
      pendingList.appendChild(li);
      return;
    }

    for (const r of reqs) {
      const li = document.createElement("li");
      li.style.display = "flex";
      li.style.gap = "8px";
      li.style.alignItems = "center";

      const nameSpan = document.createElement("span");
      nameSpan.textContent = r.userName || r.uid;

      const ok = document.createElement("button");
      ok.textContent = "承認";

      const ng = document.createElement("button");
      ng.textContent = "却下";

      // ★ 承認
      on(ok, "click", async () => {
        try {
          await groupSvc.approveMember({
            requestId: r.id,
            ownerUid: State.authUser.uid,
            ownerUserName: userMgr.getCurrentUserName()
          });

          await loadPendingRequests();
          await refreshMyGroups();
        } catch (e) {
          console.error("approve failed:", e);
          alert("承認に失敗しました");
        }
      });

      // ★ 却下
      on(ng, "click", async () => {
        try {
          await groupSvc.rejectMember({ requestId: r.id });
          await loadPendingRequests();
        } catch (e) {
          console.error("reject failed:", e);
          alert("却下に失敗しました");
        }
      });

      li.appendChild(nameSpan);
      li.appendChild(ok);
      li.appendChild(ng);
      pendingList.appendChild(li);
    }
  } catch (e) {
    console.error("loadPendingRequests failed:", e);
    const li = document.createElement("li");
    li.textContent = "承認待ち一覧の取得に失敗しました。";
    pendingList.appendChild(li);
  }
}


async function onGroupChanged() {
  if (!currentGroupSelect) return;

  const sel = currentGroupSelect.selectedOptions[0];
  State.currentGroupId = sel?.value ?? "";
  State.currentGroupRole = sel?.dataset?.role ?? null;

  setSavedGroupIdFor(currentUserNameSafe(), State.currentGroupId);

  if (leaveGroupBtn) leaveGroupBtn.disabled = !State.currentGroupId;
  if (deleteGroupBtn) deleteGroupBtn.disabled = !(State.currentGroupId && State.currentGroupRole === "owner");

  if (pendingBox) {
    pendingBox.style.display = (State.currentGroupId && State.currentGroupRole === "owner") ? "block" : "none";
  }
  if (State.currentGroupId && State.currentGroupRole === "owner") {
    await loadPendingRequests();
  } else if (pendingList) {
    pendingList.innerHTML = "";
    const li = document.createElement("li");
    li.textContent = "owner のみ表示されます。";
    pendingList.appendChild(li);
  }

  await loadGroupRanking();
}

/* =========================================================
   Bind UI events
========================================================= */
function bindModal() {
  on(closeModalBtn, "click", hideModal);
  on(nextBtn, "click", () => {
    hideModal();
    // 次へ：今日の課題中は固定、通常は別文に
    if (State.daily.enabled) {
      setCurrentItem(pickDailyItemForCurrent(), { daily: true });
    } else {
      buildPool();
      if (!State.hasNoItem) {
        setCurrentItem(pickRandomDifferentText(), { daily: false });
      }
    }
    updateMetaInfo();
  });
  on(modalBackdrop, "click", (e) => {
    if (e.target === modalBackdrop) hideModal();
  });
}

function bindTypingButtons() {
  on(startBtn, "click", async () => {
    if (!inputEl) return;
    inputEl.disabled = false;
    inputEl.value = "";
    inputEl.focus();

    // カウントダウン→開始
    await engine.showCountdownInTextarea(3);
    engine.startNow();
  });

  on(skipBtn, "click", () => {
    // 要件：「別の文章にする」押下で今日の課題チェックを外して別文
    if (dailyTaskEl && dailyTaskEl.checked) {
      dailyTaskEl.checked = false;
      disableDailyTask();
    }

    buildPool();
    if (!State.hasNoItem) {
      setCurrentItem(pickRandomDifferentText(), { daily: false });
    }
    updateMetaInfo();
  });
}

function bindPracticeFilters() {
  on(difficultyEl, "change", () => {
    if (State.daily.enabled) {
      // 今日の課題中：難度変更→固定長更新→課題更新
      enableDailyTask();
    } else {
      buildPool();
      if (!State.hasNoItem) {
        setCurrentItem(pickRandomDifferentText(), { daily: false });
      }
      updateMetaInfo();
    }
  });

  on(lengthGroupEl, "change", () => {
    if (State.daily.enabled) {
      // 今日の課題は固定なので戻す
      if (lengthGroupEl) lengthGroupEl.value = State.daily.lengthGroup;
      return;
    }
    buildPool();
    if (!State.hasNoItem) {
      setCurrentItem(pickRandomDifferentText(), { daily: false });
    }
    updateMetaInfo();
  });

  on(categoryEl, "change", () => {
    updateThemeOptionsByCategory();
  
    if (State.daily.enabled) return;
  
    buildPool();
    if (!State.hasNoItem) {
      setCurrentItem(pickRandomDifferentText(), { daily: false });
    }
    updateMetaInfo();
  });



  on(themeEl, "change", () => {
    if (State.daily.enabled) return;
  
    buildPool();
    if (!State.hasNoItem) {
      setCurrentItem(pickRandomDifferentText(), { daily: false });
    }
    updateMetaInfo();
  });


  on(dailyTaskEl, "change", () => {
    if (dailyTaskEl.checked) {
      enableDailyTask();
    } else {
      disableDailyTask();
      buildPool();
      if (!State.hasNoItem) {
      setCurrentItem(pickRandomDifferentText(), { daily: false });
    }
      updateMetaInfo();
    }
    reloadAllRankings();
  });
}

function bindRankDiffTabs() {
  if (!diffTabsUnified) return;

  const buttons = diffTabsUnified.querySelectorAll("[data-diff]");
  buttons.forEach(btn => {
    on(btn, "click", async () => {
      const d = btn.dataset.diff;
      if (!d) return;
      State.activeRankDiff = d;

      // UI active
      buttons.forEach(b => b.classList.toggle("active", b.dataset.diff === State.activeRankDiff));

      await reloadAllRankings();
      await loadMyAnalytics();
    });
  });

  // 初期 active 反映
  buttons.forEach(b => b.classList.toggle("active", b.dataset.diff === State.activeRankDiff));
}

function bindGroupUI() {
  on(groupCreateBtn, "click", async () => {
    if (!State.authUser) return;
  
    const groupName = (groupCreateName?.value ?? "").trim();
    if (!groupName) {
      alert("グループ名を入力してください。");
      return;
    }
  
    try {
      const ownerUid = State.authUser.uid;
      const ownerUserName = userMgr.getCurrentUserName();
  
      const created = await groupSvc.createGroup({
        groupName,
        ownerUid,
        ownerUserName
      });
  
      groupCreateName.value = "";
  
      await refreshMyGroups();
      if (currentGroupSelect) {
        currentGroupSelect.value = created.groupId;
      }
      await onGroupChanged();
  
      alert("グループを作成しました。");
    } catch (e) {
      console.error("createGroup failed:", e);
      alert("グループ作成に失敗しました。");
    }
  });
  
  on(groupSearchBtn, "click", async () => {
    const name = (groupSearchInput?.value ?? "").trim();
    if (!name) return;
  
    try {
      const results = await groupSvc.searchGroupsByName(name);
  
      groupSearchResult.innerHTML = "";
  
      if (!results || results.length === 0) {
        const li = document.createElement("li");
        li.textContent = "該当するグループはありません。";
        groupSearchResult.appendChild(li);
        return;
      }
  
      for (const g of results) {
        const li = document.createElement("li");
        li.textContent = g.name ?? "(no name)";
  
        const btn = document.createElement("button");
        btn.textContent = "参加申請";
  
        on(btn, "click", async () => {
          try {
            await groupSvc.requestJoin({
              groupId: g.groupId,
              uid: State.authUser.uid,
              userName: userMgr.getCurrentUserName(),
              targetOwnerUserName: g.ownerUserName   // ★追加
            });
            alert("参加申請を送信しました。");
          } catch (e) {
            console.error("requestJoin failed:", e);
            alert("参加申請に失敗しました。");
          }
        });
  
        li.appendChild(btn);
        groupSearchResult.appendChild(li);
      }
    } catch (e) {
      console.error("searchGroups failed:", e);
    }
  });


  // groupSearchResult クリックで加入申請（index.htmlは「結果エリア」なのでここで操作）
  on(groupSearchResult, "click", async () => {
    if (!State.authUser) return;

    const gid = groupSearchResult?.dataset?.groupId || "";
    if (!gid) return;

    try {
      await groupSvc.requestJoin(gid, State.authUser.uid, userMgr.getCurrentUserName?.() ?? "Guest");
      alert("参加申請しました。承認されるまでお待ちください。");
    } catch (e) {
      console.error("requestJoin failed:", e);
      alert("参加申請に失敗しました。");
    }
  });

  on(currentGroupSelect, "change", onGroupChanged);
  
  on(leaveGroupBtn, "click", async () => {
    if (!State.currentGroupId) return;
  
    if (!confirm("このグループから退出しますか？")) return;
  
    try {
      await groupSvc.leaveGroup({
        groupId: State.currentGroupId,
        uid: State.authUser.uid,
        userName: userMgr.getCurrentUserName()
      });
  
      await refreshMyGroups();
      await onGroupChanged();
    } catch (e) {
      console.error("leaveGroup failed:", e);
      alert("グループ退出に失敗しました");
    }
  });


  on(deleteGroupBtn, "click", async () => {
    if (!State.currentGroupId) return;
    if (State.currentGroupRole !== "owner") return;
  
    if (!confirm("このグループを削除しますか？")) return;
  
    try {
      await groupSvc.deleteGroup({
        groupId: State.currentGroupId
      });
  
      await refreshMyGroups();
      await onGroupChanged();
    } catch (e) {
      console.error("deleteGroup failed:", e);
      alert("グループ削除に失敗しました");
    }
  });


}

/* =========================================================
   TypingEngine instance (must be after DOM refs)
========================================================= */
function onTypingFinish({ metrics, meta }) {
  try {
    const cpm = Math.round(Number(metrics?.cpm ?? 0));
    const timeSec = Math.round(Number(metrics?.timeSec ?? 0) * 10) / 10;
    const rank = metrics?.rank ?? rankByCPM(cpm);

    const isDailyTask = !!meta?.daily;
    const difficulty = meta?.difficulty ?? getPracticeDifficulty();
    const lengthGroup = meta?.lengthGroup ?? getPracticeLengthGroup();
    const category = meta?.category ?? getPracticeCategory();
    const theme = meta?.theme ?? getPracticeTheme();

    setModalMetrics({
      cpm,
      rank,
      timeSec,
      difficulty,
      lengthGroup,
      isDailyTask,
      theme,
      category
    });

    showModal();

    const user = State.authUser;
    const uid = user?.uid;
    const userName = userMgr.getCurrentUserName?.() ?? "Guest";
    const dateKey = todayKey();
    const dailyTaskKey = meta?.dailyTaskKey ?? (isDailyTask ? State.daily.dailyTaskKey : null);
    const dailyTaskName = isDailyTask ? (theme !== "all" ? theme : (category !== "all" ? category : "今日の課題")) : null;

    // groupId は「選択中グループ」をそのまま保存（グループランキングのため）
    const groupId = State.currentGroupId || null;

    if (uid) {
      submitScoreDoc({
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
        dailyTaskKey,
        dailyTaskName,
        groupId
      }).catch(e => console.error("submitScoreDoc error:", e));
    }

    // 終了後にランキング更新
    reloadAllRankings().catch(() => {});
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

/* =========================================================
   App init
========================================================= */
 async function initApp() {
   await loadTrivia();
   initFilterOptions(); // ← ★これを追加
 
   // 初期：今日の課題は OFF、通常出題
   disableDailyTask();
   buildPool();

  if (!State.hasNoItem) {
    setCurrentItem(pickRandomDifferentText(), { daily: false });
  }
  updateMetaInfo();
  syncDailyInfoLabel();

  bindModal();
  bindTypingButtons();
  bindPracticeFilters();
  bindRankDiffTabs();
  bindGroupUI();
  bindUserSwitchHooks();


  // 認証後にグループ一覧
  await refreshMyGroups();

  // 初回ランキング
  await reloadAllRankings();
  await loadMyAnalytics();
}

/* =========================================================
   Auth start
========================================================= */
signInAnonymously(auth).catch((e) => {
  console.error("signInAnonymously error:", e);
  setText(authBadge, "認証：失敗（Consoleを確認）");
});

onAuthStateChanged(auth, async (user) => {
  State.authUser = user || null;
  setText(authBadge, user ? "認証：OK（匿名）" : "認証：未");

  if (!user) return;

  try {
    // ★ auth.uid が確定してから init（端末ごとの last userName 復元 or guest 新規作成）
    await userMgr.init(user.uid);
    await initApp();
  } catch (e) {
    console.error("initApp error:", e);
  }
});











