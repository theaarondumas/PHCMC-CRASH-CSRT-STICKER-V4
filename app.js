import { initializeApp } from "https://www.gstatic.com/firebasejs/12.7.0/firebase-app.js";
import {
  getFirestore,
  addDoc,
  collection,
  serverTimestamp,
  enableIndexedDbPersistence
} from "https://www.gstatic.com/firebasejs/12.7.0/firebase-firestore.js";

/* =========================
   FIREBASE (PASTE CONFIG)
   ========================= */
const firebaseConfig = {
  // 🔥 PASTE YOUR FIREBASE CONFIG HERE
  // apiKey: "...",
  // authDomain: "...",
  // projectId: "...",
  // storageBucket: "...",
  // messagingSenderId: "...",
  // appId: "..."
};

let app = null;
let db = null;

function initFirebase(){
  if (!firebaseConfig?.projectId) return;
  app = initializeApp(firebaseConfig);
  db = getFirestore(app);
  enableIndexedDbPersistence(db).catch(()=>{});
}

/* =========================
   PIN GATE + LOCK BUTTON
   ========================= */

// PIN = 045360  (stored as SHA-256 hash)
const PIN_SHA256_HEX = "b37628edb9bff2492cf1e8024d529128269c2cd31c75e72b53cc0df4d6f75e65";
const PIN_SESSION_KEY = "cc_pin_unlocked_v1";

function hexFromBuffer(buf){
  return [...new Uint8Array(buf)].map(b=>b.toString(16).padStart(2,"0")).join("");
}
async function sha256Hex(str){
  const enc = new TextEncoder().encode(str);
  const digest = await crypto.subtle.digest("SHA-256", enc);
  return hexFromBuffer(digest);
}

function setupPinGate(){
  const gate = document.getElementById("pinGate");
  const input = document.getElementById("pinInput");
  const btn = document.getElementById("pinUnlockBtn");
  const err = document.getElementById("pinError");

  if(!gate || !input || !btn) return;

  const unlocked = sessionStorage.getItem(PIN_SESSION_KEY) === "1";
  if(unlocked){
    gate.style.display = "none";
    return;
  }

  gate.style.display = "flex";

  const attempt = async () => {
    err.textContent = "";
    const pin = (input.value || "").trim();
    if(pin.length < 4){
      err.textContent = "PIN must be at least 4 digits.";
      return;
    }
    const hash = await sha256Hex(pin);
    if(hash === PIN_SHA256_HEX){
      sessionStorage.setItem(PIN_SESSION_KEY, "1");
      gate.style.display = "none";
      input.value = "";
    } else {
      err.textContent = "Incorrect PIN.";
      input.value = "";
      input.focus();
    }
  };

  btn.addEventListener("click", attempt);
  input.addEventListener("keydown", (e)=>{ if(e.key === "Enter") attempt(); });
  setTimeout(()=>input.focus(), 150);
}

function setupLockButton(){
  const btn = document.getElementById("lockBtn");
  if(!btn) return;

  btn.addEventListener("click", () => {
    sessionStorage.removeItem(PIN_SESSION_KEY);
    location.reload();
  });
}

/* =========================
   YOUR FULL LISTS
   ========================= */

function backupSlots(label, count){
  return Array.from({length: count}, (_,i)=> `${label} ${i+1}`);
}

// ADULT MAIN
const ADULT_MAIN = [
  { group: "ER AREA", items: ["Cardiology","EDX1","EDX2","ER TRIAGE","ER RM 2"] },
  { group: "XRAY DEPT", items: ["CT 1","CT2/MRI","XRAY","SPECIAL RM 5","SPECIAL RM 6","CATH LAB","CT TRAILER"] },
  { group: "MOTHER BABY", items: ["LD TRIAGE","LD NURSE STATION","MATERNITY"] },
  { group: "SURGERY", items: ["OR","RECOVERY"] },
  { group: "NORTH BUILDING", items: ["PHYSICAL THERAPY"] },
  { group: "BASEMENT", items: ["GI LAB"] },
  { group: "CENTRAL BACK UP CARTS", items: ["XRAY TRAILER 5", ...backupSlots("UROLOGY", 6)] }
];

// BROSELOW
const BROSELOW = [
  { group: "2ND FLOOR", items: ["2C","ER","EDX1","EDX2","ER MAIN","SURGERY","RECOVERY"] },
  { group: "NORTH BLDG", items: ["PHYSICAL THERAPY"] },
  { group: "CENTRAL BACK UP CARTS", items: backupSlots("BACKUP", 3) }
];

