import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { getAuth, signInAnonymously, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";

import { UserManager } from "./userManager.js";
import { TypingEngine } from "./typingEngine.js";
import { RankingService } from "./ranking.js";

/* =========================
 Firebase 初期化
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

// 本番：匿名認証必須
signInAnonymously(auth).catch(() => { /* noop */ });

/* =========================
 難易度精密化（length + 句読点 + カタカナ比率）
========================= */
const PUNCT_WEIGHT = 6;
const KATA_WEIGHT  = 80;
const EASY_SCORE_MAX   = 145;
const NORMAL_SCORE_MAX = 190;

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
function difficultyByFeatures(len, pCount, kRatio) {
  const score = Math.round(len + (pCount * PUNCT_WEIGHT) + (kRatio * KATA_WEIGHT));
  let diff = "むずかしい";
  if (score <= EASY_SCORE_MAX) diff = "かんたん";
  else if (score <= NORMAL_SCORE_MAX) diff = "ふつう";
  return { diff, score };
}

/* =========================
 日付・ハッシュ
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

/* =========================
 出題データ
========================= */
let items = []; // enriched
let categories = [];
let themeByCategory = new Map();
let allThemes = [];
let dailyTheme = null;

// 直近10問 再出題回避
const HISTORY_MAX = 10;
const recentTexts = [];
function pushHistory(text) {
  if (!text) return;
  recentTexts.unshift(text);
  if (recentTexts.length > HISTORY_MAX) recentTexts.length = HISTORY_MAX;
}
function isRecentlyUsed(text) { return recentTexts.includes(text); }

/* =========================
 DOM refs
========================= */
const el = {
  difficulty: document.getElementById("difficulty"),
  category: document.getElementById("category"),
  theme: document.getElementById("theme"),
  dailyTheme: document.getElementById("dailyTheme"),
  dailyInfo: document.getElementById("dailyInfo"),

  userSelect: document.getElementById("userSelect"),
  addUserBtn: document.getElementById("addUserBtn"),
  renameUserBtn: document.getElementById("renameUserBtn"),
  deleteUserBtn: document.getElementById("deleteUserBtn"),
  authBadge: document.getElementById("authBadge"),

  startBtn: document.getElementById("startBtn"),
  skipBtn: document.getElementById("skipBtn"),
  countdownWrap: document.getElementById("countdownWrap"),
  countdown: document.getElementById("countdown"),
  countdownSub: document.getElementById("countdownSub"),

  text: document.getElementById("text"),
  input: document.getElementById("input"),
  result: document.getElementById("result"),

  rankScope: document.getElementById("rankScope"),
  rankLabel: document.getElementById("rankLabel"),
  dailyRankLabel: document.getElementById("dailyRankLabel"),
  ranking: document.getElementById("ranking"),
  dailyRanking: document.getElementById("dailyRanking"),

  bestByDifficulty: document.getElementById("bestByDifficulty"),
  myRecent: document.getElementById("myRecent"),
  diffChart: document.getElementById("diffChart"),
  compareToday: document.getElementById("compareToday"),
};

/* =========================
 ユーザー管理（端末最大10名）
========================= */
const userManager = new UserManager({ maxUsers: 10, storagePrefix: "otonano_typing" });

function renderUserSelect() {
  const { users, current } = userManager.getState();
  el.userSelect.innerHTML = "";
  for (const u of users) {
    const opt = document.createElement("option");
    opt.value = u;
    opt.textContent = u;
    if (u === current) opt.selected = true;
    el.userSelect.appendChild(opt);
  }
}

el.addUserBtn.addEventListener("click", () => {
  const name = prompt("追加するユーザー名（端末内で最大10名）");
  if (!name) return;
  userManager.addUser(name.trim());
});
el.renameUserBtn.addEventListener("click", () => {
  const { current } = userManager.getState();
  if (!current) return;
  const next = prompt(`名前変更（現在：${current}）`);
  if (!next) return;
  const r = userManager.renameUser(current, next.trim());
  if (!r.ok) alert("名前変更に失敗しました（重複や空欄を確認）");
});
el.deleteUserBtn.addEventListener("click", () => {
  const { current } = userManager.getState();
  if (!current) return;
  if (!confirm(`「${current}」を端末から削除しますか？（Firestoreの履歴は残ります）`)) return;
  userManager.deleteUser(current);
});

