import {
  dedupeAssignmentRecords,
  getAssignmentDeadlineState,
} from './assignmentDeadline.js';
import { sortCollectedAssignmentRecords } from './assignmentDetection.js';
import {
  getCanonicalMoocsUrl,
  parseMoocsCourseRoute,
} from './moocsRoute.js';

function normalizeAssignmentStatusText(value) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function getAssignmentStatusDisplayLabel(status) {
  if (status === 'checking') return '確認中';
  if (status === 'unchecked') return '未確認';
  if (status === 'submitted') return '提出済み';
  if (status === 'pending_confirmation') return '確認待ち';
  if (status === 'not_submitted') return '要対応';
  if (status === 'unpublished') return '未公開';
  return '確認不能';
}

export function getAssignmentStatusDescriptionText(result) {
  if (result.status === 'checking') return 'MOOCs側の表示が出揃うのを待って再確認しています。';
  if (result.status === 'unchecked') return 'まだ提出状態を確認していません。必要なら再確認してください。';
  if (result.status === 'submitted') {
    if (result.source === 'manual') return '手動で提出済みとして記録されています。';
    return result.source === 'storage' || result.source === 'moocs-alert'
      ? '保存済みの提出完了記録を表示しています。'
      : '強い提出済み表示を検出しました。';
  }
  if (result.status === 'unpublished') {
    if (result.source === 'manual') return '手動で課題未公開として記録されています。';
    return 'MOOCs側の非公開表示を検出しました。';
  }
  if (result.status === 'pending_confirmation') return '提出操作を検出しました。完了表示が出るまで確認中です。';
  if (result.status === 'not_submitted') {
    if (result.source === 'manual') return '手動で未提出として記録されています。';
    return result.confidence === 'low'
      ? '提出フォームはありますが、提出済み表示は見つかっていません。'
      : '未提出を示す表示を検出しました。';
  }
  return 'MOOCs側の表示だけでは提出状態を判断できません。';
}

export function getAssignmentRecordTitleForDisplay(record) {
  const route = parseMoocsCourseRoute(record?.url || record?.pageKey || '');
  const routeLabel = route?.page ? route.page.replace(/^.*?(\d+(?:-\d+)?)$/, '$1') : '';
  const title = normalizeAssignmentStatusText(record?.title || record?.lectureName || '');
  if (!title) return routeLabel ? `課題 ${routeLabel}` : '課題';
  const compact = title.replace(/\s*[:：]\s*INIAD MOOCs$/i, '').replace(/\s*\|\s*INIAD MOOCs$/i, '');
  if (routeLabel && !compact.includes(routeLabel)) return `${routeLabel}: ${compact}`;
  return compact;
}

export function getAssignmentEvidenceSourceLabel(record) {
  if (record?.source === 'manual') return '手動補正';
  if (record?.source === 'moocs-alert') return '提出完了アラート';
  if (record?.source === 'submit-click-uploaded') return '提出操作 + アップロード確認';
  if (record?.source === 'page-text') return 'MOOCs表示';
  if (record?.source === 'page-text-unpublished' || record?.source === 'lecture-link-unpublished') return '非公開表示';
  if (record?.source === 'lecture-link-collect' || record?.source === 'lecture-link-collect-fallback') return 'この回の確認';
  if (record?.source === 'uploaded-file') return 'アップロード表示';
  if (record?.source === 'storage') return '保存済み';
  return record?.source || '保存済み';
}

export function getAssignmentEvidenceDescription(result, record = {}) {
  const label = getAssignmentEvidenceSourceLabel({ ...record, ...result });
  const evidence = normalizeAssignmentStatusText(result?.evidence || record?.evidence || '');
  return evidence ? `根拠: ${label} / ${evidence}` : `根拠: ${label}`;
}

