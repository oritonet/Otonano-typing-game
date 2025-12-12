function escapeHtml(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function clamp(n, a, b) { return Math.max(a, Math.min(b, n)); }

export class TypingEngine {
  constructor({
    textEl,
    inputEl,
    resultEl,
    startBtn,
    skipBtn,
    countdownWrapEl,
    countdownEl,
    countdownSubEl,
    onComplete,            // ({typed, seconds, keystrokes, committedValue}) => void
    onNeedNextText         // () => void   (別の文章/完了後の次へ)
  }) {
    this.textEl = textEl;
    this.inputEl = inputEl;
    this.resultEl = resultEl;
    this.startBtn = startBtn;
    this.skipBtn = skipBtn;
    this.countdownWrapEl = countdownWrapEl;
    this.countdownEl = countdownEl;
    this.countdownSubEl = countdownSubEl;
    this.onComplete = onComplete;
    this.onNeedNextText = onNeedNextText;

    this.target = "";
    this.started = false;
    this.ended = false;

    this.startTime = 0;        // 初入力で開始
    this.keystrokes = 0;

    // IME関連：確定文字だけで判定するための状態
    this.isComposing = false;

    this._bind();
  }

  _bind() {
    // ボタン
    this.startBtn.addEventListener("click", () => this.startCountdown());
    this.skipBtn.addEventListener("click", () => {
      this.resetRoundUI();
      this.onNeedNextText?.();
    });

    // IME：変換中は判定しない
    this.inputEl.addEventListener("compositionstart", () => {
      this.isComposing = true;
      this._renderNoJudge();
    });
    this.inputEl.addEventListener("compositionend", () => {
      this.isComposing = false;
      // compositionend の直後に input が来ることが多いが、ここでも一応描画
      this.renderJudged();
    });

    // KPM（IME寄り強化）：文字/Backspace/Delete/Space/Enter をカウント
    this.inputEl.addEventListener("keydown", (e) => {
      const k = e.key;
      const isPrintable = (k.length === 1);
      const isEdit = (k === "Backspace" || k === "Delete");
      const isImeOps = (k === " " || k === "Enter");
      if (this.started && !this.ended && (isPrintable || isEdit || isImeOps)) {
        this.keystrokes++;
      }
    });

    // 入力
    this.inputEl.addEventListener("input", () => {
      if (!this.started || this.ended) return;

      // 変換中は判定しない（=色付けしない）
      if (this.isComposing) {
        this._renderNoJudge();
        return;
      }

      const typed = this.inputEl.value;

      if (typed.length > 0 && this.startTime === 0) {
        this.startTime = Date.now();
      }

      this.renderJudged();

      if (typed === this.target) {
        this.ended = true;
        const seconds = this.startTime ? (Date.now() - this.startTime) / 1000 : 0;
        this.onComplete?.({
          typed,
          seconds: Math.max(0.001, seconds),
          keystrokes: Math.max(1, this.keystrokes)
        });
      }
    });
  }

  setTarget(text) {
    this.target = text ?? "";
    this.textEl.textContent = this.target;
    this.resetRoundUI();
  }

  resetRoundUI() {
    this.started = false;
    this.ended = false;
    this.startTime = 0;
    this.keystrokes = 0;
    this.isComposing = false;

    this.inputEl.value = "";
    this.inputEl.disabled = true;

    this.resultEl.textContent = "";
    this.textEl.textContent = this.target;
  }

  async startCountdown() {
    if (!this.target) return;
    if (this.started && !this.ended) {
      // すでに開始中ならフォーカスだけ
      this.inputEl.focus();
      return;
    }

    this.resetRoundUI();

    // 3,2,1,0
    this.countdownWrapEl.style.display = "block";
    this.countdownSubEl.textContent = "準備してください";

    const seq = [3, 2, 1, 0];
    for (const n of seq) {
      this.countdownEl.textContent = String(n);
      this.countdownSubEl.textContent = (n === 0) ? "開始" : "準備してください";
      await new Promise(r => setTimeout(r, 700));
    }

    this.countdownWrapEl.style.display = "none";

    // 開始
    this.started = true;
    this.ended = false;
    this.startTime = 0;
    this.keystrokes = 0;

    this.inputEl.disabled = false;
    this.inputEl.focus();
  }

  _renderNoJudge() {
    // 変換確定前は色判定しない（=見本文を素のテキストで表示）
    this.textEl.textContent = this.target;
  }

  renderJudged() {
    const t = this.target ?? "";
    const v = this.inputEl.value ?? "";

    // mismatch index
    let mismatch = -1;
    const minLen = Math.min(v.length, t.length);
    for (let i = 0; i < minLen; i++) {
      if (v[i] !== t[i]) { mismatch = i; break; }
    }
    if (mismatch === -1 && v.length > t.length) mismatch = t.length;

    let html = "";
    if (mismatch === -1) {
      const okPart = t.slice(0, v.length);
      const rest = t.slice(v.length);
      html = `<span class="ok">${escapeHtml(okPart)}</span>${escapeHtml(rest)}`;
    } else {
      const okPart = t.slice(0, mismatch);
      const ngPart = t.slice(mismatch, Math.min(v.length, t.length));
      const rest = t.slice(Math.min(v.length, t.length));
      html =
        `<span class="ok">${escapeHtml(okPart)}</span>` +
        `<span class="ng">${escapeHtml(ngPart)}</span>` +
        `${escapeHtml(rest)}`;
    }
    this.textEl.innerHTML = html;
  }

  // 結果表示用（アプリ側で使う）
  static computeMetrics({ typedLength, seconds, keystrokes }) {
    const minutes = seconds / 60;
    const cpm = Math.round(typedLength / minutes);
    const kpm = Math.round(keystrokes / minutes);
    const wpm = Math.round((typedLength / 5) / minutes); // 参考
    const diff = Math.max(0, kpm - cpm);
    const eff = (kpm > 0) ? (cpm / kpm) : 0;
    return { cpm, kpm, wpm, diff, eff };
  }

  static calcRank(cpm, kpm) {
    const eff = (kpm > 0) ? (cpm / kpm) : 0;
    if (cpm >= 420 && eff >= 0.92) return "SSS";
    if (cpm >= 360 && eff >= 0.88) return "SS";
    if (cpm >= 320 && eff >= 0.84) return "S";
    if (cpm >= 260 && eff >= 0.78) return "A";
    if (cpm >= 200 && eff >= 0.72) return "B";
    if (cpm >= 150) return "C";
    return "D";
  }

  static calcRankingScore(cpm, kpm) {
    const eff = cpm / kpm;
    const waste = kpm - cpm;
    return Math.round(
      cpm * 1.0 +
      eff * 100 -
      waste * 0.3
    );
  }

  // 直近X件の差分推移を描く（アプリ側にも置けるが、ここに同梱）
  static drawDiffChart(canvas, values) {
    const ctx = canvas.getContext("2d");

    const cssW = canvas.clientWidth;
    const cssH = canvas.clientHeight;
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

    // axis
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

    const n = values.length;
    for (let i = 0; i < n; i++) {
      const x = pad + (n === 1 ? 0 : (i / (n - 1)) * w);
      const norm = (values[i] - minV) / (maxV - minV || 1);
      const y = pad + h - norm * h;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();

    // label
    ctx.fillStyle = "#555";
    ctx.font = "12px system-ui";
    ctx.fillText("KPM−CPM 差（小さいほど効率的）", pad, 14);
  }
}