el.userSelect.addEventListener("change", (e) => {
  userManager.setCurrent(e.target.value);
});

userManager.onChange(() => {
  renderUserSelect();
  refreshAllViews(); // ⑤：選択ユーザーの分析に切替
});

/* =========================
 ランキング/履歴サービス
========================= */
const rankingService = new RankingService({ db, auth });

/* =========================
 テーマ選択：カテゴリに属するテーマだけ表示
========================= */
function hydrateSelects() {
  el.difficulty.innerHTML = `
    <option value="all">難易度：すべて</option>
    <option value="かんたん">難易度：かんたん</option>
    <option value="ふつう">難易度：ふつう</option>
    <option value="むずかしい">難易度：むずかしい</option>
  `;

  el.category.innerHTML =
    `<option value="all">カテゴリ：すべて</option>` +
    categories.map(c => `<option value="${c}">${c}</option>`).join("");

  el.theme.innerHTML = `<option value="all">テーマ：すべて</option>`;

  el.rankScope.innerHTML = `
    <option value="overall">ランキング：全体</option>
    <option value="category">ランキング：カテゴリ別（現在のカテゴリ）</option>
    <option value="theme">ランキング：テーマ別（現在のテーマ）</option>
    <option value="daily">ランキング：今日のテーマ</option>
  `;
}

function applyThemeOptionsByCategory() {
  const daily = el.dailyTheme.checked && !!dailyTheme;
  if (daily) return;

  const cat = el.category.value;
  const currentTheme = el.theme.value;

  let themes = [];
  if (cat === "all") {
    themes = allThemes;
  } else {
    const set = themeByCategory.get(cat);
    themes = set ? Array.from(set).sort((a,b) => a.localeCompare(b, "ja")) : [];
  }

  el.theme.innerHTML =
    `<option value="all">テーマ：すべて</option>` +
    themes.map(t => `<option value="${t}">${t}</option>`).join("");

  el.theme.value = themes.includes(currentTheme) ? currentTheme : "all";
}

function updateDailyThemeUI() {
  const daily = el.dailyTheme.checked && !!dailyTheme;
  el.category.disabled = daily;
  el.theme.disabled = daily;

  if (!dailyTheme) {
    el.dailyInfo.style.display = "none";
    el.dailyInfo.textContent = "";
    return;
  }

  // 必要最小限表示（黄色バッジ群は廃止）
  el.dailyInfo.style.display = "block";
  el.dailyInfo.textContent = daily
    ? `今日（${todayKey()}）のテーマ：${dailyTheme}（固定中）`
    : `今日（${todayKey()}）のテーマ：${dailyTheme}`;
}

