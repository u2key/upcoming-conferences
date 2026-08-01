'use strict';

const session = require('express-session');
const { getDb } = require('../db/database');

/**
 * Minimal SQLite session store backed by the `sessions` table.
 */
class SqliteSessionStore extends session.Store {
  constructor() {
    super();
  }

  get(sid, callback) {
    try {
      const db = getDb();
      const row = db
        .prepare('SELECT sess, expired FROM sessions WHERE sid = ?')
        .get(sid);
      if (!row) return callback(null, null);
      if (row.expired < Date.now()) {
        db.prepare('DELETE FROM sessions WHERE sid = ?').run(sid);
        return callback(null, null);
      }
      return callback(null, JSON.parse(row.sess));
    } catch (err) {
      return callback(err);
    }
  }

  set(sid, sess, callback) {
    try {
      const db = getDb();
      const maxAge = sess.cookie && sess.cookie.maxAge
        ? sess.cookie.maxAge
        : 86400000 * 7;
      const expired = Date.now() + maxAge;
      const payload = JSON.stringify(sess);
      db.prepare(
        `INSERT INTO sessions (sid, sess, expired) VALUES (?, ?, ?)
         ON CONFLICT(sid) DO UPDATE SET sess = excluded.sess, expired = excluded.expired`
      ).run(sid, payload, expired);
      callback && callback(null);
    } catch (err) {
      callback && callback(err);
    }
  }

  destroy(sid, callback) {
    try {
      getDb().prepare('DELETE FROM sessions WHERE sid = ?').run(sid);
      callback && callback(null);
    } catch (err) {
      callback && callback(err);
    }
  }

  touch(sid, sess, callback) {
    this.set(sid, sess, callback);
  }

  /** Remove expired sessions. */
  clearExpired() {
    try {
      getDb().prepare('DELETE FROM sessions WHERE expired < ?').run(Date.now());
    } catch (e) {
      console.warn('[session] clearExpired failed:', e.message);
    }
  }
}

module.exports = SqliteSessionStore;
