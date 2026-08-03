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

/** GET /api/conferences — public list (hidden excluded). Query: type=domestic|international */
router.get('/', (req, res) => {
  try {
    const type = req.query.type || undefined;
    if (type && type !== 'domestic' && type !== 'international') {
      return res.status(400).json({ error: 'type は domestic または international です' });
    }
    // Only admin users may request hidden conferences
    const includeHidden = req.user && req.user.isAdmin && req.query.includeHidden === '1' ? true : false;
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
    const conf = conferences.setHidden(parseInt(req.params.id, 10), false, req.user.id);
    emitUpdate('unhide', conf);
    res.json({ conference: conf });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

module.exports = router;
