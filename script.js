/* 
  A5 Whiteboard Survey (Undo/Redo + Named Sessions + PNG Export)
  – Pen/Eraser, brush size, colour wheel + hex
  – A5 pages, add/switch
  – Undo/Redo (history per page)
  – Save/Load by session name (IndexedDB, private)
  – Export current page as opaque PNG

  Learn while you build:
  • History uses ImageData snapshots on stroke end.
  • IndexedDB stores per-session PNG ArrayBuffers; session key is the name you type.
*/

const mmToPx = mm => (mm * 96) / 25.4;
const A5 = { wMM: 148, hMM: 210 };

// UI refs
const UI = {
  penBtn: document.getElementById('penBtn'),
  eraserBtn: document.getElementById('eraserBtn'),
  size: document.getElementById('size'),
  sizeValue: document.getElementById('sizeValue'),
  addPageBtn: document.getElementById('addPageBtn'),
  clearBtn: document.getElementById('clearBtn'),
  saveBtn: document.getElementById('saveBtn'),
  loadBtn: document.getElementById('loadBtn'),
  exportBtn: document.getElementById('exportBtn'),
  pagesList: document.getElementById('pagesList'),
  pageStage: document.getElementById('pageStage'),
  colorWheel: document.getElementById('colorWheel'),
  colorHex: document.getElementById('colorHex'),
  currentSwatch: document.getElementById('currentSwatch'),
  undoBtn: document.getElementById('undoBtn'),
  redoBtn: document.getElementById('redoBtn'),
  sessionName: document.getElementById('sessionName'),
};

let state = {
  tool: 'pen',
  size: parseInt(UI.size.value, 10),
  color: '#111111',
  pages: [],              // { id, canvas, ctx, dpr, history:[], future:[] }
  activeIndex: -1,
  drawing: false,
  last: { x: 0, y: 0 },
  maxHistory: 40
};

// ---------- IndexedDB ----------
const DB_NAME = 'A5WhiteboardDB';
const DB_VERSION = 1;
const STORE = 'pages';

function openDB(){
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'id' }); // id = sessionName
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function saveSession(sessionId, pngBlobs){
  if (!sessionId) throw new Error('Session name required');
  const db = await openDB();
  const tx = db.transaction(STORE, 'readwrite');
  const store = tx.objectStore(STORE);
  const record = { id: sessionId, ts: Date.now(), pages: await Promise.all(pngBlobs.map(blobToArrayBuffer)) };
  store.put(record);
  return new Promise((res, rej)=>{ tx.oncomplete=()=>res(true); tx.onerror=()=>rej(tx.error); });
}
async function loadSession(sessionId){
  if (!sessionId) throw new Error('Session name required');
  const db = await openDB();
  const tx = db.transaction(STORE, 'readonly');
  const store = tx.objectStore(STORE);
  return new Promise((resolve, reject) => {
    const req = store.get(sessionId);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}
function blobToArrayBuffer(blob){
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(fr.result);
    fr.onerror = reject;
    fr.readAsArrayBuffer(blob);
  });
}
function arrayBufferToBlob(buf, type='image/png'){ return new Blob([buf], { type }); }

// ---------- init ----------
UI.sizeValue.textContent = `${state.size} px`;
drawColourWheel(UI.colorWheel);
updateSwatch(state.color);

makePage();
selectPage(0);
wireUI();
wireKeyboard();

