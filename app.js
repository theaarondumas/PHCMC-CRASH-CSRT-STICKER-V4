/* ============================================================
   app.js — Crash Cart Stickers (3-level + Cart# + Batch Preview)
   - PIN gate + Lock button
   - Cart Type → Section → Location dropdowns
   - Cart # required
   - Green ✅ appears when entry is complete (informational)
   - Save → local batch
   - Preview → Edit/Delete
   - Submit → Firestore (one Submission doc w/ entries array)
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
   ========================= */
const firebaseConfig = {
  // TODO: keep your real values here
  apiKey: "REPLACE_ME",
  authDomain: "REPLACE_ME",
  projectId: "REPLACE_ME",
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);

/* =========================
   Local Storage Keys
   ========================= */
const LOCAL_KEY = "cc_batch_entries_v1";
const LOCAL_PIN_OK = "cc_pin_ok_v1";

/* =========================
   PIN (set your PIN)
   ========================= */
const ACCESS_PIN = "1234"; // TODO: change

/* =========================
   Taxonomy (3-level)
   Values match your cartTypeSelect values
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
   DOM Helpers
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

function setSync(statusText, ok = true) {
  const dot = $("syncDot");
  const txt = $("syncText");
  if (txt) txt.textContent = statusText;
  if (dot) dot.style.opacity = ok ? "1" : "0.6";
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
   Lock / PIN gate
   ========================= */
let isUnlocked = false;

function applyLockState() {
  // Lock affects sticker inputs + selection UI
  const locked = !isUnlocked;

  // Sticker inputs
  const stickerInputs = [
    "supplyFirst","supplyDate","supplyDone","supplyTech",
    "drugFirstExp","drugName","drugLock","drugDoneOn","drugInitials"
  ];
  stickerInputs.forEach(id => {
    const el = $(id);
    if (el) el.disabled = locked;
  });

  // Dept dropdown card controls
  ["deptBtn","cartTypeSelect","sectionSelect","locationSelect","cartNumberInput","closeDeptCard"].forEach(id => {
    const el = $(id);
    if (el) el.disabled = locked;
  });

  // Actions
  if ($("saveBtn")) $("saveBtn").disabled = locked;
  if ($("clearBtn")) $("clearBtn").disabled = locked;

  // Preview allowed even if locked (view-only), but submit should require unlock
  if ($("submitBtn")) $("submitBtn").disabled = locked;

  // Lock button label
  const lockBtn = $("lockBtn");
  if (lockBtn) lockBtn.textContent = locked ? "🔒 Lock" : "🔓 Unlock";

  // PIN gate overlay
  $("pinGate").style.display = locked ? "flex" : "none";

  updateCompleteIndicator();
}

function unlockWithPin() {
  const pin = String($("pinInput")?.value || "").trim();
  if (pin !== ACCESS_PIN) {
    const err = $("pinError");
    if (err) err.textContent = "Incorrect PIN.";
    return;
  }
  localStorage.setItem(LOCAL_PIN_OK, "1");
  isUnlocked = true;
  const err = $("pinError");
  if (err) err.textContent = "";
  $("pinInput").value = "";
  setSync("Unlocked", true);
  applyLockState();
  toast("Unlocked.");
}

function lockNow() {
  localStorage.removeItem(LOCAL_PIN_OK);
  isUnlocked = false;
  setSync("Locked", false);
  applyLockState();
}

/* =========================
   Dept Card Toggle
   ========================= */
function openDeptCard() {
  $("deptCard").hidden = false;
}
function closeDeptCard() {
  $("deptCard").hidden = true;
}

