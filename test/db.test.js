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

  it('unifies areas of records sharing a tag at startup, losing nothing', () => {
    const config = require('../src/config');
    const originalPath = config.dbPath;
    closeDb();
    config.dbPath = path.join(tmpDir, 'areas.db');
    try {
      let db = getDb();
      const insert = db.prepare(`INSERT INTO conferences (name, type, tag, areas) VALUES (?, 'domestic', ?, ?)`);
      insert.run('a1', 'a', 'x,y');
      insert.run('a2', 'a', 'y,z');
      insert.run('a3', 'a', '');
      insert.run('same1', 'same', 'q');
      insert.run('same2', 'same', 'q');
      insert.run('none1', '', 'one');
      insert.run('none2', '', 'two');
      closeDb();

      db = getDb();
      const areasOf = (name) => db.prepare('SELECT areas FROM conferences WHERE name = ?').get(name).areas;
      for (const name of ['a1', 'a2', 'a3']) assert.equal(areasOf(name), 'x,y,z');
      assert.equal(areasOf('same1'), 'q');
      // No tag means no group
      assert.equal(areasOf('none1'), 'one');
      assert.equal(areasOf('none2'), 'two');
    } finally {
      closeDb();
      config.dbPath = originalPath;
    }
  });

  it('migrates operation_logs from a database that predates delete logging', () => {
    const Database = require('better-sqlite3');
    const config = require('../src/config');
    const schema = fs.readFileSync(path.join(__dirname, '../src/db/schema.sql'), 'utf8');
    const oldSchema = schema.replace(", 'delete'))", '))').replace(/^\s*notify_email .*\n/gm, '').replace(/^\s*areas .*\n/gm, '');
    assert.ok(!oldSchema.includes('notify_email'));
    assert.notEqual(oldSchema, schema);

    const oldPath = path.join(tmpDir, 'old.db');
    const old = new Database(oldPath);
    old.exec(oldSchema);
    old.prepare(
      `INSERT INTO users (id, username, email, password_hash, full_name) VALUES (7, 'u', 'u@x', 'h', 'U')`
    ).run();
    old.prepare(
      `INSERT INTO operation_logs (id, conference_id, user_id, action, before_data, after_data, created_at)
       VALUES (42, 5, 7, 'update', '{"a":1}', '{"a":2}', '2026-01-02 03:04:05')`
    ).run();
    assert.throws(() =>
      old.prepare(`INSERT INTO operation_logs (user_id, action) VALUES (7, 'delete')`).run()
    );
    old.close();

    const originalPath = config.dbPath;
    closeDb();
    config.dbPath = oldPath;
    try {
      const db = getDb();
      assert.deepEqual(db.prepare('SELECT * FROM operation_logs').all(), [
        {
          id: 42,
          conference_id: 5,
          user_id: 7,
          action: 'update',
          before_data: '{"a":1}',
          after_data: '{"a":2}',
          created_at: '2026-01-02 03:04:05',
        },
      ]);
      db.prepare(`INSERT INTO operation_logs (user_id, action) VALUES (7, 'delete')`).run();

      const conferenceColumns = db.prepare(`PRAGMA table_info('conferences')`).all();
      assert.ok(conferenceColumns.some((c) => c.name === 'areas'));

      // Existing users default to receiving the notification mail
      assert.equal(db.prepare('SELECT notify_email FROM users WHERE id = 7').get().notify_email, 1);
      const applicationColumns = db.prepare(`PRAGMA table_info('account_applications')`).all();
      assert.ok(applicationColumns.some((c) => c.name === 'notify_email'));

      const names = db.prepare(`SELECT name FROM sqlite_master`).all().map((r) => r.name);
      assert.ok(names.includes('idx_operation_logs_created'));
      assert.ok(names.includes('idx_operation_logs_conference'));
      assert.ok(!names.includes('operation_logs_legacy'));

      // Re-opening a migrated database changes nothing
      closeDb();
      assert.equal(getDb().prepare('SELECT COUNT(*) AS c FROM operation_logs').get().c, 2);
    } finally {
      closeDb();
      config.dbPath = originalPath;
    }
  });
});
