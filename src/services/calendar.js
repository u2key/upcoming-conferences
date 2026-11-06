'use strict';

const config = require('../config');

const DEADLINE_KINDS = [
  { key: 'applicationDeadline', uid: 'application', label: '申込' },
  { key: 'abstractDeadline', uid: 'abstract', label: '抄録' },
  { key: 'manuscriptDeadline', uid: 'manuscript', label: '原稿' },
];

const NOTICE = '締切や日程は変更される場合があります。投稿の前に公式サイトで確認してください。';

/** Parse the leading YYYY-MM-DD of a stored date. Stored values aren't validated, so bad ones give null. */
function parseDate(value) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value || '');
  if (!m) return null;
  const date = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  // Reject dates that rolled over, such as 2026-02-31
  return date.getUTCMonth() === +m[2] - 1 ? date : null;
}

const formatDate = (date) => date.toISOString().slice(0, 10).replace(/-/g, '');
const nextDay = (date) => new Date(date.getTime() + 24 * 60 * 60 * 1000);

/** Escape a TEXT value (RFC 5545 3.3.11). Values come from users, so this also stops line injection. */
function escapeText(value) {
  return String(value)
    .replace(/[\\;,]/g, '\\$&')
    .replace(/\r\n|\r|\n/g, '\\n')
    // eslint-disable-next-line no-control-regex
    .replace(/[\x00-\x1f\x7f]/g, ' ');
}

/** Fold a line to at most 75 octets (RFC 5545 3.1) without splitting a multi-byte character. */
function foldLine(line) {
  const parts = [];
  let current = '';
  let size = 0;
  for (const char of line) {
    const bytes = Buffer.byteLength(char);
    if (size + bytes > 75) {
      parts.push(current);
      current = ' ';
      size = 1;
    }
    current += char;
    size += bytes;
  }
  parts.push(current);
  return parts.join('\r\n');
}

/** DTSTAMP from the stored UTC "YYYY-MM-DD HH:MM:SS". */
function stamp(conference) {
  const compact = String(conference.updatedAt || conference.createdAt || '').replace(/[-:]/g, '').replace(' ', 'T');
  return /^\d{8}T\d{6}$/.test(compact) ? `${compact}Z` : '19700101T000000Z';
}

function eventLines({ uid, summary, start, end, location, url, description, dtstamp }) {
  return [
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `DTSTAMP:${dtstamp}`,
    `DTSTART;VALUE=DATE:${formatDate(start)}`,
    `DTEND;VALUE=DATE:${formatDate(nextDay(end))}`, // exclusive for all-day events
    `SUMMARY:${escapeText(summary)}`,
    ...(location ? [`LOCATION:${escapeText(location)}`] : []),
    ...(url ? [`URL:${url}`] : []),
    `DESCRIPTION:${escapeText(description)}`,
    'TRANSP:TRANSPARENT', // informational: don't mark people as busy
    'END:VEVENT',
  ];
}

/** Deadlines falling on one day become one event: a blank application deadline defaults to another deadline's date. */
function deadlineEvents(conference, common, domain) {
  const byDate = new Map();
  for (const kind of DEADLINE_KINDS) {
    const date = parseDate(conference[kind.key]);
    if (!date) continue;
    const key = date.getTime();
    if (!byDate.has(key)) byDate.set(key, { date, kinds: [] });
    byDate.get(key).kinds.push(kind);
  }
  return [...byDate.values()].flatMap(({ date, kinds }) =>
    eventLines({
      ...common,
      uid: `conference-${conference.id}-${kinds[0].uid}@${domain}`,
      summary: `【締切】${kinds.map((k) => k.label).join('・')}: ${conference.name}`,
      start: date,
      end: date,
      location: '',
    })
  );
}

function conferenceEvent(conference, common, domain) {
  const start = parseDate(conference.startDate) || parseDate(conference.endDate);
  if (!start) return [];
  const end = parseDate(conference.endDate);
  return eventLines({
    ...common,
    uid: `conference-${conference.id}-dates@${domain}`,
    summary: conference.name,
    start,
    end: end && end >= start ? end : start,
    location: conference.location,
  });
}

/**
 * Build an iCalendar feed. UIDs stay the same across fetches, so subscribed
 * calendars update events in place rather than duplicating them.
 * @param {object[]} conferences public conference objects
 * @param {{ include?: 'all'|'deadlines'|'dates', name?: string }} opts
 */
function buildCalendar(conferences, { include = 'all', name = 'Upcoming Conferences' } = {}) {
  let domain = 'upcoming-conferences';
  try {
    domain = new URL(config.appBaseUrl).hostname || domain;
  } catch {
    // keep the fallback
  }

  const events = conferences.flatMap((conference) => {
    const url = /^https?:\/\//i.test(conference.website) ? conference.website.replace(/[\r\n]/g, '') : '';
    const common = {
      url,
      dtstamp: stamp(conference),
      description: [url, NOTICE].filter(Boolean).join('\n'),
    };
    return [
      ...(include !== 'dates' ? deadlineEvents(conference, common, domain) : []),
      ...(include !== 'deadlines' ? conferenceEvent(conference, common, domain) : []),
    ];
  });

  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Upcoming Conferences//Conference Deadlines//JA',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${escapeText(name)}`,
    'REFRESH-INTERVAL;VALUE=DURATION:PT6H',
    'X-PUBLISHED-TTL:PT6H',
    ...events,
    'END:VCALENDAR',
  ];
  return `${lines.map(foldLine).join('\r\n')}\r\n`;
}

module.exports = { buildCalendar };
