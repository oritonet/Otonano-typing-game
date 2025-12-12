// js/firebase.js
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { getAuth, signInAnonymously, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";

export function initFirebase({ onAuthState } = {}) {
  const app = initializeApp({
    apiKey: "AIzaSyAqDSPE_HkPbi-J-SqPL4Ys-wR4RaA8wKA",
    authDomain: "otonano-typing-game.firebaseapp.com",
    projectId: "otonano-typing-game",
    storageBucket: "otonano-typing-game.appspot.com",
    messagingSenderId: "475283850178",
    appId: "1:475283850178:web:193d28f17be20a232f4c5b",
  });

  const db = getFirestore(app);
  const auth = getAuth(app);

  let uid = null;
  let readyResolve, readyReject;
  const ready = new Promise((res, rej) => { readyResolve = res; readyReject = rej; });

  onAuthState?.("認証：匿名ログイン中…");

  signInAnonymously(auth).catch((e) => {
    onAuthState?.(`認証：失敗（${e?.message ?? e}）`);
    readyReject(e);
  });

  onAuthStateChanged(auth, (user) => {
    if (user) {
      uid = user.uid;
      onAuthState?.(`認証：OK（${uid.slice(0, 8)}…）`);
      readyResolve(true);
    }
  });

  return {
    app, db, auth,
    onAuthReady: () => ready,
    getUid: () => uid,
  };
}
