// ── パスワード認証 ────────────────────────────────────────────
const PASSWORD = 'Puitan09'; // ← ここをあなたのパスワードに書き換えてください

function checkAuth() {
  if (sessionStorage.getItem('wardrobe_auth') === 'ok') {
    unlock();
    return;
  }
  document.getElementById('btn-unlock').addEventListener('click', tryUnlock);
  document.getElementById('password-input').addEventListener('keydown', e => {
    if (e.key === 'Enter') tryUnlock();
  });
}

function tryUnlock() {
  const input = document.getElementById('password-input').value;
  if (input === PASSWORD) {
    sessionStorage.setItem('wardrobe_auth', 'ok');
    unlock();
  } else {
    document.getElementById('lock-error').classList.remove('hidden');
    document.getElementById('password-input').value = '';
    document.getElementById('password-input').focus();
  }
}

function unlock() {
  document.getElementById('lock-screen').classList.add('hidden');
  document.getElementById('app').classList.remove('hidden');
}

// ── Dropbox API ───────────────────────────────────────────────
const DBX_APP_KEY     = '60saj2jkegwrdlm';
const DBX_REDIRECT    = 'https://pentan1989-create.github.io/my-wardrobe/';
const DBX_FILE        = '/wardrobe_data.json';

function dbxConnected() { return !!localStorage.getItem('dbx_token'); }

function b64url(buf) {
  return btoa(String.fromCharCode(...new Uint8Array(buf)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

async function dbxConnect() {
  const verifier = b64url(crypto.getRandomValues(new Uint8Array(32)));
  const state   = b64url(crypto.getRandomValues(new Uint8Array(16)));
  const challenge = b64url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)));
  sessionStorage.setItem('dbx_verifier', verifier);
  sessionStorage.setItem('dbx_state', state);
  const p = new URLSearchParams({
    client_id: DBX_APP_KEY, response_type: 'code',
    code_challenge: challenge, code_challenge_method: 'S256',
    redirect_uri: DBX_REDIRECT, token_access_type: 'online',
    state,
  });
  location.href = `https://www.dropbox.com/oauth2/authorize?${p}`;
}

async function dbxExchangeCode(code) {
  const res = await fetch('https://api.dropboxapi.com/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code, grant_type: 'authorization_code',
      code_verifier: sessionStorage.getItem('dbx_verifier'),
      redirect_uri: DBX_REDIRECT, client_id: DBX_APP_KEY,
    }),
  });
  const d = await res.json();
  if (d.access_token) {
    localStorage.setItem('dbx_token', d.access_token);
    sessionStorage.removeItem('dbx_verifier');
    sessionStorage.removeItem('dbx_state');
    return true;
  }
  return false;
}


async function dbxUpload(data) {
  if (!dbxConnected()) return;
  const res = await fetch('https://content.dropboxapi.com/2/files/upload', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${localStorage.getItem('dbx_token')}`,
      'Dropbox-API-Arg': JSON.stringify({ path: DBX_FILE, mode: 'overwrite', mute: true }),
      'Content-Type': 'application/octet-stream',
    },
    body: JSON.stringify(data),
  });
  if (res.status === 401) { dbxDisconnect(); toast('Dropboxの接続が切れました。再接続してください'); }
}

async function dbxDownload() {
  if (!dbxConnected()) return null;
  const res = await fetch('https://content.dropboxapi.com/2/files/download', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${localStorage.getItem('dbx_token')}`,
      'Dropbox-API-Arg': JSON.stringify({ path: DBX_FILE }),
    },
  });
  if (res.status === 401) { dbxDisconnect(); return null; }
  if (!res.ok) return null;
  try { return await res.json(); } catch { return null; }
}

function dbxDisconnect() {
  localStorage.removeItem('dbx_token');
  updateDropboxStatus();
  toast('Dropbox連携を解除しました');
}

