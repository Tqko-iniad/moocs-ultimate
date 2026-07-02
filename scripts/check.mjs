import { access, readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractDeadlineCandidatesFromLines } from '../src/shared/deadlineCandidates.js';
import {
  collectExternalLinksFromDocument,
  createExternalLinkEntry,
  dedupeExternalLinkEntries,
} from '../src/shared/externalLinks.js';
import {
  collectCourseCardElements,
  getCourseCardDriveUrl,
  getCourseCardTitle,
  isCourseCardElement,
} from '../src/shared/courseCards.js';
import {
  collectMemoPageContextFromDocument,
  createMemoNote,
  normalizeMemoRecord,
} from '../src/shared/pageMemo.js';
import {
  collectDownloadCandidatesFromDocument,
  convertDriveFileUrlToDownloadUrl,
  sanitizePathPart,
} from '../src/shared/downloadCandidates.js';
import {
  classifyAssignmentLinkCandidate,
  detectAssignmentSignalInDocument,
  hasSubmissionFormInDocument,
  sortCollectedAssignmentRecords,
} from '../src/shared/assignmentDetection.js';
import { isAttendanceFieldInstruction, isPreviousAttendanceTitle } from '../src/shared/attendanceDetection.js';
import { validateAndNormalizeSettings } from '../src/shared/defaultSettings.js';
import {
  dedupeRouteEntries,
  getCanonicalMoocsUrl,
  parseMoocsCourseRoute,
} from '../src/shared/moocsRoute.js';
import {
  compareAssignmentDeadlineUrgency,
  dedupeAssignmentRecords,
  getAssignmentLectureDetails,
  getAssignmentOverview,
  getAssignmentDeadlineState,
  parseAssignmentDeadline,
} from '../src/shared/assignmentDeadline.js';
import {
  collectStoredAssignmentRecordsForLecture,
  createLectureAssignmentSummaryText,
  formatAssignmentDeadlineForDisplay,
  getAssignmentRecordTitleForDisplay,
  getAssignmentStatusDisplayLabel,
  getLectureAssignmentSummaryState,
  prepareAssignmentStatusUpsert,
} from '../src/shared/assignmentStatus.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');

