// js/typingEngine.js
export class TypingEngine {
  constructor({ textEl, inputEl, countdownEl, onComplete }) {
    this.textEl = textEl;
    this.inputEl = inputEl;
    this.countdownEl = countdownEl;
    this.onComplete = onComplete;

    this.target = "";
    this.started = false;
    this.finished = false;
    this.isComposing = false;

    this.startTime = 0;
    this.keystrokes = 0;
  }

  setText(text) {
    this.target = text;
    this.textEl.textContent = text;
    this.inputEl.value = "";
    this.inputEl.disabled = true;
    this.started = false;
    this.finished = false;
    this.keystrokes = 0;
    this.startTime = 0;
  }

  async start() {
    this.inputEl.disabled = false;
    this.inputEl.readOnly = true;
    this.inputEl.value = "";
    this.countdownEl.style.display = "block";

    const steps = ["3", "2", "1", "0"];
    for (const s of steps) {
      this.countdownEl.querySelector("#countdown").textContent = s;
      await new Promise(r => setTimeout(r, 700));
    }

    this.countdownEl.style.display = "none";
    this.inputEl.readOnly = false;
    this.inputEl.focus();
    this.started = true;
  }

  bind() {
    this.inputEl.addEventListener("compositionstart", () => {
      this.isComposing = true;
    });

    this.inputEl.addEventListener("compositionend", () => {
      this.isComposing = false;
      this.render();
      this.checkFinish();
    });

    this.inputEl.addEventListener("keydown", e => {
      if (!this.started || this.finished) return;
      if (e.key.length === 1 || ["Backspace", "Delete", " ", "Enter"].includes(e.key)) {
        this.keystrokes++;
      }
    });

    this.inputEl.addEventListener("input", () => {
      if (!this.started || this.finished) return;

      if (!this.startTime && !this.isComposing && this.inputEl.value.length === 1) {
        this.startTime = Date.now();
        this.keystrokes = 0;
      }

      if (this.isComposing) return;

      this.render();
      this.checkFinish();
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
    if (this.finished || this.isComposing) return;

    if (this.inputEl.value === this.target) {
      this.finished = true;
      const sec = (Date.now() - this.startTime) / 1000;
      const min = sec / 60;

      const cpm = Math.round(this.target.length / min);
      const kpm = Math.round(this.keystrokes / min);
      const eff = cpm / kpm;

      let rank = "D";
      if (cpm >= 420 && eff >= 0.92) rank = "SSS";
      else if (cpm >= 360) rank = "SS";
      else if (cpm >= 320) rank = "S";
      else if (cpm >= 260) rank = "A";
      else if (cpm >= 200) rank = "B";
      else if (cpm >= 150) rank = "C";

      alert(
        `完了！\n\nCPM: ${cpm}\nKPM: ${kpm}\n効率: ${(eff*100).toFixed(1)}%\nランク: ${rank}`
      );

      this.onComplete({ cpm, kpm, rank });
    }
  }
}