function updateDropboxStatus() {
  const el = document.getElementById('dropbox-status');
  if (!el) return;
  if (dbxConnected()) {
    el.innerHTML = `
      <p style="font-size:13px;color:#2e7d32;margin-bottom:10px">✅ 連携中 — 変更が自動でDropboxに保存されます</p>
      <button class="btn-secondary" onclick="dbxDisconnect()" style="width:100%">連携を解除する</button>`;
  } else {
    el.innerHTML = `
      <p style="font-size:13px;color:var(--text-sub);margin-bottom:10px">MacとiPadで同じデータを自動同期します。</p>
      <button class="btn-dropbox" onclick="dbxConnect()">Dropboxと連携する</button>`;
  }
}

// ── Data ─────────────────────────────────────────────────────
const STORAGE_KEY = 'wardrobe_v1';

function getData() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY)) || { items: [], outfits: [], wearLogs: [] };
  } catch { return { items: [], outfits: [], wearLogs: [] }; }
}

function saveData(d) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(d));
  dbxUpload(d);
}

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function daysSince(dateStr) {
  if (!dateStr) return 9999;
  return Math.floor((Date.now() - new Date(dateStr)) / 86400000);
}

// ── Category helpers ──────────────────────────────────────────
const CAT_LABEL = {
  tops: 'トップス', bottoms: 'ボトムス', outer: 'アウター',
  dress: 'ワンピース', shoes: '靴', bag: 'バッグ',
  accessory: '小物', other: 'その他'
};
const CAT_ICON = {
  tops: '👕', bottoms: '👖', outer: '🧥', dress: '👗',
  shoes: '👟', bag: '👜', accessory: '💍', other: '📦'
};
const icon = c => CAT_ICON[c] || '📦';
const label = c => CAT_LABEL[c] || c;

