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
function hide(el) {
  if (!el) return;
  el.style.display = "none"; // レイアウトから消す（余白が残らない）
}
function bindToggle(btnId, panelId) {
  const btn = $(btnId);
  const panel = $(panelId);
  if (!btn || !panel) return;

  btn.addEventListener("click", () => {
    const open = panel.classList.toggle("open");
    btn.textContent = open ? btn.textContent.replace("▾", "▲") : btn.textContent.replace("▲", "▾");
  });
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

async function submitScoreDoc({
  personalId,
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
  if (!personalId || !uid) return;

  try {
    await addDoc(collection(db, "scores"), {
      personalId,          // ★追加（主キー）
      uid,
      userName,            // 表示用
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
      dailyTaskName: dailyTaskName || null,
      groupId: groupId || null,
      createdAt: serverTimestamp()
    });
  } catch (e) {
    console.error("submitScoreDoc failed:", e);
  }
}



// userName切替時：グループSelect即更新 + ランキング更新
userMgr.onUserChanged(async () => {
  // ★ ユーザーごとの前回状態を復元
  const userName = currentUserNameSafe();
  const prefs = loadPrefsOf(userName);
  applyPrefsToUI(prefs);

  if (dailyTaskEl?.checked) enableDailyTask();
  else disableDailyTask();

  buildPool();
  if (!State.hasNoItem) setCurrentItem(pickRandomDifferentText(), { daily: false });
  updateMetaInfo();
  syncDailyInfoLabel();

  await refreshMyGroups();
  await reloadAllRankings();
});

async function buildUserNameMapFromScores(db, rows) {
  const map = new Map();

  const personalIds = [...new Set(
    rows.map(r => r.personalId).filter(Boolean)
  )];

  for (const pid of personalIds) {
    try {
      const snap = await getDoc(doc(db, "userProfiles", pid));
      if (snap.exists()) {
        const data = snap.data();
        if (data.userName) {
          map.set(pid, data.userName);
        }
      }
    } catch (e) {
      // 読めないユーザーはスキップ（Rules上あり得る）
    }
  }

  return map;
}



/* =========================================================
   State
========================================================= */
const State = {
  authUser: null,

  // ★ 追加：今日の課題 ON 前の退避
  beforeDailyPrefs: null,

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

/* =========================================================
   Practice/Ranking UI state (localStorage)
   userName 単位で復元（端末内の複数ユーザーに対応）
========================================================= */
function prefsKeyOf(personalId) {
  return `practicePrefs_v1:${personalId || "unknown"}`;
}

function loadPrefsOf(personalId) {
  try {
    const raw = localStorage.getItem(prefsKeyOf(personalId));
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function savePrefsOf(personalId, prefs) {
  try {
    localStorage.setItem(prefsKeyOf(personalId), JSON.stringify(prefs || {}));
  } catch {}
}

function collectCurrentPrefs() {
  return {
    difficulty: (difficultyEl?.value ?? "normal").toString(),
    lengthGroup: (lengthGroupEl?.value ?? "medium").toString(),
    category: (categoryEl?.value ?? "all").toString(),
    theme: (themeEl?.value ?? "all").toString(),
    dailyTaskEnabled: !!dailyTaskEl?.checked,
    activeRankDiff: (State.activeRankDiff ?? "normal").toString()
    // グループは既存の currentGroupId_v1:${userName} で別保存なのでここでは持たない
  };
}

function applyPrefsToUI(prefs) {
  if (!prefs) return;

  // option が存在する値だけ反映（存在しない値は無視）
  const setIfExists = (selectEl, v) => {
    if (!selectEl) return;
    const val = (v ?? "").toString();
    if (!val) return;
    const ok = Array.from(selectEl.options).some(o => o.value === val);
    if (ok) selectEl.value = val;
  };

  setIfExists(difficultyEl, prefs.difficulty);
  setIfExists(lengthGroupEl, prefs.lengthGroup);

  // category は先に反映 → theme options 再構築 → theme 反映、の順が必須
  setIfExists(categoryEl, prefs.category);
  updateThemeOptionsByCategory(); // 既存関数 :contentReference[oaicite:3]{index=3}
  setIfExists(themeEl, prefs.theme);

  if (dailyTaskEl) dailyTaskEl.checked = !!prefs.dailyTaskEnabled;

  if (prefs.activeRankDiff === "easy" || prefs.activeRankDiff === "normal" || prefs.activeRankDiff === "hard") {
    State.activeRankDiff = prefs.activeRankDiff;
  }
}

function persistPrefsNow() {
  const personalId = userMgr.getCurrentPersonalId();
  if (!personalId) return;
  savePrefsOf(personalId, collectCurrentPrefs());
}

function currentUserNameSafe() {
  return (userMgr.getCurrentPersonalId?.() ?? "").toString();
}

function groupStorageKeyOf(personalId) {
  return `currentGroupId_v1:${personalId}`;
}

function getSavedGroupIdFor(personalId) {
  if (!personalId) return "";
  return localStorage.getItem(groupStorageKeyOf(personalId)) || "";
}

function setSavedGroupIdFor(personalId, groupId) {
  if (!personalId) return;
  const key = groupStorageKeyOf(personalId);
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

// 漢字密度
function kanjiRatio(text) {
  const total = Math.max(text.length, 30);
  const kanji = (text.match(/[一-龥]/g) || []).length;
  return kanji / total;
}

// 記号密度（IME負荷を考慮した重み付き）
function punctDensity(text) {
  const total = Math.max(text.length, 30);

  const strong = (text.match(/[（）「」『』［］【】＜＞”’]/g) || []).length;
  const middle = (text.match(/[￥＄：；]/g) || []).length;
  const weak   = (text.match(/[ー・＃％＆＋－＝／]/g) || []).length;
  const basic  = (text.match(/[、。,.!！?？]/g) || []).length;

  return (
    strong * 3 +
    middle * 2 +
    weak   * 1 +
    basic  * 0.5
  ) / total;
}

// 数字密度
function digitRatio(text) {
  const total = Math.max(text.length, 30);
  const digits = (text.match(/[0-9]/g) || []).length;
  return digits / total;
}

//IME入力負荷目線
function imeScore(text) {
  return (
    kanjiRatio(text)   * 60 +
    punctDensity(text) * 30 +
    digitRatio(text)  * 20
  );
}

//読解難度目線
function readingScore(text) {
  return (
    kanjiRatio(text)   * 80 +
    punctDensity(text) * 25 +
    digitRatio(text)  * 10
  );
}

/* =========================
   難易度：3段階
========================= */
function difficultyByText(text) {
  const ime = imeScore(text);
  const reading = readingScore(text);

  // 合成比率（用途に応じて調整）
  const combined = ime * 0.5 + reading * 0.5;

  if (combined < 25) return "easy";
  if (combined < 33) return "normal";
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

function rankByCPM(cpm, difficulty = getPracticeDifficulty()) {
  const base = Number(cpm) || 0;
  const k =
    difficulty === "easy" ? 1.05 :
    difficulty === "hard" ? 0.92 : 1.0;
  const v = base / k;

  const thresholds = [
    ["G-", 0],   ["G", 10],   ["G+", 20],
    ["F-", 30],  ["F", 40],   ["F+", 50],
    ["E-", 60],  ["E", 70],   ["E+", 80],
    ["D-", 90],  ["D", 100],  ["D+", 110],
    ["C-", 120], ["C", 130],  ["C+", 140],
    ["B-", 150], ["B", 160],  ["B+", 170],
    ["A-", 180], ["A", 190],  ["A+", 200],
    ["S-", 210], ["S", 220],  ["S+", 230],
    ["SS-", 240],["SS", 250], ["SS+", 260],
    ["SSS-", 270],["SSS", 280],["SSS+", 290],
  ];

  let r = "G-";
  for (const [name, need] of thresholds) {
    if (v >= need) r = name;
    else break;
  }
  return r;
}

function rankIndex(rank) {
  const order = [
    "G-", "G", "G+",
    "F-", "F", "F+",
    "E-", "E", "E+",
    "D-", "D", "D+",
    "C-", "C", "C+",
    "B-", "B", "B+",
    "A-", "A", "A+",
    "S-", "S", "S+",
    "SS-", "SS", "SS+",
    "SSS-", "SSS", "SSS+"
  ];
  return order.indexOf(rank);
}

function rankStage(rank) {
  if (rank.startsWith("SSS")) return "SSS";
  if (rank.startsWith("SS"))  return "SS";
  if (rank.startsWith("S"))   return "S";
  if (rank.startsWith("A"))   return "A";
  if (rank.startsWith("B"))   return "B";
  if (rank.startsWith("C"))   return "C";
  if (rank.startsWith("D"))   return "D";
  if (rank.startsWith("E"))   return "E";
  if (rank.startsWith("F"))   return "F";
  return "G";
}

function isMasterOrAbove(rank) {
  return rankIndex(rank) >= rankIndex("S-");
}

const RANK_MESSAGES = {
  G: {
    title: "入門",
    message: "焦るな。まずは打ち切れ。\nそれが第一歩だ。"
  },
  F: {
    title: "修練",
    message: "迷いが減れば速さになる。\n稽古は裏切らない。"
  },
  E: {
    title: "初段",
    message: "流れを切るな。\n呼吸で文章を運べ。"
  },
  D: {
    title: "中段",
    message: "安定は強さ。\n地味こそ最強の型。"
  },
  C: {
    title: "上段",
    message: "先を見ろ。\n勝ちは準備で決まる。"
  },
  B: {
    title: "師範代",
    message: "速さに品が出てきた。\n余裕が力だ。"
  },
  A: {
    title: "師範",
    message: "難所で崩れない。\nそれが実力の証。"
  },
  S: {
    title: "達人",
    message: "無駄を削れ。\n軽さが速さになる。"
  },
  SS: {
    title: "宗匠",
    message: "型は裏切らない。\n数字がそれを証明する。"
  },
  SSS: {
    title: "無双",
    message: "静かに勝つ。\nここが到達点だ。"
  }
};

const RANK_IMAGES = {

  /* G：入門（おどおど） */
  G: `
<svg viewBox="0 0 200 200">
  <circle cx="100" cy="70" r="45" fill="#e0b070" stroke="#000" stroke-width="5"/>
  <circle cx="85" cy="65" r="6"/><circle cx="115" cy="65" r="6"/>
  <path d="M90 85 Q100 80 110 85" fill="none" stroke="#000" stroke-width="4"/>
  <rect x="70" y="115" width="60" height="50" rx="20" fill="#e0b070" stroke="#000" stroke-width="5"/>
  <text x="100" y="190" text-anchor="middle" font-size="18">入門</text>
</svg>`,

  /* F：修練（構え） */
  F: `
<svg viewBox="0 0 200 200">
  <circle cx="100" cy="70" r="45" fill="#d9a85f" stroke="#000" stroke-width="5"/>
  <circle cx="85" cy="65" r="6"/><circle cx="115" cy="65" r="6"/>
  <path d="M85 85 Q100 90 115 85" fill="none" stroke="#000" stroke-width="4"/>
  <rect x="65" y="115" width="70" height="50" rx="20" fill="#d9a85f" stroke="#000" stroke-width="5"/>
  <text x="100" y="190" text-anchor="middle" font-size="18">修練</text>
</svg>`,

  /* E：初段（集中） */
  E: `
<svg viewBox="0 0 200 200">
  <circle cx="100" cy="70" r="45" fill="#d2a060" stroke="#000" stroke-width="5"/>
  <rect x="80" y="60" width="15" height="6"/>
  <rect x="105" y="60" width="15" height="6"/>
  <path d="M90 85 H110" stroke="#000" stroke-width="4"/>
  <rect x="65" y="115" width="70" height="50" rx="18" fill="#d2a060" stroke="#000" stroke-width="5"/>
  <text x="100" y="190" text-anchor="middle" font-size="18">初段</text>
</svg>`,

  /* D：中段（安定） */
  D: `
<svg viewBox="0 0 200 200">
  <circle cx="100" cy="70" r="45" fill="#cfa45a" stroke="#000" stroke-width="5"/>
  <circle cx="85" cy="65" r="5"/><circle cx="115" cy="65" r="5"/>
  <path d="M90 88 Q100 92 110 88" fill="none" stroke="#000" stroke-width="4"/>
  <rect x="60" y="115" width="80" height="55" rx="20" fill="#cfa45a" stroke="#000" stroke-width="5"/>
  <text x="100" y="190" text-anchor="middle" font-size="18">中段</text>
</svg>`,

  /* C：上段（余裕） */
  C: `
<svg viewBox="0 0 200 200">
  <circle cx="100" cy="70" r="45" fill="#caa04a" stroke="#000" stroke-width="5"/>
  <path d="M80 60 H95 M105 60 H120" stroke="#000" stroke-width="4"/>
  <path d="M85 90 Q100 80 115 90" fill="none" stroke="#000" stroke-width="4"/>
  <rect x="60" y="115" width="80" height="55" rx="22" fill="#caa04a" stroke="#000" stroke-width="5"/>
  <text x="100" y="190" text-anchor="middle" font-size="18">上段</text>
</svg>`,

  /* B：師範代（自信） */
  B: `
<svg viewBox="0 0 200 200">
  <circle cx="100" cy="65" r="45" fill="#c79a3c" stroke="#000" stroke-width="5"/>
  <path d="M80 60 H100 M105 60 H125" stroke="#000" stroke-width="4"/>
  <path d="M90 90 Q100 75 110 90" fill="none" stroke="#000" stroke-width="4"/>
  <rect x="55" y="110" width="90" height="60" rx="25" fill="#c79a3c" stroke="#000" stroke-width="5"/>
  <text x="100" y="190" text-anchor="middle" font-size="18">師範代</text>
</svg>`,

  /* A：師範（堂々） */
  A: `
<svg viewBox="0 0 200 200">
  <circle cx="100" cy="60" r="45" fill="#c4942e" stroke="#000" stroke-width="5"/>
  <path d="M75 55 H95 M105 55 H125" stroke="#000" stroke-width="5"/>
  <path d="M90 92 Q100 85 110 92" fill="none" stroke="#000" stroke-width="4"/>
  <rect x="50" y="110" width="100" height="65" rx="28" fill="#c4942e" stroke="#000" stroke-width="5"/>
  <text x="100" y="190" text-anchor="middle" font-size="18">師範</text>
</svg>`,

  /* S：達人（静） */
  S: `
<svg viewBox="0 0 200 200">
  <circle cx="100" cy="60" r="45" fill="#d4af37" stroke="#000" stroke-width="5"/>
  <path d="M85 58 H115" stroke="#000" stroke-width="5"/>
  <path d="M90 95 H110" stroke="#000" stroke-width="4"/>
  <rect x="45" y="110" width="110" height="70" rx="30" fill="#d4af37" stroke="#000" stroke-width="5"/>
  <text x="100" y="190" text-anchor="middle" font-size="18">達人</text>
</svg>`,

  /* SS：宗匠（威厳） */
  SS: `
<svg viewBox="0 0 200 200">
  <circle cx="100" cy="55" r="45" fill="#e0c35a" stroke="#000" stroke-width="6"/>
  <path d="M80 55 H120" stroke="#000" stroke-width="6"/>
  <rect x="40" y="105" width="120" height="75" rx="35" fill="#e0c35a" stroke="#000" stroke-width="6"/>
  <text x="100" y="190" text-anchor="middle" font-size="18">宗匠</text>
</svg>`,

  /* SSS：無双（到達点） */
  SSS: `
<svg viewBox="0 0 200 200">
  <defs>
    <linearGradient id="gold" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#fff5c0"/>
      <stop offset="100%" stop-color="#d4af37"/>
    </linearGradient>
  </defs>
  <rect x="10" y="10" width="180" height="180" rx="30"
        fill="url(#gold)" stroke="#000" stroke-width="6"/>
  <circle cx="100" cy="70" r="40" fill="#fff" stroke="#000" stroke-width="4"/>
  <path d="M60 135 C80 115,120 115,140 135" fill="none" stroke="#000" stroke-width="5"/>
  <text x="100" y="185" text-anchor="middle" font-size="22" font-weight="900">無双</text>
</svg>`
};





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
    categoryEl.innerHTML = `<option value="all">カテゴリ：すべて</option>`;
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
function updateThemeOptionsByCategory(keepTheme = true) {
  if (!categoryEl || !themeEl) return;
  if (!State.allItems || State.allItems.length === 0) return;

  const prevTheme = themeEl.value;
  const selectedCategory = categoryEl.value;

  const filtered =
    selectedCategory === "all"
      ? State.allItems
      : State.allItems.filter(x => x.category === selectedCategory);

  const themeSet = new Set(filtered.map(x => x.theme).filter(Boolean));

  themeEl.innerHTML = `<option value="all">テーマ：すべて</option>`;

  for (const v of Array.from(themeSet).sort()) {
    const opt = document.createElement("option");
    opt.value = v;
    opt.textContent = v;
    themeEl.appendChild(opt);
  }

  // ★ 選択テーマを可能な限り維持
  if (keepTheme && [...themeSet].includes(prevTheme)) {
    themeEl.value = prevTheme;
  } else {
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
  const cat = (categoryEl?.value ?? "all").toString();
  if (cat !== "all") return cat;

  // ★ カテゴリが all の場合、テーマから補完
  const theme = getPracticeTheme();
  return categoryByTheme(theme);
}


function getPracticeTheme() {
  return (themeEl?.value ?? "all").toString();
}

/* =========================================================
    Theme→ Category 連動
========================================================= */
function categoryByTheme(theme) {
  if (!theme || theme === "all") return "all";

  const item = State.allItems.find(x => x.theme === theme);
  return item?.category ?? "all";
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
    inputEl.disabled = true; // Start押すまで無効
  }

  if (startBtn) {
    startBtn.disabled = false;
    startBtn.style.display = ""; // ★文章更新で必ず復活
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
function setModalMetrics({
  cpm,
  rank,
  timeSec,
  difficulty,
  lengthGroup,
  isDailyTask,
  theme,
  category
}) {
  /* =========================
     ランク表示
  ========================= */
  setText(mRank, rank);

  // ★ 達人以上は金色
  mRank.classList.toggle("rankGold", isMasterOrAbove(rank));

  setText(mCPM, String(cpm));
  setText(mTimeSec, String(timeSec));
  setText(mLen, lengthLabel(lengthGroup));

  /* =========================
     ランクアップ判定
  ========================= */
  const rankUpEl = document.getElementById("mRankUp");

  // ユーザー×難易度ごとに前回ベストを保存
  const key = `bestRank::${State.authUser?.uid || "guest"}::${difficulty}`;
  const prevRank = localStorage.getItem(key) || "G-";

  if (rankIndex(rank) > rankIndex(prevRank)) {
    localStorage.setItem(key, rank);

    const fromStage = rankStage(prevRank);
    const toStage = rankStage(rank);

    if (rankUpEl) {
      rankUpEl.textContent =
        fromStage !== toStage
          ? `${fromStage} → ${toStage}`
          : `ランクアップ！ ${prevRank} → ${rank}`;
      rankUpEl.style.display = "";
    }
  } else {
    if (rankUpEl) rankUpEl.style.display = "none";
  }

  /* =========================
     メタ情報
  ========================= */
  const metaParts = [];
  metaParts.push(`難度:${diffLabel(difficulty)}`);
  metaParts.push(`長さ:${lengthLabel(lengthGroup)}`);
  if (isDailyTask) metaParts.push("今日の課題");
  if (theme && theme !== "all") metaParts.push(`テーマ:${theme}`);
  if (category && category !== "all") metaParts.push(`カテゴリ:${category}`);
  if (State.currentGroupId) metaParts.push(`グループ:${State.currentGroupId}`);
  setText(mMeta, metaParts.join(" / "));
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

  hide(dailyRankLabel);

  try {
    // ① ランキングデータ取得
    const rows = await rankingSvc.loadDailyTask({
      dailyTaskKey,
      dateKey,
      difficulty: diff
    });

    // ② rows から最新 userNameMap を作成
    const userNameMap = await buildUserNameMapFromScores(db, rows);

    // ③ 表示（最新 userName を使用）
    rankingSvc.renderList(dailyRankingUL, rows, {
      highlightPersonalId: userMgr.getCurrentPersonalId?.() ?? null,
      userNameMap
    });

  } catch (e) {
    console.error("loadDailyRanking error:", e);
    dailyRankingUL.innerHTML = "<li>ランキングの読み込みに失敗しました</li>";
  }
}


async function loadOverallRanking() {
  if (!rankingUL) return;

  hide(overallLabel);

  try {
    // 全国ランキング：長さ/テーマでフィルタしない（ranking.js の方針に合わせる）
    const rows = await rankingSvc.loadOverall({ difficulty: State.activeRankDiff });
  rankingSvc.renderList(rankingUL, rows, {
    highlightPersonalId: userMgr.getCurrentPersonalId(),
    userNameMap
  });

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
  hide(groupRankLabel);

  try {
    const rowsRaw = await fetchScoresGroup({
      groupId: State.currentGroupId,
      difficulty: State.activeRankDiff
    });

    const rows = sortAndTop10(rowsRaw);
    rankingSvc.renderList(groupRankingUL, rows, { highlightPersonalId: userMgr.getCurrentPersonalId?.() ?? null });
  } catch (e) {
    console.error("loadGroupRanking error:", e);
    groupRankingUL.innerHTML = "<li>ランキングの読み込みに失敗しました</li>";
  }
}

async function reloadAllRankings() {
  const rows = await rankingSvc.loadOverallRanking(...);
  
  const userNameMap = await buildUserNameMapFromScores(db, rows);
  
  rankingSvc.renderList(rankingUL, rows, {
    highlightPersonalId: userMgr.getCurrentPersonalId(),
    userNameMap
  });

  await loadDailyRanking();
  await loadOverallRanking();
  await loadGroupRanking();
}

/* =========================================================
   Analytics (最低限で落ちない)
========================================================= */
async function loadMyAnalytics() {
  const personalId = userMgr.getCurrentPersonalId();
  if (!personalId) return;

  setText(analyticsTitle, "入力分析");

  bestByDifficulty.innerHTML = "";

  const q = query(
    collection(db, "scores"),
    where("personalId", "==", personalId),
    where("difficulty", "==", State.activeRankDiff),
    limit(500)
  );

  const snap = await getDocs(q);
  const rows = snap.docs.map(d => d.data());

  if (rows.length === 0) {
    bestByDifficulty.textContent = "まだ記録がありません。";
    return;
  }

  const best = rows.reduce((a, b) =>
    Number(b.cpm) > Number(a.cpm) ? b : a
  );

  const bestScore = Math.round(best.cpm);
  const rank = rankByCPM(bestScore, State.activeRankDiff);
  const stage = rankStage(rank);
  const msg = RANK_MESSAGES[stage];

  const formattedMessage =
    msg.message.replace(/\n/g, "<br>");

  bestByDifficulty.innerHTML = `
    <table class="powerTable">
      <tr>
        <td class="label">ランク</td>
        <td class="rank">${rank}</td>
      </tr>
      <tr>
        <td class="label">ベストスコア</td>
        <td class="score">${bestScore}</td>
      </tr>
      <tr>
        <td colspan="2" class="message">
          『${msg.title}』<br>
          ${formattedMessage}
        </td>
      </tr>
    </table>
  `;

  // ===== 称号画像の表示（★ここに置く）=====
  const imgBox = document.getElementById("rankImageBox");
  if (imgBox) {
    imgBox.innerHTML = RANK_IMAGES[stage] ?? "";
  }
}

/* =========================================================
   Group UI
========================================================= */
async function refreshMyGroups() {
  if (!State.authUser) return;
  if (!currentGroupSelect) return;

  const uid = State.authUser.uid;
  const userName = userMgr.getCurrentPersonalId();

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
  
  if (State.currentGroupId && State.currentGroupRole === "owner") {
    await loadPendingRequests();
  }
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

    // ★★★ ここが重要：同一人物をまとめる ★★★
    const map = new Map(); // key = uid::userName
    for (const r of reqs) {
      const key = `${r.uid}::${r.userName}`;
      if (!map.has(key)) {
        map.set(key, r);
      }
    }

    for (const r of map.values()) {
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

      ok.addEventListener("click", async () => {
        await groupSvc.approveMember({
          requestId: r.id,
          ownerUid: State.authUser.uid,
          ownerUserName: userMgr.getCurrentPersonalId()
        });
        await refreshMyGroups();
      });

      ng.addEventListener("click", async () => {
        await groupSvc.rejectMember({ requestId: r.id });
        await refreshMyGroups();
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
  const canStartNow = () => {
    if (!startBtn || startBtn.disabled) return false;
    if (startBtn.style.display === "none") return false;

    // モーダル表示中は開始しない
    if (modalBackdrop && modalBackdrop.style.display === "flex") return false;

    // フォーム操作中（select等）に Space が誤爆しないようガード
    const ae = document.activeElement;
    const tag = ae?.tagName || "";
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") {
      // ただし「タイピング欄（disabled）」にフォーカスがある場合は許可
      if (ae !== inputEl) return false;
    }

    return true;
  };

  const startSequence = async () => {
    if (!inputEl || !canStartNow()) return;

    // 開始したらスタートを消す（要件）
    startBtn.style.display = "none";

    // カウントダウン → 開始
    await engine.showCountdownInTextarea(3);
    engine.startNow();
  };

  on(startBtn, "click", startSequence);

  // Space/Enter で開始（app.js側）
  document.addEventListener("keydown", (e) => {
    if (!canStartNow()) return;

    if (e.code === "Space" || e.code === "Enter") {
      e.preventDefault();
      startSequence();
    }
  });

  on(skipBtn, "click", () => {
    // 既存処理そのまま
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
      persistPrefsNow(); // ★追加
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
    persistPrefsNow(); // ★追加
  });

  on(categoryEl, "change", () => {
    const category = categoryEl.value;
  
    // ★ カテゴリが all に戻ったら、テーマも all に戻す
    if (category === "all") {
      if (themeEl) themeEl.value = "all";
      updateThemeOptionsByCategory(false); // keepTheme = false
    } else {
      updateThemeOptionsByCategory(true);  // 通常はテーマ維持
    }
  
    if (State.daily.enabled) return;
  
    buildPool();
    if (!State.hasNoItem) {
      setCurrentItem(pickRandomDifferentText(), { daily: false });
    }
    updateMetaInfo();
    persistPrefsNow(); // ★追加
  });
  
    
  on(themeEl, "change", () => {
    if (State.daily.enabled) return;
  
    const selectedTheme = themeEl.value;
    const prevCategory = categoryEl.value;
  
    let categoryChanged = false;
  
    // ① カテゴリが all の場合のみ、テーマからカテゴリ確定
    if (prevCategory === "all" && selectedTheme !== "all") {
      const cat = categoryByTheme(selectedTheme);
      if (cat && cat !== "all") {
        categoryEl.value = cat;
        categoryChanged = true;
      }
    }
  
    // ② カテゴリが変わったら、テーマ候補を再構築
    if (categoryChanged) {
      updateThemeOptionsByCategory(true);
      themeEl.value = selectedTheme; // ★ 必ず維持
    }
  
    buildPool();
    if (!State.hasNoItem) {
      setCurrentItem(pickRandomDifferentText(), { daily: false });
    }
    updateMetaInfo();
    persistPrefsNow(); // ★追加
  });
  
  on(dailyTaskEl, "change", () => {
    if (dailyTaskEl.checked) {
      // ONにする直前の状態を退避
      State.beforeDailyPrefs = {
        lengthGroup: lengthGroupEl?.value ?? "medium",
        category: categoryEl?.value ?? "all",
        theme: themeEl?.value ?? "all"
      };
  
      enableDailyTask();
    } else {
      disableDailyTask();
  
      // OFFに戻したら元の状態を復元
      if (State.beforeDailyPrefs) {
        const { lengthGroup, category, theme } = State.beforeDailyPrefs;
  
        if (lengthGroupEl) lengthGroupEl.value = lengthGroup;
        if (categoryEl) categoryEl.value = category;
  
        updateThemeOptionsByCategory();
        if (themeEl) themeEl.value = theme;
  
        State.beforeDailyPrefs = null;
      }
  
      buildPool();
      if (!State.hasNoItem) {
        setCurrentItem(pickRandomDifferentText(), { daily: false });
      }
      updateMetaInfo();
  
      persistPrefsNow();
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
      persistPrefsNow(); // ★追加

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
      const ownerUserName = userMgr.getCurrentPersonalId();
  
      const created = await groupSvc.createGroup({
        groupName,
        ownerPersonalId: userMgr.getCurrentPersonalId(),
        ownerUid: auth.currentUser.uid,
        ownerUserName: userMgr.getCurrentPersonalId()
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
              userName: userMgr.getCurrentPersonalId(),
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
      await groupSvc.requestJoin(gid, State.authUser.uid, userMgr.getCurrentPersonalId?.() ?? "Guest");
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
        userName: userMgr.getCurrentPersonalId()
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
async function onTypingFinish({ metrics, meta }) {
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

    // setModalMetrics(...) の直後あたり
    const rankUpEl = document.getElementById("mRankUp");
    
    // 前回ベスト（ユーザー×難易度で保持）
    const key = `bestRank::${(State.authUser?.uid || "guest")}::${difficulty}`;
    const prevBest = localStorage.getItem(key) || "G-";
    
    const prevStage = rankStage(prevBest);
    const nowStage  = rankStage(rank);
    
    if (rankIndex(rank) > rankIndex(prevBest)) {
      localStorage.setItem(key, rank);
    
      if (rankUpEl) {
        if (prevStage !== nowStage) {
          rankUpEl.textContent = `${prevStage} → ${nowStage}`;
        } else {
          rankUpEl.textContent = `ランクアップ！ ${prevBest} → ${rank}`;
        }
        rankUpEl.style.display = "";
      }
    } else {
      if (rankUpEl) rankUpEl.style.display = "none";
    }


    showModal();

    const user = State.authUser;
    const uid = user?.uid;
    const userName = userMgr.getCurrentPersonalId?.() ?? "Guest";
    const dateKey = todayKey();
    const dailyTaskKey = meta?.dailyTaskKey ?? (isDailyTask ? State.daily.dailyTaskKey : null);
    const dailyTaskName = isDailyTask ? (theme !== "all" ? theme : (category !== "all" ? category : "今日の課題")) : null;

    // groupId は「選択中グループ」をそのまま保存（グループランキングのため）
    const groupId = State.currentGroupId || null;

    if (uid) {
      try {
        const personalId = userMgr.getCurrentPersonalId();
        
        await submitScoreDoc({
          personalId,   // ★追加
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
        });

      } catch (e) {
        console.error("submitScoreDoc error:", e);
      }
    }
    
    // ★ 保存完了後にランキング更新
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
  initFilterOptions();
  
  // ★ 前回の選択を復元（options 構築後じゃないと反映できない）
  {
    const personalId = userMgr.getCurrentPersonalId();
    const prefs = loadPrefsOf(personalId);
    applyPrefsToUI(prefs);
  }
  
  // ★ daily は「復元したチェック状態」に従う
  if (dailyTaskEl?.checked) {
    enableDailyTask();
  } else {
    disableDailyTask();
  }
  
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
  bindToggle("toggleUserPanel", "userPanel");
  bindToggle("toggleGroupPanel", "groupPanel");

   
  // 初回ランキング：activeRankDiff も復元済みの State.activeRankDiff で走る
  await reloadAllRankings();
  await loadMyAnalytics();


  if (!State.hasNoItem) {
    setCurrentItem(pickRandomDifferentText(), { daily: false });
  }
  updateMetaInfo();
  syncDailyInfoLabel();

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























