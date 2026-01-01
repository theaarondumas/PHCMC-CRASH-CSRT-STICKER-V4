/* ============================================================
   app.js — matched to your provided index.html (IDs exact)
   Crash Cart Stickers (NO PHI)
   - PIN gate + Lock
   - Department dropdown card (Cart Type + Area)
   - Save -> local entries
   - Preview -> Edit/Delete
   - Submit -> Firestore (Anonymous Auth, runs ONLY on submit)
   ============================================================ */

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

/* =========================
   Firebase Config
   ========================= */
const firebaseConfig = {
  apiKey: "AIzaSyB-3bjNKIf-OOcRu3HtxdsjnMugpD1lhQU",
  authDomain: "phcmc-crash-cart.firebaseapp.com",
  projectId: "phcmc-crash-cart",
  storageBucket: "phcmc-crash-cart.firebasestorage.app",
  messagingSenderId: "478233106614",
  appId: "1:478233106614:web:441f55c8f401bb335aae17",
  measurementId: "G-SQJ14G87G6"
};

const SUBMISSIONS_COLLECTION = "submissions";

/* =========================
   Local Storage Keys
   ========================= */
const LS = {
  PIN_UNLOCKED: "cc_pin_unlocked_v1",
  CURRENT_SEL: "cc_current_selection_v1",
  ENTRIES: "cc_saved_entries_v1"
};

/* =========================
   PIN Gate
   ========================= */
const ACCESS_PIN = "2026"; // <= 8 digits

/* =========================
   Cart Types -> Areas
   ========================= */
const AREAS_BY_CARTTYPE = {
  ADULT_MAIN: ["ED", "ICU", "OR", "PACU", "Med-Surg", "Telemetry"],
  BROSELOW: ["ED Peds", "Peds Unit", "PICU"],
  NEONATAL: ["NICU", "L&D", "Mother/Baby"],
  ADULT_TOWERS: ["3SOUTH", "3NORTH", "4SOUTH", "4NORTH", "5SOUTH", "5NORTH"]
};

/* =========================
   DOM
   ========================= */
const el = {
  pinGate: document.getElementById("pinGate"),
  pinInput: document.getElementById("pinInput"),
  pinUnlockBtn: document.getElementById("pinUnlockBtn"),
  pinError: document.getElementById("pinError"),

  lockBtn: document.getElementById("lockBtn"),
  subtitle: document.getElementById("subtitle"),
  syncDot: document.getElementById("syncDot"),
  syncText: document.getElementById("syncText"),

  toast: document.getElementById("toast"),

  viewEntry: document.getElementById("viewEntry"),
  viewPreview: document.getElementById("viewPreview"),

  deptBtn: document.getElementById("deptBtn"),
  deptCard: document.getElementById("deptCard"),
  cartTypeSelect: document.getElementById("cartTypeSelect"),
  areaSelect: document.getElementById("areaSelect"),
  closeDeptCard: document.getElementById("closeDeptCard"),
  selectedKeyMeta: document.getElementById("selectedKeyMeta"),
  savedBadge: document.getElementById("savedBadge"),

  supplyFirst: document.getElementById("supplyFirst"),
  supplyDate: document.getElementById("supplyDate"),
  supplyDone: document.getElementById("supplyDone"),
  supplyTech: document.getElementById("supplyTech"),

  drugFirstExp: document.getElementById("drugFirstExp"),
  drugName: document.getElementById("drugName"),
  drugLock: document.getElementById("drugLock"),
  drugDoneOn: document.getElementById("drugDoneOn"),
  drugInitials: document.getElementById("drugInitials"),

  headerCheck: document.getElementById("headerCheck"),

  saveBtn: document.getElementById("saveBtn"),
  clearBtn: document.getElementById("clearBtn"),

  previewBtn: document.getElementById("previewBtn"),
  previewCount: document.getElementById("previewCount"),
  entryBtn: document.getElementById("entryBtn"),
  previewMeta: document.getElementById("previewMeta"),
  previewList: document.getElementById("previewList"),
  submitBtn: document.getElementById("submitBtn"),
  wipeAllBtn: document.getElementById("wipeAllBtn"),

  footerStatus: document.getElementById("footerStatus")
};

/* =========================
   State
   ========================= */
const state = {
  unlocked: false,
  selection: { cartType: "", area: "" },
  entries: [],
  editingIndex: null,
  authReady: false,
  user: null
};

