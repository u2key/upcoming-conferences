'use strict';

const { getDb } = require('../db/database');
const audit = require('./audit');

const COLUMNS = [
  'id',
  'name',
  'type',
  'application_deadline',
  'abstract_deadline',
  'manuscript_deadline',
  'start_date',
  'end_date',
  'website',
  'tag',
  'location',
  'is_hidden',
  'created_by',
  'updated_by',
  'created_at',
  'updated_at',
];

function toPublic(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    type: row.type,
    applicationDeadline: row.application_deadline,
    abstractDeadline: row.abstract_deadline,
    manuscriptDeadline: row.manuscript_deadline,
    startDate: row.start_date,
    endDate: row.end_date,
    website: row.website || '',
    tag: row.tag || '',
    location: row.location,
    isHidden: !!row.is_hidden,
    createdBy: row.created_by,
    updatedBy: row.updated_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function rowFromInput(data) {
  const abstract_deadline = data.abstractDeadline || data.abstract_deadline || null;
  const manuscript_deadline = data.manuscriptDeadline || data.manuscript_deadline || null;
  let application_deadline = data.applicationDeadline || data.application_deadline || null;

  // If no application deadline was given, default it to the earlier of the
  // abstract/manuscript deadlines (whichever is set).
  if (!application_deadline) {
    const candidates = [abstract_deadline, manuscript_deadline].filter(Boolean);
    if (candidates.length) {
      application_deadline = candidates.sort()[0];
    }
  }

  return {
    name: (data.name || '').trim(),
    type: data.type,
    application_deadline,
    abstract_deadline,
    manuscript_deadline,
    start_date: data.startDate || data.start_date || null,
    end_date: data.endDate || data.end_date || null,
    website: (data.website || data.website || '').trim(),
    tag: (data.tag || data.tag || '').trim(),
    location: (data.location || '').trim(),
  };
}

function validate(fields) {
  if (!fields.name) {
    const err = new Error('学会名は必須です');
    err.status = 400;
    throw err;
  }
  if (fields.type !== 'domestic' && fields.type !== 'international') {
    const err = new Error('type は domestic または international である必要があります');
    err.status = 400;
    throw err;
  }
}

function getRaw(id) {
  const db = getDb();
  return db.prepare('SELECT * FROM conferences WHERE id = ?').get(id);
}

function getById(id) {
  return toPublic(getRaw(id));
}

/**
 * List conferences.
 * @param {{ type?: string, includeHidden?: boolean }} opts
 */
function list({ type, includeHidden = false } = {}) {
  const db = getDb();
  const clauses = [];
  const params = [];

  if (type) {
    clauses.push('type = ?');
    params.push(type);
  }
  if (!includeHidden) {
    clauses.push('is_hidden = 0');
  }

  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const rows = db
    .prepare(
      `SELECT * FROM conferences ${where}
       ORDER BY
         CASE WHEN application_deadline IS NULL OR application_deadline = '' THEN 1 ELSE 0 END,
         application_deadline ASC,
         name ASC`
    )
    .all(...params);

  return rows.map(toPublic);
}

/**
 * Create a conference and write an audit log entry.
 */
function create(data, userId) {
  const fields = rowFromInput(data);
  validate(fields);

  const db = getDb();
  const result = db
    .prepare(
      `INSERT INTO conferences
         (name, type, application_deadline, abstract_deadline, manuscript_deadline,
          start_date, end_date, website, tag, location, is_hidden, created_by, updated_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      fields.name,
      fields.type,
      fields.application_deadline,
      fields.abstract_deadline,
      fields.manuscript_deadline,
      fields.start_date,
      fields.end_date,
      fields.website,
      fields.tag,
      fields.location,
      0,
      userId,
      userId
    );

  const created = getRaw(result.lastInsertRowid);
  audit.logOperation({
    conferenceId: created.id,
    userId,
    action: 'create',
    beforeData: null,
    afterData: created,
  });

  return toPublic(created);
}

/**
 * Update conference fields and write audit log.
 */
function update(id, data, userId) {
  const existing = getRaw(id);
  if (!existing) {
    const err = new Error('学会が見つかりません');
    err.status = 404;
    throw err;
  }

  const fields = rowFromInput({ ...toPublic(existing), ...data });
  // Keep type from input if provided, else existing
  if (data.type) fields.type = data.type;
  validate(fields);

  const db = getDb();
  db.prepare(
    `UPDATE conferences SET
       name = ?, type = ?,
       application_deadline = ?, abstract_deadline = ?, manuscript_deadline = ?,
     start_date = ?, end_date = ?, website = ?, tag = ?, location = ?,
       updated_by = ?, updated_at = datetime('now')
     WHERE id = ?`
  ).run(
    fields.name,
    fields.type,
    fields.application_deadline,
    fields.abstract_deadline,
    fields.manuscript_deadline,
    fields.start_date,
    fields.end_date,
    fields.website,
    fields.tag,
    fields.location,
    userId,
    id
  );

  const updated = getRaw(id);
  audit.logOperation({
    conferenceId: id,
    userId,
    action: 'update',
    beforeData: existing,
    afterData: updated,
  });

  return toPublic(updated);
}

/**
 * Hide or unhide a conference.
 */
function setHidden(id, isHidden, userId) {
  const existing = getRaw(id);
  if (!existing) {
    const err = new Error('学会が見つかりません');
    err.status = 404;
    throw err;
  }

  const db = getDb();
  db.prepare(
    `UPDATE conferences SET is_hidden = ?, updated_by = ?, updated_at = datetime('now')
     WHERE id = ?`
  ).run(isHidden ? 1 : 0, userId, id);

  const updated = getRaw(id);
  audit.logOperation({
    conferenceId: id,
    userId,
    action: isHidden ? 'hide' : 'unhide',
    beforeData: existing,
    afterData: updated,
  });

  return toPublic(updated);
}

/**
 * Restore conference state from a snapshot (used by rollback).
 * Does not itself write a new log — caller (audit.rollback) does.
 */
function restoreFromSnapshot(snapshot, userId) {
  if (!snapshot || !snapshot.id) {
    const err = new Error('不正なスナップショットです');
    err.status = 400;
    throw err;
  }

  const db = getDb();
  const existing = getRaw(snapshot.id);

  if (existing) {
    db.prepare(
      `UPDATE conferences SET
         name = ?, type = ?,
         application_deadline = ?, abstract_deadline = ?, manuscript_deadline = ?,
       start_date = ?, end_date = ?, website = ?, tag = ?, location = ?, is_hidden = ?,
         updated_by = ?, updated_at = datetime('now')
       WHERE id = ?`
    ).run(
      snapshot.name,
      snapshot.type,
      snapshot.application_deadline,
      snapshot.abstract_deadline,
      snapshot.manuscript_deadline,
      snapshot.start_date,
      snapshot.end_date,
    snapshot.website || '',
    snapshot.tag || '',
    snapshot.location || '',
    snapshot.is_hidden ? 1 : 0,
    userId,
    snapshot.id
    );
  } else {
    // Re-insert with original id if the row was somehow missing
    db.prepare(
      `INSERT INTO conferences
         (id, name, type, application_deadline, abstract_deadline, manuscript_deadline,
          start_date, end_date, website, tag, location, is_hidden, created_by, updated_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      snapshot.id,
      snapshot.name,
      snapshot.type,
      snapshot.application_deadline,
      snapshot.abstract_deadline,
      snapshot.manuscript_deadline,
      snapshot.start_date,
      snapshot.end_date,
      snapshot.website || '',
      snapshot.tag || '',
      snapshot.location || '',
      snapshot.is_hidden ? 1 : 0,
      snapshot.created_by || userId,
      userId
    );
  }

  return toPublic(getRaw(snapshot.id));
}

// Permanently delete a conference and return the deleted public data, or null if not found
function deleteById(id) {
  const db = getDb();
  const existing = getRaw(id);
  if (!existing) return null;
  db.prepare('DELETE FROM conferences WHERE id = ?').run(id);
  // skipping audit log to avoid adding new action types
  return toPublic(existing);
}

module.exports = {
  toPublic,
  getById,
  getRaw,
  list,
  create,
  update,
  setHidden,
  restoreFromSnapshot,
  deleteById,
  COLUMNS,
};
