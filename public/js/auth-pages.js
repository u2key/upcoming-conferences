'use strict';

const { api } = window.UCApi;
const { renderNavAuth } = window.UCCommon;

async function setupLogin() {
  await renderNavAuth();
  const form = document.getElementById('login-form');
  if (!form) return;

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const errEl = document.getElementById('form-error');
    const okEl = document.getElementById('form-success');
    errEl.textContent = '';
    if (okEl) okEl.textContent = '';

    const username = form.elements.username.value.trim();
    const password = form.elements.password.value;

    try {
      const data = await api('/api/auth/login', {
        method: 'POST',
        body: { username, password },
      });
      if (data.user && data.user.isAdmin) {
        location.href = '/admin.html';
      } else {
        location.href = '/';
      }
    } catch (err) {
      errEl.textContent = err.message;
    }
  });
}

async function setupRegister() {
  await renderNavAuth();
  const form = document.getElementById('register-form');
  if (!form) return;

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const errEl = document.getElementById('form-error');
    const okEl = document.getElementById('form-success');
    errEl.textContent = '';
    okEl.textContent = '';

    const body = {
      email: form.elements.email.value.trim(),
      fullName: form.elements.fullName.value.trim(),
      affiliation: form.elements.affiliation.value.trim(),
      username: form.elements.username.value.trim(),
      password: form.elements.password.value,
    };

    if (form.elements.passwordConfirm.value !== body.password) {
      errEl.textContent = 'パスワードが一致しません';
      return;
    }

    try {
      const data = await api('/api/auth/register', { method: 'POST', body });
      form.reset();
      okEl.textContent =
        data.message ||
        '申請を受け付けました。管理者の承認後、メールで通知されます。';
    } catch (err) {
      errEl.textContent = err.message;
    }
  });
}

async function setupChangePassword() {
  await renderNavAuth();
  const form = document.getElementById('change-password-form');
  if (!form) return;

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const errEl = document.getElementById('form-error');
    const okEl = document.getElementById('form-success');
    errEl.textContent = '';
    okEl.textContent = '';

    const currentPassword = form.elements.currentPassword.value;
    const newPassword = form.elements.newPassword.value;
    const newPasswordConfirm = form.elements.newPasswordConfirm.value;

    if (newPassword !== newPasswordConfirm) {
      errEl.textContent = '新しいパスワードが一致しません';
      return;
    }
    if (newPassword.length < 6) {
      errEl.textContent = '新しいパスワードは6文字以上で指定してください';
      return;
    }

    try {
      const data = await api('/api/auth/change-password', {
        method: 'POST',
        body: { currentPassword, newPassword },
      });
      form.reset();
      okEl.textContent = data.message || 'パスワードを変更しました';
    } catch (err) {
      errEl.textContent = err.message;
    }
  });
}

document.addEventListener('DOMContentLoaded', () => {
  if (document.getElementById('login-form')) setupLogin();
  if (document.getElementById('register-form')) setupRegister();
  if (document.getElementById('change-password-form')) setupChangePassword();
});
