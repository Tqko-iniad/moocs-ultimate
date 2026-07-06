import {
  isExtensionContextInvalidated,
  runtimeAddMessageListener,
  runtimeGetURL,
  runtimeSendMessage,
  storageAddChangeListener,
} from '../shared/browserApi.js';
import { createMessage, MESSAGE_TYPES } from '../shared/messages.js';
import {
  getCourseOrder,
  getCoursePrefs,
  getAssignmentStatus,
  getAiSummaries,
  getMemos,
  getSettings,
  getAceTimetable,
  saveCourseOrder,
  saveCoursePrefs,
  saveAssignmentStatus,
  saveMemos,
  STORAGE_KEYS,
} from '../shared/storage.js';
import { createExternalLinksPanelController } from './externalLinksPanel.js';
import { createSlideResizeToolsController } from './slideResizeTools.js';
import { createSlidePositionRestoreController } from './slidePositionRestore.js';
import { createAccountSettingsLinkController } from './accountSettingsLink.js';
import { createGlobalDriveButtonController } from './globalDriveButton.js';
import { createPageMemoPanelController } from './pageMemoPanel.js';
import { createCourseToolsController } from './courseTools.js';
import { createUpcomingPanelController } from './upcomingPanel.js';
import { createAssignmentOverviewPanelController } from './assignmentOverviewPanel.js';
import { createLectureToolsPanelController } from './lectureToolsPanel.js';
import {
  renderLectureAssignmentMiniList as renderLectureAssignmentMiniListView,
  updateLectureAssignmentCheckStatus as updateLectureAssignmentCheckStatusView,
} from './lectureAssignmentMiniPanel.js';
import {
  createAiSummaryPanelElement,
  renderAiSummaryOutput as renderAiSummaryOutputView,
  resetAiSummaryPanelForSource as resetAiSummaryPanelForSourceView,
  setAiSummaryBusyState as setAiSummaryBusyStateView,
  setAiSummaryPanelStatus as setAiSummaryPanelStatusView,
  updateAiSummaryActionButtons as updateAiSummaryActionButtonsView,
  updateAiSummaryCacheStateView as updateAiSummaryCacheStateViewPanel,
  updateAiSummaryTokenEstimate as updateAiSummaryTokenEstimateView,
  setAiSummaryStaleState,
} from './aiSummaryPanelView.js';
import {
  createDownloadPanelElement,
  renderDownloadCandidateList as renderDownloadCandidateListView,
  renderDownloadQueueState as renderDownloadQueueStateView,
  setDownloadPanelStatus as setDownloadPanelStatusView,
} from './downloadPanelView.js';
import {
  createLectureAssignmentSummaryText,
  getLectureAssignmentSummaryState,
} from '../shared/assignmentStatus.js';
import {
  collectCourseLectureRouteLinksFromDocument,
  collectLecturePageRouteLinksFromDocument,
  dedupeRouteEntries,
  getCanonicalMoocsUrl,
  parseMoocsCourseRoute,
} from '../shared/moocsRoute.js';
import {
  collectDownloadCandidatesFromDocument,
  getDownloadNamingContext,
  getMoocsPageTitle,
  normalizeDownloadCandidateForRendering,
  sanitizePathPart,
} from '../shared/downloadCandidates.js';
import {
  SUBMISSION_ANSWER_SELECTOR,
  findAssignmentEvidenceLine,
  hasSubmissionFormInDocument,
} from '../shared/assignmentDetection.js';
import {
  createButton,
  downloadTextFileFromPage,
  reportContentError,
  showToast,
} from '../shared/domUtils.js';
import { createLectureAssignmentCollector } from './lectureAssignmentCollector.js';
import { createAssignmentTabBadgesController } from './assignmentTabBadges.js';
import { createAssignmentFrameInspection } from './assignmentFrameInspection.js';
import { createAssignmentStatusActionsController } from './assignmentStatusActions.js';
import { createTabClassifier } from './tabClassification.js';

const ROOT_ATTRIBUTE = 'data-um-content-mounted';
const BADGE_ID = 'um-status-badge';
const STYLE_ID = 'um-runtime-style';
const TAB_SELECTOR =
  '.nav-tabs a, .nav-pills a, .pagination a, .pagination button, .breadcrumb a, .content-header a, .content a[href]';

let currentSettings = null;
let scrollTopButton = null;
let tabRefreshTimer = 0;
let observer = null;
let pendingAssignmentSubmit = null;
let downloadPanel = null;
let downloadCandidateState = {
  entries: [],
  selectedIds: new Set(),
  scope: 'page',
  slidesFormat: '',
};
let downloadCandidateRefreshGeneration = 0;
const downloadDocumentCache = new Map();
let aiSummaryPanel = null;
let aiSummaryDraft = {
  title: '',
  sourceUrl: '',
  text: '',
  slideResults: [],
};
let aiSummaryBusy = false;
const slideTextExtractionCache = new Map();
let slideTextExtractionBusy = false;
let learningToolsRefreshTimer = 0;
let lastLearningToolsSignature = '';
let locationChangeListenerInstalled = false;

const MAX_LECTURE_PAGES = 60;
const MAX_COURSE_PAGES = 360;
const DOWNLOAD_FETCH_CONCURRENCY = 12;
const DOWNLOAD_DOCUMENT_CACHE_LIMIT = 500;
const PAGE_ALERT_MESSAGE_TYPE = 'ultimateMoocs:page.alert';

const tabClassifier = createTabClassifier({
  document,
  window,
  location,
  normalizeVisibleLabelText,
  isMoocsUltimateOwnedNode,
  fetchMoocsHtmlDocument,
});

const assignmentFrameInspection = createAssignmentFrameInspection({
  document,
  window,
  location,
  getAssignmentDetectionOptions,
});

const assignmentTabBadges = createAssignmentTabBadgesController({
  document,
  location,
  getCurrentSettings: () => currentSettings,
  getTabCanonicalUrl,
  isNumberPageTab: tabClassifier.isNumberPageTab,
  classifyNumberPageTab: tabClassifier.classifyNumberPageTab,
  isAttendanceTabKind: tabClassifier.isAttendanceTabKind,
});

const lectureToolsPanelController = createLectureToolsPanelController({
  document,
  findMountTarget: findLectureToolsMountTarget,
  onAssignmentCheck: () => {
    lectureAssignmentCollector.refreshCurrentLectureAssignmentCandidates().catch((error) => {
      if (isExtensionContextInvalidated(error)) return;
      reportContentError('[ultimateMoocs:assignment]', error);
      updateLectureAssignmentCheckStatus('確認に失敗しました', 'error');
      showToast(error?.message || 'この回の課題確認に失敗しました。');
    });
  },
});
const lectureAssignmentCollector = createLectureAssignmentCollector({
  document,
  location,
  isMoocsUltimateOwnedNode,
  normalizeVisibleLabelText,
  isNumberPageTab: tabClassifier.isNumberPageTab,
  classifyTab: tabClassifier.classifyTab,
  isAttendanceTabKind: tabClassifier.isAttendanceTabKind,
  getTabCanonicalUrl,
  isAttendanceDocument: tabClassifier.isAttendanceDocument,
  getAssignmentDetectionOptions,
  fetchMoocsHtmlDocument,
  runWithConcurrency,
  downloadFetchConcurrency: DOWNLOAD_FETCH_CONCURRENCY,
  shouldInspectAssignmentCandidateInSandboxedFrame: assignmentFrameInspection.shouldInspectAssignmentCandidateInSandboxedFrame,
  inspectAssignmentCandidateInSandboxedFrame: assignmentFrameInspection.inspectAssignmentCandidateInSandboxedFrame,
  syncCurrentAssignmentStatusFromDom,
  updateCheckStatus: updateLectureAssignmentCheckStatus,
  renderMiniList: renderLectureAssignmentMiniList,
  applyAssignmentTabStatusBadges: assignmentTabBadges.applyAssignmentTabStatusBadges,
});
const assignmentStatusActions = createAssignmentStatusActionsController({
  document,
  window,
  location,
  getCurrentSettings: () => currentSettings,
  isCurrentPageAssignmentLike,
  findMainContentRoot,
  getCurrentPageStorageKey,
  detectCurrentAssignmentSubmissionStatus,
  collectDeadlineCandidateLines,
  findUploadedAssignmentEvidence,
  normalizeVisibleLabelText,
  refreshLectureAssignmentSummaryFromStorage,
  runtimeGetURL,
  getPendingAssignmentSubmit: () => pendingAssignmentSubmit,
  setPendingAssignmentSubmit: (value) => { pendingAssignmentSubmit = value; },
  refreshCurrentLectureAssignmentCandidates: lectureAssignmentCollector.refreshCurrentLectureAssignmentCandidates,
  applyAssignmentTabStatusBadges: assignmentTabBadges.applyAssignmentTabStatusBadges,
});
let bootStarted = false;
let tabColoringGeneration = 0;

const externalLinksPanelController = createExternalLinksPanelController({
  document,
  location,
  getCurrentSettings: () => currentSettings,
  isOwnedNode: isMoocsUltimateOwnedNode,
});
const slideResizeToolsController = createSlideResizeToolsController({
  document,
  getCurrentSettings: () => currentSettings,
});
const slidePositionRestoreController = createSlidePositionRestoreController({
  document,
});
const accountSettingsLinkController = createAccountSettingsLinkController({
  document,
  location,
  window,
  openOptions: () => runtimeSendMessage(createMessage(MESSAGE_TYPES.optionsOpen)),
  getOptionsUrl: () => runtimeGetURL('options/index.html'),
  isContextInvalidated: isExtensionContextInvalidated,
});
const globalDriveButtonController = createGlobalDriveButtonController({
  document,
  isOwnedNode: isMoocsUltimateOwnedNode,
});
const pageMemoPanelController = createPageMemoPanelController({
  document,
  location,
  getCurrentSettings: () => currentSettings,
  getMemos,
  saveMemos,
  getPageKey: () => getCurrentPageStorageKey(),
  createButton,
  downloadTextFile: downloadTextFileFromPage,
});
const courseToolsController = createCourseToolsController({
  document,
  location,
  window,
  getCurrentSettings: () => currentSettings,
  getCourseOrder,
  getCoursePrefs,
  saveCourseOrder,
  saveCoursePrefs,
  createButton,
  isOwnedNode: isMoocsUltimateOwnedNode,
  onRefresh: () => ensureGlobalDriveButtonMounted(),
  onError: reportContentError,
});
const upcomingPanelController = createUpcomingPanelController({
  document,
  getCurrentSettings: () => currentSettings,
  getAceTimetable,
});
const assignmentOverviewPanelController = createAssignmentOverviewPanelController({
  document,
  location,
  getCurrentSettings: () => currentSettings,
  getAssignmentStatus,
});

function safeCssUrl(url) {
  const trimmedUrl = String(url || '').trim();
  return trimmedUrl ? `url(${JSON.stringify(trimmedUrl)})` : 'none';
}