// ── Security helpers ──────────────────────────────────────────
function escapeHTML(v) {
  return String(v ?? '')
    .replaceAll('&', '&amp;').replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;').replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}
function cleanText(v, max = 100) { return String(v ?? '').slice(0, max); }
function cleanNumber(v, fb = 0) { const n = Number(v); return Number.isFinite(n) ? n : fb; }
function cleanId(v) { return String(v ?? '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 30); }
function cleanPhoto(v) {
  if (typeof v !== 'string') return null;
  if (!/^data:image\/(jpeg|png|webp);base64,/i.test(v)) return null;
  if (v.length > 2_000_000) return null;
  return v;
}
function sanitizeImportedData(data) {
  return {
    items: Array.isArray(data.items) ? data.items.slice(0, 500).map(item => ({
      id: cleanId(item.id), name: cleanText(item.name, 100),
      category: cleanText(item.category, 20), color: cleanText(item.color, 20),
      brand: cleanText(item.brand, 50), notes: cleanText(item.notes, 500),
      photo: cleanPhoto(item.photo), wearCount: cleanNumber(item.wearCount),
      lastWorn: cleanText(item.lastWorn, 10), addedDate: cleanText(item.addedDate, 10),
    })) : [],
    outfits: Array.isArray(data.outfits) ? data.outfits.slice(0, 200).map(o => ({
      id: cleanId(o.id), name: cleanText(o.name, 100),
      occasion: cleanText(o.occasion, 30),
      items: Array.isArray(o.items) ? o.items.slice(0, 20).map(id => cleanId(id)) : [],
      wearCount: cleanNumber(o.wearCount), lastWorn: cleanText(o.lastWorn, 10),
      addedDate: cleanText(o.addedDate, 10),
    })) : [],
    wearLogs: Array.isArray(data.wearLogs) ? data.wearLogs.slice(0, 1000).map(log => ({
      date: cleanText(log.date, 10),
      itemIds: Array.isArray(log.itemIds) ? log.itemIds.slice(0, 20).map(id => cleanId(id)) : [],
      outfitId: log.outfitId ? cleanId(log.outfitId) : null,
    })) : [],
  };
}

// ── Navigation ────────────────────────────────────────────────
document.querySelectorAll('.nav-btn').forEach(btn => {
  btn.addEventListener('click', () => switchView(btn.dataset.view));
});

function switchView(view) {
  document.querySelectorAll('.nav-btn').forEach(b =>
    b.classList.toggle('active', b.dataset.view === view));
  document.querySelectorAll('.view').forEach(v =>
    v.classList.toggle('active', v.id === `view-${view}`));
  if (view === 'closet')   renderCloset();
  if (view === 'outfits')  renderOutfits();
  if (view === 'today')    renderToday();
  if (view === 'declutter') renderDeclutter();
}

// ── Modal helpers ─────────────────────────────────────────────
function openModal(id) { document.getElementById(id).classList.remove('hidden'); }
function closeModal(id) { document.getElementById(id).classList.add('hidden'); }
function closeAllModals() {
  document.querySelectorAll('.modal').forEach(m => m.classList.add('hidden'));
}

document.querySelectorAll('.modal-close-btn').forEach(btn => {
  btn.addEventListener('click', () => closeModal(btn.dataset.modal));
});
document.querySelectorAll('.modal').forEach(m => {
  m.addEventListener('click', e => { if (e.target === m) closeAllModals(); });
});

// ── Toast ─────────────────────────────────────────────────────
let toastTimer;
function toast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add('hidden'), 2500);
}

// ── Image compression ─────────────────────────────────────────
function compressImage(dataUrl, maxPx, cb) {
  const img = new Image();
  img.onload = () => {
    let { width: w, height: h } = img;
    if (w > h ? w > maxPx : h > maxPx) {
      if (w > h) { h = h * maxPx / w; w = maxPx; }
      else       { w = w * maxPx / h; h = maxPx; }
    }
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    c.getContext('2d').drawImage(img, 0, 0, w, h);
    cb(c.toDataURL('image/jpeg', 0.72));
  };
  img.src = dataUrl;
}

// ── Closet ────────────────────────────────────────────────────
let activeCategory = 'all';

document.getElementById('filter-tabs').addEventListener('click', e => {
  const btn = e.target.closest('.filter-btn');
  if (!btn) return;
  activeCategory = btn.dataset.cat;
  document.querySelectorAll('.filter-btn').forEach(b =>
    b.classList.toggle('active', b === btn));
  renderCloset();
});

function renderCloset() {
  const { items } = getData();
  const list = activeCategory === 'all' ? items : items.filter(i => i.category === activeCategory);
  const grid = document.getElementById('items-grid');
  if (!list.length) {
    grid.innerHTML = `<div class="empty-state"><div class="empty-icon">👕</div><p>アイテムがまだありません</p></div>`;
    return;
  }
  grid.innerHTML = list.map(item => `
    <div class="item-card" onclick="openItemDetail('${item.id}')">
      <div class="item-thumb">
        ${item.photo ? `<img src="${item.photo}" alt="">` : icon(item.category)}
      </div>
      <div class="item-info">
        <div class="item-name">${escapeHTML(item.name)}</div>
        <div class="item-meta">
          <span>${escapeHTML(item.color || '')}</span>
          <span>× ${item.wearCount || 0}</span>
        </div>
      </div>
    </div>
  `).join('');
}

// ── Add / Edit item ───────────────────────────────────────────
let editingItemId = null;
let pendingPhoto = null;

document.getElementById('btn-add-item').addEventListener('click', () => openItemModal());

function openItemModal(itemId = null) {
  editingItemId = itemId;
  pendingPhoto = null;
  const form = document.getElementById('form-item');
  form.reset();
  const preview = document.getElementById('photo-preview');
  const ph = document.getElementById('photo-placeholder');
  preview.classList.add('hidden');
  ph.style.display = '';

  if (itemId) {
    const item = getData().items.find(i => i.id === itemId);
    if (item) {
      document.getElementById('modal-item-title').textContent = 'アイテムを編集';
      document.getElementById('item-name').value = item.name;
      document.getElementById('item-category').value = item.category;
      document.getElementById('item-color').value = item.color || '';
      document.getElementById('item-brand').value = item.brand || '';
      document.getElementById('item-notes').value = item.notes || '';
      if (item.photo) {
        pendingPhoto = item.photo;
        preview.src = item.photo;
        preview.classList.remove('hidden');
        ph.style.display = 'none';
      }
    }
  } else {
    document.getElementById('modal-item-title').textContent = 'アイテムを追加';
  }
  openModal('modal-item');
}

document.getElementById('photo-area').addEventListener('click', () =>
  document.getElementById('photo-input').click());

document.getElementById('photo-input').addEventListener('change', e => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = ev => compressImage(ev.target.result, 600, url => {
    pendingPhoto = url;
    const preview = document.getElementById('photo-preview');
    preview.src = url;
    preview.classList.remove('hidden');
    document.getElementById('photo-placeholder').style.display = 'none';
  });
  reader.readAsDataURL(file);
});

