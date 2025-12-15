// js/typingEngine.js
export class TypingEngine {
  constructor({ textEl, inputEl, resultEl, onFinish }) {
    this.textEl = textEl;
    this.inputEl = inputEl;
    this.resultEl = resultEl;
    this.onFinish = onFinish;

    this.target = "";
    this.targetMeta = null;

    this.started = false;
    this.ended = false;

    this.startTimeMs = 0;

    this.isComposing = false;
    this.lastCommittedValue = "";

    this.keystrokes = 0; // 参考（表示や保存に使わない方針でも残しておく）
  }

  setTarget(text, meta = null) {
    this.target = text || "";
    this.targetMeta = meta;

    this.started = false;
    this.ended = false;
    this.startTimeMs = 0;
    this.isComposing = false;
    this.lastCommittedValue = "";

    this.keystrokes = 0;

    this.inputEl.value = "";
    this.inputEl.disabled = true;
    this.resultEl.textContent = "";

    this._renderByCommitted("");
  }

  // カウントダウン表示は「入力欄内」に出す
  showCountdownInTextarea(n) {
    this.inputEl.disabled = true;
    this.inputEl.classList.add("countdown");

    this.inputEl.value = String(n);

    // ▼上下中央寄せ：textareaの高さからpadding-topを計算（%は使わない）
    const el = this.inputEl;
    const cs = getComputedStyle(el);
    const fontSize = parseFloat(cs.fontSize) || 0; // px
    const h = el.clientHeight;
    const padTop = Math.max(0, Math.floor((h - fontSize) / 2));

    el.style.paddingTop = `${padTop}px`;
    el.style.paddingBottom = "0px";
  }

  enableReadyState() {
    this.inputEl.disabled = false;
    this.inputEl.value = "";
    this.inputEl.focus();
  }

  startNow() {
    this.started = true;
    this.ended = false;
    this.startTimeMs = Date.now();
    this.keystrokes = 0;
    this.lastCommittedValue = this.inputEl.value;
  }

  attach() {
    // keydown: 打鍵カウント（参考）
    this.inputEl.addEventListener("keydown", (e) => {
      if (!this.started || this.ended) return;

      const k = e.key;
      const isPrintable = (k.length === 1);
      const isEdit = (k === "Backspace" || k === "Delete");
      const isImeOps = (k === " " || k === "Enter");
      if (isPrintable || isEdit || isImeOps) this.keystrokes++;
    });

    // composition: 変換中は判定しない・色を変えない
    this.inputEl.addEventListener("compositionstart", () => {
      this.isComposing = true;
      this.lastCommittedValue = this._getCommittedValueSafe();
      this._renderByCommitted(this.lastCommittedValue);
    });

    this.inputEl.addEventListener("compositionend", () => {
      this.isComposing = false;
      this.lastCommittedValue = this._getCommittedValueSafe();
      this._renderByCommitted(this.lastCommittedValue);
      this._tryFinishIfMatched();
    });

    // input: composing中は「色を変えない」
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

  _getCommittedValueSafe() {
    return this.inputEl.value ?? "";
  }

  _tryFinishIfMatched() {
    if (this.ended) return;
    const committed = this.lastCommittedValue;

    // 確定文字で完全一致したら即終了
    if (committed === this.target) {
      this.ended = true;

      const endMs = Date.now();
      const sec = Math.max(0.001, (endMs - this.startTimeMs) / 1000);

      const metrics = this.computeMetrics({
        committed,
        seconds: sec,
        keystrokes: this.keystrokes
      });

      // 表示（app.js側でモーダルも出す）
      this.resultEl.innerHTML = `完了！ スコア(CPM): ${metrics.cpm}　ランク: ${metrics.rank}`;

      this.onFinish?.({ metrics, meta: this.targetMeta });

      this.inputEl.disabled = true;
    }
  }

  // ★新仕様：CPM（=スコア）は「文章長 ÷ 完了時間」
  computeMetrics({ committed, seconds, keystrokes }) {
    const minutes = seconds / 60;

    // 出題文の文字数で評価する（漢字/かな混在でも公平）
    const targetLen = (this.target ?? "").length;

    const cpm = Math.round((targetLen / minutes));

    // 参考値として残す（使わないなら保存しなくてOK）
    const kpm = Math.round((keystrokes / minutes));

    const rank = this.calcRank(cpm);

    return {
      cpm,
      rank,
      seconds: Math.round(seconds * 1000) / 1000,
      length: targetLen,
      kpm
    };
  }

  // ★新方針：ランクは「速く一致できたか」中心（CPMだけ）
  calcRank(cpm) {
    if (cpm >= 520) return "SSS";
    if (cpm >= 440) return "SS";
    if (cpm >= 380) return "S";
    if (cpm >= 300) return "A";
    if (cpm >= 220) return "B";
    if (cpm >= 150) return "C";
    return "D";
  }

  // 見本文：確定文字だけで青/赤を付ける（変換中は lastCommitted を使う）
  _renderByCommitted(committed) {
    const t = this.target ?? "";
    const v = committed ?? "";

    let mismatch = -1;
    const minLen = Math.min(v.length, t.length);
    for (let i = 0; i < minLen; i++) {
      if (v[i] !== t[i]) { mismatch = i; break; }
    }
    if (mismatch === -1 && v.length > t.length) mismatch = t.length;

    const esc = (s) => String(s)
      .replaceAll("&","&amp;")
      .replaceAll("<","&lt;")
      .replaceAll(">","&gt;")
      .replaceAll('"',"&quot;")
      .replaceAll("'","&#039;");

    let html = "";
    if (mismatch === -1) {
      const okPart = t.slice(0, v.length);
      const rest = t.slice(v.length);
      html = `<span class="ok">${esc(okPart)}</span>${esc(rest)}`;
    } else {
      const okPart = t.slice(0, mismatch);
      const ngPart = t.slice(mismatch, Math.min(v.length, t.length));
      const rest = t.slice(Math.min(v.length, t.length));
      html = `<span class="ok">${esc(okPart)}</span><span class="ng">${esc(ngPart)}</span>${esc(rest)}`;
    }

    this.textEl.innerHTML = html;
  }
}
