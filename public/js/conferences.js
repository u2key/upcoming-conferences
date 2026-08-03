'use strict';

const { api } = window.UCApi;
const { formatDate, deadlineClass, escapeHtml, renderNavAuth } = window.UCCommon;

let currentUser = null;
let allConferences = [];
let sortKey = 'nextDeadline';
let sortDir = 1; // 1 = asc, -1 = desc

function deadlineCell(value, label, optional = false) {
  const cls = deadlineClass(value);
  return `<td class="deadline ${cls}${optional ? ' optional' : ''}" data-label="${escapeHtml(label)}">${escapeHtml(formatDate(value))}</td>`;
}

function renderTable(type, rows, tbodyId) {
  const tbody = document.getElementById(tbodyId);
  if (!tbody) return;

  const filtered = rows.filter((c) => c.type === type);
  if (!filtered.length) {
    tbody.innerHTML = `<tr><td colspan="8" class="empty">登録されている学会はありません</td></tr>`;
    return;
  }

  tbody.innerHTML = filtered
    .map((c) => {
      const hiddenClass = c.isHidden ? 'hidden-row' : '';
      const hiddenBadge = c.isHidden
        ? ' <span class="badge badge-hidden">非表示</span>'
        : '';
      let actions = '';
      if (currentUser) {
        const hideBtn = c.isHidden
          ? `<button type="button" class="btn btn-secondary btn-sm" data-action="unhide" data-id="${c.id}">再表示</button>`
          : `<button type="button" class="btn btn-secondary btn-sm" data-action="hide" data-id="${c.id}">非表示</button>`;
        actions = `
          <td class="actions">
            <button type="button" class="btn btn-sm" data-action="edit" data-id="${c.id}">編集</button>
            ${hideBtn}
          </td>`;
      } else {
        actions = `<td></td>`;
      }

      return `
        <tr class="${hiddenClass}" data-id="${c.id}">
          <td data-label="学会名">${c.website ? `<a href="${escapeHtml(c.website)}" target="_blank" rel="noopener noreferrer"><strong>${escapeHtml(c.name)}</strong></a>` : `<strong>${escapeHtml(c.name)}</strong>`}${hiddenBadge}${c.website ? ` <a class="hint" href="${escapeHtml(c.website)}" target="_blank" rel="noopener noreferrer">↗</a>` : ''}</td>
          ${deadlineCell(c.applicationDeadline, '申し込み期限', false)}
          ${deadlineCell(c.abstractDeadline, '抄録提出期限', true)}
          ${deadlineCell(c.manuscriptDeadline, '原稿提出期限', true)}
          ${deadlineCell(c.startDate, '開始日', false)}
          ${deadlineCell(c.endDate, '終了日', true)}
          <td data-label="場所">${escapeHtml(c.location || '—')}</td>
          ${actions.replace('<td class="actions">', '<td class="actions" data-label="操作">')}
        </tr>`;
    })
    .join('');
}

function isEnded(conf) {
  if (!conf || !conf.endDate) return false;
  const end = (conf.endDate || '').slice(0, 10);
  const today = new Date().toISOString().slice(0, 10);
  return end < today;
}

function getNextDeadlineValue(conf) {
  if (!conf) return '';
  const keys = ['applicationDeadline', 'abstractDeadline', 'manuscriptDeadline'];
  const today = new Date().toISOString().slice(0, 10);
  const dates = keys
    .map((k) => (conf[k] ? (conf[k] || '').slice(0, 10) : null))
    .filter(Boolean);
  if (!dates.length) return '';
  // prefer upcoming (>= today)
  const future = dates.filter((d) => d >= today);
  if (future.length) return future.sort()[0];
  // otherwise return the most recent past (largest)
  return dates.sort().slice(-1)[0];
}

function sortConferences() {
  if (!sortKey) return;
  allConferences.sort((a, b) => {
    let va, vb;
    if (sortKey === 'nextDeadline') {
      va = getNextDeadlineValue(a) || '';
      vb = getNextDeadlineValue(b) || '';
    } else {
      va = a[sortKey] || '';
      vb = b[sortKey] || '';
    }
    if (!va && !vb) return 0;
    if (!va) return 1 * sortDir;
    if (!vb) return -1 * sortDir;
    if (va < vb) return -1 * sortDir;
    if (va > vb) return 1 * sortDir;
    return 0;
  });
}