document.getElementById('form-item').addEventListener('submit', e => {
  e.preventDefault();
  const data = getData();
  const payload = {
    name: document.getElementById('item-name').value.trim(),
    category: document.getElementById('item-category').value,
    color: document.getElementById('item-color').value,
    brand: document.getElementById('item-brand').value.trim(),
    notes: document.getElementById('item-notes').value.trim(),
    photo: pendingPhoto,
  };
  if (editingItemId) {
    const idx = data.items.findIndex(i => i.id === editingItemId);
    if (idx !== -1) data.items[idx] = { ...data.items[idx], ...payload };
    toast('更新しました');
  } else {
    data.items.push({ id: uid(), ...payload, wearCount: 0, lastWorn: null, addedDate: today() });
    toast('追加しました');
  }
  saveData(data);
  closeAllModals();
  renderCloset();
});

// ── Item detail ───────────────────────────────────────────────
let detailId = null;

function openItemDetail(itemId) {
  detailId = itemId;
  const item = getData().items.find(i => i.id === itemId);
  if (!item) return;
  document.getElementById('detail-name').textContent = item.name;
  document.getElementById('detail-body').innerHTML = `
    <div class="detail-photo">
      ${item.photo ? `<img src="${item.photo}" alt="">` : icon(item.category)}
    </div>
    <div class="detail-stats">
      <div class="stat-box">
        <div class="stat-val">${item.wearCount || 0}</div>
        <div class="stat-lbl">着用回数</div>
      </div>
      <div class="stat-box">
        <div class="stat-val">${item.lastWorn ? daysSince(item.lastWorn) + '日前' : '—'}</div>
        <div class="stat-lbl">最終着用</div>
      </div>
    </div>
    <div class="detail-tags">
      ${item.category ? `<span class="detail-tag">${label(item.category)}</span>` : ''}
      ${item.color    ? `<span class="detail-tag">${escapeHTML(item.color)}</span>` : ''}
      ${item.brand    ? `<span class="detail-tag">${escapeHTML(item.brand)}</span>` : ''}
    </div>
    ${item.notes ? `<p style="font-size:14px;color:var(--text-sub)">${escapeHTML(item.notes)}</p>` : ''}
  `;
  openModal('modal-detail');
}

document.getElementById('btn-detail-wear').addEventListener('click', () => {
  if (!detailId) return;
  recordWear([detailId]);
  closeAllModals();
  toast('着用記録しました！');
  renderCloset();
});

document.getElementById('btn-detail-edit').addEventListener('click', () => {
  closeAllModals();
  openItemModal(detailId);
});

document.getElementById('btn-detail-delete').addEventListener('click', () => {
  if (!confirm('このアイテムを削除しますか？')) return;
  const data = getData();
  data.items = data.items.filter(i => i.id !== detailId);
  saveData(data);
  closeAllModals();
  toast('削除しました');
  renderCloset();
});

// ── Outfits ───────────────────────────────────────────────────
function renderOutfits() {
  const { outfits, items } = getData();
  const el = document.getElementById('outfits-list');
  if (!outfits.length) {
    el.innerHTML = `<div class="empty-state" style="display:block"><div class="empty-icon">✨</div><p>コーデがまだありません</p></div>`;
    return;
  }
  el.innerHTML = outfits.map(o => {
    const oItems = o.items.map(id => items.find(i => i.id === id)).filter(Boolean);
    return `
      <div class="outfit-card" onclick="openOutfitDetail('${o.id}')">
        <div class="outfit-card-head">
          <span class="outfit-card-name">${escapeHTML(o.name)}</span>
          ${o.occasion ? `<span class="occasion-badge">${escapeHTML(o.occasion)}</span>` : ''}
        </div>
        <div class="outfit-thumbs">
          ${oItems.map(item => `
            <div class="outfit-thumb">
              ${item.photo ? `<img src="${item.photo}" alt="">` : icon(item.category)}
            </div>
          `).join('')}
        </div>
        <div class="outfit-card-foot">
          <span>着用 ${o.wearCount || 0}回</span>
          <span>${o.lastWorn || '未着用'}</span>
        </div>
      </div>
    `;
  }).join('');
}