export function createLectureAssignmentSummaryText(records, removed = 0) {
  if (!records.length) return removed > 0 ? `課題なし / 整理 ${removed}` : '課題なし';
  const counts = records.reduce(
    (acc, record) => {
      acc.total += 1;
      if (record.status === 'submitted') acc.submitted += 1;
      else if (record.status === 'not_submitted' || record.status === 'pending_confirmation') acc.action += 1;
      else if (record.status === 'unpublished') acc.unpublished += 1;
      else acc.unchecked += 1;
      return acc;
    },
    { total: 0, submitted: 0, action: 0, unpublished: 0, unchecked: 0 },
  );
  const deadlineCounts = records.reduce(
    (acc, record) => {
      const tone = getAssignmentDeadlineState(record).tone;
      if (tone === 'overdue') acc.overdue += 1;
      else if (tone === 'today' || tone === 'soon') acc.soon += 1;
      return acc;
    },
    { overdue: 0, soon: 0 },
  );
  const parts = [`課題 ${counts.total}件`];
  if (deadlineCounts.overdue) parts.push(`期限超過 ${deadlineCounts.overdue}`);
  if (deadlineCounts.soon) parts.push(`期限間近 ${deadlineCounts.soon}`);
  if (counts.action) parts.push(`要対応 ${counts.action}`);
  if (counts.unchecked) parts.push(`未確認 ${counts.unchecked}`);
  if (counts.unpublished) parts.push(`未公開 ${counts.unpublished}`);
  if (counts.submitted) parts.push(`完了 ${counts.submitted}`);
  if (removed) parts.push(`整理 ${removed}`);
  return parts.join(' / ');
}

export function getLectureAssignmentSummaryState(records) {
  if (!records.length) return 'empty';
  if (records.some((record) => getAssignmentDeadlineState(record).alert)) return 'action';
  if (records.some((record) => record.status === 'not_submitted' || record.status === 'pending_confirmation')) return 'action';
  if (records.some((record) => record.status === 'unchecked' || record.status === 'unknown')) return 'unchecked';
  if (records.every((record) => record.status === 'submitted')) return 'complete';
  return 'idle';
}

export function createAssignmentDetectionResultFromRecord(record) {
  return {
    status: record.status || 'unknown',
    confidence: record.confidence || 'low',
    evidence: record.evidence || '保存済みの提出状態を表示しています。',
    source: record.source || 'storage',
    attemptedAt: record.attemptedAt || '',
  };
}

export function isHighConfidenceSubmittedRecord(record) {
  return Boolean(record?.status === 'submitted' && record.confidence === 'high');
}

export function getAssignmentStorageKeysForRecord(record, options = {}) {
  return [
    ...new Set([
      record?.url,
      record?.pageKey,
      options.currentUrl,
      options.currentPageKey,
    ].filter(Boolean)),
  ];
}

export function isManualAssignmentStatusRecord(record) {
  return Boolean(record?.source === 'manual');
}

export function shouldReplaceStaleUnpublishedRecord(previous, nextRecord) {
  return Boolean(
    previous?.status === 'unpublished' &&
      nextRecord.status !== 'unpublished' &&
      ['form-presence', 'assignment-page-fallback', 'page-text', 'submit-attempt', 'uploaded-file'].includes(nextRecord.source),
  );
}

export function isWeakAssignmentDetectionResult(result) {
  return Boolean(
    result?.status !== 'submitted' &&
      (result?.confidence === 'low' ||
        result?.status === 'pending_confirmation' ||
        result?.source === 'form-presence' ||
        result?.source === 'conservative-fallback' ||
        result?.source === 'assignment-page-fallback' ||
        result?.source === 'submit-attempt' ||
        result?.source === 'uploaded-file'),
  );
}

function isWeakAssignmentDowngradeCandidate(record) {
  return Boolean(
    record?.status !== 'submitted' &&
      (record?.confidence === 'low' ||
        record?.status === 'pending_confirmation' ||
        record?.source === 'form-presence' ||
        record?.source === 'conservative-fallback' ||
        record?.source === 'assignment-page-fallback' ||
        record?.source === 'uploaded-file'),
  );
}

function copyAssignmentDeadlineFields(record, previous) {
  if (!previous) return record;
  for (const field of [
    'deadlineDate',
    'deadlineTime',
    'deadlineSource',
    'deadlineUpdatedAt',
    'deadlineEvidence',
    'deadlineInferredYear',
    'deadlineInferredTime',
    'deadlineIgnoredCandidates',
  ]) {
    if (!(field in record) && field in previous) record[field] = previous[field];
  }
  return record;
}