function detectMissingNextYear(list) {
  if (!Array.isArray(list) || !list.length) return [];
  // Helper: normalization for name-based grouping
  function normalizeName(name) {
    if (!name) return '';
    return name
      .toLowerCase()
      .replace(/\(\s*\d{4}\s*\)/g, '') // remove year in parentheses
      .replace(/\d{4}/g, '') // remove stray years
      .replace(/[\s　]+/g, ' ')
      .trim();
  }

  // Build groups by tag if present, else normalized name
  const groups = new Map();
  list.forEach((c) => {
    const key = (c.tag && String(c.tag).trim()) || normalizeName(c.name || '');
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(c);
  });

  const results = [];
  groups.forEach((items, key) => {
    // If key is empty, skip
    if (!key) return;
    // Sort by startDate (fallback to endDate), earliest first
    items.sort((a, b) => {
      const da = (a.startDate || a.endDate || '').slice(0, 10) || '';
      const db = (b.startDate || b.endDate || '').slice(0, 10) || '';
      if (!da && !db) return 0;
      if (!da) return -1;
      if (!db) return 1;
      return da < db ? -1 : da > db ? 1 : 0;
    });

    // For each hidden item, check if there exists a later item (by startDate) in the group
    items.forEach((it) => {
      if (!it.isHidden) return; // only consider hidden conferences
      const itDate = (it.startDate || it.endDate || '').slice(0, 10) || '';
      const hasLater = items.some((x) => {
        if (x.id === it.id) return false;
        const xDate = (x.startDate || x.endDate || '').slice(0, 10) || '';
        if (!xDate) return false;
        if (!itDate) return true; // hidden old without date, but there's some other entry with date -> consider as next exists
        return xDate > itDate;
      });
      if (!hasLater) results.push(it);
    });
  });

  return results;
}

function renderAll(list) {
  // Detect hidden conferences lacking next-year entries (only meaningful for editors)
  try {
    const missing = currentUser ? detectMissingNextYear(list || []) : [];
    const noticeEl = document.getElementById('missing-next-notice');
    if (noticeEl) {
      if (missing.length) {
        noticeEl.hidden = false;
        noticeEl.innerHTML = `非表示の学会で次年度情報が未登録: <strong>${missing.length}</strong> 件。` +
          ` <span class="hint">${missing.map((m) => m.name).slice(0,5).map((n)=>escapeHtml(n)).join(', ')}${missing.length>5? '…':''}</span>` +
          ` <a href="/admin" class="hint">管理画面で確認</a>`;
      } else {
        noticeEl.hidden = true;
        noticeEl.innerHTML = '';
      }
    }
  } catch (e) {
    console.error('detect missing next-year failed', e);
  }

  // Filter out conferences that have already ended for main listing
  allConferences = (list || []).filter((c) => !isEnded(c));
  // Apply sorting if set
  sortConferences();
  renderTable('domestic', allConferences, 'tbody-domestic');
  renderTable('international', allConferences, 'tbody-international');
  // Adjust layout when table content causes overflow
  checkTableOverflow();
}

async function loadConferences() {
  const includeHidden = currentUser ? '1' : '0';
  const data = await api(`/api/conferences?includeHidden=${includeHidden}`);
  renderAll(data.conferences);
}

function setLiveStatus(connected) {
  const el = document.getElementById('live-status');
  if (!el) return;
  el.classList.toggle('connected', connected);
  el.classList.toggle('disconnected', !connected);
  el.querySelector('.live-label').textContent = connected
    ? 'リアルタイム接続中'
    : 'オフライン';
}

function connectSocket() {
  if (typeof io === 'undefined') {
    setLiveStatus(false);
    return null;
  }
  const socket = io({ path: '/socket.io' });
  socket.on('connect', () => setLiveStatus(true));
  socket.on('disconnect', () => setLiveStatus(false));
  socket.on('conferences:update', (payload) => {
    if (payload && Array.isArray(payload.conferences)) {
      // Public socket list excludes hidden; if logged in, re-fetch full list
      if (currentUser) {
        loadConferences().catch(console.error);
      } else {
        renderAll(payload.conferences);
      }
    }
  });
  return socket;
}

