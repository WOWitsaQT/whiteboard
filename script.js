// === A5 Whiteboard Survey (Compact-only, dock pinned to bottom) ===
const A5_ASPECT = 148 / 210;

// ---------- UI references ----------
const UI = {
  pageStage: document.getElementById('pageStage'),

  // Dock
  mobileDock: document.getElementById('mobileDock'),
  dockPen: document.getElementById('dockPen'),
  dockEraser: document.getElementById('dockEraser'),
  dockSizeMinus: document.getElementById('dockSizeMinus'),
  dockSizePlus: document.getElementById('dockSizePlus'),
  dockSizeLabel: document.getElementById('dockSizeLabel'),
  dockUndo: document.getElementById('dockUndo'),
  dockRedo: document.getElementById('dockRedo'),
  dockColor: document.getElementById('dockColor'),
  dockPrev: document.getElementById('dockPrev'),
  dockNext: document.getElementById('dockNext'),
  dockPageLabel: document.getElementById('dockPageLabel'),
  dockAddPage: document.getElementById('dockAddPage'),
  
  // Corner tab
  cornerPanel:    document.getElementById('cornerPanel'),
  cornerToggle:   document.getElementById('cornerToggle'),
  cornerContent:  document.getElementById('cornerContent'),
  cornerSession:  document.getElementById('cornerSessionName'),
  cornerSave:     document.getElementById('cornerSave'),
  cornerLoad:     document.getElementById('cornerLoad'),
  cornerExport:   document.getElementById('cornerExport'),
};

// ---------- State ----------
let state = {
  tool: 'pen',
  size: 8,
  color: '#111111',
  pages: [], // { id, canvas, ctx, dpr, history:[], future:[] }
  activeIndex: -1,
  drawing: false,
  maxHistory: 40,
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
        db.createObjectStore(STORE, { keyPath: 'id' }); // id = session name
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
  tx.objectStore(STORE).put({
    id: sessionId,
    ts: Date.now(),
    pages: await Promise.all(pngBlobs.map(blobToArrayBuffer))
  });
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
UI.dockSizeLabel.textContent = `${state.size}px`;
setTool('pen');

makePage();
selectPage(0);
wireDock();
wireCornerTab();
wireKeyboard();
addResizeObservers();
observeDock(); // keep --dock-h synced to actual dock height

// ---------- Dock sizing sync ----------
function syncDockPadding(){
  if (!UI.mobileDock) return;
  const h = UI.mobileDock.getBoundingClientRect().height || 0;
  document.documentElement.style.setProperty('--dock-h', `${Math.ceil(h)}px`);
}
function observeDock(){
  if (!UI.mobileDock) return;
  const ro = new ResizeObserver(syncDockPadding);
  ro.observe(UI.mobileDock);
  window.addEventListener('resize', syncDockPadding);
  window.addEventListener('orientationchange', () => setTimeout(syncDockPadding, 50));
  syncDockPadding();
}

// ---------- Wiring: Dock ----------
function wireDock(){
  UI.dockPen.addEventListener('click', () => setTool('pen'));
  UI.dockEraser.addEventListener('click', () => setTool('eraser'));

  UI.dockSizeMinus.addEventListener('click', () => setBrushSize(Math.max(1, state.size - 2)));
  UI.dockSizePlus.addEventListener('click', () => setBrushSize(Math.min(60, state.size + 2)));

  UI.dockUndo.addEventListener('click', undo);
  UI.dockRedo.addEventListener('click', redo);

  UI.dockColor.addEventListener('input', (e) => setPenColor(e.target.value));

  UI.dockPrev.addEventListener('click', () => selectPage(Math.max(0, state.activeIndex - 1)));
  UI.dockNext.addEventListener('click', () => selectPage(Math.min(state.pages.length - 1, state.activeIndex + 1)));
  UI.dockAddPage.addEventListener('click', () => { const i = makePage(); selectPage(i); });

}

function setBrushSize(px){
  state.size = px|0;
  UI.dockSizeLabel.textContent = `${state.size}px`;
  const p = getActivePage();
  if (p) p.ctx.lineWidth = state.size;
}

// ---------- Wiring: Corner Tab ----------
function wireCornerTab(){
  if (!UI.cornerToggle || !UI.cornerContent || !UI.cornerPanel) return;

  UI.cornerToggle.addEventListener('click', (e) => {
    e.stopPropagation();
    const open = UI.cornerPanel.getAttribute('data-open') === 'true';
    setCornerOpen(!open);
  });

  document.addEventListener('click', (e) => {
    if (!UI.cornerPanel.contains(e.target)) setCornerOpen(false);
  });

  UI.cornerSave.addEventListener('click', saveAll);
  UI.cornerLoad.addEventListener('click', loadAll);
  UI.cornerExport.addEventListener('click', exportActivePNG);
}
function setCornerOpen(open){
  UI.cornerPanel.setAttribute('data-open', open ? 'true' : 'false');
  UI.cornerToggle.setAttribute('aria-expanded', open ? 'true' : 'false');
  UI.cornerContent.hidden = !open;
}

// ---------- Keyboard (optional helpers) ----------
function wireKeyboard(){
  window.addEventListener('keydown', (e) => {
    const k = e.key.toLowerCase();
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && k === 'z') { e.preventDefault(); undo(); return; }
    if ((e.ctrlKey || e.metaKey) && (e.shiftKey && k === 'z')) { e.preventDefault(); redo(); return; }
    if ((e.ctrlKey) && k === 'y') { e.preventDefault(); redo(); return; }

    if (k === 'p') setTool('pen');
    if (k === 'e') setTool('eraser');
    if (k === '[') setBrushSize(Math.max(1, state.size - 1));
    if (k === ']') setBrushSize(Math.min(60, state.size + 1));
    if (k === 'n') { const i = makePage(); selectPage(i); }
    if (k === 'd') exportActivePNG();
  });
}

