import { initializeApp } from "https://www.gstatic.com/firebasejs/12.7.0/firebase-app.js";
import {
  getFirestore,
  collection,
  addDoc,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.7.0/firebase-firestore.js";
import {
  getAuth,
  signInAnonymously
} from "https://www.gstatic.com/firebasejs/12.7.0/firebase-auth.js";

/* ============================================================
   app.js — BULLETPROOF UI (CLEAN)
   - Department card always opens
   - 3-level dropdowns + Cart# required
   - ✅ appears when ALL fields complete
   - Save -> local batch
   - Preview -> Edit/Delete
   - Submit -> Firebase (uses existing db/auth, addDoc)
   ============================================================ */

const $ = (id) => document.getElementById(id);
const LOCAL_KEY = "cc_batch_entries_v3";

/* =========================
   Taxonomy (3-level)
   ========================= */
const CART_TAXONOMY = {
  ADULT_MAIN: {
    "ER": ["ER Area", "ER Triage", "ER Room 2", "ER Main", "EDX1", "EDX2"],
    "Imaging": ["X-Ray Dept", "X-Ray", "CT1", "CT2 / MRI", "CT Trailer", "X-Ray Trailer"],
    "Procedural": ["Cardiology", "Cath Lab"],
    "Specials": ["Specials Room 5", "Specials Room 6"],
    "Surgery": ["OR", "Recovery"],
    "Mother/Baby": ["L/D Triage", "L/D Nurse Station", "Maternity"],
    "Buildings/Support": ["North Building", "Physical Therapy", "Basement", "GI Lab"],
    "Central": ["Central Backup Carts"],
    "Clinic/Other": ["Urology"]
  },
  ADULT_TOWERS: {
    "4th Floor Tower": ["4 South", "4 East", "Extra Cart"],
    "3rd Floor Tower": ["3 South", "3 East", "Extra Cart"],
    "2nd Floor Tower": ["2 South", "2 East", "Extra Cart"],
    "2nd Floor North": ["2A", "2B", "2C", "2D", "Extra Cart"],
    "3rd Floor North": ["3A", "3B", "3C", "3D", "Extra Cart"],
    "ICU Pavilion (1st Floor)": ["Pav A", "Pav B", "Pav C"]
  },
  NEONATAL: {
    "Labor & Delivery": ["OR Hallway", "L/D Hallway"],
    "Mother/Baby": ["NICU", "Nursery", "Maternity", "Pav C NICU"],
    "2nd Floor": ["2A Overflow"],
    "Central": ["Central Backup Carts"]
  },
  BROSELOW: {
    "2nd Floor": ["2C"],
    "ER": ["ER", "EDX1", "EDX2", "ER Main"],
    "Surgery": ["Recovery"],
    "North Building": ["Physical Therapy"],
    "Central": ["Central Backup Carts"]
  }
};

/* =========================
   Firebase Config (YOUR REAL ONE)
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

/* =========================
   Firebase init (single init)
   ========================= */
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);

// Top-level await is OK because index.html loads app.js as type="module"
await signInAnonymously(auth);

console.log("Firebase initialized:", app?.options?.projectId);
console.log("Signed in UID:", auth.currentUser?.uid);

/* =========================
   UI helpers
   ========================= */
function toast(msg, ms = 1800) {
  const el = $("toast");
  if (!el) return alert(msg);
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => (el.hidden = true), ms);
}

function setSync(text, ok = true) {
  if ($("syncText")) $("syncText").textContent = text;
  if ($("syncDot")) $("syncDot").style.opacity = ok ? "1" : "0.6";
}

function loadBatch() {
  try { return JSON.parse(localStorage.getItem(LOCAL_KEY) || "[]"); }
  catch { return []; }
}

function saveBatch(entries) {
  localStorage.setItem(LOCAL_KEY, JSON.stringify(entries));
}

function resetSelect(selectEl, placeholder) {
  if (!selectEl) return;
  selectEl.innerHTML = "";
  const opt = document.createElement("option");
  opt.value = "";
  opt.disabled = true;
  opt.selected = true;
  opt.textContent = placeholder;
  selectEl.appendChild(opt);
}

function fillSelect(selectEl, items) {
  if (!selectEl) return;
  items.forEach(v => {
    const opt = document.createElement("option");
    opt.value = v;
    opt.textContent = v;
    selectEl.appendChild(opt);
  });
}