/* =========================
   Dropdown population (3-level)
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
  const sections = Object.keys(CART_TAXONOMY[cartType] || {});

  const sectionSelect = $("sectionSelect");
  const locationSelect = $("locationSelect");

  resetSelect(sectionSelect, "Select section…");
  resetSelect(locationSelect, "Select location…");

  sectionSelect.disabled = sections.length === 0;
  locationSelect.disabled = true;

  fillSelect(sectionSelect, sections);

  // Clear meta + department display
  updateSelectedMeta();
  updateCompleteIndicator();
}

function onSectionChange() {
  const cartType = $("cartTypeSelect").value;
  const section = $("sectionSelect").value;
  const locations = (CART_TAXONOMY[cartType]?.[section]) || [];

  const locationSelect = $("locationSelect");
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
  const cartType = $("cartTypeSelect")?.value || "";
  const section = $("sectionSelect")?.value || "";
  const location = $("locationSelect")?.value || "";
  const cartNum = normalizeCartNumber($("cartNumberInput")?.value || "");

  const display = section && location ? `${section} — ${location}` : "—";
  const meta = $("selectedKeyMeta");
  if (meta) meta.textContent = `Selected: ${display}${cartNum ? ` | Cart ${cartNum}` : ""}`;

  // If you later add a printed “Department” field on the sticker,
  // this is where we’d set it live.
}

/* =========================
   Entry completeness ✅ (informational)
   "All fields are entered" = all sticker inputs + selection + cart#
   ========================= */
function getEntryDraft() {
  const cartType = $("cartTypeSelect")?.value || "";
  const section = $("sectionSelect")?.value || "";
  const location = $("locationSelect")?.value || "";
  const cartNumber = normalizeCartNumber($("cartNumberInput")?.value || "");

  const departmentDisplay = (section && location) ? `${section} — ${location}` : "";

  const fields = {
    supplyFirst: $("supplyFirst")?.value || "",
    supplyDate: $("supplyDate")?.value || "",
    supplyDone: $("supplyDone")?.value || "",
    supplyTech: $("supplyTech")?.value || "",
    drugFirstExp: $("drugFirstExp")?.value || "",
    drugName: $("drugName")?.value || "",
    drugLock: $("drugLock")?.value || "",
    drugDoneOn: $("drugDoneOn")?.value || "",
    drugInitials: $("drugInitials")?.value || "",
  };

  return {
    cartType,
    section,
    location,
    departmentDisplay,
    cartNumber,
    ...fields
  };
}

function isComplete(entry) {
  // completeness = everything filled + valid cart#
  if (!entry.cartType || !entry.section || !entry.location) return false;
  if (!entry.cartNumber) return false;

  // all sticker inputs must be non-empty (per your request)
  const requiredInputs = [
    "supplyFirst","supplyDate","supplyDone","supplyTech",
    "drugFirstExp","drugName","drugLock","drugDoneOn","drugInitials"
  ];
  return requiredInputs.every(k => String(entry[k] || "").trim().length > 0);
}

function updateCompleteIndicator() {
  const check = $("headerCheck");
  const hint = $("completeHint");
  if (!check || !hint) return;

  const entry = getEntryDraft();
  const complete = isComplete(entry);

  check.hidden = !complete;
  // purely informational
  hint.style.opacity = complete ? "0.55" : "1";
}

/* =========================
   Save (local batch)
   ========================= */
let batch = loadBatch();
let editingIndex = null;

function updatePreviewCount() {
  const pill = $("previewCount");
  if (pill) pill.textContent = String(batch.length);
  const meta = $("previewMeta");
  if (meta) meta.textContent = `${batch.length} saved.`;
}

function validateBeforeSave(entry) {
  if (!entry.cartType) return "Select Cart Type.";
  if (!entry.section) return "Select Section.";
  if (!entry.location) return "Select Location.";
  if (!entry.cartNumber) return "Enter a valid Cart # (numbers only).";

  // all sticker inputs required (per your request)
  if (!isComplete(entry)) return "Complete entry to continue.";
  return "";
}

