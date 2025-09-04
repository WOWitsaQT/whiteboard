/* 
  A5 Whiteboard Survey
  – Pen / Eraser
  – Adjustable brush size
  – Add & switch pages (each A5)
  – Download current page as PNG

  Key idea to learn: canvas has a *display size* (CSS) and a separate *pixel buffer size*.
  We match the buffer to physical size × devicePixelRatio for crisp strokes.
*/

const mmToPx = mm => (mm * 96) / 25.4; // CSS pixels at 96dpi
const A5 = { wMM: 148, hMM: 210 };

const UI = {
  penBtn: document.getElementById('penBtn'),
  eraserBtn: document.getElementById('eraserBtn'),
  size: document.getElementById('size'),
  sizeValue: document.getElementById('sizeValue'),
  addPageBtn: document.getElementById('addPageBtn'),
  clearBtn: document.getElementById('clearBtn'),
  downloadBtn: document.getElementById('downloadBtn'),
  pagesList: document.getElementById('pagesList'),
  pageStage: document.getElementById('pageStage'),
};

let state = {
  tool: 'pen',            // 'pen' | 'eraser'
  size: parseInt(UI.size.value, 10),
  pages: [],              // { id, canvas, ctx, dpr }
  activeIndex: -1,
  drawing: false,
  last: { x: 0, y: 0 },
};

// --- init ---
UI.sizeValue.textContent = `${state.size} px`;
makePage();          // create first A5 page
selectPage(0);       // and select it
wireUI();
wireKeyboard();

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

  UI.clearBtn.addEventListener('click', clearActivePage);
  UI.downloadBtn.addEventListener('click', downloadActivePage);
}

function wireKeyboard(){
  window.addEventListener('keydown', (e) => {
    if (e.key.toLowerCase() === 'p') setTool('pen');
    if (e.key.toLowerCase() === 'e') setTool('eraser');
    if (e.key.toLowerCase() === 'n') { const i = makePage(); selectPage(i); }
    if (e.key.toLowerCase() === 'c') clearActivePage();
    if (e.key.toLowerCase() === 'd') downloadActivePage();

    // quick brush size tweak
    if (e.key === '[') { UI.size.value = Math.max(1, state.size - 1); UI.size.dispatchEvent(new Event('input')); }
    if (e.key === ']') { UI.size.value = Math.min(60, state.size + 1); UI.size.dispatchEvent(new Event('input')); }
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

function makePage(){
  // Create canvas element
  const canvas = document.createElement('canvas');
  canvas.className = 'page-canvas';
  canvas.setAttribute('role', 'tabpanel');

  // Style: A5 in physical units. We'll set the pixel buffer below.
  canvas.style.width  = `${A5.wMM}mm`;
  canvas.style.height = `${A5.hMM}mm`;

  // Insert into stage
  UI.pageStage.appendChild(canvas);

  // Prepare 2D context with DPR scaling
  const dpr = Math.max(1, window.devicePixelRatio || 1);
  const cssW = canvas.clientWidth  || mmToPx(A5.wMM); // fallback in case not laid out yet
  const cssH = canvas.clientHeight || mmToPx(A5.hMM);
  canvas.width  = Math.round(cssW * dpr);
  canvas.height = Math.round(cssH * dpr);

  const ctx = canvas.getContext('2d', { alpha: true, desynchronized: false, willReadFrequently: false });
  // Normalize coordinate space so we can draw in CSS pixels
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.lineJoin = 'round';
  ctx.lineCap  = 'round';
  ctx.strokeStyle = '#111';
  ctx.lineWidth = state.size;
  ctx.globalCompositeOperation = state.tool === 'pen' ? 'source-over' : 'destination-out';

  const id = crypto.randomUUID ? crypto.randomUUID() : `p_${Date.now()}_${Math.random().toString(16).slice(2)}`;

  const page = { id, canvas, ctx, dpr };
  state.pages.push(page);

  // Interactions (pointer events)
  bindDrawingEvents(page);

  // Pages list entry
  const index = state.pages.length - 1;
  addPageListItem(index);

  return index;
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

  // toggle canvas visibility
  state.pages.forEach((p, i) => {
    p.canvas.classList.toggle('active', i === index);
  });

  // toggle page list selection
  [...UI.pagesList.querySelectorAll('button')].forEach((b, i) => {
    b.setAttribute('aria-selected', i === index ? 'true' : 'false');
  });

  state.activeIndex = index;

  // Refresh tool visual + composite mode on the active context
  setTool(state.tool);

  // Ensure lineWidth reflects slider for new page
  const page = getActivePage();
  if (page) page.ctx.lineWidth = state.size;
}

function getActivePage(){
  return state.pages[state.activeIndex] || null;
}

function bindDrawingEvents(page){
  const c = page.canvas;

  const onDown = (e) => {
    e.preventDefault();
    c.setPointerCapture?.(e.pointerId);
    state.drawing = true;
    const pt = relativePoint(c, e);
    state.last = pt;

    const { ctx } = page;
    ctx.beginPath();
    ctx.moveTo(pt.x, pt.y);
  };

  const onMove = (e) => {
    if (!state.drawing) return;
    const { ctx } = page;
    const pt = relativePoint(c, e);
    ctx.lineWidth = state.size;
    ctx.lineTo(pt.x, pt.y);
    ctx.stroke();
    state.last = pt;
  };

  const endStroke = (e) => {
    if (!state.drawing) return;
    const { ctx } = page;
    const pt = relativePoint(c, e);
    ctx.lineTo(pt.x, pt.y);
    ctx.stroke();
    ctx.closePath();
    state.drawing = false;
    c.releasePointerCapture?.(e.pointerId);
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
  ctx.save();
  ctx.setTransform(1,0,0,1,0,0);   // reset to clear full buffer
  ctx.clearRect(0,0,canvas.width, canvas.height);
  ctx.restore();                    // back to CSS pixel transform
}

function downloadActivePage(){
  const page = getActivePage();
  if (!page) return;

  // Temporarily draw a white background so eraser holes don’t become transparent
  const temp = document.createElement('canvas');
  temp.width  = page.canvas.width;
  temp.height = page.canvas.height;
  const tctx = temp.getContext('2d');

  // Fill white then draw the page bitmap on top
  tctx.fillStyle = '#ffffff';
  tctx.fillRect(0,0,temp.width,temp.height);
  tctx.drawImage(page.canvas, 0, 0);

  const url = temp.toDataURL('image/png');
  const a = document.createElement('a');
  a.href = url;
  a.download = `whiteboard_page_${state.activeIndex + 1}.png`;
  a.click();
  URL.revokeObjectURL?.(url);
}

/* ——— Little learning moments (toggle as you wish) ———
   Try changing A5 to landscape by swapping width/height in CSS only.
   Then, what breaks? (hint: nothing; we sized the pixel buffer from the rendered size)
*/