// ---------- UI wiring ----------
function wireUI(){
  UI.penBtn.addEventListener('click', () => setTool('pen'));
  UI.eraserBtn.addEventListener('click', () => setTool('eraser'));

  UI.size.addEventListener('input', (e) => {
    state.size = parseInt(e.target.value, 10);
    UI.sizeValue.textContent = `${state.size} px`;
  });

  UI.addPageBtn.addEventListener('click', () => {
    const idx = makePage();
    selectPage(idx);
  });

  UI.clearBtn.addEventListener('click', () => {
    clearActivePage();
    pushHistory(getActivePage()); // snapshot after clear so you can undo the clear
  });

  UI.saveBtn.addEventListener('click', async () => {
    const name = UI.sessionName.value.trim();
    const blobs = await Promise.all(state.pages.map(pageToBlobOpaque));
    await saveSession(name, blobs);
    pulse(UI.saveBtn, '✅ Saved');
  });

  UI.loadBtn.addEventListener('click', async () => {
    const name = UI.sessionName.value.trim();
    const rec = await loadSession(name);
    if (rec) {
      await restoreFromRecord(rec);
      pulse(UI.loadBtn, '📂 Loaded');
    } else {
      pulse(UI.loadBtn, '⚠️ Not found');
    }
  });

  UI.exportBtn.addEventListener('click', exportActivePNG);

  // Colour wheel + hex
  UI.colorWheel.addEventListener('pointerdown', onWheelPickStart);
  UI.colorWheel.addEventListener('pointermove', onWheelPickMove);
  UI.colorWheel.addEventListener('pointerup', onWheelPickEnd);
  UI.colorWheel.addEventListener('pointerleave', onWheelPickEnd);

  UI.colorHex.addEventListener('change', () => {
    const val = UI.colorHex.value.trim();
    const ok = trySetStrokeStyle(val);
    if (!ok) UI.colorHex.value = state.color;
    updateSwatch(state.color);
  });

  // Undo/Redo buttons
  UI.undoBtn.addEventListener('click', undo);
  UI.redoBtn.addEventListener('click', redo);
}

function wireKeyboard(){
  window.addEventListener('keydown', (e) => {
    const k = e.key.toLowerCase();

    // Undo/Redo (support common combos)
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && k === 'z') { e.preventDefault(); undo(); return; }
    if ((e.ctrlKey || e.metaKey) && (e.shiftKey && k === 'z')) { e.preventDefault(); redo(); return; }
    if ((e.ctrlKey) && k === 'y') { e.preventDefault(); redo(); return; }

    if (k === 'p') setTool('pen');
    if (k === 'e') setTool('eraser');
    if (k === 'n') { const i = makePage(); selectPage(i); }
    if (k === 'c') { clearActivePage(); pushHistory(getActivePage()); }
    if (k === '[') { UI.size.value = Math.max(1, state.size - 1); UI.size.dispatchEvent(new Event('input')); }
    if (k === ']') { UI.size.value = Math.min(60, state.size + 1); UI.size.dispatchEvent(new Event('input')); }
    if (k === 's') UI.saveBtn.click();
    if (k === 'l') UI.loadBtn.click();
    if (k === 'd') UI.exportBtn.click();
  });
}

function setTool(tool){
  state.tool = tool;
  const isPen = tool === 'pen';
  UI.penBtn.classList.toggle('active', isPen);
  UI.penBtn.setAttribute('aria-pressed', isPen);
  UI.eraserBtn.classList.toggle('active', !isPen);
  UI.eraserBtn.setAttribute('aria-pressed', !isPen);

  const page = getActivePage();
  if (page){
    page.ctx.globalCompositeOperation = isPen ? 'source-over' : 'destination-out';
    page.canvas.style.cursor = isPen ? 'crosshair' : 'cell';
  }
}

