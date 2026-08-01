'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'uc-db-'));
const tmpDb = path.join(tmpDir, 'test.db');

process.env.DB_PATH = tmpDb;
process.env.ADMIN_USERNAME = 'root';
process.env.ADMIN_PASSWORD = 'toor';
process.env.ADMIN_EMAIL = 'admin@test.local';

// Re-require after env is set
delete require.cache[require.resolve('../src/config')];
delete require.cache[require.resolve('../src/db/database')];
delete require.cache[require.resolve('../src/db/init')];

const { getDb, closeDb, purgeOldLogs } = require('../src/db/database');
const { ensureAdmin } = require('../src/db/init');

describe('database', () => {
  before(() => {
    getDb();
  });

  after(() => {
    closeDb();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('creates schema tables', () => {
    const db = getDb();
    const tables = db
      .prepare(
        `SELECT name FROM sqlite_master WHERE type='table' ORDER BY name`
      )
      .all()
      .map((r) => r.name);

    for (const name of [
      'users',
      'account_applications',
      'conferences',
      'operation_logs',
      'sessions',
    ]) {
      assert.ok(tables.includes(name), `missing table: ${name}`);
    }
  });

  it('creates default admin root/toor', () => {
    const id = ensureAdmin();
    assert.ok(id > 0);

    const db = getDb();
    const user = db
      .prepare('SELECT * FROM users WHERE username = ?')
      .get('root');
    assert.equal(user.is_admin, 1);
    assert.equal(user.is_active, 1);

    const bcrypt = require('bcryptjs');
    assert.ok(bcrypt.compareSync('toor', user.password_hash));

    // idempotent
    const id2 = ensureAdmin();
    assert.equal(id2, id);
  });

  it('purges old operation logs', () => {
    const db = getDb();
    const user = db.prepare('SELECT id FROM users WHERE username = ?').get('root');

    db.prepare(
      `INSERT INTO operation_logs (conference_id, user_id, action, before_data, after_data, created_at)
       VALUES (NULL, ?, 'create', NULL, '{}', datetime('now', '-100 days'))`
    ).run(user.id);

    db.prepare(
      `INSERT INTO operation_logs (conference_id, user_id, action, before_data, after_data, created_at)
       VALUES (NULL, ?, 'create', NULL, '{}', datetime('now', '-10 days'))`
    ).run(user.id);

    const deleted = purgeOldLogs(90);
    assert.equal(deleted, 1);

    const remaining = db.prepare('SELECT COUNT(*) AS c FROM operation_logs').get().c;
    assert.equal(remaining, 1);
  });
});
