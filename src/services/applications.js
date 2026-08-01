'use strict';

const { getDb } = require('../db/database');
const users = require('./users');

function toPublic(row) {
  if (!row) return null;
  return {
    id: row.id,
    email: row.email,
    fullName: row.full_name,
    affiliation: row.affiliation,
    username: row.username,
    status: row.status,
    isHidden: !!row.is_hidden,
    createdAt: row.created_at,
    reviewedAt: row.reviewed_at,
    reviewedBy: row.reviewed_by,
  };
}

/**
 * Submit a new account application.
 * Collects email, name, affiliation, plus username/password for later login.
 */
function submitApplication({ email, fullName, affiliation, username, password }) {
  if (!email || !fullName || !affiliation || !username || !password) {
    const err = new Error('メールアドレス・氏名・所属・ユーザ名・パスワードは必須です');
    err.status = 400;
    throw err;
  }

  const emailNorm = String(email).trim().toLowerCase();
  const usernameNorm = String(username).trim();

  if (users.findByUsername(usernameNorm)) {
    const err = new Error('このユーザ名は既に使用されています');
    err.status = 409;
    throw err;
  }
  if (users.findByEmail(emailNorm)) {
    const err = new Error('このメールアドレスは既に登録されています');
    err.status = 409;
    throw err;
  }

  const db = getDb();
  const pending = db
    .prepare(
      `SELECT id FROM account_applications
       WHERE status = 'pending' AND (username = ? OR email = ?)`
    )
    .get(usernameNorm, emailNorm);
  if (pending) {
    const err = new Error('同じユーザ名またはメールの申請が既に審査中です');
    err.status = 409;
    throw err;
  }

  const passwordHash = users.hashPassword(password);
  const result = db
    .prepare(
      `INSERT INTO account_applications
         (email, full_name, affiliation, username, password_hash, status)
       VALUES (?, ?, ?, ?, ?, 'pending')`
    )
    .run(emailNorm, fullName.trim(), affiliation.trim(), usernameNorm, passwordHash);

  return toPublic(
    db.prepare('SELECT * FROM account_applications WHERE id = ?').get(result.lastInsertRowid)
  );
}

/**
 * List applications for admin console.
 * @param {{ includeHidden?: boolean }} opts
 *   - default: pending + non-hidden rejected (rejected hidden ones omitted)
 *   - includeHidden: also show hidden rejected applications
 */
function listApplications({ includeHidden = false } = {}) {
  const db = getDb();
  let rows;
  if (includeHidden) {
    rows = db
      .prepare(
        `SELECT * FROM account_applications
         WHERE status IN ('pending', 'rejected')
         ORDER BY created_at DESC`
      )
      .all();
  } else {
    rows = db
      .prepare(
        `SELECT * FROM account_applications
         WHERE status = 'pending'
            OR (status = 'rejected' AND is_hidden = 0)
         ORDER BY
           CASE status WHEN 'pending' THEN 0 ELSE 1 END,
           created_at DESC`
      )
      .all();
  }
  return rows.map(toPublic);
}

function getApplication(id) {
  const db = getDb();
  return toPublic(
    db.prepare('SELECT * FROM account_applications WHERE id = ?').get(id)
  );
}

function getApplicationRaw(id) {
  const db = getDb();
  return db.prepare('SELECT * FROM account_applications WHERE id = ?').get(id);
}

/**
 * Approve an application: create user account and mark application approved.
 * @returns {{ application, user }}
 */
function approveApplication(id, reviewerId) {
  const db = getDb();
  const app = getApplicationRaw(id);
  if (!app) {
    const err = new Error('申請が見つかりません');
    err.status = 404;
    throw err;
  }
  if (app.status === 'approved') {
    const err = new Error('既に承認済みです');
    err.status = 400;
    throw err;
  }

  // Re-check uniqueness at approval time
  if (users.findByUsername(app.username)) {
    const err = new Error('ユーザ名が既に使用されているため承認できません');
    err.status = 409;
    throw err;
  }
  if (users.findByEmail(app.email)) {
    const err = new Error('メールアドレスが既に登録されているため承認できません');
    err.status = 409;
    throw err;
  }

  const approve = db.transaction(() => {
    const user = users.createUser({
      username: app.username,
      email: app.email,
      passwordHash: app.password_hash,
      fullName: app.full_name,
      affiliation: app.affiliation,
      isAdmin: false,
    });

    db.prepare(
      `UPDATE account_applications
       SET status = 'approved', is_hidden = 0,
           reviewed_at = datetime('now'), reviewed_by = ?
       WHERE id = ?`
    ).run(reviewerId, id);

    return user;
  });

  const user = approve();
  return { application: getApplication(id), user };
}

/**
 * Reject an application and hide it from the default console view.
 * No email is sent (caller responsibility).
 */
function rejectApplication(id, reviewerId) {
  const db = getDb();
  const app = getApplicationRaw(id);
  if (!app) {
    const err = new Error('申請が見つかりません');
    err.status = 404;
    throw err;
  }
  if (app.status === 'approved') {
    const err = new Error('承認済みの申請は拒否できません');
    err.status = 400;
    throw err;
  }

  db.prepare(
    `UPDATE account_applications
     SET status = 'rejected', is_hidden = 1,
         reviewed_at = datetime('now'), reviewed_by = ?
     WHERE id = ?`
  ).run(reviewerId, id);

  return getApplication(id);
}

/**
 * Toggle visibility of a rejected application.
 * When re-shown (is_hidden=0), an approve button becomes available again.
 */
function setApplicationHidden(id, isHidden) {
  const db = getDb();
  const app = getApplicationRaw(id);
  if (!app) {
    const err = new Error('申請が見つかりません');
    err.status = 404;
    throw err;
  }
  if (app.status !== 'rejected') {
    const err = new Error('拒否された申請のみ表示切替できます');
    err.status = 400;
    throw err;
  }

  db.prepare(
    `UPDATE account_applications SET is_hidden = ? WHERE id = ?`
  ).run(isHidden ? 1 : 0, id);

  return getApplication(id);
}

module.exports = {
  submitApplication,
  listApplications,
  getApplication,
  approveApplication,
  rejectApplication,
  setApplicationHidden,
};
