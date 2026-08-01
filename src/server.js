'use strict';

const path = require('path');
const http = require('http');
const express = require('express');
const session = require('express-session');
const cookieParser = require('cookie-parser');

const config = require('./config');
const { getDb } = require('./db/database');
const { ensureAdmin } = require('./db/init');
const SqliteSessionStore = require('./middleware/session-store');
const { loadUser } = require('./middleware/auth');
const { attachSocket } = require('./socket');

const authRoutes = require('./routes/auth');
const conferenceRoutes = require('./routes/conferences');
const adminRoutes = require('./routes/admin');

// Ensure DB + default admin exist
getDb();
ensureAdmin();

const app = express();
const server = http.createServer(app);
const { broadcastConferences } = attachSocket(server);

conferenceRoutes.setBroadcast(broadcastConferences);
adminRoutes.setBroadcast(broadcastConferences);

const sessionStore = new SqliteSessionStore();
// Periodically clean expired sessions
setInterval(() => sessionStore.clearExpired(), 60 * 60 * 1000).unref();

app.set('trust proxy', 1);
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: false }));
app.use(cookieParser());
app.use(
  session({
    store: sessionStore,
    secret: config.sessionSecret,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      secure: config.nodeEnv === 'production',
      maxAge: 7 * 24 * 60 * 60 * 1000,
    },
  })
);
app.use(loadUser);

// API routes
app.use('/api/auth', authRoutes);
app.use('/api/conferences', conferenceRoutes);
app.use('/api/admin', adminRoutes);

// Health check
app.get('/api/health', (_req, res) => {
  res.json({ ok: true, time: new Date().toISOString() });
});

// Static frontend
const publicDir = path.join(__dirname, '..', 'public');
app.use(express.static(publicDir));

// SPA-ish fallback for known pages
app.get(['/admin', '/admin/'], (_req, res) => {
  res.sendFile(path.join(publicDir, 'admin.html'));
});

// Error handler
app.use((err, _req, res, _next) => {
  console.error('[error]', err);
  res.status(err.status || 500).json({ error: err.message || 'Internal Server Error' });
});

function start() {
  server.listen(config.port, () => {
    console.log(`upcoming-conferences listening on http://localhost:${config.port}`);
    console.log(`  env=${config.nodeEnv}  db=${config.dbPath}`);
  });
}

if (require.main === module) {
  start();
}

module.exports = { app, server, start, broadcastConferences };
