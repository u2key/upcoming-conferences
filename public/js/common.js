(function(){ 'use strict';

/** Format ISO/date string for display (YYYY-MM-DD or empty). */
function formatDate(value) {
  if (!value) return '—';
  // Already date-only
  if (/^\d{4}-\d{2}-\d{2}/.test(value)) return value.slice(0, 10);
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toISOString().slice(0, 10);
}

/** Classify deadline relative to today. */
function deadlineClass(value) {
  if (!value) return '';
  const day = value.slice(0, 10);
  const today = new Date();
  const t = today.toISOString().slice(0, 10);
  if (day < t) return 'passed';
  const soon = new Date(today);
  soon.setDate(soon.getDate() + 14);
  if (day <= soon.toISOString().slice(0, 10)) return 'soon';
  return '';
}

function escapeHtml(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Render nav auth state into #nav-auth element.
 */
async function renderNavAuth() {
  const el = document.getElementById('nav-auth');
  if (!el) return null;

  let user = null;
  try {
    user = await window.UCApi.getMe();
  } catch {
    user = null;
  }

  if (!user) {
    el.innerHTML = `
      <a class="btn btn-secondary btn-sm" href="/login.html">ログイン</a>
      <a class="btn btn-sm" href="/register.html">アカウント申請</a>
    `;
    return null;
  }

  const adminLink = user.isAdmin
    ? `<a class="btn btn-secondary btn-sm" href="/admin.html">管理コンソール</a>`
    : '';

  el.innerHTML = `
    <span class="nav-user">${escapeHtml(user.fullName || user.username)}
      ${user.isAdmin ? '<span class="badge badge-pending">admin</span>' : ''}
    </span>
    ${adminLink}
    <a class="btn btn-sm" href="/password.html">パスワード変更</a>
    <button type="button" class="btn btn-ghost btn-sm" id="btn-logout">ログアウト</button>
  `;

  const logoutBtn = document.getElementById('btn-logout');
  if (logoutBtn) {
    logoutBtn.addEventListener('click', async () => {
      try {
        await window.UCApi.api('/api/auth/logout', { method: 'POST' });
      } catch {
        /* ignore */
      }
      location.href = '/';
    });
  }

  return user;
}

window.UCCommon = {
  formatDate,
  deadlineClass,
  escapeHtml,
  renderNavAuth,
};
})();
