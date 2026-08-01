'use strict';

const users = require('../services/users');

/** Attach req.user from session if present. */
function loadUser(req, _res, next) {
  if (req.session && req.session.userId) {
    req.user = users.findById(req.session.userId);
    if (!req.user || !req.user.isActive) {
      req.user = null;
      req.session.destroy(() => {});
    }
  } else {
    req.user = null;
  }
  next();
}

/** Require any authenticated active user. */
function requireAuth(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ error: 'ログインが必要です' });
  }
  next();
}

/** Require admin user. */
function requireAdmin(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ error: 'ログインが必要です' });
  }
  if (!req.user.isAdmin) {
    return res.status(403).json({ error: '管理者権限が必要です' });
  }
  next();
}

module.exports = {
  loadUser,
  requireAuth,
  requireAdmin,
};
