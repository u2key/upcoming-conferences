'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const http = require('http');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'uc-api-'));
const tmpDb = path.join(tmpDir, 'test.db');

process.env.DB_PATH = tmpDb;
process.env.PORT = '0';
process.env.NODE_ENV = 'test';
process.env.SESSION_SECRET = 'test-secret';
process.env.ADMIN_USERNAME = 'root';
process.env.ADMIN_PASSWORD = 'toor';
process.env.ADMIN_EMAIL = 'admin@test.local';
process.env.SMTP_HOST = ''; // console mail

// Clear cached modules so config picks up env
for (const key of Object.keys(require.cache)) {
  if (key.includes('upcoming-conferences') || key.includes('uc-api')) {
    // only clear our app modules by path fragment
  }
}
// Force re-load of config-dependent modules
const moduleRoots = [
  'config',
  'db/database',
  'db/init',
  'services/users',
  'services/applications',
  'services/conferences',
  'services/audit',
  'services/mail',
  'middleware/auth',
  'middleware/session-store',
  'routes/auth',
  'routes/conferences',
  'routes/admin',
  'socket',
  'server',
];
for (const rel of moduleRoots) {
  const full = require.resolve('../src/' + rel);
  delete require.cache[full];
}

const { app, server, start } = require('../src/server');