// ---------- Tools ----------
function setTool(tool){
  state.tool = tool;
  const isPen = tool === 'pen';
  UI.dockPen.classList.toggle('active', isPen);
  UI.dockEraser.classList.toggle('active', !isPen);
  const page = getActivePage();
  if (page){
    page.ctx.globalCompositeOperation = isPen ? 'source-over' : 'destination-out';
    page.canvas.style.cursor = isPen ? 'crosshair' : 'cell';
  }
}
function setPenColor(cssColor){
  if (!trySetStrokeStyle(cssColor)) return;
  if (state.color.startsWith('#')) UI.dockColor.value = state.color;
}
function trySetStrokeStyle(cssColor){
  const t = document.createElement('canvas').getContext('2d');
  try {
    t.strokeStyle = cssColor;
    state.color = cssColor;
    const p = getActivePage();
    if (p && state.tool === 'pen') p.ctx.strokeStyle = state.color;
    return true;
  } catch { return false; }
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
  layoutPageToFit(page, false);
  pushHistory(page, true);

  updatePageLabel();
  return state.pages.length - 1;
}
function selectPage(index){
  if (index < 0 || index >= state.pages.length) return;
  state.pages.forEach((p, i) => p.canvas.style.display = i === index ? 'block' : 'none');
  state.activeIndex = index;

  const page = getActivePage();
  if (page){
    page.ctx.lineWidth = state.size;
    page.ctx.strokeStyle = state.color;
    page.ctx.globalCompositeOperation = state.tool === 'pen' ? 'source-over' : 'destination-out';
    layoutPageToFit(page, true);
    updateUndoRedoButtons();
  }
  updatePageLabel();
}
function updatePageLabel(){ UI.dockPageLabel.textContent = `${state.activeIndex + 1}/${state.pages.length}`; }
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
  UI.dockUndo.disabled = !page || page.history.length === 0;
  UI.dockRedo.disabled = !page || page.future.length === 0;
}

// ---------- Save/Load/Export ----------
async function saveAll(){
  const name = (UI.cornerSession?.value || '').trim() || 'default';
  const blobs = await Promise.all(state.pages.map(pageToBlobOpaque));
  await saveSession(name, blobs);
  flashCorner('✅ Saved');
}
async function loadAll(){
  const name = (UI.cornerSession?.value || '').trim() || 'default';
  const rec = await loadSession(name);
  if (!rec) { flashCorner('⚠️ Not found'); return; }

  // wipe existing
  state.pages.forEach(p => p.canvas.remove());
  state.pages = [];

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
  flashCorner('📂 Loaded');
}

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
  const base = (UI.cornerSession?.value || 'session').trim() || 'session';
  a.href = url;
  a.download = `${base}_page_${state.activeIndex + 1}.png`;
  a.click();
  URL.revokeObjectURL?.(url);
}
function flashCorner(text){
  const old = UI.cornerToggle.textContent;
  UI.cornerToggle.textContent = text;
  setTimeout(()=> UI.cornerToggle.textContent = old, 900);
}

// ---------- Fit-to-screen ----------
function addResizeObservers(){
  const ro = new ResizeObserver(() => layoutActivePage(true));
  ro.observe(UI.pageStage);
  window.addEventListener('resize', () => layoutActivePage(true));
  window.addEventListener('orientationchange', () => layoutActivePage(true));
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
  if (targetH > availH) { targetH = availH; targetW = targetH * A5_ASPECT; }

  page.canvas.style.width = `${Math.floor(targetW)}px`;
  page.canvas.style.height = `${Math.floor(targetH)}px`;
  syncBufferToDisplay(page, preserve);
}
function syncBufferToDisplay(page, preserveContent){
  const dpr = Math.max(1, window.devicePixelRatio || 1);
  const cssW = Math.floor(parseFloat(page.canvas.style.width));
  const cssH = Math.floor(parseFloat(page.canvas.style.height));
  const need = page.canvas.width !== Math.round(cssW * dpr) || page.canvas.height !== Math.round(cssH * dpr) || page.dpr !== dpr;
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
    const tctx = temp.getContext('2d'); tctx.putImageData(snap, 0, 0);
    page.ctx.save(); page.ctx.setTransform(1,0,0,1,0,0);
    page.ctx.drawImage(temp, 0, 0, page.canvas.width, page.canvas.height);
    page.ctx.restore();
  }
  updateUndoRedoButtons();
}