async function listJavaScriptFiles(relativeDir) {
  const entries = await readdir(path.join(rootDir, relativeDir), { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.js'))
    .map((entry) => `${relativeDir}/${entry.name}`)
    .sort();
}

const contentScriptFiles = await listJavaScriptFiles('src/content');
const sharedScriptFiles = await listJavaScriptFiles('src/shared');

const requiredFiles = [
  'package.json',
  'src/manifest/manifest.chromium.json',
  'src/assets/icons/moocs-ultimate.svg',
  'src/assets/icons/icon16.png',
  'src/assets/icons/icon32.png',
  'src/assets/icons/icon48.png',
  'src/assets/icons/icon128.png',
  'src/background/index.js',
  'src/ace/index.js',
  ...contentScriptFiles,
  'src/slides/index.js',
  'src/options/index.html',
  'src/options/options.js',
  'src/popup/index.html',
  'src/popup/popup.js',
  'src/styles/content.css',
  ...sharedScriptFiles,
  'scripts/build-extension.mjs',
  'scripts/release-check.mjs',
  'README.md',
  'CHANGELOG.md',
  'docs/ALPHA_TESTING.md',
];

for (const file of requiredFiles) {
  await access(path.join(rootDir, file));
}

const manifest = JSON.parse(
  await readFile(path.join(rootDir, 'src/manifest/manifest.chromium.json'), 'utf8'),
);

if (manifest.manifest_version !== 3) {
  throw new Error('manifest_version must be 3.');
}

if (manifest.permissions.includes('debugger') || manifest.host_permissions.includes('<all_urls>')) {
  throw new Error('Release manifest contains an intentionally unsupported broad permission.');
}

for (const size of ['16', '32', '48', '128']) {
  const expectedPath = `icons/icon${size}.png`;
  if (manifest.icons?.[size] !== expectedPath || manifest.action?.default_icon?.[size] !== expectedPath) {
    throw new Error(`Manifest icon mapping is missing for ${size}px.`);
  }
}

const oldSettings = validateAndNormalizeSettings({ assignments: { enableSubmissionCheck: true } });
if (
  !oldSettings.ok ||
  oldSettings.settings.assignments.enableAssignmentOverview !== true ||
  oldSettings.settings.assignments.hideCompletedAssignmentLectures !== true ||
  oldSettings.settings.assignments.assignmentOverviewWarningDays !== 7 ||
  oldSettings.settings.assignments.assignmentOverviewLimit !== 10
) {
  throw new Error('Assignment overview settings migration defaults failed.');
}
const invalidOverviewSettings = validateAndNormalizeSettings({
  assignments: {
    enableAssignmentOverview: true,
    assignmentOverviewWarningDays: 31,
    assignmentOverviewLimit: 2,
  },
});
if (invalidOverviewSettings.ok) {
  throw new Error('Assignment overview settings range validation failed.');
}
const validFormattedSettings = validateAndNormalizeSettings({
  appearance: {
    backgroundColor: '#ABCDEF',
    backgroundImageUrl: 'https://example.com/background image.png',
  },
  navigation: {
    colors: {
      attendanceTest: '#0af',
    },
  },
  ai: {
    apiBaseUrl: 'https://api.openai.iniad.org/api/v1/',
  },
});
if (
  !validFormattedSettings.ok ||
  validFormattedSettings.settings.appearance.backgroundColor !== '#abcdef' ||
  validFormattedSettings.settings.navigation.colors.attendanceTest !== '#0af' ||
  validFormattedSettings.settings.ai.apiBaseUrl !== 'https://api.openai.iniad.org/api/v1'
) {
  throw new Error('Formatted settings normalization failed.');
}
const invalidFormattedSettings = validateAndNormalizeSettings({
  appearance: {
    backgroundColor: 'red; color: black',
    backgroundImageUrl: 'javascript:alert(1)',
  },
  ai: {
    apiBaseUrl: 'https://example.com/api/v1',
  },
});
if (
  invalidFormattedSettings.ok ||
  invalidFormattedSettings.errors.length !== 3
) {
  throw new Error('Formatted settings validation failed.');
}
const parsedMoocsRoute = parseMoocsCourseRoute('https://moocs.iniad.org/courses/2026/COT101/10-1/10-1-2?x=1#top');
if (
  parsedMoocsRoute?.year !== '2026' ||
  parsedMoocsRoute?.course !== 'COT101' ||
  parsedMoocsRoute?.lecture !== '10-1' ||
  parsedMoocsRoute?.page !== '10-1-2'
) {
  throw new Error('MOOCs route parsing failed.');
}
if (
  getCanonicalMoocsUrl('https://moocs.iniad.org/courses/2026/COT101/10-1/10-1-2?x=1#top') !==
  'https://moocs.iniad.org/courses/2026/COT101/10-1/10-1-2'
) {
  throw new Error('MOOCs route canonical URL normalization failed.');
}
if (
  dedupeRouteEntries([
    { url: new URL('https://moocs.iniad.org/courses/2026/COT101/10-1/a#top') },
    { url: new URL('https://moocs.iniad.org/courses/2026/COT101/10-1/a#bottom') },
    { url: new URL('https://moocs.iniad.org/courses/2026/COT101/10-1/b') },
  ]).length !== 2
) {
  throw new Error('MOOCs route entry deduplication failed.');
}
if (sanitizePathPart('CON') !== 'CON_file' || sanitizePathPart('bad/name?.pdf') !== 'bad_name_.pdf') {
  throw new Error('Download filename sanitization failed.');
}
if (
  convertDriveFileUrlToDownloadUrl('https://drive.google.com/file/d/example-id/view') !==
  'https://drive.google.com/uc?export=download&id=example-id'
) {
  throw new Error('Drive download URL conversion failed.');
}
const createFakeNode = (textContent, attributes = {}) => ({
  textContent,
  title: attributes.title || '',
  tagName: attributes.tagName || 'A',
  getAttribute(name) {
    return attributes[name] || '';
  },
  closest(selector) {
    return attributes.owned && selector.includes('[data-um-owned="true"]') ? this : null;
  },
});
const downloadCandidateDoc = {
  querySelectorAll(selector) {
    if (selector === 'a[href]') {
      return [
        createFakeNode('Slides', { href: 'https://docs.google.com/presentation/d/slide-id/edit' }),
        createFakeNode('PDF', { href: '/courses/2026/COT101/10-1/file.pdf' }),
        createFakeNode('Owned', { href: 'https://drive.google.com/file/d/ignored/view', owned: true }),
      ];
    }
    if (selector === 'iframe[src], embed[src]' || selector === 'object[data]') return [];
    if (selector.includes('h1') || selector.includes('h2')) {
      return [
        createFakeNode('[COT101] Course Title'),
        createFakeNode('10-1 Lecture Title'),
      ];
    }
    return [];
  },
};
const downloadCandidates = collectDownloadCandidatesFromDocument(
  downloadCandidateDoc,
  'https://moocs.iniad.org/courses/2026/COT101/10-1/10-1-1',
);
if (
  downloadCandidates.length !== 2 ||
  !downloadCandidates.some((candidate) => candidate.kind === 'google_slides') ||
  !downloadCandidates.some((candidate) => candidate.kind === 'direct_file' && candidate.filename.endsWith('/file.pdf'))
) {
  throw new Error('Download candidate collection failed.');
}
const createFakeAssignmentLink = (textContent, attributes = {}) => ({
  textContent,
  getAttribute(name) {
    return attributes[name] || '';
  },
  closest() {
    return null;
  },
});
const assignmentCandidate = classifyAssignmentLinkCandidate(
  createFakeAssignmentLink('課題 10-1 回答してください', { href: '/courses/2026/COT101/10-1/task' }),
  new URL('https://moocs.iniad.org/courses/2026/COT101/10-1/task'),
  { isPageTab: true, tabKind: 'assignment', isAttendanceTabKind: () => false },
);
if (!assignmentCandidate.shouldVerify || !assignmentCandidate.likelyAssignment) {
  throw new Error('Assignment link classification failed.');
}
const sortedAssignmentUrls = sortCollectedAssignmentRecords([
  { url: 'https://moocs.iniad.org/courses/2026/COT101/10-1/10-1-10' },
  { url: 'https://moocs.iniad.org/courses/2026/COT101/10-1/10-1-2' },
]).map((record) => record.url);
if (!sortedAssignmentUrls[0].endsWith('/10-1-2')) {
  throw new Error('Assignment record page sorting failed.');
}
const createFakeElement = (textContent = '', attributes = {}) => ({
  nodeType: 1,
  hidden: false,
  parentElement: attributes.parentElement || null,
  textContent,
  value: attributes.value || '',
  getAttribute(name) {
    return attributes[name] || '';
  },
  closest(selector) {
    if (attributes.closestBySelector?.[selector]) return attributes.closestBySelector[selector];
    return attributes.owned && selector.includes('[data-um-owned="true"]') ? this : null;
  },
  matches(selector) {
    return Boolean(attributes.matches?.some((pattern) => selector.includes(pattern)));
  },
  querySelector(selector) {
    return this.querySelectorAll(selector)[0] || null;
  },
  querySelectorAll(selector) {
    return attributes.childrenBySelector?.[selector] || [];
  },
});
const assignmentInput = createFakeElement('', { matches: ['textarea'] });
const assignmentSubmitButton = createFakeElement('提出', { matches: ['button'] });
const assignmentForm = createFakeElement('', {
  childrenBySelector: {
    'textarea, select, [contenteditable="true"], input:not([type]), input[type="file"], input[type="text"], input[type="radio"], input[type="checkbox"]': [
      assignmentInput,
    ],
    'button, input[type="submit"], input[type="button"]': [assignmentSubmitButton],
  },
});
const assignmentFormDoc = {
  title: '課題 1',
  body: assignmentForm,
  querySelector(selector) {
    if (selector === '.content-wrapper .content' || selector === '.content-wrapper' || selector === 'main') return null;
    return null;
  },
  querySelectorAll(selector) {
    if (selector === 'form') return [assignmentForm];
    if (selector.includes('h1') || selector.includes('h2') || selector.includes('h3')) return [];
    return [];
  },
};
if (!hasSubmissionFormInDocument(assignmentFormDoc)) {
  throw new Error('Assignment submission form detection failed.');
}
const assignmentSignalLine = createFakeElement('最後に提出ボタンをクリックしてください');
const assignmentSignalDoc = {
  title: '課題 1',
  body: createFakeElement(''),
  querySelector(selector) {
    if (selector === '.problem-contentpage') return null;
    return null;
  },
  querySelectorAll(selector) {
    if (selector === 'form') return [];
    if (selector.includes('h1') || selector.includes('h2') || selector.includes('h3') || selector.includes('p')) {
      return [assignmentSignalLine];
    }
    return [];
  },
};
const assignmentSignal = detectAssignmentSignalInDocument(
  assignmentSignalDoc,
  new URL('https://moocs.iniad.org/courses/2026/COT101/10-1/task'),
  assignmentCandidate,
);
if (!assignmentSignal.ok || assignmentSignal.status !== 'not_submitted') {
  throw new Error('Assignment document signal detection failed.');
}
const hiddenProblemInput = createFakeElement('', { matches: ['textarea'] });
const hiddenProblemSubmit = createFakeElement('提出', { matches: ['button'] });
const hiddenProblemContentpage = createFakeElement(
  '回答は自動的に記録されます。 提出',
  {
    style: 'display: none',
    childrenBySelector: {
      'textarea, select, [contenteditable="true"], input:not([type]), input[type="file"], input[type="text"], input[type="radio"], input[type="checkbox"]': [
        hiddenProblemInput,
      ],
      'button, input[type="submit"], input[type="button"], a.btn': [hiddenProblemSubmit],
    },
  },
);
hiddenProblemInput.parentElement = hiddenProblemContentpage;
hiddenProblemSubmit.parentElement = hiddenProblemContentpage;
const unpublishedOpenButton = createFakeElement('問題を開く', { matches: ['button'] });
const unpublishedCoverpage = createFakeElement('現在この問題は非公開です。 問題を開く', {
  childrenBySelector: {
    'button, a.btn, a[href], input[type="button"], input[type="submit"]': [unpublishedOpenButton],
  },
});
const unpublishedProblemContainer = createFakeElement('現在この問題は非公開です。 問題を開く', {
  childrenBySelector: {
    '.problem-contentpage': [hiddenProblemContentpage],
    'textarea, select, [contenteditable="true"], input:not([type]), input[type="file"], input[type="text"], input[type="radio"], input[type="checkbox"]': [
      hiddenProblemInput,
    ],
    'button, input[type="submit"], input[type="button"], a.btn': [unpublishedOpenButton, hiddenProblemSubmit],
  },
});
unpublishedCoverpage.parentElement = unpublishedProblemContainer;
unpublishedCoverpage.closest = (selector) => selector === '.problem-container' ? unpublishedProblemContainer : null;
unpublishedOpenButton.parentElement = unpublishedCoverpage;
hiddenProblemContentpage.parentElement = unpublishedProblemContainer;
hiddenProblemContentpage.closest = (selector) => selector === '.problem-container' ? unpublishedProblemContainer : null;
const unpublishedProblemDoc = {
  title: 'Quiz 3',
  body: unpublishedProblemContainer,
  querySelector(selector) {
    if (selector === '.content-wrapper .content' || selector === '.content-wrapper' || selector === 'main') return null;
    if (selector === '.problem-contentpage') return hiddenProblemContentpage;
    return null;
  },
  querySelectorAll(selector) {
    if (selector === '.problem-container .problem-coverpage' || selector === '.problem-coverpage') return [unpublishedCoverpage];
    if (selector === 'form') return [];
    if (selector === 'button, a.btn, a[href], input[type="button"], input[type="submit"]') return [unpublishedOpenButton, hiddenProblemSubmit];
    if (selector.includes('h1') || selector.includes('h2') || selector.includes('h3') || selector.includes('p')) {
      return [unpublishedCoverpage];
    }
    return [];
  },
};
const unpublishedSignal = detectAssignmentSignalInDocument(
  unpublishedProblemDoc,
  new URL('https://moocs.iniad.org/courses/2026/COT105/11/04'),
  assignmentCandidate,
);
if (
  hasSubmissionFormInDocument(unpublishedProblemDoc) ||
  !unpublishedSignal.ok ||
  unpublishedSignal.status !== 'unpublished' ||
  unpublishedSignal.confidence !== 'high'
) {
  throw new Error(`Unpublished assignment coverpage detection failed: ${JSON.stringify(unpublishedSignal)}`);
}
const storedLectureAssignments = collectStoredAssignmentRecordsForLecture(
  {
    'https://moocs.iniad.org/courses/2026/COT101/10-1/10-1-2': {
      url: 'https://moocs.iniad.org/courses/2026/COT101/10-1/10-1-2',
      status: 'not_submitted',
      source: 'lecture-link-collect',
      title: '課題 2 : INIAD MOOCs',
      deadlineDate: '2026-06-30',
      deadlineTime: '23:59',
    },
    'https://moocs.iniad.org/courses/2026/COT101/10-1/10-1-3': {
      url: 'https://moocs.iniad.org/courses/2026/COT101/10-1/10-1-3',
      status: 'submitted',
      source: 'moocs-alert',
    },
    'https://moocs.iniad.org/courses/2026/COT101/10-1/attendance': {
      url: 'https://moocs.iniad.org/courses/2026/COT101/10-1/attendance',
      status: 'not_submitted',
      source: 'lecture-link-collect',
    },
  },
  {
    currentUrl: 'https://moocs.iniad.org/courses/2026/COT101/10-1/10-1-1',
    attendancePageUrls: ['https://moocs.iniad.org/courses/2026/COT101/10-1/attendance'],
  },
);
if (
  storedLectureAssignments.length !== 2 ||
  storedLectureAssignments.some((record) => record.url.endsWith('/attendance')) ||
  getAssignmentStatusDisplayLabel('not_submitted') !== '要対応' ||
  getLectureAssignmentSummaryState(storedLectureAssignments) !== 'action' ||
  !createLectureAssignmentSummaryText(storedLectureAssignments).includes('課題 2件') ||
  getAssignmentRecordTitleForDisplay(storedLectureAssignments[0]) !== '1-2: 課題 2' ||
  formatAssignmentDeadlineForDisplay(storedLectureAssignments[0]) === '未設定'
) {
  throw new Error('Assignment status shared helpers failed.');
}
const manualProtectedUpsert = prepareAssignmentStatusUpsert(
  {
    page: {
      pageKey: 'page',
      status: 'submitted',
      source: 'manual',
      confidence: 'manual',
    },
  },
  {
    pageKey: 'page',
    status: 'not_submitted',
    source: 'form-presence',
    confidence: 'low',
  },
);
const strongSubmittedUpsert = prepareAssignmentStatusUpsert(
  {
    page: {
      pageKey: 'page',
      status: 'submitted',
      source: 'moocs-alert',
      confidence: 'high',
    },
  },
  {
    pageKey: 'page',
    status: 'pending_confirmation',
    source: 'submit-attempt',
    confidence: 'low',
  },
);
if (
  manualProtectedUpsert.action !== 'keep' ||
  manualProtectedUpsert.record.source !== 'manual' ||
  strongSubmittedUpsert.action !== 'keep' ||
  strongSubmittedUpsert.record.status !== 'submitted'
) {
  throw new Error('Assignment status upsert protection failed.');
}

if (!isPreviousAttendanceTitle('前回の確認 : INIAD MOOCs')) {
  throw new Error('Previous attendance title detection failed.');
}
if (!isAttendanceFieldInstruction('講義を受講している教室・座席番号を回答してください')) {
  throw new Error('Classroom attendance field detection failed.');
}
if (isAttendanceFieldInstruction('レポート本文を入力してください')) {
  throw new Error('Ordinary assignment input must not be treated as attendance.');
}

const externalLink = createExternalLinkEntry({
  href: 'https://drive.google.com/drive/search?q=course#result',
  baseHref: 'https://moocs.iniad.org/courses',
  currentOrigin: 'https://moocs.iniad.org',
  labels: ['ドライブで探す'],
});
if (
  !externalLink ||
  externalLink.href !== 'https://drive.google.com/drive/search?q=course' ||
  externalLink.hostname !== 'drive.google.com'
) {
  throw new Error('External link normalization failed.');
}
if (
  createExternalLinkEntry({
    href: '/courses/2026/COT101',
    baseHref: 'https://moocs.iniad.org/courses',
    currentOrigin: 'https://moocs.iniad.org',
  }) !== null
) {
  throw new Error('Internal MOOCs links must not be external link candidates.');
}
const dedupedExternalLinks = dedupeExternalLinkEntries([
  externalLink,
  { ...externalLink, label: 'duplicate' },
  createExternalLinkEntry({
    href: 'https://app.slack.com/client/example',
    baseHref: 'https://moocs.iniad.org/courses',
    currentOrigin: 'https://moocs.iniad.org',
    labels: ['Slack'],
  }),
]);
if (dedupedExternalLinks.length !== 2) {
  throw new Error('External link deduplication failed.');
}
const createFakeAnchor = (textContent, attributes = {}) => ({
  textContent,
  href: attributes.href || '',
  parentElement: attributes.parentElement || null,
  getAttribute(name) {
    return attributes[name] || '';
  },
  querySelector(selector) {
    if (selector === 'img[alt]' && attributes.imageAlt) {
      return { getAttribute: (name) => (name === 'alt' ? attributes.imageAlt : '') };
    }
    return null;
  },
  querySelectorAll(selector) {
    return attributes.childrenBySelector?.[selector] || [];
  },
  closest(selector) {
    if (attributes.owned && selector.includes('[data-um-owned="true"]')) return this;
    if (attributes.hidden && selector.includes('[hidden]')) return this;
    if (attributes.container && selector.includes('.box')) return attributes.container;
    return null;
  },
});
const visibleExternalAnchor = createFakeAnchor('Course Drive', {
  href: 'https://drive.google.com/drive/folders/example#ignored',
});
const hiddenExternalAnchor = createFakeAnchor('Hidden', {
  href: 'https://example.com/hidden',
  hidden: true,
});
const externalLinkDoc = {
  querySelectorAll(selector) {
    return selector === 'a[href]' ? [visibleExternalAnchor, hiddenExternalAnchor] : [];
  },
};
const collectedExternalLinks = collectExternalLinksFromDocument(externalLinkDoc, {
  baseHref: 'https://moocs.iniad.org/courses/2026/COT101',
  currentOrigin: 'https://moocs.iniad.org',
});
if (
  collectedExternalLinks.length !== 1 ||
  collectedExternalLinks[0].href !== 'https://drive.google.com/drive/folders/example'
) {
  throw new Error('External link document collection failed.');
}
const courseContainer = {
  textContent: 'COT101 View Course',
  parentElement: { append() {} },
  querySelector(selector) {
    if (selector.includes('h1')) return { textContent: 'COT101' };
    if (selector === 'img[alt]') return null;
    return null;
  },
  querySelectorAll(selector) {
    if (selector === 'a[href]') {
      return [createFakeAnchor('Drive', { href: 'https://drive.google.com/drive/folders/course' })];
    }
    return [];
  },
};
const courseAnchor = createFakeAnchor('View Course', {
  href: 'https://moocs.iniad.org/courses/2026/COT101',
  container: courseContainer,
});
const courseDoc = {
  querySelectorAll(selector) {
    return selector.includes('/courses/') ? [courseAnchor] : [];
  },
};
const courseCards = collectCourseCardElements(courseDoc, {
  baseHref: 'https://moocs.iniad.org/courses',
  currentHost: 'moocs.iniad.org',
});
if (
  courseCards.length !== 1 ||
  !isCourseCardElement(courseCards[0]) ||
  getCourseCardTitle(courseCards[0]) !== 'COT101' ||
  getCourseCardDriveUrl(courseCards[0]) !== 'https://drive.google.com/drive/folders/course'
) {
  throw new Error('Course card collection failed.');
}
const memoContextDoc = {
  querySelectorAll(selector) {
    if (selector.includes('h1') || selector.includes('h2')) {
      return [{ textContent: 'COT101' }, { textContent: '10-1 Lecture' }];
    }
    return [];
  },
};
const memoContext = collectMemoPageContextFromDocument(
  memoContextDoc,
  'https://moocs.iniad.org/courses/2026/COT101/10-1',
  'Fallback',
);
const memoRecord = normalizeMemoRecord({ notes: null }, memoContext, '2026-06-26T00:00:00.000Z');
const memoNote = createMemoNote('body', '2026-06-26T00:00:00.000Z', 'fixed');
if (
  memoContext.courseTitle !== 'COT101' ||
  memoContext.lectureTitle !== '10-1 Lecture' ||
  memoRecord.notes.length !== 0 ||
  memoNote.id !== 'memo-1782432000000-fixed'
) {
  throw new Error('Page memo shared helpers failed.');
}

const deadlineNow = Date.parse('2026-06-22T12:00:00+09:00');
const todayDeadline = getAssignmentDeadlineState(
  { deadlineDate: '2026-06-22', deadlineTime: '23:59', status: 'not_submitted' },
  { now: deadlineNow },
);
if (todayDeadline.tone !== 'today' || !todayDeadline.alert) {
  throw new Error('JST today assignment deadline state failed.');
}
const soonDeadline = getAssignmentDeadlineState(
  { deadlineDate: '2026-06-24', deadlineTime: '23:59', status: 'not_submitted' },
  { now: deadlineNow },
);
if (soonDeadline.tone !== 'soon' || soonDeadline.remainingDays !== 2) {
  throw new Error('Soon assignment deadline state failed.');
}
const overdueDeadline = getAssignmentDeadlineState(
  { deadlineDate: '2026-06-21', deadlineTime: '23:59', status: 'not_submitted' },
  { now: deadlineNow },
);
if (overdueDeadline.tone !== 'overdue' || !overdueDeadline.alert) {
  throw new Error('Overdue assignment deadline state failed.');
}
const completedDeadline = getAssignmentDeadlineState(
  { deadlineDate: '2026-06-21', deadlineTime: '23:59', status: 'submitted' },
  { now: deadlineNow },
);
if (completedDeadline.tone !== 'complete' || completedDeadline.alert) {
  throw new Error('Submitted assignments must not be marked overdue.');
}
const unpublishedDeadline = getAssignmentDeadlineState(
  { deadlineDate: '2026-06-21', deadlineTime: '23:59', status: 'unpublished' },
  { now: deadlineNow },
);
if (unpublishedDeadline.tone !== 'unpublished' || unpublishedDeadline.alert) {
  throw new Error('Unpublished assignments must not emit overdue alerts.');
}
if (parseAssignmentDeadline({ deadlineDate: '2026-02-30', deadlineTime: '23:59' }) !== null) {
  throw new Error('Invalid stored assignment deadlines must be rejected.');
}
const dedupedAssignments = dedupeAssignmentRecords([
  {
    key: 'old',
    url: 'https://moocs.iniad.org/courses/2026/COT101/10-1/task?from=navigation#top',
    status: 'not_submitted',
    checkedAt: '2026-06-20T00:00:00.000Z',
    deadlineDate: '2026-06-25',
    deadlineTime: '23:59',
    deadlineSource: 'page-candidate',
  },
  {
    key: 'new',
    url: 'https://moocs.iniad.org/courses/2026/COT101/10-1/task/',
    status: 'submitted',
    confidence: 'high',
    checkedAt: '2026-06-21T00:00:00.000Z',
    deadlineDate: '2026-06-26',
    deadlineTime: '18:00',
    deadlineSource: 'manual',
  },
]);
if (
  dedupedAssignments.length !== 1 ||
  dedupedAssignments[0].status !== 'submitted' ||
  dedupedAssignments[0].deadlineDate !== '2026-06-26'
) {
  throw new Error('Duplicate assignment record merge failed.');
}
const deadlinePriorityOrder = [
  { id: 'complete', deadlineDate: '2026-06-20', deadlineTime: '23:59', status: 'submitted' },
  { id: 'unset', status: 'not_submitted' },
  { id: 'scheduled', deadlineDate: '2026-07-10', deadlineTime: '23:59', status: 'not_submitted' },
  { id: 'soon', deadlineDate: '2026-06-24', deadlineTime: '23:59', status: 'not_submitted' },
  { id: 'today', deadlineDate: '2026-06-22', deadlineTime: '23:59', status: 'not_submitted' },
  { id: 'overdue', deadlineDate: '2026-06-21', deadlineTime: '23:59', status: 'not_submitted' },
]
  .sort((a, b) => compareAssignmentDeadlineUrgency(a, b, { now: deadlineNow }))
  .map((record) => record.id)
  .join(',');
if (deadlinePriorityOrder !== 'overdue,today,soon,scheduled,unset,complete') {
  throw new Error(`Assignment deadline priority order failed: ${deadlinePriorityOrder}`);
}
const assignmentLectureDetails = getAssignmentLectureDetails(
  [
    { id: 'unset', url: 'https://moocs.iniad.org/courses/2026/COT101/10-1/10-1-5', status: 'not_submitted' },
    { id: 'unpublished', url: 'https://moocs.iniad.org/courses/2026/COT101/10-1/review', status: 'unpublished' },
    { id: 'submitted', url: 'https://moocs.iniad.org/courses/2026/COT101/10-1/10-1-6', status: 'submitted', deadlineDate: '2026-06-20' },
    { id: 'soon', url: 'https://moocs.iniad.org/courses/2026/COT101/10-1/10-1-4', status: 'unchecked', deadlineDate: '2026-06-24' },
    { id: 'today', url: 'https://moocs.iniad.org/courses/2026/COT101/10-1/10-1-3', status: 'pending_confirmation', deadlineDate: '2026-06-22' },
    { id: 'overdue-old', url: 'https://moocs.iniad.org/courses/2026/COT101/10-1/10-1-2#old', status: 'not_submitted', checkedAt: '2026-06-20T00:00:00.000Z', deadlineDate: '2026-06-21' },
    { id: 'overdue', url: 'https://moocs.iniad.org/courses/2026/COT101/10-1/10-1-2', status: 'not_submitted', checkedAt: '2026-06-21T00:00:00.000Z', deadlineDate: '2026-06-21' },
    { id: 'scheduled', url: 'https://moocs.iniad.org/courses/2026/COT101/10-1/10-1-1', status: 'unknown', deadlineDate: '2026-07-10' },
  ],
  { now: deadlineNow, warningDays: 7 },
);
if (
  assignmentLectureDetails.map((record) => record.id).join(',') !==
  'overdue,today,soon,scheduled,unset,unpublished'
) {
  throw new Error(
    `Assignment lecture detail filtering failed: ${assignmentLectureDetails.map((record) => record.id).join(',')}`,
  );
}
const assignmentOverview = getAssignmentOverview(
  [
    { id: 'overdue', url: 'https://moocs.iniad.org/courses/2026/COT101/10-1/a', status: 'not_submitted', deadlineDate: '2026-06-21' },
    { id: 'soon', url: 'https://moocs.iniad.org/courses/2026/COT101/10-1/b', status: 'unchecked', deadlineDate: '2026-06-29' },
    { id: 'later', url: 'https://moocs.iniad.org/courses/2026/COT101/10-1/c', status: 'not_submitted', deadlineDate: '2026-06-30' },
    { id: 'unset', url: 'https://moocs.iniad.org/courses/2026/COT101/10-1/d', status: 'not_submitted' },
    { id: 'done', url: 'https://moocs.iniad.org/courses/2026/COT101/10-1/e', status: 'submitted', deadlineDate: '2026-06-20' },
    { id: 'other-lecture', url: 'https://moocs.iniad.org/courses/2026/COT101/09-3/a', status: 'submitted', deadlineDate: '2026-06-18' },
    { id: 'old', url: 'https://moocs.iniad.org/courses/2025/COT101/10-1/f', status: 'not_submitted', deadlineDate: '2026-06-22' },
  ],
  { now: deadlineNow, warningDays: 7 },
);
if (
  assignmentOverview.year !== '2026' ||
  assignmentOverview.upcoming.map((record) => record.id).join(',') !== 'overdue,soon' ||
  assignmentOverview.unsetCount !== 1 ||
  assignmentOverview.lectures.length !== 2 ||
  assignmentOverview.lectures.find((lecture) => lecture.lecture === '10-1')?.totalCount !== 5 ||
  assignmentOverview.lectures.find((lecture) => lecture.lecture === '10-1')?.remainingCount !== 4 ||
  assignmentOverview.lectures.find((lecture) => lecture.lecture === '10-1')?.submittedCount !== 1 ||
  assignmentOverview.lectures.find((lecture) => lecture.lecture === '10-1')?.deadline?.tone !== 'overdue' ||
  assignmentOverview.lectures.find((lecture) => lecture.lecture === '09-3')?.deadlineLabel !== '提出済み'
) {
  throw new Error(`Assignment overview filtering failed: ${JSON.stringify(assignmentOverview)}`);
}
const overviewWithoutCompletedLectures = getAssignmentOverview(
  assignmentOverview.lectures.flatMap((lecture) => lecture.records),
  { now: deadlineNow, warningDays: 7, hideCompleted: true },
);
if (
  overviewWithoutCompletedLectures.lectures.some(
    (lecture) => lecture.totalCount > 0 && lecture.submittedCount === lecture.totalCount,
  ) ||
  !overviewWithoutCompletedLectures.lectures.some((lecture) => lecture.lecture === '10-1')
) {
  throw new Error('Completed assignment lecture visibility filter failed.');
}
const phaseThreePendingRecord = {
  id: 'phase-three-task',
  url: 'https://moocs.iniad.org/courses/2026/COT101/11-1/task',
  status: 'not_submitted',
};
const phaseThreePendingOverview = getAssignmentOverview([phaseThreePendingRecord], {
  now: deadlineNow,
  year: 2026,
});
const phaseThreeSubmittedRecord = { ...phaseThreePendingRecord, status: 'submitted' };
const phaseThreeSubmittedOverview = getAssignmentOverview([phaseThreeSubmittedRecord], {
  now: deadlineNow,
  year: 2026,
});
const phaseThreeHiddenOverview = getAssignmentOverview([phaseThreeSubmittedRecord], {
  now: deadlineNow,
  year: 2026,
  hideCompleted: true,
});
if (
  getAssignmentLectureDetails([phaseThreePendingRecord], { now: deadlineNow }).length !== 1 ||
  getAssignmentLectureDetails([phaseThreeSubmittedRecord], { now: deadlineNow }).length !== 0 ||
  phaseThreePendingOverview.lectures[0]?.remainingCount !== 1 ||
  phaseThreeSubmittedOverview.lectures[0]?.remainingCount !== 0 ||
  phaseThreeSubmittedOverview.lectures[0]?.submittedCount !== 1 ||
  phaseThreeHiddenOverview.lectures.length !== 0
) {
  throw new Error('Assignment overview state transition failed.');
}

const sourceFiles = [
  'src/background/index.js',
  ...contentScriptFiles,
  'src/options/options.js',
  'src/popup/popup.js',
  ...sharedScriptFiles,
];

for (const file of [...new Set(sourceFiles)]) {
  const source = await readFile(path.join(rootDir, file), 'utf8');
  if (source.includes('glassmoocs:') || source.includes('iniadpp_')) {
    throw new Error(`${file} contains a legacy namespace.`);
  }
}

const contentSource = await readFile(path.join(rootDir, 'src/content/index.js'), 'utf8');
const lectureAssignmentMiniPanelSource = await readFile(path.join(rootDir, 'src/content/lectureAssignmentMiniPanel.js'), 'utf8');
const assignmentOverviewPanelSource = await readFile(path.join(rootDir, 'src/content/assignmentOverviewPanel.js'), 'utf8');
const assignmentFrameInspectionSource = await readFile(path.join(rootDir, 'src/content/assignmentFrameInspection.js'), 'utf8');
const downloadPanelViewSource = await readFile(path.join(rootDir, 'src/content/downloadPanelView.js'), 'utf8');
const externalLinksPanelSource = await readFile(path.join(rootDir, 'src/content/externalLinksPanel.js'), 'utf8');
const externalLinksSource = await readFile(path.join(rootDir, 'src/shared/externalLinks.js'), 'utf8');
const contentStyleSource = await readFile(path.join(rootDir, 'src/styles/content.css'), 'utf8');
const popupHtmlSource = await readFile(path.join(rootDir, 'src/popup/index.html'), 'utf8');
const popupSource = await readFile(path.join(rootDir, 'src/popup/popup.js'), 'utf8');
if (
  popupHtmlSource.includes('<h1>Ready</h1>') ||
  popupSource.includes('background / downloads API ready') ||
  popupSource.includes("state.textContent = enabled ? 'ON' : 'OFF'")
) {
  throw new Error('Popup user-facing status must be localized to Japanese.');
}
if (
  !popupHtmlSource.includes('拡張機能の状態') ||
  !popupSource.includes("statusTitle.textContent = '正常に動作しています'") ||
  !popupSource.includes("state.textContent = enabled ? '有効' : '無効'")
) {
  throw new Error('Localized popup status UI is missing.');
}
if (!contentSource.includes('const hasBackground = glassEnabled && Boolean(')) {
  throw new Error('Background customization must be disabled when glassmorphism is OFF.');
}
if (
  !contentSource.includes('isOwnedNode: isMoocsUltimateOwnedNode') ||
  !externalLinksSource.includes('isOwnedNode(link)') ||
  !externalLinksPanelSource.includes("linkHost.className = 'um-external-link-host'") ||
  !externalLinksPanelSource.includes("label.textContent = '外部リンク'")
) {
  throw new Error('External links must exclude extension-owned UI and show destination hosts.');
}
if (contentSource.includes('html[data-um-glassmorphism="false"] .content-wrapper')) {
  throw new Error('Glassmorphism OFF must preserve the native MOOCs page background.');
}
if (!lectureAssignmentMiniPanelSource.includes('um-lecture-assignment-deadline')) {
  throw new Error('Lecture assignment deadline UI is missing.');
}
if (
  !assignmentFrameInspectionSource.includes("frame.setAttribute('sandbox', 'allow-same-origin')") ||
  assignmentFrameInspectionSource.includes("frame.setAttribute('sandbox', 'allow-same-origin allow-scripts") ||
  assignmentFrameInspectionSource.includes("frame.setAttribute('sandbox', 'allow-same-origin allow-forms")
) {
  throw new Error('Assignment candidate frame inspection must stay sandboxed without scripts or forms.');
}
if (
  !assignmentOverviewPanelSource.includes('um-assignment-overview-toggle') ||
  !assignmentOverviewPanelSource.includes('um-assignment-overview-detail') ||
  !assignmentOverviewPanelSource.includes('aria-expanded') ||
  !assignmentOverviewPanelSource.includes("setAttribute('aria-labelledby'") ||
  !assignmentOverviewPanelSource.includes("setAttribute('role', 'list')") ||
  !assignmentOverviewPanelSource.includes('focusedLectureKey') ||
  !assignmentOverviewPanelSource.includes('shouldRestoreFocus') ||
  !assignmentOverviewPanelSource.includes('expandedLectures') ||
  !assignmentOverviewPanelSource.includes('renderGeneration')
) {
  throw new Error('Assignment overview expansion UI is missing.');
}
if (
  !contentStyleSource.includes('container-name: um-assignment-overview') ||
  !contentStyleSource.includes('@container um-assignment-overview (max-width: 820px)') ||
  !contentStyleSource.includes('@container um-assignment-overview (max-width: 520px)')
) {
  throw new Error('Assignment overview container-responsive styles are missing.');
}
if (!downloadPanelViewSource.includes('data-um-download="extract-slide-text"')) {
  throw new Error('Independent Slides text extraction UI is missing from the download panel.');
}
if (contentSource.includes('送信内容の確認') || contentSource.includes('data-um-ai="prepare"')) {
  throw new Error('Legacy AI source preview UI must not remain in the AI summary panel.');
}
const messageSource = await readFile(path.join(rootDir, 'src/shared/messages.js'), 'utf8');
if (!messageSource.includes("slidesTextExtract: 'ultimateMoocs:slidesText.extract'")) {
  throw new Error('Namespaced Slides text extraction message is missing.');
}
if (!messageSource.includes("diagnosticsGet: 'ultimateMoocs:diagnostics.get'")) {
  throw new Error('Namespaced developer diagnostics message is missing.');
}
const optionsSource = await readFile(path.join(rootDir, 'src/options/options.js'), 'utf8');
const optionsHtmlSource = await readFile(path.join(rootDir, 'src/options/index.html'), 'utf8');
const backgroundSource = await readFile(path.join(rootDir, 'src/background/index.js'), 'utf8');
if (
  !optionsSource.includes('currentSettings.debug.enableDebugLog') ||
  !optionsHtmlSource.includes('id="diagnostics-tab"') ||
  !backgroundSource.includes('デベロッパーモードがOFFのため診断機能は利用できません。')
) {
  throw new Error('Developer-only diagnostics gate is missing.');
}

const explicitDeadline = extractDeadlineCandidatesFromLines(['提出期限: 2026年6月28日 18:30'], { defaultYear: 2026 });
if (explicitDeadline[0]?.id !== '2026-06-28T18:30' || explicitDeadline[0]?.inferredYear || explicitDeadline[0]?.inferredTime) {
  throw new Error('Explicit assignment deadline parsing failed.');
}
const inferredDeadline = extractDeadlineCandidatesFromLines(['6/30までに提出してください'], { defaultYear: 2026 });
if (inferredDeadline[0]?.id !== '2026-06-30T23:59' || !inferredDeadline[0]?.inferredYear || !inferredDeadline[0]?.inferredTime) {
  throw new Error('Inferred assignment deadline parsing failed.');
}
if (extractDeadlineCandidatesFromLines(['講義日は6月30日です'], { defaultYear: 2026 }).length) {
  throw new Error('Unrelated dates must not be treated as assignment deadlines.');
}
const looseDate = extractDeadlineCandidatesFromLines(['講義日は6月30日です'], {
  defaultYear: 2026,
  allowLooseDates: true,
});
if (looseDate[0]?.id !== '2026-06-30T23:59' || looseDate[0]?.contextMatched) {
  throw new Error('Loose deadline date suggestions failed.');
}
const lectureIds = extractDeadlineCandidatesFromLines([
  'TABLE OF CONTENTS 01-1: Python入門 01-2: 文字列 01-3: 復習 02-1: 変数 02-2: 条件分岐',
], {
  defaultYear: 2026,
  allowLooseDates: true,
});
if (lectureIds.length) {
  throw new Error('Lecture identifiers must not be treated as loose assignment deadlines.');
}
const explicitHyphenDeadline = extractDeadlineCandidatesFromLines(['提出期限: 6-23 18:30'], {
  defaultYear: 2026,
  allowLooseDates: true,
});
if (explicitHyphenDeadline[0]?.id !== '2026-06-23T18:30') {
  throw new Error('Hyphenated dates with deadline context must remain supported.');
}
const shimeDeadline = extractDeadlineCandidatesFromLines(['〆切：6/23（火）23:59'], { defaultYear: 2026 });
if (shimeDeadline[0]?.id !== '2026-06-23T23:59' || !shimeDeadline[0]?.contextMatched) {
  throw new Error('Japanese shime deadline parsing failed.');
}
if (extractDeadlineCandidatesFromLines(['提出期限: 2026年2月30日'], { defaultYear: 2026 }).length) {
  throw new Error('Invalid assignment deadline dates must be rejected.');
}

console.log('Project check passed.');
