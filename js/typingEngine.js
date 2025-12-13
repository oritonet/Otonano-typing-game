// js/typingEngine.js
export class TypingEngine {
  constructor({
    textEl,
    inputEl,
    resultEl,
    onFinish
  }) {
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

    this.keystrokes = 0; // KPM用（IME寄り：Space/Enterも含む）
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

    this._renderByCommitted(""); // 最初は黒
  }

  // カウントダウン表示は「入力欄内」に出す
  showCountdownInTextarea(n) {
    this.inputEl.disabled = true;
    this.inputEl.classList.add("countdown");
  
    // 数字だけ表示
    this.inputEl.value = String(n);
  
    // ▼上下中央寄せ：textareaの高さからpadding-topを計算（%は使わない）
    const el = this.inputEl;
    const cs = getComputedStyle(el);
    const fontSize = parseFloat(cs.fontSize) || 0;          // px
    const h = el.clientHeight;                               // padding含む内側高さ
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
    // keydown: 打鍵カウント（IME寄り）
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
      // ここで lastCommittedValue を固定（色が戻らないため）
      this.lastCommittedValue = this._getCommittedValueSafe();
      this._renderByCommitted(this.lastCommittedValue);
    });

    this.inputEl.addEventListener("compositionend", () => {
      this.isComposing = false;
      // 変換確定後の値で committed を更新して判定する
      this.lastCommittedValue = this._getCommittedValueSafe();
      this._renderByCommitted(this.lastCommittedValue);
      this._tryFinishIfMatched();
    });

    // input: composing中は「色を変えない」
    this.inputEl.addEventListener("input", () => {
      if (!this.started || this.ended) return;

      if (this.isComposing) {
        // 変換中は committed 表示を保つ（黒に戻さない）
        this._renderByCommitted(this.lastCommittedValue);
        return;
      }

      // 通常入力（確定文字）なので committed 更新
      this.lastCommittedValue = this._getCommittedValueSafe();
      this._renderByCommitted(this.lastCommittedValue);
      this._tryFinishIfMatched();
    });
  }

  _getCommittedValueSafe() {
    // textareaの値はここでは確定文字を含む（composition中でも変わるが、compositionstartで固定している）
    return this.inputEl.value ?? "";
  }

  _tryFinishIfMatched() {
    // 確定文字で完全一致したら即終了
    if (this.ended) return;
    const committed = this.lastCommittedValue;

    if (committed === this.target) {
      this.ended = true;
      const endMs = Date.now();
      const sec = Math.max(0.001, (endMs - this.startTimeMs) / 1000);

      const metrics = this.computeMetrics({
        committed,
        seconds: sec,
        keystrokes: this.keystrokes
      });

      this.resultEl.innerHTML =
        `完了！` +
        `　CPM: ${metrics.cpm}　KPM: ${metrics.kpm}　ランク: ${metrics.rank}　Score: ${metrics.rankingScore}`;

      this.onFinish?.({ metrics, meta: this.targetMeta });

      // 終了後は入力無効（次へはボタン）
      this.inputEl.disabled = true;
    }
  }

  computeMetrics({ committed, seconds, keystrokes }) {
    const minutes = seconds / 60;
  
    // 新：スコア（=CPM）は「出題文の長さ ÷ 完了時間」
    const targetLen = (this.target ?? "").length;
    const cpm = Math.round((targetLen / minutes));
  
    // KPM等を残すならそのまま（使わなくてもOK）
    const kpm = Math.round((keystrokes / minutes));
    const eff = (kpm > 0) ? (cpm / kpm) : 0;
    const diff = Math.max(0, kpm - cpm);
  
    // ランク/ランキングScore は後で ranking.js と合わせて見直す（手順4）
    const rank = this.calcRank(cpm, kpm);
    const rankingScore = cpm; // ← いったん「スコア=CPM」に寄せる
  
    return { cpm, kpm, eff, diff, rank, rankingScore };
  }


  // ランク（SSS〜D）
  calcRank(cpm, kpm) {
    const eff = (kpm > 0) ? (cpm / kpm) : 0;
    if (cpm >= 420 && eff >= 0.92) return "SSS";
    if (cpm >= 360 && eff >= 0.88) return "SS";
    if (cpm >= 320 && eff >= 0.84) return "S";
    if (cpm >= 260 && eff >= 0.78) return "A";
    if (cpm >= 200 && eff >= 0.72) return "B";
    if (cpm >= 150) return "C";
    return "D";
  }

  // rankingScore（ランキング並び順の本体）
  calcRankingScore(cpm, kpm) {
    const eff = (kpm > 0) ? (cpm / kpm) : 0;
    const waste = Math.max(0, kpm - cpm);
    return Math.round(
      cpm * 1.0 +
      eff * 100 -
      waste * 0.3
    );
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



