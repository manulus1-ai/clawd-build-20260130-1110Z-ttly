/* TabTally
   - Client-only receipt splitter.
   - State can be shared by encoding JSON into the URL hash.
*/

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

const els = {
  personName: $('#personName'),
  btnAddPerson: $('#btnAddPerson'),
  people: $('#people'),
  receipt: $('#receipt'),
  btnParse: $('#btnParse'),
  btnAddItem: $('#btnAddItem'),
  items: $('#items'),
  itemsTable: $('#itemsTable'),
  tax: $('#tax'),
  tip: $('#tip'),
  totals: $('#totals'),
  grandTotal: $('#grandTotal'),
  btnCopyText: $('#btnCopyText'),
  btnDownload: $('#btnDownload'),
  btnShare: $('#btnShare'),
  btnNativeShare: $('#btnNativeShare'),
  btnNew: $('#btnNew'),
  btnExample: $('#btnExample'),
  btnScan: $('#btnScan'),
  scanInput: $('#scanInput'),
  parseMsg: $('#parseMsg'),
};

/** @typedef {{id:string,name:string}} Person */
/** @typedef {{id:string, name:string, price:number, assignedTo:string[]}} Item */

/** @type {{people: Person[], items: Item[], tax: number, tip: number}} */
let state = {
  people: [],
  items: [],
  tax: 0,
  tip: 0,
};

let activeAssignees = new Set();

function uid(prefix='id'){
  return `${prefix}_${Math.random().toString(16).slice(2)}${Date.now().toString(16)}`;
}

function money(n){
  const v = Number.isFinite(n) ? n : 0;
  return v.toLocaleString(undefined, { style:'currency', currency:'USD' });
}

function parseMoney(s){
  if (s == null) return 0;
  const cleaned = String(s).replace(/[^0-9.\-]/g,'');
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : 0;
}

function base64UrlEncode(str){
  const b64 = btoa(unescape(encodeURIComponent(str)));
  return b64.replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
}
function base64UrlDecode(b64url){
  let b64 = b64url.replace(/-/g,'+').replace(/_/g,'/');
  while (b64.length % 4) b64 += '=';
  const str = decodeURIComponent(escape(atob(b64)));
  return str;
}

function setHashFromState(){
  const payload = JSON.stringify(state);
  const encoded = base64UrlEncode(payload);
  // keep it in the hash so it never hits any server logs.
  location.hash = `#t=${encoded}`;
}

