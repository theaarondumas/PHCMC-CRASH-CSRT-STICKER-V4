/* ============================================================
   app.js — LOCK/PIN DISABLED (always-unlocked)
   - Cart Type → Section → Location
   - Cart # required
   - ✅ completeness indicator (informational only)
   - SAVE -> local batch
   - PREVIEW -> Edit/Delete
   - SUBMIT -> Firestore (one submission doc with entries array)
   ============================================================ */

import { initializeApp } from "https://www.gstatic.com/firebasejs/12.7.0/firebase-app.js";
import {
  getFirestore,
  collection,
  doc,
  setDoc,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.7.0/firebase-firestore.js";
import {
  getAuth,
  signInAnonymously
} from "https://www.gstatic.com/firebasejs/12.7.0/firebase-auth.js";

/* =========================
   Firebase Config
   =========================
   Put your REAL values here.
   If Firebase isn't configured yet, UI still works; submit will warn.
*/
const firebaseConfig = {
  apiKey: "AIzaSyB-3bjNKIf-OOcRu3HtxdsjnMugpD1lhQU",
  authDomain: "phcmc-crash-cart.firebaseapp.com",
  projectId: "phcmc-crash-cart",

let db = null;
let auth = null;
try {
  const fbApp = initializeApp(firebaseConfig);
  db = getFirestore(fbApp);
  auth = getAuth(fbApp);
} catch (e) {
  console.warn("Firebase not configured:", e);
}

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
   Local Storage
   ========================= */
const LOCAL_KEY = "cc_batch_entries_v2";

/* =========================
   DOM helpers
   ========================= */
const $ = (id) => document.getElementById(id);

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
  try {
    return JSON.parse(localStorage.getItem(LOCAL_KEY) || "[]");
  } catch {
    return [];
  }
}

function saveBatch(entries) {
  localStorage.setItem(LOCAL_KEY, JSON.stringify(entries));
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
  $("btnBack").hidden = true;
}
function showPreviewView() {
  $("viewEntry").hidden = true;
  $("viewPreview").hidden = false;
  $("btnBack").hidden = false;
}

/* =========================
   Dept card
   ========================= */
function openDeptCard() { $("deptCard").hidden = false; }
function closeDeptCard() { $("deptCard").hidden = true; }

/* =========================
   Dropdown helpers
   ========================= */
function resetSelect(selectEl, placeholder) {
  selectEl.innerHTML = "";
  const opt = document.createElement("option");
  opt.value = "";
  opt.disabled = true;
  opt.selected = true;
  opt.textContent = placeholder;
  selectEl.appendChild(opt);
}

function fillSelect(selectEl, items) {
  items.forEach(v => {
    const opt = document.createElement("option");
    opt.value = v;
    opt.textContent = v;
    selectEl.appendChild(opt);
  });
}

function onCartTypeChange() {
  const cartType = $("cartTypeSelect").value;
  const sectionSelect = $("sectionSelect");
  const locationSelect = $("locationSelect");

  const sections = Object.keys(CART_TAXONOMY[cartType] || {});
  resetSelect(sectionSelect, "Select section…");
  resetSelect(locationSelect, "Select location…");

  fillSelect(sectionSelect, sections);
  sectionSelect.disabled = sections.length === 0;
  locationSelect.disabled = true;

  updateSelectedMeta();
  updateCompleteIndicator();
}

function onSectionChange() {
  const cartType = $("cartTypeSelect").value;
  const section = $("sectionSelect").value;
  const locationSelect = $("locationSelect");

  const locations = CART_TAXONOMY[cartType]?.[section] || [];
  resetSelect(locationSelect, "Select location…");
  fillSelect(locationSelect, locations);
  locationSelect.disabled = locations.length === 0;

  updateSelectedMeta();
  updateCompleteIndicator();
}

function onLocationChange() {
  updateSelectedMeta();
  updateCompleteIndicator();
}

function updateSelectedMeta() {
  const section = $("sectionSelect")?.value || "";
  const location = $("locationSelect")?.value || "";
  const cartNum = normalizeCartNumber($("cartNumberInput")?.value || "");

  const display = section && location ? `${section} — ${location}` : "—";
  $("selectedKeyMeta").textContent = `Selected: ${display}${cartNum ? ` | Cart ${cartNum}` : ""}`;
}

/* =========================
   Entry draft + completeness ✅
   "complete" = dropdowns + cart# + ALL sticker inputs filled
   ========================= */
function getEntryDraft() {
  const cartType = $("cartTypeSelect")?.value || "";
  const section = $("sectionSelect")?.value || "";
  const location = $("locationSelect")?.value || "";
  const cartNumber = normalizeCartNumber($("cartNumberInput")?.value || "");

  const departmentDisplay = (section && location) ? `${section} — ${location}` : "";

  return {
    cartType,
    section,
    location,
    departmentDisplay,
    cartNumber,

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
  const check = $("headerCheck");
  const hint = $("completeHint");
  if (!check || !hint) return;

  const complete = isComplete(getEntryDraft());
  check.hidden = !complete;
  hint.style.opacity = complete ? "0.55" : "1";
}

/* =========================
   Batch (local) + edit mode
   ========================= */
let batch = loadBatch();
let editingIndex = null;

function updatePreviewCount() {
  $("previewCount").textContent = String(batch.length);
  $("previewMeta").textContent = `${batch.length} saved.`;
}

function validateBeforeSave(e) {
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
    $("cartTypeSelect").value = "";
    resetSelect($("sectionSelect"), "Select section…");
    resetSelect($("locationSelect"), "Select location…");
    $("sectionSelect").disabled = true;
    $("locationSelect").disabled = true;
  }

  editingIndex = null;
  $("savedBadge").hidden = true;
  updateSelectedMeta();
  updateCompleteIndicator();
}

function saveEntry() {
  const entry = getEntryDraft();
  const err = validateBeforeSave(entry);
  if (err) return toast(err);

  const record = { ...entry, createdAtLocal: new Date().toISOString() };

  if (editingIndex !== null) {
    batch[editingIndex] = record;
    editingIndex = null;
    toast("Updated saved item.");
  } else {
    batch.push(record);
    toast("Saved to batch.");
  }

  saveBatch(batch);
  $("savedBadge").hidden = false;
  updatePreviewCount();
  renderPreviewList();
}

/* =========================
   Preview list render/edit/delete
   ========================= */
function renderPreviewList() {
  const list = $("previewList");
  if (!list) return;

  if (batch.length === 0) {
    list.innerHTML = `<div class="meta">No saved entries yet.</div>`;
    return;
  }

  list.innerHTML = batch.map((e, idx) => {
    const head = `${e.departmentDisplay}  |  Cart ${e.cartNumber}`;
    const supply = `Supply: ${e.supplyFirst}  •  Date: ${e.supplyDate}  •  Done: ${e.supplyDone}  •  CS: ${e.supplyTech}`;
    const drug = `Drug: ${e.drugFirstExp} (${e.drugName})  •  Lock: ${e.drugLock}  •  Done: ${e.drugDoneOn}  •  Init: ${e.drugInitials}`;

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
    btn.addEventListener("click", () => editFromPreview(Number(btn.dataset.edit)));
  });
  list.querySelectorAll("[data-del]").forEach(btn => {
    btn.addEventListener("click", () => deleteFromPreview(Number(btn.dataset.del)));
  });
}

function editFromPreview(idx) {
  const e = batch[idx];
  if (!e) return;

  $("cartTypeSelect").value = e.cartType;
  onCartTypeChange();

  $("sectionSelect").value = e.section;
  onSectionChange();

  $("locationSelect").value = e.location;
  onLocationChange();

  $("cartNumberInput").value = (e.cartNumber || "").replace(/^#/, "");

  $("supplyFirst").value = e.supplyFirst || "";
  $("supplyDate").value = e.supplyDate || "";
  $("supplyDone").value = e.supplyDone || "";
  $("supplyTech").value = e.supplyTech || "";

  $("drugFirstExp").value = e.drugFirstExp || "";
  $("drugName").value = e.drugName || "";
  $("drugLock").value = e.drugLock || "";
  $("drugDoneOn").value = e.drugDoneOn || "";
  $("drugInitials").value = e.drugInitials || "";

  editingIndex = idx;
  $("savedBadge").hidden = true;
  updateSelectedMeta();
  updateCompleteIndicator();

  showEntryView();
  toast("Editing saved item. Press SAVE to update.");
}

function deleteFromPreview(idx) {
  batch.splice(idx, 1);
  saveBatch(batch);
  updatePreviewCount();
  renderPreviewList();
  toast("Deleted.");
}

/* =========================
   Submit to Firestore (one doc with entries array)
   ========================= */
function deviceId() {
  let id = localStorage.getItem("cc_device_id_v2");
  if (!id) {
    id = (crypto?.randomUUID?.() || `dev_${Date.now()}_${Math.random()}`).toString();
    localStorage.setItem("cc_device_id_v2", id);
  }
  return id;
}

async function submitToFirebase() {
  if (!db || !auth) return toast("Firebase not configured yet.");

  if (batch.length === 0) return toast("Nothing to submit.");

  for (const e of batch) {
    if (!isComplete(e)) return toast("One or more saved entries is incomplete.");
    if (!e.cartNumber) return toast("One or more entries is missing Cart #.");
  }

  try {
    setSync("Signing in…", true);
    await signInAnonymously(auth);

    setSync("Uploading…", true);

    const submissionsCol = collection(db, "crash_cart_submissions");
    const submissionId = `sub_${new Date().toISOString().replaceAll(":", "-")}_${deviceId()}`;
    const ref = doc(submissionsCol, submissionId);

    await setDoc(ref, {
      deviceId: deviceId(),
      entryCount: batch.length,
      entries: batch,
      createdAt: serverTimestamp()
    });

    batch = [];
    saveBatch(batch);
    updatePreviewCount();
    renderPreviewList();
    setSync("Submitted ✅", true);
    toast("Submitted to Firebase ✅");
  } catch (err) {
    console.error(err);
    setSync("Submit failed", false);
    toast("Submit failed. Check console.");
  }
}

/* =========================
   Wire events
   ========================= */
function wireEvents() {
  // Dept card open/close
  $("deptBtn")?.addEventListener("click", openDeptCard);
  $("closeDeptCard")?.addEventListener("click", closeDeptCard);

  // Dropdowns
  $("cartTypeSelect")?.addEventListener("change", onCartTypeChange);
  $("sectionSelect")?.addEventListener("change", onSectionChange);
  $("locationSelect")?.addEventListener("change", onLocationChange);

  $("cartNumberInput")?.addEventListener("input", () => {
    updateSelectedMeta();
    updateCompleteIndicator();
  });

  // Sticker inputs -> completeness
  [
    "supplyFirst","supplyDate","supplyDone","supplyTech",
    "drugFirstExp","drugName","drugLock","drugDoneOn","drugInitials"
  ].forEach(id => {
    $(id)?.addEventListener("input", updateCompleteIndicator);
    $(id)?.addEventListener("change", updateCompleteIndicator);
  });

  // Save / clear
  $("saveBtn")?.addEventListener("click", saveEntry);
  $("clearBtn")?.addEventListener("click", () => clearFields(true));

  // Nav
  $("previewBtn")?.addEventListener("click", () => {
    showPreviewView();
    renderPreviewList();
  });
  $("entryBtn")?.addEventListener("click", showEntryView);
  $("btnBack")?.addEventListener("click", showEntryView);

  // Submit / wipe
  $("submitBtn")?.addEventListener("click", submitToFirebase);
  $("wipeAllBtn")?.addEventListener("click", () => {
    batch = [];
    saveBatch(batch);
    updatePreviewCount();
    renderPreviewList();
    toast("Local batch wiped.");
  });
}

/* =========================
   Init
   ========================= */
function init() {
  setSync("Ready", true);

  // Prepare selects
  resetSelect($("sectionSelect"), "Select section…");
  resetSelect($("locationSelect"), "Select location…");
  $("sectionSelect").disabled = true;
  $("locationSelect").disabled = true;

  // Load batch
  batch = loadBatch();
  updatePreviewCount();

  // Start in entry view
  showEntryView();

  wireEvents();
  updateSelectedMeta();
  updateCompleteIndicator();
  renderPreviewList();

  // Footer
  if ($("footerStatus")) $("footerStatus").textContent = "Local: ready";
}

init();
