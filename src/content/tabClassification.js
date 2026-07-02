import {
  isAttendanceFieldInstruction,
  isPreviousAttendanceTitle,
} from '../shared/attendanceDetection.js';
import {
  SUBMISSION_ANSWER_SELECTOR,
  isNodeStaticallyHidden,
} from '../shared/assignmentDetection.js';
import { reportContentError } from '../shared/domUtils.js';

export function createTabClassifier({
  document: documentRef,
  window: windowRef,
  location: locationRef,
  normalizeVisibleLabelText,
  isMoocsUltimateOwnedNode,
  fetchMoocsHtmlDocument,
}) {
  const tabKindCache = new Map();

  function classifyText(text) {
    if (isPreviousAttendanceTitle(text)) return 'attendanceTest';
    if (/出席\s*(?:\/\s*)?課題|attendance.?assignment/i.test(text)) return 'attendanceAssignment';
    if (/出席(?:\s*(?:確認|テスト))?|attendance.?(?:check|test)/i.test(text)) return 'attendanceTest';
    if (/スライド|資料|slide|material/i.test(text)) return 'slide';
    if (/理解度確認|理解度|テスト|確認|check|quiz|test/i.test(text)) return 'check';
    if (/課題|assignment|homework|report/i.test(text)) return 'assignment';
    return '';
  }

  function hasGoogleSlidesEmbed(doc) {
    return [...doc.querySelectorAll('iframe[src]')].some((frame) =>
      /docs\.google\.com\/presentation/i.test(frame.src),
    );
  }

  function classifyDocument(doc = documentRef) {
    if (isAttendanceDocument(doc)) return 'attendanceTest';
    const text = [
      doc.title,
      ...[...doc.querySelectorAll('h1, h2, h3, .content-header, .box-title')]
        .map((node) => node.textContent?.trim())
        .filter(Boolean)
        .slice(0, 8),
    ].join(' ');
    const kind = classifyText(text);
    if (!kind && hasGoogleSlidesEmbed(doc)) return 'slide';
    return kind;
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

  function getAttendanceDocumentHeadingText(doc = documentRef) {
    return [
      doc.title,
      ...[...doc.querySelectorAll('h1, h2, h3, .content-header, .box-title')]
        .map((node) => normalizeVisibleLabelText(node.textContent))
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
      .map((text) => normalizeVisibleLabelText(text))
      .join(' ');
  }

  function isAttendanceDocument(doc = documentRef) {
    if (isPreviousAttendanceTitle(getAttendanceDocumentHeadingText(doc))) return true;
    return [...doc.querySelectorAll(SUBMISSION_ANSWER_SELECTOR)].some((input) => {
      if (isMoocsUltimateOwnedNode(input) || isNodeStaticallyHidden(input)) return false;
      return isAttendanceFieldInstruction(getSubmissionInputInstructionText(doc, input));
    });
  }

  function isNumberPageTab(link) {
    const text = [...link.childNodes]
      .filter((node) => !(node instanceof windowRef.Element && node.classList.contains('um-assignment-tab-marker')))
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
      url = new URL(href, locationRef.href);
    } catch {
      return '';
    }
    if (url.origin !== locationRef.origin) return '';

    const cacheKey = url.href.replace(/#.*$/, '');
    if (tabKindCache.has(cacheKey)) return resolveKind(tabKindCache.get(cacheKey));

    try {
      const doc = await fetchMoocsHtmlDocument(url);
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
    const nearTop = rect.top < Math.max(360, windowRef.innerHeight * 0.45);
    const inKnownNav = Boolean(
      link.closest('.nav-tabs, .nav-pills, .pagination, .breadcrumb, .content-header'),
    );
    return nearTop && (inKnownNav || /^\d+$/.test(text) || classifyTab(link));
  }

  return {
    classifyText,
    classifyDocument,
    classifyTab,
    isAttendanceTabKind,
    isAttendanceDocument,
    isNumberPageTab,
    classifyNumberPageTab,
    isTopNavigationCandidate,
  };
}
