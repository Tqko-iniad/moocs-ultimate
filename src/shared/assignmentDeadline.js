const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_PATTERN = /^(\d{2}):(\d{2})$/;
const JST_OFFSET = '+09:00';
const DAY_MS = 86_400_000;
const DEADLINE_FIELDS = [
  'deadlineDate',
  'deadlineTime',
  'deadlineSource',
  'deadlineUpdatedAt',
  'deadlineEvidence',
  'deadlineInferredYear',
  'deadlineInferredTime',
  'deadlineIgnoredCandidates',
];

function isValidDate(year, month, day) {
  const value = new Date(Date.UTC(year, month - 1, day));
  return value.getUTCFullYear() === year && value.getUTCMonth() === month - 1 && value.getUTCDate() === day;
}

function getJstDateKey(timestamp) {
  const value = new Date(timestamp + 9 * 60 * 60 * 1000);
  return [
    value.getUTCFullYear(),
    String(value.getUTCMonth() + 1).padStart(2, '0'),
    String(value.getUTCDate()).padStart(2, '0'),
  ].join('-');
}

function getDateOrdinal(date) {
  const match = DATE_PATTERN.exec(String(date || ''));
  if (!match) return Number.NaN;
  return Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])) / DAY_MS;
}

export function parseAssignmentDeadline(record) {
  const date = String(record?.deadlineDate || '').trim();
  const dateMatch = DATE_PATTERN.exec(date);
  if (!dateMatch) return null;
  const year = Number(dateMatch[1]);
  const month = Number(dateMatch[2]);
  const day = Number(dateMatch[3]);
  if (!isValidDate(year, month, day)) return null;

  const time = String(record?.deadlineTime || '23:59').trim() || '23:59';
  const timeMatch = TIME_PATTERN.exec(time);
  if (!timeMatch) return null;
  const hour = Number(timeMatch[1]);
  const minute = Number(timeMatch[2]);
  if (hour > 23 || minute > 59) return null;

  const timestamp = Date.parse(`${date}T${time}:00${JST_OFFSET}`);
  if (!Number.isFinite(timestamp)) return null;
  return { date, time, timestamp };
}

export function getAssignmentDeadlineTimestamp(record) {
  return parseAssignmentDeadline(record)?.timestamp ?? Number.POSITIVE_INFINITY;
}

export function formatAssignmentDeadline(record, options = {}) {
  const parsed = parseAssignmentDeadline(record);
  if (!parsed) return options.unsetLabel || '期限未設定';
  return new Intl.DateTimeFormat(options.locale || 'ja-JP', {
    year: 'numeric',
    month: options.longMonth ? 'long' : 'short',
    day: 'numeric',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Asia/Tokyo',
  }).format(new Date(parsed.timestamp));
}

export function getAssignmentDeadlineState(record, options = {}) {
  const parsed = parseAssignmentDeadline(record);
  if (!parsed) {
    return { tone: 'unset', label: options.unsetLabel || '期限未設定', alert: false, timestamp: null };
  }

  const formatted = formatAssignmentDeadline(record, options);
  if (record?.status === 'submitted') {
    return { tone: 'complete', label: formatted, alert: false, timestamp: parsed.timestamp };
  }
  if (record?.status === 'unpublished') {
    return { tone: 'unpublished', label: `未公開 / ${formatted}`, alert: false, timestamp: parsed.timestamp };
  }

  const now = Number.isFinite(options.now) ? options.now : Date.now();
  if (parsed.timestamp < now) {
    return { tone: 'overdue', label: `期限超過 / ${formatted}`, alert: true, timestamp: parsed.timestamp };
  }

  const todayKey = getJstDateKey(now);
  if (parsed.date === todayKey) {
    return { tone: 'today', label: `今日まで / ${formatted}`, alert: true, timestamp: parsed.timestamp };
  }

  const warningDays = Math.max(0, Number(options.warningDays ?? 3));
  const remainingDays = Math.max(1, getDateOrdinal(parsed.date) - getDateOrdinal(todayKey));
  if (remainingDays <= warningDays) {
    return {
      tone: 'soon',
      label: `あと${remainingDays}日 / ${formatted}`,
      alert: true,
      timestamp: parsed.timestamp,
      remainingDays,
    };
  }
  return {
    tone: 'scheduled',
    label: formatted,
    alert: false,
    timestamp: parsed.timestamp,
    remainingDays,
  };
}

const DEADLINE_PRIORITY = Object.freeze({
  overdue: 0,
  today: 1,
  soon: 2,
  scheduled: 3,
  unset: 4,
  unpublished: 5,
  complete: 6,
});

export function getAssignmentDeadlinePriority(record, options = {}) {
  const state = getAssignmentDeadlineState(record, options);
  return DEADLINE_PRIORITY[state.tone] ?? DEADLINE_PRIORITY.unset;
}

