'use strict';

const { api } = window.UCApi;
const { formatDate, escapeHtml, renderNavAuth, closeOnBackdropClick } = window.UCCommon;

let includeHidden = false;

function showFlash(msg, ok = true) {
  const el = document.getElementById('flash');
  el.className = 'flash ' + (ok ? 'flash-ok' : 'flash-error');
  el.textContent = msg;
  el.hidden = false;
  setTimeout(() => {
    el.hidden = true;
  }, 4000);
}

/* ---------- Tabs ---------- */
function setupTabs() {
  document.querySelectorAll('.tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach((t) => t.classList.remove('active'));
      document.querySelectorAll('.tab-panel').forEach((p) => {
        p.hidden = true;
      });
      tab.classList.add('active');
      document.getElementById(tab.dataset.panel).hidden = false;

      if (tab.dataset.panel === 'panel-applications') loadApplications();
      if (tab.dataset.panel === 'panel-logs') loadLogs();
      if (tab.dataset.panel === 'panel-users') loadUsers();
      if (tab.dataset.panel === 'panel-notifications') loadNotifications();
    });
  });
}

/* ---------- Applications ---------- */
async function loadApplications() {
  const tbody = document.getElementById('tbody-applications');
  try {
    const q = includeHidden ? '?includeHidden=1' : '';
    const data = await api('/api/admin/applications' + q);
    const rows = data.applications || [];
    if (!rows.length) {
      tbody.innerHTML = `<tr><td colspan="7" class="empty">表示する申請はありません</td></tr>`;
      return;
    }
    tbody.innerHTML = rows
      .map((a) => {
        const statusBadge =
          a.status === 'pending'
            ? '<span class="badge badge-pending">審査中</span>'
            : a.status === 'rejected'
              ? '<span class="badge badge-rejected">拒否</span>'
              : '<span class="badge badge-approved">承認済</span>';

        const hiddenBadge = a.isHidden
          ? ' <span class="badge badge-hidden">非表示</span>'
          : '';

        let actions = '';
        if (a.status === 'pending' || (a.status === 'rejected' && !a.isHidden)) {
          actions += `<button type="button" class="btn btn-success btn-sm" data-action="approve" data-id="${a.id}">承認</button>`;
        }
        if (a.status === 'pending') {
          actions += `<button type="button" class="btn btn-danger btn-sm" data-action="reject" data-id="${a.id}">拒否</button>`;
        }
        if (a.status === 'rejected') {
          if (a.isHidden) {
            actions += `<button type="button" class="btn btn-secondary btn-sm" data-action="show" data-id="${a.id}">再表示</button>`;
          } else {
            actions += `<button type="button" class="btn btn-secondary btn-sm" data-action="hide" data-id="${a.id}">非表示</button>`;
          }
        }

        return `
          <tr class="${a.isHidden ? 'hidden-row' : ''}">
            <td>${a.id}</td>
            <td>${escapeHtml(a.fullName)}<br><span class="hint">@${escapeHtml(a.username)}</span></td>
            <td>${escapeHtml(a.email)}</td>
            <td>${escapeHtml(a.affiliation)}</td>
            <td>${statusBadge}${hiddenBadge}</td>
            <td class="optional">${escapeHtml(formatDate(a.createdAt))}</td>
            <td class="actions">${actions}</td>
          </tr>`;
      })
      .join('');
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="7" class="empty">${escapeHtml(err.message)}</td></tr>`;
  }
}

async function onApplicationAction(e) {
  const btn = e.target.closest('button[data-action]');
  if (!btn) return;
  const id = btn.dataset.id;
  const action = btn.dataset.action;

  try {
    if (action === 'approve') {
      if (!confirm('この申請を承認しますか？承認後、申請者にメールが送信されます。')) return;
      const res = await api(`/api/admin/applications/${id}/approve`, { method: 'POST' });
      showFlash(
        res.mailSent
          ? `${res.user.username} を承認し、メールを送信しました`
          : res.warning || '承認しました（メール送信失敗）',
        !!res.mailSent || !res.warning
      );
    } else if (action === 'reject') {
      if (!confirm('この申請を拒否しますか？（メールは送信されません）')) return;
      await api(`/api/admin/applications/${id}/reject`, { method: 'POST' });
      showFlash('申請を拒否し、コンソールから非表示にしました');
    } else if (action === 'hide') {
      await api(`/api/admin/applications/${id}/visibility`, {
        method: 'POST',
        body: { isHidden: true },
      });
      showFlash('申請を非表示にしました');
    } else if (action === 'show') {
      await api(`/api/admin/applications/${id}/visibility`, {
        method: 'POST',
        body: { isHidden: false },
      });
      showFlash('申請を再表示しました（承認ボタンが利用可能です）');
    }
    await loadApplications();
  } catch (err) {
    showFlash(err.message, false);
  }
}

/* ---------- Logs ---------- */
function summarizeSnapshot(data) {
  if (!data) return '—';
  const name = data.name || '(無題)';
  const hidden = data.is_hidden ? ' [非表示]' : '';
  return escapeHtml(name + hidden);
}

async function loadLogs() {
  const tbody = document.getElementById('tbody-logs');
  try {
    const data = await api('/api/admin/logs?limit=300');
    const rows = data.logs || [];
    if (!rows.length) {
      tbody.innerHTML = `<tr><td colspan="6" class="empty">操作ログはありません（3か月間保持）</td></tr>`;
      return;
    }
    tbody.innerHTML = rows
      .map((log) => {
        let rollbackBtn = '<span class="hint">—</span>';
        if (!log.conferenceExists) {
          rollbackBtn = '<span class="hint">削除済み</span>';
        } else if (log.action !== 'rollback') {
          rollbackBtn = `<button type="button" class="btn btn-secondary btn-sm" data-rollback="${log.id}">ロールバック</button>`;
        }
        return `
          <tr>
            <td>${log.id}</td>
            <td>${escapeHtml(log.createdAt || '')}</td>
            <td>${escapeHtml(log.username || String(log.userId))}</td>
            <td><code>${escapeHtml(log.action)}</code> #${log.conferenceId ?? '—'}</td>
            <td>
              <div class="hint">before: ${summarizeSnapshot(log.beforeData)}</div>
              <div class="hint">after: ${summarizeSnapshot(log.afterData)}</div>
            </td>
            <td class="actions">${rollbackBtn}</td>
          </tr>`;
      })
      .join('');
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="6" class="empty">${escapeHtml(err.message)}</td></tr>`;
  }
}