/* =========================
   Helpers
   ========================= */
function toast(msg) {
  console.log("[toast]", msg);
  if (!el.toast) return alert(msg);
  el.toast.hidden = false;
  el.toast.textContent = msg;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => (el.toast.hidden = true), 2400);
}

function setSync(text, ok = true) {
  if (!el.syncText || !el.syncDot) return;
  el.syncText.textContent = text;
  el.syncDot.style.opacity = "1";
  el.syncDot.style.filter = ok ? "none" : "grayscale(1)";
}

function loadLS() {
  state.unlocked = localStorage.getItem(LS.PIN_UNLOCKED) === "1";
  try {
    state.selection = JSON.parse(localStorage.getItem(LS.CURRENT_SEL) || "{}") || { cartType: "", area: "" };
  } catch {
    state.selection = { cartType: "", area: "" };
  }
  try {
    state.entries = JSON.parse(localStorage.getItem(LS.ENTRIES) || "[]");
  } catch {
    state.entries = [];
  }
}

function saveLS() {
  localStorage.setItem(LS.PIN_UNLOCKED, state.unlocked ? "1" : "0");
  localStorage.setItem(LS.CURRENT_SEL, JSON.stringify(state.selection));
  localStorage.setItem(LS.ENTRIES, JSON.stringify(state.entries));
}

/* =========================
   PIN Gate
   ========================= */
function showGate() {
  state.unlocked = false;
  saveLS();
  el.pinGate.hidden = false;
  el.pinInput.value = "";
  el.pinError.textContent = "";
  toast("Locked.");
}

function hideGate() {
  el.pinGate.hidden = true;
}

function unlockWithPin() {
  const pin = (el.pinInput.value || "").trim();
  if (!pin) return (el.pinError.textContent = "Enter PIN.");
  if (pin !== ACCESS_PIN) return (el.pinError.textContent = "Wrong PIN.");
  state.unlocked = true;
  saveLS();
  hideGate();
  toast("Unlocked ✅");
}

/* =========================
   Department UI
   ========================= */
function openDeptCard() { el.deptCard.hidden = false; }
function closeDeptCard() { el.deptCard.hidden = true; }

function populateAreasForCartType(cartType) {
  const areas = AREAS_BY_CARTTYPE[cartType] || [];
  el.areaSelect.innerHTML = `<option value="" selected disabled>Select area…</option>`;
  areas.forEach((a) => {
    const opt = document.createElement("option");
    opt.value = a;
    opt.textContent = a;
    el.areaSelect.appendChild(opt);
  });
  el.areaSelect.disabled = areas.length === 0;
}

function setDeptBtnLabel(labelText) {
  // Safely update ONLY the text portion of the button while keeping the badge span
  const textNode = Array.from(el.deptBtn.childNodes).find(n => n.nodeType === Node.TEXT_NODE);
  if (textNode) textNode.textContent = `${labelText} `;
  else el.deptBtn.insertBefore(document.createTextNode(`${labelText} `), el.deptBtn.firstChild);
}

function updateSelectionMeta() {
  const ct = state.selection.cartType || "—";
  const ar = state.selection.area || "—";
  el.selectedKeyMeta.textContent = `Selected: ${ct} → ${ar}`;
  setDeptBtnLabel(state.selection.area ? `${state.selection.area} ▾` : "DEPARTMENT ▾");
}

function selectionKey() {
  const { cartType, area } = state.selection;
  if (!cartType || !area) return "";
  return `${cartType}__${area}`;
}

/* =========================
   Form
   ========================= */
function readForm() {
  return {
    supplyFirst: el.supplyFirst.value.trim(),
    supplyDate: el.supplyDate.value.trim(),
    supplyDone: el.supplyDone.value.trim(),
    supplyTech: el.supplyTech.value.trim(),
    drugFirstExp: el.drugFirstExp.value.trim(),
    drugName: el.drugName.value.trim(),
    drugLock: el.drugLock.value.trim(),
    drugDoneOn: el.drugDoneOn.value.trim(),
    drugInitials: el.drugInitials.value.trim()
  };
}

function writeForm(d = {}) {
  el.supplyFirst.value = d.supplyFirst || "";
  el.supplyDate.value = d.supplyDate || "";
  el.supplyDone.value = d.supplyDone || "";
  el.supplyTech.value = d.supplyTech || "";
  el.drugFirstExp.value = d.drugFirstExp || "";
  el.drugName.value = d.drugName || "";
  el.drugLock.value = d.drugLock || "";
  el.drugDoneOn.value = d.drugDoneOn || "";
  el.drugInitials.value = d.drugInitials || "";
}

