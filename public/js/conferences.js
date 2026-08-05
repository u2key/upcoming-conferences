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
          <td data-label="学会名">${c.website ? `<a href="${escapeHtml(c.website)}" target="_blank" rel="noopener noreferrer"><strong>${escapeHtml(c.name)}</strong></a>` : `<strong>${escapeHtml(c.name)}</strong>`}${hiddenBadge}</td>
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

/**
 * Navigate to `url` the way `target="_blank"` would: try opening a new tab,
 * fall back to navigating the top window, and finally the current window.
 * Used when embedded in an iframe that may block popups or have restrictive sizing.
 */
function openInNewContext(url) {
  let opened = null;
  try {
    opened = window.open(url, '_blank');
  } catch (e) {
    opened = null;
  }
  if (opened) return;
  try {
    if (window.top && window.top !== window) {
      window.top.location.href = url;
      return;
    }
  } catch (e) {
    // ignore cross-origin access error
  }
  location.href = url;
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

function isNonVisible(conf) {
  return !!(conf.isHidden || isEnded(conf));
}

function detectAllHiddenTags(list) {
  // Find tags where all records are non-visible (isHidden or ended)
  if (!Array.isArray(list) || !list.length) return [];
  const groups = new Map();
  list.forEach((c) => {
    const t = c.tag && String(c.tag).trim();
    if (!t) return;
    if (!groups.has(t)) groups.set(t, []);
    groups.get(t).push(c);
  });

  const results = [];
  groups.forEach((items, tag) => {
    // If every item is non-visible, report
    const allHidden = items.every((it) => isNonVisible(it));
    if (!allHidden) return;
    // Find latest item by date (startDate or endDate)
    const latest = items
      .slice()
      .sort((a, b) => {
        const da = (a.startDate || a.endDate || '').slice(0, 10) || '';
        const db = (b.startDate || b.endDate || '').slice(0, 10) || '';
        if (!da && !db) return 0;
        if (!da) return 1;
        if (!db) return -1;
        return da < db ? -1 : da > db ? 1 : 0;
      })
      .slice(-1)[0];
    results.push({ tag, latest });
  });
  return results;
}

function renderAll(list) {
  // Detect tags where all records are non-visible and notify editors/admins
  try {
    const missingTags = currentUser ? detectAllHiddenTags(list || []) : [];
    const noticeEl = document.getElementById('missing-next-notice');
    if (noticeEl) {
      if (missingTags.length) {
        noticeEl.hidden = false;
        const examples = missingTags.slice(0, 5).map((m) => escapeHtml(m.tag)).join(', ');
        noticeEl.innerHTML = `未登録（全記録非表示）の学会タグ: <strong>${missingTags.length}</strong> 件。` +
          ` <span class="hint">${examples}${missingTags.length>5? '…':''}</span>` +
          ` <button id="btn-open-missing-tags" class="btn btn-sm">過去の学会情報を見る</button>`;
        // attach handler
        setTimeout(() => {
          const btn = document.getElementById('btn-open-missing-tags');
          if (btn) {
            btn.addEventListener('click', () => {
              // Open modal listing all missing tags and allow per-tag drilldown
              const backdrop = document.getElementById('hidden-modal-backdrop');
              const body = document.getElementById('hidden-modal-body');
              body.innerHTML = '<p class="hint">読み込み中…</p>';
              backdrop.hidden = false;
              // render a table grouped by tag
              const rows = missingTags.map((m) => {
                const latest = m.latest;
                const name = latest && latest.website ? `<a href="${escapeHtml(latest.website)}" target="_blank" rel="noopener noreferrer">${escapeHtml(latest.name)}</a>` : escapeHtml(latest && latest.name || m.tag);
                const dates = escapeHtml((latest && [latest.startDate, latest.endDate].filter(Boolean).join(' ~ ')) || '日付未設定');
                return `<tr data-tag="${escapeHtml(m.tag)}"><td>${name}</td><td>${escapeHtml(m.tag)}</td><td>${dates}</td><td><button class="btn btn-sm" data-action="view-tag" data-tag="${escapeHtml(m.tag)}">過去の記録を見る</button></td></tr>`;
              }).join('\n');
              body.innerHTML = `
                <div class="hidden-table-wrap">
                  <table class="hidden-list">
                    <thead><tr><th>代表名</th><th>タグ</th><th>日付</th><th>操作</th></tr></thead>
                    <tbody>${rows}</tbody>
                  </table>
                </div>
              `;
            });
          }
        }, 10);
      } else {
        noticeEl.hidden = true;
        noticeEl.innerHTML = '';
      }
    }
  } catch (e) {
    console.error('detect missing tags failed', e);
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
  // Only request hidden data when current user is admin
  const includeHidden = currentUser && currentUser.isAdmin ? '1' : '0';
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
    if (form.elements.website) form.elements.website.value = conference.website || '';
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
  const viewHiddenBtn = document.getElementById('btn-view-hidden');
  if (addBtn1) {
    // Always attach handler: redirect viewers to login, editors open the modal
    addBtn1.addEventListener('click', () => {
      if (!currentUser) {
        openInNewContext('/login.html');
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
        openInNewContext('/login.html');
        return;
      }
      openModal(null);
    });
    // visibility toggled based on auth state
    addBtn2.hidden = !currentUser;
  }

  if (viewHiddenBtn) {
    viewHiddenBtn.addEventListener('click', async () => {
      if (!currentUser || !currentUser.isAdmin) {
        openInNewContext('/login.html');
        return;
      }
      // Embedded in an iframe: open the site in a new tab (target=_blank
      // equivalent) instead of showing the modal inline, since the parent
      // frame may not have room to display it. The admin can click the
      // button again once there.
      if (window.self !== window.top) {
        openInNewContext('/');
        return;
      }
      const backdrop = document.getElementById('hidden-modal-backdrop');
      const body = document.getElementById('hidden-modal-body');
      body.innerHTML = '<p class="hint">読み込み中…</p>';
      backdrop.hidden = false;
      try {
        const data = await api('/api/conferences?includeHidden=1');
        // Consider both explicitly hidden and automatically hidden (ended) as "hidden"
        const hidden = (data.conferences || []).filter((c) => c.isHidden || isEnded(c));
        if (!hidden.length) {
          body.innerHTML = '<p class="hint">非表示の学会はありません。</p>';
        } else {
          // Render a compact table for easier scanning and action
          const rows = hidden.map((c) => {
            const name = c.website
              ? `<a href="${escapeHtml(c.website)}" target="_blank" rel="noopener noreferrer">${escapeHtml(c.name)}</a>`
              : `${escapeHtml(c.name)}`;
            const tag = escapeHtml(c.tag || '');
            const dates = escapeHtml([c.startDate, c.endDate].filter(Boolean).join(' ~ ') || '日付未設定');
            const loc = escapeHtml(c.location || '—');
            return `<tr data-id="${c.id}">
              <td class="name">${name}</td>
              <td class="tag">${tag}</td>
              <td class="dates">${dates}</td>
              <td class="loc">${loc}</td>
              <td class="actions">
                <button class="btn btn-sm" data-action="edit" data-id="${c.id}">編集</button>
                <button class="btn btn-secondary btn-sm" data-action="unhide" data-id="${c.id}">再表示</button>
              </td>
            </tr>`;
          }).join('\n');

          body.innerHTML = `
            <div class="hidden-table-wrap">
              <table class="hidden-list">
                <thead>
                  <tr><th>学会名</th><th>タグ</th><th>日付</th><th>場所</th><th>操作</th></tr>
                </thead>
                <tbody>
                  ${rows}
                </tbody>
              </table>
            </div>
          `;
        }
      } catch (err) {
        body.innerHTML = `<p class="flash flash-error">読み込みに失敗しました: ${escapeHtml(err.message)}</p>`;
      }
    });
    viewHiddenBtn.hidden = !(currentUser && currentUser.isAdmin);
  }

  if (currentUser) {
    document.getElementById('conf-form').addEventListener('submit', onSubmitForm);
    document.getElementById('btn-cancel-modal').addEventListener('click', closeModal);
    document.getElementById('modal-backdrop').addEventListener('click', (e) => {
      if (e.target.id === 'modal-backdrop') closeModal();
    });
  }

  const closeHidden = document.getElementById('btn-close-hidden');
  if (closeHidden) closeHidden.addEventListener('click', () => {
    document.getElementById('hidden-modal-backdrop').hidden = true;
  });

  // Delegate click handling inside hidden modal for edit/unhide actions
  const hiddenBody = document.getElementById('hidden-modal-body');
  if (hiddenBody) {
    hiddenBody.addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-action]');
      if (!btn) return;
      const action = btn.dataset.action;
      const id = parseInt(btn.dataset.id, 10);
      if (action === 'edit') {
        // Only admins can edit
        if (!currentUser || !currentUser.isAdmin) return alert('編集は管理者のみ行えます');
        document.getElementById('hidden-modal-backdrop').hidden = true;
        const conf = allConferences.find((c) => c.id === id);
        if (conf) {
          openModal(conf);
        } else {
          api(`/api/conferences/${id}`).then((res) => {
            if (res && res.conference) openModal(res.conference);
          }).catch((err) => alert(err.message));
        }
      } else if (action === 'unhide') {
        // Editors can unhide only if not ended; admins can unhide always
        api(`/api/conferences/${id}`).then((res) => {
          const conf = res.conference;
          const ended = isEnded(conf);
          if (!currentUser || (!currentUser.isAdmin && ended)) {
            return alert('この学会は終了しているため、編集者は再表示できません。管理者に依頼してください。');
          }
          if (!confirm('この学会を再表示しますか？（必要であれば日付を更新してください）')) return;
          api(`/api/conferences/${id}/unhide`, { method: 'POST' })
            .then(() => {
              // refresh both hidden modal and main list
              viewHiddenBtn.click();
              loadConferences();
              alert('再表示しました（必要なら日付を編集してください）。');
            })
            .catch((err) => alert(err.message));
        }).catch((err) => alert(err.message));
      } else if (action === 'duplicate') {
        // Duplicate: open modal prefilled but clear id for creating new record
        document.getElementById('hidden-modal-backdrop').hidden = true;
        api(`/api/conferences/${id}`).then((res) => {
          const conf = res.conference;
          if (conf) {
            openModal(conf);
            // clear id to force create
            const form = document.getElementById('conf-form');
            form.elements.id.value = '';
            document.getElementById('modal-title').textContent = '学会情報の複製（新規作成）';
          }
        }).catch((err) => alert(err.message));
      } else if (action === 'view-tag') {
        const tag = btn.dataset.tag;
        // render past records for this tag
        const backdrop = document.getElementById('hidden-modal-backdrop');
        const body = document.getElementById('hidden-modal-body');
        body.innerHTML = '<p class="hint">読み込み中…</p>';
        api(`/api/conferences?includeHidden=1`).then((data) => {
          const items = (data.conferences || []).filter((c) => (c.tag || '') === tag);
          if (!items.length) {
            body.innerHTML = '<p class="hint">該当する過去の記録はありません。</p>';
            return;
          }
          const rows = items.map((c) => `<tr><td>${c.website?`<a href="${escapeHtml(c.website)}" target="_blank">${escapeHtml(c.name)}</a>`:escapeHtml(c.name)}</td><td>${escapeHtml(c.tag||'')}</td><td>${escapeHtml([c.startDate,c.endDate].filter(Boolean).join(' ~ ')||'日付未設定')}</td><td><button class="btn btn-sm" data-action="duplicate" data-id="${c.id}">複製して新規作成</button></td></tr>`).join('');
          body.innerHTML = `\n            <div class="hidden-table-wrap">\n              <table class="hidden-list">\n                <thead><tr><th>学会名</th><th>タグ</th><th>日付</th><th>操作</th></tr></thead>\n                <tbody>${rows}</tbody>\n              </table>\n            </div>\n          `;
        }).catch((err) => { body.innerHTML = `<p class="flash flash-error">読み込みに失敗しました: ${escapeHtml(err.message)}</p>`; });
      }
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
