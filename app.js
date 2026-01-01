/* ============================================================
   app.js — Crash Cart Stickers (NO PHI)
   Secure submit: Anonymous Auth + Firestore
   Robust UI bindings: works even if IDs/classes differ
   Fixes Department button (delegated)
   Includes Lock + PIN, Local Saved Entries, Submit to Firebase
   ============================================================ */

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
// CONFIG — PASTE YOUR REAL VALUES
// =========================
const firebaseConfig = {
  apiKey: "PASTE_API_KEY",
  authDomain: "phcmc-crash-cart.firebaseapp.com",
  projectId: "phcmc-crash-cart",
  storageBucket: "phcmc-crash-cart.appspot.com",
  messagingSenderId: "478233106614",
  appId: "PASTE_APP_ID"
};

// If your submit writes to a different collection, change this.
const SUBMISSIONS_COLLECTION = "submissions";

// =========================
// Local storage keys
// =========================
const LOCAL_SAVED_KEY = "cc_saved_entries_v2";
const LOCAL_LOCK_KEY = "cc_lock_v2";                 // { locked, pinHash }
const LOCAL_DEPT_KEY = "cc_current_department_v2";   // string

// =========================
// Helpers
// =========================
const qs = (sel) => document.querySelector(sel);
const qsa = (sel) => Array.from(document.querySelectorAll(sel));

function firstEl(selectors) {
  for (const s of selectors) {
    const el = qs(s);
    if (el) return el;
  }
  return null;
}

function showToast(message) {
  console.log("[toast]", message);

  // Try common toast containers
  const toast =
    firstEl([
      "#toast",
      "#toastMessage",
      ".toast",
      "[data-role='toast']"
    ]);

  if (toast) {
    toast.textContent = message;
    toast.style.opacity = "1";
    toast.style.transform = "translateY(0)";
    clearTimeout(showToast._t);
    showToast._t = setTimeout(() => {
      toast.style.opacity = "0";
      toast.style.transform = "translateY(8px)";
    }, 2800);
    return;
  }

  // Fallback
  alert(message);
}

function hardReloadHint(tag = "v") {
  // Cache bust helper for iOS Safari
  const url = new URL(window.location.href);
  url.searchParams.set(tag, String(Date.now()));
  window.location.href = url.toString();
}

// =========================
// App state
// =========================
const state = {
  authReady: false,
  user: null,

  currentDepartment: "",

  savedEntries: [],

  lock: {
    locked: false,
    pinHash: null
  }
};

// =========================
// DOM mapping (robust)
// =========================
const els = {
  // Preview container(s)
  previewList: firstEl(["#previewList", "#previewCards", "#previewContainer", "[data-role='preview-list']"]),
  // Buttons
  btnSubmit: firstEl(["#btnSubmitFirebase", "#submitToFirebaseBtn", "[data-action='submit-firebase']"]),
  btnWipeLocal: firstEl(["#btnWipeLocal", "#wipeLocalBtn", "[data-action='wipe-local']"]),
  btnLock: firstEl(["#btnLock", ".lock-btn", "[data-action='lock']"]),
  btnGeneratePin: firstEl(["#btnGeneratePin", "[data-action='generate-pin']"]),
  // Department button/select
  deptBtn: firstEl(["#deptBtn", "#departmentBtn", ".dept-btn", "[data-action='department']"]),
  deptSelect: firstEl(["#deptSelect", "#departmentSelect", "select[name='department']", "[data-role='department-select']"])
};

// =========================
// Lock + PIN
// =========================
async function sha256(text) {
  const enc = new TextEncoder().encode(text);
  const buf = await crypto.subtle.digest("SHA-256", enc);
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
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
  const b = firstEl(["#btnLock", ".lock-btn", "[data-action='lock']"]);
  if (!b) return;

  // Keep your UI label if you already have icons; this is safe fallback.
  b.textContent = state.lock.locked ? "Locked" : "Lock";
}

async function generatePin() {
  const pin = String(Math.floor(100000 + Math.random() * 900000)); // 6 digits
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
    showToast("No PIN set. Generate a PIN first.");
    return;
  }
  if (state.lock.locked) return promptUnlock();
  state.lock.locked = true;
  saveLock();
  showToast("Locked.");
}

// =========================
// Department selection (FIXED)
// Works even if your department button is injected later.
// =========================
function setDepartment(dept) {
  const clean = (dept || "").trim();
  state.currentDepartment = clean;
  localStorage.setItem(LOCAL_DEPT_KEY, clean);

  // Update dept button label if present
  const b = firstEl(["#deptBtn", "#departmentBtn", ".dept-btn", "[data-action='department']"]);
  if (b) b.textContent = clean ? clean : "Department";

  // If you show dept somewhere else, it can be updated here too.
}

function loadDepartment() {
  try {
    const saved = localStorage.getItem(LOCAL_DEPT_KEY) || "";
    state.currentDepartment = saved;
    if (saved) setDepartment(saved);
  } catch {}
}