function loadStateFromHash(){
  const h = location.hash || '';
  const m = h.match(/#t=([A-Za-z0-9_-]+)/);
  if (!m) return false;
  try{
    const decoded = base64UrlDecode(m[1]);
    const parsed = JSON.parse(decoded);

    // minimal validation
    if (!parsed || typeof parsed !== 'object') return false;
    if (!Array.isArray(parsed.people) || !Array.isArray(parsed.items)) return false;

    state = {
      people: parsed.people.map(p => ({ id: String(p.id||uid('p')), name: String(p.name||'') })).filter(p=>p.name.trim()),
      items: parsed.items.map(it => ({
        id: String(it.id||uid('i')),
        name: String(it.name||''),
        price: Number(it.price)||0,
        assignedTo: Array.isArray(it.assignedTo) ? it.assignedTo.map(String) : [],
      })),
      tax: Number(parsed.tax)||0,
      tip: Number(parsed.tip)||0,
    };

    els.tax.value = state.tax ? state.tax.toFixed(2) : '';
    els.tip.value = state.tip ? state.tip.toFixed(2) : '';

    return true;
  }catch{
    return false;
  }
}

function renderPeople(){
  els.people.innerHTML = '';
  state.people.forEach(p => {
    const el = document.createElement('div');
    el.className = 'chip' + (activeAssignees.has(p.id) ? ' active' : '');
    el.innerHTML = `<span>${escapeHtml(p.name)}</span>
      <button type="button" title="Remove">×</button>`;

    el.addEventListener('click', (e) => {
      if (e.target.tagName === 'BUTTON') return;
      const multi = e.shiftKey;
      if (!multi) activeAssignees = new Set();
      if (activeAssignees.has(p.id)) activeAssignees.delete(p.id);
      else activeAssignees.add(p.id);
      renderPeople();
      renderItems();
    });

    el.querySelector('button').addEventListener('click', () => {
      removePerson(p.id);
    });

    els.people.appendChild(el);
  });
}

function renderItems(){
  els.items.innerHTML = '';
  state.items.forEach(item => {
    const tr = document.createElement('tr');
    if (!item.assignedTo || item.assignedTo.length === 0) tr.classList.add('unassignedRow');

    const assigned = new Set(item.assignedTo);
    const pills = state.people.map(p => {
      const on = assigned.has(p.id);
      return `<span class="pill ${on?'on':''}" data-pid="${p.id}">${escapeHtml(p.name)}</span>`;
    }).join('');

    tr.innerHTML = `
      <td>
        <input data-field="name" data-id="${item.id}" value="${escapeAttr(item.name)}" placeholder="Item name" />
      </td>
      <td>
        <input data-field="price" data-id="${item.id}" value="${Number(item.price||0).toFixed(2)}" inputmode="decimal" />
      </td>
      <td>
        <div class="assign" data-id="${item.id}">${pills || '<span class="muted">Add people first</span>'}</div>
        <div class="muted tiny" style="margin-top:6px">Tip: click a name to toggle. Or select people above then click here to assign quickly.</div>
      </td>
      <td style="text-align:right">
        <button class="btn ghost" data-del="${item.id}" type="button">Delete</button>
      </td>
    `;

    // input handlers
    tr.querySelectorAll('input').forEach(inp => {
      inp.addEventListener('input', () => {
        const id = inp.getAttribute('data-id');
        const field = inp.getAttribute('data-field');
        const it = state.items.find(x => x.id === id);
        if (!it) return;
        if (field === 'name') it.name = inp.value;
        if (field === 'price') it.price = parseMoney(inp.value);
        computeAndRenderTotals();
        scheduleAutosave();
      });
    });

    // assign pills
    tr.querySelectorAll('.pill').forEach(pill => {
      pill.addEventListener('click', (e) => {
        const pid = pill.getAttribute('data-pid');
        toggleAssignment(item.id, pid, e.shiftKey);
      });
    });

    // quick assign using selected people
    tr.querySelector('.assign')?.addEventListener('dblclick', () => {
      if (activeAssignees.size === 0) return;
      item.assignedTo = Array.from(activeAssignees);
      renderItems();
      computeAndRenderTotals();
      scheduleAutosave();
    });

    tr.querySelector('[data-del]')?.addEventListener('click', () => {
      state.items = state.items.filter(x => x.id !== item.id);
      renderItems();
      computeAndRenderTotals();
      scheduleAutosave();
    });

    els.items.appendChild(tr);
  });
}

function toggleAssignment(itemId, personId, multi){
  const it = state.items.find(x => x.id === itemId);
  if (!it) return;
  const s = new Set(it.assignedTo);

  if (!multi && activeAssignees.size > 0) {
    // If user has selected people above, clicking any pill should assign the active set.
    it.assignedTo = Array.from(activeAssignees);
  } else {
    if (s.has(personId)) s.delete(personId);
    else s.add(personId);
    it.assignedTo = Array.from(s);
  }

  renderItems();
  computeAndRenderTotals();
  scheduleAutosave();
}

function removePerson(personId){
  state.people = state.people.filter(p => p.id !== personId);
  state.items.forEach(it => {
    it.assignedTo = it.assignedTo.filter(pid => pid !== personId);
  });
  activeAssignees.delete(personId);
  renderPeople();
  renderItems();
  computeAndRenderTotals();
  scheduleAutosave();
}

function addPerson(name){
  const trimmed = (name||'').trim();
  if (!trimmed) return;
  // prevent duplicates by name (case-insensitive)
  const exists = state.people.some(p => p.name.trim().toLowerCase() === trimmed.toLowerCase());
  if (exists) return;
  state.people.push({ id: uid('p'), name: trimmed });
  els.personName.value = '';
  renderPeople();
  renderItems();
  computeAndRenderTotals();
  scheduleAutosave();
}

function addBlankItem(){
  state.items.push({ id: uid('i'), name: '', price: 0, assignedTo: [] });
  renderItems();
  computeAndRenderTotals();
  scheduleAutosave();
}

function computeTotals(){
  const people = state.people;
  // Work in integer cents to avoid rounding drift when splitting items.
  const per = new Map(people.map(p => [p.id, { subtotal:0, tax:0, tip:0, total:0 }]));

  let unassignedSubtotal = 0; // cents

  // Item subtotals: split each item across its assignees in cents.
  for (const it of state.items){
    const priceCents = Math.round((Number(it.price)||0) * 100);
    const assignees = (it.assignedTo || []).filter(pid => per.has(pid)).slice().sort();
    if (assignees.length === 0){
      unassignedSubtotal += priceCents;
      continue;
    }
    const base = Math.floor(priceCents / assignees.length);
    const rem = priceCents - base * assignees.length;
    assignees.forEach((pid, idx) => {
      per.get(pid).subtotal += base + (idx < rem ? 1 : 0);
    });
  }

  const taxCents = Math.round((Number(state.tax)||0) * 100);
  const tipCents = Math.round((Number(state.tip)||0) * 100);

  const subtotalSum = Array.from(per.values()).reduce((a,x)=>a + x.subtotal, 0);

  function allocateProportional(totalCents, weights){
    const n = weights.length;
    if (n === 0) return [];
    if (totalCents === 0) return weights.map(() => 0);
    const wSum = weights.reduce((a,b)=>a+b, 0);
    if (wSum <= 0){
      const base = Math.floor(totalCents / Math.max(n,1));
      const rem = totalCents - base*n;
      return weights.map((_,i)=> base + (i < rem ? 1 : 0));
    }
    const raw = weights.map(w => (totalCents * w) / wSum);
    const flo = raw.map(x => Math.floor(x));
    let used = flo.reduce((a,b)=>a+b, 0);
    let rem = totalCents - used;
    const fracIdx = raw
      .map((x,i)=>({i, frac: x - Math.floor(x)}))
      .sort((a,b)=> b.frac - a.frac);
    if (fracIdx.length){
      for (let k=0; k<rem; k++) flo[fracIdx[k % fracIdx.length].i] += 1;
    }
    return flo;
  }

  const ids = people.map(p => p.id);
  const weights = ids.map(id => per.get(id)?.subtotal || 0);
  const taxAlloc = allocateProportional(taxCents, weights);
  const tipAlloc = allocateProportional(tipCents, weights);

  ids.forEach((id, idx) => {
    const t = per.get(id);
    t.tax = taxAlloc[idx] || 0;
    t.tip = tipAlloc[idx] || 0;
    t.total = t.subtotal + t.tax + t.tip;
  });

  const grand = subtotalSum + unassignedSubtotal + taxCents + tipCents; // cents

  // Convert to dollars for rendering.
  const perDollars = new Map();
  for (const [pid, t] of per){
    perDollars.set(pid, {
      subtotal: t.subtotal/100,
      tax: t.tax/100,
      tip: t.tip/100,
      total: t.total/100,
    });
  }

  return { per: perDollars, unassignedSubtotal: unassignedSubtotal/100, grand: grand/100 };
}


function computeAndRenderTotals(){
  const { per, unassignedSubtotal, grand } = computeTotals();
  els.grandTotal.textContent = money(grand);

  els.totals.innerHTML = '';
  state.people.forEach(p => {
    const t = per.get(p.id) || { subtotal:0,tax:0,tip:0,total:0 };
    const div = document.createElement('div');
    div.className = 'totalCard';
    div.innerHTML = `
      <div class="name">${escapeHtml(p.name)}</div>
      <div class="line"><span>Items</span><span>${money(t.subtotal)}</span></div>
      <div class="line"><span>Tax</span><span>${money(t.tax)}</span></div>
      <div class="line"><span>Tip</span><span>${money(t.tip)}</span></div>
      <div class="due"><span>Owes</span><span>${money(t.total)}</span></div>
    `;
    els.totals.appendChild(div);
  });

  if (unassignedSubtotal > 0){
    const div = document.createElement('div');
    div.className = 'totalCard';
    div.innerHTML = `
      <div class="name">Unassigned</div>
      <div class="line"><span>Items not assigned</span><span>${money(unassignedSubtotal)}</span></div>
      <div class="muted tiny" style="margin-top:10px">Assign every item to get accurate splits.</div>
    `;
    els.totals.appendChild(div);
  }
}

function parseReceiptLines(text){
  const lines = String(text||'').split(/\r?\n/).map(l=>l.trim()).filter(Boolean);
  /** @type {Item[]} */
  const items = [];
  let tax = null;
  let tip = null;

  const moneyRe = /(-?\$?\d+(?:[\.,]\d{1,2})?)/;

  for (const line of lines){
    const lower = line.toLowerCase();

    // tax/tip heuristics
    if (/(^|\b)(tax|vat)\b/.test(lower)){
      const m = line.match(moneyRe);
      if (m) tax = parseMoney(m[1]);
      continue;
    }
    if (/(^|\b)(tip|gratuity)\b/.test(lower)){
      const m = line.match(moneyRe);
      if (m) tip = parseMoney(m[1]);
      continue;
    }
    if (/(^|\b)(total|amount due|balance)\b/.test(lower)){
      // ignore totals; we compute.
      continue;
    }

    // item parsing: try "name 12.34" then "12.34 name"
    let name = line;
    let price = null;

    // name ... price (last amount)
    const m1 = line.match(/^(.*?)(-?\$?\d+(?:[\.,]\d{1,2})?)\s*$/);
    if (m1){
      name = m1[1].trim();
      price = parseMoney(m1[2]);
    } else {
      const m2 = line.match(/^(-?\$?\d+(?:[\.,]\d{1,2})?)\s+(.*)$/);
      if (m2){
        price = parseMoney(m2[1]);
        name = m2[2].trim();
      }
    }

    if (price == null || !Number.isFinite(price)) continue;
    if (!name) name = 'Item';

    items.push({ id: uid('i'), name, price, assignedTo: [] });
  }

  return { items, tax, tip };
}

function escapeHtml(s){
  return String(s).replace(/[&<>"']/g, (c)=>({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  }[c]));
}
function escapeAttr(s){
  return escapeHtml(s).replace(/\n/g,' ');
}

let saveTimer = null;
function scheduleAutosave(){
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try{ localStorage.setItem('tabtally_v1', JSON.stringify(state)); }catch{}
    // keep hash in sync too
    setHashFromState();
  }, 200);
}

function loadFromLocalStorage(){
  try{
    const raw = localStorage.getItem('tabtally_v1');
    if (!raw) return false;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return false;
    if (!Array.isArray(parsed.people) || !Array.isArray(parsed.items)) return false;
    state = parsed;
    els.tax.value = state.tax ? Number(state.tax).toFixed(2) : '';
    els.tip.value = state.tip ? Number(state.tip).toFixed(2) : '';
    return true;
  }catch{ return false; }
}

function copyTextToClipboard(text){
  return navigator.clipboard.writeText(text);
}

function buildSummaryText(){
  const { per, unassignedSubtotal, grand } = computeTotals();
  const lines = [];
  lines.push('TabTally — split summary');
  lines.push('');
  for (const p of state.people){
    const t = per.get(p.id);
    lines.push(`${p.name}: ${money(t.total)} (items ${money(t.subtotal)} + tax ${money(t.tax)} + tip ${money(t.tip)})`);
  }
  if (unassignedSubtotal > 0){
    lines.push('');
    lines.push(`Unassigned items: ${money(unassignedSubtotal)}`);
  }
  lines.push('');
  lines.push(`Grand total: ${money(grand)}`);
  return lines.join('\n');
}

function downloadCSV(){
  const { per } = computeTotals();
  const rows = [['Person','Items','Tax','Tip','Total']];
  for (const p of state.people){
    const t = per.get(p.id);
    rows.push([p.name, t.subtotal.toFixed(2), t.tax.toFixed(2), t.tip.toFixed(2), t.total.toFixed(2)]);
  }
  const csv = rows.map(r => r.map(cell => {
    const s = String(cell);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g,'""')}"` : s;
  }).join(',')).join('\n');

  const blob = new Blob([csv], { type:'text/csv' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'tabtally-split.csv';
  document.body.appendChild(a);
  a.click();
  a.remove();
}

// --- events ---
els.btnAddPerson.addEventListener('click', () => addPerson(els.personName.value));
els.personName.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') addPerson(els.personName.value);
});

