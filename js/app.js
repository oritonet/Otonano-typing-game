// js/app.js
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getAuth, signInAnonymously } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";

import { TypingEngine } from "./typingEngine.js";
import { RankingService } from "./ranking.js";
import { UserManager } from "./userManager.js";

const app = initializeApp({
  apiKey: "AIzaSyAqDSPE_HkPbi-J-SqPL4Ys-wR4RaA8wKA",
  authDomain: "otonano-typing-game.firebaseapp.com",
  projectId: "otonano-typing-game"
});
signInAnonymously(getAuth(app));

const ranking = new RankingService(app);

let items = [];
let dailyTheme = "";

async function loadData() {
  const r = await fetch("./data/trivia.json");
  items = await r.json();

  const themes = [...new Set(items.map(x => x.theme))];
  const d = new Date().toISOString().slice(0, 10);
  dailyTheme = themes[Math.abs(hash(d)) % themes.length];

  next();
}

function hash(s) {
  let h = 0;
  for (let c of s) h = (h << 5) - h + c.charCodeAt(0);
  return h;
}

let currentItem = null;
let engine, users;

function next() {
  const pool = items.filter(x => x.theme === dailyTheme);
  currentItem = pool[Math.floor(Math.random() * pool.length)];
  engine.setText(currentItem.text);
}

window.addEventListener("DOMContentLoaded", async () => {
  users = new UserManager(document.getElementById("userSelect"));

  engine = new TypingEngine({
    textEl: document.getElementById("text"),
    inputEl: document.getElementById("input"),
    onComplete: async (metrics) => {
      await ranking.saveDaily({
        name: users.current,
        theme: currentItem.theme,
        dailyTheme,
        metrics
      });
      next();
    }
  });

  engine.bind();

  document.getElementById("startBtn").onclick = () => {
    engine.startCountdown();
  };

  document.getElementById("addUser").onclick = () => {
    const n = prompt("ユーザー名");
    users.add(n);
  };

  document.getElementById("userSelect").onchange = e => {
    users.select(e.target.value);
  };

  await loadData();
});
