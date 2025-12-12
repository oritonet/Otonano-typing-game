// js/app.js
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { getAuth, signInAnonymously, onAuthStateChanged } 
  from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";

import { TypingEngine } from "./typingEngine.js";
import { Ranking } from "./ranking.js";
import { UserManager } from "./userManager.js";

const app = initializeApp({
  apiKey: "AIzaSyAqDSPE_HkPbi-J-SqPL4Ys-wR4RaA8wKA",
  authDomain: "otonano-typing-game.firebaseapp.com",
  projectId: "otonano-typing-game",
});

const db = getFirestore(app);
const auth = getAuth(app);

const authBadge = document.getElementById("authBadge");
signInAnonymously(auth);

let uid = null;
onAuthStateChanged(auth, user => {
  if (user) {
    uid = user.uid;
    authBadge.textContent = `認証OK (${uid.slice(0,8)}…)`;
  }
});

const trivia = await (await fetch("./data/trivia.json")).json();
const themes = [...new Set(trivia.map(t => t.theme))];
const todayTheme = themes[new Date().getDate() % themes.length];

const ranking = new Ranking(db);
const users = new UserManager(document.getElementById("userSelect"));

let current = trivia.find(t => t.theme === todayTheme);

const engine = new TypingEngine({
  textEl: document.getElementById("text"),
  inputEl: document.getElementById("input"),
  countdownEl: document.getElementById("countdownWrap"),
  onComplete: async ({ cpm, kpm, rank }) => {
    await ranking.saveDaily({
      uid,
      name: users.current,
      theme: current.theme,
      dailyTheme: todayTheme,
      cpm, kpm, rank
    });

    current = trivia.find(t => t.theme === todayTheme);
    engine.setText(current.text);
  }
});

engine.setText(current.text);
engine.bind();

document.getElementById("startBtn").onclick = () => engine.start();
document.getElementById("skipBtn").onclick = () => {
  current = trivia.find(t => t.theme === todayTheme);
  engine.setText(current.text);
};