document.getElementById('btn-add-outfit').addEventListener('click', () => openOutfitModal());

let editingOutfitId = null;
let selectedItems = new Set();

function openOutfitModal(outfitId = null) {
  editingOutfitId = outfitId;
  selectedItems = new Set();
  document.getElementById('outfit-name').value = '';
  document.getElementById('outfit-occasion').value = '';

  if (outfitId) {
    const o = getData().outfits.find(x => x.id === outfitId);
    if (o) {
      document.getElementById('modal-outfit-title').textContent = 'コーデを編集';
      document.getElementById('outfit-name').value = o.name;
      document.getElementById('outfit-occasion').value = o.occasion || '';
      o.items.forEach(id => selectedItems.add(id));
    }
  } else {
    document.getElementById('modal-outfit-title').textContent = 'コーデを作る';
  }
  renderOutfitSelector();
  openModal('modal-outfit');
}

function renderOutfitSelector() {
  const { items } = getData();
  document.getElementById('outfit-selector').innerHTML = items.map(item => `
    <div class="outfit-sel-row ${selectedItems.has(item.id) ? 'selected' : ''}"
         onclick="toggleOutfitItem('${item.id}')">
      <div class="outfit-sel-thumb">
        ${item.photo ? `<img src="${item.photo}" alt="">` : icon(item.category)}
      </div>
      <div>
        <div class="outfit-sel-name">${escapeHTML(item.name)}</div>
        <div class="outfit-sel-cat">${label(item.category)}</div>
      </div>
    </div>
  `).join('');
  refreshSelectedDisplay();
}

function toggleOutfitItem(id) {
  selectedItems.has(id) ? selectedItems.delete(id) : selectedItems.add(id);
  document.querySelectorAll(`.outfit-sel-row[onclick="toggleOutfitItem('${id}')"]`)
    .forEach(el => el.classList.toggle('selected', selectedItems.has(id)));
  refreshSelectedDisplay();
}

function refreshSelectedDisplay() {
  const { items } = getData();
  const el = document.getElementById('outfit-selected');
  const selected = [...selectedItems].map(id => items.find(i => i.id === id)).filter(Boolean);
  el.innerHTML = selected.length
    ? selected.map(item => `<span class="sel-chip">${icon(item.category)} ${escapeHTML(item.name)}</span>`).join('')
    : `<span class="placeholder-text">アイテムを選んでください</span>`;
}

document.getElementById('form-outfit').addEventListener('submit', e => {
  e.preventDefault();
  if (!selectedItems.size) { toast('アイテムを選んでください'); return; }
  const data = getData();
  const payload = {
    name: document.getElementById('outfit-name').value.trim() || '無名コーデ',
    occasion: document.getElementById('outfit-occasion').value,
    items: [...selectedItems],
  };
  if (editingOutfitId) {
    const idx = data.outfits.findIndex(o => o.id === editingOutfitId);
    if (idx !== -1) data.outfits[idx] = { ...data.outfits[idx], ...payload };
    toast('コーデを更新しました');
  } else {
    data.outfits.push({ id: uid(), ...payload, wearCount: 0, lastWorn: null, addedDate: today() });
    toast('コーデを保存しました');
  }
  saveData(data);
  closeAllModals();
  renderOutfits();
});

// ── Outfit detail ─────────────────────────────────────────────
let detailOutfitId = null;