// Detect if any table's content overflows its container and switch to stacked layout
function debounce(fn, wait) {
  let t = null;
  return (...args) => {
    if (t) clearTimeout(t);
    t = setTimeout(() => fn(...args), wait);
  };
}

function checkTableOverflow() {
  try {
    const wraps = Array.from(document.querySelectorAll('.table-wrap'));
    let shouldStack = false;
    wraps.forEach((w) => {
      const table = w.querySelector('table.data');
      if (!table) return;
      // Prefer per-row measurement: if any data row's scrollWidth exceeds the wrap width,
      // that row cannot be displayed horizontally without overflow -> switch to stacked.
      const tbody = table.tBodies && table.tBodies[0];
      if (tbody && tbody.rows && tbody.rows.length) {
        for (let i = 0; i < tbody.rows.length; i++) {
          const row = tbody.rows[i];
          // Some environments may report small rounding differences, allow 1px tolerance
          if (row.scrollWidth > w.clientWidth + 1) {
            shouldStack = true;
            break;
          }
        }
      } else {
        // Fallback to table-level check
        if (table.scrollWidth > w.clientWidth + 1) {
          shouldStack = true;
        }
      }
    });
    if (shouldStack) document.body.classList.add('stacked-table');
    else document.body.classList.remove('stacked-table');
  } catch (e) {
    // ignore errors in detection
  }
}

window.addEventListener('resize', debounce(checkTableOverflow, 150));

function setupSorting() {
  const ths = Array.from(document.querySelectorAll('table.data thead th[data-sort-key]'));
  const select = document.getElementById('sort-select');

  function clearIndicators() {
    ths.forEach((t) => {
      t.querySelectorAll('.sort-indicator').forEach((s) => s.remove());
    });
  }

  ths.forEach((th) => {
    // store original text
    th.dataset.orig = th.textContent.trim();
    th.addEventListener('click', () => {
      const key = th.dataset.sortKey;
      if (sortKey === key) {
        sortDir = -sortDir; // toggle
      } else {
        sortKey = key;
        sortDir = 1;
      }
      // update indicators
      clearIndicators();
      const ind = document.createElement('span');
      ind.className = 'sort-indicator';
      ind.textContent = sortDir === 1 ? ' ▲' : ' ▼';
      th.appendChild(ind);

      // reflect in select if present
      if (select) select.value = sortKey;

      sortConferences();
      renderAll(allConferences);
    });
  });

  if (select) {
    // set initial select value
    select.value = sortKey || '';
    select.addEventListener('change', () => {
      const key = select.value || null;
      sortKey = key;
      sortDir = 1;
      clearIndicators();
      // if key corresponds to a header, mark it
      const match = ths.find((t) => t.dataset.sortKey === key);
      if (match) {
        const ind = document.createElement('span');
        ind.className = 'sort-indicator';
        ind.textContent = ' ▲';
        match.appendChild(ind);
      }
      sortConferences();
      renderAll(allConferences);
    });
  }
}

/* ---------- Modal form ---------- */

function openModal(conference) {
  const backdrop = document.getElementById('modal-backdrop');
  const form = document.getElementById('conf-form');
  const title = document.getElementById('modal-title');
  const errEl = document.getElementById('form-error');
  errEl.textContent = '';

  form.reset();
  form.elements.id.value = conference ? conference.id : '';
  title.textContent = conference ? '学会情報の編集' : '学会情報の追加';

  if (conference) {
    form.elements.name.value = conference.name || '';
    form.elements.type.value = conference.type || 'domestic';
    form.elements.applicationDeadline.value = (conference.applicationDeadline || '').slice(0, 10);
    form.elements.abstractDeadline.value = (conference.abstractDeadline || '').slice(0, 10);
    form.elements.manuscriptDeadline.value = (conference.manuscriptDeadline || '').slice(0, 10);
    form.elements.startDate.value = (conference.startDate || '').slice(0, 10);
    form.elements.endDate.value = (conference.endDate || '').slice(0, 10);
    form.elements.location.value = conference.location || '';
    if (form.elements.tag) form.elements.tag.value = conference.tag || '';
  }

  backdrop.hidden = false;
  form.elements.name.focus();
}

