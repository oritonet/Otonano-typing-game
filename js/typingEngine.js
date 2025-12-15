// js/typingEngine.js
// ・IME（日本語変換）中は判定しない
// ・確定文字だけで青赤表示
// ・CPM = 文章長 ÷ 完了時間
// ・スタート前は index.html の data-guide を表示（上揃え・横中央）
// ・カウントダウン時のみ上下中央

export class TypingEngine {
  constructor(opts = {}) {
    this.textEl = opts.textEl || null;
    this.inputEl = opts.inputEl || null;
    this.resultEl = opts.resultEl || null;
    this.onFinish = typeof opts.onFinish === "function" ? opts.onFinish : null;

    this.target = "";
    this.targetMeta = null;

    this.started = false;
    this.ended = false;
    this.startTimeMs = 0;

    this.isComposing = false;
    this.lastCommittedValue = "";
    this.keystrokes = 0; // 参考値

    // textarea の元 padding を保持
    this._basePaddingTop = null;
    this._basePaddingBottom = null;
  }

  /* =========================
     padding 管理
  ========================= */
  _ensureBasePadding() {
    if (!this.inputEl) return;
    if (this._basePaddingTop != null && this._basePaddingBottom != null) return;

    const cs = getComputedStyle(this.inputEl);
    this._basePaddingTop = cs.paddingTop;
    this._basePaddingBottom = cs.paddingBottom;
  }

  _restoreBasePadding() {
    if (!this.inputEl) return;
    this._ensureBasePadding();
    this.inputEl.style.paddingTop = this._basePaddingTop;
    this.inputEl.style.paddingBottom = this._basePaddingBottom;
  }

  /* =========================
     出題文セット
  ========================= */
  setTarget(text, meta = null) {
    this.target = (text ?? "").toString();
    this.targetMeta = meta;

    this.started = false;
    this.ended = false;
    this.startTimeMs = 0;

    this.isComposing = false;
    this.lastCommittedValue = "";
    this.keystrokes = 0;

    if (this.inputEl) {
      this._ensureBasePadding();
      this.inputEl.classList.remove("countdown", "input-guide");
      this._restoreBasePadding();

      this.inputEl.value = "";
      this.inputEl.disabled = true;
    }

    if (this.resultEl) this.resultEl.textContent = "";

    this._renderByCommitted("");
    this._showGuideCharInTextarea();
  }

  /* =========================
     ready 状態
  ========================= */
  enableReadyState() {
    if (!this.inputEl) return;

    this.started = false;
    this.ended = false;
    this.startTimeMs = 0;
    this.isComposing = false;
    this.lastCommittedValue = "";
    this.keystrokes = 0;

    this.inputEl.disabled = true;
    this._showGuideCharInTextarea();
  }

  /* =========================
     カウントダウン表示
  ========================= */
  async showCountdownInTextarea(sec = 3) {
    if (!this.inputEl) return;

    const el = this.inputEl;
    this._ensureBasePadding();

    el.disabled = true;
    el.classList.remove("input-guide");
    el.classList.add("countdown");

    for (let i = Number(sec) || 3; i > 0; i--) {
      el.value = String(i);
      this._applyVerticalCenterPadding();
      await this._sleep(1000);
    }

    el.value = "";
    el.classList.remove("countdown");
    this._restoreBasePadding();
  }

  /* =========================
     開始
  ========================= */
  startNow() {
    if (!this.inputEl) return;

    this.started = true;
    this.ended = false;
    this.startTimeMs = Date.now();
    this.keystrokes = 0;

    this.isComposing = false;
    this.lastCommittedValue = "";

    this.inputEl.classList.remove("countdown", "input-guide");
    this._restoreBasePadding();

    this.inputEl.value = "";
    this.inputEl.disabled = false;
    this.inputEl.focus();
  }

  /* =========================
     イベント登録
  ========================= */
  attach() {
    if (!this.inputEl) return;

    // 打鍵カウント（参考）
    this.inputEl.addEventListener("keydown", (e) => {
      if (!this.started || this.ended) return;

      const k = e.key;
      const isPrintable = (k.length === 1);
      const isEdit = (k === "Backspace" || k === "Delete");
      const isImeOps = (k === " " || k === "Enter");
      if (isPrintable || isEdit || isImeOps) this.keystrokes++;
    });

    // IME 変換開始
    this.inputEl.addEventListener("compositionstart", () => {
      this.isComposing = true;
      this.lastCommittedValue = this._getCommittedValueSafe();
      this._renderByCommitted(this.lastCommittedValue);
    });

    // IME 変換確定
    this.inputEl.addEventListener("compositionend", () => {
      this.isComposing = false;
      this.lastCommittedValue = this._getCommittedValueSafe();
      this._renderByCommitted(this.lastCommittedValue);
      this._tryFinishIfMatched();
    });

    // 入力
    this.inputEl.addEventListener("input", () => {
      if (!this.started || this.ended) return;

      if (this.isComposing) {
        this._renderByCommitted(this.lastCommittedValue);
        return;
      }

      this.lastCommittedValue = this._getCommittedValueSafe();
      this._renderByCommitted(this.lastCommittedValue);
      this._tryFinishIfMatched();
    });
  }

