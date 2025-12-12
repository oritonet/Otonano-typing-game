// js/typingEngine.js
// - Startボタン→入力欄にフォーカス→3,2,1,0を「入力欄に仮表示」→開始
// - IME変換中(composition中)は判定しない（色が黒に戻らない）
// - 確定文字だけで青/赤判定
// - target と一致した瞬間に即終了（スペース→バックスペース不要）
// - KPM: 文字/Backspace/Delete/Space/Enterを打鍵としてカウント（IME寄り）

export class TypingEngine {
  constructor({
    inputEl,
    textEl,
    countdownSeconds = 3,
    onFinish
  }) {
    this.inputEl = inputEl;
    this.textEl = textEl;
    this.countdownSeconds = countdownSeconds;
    this.onFinish = onFinish;

    this.target = "";
    this.running = false;

    this.startTimeMs = 0;
    this.keystrokes = 0;

    // IME
    this.isComposing = false;
    this.committedValue = ""; // 確定済みの文字列（判定/色付けはこれだけ）

    // bind
    this._onKeyDown = this._onKeyDown.bind(this);
    this._onInput = this._onInput.bind(this);
    this._onCompositionStart = this._onCompositionStart.bind(this);
    this._onCompositionEnd = this._onCompositionEnd.bind(this);

    // attach
    this.inputEl.addEventListener("keydown", this._onKeyDown);
    this.inputEl.addEventListener("input", this._onInput);
    this.inputEl.addEventListener("compositionstart", this._onCompositionStart);
    this.inputEl.addEventListener("compositionend", this._onCompositionEnd);

    // 初期状態
    this.inputEl.disabled = true;
    this.inputEl.value = "スタートを押すと入力できます";
    this._render();
  }

  setText(target) {
    this.target = String(target ?? "");
    this.reset();
    this._render();
  }

  reset() {
    this.running = false;
    this.startTimeMs = 0;
    this.keystrokes = 0;
    this.isComposing = false;
    this.committedValue = "";

    this.inputEl.disabled = true;
    this.inputEl.value = "スタートを押すと入力できます";
    this._render();
  }

  async startWithCountdown() {
    if (!this.target) return;

    // すでに実行中なら無視
    if (this.running) return;

    // カウントを「入力欄に仮表示」
    this.inputEl.disabled = true;
    this.inputEl.focus();

    for (let i = this.countdownSeconds; i >= 0; i--) {
      this.inputEl.value = String(i);
      await this._sleep(700);
    }

    // 開始
    this.inputEl.value = "";
    this.inputEl.disabled = false;
    this.inputEl.focus();

    this.running = true;
    this.startTimeMs = 0;
    this.keystrokes = 0;
    this.isComposing = false;
    this.committedValue = "";

    this._render();
  }

  _sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
  }

  // -----------------------
  // events
  // -----------------------
  _onCompositionStart() {
    this.isComposing = true;
    // 変換中に色が黒に戻る原因は「inputで再描画して committedValue を空扱い」など
    // ここでは committedValue を維持したままにする
  }

  _onCompositionEnd() {
    this.isComposing = false;

    // compositionend 後は value が確定済みになるのでここで committedValue を更新
    // ただし running 中のみ
    if (this.running) {
      this.committedValue = this.inputEl.value;
      this._render();
      this._maybeFinish();
    }
  }

  _onKeyDown(e) {
    if (!this.running) return;

    const k = e.key;
    const isPrintable = (k.length === 1);
    const isEdit = (k === "Backspace" || k === "Delete");
    const isImeOps = (k === " " || k === "Enter"); // Space=変換/候補送り, Enter=確定

    if (isPrintable || isEdit || isImeOps) {
      // 開始前の誤カウントを避けるため、最初の実入力で startTime を確定
      if (this.startTimeMs === 0) this.startTimeMs = Date.now();
      this.keystrokes++;
    }
  }

  _onInput() {
    if (!this.running) return;

    // IME変換中は committedValue を更新しない
    // → 変換中に青/赤が黒に戻らない
    if (!this.isComposing) {
      this.committedValue = this.inputEl.value;
    }

    // 描画は毎回行うが、色判定は committedValue ベース
    this._render();

    // IME中は終了判定しない（確定後のみ）
    if (!this.isComposing) {
      this._maybeFinish();
    }
  }

  // -----------------------
  // finish
  // -----------------------
  _maybeFinish() {
    if (!this.running) return;
    if (!this.target) return;

    // 完全一致したら即終了（「スペース→バックスペース」不要）
    if (this.committedValue === this.target) {
      this._finish();
    }
  }

  _finish() {
    this.running = false;
    this.inputEl.disabled = true;

    const endMs = Date.now();
    const startMs = this.startTimeMs || endMs;
    const seconds = Math.max(0.2, (endMs - startMs) / 1000);

    const typedLength = this.target.length;
    const minutes = seconds / 60;

    const cpm = Math.round(typedLength / minutes);
    const kpm = Math.round(this.keystrokes / minutes);
    const wpm = Math.round((typedLength / 5) / minutes);

    const diff = Math.max(0, kpm - cpm);
    const eff = kpm > 0 ? (cpm / kpm) : 0;

    const rank = this._calcRank(cpm, kpm);

    // 完了ポップアップ（消えない）
    // ブラウザ標準ダイアログで「一瞬で消える」問題を回避
    const msg =
      `完了！\n` +
      `ランク: ${rank}（効率 ${(eff * 100).toFixed(1)}%）\n` +
      `CPM（文字/分）: ${cpm}\n` +
      `KPM（打鍵/分）: ${kpm}\n` +
      `KPM−CPM差: ${diff}\n` +
      `参考WPM: ${wpm}`;

    alert(msg);

    if (typeof this.onFinish === "function") {
      this.onFinish({
        seconds,
        typedLength,
        cpm,
        kpm,
        wpm,
        diff,
        eff,
        rank,
        keystrokes: this.keystrokes
      });
    }
  }

  _calcRank(cpm, kpm) {
    const eff = (kpm > 0) ? (cpm / kpm) : 0;
    if (cpm >= 420 && eff >= 0.92) return "SSS";
    if (cpm >= 360 && eff >= 0.88) return "SS";
    if (cpm >= 320 && eff >= 0.84) return "S";
    if (cpm >= 260 && eff >= 0.78) return "A";
    if (cpm >= 200 && eff >= 0.72) return "B";
    if (cpm >= 150) return "C";
    return "D";
  }

  // -----------------------
  // render (blue/red)
  // -----------------------
  _escape(s) {
    return String(s)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  _render() {
    const t = this.target ?? "";
    const v = this.committedValue ?? ""; // 確定文字だけで判定

    if (!t) {
      this.textEl.textContent = "読み込み中...";
      return;
    }

    // mismatch を探す
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
      html = `<span class="ok">${this._escape(okPart)}</span>${this._escape(rest)}`;
    } else {
      const okPart = t.slice(0, mismatch);
      const ngPart = t.slice(mismatch, Math.min(v.length, t.length));
      const rest = t.slice(Math.min(v.length, t.length));
      html =
        `<span class="ok">${this._escape(okPart)}</span>` +
        `<span class="ng">${this._escape(ngPart)}</span>` +
        `${this._escape(rest)}`;
    }
    this.textEl.innerHTML = html;
  }
}