function closeModal() {
  document.getElementById('modal-backdrop').hidden = true;
}

function formToBody(form) {
  return {
    name: form.elements.name.value.trim(),
    type: form.elements.type.value,
    applicationDeadline: form.elements.applicationDeadline.value || null,
    abstractDeadline: form.elements.abstractDeadline.value || null,
    manuscriptDeadline: form.elements.manuscriptDeadline.value || null,
    startDate: form.elements.startDate.value || null,
    endDate: form.elements.endDate.value || null,
    website: form.elements.website ? form.elements.website.value.trim() : '',
    tag: form.elements.tag ? form.elements.tag.value.trim() : '',
    location: form.elements.location.value.trim(),
  };
}

async function onSubmitForm(e) {
  e.preventDefault();
  const form = e.target;
  const errEl = document.getElementById('form-error');
  errEl.textContent = '';
  const id = form.elements.id.value;
  const body = formToBody(form);

  try {
    if (id) {
      await api(`/api/conferences/${id}`, { method: 'PUT', body });
    } else {
      await api('/api/conferences', { method: 'POST', body });
    }
    closeModal();
    await loadConferences();
  } catch (err) {
    errEl.textContent = err.message;
  }
}

function onTableClick(e) {
  const btn = e.target.closest('button[data-action]');
  if (!btn) return;
  const id = parseInt(btn.dataset.id, 10);
  const action = btn.dataset.action;
  const conf = allConferences.find((c) => c.id === id);

  if (action === 'edit' && conf) {
    openModal(conf);
  } else if (action === 'hide') {
    api(`/api/conferences/${id}/hide`, { method: 'POST' })
      .then(() => loadConferences())
      .catch((err) => alert(err.message));
  } else if (action === 'unhide') {
    api(`/api/conferences/${id}/unhide`, { method: 'POST' })
      .then(() => loadConferences())
      .catch((err) => alert(err.message));
  }
}

function setupEditorUI() {
  const addBtn1 = document.getElementById('btn-add-conference1');
  const addBtn2 = document.getElementById('btn-add-conference2');
  if (addBtn1) {
    // Always attach handler: redirect viewers to login, editors open the modal
    addBtn1.addEventListener('click', () => {
      if (!currentUser) {
        // Not logged in -> go to login page
        location.href = '/login.html';
        return;
      }
      openModal(null);
    });
    // visibility toggled based on auth state
    addBtn1.hidden = !currentUser;
  }
  if (addBtn2) {
    // Always attach handler: redirect viewers to login, editors open the modal
    addBtn2.addEventListener('click', () => {
      if (!currentUser) {
        // Not logged in -> go to login page
        location.href = '/login.html';
        return;
      }
      openModal(null);
    });
    // visibility toggled based on auth state
    addBtn2.hidden = !currentUser;
  }

  if (currentUser) {
    document.getElementById('conf-form').addEventListener('submit', onSubmitForm);
    document.getElementById('btn-cancel-modal').addEventListener('click', closeModal);
    document.getElementById('modal-backdrop').addEventListener('click', (e) => {
      if (e.target.id === 'modal-backdrop') closeModal();
    });
  }

  // Always attach table click handlers so viewers can interact safely (no edit buttons shown)
  const tbodyDom = document.getElementById('tbody-domestic');
  if (tbodyDom) tbodyDom.addEventListener('click', onTableClick);
  const tbodyIntl = document.getElementById('tbody-international');
  if (tbodyIntl) tbodyIntl.addEventListener('click', onTableClick);
}

async function main() {
  currentUser = await renderNavAuth();
  setupEditorUI();
  setupSorting();
  try {
    await loadConferences();
  } catch (err) {
    console.error(err);
    document.getElementById('tbody-domestic').innerHTML =
      `<tr><td colspan="8" class="empty">読み込みに失敗しました: ${escapeHtml(err.message)}</td></tr>`;
  }
  connectSocket();
}

document.addEventListener('DOMContentLoaded', main);
