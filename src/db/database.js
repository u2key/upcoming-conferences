'use strict';

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const config = require('../config');

let db = null;

/**
 * Open (or create) the SQLite database and apply schema.
 * @returns {import('better-sqlite3').Database}
 */
function getDb() {
  if (db) return db;

  const dir = path.dirname(config.dbPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  db = new Database(config.dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  const schemaPath = path.join(__dirname, 'schema.sql');
  const schema = fs.readFileSync(schemaPath, 'utf8');
  db.exec(schema);

  // Backfill migrations for existing databases: add 'website' and 'tag' columns if missing
  try {
    const info = db.prepare("PRAGMA table_info('conferences')").all();
    const cols = info.map((r) => r.name);
    if (!cols.includes('website')) {
      // Add website column with a safe default
      db.prepare("ALTER TABLE conferences ADD COLUMN website TEXT NOT NULL DEFAULT ''").run();
    }
    if (!cols.includes('tag')) {
      // Add tag column (identifier) to help reliably group recurring conferences
      db.prepare("ALTER TABLE conferences ADD COLUMN tag TEXT NOT NULL DEFAULT ''").run();
    }
  } catch (e) {
    // Migration failures should not crash startup; log and continue
    console.error('DB migration check failed:', e && e.message ? e.message : e);
  }

  return db;
}

/** Close the database connection (for tests / shutdown). */
function closeDb() {
  if (db) {
    db.close();
    db = null;
  }
}

/**
 * Delete operation logs older than retention period.
 * @param {number} [days]
 * @returns {number} number of deleted rows
 */
function purgeOldLogs(days = config.logRetentionDays) {
  const database = getDb();
  const result = database
    .prepare(
      `DELETE FROM operation_logs
       WHERE created_at < datetime('now', ?)`
    )
    .run(`-${days} days`);
  return result.changes;
}

module.exports = {
  getDb,
  closeDb,
  purgeOldLogs,
};