async function onLogAction(e) {
  const btn = e.target.closest('button[data-rollback]');
  if (!btn) return;
  const id = btn.dataset.rollback;
  if (!confirm(`操作ログ #${id} をロールバックしますか？`)) return;
  try {
    const res = await api(`/api/admin/logs/${id}/rollback`, { method: 'POST' });
    showFlash(
      `ロールバック完了: ${res.conference ? res.conference.name : '(学会)'} を復元しました`
    );
    await loadLogs();
  } catch (err) {
    showFlash(err.message, false);
  }
}

/* ---------- Users ---------- */
async function loadUsers() {
  const tbody = document.getElementById('tbody-users');
  try {
    const data = await api('/api/admin/users');
    const rows = data.users || [];
    tbody.innerHTML = rows
      .map(
        (u) => `
      <tr>
        <td>${u.id}</td>
        <td>${escapeHtml(u.username)} ${u.isAdmin ? '<span class="badge badge-pending">admin</span>' : ''}</td>
        <td>${escapeHtml(u.fullName)}</td>
        <td>${escapeHtml(u.email)}</td>
        <td>${escapeHtml(u.affiliation)}</td>
        <td>${u.isActive ? '有効' : '無効'}</td>
        <td class="actions">
          <button type="button" class="btn btn-secondary btn-sm" data-action="reset" data-id="${u.id}">パスワードリセット</button>
          ${u.id !== 1 ? (u.isAdmin ? `<button type="button" class="btn btn-danger btn-sm" data-action="revoke" data-id="${u.id}">管理者剥奪</button>` : `<button type="button" class="btn btn-success btn-sm" data-action="grant" data-id="${u.id}">管理者付与</button>`) : '<span class="hint">root</span>'}
        </td>
      </tr>`
      )
      .join('');
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="6" class="empty">${escapeHtml(err.message)}</td></tr>`;
  }
}

/* ---------- Notification mail ---------- */
function formatUtcDateTime(value) {
  const date = new Date(`${String(value).replace(' ', 'T')}Z`);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString('ja-JP');
}

async function loadNotifications() {
  const summary = document.getElementById('notify-summary');
  const tbody = document.getElementById('tbody-notify-runs');
  try {
    const status = await api('/api/admin/notifications');
    summary.innerHTML = `
      <p>未登録の学会タグ: <strong>${status.tagCount}</strong> 件 / 受信者: <strong>${status.recipients.length}</strong> 人</p>
      <p class="hint">次回の自動送信: ${escapeHtml(status.nextAutoSend)}（${escapeHtml(status.timeZone)}）</p>`;
    tbody.innerHTML = status.runs.length
      ? status.runs
          .map(
            (r) => `
          <tr>
            <td>${escapeHtml(formatUtcDateTime(r.createdAt))}</td>
            <td>${r.kind === 'auto' ? '自動' : `手動（${escapeHtml(r.username || '—')}）`}</td>
            <td>${r.tagCount}</td>
            <td>${r.sentCount}</td>
            <td>${r.failedCount}</td>
          </tr>`
          )
          .join('')
      : '<tr><td colspan="5" class="empty">送信履歴はありません</td></tr>';
  } catch (err) {
    summary.innerHTML = `<p class="form-error">${escapeHtml(err.message)}</p>`;
  }
}

function setupNotifications() {
  const backdrop = document.getElementById('notify-modal-backdrop');
  const body = document.getElementById('notify-modal-body');
  const sendBtn = document.getElementById('btn-notify-send');
  const previewBtn = document.getElementById('btn-notify-preview');
  let isSending = false;

  const close = () => {
    if (!isSending) backdrop.hidden = true;
  };

  previewBtn.addEventListener('click', async () => {
    previewBtn.disabled = true;
    try {
      const status = await api('/api/admin/notifications');
      const blocker = !status.tagCount
        ? '未登録の学会タグがないため、送信する内容がありません。'
        : !status.recipients.length
          ? '通知を受け取るユーザがいません。'
          : '';
      body.innerHTML = `
        ${blocker ? `<p class="flash flash-error">${blocker}</p>` : ''}
        <p class="hint">件名</p>
        <p class="mail-subject">${escapeHtml(status.subject)}</p>
        <p class="hint">本文（宛名は受信者ごとのユーザ名になります）</p>
        <pre class="mail-preview">${escapeHtml(status.text)}</pre>
        <p class="hint">受信者（${status.recipients.length} 人）</p>
        <p>${escapeHtml(status.recipients.join(', ')) || '—'}</p>`;
      sendBtn.disabled = !!blocker;
      backdrop.hidden = false;
      body.scrollTop = 0;
    } catch (err) {
      showFlash(err.message, false);
    } finally {
      previewBtn.disabled = false;
    }
  });

  sendBtn.addEventListener('click', async () => {
    isSending = true;
    sendBtn.disabled = true;
    sendBtn.textContent = '送信中…';
    try {
      const res = await api('/api/admin/notifications/send', { method: 'POST' });
      showFlash(
        res.failed.length
          ? `${res.sentCount} 人に送信しました。送信失敗: ${res.failed.join(', ')}`
          : `${res.sentCount} 人に送信しました`,
        !res.failed.length
      );
    } catch (err) {
      showFlash(err.message, false);
    } finally {
      isSending = false;
      sendBtn.textContent = 'この内容で送信';
      close();
      loadNotifications();
    }
  });

  document.getElementById('btn-notify-cancel').addEventListener('click', close);
  closeOnBackdropClick(backdrop, close);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !backdrop.hidden) close();
  });
}

async function main() {
  const user = await renderNavAuth();
  if (!user || !user.isAdmin) {
    document.getElementById('admin-root').innerHTML = `
      <div class="panel auth-card">
        <h1>アクセス拒否</h1>
        <p class="subtitle">管理者権限が必要です。<a href="/login.html">ログイン</a>してください。</p>
      </div>`;
    return;
  }

  setupTabs();
  setupNotifications();
  document
    .getElementById('tbody-applications')
    .addEventListener('click', onApplicationAction);
  document.getElementById('tbody-logs').addEventListener('click', onLogAction);
  document.getElementById('tbody-users').addEventListener('click', onUserAction);

  const toggle = document.getElementById('toggle-hidden');
  toggle.addEventListener('change', () => {
    includeHidden = toggle.checked;
    loadApplications();
  });

  await loadApplications();
  await loadUsers();
}

async function onUserAction(e) {
  const btn = e.target.closest('button[data-action]');
  if (!btn) return;
  const id = btn.dataset.id;
  const action = btn.dataset.action;

  try {
    if (action === 'reset') {
      if (!confirm(`ユーザ #${id} のパスワードをリセットして、登録メールアドレスに通知しますか？`)) return;
      const res = await api(`/api/admin/users/${id}/reset-password`, { method: 'POST' });
      showFlash(
        res.mailSent
          ? `ユーザ ${id} のパスワードをリセットし、メールを送信しました`
          : res.warning || 'パスワードをリセットしました（メール送信失敗）'
      );
      await loadUsers();
    } else if (action === 'grant' || action === 'revoke') {
      const makeAdmin = action === 'grant';
      const verb = makeAdmin ? '付与' : '剥奪';
      if (!confirm(`ユーザ #${id} に管理者権限を${verb}しますか？`)) return;
      const res = await api(`/api/admin/users/${id}/admin`, {
        method: 'POST',
        body: { isAdmin: makeAdmin },
      });
      showFlash(`ユーザ ${id} の管理者権限を${verb}しました`);
      await loadUsers();
    }
  } catch (err) {
    showFlash(err.message, false);
  }
}

document.addEventListener('DOMContentLoaded', main);
