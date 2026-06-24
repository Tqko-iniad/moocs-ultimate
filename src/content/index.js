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
import { extractDeadlineCandidatesFromLines } from '../shared/deadlineCandidates.js';
import { isAttendanceFieldInstruction, isPreviousAttendanceTitle } from '../shared/attendanceDetection.js';
import { createExternalLinkEntry, dedupeExternalLinkEntries } from '../shared/externalLinks.js';
import {
  compareAssignmentDeadlineUrgency,
  dedupeAssignmentRecords,
  getAssignmentLectureDetails,
  getAssignmentOverview,
  getAssignmentDeadlineState,
} from '../shared/assignmentDeadline.js';

const ROOT_ATTRIBUTE = 'data-um-content-mounted';
const BADGE_ID = 'um-status-badge';
const STYLE_ID = 'um-runtime-style';
const TAB_SELECTOR =
  '.nav-tabs a, .nav-pills a, .pagination a, .pagination button, .breadcrumb a, .content-header a, .content a[href]';

let currentSettings = null;
let scrollTopButton = null;
let tabRefreshTimer = 0;
let observer = null;
let memoPanel = null;
let externalLinksPanel = null;
let driveButton = null;
let slideToolsPanel = null;
let assignmentStatusPanel = null;
let pendingAssignmentSubmit = null;
let courseRefreshTimer = 0;
let lectureToolsPanel = null;
let downloadPanel = null;
let downloadCandidateState = {
  entries: [],
  selectedIds: new Set(),
  scope: 'page',
  slidesFormat: '',
};
const downloadDocumentCache = new Map();
const tabKindCache = new Map();
let upcomingPanel = null;
let assignmentOverviewPanel = null;
let assignmentOverviewRenderGeneration = 0;
const expandedAssignmentOverviewLectures = new Set();
let settingsLinkPanel = null;
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
let lectureAssignmentCheckBusy = false;
let learningToolsRefreshTimer = 0;
let lastLearningToolsSignature = '';
let locationChangeListenerInstalled = false;
let bootStarted = false;
let tabColoringGeneration = 0;
const assignmentUnknownRetryCounts = new Map();
const assignmentSubmittedLocks = new Map();
const detectedAttendancePageUrls = new Set();