function ensureRuntimeStyle() {
  let style = document.querySelector(`#${STYLE_ID}`);
  if (!style) {
    style = document.createElement('style');
    style.id = STYLE_ID;
    document.documentElement.append(style);
  }

  const appearance = currentSettings?.appearance;
  const rawOpacity = Number(appearance?.contentOpacity ?? 0.86);
  const opacity = Number.isFinite(rawOpacity) ? rawOpacity : 0.86;
  const glassEnabled = Boolean(appearance?.enableGlassmorphism);
  const surfaceOpacity = glassEnabled
    ? Math.max(0.34, Math.min(0.52, opacity - 0.4))
    : Math.max(0.9, Math.min(1, opacity));
  const glassOpacity = glassEnabled ? Math.max(0.28, Math.min(0.46, opacity - 0.48)) : surfaceOpacity;
  const backgroundColor = appearance?.backgroundColor || '#f8fafc';
  const backgroundImage = safeCssUrl(appearance?.backgroundImageUrl);

  style.textContent = `
    :root {
      --um-content-opacity: ${opacity};
      --um-surface-opacity: ${surfaceOpacity};
      --um-glass-opacity: ${glassOpacity};
      --um-glass-text-color: ${glassEnabled ? '#f8fafc' : '#0f172a'};
      --um-glass-muted-color: ${glassEnabled ? 'rgba(226, 232, 240, 0.82)' : '#475569'};
      --um-glass-border-color: ${glassEnabled ? 'rgba(148, 163, 184, 0.22)' : 'rgba(148, 163, 184, 0.28)'};
      --um-background-color: ${backgroundColor};
      --um-background-image: ${backgroundImage};
    }
    html[data-um-background-active="true"],
    html[data-um-background-active="true"] body {
      background-color: var(--um-background-color) !important;
      background-image: var(--um-background-image) !important;
      background-attachment: fixed !important;
      background-position: center center !important;
      background-repeat: no-repeat !important;
      background-size: cover !important;
    }
    html[data-um-background-active="true"] body {
      min-height: 100vh !important;
    }
    html[data-um-background-active="true"] .wrapper {
      background: transparent !important;
    }
    html[data-um-background-active="true"] .content-wrapper,
    html[data-um-background-active="true"] .right-side {
      background: transparent !important;
    }
    html[data-um-background-active="true"] .content {
      background-color: transparent !important;
    }
    html[data-um-background-active="true"] .content-header,
    html[data-um-background-active="true"] .box,
    html[data-um-background-active="true"] .box-body,
    html[data-um-background-active="true"] .panel,
    html[data-um-background-active="true"] .panel-body,
    html[data-um-background-active="true"] .well,
    html[data-um-background-active="true"] .list-group-item,
    html[data-um-background-active="true"] .callout,
    html[data-um-background-active="true"] .nav-tabs-custom,
    html[data-um-background-active="true"] .table,
    html[data-um-background-active="true"] .breadcrumb {
      background-color: rgba(255, 255, 255, var(--um-surface-opacity)) !important;
      backdrop-filter: blur(14px) saturate(128%);
      -webkit-backdrop-filter: blur(14px) saturate(128%);
    }
    html[data-um-background-active="true"] body::before {
      position: fixed;
      inset: 0;
      z-index: 0;
      pointer-events: none;
      background: rgba(2, 6, 23, 0.24);
      backdrop-filter: blur(0.5px) saturate(96%);
      -webkit-backdrop-filter: blur(0.5px) saturate(96%);
      content: "";
    }
    html[data-um-background-active="true"] .wrapper,
    html[data-um-background-active="true"] .content-wrapper {
      position: relative;
      z-index: 1;
    }
    html[data-um-background-active="true"] .main-header {
      position: relative;
      z-index: 1030;
    }
    html[data-um-background-active="true"] .main-sidebar {
      z-index: 810;
    }
    html[data-um-glassmorphism="true"] .box,
    html[data-um-glassmorphism="true"] .box-body,
    html[data-um-glassmorphism="true"] .panel,
    html[data-um-glassmorphism="true"] .panel-body,
    html[data-um-glassmorphism="true"] .well,
    html[data-um-glassmorphism="true"] .list-group-item,
    html[data-um-glassmorphism="true"] .content-header,
    html[data-um-glassmorphism="true"] .callout,
    html[data-um-glassmorphism="true"] .nav-tabs-custom,
    html[data-um-glassmorphism="true"] .breadcrumb,
    html[data-um-glassmorphism="true"] .pagination > li > a,
    html[data-um-glassmorphism="true"] .pagination > li > span,
    html[data-um-glassmorphism="true"] pre,
    html[data-um-glassmorphism="true"] code,
    html[data-um-glassmorphism="true"] .main-header .navbar,
    html[data-um-glassmorphism="true"] .main-sidebar {
      background-color: rgba(2, 6, 23, var(--um-glass-opacity)) !important;
      color: var(--um-glass-text-color) !important;
      border-color: var(--um-glass-border-color) !important;
      backdrop-filter: blur(8px) saturate(112%);
      -webkit-backdrop-filter: blur(8px) saturate(112%);
    }
    html[data-um-glassmorphism="true"] .box,
    html[data-um-glassmorphism="true"] .panel,
    html[data-um-glassmorphism="true"] .well {
      border-color: rgba(148, 163, 184, 0.28) !important;
      box-shadow: 0 12px 32px rgba(2, 6, 23, 0.16) !important;
    }
    html[data-um-glassmorphism="true"] .main-header .logo {
      position: relative !important;
      z-index: 1050 !important;
      background: rgba(2, 6, 23, 0.22) !important;
      color: #ffffff !important;
      opacity: 1 !important;
      pointer-events: auto !important;
      filter: none !important;
      backdrop-filter: blur(6px) saturate(108%) !important;
      -webkit-backdrop-filter: blur(6px) saturate(108%) !important;
    }
    html[data-um-glassmorphism="true"] .main-header .logo:hover {
      background: rgba(2, 6, 23, 0.32) !important;
    }
    html[data-um-glassmorphism="true"] .main-header .logo img {
      visibility: visible !important;
      opacity: 1 !important;
      pointer-events: auto !important;
      filter: none !important;
    }
    html[data-um-glassmorphism="true"] .box a,
    html[data-um-glassmorphism="true"] .panel a,
    html[data-um-glassmorphism="true"] .well a,
    html[data-um-glassmorphism="true"] .content-header a,
    html[data-um-glassmorphism="true"] .breadcrumb a,
    html[data-um-glassmorphism="true"] .list-group-item a {
      color: #bae6fd !important;
    }
    html[data-um-glassmorphism="true"] .text-muted,
    html[data-um-glassmorphism="true"] .help-block,
    html[data-um-glassmorphism="true"] small,
    html[data-um-glassmorphism="true"] h1,
    html[data-um-glassmorphism="true"] h2,
    html[data-um-glassmorphism="true"] h3,
    html[data-um-glassmorphism="true"] h4,
    html[data-um-glassmorphism="true"] .breadcrumb,
    html[data-um-glassmorphism="true"] .breadcrumb li,
    html[data-um-glassmorphism="true"] .breadcrumb li::before {
      color: var(--um-glass-muted-color) !important;
    }
    html[data-um-glassmorphism="true"] h1,
    html[data-um-glassmorphism="true"] h2,
    html[data-um-glassmorphism="true"] h3,
    html[data-um-glassmorphism="true"] h4,
    html[data-um-glassmorphism="true"] .box-title {
      color: var(--um-glass-text-color) !important;
    }
    html[data-um-glassmorphism="true"] .btn:not([data-um-module]):not([data-um-module] .btn):not([data-um-owned="true"]),
    html[data-um-glassmorphism="true"] button:not(.um-scroll-top-button):not(.um-settings-link-button):not([data-um-module]):not([data-um-module] button):not([data-um-owned="true"]) {
      border-color: rgba(148, 163, 184, 0.28) !important;
      color: #ffffff !important;
    }
    html[data-um-glassmorphism="true"] .btn-default {
      background-color: rgba(15, 23, 42, 0.48) !important;
      color: var(--um-glass-muted-color) !important;
    }
    html[data-um-glassmorphism="true"] .pagination > li > a,
    html[data-um-glassmorphism="true"] .pagination > li > span {
      color: var(--um-glass-text-color) !important;
    }
    html[data-um-glassmorphism="true"] .box p,
    html[data-um-glassmorphism="true"] .panel p,
    html[data-um-glassmorphism="true"] .well p,
    html[data-um-glassmorphism="true"] .box li,
    html[data-um-glassmorphism="true"] .panel li,
    html[data-um-glassmorphism="true"] .well li,
    html[data-um-glassmorphism="true"] .box label,
    html[data-um-glassmorphism="true"] .panel label,
    html[data-um-glassmorphism="true"] .well label {
      color: var(--um-glass-text-color) !important;
    }
    html[data-um-glassmorphism="true"] .pagination > .active > a,
    html[data-um-glassmorphism="true"] .pagination > .active > span {
      background-color: rgba(37, 99, 235, 0.78) !important;
      border-color: rgba(147, 197, 253, 0.55) !important;
      color: #ffffff !important;
    }
    html[data-um-glassmorphism="true"] .pagination > li > a.um-tab-colored,
    html[data-um-glassmorphism="true"] .pagination > li > span.um-tab-colored {
      border-color: color-mix(in srgb, var(--um-tab-color) 42%, rgba(148, 163, 184, 0.28)) !important;
      border-bottom: 4px solid color-mix(in srgb, var(--um-tab-color) 78%, #2563eb) !important;
      background: color-mix(in srgb, var(--um-tab-color) 62%, rgba(255, 255, 255, 0.9)) !important;
      color: #172033 !important;
      font-weight: 850 !important;
      transition: none !important;
    }
    html[data-um-glassmorphism="true"] .pagination > li:first-child > a.um-tab-colored,
    html[data-um-glassmorphism="true"] .pagination > li:first-child > span.um-tab-colored,
    html[data-um-glassmorphism="true"] .pagination > li:last-child > a.um-tab-colored,
    html[data-um-glassmorphism="true"] .pagination > li:last-child > span.um-tab-colored {
      border-color: rgba(148, 163, 184, 0.28) !important;
      border-bottom: 1px solid rgba(148, 163, 184, 0.28) !important;
      background: rgba(2, 6, 23, var(--um-glass-opacity)) !important;
      color: var(--um-glass-muted-color) !important;
    }
    html[data-um-glassmorphism="true"] .pagination > li > a.um-tab-colored:hover,
    html[data-um-glassmorphism="true"] .pagination > li > span.um-tab-colored:hover,
    html[data-um-glassmorphism="true"] .pagination > li > a.um-tab-colored:focus,
    html[data-um-glassmorphism="true"] .pagination > li > span.um-tab-colored:focus {
      border-color: color-mix(in srgb, var(--um-tab-color) 42%, rgba(148, 163, 184, 0.28)) !important;
      border-bottom-color: color-mix(in srgb, var(--um-tab-color) 78%, #2563eb) !important;
      background: color-mix(in srgb, var(--um-tab-color) 62%, rgba(255, 255, 255, 0.9)) !important;
      color: #172033 !important;
    }
    html[data-um-glassmorphism="true"] .pagination > .active > a.um-tab-colored,
    html[data-um-glassmorphism="true"] .pagination > .active > span.um-tab-colored {
      background: color-mix(in srgb, var(--um-tab-color) 72%, rgba(255, 255, 255, 0.82)) !important;
      color: #ffffff !important;
    }
    html[data-um-glassmorphism="true"] input,
    html[data-um-glassmorphism="true"] textarea,
    html[data-um-glassmorphism="true"] select,
    html[data-um-glassmorphism="true"] pre {
      background-color: rgba(15, 23, 42, 0.42) !important;
      border-color: rgba(148, 163, 184, 0.28) !important;
      color: var(--um-glass-text-color) !important;
    }
    html[data-um-sticky-header="true"] .main-header {
      position: sticky !important;
      top: 0 !important;
      z-index: 1030 !important;
    }
    html[data-um-sticky-sidebar="true"] .main-sidebar {
      position: sticky !important;
      top: 0 !important;
      max-height: 100vh !important;
      overflow: auto !important;
    }
  `;
}

function countGraphemes(value) {
  const text = String(value || '');
  if (globalThis.Intl?.Segmenter) {
    return [...new Intl.Segmenter('ja', { granularity: 'grapheme' }).segment(text)].length;
  }
  return [...text].length;
}

function isEditableTarget(target) {
  if (!(target instanceof Element)) return false;
  return Boolean(
    target.closest(
      'input, textarea, select, [contenteditable="true"], [contenteditable=""], [role="textbox"]',
    ),
  );
}

function mountStatusBadge() {
  let badge = document.querySelector(`#${BADGE_ID}`);
  if (!badge) {
    badge = document.createElement('div');
    badge.id = BADGE_ID;
    badge.className = 'um-status-badge';
    badge.dataset.umModule = 'content-runtime';
    badge.textContent = 'MOOCs Ultimate';
    badge.title = 'MOOCs Ultimate content script is running.';
    document.body.append(badge);
  }

  badge.hidden = !currentSettings?.debug?.showInternalStatus;
}