els.btnAddItem.addEventListener('click', addBlankItem);

// --- OCR receipt scanning (client-side, Tesseract.js) ---
async function downscaleImageFile(file, maxDim=1600){
  const img = new Image();
  const url = URL.createObjectURL(file);
  try{
    await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = url; });
    const w = img.naturalWidth || img.width;
    const h = img.naturalHeight || img.height;
    const scale = Math.min(1, maxDim / Math.max(w, h));
    const cw = Math.max(1, Math.round(w * scale));
    const ch = Math.max(1, Math.round(h * scale));
    const canvas = document.createElement('canvas');
    canvas.width = cw;
    canvas.height = ch;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0, cw, ch);
    return canvas;
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function scanReceiptFromFile(file){
  if (!file) return;
  if (!window.Tesseract){
    alert('OCR library failed to load. Please refresh and try again.');
    return;
  }

  els.parseMsg.textContent = 'Scanning photo… (this can take ~10–30s)';

  try{
    const canvas = await downscaleImageFile(file, 1600);
    const result = await window.Tesseract.recognize(canvas, 'eng', {
      logger: (m) => {
        if (m.status === 'recognizing text' && typeof m.progress === 'number'){
          const pct = Math.round(m.progress * 100);
          els.parseMsg.textContent = `Scanning photo… ${pct}%`;
        }
      }
    });

    const rawText = (result?.data?.text || '').trim();
    if (!rawText){
      els.parseMsg.textContent = 'OCR found no text. Try a clearer photo.';
      setTimeout(()=>{ els.parseMsg.textContent=''; }, 3500);
      return;
    }

    // Put OCR text in the textarea so the user can fix mistakes.
    els.receipt.value = rawText;

    // Try auto-parse immediately; user can also edit and re-parse.
    applyParsedReceipt(parseReceiptLines(rawText), { sourceLabel: 'Scanned' });
  } catch (e){
    console.error(e);
    els.parseMsg.textContent = 'Scan failed. Try again with better lighting / closer crop.';
    setTimeout(()=>{ els.parseMsg.textContent=''; }, 3500);
  }
}