export function prepareAssignmentStatusUpsert(allStatuses, record, options = {}) {
  const { allowManualOverwrite = false, currentUrl = '', currentPageKey = '' } = options;
  const key = record.url || record.pageKey;
  const previous = allStatuses[key] || allStatuses[record.pageKey] || allStatuses[record.url];
  copyAssignmentDeadlineFields(record, previous);
  const overwriteStaleUnpublished = shouldReplaceStaleUnpublishedRecord(previous, record);
  if (isManualAssignmentStatusRecord(previous) && !allowManualOverwrite && record.source !== 'manual' && record.source !== 'moocs-alert') {
    if (overwriteStaleUnpublished) {
      return {
        action: 'write',
        record,
        keys: getAssignmentStorageKeysForRecord(record, { currentUrl, currentPageKey }),
      };
    }
    return {
      action: 'keep',
      record: previous,
      keys: [],
    };
  }

  const previousIsStrongSubmitted = isHighConfidenceSubmittedRecord(previous);
  const nextIsWeakDowngrade = isWeakAssignmentDowngradeCandidate(record);
  if (previousIsStrongSubmitted && nextIsWeakDowngrade) {
    return {
      action: 'keep',
      record: previous,
      keys: [],
    };
  }

  const changed =
    !previous ||
    previous.status !== record.status ||
    previous.confidence !== record.confidence ||
    previous.evidence !== record.evidence ||
    previous.title !== record.title;
  if (!changed) {
    return {
      action: 'keep',
      record: previous,
      keys: [],
    };
  }

  return {
    action: 'write',
    record,
    keys: isHighConfidenceSubmittedRecord(record) || overwriteStaleUnpublished
      ? getAssignmentStorageKeysForRecord(record, { currentUrl, currentPageKey })
      : [key],
  };
}

export function isWeakAutoCollectedAssignmentRecord(record) {
  return Boolean(
    record &&
      ['unchecked', 'unknown'].includes(record.status) &&
      ['lecture-link-collect', 'lecture-link-collect-fallback'].includes(record.source),
  );
}

export function canReplaceAutoCollectedAssignmentRecord(existing, nextRecord) {
  if (!existing || existing.source === 'manual' || existing.status === 'submitted') return false;
  if (nextRecord.status === 'unpublished') return true;
  if (
    nextRecord.status === 'unchecked' &&
    existing.status === 'unpublished' &&
    ['lecture-link-unpublished', 'lecture-link-collect', 'lecture-link-collect-fallback'].includes(existing.source)
  ) {
    return true;
  }
  return (
    nextRecord.status === 'not_submitted' &&
    ['unchecked', 'unknown'].includes(existing.status) &&
    ['lecture-link-collect', 'lecture-link-collect-fallback'].includes(existing.source)
  );
}

export function collectStoredAssignmentRecordsForLecture(allStatuses, options = {}) {
  const currentRoute = parseMoocsCourseRoute(options.currentUrl || '');
  if (!currentRoute?.year || !currentRoute?.course || !currentRoute?.lecture) return [];
  const attendancePageUrls = new Set(options.attendancePageUrls || []);
  const records = new Map();
  for (const [key, record] of Object.entries(allStatuses || {})) {
    if (!record || typeof record !== 'object') continue;
    const rawUrl = record.url || record.pageKey || key;
    const route = parseMoocsCourseRoute(rawUrl);
    if (!route) continue;
    if (route.year !== currentRoute.year || route.course !== currentRoute.course || route.lecture !== currentRoute.lecture) continue;
    const canonicalUrl = getCanonicalMoocsUrl(rawUrl);
    if (attendancePageUrls.has(canonicalUrl)) continue;
    records.set(canonicalUrl, {
      ...record,
      url: canonicalUrl,
      pageKey: record.pageKey || canonicalUrl,
    });
  }
  return dedupeAssignmentRecords(sortCollectedAssignmentRecords([...records.values()]));
}

export function formatAssignmentDeadlineForDisplay(record) {
  const date = String(record?.deadlineDate || '').trim();
  const time = String(record?.deadlineTime || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return '未設定';
  const value = new Date(`${date}T${/^\d{2}:\d{2}$/.test(time) ? time : '00:00'}:00`);
  if (Number.isNaN(value.getTime())) return '未設定';
  return new Intl.DateTimeFormat('ja-JP', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    weekday: 'short',
    ...(time ? { hour: '2-digit', minute: '2-digit' } : {}),
  }).format(value);
}