function ensureScrollTopButton() {
  const enabled = Boolean(currentSettings?.appearance?.showScrollTopButton);

  if (!enabled) {
    scrollTopButton?.remove();
    scrollTopButton = null;
    return;
  }

  if (!scrollTopButton) {
    scrollTopButton = document.createElement('button');
    scrollTopButton.type = 'button';
    scrollTopButton.className = 'um-scroll-top-button';
    scrollTopButton.dataset.umOwned = 'true';
    scrollTopButton.textContent = 'Top';
    scrollTopButton.addEventListener('click', () => {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
    document.body.append(scrollTopButton);
  }
}

function updateTextarea(textarea) {
  const counterEnabled = Boolean(currentSettings?.inputHelper?.enableTextareaCounter);
  const autoResizeEnabled = Boolean(currentSettings?.inputHelper?.enableTextareaAutoResize);
  const counter = textarea.parentElement?.querySelector(
    `.um-textarea-counter[data-um-for="${textarea.dataset.umTextareaId}"]`,
  );

  if (counter) {
    counter.textContent = `${countGraphemes(textarea.value)} 文字`;
    counter.hidden = !counterEnabled;
  }

  if (autoResizeEnabled) {
    const computed = getComputedStyle(textarea);
    const maxHeight = Math.max(window.innerHeight * 0.65, 240);
    textarea.style.overflowY = textarea.scrollHeight > maxHeight ? 'auto' : 'hidden';
    textarea.style.height = 'auto';
    textarea.style.height = `${Math.min(textarea.scrollHeight + 2, maxHeight)}px`;
    textarea.style.minHeight = computed.minHeight || '72px';
  } else {
    textarea.style.removeProperty('overflow-y');
    textarea.style.removeProperty('height');
  }
}

function enhanceTextareas() {
  const counterEnabled = Boolean(currentSettings?.inputHelper?.enableTextareaCounter);
  const autoResizeEnabled = Boolean(currentSettings?.inputHelper?.enableTextareaAutoResize);

  for (const textarea of document.querySelectorAll('textarea')) {
    if (!counterEnabled && !autoResizeEnabled) {
      textarea.parentElement
        ?.querySelector(`.um-textarea-counter[data-um-for="${textarea.dataset.umTextareaId}"]`)
        ?.remove();
      textarea.dataset.umTextareaEnhanced = 'false';
      textarea.style.removeProperty('overflow-y');
      textarea.style.removeProperty('height');
      continue;
    }

    if (!textarea.dataset.umTextareaId) {
      textarea.dataset.umTextareaId = `um-textarea-${Date.now()}-${Math.random()
        .toString(36)
        .slice(2)}`;
    }

    if (textarea.dataset.umTextareaEnhanced !== 'true') {
      textarea.dataset.umTextareaEnhanced = 'true';
      textarea.addEventListener('input', () => updateTextarea(textarea));
    }

    if (counterEnabled) {
      const selector = `.um-textarea-counter[data-um-for="${textarea.dataset.umTextareaId}"]`;
      if (!textarea.parentElement?.querySelector(selector)) {
        const counter = document.createElement('span');
        counter.className = 'um-textarea-counter';
        counter.dataset.umOwned = 'true';
        counter.dataset.umFor = textarea.dataset.umTextareaId;
        textarea.insertAdjacentElement('afterend', counter);
      }
    }

    updateTextarea(textarea);
  }
}

function clearTabColoring() {
  for (const link of document.querySelectorAll('.um-tab-colored')) {
    link.classList.remove('um-tab-colored', 'um-tab-mode-full', 'um-tab-mode-badge', 'um-tab-mode-icon');
    link.removeAttribute('data-um-tab-kind');
    link.style.removeProperty('--um-tab-color');
  }
}

function applyTabColor(link, kind, mode, colors) {
  if (!kind) return;
  link.classList.add('um-tab-colored', `um-tab-mode-${mode}`);
  link.dataset.umTabKind = kind;
  link.style.setProperty('--um-tab-color', colors[kind] || '#2563eb');
}

async function applyTabColoring() {
  const generation = ++tabColoringGeneration;

  if (!currentSettings?.navigation?.enableTabColoring) {
    clearTabColoring();
    return;
  }

  const mode = currentSettings.navigation.tabColorMode || 'badge';
  const colors = currentSettings.navigation.colors || {};
  let assignmentLookup = new Map();
  if (currentSettings?.assignments?.enableSubmissionCheck) {
    try {
      assignmentLookup = assignmentTabBadges.buildAssignmentStatusLookup(await getAssignmentStatus());
    } catch (error) {
      if (!isExtensionContextInvalidated(error)) {
        reportContentError('[ultimateMoocs:tabs] failed to load assignment colors', error);
      }
    }
  }

  const links = [...document.querySelectorAll(TAB_SELECTOR)].filter((link) => {
    if (!tabClassifier.isTopNavigationCandidate(link)) return false;
    return !link.closest('.pagination') || tabClassifier.isNumberPageTab(link);
  });
  const decisions = await Promise.all(links.map(async (link) => {
    const numberTab = tabClassifier.isNumberPageTab(link);
    const nativeKind = numberTab ? await tabClassifier.classifyNumberPageTab(link) : tabClassifier.classifyTab(link);
    const assignmentRecord = numberTab
      ? assignmentLookup.get(getTabCanonicalUrl(link))
      : null;
    const kind = !tabClassifier.isAttendanceTabKind(nativeKind) && assignmentRecord && assignmentTabBadges.isAssignmentTabStatusVisible(assignmentRecord.status)
      ? 'assignment'
      : nativeKind;
    return { link, kind };
  }));

  // A newer refresh owns the final paint. Keeping the previous colors until all
  // classifications finish prevents visible clear/repaint flicker.
  if (generation !== tabColoringGeneration || !currentSettings?.navigation?.enableTabColoring) return;
  clearTabColoring();
  for (const { link, kind } of decisions) applyTabColor(link, kind, mode, colors);
}

function getTabCanonicalUrl(link) {
  const href = link.getAttribute('href');
  if (!href || href === '#') return getCanonicalMoocsUrl();
  try {
    const url = new URL(href, location.href);
    if (url.origin !== location.origin) return '';
    return getCanonicalMoocsUrl(url.href);
  } catch {
    return '';
  }
}

function scheduleTabRefresh() {
  if (tabRefreshTimer) return;
  tabRefreshTimer = window.setTimeout(() => {
    tabRefreshTimer = 0;
    applyTabColoring();
    assignmentTabBadges.applyAssignmentTabStatusBadges();
    enhanceTextareas();
  }, 120);
}

function scheduleLearningToolsRefresh() {
  if (learningToolsRefreshTimer) return;
  learningToolsRefreshTimer = window.setTimeout(() => {
    learningToolsRefreshTimer = 0;
    const signature = createLearningToolsRefreshSignature();
    if (signature === lastLearningToolsSignature) return;
    lastLearningToolsSignature = signature;
    applyLearningToolFeatures();
  }, 220);
}

function schedulePostLoadAssignmentDetection() {
  for (const delay of [600, 1600, 3400]) {
    window.setTimeout(() => {
      const signature = createLearningToolsRefreshSignature();
      if (signature !== lastLearningToolsSignature) {
        lastLearningToolsSignature = signature;
        applyLearningToolFeatures();
        return;
      }
      if (currentSettings?.assignments?.enableSubmissionCheck && hasCurrentPageSubmissionForm()) {
        assignmentStatusActions.ensureAssignmentStatusPanelMounted().catch((error) => reportContentError('[ultimateMoocs:assignment]', error));
        refreshLectureAssignmentSummaryFromStorage();
      }
    }, delay);
  }
}

function setupLocationChangeListener() {
  if (locationChangeListenerInstalled) return;
  locationChangeListenerInstalled = true;

  const notify = () => {
    scheduleLearningToolsRefresh();
    schedulePostLoadAssignmentDetection();
  };
  for (const method of ['pushState', 'replaceState']) {
    const original = history[method];
    if (typeof original !== 'function') continue;
    history[method] = function patchedHistoryMethod(...args) {
      const result = original.apply(this, args);
      window.setTimeout(notify, 0);
      return result;
    };
  }
  window.addEventListener('popstate', notify);
}

function parseShortcut(shortcutText) {
  const isMac = /Mac|iPhone|iPad|iPod/i.test(navigator.platform);
  const parts = String(shortcutText || '')
    .split('+')
    .map((part) => part.trim().toLowerCase())
    .filter(Boolean);

  return {
    key: parts.at(-1) || '',
    ctrl: parts.includes('ctrl') || parts.includes('control') || (parts.includes('mod') && !isMac),
    meta: parts.includes('meta') || parts.includes('cmd') || parts.includes('command') || (parts.includes('mod') && isMac),
    alt: parts.includes('alt') || parts.includes('option'),
    shift: parts.includes('shift'),
  };
}

function eventMatchesShortcut(event, shortcutText) {
  const shortcut = parseShortcut(shortcutText);
  if (!shortcut.key) return false;
  const key = event.key.toLowerCase();
  const code = event.code.toLowerCase();
  const wanted = shortcut.key.toLowerCase();

  return (
    (key === wanted || code === wanted) &&
    event.ctrlKey === shortcut.ctrl &&
    event.metaKey === shortcut.meta &&
    event.altKey === shortcut.alt &&
    event.shiftKey === shortcut.shift
  );
}

function isScreenshotShortcut(event) {
  const isMac = /Mac|iPhone|iPad|iPod/i.test(navigator.platform);
  const primaryModifier = isMac ? event.metaKey : event.ctrlKey;
  return (
    primaryModifier &&
    event.shiftKey &&
    !event.altKey &&
    event.key.toLowerCase() === 's'
  );
}

function getNavigationTabs() {
  const links = [...document.querySelectorAll(TAB_SELECTOR)].filter((link) => {
    if (!tabClassifier.isTopNavigationCandidate(link)) return false;
    if (link.matches('[disabled], [aria-disabled="true"]')) return false;
    return Boolean(link.href || link.tagName === 'BUTTON');
  });

  return [...new Set(links)];
}

function isActiveTab(link) {
  const href = link.href ? new URL(link.href, location.href).href : '';
  const current = new URL(location.href).href;
  return Boolean(
    link.closest('.active') ||
      link.getAttribute('aria-current') === 'page' ||
      (href && href.replace(/#.*$/, '') === current.replace(/#.*$/, '')),
  );
}

function moveTab(direction) {
  const tabs = getNavigationTabs();
  if (tabs.length < 2) return false;

  const activeIndex = Math.max(0, tabs.findIndex(isActiveTab));
  const nextIndex = activeIndex + direction;
  const next = tabs[nextIndex];
  if (!next) return false;

  next.click();
  return true;
}

function handleKeydown(event) {
  if (isEditableTarget(event.target)) return;

  if (currentSettings?.downloads?.enableScreenshotShortcut && isScreenshotShortcut(event)) {
    event.preventDefault();
    event.stopPropagation();
    captureVisibleScreenshot().catch((error) => {
      if (!isExtensionContextInvalidated(error)) {
        setDownloadPanelStatus(error?.message || 'スクリーンショット処理に失敗しました。');
        showToast(error?.message || 'スクリーンショット処理に失敗しました。');
      }
    });
    return;
  }

  const navigation = currentSettings?.navigation;
  if (!navigation) return;

  if (eventMatchesShortcut(event, navigation.shortcutPrevious)) {
    if (moveTab(-1)) event.preventDefault();
  } else if (eventMatchesShortcut(event, navigation.shortcutNext)) {
    if (moveTab(1)) event.preventDefault();
  }
}

async function captureVisibleScreenshot() {
  const action = currentSettings?.downloads?.screenshotShortcutAction === 'clipboard' ? 'clipboard' : 'download';
  const response = await runtimeSendMessage(
    createMessage(MESSAGE_TYPES.screenshotCapture, {
      action,
      title: document.title,
      href: location.href,
    }),
  );
  if (!response?.ok) {
    throw new Error(response?.error || 'スクリーンショットを保存できませんでした。');
  }

  if (action === 'clipboard') {
    if (response.payload?.skipped) return;
    if (!response.payload?.copied) {
      showScreenshotCopyDialog(response.payload?.dataUrl, response.payload?.error);
      return;
    }
    showToast('スクリーンショットをクリップボードにコピーしました。');
    return;
  }

  showToast('スクリーンショットを保存しました。');
  setDownloadPanelStatus(`スクリーンショットを保存しました: ${response.payload?.filename || ''}`);
}

function showScreenshotCopyDialog(dataUrl, errorMessage = '') {
  const oldDialog = document.querySelector('.um-screenshot-dialog');
  oldDialog?.remove();

  const dialog = document.createElement('section');
  dialog.className = 'um-screenshot-dialog';
  dialog.dataset.umModule = 'screenshot-dialog';
  dialog.tabIndex = -1;

  const title = document.createElement('strong');
  title.textContent = 'スクリーンショットをコピー';

  const description = document.createElement('p');
  description.textContent = errorMessage
    ? `コピーの準備ができました。${errorMessage}`
    : '下のボタンからクリップボードにコピーできます。';

  const preview = document.createElement('img');
  preview.alt = 'スクリーンショットプレビュー';
  preview.src = dataUrl || '';

  const actions = document.createElement('div');
  actions.className = 'um-screenshot-actions';

  const copyButton = document.createElement('button');
  copyButton.type = 'button';
  copyButton.textContent = 'クリップボードにコピー';
  copyButton.addEventListener('click', async () => {
    try {
      window.focus();
      await writePngDataUrlToClipboard(dataUrl);
      dialog.remove();
      showToast('スクリーンショットをクリップボードにコピーしました。');
    } catch (error) {
      description.textContent = `コピー失敗: ${error?.message || 'クリップボードにコピーできませんでした。'}`;
    }
  });

  const openButton = document.createElement('button');
  openButton.type = 'button';
  openButton.textContent = '画像を開く';
  openButton.addEventListener('click', () => {
    if (dataUrl) window.open(dataUrl, '_blank', 'noopener,noreferrer');
  });

  const closeButton = document.createElement('button');
  closeButton.type = 'button';
  closeButton.textContent = '閉じる';
  closeButton.addEventListener('click', () => dialog.remove());

  actions.append(copyButton, openButton, closeButton);
  dialog.append(title, description);
  if (dataUrl) dialog.append(preview);
  dialog.append(actions);
  document.body.append(dialog);
  dialog.focus({ preventScroll: true });
  copyButton.focus({ preventScroll: true });
}

function setupRuntimeMessageListener() {
  runtimeAddMessageListener((message, _sender, sendResponse) => {
    if (message?.type === 'ultimateMoocs:content.probe') {
      sendResponse?.({
        ok: true,
        ready: document.documentElement.getAttribute(ROOT_ATTRIBUTE) === 'true',
      });
      return true;
    }
    if (message?.type !== MESSAGE_TYPES.screenshotShowCopyDialog) return undefined;
    showScreenshotCopyDialog(message.payload?.dataUrl, message.payload?.error);
    return undefined;
  });
}

function setupPageAlertListener() {
  const handlePageAlert = (data) => {
    if (!data || data.source !== 'ultimateMoocs:page' || data.type !== PAGE_ALERT_MESSAGE_TYPE) return;
    if (!assignmentStatusActions.isAssignmentSavedAlertMessage(data.message)) return;
    assignmentStatusActions.markAssignmentSubmittedFromMoocsAlert(data.message, data.capturedAt)
      .catch((error) => reportContentError('[ultimateMoocs:assignment] alert handling failed', error));
  };

  window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    if (event.origin !== location.origin) return;
    handlePageAlert(event.data);
  });

  window.addEventListener('ultimateMoocs:page-alert', (event) => {
    handlePageAlert(event.detail);
  });
}

function injectPageAlertHook() {
  if (document.documentElement.dataset.umAlertHookInjected === 'true') return;
  document.documentElement.dataset.umAlertHookInjected = 'true';
  try {
    const script = document.createElement('script');
    script.src = runtimeGetURL('page/alert-hook.js');
    script.async = false;
    script.dataset.umModule = 'alert-hook';
    script.addEventListener('load', () => script.remove());
    script.addEventListener('error', () => script.remove());
    (document.head || document.documentElement).append(script);
  } catch (error) {
    reportContentError('[ultimateMoocs:assignment] alert hook injection failed', error);
  }
}

async function writePngDataUrlToClipboard(dataUrl) {
  if (!dataUrl) {
    throw new Error('スクリーンショット画像を取得できませんでした。');
  }
  if (!navigator.clipboard?.write || typeof ClipboardItem === 'undefined') {
    throw new Error('このChromeでは画像のクリップボードコピーに対応していません。');
  }

  const blob = await getClipboardReadyPngBlob(dataUrl);
  await writeBlobToClipboard(blob);
}

async function writeBlobToClipboard(blob) {
  if (blob.type !== 'image/png') {
    throw new Error('PNG画像としてコピーできませんでした。');
  }

  try {
    await navigator.clipboard.write([
      new ClipboardItem({
        'image/png': blob,
      }),
    ]);
    return;
  } catch (firstError) {
    try {
      await navigator.clipboard.write([
        new ClipboardItem({
          'image/png': Promise.resolve(blob),
        }),
      ]);
      return;
    } catch {
      throw firstError;
    }
  }
}

async function getClipboardReadyPngBlob(dataUrl) {
  const response = await fetch(dataUrl);
  const blob = await response.blob();
  if (blob.type === 'image/png') {
    try {
      return await rasterizePngBlob(blob);
    } catch {
      return blob;
    }
  }
  return blob;
}

async function rasterizePngBlob(blob) {
  const bitmap = await createImageBitmap(blob);
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const context = canvas.getContext('2d');
  context.drawImage(bitmap, 0, 0);
  bitmap.close?.();
  return new Promise((resolve, reject) => {
    canvas.toBlob((nextBlob) => {
      if (nextBlob) {
        resolve(nextBlob);
      } else {
        reject(new Error('PNG画像をクリップボード用に変換できませんでした。'));
      }
    }, 'image/png');
  });
}

function setupReloadAfterSubmit() {
  const rememberSubmitAttempt = (event) => {
    if (!currentSettings?.assignments?.enableSubmissionCheck) return;
    if (!isCurrentPageAssignmentLike()) return;
    const target = event.target instanceof Element ? event.target : null;
    if (target && isMoocsUltimateOwnedNode(target)) return;
    pendingAssignmentSubmit = {
      url: getCanonicalMoocsUrl(),
      attemptedAt: new Date().toISOString(),
    };
  };

  document.addEventListener(
    'submit',
    (event) => {
      rememberSubmitAttempt(event);
      window.setTimeout(() => {
        if (!event.defaultPrevented) {
          if (assignmentStatusActions.getTemporarySubmittedAssignmentRecord()) return;
          assignmentStatusActions.markAssignmentPendingAfterSubmitAttempt()
            .catch((error) => reportContentError('[ultimateMoocs:assignment]', error));
        }
      }, 1800);
      if (!currentSettings?.inputHelper?.reloadAfterSubmit) return;
      window.setTimeout(() => {
        if (!event.defaultPrevented) {
          location.reload();
        }
      }, 1200);
    },
    false,
  );

  document.addEventListener(
    'click',
    (event) => {
      const target = event.target instanceof Element ? event.target.closest('button, input[type="submit"], input[type="button"], a') : null;
      if (!target || isMoocsUltimateOwnedNode(target)) return;
      const label = normalizeVisibleLabelText(target.textContent || target.value || target.getAttribute('aria-label') || '');
      if (!/提出|送信|回答|submit|turn in/i.test(label)) return;
      rememberSubmitAttempt(event);
      window.setTimeout(() => {
        if (assignmentStatusActions.getTemporarySubmittedAssignmentRecord()) return;
        assignmentStatusActions.markAssignmentPendingAfterSubmitAttempt()
          .catch((error) => reportContentError('[ultimateMoocs:assignment]', error));
      }, 1800);
    },
    true,
  );
}

function getCurrentPageStorageKey() {
  return `${location.origin}${location.pathname}${location.search}`;
}

function createLearningToolsRefreshSignature() {
  const heading =
    document.querySelector('.content-header h1, .content-header h2, h1, h2')?.textContent?.trim() || '';
  const answerInputCount = document.querySelectorAll(
    SUBMISSION_ANSWER_SELECTOR,
  ).length;
  const submitControlCount = [...document.querySelectorAll('button, input[type="submit"], input[type="button"], a.btn')]
    .filter((node) => !isMoocsUltimateOwnedNode(node))
    .filter((node) => /提出|送信|回答|submit|turn in/i.test(node.textContent || node.value || node.getAttribute('aria-label') || ''))
    .length;
  return [getCanonicalMoocsUrl(), document.title, heading, answerInputCount, submitControlCount].join('|');
}

function isMoocsUltimateOwnedNode(node) {
  return Boolean(node?.closest?.('[data-um-module], [data-um-owned="true"]'));
}

function normalizeVisibleLabelText(value) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim();
}

function findLectureToolsMountTarget() {
  return (
    document.querySelector('.content-wrapper .content') ||
    document.querySelector('.content-wrapper') ||
    document.body
  );
}

function ensureLectureToolsPanel() {
  return lectureToolsPanelController.ensurePanel();
}

function findLectureToolPane(key) {
  return lectureToolsPanelController.findPane(key);
}

function setActiveLectureToolPane(key) {
  lectureToolsPanelController.setActivePane(key);
}

function updateLectureToolTab(key, label, enabled = true) {
  lectureToolsPanelController.updateTab(key, label, enabled);
}

function updateLectureToolTabStatus(key, statusText = '', statusState = '') {
  lectureToolsPanelController.updateTabStatus(key, statusText, statusState);
}

function updateLectureAssignmentCheckStatus(text, state = 'idle') {
  updateLectureAssignmentCheckStatusView(lectureToolsPanelController.getPanel(), text, state);
}

function renderLectureAssignmentMiniList(records) {
  renderLectureAssignmentMiniListView(document, lectureToolsPanelController.getPanel(), records);
}

async function refreshLectureAssignmentSummaryFromStorage() {
  if (lectureAssignmentCollector.isBusy()) return;
  if (!lectureToolsPanelController.getPanel()) return;
  const route = parseMoocsCourseRoute(location.href);
  if (!route?.course || !route.lecture) return;
  try {
    await syncCurrentAssignmentStatusFromDom();
    const allStatuses = await getAssignmentStatus();
    const removed = lectureAssignmentCollector.removeAutoCollectedAttendanceRecords(allStatuses);
    if (removed > 0) await saveAssignmentStatus(allStatuses);
    const records = lectureAssignmentCollector.getStoredAssignmentRecordsForCurrentLecture(allStatuses);
    updateLectureAssignmentCheckStatus(
      records.length ? createLectureAssignmentSummaryText(records) : '未確認',
      records.length ? getLectureAssignmentSummaryState(records) : 'idle',
    );
    renderLectureAssignmentMiniList(records);
  } catch (error) {
    reportContentError('[ultimateMoocs:assignment] summary refresh failed', error);
  }
}

async function syncCurrentAssignmentStatusFromDom() {
  if (!currentSettings?.assignments?.enableSubmissionCheck) return;
  if (!isCurrentPageAssignmentLike()) return;
  const storedRecord = await assignmentStatusActions.getStoredAssignmentRecordForCurrentPage();
  if (!storedRecord || storedRecord.status !== 'unpublished' || storedRecord.source === 'manual') return;
  const result = detectCurrentAssignmentSubmissionStatus();
  if (result.status === 'unpublished' || result.status === 'unknown') return;
  const record = assignmentStatusActions.createAssignmentStatusRecordFromDetection(result);
  await assignmentStatusActions.saveAssignmentStatusRecordIfChanged(record);
}

function ensureLectureAssignmentCheck() {
  const enabled = Boolean(currentSettings?.assignments?.enableSubmissionCheck);
  const route = parseMoocsCourseRoute(location.href);
  const isLecturePage = Boolean(route?.course && route?.lecture);
  if (!enabled || !isLecturePage) {
    const panel = lectureToolsPanelController.getPanel();
    if (!panel) return;
    const check = panel.querySelector('.um-lecture-assignment-check');
    if (check) check.hidden = true;
    return;
  }
  const panel = ensureLectureToolsPanel();
  const check = panel.querySelector('.um-lecture-assignment-check');
  if (check) check.hidden = false;
  refreshLectureAssignmentSummaryFromStorage();
}

function cleanupLectureToolsPanel() {
  if (!lectureToolsPanelController.getPanel()) return;
  const hasAssignmentCheck = Boolean(
    currentSettings?.assignments?.enableSubmissionCheck &&
      parseMoocsCourseRoute(location.href)?.course &&
      parseMoocsCourseRoute(location.href)?.lecture,
  );
  const hasTools = Boolean(downloadPanel || aiSummaryPanel || hasAssignmentCheck);
  if (!hasTools) {
    lectureToolsPanelController.remove();
  }
}

async function fetchMoocsHtmlDocument(url) {
  const cacheKey = url.href.replace(/#.*$/, '');
  if (downloadDocumentCache.has(cacheKey)) {
    return downloadDocumentCache.get(cacheKey);
  }

  const request = fetch(url.href, { credentials: 'include' })
    .then(async (response) => {
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const html = await response.text();
      return new DOMParser().parseFromString(html, 'text/html');
    })
    .catch((error) => {
      downloadDocumentCache.delete(cacheKey);
      throw error;
    });

  downloadDocumentCache.set(cacheKey, request);
  if (downloadDocumentCache.size > DOWNLOAD_DOCUMENT_CACHE_LIMIT) {
    const oldestKey = downloadDocumentCache.keys().next().value;
    if (oldestKey) downloadDocumentCache.delete(oldestKey);
  }
  return request;
}

async function runWithConcurrency(items, limit, worker) {
  const queue = items.map((item, index) => ({ item, index }));
  const workerCount = Math.max(1, Math.min(limit, queue.length));
  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (queue.length > 0) {
        const next = queue.shift();
        if (!next) return;
        await worker(next.item, next.index);
      }
    }),
  );
}