els.btnScan?.addEventListener('click', () => {
  els.scanInput?.click();
});

els.scanInput?.addEventListener('change', async () => {
  const file = els.scanInput.files?.[0];
  await scanReceiptFromFile(file);
  els.scanInput.value = '';
});

function applyParsedReceipt({ items, tax, tip }, { replace=false, sourceLabel='' } = {}){
  const before = state.items.length;
  if (replace) state.items = [];

  if (items.length > 0) state.items.push(...items);

  if (tax != null){
    state.tax = tax;
    els.tax.value = tax.toFixed(2);
  }
  if (tip != null){
    state.tip = tip;
    els.tip.value = tip.toFixed(2);
  }

  renderItems();
  computeAndRenderTotals();
  scheduleAutosave();

  const added = state.items.length - before;
  const label = sourceLabel ? `${sourceLabel}: ` : '';
  els.parseMsg.textContent = added ? `${label}Added ${added} item${added===1?'':'s'}.` : `${label}No items recognized.`;
  setTimeout(()=>{ els.parseMsg.textContent=''; }, 3500);
}

els.btnParse.addEventListener('click', () => {
  applyParsedReceipt(parseReceiptLines(els.receipt.value), { sourceLabel: 'Parsed' });
});

els.btnExample?.addEventListener('click', () => {
  // Quick demo data so first-time users can see the flow.
  state.people = [
    { id: uid('p'), name: 'Alex' },
    { id: uid('p'), name: 'Bea' },
    { id: uid('p'), name: 'Chris' },
  ];
  activeAssignees = new Set();
  state.items = [];
  els.receipt.value = [
    'Tacos 13.50',
    'Chips & salsa 6.00',
    'Soda 3.25',
    'Soda 3.25',
    'Tax 2.10',
    'Tip 5.00',
  ].join('\n');

  applyParsedReceipt(parseReceiptLines(els.receipt.value), { replace:true, sourceLabel:'Example' });

  renderPeople();
});

