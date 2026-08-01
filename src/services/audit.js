'use strict';

const { getDb, purgeOldLogs } = require('../db/database');
const config = require('../config');

function serialize(data) {
  if (data == null) return null;
  return JSON.stringify(data);
}

function parse(json) {
  if (json == null) return null;
  try {
    return JSON.parse(json);
  } catch {
    return null;
  }
}

function toPublic(row) {
  if (!row) return null;
  return {
    id: row.id,
    conferenceId: row.conference_id,
    userId: row.user_id,
    username: row.username || null,
    action: row.action,
    beforeData: parse(row.before_data),
    afterData: parse(row.after_data),
    createdAt: row.created_at,
  };
}

/**
 * Record an operation. Automatically purges logs older than retention.
 */
function logOperation({ conferenceId, userId, action, beforeData, afterData }) {
  const db = getDb();
  const result = db
    .prepare(
      `INSERT INTO operation_logs
         (conference_id, user_id, action, before_data, after_data)
       VALUES (?, ?, ?, ?, ?)`
    )
    .run(
      conferenceId ?? null,
      userId,
      action,
      serialize(beforeData),
      serialize(afterData)
    );

  try {
    purgeOldLogs(config.logRetentionDays);
  } catch (e) {
    console.warn('[audit] purge failed:', e.message);
  }

  return result.lastInsertRowid;
}

/**
 * List operation logs within retention window (default 90 days).
 */
function listLogs({ conferenceId, limit = 200 } = {}) {
  const db = getDb();
  const params = [];
  let sql = `
    SELECT ol.*, u.username
    FROM operation_logs ol
    LEFT JOIN users u ON u.id = ol.user_id
    WHERE ol.created_at >= datetime('now', ?)
  `;
  params.push(`-${config.logRetentionDays} days`);

  if (conferenceId != null) {
    sql += ' AND ol.conference_id = ?';
    params.push(conferenceId);
  }

  sql += ' ORDER BY ol.created_at DESC, ol.id DESC LIMIT ?';
  params.push(limit);

  return db.prepare(sql).all(...params).map(toPublic);
}

function getLog(id) {
  const db = getDb();
  const row = db
    .prepare(
      `SELECT ol.*, u.username
       FROM operation_logs ol
       LEFT JOIN users u ON u.id = ol.user_id
       WHERE ol.id = ?`
    )
    .get(id);
  return toPublic(row);
}

/**
 * Roll back to the state *before* the given log entry.
 * - create  → hide the conference (soft undo)
 * - update/hide/unhide/rollback → restore before_data snapshot
 */
function rollback(logId, userId) {
  const conferences = require('./conferences');
  const entry = getLog(logId);
  if (!entry) {
    const err = new Error('操作ログが見つかりません');
    err.status = 404;
    throw err;
  }

  const db = getDb();
  const fresh = db
    .prepare(
      `SELECT id FROM operation_logs
       WHERE id = ? AND created_at >= datetime('now', ?)`
    )
    .get(logId, `-${config.logRetentionDays} days`);
  if (!fresh) {
    const err = new Error('保持期間（3か月）を過ぎたログはロールバックできません');
    err.status = 400;
    throw err;
  }

  const current = entry.conferenceId
    ? conferences.getRaw(entry.conferenceId)
    : null;

  let after = null;

  if (entry.action === 'create') {
    if (!entry.conferenceId || !current) {
      const err = new Error('ロールバック対象の学会が存在しません');
      err.status = 400;
      throw err;
    }
    db.prepare(
      `UPDATE conferences SET is_hidden = 1, updated_by = ?, updated_at = datetime('now')
       WHERE id = ?`
    ).run(userId, entry.conferenceId);
    after = conferences.getRaw(entry.conferenceId);
  } else if (entry.beforeData) {
    conferences.restoreFromSnapshot(entry.beforeData, userId);
    after = conferences.getRaw(entry.beforeData.id);
  } else {
    const err = new Error('この操作にはロールバック用のスナップショットがありません');
    err.status = 400;
    throw err;
  }

  logOperation({
    conferenceId: entry.conferenceId || (entry.beforeData && entry.beforeData.id) || null,
    userId,
    action: 'rollback',
    beforeData: current,
    afterData: after,
  });

  return {
    log: entry,
    conference: conferences.toPublic(after),
  };
}

module.exports = {
  logOperation,
  listLogs,
  getLog,
  rollback,
};