function isCurrentDownloadCandidateRefresh(generation) {
  return generation === downloadCandidateRefreshGeneration && Boolean(downloadPanel);
}

async function collectLecturePageRouteEntries(scope, options = {}) {
  const currentRoute = parseMoocsCourseRoute(location.href);
  if (!currentRoute?.course) return [];
  const precollectedEntries = Array.isArray(options.precollectedEntries) ? options.precollectedEntries : null;
  const slidesOnly = Boolean(options.slidesOnly);
  const generation = Number(options.generation || 0);

  if (scope === 'lecture') {
    const currentPages = collectLecturePageRouteLinksFromDocument();
    if (currentPages.length) return dedupeRouteEntries(currentPages, MAX_LECTURE_PAGES);
    const currentUrl = new URL(location.href);
    return [{ url: currentUrl, route: currentRoute, title: document.title }];
  }

  const courseUrl = currentRoute.lecture
    ? new URL(`/courses/${currentRoute.year}/${currentRoute.course}`, location.origin)
    : new URL(location.href);
  const courseDoc = currentRoute.lecture ? await fetchMoocsHtmlDocument(courseUrl) : document;
  const lectureLinks = dedupeRouteEntries(collectCourseLectureRouteLinksFromDocument(courseDoc, courseUrl.href));
  const pageLinks = [];
  let completed = 0;

  await runWithConcurrency(lectureLinks, DOWNLOAD_FETCH_CONCURRENCY, async (lecture) => {
    try {
      const doc = await fetchMoocsHtmlDocument(lecture.url);
      if (precollectedEntries) {
        const candidates = collectDownloadCandidatesFromDocument(doc, lecture.url.href);
        precollectedEntries.push(
          ...(slidesOnly ? candidates.filter((candidate) => candidate.kind === 'google_slides') : candidates),
        );
      }
      const links = collectLecturePageRouteLinksFromDocument(doc, lecture.url.href);
      pageLinks.push(...(links.length ? links : [lecture]));
    } catch (error) {
      reportContentError(`[ultimateMoocs:downloads] lecture collection failed ${lecture.url.href}`, error);
      pageLinks.push(lecture);
    } finally {
      completed += 1;
      if (isCurrentDownloadCandidateRefresh(generation)) {
        setDownloadPanelStatus(`講義ページ一覧を収集中... ${completed}/${lectureLinks.length}`);
      }
    }
  });

  const lectureUrlKeys = new Set(lectureLinks.map((entry) => entry.url.href.replace(/#.*$/, '')));
  return dedupeRouteEntries(pageLinks, MAX_COURSE_PAGES).filter(
    (entry) => !lectureUrlKeys.has(entry.url.href.replace(/#.*$/, '')),
  );
}

async function collectDownloadCandidatesFromRouteEntries(pageEntries, slidesOnly = false, options = {}) {
  const entries = [];
  let completed = 0;
  const generation = Number(options.generation || 0);

  await runWithConcurrency(pageEntries, DOWNLOAD_FETCH_CONCURRENCY, async (entry) => {
    try {
      const doc = await fetchMoocsHtmlDocument(entry.url);
      const candidates = collectDownloadCandidatesFromDocument(doc, entry.url.href);
      entries.push(...(slidesOnly ? candidates.filter((candidate) => candidate.kind === 'google_slides') : candidates));
    } catch (error) {
      reportContentError(`[ultimateMoocs:downloads] page collection failed ${entry.url.href}`, error);
    } finally {
      completed += 1;
      if (isCurrentDownloadCandidateRefresh(generation)) {
        setDownloadPanelStatus(`資料候補を収集中... ${completed}/${pageEntries.length}`);
      }
    }
  });

  return entries;
}

async function collectDownloadEntriesForScope(scope, slidesOnly = false, options = {}) {
  let entries = collectDownloadCandidatesFromDocument();
  const generation = Number(options.generation || 0);
  if (scope === 'lecture' || scope === 'course') {
    if (isCurrentDownloadCandidateRefresh(generation)) {
      setDownloadPanelStatus(`MOOCsページ構造を解析中... ${scope}`);
    }
    const precollectedEntries = [];
    const pageLinks = await collectLecturePageRouteEntries(scope, {
      precollectedEntries,
      slidesOnly,
      generation,
    });
    entries.push(
      ...precollectedEntries,
      ...(await collectDownloadCandidatesFromRouteEntries(pageLinks, slidesOnly, { generation })),
    );
  }

  if (slidesOnly) {
    entries = entries.filter((entry) => entry.kind === 'google_slides');
  }

  if (!currentSettings?.downloads?.enableDirectFileDownload) {
    entries = entries.map((entry) =>
      entry.kind === 'direct_file'
        ? {
            ...entry,
            disabled: true,
            disabledReason: 'Direct file download is disabled in settings',
          }
        : entry,
    );
  }

  if (!currentSettings?.downloads?.enableGoogleSlidesPdf) {
    entries = entries.map((entry) =>
      entry.kind === 'google_slides'
        ? {
            ...entry,
            disabled: true,
            disabledReason: 'Google Slides PDF download is disabled in settings',
          }
        : entry,
    );
  }

  return [...new Map(entries.map((entry) => [entry.url, entry])).values()].map(normalizeDownloadCandidateForRendering);
}

function setDownloadPanelStatus(text) {
  setDownloadPanelStatusView(downloadPanel, text);
}

function renderDownloadCandidateList() {
  renderDownloadCandidateListView(downloadPanel, downloadCandidateState, {
    updateTab: (label, enabled) => updateLectureToolTab('downloads', label, enabled),
  });
}

async function refreshDownloadCandidatesForScope(scope, slidesOnly = false, slidesFormat = '') {
  if (!downloadPanel) return;
  const generation = downloadCandidateRefreshGeneration + 1;
  downloadCandidateRefreshGeneration = generation;
  setActiveLectureToolPane('downloads');
  downloadCandidateState = {
    entries: [],
    selectedIds: new Set(),
    scope,
    slidesFormat,
  };
  renderDownloadCandidateList();
  setDownloadPanelStatus('資料候補を検出中...');

  let entries = await collectDownloadEntriesForScope(scope, slidesOnly, { generation });
  if (!isCurrentDownloadCandidateRefresh(generation)) return false;
  if (slidesFormat) {
    entries = entries.map((entry) =>
      entry.kind === 'google_slides' ? { ...entry, exportFormat: slidesFormat } : entry,
    );
  }
  if (!isCurrentDownloadCandidateRefresh(generation)) return false;

  downloadCandidateState = {
    entries,
    selectedIds: new Set(entries.filter((entry) => !entry.disabled).map((entry) => entry.id)),
    scope,
    slidesFormat,
  };
  renderDownloadCandidateList();
  setDownloadPanelStatus(entries.length ? '保存する資料を確認してください。' : '資料候補が見つかりませんでした。');
  return true;
}

async function downloadAllCandidatesForScope(scope) {
  const refreshed = await refreshDownloadCandidatesForScope(scope, false, 'pdf');
  if (!refreshed) return;
  await enqueueSelectedDownloadCandidatesForBackground();
}

function showDownloadActionError(error) {
  if (isExtensionContextInvalidated(error)) {
    setDownloadPanelStatus('拡張機能を更新しました。ページを再読み込みしてください。');
    return;
  }
  reportContentError('[ultimateMoocs:downloads]', error);
  setDownloadPanelStatus(error?.message || 'ダウンロード処理に失敗しました。');
}

async function enqueueSelectedDownloadCandidatesForBackground() {
  if (!downloadPanel) return;
  const entries = downloadCandidateState.entries.filter((entry) => downloadCandidateState.selectedIds.has(entry.id));
  if (!entries.length) {
    setDownloadPanelStatus('保存対象が選択されていません。');
    return;
  }

  const response = await runtimeSendMessage(
    createMessage(MESSAGE_TYPES.downloadEnqueue, {
      scope: downloadCandidateState.scope,
      entries,
    }),
  );
  if (!response?.ok) {
    setDownloadPanelStatus(response?.error || 'ダウンロードを開始できませんでした。');
  }
}

async function renderDownloadQueueState() {
  if (!downloadPanel) return;
  const response = await runtimeSendMessage(createMessage(MESSAGE_TYPES.downloadStateGet));
  const state = response?.payload?.state;
  renderDownloadQueueStateView(downloadPanel, state);
}

function ensureDownloadPanel() {
  const downloads = currentSettings?.downloads || {};
  const enabled = Boolean(downloads.enableDownloadPanel);
  const route = parseMoocsCourseRoute(location.href);
  const isCoursePage = Boolean(route?.course);

  if (!enabled || !isCoursePage) {
    downloadCandidateRefreshGeneration += 1;
    downloadPanel?.remove();
    downloadPanel = null;
    updateLectureToolTab('downloads', '資料保存', false);
    downloadCandidateState = {
      entries: [],
      selectedIds: new Set(),
      scope: 'page',
      slidesFormat: '',
    };
    return;
  }

  if (!downloadPanel) {
    downloadPanel = createDownloadPanelElement(document, {
      onAction: (action) => {
        if (action === 'cancel') {
          runtimeSendMessage(createMessage(MESSAGE_TYPES.downloadCancel))
            .then(renderDownloadQueueState)
            .catch((error) => {
              if (!isExtensionContextInvalidated(error)) {
                reportContentError('[ultimateMoocs:downloads]', error);
              }
            });
        } else if (action === 'page') {
          downloadAllCandidatesForScope('page').catch(showDownloadActionError);
        } else if (action === 'lecture') {
          downloadAllCandidatesForScope('lecture').catch(showDownloadActionError);
        } else if (action === 'course') {
          downloadAllCandidatesForScope('course').catch(showDownloadActionError);
        } else if (action === 'extract-slide-text') {
          extractSlideTextFromDownloadPanelAction().catch(showSlideTextActionError);
        } else if (action === 'copy-slide-text') {
          copyExtractedSlideTextFromDownloadPanel().catch(showSlideTextActionError);
        } else if (action === 'save-slide-text') {
          downloadExtractedSlideTextFromDownloadPanel();
        }
      },
      onCandidateSelectionChange: (candidateId, checked) => {
        if (checked) {
          downloadCandidateState.selectedIds.add(candidateId);
        } else {
          downloadCandidateState.selectedIds.delete(candidateId);
        }
        renderDownloadCandidateList();
      },
    });
  }

  const pane = findLectureToolPane('downloads');
  if (pane && downloadPanel.parentElement !== pane) pane.append(downloadPanel);
  syncSlideTextPanelWithCurrentPage();
  updateLectureToolTab('downloads', '資料保存', true);

  downloadPanel.querySelector('[data-um-download="page"]').disabled = !downloads.enableCurrentPageDownload;
  downloadPanel.querySelector('[data-um-download="lecture"]').disabled = !downloads.enableLectureDownload;
  downloadPanel.querySelector('[data-um-download="course"]').disabled = !downloads.enableCourseDownload;
  renderDownloadQueueState().catch((error) => {
    if (!isExtensionContextInvalidated(error)) {
      reportContentError('[ultimateMoocs:downloads]', error);
    }
  });
}

function createSlideTextExtractionCacheKey() {
  const urls = [...new Set(collectSlidesUrlsFromCurrentPage())].sort();
  return `${getCanonicalMoocsUrl()}\n${urls.join('\n')}`;
}

function getSlideTextExtractionMethodLabel(method) {
  if (method === 'svg_helper') return 'SVG';
  if (method === 'html_candidates') return 'HTML';
  if (method === 'export_txt') return 'テキスト出力';
  return '代替処理';
}

async function extractSlideTextForCurrentMoocsPage({ force = false, onStatus } = {}) {
  const urls = [...new Set(collectSlidesUrlsFromCurrentPage())];
  const key = createSlideTextExtractionCacheKey();
  if (!force && slideTextExtractionCache.has(key)) return slideTextExtractionCache.get(key);
  if (!urls.length) {
    return {
      key,
      sourceUrl: getCanonicalMoocsUrl(),
      title: getCurrentAiSummaryTitle(),
      text: '',
      results: [],
      error: 'このページにGoogle Slidesが見つかりませんでした。',
    };
  }

  onStatus?.(`Slides本文を抽出しています... ${urls.length}件`);
  const response = await runtimeSendMessage(
    createMessage(MESSAGE_TYPES.slidesTextExtract, { urls }),
  );
  if (!response?.ok) throw new Error(response?.error || 'Slides本文の抽出に失敗しました。');

  const results = response.payload?.results || [];
  const text = results
    .filter((result) => result.ok && result.text)
    .map((result, index) => [`--- Google Slides ${index + 1} ---`, cleanLectureTextForAiSummary(result.text)].join('\n'))
    .join('\n\n')
    .trim();
  const extraction = {
    key,
    sourceUrl: getCanonicalMoocsUrl(),
    title: getCurrentAiSummaryTitle(),
    text,
    results,
    extractedAt: new Date().toISOString(),
    error: text ? '' : results.find((result) => !result.ok)?.error || 'Slides本文を取得できませんでした。',
  };
  slideTextExtractionCache.set(key, extraction);
  if (slideTextExtractionCache.size > 8) {
    slideTextExtractionCache.delete(slideTextExtractionCache.keys().next().value);
  }
  return extraction;
}

function renderSlideTextExtractionResult(extraction) {
  if (!downloadPanel) return;
  const tool = downloadPanel.querySelector('.um-slide-text-tool');
  const status = tool?.querySelector('.um-slide-text-status');
  const output = tool?.querySelector('.um-slide-text-output');
  const actions = tool?.querySelector('.um-slide-text-actions');
  const count = tool?.querySelector('.um-slide-text-count');
  const resultsList = tool?.querySelector('.um-slide-text-results');
  if (!tool || !status || !output || !actions || !count || !resultsList) return;

  const hasText = Boolean(extraction?.text);
  tool.dataset.state = hasText ? 'ready' : 'error';
  tool.dataset.extractionKey = extraction?.key || '';
  status.textContent = hasText
    ? `本文を抽出しました。AI tokenは使用していません。`
    : extraction?.error || 'Slides本文を取得できませんでした。';
  status.classList.toggle('error', !hasText);
  output.value = extraction?.text || '';
  output.hidden = !hasText;
  actions.hidden = !hasText;
  count.textContent = hasText
    ? `${extraction.text.length.toLocaleString()}文字 / Slides ${extraction.results.filter((item) => item.ok).length}件`
    : '';
  resultsList.replaceChildren();
  for (const result of extraction?.results || []) {
    const item = document.createElement('li');
    item.className = result.ok ? 'ok' : 'warn';
    item.textContent = result.ok
      ? `${getSlideTextExtractionMethodLabel(result.method)}で${result.text.length.toLocaleString()}文字を抽出`
      : `抽出失敗: ${result.error || result.url}`;
    resultsList.append(item);
  }
}

function syncSlideTextPanelWithCurrentPage() {
  if (!downloadPanel) return;
  const sourceUrl = getCanonicalMoocsUrl();
  if (downloadPanel.dataset.umSlideTextSourceUrl === sourceUrl) return;
  downloadPanel.dataset.umSlideTextSourceUrl = sourceUrl;

  const cached = slideTextExtractionCache.get(createSlideTextExtractionCacheKey());
  if (cached) {
    renderSlideTextExtractionResult(cached);
    return;
  }

  const tool = downloadPanel.querySelector('.um-slide-text-tool');
  const status = tool?.querySelector('.um-slide-text-status');
  const output = tool?.querySelector('.um-slide-text-output');
  const actions = tool?.querySelector('.um-slide-text-actions');
  const results = tool?.querySelector('.um-slide-text-results');
  if (tool) {
    tool.dataset.state = 'idle';
    tool.dataset.extractionKey = '';
  }
  if (status) {
    status.textContent = 'このページのSlidesを検出して本文を抽出できます。';
    status.classList.remove('error');
  }
  if (output) {
    output.value = '';
    output.hidden = true;
  }
  if (actions) actions.hidden = true;
  if (results) results.replaceChildren();
}

function setSlideTextPanelLoadingState(isBusy, statusText = '') {
  slideTextExtractionBusy = isBusy;
  if (!downloadPanel) return;
  const tool = downloadPanel.querySelector('.um-slide-text-tool');
  const button = downloadPanel.querySelector('[data-um-download="extract-slide-text"]');
  if (tool) tool.dataset.state = isBusy ? 'busy' : tool.dataset.state;
  if (button) {
    button.disabled = isBusy;
    button.textContent = isBusy ? '抽出中...' : '本文を抽出';
  }
  if (statusText) {
    const status = tool?.querySelector('.um-slide-text-status');
    if (status) {
      status.textContent = statusText;
      status.classList.remove('error');
    }
  }
}

async function extractSlideTextFromDownloadPanelAction() {
  if (slideTextExtractionBusy) return;
  setSlideTextPanelLoadingState(true, 'Slidesを検出しています...');
  try {
    const extraction = await extractSlideTextForCurrentMoocsPage({
      force: true,
      onStatus: (text) => setSlideTextPanelLoadingState(true, text),
    });
    renderSlideTextExtractionResult(extraction);
  } finally {
    setSlideTextPanelLoadingState(false);
  }
}

function getExtractedSlideTextFromDownloadPanel() {
  return downloadPanel?.querySelector('.um-slide-text-output')?.value?.trim() || '';
}

async function copyExtractedSlideTextFromDownloadPanel() {
  const text = getExtractedSlideTextFromDownloadPanel();
  if (!text) throw new Error('コピーするSlides本文がありません。');
  await copyTextToClipboard(text);
  const status = downloadPanel?.querySelector('.um-slide-text-status');
  if (status) status.textContent = 'Slides本文をクリップボードにコピーしました。';
}

function downloadExtractedSlideTextFromDownloadPanel() {
  const text = getExtractedSlideTextFromDownloadPanel();
  if (!text) {
    showSlideTextActionError(new Error('保存するSlides本文がありません。'));
    return;
  }
  downloadTextFileFromPage(`${sanitizePathPart(getCurrentAiSummaryTitle(), 'moocs-slides')}_slides.txt`, `${text}\n`);
  const status = downloadPanel?.querySelector('.um-slide-text-status');
  if (status) status.textContent = 'Slides本文をTXTで保存しました。';
}

function showSlideTextActionError(error) {
  if (isExtensionContextInvalidated(error)) {
    setSlideTextPanelLoadingState(false, '拡張機能を更新しました。ページを再読み込みしてください。');
    return;
  }
  reportContentError('[ultimateMoocs:slides-text]', error);
  setSlideTextPanelLoadingState(false);
  const tool = downloadPanel?.querySelector('.um-slide-text-tool');
  const status = tool?.querySelector('.um-slide-text-status');
  if (tool) tool.dataset.state = 'error';
  if (status) {
    status.textContent = error?.message || 'Slides本文の抽出に失敗しました。';
    status.classList.add('error');
  }
}

function estimateAiPreviewTokenCount(text) {
  const normalized = String(text || '').trim();
  return normalized ? Math.ceil(normalized.length / 2.5) : 0;
}

function getCurrentAiSummaryTitle() {
  const context = getDownloadNamingContext(document, location.href);
  return [context.courseName, context.lectureGroup, context.lectureName]
    .filter(Boolean)
    .join(' / ');
}

function isReadablePageTextNode(node) {
  if (!node || isMoocsUltimateOwnedNode(node)) return false;
  if (node.closest?.('.main-header, .main-sidebar, .control-sidebar, script, style, noscript')) return false;
  const text = normalizeVisibleLabelText(node.textContent);
  return text.length >= 2;
}

function collectCurrentPageTextForAiSummary() {
  const context = getDownloadNamingContext(document, location.href);
  const root =
    document.querySelector('.content-wrapper .content') ||
    document.querySelector('.content-wrapper') ||
    document.body;
  const chunks = [
    `科目: ${context.courseName}`,
    `講義回: ${context.lectureGroup}`,
    `ページ: ${context.lectureName}`,
    `URL: ${getCanonicalMoocsUrl()}`,
  ];
  const seen = new Set(chunks);
  const selectors = [
    '.content-header h1',
    '.content-header h2',
    '.breadcrumb',
    'h1',
    'h2',
    'h3',
    'h4',
    '.box-title',
    '.panel-title',
    'p',
    'li',
    'td',
    'th',
    'dt',
    'dd',
    'blockquote',
    'pre',
  ].join(',');

  for (const node of root.querySelectorAll(selectors)) {
    if (!isReadablePageTextNode(node)) continue;
    const text = normalizeVisibleLabelText(node.textContent);
    if (seen.has(text)) continue;
    if (/^(bookmark|view course|search|shortcut|table of contents)$/i.test(text)) continue;
    seen.add(text);
    chunks.push(text);
  }

  return chunks.join('\n');
}

function isAiSummaryNoiseLine(value) {
  const text = normalizeVisibleLabelText(value);
  if (!text) return true;
  if (/^[A-Z]:\\/.test(text)) return true;
  if (/\\(?:Users|Documents|SkyDrive|OneDrive|Desktop|Downloads)\\/i.test(text)) return true;
  if (/\.(?:bmp|png|jpe?g|gif|webp|svg|ico)(?:\s|$)/i.test(text)) return true;
  if (/^(?:Bookmark|Previous|Next|« Previous|Next »|«|»|チーム開発とGitHub Bookmark)$/i.test(text)) return true;
  if (/「.+」の画像検索結果/.test(text)) return true;
  if (/画像検索結果$/.test(text)) return true;
  if (/^(?:パソコンを使う|データベース|サラリーマン|OL・女性会社員).*(?:イラスト|画像)$/i.test(text)) {
    return true;
  }
  if (/^(?:ここをクリック|試しに).{0,40}(?:クリック|確認)/.test(text)) return true;
  return false;
}

function cleanLectureTextForAiSummary(text) {
  const lines = String(text || '')
    .replace(/\r\n?/g, '\n')
    .split('\n');
  const cleaned = [];
  const seen = new Map();
  let previousWasBlank = false;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) {
      if (!previousWasBlank && cleaned.length) cleaned.push('');
      previousWasBlank = true;
      continue;
    }
    previousWasBlank = false;
    if (isAiSummaryNoiseLine(line)) continue;

    const duplicateKey = line.replace(/\s+/g, ' ');
    const count = seen.get(duplicateKey) || 0;
    if (count >= 2 && !/^--- /.test(line)) continue;
    seen.set(duplicateKey, count + 1);
    cleaned.push(line);
  }

  return cleaned.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

function collectSlidesUrlsFromCurrentPage() {
  return collectDownloadCandidatesFromDocument()
    .filter((candidate) => candidate.kind === 'google_slides')
    .map((candidate) => candidate.sourceUrl || candidate.url)
    .filter(Boolean);
}

async function copyTextToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
    return;
  } catch {
    const fallback = document.createElement('textarea');
    fallback.className = 'um-clipboard-fallback';
    fallback.value = text;
    fallback.setAttribute('readonly', '');
    document.body.append(fallback);
    fallback.focus();
    fallback.select();
    const copied = document.execCommand('copy');
    fallback.remove();
    if (!copied) throw new Error('クリップボードへコピーできませんでした。');
  }
}

function setAiSummaryPanelStatus(text, isError = false) {
  setAiSummaryPanelStatusView(aiSummaryPanel, text, isError);
}

function setAiSummaryBusyState(isBusy) {
  aiSummaryBusy = isBusy;
  setAiSummaryBusyStateView(aiSummaryPanel, isBusy);
  if (!isBusy && aiSummaryPanel?.dataset.cachedSummaryKey && getRenderedAiSummaryText()) {
    updateAiSummaryActionButtons({ hasCachedSummary: true, isShowingCached: true });
  }
}

function updateAiSummaryTokenEstimate(estimatedTokens = null) {
  updateAiSummaryTokenEstimateView(aiSummaryPanel, estimatedTokens);
}

function normalizeAiSummaryMatchText(value) {
  return normalizeVisibleLabelText(value)
    .toLowerCase()
    .replace(/[［\[]([a-z]{2,}\d{3})[］\]]/gi, '$1')
    .replace(/[^\p{L}\p{N}]+/gu, '');
}

function doAiSummaryRoutesMatch(itemUrl, currentUrl = getCanonicalMoocsUrl()) {
  const itemRoute = parseMoocsCourseRoute(itemUrl);
  const currentRoute = parseMoocsCourseRoute(currentUrl);
  if (!itemRoute || !currentRoute) return false;
  if (
    itemRoute.year !== currentRoute.year ||
    itemRoute.course !== currentRoute.course ||
    itemRoute.lecture !== currentRoute.lecture
  ) {
    return false;
  }
  if (currentRoute.page) return itemRoute.page === currentRoute.page;
  if (itemRoute.page) return false;
  return true;
}

function doesAiSummaryTitleMatchExactly(itemTitle, currentTitle = getCurrentAiSummaryTitle()) {
  const item = normalizeAiSummaryMatchText(itemTitle);
  const current = normalizeAiSummaryMatchText(currentTitle);
  if (!item || !current) return false;
  return item === current;
}

function doesAiSummarySourceMatchCurrentPage(item, currentUrl, currentTitle) {
  const itemUrl = getCanonicalMoocsUrl(item.sourceUrl);
  if (item.sourceUrl && itemUrl === currentUrl) return true;
  if (item.sourceUrl) return doAiSummaryRoutesMatch(item.sourceUrl, currentUrl);
  return doesAiSummaryTitleMatchExactly(item.title, currentTitle);
}

function mapSavedAiSummaryForRendering(cacheKey, item) {
  return {
    cacheKey,
    version: Number(item.version || 0),
    sourceUrl: String(item.sourceUrl || ''),
    title: String(item.title || item.sourceUrl || 'AI要約'),
    model: String(item.model || ''),
    summaryMode: String(item.summaryMode || ''),
    summary: String(item.summary || ''),
    estimatedInputTokens: Number(item.estimatedInputTokens || 0),
    estimatedOutputTokens: Number(item.estimatedOutputTokens || 0),
    createdAt: String(item.createdAt || item.updatedAt || ''),
    updatedAt: String(item.updatedAt || item.createdAt || ''),
  };
}

async function findSavedAiSummariesForCurrentPage() {
  const summaries = await getAiSummaries();
  const currentUrl = getCanonicalMoocsUrl();
  const currentTitle = getCurrentAiSummaryTitle();
  return Object.entries(summaries)
    .filter(([, item]) => item && typeof item === 'object' && typeof item.summary === 'string')
    .map(([cacheKey, item]) => mapSavedAiSummaryForRendering(cacheKey, item))
    .filter((item) => doesAiSummarySourceMatchCurrentPage(item, currentUrl, currentTitle))
    .sort((a, b) => String(b.updatedAt || b.createdAt).localeCompare(String(a.updatedAt || a.createdAt)));
}

async function fetchSavedAiSummariesForCurrentPage() {
  let remoteSummaries = [];
  try {
    const response = await runtimeSendMessage(
      createMessage(MESSAGE_TYPES.aiSummaryList, {
        sourceUrl: getCanonicalMoocsUrl(),
        title: getCurrentAiSummaryTitle(),
      }),
    );
    if (!response?.ok) throw new Error(response?.error || 'AI要約履歴を取得できませんでした。');
    remoteSummaries = response.payload?.summaries || [];
  } catch (error) {
    if (!isExtensionContextInvalidated(error)) {
      reportContentError('[ultimateMoocs:ai] background summary lookup failed; trying local storage', error);
    }
  }

  const localSummaries = await findSavedAiSummariesForCurrentPage();
  const merged = [...remoteSummaries, ...localSummaries];
  return [...new Map(merged.map((item) => [item.cacheKey, item])).values()].sort((a, b) =>
    String(b.updatedAt || b.createdAt).localeCompare(String(a.updatedAt || a.createdAt)),
  );
}

function resetAiSummaryPanelForSource(sourceUrl) {
  if (!resetAiSummaryPanelForSourceView(aiSummaryPanel, sourceUrl)) return;
  aiSummaryDraft = {
    title: '',
    sourceUrl: '',
    text: '',
    slideResults: [],
  };
  updateAiSummaryActionButtons({ hasCachedSummary: false, isShowingCached: false });
  updateAiSummaryTokenEstimate(null);
}

function updateAiSummaryActionButtons({ hasCachedSummary = false, isShowingCached = false } = {}) {
  updateAiSummaryActionButtonsView(aiSummaryPanel, aiSummaryBusy, { hasCachedSummary, isShowingCached });
}

function updateAiSummaryCacheStateView({ cached = false, updatedAt = '', hasApiKey = true } = {}) {
  updateAiSummaryCacheStateViewPanel(aiSummaryPanel, updateLectureToolTabStatus, { cached, updatedAt, hasApiKey });
}

async function refreshAiSummaryCacheState() {
  if (!aiSummaryPanel) return;
  resetAiSummaryPanelForSource(getCanonicalMoocsUrl());
  setAiSummaryStaleState(aiSummaryPanel, false);
  const cacheRow = aiSummaryPanel.querySelector('.um-ai-cache-row');
  const cacheText = aiSummaryPanel.querySelector('.um-ai-cache-text');
  const output = aiSummaryPanel.querySelector('.um-ai-output');
  try {
    const summaries = await fetchSavedAiSummariesForCurrentPage();
    const latest = summaries[0];
    const hasApiKey = Boolean(currentSettings?.ai?.apiKey?.trim());
    aiSummaryPanel.dataset.cachedSummaryKey = latest?.cacheKey || '';
    cacheRow.hidden = !latest;
    updateAiSummaryActionButtons({
      hasCachedSummary: Boolean(latest),
      isShowingCached: Boolean(latest && output?.dataset.rawSummary),
    });
    updateLectureToolTab('ai', latest ? 'AI要約 ✓' : 'AI要約', true);
    updateAiSummaryCacheStateView({
      cached: Boolean(latest),
      updatedAt: latest?.updatedAt || latest?.createdAt || '',
      hasApiKey,
    });
    if (latest) {
      const date = latest.updatedAt || latest.createdAt || '';
      cacheText.textContent = `保存済み要約を使用できます${date ? ` / 作成 ${new Date(date).toLocaleString()}` : ''}`;
      if (!output?.dataset.rawSummary) {
        renderAiSummaryOutput(latest.summary, {
          ...latest,
          cached: true,
          autoShown: true,
        });
      }
    }
  } catch (error) {
    cacheRow.hidden = true;
    updateAiSummaryCacheStateView({
      cached: false,
      hasApiKey: Boolean(currentSettings?.ai?.apiKey?.trim()),
    });
    reportContentError('[ultimateMoocs:ai] cache status failed', error);
  }
}

async function showCachedAiSummaryForCurrentPage() {
  const summaries = await fetchSavedAiSummariesForCurrentPage();
  const latest = summaries[0];
  if (!latest) {
    setAiSummaryPanelStatus('このページの保存済み要約はまだありません。');
    return;
  }
  renderAiSummaryOutput(latest.summary, {
    ...latest,
    cached: true,
  });
}

async function checkAiSummaryStaleForCurrentPage() {
  if (!aiSummaryPanel) return;
  if (aiSummaryBusy) return;
  const currentSourceUrl = getCanonicalMoocsUrl();
  setAiSummaryBusyState(true);
  try {
    if (!aiSummaryDraft.text || aiSummaryDraft.sourceUrl !== currentSourceUrl) {
      setAiSummaryPanelStatus('要約用テキストを準備しています...');
      await prepareAiSummaryRequestDraft();
    }
    if (getCanonicalMoocsUrl() !== currentSourceUrl || aiSummaryPanel?.dataset.umSourceUrl !== currentSourceUrl) {
      return;
    }
    const text = aiSummaryDraft.text.trim();
    if (!text) {
      setAiSummaryPanelStatus('確認するテキストがありません。', true);
      return;
    }
    setAiSummaryPanelStatus('内容の変更を確認しています...');
    const response = await runtimeSendMessage(
      createMessage(MESSAGE_TYPES.aiSummaryCheckStale, {
        title: aiSummaryDraft.title || getCurrentAiSummaryTitle(),
        sourceUrl: aiSummaryDraft.sourceUrl || currentSourceUrl,
        text,
      }),
    );
    if (getCanonicalMoocsUrl() !== currentSourceUrl || aiSummaryPanel?.dataset.umSourceUrl !== currentSourceUrl) {
      return;
    }
    if (!response?.ok) {
      setAiSummaryPanelStatus(response?.error || '更新確認に失敗しました。', true);
      return;
    }
    const stale = Boolean(response.payload?.stale);
    setAiSummaryStaleState(aiSummaryPanel, stale);
    setAiSummaryPanelStatus(
      stale
        ? '内容が更新されている可能性があります。必要なら「再生成」してください。'
        : '保存済み要約は現在の内容と一致しています。',
    );
  } finally {
    setAiSummaryBusyState(false);
  }
}

function renderAiSummaryOutput(summary, meta = {}) {
  const rendered = renderAiSummaryOutputView(aiSummaryPanel, summary, meta);
  if (!rendered) return;
  setAiSummaryPanelStatus(rendered.statusText);
  if (rendered.isCached) {
    updateAiSummaryActionButtons({ hasCachedSummary: true, isShowingCached: true });
  }
}

function getRenderedAiSummaryText() {
  return aiSummaryPanel?.querySelector('.um-ai-output')?.dataset.rawSummary?.trim() || '';
}

async function copyRenderedAiSummary() {
  const text = getRenderedAiSummaryText();
  if (!text) {
    setAiSummaryPanelStatus('コピーする要約がありません。', true);
    return;
  }
  await copyTextToClipboard(text);
  setAiSummaryPanelStatus('要約をクリップボードにコピーしました。');
}

function downloadRenderedAiSummary() {
  const text = getRenderedAiSummaryText();
  if (!text) {
    setAiSummaryPanelStatus('保存する要約がありません。', true);
    return;
  }
  downloadTextFileFromPage(`${sanitizePathPart(getCurrentAiSummaryTitle(), 'moocs-ai-summary')}.txt`, `${text}\n`);
  setAiSummaryPanelStatus('要約TXTを書き出しました。');
}

async function appendRenderedAiSummaryToMemo() {
  const text = getRenderedAiSummaryText();
  if (!text) {
    setAiSummaryPanelStatus('メモに追加する要約がありません。', true);
    return;
  }
  await pageMemoPanelController.addNote(`AI要約\n\n${text}`, { prepend: true });
  setAiSummaryPanelStatus('要約をページメモに追加しました。');
}

async function prepareAiSummaryRequestDraft() {
  if (!aiSummaryPanel) return;
  if (aiSummaryBusy) return;
  setAiSummaryBusyState(true);
  try {
    setAiSummaryPanelStatus('ページ本文を抽出しています...');
    const pageText = collectCurrentPageTextForAiSummary();
    const extraction = await extractSlideTextForCurrentMoocsPage({
      onStatus: (text) => setAiSummaryPanelStatus(text),
    });
    const slideText = extraction.text;
    const maxInputChars = Math.max(1000, Number(currentSettings?.ai?.maxInputChars || 24000));
    const combinedText = [pageText, slideText].filter(Boolean).join('\n\n');
    const text = cleanLectureTextForAiSummary(combinedText).slice(0, maxInputChars);
    aiSummaryDraft = {
      title: getCurrentAiSummaryTitle(),
      sourceUrl: getCanonicalMoocsUrl(),
      text,
      slideResults: extraction.results,
    };
    updateAiSummaryTokenEstimate(estimateAiPreviewTokenCount(text));
    const truncated = combinedText.length > text.length ? ' 最大入力文字数に合わせて末尾を省略しました。' : '';
    const slideCount = extraction.results.filter((result) => result.ok).length;
    setAiSummaryPanelStatus(`要約する本文を準備しました${slideCount ? ` / Slides ${slideCount}件` : ''}。${truncated}`);
  } finally {
    setAiSummaryBusyState(false);
  }
}

async function runAiSummaryRequest({ forceRefresh = false } = {}) {
  if (!aiSummaryPanel) return;
  if (aiSummaryBusy) return;
  setActiveLectureToolPane('ai');
  const currentSourceUrl = getCanonicalMoocsUrl();
  if (!aiSummaryDraft.text || aiSummaryDraft.sourceUrl !== currentSourceUrl) {
    setAiSummaryPanelStatus('要約用テキストを準備しています...');
    await prepareAiSummaryRequestDraft();
  }
  const text = aiSummaryDraft.text.trim();
  if (!text) {
    setAiSummaryPanelStatus('要約するテキストがありません。', true);
    return;
  }
  const estimatedTokens = estimateAiPreviewTokenCount(text);
  updateAiSummaryTokenEstimate(estimatedTokens);
  if (currentSettings?.ai?.confirmBeforeSend) {
    const warning = estimatedTokens >= 12000 ? '\n\n長めの資料なのでtoken消費が多めになる可能性があります。' : '';
    const ok = window.confirm(
      `送信予定: 約${estimatedTokens.toLocaleString()} tokens\n抽出テキスト: ${text.length.toLocaleString()}文字${warning}\n\n要約しますか？`,
    );
    if (!ok) {
      setAiSummaryPanelStatus('AI要約をキャンセルしました。');
      return;
    }
  }

  setAiSummaryBusyState(true);
  try {
    setAiSummaryPanelStatus('INIAD AI MOPへ送信しています...');
    const response = await runtimeSendMessage(
      createMessage(MESSAGE_TYPES.aiSummarize, {
        title: aiSummaryDraft.title || getCurrentAiSummaryTitle(),
        sourceUrl: aiSummaryDraft.sourceUrl || getCanonicalMoocsUrl(),
        text,
        forceRefresh,
      }),
    );
    if (!response?.ok) {
      setAiSummaryPanelStatus(response?.error || 'AI要約に失敗しました。', true);
      return;
    }
    renderAiSummaryOutput(response.payload?.summary || '', response.payload || {});
    await refreshAiSummaryCacheState();
  } finally {
    setAiSummaryBusyState(false);
  }
}

function ensureAiSummaryPanel() {
  const enabled = Boolean(currentSettings?.ai?.enableAiSummary);
  const route = parseMoocsCourseRoute(location.href);
  const isLecturePage = Boolean(route?.course && route?.lecture);

  if (!enabled || !isLecturePage) {
    aiSummaryPanel?.remove();
    aiSummaryPanel = null;
    updateLectureToolTabStatus('ai', '', '');
    updateLectureToolTab('ai', 'AI要約', false);
    return;
  }

  if (!aiSummaryPanel) {
    aiSummaryPanel = createAiSummaryPanelElement(document, {
      onAction: (action) => {
      if (action === 'summarize') {
        const hasCachedSummary = Boolean(aiSummaryPanel?.dataset.cachedSummaryKey);
        const task = hasCachedSummary ? showCachedAiSummaryForCurrentPage() : runAiSummaryRequest();
        task.catch((error) => {
          reportContentError('[ultimateMoocs:ai]', error);
          setAiSummaryPanelStatus(error?.message || '要約に失敗しました。', true);
        });
      } else if (action === 'regenerate') {
        const ok = window.confirm(
          '保存済み要約を使わず、INIAD AI MOPでこのページの要約を作り直します。tokenを消費します。よろしいですか？',
        );
        if (!ok) {
          setAiSummaryPanelStatus('再生成をキャンセルしました。保存済み要約はそのままです。');
          return;
        }
        runAiSummaryRequest({ forceRefresh: true }).catch((error) => {
          reportContentError('[ultimateMoocs:ai]', error);
          setAiSummaryPanelStatus(error?.message || '再生成に失敗しました。', true);
        });
      } else if (action === 'check-stale') {
        checkAiSummaryStaleForCurrentPage().catch((error) => {
          reportContentError('[ultimateMoocs:ai]', error);
          setAiSummaryPanelStatus(error?.message || '更新確認に失敗しました。', true);
        });
      } else if (action === 'copy') {
        copyRenderedAiSummary().catch((error) => {
          reportContentError('[ultimateMoocs:ai]', error);
          setAiSummaryPanelStatus(error?.message || 'コピーに失敗しました。', true);
        });
      } else if (action === 'download') {
        downloadRenderedAiSummary();
      } else if (action === 'memo') {
        appendRenderedAiSummaryToMemo().catch((error) => {
          reportContentError('[ultimateMoocs:ai]', error);
          setAiSummaryPanelStatus(error?.message || 'メモ追加に失敗しました。', true);
        });
      }
      },
    });
  }
  const pane = findLectureToolPane('ai');
  if (pane && aiSummaryPanel.parentElement !== pane) pane.append(aiSummaryPanel);
  updateLectureToolTab('ai', 'AI要約', true);
  refreshAiSummaryCacheState().catch((error) => reportContentError('[ultimateMoocs:ai] cache refresh failed', error));
  updateAiSummaryTokenEstimate(aiSummaryDraft.text ? estimateAiPreviewTokenCount(aiSummaryDraft.text) : null);
}

function findMainContentRoot() {
  return (
    document.querySelector('.content-wrapper .content') ||
    document.querySelector('.content-wrapper') ||
    document.body
  );
}

function isCurrentPageAssignmentLike() {
  const kind = tabClassifier.classifyDocument();
  const activeNumberTab = document.querySelector(
    '.pagination > .active > a, .pagination > .active > span, .pagination > .active > button',
  );
  const activeTabKind = activeNumberTab ? tabClassifier.classifyTab(activeNumberTab) : '';
  if (tabClassifier.isAttendanceTabKind(kind) || tabClassifier.isAttendanceTabKind(activeTabKind)) return false;
  if (kind === 'assignment') return true;
  const route = parseMoocsCourseRoute(location.href);
  if (!route?.course || !route?.lecture) return false;
  if (hasCurrentPageSubmissionForm()) return true;
  const titleText = [
    document.title,
    ...[...document.querySelectorAll('h1, h2, h3, .content-header, .box-title')]
      .map((node) => normalizeVisibleLabelText(node.textContent))
      .filter(Boolean)
      .slice(0, 10),
  ].join(' ');
  return /課題|assignment|homework|report/i.test(titleText);
}

function collectVisibleContentLines() {
  const root = findMainContentRoot();
  const nodes = [
    ...root.querySelectorAll(
      'h1, h2, h3, h4, p, li, tr, td, th, label, textarea, pre, code, .box, .panel, .card, .content-header, .box-title',
    ),
  ].filter((node) => !isMoocsUltimateOwnedNode(node));
  const lines = nodes
    .map((node) => normalizeVisibleLabelText(node.innerText || node.textContent || ''))
    .flatMap((text) => text.split(/(?<=。)|[\n\r]+/))
    .map((line) => normalizeVisibleLabelText(line))
    .filter((line) => line.length >= 2);
  const bodyClone = document.body.cloneNode(true);
  for (const node of bodyClone.querySelectorAll('[class^="um-"], [class*=" um-"], [data-um-module]')) {
    node.remove();
  }
  const fallbackLines = normalizeVisibleLabelText(bodyClone.textContent || '')
    .split(/(?<=。)|[\n\r]+/)
    .map((line) => normalizeVisibleLabelText(line))
    .filter((line) => line.length >= 2);
  return [...new Set([...lines, ...fallbackLines])];
}

function collectDeadlineCandidateLines() {
  const root = findMainContentRoot();
  const excludedSelector = [
    'script',
    'style',
    'noscript',
    'nav',
    'aside',
    '.pagination',
    '.breadcrumb',
    '.main-sidebar',
    '.sidebar-menu',
    '.table-of-contents',
    '.toc',
    '[role="navigation"]',
    '[data-um-module]',
  ].join(',');
  const lines = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let node = walker.nextNode();
  while (node) {
    const parent = node.parentElement;
    if (parent && !isMoocsUltimateOwnedNode(parent) && !parent.closest(excludedSelector)) {
      const text = normalizeVisibleLabelText(node.textContent || '');
      if (text.length >= 2) lines.push(text);
    }
    node = walker.nextNode();
  }
  return [...new Set(lines)];
}

function isCurrentUrlLikelyAssignment() {
  const route = parseMoocsCourseRoute(location.href);
  const page = route?.page || '';
  const path = route?.url?.pathname || location.pathname;
  return /(?:report|assignment|homework|submit|task|kadai)/i.test(`${page} ${path}`);
}

function getAssignmentDetectionOptions() {
  return {
    currentDocument: document,
    isVisiblePageContentNode,
    isAttendanceDocument: tabClassifier.isAttendanceDocument,
  };
}

function hasCurrentPageSubmissionForm() {
  return hasSubmissionFormInDocument(document, getAssignmentDetectionOptions());
}

function detectCurrentAssignmentSubmissionStatus() {
  const lines = collectVisibleContentLines();
  const negativePatterns = [/未提出|未回答|未送信|未作成|未着手|まだ提出|されていません|not\s+submitted/i];
  const submittedEvidence = findAssignmentEvidenceLine(
    lines,
    [
      /提出済み/,
      /提出完了/,
      /提出が完了/,
      /提出しました/,
      /提出日時/,
      /提出時刻/,
      /送信済み/,
      /回答済み/,
      /提出内容/,
      /提出ファイル/,
      /\bsubmitted\b/i,
      /turned\s+in/i,
    ],
    negativePatterns,
  );
  if (submittedEvidence) {
    return {
      status: 'submitted',
      confidence: 'high',
      evidence: submittedEvidence,
      source: 'page-text',
    };
  }

  const unpublishedEvidence = findCurrentPageUnpublishedAssignmentEvidence();
  if (unpublishedEvidence) {
    return {
      status: 'unpublished',
      confidence: 'high',
      evidence: unpublishedEvidence,
      source: 'page-text-unpublished',
    };
  }

  const uploadedEvidence = findUploadedAssignmentEvidence(lines);
  if (uploadedEvidence) {
    return {
      status: 'pending_confirmation',
      confidence: 'medium',
      evidence: uploadedEvidence,
      source: 'uploaded-file',
    };
  }

  const notSubmittedEvidence = findAssignmentEvidenceLine(lines, [
    /未提出/,
    /未回答/,
    /未送信/,
    /未作成/,
    /未着手/,
    /提出されていません/,
    /まだ提出/,
    /回答してください/,
    /no\s+submission/i,
    /not\s+submitted/i,
  ]);
  if (notSubmittedEvidence) {
    return {
      status: 'not_submitted',
      confidence: 'medium',
      evidence: notSubmittedEvidence,
      source: 'page-text',
    };
  }

  const submitAttemptedHere =
    pendingAssignmentSubmit?.url === getCanonicalMoocsUrl() &&
    Date.now() - new Date(pendingAssignmentSubmit.attemptedAt).getTime() < 10 * 60 * 1000;
  if (submitAttemptedHere) {
    return {
      status: 'pending_confirmation',
      confidence: 'low',
      evidence: '提出操作を検出しましたが、MOOCs側の提出完了表示はまだ検出できていません。',
      source: 'submit-attempt',
      attemptedAt: pendingAssignmentSubmit.attemptedAt,
    };
  }

  if (hasCurrentPageSubmissionForm()) {
    return {
      status: 'not_submitted',
      confidence: 'low',
      evidence: '提出フォームらしき入力欄があります。提出済み表示は検出していません。',
      source: 'form-presence',
    };
  }

  if (isCurrentPageAssignmentLike() || isCurrentUrlLikelyAssignment()) {
    return {
      status: 'not_submitted',
      confidence: 'low',
      evidence: '課題ページとして認識しました。提出済み表示はまだ検出できていません。',
      source: 'assignment-page-fallback',
    };
  }

  return {
    status: 'unknown',
    confidence: 'low',
    evidence: '提出済み/未提出を断定できる表示を検出できませんでした。',
    source: 'conservative-fallback',
  };
}

function findUploadedAssignmentEvidence(lines = collectVisibleContentLines()) {
  return findAssignmentEvidenceLine(lines, [
    /アップロード済み/,
    /アップロードしました/,
    /uploaded/i,
    /添付済み/,
    /ファイル.+保存/,
  ]);
}

function isVisiblePageContentNode(node) {
  if (!(node instanceof Element)) return false;
  if (isMoocsUltimateOwnedNode(node)) return false;
  const style = window.getComputedStyle(node);
  if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
  const rect = node.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

function collectVisibleMainContentLines() {
  const root = findMainContentRoot();
  return [
    ...root.querySelectorAll('h1, h2, h3, h4, p, li, label, .box, .panel, .card, .content-header, .box-title'),
  ]
    .filter(isVisiblePageContentNode)
    .map((node) => normalizeVisibleLabelText(node.innerText || node.textContent || ''))
    .flatMap((text) => text.split(/(?<=。)|[\n\r]+/))
    .map((line) => normalizeVisibleLabelText(line))
    .filter((line) => line.length >= 2);
}

function findCurrentPageUnpublishedAssignmentEvidence() {
  if (hasCurrentPageSubmissionForm()) return '';
  return findAssignmentEvidenceLine(collectVisibleMainContentLines(), [
    /現在この問題は非公開です。?/,
    /この問題は非公開です。?/,
    /問題は非公開です。?/,
  ]);
}

function ensureGlobalDriveButtonMounted() {
  const enabled = Boolean(currentSettings?.iniadPlus?.enableDriveButton);
  courseToolsController.ensureDriveButtonsMounted(enabled);
  globalDriveButtonController.ensureMounted(enabled);
}

function applyLearningToolFeatures() {
  ensureDownloadPanel();
  ensureAiSummaryPanel();
  ensureLectureAssignmentCheck();
  cleanupLectureToolsPanel();
  assignmentStatusActions.ensureAssignmentStatusPanelMounted().catch((error) => reportContentError('[ultimateMoocs:assignment]', error));
  upcomingPanelController.ensureMounted().catch((error) => reportContentError('[ultimateMoocs:upcoming]', error));
  assignmentOverviewPanelController.ensureMounted().catch((error) => reportContentError('[ultimateMoocs:assignment-overview]', error));
  accountSettingsLinkController.ensureMounted();
  pageMemoPanelController.ensureMounted().catch((error) => reportContentError('[ultimateMoocs:memo]', error));
  courseToolsController.ensureMounted().catch((error) => reportContentError('[ultimateMoocs:course]', error));
  externalLinksPanelController.ensureMounted();
  ensureGlobalDriveButtonMounted();
  slideResizeToolsController.ensureMounted();
  if (currentSettings?.navigation?.enableSlidePositionRestore) {
    slidePositionRestoreController.ensureMounted().catch((error) => reportContentError('[ultimateMoocs:slide-position]', error));
  }
}

function applyRuntimeSettings(settings) {
  currentSettings = settings;
  const root = document.documentElement;
  const appearance = settings.appearance;
  const glassEnabled = Boolean(appearance.enableGlassmorphism);
  const hasBackground = glassEnabled && Boolean(
    appearance.backgroundImageUrl?.trim() || appearance.backgroundColor?.trim(),
  );
  root.dataset.umBackgroundActive = String(hasBackground);
  root.dataset.umGlassmorphism = String(glassEnabled);
  root.dataset.umStickyHeader = String(settings.appearance.stickyHeader);
  root.dataset.umStickySidebar = String(settings.appearance.stickySidebar);
  root.dataset.umTabColoring = String(settings.navigation.enableTabColoring);
  root.dataset.umDebugLog = String(settings.debug.enableDebugLog);

  ensureRuntimeStyle();
  mountStatusBadge();
  ensureScrollTopButton();
  enhanceTextareas();
  applyTabColoring();
  assignmentTabBadges.applyAssignmentTabStatusBadges();
  lastLearningToolsSignature = createLearningToolsRefreshSignature();
  applyLearningToolFeatures();
}

async function pingBackgroundServiceWorker() {
  try {
    const response = await runtimeSendMessage(
      createMessage(MESSAGE_TYPES.contentPing, {
        href: location.href,
        title: document.title,
      }),
    );

    if (currentSettings?.debug?.enableDebugLog) {
      console.info('[ultimateMoocs:content] background ping response', response);
    }
  } catch (error) {
    if (!isExtensionContextInvalidated(error)) {
      reportContentError('[ultimateMoocs:content] background ping failed', error);
    }
  }
}

function removeStaleContentScriptMount() {
  document.querySelectorAll('[data-um-module], [data-um-owned="true"]').forEach((node) => node.remove());
  document.querySelector(`#${BADGE_ID}`)?.remove();
  document.querySelectorAll('.um-scroll-top-button, .um-textarea-counter').forEach((node) => node.remove());
  document.querySelectorAll('[data-um-textarea-enhanced]').forEach((node) => {
    delete node.dataset.umTextareaEnhanced;
    delete node.dataset.umTextareaId;
  });
  clearTabColoring();
  assignmentTabBadges.clearAssignmentTabStatusBadges();
}

async function bootContentScript() {
  if (bootStarted) return;
  bootStarted = true;

  if (document.documentElement.getAttribute(ROOT_ATTRIBUTE) === 'true') removeStaleContentScriptMount();

  document.documentElement.setAttribute(ROOT_ATTRIBUTE, 'true');
  applyRuntimeSettings(await getSettings());
  await pingBackgroundServiceWorker();

  document.addEventListener('keydown', handleKeydown, true);
  setupLocationChangeListener();
  injectPageAlertHook();
  setupRuntimeMessageListener();
  setupPageAlertListener();
  setupReloadAfterSubmit();
  schedulePostLoadAssignmentDetection();

  observer = new MutationObserver(() => {
    scheduleTabRefresh();
    scheduleLearningToolsRefresh();
  });
  observer.observe(document.body, { childList: true, subtree: true });

  storageAddChangeListener((changes, areaName) => {
    if (areaName !== 'local') return;
    const assignmentStatusChanged = Object.prototype.hasOwnProperty.call(
      changes,
      STORAGE_KEYS.assignmentStatus,
    );
    if (changes[STORAGE_KEYS.settings]?.newValue) {
      getSettings()
        .then(applyRuntimeSettings)
        .catch((error) => {
          reportContentError('[ultimateMoocs:content] settings refresh failed', error);
        });
      return;
    }
    if (
      changes[STORAGE_KEYS.memos]?.newValue ||
      changes[STORAGE_KEYS.courseOrder]?.newValue ||
      changes[STORAGE_KEYS.coursePrefs]?.newValue ||
      changes[STORAGE_KEYS.downloadState]?.newValue ||
      changes[STORAGE_KEYS.aceTimetable]?.newValue ||
      changes[STORAGE_KEYS.aiSummaries]?.newValue ||
      assignmentStatusChanged
    ) {
      if (assignmentStatusChanged) {
        assignmentTabBadges.applyAssignmentTabStatusBadges();
      }
      applyLearningToolFeatures();
    }
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', bootContentScript, { once: true });
} else {
  bootContentScript();
}