// ---------- pages ----------
function makePage(){
  const canvas = document.createElement('canvas');
  canvas.className = 'page-canvas';
  canvas.setAttribute('role', 'tabpanel');
  canvas.style.width  = `${A5.wMM}mm`;
  canvas.style.height = `${A5.hMM}mm`;
  UI.pageStage.appendChild(canvas);

  const dpr = Math.max(1, window.devicePixelRatio || 1);
  const cssW = canvas.clientWidth  || mmToPx(A5.wMM);
  const cssH = canvas.clientHeight || mmToPx(A5.hMM);
  canvas.width  = Math.round(cssW * dpr);
  canvas.height = Math.round(cssH * dpr);

  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.lineJoin = 'round';
  ctx.lineCap  = 'round';
  ctx.lineWidth = state.size;
  ctx.strokeStyle = state.color;
  ctx.globalCompositeOperation = state.tool === 'pen' ? 'source-over' : 'destination-out';

  const id = crypto.randomUUID ? crypto.randomUUID() : `p_${Date.now()}_${Math.random().toString(16).slice(2)}`;
  const page = { id, canvas, ctx, dpr, history: [], future: [] };
  state.pages.push(page);

  bindDrawingEvents(page);
  addPageListItem(state.pages.length - 1);

  // push a blank snapshot so first undo works
  pushHistory(page, /*force*/true);

  return state.pages.length - 1;
}

function addPageListItem(index){
  const li = document.createElement('li');
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.textContent = `Page ${index + 1}`;
  btn.setAttribute('role', 'tab');
  btn.setAttribute('aria-selected', 'false');
  btn.addEventListener('click', () => selectPage(index));
  li.appendChild(btn);
  UI.pagesList.appendChild(li);
}

function selectPage(index){
  if (index < 0 || index >= state.pages.length) return;
  state.pages.forEach((p, i) => p.canvas.classList.toggle('active', i === index));
  [...UI.pagesList.querySelectorAll('button')].forEach((b, i) => {
    b.setAttribute('aria-selected', i === index ? 'true' : 'false');
  });
  state.activeIndex = index;
  setTool(state.tool);
  const page = getActivePage();
  if (page) {
    page.ctx.lineWidth = state.size;
    page.ctx.strokeStyle = state.color;
  }
}

function getActivePage(){ return state.pages[state.activeIndex] || null; }

// ---------- drawing + history ----------
function bindDrawingEvents(page){
  const c = page.canvas;

  const onDown = (e) => {
    e.preventDefault();
    c.setPointerCapture?.(e.pointerId);
    state.drawing = true;
    const pt = relativePoint(c, e);
    state.last = pt;
    page.ctx.beginPath();
    page.ctx.moveTo(pt.x, pt.y);
    // snapshot BEFORE drawing so undo returns to this state
    pushHistory(page);
  };

  const onMove = (e) => {
    if (!state.drawing) return;
    const pt = relativePoint(c, e);
    page.ctx.lineWidth = state.size;
    if (state.tool === 'pen') page.ctx.strokeStyle = state.color;
    page.ctx.lineTo(pt.x, pt.y);
    page.ctx.stroke();
    state.last = pt;
  };

  const endStroke = (e) => {
    if (!state.drawing) return;
    const pt = relativePoint(c, e);
    page.ctx.lineTo(pt.x, pt.y);
    page.ctx.stroke();
    page.ctx.closePath();
    state.drawing = false;
    c.releasePointerCapture?.(e.pointerId);
    // (no snapshot here—already captured at pointerdown)
  };

  c.addEventListener('pointerdown', onDown);
  c.addEventListener('pointermove', onMove);
  c.addEventListener('pointerup', endStroke);
  c.addEventListener('pointercancel', endStroke);
  c.addEventListener('pointerleave', endStroke);
}

function relativePoint(canvas, e){
  const r = canvas.getBoundingClientRect();
  return { x: e.clientX - r.left, y: e.clientY - r.top };
}

function clearActivePage(){
  const page = getActivePage();
  if (!page) return;
  const { ctx, canvas } = page;
  ctx.save(); ctx.setTransform(1,0,0,1,0,0);
  ctx.clearRect(0,0,canvas.width, canvas.height);
  ctx.restore();
}

// snapshot current bitmap into history (ImageData)
function pushHistory(page, force=false){
  // when starting a new stroke, we snapshot before drawing
  const { canvas, history, future } = page;
  const ctx = canvas.getContext('2d');
  ctx.save(); ctx.setTransform(1,0,0,1,0,0);
  const snap = ctx.getImageData(0,0,canvas.width, canvas.height);
  ctx.restore();
  history.push(snap);
  // drop redo stack on new action
  if (!force) page.future = [];
  // cap memory
  if (history.length > state.maxHistory) history.shift();
  updateUndoRedoButtons();
}