// NEONATAL
const NEONATAL = [
  { group: "LABOR DELIVERY", items: ["OR HALLWAY","LD HALLWAY"] },
  { group: "MOTHER BABY", items: ["NICU","NURSERY","MATERNITY","PAV C NICU"] },
  { group: "2ND FLOOR OVERFLOW", items: ["OVERFLOW"] },
  { group: "CENTRAL BACK UP CARTS", items: backupSlots("BACKUP", 10) }
];

// ADULT TOWERS / NORTH TOWER
const ADULT_TOWERS = [
  { group: "4TH FLOOR TOWERS", items: ["4SOUTH","4 EAST"] },
  { group: "3RD FLOOR TOWERS", items: ["3SOUTH","3EAST"] },
  { group: "2ND FLOOR TOWERS", items: ["2 SOUTH","2EAST"] },
  { group: "2ND FLOOR NORTH", items: ["2A","2B","2C","2D"] },
  { group: "3RD FLOOR NORTH", items: ["3A","3B","3C","3D"] },
  { group: "1ST FLOOR PAVILION ICU", items: ["PAV A","PAV B","PAV C"] }
];

const CART_MAP = { ADULT_MAIN, BROSELOW, NEONATAL, ADULT_TOWERS };

const CART_TYPE_LABEL = {
  ADULT_MAIN: "Adult Crash Carts (Main)",
  BROSELOW: "Broselow Carts",
  NEONATAL: "Neonatal Crash Carts",
  ADULT_TOWERS: "Adult Crash Carts (Towers / North Tower)"
};

/* =========================
   STATE (LOCAL FIRST)
   ========================= */

const LOCAL_KEY = "cc_stickers_clean_v2"; // bumped to v2 with pin/lock changes

const defaultState = {
  cartType: "",
  area: "",
  saved: {},           // key: `${cartType}::${area}` -> entry object
  lastTouchedKey: ""
};

let state = loadState();

function loadState(){
  try{
    const raw = localStorage.getItem(LOCAL_KEY);
    if(!raw) return structuredClone(defaultState);
    const parsed = JSON.parse(raw);
    return { ...structuredClone(defaultState), ...parsed };
  }catch{
    return structuredClone(defaultState);
  }
}
function saveState(){
  localStorage.setItem(LOCAL_KEY, JSON.stringify(state));
}

/* =========================
   DOM
   ========================= */

const $ = (id)=> document.getElementById(id);

const viewEntry = $("viewEntry");
const viewPreview = $("viewPreview");

const btnBack = $("btnBack");
const deptBtn = $("deptBtn");
const deptCard = $("deptCard");
const closeDeptCard = $("closeDeptCard");

const cartTypeSelect = $("cartTypeSelect");
const areaSelect = $("areaSelect");
const selectedKeyMeta = $("selectedKeyMeta");

const saveBtn = $("saveBtn");
const clearBtn = $("clearBtn");

const previewBtn = $("previewBtn");
const previewCount = $("previewCount");
const entryBtn = $("entryBtn");
const submitBtn = $("submitBtn");
const wipeAllBtn = $("wipeAllBtn");

const previewList = $("previewList");
const previewMeta = $("previewMeta");

const savedBadge = $("savedBadge");
const headerCheck = $("headerCheck");

const syncDot = $("syncDot");
const syncText = $("syncText");
const footerStatus = $("footerStatus");
const subtitle = $("subtitle");

const toast = $("toast");

// Sticker inputs
const supplyFirst = $("supplyFirst");
const supplyDate = $("supplyDate");
const supplyDone = $("supplyDone");
const supplyTech = $("supplyTech");

const drugFirstExp = $("drugFirstExp");
const drugName = $("drugName");
const drugLock = $("drugLock");
const drugDoneOn = $("drugDoneOn");
const drugInitials = $("drugInitials");

/* =========================
   UI HELPERS
   ========================= */

function showToast(msg, ms=1600){
  toast.textContent = msg;
  toast.hidden = false;
  setTimeout(()=> toast.hidden = true, ms);
}

function setSyncUI(){
  const online = navigator.onLine;
  syncDot.style.background = online ? "#4ee1a0" : "#ffcc66";
  syncText.textContent = online ? "Online" : "Offline";
}

function setView(name){
  // name: entry | preview
  viewEntry.hidden = name !== "entry";
  viewPreview.hidden = name !== "preview";
  btnBack.hidden = name === "entry";
  subtitle.textContent = (name === "entry")
    ? "Sticker entry → Preview → Submit"
    : "Review everything before submitting";
}

function buildKey(cartType, area){
  return `${cartType}::${area}`;
}

function currentKey(){
  if(!state.cartType || !state.area) return "";
  return buildKey(state.cartType, state.area);
}

