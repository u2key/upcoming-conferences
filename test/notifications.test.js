'use strict';

const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const http = require('http');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'uc-notify-'));

process.env.DB_PATH = path.join(tmpDir, 'test.db');
process.env.NODE_ENV = 'test';
process.env.SESSION_SECRET = 'test-secret';
process.env.ADMIN_USERNAME = 'root';
process.env.ADMIN_PASSWORD = 'toor';
process.env.ADMIN_EMAIL = 'admin@test.local';
process.env.SMTP_HOST = ''; // never send real mail
process.env.NOTIFICATION_TIMEZONE = 'Asia/Tokyo';
process.env.NOTIFICATION_HOUR = '9';

const { server } = require('../src/server');
const mail = require('../src/services/mail');
const notifications = require('../src/services/notifications');
const { getDb, closeDb } = require('../src/db/database');

function request(method, urlPath, { body, cookie } = {}) {
  return new Promise((resolve, reject) => {
    const payload = body != null ? JSON.stringify(body) : null;
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port: server.address().port,
        path: urlPath,
        method,
        headers: {
          ...(payload
            ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }
            : {}),
          ...(cookie ? { Cookie: cookie } : {}),
        },
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const setCookie = res.headers['set-cookie'];
          resolve({
            status: res.statusCode,
            json: JSON.parse(Buffer.concat(chunks).toString('utf8') || 'null'),
            cookie: setCookie ? setCookie.map((c) => c.split(';')[0]).join('; ') : cookie,
          });
        });
      }
    );
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

const login = async (username, password) =>
  (await request('POST', '/api/auth/login', { body: { username, password } })).cookie;