function undo(){
  const page = getActivePage();
  if (!page) return;
  if (page.history.length === 0) return;
  // current state -> future, and restore the last snapshot
  const { canvas, ctx, history, future } = page;

  // Save current bitmap to redo stack
  ctx.save(); ctx.setTransform(1,0,0,1,0,0);
  const current = ctx.getImageData(0,0,canvas.width, canvas.height);
  ctx.restore();
  future.push(current);
  if (future.length > state.maxHistory) future.shift();

  // Pop last snapshot to restore
  const snap = history.pop();
  ctx.save(); ctx.setTransform(1,0,0,1,0,0);
  ctx.putImageData(snap, 0, 0);
  ctx.restore();

  updateUndoRedoButtons();
}

function redo(){
  const page = getActivePage();
  if (!page) return;
  if (page.future.length === 0) return;
  const { canvas, ctx, history, future } = page;

  // push current to history
  ctx.save(); ctx.setTransform(1,0,0,1,0,0);
  const current = ctx.getImageData(0,0,canvas.width, canvas.height);
  ctx.restore();
  history.push(current);
  if (history.length > state.maxHistory) history.shift();

  // restore from future
  const snap = future.pop();
  ctx.save(); ctx.setTransform(1,0,0,1,0,0);
  ctx.putImageData(snap, 0, 0);
  ctx.restore();

  updateUndoRedoButtons();
}

function updateUndoRedoButtons(){
  const page = getActivePage();
  if (!page){ UI.undoBtn.disabled = UI.redoBtn.disabled = true; return; }
  UI.undoBtn.disabled = page.history.length === 0;
  UI.redoBtn.disabled = page.future.length === 0;
}

// ---------- save/load ----------
function pageToBlobOpaque(page){
  return new Promise(resolve => {
    const temp = document.createElement('canvas');
    temp.width = page.canvas.width;
    temp.height = page.canvas.height;
    const tctx = temp.getContext('2d');
    tctx.fillStyle = '#ffffff';
    tctx.fillRect(0,0,temp.width,temp.height);
    tctx.drawImage(page.canvas, 0, 0);
    temp.toBlob(b => resolve(b), 'image/png', 1.0);
  });
}

async function restoreFromRecord(rec){
  // wipe current pages
  state.pages.forEach(p => p.canvas.remove());
  state.pages = [];
  UI.pagesList.innerHTML = '';

  for (let i = 0; i < rec.pages.length; i++){
    const idx = makePage();
    const page = state.pages[idx];
    const blob = arrayBufferToBlob(rec.pages[i], 'image/png');
    await drawBlobOnCanvas(blob, page.canvas);
    // reset history stacks after drawing restored bitmap
    page.history = [];
    page.future = [];
    pushHistory(page, /*force*/true); // snapshot base so undo works
  }
  selectPage(0);
}

function drawBlobOnCanvas(blob, canvas){
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const ctx = canvas.getContext('2d');
      ctx.save(); ctx.setTransform(1,0,0,1,0,0);
      ctx.clearRect(0,0,canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      ctx.restore();
      resolve(true);
    };
    img.src = URL.createObjectURL(blob);
  });
}

// ---------- export (PNG current page) ----------
async function exportActivePNG(){
  const page = getActivePage();
  if (!page) return;

  // opaque white background under strokes
  const temp = document.createElement('canvas');
  temp.width = page.canvas.width;
  temp.height = page.canvas.height;
  const tctx = temp.getContext('2d');
  tctx.fillStyle = '#ffffff';
  tctx.fillRect(0,0,temp.width,temp.height);
  tctx.drawImage(page.canvas, 0, 0);

  const url = temp.toDataURL('image/png');
  const a = document.createElement('a');
  a.href = url;
  a.download = `${UI.sessionName.value.trim() || 'session'}_page_${state.activeIndex + 1}.png`;
  a.click();
  URL.revokeObjectURL?.(url);
}