function hydrateAreaDropdown(){
  const cartType = cartTypeSelect.value;
  areaSelect.innerHTML = `<option value="" selected disabled>Select area…</option>`;
  areaSelect.disabled = !cartType;

  if(!cartType) return;

  const groups = CART_MAP[cartType] || [];
  for(const g of groups){
    const og = document.createElement("optgroup");
    og.label = g.group;
    for(const item of g.items){
      const opt = document.createElement("option");
      opt.value = item;
      opt.textContent = item;
      og.appendChild(opt);
    }
    areaSelect.appendChild(og);
  }
}

function updateSavedIndicators(){
  const key = currentKey();
  const isSaved = !!(key && state.saved[key]);

  savedBadge.hidden = !isSaved;
  headerCheck.hidden = !isSaved;

  const label = key
    ? `Selected: ${CART_TYPE_LABEL[state.cartType] || state.cartType} → ${state.area}`
    : "Selected: —";
  selectedKeyMeta.textContent = label;
}

function setInputsFromSavedIfExists(){
  const key = currentKey();
  const entry = key ? state.saved[key] : null;

  if(entry){
    supplyFirst.value = entry.supplyFirst || "";
    supplyDate.value  = entry.supplyDate || "";
    supplyDone.value  = entry.supplyDone || "";
    supplyTech.value  = entry.supplyTech || "";

    drugFirstExp.value = entry.drugFirstExp || "";
    drugName.value     = entry.drugName || "";
    drugLock.value     = entry.drugLock || "";
    drugDoneOn.value   = entry.drugDoneOn || "";
    drugInitials.value = entry.drugInitials || "";
  }
}

function clearInputs(){
  supplyFirst.value = "";
  supplyDate.value  = "";
  supplyDone.value  = "";
  supplyTech.value  = "";

  drugFirstExp.value = "";
  drugName.value     = "";
  drugLock.value     = "";
  drugDoneOn.value   = "";
  drugInitials.value = "";
}

function countSaved(){
  return Object.keys(state.saved).length;
}

/* =========================
   PREVIEW RENDER
   ========================= */

function renderPreview(){
  const keys = Object.keys(state.saved);
  previewCount.textContent = String(keys.length);
  previewMeta.textContent = `${keys.length} saved. Review and edit before submitting.`;

  previewList.innerHTML = "";
  if(keys.length === 0){
    previewList.innerHTML = `<div class="previewItem"><div class="previewTitle">No saved stickers yet.</div><div class="previewSub">Go back and save at least one area.</div></div>`;
    return;
  }

  keys.sort((a,b)=> a.localeCompare(b));

  for(const key of keys){
    const entry = state.saved[key];
    const [ct, area] = key.split("::");

    const div = document.createElement("div");
    div.className = "previewItem";

    const t = document.createElement("div");
    t.className = "previewTitle";
    t.textContent = `${CART_TYPE_LABEL[ct] || ct} → ${area}`;

    const sub = document.createElement("div");
    sub.className = "previewSub";
    const when = entry.updatedAt ? new Date(entry.updatedAt).toLocaleString() : "—";
    sub.textContent = `Last updated: ${when}`;

    const summary = document.createElement("div");
    summary.className = "previewSub";
    summary.style.marginTop = "6px";
    summary.textContent =
      `Supply exp: ${entry.supplyFirst || "—"} | CS tech: ${entry.supplyTech || "—"} | Lock: ${entry.drugLock || "—"} | Initials: ${entry.drugInitials || "—"}`;

    const btns = document.createElement("div");
    btns.className = "previewBtns";

    const edit = document.createElement("button");
    edit.className = "btn btn--primary";
    edit.textContent = "Edit";
    edit.type = "button";
    edit.addEventListener("click", ()=>{
      state.cartType = ct;
      state.area = area;
      state.lastTouchedKey = key;
      saveState();

      cartTypeSelect.value = ct;
      hydrateAreaDropdown();
      areaSelect.value = area;

      setView("entry");
      updateSavedIndicators();
      setInputsFromSavedIfExists();
      showToast("Editing selected sticker");
    });

    const del = document.createElement("button");
    del.className = "btn btn--ghost";
    del.textContent = "Delete";
    del.type = "button";
    del.addEventListener("click", ()=>{
      delete state.saved[key];
      saveState();
      renderPreview();
      showToast("Deleted");
    });

    btns.appendChild(edit);
    btns.appendChild(del);

    div.appendChild(t);
    div.appendChild(sub);
    div.appendChild(summary);
    div.appendChild(btns);

    previewList.appendChild(div);
  }
}

/* =========================
   SAVE LOGIC
   ========================= */