describe('notification mail', () => {
  let admin;
  let sent;
  const transport = () => mail.getTransporter();
  let originalSendMail;

  // Register and approve a user. Returns their session cookie.
  async function addUser(username, extra = {}) {
    const res = await request('POST', '/api/auth/register', {
      body: {
        email: `${username}@example.com`,
        fullName: `FULLNAME_${username}`,
        affiliation: 'Lab',
        username,
        password: 'password1',
        ...extra,
      },
    });
    assert.equal(res.status, 201);
    await request('POST', `/api/admin/applications/${res.json.application.id}/approve`, { cookie: admin });
    return login(username, 'password1');
  }

  const addConference = (fields) =>
    request('POST', '/api/conferences', { cookie: admin, body: { type: 'domestic', ...fields } });

  before(async () => {
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    admin = await login('root', 'toor');
    originalSendMail = transport().sendMail;
  });

  after(async () => {
    transport().sendMail = originalSendMail;
    await new Promise((resolve) => server.close(resolve));
    closeDb();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  beforeEach(() => {
    sent = [];
    transport().sendMail = async (options) => {
      sent.push(options);
      return { messageId: 'test' };
    };
  });

  it('defaults to on, honors the choice at application, and can be toggled', async () => {
    const onByDefault = await addUser('default_on');
    let me = await request('GET', '/api/auth/me', { cookie: onByDefault });
    assert.equal(me.json.user.notifyEmail, true);

    const optedOut = await addUser('opted_out', { notifyEmail: false });
    me = await request('GET', '/api/auth/me', { cookie: optedOut });
    assert.equal(me.json.user.notifyEmail, false);

    const url = '/api/auth/notification-preference';
    assert.equal((await request('PUT', url, { body: { notifyEmail: true } })).status, 401);
    assert.equal((await request('PUT', url, { cookie: onByDefault, body: { notifyEmail: 'no' } })).status, 400);
    const off = await request('PUT', url, { cookie: onByDefault, body: { notifyEmail: false } });
    assert.equal(off.status, 200);
    assert.equal(off.json.user.notifyEmail, false);
    me = await request('GET', '/api/auth/me', { cookie: onByDefault });
    assert.equal(me.json.user.notifyEmail, false);
    await request('PUT', url, { cookie: onByDefault, body: { notifyEmail: true } });
  });

  it('refuses to send when no tag is missing, and sends nothing automatically', async () => {
    await addConference({ name: 'Future', tag: 'future-tag', endDate: '2099-01-01' });
    await addConference({ name: 'Untagged old', endDate: '2020-01-01' });

    const status = await request('GET', '/api/admin/notifications', { cookie: admin });
    assert.equal(status.json.tagCount, 0);
    assert.equal((await request('POST', '/api/admin/notifications/send', { cookie: admin })).status, 409);
    assert.equal(sent.length, 0);

    const run = await notifications.runScheduled(new Date('2026-11-02T01:00:00Z'));
    assert.equal(run.sentCount, 0);
    assert.equal(sent.length, 0);
  });

  it('previews without sending, for admins only', async () => {
    await addConference({
      name: 'Old Conf 2024',
      tag: 'old-conf',
      startDate: '2024-05-01',
      endDate: '2024-05-03',
      website: 'https://example.com/old',
    });
    await addConference({ name: 'Old Conf 2023', tag: 'old-conf', startDate: '2023-05-01', endDate: '2023-05-03' });
    await addConference({ name: 'Bad Link', tag: 'bad-link', endDate: '2020-01-01', website: 'javascript:alert(1)' });

    const url = '/api/admin/notifications';
    assert.equal((await request('GET', url)).status, 401);
    const editor = await login('default_on', 'password1');
    assert.equal((await request('GET', url, { cookie: editor })).status, 403);
    assert.equal((await request('POST', `${url}/send`, { cookie: editor })).status, 403);

    const status = await request('GET', url, { cookie: admin });
    assert.equal(status.status, 200);
    assert.equal(status.json.tagCount, 2);
    assert.deepEqual(status.json.recipients, ['root', 'default_on']);
    assert.match(status.json.text, /^root さん/);
    assert.match(status.json.text, /Old Conf 2024（タグ: old-conf）/);
    assert.doesNotMatch(status.json.text, /Old Conf 2023/);
    assert.match(status.json.text, /https:\/\/example\.com\/old/);
    assert.doesNotMatch(status.json.text, /javascript:/);
    assert.doesNotMatch(status.json.text, /Future/);
    assert.equal(sent.length, 0);
  });

  it('sends each opted-in user a mail addressed by username, never full name', async () => {
    const res = await request('POST', '/api/admin/notifications/send', { cookie: admin });
    assert.equal(res.status, 200);
    assert.equal(res.json.sentCount, 2);
    assert.deepEqual(res.json.failed, []);

    assert.deepEqual(sent.map((m) => m.to), ['admin@test.local', 'default_on@example.com']);
    assert.match(sent[1].text, /^default_on さん/);
    for (const m of sent) {
      assert.doesNotMatch(m.text, /FULLNAME_|Administrator/);
    }

    const status = await request('GET', '/api/admin/notifications', { cookie: admin });
    assert.equal(status.json.runs[0].kind, 'manual');
    assert.equal(status.json.runs[0].username, 'root');
    assert.equal(status.json.runs[0].sentCount, 2);
  });

  it('keeps sending after one failure and reports it', async () => {
    transport().sendMail = async (options) => {
      if (options.to === 'admin@test.local') throw new Error('rejected');
      sent.push(options);
    };
    const res = await request('POST', '/api/admin/notifications/send', { cookie: admin });
    assert.equal(res.status, 200);
    assert.equal(res.json.sentCount, 1);
    assert.deepEqual(res.json.failed, ['root']);
    assert.deepEqual(sent.map((m) => m.to), ['default_on@example.com']);
    const status = await request('GET', '/api/admin/notifications', { cookie: admin });
    assert.equal(status.json.runs[0].failedCount, 1);
  });

  it('sends automatically only on the first Monday from 9:00 Tokyo time', async () => {
    const notDue = [
      '2026-12-06T23:59:00Z', // Mon Dec 7, 08:59 JST: too early
      '2026-12-06T15:00:00Z', // Mon Dec 7, 00:00 JST: too early
      '2026-12-07T15:00:00Z', // Monday in UTC, but Tue Dec 8 in JST: day has passed
      '2026-12-14T01:00:00Z', // second Monday
      '2026-12-01T01:00:00Z', // first of the month, a Tuesday
      '2026-11-30T01:00:00Z', // last Monday of November
      '2026-11-05T01:00:00Z', // after this month's first Monday: no catch-up
    ];
    for (const at of notDue) {
      assert.equal(await notifications.runScheduled(new Date(at)), null, at);
    }
    assert.equal(sent.length, 0);

    const run = await notifications.runScheduled(new Date('2026-12-07T00:00:00Z')); // 09:00 JST
    assert.equal(run.period, '2026-12');
    assert.equal(run.sentCount, 2);
    assert.equal(sent.length, 2);

    // A later check, a restart or another instance must not send it again
    assert.equal(await notifications.runScheduled(new Date('2026-12-07T05:00:00Z')), null);
    assert.equal(sent.length, 2);

    // The first of the month can itself be the first Monday
    const february = await notifications.runScheduled(new Date('2027-02-01T02:00:00Z'));
    assert.equal(february.period, '2027-02');

    const auto = getDb().prepare(`SELECT * FROM notification_runs WHERE period = '2026-12'`).get();
    assert.equal(auto.kind, 'auto');
    assert.equal(auto.sent_count, 2);
  });

  it('skips users who turned it off or were deactivated', async () => {
    const cookie = await login('default_on', 'password1');
    await request('PUT', '/api/auth/notification-preference', { cookie, body: { notifyEmail: false } });
    let status = await request('GET', '/api/admin/notifications', { cookie: admin });
    assert.deepEqual(status.json.recipients, ['root']);

    await request('PUT', '/api/auth/notification-preference', { cookie, body: { notifyEmail: true } });
    getDb().prepare(`UPDATE users SET is_active = 0 WHERE username = 'default_on'`).run();
    status = await request('GET', '/api/admin/notifications', { cookie: admin });
    assert.deepEqual(status.json.recipients, ['root']);
    getDb().prepare(`UPDATE users SET is_active = 1 WHERE username = 'default_on'`).run();
  });

  it('computes the next automatic send', () => {
    const next = (at) => notifications.nextAutoSend(new Date(at));
    assert.equal(next('2026-11-05T01:00:00Z'), '2026-12-07 09:00');
    assert.equal(next('2026-12-06T23:59:00Z'), '2026-12-07 09:00');
    assert.equal(next('2026-12-07T00:00:00Z'), '2027-01-04 09:00');
    assert.equal(next('2026-12-20T00:00:00Z'), '2027-01-04 09:00');
  });
});
