'use strict';

/**
 * Initialize the database and ensure the default admin account exists.
 * Safe to run multiple times (idempotent).
 */

const bcrypt = require('bcryptjs');
const config = require('../config');
const { getDb, closeDb, purgeOldLogs } = require('./database');

function ensureAdmin() {
  const db = getDb();
  const existing = db
    .prepare('SELECT id FROM users WHERE username = ?')
    .get(config.admin.username);

  if (existing) {
    console.log(`Admin user "${config.admin.username}" already exists (id=${existing.id}).`);
    return existing.id;
  }

  const passwordHash = bcrypt.hashSync(config.admin.password, 10);
  const result = db
    .prepare(
      `INSERT INTO users (username, email, password_hash, full_name, affiliation, is_admin, is_active)
       VALUES (?, ?, ?, ?, ?, 1, 1)`
    )
    .run(
      config.admin.username,
      config.admin.email,
      passwordHash,
      'Administrator',
      'System'
    );

  console.log(
    `Created default admin user "${config.admin.username}" (id=${result.lastInsertRowid}).`
  );
  return result.lastInsertRowid;
}

function main() {
  console.log(`Initializing database at: ${config.dbPath}`);
  getDb();
  ensureAdmin();
  const purged = purgeOldLogs();
  if (purged > 0) {
    console.log(`Purged ${purged} operation log(s) older than ${config.logRetentionDays} days.`);
  }
  console.log('Database initialization complete.');
  closeDb();
}

if (require.main === module) {
  main();
}

module.exports = { ensureAdmin, main };
