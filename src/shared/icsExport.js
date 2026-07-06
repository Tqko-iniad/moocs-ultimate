import { parseAssignmentDeadline } from './assignmentDeadline.js';
import { getAssignmentRecordTitleForDisplay } from './assignmentStatus.js';
import { parseMoocsCourseRoute } from './moocsRoute.js';

function formatIcsDate(timestamp) {
  const d = new Date(timestamp);
  const pad = (n) => String(n).padStart(2, '0');
  return (
    d.getUTCFullYear() +
    pad(d.getUTCMonth() + 1) +
    pad(d.getUTCDate()) +
    'T' +
    pad(d.getUTCHours()) +
    pad(d.getUTCMinutes()) +
    pad(d.getUTCSeconds()) +
    'Z'
  );
}

function escapeIcsText(text) {
  return String(text || '')
    .replace(/\\/g, '\\\\')
    .replace(/\r\n?/g, '\\n')
    .replace(/\n/g, '\\n')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,');
}

function foldLine(line) {
  const encoder = new TextEncoder();
  const totalBytes = encoder.encode(line).byteLength;
  if (totalBytes <= 75) return line;

  const lines = [];
  let currentLine = '';
  let currentBytes = 0;
  const maxFirst = 75;
  const maxCont = 74;

  for (const char of line) {
    const charBytes = encoder.encode(char).byteLength;
    const limit = lines.length === 0 ? maxFirst : maxCont;
    if (currentBytes + charBytes > limit && currentLine) {
      lines.push(currentLine);
      currentLine = '';
      currentBytes = 0;
    }
    currentLine += char;
    currentBytes += charBytes;
  }
  if (currentLine) lines.push(currentLine);

  return lines.map((l, i) => (i === 0 ? l : ' ' + l)).join('\r\n');
}

function safeUrl(raw) {
  try {
    const url = new URL(String(raw));
    if (url.protocol === 'https:' || url.protocol === 'http:') return url.href;
  } catch {}
  return '';
}

function buildUid(record) {
  const raw = String(record?.url || record?.pageKey || record?.key || '');
  const route = parseMoocsCourseRoute(raw);
  if (route) {
    const page = route.page || 'index';
    return `${route.year}-${route.course}-${route.lecture}-${page}@moocs.iniad.org`;
  }
  const hash = raw.replace(/[^a-z0-9]/gi, '-').slice(0, 80);
  return `${hash}@moocs.iniad.org`;
}

export function buildIcsString(records) {
  const events = [];

  for (const record of records) {
    const parsed = parseAssignmentDeadline(record);
    if (!parsed) continue;
    if (record?.status === 'submitted') continue;
    if (record?.status === 'unpublished') continue;

    const title = getAssignmentRecordTitleForDisplay(record);
    const route = parseMoocsCourseRoute(
      String(record?.url || record?.pageKey || record?.key || ''),
    );
    const courseName = record?.courseName || route?.course || '';
    const summary = courseName ? `${courseName} - ${title}` : title;
    const url = safeUrl(record?.url || record?.pageKey || '');

    const dtEnd = formatIcsDate(parsed.timestamp);
    const dtStart = formatIcsDate(parsed.timestamp - 30 * 60 * 1000);
    const uid = buildUid(record);
    const now = formatIcsDate(Date.now());

    const lines = [
      'BEGIN:VEVENT',
      foldLine(`UID:${uid}`),
      `DTSTAMP:${now}`,
      `DTSTART:${dtStart}`,
      `DTEND:${dtEnd}`,
      foldLine(`SUMMARY:${escapeIcsText(summary)}`),
    ];
    if (url) lines.push(foldLine(`URL:${url}`));
    lines.push(
      foldLine(`DESCRIPTION:${escapeIcsText(`提出期限: ${parsed.date} ${parsed.time}`)}`),
      'BEGIN:VALARM',
      'TRIGGER:-PT30M',
      'ACTION:DISPLAY',
      foldLine(`DESCRIPTION:${escapeIcsText(`${summary} の提出期限が近づいています`)}`),
      'END:VALARM',
      'END:VEVENT',
    );
    events.push(lines.join('\r\n'));
  }

  const calendar = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//MOOCs Ultimate//Assignment Deadlines//JP',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'X-WR-CALNAME:MOOCs 課題締切',
    'X-WR-TIMEZONE:Asia/Tokyo',
    ...events,
    'END:VCALENDAR',
    '',
  ].join('\r\n');

  return calendar;
}

export function downloadIcsFile(icsString, filename = 'moocs-deadlines.ics') {
  const blob = new Blob([icsString], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    URL.revokeObjectURL(url);
    a.remove();
  }, 1000);
}