function clearForm() {
  writeForm({});
  el.headerCheck.hidden = true;
  el.savedBadge.hidden = true;
  state.editingIndex = null;
  saveLS();
}

function markSavedUI() {
  el.savedBadge.hidden = false;
  el.headerCheck.hidden = false;
  clearTimeout(markSavedUI._t);
  markSavedUI._t = setTimeout(() => (el.savedBadge.hidden = true), 1600);
}

/* =========================
   Entries (local)
   ========================= */
function upsertEntry() {
  const key = selectionKey();
  if (!key) return toast("Select Cart Type + Area first.");

  const entry = {
    key,
    cartType: state.selection.cartType,
    area: state.selection.area,
    lastUpdated: new Date().toLocaleString(),
    form: readForm()
  };

  if (state.editingIndex !== null) {
    state.entries[state.editingIndex] = entry;
    state.editingIndex = null;
  } else {
    const existingIdx = state.entries.findIndex((e) => e.key === key);
    if (existingIdx >= 0) state.entries[existingIdx] = entry;
    else state.entries.push(entry);
  }

  saveLS();
  updatePreviewCount();
  markSavedUI();
  toast("Saved ✅");
}

function updatePreviewCount() {
  el.previewCount.textContent = String(state.entries.length);
  el.previewMeta.textContent = `${state.entries.length} saved.`;
  el.footerStatus.textContent = `Local: ${state.entries.length} saved`;
}

function deleteEntry(idx) {
  if (!confirm("Delete this saved entry?")) return;
  state.entries.splice(idx, 1);
  saveLS();
  updatePreviewCount();
  renderPreviewList();
  toast("Deleted.");
}

function editEntry(idx) {
  const entry = state.entries[idx];
  if (!entry) return;

  state.selection.cartType = entry.cartType;
  state.selection.area = entry.area;
  saveLS();

  el.cartTypeSelect.value = entry.cartType;
  populateAreasForCartType(entry.cartType);
  el.areaSelect.disabled = false;
  el.areaSelect.value = entry.area;

  updateSelectionMeta();
  writeForm(entry.form);

  state.editingIndex = idx;
  goEntry();
  toast("Editing entry…");
}

/* =========================
   Preview
   ========================= */
function escapeHtml(s) {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function renderPreviewList() {
  el.previewList.innerHTML = "";
  if (!state.entries.length) {
    el.previewList.innerHTML = `<div class="meta">No saved entries yet.</div>`;
    return;
  }

  state.entries.forEach((e, idx) => {
    const card = document.createElement("div");
    card.className = "previewCard";
    card.style.border = "1px solid rgba(255,255,255,0.08)";
    card.style.borderRadius = "14px";
    card.style.padding = "14px";
    card.style.marginBottom = "12px";

    card.innerHTML = `
      <div style="font-weight:700; font-size:16px; margin-bottom:6px;">
        ${escapeHtml(e.cartType)} → ${escapeHtml(e.area)}
      </div>
      <div style="opacity:0.8; font-size:13px; margin-bottom:10px;">
        Last updated: ${escapeHtml(e.lastUpdated)}
      </div>
      <div style="display:flex; gap:10px;">
        <button class="btn btn--ghost" data-action="edit" data-idx="${idx}">Edit</button>
        <button class="btn btn--ghost" data-action="delete" data-idx="${idx}">Delete</button>
      </div>
    `;
    el.previewList.appendChild(card);
  });
}

/* =========================
   Views
   ========================= */
function goEntry() {
  el.viewEntry.hidden = false;
  el.viewPreview.hidden = true;
  el.subtitle.textContent = "Sticker entry → Preview → Submit";
}
function goPreview() {
  el.viewEntry.hidden = true;
  el.viewPreview.hidden = false;
  el.subtitle.textContent = "Review everything before submitting";
  renderPreviewList();
  updatePreviewCount();
}

/* =========================
   Firebase
   ========================= */
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);

enableIndexedDbPersistence(db).catch(() => {});