/* =========================
 フィルタと出題プール
========================= */
function getActiveFilters() {
  const daily = el.dailyTheme.checked && !!dailyTheme;
  const difficulty = el.difficulty.value;
  const category = daily ? "all" : el.category.value;
  const theme = daily ? dailyTheme : el.theme.value;
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

function pickNextItem(pool) {
  if (pool.length === 0) return null;
  const notRecent = pool.filter(x => !isRecentlyUsed(x.text));
  const candidates = (notRecent.length > 0) ? notRecent : pool;
  return candidates[Math.floor(Math.random() * candidates.length)];
}

/* =========================
 TypingEngine
========================= */
const engine = new TypingEngine({
  textEl: el.text,
  inputEl: el.input,
  resultEl: el.result,
  startBtn: el.startBtn,
  skipBtn: el.skipBtn,
  countdownWrapEl: el.countdownWrap,
  countdownEl: el.countdown,
  countdownSubEl: el.countdownSub,
  onNeedNextText: () => setNewText(),
  onComplete: async ({ typed, seconds, keystrokes }) => {
    // ⑥：自動記録（ボタン不要）
    await handleComplete({ typed, seconds, keystrokes });
  }
});

/* =========================
 出題更新
========================= */
function setNewText() {
  const pool = filterPool();
  if (pool.length === 0) {
    engine.setTarget("");
    el.text.textContent = "該当する文章がありません。条件を変更してください。";
    el.input.value = "";
    el.input.disabled = true;
    el.result.textContent = "";
    return;
  }

  const pick = pickNextItem(pool);
  pushHistory(pick.text);
  engine.setTarget(pick.text);

  // 完了時の保存用に、現在出題のメタを保持
  currentItem = pick;

  // ランキングは「今日のテーマ」をTOP固定表示
  refreshRankings();
}

/* =========================
 現在出題のメタ
========================= */
let currentItem = null;

/* =========================
 ランキングキー用
========================= */
function keysForRanking() {
  const { daily, difficulty, category, theme } = getActiveFilters();
  const difficultyKey = (difficulty === "all") ? "diff_all" : `diff_${difficulty}`;
  const categoryKey = daily ? "all" : (category === "all" ? "all" : category);
  const themeKey = (theme === "all") ? "all" : theme;
  const dailyThemeKey = dailyTheme ?? "no_theme";
  return { difficultyKey, categoryKey, themeKey, dailyThemeKey };
}

/* =========================
 ラベル更新
========================= */
function updateRankingLabels() {
  const { daily, difficulty, category, theme } = getActiveFilters();
  const diffText = (difficulty === "all") ? "（難易度：すべて）" : `（難易度：${difficulty}）`;

  el.dailyRankLabel.textContent = `🏆 今日のテーマ「${dailyTheme ?? "—"}」ランキング TOP10 ${diffText}`;

  const scope = el.rankScope.value;
  let label = "ランキング";
  if (scope === "overall") label = `ランキング：全体 TOP10 ${diffText}`;
  if (scope === "daily") label = `ランキング：今日のテーマ「${dailyTheme ?? "—"}」TOP10 ${diffText}`;
  if (scope === "category") {
    const c = daily ? "—" : (category === "all" ? "すべて" : category);
    label = `ランキング：カテゴリ「${c}」TOP10 ${diffText}`;
  }
  if (scope === "theme") {
    const t = (theme === "all") ? "すべて" : theme;
    label = `ランキング：テーマ「${t}」TOP10 ${diffText}`;
  }
  el.rankLabel.textContent = label;
}

/* =========================
 ランキング表示（②：CPM/KPM/ランク付き）
========================= */
function renderRankingList(ul, rows) {
  ul.innerHTML = "";
  if (!rows.length) {
    const li = document.createElement("li");
    li.textContent = "まだスコアがありません。最初の記録を作りましょう。";
    ul.appendChild(li);
    return;
  }
  for (const d of rows) {
    const li = document.createElement("li");
    const effPct = (d.kpm > 0) ? ((d.cpm / d.kpm) * 100).toFixed(1) : "0.0";
    li.textContent = `${d.name}｜Rank ${d.rank}｜CPM ${d.cpm}｜KPM ${d.kpm}｜効率 ${effPct}%`;
    ul.appendChild(li);
  }
}

/* =========================
 ①：rankingScoreで並び
========================= */
async function refreshRankings() {
  updateRankingLabels();

  // 今日のテーマランキング（TOP固定）
  try {
    const dailyRows = await rankingService.loadTop10({
      scope: "daily",
      keys: keysForRanking()
    });
    renderRankingList(el.dailyRanking, dailyRows);
  } catch {
    el.dailyRanking.innerHTML = "<li>ランキングの読み込みに失敗しました。</li>";
  }

  // 選択スコープランキング
  try {
    const scope = el.rankScope.value;
    const rows = await rankingService.loadTop10({
      scope,
      keys: keysForRanking()
    });
    renderRankingList(el.ranking, rows);
  } catch {
    el.ranking.innerHTML = "<li>ランキングの読み込みに失敗しました。</li>";
  }
}

/* =========================
 個人分析（⑤：選択ユーザーのみ）
========================= */
function avg(arr) {
  if (!arr.length) return null;
  return Math.round(arr.reduce((s, x) => s + x, 0) / arr.length);
}

const RANK_SCORE = { "D":1, "C":2, "B":3, "A":4, "S":5, "SS":6, "SSS":7 };
function betterRank(a, b) {
  return (RANK_SCORE[a] ?? 0) >= (RANK_SCORE[b] ?? 0) ? a : b;
}

function renderBestByDifficulty(histories) {
  el.bestByDifficulty.innerHTML = "";
  const diffs = ["かんたん", "ふつう", "むずかしい"];
  const best = {};
  for (const d of diffs) best[d] = { bestCpm: null, bestRank: "D", bestKpm: null };

  for (const h of histories) {
    if (!best[h.itemDifficulty]) continue;

    if (best[h.itemDifficulty].bestCpm === null || h.cpm > best[h.itemDifficulty].bestCpm) {
      best[h.itemDifficulty].bestCpm = h.cpm;
      best[h.itemDifficulty].bestKpm = h.kpm;
    }
    best[h.itemDifficulty].bestRank = betterRank(h.rank, best[h.itemDifficulty].bestRank);
  }

  for (const d of diffs) {
    const li = document.createElement("li");
    if (best[d].bestCpm === null) {
      li.textContent = `${d}：まだ履歴がありません`;
    } else {
      li.textContent = `${d}：TOP CPM ${best[d].bestCpm}（KPM ${best[d].bestKpm}） / TOPランク ${best[d].bestRank}`;
    }
    el.bestByDifficulty.appendChild(li);
  }
}

function renderRecent(histories) {
  el.myRecent.innerHTML = "";
  const slice = histories.slice(0, 12);
  if (!slice.length) {
    const li = document.createElement("li");
    li.textContent = "まだ履歴がありません（自動保存されます）。";
    el.myRecent.appendChild(li);
    return;
  }
  for (const h of slice) {
    const li = document.createElement("li");
    li.textContent = `${h.dateKey}｜${h.itemDifficulty}｜CPM ${h.cpm} / KPM ${h.kpm}｜ランク ${h.rank}｜差 ${h.diff}`;
    el.myRecent.appendChild(li);
  }
}

function summarizeToday(histories) {
  const tKey = todayKey();
  const todays = histories.filter(h => h.dateKey === tKey);
  if (!todays.length) return null;

  const cpm = avg(todays.map(h => h.cpm));
  const kpm = avg(todays.map(h => h.kpm));
  const eff = (kpm > 0) ? cpm / kpm : 0;
  const rank = TypingEngine.calcRank(cpm, kpm);
  return { cpm, kpm, eff, rank };
}

function summarize7days(histories) {
  const now = new Date();
  const cutoff = now.getTime() - 7 * 24 * 60 * 60 * 1000;
  const last7 = histories.filter(h => h.createdAtMs !== null && h.createdAtMs >= cutoff);
  if (!last7.length) return null;

  const cpm = avg(last7.map(h => h.cpm));
  const kpm = avg(last7.map(h => h.kpm));
  const eff = (kpm > 0) ? cpm / kpm : 0;
  const rank = TypingEngine.calcRank(cpm, kpm);
  return { cpm, kpm, eff, rank };
}

function formatCompare(todayObj, avg7Obj) {
  if (!todayObj || !avg7Obj) {
    el.compareToday.textContent = "データが不足しています（履歴を数回保存すると表示されます）。";
    return;
  }
  const cpmDelta = todayObj.cpm - avg7Obj.cpm;
  const kpmDelta = todayObj.kpm - avg7Obj.kpm;
  const effDelta = Math.round((todayObj.eff - avg7Obj.eff) * 1000) / 10; // %
  const sign = (n) => (n > 0 ? `+${n}` : `${n}`);

  el.compareToday.innerHTML =
    `今日：CPM ${todayObj.cpm} / KPM ${todayObj.kpm} / ランク ${todayObj.rank} / 効率 ${(todayObj.eff*100).toFixed(1)}%<br>` +
    `過去7日平均：CPM ${avg7Obj.cpm} / KPM ${avg7Obj.kpm} / ランク ${avg7Obj.rank} / 効率 ${(avg7Obj.eff*100).toFixed(1)}%<br>` +
    `差分：CPM ${sign(cpmDelta)} / KPM ${sign(kpmDelta)} / 効率 ${sign(effDelta)}%`;
}

/* =========================
 履歴ロード（選択ユーザーでフィルタ）
========================= */
async function refreshUserAnalytics() {
  const current = userManager.getState().current;
  if (!current) {
    el.bestByDifficulty.innerHTML = "<li>ユーザーを追加してください</li>";
    el.myRecent.innerHTML = "<li>ユーザーを追加してください</li>";
    el.compareToday.textContent = "ユーザーが未選択です。";
    TypingEngine.drawDiffChart(el.diffChart, []);
    return;
  }

  try {
    const rows = await rankingService.loadHistories({ max: 300 });

    // Firestore timestamp -> ms
    const histories = rows.map(d => {
      const ts = d.createdAt;
      const ms = ts && typeof ts.toMillis === "function" ? ts.toMillis() : null;
      return { ...d, createdAtMs: ms };
    })
    .filter(h => h.localUser === current) // ⑤：選択ユーザーのみ
    .map(h => ({
      dateKey: h.dateKey ?? "",
      itemDifficulty: h.itemDifficulty ?? "",
      cpm: Number(h.cpm ?? 0),
      kpm: Number(h.kpm ?? 0),
      wpm: Number(h.wpm ?? 0),
      diff: Number(h.diff ?? 0),
      eff: Number(h.eff ?? 0),
      rank: h.rank ?? "D",
      createdAtMs: h.createdAtMs
    }));

    renderRecent(histories);
    renderBestByDifficulty(histories);

    // diff chart: 古い→新しいで最後30
    const diffSeries = histories
      .slice(0, 60)
      .reverse()
      .map(h => h.diff);
    TypingEngine.drawDiffChart(el.diffChart, diffSeries.slice(-30));

    const today = summarizeToday(histories);
    const avg7 = summarize7days(histories);
    formatCompare(today, avg7);
  } catch {
    el.bestByDifficulty.innerHTML = "<li>履歴の読み込みに失敗しました。</li>";
    el.myRecent.innerHTML = "<li>履歴の読み込みに失敗しました。</li>";
    el.compareToday.textContent = "履歴の読み込みに失敗しました。";
    TypingEngine.drawDiffChart(el.diffChart, []);
  }
}

/* =========================
 全体更新
========================= */
async function refreshAllViews() {
  updateDailyThemeUI();
  applyThemeOptionsByCategory();
  setNewText();
  await refreshRankings();
  await refreshUserAnalytics();
}

/* =========================
 完了時：自動保存（⑥）＋ランキング・分析更新
========================= */
let lastAutoSaveMs = 0;

async function handleComplete({ typed, seconds, keystrokes }) {
  const currentUser = userManager.getState().current;
  if (!currentUser) {
    el.result.innerHTML = "ユーザーが未選択です。ユーザーを追加してください。";
    return;
  }
  if (!currentItem) {
    el.result.innerHTML = "内部状態エラー：出題が未設定です。";
    return;
  }

  // 連投軽減（例：15秒）
  const now = Date.now();
  if (now - lastAutoSaveMs < 15000) {
    // 記録はしないが次へ
    el.result.innerHTML = "完了！（連続記録を抑制中：少し待ってください）";
    setNewText();
    return;
  }
  lastAutoSaveMs = now;

  const m = TypingEngine.computeMetrics({
    typedLength: typed.length,
    seconds,
    keystrokes
  });
  const rank = TypingEngine.calcRank(m.cpm, m.kpm);
  const rankingScore = TypingEngine.calcRankingScore(m.cpm, m.kpm);

  // 結果表示
  el.result.innerHTML =
    `完了！<br>` +
    `<strong>ランク:</strong> ${rank}（効率 ${(m.eff*100).toFixed(1)}%）<br>` +
    `<strong>CPM（文字/分）:</strong> ${m.cpm}<br>` +
    `<strong>KPM（打鍵/分）:</strong> ${m.kpm}（Space/Enterの変換・確定を含む）<br>` +
    `<strong>KPM−CPM差:</strong> ${m.diff}<br>` +
    `<strong>参考WPM:</strong> ${m.wpm}`;

  // 保存コンテキスト（フィルタ設定）
  const { daily, difficulty, category, theme } = getActiveFilters();

  const keys = keysForRanking();
  const scoreDoc = {
    name: currentUser,
    localUser: currentUser, // 端末内複数ユーザーの識別（ランキングは name でOKだが将来用）
    cpm: m.cpm,
    kpm: m.kpm,
    wpm: m.wpm,
    diff: m.diff,
    eff: Math.round(m.eff * 10000) / 10000,
    rank,
    rankingScore,

    // 検索/集計用（任意）
    itemCategory: currentItem.category ?? "",
    itemTheme: currentItem.theme ?? "",
    itemDifficulty: currentItem.difficulty ?? "",
    itemLength: currentItem.length ?? typed.length
  };

  const historyRecord = {
    localUser: currentUser,
    dateKey: todayKey(),
    cpm: m.cpm,
    kpm: m.kpm,
    wpm: m.wpm,
    diff: m.diff,
    eff: Math.round(m.eff * 10000) / 10000,
    rank,
    rankingScore,

    // 出題メタ（分析で使う）
    itemDifficulty: currentItem.difficulty ?? "",
    itemCategory: currentItem.category ?? "",
    itemTheme: currentItem.theme ?? "",
    itemLength: currentItem.length ?? typed.length,
    itemPunct: currentItem.punct ?? 0,
    itemKataRatio: currentItem.kataRatio ?? 0,

    // 当時のフィルタ状態（参考）
    filterDaily: !!daily,
    filterDifficulty: difficulty,
    filterCategory: daily ? "daily" : category,
    filterTheme: daily ? (dailyTheme ?? "") : theme
  };

  try {
    // ①②③：匿名認証必須で書き込み
    await rankingService.saveScoreToBoards({ score: scoreDoc, keys });
    await rankingService.saveHistory({ record: historyRecord });

    // 次へ
    setNewText();

    // 表示更新
    await refreshRankings();
    await refreshUserAnalytics();
  } catch (e) {
    el.result.innerHTML = "保存に失敗しました。Firestoreルール（匿名認証必須）と認証状態を確認してください。";
  }
}

/* =========================
 イベント：フィルタ変更
========================= */
el.difficulty.addEventListener("change", () => { setNewText(); refreshRankings(); });
el.category.addEventListener("change", () => { applyThemeOptionsByCategory(); setNewText(); refreshRankings(); });
el.theme.addEventListener("change", () => { setNewText(); refreshRankings(); });
el.dailyTheme.addEventListener("change", () => { updateDailyThemeUI(); applyThemeOptionsByCategory(); setNewText(); refreshRankings(); });
el.rankScope.addEventListener("change", () => { refreshRankings(); });

/* =========================
 JSON読み込み（data/trivia.json）
========================= */
async function loadItems() {
  const res = await fetch("./data/trivia.json", { cache: "no-store" });
  const json = await res.json();

  items = json
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
        score
      };
    });

  const catSet = new Set(items.map(x => x.category).filter(Boolean));
  categories = Array.from(catSet).sort((a,b) => a.localeCompare(b, "ja"));

  themeByCategory = new Map();
  for (const c of categories) themeByCategory.set(c, new Set());
  for (const it of items) {
    if (!it.category || !it.theme) continue;
    if (!themeByCategory.has(it.category)) themeByCategory.set(it.category, new Set());
    themeByCategory.get(it.category).add(it.theme);
  }

  const themeSet = new Set(items.map(x => x.theme).filter(Boolean));
  allThemes = Array.from(themeSet).sort((a,b) => a.localeCompare(b, "ja"));

  if (allThemes.length > 0) {
    const idx = hashString(todayKey()) % allThemes.length;
    dailyTheme = allThemes[idx];
  } else {
    dailyTheme = null;
  }

  hydrateSelects();
  applyThemeOptionsByCategory();
  updateDailyThemeUI();
}

/* =========================
 起動
========================= */
renderUserSelect();

onAuthStateChanged(auth, (user) => {
  if (user) {
    el.authBadge.textContent = `認証：OK（端末ID ${user.uid.slice(0, 8)}…）`;
  } else {
    el.authBadge.textContent = "認証：未完了";
  }
});

(async () => {
  try {
    await loadItems();
    setNewText();
    await refreshRankings();
    await refreshUserAnalytics();
  } catch {
    el.text.textContent = "データ読み込みに失敗しました。data/trivia.json の場所とJSON形式を確認してください。";
    el.input.disabled = true;
  }
})();
