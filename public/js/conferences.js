'use strict';

const { api } = window.UCApi;
const { formatDate, deadlineClass, escapeHtml, renderNavAuth } = window.UCCommon;

let currentUser = null;
let allConferences = [];

function deadlineCell(value) {
  const cls = deadlineClass(value);
  return `<td class="deadline ${cls}">${escapeHtml(formatDate(value))}</td>`;
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
          <td><strong>${escapeHtml(c.name)}</strong>${hiddenBadge}</td>
          ${deadlineCell(c.applicationDeadline)}
          ${deadlineCell(c.abstractDeadline)}
          ${deadlineCell(c.manuscriptDeadline)}
          ${deadlineCell(c.startDate)}
          ${deadlineCell(c.endDate)}
          <td>${escapeHtml(c.location || '—')}</td>
          ${actions}
        </tr>`;
    })
    .join('');
}

function renderAll(list) {
  allConferences = list || [];
  renderTable('domestic', allConferences, 'tbody-domestic');
  renderTable('international', allConferences, 'tbody-international');
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
  const addBtn = document.getElementById('btn-add-conference');
  if (!currentUser) {
    if (addBtn) addBtn.hidden = true;
  } else {
    if (addBtn) {
      addBtn.hidden = false;
      addBtn.addEventListener('click', () => openModal(null));
    }

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