function openOutfitDetail(outfitId) {
  detailOutfitId = outfitId;
  const { outfits, items } = getData();
  const o = outfits.find(x => x.id === outfitId);
  if (!o) return;
  const oItems = o.items.map(id => items.find(i => i.id === id)).filter(Boolean);
  document.getElementById('outfit-detail-name').textContent = o.name;
  document.getElementById('outfit-detail-body').innerHTML = `
    <div class="outfit-thumbs" style="margin-bottom:16px">
      ${oItems.map(item => `
        <div class="outfit-thumb" style="width:72px;height:72px">
          ${item.photo ? `<img src="${item.photo}" alt="">` : icon(item.category)}
        </div>
      `).join('')}
    </div>
    <div class="detail-stats">
      <div class="stat-box">
        <div class="stat-val">${o.wearCount || 0}</div>
        <div class="stat-lbl">着用回数</div>
      </div>
      <div class="stat-box">
        <div class="stat-val">${o.lastWorn ? daysSince(o.lastWorn) + '日前' : '—'}</div>
        <div class="stat-lbl">最終着用</div>
      </div>
    </div>
    <div class="detail-tags">
      ${o.occasion ? `<span class="detail-tag">${escapeHTML(o.occasion)}</span>` : ''}
      ${oItems.map(i => `<span class="detail-tag">${escapeHTML(i.name)}</span>`).join('')}
    </div>
  `;
  openModal('modal-outfit-detail');
}

document.getElementById('btn-outfit-wear').addEventListener('click', () => {
  if (!detailOutfitId) return;
  const data = getData();
  const o = data.outfits.find(x => x.id === detailOutfitId);
  if (!o) return;
  const d = today();
  o.wearCount = (o.wearCount || 0) + 1;
  o.lastWorn = d;
  recordWear(o.items, detailOutfitId, data);
  saveData(data);
  closeAllModals();
  toast(`「${o.name}」を記録しました！`);
  renderOutfits();
});

document.getElementById('btn-outfit-edit').addEventListener('click', () => {
  closeAllModals();
  openOutfitModal(detailOutfitId);
});

document.getElementById('btn-outfit-delete').addEventListener('click', () => {
  if (!confirm('このコーデを削除しますか？')) return;
  const data = getData();
  data.outfits = data.outfits.filter(o => o.id !== detailOutfitId);
  saveData(data);
  closeAllModals();
  toast('削除しました');
  renderOutfits();
});

// ── Wear recording ────────────────────────────────────────────
function recordWear(itemIds, outfitId = null, data = null) {
  const save = data === null;
  if (!data) data = getData();
  const d = today();
  itemIds.forEach(id => {
    const item = data.items.find(i => i.id === id);
    if (item) { item.wearCount = (item.wearCount || 0) + 1; item.lastWorn = d; }
  });
  const log = data.wearLogs.find(l => l.date === d);
  if (log) {
    if (outfitId) log.outfitId = outfitId;
    itemIds.forEach(id => { if (!log.itemIds.includes(id)) log.itemIds.push(id); });
  } else {
    data.wearLogs.push({ date: d, itemIds: [...itemIds], outfitId });
  }
  if (save) saveData(data);
}

// ── Today ─────────────────────────────────────────────────────
let todaySelected = new Set();

function renderToday() {
  const d = new Date();
  const dayNames = ['日','月','火','水','木','金','土'];
  document.getElementById('today-date').textContent =
    `${d.getMonth()+1}月${d.getDate()}日（${dayNames[d.getDay()]}）`;

  const { outfits, items, wearLogs } = getData();

  // Outfit buttons
  const outfitEl = document.getElementById('today-outfit-list');
  outfitEl.innerHTML = outfits.length
    ? outfits.map(o => `
        <button class="today-outfit-btn" onclick="logOutfit('${o.id}')">
          ${escapeHTML(o.name)}${o.occasion ? ` · ${escapeHTML(o.occasion)}` : ''}
        </button>
      `).join('')
    : '<p style="font-size:13px;color:var(--text-sub)">コーデが登録されていません</p>';

  // Item chips
  todaySelected = new Set();
  document.getElementById('today-chips').innerHTML = items.map(item => `
    <button class="chip" data-id="${item.id}" onclick="toggleTodayItem('${item.id}')">
      ${icon(item.category)} ${escapeHTML(item.name)}
    </button>
  `).join('');

  renderTodayLog();
}

function toggleTodayItem(id) {
  todaySelected.has(id) ? todaySelected.delete(id) : todaySelected.add(id);
  document.querySelectorAll(`.chip[data-id="${id}"]`)
    .forEach(el => el.classList.toggle('selected', todaySelected.has(id)));
}

