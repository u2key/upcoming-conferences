'use strict';

const { getDb } = require('../db/database');
const config = require('../config');
const conferences = require('./conferences');
const mail = require('./mail');

const SUBJECT = '[学会締め切り管理] 未登録の学会情報の登録のお願い';
const CHECK_INTERVAL_MS = 10 * 60 * 1000;

let sending = false;

function conflict(message) {
  const err = new Error(message);
  err.status = 409;
  return err;
}

function buildText(username, tags) {
  const items = tags.flatMap(({ tag, latest }) => {
    const dates = [latest.start_date, latest.end_date].filter(Boolean).join(' ~ ') || '日付未設定';
    const lines = [`・${latest.name}（タグ: ${tag}）`, `  直近の開催: ${dates}`];
    if (/^https?:\/\//i.test(latest.website)) lines.push(`  ${latest.website}`);
    return lines;
  });
  return [
    `${username} さん`,
    '',
    '次の学会は、登録済みの回がすべて終了または非表示になっています。',
    '次回の情報が公開されていれば、登録をお願いします。',
    '',
    ...items,
    '',
    `登録はこちら: ${config.appBaseUrl}/`,
    '',
    'この通知が不要な場合は、一覧ページ上部のトグルからオフにできます。',
    '',
    '---',
    '学会締め切り管理システム',
  ].join('\n');
}

function listRecipients() {
  return getDb()
    .prepare(
      `SELECT username, email FROM users
       WHERE is_active = 1 AND notify_email = 1 AND email <> ''
       ORDER BY id`
    )
    .all();
}

/** Send one mail per recipient. One failure must not stop the others. */
async function deliver(recipients, tags) {
  const failed = [];
  for (const { username, email } of recipients) {
    try {
      await mail.sendConferenceRegistrationNotification({
        email,
        subject: SUBJECT,
        text: buildText(username, tags),
      });
    } catch (err) {
      console.error(`[notifications] failed to send to ${username}:`, err.message);
      failed.push(username);
    }
  }
  return { sentCount: recipients.length - failed.length, failed };
}

/** Year, month, day and hour of `now` in the configured time zone. */
function localParts(now) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: config.notification.timeZone,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    hourCycle: 'h23',
  }).formatToParts(now);
  const get = (type) => parseInt(parts.find((p) => p.type === type).value, 10);
  return { year: get('year'), month: get('month'), day: get('day'), hour: get('hour') };
}

function firstMondayOfMonth(year, month) {
  const weekday = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
  return 1 + ((8 - weekday) % 7);
}

/** The next automatic send as "YYYY-MM-DD HH:00" in the configured time zone. */
function nextAutoSend(now = new Date()) {
  let { year, month, day, hour } = localParts(now);
  const first = firstMondayOfMonth(year, month);
  if (day > first || (day === first && hour >= config.notification.hour)) {
    month += 1;
    if (month > 12) {
      month = 1;
      year += 1;
    }
  }
  const pad = (n) => String(n).padStart(2, '0');
  const date = `${year}-${pad(month)}-${pad(firstMondayOfMonth(year, month))}`;
  return `${date} ${pad(config.notification.hour)}:00`;
}

function listRuns(limit = 12) {
  return getDb()
    .prepare(
      `SELECT r.*, u.username FROM notification_runs r
       LEFT JOIN users u ON u.id = r.triggered_by
       ORDER BY r.id DESC LIMIT ?`
    )
    .all(limit)
    .map((r) => ({
      id: r.id,
      kind: r.kind,
      username: r.username,
      tagCount: r.tag_count,
      sentCount: r.sent_count,
      failedCount: r.failed_count,
      createdAt: r.created_at,
    }));
}

/** Everything the admin console shows, including a preview of the mail. Sends nothing. */
function getStatus(now = new Date()) {
  const tags = conferences.listMissingTags();
  const recipients = listRecipients();
  return {
    subject: SUBJECT,
    text: buildText(recipients.length ? recipients[0].username : '（ユーザ名）', tags),
    tagCount: tags.length,
    recipients: recipients.map((r) => r.username),
    nextAutoSend: nextAutoSend(now),
    timeZone: config.notification.timeZone,
    runs: listRuns(),
  };
}

/** Manual send from the admin console. */
async function sendNow(userId) {
  if (sending) throw conflict('通知の送信中です。完了までお待ちください');
  const tags = conferences.listMissingTags();
  const recipients = listRecipients();
  if (!tags.length) throw conflict('未登録の学会タグがないため、送信する内容がありません');
  if (!recipients.length) throw conflict('通知を受け取るユーザがいません');

  sending = true;
  try {
    const { sentCount, failed } = await deliver(recipients, tags);
    getDb()
      .prepare(
        `INSERT INTO notification_runs (kind, triggered_by, tag_count, sent_count, failed_count)
         VALUES ('manual', ?, ?, ?, ?)`
      )
      .run(userId, tags.length, sentCount, failed.length);
    return { sentCount, failed };
  } finally {
    sending = false;
  }
}

/**
 * Send the monthly notification if it is due: on the first Monday of the month,
 * from the configured hour. A missed day is skipped rather than caught up, so a
 * restart later in the month can't surprise everyone with mail. The UNIQUE period
 * is claimed before sending, so restarts and extra instances can't send twice.
 * @returns {object|null} the outcome, or null if nothing was due
 */
async function runScheduled(now = new Date()) {
  const { year, month, day, hour } = localParts(now);
  if (day !== firstMondayOfMonth(year, month) || hour < config.notification.hour) return null;
  if (sending) return null; // retried on the next check

  const db = getDb();
  const period = `${year}-${String(month).padStart(2, '0')}`;
  const claim = db
    .prepare(`INSERT OR IGNORE INTO notification_runs (kind, period) VALUES ('auto', ?)`)
    .run(period);
  if (!claim.changes) return null;

  sending = true;
  try {
    const tags = conferences.listMissingTags();
    const { sentCount, failed } = tags.length
      ? await deliver(listRecipients(), tags)
      : { sentCount: 0, failed: [] };
    db.prepare(
      `UPDATE notification_runs SET tag_count = ?, sent_count = ?, failed_count = ? WHERE period = ?`
    ).run(tags.length, sentCount, failed.length, period);
    console.log(`[notifications] ${period}: sent ${sentCount}, failed ${failed.length}, tags ${tags.length}`);
    return { period, sentCount, failed };
  } finally {
    sending = false;
  }
}

function startScheduler() {
  const check = () =>
    runScheduled().catch((err) => console.error('[notifications] scheduled send failed:', err.message));
  check();
  setInterval(check, CHECK_INTERVAL_MS).unref();
}

module.exports = {
  getStatus,
  sendNow,
  runScheduled,
  nextAutoSend,
  startScheduler,
};