function ensureAnonAuthOnce() {
  // Do not spam signIn attempts; run once on submit
  return new Promise((resolve) => {
    const unsub = onAuthStateChanged(auth, async (user) => {
      if (user) {
        state.user = user;
        state.authReady = true;
        unsub?.();
        return resolve(true);
      }
      try {
        await signInAnonymously(auth);
        // auth state listener will fire again with user
      } catch (e) {
        console.error("Anon auth failed:", e);
        return resolve({ ok: false, err: e });
      }
    });
  });
}

async function submitToFirebase() {
  if (!state.unlocked) return toast("Locked. Enter PIN first.");
  if (!state.entries.length) return toast("Nothing to submit.");

  setSync("Signing in…", true);
  const res = await ensureAnonAuthOnce();
  if (res !== true) {
    const e = res?.err;
    setSync("Auth blocked", false);
    toast(`Auth blocked: ${e?.code || ""}`.trim());

    // This specific error means signups are blocked in the project
    if (e?.code?.includes("signup-are-blocked")) {
      toast("Fix: enable User sign-up in Google Cloud Identity Platform OR disable signup blocking.");
    }
    return;
  }

  setSync("Submitting…", true);

  const submissionId = `sub_${Date.now()}`;
  const payload = {
    createdAt: serverTimestamp(),
    createdByUid: auth.currentUser?.uid || null,
    entries: state.entries
  };

  try {
    await setDoc(doc(db, SUBMISSIONS_COLLECTION, submissionId), payload);
    setSync("Submitted ✅", true);
    toast("Submitted to Firebase ✅");
  } catch (e) {
    console.error("Firestore submit error:", e);
    setSync("Submit failed", false);
    toast(`Submit failed: ${e.code || ""}`.trim());
  }
}

/* =========================
   Wipe local
   ========================= */
function wipeAllLocal() {
  if (!confirm("Wipe ALL saved (local) entries?")) return;
  state.entries = [];
  state.editingIndex = null;
  saveLS();
  updatePreviewCount();
  renderPreviewList();
  toast("Wiped local saved entries.");
}

/* =========================
   Events
   ========================= */
function bind() {
  el.pinUnlockBtn.addEventListener("click", unlockWithPin);
  el.pinInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") unlockWithPin();
  });

  el.lockBtn.addEventListener("click", showGate);

  el.deptBtn.addEventListener("click", () => {
    if (!state.unlocked) return toast("Enter PIN first.");
    openDeptCard();
  });

  el.closeDeptCard.addEventListener("click", closeDeptCard);

  el.cartTypeSelect.addEventListener("change", () => {
    state.selection.cartType = el.cartTypeSelect.value;
    state.selection.area = "";
    saveLS();

    populateAreasForCartType(state.selection.cartType);
    el.areaSelect.disabled = false;
    el.areaSelect.value = "";
    updateSelectionMeta();
  });

  el.areaSelect.addEventListener("change", () => {
    state.selection.area = el.areaSelect.value;
    saveLS();
    updateSelectionMeta();
    closeDeptCard();
    toast(`Selected: ${state.selection.area}`);
  });

  el.saveBtn.addEventListener("click", () => {
    if (!state.unlocked) return toast("Enter PIN first.");
    upsertEntry();
  });

  el.clearBtn.addEventListener("click", () => {
    clearForm();
    toast("Cleared.");
  });

  el.previewBtn.addEventListener("click", () => {
    if (!state.unlocked) return toast("Enter PIN first.");
    goPreview();
  });

  el.entryBtn.addEventListener("click", goEntry);

  el.submitBtn.addEventListener("click", submitToFirebase);
  el.wipeAllBtn.addEventListener("click", wipeAllLocal);

  el.previewList.addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-action]");
    if (!btn) return;
    const idx = Number(btn.dataset.idx);
    if (!Number.isFinite(idx)) return;
    if (btn.dataset.action === "delete") deleteEntry(idx);
    if (btn.dataset.action === "edit") editEntry(idx);
  });
}

/* =========================
   Boot
   ========================= */
function init() {
  loadLS();

  if (state.unlocked) {
    hideGate();
  } else {
    el.pinGate.hidden = false;
  }

  if (state.selection.cartType) {
    el.cartTypeSelect.value = state.selection.cartType;
    populateAreasForCartType(state.selection.cartType);
    el.areaSelect.disabled = false;
    if (state.selection.area) el.areaSelect.value = state.selection.area;
  } else {
    populateAreasForCartType("");
    el.areaSelect.disabled = true;
  }

  updateSelectionMeta();
  updatePreviewCount();
  setSync("Ready", true);

  bind();
  goEntry();
}

init();