function onTaxTipInput(){
  state.tax = parseMoney(els.tax.value);
  state.tip = parseMoney(els.tip.value);
  computeAndRenderTotals();
  scheduleAutosave();
}
els.tax.addEventListener('input', onTaxTipInput);
els.tip.addEventListener('input', onTaxTipInput);

els.btnCopyText.addEventListener('click', async () => {
  try{
    await copyTextToClipboard(buildSummaryText());
    els.btnCopyText.textContent = 'Copied!';
    setTimeout(()=>{ els.btnCopyText.textContent='Copy summary'; }, 1200);
  }catch{
    alert('Could not copy. Your browser may block clipboard access.');
  }
});

els.btnDownload.addEventListener('click', downloadCSV);

els.btnShare.addEventListener('click', async () => {
  try{
    setHashFromState();
    await copyTextToClipboard(location.href);
    els.btnShare.textContent = 'Link copied!';
    setTimeout(()=>{ els.btnShare.textContent='Copy share link'; }, 1200);
  }catch{
    alert('Could not copy the link.');
  }
});

els.btnNativeShare?.addEventListener('click', async () => {
  try{
    setHashFromState();
    const url = location.href;
    if (navigator.share){
      await navigator.share({ title: 'TabTally', text: 'Receipt split', url });
      return;
    }
    await copyTextToClipboard(url);
    alert('Share not supported here — copied link instead.');
  }catch{
    // ignore (user cancelled share, etc.)
  }
});

els.btnNew.addEventListener('click', () => {
  if (!confirm('Start a new split? This clears the current receipt in this browser.')) return;
  state = { people:[], items:[], tax:0, tip:0 };
  activeAssignees = new Set();
  els.receipt.value = '';
  els.tax.value = '';
  els.tip.value = '';
  location.hash = '';
  try{ localStorage.removeItem('tabtally_v1'); }catch{}
  renderPeople();
  renderItems();
  computeAndRenderTotals();
});

window.addEventListener('hashchange', () => {
  if (loadStateFromHash()){
    renderPeople();
    renderItems();
    computeAndRenderTotals();
    try{ localStorage.setItem('tabtally_v1', JSON.stringify(state)); }catch{}
  }
});

// --- init ---
(function init(){
  const loadedFromHash = loadStateFromHash();
  if (!loadedFromHash) loadFromLocalStorage();

  renderPeople();
  renderItems();
  computeAndRenderTotals();

  // start with one blank row to guide first-time users
  if (state.items.length === 0) addBlankItem();
})();
