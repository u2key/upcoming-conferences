(function(){ 'use strict';

if (window.self !== window.top) {
  // Only the main page has this id. Sub-pages are framed only when popups are
  // blocked, so they keep their header and their links stay in the frame.
  const siteHeader = document.getElementById("site-header");
  if (siteHeader) {
    document.addEventListener('click', function(e) {
      const link = e.target.closest('a');
      if (link && !link.hasAttribute('target')) {
        link.target = '_blank';
      }
    });
    siteHeader.style.display = 'none';
  }
  [].slice.call(document.querySelectorAll(".container")).forEach(e=>e.style.maxWidth='unset');
}

function sendWindowSize() {
  const height = document.documentElement.scrollHeight;
  const width = document.documentElement.scrollWidth;
  window.parent.postMessage({ frameHeight: height }, '*');
}
window.addEventListener("load", sendWindowSize);
window.addEventListener("resize", sendWindowSize);
if ('ResizeObserver' in window) {
  new ResizeObserver(sendWindowSize).observe(document.body);
}

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
  if (!value) return 'unset';
  const day = value.slice(0, 10);
  const today = new Date();
  const t = today.toISOString().slice(0, 10);
  if (day < t) return 'passed';
  const soon = new Date(today);
  soon.setDate(soon.getDate() + 14);
  if (day <= soon.toISOString().slice(0, 10)) return 'soon';
  return '';
}

/**
 * Reload the page once at the next occurrence of `hourUTC:00` UTC, so that
 * date-relative UI (deadline highlighting, "ended" filtering) picks up the new
 * day even if the page is left open for a long time without a manual reload
 * or a data-driven Socket.io update. A full reload re-schedules the next one,
 * so a single setTimeout (well under its ~24.8-day cap) is enough.
 *
 * If `shouldDefer` is given and returns true at the scheduled time (e.g. a
 * form modal is open, so an in-flight save could be interrupted), the reload
 * is postponed and re-checked every `deferCheckMs` until it returns false.
 */
function scheduleDailyReload(hourUTC = 1, shouldDefer = null, deferCheckMs = 30000) {
  const now = new Date();
  const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), hourUTC, 0, 0, 0));
  if (next <= now) next.setUTCDate(next.getUTCDate() + 1);

  function reloadWhenReady() {
    if (shouldDefer && shouldDefer()) {
      setTimeout(reloadWhenReady, deferCheckMs);
      return;
    }
    location.reload();
  }

  setTimeout(reloadWhenReady, next.getTime() - now.getTime());
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
    document.body.dataset.role = 'viewer';
    el.innerHTML = `
      <a class="btn btn-secondary btn-sm" href="/login.html">ログイン</a>
      <a class="btn btn-sm" href="/register.html">アカウント申請</a>
    `;
    return null;
  }

  document.body.dataset.role = 'editor';
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

/**
 * Call `close` when a modal backdrop itself is clicked or tapped. The press must
 * also start there, so dragging a text selection out of a field doesn't count.
 */
function closeOnBackdropClick(backdrop, close) {
  let pressedBackdrop = false;
  backdrop.addEventListener('pointerdown', (e) => {
    pressedBackdrop = e.target === backdrop;
  });
  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop && pressedBackdrop) close();
  });
}

window.UCCommon = {
  formatDate,
  deadlineClass,
  scheduleDailyReload,
  escapeHtml,
  renderNavAuth,
  closeOnBackdropClick,
};
})();