  /* =========================
     完了判定
  ========================= */
  _getCommittedValueSafe() {
    return this.inputEl?.value ?? "";
  }

  _tryFinishIfMatched() {
    if (this.ended) return;

    if (this.lastCommittedValue === this.target) {
      this.ended = true;

      const endMs = Date.now();
      const timeSec = Math.max(0.001, (endMs - this.startTimeMs) / 1000);

      const metrics = this.computeMetrics({
        timeSec,
        keystrokes: this.keystrokes
      });

      if (this.resultEl) {
        this.resultEl.innerHTML =
          `完了！ スコア(CPM): ${metrics.cpm}　ランク: ${metrics.rank}`;
      }

      this.onFinish?.({ metrics, meta: this.targetMeta });

      if (this.inputEl) this.inputEl.disabled = true;
    }
  }

  /* =========================
     スコア計算
  ========================= */
  computeMetrics({ timeSec, keystrokes }) {
    const minutes = timeSec / 60;
    const len = this.target.length;

    const cpm = Math.round(len / minutes);
    const kpm = Math.round((keystrokes || 0) / minutes);

    return {
      cpm,
      rank: this.calcRank(cpm),
      timeSec: Math.round(timeSec * 1000) / 1000,
      length: len,
      kpm,
      seconds: Math.round(timeSec * 1000) / 1000 // 互換用
    };
  }

  calcRank(cpm) {
    if (cpm >= 520) return "SSS";
    if (cpm >= 440) return "SS";
    if (cpm >= 380) return "S";
    if (cpm >= 300) return "A";
    if (cpm >= 220) return "B";
    if (cpm >= 150) return "C";
    return "D";
  }

  /* =========================
     見本文レンダリング
  ========================= */
  _renderByCommitted(committed) {
    if (!this.textEl) return;

    const t = this.target;
    const v = committed;

    let mismatch = -1;
    const minLen = Math.min(v.length, t.length);
    for (let i = 0; i < minLen; i++) {
      if (v[i] !== t[i]) { mismatch = i; break; }
    }
    if (mismatch === -1 && v.length > t.length) mismatch = t.length;

    const esc = (s) =>
      s.replaceAll("&","&amp;")
       .replaceAll("<","&lt;")
       .replaceAll(">","&gt;")
       .replaceAll('"',"&quot;")
       .replaceAll("'","&#039;");

    let html;
    if (mismatch === -1) {
      html =
        `<span class="ok">${esc(t.slice(0, v.length))}</span>${esc(t.slice(v.length))}`;
    } else {
      html =
        `<span class="ok">${esc(t.slice(0, mismatch))}</span>` +
        `<span class="ng">${esc(t.slice(mismatch, v.length))}</span>` +
        `${esc(t.slice(v.length))}`;
    }

    this.textEl.innerHTML = html;
  }

  /* =========================
     ガイド表示（index.html の data-guide）
  ========================= */
  _showGuideCharInTextarea() {
    if (!this.inputEl) return;

    const guide = this.inputEl.dataset.guide || "";
    if (!guide) return;

    const el = this.inputEl;
    this._ensureBasePadding();

    el.disabled = true;
    el.classList.remove("countdown");
    el.classList.add("input-guide");

    el.value = guide;

    // 上揃え・横中央
    this._restoreBasePadding();
  }

  /* =========================
     縦中央用（カウントダウン）
  ========================= */
  _applyVerticalCenterPadding() {
    if (!this.inputEl) return;

    const el = this.inputEl;
    const cs = getComputedStyle(el);
    const fontSize = parseFloat(cs.fontSize) || 0;
    const h = el.clientHeight;
    const padTop = Math.max(0, Math.floor((h - fontSize) / 2));

    el.style.paddingTop = `${padTop}px`;
    el.style.paddingBottom = "0px";
  }

  _sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