document.getElementById('btn-log-items').addEventListener('click', () => {
  if (!todaySelected.size) { toast('アイテムを選んでください'); return; }
  recordWear([...todaySelected]);
  todaySelected.forEach(id => {
    document.querySelectorAll(`.chip[data-id="${id}"]`).forEach(el => el.classList.remove('selected'));
  });
  todaySelected.clear();
  toast('記録しました！');
  renderTodayLog();
});

function logOutfit(outfitId) {
  const data = getData();
  const o = data.outfits.find(x => x.id === outfitId);
  if (!o) return;
  o.wearCount = (o.wearCount || 0) + 1;
  o.lastWorn = today();
  recordWear(o.items, outfitId, data);
  saveData(data);
  toast(`「${o.name}」を記録しました！`);
  renderTodayLog();
}

function renderTodayLog() {
  const { wearLogs, items, outfits } = getData();
  const log = wearLogs.find(l => l.date === today());
  const el = document.getElementById('today-log');
  if (!log || !log.itemIds.length) {
    el.innerHTML = '<p style="font-size:13px;color:var(--text-sub)">まだ記録がありません</p>';
    return;
  }
  const names = log.itemIds.map(id => items.find(i => i.id === id)?.name).filter(Boolean);
  const outfit = log.outfitId ? outfits.find(o => o.id === log.outfitId) : null;
  el.innerHTML = `
    <div class="log-entry">
      ${outfit ? `<div style="font-weight:600;margin-bottom:4px">${escapeHTML(outfit.name)}</div>` : ''}
      <div class="log-sub">${names.map(n => escapeHTML(n)).join(' · ')}</div>
    </div>
  `;
}

// ── Declutter ─────────────────────────────────────────────────
function renderDeclutter() {
  const days = parseInt(document.getElementById('declutter-days').value);
  const { items } = getData();
  const stale = items.filter(item => {
    const ref = item.lastWorn || item.addedDate;
    return daysSince(ref) >= days;
  });
  const grid = document.getElementById('declutter-grid');
  if (!stale.length) {
    grid.innerHTML = `<div class="empty-state"><div class="empty-icon">🎉</div><p>該当なし！しっかり活用できています</p></div>`;
    return;
  }
  grid.innerHTML = stale.map(item => `
    <div class="item-card" onclick="openItemDetail('${item.id}')">
      <div class="item-thumb">
        ${item.photo ? `<img src="${item.photo}" alt="">` : icon(item.category)}
      </div>
      <div class="item-info">
        <div class="item-name">${escapeHTML(item.name)}</div>
        <div class="item-meta">
          <span>${escapeHTML(item.color || '')}</span>
          <span>${daysSince(item.lastWorn || item.addedDate)}日前</span>
        </div>
      </div>
    </div>
  `).join('');
}

document.getElementById('declutter-days').addEventListener('change', renderDeclutter);

// ── Export / Claude連携 ───────────────────────────────────────
document.getElementById('btn-export').addEventListener('click', () => {
  document.getElementById('export-text').value = buildMarkdown();
  updateDropboxStatus();
  openModal('modal-export');
});

