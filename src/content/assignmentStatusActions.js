import { renderAssignmentStatusPanelContent as renderAssignmentStatusPanelContentView } from './assignmentStatusPanelView.js';
import {
  createAssignmentDetectionResultFromRecord,
  formatAssignmentDeadlineForDisplay,
  getAssignmentStatusDisplayLabel,
  getAssignmentStorageKeysForRecord,
  isHighConfidenceSubmittedRecord,
  isWeakAssignmentDetectionResult,
  prepareAssignmentStatusUpsert,
} from '../shared/assignmentStatus.js';
import { extractDeadlineCandidatesFromLines } from '../shared/deadlineCandidates.js';
import { createButton, reportContentError, showToast } from '../shared/domUtils.js';
import { getDownloadNamingContext, getMoocsPageTitle } from '../shared/downloadCandidates.js';
import { getAssignmentStatus, saveAssignmentStatus } from '../shared/storage.js';
import { getCanonicalMoocsUrl, parseMoocsCourseRoute } from '../shared/moocsRoute.js';

export function createAssignmentStatusActionsController({
  document: documentRef,
  window: windowRef,
  location: locationRef,
  getCurrentSettings,
  isCurrentPageAssignmentLike,
  findMainContentRoot,
  getCurrentPageStorageKey,
  detectCurrentAssignmentSubmissionStatus,
  collectDeadlineCandidateLines,
  findUploadedAssignmentEvidence,
  normalizeVisibleLabelText,
  refreshLectureAssignmentSummaryFromStorage,
  runtimeGetURL,
  getPendingAssignmentSubmit,
  setPendingAssignmentSubmit,
  refreshCurrentLectureAssignmentCandidates,
  applyAssignmentTabStatusBadges,
}) {
  let assignmentStatusPanel = null;
  const assignmentUnknownRetryCounts = new Map();
  const assignmentSubmittedLocks = new Map();

  function isAssignmentSavedAlertMessage(message) {
    const text = normalizeVisibleLabelText(message);
    return /すべての回答を保存しました|全ての回答を保存しました|回答を保存しました|all\s+your\s+answers\s+have\s+been\s+saved/i.test(text);
  }

  function createAssignmentStatusRecordFromDetection(result) {
    const context = getDownloadNamingContext(documentRef, locationRef.href);
    return {
      url: getCanonicalMoocsUrl(locationRef.href),
      pageKey: getCurrentPageStorageKey(),
      status: result.status,
      confidence: result.confidence,
      evidence: result.evidence,
      source: result.source,
      attemptedAt: result.attemptedAt || '',
      title: getMoocsPageTitle(documentRef, locationRef.href),
      courseName: context.courseName,
      lectureGroup: context.lectureGroup,
      lectureName: context.lectureName,
      checkedAt: new Date().toISOString(),
    };
  }

  function rememberSubmittedAssignmentRecordTemporarily(record) {
    if (!isHighConfidenceSubmittedRecord(record)) return;
    const lock = {
      record,
      lockedAt: Date.now(),
    };
    for (const key of getAssignmentStorageKeysForRecord(record, {
      currentUrl: getCanonicalMoocsUrl(locationRef.href),
      currentPageKey: getCurrentPageStorageKey(),
    })) {
      assignmentSubmittedLocks.set(key, lock);
    }
  }

  function getTemporarySubmittedAssignmentRecord() {
    const now = Date.now();
    for (const key of [getCanonicalMoocsUrl(locationRef.href), getCurrentPageStorageKey()].filter(Boolean)) {
      const lock = assignmentSubmittedLocks.get(key);
      if (!lock) continue;
      if (now - lock.lockedAt > 60_000) {
        assignmentSubmittedLocks.delete(key);
        continue;
      }
      return lock.record;
    }
    return null;
  }

  function shouldRetryUnknownAssignmentDetection(result, storedRecord) {
    if (storedRecord) return false;
    return result?.status === 'unknown' && result?.source === 'conservative-fallback';
  }

  function scheduleAssignmentStatusPanelRecheck(delayMs) {
    windowRef.setTimeout(() => {
      ensureAssignmentStatusPanelMounted().catch((error) => reportContentError('[ultimateMoocs:assignment]', error));
    }, delayMs);
  }

  async function getStoredAssignmentRecordForCurrentPage() {
    const allStatuses = await getAssignmentStatus();
    return allStatuses[getCanonicalMoocsUrl(locationRef.href)] || allStatuses[getCurrentPageStorageKey()] || null;
  }

  async function saveAssignmentStatusRecordIfChanged(record, options = {}) {
    const { allowManualOverwrite = false } = options;
    const allStatuses = await getAssignmentStatus();
    const upsert = prepareAssignmentStatusUpsert(allStatuses, record, {
      allowManualOverwrite,
      currentUrl: getCanonicalMoocsUrl(locationRef.href),
      currentPageKey: getCurrentPageStorageKey(),
    });
    if (upsert.action !== 'write') return upsert.record;
    for (const nextKey of upsert.keys) allStatuses[nextKey] = upsert.record;
    await saveAssignmentStatus(allStatuses);
    return upsert.record;
  }

  function renderAssignmentStatusPanelContent(result, record) {
    renderAssignmentStatusPanelContentView(assignmentStatusPanel, result, record, {
      document: documentRef,
      createButton,
      candidates: getDeadlineCandidatesForCurrentAssignment(record),
      debugEnabled: Boolean(getCurrentSettings()?.debug?.enableDebugLog),
      onRefresh: () => refreshAssignmentStatusFromManualButton()
        .catch((error) => reportContentError('[ultimateMoocs:assignment]', error)),
      onCollectLectureAssignments: () => refreshCurrentLectureAssignmentCandidates()
        .catch((error) => reportContentError('[ultimateMoocs:assignment]', error)),
      onSetManualStatus: (status) => setAssignmentStatusManually(status)
        .catch((error) => reportContentError('[ultimateMoocs:assignment]', error)),
      onTriggerDevAlert: triggerDevSubmittedAssignmentAlert,
      onSaveDeadline: (targetRecord, deadlineDate, deadlineTime) => saveAssignmentDeadlineForRecord(targetRecord, deadlineDate, deadlineTime)
        .catch((error) => reportContentError('[ultimateMoocs:assignment-deadline]', error)),
      onClearDeadline: (targetRecord) => clearAssignmentDeadlineForRecord(targetRecord)
        .catch((error) => reportContentError('[ultimateMoocs:assignment-deadline]', error)),
      onApplyCandidate: (targetRecord, candidate) => saveAssignmentDeadlineForRecord(targetRecord, candidate.date, candidate.time, {
        source: 'page-candidate',
        evidence: candidate.sourceText,
        inferredYear: candidate.inferredYear,
        inferredTime: candidate.inferredTime,
      }).catch((error) => reportContentError('[ultimateMoocs:assignment-deadline]', error)),
      onIgnoreCandidate: (targetRecord, candidateId) => ignoreDeadlineCandidateForAssignment(targetRecord, candidateId)
        .catch((error) => reportContentError('[ultimateMoocs:assignment-deadline]', error)),
    });
  }

  async function refreshAssignmentStatusFromManualButton() {
    if (!assignmentStatusPanel) return;
    renderAssignmentStatusPanelContent(
      {
        status: 'checking',
        confidence: 'low',
        evidence: '再確認ボタンから提出状態を確認しています。',
        source: 'manual-recheck',
      },
      { checkedAt: new Date().toISOString() },
    );
    await ensureAssignmentStatusPanelMounted({ allowManualOverwrite: true, showResultToast: true, skipUnknownRetry: true });
  }

  async function setAssignmentStatusManually(status) {
    if (!getCurrentSettings()?.assignments?.enableSubmissionCheck) return;
    if (!assignmentStatusPanel) return;
    const result = {
      status,
      confidence: 'manual',
      evidence: `ユーザーが手動で「${getAssignmentStatusDisplayLabel(status)}」に設定しました。`,
      source: 'manual',
    };
    setPendingAssignmentSubmit(null);
    const record = createAssignmentStatusRecordFromDetection(result);
    const savedRecord = await saveAssignmentStatusRecordIfChanged(record);
    renderAssignmentStatusPanelContent(createAssignmentDetectionResultFromRecord(savedRecord || record), savedRecord || record);
    applyAssignmentTabStatusBadges();
    showToast(`課題状態を「${getAssignmentStatusDisplayLabel(status)}」に変更しました。`);
  }

  async function markAssignmentSubmittedFromMoocsAlert(message, capturedAt = Date.now()) {
    if (!getCurrentSettings()?.assignments?.enableSubmissionCheck) return;
    if (!isCurrentPageAssignmentLike()) return;

    setPendingAssignmentSubmit(null);
    const result = {
      status: 'submitted',
      confidence: 'high',
      evidence: normalizeVisibleLabelText(message).slice(0, 180),
      source: 'moocs-alert',
      alertCapturedAt: new Date(capturedAt).toISOString(),
    };
    const record = createAssignmentStatusRecordFromDetection(result);
    const savedRecord = await saveAssignmentStatusRecordIfChanged(record);
    rememberSubmittedAssignmentRecordTemporarily(savedRecord || record);
    assignmentStatusPanel =
      documentRef.querySelector('.um-assignment-status-panel[data-um-module="assignment-status"]') ||
      documentRef.querySelector('.um-assignment-status-panel') ||
      assignmentStatusPanel;
    if (!assignmentStatusPanel) {
      assignmentStatusPanel = documentRef.createElement('section');
      assignmentStatusPanel.className = 'um-assignment-status-panel';
      assignmentStatusPanel.dataset.umModule = 'assignment-status';
      findMainContentRoot().prepend(assignmentStatusPanel);
    }
    renderAssignmentStatusPanelContent(createAssignmentDetectionResultFromRecord(savedRecord || record), savedRecord || record);
    applyAssignmentTabStatusBadges();
    showToast('課題の提出完了アラートを検出しました。');
  }

  async function markAssignmentPendingAfterSubmitAttempt() {
    if (!getCurrentSettings()?.assignments?.enableSubmissionCheck) return;
    if (!isCurrentPageAssignmentLike()) return;
    const pending = getPendingAssignmentSubmit();
    const submitAttemptedHere =
      pending?.url === getCanonicalMoocsUrl(locationRef.href) &&
      Date.now() - new Date(pending.attemptedAt).getTime() < 10 * 60 * 1000;
    if (!submitAttemptedHere) {
      await ensureAssignmentStatusPanelMounted();
      return;
    }

    const uploadedEvidence = findUploadedAssignmentEvidence();
    if (!uploadedEvidence) {
      await ensureAssignmentStatusPanelMounted();
      return;
    }

    const result = {
      status: 'submitted',
      confidence: 'high',
      evidence: `提出ボタン押下後、アップロード済み表示を確認しました: ${uploadedEvidence}`.slice(0, 220),
      source: 'submit-click-uploaded',
      attemptedAt: pending.attemptedAt,
    };
    setPendingAssignmentSubmit(null);
    const record = createAssignmentStatusRecordFromDetection(result);
    const savedRecord = await saveAssignmentStatusRecordIfChanged(record);
    rememberSubmittedAssignmentRecordTemporarily(savedRecord || record);
    assignmentStatusPanel =
      documentRef.querySelector('.um-assignment-status-panel[data-um-module="assignment-status"]') ||
      documentRef.querySelector('.um-assignment-status-panel') ||
      assignmentStatusPanel;
    if (!assignmentStatusPanel) {
      assignmentStatusPanel = documentRef.createElement('section');
      assignmentStatusPanel.className = 'um-assignment-status-panel';
      assignmentStatusPanel.dataset.umModule = 'assignment-status';
      findMainContentRoot().prepend(assignmentStatusPanel);
    }
    renderAssignmentStatusPanelContent(createAssignmentDetectionResultFromRecord(savedRecord || record), savedRecord || record);
    applyAssignmentTabStatusBadges();
    showToast('提出ボタンとアップロード済み表示を確認し、提出済みとして記録しました。');
  }

  function triggerDevSubmittedAssignmentAlert() {
    if (!getCurrentSettings()?.assignments?.enableSubmissionCheck) return;
    if (!isCurrentPageAssignmentLike()) return;
    const message = 'すべての回答を保存しました。\nAll your answers have been saved.';
    try {
      const script = documentRef.createElement('script');
      script.src = runtimeGetURL('page/dev-alert.js');
      script.async = false;
      script.dataset.message = message;
      script.dataset.umModule = 'dev-alert';
      script.addEventListener('load', () => script.remove());
      script.addEventListener('error', () => {
        script.remove();
        showToast('開発用アラートスクリプトの読み込みに失敗しました。');
      });
      (documentRef.head || documentRef.documentElement).append(script);
    } catch (error) {
      reportContentError('[ultimateMoocs:assignment:dev]', error);
      showToast('開発用アラートの起動に失敗しました。');
    }
  }

  async function saveAssignmentDeadlineForRecord(record, deadlineDate, deadlineTime = '', options = {}) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(deadlineDate)) {
      showToast('提出期限の日付を選択してください。');
      return;
    }
    if (deadlineTime && !/^\d{2}:\d{2}$/.test(deadlineTime)) {
      showToast('提出期限の時刻を確認してください。');
      return;
    }
    const allStatuses = await getAssignmentStatus();
    const key = record?.url || record?.pageKey || getCanonicalMoocsUrl(locationRef.href);
    const previous = allStatuses[key] || allStatuses[record?.pageKey] || allStatuses[record?.url] || record || {};
    const nextRecord = {
      ...previous,
      deadlineDate,
      deadlineTime,
      deadlineSource: options.source || 'manual',
      deadlineUpdatedAt: new Date().toISOString(),
      deadlineEvidence: options.evidence || '',
      deadlineInferredYear: Boolean(options.inferredYear),
      deadlineInferredTime: Boolean(options.inferredTime),
    };
    for (const nextKey of getAssignmentStorageKeysForRecord(nextRecord, {
      currentUrl: getCanonicalMoocsUrl(locationRef.href),
      currentPageKey: getCurrentPageStorageKey(),
    })) allStatuses[nextKey] = nextRecord;
    await saveAssignmentStatus(allStatuses);
    renderAssignmentStatusPanelContent(createAssignmentDetectionResultFromRecord(nextRecord), nextRecord);
    refreshLectureAssignmentSummaryFromStorage();
    showToast(`提出期限を${formatAssignmentDeadlineForDisplay(nextRecord)}に設定しました。`);
  }

  async function clearAssignmentDeadlineForRecord(record) {
    const allStatuses = await getAssignmentStatus();
    const key = record?.url || record?.pageKey || getCanonicalMoocsUrl(locationRef.href);
    const previous = allStatuses[key] || allStatuses[record?.pageKey] || allStatuses[record?.url] || record;
    if (!previous) return;
    const nextRecord = {
      ...previous,
      deadlineDate: '',
      deadlineTime: '',
      deadlineSource: '',
      deadlineUpdatedAt: new Date().toISOString(),
      deadlineEvidence: '',
      deadlineInferredYear: false,
      deadlineInferredTime: false,
    };
    for (const nextKey of getAssignmentStorageKeysForRecord(nextRecord, {
      currentUrl: getCanonicalMoocsUrl(locationRef.href),
      currentPageKey: getCurrentPageStorageKey(),
    })) allStatuses[nextKey] = nextRecord;
    await saveAssignmentStatus(allStatuses);
    renderAssignmentStatusPanelContent(createAssignmentDetectionResultFromRecord(nextRecord), nextRecord);
    refreshLectureAssignmentSummaryFromStorage();
    showToast('提出期限を削除しました。');
  }

  function getDeadlineCandidatesForCurrentAssignment(record) {
    const route = parseMoocsCourseRoute(locationRef.href);
    const ignored = new Set(Array.isArray(record?.deadlineIgnoredCandidates) ? record.deadlineIgnoredCandidates : []);
    const savedId = record?.deadlineDate
      ? `${record.deadlineDate}T${record.deadlineTime || '23:59'}`
      : '';
    return extractDeadlineCandidatesFromLines(collectDeadlineCandidateLines(), {
      defaultYear: Number(route?.year) || new Date().getFullYear(),
      allowLooseDates: true,
    }).filter((candidate) => candidate.id !== savedId && !ignored.has(candidate.id));
  }

  async function ignoreDeadlineCandidateForAssignment(record, candidateId) {
    const allStatuses = await getAssignmentStatus();
    const key = record?.url || record?.pageKey || getCanonicalMoocsUrl(locationRef.href);
    const previous = allStatuses[key] || allStatuses[record?.pageKey] || allStatuses[record?.url] || record || {};
    const ignored = [...new Set([
      ...(Array.isArray(previous.deadlineIgnoredCandidates) ? previous.deadlineIgnoredCandidates : []),
      candidateId,
    ])].slice(-20);
    const nextRecord = {
      ...previous,
      deadlineIgnoredCandidates: ignored,
    };
    for (const nextKey of getAssignmentStorageKeysForRecord(nextRecord, {
      currentUrl: getCanonicalMoocsUrl(locationRef.href),
      currentPageKey: getCurrentPageStorageKey(),
    })) allStatuses[nextKey] = nextRecord;
    await saveAssignmentStatus(allStatuses);
    renderAssignmentStatusPanelContent(createAssignmentDetectionResultFromRecord(nextRecord), nextRecord);
    showToast('この期限候補を無視しました。');
  }

  async function ensureAssignmentStatusPanelMounted(options = {}) {
    const { allowManualOverwrite = false, showResultToast = false, skipUnknownRetry = false } = options;
    const enabled = Boolean(getCurrentSettings()?.assignments?.enableSubmissionCheck);
    const shouldShow = enabled && isCurrentPageAssignmentLike();
    if (!shouldShow) {
      assignmentStatusPanel?.remove();
      assignmentStatusPanel = null;
      return;
    }

    if (!assignmentStatusPanel) {
      assignmentStatusPanel = documentRef.createElement('section');
      assignmentStatusPanel.className = 'um-assignment-status-panel';
      assignmentStatusPanel.dataset.umModule = 'assignment-status';
      findMainContentRoot().prepend(assignmentStatusPanel);
    } else {
      const root = findMainContentRoot();
      if (assignmentStatusPanel.parentElement !== root) root.prepend(assignmentStatusPanel);
    }

    const result = detectCurrentAssignmentSubmissionStatus();
    const storedRecord = await getStoredAssignmentRecordForCurrentPage();
    if (!skipUnknownRetry && shouldRetryUnknownAssignmentDetection(result, storedRecord)) {
      const key = getCanonicalMoocsUrl(locationRef.href);
      const retryCount = assignmentUnknownRetryCounts.get(key) || 0;
      if (retryCount < 4) {
        assignmentUnknownRetryCounts.set(key, retryCount + 1);
        renderAssignmentStatusPanelContent(
          {
            status: 'checking',
            confidence: 'low',
            evidence: 'ページ読み込み直後のため、提出状態の表示を待って再確認しています。',
            source: 'settling-recheck',
          },
          {
            checkedAt: new Date().toISOString(),
          },
        );
        scheduleAssignmentStatusPanelRecheck([700, 1600, 3200, 5200][retryCount] || 5200);
        return;
      }
    } else {
      assignmentUnknownRetryCounts.delete(getCanonicalMoocsUrl(locationRef.href));
    }
    const submittedLock = getTemporarySubmittedAssignmentRecord();
    if (submittedLock && isWeakAssignmentDetectionResult(result)) {
      renderAssignmentStatusPanelContent(createAssignmentDetectionResultFromRecord(submittedLock), submittedLock);
      return;
    }
    if (isHighConfidenceSubmittedRecord(storedRecord) && result.status !== 'submitted') {
      renderAssignmentStatusPanelContent(createAssignmentDetectionResultFromRecord(storedRecord), storedRecord);
      return;
    }

    const record = createAssignmentStatusRecordFromDetection(result);
    const savedRecord = await saveAssignmentStatusRecordIfChanged(record, { allowManualOverwrite });
    const displayResult = savedRecord && savedRecord !== record ? createAssignmentDetectionResultFromRecord(savedRecord) : result;
    renderAssignmentStatusPanelContent(displayResult, savedRecord || record);
    applyAssignmentTabStatusBadges();
    refreshLectureAssignmentSummaryFromStorage();
    if (showResultToast) {
      showToast(`再確認しました: ${getAssignmentStatusDisplayLabel(displayResult.status)}`);
    }
  }

  return {
    ensureAssignmentStatusPanelMounted,
    setAssignmentStatusManually,
    refreshAssignmentStatusFromManualButton,
    markAssignmentSubmittedFromMoocsAlert,
    markAssignmentPendingAfterSubmitAttempt,
    triggerDevSubmittedAssignmentAlert,
    isAssignmentSavedAlertMessage,
    getStoredAssignmentRecordForCurrentPage,
    createAssignmentStatusRecordFromDetection,
    saveAssignmentStatusRecordIfChanged,
    getTemporarySubmittedAssignmentRecord,
  };
}
