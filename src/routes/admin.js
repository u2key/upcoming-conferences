'use strict';

const express = require('express');
const applications = require('../services/applications');
const audit = require('../services/audit');
const conferences = require('../services/conferences');
const mail = require('../services/mail');
const users = require('../services/users');
const { requireAdmin } = require('../middleware/auth');

const router = express.Router();

let broadcast = () => {};
router.setBroadcast = (fn) => {
  broadcast = fn;
};

router.use(requireAdmin);

/** GET /api/admin/applications?includeHidden=1 */
router.get('/applications', (req, res) => {
  try {
    const includeHidden = req.query.includeHidden === '1';
    const list = applications.listApplications({ includeHidden });
    res.json({ applications: list });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

/** POST /api/admin/applications/:id/approve */
router.post('/applications/:id/approve', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const { application, user } = applications.approveApplication(id, req.user.id);

    // Send approval email (no email on reject)
    try {
      await mail.sendApprovalNotification({
        email: user.email,
        fullName: user.fullName,
        username: user.username,
      });
    } catch (mailErr) {
      console.error('[mail] approval notification failed:', mailErr.message);
      // Account is still approved; report mail failure separately
      return res.json({
        application,
        user,
        mailSent: false,
        warning: 'アカウントは承認されましたが、メール送信に失敗しました',
      });
    }

    res.json({ application, user, mailSent: true });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

/** POST /api/admin/applications/:id/reject — hide from console, no email */
router.post('/applications/:id/reject', (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const application = applications.rejectApplication(id, req.user.id);
    res.json({ application });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

/**
 * POST /api/admin/applications/:id/visibility
 * body: { isHidden: boolean }
 * Toggle re-display of rejected applications (shows approve button again).
 */
router.post('/applications/:id/visibility', (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const isHidden = !!(req.body && req.body.isHidden);
    const application = applications.setApplicationHidden(id, isHidden);
    res.json({ application });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

/** GET /api/admin/logs */
router.get('/logs', (req, res) => {
  try {
    const conferenceId = req.query.conferenceId
      ? parseInt(req.query.conferenceId, 10)
      : undefined;
    const limit = req.query.limit ? parseInt(req.query.limit, 10) : 200;
    const logs = audit.listLogs({ conferenceId, limit });
    res.json({ logs });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

/** POST /api/admin/logs/:id/rollback */
router.post('/logs/:id/rollback', (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const result = audit.rollback(id, req.user.id);
    try {
      broadcast({
        reason: 'rollback',
        conference: result.conference,
        conferences: conferences.list({ includeHidden: false }),
      });
    } catch (e) {
      console.warn('[socket] broadcast failed:', e.message);
    }
    res.json(result);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

/** GET /api/admin/users */
router.get('/users', (_req, res) => {
  try {
    res.json({ users: users.listUsers() });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

/** POST /api/admin/users/:id/reset-password */
router.post('/users/:id/reset-password', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const target = users.findById(id);
    if (!target) return res.status(404).json({ error: '指定されたユーザが見つかりません' });

    // Generate a random temporary password
    const newPassword = Array.from({ length: 12 })
      .map(() => String.fromCharCode(33 + Math.floor(Math.random() * 94)))
      .join('');

    const updated = users.updatePassword(id, newPassword);

    // Send notification email
    try {
      await mail.sendPasswordResetNotification({
        email: target.email,
        fullName: target.fullName || target.username,
        username: target.username,
        newPassword,
      });
    } catch (mailErr) {
      console.error('[mail] password reset notification failed:', mailErr.message);
      return res.json({ user: updated, mailSent: false, warning: 'パスワードはリセットされましたが、メール送信に失敗しました' });
    }

    res.json({ user: updated, mailSent: true });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

module.exports = router;