function buildEntryPayload(){
  return {
    cartType: state.cartType,
    area: state.area,

    supplyFirst: supplyFirst.value.trim(),
    supplyDate: supplyDate.value.trim(),
    supplyDone: supplyDone.value.trim(),
    supplyTech: supplyTech.value.trim(),

    drugFirstExp: drugFirstExp.value.trim(),
    drugName: drugName.value.trim(),
    drugLock: drugLock.value.trim(),
    drugDoneOn: drugDoneOn.value.trim(),
    drugInitials: drugInitials.value.trim(),

    updatedAt: Date.now()
  };
}

function validateBeforeSave(){
  if(!state.cartType){
    showToast("Select Cart Type");
    return false;
  }
  if(!state.area){
    showToast("Select Area");
    return false;
  }
  return true;
}

/* =========================
   SUBMIT TO FIREBASE
   ========================= */

async function submitToFirebase(){
  const keys = Object.keys(state.saved);
  if(keys.length === 0){
    showToast("Nothing to submit");
    return;
  }
  if(!db){
    showToast("Paste Firebase config in app.js first");
    return;
  }
  if(!navigator.onLine){
    showToast("Offline — connect to submit");
    return;
  }

  footerStatus.textContent = "Submitting…";

  const entries = keys.map(k => state.saved[k]);

  const docPayload = {
    submittedAt: serverTimestamp(),
    submittedAtMs: Date.now(),
    entryCount: entries.length,
    entries
  };

  await addDoc(collection(db, "crash_cart_submissions"), docPayload);

  footerStatus.textContent = "Submitted ✅";
  showToast("✅ Submitted to Firebase");

  // Wipe local after submit (pilot-friendly). Comment these lines to keep local archive.
  state.saved = {};
  saveState();
  previewCount.textContent = "0";
  renderPreview();
}

/* =========================
   EVENTS
   ========================= */

deptBtn.addEventListener("click", ()=>{
  deptCard.hidden = !deptCard.hidden;
});

closeDeptCard.addEventListener("click", ()=>{
  deptCard.hidden = true;
});

cartTypeSelect.addEventListener("change", ()=>{
  state.cartType = cartTypeSelect.value;
  state.area = "";
  saveState();

  hydrateAreaDropdown();
  areaSelect.value = "";
  updateSavedIndicators();
});

areaSelect.addEventListener("change", ()=>{
  state.area = areaSelect.value;
  saveState();

  updateSavedIndicators();

  const key = currentKey();
  if(state.saved[key]){
    setInputsFromSavedIfExists();
    showToast("Loaded saved sticker");
  } else {
    clearInputs();
    showToast("New area — fields cleared");
  }
});

saveBtn.addEventListener("click", ()=>{
  if(!validateBeforeSave()) return;

  const key = currentKey();
  state.saved[key] = buildEntryPayload();
  state.lastTouchedKey = key;
  saveState();

  updateSavedIndicators();
  previewCount.textContent = String(countSaved());
  showToast("✅ Saved");
});

clearBtn.addEventListener("click", ()=>{
  clearInputs();
  showToast("Cleared fields");
});

previewBtn.addEventListener("click", ()=>{
  setView("preview");
  renderPreview();
});

entryBtn.addEventListener("click", ()=>{
  setView("entry");
});

btnBack.addEventListener("click", ()=>{
  setView("entry");
});

submitBtn.addEventListener("click", ()=>{
  submitToFirebase().catch((e)=>{
    console.warn(e);
    footerStatus.textContent = "Submit failed";
    showToast("Submit failed — check Firebase rules/config");
  });
});

wipeAllBtn.addEventListener("click", ()=>{
  state.saved = {};
  saveState();
  previewCount.textContent = "0";
  renderPreview();
  showToast("Wiped local saved items");
});

/* =========================
   BOOT
   ========================= */

function boot(){
  setupPinGate();       // MUST be first
  setupLockButton();    // 🔒 Lock button

  initFirebase();
  setSyncUI();
  window.addEventListener("online", setSyncUI);
  window.addEventListener("offline", setSyncUI);

  // Restore selections
  if(state.cartType){
    cartTypeSelect.value = state.cartType;
    hydrateAreaDropdown();
    areaSelect.disabled = false;
  }
  if(state.area){
    areaSelect.value = state.area;
  }

  previewCount.textContent = String(countSaved());
  updateSavedIndicators();

  // If current selection already saved, load it
  if(state.cartType && state.area){
    const key = currentKey();
    if(state.saved[key]) setInputsFromSavedIfExists();
  }

  footerStatus.textContent = db ? "Firebase: connected" : "Firebase: not connected (paste config)";
}

boot();
