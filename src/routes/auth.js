'use strict';

const express = require('express');
const users = require('../services/users');
const applications = require('../services/applications');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

/** POST /api/auth/login */
router.post('/login', (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ error: 'ユーザ名とパスワードを入力してください' });
  }

  const user = users.authenticate(username, password);
  if (!user) {
    return res.status(401).json({ error: 'ユーザ名またはパスワードが正しくありません' });
  }

  req.session.userId = user.id;
  res.json({ user });
});

/** POST /api/auth/logout */
router.post('/logout', (req, res) => {
  req.session.destroy((err) => {
    if (err) return res.status(500).json({ error: 'ログアウトに失敗しました' });
    res.clearCookie('connect.sid');
    res.json({ ok: true });
  });
});

/** GET /api/auth/me */
router.get('/me', (req, res) => {
  if (!req.user) return res.json({ user: null });
  res.json({ user: req.user });
});

/** POST /api/auth/register — account application */
router.post('/register', (req, res) => {
  try {
    const { email, fullName, affiliation, username, password } = req.body || {};
    const application = applications.submitApplication({
      email,
      fullName,
      affiliation,
      username,
      password,
    });
    res.status(201).json({
      application: {
        id: application.id,
        email: application.email,
        fullName: application.fullName,
        affiliation: application.affiliation,
        username: application.username,
        status: application.status,
        createdAt: application.createdAt,
      },
      message: 'アカウント作成申請を受け付けました。管理者の承認をお待ちください。',
    });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message || '申請に失敗しました' });
  }
});

/** GET /api/auth/session-check (auth required convenience) */
router.get('/session-check', requireAuth, (req, res) => {
  res.json({ user: req.user });
});

/** POST /api/auth/change-password */
router.post('/change-password', requireAuth, (req, res) => {
  const { currentPassword, newPassword } = req.body || {};
  if (!currentPassword || !newPassword) {
    return res.status(400).json({ error: '現在のパスワードと新しいパスワードを入力してください' });
  }
  if (typeof newPassword !== 'string' || newPassword.length < 6) {
    return res.status(400).json({ error: '新しいパスワードは6文字以上で指定してください' });
  }

  try {
    const ok = users.verifyPassword(req.user.id, currentPassword);
    if (!ok) return res.status(401).json({ error: '現在のパスワードが正しくありません' });

    const updated = users.updatePassword(req.user.id, newPassword);
    res.json({ user: updated, message: 'パスワードを変更しました' });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message || 'パスワード変更に失敗しました' });
  }
});

module.exports = router;
