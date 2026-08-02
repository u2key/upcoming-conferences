-- users: approved accounts (including default admin)
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  full_name TEXT NOT NULL,
  affiliation TEXT NOT NULL DEFAULT '',
  is_admin INTEGER NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- account creation applications
CREATE TABLE IF NOT EXISTS account_applications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL,
  full_name TEXT NOT NULL,
  affiliation TEXT NOT NULL,
  username TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected')),
  -- rejected applications can be hidden from the admin console
  is_hidden INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  reviewed_at TEXT,
  reviewed_by INTEGER,
  FOREIGN KEY (reviewed_by) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_applications_status
  ON account_applications(status, is_hidden);

-- conferences (domestic / international)
CREATE TABLE IF NOT EXISTS conferences (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('domestic', 'international')),
  application_deadline TEXT,
  abstract_deadline TEXT,
  manuscript_deadline TEXT,
  start_date TEXT,
  end_date TEXT,
  website TEXT NOT NULL DEFAULT '',
  location TEXT NOT NULL DEFAULT '',
  is_hidden INTEGER NOT NULL DEFAULT 0,
  created_by INTEGER,
  updated_by INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (created_by) REFERENCES users(id),
  FOREIGN KEY (updated_by) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_conferences_type_hidden
  ON conferences(type, is_hidden);

-- operation logs for audit / rollback (retained ~3 months)
CREATE TABLE IF NOT EXISTS operation_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  conference_id INTEGER,
  user_id INTEGER NOT NULL,
  action TEXT NOT NULL
    CHECK (action IN ('create', 'update', 'hide', 'unhide', 'rollback')),
  before_data TEXT,
  after_data TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_operation_logs_created
  ON operation_logs(created_at);

CREATE INDEX IF NOT EXISTS idx_operation_logs_conference
  ON operation_logs(conference_id);

-- express-session store (connect-sqlite3 compatible shape, managed manually)
CREATE TABLE IF NOT EXISTS sessions (
  sid TEXT PRIMARY KEY,
  sess TEXT NOT NULL,
  expired INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sessions_expired ON sessions(expired);