const DIRECT_FILE_PATTERN =
  /\.(pdf|ppt|pptx|doc|docx|xls|xlsx|zip|rar|7z|txt|csv|png|jpe?g|gif|webp|svg|mp3|wav|m4a|mp4|mov|webm)(?:[?#].*)?$/i;
const STREAMING_PATTERN = /\.(m3u8|mpd)(?:[?#].*)?$/i;
const MOOCS_ROUTE_PATTERN =
  /^\/courses\/(?<year>\d{4})(?:\/(?<course>[^/?#]+)(?:\/(?<lecture>[^/?#]+)(?:\/(?<page>[^/?#]+))?)?)?\/?$/;
const MAX_LECTURE_PAGES = 60;
const MAX_COURSE_PAGES = 360;
const DOWNLOAD_FETCH_CONCURRENCY = 12;
const ASSIGNMENT_RENDER_CONCURRENCY = 4;
const DOWNLOAD_DOCUMENT_CACHE_LIMIT = 500;
const PAGE_ALERT_MESSAGE_TYPE = 'ultimateMoocs:page.alert';
const SUBMISSION_ANSWER_SELECTOR =
  'textarea, select, [contenteditable="true"], input:not([type]), input[type="file"], input[type="text"], input[type="radio"], input[type="checkbox"]';

function reportContentError(scope, error) {
  if (isExtensionContextInvalidated(error)) return;
  console.warn(scope, error);
}

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
    html[data-um-glassmorphism="true"] .btn,
    html[data-um-glassmorphism="true"] button:not(.um-scroll-top-button):not(.um-settings-link-button) {
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

function classifyText(text) {
  if (isPreviousAttendanceTitle(text)) return 'attendanceTest';
  if (/出席\s*(?:\/\s*)?課題|attendance.?assignment/i.test(text)) return 'attendanceAssignment';
  if (/出席(?:\s*(?:確認|テスト))?|attendance.?(?:check|test)/i.test(text)) return 'attendanceTest';
  if (/スライド|資料|slide|material/i.test(text)) return 'slide';
  if (/理解度確認|理解度|テスト|確認|check|quiz|test/i.test(text)) return 'check';
  if (/課題|assignment|homework|report/i.test(text)) return 'assignment';
  return '';
}

function classifyDocument(doc = document) {
  if (isAttendanceDocument(doc)) return 'attendanceTest';
  const text = [
    doc.title,
    ...[...doc.querySelectorAll('h1, h2, h3, .content-header, .box-title')]
      .map((node) => node.textContent?.trim())
      .filter(Boolean)
      .slice(0, 8),
  ].join(' ');
  return classifyText(text);
}

function classifyTab(link) {
  const title = link.dataset.umOriginalTitle || (
    link.dataset.umAssignmentTitle === 'true' ? '' : link.getAttribute('title')
  );
  const text = [
    link.textContent,
    title,
    link.getAttribute('aria-label'),
    link.getAttribute('href'),
    link.closest('li')?.textContent,
  ]
    .filter(Boolean)
    .join(' ');

  return classifyText(text);
}

function isAttendanceTabKind(kind) {
  return kind === 'attendanceTest' || kind === 'attendanceAssignment';
}

function getAttendanceDocumentHeadingText(doc = document) {
  return [
    doc.title,
    ...[...doc.querySelectorAll('h1, h2, h3, .content-header, .box-title')]
      .map((node) => normalizeLabelText(node.textContent))
      .filter(Boolean)
      .slice(0, 10),
  ].join(' ');
}

function getSubmissionInputInstructionText(doc, input) {
  const id = input.getAttribute('id');
  const associatedLabel = id
    ? [...doc.querySelectorAll('label[for]')].find((label) => label.getAttribute('for') === id)
    : null;
  return [
    input.getAttribute('aria-label'),
    input.getAttribute('placeholder'),
    input.getAttribute('name'),
    input.closest('label')?.textContent,
    associatedLabel?.textContent,
    input.closest('li, tr, .form-group, .question, .problem, .field, .control-group')?.textContent,
    input.previousElementSibling?.textContent,
  ]
    .filter(Boolean)
    .map((text) => normalizeLabelText(text))
    .join(' ');
}

function isAttendanceDocument(doc = document) {
  if (isPreviousAttendanceTitle(getAttendanceDocumentHeadingText(doc))) return true;
  return [...doc.querySelectorAll(SUBMISSION_ANSWER_SELECTOR)].some((input) => {
    if (isExtensionUiNode(input) || isStaticallyHiddenNode(input)) return false;
    return isAttendanceFieldInstruction(getSubmissionInputInstructionText(doc, input));
  });
}

function isNumberPageTab(link) {
  const text = [...link.childNodes]
    .filter((node) => !(node instanceof Element && node.classList.contains('um-assignment-tab-marker')))
    .map((node) => node.textContent || '')
    .join('')
    .trim();
  return /^\d+$/.test(text) && Boolean(link.closest('.pagination'));
}

async function classifyNumberPageTab(link) {
  if (!isNumberPageTab(link)) return '';
  const tabHintKind = classifyTab(link);
  const resolveKind = (documentKind) => (
    isAttendanceTabKind(tabHintKind) ? tabHintKind : documentKind || tabHintKind
  );
  const href = link.getAttribute('href');
  if (!href || href === '#' || link.closest('li')?.classList.contains('active')) {
    return resolveKind(classifyDocument());
  }

  let url;
  try {
    url = new URL(href, location.href);
  } catch {
    return '';
  }
  if (url.origin !== location.origin) return '';

  const cacheKey = url.href.replace(/#.*$/, '');
  if (tabKindCache.has(cacheKey)) return resolveKind(tabKindCache.get(cacheKey));

  try {
    const doc = await fetchHtmlDocument(url);
    const kind = classifyDocument(doc);
    tabKindCache.set(cacheKey, kind);
    return resolveKind(kind);
  } catch (error) {
    reportContentError(`[ultimateMoocs:tabs] failed to classify page tab ${url.href}`, error);
    tabKindCache.set(cacheKey, '');
    return '';
  }
}

function isTopNavigationCandidate(link) {
  const rect = link.getBoundingClientRect();
  const text = link.textContent?.trim() || '';
  const nearTop = rect.top < Math.max(360, window.innerHeight * 0.45);
  const inKnownNav = Boolean(
    link.closest('.nav-tabs, .nav-pills, .pagination, .breadcrumb, .content-header'),
  );
  return nearTop && (inKnownNav || /^\d+$/.test(text) || classifyTab(link));
}

function clearTabColoring() {
  for (const link of document.querySelectorAll('.um-tab-colored')) {
    link.classList.remove('um-tab-colored', 'um-tab-mode-full', 'um-tab-mode-badge', 'um-tab-mode-icon');
    link.removeAttribute('data-um-tab-kind');
    link.style.removeProperty('--um-tab-color');
  }
}

function clearAssignmentTabStatusBadges() {
  for (const link of document.querySelectorAll('.um-assignment-tab-status')) {
    removeAssignmentTabStatusBadge(link);
  }
}

function removeAssignmentTabStatusBadge(link) {
  link.classList.remove('um-assignment-tab-status');
  link.removeAttribute('data-um-assignment-status');
  link.querySelectorAll(':scope > .um-assignment-tab-marker').forEach((node) => node.remove());
  if (link.dataset.umOriginalTitle) {
    link.title = link.dataset.umOriginalTitle;
    delete link.dataset.umOriginalTitle;
  } else if (link.dataset.umAssignmentTitle === 'true') {
    link.removeAttribute('title');
    delete link.dataset.umAssignmentTitle;
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
      assignmentLookup = buildAssignmentStatusLookup(await getAssignmentStatus());
    } catch (error) {
      if (!isExtensionContextInvalidated(error)) {
        reportContentError('[ultimateMoocs:tabs] failed to load assignment colors', error);
      }
    }
  }

  const links = [...document.querySelectorAll(TAB_SELECTOR)].filter((link) => {
    if (!isTopNavigationCandidate(link)) return false;
    return !link.closest('.pagination') || isNumberPageTab(link);
  });
  const decisions = await Promise.all(links.map(async (link) => {
    const numberTab = isNumberPageTab(link);
    const nativeKind = numberTab ? await classifyNumberPageTab(link) : classifyTab(link);
    const assignmentRecord = numberTab
      ? assignmentLookup.get(getTabCanonicalUrl(link))
      : null;
    const kind = !isAttendanceTabKind(nativeKind) && assignmentRecord && isAssignmentTabStatusVisible(assignmentRecord.status)
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
  if (!href || href === '#') return getCanonicalMoocsPageUrl();
  try {
    const url = new URL(href, location.href);
    if (url.origin !== location.origin) return '';
    return getCanonicalMoocsPageUrl(url.href);
  } catch {
    return '';
  }
}

function buildAssignmentStatusLookup(records) {
  const lookup = new Map();
  for (const record of Object.values(records || {})) {
    if (!record || typeof record !== 'object' || !record.status) continue;
    for (const key of [record.url, record.pageKey].filter(Boolean)) {
      lookup.set(getCanonicalMoocsPageUrl(key), record);
    }
  }
  return lookup;
}

function isAssignmentTabStatusVisible(status) {
  return ['submitted', 'not_submitted', 'pending_confirmation', 'unpublished', 'unchecked', 'unknown'].includes(status);
}

function getAssignmentTabStatusTitle(record) {
  const label = getAssignmentStatusLabel(record.status);
  const title = record.title ? `: ${record.title}` : '';
  return `課題 ${label}${title}`;
}

async function applyAssignmentTabStatusBadges() {
  if (!currentSettings?.assignments?.enableSubmissionCheck) {
    clearAssignmentTabStatusBadges();
    return;
  }
  const route = parseMoocsRoute(location.href);
  if (!route?.course || !route.lecture) {
    clearAssignmentTabStatusBadges();
    return;
  }

  let lookup;
  try {
    lookup = buildAssignmentStatusLookup(await getAssignmentStatus());
  } catch (error) {
    reportContentError('[ultimateMoocs:assignment-tabs] failed to load assignment statuses', error);
    return;
  }

  const numberTabs = [...document.querySelectorAll('.pagination a, .pagination span, .pagination button')]
    .filter((link) => isNumberPageTab(link));
  const nativeKinds = new Map(await Promise.all(numberTabs.map(async (link) => [link, await classifyNumberPageTab(link)])));
  const touched = new Set();
  for (const link of numberTabs) {
    touched.add(link);
    if (isAttendanceTabKind(nativeKinds.get(link))) {
      removeAssignmentTabStatusBadge(link);
      continue;
    }
    const tabUrl = getTabCanonicalUrl(link);
    if (!tabUrl) {
      removeAssignmentTabStatusBadge(link);
      continue;
    }
    const record = lookup.get(tabUrl);
    if (!record || !isAssignmentTabStatusVisible(record.status)) {
      removeAssignmentTabStatusBadge(link);
      continue;
    }
    const markerText = record.status === 'submitted' ? '✓' : '';
    let marker = link.querySelector(':scope > .um-assignment-tab-marker');
    if (!link.classList.contains('um-assignment-tab-status')) {
      link.classList.add('um-assignment-tab-status');
    }
    if (link.dataset.umAssignmentStatus !== record.status) {
      link.dataset.umAssignmentStatus = record.status;
    }
    if (!marker) {
      marker = document.createElement('span');
      marker.className = 'um-assignment-tab-marker';
      marker.setAttribute('aria-hidden', 'true');
      link.append(marker);
    }
    if (marker.textContent !== markerText) marker.textContent = markerText;
    const nextTitle = getAssignmentTabStatusTitle(record);
    if (link.dataset.umAssignmentTitle === 'true') {
      if (link.title !== nextTitle) link.title = nextTitle;
    } else if (link.title) {
      const originalTitle = link.dataset.umOriginalTitle || link.title;
      if (!link.dataset.umOriginalTitle) link.dataset.umOriginalTitle = originalTitle;
      const title = `${originalTitle} / ${nextTitle}`;
      if (link.title !== title) link.title = title;
    } else if (link.title !== nextTitle) {
      link.dataset.umAssignmentTitle = 'true';
      link.title = nextTitle;
    }
  }
  for (const link of document.querySelectorAll('.um-assignment-tab-status')) {
    if (!touched.has(link)) removeAssignmentTabStatusBadge(link);
  }
}

function scheduleTabRefresh() {
  if (tabRefreshTimer) return;
  tabRefreshTimer = window.setTimeout(() => {
    tabRefreshTimer = 0;
    applyTabColoring();
    applyAssignmentTabStatusBadges();
    enhanceTextareas();
  }, 120);
}

function scheduleLearningToolsRefresh() {
  if (learningToolsRefreshTimer) return;
  learningToolsRefreshTimer = window.setTimeout(() => {
    learningToolsRefreshTimer = 0;
    const signature = getLearningToolsSignature();
    if (signature === lastLearningToolsSignature) return;
    lastLearningToolsSignature = signature;
    applyLearningTools();
  }, 220);
}

function schedulePostLoadAssignmentDetection() {
  for (const delay of [600, 1600, 3400]) {
    window.setTimeout(() => {
      const signature = getLearningToolsSignature();
      if (signature !== lastLearningToolsSignature) {
        lastLearningToolsSignature = signature;
        applyLearningTools();
        return;
      }
      if (currentSettings?.assignments?.enableSubmissionCheck && hasSubmissionFormInDocument(document)) {
        ensureAssignmentStatusPanel().catch((error) => reportContentError('[ultimateMoocs:assignment]', error));
        refreshLectureAssignmentCheckStatusFromStorage();
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
    if (!isTopNavigationCandidate(link)) return false;
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
        updateDownloadPanelStatus(error?.message || 'スクリーンショット処理に失敗しました。');
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
  updateDownloadPanelStatus(`スクリーンショットを保存しました: ${response.payload?.filename || ''}`);
}

function showToast(message) {
  const oldToast = document.querySelector('.um-toast');
  oldToast?.remove();

  const toast = document.createElement('div');
  toast.className = 'um-toast';
  toast.dataset.umModule = 'toast';
  toast.textContent = message;
  document.body.append(toast);
  window.setTimeout(() => {
    toast.classList.add('um-toast-hide');
    window.setTimeout(() => toast.remove(), 220);
  }, 1800);
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
    if (!isAssignmentSavedAlert(data.message)) return;
    markAssignmentSubmittedFromAlert(data.message, data.capturedAt)
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
    if (!isAssignmentLikePage()) return;
    const target = event.target instanceof Element ? event.target : null;
    if (target && isExtensionUiNode(target)) return;
    pendingAssignmentSubmit = {
      url: getCanonicalMoocsPageUrl(),
      attemptedAt: new Date().toISOString(),
    };
  };

  document.addEventListener(
    'submit',
    (event) => {
      rememberSubmitAttempt(event);
      window.setTimeout(() => {
        if (!event.defaultPrevented) {
          if (getAssignmentSubmittedLock()) return;
          markAssignmentSubmittedFromSubmitAttempt()
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
      if (!target || isExtensionUiNode(target)) return;
      const label = normalizeLabelText(target.textContent || target.value || target.getAttribute('aria-label') || '');
      if (!/提出|送信|回答|submit|turn in/i.test(label)) return;
      rememberSubmitAttempt(event);
      window.setTimeout(() => {
        if (getAssignmentSubmittedLock()) return;
        markAssignmentSubmittedFromSubmitAttempt()
          .catch((error) => reportContentError('[ultimateMoocs:assignment]', error));
      }, 1800);
    },
    true,
  );
}

function pageKey() {
  return `${location.origin}${location.pathname}${location.search}`;
}

function getPageContext() {
  const headings = [...document.querySelectorAll('h1, h2, .content-header h1, .content-header h2')]
    .map((node) => node.textContent?.trim())
    .filter(Boolean);
  return {
    url: pageKey(),
    title: document.title || headings[0] || location.href,
    courseTitle: headings[0] || '',
    lectureTitle: headings[1] || headings[0] || '',
  };
}

function createButton(label, className = '') {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = className;
  button.textContent = label;
  return button;
}

function normalizeMemoRecord(record) {
  const context = getPageContext();
  return {
    url: record?.url || context.url,
    title: record?.title || context.title,
    courseTitle: record?.courseTitle || context.courseTitle,
    lectureTitle: record?.lectureTitle || context.lectureTitle,
    updatedAt: record?.updatedAt || new Date().toISOString(),
    notes: Array.isArray(record?.notes) ? record.notes : [],
  };
}

async function saveCurrentMemoRecord(record) {
  const memos = await getMemos();
  memos[pageKey()] = normalizeMemoRecord(record);
  await saveMemos(memos);
}

function downloadText(filename, text, type = 'text/plain') {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function sanitizePathPart(value, fallback = 'untitled') {
  const reserved = /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/i;
  let text = String(value || fallback)
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/[\u0000-\u001f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/g, '');
  if (!text) text = fallback;
  if (reserved.test(text)) text = `${text}_file`;
  return text.slice(0, 100);
}

function filenameFromUrl(url, fallback = 'download') {
  try {
    const parsed = new URL(url, location.href);
    const name = decodeURIComponent(parsed.pathname.split('/').filter(Boolean).at(-1) || fallback);
    return sanitizePathPart(name, fallback);
  } catch {
    return sanitizePathPart(fallback, fallback);
  }
}

function parseMoocsRoute(rawUrl = location.href) {
  try {
    const url = new URL(rawUrl, location.href);
    if (url.host !== location.host) return null;
    const match = url.pathname.match(MOOCS_ROUTE_PATTERN);
    if (!match?.groups) return null;
    return {
      url,
      year: match.groups.year || '',
      course: match.groups.course || '',
      lecture: match.groups.lecture || '',
      page: match.groups.page || '',
    };
  } catch {
    return null;
  }
}

function getCanonicalMoocsPageUrl(rawUrl = location.href) {
  try {
    const url = new URL(rawUrl, location.href);
    if (url.host === location.host && url.pathname.startsWith('/courses/')) {
      url.hash = '';
      url.search = '';
      return url.href.replace(/\/+$/, '');
    }
    url.hash = '';
    url.searchParams.delete('_');
    return url.href.replace(/\/+$/, '');
  } catch {
    return String(rawUrl || '').replace(/[?#].*$/, '').replace(/\/+$/, '');
  }
}

function getLearningToolsSignature() {
  const heading =
    document.querySelector('.content-header h1, .content-header h2, h1, h2')?.textContent?.trim() || '';
  const answerInputCount = document.querySelectorAll(
    SUBMISSION_ANSWER_SELECTOR,
  ).length;
  const submitControlCount = [...document.querySelectorAll('button, input[type="submit"], input[type="button"], a.btn')]
    .filter((node) => !isExtensionUiNode(node))
    .filter((node) => /提出|送信|回答|submit|turn in/i.test(node.textContent || node.value || node.getAttribute('aria-label') || ''))
    .length;
  return [getCanonicalMoocsPageUrl(), document.title, heading, answerInputCount, submitControlCount].join('|');
}

function isExtensionUiNode(node) {
  return Boolean(node?.closest?.('[data-um-module], [data-um-owned="true"]'));
}

function isDomElement(node) {
  return Boolean(node && node.nodeType === 1 && typeof node.matches === 'function');
}

function getPageTitle(doc, pageUrl) {
  const title =
    [...doc.querySelectorAll('h1, h2, .content-header h1, .content-header h2, .box-title')]
      .map((node) => node.textContent?.trim())
      .filter(Boolean)
      .find(Boolean) || '';
  if (title) return title;
  try {
    return new URL(pageUrl, location.href).pathname.split('/').filter(Boolean).at(-1) || 'page';
  } catch {
    return 'page';
  }
}

function normalizeLabelText(value) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim();
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function isLikelyLectureLabel(value) {
  const text = normalizeLabelText(value);
  return /^(#?\d+|第?\d+回|lecture\s*\d+|part\s*\d+|[0-9]{1,2}[-:：].+)$/i.test(text);
}

function getCourseTitleCandidate(doc, route) {
  const courseCode = normalizeLabelText(route?.course || '');
  const candidates = [
    ...doc.querySelectorAll(
      '.breadcrumb li, .breadcrumb a, .content-header h1, .content-header h2, h1, h2, .box-title',
    ),
  ]
    .map((node) => normalizeLabelText(node.textContent))
    .filter(Boolean)
    .filter((text) => text !== courseCode)
    .filter((text) => !/^\d{4}$/.test(text))
    .filter((text) => !/^#?\d+$/.test(text))
    .filter((text) => !isLikelyLectureLabel(text));

  const nonGeneric = candidates.find((text) => !/^(list of courses|course|courses|講義|資料)$/i.test(text));
  return nonGeneric || '';
}

function buildCourseFolderName(doc, route) {
  const courseCode = normalizeLabelText(route?.course || '');
  const courseTitle = courseCode
    ? getCourseTitleCandidate(doc, route).replace(new RegExp(`\\[?${escapeRegExp(courseCode)}\\]?`, 'i'), '').trim()
    : getCourseTitleCandidate(doc, route);
  if (courseCode && courseTitle) return `${courseTitle}[${courseCode}]`;
  return courseCode || courseTitle || document.title || 'course';
}

function getDownloadContext(doc = document, pageUrl = location.href) {
  const headings = [...doc.querySelectorAll('h1, h2, .content-header h1, .content-header h2')]
    .map((node) => node.textContent?.trim())
    .filter(Boolean);
  const route = parseMoocsRoute(pageUrl);
  const year = route?.year || new Date().getFullYear();
  const lectureName = getPageTitle(doc, pageUrl);
  return {
    year: String(year),
    courseName: buildCourseFolderName(doc, route) || headings[0] || document.title || 'course',
    lectureGroup: route?.lecture || headings[1] || 'lecture',
    lectureName,
  };
}

function buildDownloadFilename(candidate, context) {
  const lectureGroup = sanitizePathPart(context.lectureGroup);
  const lectureName = sanitizePathPart(context.lectureName);
  const shouldIncludeLectureName =
    lectureName &&
    lectureName !== lectureGroup &&
    !lectureName.toLowerCase().startsWith(`${lectureGroup.toLowerCase()}_`);
  const parts = [
    'moocs-ultimate',
    context.year,
    context.courseName,
    lectureGroup,
    shouldIncludeLectureName ? lectureName : '',
    candidate.filename,
  ]
    .filter(Boolean)
    .map((part) => sanitizePathPart(part));
  return parts.join('/');
}

function convertDriveUrl(url) {
  try {
    const parsed = new URL(url, location.href);
    if (!/drive\.google\.com$/i.test(parsed.hostname)) return url;
    const fileMatch = parsed.pathname.match(/\/file\/d\/([^/]+)/);
    const id = fileMatch?.[1] || parsed.searchParams.get('id');
    return id ? `https://drive.google.com/uc?export=download&id=${encodeURIComponent(id)}` : url;
  } catch {
    return url;
  }
}

function getDownloadCandidateId(entry) {
  return `${entry.kind || 'unknown'}::${entry.url || entry.downloadUrl || entry.filename}`;
}

function getDownloadCandidateKind(entry) {
  if (entry.kind === 'google_slides') return 'slides';
  if (/drive\.google\.com/i.test(entry.url || entry.downloadUrl || '')) return 'drive';
  if (entry.disabled && /stream/i.test(entry.disabledReason || '')) return 'streaming';
  if (entry.kind === 'direct_file') return 'file';
  return 'unknown';
}

function getDownloadKindLabel(kind) {
  const labels = {
    slides: 'Slides',
    drive: 'Drive',
    file: 'File',
    streaming: 'Streaming',
    unknown: 'Other',
  };
  return labels[kind] || labels.unknown;
}

function getDownloadCandidateTitle(entry) {
  const filename = String(entry.filename || '').split('/').filter(Boolean).at(-1);
  return filename || entry.url || 'download';
}

function normalizeDownloadCandidate(entry) {
  const id = getDownloadCandidateId(entry);
  const kindLabel = getDownloadCandidateKind(entry);
  return {
    ...entry,
    id,
    candidateKind: kindLabel,
    title: getDownloadCandidateTitle(entry),
    selectable: !entry.disabled,
  };
}

function candidateFromUrl(rawUrl, source, context, label = '', baseUrl = location.href) {
  let url;
  try {
    url = new URL(rawUrl, baseUrl);
  } catch {
    return null;
  }

  if (!/^https?:$/.test(url.protocol)) return null;
  const href = url.href;
  const isSlides = /docs\.google\.com\/presentation/i.test(href);
  const isDriveFile = /drive\.google\.com\/file\/d\//i.test(href) || /drive\.google\.com\/open\?id=/i.test(href);
  const isDirect = DIRECT_FILE_PATTERN.test(url.pathname) || isDriveFile;
  const isStreaming = STREAMING_PATTERN.test(url.pathname);

  if (!isSlides && !isDirect && !isStreaming) return null;
  if (url.host === location.host && !DIRECT_FILE_PATTERN.test(url.pathname)) return null;

  const baseName = label || filenameFromUrl(href, isSlides ? 'google-slides' : 'download');
  const extensionName = isSlides
    ? `${sanitizePathPart(baseName, 'google-slides')}.slides`
    : filenameFromUrl(href, sanitizePathPart(baseName, 'download'));
  const candidate = {
    url: href,
    sourceUrl: href,
    downloadUrl: isDriveFile ? convertDriveUrl(href) : href,
    source,
    kind: isSlides ? 'google_slides' : 'direct_file',
    filename: extensionName,
    disabled: isStreaming,
    disabledReason: isStreaming ? 'Streaming playlist is not downloaded in this phase' : '',
  };
  candidate.filename = buildDownloadFilename(candidate, context);
  return candidate;
}

function collectCandidatesFromDocument(doc = document, pageUrl = location.href) {
  const context = getDownloadContext(doc, pageUrl);
  const candidates = [];

  for (const link of doc.querySelectorAll('a[href]')) {
    if (isExtensionUiNode(link)) continue;
    const candidate = candidateFromUrl(
      link.getAttribute('href'),
      'link',
      context,
      link.textContent?.trim(),
      pageUrl,
    );
    if (candidate) candidates.push(candidate);
  }

  for (const frame of doc.querySelectorAll('iframe[src], embed[src]')) {
    if (isExtensionUiNode(frame)) continue;
    const candidate = candidateFromUrl(
      frame.getAttribute('src'),
      frame.tagName.toLowerCase(),
      context,
      frame.title,
      pageUrl,
    );
    if (candidate) candidates.push(candidate);
  }

  for (const object of doc.querySelectorAll('object[data]')) {
    if (isExtensionUiNode(object)) continue;
    const candidate = candidateFromUrl(object.getAttribute('data'), 'object', context, object.title, pageUrl);
    if (candidate) candidates.push(candidate);
  }

  return [...new Map(candidates.map((candidate) => [candidate.url, candidate])).values()];
}

function getLectureToolsMountTarget() {
  return (
    document.querySelector('.content-wrapper .content') ||
    document.querySelector('.content-wrapper') ||
    document.body
  );
}

function ensureLectureToolsPanel() {
  if (!lectureToolsPanel) {
    lectureToolsPanel = document.createElement('section');
    lectureToolsPanel.className = 'um-lecture-tools';
    lectureToolsPanel.dataset.umModule = 'lecture-tools';
    lectureToolsPanel.dataset.activeTool = '';
    lectureToolsPanel.innerHTML = `
      <div class="um-lecture-tools-bar">
        <div>
          <span class="um-lecture-tools-kicker">MOOCS ULTIMATE</span>
          <strong>講義ツール</strong>
        </div>
        <div class="um-lecture-assignment-check" data-um-module="assignment-check">
          <button type="button" data-um-assignment-check>この回の課題を確認</button>
          <span class="um-lecture-assignment-status" data-state="idle">未確認</span>
        </div>
        <div class="um-lecture-tools-tabs" role="tablist" aria-label="MOOCs Ultimate 講義ツール">
          <button type="button" data-um-tool-tab="downloads" aria-selected="false" hidden>資料保存</button>
          <button type="button" data-um-tool-tab="ai" aria-selected="false" hidden>AI要約</button>
          <button type="button" data-um-tool-close hidden>閉じる</button>
        </div>
      </div>
      <div class="um-lecture-tools-panes" hidden>
        <div class="um-lecture-tool-pane" data-um-tool-pane="downloads" hidden></div>
        <div class="um-lecture-tool-pane" data-um-tool-pane="ai" hidden></div>
      </div>
      <div class="um-lecture-assignment-list" data-um-assignment-list hidden></div>
    `;
    lectureToolsPanel.addEventListener('click', (event) => {
      const tab = event.target instanceof Element ? event.target.closest('[data-um-tool-tab]') : null;
      if (tab) {
        const key = tab.getAttribute('data-um-tool-tab');
        setLectureToolActive(lectureToolsPanel.dataset.activeTool === key ? '' : key);
        return;
      }
      if (event.target instanceof Element && event.target.closest('[data-um-assignment-check]')) {
        collectCurrentLectureAssignments().catch((error) => {
          if (isExtensionContextInvalidated(error)) return;
          reportContentError('[ultimateMoocs:assignment]', error);
          updateLectureAssignmentCheckStatus('確認に失敗しました', 'error');
          showToast(error?.message || 'この回の課題確認に失敗しました。');
        });
        return;
      }
      if (event.target instanceof Element && event.target.closest('[data-um-tool-close]')) {
        setLectureToolActive('');
      }
    });
  }

  const mountTarget = getLectureToolsMountTarget();
  if (lectureToolsPanel.parentElement !== mountTarget) {
    mountTarget.prepend(lectureToolsPanel);
  }
  return lectureToolsPanel;
}

function getLectureToolPane(key) {
  return ensureLectureToolsPanel().querySelector(`[data-um-tool-pane="${key}"]`);
}

function setLectureToolActive(key) {
  if (!lectureToolsPanel) return;
  lectureToolsPanel.dataset.activeTool = key || '';
  const panes = lectureToolsPanel.querySelector('.um-lecture-tools-panes');
  panes.hidden = !key;
  const closeButton = lectureToolsPanel.querySelector('[data-um-tool-close]');
  if (closeButton) closeButton.hidden = !key;
  for (const tab of lectureToolsPanel.querySelectorAll('[data-um-tool-tab]')) {
    const active = tab.getAttribute('data-um-tool-tab') === key;
    tab.setAttribute('aria-selected', String(active));
  }
  for (const pane of lectureToolsPanel.querySelectorAll('[data-um-tool-pane]')) {
    pane.hidden = pane.getAttribute('data-um-tool-pane') !== key;
  }
}

function updateLectureToolTab(key, label, enabled = true) {
  if (!lectureToolsPanel) return;
  const tab = lectureToolsPanel.querySelector(`[data-um-tool-tab="${key}"]`);
  if (!tab) return;
  const statusText = tab.dataset.umToolStatus || '';
  tab.replaceChildren();
  const main = document.createElement('span');
  main.className = 'um-tool-tab-main';
  main.textContent = label;
  tab.append(main);
  if (statusText) {
    const status = document.createElement('span');
    status.className = 'um-tool-tab-status';
    status.textContent = statusText;
    tab.append(status);
  }
  tab.hidden = !enabled;
  if (!enabled && lectureToolsPanel.dataset.activeTool === key) {
    setLectureToolActive('');
  }
}

function updateLectureToolTabStatus(key, statusText = '', statusState = '') {
  if (!lectureToolsPanel) return;
  const tab = lectureToolsPanel.querySelector(`[data-um-tool-tab="${key}"]`);
  if (!tab) return;
  tab.dataset.umToolStatus = statusText;
  tab.dataset.umToolState = statusState;
  const label = tab.querySelector('.um-tool-tab-main')?.textContent || tab.textContent || key;
  updateLectureToolTab(key, label, !tab.hidden);
  tab.title = statusText ? `${label}: ${statusText}` : label;
}

function updateLectureAssignmentCheckStatus(text, state = 'idle') {
  if (!lectureToolsPanel) return;
  const status = lectureToolsPanel.querySelector('.um-lecture-assignment-status');
  const button = lectureToolsPanel.querySelector('[data-um-assignment-check]');
  if (status) {
    status.textContent = text;
    status.dataset.state = state;
  }
  if (button) {
    button.disabled = state === 'checking';
  }
}

function getLectureAssignmentSummaryText(records, removed = 0) {
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

function getLectureAssignmentSummaryState(records) {
  if (!records.length) return 'empty';
  if (records.some((record) => getAssignmentDeadlineState(record).alert)) return 'action';
  if (records.some((record) => record.status === 'not_submitted' || record.status === 'pending_confirmation')) return 'action';
  if (records.some((record) => record.status === 'unchecked' || record.status === 'unknown')) return 'unchecked';
  if (records.every((record) => record.status === 'submitted')) return 'complete';
  return 'idle';
}

function getAssignmentRecordDisplayTitle(record) {
  const route = parseMoocsRoute(record?.url || record?.pageKey || '');
  const routeLabel = route?.page ? route.page.replace(/^.*?(\d+(?:-\d+)?)$/, '$1') : '';
  const title = normalizeLabelText(record?.title || record?.lectureName || '');
  if (!title) return routeLabel ? `課題 ${routeLabel}` : '課題';
  const compact = title.replace(/\s*[:：]\s*INIAD MOOCs$/i, '').replace(/\s*\|\s*INIAD MOOCs$/i, '');
  if (routeLabel && !compact.includes(routeLabel)) return `${routeLabel}: ${compact}`;
  return compact;
}

function getAssignmentEvidenceLabel(record) {
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

function getAssignmentEvidenceText(result, record = {}) {
  const label = getAssignmentEvidenceLabel({ ...record, ...result });
  const evidence = normalizeLabelText(result?.evidence || record?.evidence || '');
  return evidence ? `根拠: ${label} / ${evidence}` : `根拠: ${label}`;
}

function renderLectureAssignmentMiniList(records) {
  if (!lectureToolsPanel) return;
  const list = lectureToolsPanel.querySelector('[data-um-assignment-list]');
  if (!list) return;
  list.replaceChildren();
  const visibleRecords = records.filter((record) => record?.status).sort((a, b) => {
    const deadlineOrder = compareAssignmentDeadlineUrgency(a, b);
    if (deadlineOrder) return deadlineOrder;
    const pageOrder = sortAssignmentCollectedLinks([a, b]);
    if (pageOrder[0]?.url === pageOrder[1]?.url) return 0;
    return pageOrder[0] === a ? -1 : 1;
  });
  list.hidden = visibleRecords.length === 0;
  if (!visibleRecords.length) return;
  const heading = document.createElement('div');
  heading.className = 'um-lecture-assignment-list-heading';
  heading.textContent = 'この回の課題';
  list.append(heading);
  for (const record of visibleRecords) {
    const deadline = getAssignmentDeadlineState(record);
    const link = document.createElement('a');
    link.className = 'um-lecture-assignment-item';
    link.dataset.status = record.status || 'unknown';
    link.dataset.deadlineTone = deadline.tone;
    link.href = record.url || record.pageKey || '#';
    link.title = [deadline.label, record.evidence, '期限は課題ページで編集できます。'].filter(Boolean).join('\n');
    const title = document.createElement('span');
    title.className = 'um-lecture-assignment-title';
    title.textContent = getAssignmentRecordDisplayTitle(record);
    const meta = document.createElement('span');
    meta.className = 'um-lecture-assignment-meta';
    meta.textContent = getAssignmentEvidenceLabel(record);
    const status = document.createElement('span');
    status.className = 'um-lecture-assignment-chip';
    status.textContent = getAssignmentStatusLabel(record.status);
    const deadlineText = document.createElement('span');
    deadlineText.className = 'um-lecture-assignment-deadline';
    deadlineText.dataset.tone = deadline.tone;
    deadlineText.textContent = deadline.label;
    link.append(title, meta, status, deadlineText);
    list.append(link);
  }
}

function getAssignmentRecordsForCurrentLecture(allStatuses) {
  const currentRoute = parseMoocsRoute(location.href);
  if (!currentRoute?.year || !currentRoute?.course || !currentRoute?.lecture) return [];
  const attendancePageUrls = getCurrentLectureAttendancePageUrls();
  const records = new Map();
  for (const [key, record] of Object.entries(allStatuses || {})) {
    if (!record || typeof record !== 'object') continue;
    const rawUrl = record.url || record.pageKey || key;
    const route = parseMoocsRoute(rawUrl);
    if (!route) continue;
    if (route.year !== currentRoute.year || route.course !== currentRoute.course || route.lecture !== currentRoute.lecture) continue;
    const canonicalUrl = getCanonicalMoocsPageUrl(rawUrl);
    if (attendancePageUrls.has(canonicalUrl)) continue;
    records.set(canonicalUrl, {
      ...record,
      url: canonicalUrl,
      pageKey: record.pageKey || canonicalUrl,
    });
  }
  return dedupeAssignmentRecords(sortAssignmentCollectedLinks([...records.values()]));
}

async function refreshLectureAssignmentCheckStatusFromStorage() {
  if (lectureAssignmentCheckBusy) return;
  if (!lectureToolsPanel) return;
  const route = parseMoocsRoute(location.href);
  if (!route?.course || !route.lecture) return;
  try {
    await reconcileCurrentPageAssignmentStatusWithDom();
    const allStatuses = await getAssignmentStatus();
    const removed = purgeAutoCollectedAttendanceRecords(allStatuses);
    if (removed > 0) await saveAssignmentStatus(allStatuses);
    const records = getAssignmentRecordsForCurrentLecture(allStatuses);
    updateLectureAssignmentCheckStatus(
      records.length ? getLectureAssignmentSummaryText(records) : '未確認',
      records.length ? getLectureAssignmentSummaryState(records) : 'idle',
    );
    renderLectureAssignmentMiniList(records);
  } catch (error) {
    reportContentError('[ultimateMoocs:assignment] summary refresh failed', error);
  }
}

async function reconcileCurrentPageAssignmentStatusWithDom() {
  if (!currentSettings?.assignments?.enableSubmissionCheck) return;
  if (!isAssignmentLikePage()) return;
  const storedRecord = await getStoredAssignmentRecordForCurrentPage();
  if (!storedRecord || storedRecord.status !== 'unpublished' || storedRecord.source === 'manual') return;
  const result = detectAssignmentSubmissionStatus();
  if (result.status === 'unpublished' || result.status === 'unknown') return;
  const record = createAssignmentRecord(result);
  await saveAssignmentRecordIfChanged(record);
}

function ensureLectureAssignmentCheck() {
  const enabled = Boolean(currentSettings?.assignments?.enableSubmissionCheck);
  const route = parseMoocsRoute(location.href);
  const isLecturePage = Boolean(route?.course && route?.lecture);
  if (!enabled || !isLecturePage) {
    if (!lectureToolsPanel) return;
    const check = lectureToolsPanel.querySelector('.um-lecture-assignment-check');
    if (check) check.hidden = true;
    return;
  }
  const panel = ensureLectureToolsPanel();
  const check = panel.querySelector('.um-lecture-assignment-check');
  if (check) check.hidden = false;
  refreshLectureAssignmentCheckStatusFromStorage();
}

function cleanupLectureToolsPanel() {
  if (!lectureToolsPanel) return;
  const hasAssignmentCheck = Boolean(
    currentSettings?.assignments?.enableSubmissionCheck &&
      parseMoocsRoute(location.href)?.course &&
      parseMoocsRoute(location.href)?.lecture,
  );
  const hasTools = Boolean(downloadPanel || aiSummaryPanel || hasAssignmentCheck);
  if (!hasTools) {
    lectureToolsPanel.remove();
    lectureToolsPanel = null;
  }
}

function getRouteLinksFromDocument(doc, pageUrl, predicate) {
  const links = [...doc.querySelectorAll('a[href]')]
    .map((link) => {
      if (isExtensionUiNode(link)) return null;
      try {
        const url = new URL(link.getAttribute('href'), pageUrl);
        const route = parseMoocsRoute(url.href);
        if (!route || !predicate(route, link)) return null;
        return {
          url,
          route,
          title: link.textContent?.trim().replace(/\s+/g, ' ') || '',
        };
      } catch {
        return null;
      }
    })
    .filter(Boolean);

  return [...new Map(links.map((entry) => [entry.url.href.replace(/#.*$/, ''), entry])).values()];
}

function getLecturePageLinksFromDocument(doc = document, pageUrl = location.href) {
  const currentRoute = parseMoocsRoute(pageUrl);
  if (!currentRoute?.course || !currentRoute.lecture) return [];
  return getRouteLinksFromDocument(doc, pageUrl, (route) => {
    if (route.year !== currentRoute.year || route.course !== currentRoute.course) return false;
    return route.lecture === currentRoute.lecture && Boolean(route.page);
  }).slice(0, MAX_LECTURE_PAGES);
}

function getCourseLectureLinksFromDocument(doc = document, pageUrl = location.href) {
  const currentRoute = parseMoocsRoute(pageUrl);
  if (!currentRoute?.course) return [];
  return getRouteLinksFromDocument(doc, pageUrl, (route) => {
    if (route.year !== currentRoute.year || route.course !== currentRoute.course) return false;
    return Boolean(route.lecture) && !route.page;
  });
}

function uniqueRouteEntries(entries, maxCount = Infinity) {
  return [...new Map(entries.map((entry) => [entry.url.href.replace(/#.*$/, ''), entry])).values()].slice(
    0,
    maxCount,
  );
}

async function fetchHtmlDocument(url) {
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

async function mapWithConcurrency(items, limit, worker) {
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

async function collectLecturePageLinks(scope, options = {}) {
  const currentRoute = parseMoocsRoute(location.href);
  if (!currentRoute?.course) return [];
  const precollectedEntries = Array.isArray(options.precollectedEntries) ? options.precollectedEntries : null;
  const slidesOnly = Boolean(options.slidesOnly);

  if (scope === 'lecture') {
    const currentPages = getLecturePageLinksFromDocument();
    if (currentPages.length) return uniqueRouteEntries(currentPages, MAX_LECTURE_PAGES);
    const currentUrl = new URL(location.href);
    return [{ url: currentUrl, route: currentRoute, title: document.title }];
  }

  const courseUrl = currentRoute.lecture
    ? new URL(`/courses/${currentRoute.year}/${currentRoute.course}`, location.origin)
    : new URL(location.href);
  const courseDoc = currentRoute.lecture ? await fetchHtmlDocument(courseUrl) : document;
  const lectureLinks = uniqueRouteEntries(getCourseLectureLinksFromDocument(courseDoc, courseUrl.href));
  const pageLinks = [];
  let completed = 0;

  await mapWithConcurrency(lectureLinks, DOWNLOAD_FETCH_CONCURRENCY, async (lecture) => {
    try {
      const doc = await fetchHtmlDocument(lecture.url);
      if (precollectedEntries) {
        const candidates = collectCandidatesFromDocument(doc, lecture.url.href);
        precollectedEntries.push(
          ...(slidesOnly ? candidates.filter((candidate) => candidate.kind === 'google_slides') : candidates),
        );
      }
      const links = getLecturePageLinksFromDocument(doc, lecture.url.href);
      pageLinks.push(...(links.length ? links : [lecture]));
    } catch (error) {
      reportContentError(`[ultimateMoocs:downloads] lecture collection failed ${lecture.url.href}`, error);
      pageLinks.push(lecture);
    } finally {
      completed += 1;
      updateDownloadPanelStatus(`講義ページ一覧を収集中... ${completed}/${lectureLinks.length}`);
    }
  });

  const lectureUrlKeys = new Set(lectureLinks.map((entry) => entry.url.href.replace(/#.*$/, '')));
  return uniqueRouteEntries(pageLinks, MAX_COURSE_PAGES).filter(
    (entry) => !lectureUrlKeys.has(entry.url.href.replace(/#.*$/, '')),
  );
}

async function fetchCandidatesFromPages(pageEntries, slidesOnly = false) {
  const entries = [];
  let completed = 0;

  await mapWithConcurrency(pageEntries, DOWNLOAD_FETCH_CONCURRENCY, async (entry) => {
    try {
      const doc = await fetchHtmlDocument(entry.url);
      const candidates = collectCandidatesFromDocument(doc, entry.url.href);
      entries.push(...(slidesOnly ? candidates.filter((candidate) => candidate.kind === 'google_slides') : candidates));
    } catch (error) {
      reportContentError(`[ultimateMoocs:downloads] page collection failed ${entry.url.href}`, error);
    } finally {
      completed += 1;
      updateDownloadPanelStatus(`資料候補を収集中... ${completed}/${pageEntries.length}`);
    }
  });

  return entries;
}

async function collectDownloadEntries(scope, slidesOnly = false) {
  let entries = collectCandidatesFromDocument();
  if (scope === 'lecture' || scope === 'course') {
    updateDownloadPanelStatus(`MOOCsページ構造を解析中... ${scope}`);
    const precollectedEntries = [];
    const pageLinks = await collectLecturePageLinks(scope, { precollectedEntries, slidesOnly });
    entries.push(...precollectedEntries, ...(await fetchCandidatesFromPages(pageLinks, slidesOnly)));
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

  return [...new Map(entries.map((entry) => [entry.url, entry])).values()].map(normalizeDownloadCandidate);
}

function updateDownloadPanelStatus(text) {
  downloadPanel?.querySelector('.um-download-status')?.replaceChildren(document.createTextNode(text));
}

function summarizeDownloadCandidates(entries) {
  const counts = entries.reduce(
    (acc, entry) => {
      const kind = entry.candidateKind || getDownloadCandidateKind(entry);
      acc.total += 1;
      acc[kind] = (acc[kind] || 0) + 1;
      if (entry.disabled) acc.disabled += 1;
      return acc;
    },
    { total: 0, disabled: 0 },
  );
  const parts = [
    `全${counts.total}件`,
    `Slides ${counts.slides || 0}`,
    `Drive ${counts.drive || 0}`,
    `File ${counts.file || 0}`,
  ];
  if (counts.streaming) parts.push(`Streaming ${counts.streaming}`);
  if (counts.disabled) parts.push(`無効 ${counts.disabled}`);
  return parts.join(' / ');
}

function renderDownloadCandidates() {
  if (!downloadPanel) return;
  const list = downloadPanel.querySelector('.um-download-candidate-list');
  const summary = downloadPanel.querySelector('.um-download-candidate-summary');
  const saveSelectedButton = downloadPanel.querySelector('[data-um-download="save-selected"]');
  if (!list || !summary) return;

  const entries = downloadCandidateState.entries;
  const selectedCount = entries.filter((entry) => downloadCandidateState.selectedIds.has(entry.id)).length;
  updateLectureToolTab('downloads', entries.length ? `資料保存 ${entries.length}件` : '資料保存', true);
  summary.textContent = entries.length
    ? `${summarizeDownloadCandidates(entries)} / 選択 ${selectedCount}`
    : '候補はまだ検出されていません。';
  if (saveSelectedButton) saveSelectedButton.disabled = selectedCount === 0;
  list.replaceChildren();

  for (const entry of entries) {
    const row = document.createElement('label');
    row.className = 'um-download-candidate';
    row.dataset.umCandidateKind = entry.candidateKind;
    if (entry.disabled) row.dataset.umCandidateDisabled = 'true';

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = downloadCandidateState.selectedIds.has(entry.id);
    checkbox.disabled = Boolean(entry.disabled);
    checkbox.dataset.umCandidateId = entry.id;

    const body = document.createElement('span');
    body.className = 'um-download-candidate-body';

    const titleLine = document.createElement('span');
    titleLine.className = 'um-download-candidate-title';
    titleLine.textContent = entry.title;

    const metaLine = document.createElement('span');
    metaLine.className = 'um-download-candidate-meta';
    metaLine.textContent = [
      getDownloadKindLabel(entry.candidateKind),
      entry.source,
      entry.disabled ? entry.disabledReason : '',
    ]
      .filter(Boolean)
      .join(' / ');

    body.append(titleLine, metaLine);
    row.append(checkbox, body);
    list.append(row);
  }
}

async function detectDownloadCandidates(scope, slidesOnly = false, slidesFormat = '') {
  if (!downloadPanel) return;
  setLectureToolActive('downloads');
  downloadCandidateState = {
    entries: [],
    selectedIds: new Set(),
    scope,
    slidesFormat,
  };
  renderDownloadCandidates();
  updateDownloadPanelStatus('資料候補を検出中...');

  let entries = await collectDownloadEntries(scope, slidesOnly);
  if (slidesFormat) {
    entries = entries.map((entry) =>
      entry.kind === 'google_slides' ? { ...entry, exportFormat: slidesFormat } : entry,
    );
  }

  downloadCandidateState = {
    entries,
    selectedIds: new Set(entries.filter((entry) => !entry.disabled).map((entry) => entry.id)),
    scope,
    slidesFormat,
  };
  renderDownloadCandidates();
  updateDownloadPanelStatus(entries.length ? '保存する資料を確認してください。' : '資料候補が見つかりませんでした。');
}

async function startDownloadForScope(scope) {
  await detectDownloadCandidates(scope, false, 'pdf');
  await enqueueSelectedDownloadCandidates();
}

function handleDownloadActionError(error) {
  if (isExtensionContextInvalidated(error)) {
    updateDownloadPanelStatus('拡張機能を更新しました。ページを再読み込みしてください。');
    return;
  }
  reportContentError('[ultimateMoocs:downloads]', error);
  updateDownloadPanelStatus(error?.message || 'ダウンロード処理に失敗しました。');
}

async function enqueueSelectedDownloadCandidates() {
  if (!downloadPanel) return;
  const entries = downloadCandidateState.entries.filter((entry) => downloadCandidateState.selectedIds.has(entry.id));
  if (!entries.length) {
    updateDownloadPanelStatus('保存対象が選択されていません。');
    return;
  }

  const response = await runtimeSendMessage(
    createMessage(MESSAGE_TYPES.downloadEnqueue, {
      scope: downloadCandidateState.scope,
      entries,
    }),
  );
  if (!response?.ok) {
    updateDownloadPanelStatus(response?.error || 'ダウンロードを開始できませんでした。');
  }
}

async function renderDownloadState() {
  if (!downloadPanel) return;
  const response = await runtimeSendMessage(createMessage(MESSAGE_TYPES.downloadStateGet));
  const state = response?.payload?.state;
  if (!state) return;

  const progress = downloadPanel.querySelector('.um-download-progress-bar');
  const total = Number(state.total || 0);
  const completed = Math.min(Math.max(0, Number(state.completed || 0)), total);
  const failed = Math.min(Math.max(0, Number(state.failed || 0)), Math.max(0, total - completed));
  const done = Math.min(total, completed + failed);
  progress.style.width = total ? `${Math.round((done / total) * 100)}%` : '0%';
  downloadPanel.querySelector('.um-download-current').textContent = state.currentFile || '-';
  downloadPanel.querySelector('.um-download-counts').textContent = `完了 ${completed} / 失敗 ${failed} / 全 ${total}`;
  downloadPanel.querySelector('.um-download-status').textContent = state.status || 'idle';
  const mode = downloadPanel.querySelector('.um-download-mode');
  if (mode) {
    mode.textContent = state.downloadModeLabel || '';
    mode.hidden = !state.downloadModeLabel;
    mode.dataset.umDownloadMode =
      state.downloadModeLabel === '回避ダウンロード' ? 'fallback' : state.downloadModeLabel ? 'fast' : '';
  }

  const failures = downloadPanel.querySelector('.um-download-failures');
  failures.replaceChildren();
  for (const failure of (state.failures || []).slice(-failed)) {
    const item = document.createElement('li');
    item.textContent = `${failure.filename}: ${failure.reason}`;
    failures.append(item);
  }
}

function ensureDownloadPanel() {
  const downloads = currentSettings?.downloads || {};
  const enabled = Boolean(downloads.enableDownloadPanel);
  const route = parseMoocsRoute(location.href);
  const isCoursePage = Boolean(route?.course);

  if (!enabled || !isCoursePage) {
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
    downloadPanel = document.createElement('section');
    downloadPanel.className = 'um-download-panel';
    downloadPanel.dataset.umModule = 'downloads';
	    downloadPanel.innerHTML = `
	      <div class="um-panel-header">
	        <div>
	          <span class="um-download-kicker">MOOCS ULTIMATE</span>
	          <strong>資料保存</strong>
	        </div>
	        <button type="button" data-um-download="cancel">キャンセル</button>
	      </div>
	      <div class="um-download-actions">
	        <button type="button" data-um-download="course">この科目を収集</button>
	        <button type="button" data-um-download="lecture">この回の資料を全部保存</button>
	        <button type="button" data-um-download="page">このページの資料を保存</button>
	      </div>
	      <section class="um-slide-text-tool" data-state="idle">
	        <div class="um-slide-text-header">
	          <div>
	            <strong>スライド本文抽出</strong>
	            <span>AIを使わず、Google Slidesの本文をテキスト化します。</span>
	          </div>
	          <button type="button" data-um-download="extract-slide-text">本文を抽出</button>
	        </div>
	        <p class="um-slide-text-status">このページのSlidesを検出して本文を抽出できます。</p>
	        <div class="um-slide-text-actions" hidden>
	          <span class="um-slide-text-count"></span>
	          <button type="button" data-um-download="copy-slide-text">コピー</button>
	          <button type="button" data-um-download="save-slide-text">TXT保存</button>
	        </div>
	        <textarea class="um-slide-text-output" rows="10" readonly hidden aria-label="抽出したスライド本文"></textarea>
	        <ul class="um-slide-text-results"></ul>
	      </section>
	      <div class="um-download-progress"><div class="um-download-progress-bar"></div></div>
	      <details class="um-download-details">
	        <summary>
	          <span class="um-download-status">idle</span>
	          <span class="um-download-mode" hidden></span>
	          <span class="um-download-counts">完了 0 / 失敗 0 / 全 0</span>
	        </summary>
	        <p>現在: <span class="um-download-current">-</span></p>
	        <div class="um-download-candidates">
	          <div class="um-download-candidate-summary">候補はまだ検出されていません。</div>
	          <div class="um-download-candidate-list"></div>
	        </div>
          <ul class="um-download-failures"></ul>
	      </details>
	    `;
	    downloadPanel.addEventListener('click', (event) => {
        const button = event.target instanceof Element ? event.target.closest('[data-um-download]') : null;
        if (!button) return;
        const action = button.dataset.umDownload;
        if (action === 'cancel') {
          runtimeSendMessage(createMessage(MESSAGE_TYPES.downloadCancel))
            .then(renderDownloadState)
            .catch((error) => {
              if (!isExtensionContextInvalidated(error)) {
                reportContentError('[ultimateMoocs:downloads]', error);
              }
            });
        } else if (action === 'page') {
          startDownloadForScope('page').catch(handleDownloadActionError);
        } else if (action === 'lecture') {
          startDownloadForScope('lecture').catch(handleDownloadActionError);
        } else if (action === 'course') {
          startDownloadForScope('course').catch(handleDownloadActionError);
        } else if (action === 'extract-slide-text') {
          extractSlideTextFromDownloadPanel().catch(handleSlideTextActionError);
        } else if (action === 'copy-slide-text') {
          copyExtractedSlideText().catch(handleSlideTextActionError);
        } else if (action === 'save-slide-text') {
          saveExtractedSlideText();
        }
      });
      downloadPanel.addEventListener('change', (event) => {
        const checkbox = event.target instanceof HTMLInputElement ? event.target : null;
        if (!checkbox?.matches('[data-um-candidate-id]')) return;
        if (checkbox.checked) {
          downloadCandidateState.selectedIds.add(checkbox.dataset.umCandidateId);
        } else {
          downloadCandidateState.selectedIds.delete(checkbox.dataset.umCandidateId);
        }
        renderDownloadCandidates();
      });
  }

  const pane = getLectureToolPane('downloads');
  if (pane && downloadPanel.parentElement !== pane) pane.append(downloadPanel);
  syncSlideTextPanelForPage();
  updateLectureToolTab('downloads', '資料保存', true);

  downloadPanel.querySelector('[data-um-download="page"]').disabled = !downloads.enableCurrentPageDownload;
  downloadPanel.querySelector('[data-um-download="lecture"]').disabled = !downloads.enableLectureDownload;
  downloadPanel.querySelector('[data-um-download="course"]').disabled = !downloads.enableCourseDownload;
  renderDownloadState().catch((error) => {
    if (!isExtensionContextInvalidated(error)) {
      reportContentError('[ultimateMoocs:downloads]', error);
    }
  });
}

function getSlideTextExtractionKey() {
  const urls = [...new Set(getPageSlidesUrls())].sort();
  return `${getCanonicalMoocsPageUrl()}\n${urls.join('\n')}`;
}

function getSlideTextMethodLabel(method) {
  if (method === 'svg_helper') return 'SVG';
  if (method === 'html_candidates') return 'HTML';
  if (method === 'export_txt') return 'テキスト出力';
  return '代替処理';
}

async function extractSlidesTextForCurrentPage({ force = false, onStatus } = {}) {
  const urls = [...new Set(getPageSlidesUrls())];
  const key = getSlideTextExtractionKey();
  if (!force && slideTextExtractionCache.has(key)) return slideTextExtractionCache.get(key);
  if (!urls.length) {
    return {
      key,
      sourceUrl: getCanonicalMoocsPageUrl(),
      title: getAiSummaryTitle(),
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
    .map((result, index) => [`--- Google Slides ${index + 1} ---`, cleanExtractedLectureText(result.text)].join('\n'))
    .join('\n\n')
    .trim();
  const extraction = {
    key,
    sourceUrl: getCanonicalMoocsPageUrl(),
    title: getAiSummaryTitle(),
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

function renderSlideTextExtraction(extraction) {
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
      ? `${getSlideTextMethodLabel(result.method)}で${result.text.length.toLocaleString()}文字を抽出`
      : `抽出失敗: ${result.error || result.url}`;
    resultsList.append(item);
  }
}

function syncSlideTextPanelForPage() {
  if (!downloadPanel) return;
  const sourceUrl = getCanonicalMoocsPageUrl();
  if (downloadPanel.dataset.umSlideTextSourceUrl === sourceUrl) return;
  downloadPanel.dataset.umSlideTextSourceUrl = sourceUrl;

  const cached = slideTextExtractionCache.get(getSlideTextExtractionKey());
  if (cached) {
    renderSlideTextExtraction(cached);
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

function setSlideTextPanelBusy(isBusy, statusText = '') {
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

async function extractSlideTextFromDownloadPanel() {
  if (slideTextExtractionBusy) return;
  setSlideTextPanelBusy(true, 'Slidesを検出しています...');
  try {
    const extraction = await extractSlidesTextForCurrentPage({
      force: true,
      onStatus: (text) => setSlideTextPanelBusy(true, text),
    });
    renderSlideTextExtraction(extraction);
  } finally {
    setSlideTextPanelBusy(false);
  }
}

function getExtractedSlideTextFromPanel() {
  return downloadPanel?.querySelector('.um-slide-text-output')?.value?.trim() || '';
}

async function copyExtractedSlideText() {
  const text = getExtractedSlideTextFromPanel();
  if (!text) throw new Error('コピーするSlides本文がありません。');
  await copyTextToClipboard(text);
  const status = downloadPanel?.querySelector('.um-slide-text-status');
  if (status) status.textContent = 'Slides本文をクリップボードにコピーしました。';
}

function saveExtractedSlideText() {
  const text = getExtractedSlideTextFromPanel();
  if (!text) {
    handleSlideTextActionError(new Error('保存するSlides本文がありません。'));
    return;
  }
  downloadText(`${sanitizePathPart(getAiSummaryTitle(), 'moocs-slides')}_slides.txt`, `${text}\n`);
  const status = downloadPanel?.querySelector('.um-slide-text-status');
  if (status) status.textContent = 'Slides本文をTXTで保存しました。';
}

function handleSlideTextActionError(error) {
  if (isExtensionContextInvalidated(error)) {
    setSlideTextPanelBusy(false, '拡張機能を更新しました。ページを再読み込みしてください。');
    return;
  }
  reportContentError('[ultimateMoocs:slides-text]', error);
  setSlideTextPanelBusy(false);
  const tool = downloadPanel?.querySelector('.um-slide-text-tool');
  const status = tool?.querySelector('.um-slide-text-status');
  if (tool) tool.dataset.state = 'error';
  if (status) {
    status.textContent = error?.message || 'Slides本文の抽出に失敗しました。';
    status.classList.add('error');
  }
}

function estimateAiPreviewTokens(text) {
  const normalized = String(text || '').trim();
  return normalized ? Math.ceil(normalized.length / 2.5) : 0;
}

function getAiSummaryTitle() {
  const context = getDownloadContext(document, location.href);
  return [context.courseName, context.lectureGroup, context.lectureName]
    .filter(Boolean)
    .join(' / ');
}

function isReadableTextNode(node) {
  if (!node || isExtensionUiNode(node)) return false;
  if (node.closest?.('.main-header, .main-sidebar, .control-sidebar, script, style, noscript')) return false;
  const text = normalizeLabelText(node.textContent);
  return text.length >= 2;
}

function collectPageTextForAi() {
  const context = getDownloadContext(document, location.href);
  const root =
    document.querySelector('.content-wrapper .content') ||
    document.querySelector('.content-wrapper') ||
    document.body;
  const chunks = [
    `科目: ${context.courseName}`,
    `講義回: ${context.lectureGroup}`,
    `ページ: ${context.lectureName}`,
    `URL: ${getCanonicalMoocsPageUrl()}`,
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
    if (!isReadableTextNode(node)) continue;
    const text = normalizeLabelText(node.textContent);
    if (seen.has(text)) continue;
    if (/^(bookmark|view course|search|shortcut|table of contents)$/i.test(text)) continue;
    seen.add(text);
    chunks.push(text);
  }

  return chunks.join('\n');
}

function isAiNoiseLine(value) {
  const text = normalizeLabelText(value);
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

function cleanExtractedLectureText(text) {
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
    if (isAiNoiseLine(line)) continue;

    const duplicateKey = line.replace(/\s+/g, ' ');
    const count = seen.get(duplicateKey) || 0;
    if (count >= 2 && !/^--- /.test(line)) continue;
    seen.set(duplicateKey, count + 1);
    cleaned.push(line);
  }

  return cleaned.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

function getPageSlidesUrls() {
  return collectCandidatesFromDocument()
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

function setAiPanelStatus(text, isError = false) {
  if (!aiSummaryPanel) return;
  const status = aiSummaryPanel.querySelector('.um-ai-status');
  status.textContent = text;
  status.classList.toggle('error', isError);
}

function setAiBusy(isBusy) {
  aiSummaryBusy = isBusy;
  if (!aiSummaryPanel) return;
  aiSummaryPanel.dataset.umAiBusy = String(isBusy);
  for (const button of aiSummaryPanel.querySelectorAll('[data-um-ai="summarize"], [data-um-ai="regenerate"]')) {
    button.disabled = isBusy;
  }
  if (!isBusy && aiSummaryPanel.dataset.cachedSummaryKey && getAiSummaryOutputText()) {
    updateAiSummaryActionState({ hasCachedSummary: true, isShowingCached: true });
  }
}

function updateAiTokenEstimateIndicator(estimatedTokens = null) {
  if (!aiSummaryPanel) return;
  const indicator = aiSummaryPanel.querySelector('.um-ai-token-indicator');
  if (!indicator) return;

  if (!Number.isFinite(estimatedTokens) || estimatedTokens <= 0) {
    indicator.dataset.state = 'unknown';
    indicator.textContent = '「抽出して要約」を押すと、送信前に今回使うtoken数を確認できます';
    return;
  }

  const parts = [`送信予定 約${estimatedTokens.toLocaleString()} tokens`];
  if (estimatedTokens >= 12000) {
    indicator.dataset.state = 'warn';
    parts.push('長めの資料です');
  } else {
    indicator.dataset.state = 'ok';
  }
  indicator.textContent = parts.join(' / ');
}

function normalizeAiMatchText(value) {
  return normalizeLabelText(value)
    .toLowerCase()
    .replace(/[［\[]([a-z]{2,}\d{3})[］\]]/gi, '$1')
    .replace(/[^\p{L}\p{N}]+/gu, '');
}

function aiRoutesMatch(itemUrl, currentUrl = getCanonicalMoocsPageUrl()) {
  const itemRoute = parseMoocsRoute(itemUrl);
  const currentRoute = parseMoocsRoute(currentUrl);
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

function aiTitleExactlyMatches(itemTitle, currentTitle = getAiSummaryTitle()) {
  const item = normalizeAiMatchText(itemTitle);
  const current = normalizeAiMatchText(currentTitle);
  if (!item || !current) return false;
  return item === current;
}

function aiSourceMatchesPage(item, currentUrl, currentTitle) {
  const itemUrl = getCanonicalMoocsPageUrl(item.sourceUrl);
  if (item.sourceUrl && itemUrl === currentUrl) return true;
  if (item.sourceUrl) return aiRoutesMatch(item.sourceUrl, currentUrl);
  return aiTitleExactlyMatches(item.title, currentTitle);
}

function mapAiSummaryItem(cacheKey, item) {
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

async function findLocalAiSummariesForPage() {
  const summaries = await getAiSummaries();
  const currentUrl = getCanonicalMoocsPageUrl();
  const currentTitle = getAiSummaryTitle();
  return Object.entries(summaries)
    .filter(([, item]) => item && typeof item === 'object' && typeof item.summary === 'string')
    .map(([cacheKey, item]) => mapAiSummaryItem(cacheKey, item))
    .filter((item) => aiSourceMatchesPage(item, currentUrl, currentTitle))
    .sort((a, b) => String(b.updatedAt || b.createdAt).localeCompare(String(a.updatedAt || a.createdAt)));
}

async function fetchPageAiSummaries() {
  let remoteSummaries = [];
  try {
    const response = await runtimeSendMessage(
      createMessage(MESSAGE_TYPES.aiSummaryList, {
        sourceUrl: getCanonicalMoocsPageUrl(),
        title: getAiSummaryTitle(),
      }),
    );
    if (!response?.ok) throw new Error(response?.error || 'AI要約履歴を取得できませんでした。');
    remoteSummaries = response.payload?.summaries || [];
  } catch (error) {
    if (!isExtensionContextInvalidated(error)) {
      reportContentError('[ultimateMoocs:ai] background summary lookup failed; trying local storage', error);
    }
  }

  const localSummaries = await findLocalAiSummariesForPage();
  const merged = [...remoteSummaries, ...localSummaries];
  return [...new Map(merged.map((item) => [item.cacheKey, item])).values()].sort((a, b) =>
    String(b.updatedAt || b.createdAt).localeCompare(String(a.updatedAt || a.createdAt)),
  );
}

function resetAiSummaryPanelForPage(sourceUrl) {
  if (!aiSummaryPanel) return;
  if (aiSummaryPanel.dataset.umSourceUrl === sourceUrl) return;

  aiSummaryPanel.dataset.umSourceUrl = sourceUrl;
  aiSummaryPanel.dataset.cachedSummaryKey = '';
  aiSummaryDraft = {
    title: '',
    sourceUrl: '',
    text: '',
    slideResults: [],
  };

  const output = aiSummaryPanel.querySelector('.um-ai-output');
  const outputActions = aiSummaryPanel.querySelector('.um-ai-output-actions');
  const cacheRow = aiSummaryPanel.querySelector('.um-ai-cache-row');
  const cacheText = aiSummaryPanel.querySelector('.um-ai-cache-text');

  if (output) {
    output.hidden = true;
    output.dataset.rawSummary = '';
    output.replaceChildren();
  }
  if (outputActions) outputActions.hidden = true;
  if (cacheRow) cacheRow.hidden = true;
  if (cacheText) cacheText.textContent = '';
  updateAiSummaryActionState({ hasCachedSummary: false, isShowingCached: false });
  updateAiTokenEstimateIndicator(null);
}

function updateAiSummaryActionState({ hasCachedSummary = false, isShowingCached = false } = {}) {
  if (!aiSummaryPanel) return;
  const mainButton = aiSummaryPanel.querySelector('[data-um-ai="summarize"]');
  const regenerateButton = aiSummaryPanel.querySelector('[data-um-ai="regenerate"]');
  if (mainButton) {
    mainButton.hidden = isShowingCached;
    mainButton.textContent = '抽出して要約';
    mainButton.title = 'ページ本文とSlides本文を抽出してAI要約を作成します。';
    mainButton.disabled = aiSummaryBusy;
  }
  if (regenerateButton) regenerateButton.hidden = !hasCachedSummary;
}

function formatRelativeDateTime(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const diffMs = Date.now() - date.getTime();
  const diffMinutes = Math.max(0, Math.round(diffMs / 60000));
  if (diffMinutes < 1) return 'たった今';
  if (diffMinutes < 60) return `${diffMinutes}分前`;
  const diffHours = Math.round(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours}時間前`;
  const diffDays = Math.round(diffHours / 24);
  if (diffDays < 7) return `${diffDays}日前`;
  return date.toLocaleDateString();
}

function updateAiSummaryStateView({ cached = false, updatedAt = '', hasApiKey = true } = {}) {
  if (!aiSummaryPanel) return;
  const state = aiSummaryPanel.querySelector('.um-ai-state');
  if (!state) return;

  let label = '未作成';
  let detail = hasApiKey ? 'このページの要約はまだありません' : 'APIキー未設定';
  let stateName = hasApiKey ? 'empty' : 'missing-key';
  let tabStatus = hasApiKey ? '未作成' : 'API未設定';

  if (cached) {
    const relative = formatRelativeDateTime(updatedAt);
    label = '保存済み';
    detail = relative ? `${relative}に作成 / API未使用で表示` : 'API未使用で表示できます';
    stateName = 'cached';
    tabStatus = '保存済み';
  }

  state.dataset.state = stateName;
  state.replaceChildren();
  const badge = document.createElement('span');
  badge.className = 'um-ai-state-badge';
  badge.textContent = label;
  const text = document.createElement('span');
  text.textContent = detail;
  state.append(badge, text);
  updateLectureToolTabStatus('ai', tabStatus, stateName);
}

async function refreshAiSummaryCacheStatus() {
  if (!aiSummaryPanel) return;
  resetAiSummaryPanelForPage(getCanonicalMoocsPageUrl());
  const cacheRow = aiSummaryPanel.querySelector('.um-ai-cache-row');
  const cacheText = aiSummaryPanel.querySelector('.um-ai-cache-text');
  const output = aiSummaryPanel.querySelector('.um-ai-output');
  try {
    const summaries = await fetchPageAiSummaries();
    const latest = summaries[0];
    const hasApiKey = Boolean(currentSettings?.ai?.apiKey?.trim());
    aiSummaryPanel.dataset.cachedSummaryKey = latest?.cacheKey || '';
    cacheRow.hidden = !latest;
    updateAiSummaryActionState({
      hasCachedSummary: Boolean(latest),
      isShowingCached: Boolean(latest && output?.dataset.rawSummary),
    });
    updateLectureToolTab('ai', latest ? 'AI要約 ✓' : 'AI要約', true);
    updateAiSummaryStateView({
      cached: Boolean(latest),
      updatedAt: latest?.updatedAt || latest?.createdAt || '',
      hasApiKey,
    });
    if (latest) {
      const date = latest.updatedAt || latest.createdAt || '';
      cacheText.textContent = `保存済み要約を使用できます${date ? ` / 作成 ${new Date(date).toLocaleString()}` : ''}`;
      if (!output?.dataset.rawSummary) {
        renderAiSummary(latest.summary, {
          ...latest,
          cached: true,
          autoShown: true,
        });
      }
    }
  } catch (error) {
    cacheRow.hidden = true;
    updateAiSummaryStateView({
      cached: false,
      hasApiKey: Boolean(currentSettings?.ai?.apiKey?.trim()),
    });
    reportContentError('[ultimateMoocs:ai] cache status failed', error);
  }
}

async function showCachedAiSummary() {
  const summaries = await fetchPageAiSummaries();
  const latest = summaries[0];
  if (!latest) {
    setAiPanelStatus('このページの保存済み要約はまだありません。');
    return;
  }
  renderAiSummary(latest.summary, {
    ...latest,
    cached: true,
  });
}

function appendInlineMarkdown(parent, text) {
  const pattern = /(\*\*[^*]+\*\*|`[^`]+`)/g;
  let lastIndex = 0;
  for (const match of text.matchAll(pattern)) {
    if (match.index > lastIndex) {
      parent.append(document.createTextNode(text.slice(lastIndex, match.index)));
    }
    const token = match[0];
    if (token.startsWith('**')) {
      const strong = document.createElement('strong');
      strong.textContent = token.slice(2, -2);
      parent.append(strong);
    } else {
      const code = document.createElement('code');
      code.textContent = token.slice(1, -1);
      parent.append(code);
    }
    lastIndex = match.index + token.length;
  }
  if (lastIndex < text.length) {
    parent.append(document.createTextNode(text.slice(lastIndex)));
  }
}

function renderMarkdownBlocks(markdown) {
  const fragment = document.createDocumentFragment();
  const lines = String(markdown || '').replace(/\r\n?/g, '\n').split('\n');
  let list = null;
  let listType = '';

  const closeList = () => {
    if (list) {
      fragment.append(list);
      list = null;
      listType = '';
    }
  };

  for (const rawLine of lines) {
    const line = rawLine.replace(/\s+$/g, '');
    if (!line.trim()) {
      closeList();
      continue;
    }

    const heading = /^(#{1,4})\s+(.+)$/.exec(line);
    if (heading) {
      closeList();
      const level = Math.min(4, Math.max(2, heading[1].length + 1));
      const element = document.createElement(`h${level}`);
      appendInlineMarkdown(element, heading[2].trim());
      fragment.append(element);
      continue;
    }

    const unordered = /^(\s*)[-*]\s+(.+)$/.exec(line);
    const ordered = /^(\s*)\d+\.\s+(.+)$/.exec(line);
    const listMatch = unordered || ordered;
    if (listMatch) {
      const nextType = ordered ? 'ol' : 'ul';
      if (!list || listType !== nextType) {
        closeList();
        list = document.createElement(nextType);
        listType = nextType;
      }
      const item = document.createElement('li');
      const depth = Math.min(3, Math.floor((listMatch[1] || '').length / 2));
      if (depth) item.style.marginLeft = `${depth * 18}px`;
      appendInlineMarkdown(item, listMatch[2].trim());
      list.append(item);
      continue;
    }

    closeList();
    const paragraph = document.createElement('p');
    appendInlineMarkdown(paragraph, line.trim());
    fragment.append(paragraph);
  }

  closeList();
  return fragment;
}

function renderAiSummary(summary, meta = {}) {
  if (!aiSummaryPanel) return;
  const output = aiSummaryPanel.querySelector('.um-ai-output');
  const outputActions = aiSummaryPanel.querySelector('.um-ai-output-actions');
  output.hidden = false;
  outputActions.hidden = false;
  output.dataset.rawSummary = summary;
  output.replaceChildren(renderMarkdownBlocks(summary));
  const cached = meta.cached ? '保存済み要約を表示中。APIは使っていません' : '新しい要約を作成しました';
  const warnings = Array.isArray(meta.warnings) ? meta.warnings.filter(Boolean) : [];
  const warningText = warnings.length ? ` / ${warnings.join(' / ')}` : '';
  const tokenText = meta.cached ? '' : ` / 約${Number(meta.estimatedInputTokens || 0).toLocaleString()} input tokens`;
  setAiPanelStatus(`${cached}${tokenText}${warningText}`);
  if (meta.cached) {
    updateAiSummaryActionState({ hasCachedSummary: true, isShowingCached: true });
  }
}

function getAiSummaryOutputText() {
  return aiSummaryPanel?.querySelector('.um-ai-output')?.dataset.rawSummary?.trim() || '';
}

async function copyAiSummaryOutput() {
  const text = getAiSummaryOutputText();
  if (!text) {
    setAiPanelStatus('コピーする要約がありません。', true);
    return;
  }
  await copyTextToClipboard(text);
  setAiPanelStatus('要約をクリップボードにコピーしました。');
}

function downloadAiSummaryOutput() {
  const text = getAiSummaryOutputText();
  if (!text) {
    setAiPanelStatus('保存する要約がありません。', true);
    return;
  }
  downloadText(`${sanitizePathPart(getAiSummaryTitle(), 'moocs-ai-summary')}.txt`, `${text}\n`);
  setAiPanelStatus('要約TXTを書き出しました。');
}

async function appendAiSummaryToMemo() {
  const text = getAiSummaryOutputText();
  if (!text) {
    setAiPanelStatus('メモに追加する要約がありません。', true);
    return;
  }
  const record = normalizeMemoRecord((await getMemos())[pageKey()]);
  const now = new Date().toISOString();
  record.notes.unshift({
    id: `memo-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    body: `AI要約\n\n${text}`,
    createdAt: now,
    updatedAt: now,
  });
  record.updatedAt = now;
  await saveCurrentMemoRecord(record);
  await renderMemoPanel();
  setAiPanelStatus('要約をページメモに追加しました。');
}

async function prepareAiSummaryDraft() {
  if (!aiSummaryPanel) return;
  if (aiSummaryBusy) return;
  setAiBusy(true);
  try {
    setAiPanelStatus('ページ本文を抽出しています...');
    const pageText = collectPageTextForAi();
    const extraction = await extractSlidesTextForCurrentPage({
      onStatus: (text) => setAiPanelStatus(text),
    });
    const slideText = extraction.text;
    const maxInputChars = Math.max(1000, Number(currentSettings?.ai?.maxInputChars || 24000));
    const combinedText = [pageText, slideText].filter(Boolean).join('\n\n');
    const text = cleanExtractedLectureText(combinedText).slice(0, maxInputChars);
    aiSummaryDraft = {
      title: getAiSummaryTitle(),
      sourceUrl: getCanonicalMoocsPageUrl(),
      text,
      slideResults: extraction.results,
    };
    updateAiTokenEstimateIndicator(estimateAiPreviewTokens(text));
    const truncated = combinedText.length > text.length ? ' 最大入力文字数に合わせて末尾を省略しました。' : '';
    const slideCount = extraction.results.filter((result) => result.ok).length;
    setAiPanelStatus(`要約する本文を準備しました${slideCount ? ` / Slides ${slideCount}件` : ''}。${truncated}`);
  } finally {
    setAiBusy(false);
  }
}

async function runAiSummary({ forceRefresh = false } = {}) {
  if (!aiSummaryPanel) return;
  if (aiSummaryBusy) return;
  setLectureToolActive('ai');
  const currentSourceUrl = getCanonicalMoocsPageUrl();
  if (!aiSummaryDraft.text || aiSummaryDraft.sourceUrl !== currentSourceUrl) {
    setAiPanelStatus('要約用テキストを準備しています...');
    await prepareAiSummaryDraft();
  }
  const text = aiSummaryDraft.text.trim();
  if (!text) {
    setAiPanelStatus('要約するテキストがありません。', true);
    return;
  }
  const estimatedTokens = estimateAiPreviewTokens(text);
  updateAiTokenEstimateIndicator(estimatedTokens);
  if (currentSettings?.ai?.confirmBeforeSend) {
    const warning = estimatedTokens >= 12000 ? '\n\n長めの資料なのでtoken消費が多めになる可能性があります。' : '';
    const ok = window.confirm(
      `送信予定: 約${estimatedTokens.toLocaleString()} tokens\n抽出テキスト: ${text.length.toLocaleString()}文字${warning}\n\n要約しますか？`,
    );
    if (!ok) {
      setAiPanelStatus('AI要約をキャンセルしました。');
      return;
    }
  }

  setAiBusy(true);
  try {
    setAiPanelStatus('INIAD AI MOPへ送信しています...');
    const response = await runtimeSendMessage(
      createMessage(MESSAGE_TYPES.aiSummarize, {
        title: aiSummaryDraft.title || getAiSummaryTitle(),
        sourceUrl: aiSummaryDraft.sourceUrl || getCanonicalMoocsPageUrl(),
        text,
        forceRefresh,
      }),
    );
    if (!response?.ok) {
      setAiPanelStatus(response?.error || 'AI要約に失敗しました。', true);
      return;
    }
    renderAiSummary(response.payload?.summary || '', response.payload || {});
    await refreshAiSummaryCacheStatus();
  } finally {
    setAiBusy(false);
  }
}

function ensureAiSummaryPanel() {
  const enabled = Boolean(currentSettings?.ai?.enableAiSummary);
  const route = parseMoocsRoute(location.href);
  const isLecturePage = Boolean(route?.course && route?.lecture);

  if (!enabled || !isLecturePage) {
    aiSummaryPanel?.remove();
    aiSummaryPanel = null;
    updateLectureToolTabStatus('ai', '', '');
    updateLectureToolTab('ai', 'AI要約', false);
    return;
  }

  if (!aiSummaryPanel) {
    aiSummaryPanel = document.createElement('section');
    aiSummaryPanel.className = 'um-ai-panel';
    aiSummaryPanel.dataset.umModule = 'ai-summary';
    aiSummaryPanel.innerHTML = `
      <div class="um-panel-header">
        <div>
          <span class="um-ai-kicker">MOOCS ULTIMATE AI</span>
          <strong>スライド要約</strong>
        </div>
        <div class="um-ai-actions">
          <button type="button" data-um-ai="summarize">抽出して要約</button>
        </div>
      </div>
      <p class="um-ai-status">保存済みの要約があれば、APIを使わずここに表示します。</p>
      <p class="um-ai-state" data-state="empty">
        <span class="um-ai-state-badge">未作成</span>
        <span>このページの要約はまだありません</span>
      </p>
      <p class="um-ai-token-indicator" data-state="unknown">「抽出して要約」を押すと、送信前に今回使うtoken数を確認できます</p>
      <div class="um-ai-cache-row" hidden>
        <span class="um-ai-cache-text"></span>
        <button type="button" data-um-ai="regenerate">再生成</button>
      </div>
      <div class="um-ai-output" hidden></div>
      <div class="um-ai-output-actions" hidden>
        <button type="button" data-um-ai="copy">コピー</button>
        <button type="button" data-um-ai="download">TXT保存</button>
        <button type="button" data-um-ai="memo">メモへ追加</button>
      </div>
    `;
    aiSummaryPanel.addEventListener('click', (event) => {
      const button = event.target instanceof Element ? event.target.closest('[data-um-ai]') : null;
      if (!button) return;
      const action = button.dataset.umAi;
      if (action === 'summarize') {
        const hasCachedSummary = Boolean(aiSummaryPanel?.dataset.cachedSummaryKey);
        const task = hasCachedSummary ? showCachedAiSummary() : runAiSummary();
        task.catch((error) => {
          reportContentError('[ultimateMoocs:ai]', error);
          setAiPanelStatus(error?.message || '要約に失敗しました。', true);
        });
      } else if (action === 'regenerate') {
        const ok = window.confirm(
          '保存済み要約を使わず、INIAD AI MOPでこのページの要約を作り直します。tokenを消費します。よろしいですか？',
        );
        if (!ok) {
          setAiPanelStatus('再生成をキャンセルしました。保存済み要約はそのままです。');
          return;
        }
        runAiSummary({ forceRefresh: true }).catch((error) => {
          reportContentError('[ultimateMoocs:ai]', error);
          setAiPanelStatus(error?.message || '再生成に失敗しました。', true);
        });
      } else if (action === 'copy') {
        copyAiSummaryOutput().catch((error) => {
          reportContentError('[ultimateMoocs:ai]', error);
          setAiPanelStatus(error?.message || 'コピーに失敗しました。', true);
        });
      } else if (action === 'download') {
        downloadAiSummaryOutput();
      } else if (action === 'memo') {
        appendAiSummaryToMemo().catch((error) => {
          reportContentError('[ultimateMoocs:ai]', error);
          setAiPanelStatus(error?.message || 'メモ追加に失敗しました。', true);
        });
      }
    });
  }
  const pane = getLectureToolPane('ai');
  if (pane && aiSummaryPanel.parentElement !== pane) pane.append(aiSummaryPanel);
  updateLectureToolTab('ai', 'AI要約', true);
  refreshAiSummaryCacheStatus().catch((error) => reportContentError('[ultimateMoocs:ai] cache refresh failed', error));
  updateAiTokenEstimateIndicator(aiSummaryDraft.text ? estimateAiPreviewTokens(aiSummaryDraft.text) : null);
}

function getTodayLabels() {
  const day = new Date().getDay();
  const ja = ['日', '月', '火', '水', '木', '金', '土'][day];
  const en = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][day];
  return [ja, en];
}

function getMainContentRoot() {
  return (
    document.querySelector('.content-wrapper .content') ||
    document.querySelector('.content-wrapper') ||
    document.body
  );
}

function isAssignmentLikePage() {
  const kind = classifyDocument();
  const activeNumberTab = document.querySelector(
    '.pagination > .active > a, .pagination > .active > span, .pagination > .active > button',
  );
  const activeTabKind = activeNumberTab ? classifyTab(activeNumberTab) : '';
  if (isAttendanceTabKind(kind) || isAttendanceTabKind(activeTabKind)) return false;
  if (kind === 'assignment') return true;
  const route = parseMoocsRoute(location.href);
  if (!route?.course || !route?.lecture) return false;
  if (hasSubmissionFormInDocument(document)) return true;
  const titleText = [
    document.title,
    ...[...document.querySelectorAll('h1, h2, h3, .content-header, .box-title')]
      .map((node) => normalizeLabelText(node.textContent))
      .filter(Boolean)
      .slice(0, 10),
  ].join(' ');
  return /課題|assignment|homework|report/i.test(titleText);
}

function getVisibleContentLines() {
  const root = getMainContentRoot();
  const nodes = [
    ...root.querySelectorAll(
      'h1, h2, h3, h4, p, li, tr, td, th, label, textarea, pre, code, .box, .panel, .card, .content-header, .box-title',
    ),
  ].filter((node) => !isExtensionUiNode(node));
  const lines = nodes
    .map((node) => normalizeLabelText(node.innerText || node.textContent || ''))
    .flatMap((text) => text.split(/(?<=。)|[\n\r]+/))
    .map((line) => normalizeLabelText(line))
    .filter((line) => line.length >= 2);
  const bodyClone = document.body.cloneNode(true);
  for (const node of bodyClone.querySelectorAll('[class^="um-"], [class*=" um-"], [data-um-module]')) {
    node.remove();
  }
  const fallbackLines = normalizeLabelText(bodyClone.textContent || '')
    .split(/(?<=。)|[\n\r]+/)
    .map((line) => normalizeLabelText(line))
    .filter((line) => line.length >= 2);
  return [...new Set([...lines, ...fallbackLines])];
}

function getDeadlineCandidateLines() {
  const root = getMainContentRoot();
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
    if (parent && !isExtensionUiNode(parent) && !parent.closest(excludedSelector)) {
      const text = normalizeLabelText(node.textContent || '');
      if (text.length >= 2) lines.push(text);
    }
    node = walker.nextNode();
  }
  return [...new Set(lines)];
}

function isLikelyAssignmentUrl() {
  const route = parseMoocsRoute(location.href);
  const page = route?.page || '';
  const path = route?.url?.pathname || location.pathname;
  return /(?:report|assignment|homework|submit|task|kadai)/i.test(`${page} ${path}`);
}

function findAssignmentEvidence(lines, patterns, rejectPatterns = []) {
  for (const line of lines) {
    if (!patterns.some((pattern) => pattern.test(line))) continue;
    if (rejectPatterns.some((pattern) => pattern.test(line))) continue;
    return line.slice(0, 180);
  }
  return '';
}

function hasSubmissionForm() {
  return hasSubmissionFormInDocument(document);
}

function isAvailableSubmissionNode(doc, node) {
  // Elements created inside the rendered inspection iframe belong to another
  // JavaScript realm, so `node instanceof Element` is false for valid nodes.
  if (!isDomElement(node)) return false;
  if (isExtensionUiNode(node)) return false;
  if (doc === document) return isVisibleContentNode(node);
  return !isStaticallyHiddenNode(node);
}

function isAvailableSubmissionAnswerNode(doc, node) {
  if (isAvailableSubmissionNode(doc, node)) return true;
  if (doc !== document || !node.matches('input[type="file"]')) return false;

  const problemRoot = node.closest('.problem-contentpage');
  if (!problemRoot || !isVisibleContentNode(problemRoot)) return false;
  const uploadRoot = node.closest('.file-container') || problemRoot;
  return [...uploadRoot.querySelectorAll('button, a.btn, label')]
    .filter((control) => isVisibleContentNode(control))
    .some((control) => /ファイルをアップロード|アップロード|upload/i.test(
      control.textContent || control.getAttribute('aria-label') || control.getAttribute('title') || '',
    ));
}

function hasSubmissionFormInDocument(doc = document) {
  if (isAttendanceDocument(doc)) return false;
  const hasForm = [...doc.querySelectorAll('form')].some((form) => {
    if (isExtensionUiNode(form)) return false;
    const hasAnswerInput = [...form.querySelectorAll(SUBMISSION_ANSWER_SELECTOR)]
      .some((node) => isAvailableSubmissionAnswerNode(doc, node));
    const submitText = [...form.querySelectorAll('button, input[type="submit"], input[type="button"]')]
      .filter((node) => isAvailableSubmissionNode(doc, node))
      .map((node) => node.textContent || node.value || node.getAttribute('aria-label') || '')
      .join(' ');
    return hasAnswerInput && /提出|送信|回答|submit|turn in/i.test(submitText);
  });
  if (hasForm) return true;

  const roots = [
    doc.querySelector('.content-wrapper .content'),
    doc.querySelector('.content-wrapper'),
    doc.querySelector('main'),
    doc.body,
  ].filter(Boolean);
  return roots.some((root) => {
    if (isExtensionUiNode(root)) return false;
    const hasAnswerInput = [...root.querySelectorAll(SUBMISSION_ANSWER_SELECTOR)]
      .some((node) => isAvailableSubmissionAnswerNode(doc, node));
    if (!hasAnswerInput) return false;
    const submitText = [...root.querySelectorAll('button, input[type="submit"], input[type="button"], a.btn')]
      .filter((node) => isAvailableSubmissionNode(doc, node))
      .map((node) => node.textContent || node.value || node.getAttribute('aria-label') || '')
      .join(' ');
    return /提出|送信|回答|submit|turn in/i.test(submitText);
  });
}

function getAssignmentLinkText(link) {
  return normalizeLabelText(
    [
      link.textContent,
      link.getAttribute('title'),
      link.getAttribute('aria-label'),
      link.closest('li, tr, .box, .panel, .card')?.textContent,
    ]
      .filter(Boolean)
      .join(' '),
  );
}

function hasAssignmentExclusionText(text) {
  return /課題\s*解説|解説\s*課題|解答|解答例|模範|答え合わせ|solution|explanation|スライド|資料|教材|bookmark|previous|next|google\s*slides|講義ツール|AI要約/i.test(
    text,
  );
}

function hasStrongAssignmentText(text) {
  return /(?:^|\s)(?:課題|レポート)\s*\d*|提出フォーム|提出してください|回答してください|回答は自動的に記録|assignment|homework|report|submit/i.test(
    text,
  );
}

function hasAssignmentTabHintText(text) {
  return /課題|問題|レポート|提出|回答|assignment|homework|report|submit|question/i.test(text);
}

function isStrongAssignmentUrl(url) {
  const route = parseMoocsRoute(url.href);
  const page = route?.page || '';
  const path = route?.url?.pathname || url.pathname;
  return /(?:report-\d+|report|assignment|homework|submit|task|kadai)/i.test(`${page} ${path}`);
}

function isAssignmentReviewUrl(url) {
  const route = parseMoocsRoute(url.href);
  const page = route?.page || '';
  const path = route?.url?.pathname || url.pathname;
  return /(?:^|\/)review(?:\/|$)|^review$/i.test(`${page} ${path}`);
}

function getAssignmentLinkCandidate(link, url) {
  const text = getAssignmentLinkText(link);
  const href = link.getAttribute('href') || '';
  const isPageTab = isNumberPageTab(link);
  const route = parseMoocsRoute(url.href);
  const page = route?.page || '';
  const tabKind = isPageTab ? classifyTab(link) : '';
  if (isAttendanceTabKind(tabKind)) {
    return {
      text,
      score: -10,
      reasons: ['attendance-page'],
      shouldVerify: false,
      likelyAssignment: false,
    };
  }
  let score = 0;
  const reasons = [];
  if (isPageTab) {
    score += 1;
    reasons.push('page-number-tab');
  }
  if (isStrongAssignmentUrl(url)) {
    score += 4;
    reasons.push('assignment-url');
  }
  if (isAssignmentReviewUrl(url)) {
    score += 2;
    reasons.push('assignment-review-url');
  }
  if (hasStrongAssignmentText(`${text} ${href}`)) {
    score += 3;
    reasons.push('assignment-text');
  }
  if (isPageTab && /^\d+(?:-\d+)?$/.test(page) && /課題|レポート|提出|回答/i.test(text)) {
    score += 3;
    reasons.push('assignment-tab-title');
  }
  if (isPageTab && hasAssignmentTabHintText(`${text} ${href}`)) {
    score += 2;
    reasons.push('assignment-tab-hint');
  }
  if (hasAssignmentExclusionText(text) && !isStrongAssignmentUrl(url)) {
    score -= 4;
    reasons.push('excluded-text');
  }
  if (
    reasons.includes('assignment-tab-title') ||
    reasons.includes('assignment-tab-hint') ||
    reasons.includes('assignment-review-url')
  ) {
    score = Math.max(score, 2);
  }
  return {
    text,
    score,
    reasons,
    shouldVerify: score >= 1 || reasons.includes('page-number-tab'),
    likelyAssignment: score >= 3,
  };
}

function getDocumentContentLines(doc = document) {
  return [
    ...doc.querySelectorAll('h1, h2, h3, h4, p, li, label, .box, .panel, .card, .content-header, .box-title'),
  ]
    .filter((node) => (doc === document ? isVisibleContentNode(node) : !isExtensionUiNode(node) && !isStaticallyHiddenNode(node)))
    .map((node) => normalizeLabelText(node.textContent || ''))
    .flatMap((text) => text.split(/(?<=。)|[\n\r]+/))
    .map((line) => normalizeLabelText(line))
    .filter((line) => line.length >= 2);
}

function isStaticallyHiddenNode(node) {
  if (!isDomElement(node)) return false;
  for (let element = node; element; element = element.parentElement) {
    if (element.hidden || element.getAttribute('aria-hidden') === 'true') return true;
    const style = (element.getAttribute('style') || '').replace(/\s+/g, '').toLowerCase();
    if (/display:none|visibility:hidden|opacity:0/.test(style)) return true;
  }
  return false;
}

function getDocumentUnpublishedAssignmentEvidence(doc = document) {
  if (hasSubmissionFormInDocument(doc)) return '';
  return findAssignmentEvidence(getDocumentContentLines(doc), [
    /現在この問題は非公開です。?/,
    /この問題は非公開です。?/,
    /問題は非公開です。?/,
  ]);
}

function getDocumentProblemOpenControlEvidence(doc = document) {
  const controls = [...doc.querySelectorAll('button, a.btn, a[href], input[type="button"], input[type="submit"]')].filter((node) =>
    doc === document ? isVisibleContentNode(node) : !isExtensionUiNode(node) && !isStaticallyHiddenNode(node),
  );
  for (const control of controls) {
    const text = normalizeLabelText(
      control.textContent || control.value || control.getAttribute('aria-label') || control.getAttribute('title') || '',
    );
    if (/問題を開く|問題を表示|open\s+(?:the\s+)?(?:problem|question)/i.test(text)) return text.slice(0, 120);
  }
  return '';
}

function getDocumentAssignmentHeading(doc = document) {
  const headings = [
    doc.title,
    ...[...doc.querySelectorAll('h1, h2, h3, .content-header h1, .content-header h2, .box-title')]
      .map((node) => normalizeLabelText(node.textContent))
      .filter(Boolean)
      .slice(0, 10),
  ]
    .map((text) => normalizeLabelText(text))
    .filter(Boolean);
  return headings.find((text) => {
    if (hasAssignmentExclusionText(text)) return false;
    return /^(?:課題|レポート)\s*\d+(?:[-ー－]\d+)?(?:\s|:|：|$)|^(?:assignment|homework|report)\s*\d+/i.test(text);
  }) || '';
}

function getDocumentAssignmentSignal(doc, url, candidate) {
  if (isAttendanceDocument(doc)) {
    return {
      ok: false,
      status: '',
      confidence: 'high',
      evidence: '出席確認ページのタイトルまたは教室・座席入力欄を検出しました。',
      attendancePage: true,
    };
  }
  const unpublishedEvidence = getDocumentUnpublishedAssignmentEvidence(doc);
  if (unpublishedEvidence) {
    const openControlEvidence = getDocumentProblemOpenControlEvidence(doc);
    if (openControlEvidence) {
      return {
        ok: true,
        status: 'unpublished',
        confidence: 'high',
        evidence: `${unpublishedEvidence} / ${openControlEvidence}`,
      };
    }
    if (candidate.reasons.includes('assignment-tab-title') || candidate.likelyAssignment) {
      return {
        ok: true,
        status: 'not_submitted',
        confidence: 'low',
        evidence: `課題タブを確認しました。初期HTMLの非公開表示は無視して、公開中の課題候補として扱います: ${unpublishedEvidence}`,
        uncertainUnpublished: true,
      };
    }
    if (candidate.reasons.includes('assignment-tab-hint') || candidate.reasons.includes('assignment-review-url')) {
      return {
        ok: true,
        status: 'unchecked',
        confidence: 'low',
        evidence: `課題・問題らしい番号タブを確認対象に追加しました。公開/非公開はページを開いて確認します: ${unpublishedEvidence}`,
        uncertainUnpublished: true,
      };
    }
    if (!candidate.likelyAssignment && !isStrongAssignmentUrl(url)) {
      return {
        ok: false,
        status: '',
        confidence: 'low',
        evidence: `非公開表示候補だけを検出しましたが、課題ページとは断定しません: ${unpublishedEvidence}`,
        uncertainUnpublished: true,
      };
    }
    return {
      ok: true,
      status: 'unchecked',
      confidence: 'low',
      evidence: `非公開表示候補を検出しました。公開中ページの初期HTMLにも出る場合があるため、ページを開いて確認します: ${unpublishedEvidence}`,
      uncertainUnpublished: true,
    };
  }
  if (hasSubmissionFormInDocument(doc)) {
    return {
      ok: true,
      status: 'not_submitted',
      confidence: 'medium',
      evidence: '提出フォームを検出しました。提出済み表示はまだ見つかっていません。',
    };
  }
  const problemRoot = doc.querySelector('.problem-contentpage');
  if (problemRoot && !isStaticallyHiddenNode(problemRoot)) {
    return {
      ok: true,
      status: 'unchecked',
      confidence: 'low',
      evidence: 'MOOCsの問題ページ領域を検出しました。回答欄の読み込み後に提出状態を確認します。',
    };
  }
  const titleText = [
    doc.title,
    ...[...doc.querySelectorAll('h1, h2, h3, .content-header, .box-title')]
      .map((node) => normalizeLabelText(node.textContent))
      .filter(Boolean)
      .slice(0, 10),
  ].join(' ');
  const assignmentHeading = getDocumentAssignmentHeading(doc);
  const lines = getDocumentContentLines(doc);
  const bodySignal = findAssignmentEvidence(lines, [
    /回答は自動的に記録されます/,
    /最後に「?提出」?ボタンをクリック/,
    /提出フォーム/,
    /ファイルをアップロード/,
  ]);
  const textLooksExcluded = hasAssignmentExclusionText(`${titleText} ${candidate.text}`) && !bodySignal;
  if (!textLooksExcluded && (bodySignal || assignmentHeading)) {
    return {
      ok: true,
      status: bodySignal ? 'not_submitted' : 'unchecked',
      confidence: bodySignal ? 'medium' : 'low',
      evidence: bodySignal
        ? `提出が必要そうな表示を検出しました: ${bodySignal}`
        : `課題ページ見出しを検出しました: ${assignmentHeading}`,
    };
  }
  if (candidate.likelyAssignment && !textLooksExcluded && isStrongAssignmentUrl(url)) {
    return {
      ok: true,
      status: 'unchecked',
      confidence: 'low',
      evidence: '課題らしいURLを検出しました。提出状態は未確認です。',
    };
  }
  return {
    ok: false,
    status: '',
    confidence: 'low',
    evidence: textLooksExcluded ? '課題解説・資料系の表示として除外しました。' : '課題提出ページとして確認できませんでした。',
  };
}

function sortAssignmentCollectedLinks(records) {
  return [...new Map(records.map((record) => [record.url, record])).values()].sort((a, b) => {
    const routeA = parseMoocsRoute(a.url);
    const routeB = parseMoocsRoute(b.url);
    const pageA = routeA?.page || a.url;
    const pageB = routeB?.page || b.url;
    return pageA.localeCompare(pageB, 'ja', { numeric: true });
  });
}

function getCurrentLecturePageUrls() {
  const currentRoute = parseMoocsRoute(location.href);
  if (!currentRoute?.year || !currentRoute?.course || !currentRoute?.lecture) return new Set();
  const urls = new Set([getCanonicalMoocsPageUrl()]);
  for (const link of document.querySelectorAll('.pagination a[href], .pagination span[href], .pagination button[href]')) {
    if (!isNumberPageTab(link)) continue;
    let url;
    try {
      url = new URL(link.getAttribute('href'), location.href);
    } catch {
      continue;
    }
    const route = parseMoocsRoute(url.href);
    if (!route) continue;
    if (route.year !== currentRoute.year || route.course !== currentRoute.course || route.lecture !== currentRoute.lecture) continue;
    urls.add(getCanonicalMoocsPageUrl(url.href));
  }
  return urls;
}

function getCurrentLectureAttendancePageUrls() {
  const urls = new Set(detectedAttendancePageUrls);
  if (isAttendanceDocument(document)) urls.add(getCanonicalMoocsPageUrl());
  for (const link of document.querySelectorAll('.pagination a, .pagination span, .pagination button')) {
    if (!isNumberPageTab(link) || !isAttendanceTabKind(classifyTab(link))) continue;
    const url = getTabCanonicalUrl(link);
    if (url) urls.add(url);
  }
  return urls;
}

function purgeAutoCollectedAttendanceRecords(allStatuses) {
  const attendancePageUrls = getCurrentLectureAttendancePageUrls();
  if (!attendancePageUrls.size) return 0;
  let removed = 0;
  for (const [key, record] of Object.entries(allStatuses || {})) {
    if (!record || record.source === 'manual') continue;
    const recordUrl = getCanonicalMoocsPageUrl(record.url || record.pageKey || key);
    if (!attendancePageUrls.has(recordUrl)) continue;
    delete allStatuses[key];
    removed += 1;
  }
  return removed;
}

function isWeakAutoCollectedAssignmentRecord(record) {
  return Boolean(
    record &&
      ['unchecked', 'unknown'].includes(record.status) &&
      ['lecture-link-collect', 'lecture-link-collect-fallback'].includes(record.source),
  );
}

function canUpgradeAutoCollectedAssignmentRecord(existing, nextRecord) {
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

async function inspectRenderedAssignmentCandidate(entry) {
  const frame = document.createElement('iframe');
  frame.dataset.umOwned = 'true';
  frame.tabIndex = -1;
  frame.setAttribute('aria-hidden', 'true');
  frame.style.cssText =
    'position:fixed!important;left:-10000px!important;top:0!important;width:1280px!important;height:800px!important;opacity:0!important;pointer-events:none!important;border:0!important;';

  try {
    const result = await new Promise((resolve) => {
      const startedAt = Date.now();
      let settled = false;
      let intervalId = 0;
      let timeoutId = 0;

      const finish = (value) => {
        if (settled) return;
        settled = true;
        window.clearInterval(intervalId);
        window.clearTimeout(timeoutId);
        resolve(value);
      };
      const inspect = () => {
        try {
          const doc = frame.contentDocument;
          if (!doc?.documentElement) return;
          const signal = getDocumentAssignmentSignal(doc, entry.url, entry.candidate);
          if (signal.attendancePage) {
            finish({ attendancePage: true });
            return;
          }
          if (signal.ok) {
            finish({
              signal,
              title: getPageTitle(doc, entry.url.href) || entry.linkText || '課題',
            });
            return;
          }
          if (doc.readyState === 'complete' && Date.now() - startedAt >= 1800) finish(null);
        } catch {
          // The final timeout handles redirects or inaccessible documents.
        }
      };

      intervalId = window.setInterval(inspect, 180);
      timeoutId = window.setTimeout(() => finish(null), 5000);
      frame.addEventListener('load', inspect);
      frame.src = entry.url.href;
      document.body.append(frame);
      inspect();
    });
    return result;
  } finally {
    frame.remove();
  }
}

async function collectAssignmentLinksForCurrentLecture() {
  const currentRoute = parseMoocsRoute(location.href);
  if (!currentRoute?.year || !currentRoute?.course || !currentRoute?.lecture) return [];
  detectedAttendancePageUrls.clear();
  const context = getDownloadContext(document, location.href);
  const candidates = [];
  for (const link of document.querySelectorAll('a[href]')) {
    if (isExtensionUiNode(link)) continue;
    let url;
    try {
      url = new URL(link.getAttribute('href'), location.href);
    } catch {
      continue;
    }
    if (url.hostname !== 'moocs.iniad.org') continue;
    const route = parseMoocsRoute(url.href);
    if (!route) continue;
    if (route.year !== currentRoute.year || route.course !== currentRoute.course || route.lecture !== currentRoute.lecture) continue;
    const canonicalUrl = getCanonicalMoocsPageUrl(url.href);
    if (canonicalUrl === getCanonicalMoocsPageUrl()) continue;
    const candidate = getAssignmentLinkCandidate(link, url);
    if (!candidate.shouldVerify) continue;
    candidates.push({
      url,
      canonicalUrl,
      candidate,
      linkText: normalizeLabelText(link.textContent) || candidate.text,
    });
  }
  const uniqueCandidates = [...new Map(candidates.map((candidate) => [candidate.canonicalUrl, candidate])).values()];
  const links = [];
  const renderedEntries = [];
  await mapWithConcurrency(uniqueCandidates, DOWNLOAD_FETCH_CONCURRENCY, async (entry) => {
    try {
      const doc = await fetchHtmlDocument(entry.url);
      const signal = getDocumentAssignmentSignal(doc, entry.url, entry.candidate);
      if (!signal.ok) {
        if (signal.attendancePage) {
          detectedAttendancePageUrls.add(entry.canonicalUrl);
          return;
        }
        renderedEntries.push(entry);
        return;
      }
      const title = getPageTitle(doc, entry.url.href) || entry.linkText || '課題';
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
  await mapWithConcurrency(
    [...new Map(renderedEntries.map((entry) => [entry.canonicalUrl, entry])).values()],
    ASSIGNMENT_RENDER_CONCURRENCY,
    async (entry) => {
      const rendered = await inspectRenderedAssignmentCandidate(entry);
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
          evidence: `描画後にMOOCsの問題ページを検出しました。提出状態と公開状態はページを直接開いた時に確定します: ${rendered.signal.evidence}`,
          source: 'lecture-link-collect',
          title: rendered.title,
          courseName: context.courseName,
          lectureGroup: context.lectureGroup,
          lectureName: rendered.title,
          checkedAt: new Date().toISOString(),
        });
        return;
      }
      if (!entry.staticError || !entry.candidate.likelyAssignment) return;
      links.push({
        url: entry.canonicalUrl,
        pageKey: entry.canonicalUrl,
        status: 'unchecked',
        confidence: 'low',
        evidence: `候補ページの確認に失敗しましたが、課題らしいリンクとして収集しました: ${entry.staticError?.message || entry.staticError}`,
        source: 'lecture-link-collect-fallback',
        title: entry.linkText || getPageTitle(document, entry.canonicalUrl) || '課題',
        courseName: context.courseName,
        lectureGroup: context.lectureGroup,
        lectureName: entry.linkText || context.lectureName,
        checkedAt: new Date().toISOString(),
      });
    },
  );
  return sortAssignmentCollectedLinks(links);
}

async function collectCurrentLectureAssignments() {
  lectureAssignmentCheckBusy = true;
  updateLectureAssignmentCheckStatus('確認中...', 'checking');
  try {
    await reconcileCurrentPageAssignmentStatusWithDom();
    const candidates = await collectAssignmentLinksForCurrentLecture();
    const allStatuses = await getAssignmentStatus();
    let added = 0;
    let updated = 0;
    let skipped = 0;
    let removed = purgeAutoCollectedAttendanceRecords(allStatuses);
    const candidateUrls = new Set(candidates.map((record) => record.url));
    const lecturePageUrls = getCurrentLecturePageUrls();
    for (const [key, record] of Object.entries(allStatuses)) {
      const recordUrl = getCanonicalMoocsPageUrl(record?.url || key);
      if (!lecturePageUrls.has(recordUrl)) continue;
      if (candidateUrls.has(recordUrl)) continue;
      if (!isWeakAutoCollectedAssignmentRecord(record)) continue;
      delete allStatuses[key];
      removed += 1;
    }
    if (!candidates.length) {
      if (removed > 0) await saveAssignmentStatus(allStatuses);
      const lectureRecords = getAssignmentRecordsForCurrentLecture(allStatuses);
      applyAssignmentTabStatusBadges();
      updateLectureAssignmentCheckStatus(
        lectureRecords.length ? getLectureAssignmentSummaryText(lectureRecords, removed) : getLectureAssignmentSummaryText([], removed),
        lectureRecords.length ? getLectureAssignmentSummaryState(lectureRecords) : removed > 0 ? 'idle' : 'empty',
      );
      renderLectureAssignmentMiniList(lectureRecords);
      showToast(`この回の課題は見つかりませんでした。整理 ${removed}件`);
      return;
    }
    for (const record of candidates) {
      const existing = allStatuses[record.url] || allStatuses[record.pageKey];
      if (canUpgradeAutoCollectedAssignmentRecord(existing, record)) {
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
    const lectureRecords = getAssignmentRecordsForCurrentLecture(allStatuses);
    applyAssignmentTabStatusBadges();
    updateLectureAssignmentCheckStatus(
      getLectureAssignmentSummaryText(lectureRecords, removed),
      getLectureAssignmentSummaryState(lectureRecords),
    );
    renderLectureAssignmentMiniList(lectureRecords);
    showToast(`この回の課題を確認しました。追加 ${added}件 / 更新 ${updated}件 / 整理 ${removed}件 / 既存 ${skipped}件`);
  } finally {
    lectureAssignmentCheckBusy = false;
  }
}

function detectAssignmentSubmissionStatus() {
  const lines = getVisibleContentLines();
  const negativePatterns = [/未提出|未回答|未送信|未作成|未着手|まだ提出|されていません|not\s+submitted/i];
  const submittedEvidence = findAssignmentEvidence(
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

  const unpublishedEvidence = getUnpublishedAssignmentEvidence();
  if (unpublishedEvidence) {
    return {
      status: 'unpublished',
      confidence: 'high',
      evidence: unpublishedEvidence,
      source: 'page-text-unpublished',
    };
  }

  const uploadedEvidence = getUploadedAssignmentEvidence(lines);
  if (uploadedEvidence) {
    return {
      status: 'pending_confirmation',
      confidence: 'medium',
      evidence: uploadedEvidence,
      source: 'uploaded-file',
    };
  }

  const notSubmittedEvidence = findAssignmentEvidence(lines, [
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
    pendingAssignmentSubmit?.url === getCanonicalMoocsPageUrl() &&
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

  if (hasSubmissionForm()) {
    return {
      status: 'not_submitted',
      confidence: 'low',
      evidence: '提出フォームらしき入力欄があります。提出済み表示は検出していません。',
      source: 'form-presence',
    };
  }

  if (isAssignmentLikePage() || isLikelyAssignmentUrl()) {
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

function getUploadedAssignmentEvidence(lines = getVisibleContentLines()) {
  return findAssignmentEvidence(lines, [
    /アップロード済み/,
    /アップロードしました/,
    /uploaded/i,
    /添付済み/,
    /ファイル.+保存/,
  ]);
}

function isVisibleContentNode(node) {
  if (!(node instanceof Element)) return false;
  if (isExtensionUiNode(node)) return false;
  const style = window.getComputedStyle(node);
  if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
  const rect = node.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

function getVisibleMainContentLines() {
  const root = getMainContentRoot();
  return [
    ...root.querySelectorAll('h1, h2, h3, h4, p, li, label, .box, .panel, .card, .content-header, .box-title'),
  ]
    .filter(isVisibleContentNode)
    .map((node) => normalizeLabelText(node.innerText || node.textContent || ''))
    .flatMap((text) => text.split(/(?<=。)|[\n\r]+/))
    .map((line) => normalizeLabelText(line))
    .filter((line) => line.length >= 2);
}

function getUnpublishedAssignmentEvidence() {
  if (hasSubmissionForm()) return '';
  return findAssignmentEvidence(getVisibleMainContentLines(), [
    /現在この問題は非公開です。?/,
    /この問題は非公開です。?/,
    /問題は非公開です。?/,
  ]);
}

function isAssignmentSavedAlert(message) {
  const text = normalizeLabelText(message);
  return /すべての回答を保存しました|全ての回答を保存しました|回答を保存しました|all\s+your\s+answers\s+have\s+been\s+saved/i.test(text);
}

function getAssignmentStatusLabel(status) {
  if (status === 'checking') return '確認中';
  if (status === 'unchecked') return '未確認';
  if (status === 'submitted') return '提出済み';
  if (status === 'pending_confirmation') return '確認待ち';
  if (status === 'not_submitted') return '要対応';
  if (status === 'unpublished') return '未公開';
  return '確認不能';
}

function getAssignmentStatusDescription(result) {
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

function createAssignmentRecord(result) {
  const context = getDownloadContext(document, location.href);
  return {
    url: getCanonicalMoocsPageUrl(),
    pageKey: pageKey(),
    status: result.status,
    confidence: result.confidence,
    evidence: result.evidence,
    source: result.source,
    attemptedAt: result.attemptedAt || '',
    title: getPageTitle(document, location.href),
    courseName: context.courseName,
    lectureGroup: context.lectureGroup,
    lectureName: context.lectureName,
    checkedAt: new Date().toISOString(),
  };
}

function assignmentResultFromRecord(record) {
  return {
    status: record.status || 'unknown',
    confidence: record.confidence || 'low',
    evidence: record.evidence || '保存済みの提出状態を表示しています。',
    source: record.source || 'storage',
    attemptedAt: record.attemptedAt || '',
  };
}

function isStrongSubmittedRecord(record) {
  return Boolean(record?.status === 'submitted' && record.confidence === 'high');
}

function getAssignmentRecordKeys(record) {
  return [...new Set([record?.url, record?.pageKey, getCanonicalMoocsPageUrl(), pageKey()].filter(Boolean))];
}

function setAssignmentSubmittedLock(record) {
  if (!isStrongSubmittedRecord(record)) return;
  const lock = {
    record,
    lockedAt: Date.now(),
  };
  for (const key of getAssignmentRecordKeys(record)) {
    assignmentSubmittedLocks.set(key, lock);
  }
}

function getAssignmentSubmittedLock() {
  const now = Date.now();
  for (const key of [getCanonicalMoocsPageUrl(), pageKey()].filter(Boolean)) {
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

function isManualAssignmentRecord(record) {
  return Boolean(record?.source === 'manual');
}

function shouldOverwriteStaleUnpublishedRecord(previous, nextRecord) {
  return Boolean(
    previous?.status === 'unpublished' &&
      nextRecord.status !== 'unpublished' &&
      ['form-presence', 'assignment-page-fallback', 'page-text', 'submit-attempt', 'uploaded-file'].includes(nextRecord.source),
  );
}

function shouldRetrySettlingAssignmentResult(result, storedRecord) {
  if (storedRecord) return false;
  return result?.status === 'unknown' && result?.source === 'conservative-fallback';
}

function scheduleAssignmentStatusRecheck(delayMs) {
  window.setTimeout(() => {
    ensureAssignmentStatusPanel().catch((error) => reportContentError('[ultimateMoocs:assignment]', error));
  }, delayMs);
}

function isWeakAssignmentResult(result) {
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

async function getStoredAssignmentRecordForCurrentPage() {
  const allStatuses = await getAssignmentStatus();
  return allStatuses[getCanonicalMoocsPageUrl()] || allStatuses[pageKey()] || null;
}

async function saveAssignmentRecordIfChanged(record, options = {}) {
  const { allowManualOverwrite = false } = options;
  const allStatuses = await getAssignmentStatus();
  const key = record.url || record.pageKey;
  const previous = allStatuses[key] || allStatuses[record.pageKey] || allStatuses[record.url];
  if (previous) {
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
  }
  const overwriteStaleUnpublished = shouldOverwriteStaleUnpublishedRecord(previous, record);
  if (isManualAssignmentRecord(previous) && !allowManualOverwrite && record.source !== 'manual' && record.source !== 'moocs-alert') {
    if (overwriteStaleUnpublished) {
      for (const nextKey of getAssignmentRecordKeys(record)) {
        allStatuses[nextKey] = record;
      }
      await saveAssignmentStatus(allStatuses);
      return record;
    }
    return previous;
  }
  const previousIsStrongSubmitted = isStrongSubmittedRecord(previous);
  const nextIsWeakDowngrade =
    record.status !== 'submitted' &&
    (record.confidence === 'low' ||
      record.status === 'pending_confirmation' ||
      record.source === 'form-presence' ||
      record.source === 'conservative-fallback' ||
      record.source === 'assignment-page-fallback' ||
      record.source === 'uploaded-file');
  if (previousIsStrongSubmitted && nextIsWeakDowngrade) {
    return previous;
  }
  const changed =
    !previous ||
    previous.status !== record.status ||
    previous.confidence !== record.confidence ||
    previous.evidence !== record.evidence ||
    previous.title !== record.title;
  if (!changed) return previous;
  for (const nextKey of isStrongSubmittedRecord(record) || overwriteStaleUnpublished ? getAssignmentRecordKeys(record) : [key]) {
    allStatuses[nextKey] = record;
  }
  await saveAssignmentStatus(allStatuses);
  return record;
}

async function refreshAssignmentStatusFromButton() {
  if (!assignmentStatusPanel) return;
  renderAssignmentStatusPanel(
    {
      status: 'checking',
      confidence: 'low',
      evidence: '再確認ボタンから提出状態を確認しています。',
      source: 'manual-recheck',
    },
    { checkedAt: new Date().toISOString() },
  );
  await ensureAssignmentStatusPanel({ allowManualOverwrite: true, showResultToast: true, skipUnknownRetry: true });
}

async function updateAssignmentStatusManually(status) {
  if (!currentSettings?.assignments?.enableSubmissionCheck) return;
  if (!assignmentStatusPanel) return;
  const result = {
    status,
    confidence: 'manual',
    evidence: `ユーザーが手動で「${getAssignmentStatusLabel(status)}」に設定しました。`,
    source: 'manual',
  };
  pendingAssignmentSubmit = null;
  const record = createAssignmentRecord(result);
  const savedRecord = await saveAssignmentRecordIfChanged(record);
  renderAssignmentStatusPanel(assignmentResultFromRecord(savedRecord || record), savedRecord || record);
  applyAssignmentTabStatusBadges();
  showToast(`課題状態を「${getAssignmentStatusLabel(status)}」に変更しました。`);
}

async function markAssignmentSubmittedFromAlert(message, capturedAt = Date.now()) {
  if (!currentSettings?.assignments?.enableSubmissionCheck) return;
  if (!isAssignmentLikePage()) return;

  pendingAssignmentSubmit = null;
  const result = {
    status: 'submitted',
    confidence: 'high',
    evidence: normalizeLabelText(message).slice(0, 180),
    source: 'moocs-alert',
    alertCapturedAt: new Date(capturedAt).toISOString(),
  };
  const record = createAssignmentRecord(result);
  const savedRecord = await saveAssignmentRecordIfChanged(record);
  setAssignmentSubmittedLock(savedRecord || record);
  assignmentStatusPanel =
    document.querySelector('.um-assignment-status-panel[data-um-module="assignment-status"]') ||
    document.querySelector('.um-assignment-status-panel') ||
    assignmentStatusPanel;
  if (!assignmentStatusPanel) {
    assignmentStatusPanel = document.createElement('section');
    assignmentStatusPanel.className = 'um-assignment-status-panel';
    assignmentStatusPanel.dataset.umModule = 'assignment-status';
    getMainContentRoot().prepend(assignmentStatusPanel);
  }
  renderAssignmentStatusPanel(assignmentResultFromRecord(savedRecord || record), savedRecord || record);
  applyAssignmentTabStatusBadges();
  showToast('課題の提出完了アラートを検出しました。');
}

async function markAssignmentSubmittedFromSubmitAttempt() {
  if (!currentSettings?.assignments?.enableSubmissionCheck) return;
  if (!isAssignmentLikePage()) return;
  const submitAttemptedHere =
    pendingAssignmentSubmit?.url === getCanonicalMoocsPageUrl() &&
    Date.now() - new Date(pendingAssignmentSubmit.attemptedAt).getTime() < 10 * 60 * 1000;
  if (!submitAttemptedHere) {
    await ensureAssignmentStatusPanel();
    return;
  }

  const uploadedEvidence = getUploadedAssignmentEvidence();
  if (!uploadedEvidence) {
    await ensureAssignmentStatusPanel();
    return;
  }

  const result = {
    status: 'submitted',
    confidence: 'high',
    evidence: `提出ボタン押下後、アップロード済み表示を確認しました: ${uploadedEvidence}`.slice(0, 220),
    source: 'submit-click-uploaded',
    attemptedAt: pendingAssignmentSubmit.attemptedAt,
  };
  pendingAssignmentSubmit = null;
  const record = createAssignmentRecord(result);
  const savedRecord = await saveAssignmentRecordIfChanged(record);
  setAssignmentSubmittedLock(savedRecord || record);
  assignmentStatusPanel =
    document.querySelector('.um-assignment-status-panel[data-um-module="assignment-status"]') ||
    document.querySelector('.um-assignment-status-panel') ||
    assignmentStatusPanel;
  if (!assignmentStatusPanel) {
    assignmentStatusPanel = document.createElement('section');
    assignmentStatusPanel.className = 'um-assignment-status-panel';
    assignmentStatusPanel.dataset.umModule = 'assignment-status';
    getMainContentRoot().prepend(assignmentStatusPanel);
  }
  renderAssignmentStatusPanel(assignmentResultFromRecord(savedRecord || record), savedRecord || record);
  applyAssignmentTabStatusBadges();
  showToast('提出ボタンとアップロード済み表示を確認し、提出済みとして記録しました。');
}

function triggerDevAssignmentSubmittedAlert() {
  if (!currentSettings?.assignments?.enableSubmissionCheck) return;
  if (!isAssignmentLikePage()) return;
  const message = 'すべての回答を保存しました。\nAll your answers have been saved.';
  try {
    const script = document.createElement('script');
    script.src = runtimeGetURL('page/dev-alert.js');
    script.async = false;
    script.dataset.message = message;
    script.dataset.umModule = 'dev-alert';
    script.addEventListener('load', () => script.remove());
    script.addEventListener('error', () => {
      script.remove();
      showToast('開発用アラートスクリプトの読み込みに失敗しました。');
    });
    (document.head || document.documentElement).append(script);
  } catch (error) {
    reportContentError('[ultimateMoocs:assignment:dev]', error);
    showToast('開発用アラートの起動に失敗しました。');
  }
}

function formatAssignmentDeadline(record) {
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

async function saveAssignmentDeadline(record, deadlineDate, deadlineTime = '', options = {}) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(deadlineDate)) {
    showToast('提出期限の日付を選択してください。');
    return;
  }
  if (deadlineTime && !/^\d{2}:\d{2}$/.test(deadlineTime)) {
    showToast('提出期限の時刻を確認してください。');
    return;
  }
  const allStatuses = await getAssignmentStatus();
  const key = record?.url || record?.pageKey || getCanonicalMoocsPageUrl();
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
  for (const nextKey of getAssignmentRecordKeys(nextRecord)) allStatuses[nextKey] = nextRecord;
  await saveAssignmentStatus(allStatuses);
  renderAssignmentStatusPanel(assignmentResultFromRecord(nextRecord), nextRecord);
  refreshLectureAssignmentCheckStatusFromStorage();
  showToast(`提出期限を${formatAssignmentDeadline(nextRecord)}に設定しました。`);
}

async function clearAssignmentDeadline(record) {
  const allStatuses = await getAssignmentStatus();
  const key = record?.url || record?.pageKey || getCanonicalMoocsPageUrl();
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
  for (const nextKey of getAssignmentRecordKeys(nextRecord)) allStatuses[nextKey] = nextRecord;
  await saveAssignmentStatus(allStatuses);
  renderAssignmentStatusPanel(assignmentResultFromRecord(nextRecord), nextRecord);
  refreshLectureAssignmentCheckStatusFromStorage();
  showToast('提出期限を削除しました。');
}

function getCurrentAssignmentDeadlineCandidates(record) {
  const route = parseMoocsRoute(location.href);
  const ignored = new Set(Array.isArray(record?.deadlineIgnoredCandidates) ? record.deadlineIgnoredCandidates : []);
  const savedId = record?.deadlineDate
    ? `${record.deadlineDate}T${record.deadlineTime || '23:59'}`
    : '';
  return extractDeadlineCandidatesFromLines(getDeadlineCandidateLines(), {
    defaultYear: Number(route?.year) || new Date().getFullYear(),
    allowLooseDates: true,
  }).filter((candidate) => candidate.id !== savedId && !ignored.has(candidate.id));
}

async function ignoreAssignmentDeadlineCandidate(record, candidateId) {
  const allStatuses = await getAssignmentStatus();
  const key = record?.url || record?.pageKey || getCanonicalMoocsPageUrl();
  const previous = allStatuses[key] || allStatuses[record?.pageKey] || allStatuses[record?.url] || record || {};
  const ignored = [...new Set([
    ...(Array.isArray(previous.deadlineIgnoredCandidates) ? previous.deadlineIgnoredCandidates : []),
    candidateId,
  ])].slice(-20);
  const nextRecord = {
    ...previous,
    deadlineIgnoredCandidates: ignored,
  };
  for (const nextKey of getAssignmentRecordKeys(nextRecord)) allStatuses[nextKey] = nextRecord;
  await saveAssignmentStatus(allStatuses);
  renderAssignmentStatusPanel(assignmentResultFromRecord(nextRecord), nextRecord);
  showToast('この期限候補を無視しました。');
}

function createAssignmentDeadlineCandidateList(record, candidates) {
  const section = document.createElement('div');
  section.className = 'um-assignment-deadline-candidates';
  const heading = document.createElement('strong');
  heading.textContent = 'ページ内の期限候補';
  section.append(heading);
  for (const candidate of candidates) {
    const item = document.createElement('div');
    item.className = 'um-assignment-deadline-candidate';
    const content = document.createElement('div');
    const date = document.createElement('strong');
    date.textContent = formatAssignmentDeadline({ deadlineDate: candidate.date, deadlineTime: candidate.time });
    const source = document.createElement('small');
    source.textContent = candidate.sourceText;
    const assumptions = [];
    if (!candidate.contextMatched) assumptions.push('期限語がないため日付候補として表示');
    if (candidate.inferredYear) assumptions.push('年は講義年度から補完');
    if (candidate.inferredTime) assumptions.push('時刻は23:59を提案');
    content.append(date, source);
    if (assumptions.length) {
      const note = document.createElement('small');
      note.className = 'um-assignment-deadline-assumption';
      note.textContent = assumptions.join(' / ');
      content.append(note);
    }
    const actions = document.createElement('div');
    const applyButton = createButton('適用');
    applyButton.addEventListener('click', () => {
      saveAssignmentDeadline(record, candidate.date, candidate.time, {
        source: 'page-candidate',
        evidence: candidate.sourceText,
        inferredYear: candidate.inferredYear,
        inferredTime: candidate.inferredTime,
      }).catch((error) => reportContentError('[ultimateMoocs:assignment-deadline]', error));
    });
    const ignoreButton = createButton('無視');
    ignoreButton.addEventListener('click', () => {
      ignoreAssignmentDeadlineCandidate(record, candidate.id)
        .catch((error) => reportContentError('[ultimateMoocs:assignment-deadline]', error));
    });
    actions.append(applyButton, ignoreButton);
    item.append(content, actions);
    section.append(item);
  }
  return section;
}

function createAssignmentDeadlineControl(record) {
  const candidates = getCurrentAssignmentDeadlineCandidates(record);
  const details = document.createElement('details');
  details.className = 'um-assignment-deadline-control';
  details.dataset.hasCandidates = candidates.length ? 'true' : 'false';

  const summary = document.createElement('summary');
  const label = document.createElement('span');
  label.textContent = '提出期限';
  const value = document.createElement('strong');
  value.textContent = record?.deadlineDate
    ? formatAssignmentDeadline(record)
    : candidates.length
      ? `候補あり（${candidates.length}件）`
      : '未設定';
  summary.append(label, value);
  details.append(summary);

  const fields = document.createElement('div');
  fields.className = 'um-assignment-deadline-fields';
  const dateLabel = document.createElement('label');
  dateLabel.textContent = '日付';
  const dateInput = document.createElement('input');
  dateInput.type = 'date';
  dateInput.value = record?.deadlineDate || '';
  dateInput.setAttribute('aria-label', '提出期限の日付');
  const datePickerRow = document.createElement('span');
  datePickerRow.className = 'um-assignment-date-picker-row';
  const calendarTrigger = document.createElement('span');
  calendarTrigger.className = 'um-assignment-calendar-trigger';
  calendarTrigger.textContent = 'カレンダー';
  const pickerInput = document.createElement('input');
  pickerInput.type = 'date';
  pickerInput.value = dateInput.value;
  pickerInput.setAttribute('aria-label', 'カレンダーから提出期限を選択');
  pickerInput.addEventListener('change', () => {
    dateInput.value = pickerInput.value;
  });
  dateInput.addEventListener('change', () => {
    pickerInput.value = dateInput.value;
  });
  calendarTrigger.append(pickerInput);
  datePickerRow.append(dateInput, calendarTrigger);
  dateLabel.append(datePickerRow);
  const timeLabel = document.createElement('label');
  timeLabel.textContent = '時刻（任意）';
  const timeInput = document.createElement('input');
  timeInput.type = 'time';
  timeInput.value = record?.deadlineTime || '23:59';
  timeInput.setAttribute('aria-label', '提出期限の時刻');
  timeLabel.append(timeInput);

  const buttons = document.createElement('div');
  buttons.className = 'um-assignment-deadline-actions';
  const saveButton = createButton('保存');
  saveButton.addEventListener('click', () => {
    saveAssignmentDeadline(record, dateInput.value, timeInput.value)
      .catch((error) => reportContentError('[ultimateMoocs:assignment-deadline]', error));
  });
  const clearButton = createButton('期限を削除');
  clearButton.disabled = !record?.deadlineDate;
  clearButton.addEventListener('click', () => {
    clearAssignmentDeadline(record)
      .catch((error) => reportContentError('[ultimateMoocs:assignment-deadline]', error));
  });
  buttons.append(saveButton, clearButton);
  fields.append(dateLabel, timeLabel, buttons);
  if (candidates.length) details.append(createAssignmentDeadlineCandidateList(record, candidates));
  details.append(fields);
  return details;
}

function renderAssignmentStatusPanel(result, record) {
  if (!assignmentStatusPanel) return;
  assignmentStatusPanel.dataset.status = result.status;
  assignmentStatusPanel.replaceChildren();

  const header = document.createElement('div');
  header.className = 'um-assignment-status-header';

  const main = document.createElement('div');
  main.className = 'um-assignment-status-main';
  const badge = document.createElement('span');
  badge.className = 'um-assignment-status-badge';
  badge.textContent = getAssignmentStatusLabel(result.status);
  const title = document.createElement('strong');
  title.textContent = getAssignmentStatusDescription(result);
  main.append(badge, title);
  header.append(main);

  const detail = document.createElement('p');
  detail.className = 'um-assignment-status-evidence';
  detail.textContent = getAssignmentEvidenceText(result, record);

  const meta = document.createElement('small');
  meta.className = 'um-assignment-status-meta';
  const checkedAt = record?.checkedAt ? new Date(record.checkedAt).toLocaleString() : new Date().toLocaleString();
  meta.textContent = `確認: ${checkedAt} / 判定信頼度: ${result.confidence}`;

  const body = document.createElement('div');
  body.className = 'um-assignment-status-body';
  if (currentSettings?.debug?.enableDebugLog) body.append(detail, meta);
  body.append(createAssignmentDeadlineControl(record));

  const actions = document.createElement('div');
  actions.className = 'um-assignment-status-actions';
  const refreshButton = createButton('再確認');
  refreshButton.classList.add('um-assignment-action-primary');
  refreshButton.addEventListener('click', () => {
    refreshAssignmentStatusFromButton().catch((error) => reportContentError('[ultimateMoocs:assignment]', error));
  });
  actions.append(refreshButton);

  const collectButton = createButton('この回の課題を確認');
  collectButton.addEventListener('click', () => {
    collectCurrentLectureAssignments().catch((error) => reportContentError('[ultimateMoocs:assignment]', error));
  });
  actions.append(collectButton);

  const manualDetails = document.createElement('details');
  manualDetails.className = 'um-assignment-manual-details';
  const manualSummary = document.createElement('summary');
  manualSummary.textContent = '手動補正';
  manualDetails.append(manualSummary);

  const manualActions = document.createElement('div');
  manualActions.className = 'um-assignment-manual-actions';
  for (const [status, label] of [
    ['submitted', '提出済みにする'],
    ['not_submitted', '未提出にする'],
    ['unpublished', '課題未公開にする'],
    ['unknown', '確認不能にする'],
  ]) {
    const button = createButton(label);
    button.dataset.status = status;
    button.disabled = result.status === status && result.source === 'manual';
    button.addEventListener('click', () => {
      updateAssignmentStatusManually(status).catch((error) => reportContentError('[ultimateMoocs:assignment]', error));
    });
    manualActions.append(button);
  }
  manualDetails.append(manualActions);
  actions.append(manualDetails);

  if (currentSettings?.debug?.enableDebugLog) {
    const devButton = createButton('開発用: 提出完了アラート');
    devButton.classList.add('um-assignment-dev-button');
    devButton.title = '一時テスト用です。実際のMOOCs提出や直接更新は行わず、alert検出経路だけを確認します。';
    devButton.addEventListener('click', () => {
      triggerDevAssignmentSubmittedAlert();
    });
    actions.append(devButton);
  }

  assignmentStatusPanel.append(header, body, actions);
}

async function ensureAssignmentStatusPanel(options = {}) {
  const { allowManualOverwrite = false, showResultToast = false, skipUnknownRetry = false } = options;
  const enabled = Boolean(currentSettings?.assignments?.enableSubmissionCheck);
  const shouldShow = enabled && isAssignmentLikePage();
  if (!shouldShow) {
    assignmentStatusPanel?.remove();
    assignmentStatusPanel = null;
    return;
  }

  if (!assignmentStatusPanel) {
    assignmentStatusPanel = document.createElement('section');
    assignmentStatusPanel.className = 'um-assignment-status-panel';
    assignmentStatusPanel.dataset.umModule = 'assignment-status';
    getMainContentRoot().prepend(assignmentStatusPanel);
  } else {
    const root = getMainContentRoot();
    if (assignmentStatusPanel.parentElement !== root) root.prepend(assignmentStatusPanel);
  }

  const result = detectAssignmentSubmissionStatus();
  const storedRecord = await getStoredAssignmentRecordForCurrentPage();
  if (!skipUnknownRetry && shouldRetrySettlingAssignmentResult(result, storedRecord)) {
    const key = getCanonicalMoocsPageUrl();
    const retryCount = assignmentUnknownRetryCounts.get(key) || 0;
    if (retryCount < 4) {
      assignmentUnknownRetryCounts.set(key, retryCount + 1);
      renderAssignmentStatusPanel(
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
      scheduleAssignmentStatusRecheck([700, 1600, 3200, 5200][retryCount] || 5200);
      return;
    }
  } else {
    assignmentUnknownRetryCounts.delete(getCanonicalMoocsPageUrl());
  }
  const submittedLock = getAssignmentSubmittedLock();
  if (submittedLock && isWeakAssignmentResult(result)) {
    renderAssignmentStatusPanel(assignmentResultFromRecord(submittedLock), submittedLock);
    return;
  }
  if (isStrongSubmittedRecord(storedRecord) && result.status !== 'submitted') {
    renderAssignmentStatusPanel(assignmentResultFromRecord(storedRecord), storedRecord);
    return;
  }

  const record = createAssignmentRecord(result);
  const savedRecord = await saveAssignmentRecordIfChanged(record, { allowManualOverwrite });
  const displayResult = savedRecord && savedRecord !== record ? assignmentResultFromRecord(savedRecord) : result;
  renderAssignmentStatusPanel(displayResult, savedRecord || record);
  applyAssignmentTabStatusBadges();
  refreshLectureAssignmentCheckStatusFromStorage();
  if (showResultToast) {
    showToast(`再確認しました: ${getAssignmentStatusLabel(displayResult.status)}`);
  }
}

function findUpcomingFromPage() {
  const nodes = [...document.querySelectorAll('a, li, tr, .box, .panel')]
    .map((node) => node.textContent?.trim())
    .filter(Boolean)
    .filter((text) => /次回|直近|今日|明日|講義|授業|lesson|lecture/i.test(text))
    .slice(0, 5);
  return nodes.map((text) => ({ title: text, source: 'MOOCs page' }));
}

async function ensureUpcomingPanel() {
  const enabled = Boolean(currentSettings?.iniadPlus?.enableAceTimetableDownload);

  if (!enabled) {
    upcomingPanel?.remove();
    upcomingPanel = null;
    return;
  }

  const timetable = await getAceTimetable();
  const labels = getTodayLabels();
  const timetableItems = (timetable.items || [])
    .filter((item) => labels.some((label) => String(item.day || item.rawText || '').includes(label)))
    .slice(0, 5)
    .map((item) => ({
      title: [item.period, item.title].filter(Boolean).join(' ') || item.rawText,
      source: 'ACE timetable',
    }));
  const items = [...timetableItems, ...findUpcomingFromPage()].slice(0, 6);

  if (!items.length) {
    upcomingPanel?.remove();
    upcomingPanel = null;
    return;
  }

  if (!upcomingPanel) {
    upcomingPanel = document.createElement('section');
    upcomingPanel.className = 'um-upcoming-panel';
    upcomingPanel.dataset.umModule = 'upcoming';
    const target =
      document.querySelector('.content-wrapper .content') ||
      document.querySelector('.content-wrapper') ||
      document.body;
    target.prepend(upcomingPanel);
  }

  const list = document.createElement('ul');
  for (const item of items) {
    const row = document.createElement('li');
    row.textContent = `${item.title} (${item.source})`;
    list.append(row);
  }
  upcomingPanel.replaceChildren();
  const title = document.createElement('strong');
  title.textContent = '直近の講義';
  upcomingPanel.append(title, list);
}

function getMoocsCourseListYear() {
  if (/^\/courses\/?$/.test(location.pathname)) return '';
  const route = parseMoocsRoute(location.href);
  return route?.year && !route.course ? route.year : null;
}

async function ensureAssignmentOverviewPanel() {
  const renderGeneration = ++assignmentOverviewRenderGeneration;
  const focusedElement = document.activeElement;
  const focusedLectureKey = focusedElement
    ?.closest?.('.um-assignment-overview-item')
    ?.dataset.umLectureKey;
  const assignmentSettings = currentSettings?.assignments || {};
  const enabled = Boolean(assignmentSettings.enableAssignmentOverview);
  const warningDays = Math.min(
    30,
    Math.max(1, Number(assignmentSettings.assignmentOverviewWarningDays) || 7),
  );
  const limit = Math.min(30, Math.max(3, Number(assignmentSettings.assignmentOverviewLimit) || 10));
  const hideCompleted = Boolean(assignmentSettings.hideCompletedAssignmentLectures);
  const pageYear = getMoocsCourseListYear();
  if (!enabled || pageYear === null) {
    assignmentOverviewPanel?.remove();
    assignmentOverviewPanel = null;
    expandedAssignmentOverviewLectures.clear();
    return;
  }

  const stored = await getAssignmentStatus();
  if (renderGeneration !== assignmentOverviewRenderGeneration) return;
  const records = Object.entries(stored).map(([key, record]) => ({
    ...(record && typeof record === 'object' ? record : {}),
    key,
    url: getCanonicalMoocsPageUrl(record?.url || record?.pageKey || key),
  }));
  const overview = getAssignmentOverview(records, {
    warningDays,
    limit,
    hideCompleted,
    year: pageYear || undefined,
  });

  if (!overview.lectures.length) {
    assignmentOverviewPanel?.remove();
    assignmentOverviewPanel = null;
    expandedAssignmentOverviewLectures.clear();
    return;
  }

  const visibleLectureKeys = new Set(overview.lectures.map((lecture) => lecture.key));
  for (const key of expandedAssignmentOverviewLectures) {
    if (!visibleLectureKeys.has(key)) expandedAssignmentOverviewLectures.delete(key);
  }

  if (!assignmentOverviewPanel) {
    assignmentOverviewPanel = document.createElement('section');
    assignmentOverviewPanel.className = 'um-assignment-overview-panel';
    assignmentOverviewPanel.dataset.umModule = 'assignment-overview';
    assignmentOverviewPanel.setAttribute('aria-labelledby', 'um-assignment-overview-title');
    const target =
      document.querySelector('.content-wrapper .content') ||
      document.querySelector('.content-wrapper') ||
      document.body;
    target.prepend(assignmentOverviewPanel);
  }

  const header = document.createElement('header');
  header.className = 'um-assignment-overview-header';
  const heading = document.createElement('div');
  heading.innerHTML =
    '<span>MOOCS ULTIMATE</span><strong id="um-assignment-overview-title">講義ごとの課題</strong>';
  const summary = document.createElement('span');
  summary.className = 'um-assignment-overview-summary';
  summary.textContent = `${overview.year} / ${overview.lectures.length}回`;
  summary.setAttribute('aria-live', 'polite');
  header.append(heading, summary);

  const list = document.createElement('div');
  list.className = 'um-assignment-overview-list';
  list.setAttribute('role', 'list');
  for (const lecture of overview.lectures) {
    const detailRecords = getAssignmentLectureDetails(lecture.records, { warningDays });
    if (!detailRecords.length) expandedAssignmentOverviewLectures.delete(lecture.key);
    const expanded = detailRecords.length > 0 && expandedAssignmentOverviewLectures.has(lecture.key);
    const item = document.createElement('article');
    item.className = 'um-assignment-overview-item';
    item.dataset.umLectureKey = lecture.key;
    item.dataset.tone = lecture.deadline?.tone || (lecture.remainingCount ? 'unset' : 'complete');
    item.setAttribute('role', 'listitem');

    const row = document.createElement('div');
    row.className = 'um-assignment-overview-row';
    const detailsId = `um-assignment-overview-details-${lecture.key.replace(/[^a-z0-9_-]+/gi, '-')}`;
    const lectureTitleId = `${detailsId}-title`;

    const identity = document.createElement('span');
    identity.className = 'um-assignment-overview-identity';
    const course = document.createElement('span');
    course.textContent = normalizeLabelText(lecture.courseName || lecture.course);
    const title = document.createElement('strong');
    title.id = lectureTitleId;
    title.textContent = `課題 ${lecture.lecture}`;
    identity.append(course, title);

    const stats = document.createElement('span');
    stats.className = 'um-assignment-overview-stats';
    const values = [
      ['課題数', lecture.totalCount],
      ['残り', lecture.remainingCount],
      ['提出期限', lecture.deadlineLabel],
    ];
    if (lecture.unpublishedCount) values.splice(2, 0, ['未公開', lecture.unpublishedCount]);
    stats.dataset.columns = String(values.length);
    for (const [label, value] of values) {
      const stat = document.createElement('span');
      stat.className = 'um-assignment-overview-stat';
      const term = document.createElement('span');
      term.textContent = label;
      const detail = document.createElement('strong');
      detail.textContent = String(value);
      stat.append(term, detail);
      stats.append(stat);
    }

    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'um-assignment-overview-toggle';
    toggle.hidden = detailRecords.length === 0;
    toggle.textContent = expanded ? '▲' : '▼';
    toggle.title = `${lecture.lecture}の課題を${expanded ? '折りたたむ' : '展開'}`;
    toggle.setAttribute('aria-label', toggle.title);
    toggle.setAttribute('aria-expanded', String(expanded));
    toggle.setAttribute('aria-controls', detailsId);

    const details = document.createElement('div');
    details.id = detailsId;
    details.className = 'um-assignment-overview-details';
    details.setAttribute('role', 'list');
    details.setAttribute('aria-labelledby', lectureTitleId);
    details.hidden = !expanded;
    for (const record of detailRecords) {
      const deadline = getAssignmentDeadlineState(record, { warningDays });
      const detailRow = document.createElement('div');
      detailRow.className = 'um-assignment-overview-detail';
      detailRow.setAttribute('role', 'listitem');
      detailRow.dataset.status = record.status;
      detailRow.dataset.tone = record.status === 'unpublished' ? 'unpublished' : deadline.tone;

      const detailTitle = document.createElement('strong');
      detailTitle.className = 'um-assignment-overview-detail-title';
      detailTitle.textContent = getAssignmentRecordDisplayTitle(record);
      detailTitle.title = detailTitle.textContent;
      const detailStatus = document.createElement('span');
      detailStatus.className = 'um-assignment-overview-detail-status';
      detailStatus.textContent = getAssignmentStatusLabel(record.status);
      const detailDeadline = document.createElement('span');
      detailDeadline.className = 'um-assignment-overview-detail-deadline';
      detailDeadline.textContent = deadline.label;
      const openLink = document.createElement('a');
      openLink.className = 'um-assignment-overview-open';
      openLink.href = record.url || record.pageKey || '#';
      openLink.textContent = '開く';
      openLink.setAttribute('aria-label', `${detailTitle.textContent}を開く`);
      detailRow.append(detailTitle, detailStatus, detailDeadline, openLink);
      details.append(detailRow);
    }

    toggle.addEventListener('click', () => {
      const isExpanded = toggle.getAttribute('aria-expanded') === 'true';
      if (isExpanded) expandedAssignmentOverviewLectures.delete(lecture.key);
      else expandedAssignmentOverviewLectures.add(lecture.key);
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

  const shouldRestoreFocus = Boolean(focusedLectureKey && document.activeElement === focusedElement);
  assignmentOverviewPanel.replaceChildren(header, list);
  if (shouldRestoreFocus) {
    const focusedItem = [...assignmentOverviewPanel.querySelectorAll('.um-assignment-overview-item')].find(
      (item) => item.dataset.umLectureKey === focusedLectureKey,
    );
    focusedItem?.querySelector('.um-assignment-overview-toggle')?.focus({ preventScroll: true });
  }
}

function ensureAccountSettingsLink() {
  const isAccountPage = /account|settings|profile|users/i.test(location.pathname + location.search);
  if (!isAccountPage) {
    settingsLinkPanel?.remove();
    settingsLinkPanel = null;
    return;
  }

  if (!settingsLinkPanel) {
    settingsLinkPanel = document.createElement('section');
    settingsLinkPanel.className = 'um-settings-link-panel';
    settingsLinkPanel.dataset.umOwned = 'true';
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'um-settings-link-button';
    button.textContent = 'MOOCs Ultimate 設定を開く';
    button.addEventListener('click', async () => {
      try {
        const response = await runtimeSendMessage(createMessage(MESSAGE_TYPES.optionsOpen));
        if (!response?.ok) throw new Error(response?.error || 'Options page open failed');
      } catch (error) {
        const contextInvalidated = isExtensionContextInvalidated(error);
        if (contextInvalidated) {
          button.textContent = '拡張機能を更新しました。ページを再読み込みしてください';
          button.disabled = true;
          return;
        }
        const optionsUrl = runtimeGetURL('options/index.html');
        if (/^chrome-extension:|^moz-extension:/.test(optionsUrl)) {
          window.open(optionsUrl, '_blank', 'noopener,noreferrer');
        } else {
          button.textContent = error?.message || '設定を開けません。ページを再読み込みしてください';
        }
      }
    });
    settingsLinkPanel.append(button);
    const target =
      document.querySelector('.content-wrapper .content') ||
      document.querySelector('.content-wrapper') ||
      document.body;
    target.prepend(settingsLinkPanel);
  }
}

async function renderMemoPanel() {
  if (!memoPanel) return;

  const memos = await getMemos();
  const record = normalizeMemoRecord(memos[pageKey()]);
  const list = memoPanel.querySelector('.um-memo-list');
  list.replaceChildren();

  for (const note of record.notes) {
    const item = document.createElement('article');
    item.className = 'um-memo-item';
    item.dataset.memoId = note.id;

    const textarea = document.createElement('textarea');
    textarea.className = 'um-memo-textarea';
    textarea.value = note.body || '';
    textarea.placeholder = 'メモを書く';
    textarea.addEventListener('input', async () => {
      const latest = normalizeMemoRecord((await getMemos())[pageKey()]);
      const target = latest.notes.find((entry) => entry.id === note.id);
      if (!target) return;
      target.body = textarea.value;
      target.updatedAt = new Date().toISOString();
      latest.updatedAt = target.updatedAt;
      await saveCurrentMemoRecord(latest);
    });

    const actions = document.createElement('div');
    actions.className = 'um-memo-actions';
    const downloadButton = createButton('DL');
    downloadButton.title = 'このメモをダウンロード';
    downloadButton.addEventListener('click', () => {
      downloadText(`${document.title || 'moocs-memo'}.txt`, textarea.value);
    });
    const deleteButton = createButton('削除');
    deleteButton.addEventListener('click', async () => {
      const latest = normalizeMemoRecord((await getMemos())[pageKey()]);
      latest.notes = latest.notes.filter((entry) => entry.id !== note.id);
      latest.updatedAt = new Date().toISOString();
      await saveCurrentMemoRecord(latest);
      await renderMemoPanel();
    });
    actions.append(downloadButton, deleteButton);
    item.append(textarea, actions);
    list.append(item);
  }
}

async function ensureMemoPanel() {
  const enabled = Boolean(currentSettings?.memo?.enablePageMemo);

  if (!enabled) {
    memoPanel?.remove();
    memoPanel = null;
    return;
  }

  if (!memoPanel) {
    memoPanel = document.createElement('aside');
    memoPanel.className = 'um-memo-panel';
    memoPanel.dataset.umModule = 'memo';
    memoPanel.innerHTML = `
      <div class="um-panel-header">
        <strong>Memo</strong>
        <div class="um-panel-actions"></div>
      </div>
      <div class="um-memo-list"></div>
    `;
    const actions = memoPanel.querySelector('.um-panel-actions');
    const addButton = createButton('追加');
    addButton.addEventListener('click', async () => {
      const memos = await getMemos();
      const record = normalizeMemoRecord(memos[pageKey()]);
      const now = new Date().toISOString();
      record.notes.push({
        id: `memo-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        body: '',
        createdAt: now,
        updatedAt: now,
      });
      record.updatedAt = now;
      await saveCurrentMemoRecord(record);
      await renderMemoPanel();
    });
    const exportButton = createButton('JSON');
    exportButton.addEventListener('click', async () => {
      const record = normalizeMemoRecord((await getMemos())[pageKey()]);
      downloadText('moocs-ultimate-page-memo.json', `${JSON.stringify(record, null, 2)}\n`, 'application/json');
    });
    actions.append(addButton, exportButton);
    document.body.append(memoPanel);
  }

  await renderMemoPanel();
}

function getExternalLinks() {
  const entries = [];
  for (const link of document.querySelectorAll('a[href]')) {
    if (
      isExtensionUiNode(link) ||
      link.closest('[hidden], [aria-hidden="true"]')
    ) {
      continue;
    }
    const entry = createExternalLinkEntry({
      href: link.getAttribute('href') || link.href,
      baseHref: location.href,
      currentOrigin: location.origin,
      labels: [
        link.textContent,
        link.getAttribute('aria-label'),
        link.getAttribute('title'),
        link.querySelector('img[alt]')?.getAttribute('alt'),
      ],
    });
    if (entry) entries.push(entry);
  }
  return dedupeExternalLinkEntries(entries, 20);
}

function ensureExternalLinksPanel() {
  const enabled = Boolean(currentSettings?.iniadPlus?.enableExternalLinksPanel);

  if (!enabled) {
    externalLinksPanel?.remove();
    externalLinksPanel = null;
    return;
  }

  const links = getExternalLinks();
  if (!links.length) {
    externalLinksPanel?.remove();
    externalLinksPanel = null;
    return;
  }

  if (!externalLinksPanel) {
    externalLinksPanel = document.createElement('aside');
    externalLinksPanel.className = 'um-external-links-panel';
    externalLinksPanel.dataset.umModule = 'external-links';
    document.body.append(externalLinksPanel);
  }

  const list = document.createElement('ul');
  for (const entry of links) {
    const item = document.createElement('li');
    const anchor = document.createElement('a');
    anchor.href = entry.href;
    anchor.target = '_blank';
    anchor.rel = 'noopener noreferrer';
    const linkLabel = document.createElement('span');
    linkLabel.className = 'um-external-link-label';
    linkLabel.textContent = entry.label;
    const linkHost = document.createElement('span');
    linkHost.className = 'um-external-link-host';
    linkHost.textContent = entry.hostname;
    anchor.append(linkLabel, linkHost);
    item.append(anchor);
    list.append(item);
  }

  externalLinksPanel.replaceChildren();
  const details = document.createElement('details');
  const summary = document.createElement('summary');
  const label = document.createElement('span');
  const count = document.createElement('span');
  label.textContent = '外部リンク';
  count.textContent = String(links.length);
  summary.append(label, count);
  details.append(summary, list);
  externalLinksPanel.append(details);
}

function ensureDriveButton() {
  const enabled = Boolean(currentSettings?.iniadPlus?.enableDriveButton);
  ensureCourseDriveButtons(enabled);

  const driveLink = [...document.querySelectorAll('a[href]')].find((link) =>
    !isExtensionUiNode(link) && /drive\.google\.com|docs\.google\.com/i.test(link.href),
  );

  if (!enabled || !driveLink) {
    driveButton?.remove();
    driveButton = null;
    return;
  }

  if (!driveButton) {
    driveButton = document.createElement('a');
    driveButton.className = 'um-drive-button';
    driveButton.dataset.umOwned = 'true';
    driveButton.target = '_blank';
    driveButton.rel = 'noreferrer';
    driveButton.textContent = 'Drive';
    document.body.append(driveButton);
  }

  driveButton.href = driveLink.href;
}

function findDriveLinkInNode(node) {
  return [...(node?.querySelectorAll?.('a[href]') || [])].find((link) =>
    !isExtensionUiNode(link) && /drive\.google\.com|docs\.google\.com/i.test(link.href),
  );
}

function cleanCourseTitle(text) {
  return String(text || '')
    .replace(/View Course/gi, '')
    .replace(/ドライブで探す/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function getCourseItemTitle(item) {
  const heading =
    item.container.querySelector?.('h1, h2, h3, h4, .course-title, .box-title, .panel-title')?.textContent || '';
  const imageAlt = item.container.querySelector?.('img[alt]')?.getAttribute('alt') || '';
  const containerTitle = cleanCourseTitle(item.container.textContent);
  const anchorTitle = cleanCourseTitle(item.anchor.textContent || item.anchor.getAttribute('title') || '');
  return cleanCourseTitle(heading) || cleanCourseTitle(imageAlt) || containerTitle || anchorTitle || 'INIAD MOOCs';
}

function getCourseDriveUrl(item) {
  const driveLink = findDriveLinkInNode(item.container);
  if (driveLink) return driveLink.href;
  const title = getCourseItemTitle(item);
  return `https://drive.google.com/drive/search?q=${encodeURIComponent(title)}`;
}

function isCourseCardItem(item) {
  if (!item?.container || isExtensionUiNode(item.container)) return false;
  const anchorText = item.anchor.textContent?.trim() || '';
  const containerText = cleanCourseTitle(item.container.textContent);
  const hasCourseAction = /view\s*course|コースを見る|course/i.test(anchorText);
  const hasCourseImage = Boolean(item.container.querySelector?.('img'));
  const hasEnoughContent = containerText.length >= 2 && containerText !== cleanCourseTitle(anchorText);
  return hasEnoughContent && (hasCourseAction || hasCourseImage);
}

function ensureCourseDriveButtons(enabled) {
  for (const node of document.querySelectorAll('.um-course-drive-button')) node.remove();
  if (!enabled) return;

  const seen = new Set();
  for (const item of getCourseItems()) {
    if (!isCourseCardItem(item) || seen.has(item.id)) continue;
    seen.add(item.id);

    const button = document.createElement('a');
    button.className = 'um-course-drive-button';
    button.dataset.umOwned = 'true';
    button.href = getCourseDriveUrl(item);
    button.target = '_blank';
    button.rel = 'noreferrer';
    button.textContent = 'ドライブで探す';

    item.anchor.insertAdjacentElement('afterend', button);
  }
}

function getSlideFrames() {
  return [...document.querySelectorAll('iframe')].filter((frame) =>
    /docs\.google\.com\/presentation|slide/i.test(frame.src || frame.title || ''),
  );
}

function applySlideTransform(frame, state) {
  frame.style.width = `${state.width}%`;
  frame.style.minHeight = `${state.height}px`;
  frame.style.transform = `scale(${state.scale})`;
  frame.style.transformOrigin = 'top center';
  frame.style.display = 'block';
  frame.style.marginLeft = state.center ? 'auto' : '';
  frame.style.marginRight = state.center ? 'auto' : '';
}

function ensureSlideTools() {
  const enabled = Boolean(currentSettings?.iniadPlus?.enableSlideResizeTools);
  const frames = getSlideFrames();

  if (!enabled || !frames.length) {
    slideToolsPanel?.remove();
    slideToolsPanel = null;
    for (const frame of frames) {
      frame.style.removeProperty('width');
      frame.style.removeProperty('min-height');
      frame.style.removeProperty('transform');
      frame.style.removeProperty('transform-origin');
      frame.style.removeProperty('display');
      frame.style.removeProperty('margin-left');
      frame.style.removeProperty('margin-right');
    }
    return;
  }

  if (!slideToolsPanel) {
    slideToolsPanel = document.createElement('aside');
    slideToolsPanel.className = 'um-slide-tools';
    slideToolsPanel.dataset.umModule = 'slide-tools';
    slideToolsPanel.innerHTML = `
      <strong>Slide</strong>
      <label>幅 <input data-um-slide="width" type="range" min="50" max="140" value="100"></label>
      <label>高さ <input data-um-slide="height" type="range" min="240" max="1200" value="540"></label>
      <label>拡大 <input data-um-slide="scale" type="range" min="0.5" max="1.8" step="0.05" value="1"></label>
      <label class="um-inline-check"><input data-um-slide="center" type="checkbox" checked>中央</label>
    `;
    slideToolsPanel.addEventListener('input', () => {
      const state = {
        width: Number(slideToolsPanel.querySelector('[data-um-slide="width"]').value),
        height: Number(slideToolsPanel.querySelector('[data-um-slide="height"]').value),
        scale: Number(slideToolsPanel.querySelector('[data-um-slide="scale"]').value),
        center: slideToolsPanel.querySelector('[data-um-slide="center"]').checked,
      };
      getSlideFrames().forEach((frame) => applySlideTransform(frame, state));
    });
    document.body.append(slideToolsPanel);
  }

  slideToolsPanel.dispatchEvent(new Event('input'));
}

function getCourseItems() {
  const anchors = [...document.querySelectorAll('a[href*="/courses/"], a[href*="/course/"]')].filter(
    (anchor) => {
      try {
        const url = new URL(anchor.href, location.href);
        return url.host === location.host;
      } catch {
        return false;
      }
    },
  );

  return anchors
    .map((anchor) => {
      const container =
        anchor.closest('.box, .panel, .course, .coursebox, li, tr, article, .col-md-3, .col-md-4, .col-sm-6') ||
        anchor;
      return {
        id: new URL(anchor.href, location.href).pathname,
        title: anchor.textContent?.trim() || anchor.getAttribute('title') || anchor.href,
        anchor,
        container,
        parent: container.parentElement,
      };
    })
    .filter((item, index, items) => items.findIndex((candidate) => candidate.id === item.id) === index);
}

async function ensureCourseTools() {
  const courseSettings = currentSettings?.course || {};
  const enabled = Boolean(
    courseSettings.enableCourseSort || courseSettings.enableCourseFavorite || courseSettings.enableCourseHide,
  );

  for (const node of document.querySelectorAll('.um-course-tools')) node.remove();
  for (const node of document.querySelectorAll('[data-um-course-hidden="true"]')) {
    node.hidden = false;
    node.removeAttribute('data-um-course-hidden');
  }

  if (!enabled) return;

  const items = getCourseItems();
  if (!items.length) return;

  const [order, prefs] = await Promise.all([getCourseOrder(), getCoursePrefs()]);
  const orderIndex = new Map(order.map((id, index) => [id, index]));
  const sortableItems = items.filter((item) => item.parent);
  sortableItems.sort((a, b) => (orderIndex.get(a.id) ?? 9999) - (orderIndex.get(b.id) ?? 9999));
  for (const item of sortableItems) {
    item.parent.append(item.container);
  }

  for (const item of getCourseItems()) {
    const pref = prefs[item.id] || {};
    if (courseSettings.enableCourseHide && pref.hidden) {
      item.container.hidden = true;
      item.container.dataset.umCourseHidden = 'true';
    }

    const tools = document.createElement('div');
    tools.className = 'um-course-tools';
    tools.dataset.umOwned = 'true';
    tools.dataset.umCourseId = item.id;

    if (courseSettings.enableCourseFavorite) {
      const favoriteButton = createButton(pref.favorite ? '★' : '☆');
      favoriteButton.title = 'お気に入り';
      favoriteButton.addEventListener('click', async () => {
        const latest = await getCoursePrefs();
        latest[item.id] = { ...(latest[item.id] || {}), favorite: !latest[item.id]?.favorite };
        await saveCoursePrefs(latest);
        scheduleCourseRefresh();
      });
      tools.append(favoriteButton);
      item.container.classList.toggle('um-course-favorite', Boolean(pref.favorite));
    }

    if (courseSettings.enableCourseHide) {
      const hideButton = createButton(pref.hidden ? '表示' : '非表示');
      hideButton.title = 'コースを非表示';
      hideButton.addEventListener('click', async () => {
        const latest = await getCoursePrefs();
        latest[item.id] = { ...(latest[item.id] || {}), hidden: !latest[item.id]?.hidden };
        await saveCoursePrefs(latest);
        scheduleCourseRefresh();
      });
      tools.append(hideButton);
    }

    if (courseSettings.enableCourseSort) {
      const upButton = createButton('↑');
      const downButton = createButton('↓');
      upButton.addEventListener('click', () => moveCourse(item.id, -1));
      downButton.addEventListener('click', () => moveCourse(item.id, 1));
      tools.append(upButton, downButton);
    }

    item.container.prepend(tools);
  }
}

async function moveCourse(courseId, direction) {
  const items = getCourseItems();
  const ids = items.map((item) => item.id);
  const index = ids.indexOf(courseId);
  const nextIndex = index + direction;
  if (index < 0 || nextIndex < 0 || nextIndex >= ids.length) return;
  const [id] = ids.splice(index, 1);
  ids.splice(nextIndex, 0, id);
  await saveCourseOrder(ids);
  scheduleCourseRefresh();
}

function scheduleCourseRefresh() {
  if (courseRefreshTimer) return;
  courseRefreshTimer = window.setTimeout(() => {
    courseRefreshTimer = 0;
    ensureCourseTools().catch((error) => reportContentError('[ultimateMoocs:course]', error));
    ensureDriveButton();
  }, 120);
}

function applyLearningTools() {
  ensureDownloadPanel();
  ensureAiSummaryPanel();
  ensureLectureAssignmentCheck();
  cleanupLectureToolsPanel();
  ensureAssignmentStatusPanel().catch((error) => reportContentError('[ultimateMoocs:assignment]', error));
  ensureUpcomingPanel().catch((error) => reportContentError('[ultimateMoocs:upcoming]', error));
  ensureAssignmentOverviewPanel().catch((error) => reportContentError('[ultimateMoocs:assignment-overview]', error));
  ensureAccountSettingsLink();
  ensureMemoPanel().catch((error) => reportContentError('[ultimateMoocs:memo]', error));
  ensureCourseTools().catch((error) => reportContentError('[ultimateMoocs:course]', error));
  ensureExternalLinksPanel();
  ensureDriveButton();
  ensureSlideTools();
}

function applySettings(settings) {
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
  applyAssignmentTabStatusBadges();
  lastLearningToolsSignature = getLearningToolsSignature();
  applyLearningTools();
}

async function pingBackground() {
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

function cleanupStaleContentMount() {
  document.querySelectorAll('[data-um-module], [data-um-owned="true"]').forEach((node) => node.remove());
  document.querySelector(`#${BADGE_ID}`)?.remove();
  document.querySelectorAll('.um-scroll-top-button, .um-textarea-counter').forEach((node) => node.remove());
  document.querySelectorAll('[data-um-textarea-enhanced]').forEach((node) => {
    delete node.dataset.umTextareaEnhanced;
    delete node.dataset.umTextareaId;
  });
  clearTabColoring();
  clearAssignmentTabStatusBadges();
}

async function boot() {
  if (bootStarted) return;
  bootStarted = true;

  if (document.documentElement.getAttribute(ROOT_ATTRIBUTE) === 'true') cleanupStaleContentMount();

  document.documentElement.setAttribute(ROOT_ATTRIBUTE, 'true');
  applySettings(await getSettings());
  await pingBackground();

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
        .then(applySettings)
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
        applyAssignmentTabStatusBadges();
      }
      applyLearningTools();
    }
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot, { once: true });
} else {
  boot();
}