function bindDepartmentUI() {
  // If you have a <select>, bind it
  const sel = firstEl(["#deptSelect", "#departmentSelect", "select[name='department']", "[data-role='department-select']"]);
  if (sel) {
    sel.addEventListener("change", (e) => setDepartment(e.target.value));
  }

  // Delegated click (covers button injected later)
  document.addEventListener("click", (e) => {
    const target = e.target.closest("#deptBtn, #departmentBtn, .dept-btn, [data-action='department']");
    if (!target) return;

    e.preventDefault();
    const current = state.currentDepartment || localStorage.getItem(LOCAL_DEPT_KEY) || "";
    const dept = prompt("Enter department (ex: 3SOUTH, ED, ICU):", current);
    if (dept === null) return;
    setDepartment(dept);
  });
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
// Preview render + Edit/Delete hooks
// (If your UI already handles cards, this won’t fight it—
// it only renders into the preview container if found.)
// =========================
function escapeHtml(s) {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function renderPreview() {
  const container = firstEl(["#previewList", "#previewCards", "#previewContainer", "[data-role='preview-list']"]);
  if (!container) return;

  container.innerHTML = "";

  if (!state.savedEntries.length) {
    const empty = document.createElement("div");
    empty.className = "empty";
    empty.textContent = "No saved entries yet.";
    container.appendChild(empty);
    return;
  }

  state.savedEntries.forEach((entry, idx) => {
    const title = entry.title || entry.cartName || entry.name || "Crash Cart Entry";
    const dept = entry.department || entry.dept || state.currentDepartment || "";
    const updated = entry.updatedAt || entry.lastUpdated || entry.updated || "";

    const card = document.createElement("div");
    card.className = "preview-card";
    card.innerHTML = `
      <div class="card-title">${escapeHtml(title)}${dept ? ` → ${escapeHtml(dept)}` : ""}</div>
      <div class="card-meta">${updated ? `Last updated: ${escapeHtml(updated)}` : ""}</div>
      <div class="card-actions">
        <button class="btn-edit" data-action="edit-entry" data-index="${idx}">Edit</button>
        <button class="btn-delete" data-action="delete-entry" data-index="${idx}">Delete</button>
      </div>
    `;
    container.appendChild(card);
  });
}

// Edit/Delete delegated (won’t break if your buttons differ)
function bindEntryCardActions() {
  document.addEventListener("click", (e) => {
    const del = e.target.closest("[data-action='delete-entry']");
    if (del) {
      const idx = Number(del.dataset.index);
      if (Number.isFinite(idx) && state.savedEntries[idx]) {
        if (!confirm("Delete this saved entry?")) return;
        state.savedEntries.splice(idx, 1);
        saveSavedEntries();
        renderPreview();
        showToast("Deleted.");
      }
      return;
    }

    const edit = e.target.closest("[data-action='edit-entry']");
    if (edit) {
      const idx = Number(edit.dataset.index);
      if (!Number.isFinite(idx) || !state.savedEntries[idx]) return;

      // Minimal edit: change title + department quickly
      const entry = state.savedEntries[idx];
      const newTitle = prompt("Edit title:", entry.title || entry.cartName || entry.name || "");
      if (newTitle === null) return;

      entry.title = newTitle.trim() || entry.title || "Crash Cart Entry";

      const newDept = prompt("Edit department:", entry.department || entry.dept || state.currentDepartment || "");
      if (newDept !== null) entry.department = newDept.trim();

      entry.updatedAt = new Date().toLocaleString();
      state.savedEntries[idx] = entry;

      saveSavedEntries();
      renderPreview();
      showToast("Updated.");
    }
  });
}

// =========================
// Firebase init + auth
// =========================
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);

enableIndexedDbPersistence(db).catch((err) => {
  console.warn("IndexedDB persistence not enabled:", err?.code || err);
});

function ensureAnonAuth() {
  return new Promise((resolve) => {
    const unsub = onAuthStateChanged(auth, async (user) => {
      if (user) {
        state.user = user;
        state.authReady = true;
        unsub?.();
        resolve(true);
        return;
      }
      try {
        await signInAnonymously(auth);
        // onAuthStateChanged will fire again
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

  const ok = await ensureAnonAuth();
  if (!ok) return;

  // Make sure each entry has department
  const entries = state.savedEntries.map((e) => ({
    ...e,
    department: e.department || e.dept || state.currentDepartment || ""
  }));

  const submissionId = `sub_${Date.now()}`;

  const payload = {
    createdAt: serverTimestamp(),
    createdByUid: auth.currentUser?.uid || null,
    department: state.currentDepartment || null,
    entries
  };

  try {
    await setDoc(doc(db, SUBMISSIONS_COLLECTION, submissionId), payload);
    showToast("Submitted to Firebase ✅");

    // Optional: clear local after submit
    // state.savedEntries = [];
    // saveSavedEntries();
    // renderPreview();

  } catch (e) {
    console.error("Firestore submit error:", e.code, e.message, e);
    showToast(`Submit failed: ${e.code || ""} ${e.message || e}`);
  }
}

// =========================
// Bind UI events (robust)
// =========================
function bindUI() {
  // Buttons may not exist at initial load; use delegated for safety
  document.addEventListener("click", (e) => {
    const submit = e.target.closest("#btnSubmitFirebase, #submitToFirebaseBtn, [data-action='submit-firebase']");
    if (submit) {
      e.preventDefault();
      submitToFirebase();
      return;
    }

    const wipe = e.target.closest("#btnWipeLocal, #wipeLocalBtn, [data-action='wipe-local']");
    if (wipe) {
      e.preventDefault();
      wipeLocal();
      return;
    }

    const lock = e.target.closest("#btnLock, .lock-btn, [data-action='lock']");
    if (lock) {
      e.preventDefault();
      toggleLock();
      return;
    }

    const gen = e.target.closest("#btnGeneratePin, [data-action='generate-pin']");
    if (gen) {
      e.preventDefault();
      generatePin();
    }
  });

  bindDepartmentUI();
  bindEntryCardActions();
}

// =========================
// Boot
// =========================
function init() {
  loadLock();
  updateLockUI();

  loadDepartment();
  setDepartment(state.currentDepartment || "");

  loadSavedEntries();
  renderPreview();

  bindUI();

  // Kick auth early so submit is instant
  ensureAnonAuth();
}

init();
