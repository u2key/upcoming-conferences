'use strict';

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const rootDir = path.join(__dirname, '..');

module.exports = {
  port: parseInt(process.env.PORT || '3000', 10),
  nodeEnv: process.env.NODE_ENV || 'development',
  sessionSecret: process.env.SESSION_SECRET || 'dev-only-session-secret-change-me',
  dbPath: process.env.DB_PATH || path.join(rootDir, 'data', 'conferences.db'),
  admin: {
    username: process.env.ADMIN_USERNAME || 'root',
    password: process.env.ADMIN_PASSWORD || 'toor',
    email: process.env.ADMIN_EMAIL || 'admin@localhost',
  },
  mail: {
    host: process.env.SMTP_HOST || '',
    port: parseInt(process.env.SMTP_PORT || '587', 10),
    secure: process.env.SMTP_SECURE === 'true',
    user: process.env.SMTP_USER || '',
    pass: process.env.SMTP_PASS || '',
    from: process.env.MAIL_FROM || 'noreply@upcoming-conferences.local',
  },
  appBaseUrl: process.env.APP_BASE_URL || 'http://localhost:3000',
  /** Operation logs older than this many days are purged. */
  logRetentionDays: 90,
};