// JSON download
document.getElementById('btn-download-json').addEventListener('click', () => {
  const data = getData();
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `wardrobe_backup_${today()}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
  toast('ダウンロードしました。Dropboxフォルダに移動してください');
});

// JSON import
document.getElementById('btn-import-json').addEventListener('click', () =>
  document.getElementById('import-input').click());

document.getElementById('import-input').addEventListener('change', e => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = ev => {
    try {
      const raw = JSON.parse(ev.target.result);
      if (!raw.items || !raw.outfits) throw new Error();
      if (!confirm(`データを復元します。\n現在のデータはすべて上書きされます。\nよろしいですか？`)) return;
      saveData(sanitizeImportedData(raw));
      closeAllModals();
      toast('復元しました！');
      renderCloset();
    } catch {
      toast('ファイルが正しくありません');
    }
  };
  reader.readAsText(file);
  e.target.value = '';
});

document.getElementById('export-include-notes').addEventListener('change', () => {
  document.getElementById('export-text').value = buildMarkdown();
});

document.getElementById('btn-copy-export').addEventListener('click', () => {
  navigator.clipboard.writeText(document.getElementById('export-text').value)
    .then(() => { toast('コピーしました！Claudeに貼り付けてください'); closeAllModals(); })
    .catch(() => toast('コピーに失敗しました'));
});

function buildMarkdown() {
  const { items, outfits } = getData();
  const includeNotes = document.getElementById('export-include-notes')?.checked ?? false;
  const d = today();
  let md = `# ワードローブデータ\n更新: ${d}\n\n`;
  md += `## アイテム一覧（${items.length}点）\n\n`;

  const byCategory = {};
  items.forEach(item => {
    const cat = item.category || 'other';
    (byCategory[cat] = byCategory[cat] || []).push(item);
  });
  Object.entries(byCategory).forEach(([cat, list]) => {
    md += `### ${label(cat)}\n`;
    list.forEach(item => {
      md += `- **${item.name}**`;
      if (item.color)    md += ` / ${item.color}`;
      if (item.brand)    md += ` / ${item.brand}`;
      md += ` / 着用${item.wearCount || 0}回`;
      if (item.lastWorn) md += ` / 最終着用: ${item.lastWorn}`;
      if (includeNotes && item.notes) md += ` / ${item.notes}`;
      md += '\n';
    });
    md += '\n';
  });

  if (outfits.length) {
    md += `## 登録済みコーデ（${outfits.length}件）\n\n`;
    outfits.forEach(o => {
      const oItems = o.items.map(id => items.find(i => i.id === id)).filter(Boolean);
      md += `### ${o.name}${o.occasion ? ` [${o.occasion}]` : ''}\n`;
      oItems.forEach(i => { md += `- ${i.name}（${label(i.category)}）\n`; });
      md += '\n';
    });
  }

  const threshold = new Date(Date.now() - 90 * 86400000).toISOString().slice(0, 10);
  const stale = items.filter(item => {
    const ref = item.lastWorn || item.addedDate;
    return !ref || ref < threshold;
  });
  if (stale.length) {
    md += `## 断捨離候補（90日以上未着用）\n\n`;
    stale.forEach(item => {
      md += `- ${item.name}（${label(item.category)}）`;
      if (item.lastWorn) md += ` / 最終: ${item.lastWorn}`;
      md += '\n';
    });
    md += '\n';
  }

  md += `---\n以上のワードローブデータをもとに、コーデ提案や断捨離アドバイスをお願いします。`;
  return md;
}

// ── Skills ───────────────────────────────────────────────────
document.getElementById('btn-copy-suggest').addEventListener('click', () => {
  const tpo = document.getElementById('suggest-tpo').value.trim();
  const command = `/wardrobe-suggest${tpo ? ' ' + tpo : ''}`;
  const markdown = buildMarkdown();
  const text = `${command}\n\n${markdown}`;
  navigator.clipboard.writeText(text)
    .then(() => toast('コピーしました！Claude Codeに貼り付けてください'))
    .catch(() => toast('コピーに失敗しました'));
});

document.getElementById('btn-copy-review').addEventListener('click', () => {
  const comment = document.getElementById('review-comment').value.trim();
  const text = `/wardrobe-review${comment ? ' ' + comment : ''}`;
  navigator.clipboard.writeText(text)
    .then(() => toast('コピーしました！Claude Codeに貼り付けて写真も添付してください'))
    .catch(() => toast('コピーに失敗しました'));
});

// ── Init ──────────────────────────────────────────────────────
async function init() {
  checkAuth();

  const params = new URLSearchParams(location.search);
  const code = params.get('code');
  const returnedState = params.get('state');
  if (code) {
    history.replaceState({}, '', location.pathname);
    const savedState = sessionStorage.getItem('dbx_state');
    if (!savedState || savedState !== returnedState) {
      toast('認証エラー: 不正なリクエストです');
    } else {
      const ok = await dbxExchangeCode(code);
      if (ok) {
        const cloud = await dbxDownload();
        if (cloud?.items) { localStorage.setItem(STORAGE_KEY, JSON.stringify(sanitizeImportedData(cloud))); }
        toast('Dropboxと連携しました！');
      }
    }
  } else if (dbxConnected()) {
    const cloud = await dbxDownload();
    if (cloud?.items) { localStorage.setItem(STORAGE_KEY, JSON.stringify(sanitizeImportedData(cloud))); }
  }

  renderCloset();
}

init();