// ---------- colour wheel ----------
let wheelPicking = false;

function drawColourWheel(canvas){
  const ctx = canvas.getContext('2d');
  const { width, height } = canvas;
  const cx = width/2, cy = height/2;
  const radius = Math.min(cx, cy) - 2;

  const img = ctx.createImageData(width, height);
  for (let y = 0; y < height; y++){
    for (let x = 0; x < width; x++){
      const dx = x - cx, dy = y - cy;
      const dist = Math.sqrt(dx*dx + dy*dy);
      const i = (y * width + x) * 4;

      if (dist <= radius){
        const angle = Math.atan2(dy, dx);
        const hue = ((angle * 180 / Math.PI) + 360) % 360;
        const t = Math.min(1, dist / radius);
        const s = 1;
        const l = 0.5 + (t-0.5)*0.6;
        const { r, g, b } = hslToRgb(hue/360, s, l);
        img.data[i+0] = r; img.data[i+1] = g; img.data[i+2] = b; img.data[i+3] = 255;
      } else {
        img.data[i+3] = 0;
      }
    }
  }
  ctx.putImageData(img, 0, 0);
}

function onWheelPickStart(e){ wheelPicking = true; pickColorFromWheel(e); }
function onWheelPickMove(e){ if (wheelPicking) pickColorFromWheel(e); }
function onWheelPickEnd(){ wheelPicking = false; }

function pickColorFromWheel(e){
  const rect = UI.colorWheel.getBoundingClientRect();
  const x = Math.floor(e.clientX - rect.left);
  const y = Math.floor(e.clientY - rect.top);
  const ctx = UI.colorWheel.getContext('2d');
  const data = ctx.getImageData(x, y, 1, 1).data;
  if (data[3] === 0) return;
  const hex = rgbToHex(data[0], data[1], data[2]);
  setPenColor(hex);
}

function setPenColor(cssColor){
  if (!trySetStrokeStyle(cssColor)) return false;
  updateSwatch(state.color);
  UI.colorHex.value = state.color;
  return true;
}

function trySetStrokeStyle(cssColor){
  const test = document.createElement('canvas').getContext('2d');
  try {
    test.strokeStyle = cssColor; // throws for invalid colors
    state.color = cssColor;
    const page = getActivePage();
    if (page && state.tool === 'pen') page.ctx.strokeStyle = state.color;
    return true;
  } catch { return false; }
}

function updateSwatch(color){
  UI.currentSwatch.style.setProperty('--swatch', color);
  UI.currentSwatch.style.background = color;
}

// helpers: color conversions
function hslToRgb(h, s, l){
  if (s === 0) { const v = Math.round(l*255); return { r:v, g:v, b:v }; }
  const q = l < 0.5 ? l*(1+s) : l + s - l*s;
  const p = 2*l - q;
  const r = Math.round(hue2rgb(p,q,h+1/3)*255);
  const g = Math.round(hue2rgb(p,q,h)*255);
  const b = Math.round(hue2rgb(p,q,h-1/3)*255);
  return { r,g,b };
}
function hue2rgb(p,q,t){ if (t<0) t+=1; if (t>1) t-=1;
  if (t<1/6) return p+(q-p)*6*t;
  if (t<1/2) return q;
  if (t<2/3) return p+(q-p)*(2/3-t)*6;
  return p;
}
function rgbToHex(r,g,b){ const h=n=>n.toString(16).padStart(2,'0'); return `#${h(r)}${h(g)}${h(b)}`; }

// ---------- UI sugar ----------
function pulse(btn, text){
  const old = btn.textContent;
  btn.textContent = text;
  setTimeout(()=>btn.textContent = old, 900);
}