export function compareAssignmentDeadlineUrgency(a, b, options = {}) {
  const priorityOrder = getAssignmentDeadlinePriority(a, options) - getAssignmentDeadlinePriority(b, options);
  if (priorityOrder) return priorityOrder;
  const aTimestamp = getAssignmentDeadlineTimestamp(a);
  const bTimestamp = getAssignmentDeadlineTimestamp(b);
  if (aTimestamp !== bTimestamp) {
    if (!Number.isFinite(aTimestamp)) return 1;
    if (!Number.isFinite(bTimestamp)) return -1;
    return aTimestamp - bTimestamp;
  }
  return 0;
}

const ASSIGNMENT_DETAIL_STATUSES = new Set([
  'not_submitted',
  'pending_confirmation',
  'unchecked',
  'unknown',
  'unpublished',
]);

const ASSIGNMENT_DETAIL_STATUS_PRIORITY = Object.freeze({
  not_submitted: 0,
  pending_confirmation: 1,
  unchecked: 2,
  unknown: 3,
  unpublished: 4,
});

function compareAssignmentPageOrder(a, b) {
  const getPageValue = (record) => {
    const value = String(record?.url || record?.pageKey || record?.key || '');
    try {
      return new URL(value).pathname.split('/').filter(Boolean).at(-1) || value;
    } catch {
      return value.replace(/[?#].*$/, '').split('/').filter(Boolean).at(-1) || value;
    }
  };
  return getPageValue(a).localeCompare(getPageValue(b), 'ja', { numeric: true });
}

export function getAssignmentLectureDetails(records, options = {}) {
  const now = Number.isFinite(options.now) ? options.now : Date.now();
  const warningDays = Math.max(0, Number(options.warningDays ?? 7));
  return dedupeAssignmentRecords(records)
    .filter((record) => ASSIGNMENT_DETAIL_STATUSES.has(record?.status))
    .sort((a, b) => {
      const aUnpublished = a.status === 'unpublished';
      const bUnpublished = b.status === 'unpublished';
      if (aUnpublished !== bUnpublished) return aUnpublished ? 1 : -1;
      const deadlineOrder = compareAssignmentDeadlineUrgency(a, b, { now, warningDays });
      if (deadlineOrder) return deadlineOrder;
      const statusOrder =
        (ASSIGNMENT_DETAIL_STATUS_PRIORITY[a.status] ?? 99) -
        (ASSIGNMENT_DETAIL_STATUS_PRIORITY[b.status] ?? 99);
      return statusOrder || compareAssignmentPageOrder(a, b);
    });
}

function getAssignmentYear(record) {
  const value = String(record?.url || record?.pageKey || record?.key || '');
  const match = value.match(/\/courses\/(\d{4})(?:\/|$)/);
  return match?.[1] || '';
}

function getAssignmentRoute(record) {
  const value = String(record?.url || record?.pageKey || record?.key || '');
  const match = value.match(/\/courses\/(\d{4})\/([^/?#]+)\/([^/?#]+)/);
  if (!match) return null;
  return { year: match[1], course: match[2], lecture: match[3] };
}

function getLectureUrl(record, route) {
  try {
    const url = new URL(String(record?.url || record?.pageKey || ''));
    return `${url.origin}/courses/${route.year}/${route.course}/${route.lecture}`;
  } catch {
    return `/courses/${route.year}/${route.course}/${route.lecture}`;
  }
}

function getOverviewYear(records, now, requestedYear) {
  if (requestedYear) return String(requestedYear);
  const years = [...new Set(records.map(getAssignmentYear).filter(Boolean))].sort().reverse();
  const currentYear = getJstDateKey(now).slice(0, 4);
  return years.includes(currentYear) ? currentYear : years[0] || currentYear;
}

function isActionableAssignment(record) {
  return record?.status !== 'submitted' && record?.status !== 'unpublished';
}

export function getAssignmentOverview(records, options = {}) {
  const now = Number.isFinite(options.now) ? options.now : Date.now();
  const warningDays = Math.max(0, Number(options.warningDays ?? 7));
  const limit = Math.max(1, Number(options.limit ?? 10));
  const deduped = dedupeAssignmentRecords(records);
  const year = getOverviewYear(deduped, now, options.year);
  const yearRecords = deduped.filter((record) => getAssignmentYear(record) === year);
  const actionableRecords = yearRecords.filter(isActionableAssignment);
  const upcoming = actionableRecords
    .filter((record) => {
      const tone = getAssignmentDeadlineState(record, { now, warningDays }).tone;
      return tone === 'overdue' || tone === 'today' || tone === 'soon';
    })
    .sort((a, b) => compareAssignmentDeadlineUrgency(a, b, { now, warningDays }))
    .slice(0, limit);
  const unsetCount = actionableRecords.filter(
    (record) => getAssignmentDeadlineState(record, { now, warningDays }).tone === 'unset',
  ).length;

  const lectureMap = new Map();
  for (const record of yearRecords) {
    const route = getAssignmentRoute(record);
    if (!route) continue;
    const key = `${route.year}/${route.course}/${route.lecture}`;
    if (!lectureMap.has(key)) {
      lectureMap.set(key, {
        key,
        year: route.year,
        course: route.course,
        lecture: route.lecture,
        courseName: String(record?.courseName || route.course),
        url: getLectureUrl(record, route),
        records: [],
      });
    }
    const group = lectureMap.get(key);
    group.records.push(record);
    if (!group.courseName || group.courseName === group.course) {
      group.courseName = String(record?.courseName || group.course);
    }
  }

  const lectures = [...lectureMap.values()]
    .map((group) => {
      const actionable = group.records.filter(isActionableAssignment);
      const deadlineRecord = actionable
        .filter((record) => Number.isFinite(getAssignmentDeadlineTimestamp(record)))
        .sort((a, b) => compareAssignmentDeadlineUrgency(a, b, { now, warningDays }))[0];
      const deadline = deadlineRecord
        ? getAssignmentDeadlineState(deadlineRecord, { now, warningDays })
        : null;
      const submittedCount = group.records.filter((record) => record?.status === 'submitted').length;
      const unpublishedCount = group.records.filter((record) => record?.status === 'unpublished').length;
      return {
        ...group,
        totalCount: group.records.length,
        remainingCount: actionable.length,
        submittedCount,
        unpublishedCount,
        deadline,
        deadlineLabel: deadline?.label || (actionable.length ? '未設定' : submittedCount ? '提出済み' : '未公開'),
      };
    })
    .filter(
      (group) =>
        !options.hideCompleted ||
        group.totalCount === 0 ||
        group.submittedCount !== group.totalCount,
    )
    .sort((a, b) => {
      const aPriority = a.remainingCount ? (a.deadline ? DEADLINE_PRIORITY[a.deadline.tone] : 4) : a.submittedCount ? 5 : 6;
      const bPriority = b.remainingCount ? (b.deadline ? DEADLINE_PRIORITY[b.deadline.tone] : 4) : b.submittedCount ? 5 : 6;
      if (aPriority !== bPriority) return aPriority - bPriority;
      const aTimestamp = a.deadline?.timestamp ?? Number.POSITIVE_INFINITY;
      const bTimestamp = b.deadline?.timestamp ?? Number.POSITIVE_INFINITY;
      if (aTimestamp !== bTimestamp) return aTimestamp - bTimestamp;
      return b.lecture.localeCompare(a.lecture, 'ja', { numeric: true });
    })
    .slice(0, limit);

  return { year, upcoming, unsetCount, lectures };
}

function getAssignmentIdentity(record, index) {
  const value = String(record?.url || record?.pageKey || record?.key || '').trim();
  if (!value) return `record:${index}`;
  try {
    const url = new URL(value, 'https://moocs.iniad.org');
    url.hash = '';
    if (url.hostname === 'moocs.iniad.org' && url.pathname.startsWith('/courses/')) {
      url.search = '';
    }
    url.pathname = url.pathname.replace(/\/$/, '') || '/';
    return url.href;
  } catch {
    return value.replace(/#.*$/, '').replace(/\/$/, '');
  }
}

function getRecordFreshness(record) {
  const value = Date.parse(record?.checkedAt || record?.updatedAt || '');
  return Number.isFinite(value) ? value : 0;
}

function selectStatusRecord(records) {
  return [...records].sort((a, b) => {
    const score = (record) =>
      (record?.source === 'manual' ? 100 : 0) +
      (record?.status === 'submitted' ? 50 : 0) +
      (record?.confidence === 'high' ? 10 : 0);
    return score(b) - score(a) || getRecordFreshness(b) - getRecordFreshness(a);
  })[0];
}

function selectDeadlineRecord(records) {
  return records
    .filter((record) => parseAssignmentDeadline(record))
    .sort((a, b) => {
      const score = (record) => (record?.deadlineSource === 'manual' ? 100 : 0);
      const aUpdated = Date.parse(a?.deadlineUpdatedAt || '') || 0;
      const bUpdated = Date.parse(b?.deadlineUpdatedAt || '') || 0;
      return score(b) - score(a) || bUpdated - aUpdated;
    })[0];
}

export function dedupeAssignmentRecords(records) {
  const groups = new Map();
  for (const [index, record] of (Array.isArray(records) ? records : []).entries()) {
    const key = getAssignmentIdentity(record, index);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(record);
  }

  return [...groups.values()].map((group) => {
    const statusRecord = selectStatusRecord(group) || group[0];
    const deadlineRecord = selectDeadlineRecord(group);
    if (!deadlineRecord) return { ...statusRecord };
    const merged = { ...statusRecord };
    for (const field of DEADLINE_FIELDS) {
      if (field in deadlineRecord) merged[field] = deadlineRecord[field];
    }
    return merged;
  });
}
