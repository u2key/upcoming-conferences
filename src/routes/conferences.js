'use strict';

const express = require('express');
const conferences = require('../services/conferences');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

/**
 * Attach a function to broadcast conference updates via Socket.io.
 * Set by server after io is created: router.setBroadcast(fn)
 */
let broadcast = () => {};

router.setBroadcast = (fn) => {
  broadcast = fn;
};

function emitUpdate(reason, conference) {
  try {
    broadcast({ reason, conference, conferences: conferences.list({ includeHidden: false }) });
  } catch (e) {
    console.warn('[socket] broadcast failed:', e.message);
  }
}

/**
 * GET /api/conferences/export
 * Public-friendly raw JSON export for integrations.
 * Query params:
 *  - type=domestic|international
 *  - tag=TAG (exact match)
 *  - since=ISO8601 (filters updatedAt >= since)
 *  - fields=comma,separated,list (select subset of returned keys)
 *  - format=json|ndjson (default json)
 *  - includeHidden=1 (only honored for authenticated users)
 */
router.get('/export', (req, res) => {
  try {
    // Basic param validation
    const type = req.query.type || undefined;
    if (type && type !== 'domestic' && type !== 'international') {
      return res.status(400).json({ error: 'type は domestic または international です' });
    }

    const includeHidden = req.user && req.query.includeHidden === '1' ? true : false;
    // Load base list (public shape)
    let list = conferences.list({ type, includeHidden });

    // Tag filter
    if (req.query.tag) {
      const tag = String(req.query.tag);
      list = list.filter((c) => (c.tag || '') === tag);
    }

    // Since filter (updatedAt >= since)
    if (req.query.since) {
      const since = String(req.query.since);
      list = list.filter((c) => {
        const updated = c.updatedAt || c.createdAt || '';
        return updated >= since;
      });
    }

    // Fields selection
    let fields = null;
    if (req.query.fields) {
      fields = String(req.query.fields)
        .split(',')
        .map((f) => f.trim())
        .filter(Boolean);
      // sanitize: only allow keys present in a sample conference
      const sample = list[0] || conferences.toPublic({ id: null, name: '', type: 'domestic' });
      const allowed = new Set(Object.keys(sample));
      fields = fields.filter((f) => allowed.has(f));
      if (fields.length === 0) fields = null;
    }

    // Format
    const format = (req.query.format || 'json').toLowerCase();
    // CORS for integrations
    res.set('Access-Control-Allow-Origin', '*');
    res.set('Cache-Control', 'public, max-age=60');

    if (format === 'ndjson') {
      res.type('application/x-ndjson');
      // Stream as NDJSON
      for (const item of list) {
        const out = fields ? fields.reduce((acc, f) => ({ ...acc, [f]: item[f] }), {}) : item;
        res.write(JSON.stringify(out) + '\n');
      }
      return res.end();
    }

    // Default: JSON array
    res.json(fields ? list.map((item) => fields.reduce((acc, f) => ({ ...acc, [f]: item[f] }), {})) : list);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

/** GET /api/conferences — public list (hidden excluded). Query: type=domestic|international */
router.get('/', (req, res) => {
  try {
    const type = req.query.type || undefined;
    if (type && type !== 'domestic' && type !== 'international') {
      return res.status(400).json({ error: 'type は domestic または international です' });
    }
    // Authenticated users (editors/admins) may request hidden conferences; public cannot
    const includeHidden = req.user && req.query.includeHidden === '1' ? true : false;
    const list = conferences.list({ type, includeHidden });
    res.json({ conferences: list });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

/** GET /api/conferences/:id */
router.get('/:id', (req, res) => {
  try {
    const conf = conferences.getById(parseInt(req.params.id, 10));
    if (!conf) return res.status(404).json({ error: '学会が見つかりません' });
    if (conf.isHidden && !req.user) {
      return res.status(404).json({ error: '学会が見つかりません' });
    }
    res.json({ conference: conf });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

/** POST /api/conferences — create (approved users) */
router.post('/', requireAuth, (req, res) => {
  try {
    const conf = conferences.create(req.body || {}, req.user.id);
    emitUpdate('create', conf);
    res.status(201).json({ conference: conf });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

/** PUT /api/conferences/:id — update */
router.put('/:id', requireAuth, (req, res) => {
  try {
    const conf = conferences.update(parseInt(req.params.id, 10), req.body || {}, req.user.id);
    emitUpdate('update', conf);
    res.json({ conference: conf });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

/** POST /api/conferences/:id/hide */
router.post('/:id/hide', requireAuth, (req, res) => {
  try {
    const conf = conferences.setHidden(parseInt(req.params.id, 10), true, req.user.id);
    emitUpdate('hide', conf);
    res.json({ conference: conf });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

/** POST /api/conferences/:id/unhide */
router.post('/:id/unhide', requireAuth, (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const raw = conferences.getRaw(id);
    if (!raw) return res.status(404).json({ error: '学会が見つかりません' });
    // server-side end check: if conference has ended and user is not admin, forbid
    const end = (raw.end_date || '').slice(0, 10);
    const today = new Date().toISOString().slice(0, 10);
    const ended = end && end < today;
    if (ended && !(req.user && req.user.isAdmin)) {
      return res.status(403).json({ error: '終了した学会は管理者のみ再表示できます' });
    }
    const conf = conferences.setHidden(id, false, req.user.id);
    emitUpdate('unhide', conf);
    res.json({ conference: conf });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

/** DELETE /api/conferences/:id — permanent delete (admin only) */
router.delete('/:id', requireAuth, (req, res) => {
  try {
    if (!req.user || !req.user.isAdmin) return res.status(403).json({ error: '管理者権限が必要です' });
    const id = parseInt(req.params.id, 10);
    const deleted = conferences.deleteById(id);
    if (!deleted) return res.status(404).json({ error: '学会が見つかりません' });
    emitUpdate('delete', deleted);
    res.json({ ok: true });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

module.exports = router;
