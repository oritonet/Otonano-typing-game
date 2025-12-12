// js/typingEngine.js
export class TypingEngine {
  constructor({ textEl, inputEl, onComplete }) {
    this.textEl = textEl;
    this.inputEl = inputEl;
    this.onComplete = onComplete;

    this.target = "";
    this.startTime = 0;
    this.keystrokes = 0;
    this.isComposing = false;
    this.started = false;
    this.finished = false;
  }

  setText(text) {
    this.target = text;
    this.textEl.textContent = text;
    this.reset();
  }

  reset() {
    this.startTime = 0;
    this.keystrokes = 0;
    this.started = false;
    this.finished = false;
    this.inputEl.value = "";
  }

  async startCountdown() {
    this.inputEl.disabled = false;
    this.inputEl.readOnly = true;
    this.inputEl.value = "";
    this.inputEl.style.textAlign = "center";
    this.inputEl.style.fontSize = "2rem";

    for (const s of ["3", "2", "1", "START"]) {
      this.inputEl.value = s;
      await new Promise(r => setTimeout(r, 700));
    }

    this.inputEl.value = "";
    this.inputEl.readOnly = false;
    this.inputEl.style.textAlign = "";
    this.inputEl.style.fontSize = "";
    this.inputEl.focus();

    this.started = true;
    this.startTime = 0;
    this.keystrokes = 0;
  }

  bind() {
    this.inputEl.addEventListener("compositionstart", () => {
      this.isComposing = true;
    });

    this.inputEl.addEventListener("compositionend", () => {
      this.isComposing = false;
      this.render(); // 確定後のみ再描画
      this.checkFinish(); // ★ 確定直後に終了判定
    });

    this.inputEl.addEventListener("keydown", e => {
      if (
        e.key.length === 1 ||
        ["Backspace", "Delete", "Enter", " "].includes(e.key)
      ) {
        this.keystrokes++;
      }
    });

    this.inputEl.addEventListener("input", () => {
      if (!this.started || this.finished) return;

      if (this.inputEl.value.length === 1 && this.startTime === 0) {
        this.startTime = Date.now();
        this.keystrokes = 0;
      }

      if (!this.isComposing) {
        this.render();
        this.checkFinish(); // ★ 入力ごとに終了判定
      }
    });
  }

  render() {
    const typed = this.inputEl.value;
    let html = "";

    for (let i = 0; i < this.target.length; i++) {
      if (i < typed.length) {
        html += typed[i] === this.target[i]
          ? `<span class="ok">${this.target[i]}</span>`
          : `<span class="ng">${this.target[i]}</span>`;
      } else {
        html += this.target[i];
      }
    }
    this.textEl.innerHTML = html;
  }

  checkFinish() {
    const typed = this.inputEl.value;

    // ★ IME確定後 & 完全一致のみ終了
    if (
      !this.isComposing &&
      typed.length === this.target.length &&
      typed === this.target
    ) {
      this.finish();
    }
  }

  finish() {
    if (this.finished) return;
    this.finished = true;
    this.started = false;

    const seconds = (Date.now() - this.startTime) / 1000;
    const minutes = seconds / 60;

    const cpm = Math.round(this.target.length / minutes);
    const kpm = Math.round(this.keystrokes / minutes);
    const eff = cpm / kpm;

    let rank = "D";
    if (cpm >= 420 && eff >= 0.92) rank = "SSS";
    else if (cpm >= 360 && eff >= 0.88) rank = "SS";
    else if (cpm >= 320 && eff >= 0.84) rank = "S";
    else if (cpm >= 260 && eff >= 0.78) rank = "A";
    else if (cpm >= 200 && eff >= 0.72) rank = "B";
    else if (cpm >= 150) rank = "C";

    // ★ alertはここで完全に止まる
    alert(
      `完了！\n\n` +
      `ランク：${rank}\n` +
      `CPM：${cpm}\n` +
      `KPM：${kpm}\n` +
      `効率：${(eff * 100).toFixed(1)}%`
    );

    // 次の処理は alert 後に行う
    this.onComplete({ cpm, kpm, eff, rank });
  }
}