function normalizeCartNumber(raw) {
  const v = String(raw || "").trim().replace(/^#/, "");
  if (!v) return "";
  if (!/^\d+$/.test(v)) return "";
  return `#${Number(v)}`;
}

function escapeHtml(s) {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

/* =========================
   Views
   ========================= */
function showEntryView() {
  $("viewEntry").hidden = false;
  $("viewPreview").hidden = true;
  if ($("btnBack")) $("btnBack").hidden = true;
}

function showPreviewView() {
  $("viewEntry").hidden = true;
  $("viewPreview").hidden = false;
  if ($("btnBack")) $("btnBack").hidden = false;
}

/* =========================
   Dropdown logic
   ========================= */
function onCartTypeChange() {
  const cartType = $("cartTypeSelect")?.value || "";
  const sections = Object.keys(CART_TAXONOMY[cartType] || {});
  resetSelect($("sectionSelect"), "Select section…");
  resetSelect($("locationSelect"), "Select location…");
  fillSelect($("sectionSelect"), sections);

  if ($("sectionSelect")) $("sectionSelect").disabled = sections.length === 0;
  if ($("locationSelect")) $("locationSelect").disabled = true;

  updateSelectedMeta();
  updateCompleteIndicator();
}

function onSectionChange() {
  const cartType = $("cartTypeSelect")?.value || "";
  const section = $("sectionSelect")?.value || "";
  const locations = CART_TAXONOMY[cartType]?.[section] || [];

  resetSelect($("locationSelect"), "Select location…");
  fillSelect($("locationSelect"), locations);
  if ($("locationSelect")) $("locationSelect").disabled = locations.length === 0;

  updateSelectedMeta();
  updateCompleteIndicator();
}

function updateSelectedMeta() {
  const section = $("sectionSelect")?.value || "";
  const location = $("locationSelect")?.value || "";
  const cartNum = normalizeCartNumber($("cartNumberInput")?.value || "");
  const display = section && location ? `${section} — ${location}` : "—";
  if ($("selectedKeyMeta")) {
    $("selectedKeyMeta").textContent = `Selected: ${display}${cartNum ? ` | Cart ${cartNum}` : ""}`;
  }
}

/* =========================
   Draft + completeness ✅
   ========================= */
function getDraft() {
  const cartType = $("cartTypeSelect")?.value || "";
  const section = $("sectionSelect")?.value || "";
  const location = $("locationSelect")?.value || "";
  const cartNumber = normalizeCartNumber($("cartNumberInput")?.value || "");
  const departmentDisplay = (section && location) ? `${section} — ${location}` : "";

  return {
    cartType, section, location, cartNumber, departmentDisplay,
    supplyFirst: $("supplyFirst")?.value || "",
    supplyDate: $("supplyDate")?.value || "",
    supplyDone: $("supplyDone")?.value || "",
    supplyTech: $("supplyTech")?.value || "",
    drugFirstExp: $("drugFirstExp")?.value || "",
    drugName: $("drugName")?.value || "",
    drugLock: $("drugLock")?.value || "",
    drugDoneOn: $("drugDoneOn")?.value || "",
    drugInitials: $("drugInitials")?.value || ""
  };
}

function isComplete(e) {
  if (!e.cartType || !e.section || !e.location) return false;
  if (!e.cartNumber) return false;

  const req = [
    "supplyFirst","supplyDate","supplyDone","supplyTech",
    "drugFirstExp","drugName","drugLock","drugDoneOn","drugInitials"
  ];
  return req.every(k => String(e[k] || "").trim().length > 0);
}

function updateCompleteIndicator() {
  const check = $("headerCheck");     // ✅ icon on sticker header
  const hint  = $("completeHint");    // "Complete entry to continue"
  if (!check) return;

  const complete = isComplete(getDraft());
  check.hidden = !complete;

  if (hint) hint.style.opacity = complete ? "0.55" : "1";
}

/* =========================
   Batch / Preview
   ========================= */
let batch = loadBatch();
let editingIndex = null;

function updateCounts() {
  if ($("previewCount")) $("previewCount").textContent = String(batch.length);
  if ($("previewMeta")) $("previewMeta").textContent = `${batch.length} saved.`;
}

function validateForSave(e) {
  if (!e.cartType) return "Select Cart Type.";
  if (!e.section) return "Select Section.";
  if (!e.location) return "Select Location.";
  if (!e.cartNumber) return "Enter a valid Cart # (numbers only).";
  if (!isComplete(e)) return "Complete entry to continue.";
  return "";
}

function clearFields(keepDept = true) {
  [
    "supplyFirst","supplyDate","supplyDone","supplyTech",
    "drugFirstExp","drugName","drugLock","drugDoneOn","drugInitials"
  ].forEach(id => { if ($(id)) $(id).value = ""; });

  if ($("cartNumberInput")) $("cartNumberInput").value = "";

  if (!keepDept) {
    if ($("cartTypeSelect")) $("cartTypeSelect").value = "";
    resetSelect($("sectionSelect"), "Select section…");
    resetSelect($("locationSelect"), "Select location…");
    if ($("sectionSelect")) $("sectionSelect").disabled = true;
    if ($("locationSelect")) $("locationSelect").disabled = true;
  }

  editingIndex = null;
  if ($("savedBadge")) $("savedBadge").hidden = true;

  updateSelectedMeta();
  updateCompleteIndicator();
}

function saveEntry() {
  const e = getDraft();
  const err = validateForSave(e);
  if (err) return toast(err);

  const record = { ...e, createdAtLocal: new Date().toISOString() };

  if (editingIndex !== null) {
    batch[editingIndex] = record;
    editingIndex = null;
    toast("Updated saved item.");
  } else {
    batch.push(record);
    toast("Saved to batch.");
  }

  saveBatch(batch);
  if ($("savedBadge")) $("savedBadge").hidden = false;

  updateCounts();
  renderPreview();
}

function renderPreview() {
  const list = $("previewList");
  if (!list) return;

  if (batch.length === 0) {
    list.innerHTML = `<div class="meta">No saved entries yet.</div>`;
    return;
  }

  list.innerHTML = batch.map((e, idx) => {
    const head = `${e.departmentDisplay} | Cart ${e.cartNumber}`;
    const supply = `Supply: ${e.supplyFirst} • Date: ${e.supplyDate} • Done: ${e.supplyDone} • CS: ${e.supplyTech}`;
    const drug = `Drug: ${e.drugFirstExp} (${e.drugName}) • Lock: ${e.drugLock} • Done: ${e.drugDoneOn} • Init: ${e.drugInitials}`;

    return `
      <div class="card" style="margin-top:12px;">
        <div class="meta" style="font-weight:700;">${escapeHtml(head)}</div>
        <div class="meta">${escapeHtml(supply)}</div>
        <div class="meta">${escapeHtml(drug)}</div>
        <div class="actions" style="margin-top:10px;">
          <button class="btn btn--ghost" type="button" data-edit="${idx}">Edit</button>
          <button class="btn btn--ghost" type="button" data-del="${idx}">Delete</button>
        </div>
      </div>
    `;
  }).join("");

  list.querySelectorAll("[data-edit]").forEach(btn => {
    btn.addEventListener("click", () => editEntry(Number(btn.dataset.edit)));
  });

  list.querySelectorAll("[data-del]").forEach(btn => {
    btn.addEventListener("click", () => deleteEntry(Number(btn.dataset.del)));
  });
}

function editEntry(idx) {
  const e = batch[idx];
  if (!e) return;

  if ($("cartTypeSelect")) $("cartTypeSelect").value = e.cartType;
  onCartTypeChange();

  if ($("sectionSelect")) $("sectionSelect").value = e.section;
  onSectionChange();

  if ($("locationSelect")) $("locationSelect").value = e.location;

  if ($("cartNumberInput")) $("cartNumberInput").value = (e.cartNumber || "").replace(/^#/, "");

  if ($("supplyFirst")) $("supplyFirst").value = e.supplyFirst || "";
  if ($("supplyDate")) $("supplyDate").value = e.supplyDate || "";
  if ($("supplyDone")) $("supplyDone").value = e.supplyDone || "";
  if ($("supplyTech")) $("supplyTech").value = e.supplyTech || "";

  if ($("drugFirstExp")) $("drugFirstExp").value = e.drugFirstExp || "";
  if ($("drugName")) $("drugName").value = e.drugName || "";
  if ($("drugLock")) $("drugLock").value = e.drugLock || "";
  if ($("drugDoneOn")) $("drugDoneOn").value = e.drugDoneOn || "";
  if ($("drugInitials")) $("drugInitials").value = e.drugInitials || "";

  editingIndex = idx;
  if ($("savedBadge")) $("savedBadge").hidden = true;

  // open dept card for visibility
  if ($("deptCard")) $("deptCard").hidden = false;

  updateSelectedMeta();
  updateCompleteIndicator();
  showEntryView();
  toast("Editing saved item. Press SAVE to update.");
}

function deleteEntry(idx) {
  batch.splice(idx, 1);
  saveBatch(batch);
  updateCounts();
  renderPreview();
  toast("Deleted.");
}

/* =========================
   Firebase — submit (FIXED)
   - Uses existing db/auth
   - addDoc => easiest rules (create)
   ========================= */
function deviceId() {
  let id = localStorage.getItem("cc_device_id_v3");
  if (!id) {
    id = (crypto?.randomUUID?.() || `dev_${Date.now()}_${Math.random()}`).toString();
    localStorage.setItem("cc_device_id_v3", id);
  }
  return id;
}

async function submitToFirebase() {
  if (batch.length === 0) return toast("Nothing to submit.");

  for (const e of batch) {
    if (!isComplete(e)) return toast("One or more saved entries is incomplete.");
  }

  try {
    setSync("Checking auth…", true);

    // Safari refresh sometimes drops session
    if (!auth.currentUser) {
      await signInAnonymously(auth);
      console.log("Re-signed in UID:", auth.currentUser?.uid);
    }

    setSync("Uploading…", true);

    const payload = {
      deviceId: deviceId(),
      uid: auth.currentUser?.uid || null,
      entryCount: batch.length,
      entries: batch,
      createdAt: serverTimestamp(),
      source: "Crash Cart Stickers"
    };

    // ✅ addDoc writes a new doc to the collection
    const docRef = await addDoc(
      collection(db, "crash_cart_submissions"),
      payload
    );

    console.log("✅ Submit success. Doc ID:", docRef.id);

    // Clear local batch AFTER upload
    batch = [];
    saveBatch(batch);
    updateCounts();
    renderPreview();

    setSync("Submitted ✅", true);
    toast("Submitted to Firebase ✅");
  } catch (err) {
    console.error("🔥 FIREBASE SUBMIT ERROR:", err);
    console.error("code:", err?.code, "message:", err?.message);

    setSync("Submit failed", false);

    if (err?.code === "permission-denied") {
      toast("Submit failed: permissions (rules/collection name).");
    } else if (String(err?.message || "").toLowerCase().includes("failed to fetch")) {
      toast("Submit failed: network / blocked request.");
    } else {
      toast("Submit failed. Check console.");
    }
  }
}

/* =========================
   Wire events
   ========================= */
function wire() {
  // Department open/close (always works)
  $("deptBtn")?.addEventListener("click", () => { $("deptCard").hidden = false; });
  $("closeDeptCard")?.addEventListener("click", () => { $("deptCard").hidden = true; });

  $("cartTypeSelect")?.addEventListener("change", onCartTypeChange);
  $("sectionSelect")?.addEventListener("change", onSectionChange);
  $("locationSelect")?.addEventListener("change", () => { updateSelectedMeta(); updateCompleteIndicator(); });

  $("cartNumberInput")?.addEventListener("input", () => { updateSelectedMeta(); updateCompleteIndicator(); });

  [
    "supplyFirst","supplyDate","supplyDone","supplyTech",
    "drugFirstExp","drugName","drugLock","drugDoneOn","drugInitials"
  ].forEach(id => {
    $(id)?.addEventListener("input", updateCompleteIndicator);
    $(id)?.addEventListener("change", updateCompleteIndicator);
  });

  $("saveBtn")?.addEventListener("click", saveEntry);
  $("clearBtn")?.addEventListener("click", () => clearFields(true));

  $("previewBtn")?.addEventListener("click", () => { showPreviewView(); renderPreview(); });
  $("entryBtn")?.addEventListener("click", showEntryView);
  $("btnBack")?.addEventListener("click", showEntryView);

  $("wipeAllBtn")?.addEventListener("click", () => {
    batch = [];
    saveBatch(batch);
    updateCounts();
    renderPreview();
    toast("Local batch wiped.");
  });

  $("submitBtn")?.addEventListener("click", submitToFirebase);
}

/* =========================
   Init
   ========================= */
function init() {
  setSync("Ready", true);

  // prepare selects
  resetSelect($("sectionSelect"), "Select section…");
  resetSelect($("locationSelect"), "Select location…");
  if ($("sectionSelect")) $("sectionSelect").disabled = true;
  if ($("locationSelect")) $("locationSelect").disabled = true;

  batch = loadBatch();
  updateCounts();
  renderPreview();
  showEntryView();

  updateSelectedMeta();
  updateCompleteIndicator();
  wire();

  if ($("footerStatus")) $("footerStatus").textContent = "Local: ready";
}

init();