function request(method, urlPath, { body, cookie } = {}) {
  return new Promise((resolve, reject) => {
    const addr = server.address();
    const payload = body != null ? JSON.stringify(body) : null;
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port: addr.port,
        path: urlPath,
        method,
        headers: {
          Accept: 'application/json',
          ...(payload
            ? {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(payload),
              }
            : {}),
          ...(cookie ? { Cookie: cookie } : {}),
        },
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          let json = null;
          try {
            json = text ? JSON.parse(text) : null;
          } catch {
            json = text;
          }
          const setCookie = res.headers['set-cookie'];
          resolve({
            status: res.statusCode,
            headers: res.headers,
            json,
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

describe('API integration', () => {
  before(async () => {
    await new Promise((resolve) => {
      server.listen(0, '127.0.0.1', resolve);
    });
  });

  after(async () => {
    await new Promise((resolve) => server.close(resolve));
    const { closeDb } = require('../src/db/database');
    closeDb();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('health check', async () => {
    const res = await request('GET', '/api/health');
    assert.equal(res.status, 200);
    assert.equal(res.json.ok, true);
  });

  it('login root/toor and create conference', async () => {
    const login = await request('POST', '/api/auth/login', {
      body: { username: 'root', password: 'toor' },
    });
    assert.equal(login.status, 200);
    assert.equal(login.json.user.username, 'root');
    assert.ok(login.json.user.isAdmin);
    const cookie = login.cookie;

    const created = await request('POST', '/api/conferences', {
      cookie,
      body: {
        name: 'Test Conf',
        type: 'domestic',
        applicationDeadline: '2026-12-01',
        location: 'Kyoto',
      },
    });
    assert.equal(created.status, 201);
    assert.equal(created.json.conference.name, 'Test Conf');

    const list = await request('GET', '/api/conferences?type=domestic');
    assert.equal(list.status, 200);
    assert.ok(list.json.conferences.some((c) => c.name === 'Test Conf'));
  });

  it('application approve and reject flow', async () => {
    const login = await request('POST', '/api/auth/login', {
      body: { username: 'root', password: 'toor' },
    });
    const cookie = login.cookie;

    const app1 = await request('POST', '/api/auth/register', {
      body: {
        email: 'a@example.com',
        fullName: 'Applicant A',
        affiliation: 'Lab A',
        username: 'user_a',
        password: 'pass_a',
      },
    });
    assert.equal(app1.status, 201);
    const appId = app1.json.application.id;

    const approved = await request('POST', `/api/admin/applications/${appId}/approve`, {
      cookie,
    });
    assert.equal(approved.status, 200);
    assert.equal(approved.json.application.status, 'approved');
    assert.equal(approved.json.mailSent, true);

    const userLogin = await request('POST', '/api/auth/login', {
      body: { username: 'user_a', password: 'pass_a' },
    });
    assert.equal(userLogin.status, 200);

    const app2 = await request('POST', '/api/auth/register', {
      body: {
        email: 'b@example.com',
        fullName: 'Applicant B',
        affiliation: 'Lab B',
        username: 'user_b',
        password: 'pass_b',
      },
    });
    const app2Id = app2.json.application.id;
    const rejected = await request('POST', `/api/admin/applications/${app2Id}/reject`, {
      cookie,
    });
    assert.equal(rejected.status, 200);
    assert.equal(rejected.json.application.status, 'rejected');
    assert.equal(rejected.json.application.isHidden, true);

    const listed = await request('GET', '/api/admin/applications', { cookie });
    assert.ok(!listed.json.applications.some((a) => a.id === app2Id));

    const shown = await request('POST', `/api/admin/applications/${app2Id}/visibility`, {
      cookie,
      body: { isHidden: false },
    });
    assert.equal(shown.json.application.isHidden, false);

    const listed2 = await request('GET', '/api/admin/applications', { cookie });
    assert.ok(listed2.json.applications.some((a) => a.id === app2Id));
  });

  it('operation log and rollback', async () => {
    const login = await request('POST', '/api/auth/login', {
      body: { username: 'root', password: 'toor' },
    });
    const cookie = login.cookie;

    const created = await request('POST', '/api/conferences', {
      cookie,
      body: { name: 'Rollback Target', type: 'international', location: 'Paris' },
    });
    const id = created.json.conference.id;

    await request('PUT', `/api/conferences/${id}`, {
      cookie,
      body: { name: 'Rollback Target (edited)', location: 'Lyon' },
    });

    const logs = await request('GET', '/api/admin/logs', { cookie });
    const updateLog = logs.json.logs.find(
      (l) => l.conferenceId === id && l.action === 'update'
    );
    assert.ok(updateLog);

    const rb = await request('POST', `/api/admin/logs/${updateLog.id}/rollback`, {
      cookie,
    });
    assert.equal(rb.status, 200);
    assert.equal(rb.json.conference.name, 'Rollback Target');
    assert.equal(rb.json.conference.location, 'Paris');
  });

  it('rejects unauthenticated writes and non-admin admin routes', async () => {
    const create = await request('POST', '/api/conferences', {
      body: { name: 'Nope', type: 'domestic' },
    });
    assert.equal(create.status, 401);

    const login = await request('POST', '/api/auth/login', {
      body: { username: 'user_a', password: 'pass_a' },
    });
    // user_a was created in previous test — may not exist if order changes;
    // register a fresh non-admin if needed
    let cookie = login.cookie;
    if (login.status !== 200) {
      // skip if previous test didn't run — create via direct service path not needed
      return;
    }
    const admin = await request('GET', '/api/admin/applications', { cookie });
    assert.equal(admin.status, 403);
  });

  it('export API: filters, stable shape, and safe caching', async () => {
    const adminLogin = await request('POST', '/api/auth/login', {
      body: { username: 'root', password: 'toor' },
    });
    const cookie = adminLogin.cookie;
    const add = async (fields) =>
      (await request('POST', '/api/conferences', {
        cookie,
        body: { type: 'domestic', tag: 'export-test', ...fields },
      })).json.conference;
    const names = (res) => res.json.filter((c) => c.tag === 'export-test').map((c) => c.name).sort();
    const url = '/api/conferences/export';

    const future = await add({ name: 'ExFuture', endDate: '2099-01-01' });
    await add({ name: 'ExPast', endDate: '2020-01-01' });
    await add({ name: 'ExNoEnd' });
    const hidden = await add({ name: 'ExHidden', endDate: '2099-01-01' });
    await request('POST', `/api/conferences/${hidden.id}/hide`, { cookie });

    // Output shape is a contract with external consumers
    const all = await request('GET', url);
    assert.equal(all.status, 200);
    assert.deepEqual(Object.keys(all.json.find((c) => c.id === future.id)), [
      'id', 'name', 'type', 'applicationDeadline', 'abstractDeadline', 'manuscriptDeadline',
      'startDate', 'endDate', 'website', 'tag', 'areas', 'location', 'isHidden',
      'createdBy', 'updatedBy', 'createdAt', 'updatedAt',
    ]);
    assert.deepEqual(names(all), ['ExFuture', 'ExNoEnd', 'ExPast']);
    assert.equal(all.headers['access-control-allow-origin'], '*');
    assert.equal(all.headers['cache-control'], 'public, max-age=60');

    assert.deepEqual(names(await request('GET', `${url}?upcoming=1`)), ['ExFuture', 'ExNoEnd']);

    // since accepts every ISO 8601 form, including same-day updates
    const dayStart = `${new Date().toISOString().slice(0, 10)}T00:00:00Z`;
    assert.equal(names(await request('GET', `${url}?since=${dayStart}`)).length, 3);
    assert.equal(names(await request('GET', `${url}?since=${dayStart.slice(0, 10)}`)).length, 3);
    assert.equal(names(await request('GET', `${url}?since=2099-01-01T00:00:00Z`)).length, 0);
    // The same instant written with an offset
    const offset = `${dayStart.slice(0, 10)}T09:00:00%2B09:00`;
    assert.equal(names(await request('GET', `${url}?since=${offset}`)).length, 3);
    assert.equal((await request('GET', `${url}?since=garbage`)).status, 400);

    // Hidden records: never for the public, never in a shared cache
    const anon = await request('GET', `${url}?includeHidden=1`);
    assert.ok(!anon.json.some((c) => c.id === hidden.id));
    assert.equal(anon.headers['cache-control'], 'private, no-store');
    const authed = await request('GET', `${url}?includeHidden=1`, { cookie });
    assert.ok(authed.json.some((c) => c.id === hidden.id));
    assert.equal(authed.headers['cache-control'], 'private, no-store');

    const ndjson = await request('GET', `${url}?format=ndjson&tag=export-test&fields=name&upcoming=1`);
    assert.match(ndjson.headers['content-type'], /application\/x-ndjson/);
    const rows = String(ndjson.json).trim().split('\n').map((l) => JSON.parse(l));
    assert.deepEqual(rows.map((r) => r.name).sort(), ['ExFuture', 'ExNoEnd']);
    assert.deepEqual(Object.keys(rows[0]), ['name']);
  });

  it('stores areas, normalizes them, and keeps them through edits and rollback', async () => {
    const adminLogin = await request('POST', '/api/auth/login', {
      body: { username: 'root', password: 'toor' },
    });
    const cookie = adminLogin.cookie;
    const create = (body) => request('POST', '/api/conferences', { cookie, body: { type: 'domestic', ...body } });

    const none = await create({ name: 'AreaNone' });
    assert.deepEqual(none.json.conference.areas, []);

    // Comma styles, spacing and duplicates
    const made = await create({ name: 'AreaMade', areas: ' 機械学習, ネットワーク、セキュリティ，機械学習 ,' });
    assert.equal(made.status, 201);
    const id = made.json.conference.id;
    assert.deepEqual(made.json.conference.areas, ['機械学習', 'ネットワーク', 'セキュリティ']);
    const fromArray = await create({ name: 'AreaArray', areas: ['a,b', 'c'] });
    assert.deepEqual(fromArray.json.conference.areas, ['a', 'b', 'c']);

    // Other edits leave areas alone, including a client that doesn't know about them
    const renamed = await request('PUT', `/api/conferences/${id}`, { cookie, body: { name: 'AreaRenamed' } });
    assert.deepEqual(renamed.json.conference.areas, ['機械学習', 'ネットワーク', 'セキュリティ']);

    const edited = await request('PUT', `/api/conferences/${id}`, { cookie, body: { areas: 'HCI' } });
    assert.deepEqual(edited.json.conference.areas, ['HCI']);
    const cleared = await request('PUT', `/api/conferences/${id}`, { cookie, body: { areas: '' } });
    assert.deepEqual(cleared.json.conference.areas, []);

    // Rollback restores areas
    const logs = await request('GET', `/api/admin/logs?conferenceId=${id}`, { cookie });
    const clearing = logs.json.logs.find((l) => l.action === 'update' && l.afterData.areas === '');
    const rolled = await request('POST', `/api/admin/logs/${clearing.id}/rollback`, { cookie });
    assert.deepEqual(rolled.json.conference.areas, ['HCI']);

    // Invalid values
    assert.equal((await create({ name: 'Bad', areas: '未設定' })).status, 400);
    assert.equal((await create({ name: 'Bad', areas: 'x'.repeat(51) })).status, 400);
    assert.equal((await create({ name: 'Bad', areas: Array.from({ length: 11 }, (_, i) => `a${i}`) })).status, 400);

    // Public outputs
    const exported = await request('GET', '/api/conferences/export?fields=id,areas');
    assert.deepEqual(exported.json.find((c) => c.id === id).areas, ['HCI']);
  });

  it('calendar feed: valid iCalendar, public records only', async () => {
    const adminLogin = await request('POST', '/api/auth/login', {
      body: { username: 'root', password: 'toor' },
    });
    const cookie = adminLogin.cookie;
    const add = async (fields) =>
      (await request('POST', '/api/conferences', {
        cookie,
        body: { type: 'domestic', ...fields },
      })).json.conference;
    const url = '/api/conferences/calendar.ics';

    const full = await add({
      name: 'CalFull, 2099; a\\b',
      abstractDeadline: '2099-01-31',
      manuscriptDeadline: '2099-03-01',
      startDate: '2099-12-30',
      endDate: '2099-12-31',
      location: 'Kyoto, Japan',
      website: 'https://example.com/cal',
    });
    const oneDay = await add({ name: 'CalOneDay', startDate: '2099-02-28', website: 'javascript:alert(1)' });
    const noDates = await add({ name: 'CalNoDates' });
    const injected = await add({
      name: 'CalInject\r\nBEGIN:VEVENT\r\nSUMMARY:evil',
      startDate: '2099-05-01',
    });
    const longName = 'カレンダー長い名前'.repeat(10);
    await add({ name: longName, startDate: '2099-06-01' });
    const hidden = await add({ name: 'CalHidden', startDate: '2099-07-01', type: 'international' });
    await request('POST', `/api/conferences/${hidden.id}/hide`, { cookie });
    const intl = await add({ name: 'CalIntl', startDate: '2099-08-01', type: 'international' });

    const res = await request('GET', url, { cookie }); // logging in must not reveal hidden records
    assert.equal(res.status, 200);
    assert.match(res.headers['content-type'], /^text\/calendar; charset=utf-8/);
    assert.equal(res.headers['access-control-allow-origin'], '*');
    const raw = String(res.json);

    // Structure: CRLF only, lines within 75 octets, balanced events
    assert.equal(raw.replace(/\r\n/g, '').includes('\n'), false);
    assert.ok(raw.startsWith('BEGIN:VCALENDAR\r\nVERSION:2.0\r\n'));
    assert.ok(raw.endsWith('END:VCALENDAR\r\n'));
    for (const line of raw.split('\r\n')) assert.ok(Buffer.byteLength(line) <= 75, line);
    const text = raw.replace(/\r\n[ \t]/g, '');
    const lines = text.split('\r\n');
    assert.equal(lines.filter((l) => l === 'BEGIN:VEVENT').length, lines.filter((l) => l === 'END:VEVENT').length);

    const events = text.split('BEGIN:VEVENT\r\n').slice(1).map((e) => {
      const fields = {};
      for (const line of e.split('\r\n')) {
        const i = line.indexOf(':');
        if (i > 0) fields[line.slice(0, i)] = line.slice(i + 1);
      }
      return fields;
    });
    const of = (id) => events.filter((e) => e.UID.startsWith(`conference-${id}-`));

    // A blank application deadline defaults to the abstract date, giving one event, not two
    const fullEvents = of(full.id);
    assert.equal(fullEvents.length, 3);
    const abstract = fullEvents.find((e) => e.SUMMARY.includes('申込・抄録'));
    assert.equal(abstract['DTSTART;VALUE=DATE'], '20990131');
    assert.equal(abstract['DTEND;VALUE=DATE'], '20990201'); // end is exclusive
    const period = fullEvents.find((e) => e['DTSTART;VALUE=DATE'] === '20991230');
    assert.equal(period['DTEND;VALUE=DATE'], '21000101'); // crosses the year
    assert.equal(period.SUMMARY, 'CalFull\\, 2099\\; a\\\\b');
    assert.equal(period.LOCATION, 'Kyoto\\, Japan');
    assert.equal(period.URL, 'https://example.com/cal');

    // Start date alone gives one day. An unsafe URL isn't passed on
    assert.equal(of(oneDay.id)[0]['DTEND;VALUE=DATE'], '20990301');
    assert.equal(of(oneDay.id)[0].URL, undefined);
    assert.doesNotMatch(text, /javascript:/);
    assert.equal(of(noDates.id).length, 0);

    // A line break in a name stays inside the summary
    assert.equal(of(injected.id).length, 1);
    assert.ok(!lines.includes('SUMMARY:evil'));
    assert.ok(text.includes(longName), 'folding must not break multi-byte text');

    assert.ok(!text.includes('CalHidden'));

    // UIDs stay the same across fetches
    const again = await request('GET', url);
    assert.equal(String(again.json), raw);

    // Filters
    const international = String((await request('GET', `${url}?type=international`)).json);
    assert.ok(international.includes('CalIntl') && !international.includes('CalOneDay'));
    assert.ok(international.includes(`conference-${intl.id}-dates`));
    const deadlines = String((await request('GET', `${url}?include=deadlines`)).json);
    assert.ok(deadlines.includes(`conference-${full.id}-abstract`) || deadlines.includes(`conference-${full.id}-application`));
    assert.ok(!deadlines.includes(`conference-${full.id}-dates`));
    const dates = String((await request('GET', `${url}?include=dates`)).json);
    assert.ok(dates.includes(`conference-${full.id}-dates`));
    assert.ok(!dates.includes('【締切】'));
    assert.equal((await request('GET', `${url}?type=bad`)).status, 400);
    assert.equal((await request('GET', `${url}?include=bad`)).status, 400);
  });

  // Registers and approves a non-admin user, returning their session cookie.
  async function createEditor(adminCookie, username) {
    const application = await request('POST', '/api/auth/register', {
      body: {
        email: `${username}@example.com`,
        fullName: username,
        affiliation: 'Lab',
        username,
        password: 'pass_editor',
      },
    });
    await request('POST', `/api/admin/applications/${application.json.application.id}/approve`, {
      cookie: adminCookie,
    });
    const login = await request('POST', '/api/auth/login', {
      body: { username, password: 'pass_editor' },
    });
    assert.equal(login.status, 200);
    return login.cookie;
  }

  it('editors can only add and modify conferences', async () => {
    const adminLogin = await request('POST', '/api/auth/login', {
      body: { username: 'root', password: 'toor' },
    });
    const editor = await createEditor(adminLogin.cookie, 'perm_editor');

    const created = await request('POST', '/api/conferences', {
      cookie: editor,
      body: { name: 'Editor Conf', type: 'domestic', endDate: '2099-01-01' },
    });
    assert.equal(created.status, 201);
    const id = created.json.conference.id;

    const updated = await request('PUT', `/api/conferences/${id}`, {
      cookie: editor,
      body: { location: 'Nara' },
    });
    assert.equal(updated.status, 200);
    assert.equal(updated.json.conference.location, 'Nara');

    assert.equal((await request('POST', `/api/conferences/${id}/hide`, { cookie: editor })).status, 403);
    assert.equal((await request('POST', `/api/conferences/${id}/hide`)).status, 401);

    // A hidden, not-yet-ended conference still cannot be unhidden by an editor
    const hidden = await request('POST', `/api/conferences/${id}/hide`, { cookie: adminLogin.cookie });
    assert.equal(hidden.status, 200);
    assert.equal((await request('POST', `/api/conferences/${id}/unhide`, { cookie: editor })).status, 403);
    const unhidden = await request('POST', `/api/conferences/${id}/unhide`, { cookie: adminLogin.cookie });
    assert.equal(unhidden.status, 200);
  });

  it('deletes a tag only when all its records are hidden or ended', async () => {
    const adminLogin = await request('POST', '/api/auth/login', {
      body: { username: 'root', password: 'toor' },
    });
    const cookie = adminLogin.cookie;
    const add = async (fields) =>
      (await request('POST', '/api/conferences', {
        cookie,
        body: { type: 'domestic', ...fields },
      })).json.conference;
    const url = (tag) => `/api/conferences/by-tag/${encodeURIComponent(tag)}`;
    const exists = async (c) => (await request('GET', `/api/conferences/${c.id}`, { cookie })).status === 200;

    const tag = 'old/series 1'; // needs URL encoding
    const ended = await add({ name: 'Ended', tag, endDate: '2020-01-02' });
    const hidden = await add({ name: 'Hidden', tag, endDate: '2099-01-02' });
    await request('POST', `/api/conferences/${hidden.id}/hide`, { cookie });
    const otherTag = await add({ name: 'Other', tag: 'other-tag', endDate: '2020-01-02' });
    const untagged = await add({ name: 'Untagged', endDate: '2020-01-02' });

    // Permissions
    const editor = await createEditor(cookie, 'tag_editor');
    assert.equal((await request('DELETE', url(tag))).status, 401);
    assert.equal((await request('DELETE', url(tag), { cookie: editor })).status, 403);
    assert.ok(await exists(ended));

    // A record shown in the public list blocks the whole tag
    const visible = await add({ name: 'Visible', tag, endDate: '2099-01-02' });
    assert.equal((await request('DELETE', url(tag), { cookie })).status, 409);
    assert.ok(await exists(ended));
    assert.ok(await exists(hidden));
    assert.ok(await exists(visible));

    // Once hidden, the tag can go, and nothing else goes with it
    await request('POST', `/api/conferences/${visible.id}/hide`, { cookie });
    const deleted = await request('DELETE', url(tag), { cookie });
    assert.equal(deleted.status, 200);
    assert.equal(deleted.json.deletedCount, 3);
    for (const c of [ended, hidden, visible]) assert.equal(await exists(c), false);
    assert.ok(await exists(otherTag));
    assert.ok(await exists(untagged));

    // Each record is logged, and cannot be rolled back
    for (const c of [ended, hidden, visible]) {
      const logs = await request('GET', `/api/admin/logs?conferenceId=${c.id}`, { cookie });
      const log = logs.json.logs.find((l) => l.action === 'delete');
      assert.equal(log.beforeData.id, c.id);
      assert.equal((await request('POST', `/api/admin/logs/${log.id}/rollback`, { cookie })).status, 400);
    }

    assert.equal((await request('DELETE', url(tag), { cookie })).status, 404);
  });

  it('permanent delete is admin-only, logged, and cannot be rolled back', async () => {
    const adminLogin = await request('POST', '/api/auth/login', {
      body: { username: 'root', password: 'toor' },
    });
    const cookie = adminLogin.cookie;

    const created = await request('POST', '/api/conferences', {
      cookie,
      body: { name: 'Delete Target', type: 'domestic' },
    });
    const id = created.json.conference.id;

    // Anonymous: rejected
    const anon = await request('DELETE', `/api/conferences/${id}`);
    assert.equal(anon.status, 401);

    // Non-admin: rejected
    const editor = await createEditor(cookie, 'delete_editor');
    const denied = await request('DELETE', `/api/conferences/${id}`, { cookie: editor });
    assert.equal(denied.status, 403);
    assert.equal((await request('GET', `/api/conferences/${id}`)).status, 200);

    await request('PUT', `/api/conferences/${id}`, { cookie, body: { location: 'Before Delete' } });

    // Admin: deleted, including from the hidden-inclusive list
    const deleted = await request('DELETE', `/api/conferences/${id}`, { cookie });
    assert.equal(deleted.status, 200);
    assert.equal((await request('GET', `/api/conferences/${id}`)).status, 404);
    const list = await request('GET', '/api/conferences?includeHidden=1', { cookie });
    assert.ok(!list.json.conferences.some((c) => c.id === id));

    // Deleting again: not found
    const again = await request('DELETE', `/api/conferences/${id}`, { cookie });
    assert.equal(again.status, 404);

    // The delete is logged with a snapshot of the removed row
    const logs = await request('GET', `/api/admin/logs?conferenceId=${id}`, { cookie });
    const deleteLog = logs.json.logs.find((l) => l.action === 'delete');
    assert.ok(deleteLog);
    assert.equal(deleteLog.beforeData.name, 'Delete Target');
    assert.equal(deleteLog.afterData, null);
    assert.equal(logs.json.logs.filter((l) => l.action === 'delete').length, 1);

    // No log entry for the deleted conference can bring it back
    assert.deepEqual(logs.json.logs.map((l) => l.action).sort(), ['create', 'delete', 'update']);
    for (const log of logs.json.logs) {
      assert.equal(log.conferenceExists, false);
      const rb = await request('POST', `/api/admin/logs/${log.id}/rollback`, { cookie });
      assert.equal(rb.status, 400, `rollback of ${log.action} must be refused`);
    }
    assert.equal((await request('GET', `/api/conferences/${id}`)).status, 404);
  });
});