function clearFields(keepDept = true) {
  // sticker fields
  ["supplyFirst","supplyDate","supplyDone","supplyTech","drugFirstExp","drugName","drugLock","drugDoneOn","drugInitials"].forEach(id => {
    if ($(id)) $(id).value = "";
  });

  // cart number cleared (usually)
  if ($("cartNumberInput")) $("cartNumberInput").value = "";

  // keep selection or not
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

  const record = {
    ...entry,
    createdAtLocal: new Date().toISOString()
  };

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
   Preview: render/edit/delete
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

function escapeHtml(s) {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function editFromPreview(idx) {
  const e = batch[idx];
  if (!e) return;

  // Fill selection
  $("cartTypeSelect").value = e.cartType;
  onCartTypeChange();

  $("sectionSelect").value = e.section;
  onSectionChange();

  $("locationSelect").value = e.location;
  onLocationChange();

  $("cartNumberInput").value = (e.cartNumber || "").replace(/^#/, "");

  // Fill sticker fields
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
   Submit to Firestore
   - one Submission doc containing entries array
   ========================= */
function deviceId() {
  let id = localStorage.getItem("cc_device_id_v1");
  if (!id) {
    id = (crypto?.randomUUID?.() || `dev_${Date.now()}_${Math.random()}`).toString();
    localStorage.setItem("cc_device_id_v1", id);
  }
  return id;
}

async function submitToFirebase() {
  if (!isUnlocked) return toast("Unlock to submit.");
  if (batch.length === 0) return toast("Nothing to submit.");

  // Validate everything again
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

    // Clear local batch on success
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
   Wire up events
   ========================= */
function wireEvents() {
  // PIN
  $("pinUnlockBtn")?.addEventListener("click", unlockWithPin);
  $("pinInput")?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") unlockWithPin();
  });

  // Lock button
  $("lockBtn")?.addEventListener("click", () => {
    if (isUnlocked) lockNow();
    else $("pinGate").style.display = "flex";
  });

  // Dept card open/close
  $("deptBtn")?.addEventListener("click", () => {
    if (!isUnlocked) return toast("Unlock to continue.");
    openDeptCard();
  });
  $("closeDeptCard")?.addEventListener("click", closeDeptCard);

  // Dropdown changes
  $("cartTypeSelect")?.addEventListener("change", onCartTypeChange);
  $("sectionSelect")?.addEventListener("change", onSectionChange);
  $("locationSelect")?.addEventListener("change", onLocationChange);
  $("cartNumberInput")?.addEventListener("input", () => {
    updateSelectedMeta();
    updateCompleteIndicator();
  });

  // Sticker inputs completeness watch
  ["supplyFirst","supplyDate","supplyDone","supplyTech","drugFirstExp","drugName","drugLock","drugDoneOn","drugInitials"].forEach(id => {
    $(id)?.addEventListener("input", updateCompleteIndicator);
    $(id)?.addEventListener("change", updateCompleteIndicator);
  });

  // Save / clear
  $("saveBtn")?.addEventListener("click", saveEntry);
  $("clearBtn")?.addEventListener("click", () => clearFields(true));

  // Preview / Entry navigation
  $("previewBtn")?.addEventListener("click", () => {
    showPreviewView();
    renderPreviewList();
  });

  $("entryBtn")?.addEventListener("click", () => showEntryView());

  $("btnBack")?.addEventListener("click", () => showEntryView());

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
  // restore unlock state
  isUnlocked = localStorage.getItem(LOCAL_PIN_OK) === "1";

  // ensure selects exist (you added these in HTML edits)
  if (!$("sectionSelect") || !$("locationSelect") || !$("cartNumberInput")) {
    console.warn("Missing section/location/cartNumber inputs. Apply the HTML edits.");
  }

  // initial dropdown reset
  if ($("sectionSelect")) {
    resetSelect($("sectionSelect"), "Select section…");
    $("sectionSelect").disabled = true;
  }
  if ($("locationSelect")) {
    resetSelect($("locationSelect"), "Select location…");
    $("locationSelect").disabled = true;
  }

  // load batch and update UI
  batch = loadBatch();
  updatePreviewCount();

  // start in entry view
  showEntryView();
  setSync(isUnlocked ? "Unlocked" : "Locked", isUnlocked);

  wireEvents();
  applyLockState();
  renderPreviewList();
}

init();
