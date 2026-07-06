import {
  getAssignmentLectureDetails,
  getAssignmentOverview,
  getAssignmentDeadlineState,
} from '../shared/assignmentDeadline.js';
import {
  getAssignmentRecordTitleForDisplay,
  getAssignmentStatusDisplayLabel,
} from '../shared/assignmentStatus.js';
import {
  getCanonicalMoocsUrl,
  parseMoocsCourseRoute,
} from '../shared/moocsRoute.js';
import { buildIcsString, downloadIcsFile } from '../shared/icsExport.js';

function normalizeText(value) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim();
}

function getMoocsCourseListYearFromPage(locationRef) {
  if (/^\/courses\/?$/.test(locationRef.pathname)) return '';
  const route = parseMoocsCourseRoute(locationRef.href);
  return route?.year && !route.course ? route.year : null;
}

function findMountTarget(documentRef) {
  return (
    documentRef.querySelector('.content-wrapper .content') ||
    documentRef.querySelector('.content-wrapper') ||
    documentRef.body
  );
}

export function createAssignmentOverviewPanelController({
  document: documentRef,
  location: locationRef,
  getCurrentSettings,
  getAssignmentStatus,
}) {
  let panel = null;
  let renderGeneration = 0;
  const expandedLectures = new Set();

  async function ensureMounted() {
    const currentRenderGeneration = ++renderGeneration;
    const focusedElement = documentRef.activeElement;
    const focusedLectureKey = focusedElement
      ?.closest?.('.um-assignment-overview-item')
      ?.dataset.umLectureKey;
    const assignmentSettings = getCurrentSettings()?.assignments || {};
    const enabled = Boolean(assignmentSettings.enableAssignmentOverview);
    const warningDays = Math.min(
      30,
      Math.max(1, Number(assignmentSettings.assignmentOverviewWarningDays) || 7),
    );
    const limit = Math.min(30, Math.max(3, Number(assignmentSettings.assignmentOverviewLimit) || 10));
    const hideCompleted = Boolean(assignmentSettings.hideCompletedAssignmentLectures);
    const pageYear = getMoocsCourseListYearFromPage(locationRef);
    if (!enabled || pageYear === null) {
      panel?.remove();
      panel = null;
      expandedLectures.clear();
      return;
    }

    const stored = await getAssignmentStatus();
    if (currentRenderGeneration !== renderGeneration) return;
    const records = Object.entries(stored).map(([key, record]) => ({
      ...(record && typeof record === 'object' ? record : {}),
      key,
      url: getCanonicalMoocsUrl(record?.url || record?.pageKey || key),
    }));
    const overview = getAssignmentOverview(records, {
      warningDays,
      limit,
      hideCompleted,
      year: pageYear || undefined,
    });

    if (!overview.lectures.length) {
      panel?.remove();
      panel = null;
      expandedLectures.clear();
      return;
    }

    const visibleLectureKeys = new Set(overview.lectures.map((lecture) => lecture.key));
    for (const key of expandedLectures) {
      if (!visibleLectureKeys.has(key)) expandedLectures.delete(key);
    }

    if (!panel || !panel.isConnected) {
      panel = documentRef.createElement('section');
      panel.className = 'um-assignment-overview-panel';
      panel.dataset.umModule = 'assignment-overview';
      panel.setAttribute('aria-labelledby', 'um-assignment-overview-title');
      findMountTarget(documentRef).prepend(panel);
    }

    const header = documentRef.createElement('header');
    header.className = 'um-assignment-overview-header';
    const heading = documentRef.createElement('div');
    heading.innerHTML =
      '<span>MOOCS ULTIMATE</span><strong id="um-assignment-overview-title">講義ごとの課題</strong>';
    const summary = documentRef.createElement('span');
    summary.className = 'um-assignment-overview-summary';
    summary.textContent = `${overview.year} / ${overview.lectures.length}回`;
    summary.setAttribute('aria-live', 'polite');
    const calendarExportEnabled = Boolean(getCurrentSettings()?.assignments?.enableCalendarExport);
    if (calendarExportEnabled) {
      const exportBtn = documentRef.createElement('button');
      exportBtn.type = 'button';
      exportBtn.className = 'um-assignment-overview-export';
      exportBtn.textContent = '📅 書き出し';
      exportBtn.title = '未提出の課題締切を .ics ファイルとしてダウンロード';
      exportBtn.addEventListener('click', () => {
        const ics = buildIcsString(records);
        if (!ics.includes('BEGIN:VEVENT')) {
          exportBtn.textContent = '対象なし';
          setTimeout(() => { exportBtn.textContent = '📅 書き出し'; }, 2000);
          return;
        }
        downloadIcsFile(ics, `moocs-deadlines-${overview.year}.ics`);
        exportBtn.textContent = '✓ 保存しました';
        setTimeout(() => { exportBtn.textContent = '📅 書き出し'; }, 2000);
      });
      header.append(heading, summary, exportBtn);
    } else {
      header.append(heading, summary);
    }

    const list = documentRef.createElement('div');
    list.className = 'um-assignment-overview-list';
    list.setAttribute('role', 'list');
    for (const lecture of overview.lectures) {
      const detailRecords = getAssignmentLectureDetails(lecture.records, { warningDays });
      if (!detailRecords.length) expandedLectures.delete(lecture.key);
      const expanded = detailRecords.length > 0 && expandedLectures.has(lecture.key);
      const item = documentRef.createElement('article');
      item.className = 'um-assignment-overview-item';
      item.dataset.umLectureKey = lecture.key;
      item.dataset.tone = lecture.deadline?.tone || (lecture.remainingCount ? 'unset' : 'complete');
      item.setAttribute('role', 'listitem');

      const row = documentRef.createElement('div');
      row.className = 'um-assignment-overview-row';
      const detailsId = `um-assignment-overview-details-${lecture.key.replace(/[^a-z0-9_-]+/gi, '-')}`;
      const lectureTitleId = `${detailsId}-title`;

      const identity = documentRef.createElement('span');
      identity.className = 'um-assignment-overview-identity';
      const course = documentRef.createElement('span');
      course.textContent = normalizeText(lecture.courseName || lecture.course);
      const title = documentRef.createElement('strong');
      title.id = lectureTitleId;
      title.textContent = `課題 ${lecture.lecture}`;
      identity.append(course, title);

      const stats = documentRef.createElement('span');
      stats.className = 'um-assignment-overview-stats';
      const values = [
        ['課題数', lecture.totalCount],
        ['残り', lecture.remainingCount],
        ['提出期限', lecture.deadlineLabel],
      ];
      if (lecture.unpublishedCount) values.splice(2, 0, ['未公開', lecture.unpublishedCount]);
      stats.dataset.columns = String(values.length);
      for (const [label, value] of values) {
        const stat = documentRef.createElement('span');
        stat.className = 'um-assignment-overview-stat';
        const term = documentRef.createElement('span');
        term.textContent = label;
        const detail = documentRef.createElement('strong');
        detail.textContent = String(value);
        stat.append(term, detail);
        stats.append(stat);
      }

      const toggle = documentRef.createElement('button');
      toggle.type = 'button';
      toggle.className = 'um-assignment-overview-toggle';
      toggle.hidden = detailRecords.length === 0;
      toggle.textContent = expanded ? '▲' : '▼';
      toggle.title = `${lecture.lecture}の課題を${expanded ? '折りたたむ' : '展開'}`;
      toggle.setAttribute('aria-label', toggle.title);
      toggle.setAttribute('aria-expanded', String(expanded));
      toggle.setAttribute('aria-controls', detailsId);

      const details = documentRef.createElement('div');
      details.id = detailsId;
      details.className = 'um-assignment-overview-details';
      details.setAttribute('role', 'list');
      details.setAttribute('aria-labelledby', lectureTitleId);
      details.hidden = !expanded;
      for (const record of detailRecords) {
        const deadline = getAssignmentDeadlineState(record, { warningDays });
        const detailRow = documentRef.createElement('div');
        detailRow.className = 'um-assignment-overview-detail';
        detailRow.setAttribute('role', 'listitem');
        detailRow.dataset.status = record.status;
        detailRow.dataset.tone = record.status === 'unpublished' ? 'unpublished' : deadline.tone;

        const detailTitle = documentRef.createElement('strong');
        detailTitle.className = 'um-assignment-overview-detail-title';
        detailTitle.textContent = getAssignmentRecordTitleForDisplay(record);
        detailTitle.title = detailTitle.textContent;
        const detailStatus = documentRef.createElement('span');
        detailStatus.className = 'um-assignment-overview-detail-status';
        detailStatus.textContent = getAssignmentStatusDisplayLabel(record.status);
        const detailDeadline = documentRef.createElement('span');
        detailDeadline.className = 'um-assignment-overview-detail-deadline';
        detailDeadline.textContent = deadline.label;
        const openLink = documentRef.createElement('a');
        openLink.className = 'um-assignment-overview-open';
        openLink.href = record.url || record.pageKey || '#';
        openLink.textContent = '開く';
        openLink.setAttribute('aria-label', `${detailTitle.textContent}を開く`);
        detailRow.append(detailTitle, detailStatus, detailDeadline, openLink);
        details.append(detailRow);
      }

      toggle.addEventListener('click', () => {
        const isExpanded = toggle.getAttribute('aria-expanded') === 'true';
        if (isExpanded) expandedLectures.delete(lecture.key);
        else expandedLectures.add(lecture.key);
        toggle.setAttribute('aria-expanded', String(!isExpanded));
        toggle.setAttribute('aria-label', `${lecture.lecture}の課題を${isExpanded ? '展開' : '折りたたむ'}`);
        toggle.title = `${lecture.lecture}の課題を${isExpanded ? '展開' : '折りたたむ'}`;
        toggle.textContent = isExpanded ? '▼' : '▲';
        details.hidden = isExpanded;
      });

      row.append(identity, stats, toggle);
      item.append(row, details);
      list.append(item);
    }

    const shouldRestoreFocus = Boolean(focusedLectureKey && documentRef.activeElement === focusedElement);
    panel.replaceChildren(header, list);
    if (shouldRestoreFocus) {
      const focusedItem = [...panel.querySelectorAll('.um-assignment-overview-item')].find(
        (item) => item.dataset.umLectureKey === focusedLectureKey,
      );
      focusedItem?.querySelector('.um-assignment-overview-toggle')?.focus({ preventScroll: true });
    }
  }

  return { ensureMounted };
}
