import {
  canReplaceAutoCollectedAssignmentRecord,
  collectStoredAssignmentRecordsForLecture,
  createLectureAssignmentSummaryText,
  getLectureAssignmentSummaryState,
  isWeakAutoCollectedAssignmentRecord,
} from '../shared/assignmentStatus.js';
import {
  classifyAssignmentLinkCandidate,
  detectAssignmentSignalInDocument,
  sortCollectedAssignmentRecords,
} from '../shared/assignmentDetection.js';
import { getDownloadNamingContext, getMoocsPageTitle } from '../shared/downloadCandidates.js';
import { showToast } from '../shared/domUtils.js';
import { getAssignmentStatus, saveAssignmentStatus } from '../shared/storage.js';
import { getCanonicalMoocsUrl, parseMoocsCourseRoute } from '../shared/moocsRoute.js';

const ASSIGNMENT_RENDER_CONCURRENCY = 4;

export function createLectureAssignmentCollector({
  document: documentRef,
  location: locationRef,
  isMoocsUltimateOwnedNode,
  normalizeVisibleLabelText,
  isNumberPageTab,
  classifyTab,
  isAttendanceTabKind,
  getTabCanonicalUrl,
  isAttendanceDocument,
  getAssignmentDetectionOptions,
  fetchMoocsHtmlDocument,
  runWithConcurrency,
  downloadFetchConcurrency,
  shouldInspectAssignmentCandidateInSandboxedFrame,
  inspectAssignmentCandidateInSandboxedFrame,
  syncCurrentAssignmentStatusFromDom,
  updateCheckStatus,
  renderMiniList,
  applyAssignmentTabStatusBadges,
}) {
  let checkBusy = false;
  const detectedAttendancePageUrls = new Set();

  function collectCurrentLecturePageUrls() {
    const currentRoute = parseMoocsCourseRoute(locationRef.href);
    if (!currentRoute?.year || !currentRoute?.course || !currentRoute?.lecture) return new Set();
    const urls = new Set([getCanonicalMoocsUrl(locationRef.href)]);
    for (const link of documentRef.querySelectorAll('.pagination a[href], .pagination span[href], .pagination button[href]')) {
      if (!isNumberPageTab(link)) continue;
      let url;
      try {
        url = new URL(link.getAttribute('href'), locationRef.href);
      } catch {
        continue;
      }
      const route = parseMoocsCourseRoute(url.href);
      if (!route) continue;
      if (route.year !== currentRoute.year || route.course !== currentRoute.course || route.lecture !== currentRoute.lecture) continue;
      urls.add(getCanonicalMoocsUrl(url.href));
    }
    return urls;
  }

  function collectCurrentLectureAttendancePageUrls() {
    const urls = new Set(detectedAttendancePageUrls);
    if (isAttendanceDocument(documentRef)) urls.add(getCanonicalMoocsUrl(locationRef.href));
    for (const link of documentRef.querySelectorAll('.pagination a, .pagination span, .pagination button')) {
      if (!isNumberPageTab(link) || !isAttendanceTabKind(classifyTab(link))) continue;
      const url = getTabCanonicalUrl(link);
      if (url) urls.add(url);
    }
    return urls;
  }

  function removeAutoCollectedAttendanceRecords(allStatuses) {
    const attendancePageUrls = collectCurrentLectureAttendancePageUrls();
    if (!attendancePageUrls.size) return 0;
    let removed = 0;
    for (const [key, record] of Object.entries(allStatuses || {})) {
      if (!record || record.source === 'manual') continue;
      const recordUrl = getCanonicalMoocsUrl(record.url || record.pageKey || key);
      if (!attendancePageUrls.has(recordUrl)) continue;
      delete allStatuses[key];
      removed += 1;
    }
    return removed;
  }

  function getStoredAssignmentRecordsForCurrentLecture(allStatuses) {
    return collectStoredAssignmentRecordsForLecture(allStatuses, {
      currentUrl: locationRef.href,
      attendancePageUrls: collectCurrentLectureAttendancePageUrls(),
    });
  }

  async function collectAssignmentCandidatesForCurrentLecture() {
    const currentRoute = parseMoocsCourseRoute(locationRef.href);
    if (!currentRoute?.year || !currentRoute?.course || !currentRoute?.lecture) return [];
    detectedAttendancePageUrls.clear();
    const context = getDownloadNamingContext(documentRef, locationRef.href);
    const candidates = [];
    for (const link of documentRef.querySelectorAll('a[href]')) {
      if (isMoocsUltimateOwnedNode(link)) continue;
      let url;
      try {
        url = new URL(link.getAttribute('href'), locationRef.href);
      } catch {
        continue;
      }
      if (url.hostname !== 'moocs.iniad.org') continue;
      const route = parseMoocsCourseRoute(url.href);
      if (!route) continue;
      if (route.year !== currentRoute.year || route.course !== currentRoute.course || route.lecture !== currentRoute.lecture) continue;
      const canonicalUrl = getCanonicalMoocsUrl(url.href);
      if (canonicalUrl === getCanonicalMoocsUrl(locationRef.href)) continue;
      const isPageTab = isNumberPageTab(link);
      const candidate = classifyAssignmentLinkCandidate(link, url, {
        isPageTab,
        tabKind: isPageTab ? classifyTab(link) : '',
        isAttendanceTabKind,
      });
      if (!candidate.shouldVerify) continue;
      candidates.push({
        url,
        canonicalUrl,
        candidate,
        linkText: normalizeVisibleLabelText(link.textContent) || candidate.text,
      });
    }
    const uniqueCandidates = [...new Map(candidates.map((candidate) => [candidate.canonicalUrl, candidate])).values()];
    const links = [];
    const renderedEntries = [];
    await runWithConcurrency(uniqueCandidates, downloadFetchConcurrency, async (entry) => {
      try {
        const doc = await fetchMoocsHtmlDocument(entry.url);
        const signal = detectAssignmentSignalInDocument(doc, entry.url, entry.candidate, getAssignmentDetectionOptions());
        if (!signal.ok) {
          if (signal.attendancePage) {
            detectedAttendancePageUrls.add(entry.canonicalUrl);
            return;
          }
          renderedEntries.push(entry);
          return;
        }
        const title = getMoocsPageTitle(doc, entry.url.href) || entry.linkText || '課題';
        links.push({
          url: entry.canonicalUrl,
          pageKey: entry.canonicalUrl,
          status: signal.status,
          confidence: signal.confidence,
          evidence: signal.evidence,
          source: signal.status === 'unpublished' ? 'lecture-link-unpublished' : 'lecture-link-collect',
          title,
          courseName: context.courseName,
          lectureGroup: context.lectureGroup,
          lectureName: title,
          checkedAt: new Date().toISOString(),
        });
      } catch (error) {
        renderedEntries.push({ ...entry, staticError: error });
      }
    });
    const uniqueRenderedEntries = [...new Map(renderedEntries.map((entry) => [entry.canonicalUrl, entry])).values()];
    const sandboxInspectionKeys = new Set(
      uniqueRenderedEntries
        .filter(shouldInspectAssignmentCandidateInSandboxedFrame)
        .map((entry) => entry.canonicalUrl),
    );
    await runWithConcurrency(
      uniqueRenderedEntries.filter((entry) => sandboxInspectionKeys.has(entry.canonicalUrl)),
      ASSIGNMENT_RENDER_CONCURRENCY,
      async (entry) => {
        const rendered = await inspectAssignmentCandidateInSandboxedFrame(entry);
        if (rendered?.attendancePage) {
          detectedAttendancePageUrls.add(entry.canonicalUrl);
          return;
        }
        if (rendered) {
          links.push({
            url: entry.canonicalUrl,
            pageKey: entry.canonicalUrl,
            status: 'unchecked',
            confidence: 'low',
            evidence: `安全なサンドボックス内でMOOCsの問題ページを検出しました。提出状態と公開状態はページを直接開いた時に確定します: ${rendered.signal.evidence}`,
            source: 'lecture-link-collect',
            title: rendered.title,
            courseName: context.courseName,
            lectureGroup: context.lectureGroup,
            lectureName: rendered.title,
            checkedAt: new Date().toISOString(),
          });
          return;
        }
      },
    );
    for (const entry of uniqueRenderedEntries) {
      if (!entry.staticError || !entry.candidate.likelyAssignment) continue;
      if (sandboxInspectionKeys.has(entry.canonicalUrl)) continue;
      links.push({
        url: entry.canonicalUrl,
        pageKey: entry.canonicalUrl,
        status: 'unchecked',
        confidence: 'low',
        evidence: `候補ページの確認に失敗しましたが、課題らしいリンクとして収集しました: ${entry.staticError?.message || entry.staticError}`,
        source: 'lecture-link-collect-fallback',
        title: entry.linkText || getMoocsPageTitle(documentRef, entry.canonicalUrl) || '課題',
        courseName: context.courseName,
        lectureGroup: context.lectureGroup,
        lectureName: entry.linkText || context.lectureName,
        checkedAt: new Date().toISOString(),
      });
    }
    return sortCollectedAssignmentRecords(links);
  }

  async function refreshCurrentLectureAssignmentCandidates() {
    if (checkBusy) return;
    checkBusy = true;
    updateCheckStatus('確認中...', 'checking');
    try {
      await syncCurrentAssignmentStatusFromDom();
      const candidates = await collectAssignmentCandidatesForCurrentLecture();
      const allStatuses = await getAssignmentStatus();
      let added = 0;
      let updated = 0;
      let skipped = 0;
      let removed = removeAutoCollectedAttendanceRecords(allStatuses);
      const candidateUrls = new Set(candidates.map((record) => record.url));
      const lecturePageUrls = collectCurrentLecturePageUrls();
      for (const [key, record] of Object.entries(allStatuses)) {
        const recordUrl = getCanonicalMoocsUrl(record?.url || key);
        if (!lecturePageUrls.has(recordUrl)) continue;
        if (candidateUrls.has(recordUrl)) continue;
        if (!isWeakAutoCollectedAssignmentRecord(record)) continue;
        delete allStatuses[key];
        removed += 1;
      }
      if (!candidates.length) {
        if (removed > 0) await saveAssignmentStatus(allStatuses);
        const lectureRecords = getStoredAssignmentRecordsForCurrentLecture(allStatuses);
        applyAssignmentTabStatusBadges();
        updateCheckStatus(
          lectureRecords.length ? createLectureAssignmentSummaryText(lectureRecords, removed) : createLectureAssignmentSummaryText([], removed),
          lectureRecords.length ? getLectureAssignmentSummaryState(lectureRecords) : removed > 0 ? 'idle' : 'empty',
        );
        renderMiniList(lectureRecords);
        showToast(`この回の課題は見つかりませんでした。整理 ${removed}件`);
        return;
      }
      for (const record of candidates) {
        const existing = allStatuses[record.url] || allStatuses[record.pageKey];
        if (canReplaceAutoCollectedAssignmentRecord(existing, record)) {
          allStatuses[record.url] = {
            ...existing,
            ...record,
          };
          updated += 1;
          continue;
        }
        if (existing) {
          skipped += 1;
          continue;
        }
        allStatuses[record.url] = record;
        added += 1;
      }
      if (added > 0 || updated > 0 || removed > 0) await saveAssignmentStatus(allStatuses);
      const lectureRecords = getStoredAssignmentRecordsForCurrentLecture(allStatuses);
      applyAssignmentTabStatusBadges();
      updateCheckStatus(
        createLectureAssignmentSummaryText(lectureRecords, removed),
        getLectureAssignmentSummaryState(lectureRecords),
      );
      renderMiniList(lectureRecords);
      showToast(`この回の課題を確認しました。追加 ${added}件 / 更新 ${updated}件 / 整理 ${removed}件 / 既存 ${skipped}件`);
    } finally {
      checkBusy = false;
    }
  }

  return {
    refreshCurrentLectureAssignmentCandidates,
    getStoredAssignmentRecordsForCurrentLecture,
    removeAutoCollectedAttendanceRecords,
    isBusy: () => checkBusy,
  };
}
