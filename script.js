// === A5 Whiteboard Survey (Fit-to-Screen + Fullscreen) ===
// Keeps A5 aspect, scales to stage; page itself fills 100dvh (no outer scroll)

const A5_ASPECT = 148 / 210;

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
  fullscreenBtn: document.getElementById('fullscreenBtn'),
};

let state = {
  tool: 'pen',
  size: parseInt(UI.size.value, 10),
  color: '#111111',
  pages: [], // { id, canvas, ctx, dpr, history:[], future:[] }
  activeIndex: -1,
  drawing: false,
  maxHistory: 40
};

// ---------- IndexedDB (same as before) ----------
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

// ---------- Init ----------
UI.sizeValue.textContent = `${state.size} px`;
drawColourWheel(UI.colorWheel);
updateSwatch(state.color);

makePage();
selectPage(0);
wireUI();
wireKeyboard();
addResizeObservers();

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
    pushHistory(getActivePage());
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
    if (rec) { await restoreFromRecord(rec); pulse(UI.loadBtn, '📂 Loaded'); }
    else { pulse(UI.loadBtn, '⚠️ Not found'); }
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

  // Fullscreen
  UI.fullscreenBtn.addEventListener('click', toggleFullscreen);
  document.addEventListener('fullscreenchange', () => {
    UI.fullscreenBtn.textContent = document.fullscreenElement ? '🗗 Exit Fullscreen' : '⛶ Fullscreen';
    layoutActivePage(true);
  });
}

