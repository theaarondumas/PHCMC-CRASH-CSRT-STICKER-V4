/* app.js — Crash Cart Stickers (NO PHI)
   Secure Firebase submit via Anonymous Auth + Firestore.
   Drop-in file. If any element IDs differ from your HTML, change them in DOM SELECTORS below.
*/

// =========================
// Firebase imports (CDN)
// =========================
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.7.0/firebase-app.js";
import {
  getFirestore,
  doc,
  setDoc,
  serverTimestamp,
  enableIndexedDbPersistence
} from "https://www.gstatic.com/firebasejs/12.7.0/firebase-firestore.js";

import {
  getAuth,
  signInAnonymously,
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/12.7.0/firebase-auth.js";

// =========================
// CONFIG — PUT YOUR REAL KEYS HERE
// =========================
const firebaseConfig = {
  apiKey: "PASTE_API_KEY",
  authDomain: "phcmc-crash-cart.firebaseapp.com",
  projectId: "phcmc-crash-cart",
  storageBucket: "phcmc-crash-cart.appspot.com",
  messagingSenderId: "478233106614",
  appId: "PASTE_APP_ID"
};

// Firestore collection name for submissions.
// If your old code used a different collection, change this:
const SUBMISSIONS_COLLECTION = "submissions";

// =========================
// Local storage keys
// =========================
const LOCAL_SAVED_KEY = "cc_saved_entries_v1";
const LOCAL_LOCK_KEY = "cc_lock_v1";        // { locked: bool, pinHash: string|null }

// =========================
// DOM SELECTORS (adjust if needed)
// =========================
const $ = (sel) => document.querySelector(sel);

const els = {
  // Buttons
  btnSubmit: $("#btnSubmitFirebase") || $("#submitToFirebaseBtn") || $("button[data-action='submit-firebase']"),
  btnWipeLocal: $("#btnWipeLocal") || $("#wipeLocalBtn") || $("button[data-action='wipe-local']"),

  btnLock: $("#btnLock") || $(".lock-btn") || $("button[data-action='lock']"),
  btnGeneratePin: $("#btnGeneratePin") || $("button[data-action='generate-pin']"),

  // Preview list container
  previewList: $("#previewList") || $("#previewCards") || $("#previewContainer"),

  // Optional: status / toast
  toast: $("#toast") || $("#toastMessage") || $(".toast"),

  // Optional: any text areas/labels you might have
  authStatus: $("#authStatus") || null
};

// =========================
// App state
// =========================
const state = {
  authReady: false,
  user: null,

  savedEntries: [],

  lock: {
    locked: false,
    pinHash: null
  }
};

// =========================
// Utility: Toast / status
// =========================
function showToast(message) {
  // If you already have a toast UI, this will use it.
  // Otherwise it will fallback to alert().
  console.log("[TOAST]", message);

  if (els.toast) {
    els.toast.textContent = message;
    els.toast.style.opacity = "1";
    els.toast.style.transform = "translateY(0)";
    clearTimeout(showToast._t);
    showToast._t = setTimeout(() => {
      els.toast.style.opacity = "0";
      els.toast.style.transform = "translateY(8px)";
    }, 2800);
  } else {
    alert(message);
  }
}

// =========================
// Lock + PIN (UI gate)
// NOTE: Real security is Firebase Auth + Firestore Rules.
// PIN is UX / workflow protection, not a cryptographic barrier.
// =========================
async function sha256(text) {
  const enc = new TextEncoder().encode(text);
  const buf = await crypto.subtle.digest("SHA-256", enc);
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("");
}

function loadLock() {
  try {
    const raw = localStorage.getItem(LOCAL_LOCK_KEY);
    if (!raw) return;
    const obj = JSON.parse(raw);
    state.lock.locked = !!obj.locked;
    state.lock.pinHash = obj.pinHash || null;
  } catch {}
}

function saveLock() {
  localStorage.setItem(LOCAL_LOCK_KEY, JSON.stringify(state.lock));
  updateLockUI();
}

function updateLockUI() {
  if (!els.btnLock) return;
  // You can style this however you want in CSS.
  // For now: change button text.
  els.btnLock.textContent = state.lock.locked ? "Locked" : "Lock";
}

async function generatePin() {
  // 6-digit PIN
  const pin = String(Math.floor(100000 + Math.random() * 900000));
  state.lock.pinHash = await sha256(pin);
  state.lock.locked = true;
  saveLock();
  showToast(`PIN generated: ${pin} (save this now)`);
}

async function promptUnlock() {
  if (!state.lock.pinHash) {
    showToast("No PIN set. Generate a PIN first.");
    return;
  }
  const entered = prompt("Enter PIN to unlock:");
  if (!entered) return;

  const enteredHash = await sha256(entered.trim());
  if (enteredHash === state.lock.pinHash) {
    state.lock.locked = false;
    saveLock();
    showToast("Unlocked.");
  } else {
    showToast("Wrong PIN.");
  }
}

function toggleLock() {
  if (!state.lock.pinHash) {
    showToast("No PIN set. Tap Generate PIN first.");
    return;
  }
  if (state.lock.locked) {
    // must unlock via PIN
    promptUnlock();
  } else {
    state.lock.locked = true;
    saveLock();
    showToast("Locked.");
  }
}

// =========================
// Saved entries (local)
// =========================
function loadSavedEntries() {
  try {
    const raw = localStorage.getItem(LOCAL_SAVED_KEY);
    state.savedEntries = raw ? JSON.parse(raw) : [];
  } catch {
    state.savedEntries = [];
  }
}

function saveSavedEntries() {
  localStorage.setItem(LOCAL_SAVED_KEY, JSON.stringify(state.savedEntries));
}

function wipeLocal() {
  if (!confirm("Wipe ALL saved (local) entries?")) return;
  state.savedEntries = [];
  saveSavedEntries();
  renderPreview();
  showToast("Local entries wiped.");
}

// =========================
// Render preview
// =========================
function renderPreview() {
  if (!els.previewList) return;

  els.previewList.innerHTML = "";

  if (!state.savedEntries.length) {
    const empty = document.createElement("div");
    empty.className = "empty";
    empty.textContent = "No saved entries yet.";
    els.previewList.appendChild(empty);
    return;
  }

  state.savedEntries.forEach((entry, idx) => {
    const card = document.createElement("div");
    card.className = "preview-card";

    // Minimal display. Adjust fields to match your entry schema.
    const title = entry.title || entry.cartName || "Crash Cart Entry";
    const dept = entry.department || entry.dept || "";
    const updated = entry.updatedAt || entry.lastUpdated || "";

    card.innerHTML = `
      <div class="card-title">${escapeHtml(title)}${dept ? ` → ${escapeHtml(dept)}` : ""}</div>
      <div class="card-meta">${updated ? `Last updated: ${escapeHtml(updated)}` : ""}</div>
    `;

    els.previewList.appendChild(card);
  });
}

function escapeHtml(s) {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

// =========================
// Firebase init + auth
// =========================
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);

// Enable offline persistence (nice-to-have; safe if it fails)
enableIndexedDbPersistence(db).catch((err) => {
  console.warn("IndexedDB persistence not enabled:", err?.code || err);
});

// Sign in anonymously (secure + simple)
function ensureAnonAuth() {
  return new Promise((resolve) => {
    onAuthStateChanged(auth, async (user) => {
      if (user) {
        state.user = user;
        state.authReady = true;
        if (els.authStatus) els.authStatus.textContent = "Signed in";
        resolve(true);
        return;
      }

      try {
        await signInAnonymously(auth);
        // onAuthStateChanged will fire again.
      } catch (e) {
        console.error("Anon auth failed:", e.code, e.message, e);
        showToast(`Auth failed: ${e.code || ""} ${e.message || e}`);
        resolve(false);
      }
    });
  });
}

// =========================
// Submit to Firebase
// =========================
async function submitToFirebase() {
  if (state.lock.locked) {
    showToast("Unlock with PIN before submitting.");
    return;
  }

  if (!state.savedEntries.length) {
    showToast("Nothing to submit.");
    return;
  }

  // Ensure signed in (required for secure rules)
  const ok = await ensureAnonAuth();
  if (!ok) return;

  // Build submission doc
  const submissionId = `sub_${Date.now()}`;
  const payload = {
    createdAt: serverTimestamp(),
    createdByUid: auth.currentUser?.uid || null,
    entries: state.savedEntries
  };

  try {
    await setDoc(doc(db, SUBMISSIONS_COLLECTION, submissionId), payload);
    showToast("Submitted to Firebase ✅");

    // OPTIONAL: wipe local after submit (if you want)
    // state.savedEntries = [];
    // saveSavedEntries();
    // renderPreview();

  } catch (e) {
    console.error("Firestore submit error:", e.code, e.message, e);

    // This is the key: show the REAL error code on-screen
    const msg = `Submit failed: ${e.code || ""} ${e.message || e}`;
    showToast(msg);
  }
}

// =========================
// Wire up UI events
// =========================
function bindUI() {
  if (els.btnSubmit) els.btnSubmit.addEventListener("click", submitToFirebase);
  if (els.btnWipeLocal) els.btnWipeLocal.addEventListener("click", wipeLocal);

  if (els.btnLock) els.btnLock.addEventListener("click", toggleLock);
  if (els.btnGeneratePin) els.btnGeneratePin.addEventListener("click", generatePin);
}

// =========================
// Boot
// =========================
function init() {
  loadLock();
  updateLockUI();

  loadSavedEntries();
  renderPreview();

  bindUI();

  // Kick auth early so submit is instant
  ensureAnonAuth();
}

init();
