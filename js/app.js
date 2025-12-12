// js/app.js
// - 認証（匿名）完了を必ず待つ（準備中のままを防ぐ）
// - JSON(trivia.json)読込完了を必ず待つ（空select防ぐ）
// - セレクトは「幅確保」して空に見えない
// - 日替わりテーマは「今日テーマ」に固定し、dailyランキング混入ゼロ
// - 終了時：自動保存（ボタン不要）
// - 分析は「選択ユーザー」のみ
// - 同じ文章の短時間再出題回避（直近10）

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import {
  getFirestore, doc, setDoc, addDoc, collection, getDocs, query, orderBy, limit, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import {
  getAuth, signInAnonymously, onAuthStateChanged
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
const el = {
  // user
  userSelect: document.getElementById("userSelect"),
  addUserBtn: document.getElementById("addUserBtn"),
  renameUserBtn: document.getElementById("renameUserBtn"),
  deleteUserBtn: document.getElementById("deleteUserBtn"),
  authBadge: document.getElementById("authBadge"),

  // filters
  difficulty: document.getElementById("difficulty"),
  category: document.getElementById("category"),
  theme: document.getElementById("theme"),
  dailyTheme: document.getElementById("dailyTheme"),
  dailyInfo: document.getElementById("dailyInfo"),

  // typing
  startBtn: document.getElementById("startBtn"),
  skipBtn: document.getElementById("skipBtn"),
  text: document.getElementById("text"),
  input: document.getElementById("input"),
  result: document.getElementById("result"),

  // rankings
  rankScope: document.getElementById("rankScope"),
  rankLabel: document.getElementById("rankLabel"),
  dailyRankLabel: document.getElementById("dailyRankLabel"),
  dailyRanking: document.getElementById("dailyRanking"),
  ranking: document.getElementById("ranking"),

  // analytics
  bestByDifficulty: document.getElementById("bestByDifficulty"),
  compareToday: document.getElementById("compareToday"),
  diffChart: document.getElementById("diffChart"),
  myRecent: document.getElementById("myRecent")
};

// selectが空に見えない最低幅（CSSを触らずJSで補強）
for (const s of [el.difficulty, el.category, el.theme, el.rankScope, el.userSelect]) {
  if (s) s.style.minWidth = "170px";
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

// 難易度精密化
const PUNCT_WEIGHT = 6;
const KATA_WEIGHT = 80;
const EASY_SCORE_MAX = 145;
const NORMAL_SCORE_MAX = 190;

function difficultyByFeatures(len, pCount, kRatio) {
  const score = Math.round(len + (pCount * PUNCT_WEIGHT) + (kRatio * KATA_WEIGHT));
  let diff = "hard";
  if (score <= EASY_SCORE_MAX) diff = "easy";
  else if (score <= NORMAL_SCORE_MAX) diff = "normal";
  return { diff, score };
}

function labelDifficulty(d) {
  if (d === "easy") return "かんたん";
  if (d === "normal") return "ふつう";
  if (d === "hard") return "むずかしい";
  return "すべて";
}

function avg(arr) {
  if (!arr.length) return null;
  return Math.round(arr.reduce((s, x) => s + x, 0) / arr.length);
}

/* =========================
 Data
========================= */
let items = [];          // enriched
let categories = [];
let themesByCategory = new Map();
let allThemes = [];
let dailyThemeValue = null;

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

/* =========================
 Services
========================= */
const userManager = new UserManager({ maxUsers: 10, storagePrefix: "otonano_typing" });
const rankingSvc = new RankingService({ db });

let uid = null;
let typingEngine = null;

let currentItem = null;

/* =========================
 Firestore: user profile histories
========================= */
function profileKey(name) {
  // user名をdocに使えるように安全化
  return String(name ?? "")
    .normalize("NFKC")
    .replace(/\s+/g, "_")
    .replace(/[\/\\?%*:|"<>]/g, "_")
    .replace(/[^0-9A-Za-zぁ-んァ-ン一-龥_（）()・、。-]/g, "_")
    .slice(0, 120) || "user";
}

function historiesCol(uid, userName) {
  return collection(db, `users/${uid}/profiles/${profileKey(userName)}/histories`);
}

async function ensureProfileDoc(uid, userName) {
  const ref = doc(db, `users/${uid}/profiles/${profileKey(userName)}`);
  await setDoc(ref, { displayName: userName, createdAt: serverTimestamp() }, { merge: true });
}

/* =========================
 Load trivia.json
========================= */
async function loadItems() {
  const res = await fetch("./data/trivia.json", { cache: "no-store" });
  const json = await res.json();

  items = (Array.isArray(json) ? json : [])
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
        difficulty: diff, // easy/normal/hard
        score
      };
    });

  categories = [...new Set(items.map(x => x.category).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b, "ja"));

  themesByCategory = new Map();
  for (const c of categories) themesByCategory.set(c, new Set());
  for (const it of items) {
    if (!it.category || !it.theme) continue;
    if (!themesByCategory.has(it.category)) themesByCategory.set(it.category, new Set());
    themesByCategory.get(it.category).add(it.theme);
  }

  allThemes = [...new Set(items.map(x => x.theme).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b, "ja"));

  if (allThemes.length) {
    const idx = hashString(todayKey()) % allThemes.length;
    dailyThemeValue = allThemes[idx];
  } else {
    dailyThemeValue = null;
  }
}

/* =========================
 UI hydrate
========================= */
function hydrateFilters() {
  el.difficulty.innerHTML = `
    <option value="all">難易度：すべて</option>
    <option value="easy">難易度：かんたん</option>
    <option value="normal">難易度：ふつう</option>
    <option value="hard">難易度：むずかしい</option>
  `;

  el.category.innerHTML =
    `<option value="all">カテゴリ：すべて</option>` +
    categories.map(c => `<option value="${c}">${c}</option>`).join("");

  // theme は category 連動で更新
  applyThemeOptionsByCategory(true);

  el.rankScope.innerHTML = `
    <option value="overall">ランキング：全体</option>
    <option value="category">ランキング：カテゴリ別（現在）</option>
    <option value="theme">ランキング：テーマ別（現在）</option>
    <option value="daily">ランキング：今日のテーマ</option>
  `;

  updateDailyThemeUI();
  updateRankingLabels();
}

function applyThemeOptionsByCategory(isInit = false) {
  // 日替わりONなら theme select は無効＆固定（表示だけ）
  if (el.dailyTheme.checked && dailyThemeValue) {
    el.theme.innerHTML = `<option value="${dailyThemeValue}">${dailyThemeValue}</option>`;
    el.theme.value = dailyThemeValue;
    el.theme.disabled = true;
    return;
  }
  el.theme.disabled = false;

  const cat = el.category.value;
  const prev = el.theme.value;

  let list = [];
  if (cat === "all") list = allThemes;
  else {
    const set = themesByCategory.get(cat);
    list = set ? [...set].sort((a, b) => a.localeCompare(b, "ja")) : [];
  }

  el.theme.innerHTML =
    `<option value="all">テーマ：すべて</option>` +
    list.map(t => `<option value="${t}">${t}</option>`).join("");

  // 初期化時は all へ、通常は前回値が残っていれば維持
  if (isInit) el.theme.value = "all";
  else el.theme.value = list.includes(prev) ? prev : "all";
}

function updateDailyThemeUI() {
  if (dailyThemeValue) {
    if (el.dailyTheme.checked) {
      el.dailyInfo.textContent = `今日（${todayKey()}）のテーマ：${dailyThemeValue}（固定中）`;
      el.dailyInfo.style.display = "block";
      el.category.disabled = true;
      el.theme.disabled = true;
    } else {
      el.dailyInfo.textContent = `今日（${todayKey()}）のテーマ：${dailyThemeValue}`;
      el.dailyInfo.style.display = "none"; // 要望：必要最小限なのでOFF時は非表示
      el.category.disabled = false;
      el.theme.disabled = false;
    }
  } else {
    el.dailyInfo.textContent = "";
    el.dailyInfo.style.display = "none";
    el.category.disabled = false;
    el.theme.disabled = false;
  }
}

function updateRankingLabels() {
  const diff = el.difficulty.value;
  const diffText = (diff === "all") ? "（難易度：すべて）" : `（難易度：${labelDifficulty(diff)}）`;

  el.dailyRankLabel.textContent = `🏆 今日のテーマ「${dailyThemeValue ?? "—"}」ランキング TOP10 ${diffText}`;

  const scope = el.rankScope.value;
  if (scope === "overall") el.rankLabel.textContent = `ランキング：全体 TOP10 ${diffText}`;
  if (scope === "daily") el.rankLabel.textContent = `ランキング：今日のテーマ TOP10 ${diffText}`;
  if (scope === "category") el.rankLabel.textContent = `ランキング：カテゴリ「${el.category.value === "all" ? "すべて" : el.category.value}」TOP10 ${diffText}`;
  if (scope === "theme") el.rankLabel.textContent = `ランキング：テーマ「${el.theme.value === "all" ? "すべて" : el.theme.value}」TOP10 ${diffText}`;
}

/* =========================
 User UI
========================= */
function renderUserSelect() {
  const users = userManager.list();
  const cur = userManager.getCurrent();

  el.userSelect.innerHTML = users.length
    ? users.map(u => `<option value="${u}">${u}</option>`).join("")
    : `<option value="">（ユーザー未登録）</option>`;

  if (cur && users.includes(cur)) el.userSelect.value = cur;
}

function currentUserNameOrThrow() {
  const name = userManager.getCurrent();
  if (!name) throw new Error("no_user");
  return name;
}

/* =========================
 Filters & picking
========================= */
function getFilters() {
  const dailyEnabled = !!(el.dailyTheme.checked && dailyThemeValue);
  const difficulty = el.difficulty.value; // all/easy/normal/hard
  const category = dailyEnabled ? "all" : el.category.value;
  const theme = dailyEnabled ? dailyThemeValue : el.theme.value;
  return { dailyEnabled, difficulty, category, theme, todayTheme: dailyThemeValue ?? "" };
}

function filterPool() {
  const { dailyEnabled, difficulty, category, theme } = getFilters();
  return items.filter(x => {
    if (difficulty !== "all" && x.difficulty !== difficulty) return false;
    if (!dailyEnabled && category !== "all" && x.category !== category) return false;
    if (theme !== "all" && x.theme !== theme) return false;
    return true;
  });
}

function pickNext(pool) {
  if (!pool.length) return null;
  const notRecent = pool.filter(x => !isRecentlyUsed(x.text));
  const cand = notRecent.length ? notRecent : pool;
  return cand[Math.floor(Math.random() * cand.length)];
}

/* =========================
 New text
========================= */
function setNewText() {
  const pool = filterPool();
  if (!pool.length) {
    currentItem = null;
    el.text.textContent = "該当する文章がありません。条件を変更してください。";
    if (typingEngine) typingEngine.setText(""); // 表示だけリセット
    return;
  }
  currentItem = pickNext(pool);
  pushHistory(currentItem.text);

  typingEngine.setText(currentItem.text);
  el.result.textContent = "";
}

/* =========================
 Rankings refresh
========================= */
async function refreshRankings() {
  if (!uid) return; // 認証必須

  const { difficulty, category, theme, todayTheme } = getFilters();

  // 今日テーマランキング（常に「今日テーマ専用コレクション」）
  try {
    const rowsDaily = await rankingSvc.loadTop10({
      scope: "daily",
      difficulty,
      category,
      theme,
      todayTheme
    });
    rankingSvc.renderList(el.dailyRanking, rowsDaily);
  } catch {
    el.dailyRanking.innerHTML = "<li>ランキングの読み込みに失敗しました。</li>";
  }

  // 右側ランキング（scope に応じて）
  updateRankingLabels();
  const scope = el.rankScope.value;

  try {
    const rows = await rankingSvc.loadTop10({
      scope,
      difficulty,
      category,
      theme,
      todayTheme
    });
    rankingSvc.renderList(el.ranking, rows);
  } catch {
    el.ranking.innerHTML = "<li>ランキングの読み込みに失敗しました。</li>";
  }
}

/* =========================
 Analytics (selected user only)
========================= */
function drawDiffChart(values) {
  const canvas = el.diffChart;
  const ctx = canvas.getContext("2d");

  const cssW = canvas.clientWidth || 600;
  const cssH = canvas.clientHeight || 220;
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.floor(cssW * dpr);
  canvas.height = Math.floor(cssH * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  ctx.clearRect(0, 0, cssW, cssH);

  if (!values.length) {
    ctx.fillStyle = "#555";
    ctx.font = "12px system-ui";
    ctx.fillText("履歴がありません。", 10, 20);
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

  ctx.fillStyle = "#555";
  ctx.font = "12px system-ui";
  ctx.fillText("KPM−CPM 差（小さいほど効率的）", pad, 14);
}

function betterRank(a, b) {
  const score = { D: 1, C: 2, B: 3, A: 4, S: 5, SS: 6, SSS: 7 };
  return (score[a] ?? 0) >= (score[b] ?? 0) ? a : b;
}

async function refreshUserAnalytics() {
  if (!uid) return; // 認証必須
  const userName = userManager.getCurrent();
  if (!userName) {
    el.bestByDifficulty.innerHTML = "<li>ユーザーを追加してください。</li>";
    el.myRecent.innerHTML = "<li>ユーザーを追加してください。</li>";
    el.compareToday.textContent = "ユーザー未選択です。";
    drawDiffChart([]);
    return;
  }

  // histories load
  const qy = query(historiesCol(uid, userName), orderBy("createdAt", "desc"), limit(300));
  const snap = await getDocs(qy);

  const histories = [];
  snap.forEach(docu => {
    const d = docu.data();
    const ts = d.createdAt;
    const ms = ts && typeof ts.toMillis === "function" ? ts.toMillis() : null;
    histories.push({
      dateKey: d.dateKey ?? "",
      difficulty: d.itemDifficulty ?? "",
      cpm: Number(d.cpm ?? 0),
      kpm: Number(d.kpm ?? 0),
      diff: Number(d.diff ?? 0),
      rank: d.rank ?? "D",
      eff: Number(d.eff ?? 0),
      createdAtMs: ms
    });
  });

  // recent
  el.myRecent.innerHTML = "";
  const recent = histories.slice(0, 12);
  if (!recent.length) {
    el.myRecent.innerHTML = "<li>まだ履歴がありません（完了すると自動保存されます）。</li>";
  } else {
    for (const h of recent) {
      const li = document.createElement("li");
      li.textContent = `${h.dateKey}｜${labelDifficulty(h.difficulty)}｜CPM ${h.cpm} / KPM ${h.kpm}｜${h.rank}｜差 ${h.diff}`;
      el.myRecent.appendChild(li);
    }
  }

  // best by difficulty
  const diffs = ["easy", "normal", "hard"];
  const best = {};
  for (const d of diffs) best[d] = { bestCpm: null, bestKpm: null, bestRank: "D" };

  for (const h of histories) {
    const d = h.difficulty;
    if (!best[d]) continue;
    if (best[d].bestCpm === null || h.cpm > best[d].bestCpm) {
      best[d].bestCpm = h.cpm;
      best[d].bestKpm = h.kpm;
    }
    best[d].bestRank = betterRank(h.rank, best[d].bestRank);
  }

  el.bestByDifficulty.innerHTML = "";
  for (const d of diffs) {
    const li = document.createElement("li");
    if (best[d].bestCpm === null) li.textContent = `${labelDifficulty(d)}：まだ履歴がありません`;
    else li.textContent = `${labelDifficulty(d)}：TOP CPM ${best[d].bestCpm}（KPM ${best[d].bestKpm}） / TOPランク ${best[d].bestRank}`;
    el.bestByDifficulty.appendChild(li);
  }

  // diff chart
  const diffSeries = histories.slice(0, 60).reverse().map(h => h.diff);
  drawDiffChart(diffSeries.slice(-30));

  // today vs last7
  const tKey = todayKey();
  const todays = histories.filter(h => h.dateKey === tKey);
  const now = Date.now();
  const cutoff = now - 7 * 24 * 60 * 60 * 1000;
  const last7 = histories.filter(h => h.createdAtMs !== null && h.createdAtMs >= cutoff);

  const todaySum = todays.length ? (() => {
    const cpm = avg(todays.map(x => x.cpm));
    const kpm = avg(todays.map(x => x.kpm));
    const eff = kpm > 0 ? cpm / kpm : 0;
    const rank = (kpm > 0) ? (new TypingEngine({ inputEl: el.input, textEl: el.text })._calcRank?.(cpm, kpm) ?? "D") : "D";
    return { cpm, kpm, eff, rank };
  })() : null;

  const avg7Sum = last7.length ? (() => {
    const cpm = avg(last7.map(x => x.cpm));
    const kpm = avg(last7.map(x => x.kpm));
    const eff = kpm > 0 ? cpm / kpm : 0;
    // rankは簡易再計算（typingEngine内ロジックと同等にしたいのでここは固定関数で良い）
    const rank = (() => {
      const e = eff;
      if (cpm >= 420 && e >= 0.92) return "SSS";
      if (cpm >= 360 && e >= 0.88) return "SS";
      if (cpm >= 320 && e >= 0.84) return "S";
      if (cpm >= 260 && e >= 0.78) return "A";
      if (cpm >= 200 && e >= 0.72) return "B";
      if (cpm >= 150) return "C";
      return "D";
    })();
    return { cpm, kpm, eff, rank };
  })() : null;

  if (!todaySum || !avg7Sum) {
    el.compareToday.textContent = "データが不足しています（履歴を数回保存すると表示されます）。";
  } else {
    const cpmDelta = todaySum.cpm - avg7Sum.cpm;
    const kpmDelta = todaySum.kpm - avg7Sum.kpm;
    const effDelta = Math.round((todaySum.eff - avg7Sum.eff) * 1000) / 10;
    const sign = n => (n > 0 ? `+${n}` : `${n}`);

    el.compareToday.innerHTML =
      `今日：CPM ${todaySum.cpm} / KPM ${todaySum.kpm} / ランク ${todaySum.rank} / 効率 ${(todaySum.eff * 100).toFixed(1)}%<br>` +
      `過去7日平均：CPM ${avg7Sum.cpm} / KPM ${avg7Sum.kpm} / ランク ${avg7Sum.rank} / 効率 ${(avg7Sum.eff * 100).toFixed(1)}%<br>` +
      `差分：CPM ${sign(cpmDelta)} / KPM ${sign(kpmDelta)} / 効率 ${sign(effDelta)}%`;
  }
}

/* =========================
 Save history (auto)
========================= */
async function saveHistoryForSelectedUser({ metrics }) {
  if (!uid) return;
  const userName = currentUserNameOrThrow();
  await ensureProfileDoc(uid, userName);

  const record = {
    dateKey: todayKey(),
    userName,
    // 「出題難易度」で集計したいので itemDifficulty を保存
    itemDifficulty: currentItem?.difficulty ?? "",
    itemCategory: currentItem?.category ?? "",
    itemTheme: currentItem?.theme ?? "",
    itemLength: currentItem?.length ?? (currentItem?.text?.length ?? 0),
    itemPunct: currentItem?.punct ?? 0,
    itemKataRatio: currentItem?.kataRatio ?? 0,

    cpm: metrics.cpm,
    kpm: metrics.kpm,
    wpm: metrics.wpm,
    diff: metrics.diff,
    eff: Math.round(metrics.eff * 10000) / 10000,
    rank: metrics.rank,

    createdAt: serverTimestamp()
  };

  await addDoc(historiesCol(uid, userName), record);
}

/* =========================
 Auth (must wait)
========================= */
async function waitForAuth() {
  // 匿名認証必須：完了するまで待つ
  await signInAnonymously(auth);

  return await new Promise((resolve) => {
    const unsub = onAuthStateChanged(auth, (user) => {
      if (user) {
        uid = user.uid;
        el.authBadge.textContent = `認証：OK（端末ID ${user.uid.slice(0, 8)}…）`;
        unsub();
        resolve(user);
      }
    });
  });
}

/* =========================
 Main init
========================= */
function bindUserUI() {
  renderUserSelect();

  el.userSelect.addEventListener("change", async () => {
    userManager.setCurrent(el.userSelect.value);
    renderUserSelect();
    await refreshRankings();
    await refreshUserAnalytics();
  });

  el.addUserBtn.addEventListener("click", async () => {
    const n = prompt("追加するユーザー名（最大10名）");
    if (!n) return;
    userManager.add(n);
    renderUserSelect();
    await refreshRankings();
    await refreshUserAnalytics();
  });

  el.renameUserBtn.addEventListener("click", async () => {
    const cur = userManager.getCurrent();
    if (!cur) return alert("ユーザーがありません");
    const n = prompt("新しいユーザー名", cur);
    if (!n) return;
    userManager.rename(cur, n);
    renderUserSelect();
    await refreshRankings();
    await refreshUserAnalytics();
  });

  el.deleteUserBtn.addEventListener("click", async () => {
    const cur = userManager.getCurrent();
    if (!cur) return alert("ユーザーがありません");
    if (!confirm(`ユーザー「${cur}」を削除しますか？（端末内のみ）`)) return;
    userManager.remove(cur);
    renderUserSelect();
    await refreshRankings();
    await refreshUserAnalytics();
  });

  // 内部変更にも追随
  userManager.onChange(async () => {
    renderUserSelect();
    await refreshRankings();
    await refreshUserAnalytics();
  });
}

function bindFilterUI() {
  el.difficulty.addEventListener("change", () => {
    updateRankingLabels();
    setNewText();
    refreshRankings();
  });

  el.category.addEventListener("change", () => {
    applyThemeOptionsByCategory(false);
    updateRankingLabels();
    setNewText();
    refreshRankings();
  });

  el.theme.addEventListener("change", () => {
    updateRankingLabels();
    setNewText();
    refreshRankings();
  });

  el.dailyTheme.addEventListener("change", () => {
    updateDailyThemeUI();
    applyThemeOptionsByCategory(false);
    updateRankingLabels();
    setNewText();
    refreshRankings();
  });

  el.rankScope.addEventListener("change", () => {
    updateRankingLabels();
    refreshRankings();
  });

  el.skipBtn.addEventListener("click", () => {
    setNewText();
  });

  el.startBtn.addEventListener("click", async () => {
    // start with countdown inside input
    await typingEngine.startWithCountdown();
  });
}

(async () => {
  try {
    el.text.textContent = "読み込み中...";

    // 1) auth
    await waitForAuth();

    // 2) JSON
    await loadItems();

    // 3) UI
    hydrateFilters();
    bindUserUI();
    bindFilterUI();

    // 4) Typing engine
    typingEngine = new TypingEngine({
      inputEl: el.input,
      textEl: el.text,
      countdownSeconds: 3,
      onFinish: async (metrics) => {
        // 自動保存：ユーザー未選択なら保存しない
        let userName = null;
        try {
          userName = currentUserNameOrThrow();
        } catch {
          alert("ユーザーが未設定です。先にユーザー追加してください。");
          return;
        }

        const filters = getFilters();

        // Ranking保存（boards）
        await rankingSvc.saveToBoards({
          name: userName,
          uid,
          metrics,
          filters,
          itemMeta: {
            itemDifficulty: currentItem?.difficulty ?? "",
            itemCategory: currentItem?.category ?? "",
            itemTheme: currentItem?.theme ?? "",
            itemLength: currentItem?.length ?? metrics.typedLength,
            itemPunct: currentItem?.punct ?? 0,
            itemKataRatio: currentItem?.kataRatio ?? 0
          }
        });

        // 個人履歴保存
        await saveHistoryForSelectedUser({ metrics });

        // 表示更新
        await refreshRankings();
        await refreshUserAnalytics();

        // 次の問題へ
        setNewText();
      }
    });

    // 5) first question
    setNewText();

    // 6) load views
    await refreshRankings();
    await refreshUserAnalytics();

  } catch (e) {
    console.error(e);
    el.text.textContent = "テーマを始めに選択してください。";
    el.input.disabled = true;
  }
})();