function wireKeyboard(){
  window.addEventListener('keydown', (e) => {
    const k = e.key.toLowerCase();

    // Undo/Redo
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
    if (k === 'f') UI.fullscreenBtn.click();
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

// ---------- Pages ----------
function makePage(){
  const canvas = document.createElement('canvas');
  canvas.className = 'page-canvas';
  canvas.setAttribute('role', 'tabpanel');
  UI.pageStage.appendChild(canvas);

  const ctx = canvas.getContext('2d');
  const page = { id: crypto.randomUUID?.() || `p_${Date.now()}`, canvas, ctx, dpr: 1, history: [], future: [] };
  state.pages.push(page);

  bindDrawingEvents(page);
  addPageListItem(state.pages.length - 1);

  layoutPageToFit(page, false);
  pushHistory(page, true);

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
  if (page){
    page.ctx.lineWidth = state.size;
    page.ctx.strokeStyle = state.color;
    layoutPageToFit(page, true);
    updateUndoRedoButtons();
  }
}

function getActivePage(){ return state.pages[state.activeIndex] || null; }

// ---------- Drawing + History ----------
function bindDrawingEvents(page){
  const c = page.canvas;

  const onDown = (e) => {
    e.preventDefault();
    c.setPointerCapture?.(e.pointerId);
    state.drawing = true;
    const pt = relPoint(c, e);
    page.ctx.beginPath();
    page.ctx.moveTo(pt.x, pt.y);
    pushHistory(page); // snapshot BEFORE drawing
  };

  const onMove = (e) => {
    if (!state.drawing) return;
    const pt = relPoint(c, e);
    page.ctx.lineWidth = state.size;
    if (state.tool === 'pen') page.ctx.strokeStyle = state.color;
    page.ctx.lineTo(pt.x, pt.y);
    page.ctx.stroke();
  };

  const endStroke = (e) => {
    if (!state.drawing) return;
    const pt = relPoint(c, e);
    page.ctx.lineTo(pt.x, pt.y);
    page.ctx.stroke();
    page.ctx.closePath();
    state.drawing = false;
    c.releasePointerCapture?.(e.pointerId);
  };

  c.addEventListener('pointerdown', onDown);
  c.addEventListener('pointermove', onMove);
  c.addEventListener('pointerup', endStroke);
  c.addEventListener('pointercancel', endStroke);
  c.addEventListener('pointerleave', endStroke);
}

function relPoint(canvas, e){
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

function pushHistory(page, force=false){
  const { canvas, history } = page;
  const ctx = canvas.getContext('2d');
  ctx.save(); ctx.setTransform(1,0,0,1,0,0);
  const snap = ctx.getImageData(0,0,canvas.width, canvas.height);
  ctx.restore();
  history.push(snap);
  if (!force) page.future = [];
  if (history.length > state.maxHistory) history.shift();
  updateUndoRedoButtons();
}

function undo(){
  const page = getActivePage();
  if (!page || page.history.length === 0) return;

  const { canvas, ctx, history, future } = page;
  ctx.save(); ctx.setTransform(1,0,0,1,0,0);
  const current = ctx.getImageData(0,0,canvas.width, canvas.height);
  ctx.restore();
  future.push(current);
  if (future.length > state.maxHistory) future.shift();

  const snap = history.pop();
  ctx.save(); ctx.setTransform(1,0,0,1,0,0);
  ctx.putImageData(snap, 0, 0);
  ctx.restore();

  updateUndoRedoButtons();
}

function redo(){
  const page = getActivePage();
  if (!page || page.future.length === 0) return;

  const { canvas, ctx, history, future } = page;
  ctx.save(); ctx.setTransform(1,0,0,1,0,0);
  const current = ctx.getImageData(0,0,canvas.width, canvas.height);
  ctx.restore();
  history.push(current);
  if (history.length > state.maxHistory) history.shift();

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

// ---------- Save/Load/Export ----------
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
  state.pages.forEach(p => p.canvas.remove());
  state.pages = [];
  UI.pagesList.innerHTML = '';

  for (let i = 0; i < rec.pages.length; i++){
    const idx = makePage();
    const page = state.pages[idx];
    const blob = arrayBufferToBlob(rec.pages[i], 'image/png');
    await drawBlobOnCanvas(blob, page.canvas);
    page.history = []; page.future = [];
    pushHistory(page, true);
    layoutPageToFit(page, true);
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

async function exportActivePNG(){
  const page = getActivePage();
  if (!page) return;
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

// ---------- Colour wheel ----------
let wheelPicking = false;
function drawColourWheel(canvas){
  const ctx = canvas.getContext('2d');
  const { width, height } = canvas;
  const cx = width/2, cy = height/2;
  const radius = Math.min(cx, cy) - 1;
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
        const s = 1, l = 0.5 + (t-0.5)*0.6;
        const { r, g, b } = hslToRgb(hue/360, s, l);
        img.data[i] = r; img.data[i+1] = g; img.data[i+2] = b; img.data[i+3] = 255;
      } else { img.data[i+3] = 0; }
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
  const d = ctx.getImageData(x, y, 1, 1).data;
  if (d[3] === 0) return;
  const hex = rgbToHex(d[0], d[1], d[2]);
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
    test.strokeStyle = cssColor;
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

// ---------- Fit-to-screen & buffer sync ----------
function addResizeObservers(){
  const ro = new ResizeObserver(() => layoutActivePage(true));
  ro.observe(UI.pageStage);
  window.addEventListener('orientationchange', () => layoutActivePage(true));
  window.addEventListener('resize', () => layoutActivePage(true));
}
function layoutActivePage(preserve=true){
  const page = getActivePage();
  if (!page) return;
  layoutPageToFit(page, preserve);
}
function layoutPageToFit(page, preserve=true){
  const rect = UI.pageStage.getBoundingClientRect();
  const availW = Math.max(100, rect.width - 16);
  const availH = Math.max(100, rect.height - 16);

  let targetW = availW;
  let targetH = targetW / A5_ASPECT;
  if (targetH > availH) {
    targetH = availH;
    targetW = targetH * A5_ASPECT;
  }

  page.canvas.style.width = `${Math.floor(targetW)}px`;
  page.canvas.style.height = `${Math.floor(targetH)}px`;

  syncBufferToDisplay(page, preserve);
}
function syncBufferToDisplay(page, preserveContent){
  const dpr = Math.max(1, window.devicePixelRatio || 1);
  const cssW = Math.floor(parseFloat(page.canvas.style.width));
  const cssH = Math.floor(parseFloat(page.canvas.style.height));
  const need =
    page.canvas.width !== Math.round(cssW * dpr) ||
    page.canvas.height !== Math.round(cssH * dpr) ||
    page.dpr !== dpr;

  if (!need) return;

  let snap = null;
  if (preserveContent){
    page.ctx.save(); page.ctx.setTransform(1,0,0,1,0,0);
    snap = page.ctx.getImageData(0,0,page.canvas.width, page.canvas.height);
    page.ctx.restore();
  }

  page.dpr = dpr;
  page.canvas.width = Math.round(cssW * dpr);
  page.canvas.height = Math.round(cssH * dpr);
  page.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  page.ctx.lineJoin = 'round';
  page.ctx.lineCap  = 'round';
  page.ctx.lineWidth = state.size;
  page.ctx.strokeStyle = state.color;
  page.ctx.globalCompositeOperation = state.tool === 'pen' ? 'source-over' : 'destination-out';

  if (snap){
    const temp = document.createElement('canvas');
    temp.width = snap.width; temp.height = snap.height;
    const tctx = temp.getContext('2d');
    tctx.putImageData(snap, 0, 0);
    page.ctx.save(); page.ctx.setTransform(1,0,0,1,0,0);
    page.ctx.drawImage(temp, 0, 0, page.canvas.width, page.canvas.height);
    page.ctx.restore();
  }
  updateUndoRedoButtons();
}

// ---------- Fullscreen ----------
function toggleFullscreen(){
  if (!document.fullscreenElement) {
    (document.documentElement.requestFullscreen?.bind(document.documentElement) ||
     document.body.requestFullscreen?.bind(document.body) ||
     (()=>{}))();
  } else {
    document.exitFullscreen?.();
  }
}

// ---------- UI sugar ----------
function pulse(btn, text){
  const old = btn.textContent;
  btn.textContent = text;
  setTimeout(()=>btn.textContent = old, 900);
}
