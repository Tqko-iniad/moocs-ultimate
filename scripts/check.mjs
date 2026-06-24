import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractDeadlineCandidatesFromLines } from '../src/shared/deadlineCandidates.js';
import { createExternalLinkEntry, dedupeExternalLinkEntries } from '../src/shared/externalLinks.js';
import { isAttendanceFieldInstruction, isPreviousAttendanceTitle } from '../src/shared/attendanceDetection.js';
import { validateAndNormalizeSettings } from '../src/shared/defaultSettings.js';
import {
  compareAssignmentDeadlineUrgency,
  dedupeAssignmentRecords,
  getAssignmentLectureDetails,
  getAssignmentOverview,
  getAssignmentDeadlineState,
  parseAssignmentDeadline,
} from '../src/shared/assignmentDeadline.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');

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
  'src/content/index.js',
  'src/slides/index.js',
  'src/options/index.html',
  'src/options/options.js',
  'src/popup/index.html',
  'src/popup/popup.js',
  'src/styles/content.css',
  'src/shared/browserApi.js',
  'src/shared/defaultSettings.js',
  'src/shared/attendanceDetection.js',
  'src/shared/assignmentDeadline.js',
  'src/shared/deadlineCandidates.js',
  'src/shared/externalLinks.js',
  'src/shared/storage.js',
  'src/shared/messages.js',
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
  'src/content/index.js',
  'src/options/options.js',
  'src/popup/popup.js',
  'src/shared/browserApi.js',
  'src/shared/storage.js',
  'src/shared/messages.js',
];

for (const file of sourceFiles) {
  const source = await readFile(path.join(rootDir, file), 'utf8');
  if (source.includes('glassmoocs:') || source.includes('iniadpp_')) {
    throw new Error(`${file} contains a legacy namespace.`);
  }
}

const contentSource = await readFile(path.join(rootDir, 'src/content/index.js'), 'utf8');
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
  !contentSource.includes('isExtensionUiNode(link)') ||
  !contentSource.includes("linkHost.className = 'um-external-link-host'") ||
  !contentSource.includes("label.textContent = '外部リンク'")
) {
  throw new Error('External links must exclude extension-owned UI and show destination hosts.');
}
if (contentSource.includes('html[data-um-glassmorphism="false"] .content-wrapper')) {
  throw new Error('Glassmorphism OFF must preserve the native MOOCs page background.');
}
if (!contentSource.includes('um-lecture-assignment-deadline')) {
  throw new Error('Lecture assignment deadline UI is missing.');
}
if (
  !contentSource.includes('um-assignment-overview-toggle') ||
  !contentSource.includes('um-assignment-overview-detail') ||
  !contentSource.includes('aria-expanded') ||
  !contentSource.includes("setAttribute('aria-labelledby'") ||
  !contentSource.includes("setAttribute('role', 'list')") ||
  !contentSource.includes('focusedLectureKey') ||
  !contentSource.includes('shouldRestoreFocus') ||
  !contentSource.includes('expandedAssignmentOverviewLectures') ||
  !contentSource.includes('assignmentOverviewRenderGeneration')
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
if (!contentSource.includes('data-um-download="extract-slide-text"')) {
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
