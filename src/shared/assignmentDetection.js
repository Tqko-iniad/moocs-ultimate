import { parseMoocsCourseRoute } from './moocsRoute.js';

export const SUBMISSION_ANSWER_SELECTOR =
  'textarea, select, [contenteditable="true"], input:not([type]), input[type="file"], input[type="text"], input[type="radio"], input[type="checkbox"]';

function normalizeAssignmentText(value) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function getAssignmentLinkSearchText(link) {
  return normalizeAssignmentText(
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

export function hasNonAssignmentLinkText(text) {
  return /課題\s*解説|解説\s*課題|解答|解答例|模範|答え合わせ|solution|explanation|スライド|資料|教材|bookmark|previous|next|google\s*slides|講義ツール|AI要約/i.test(
    text,
  );
}

export function hasStrongAssignmentLinkText(text) {
  return /(?:^|\s)(?:課題|レポート)\s*\d*|提出フォーム|提出してください|回答してください|回答は自動的に記録|assignment|homework|report|submit/i.test(
    text,
  );
}

export function hasAssignmentTabHintText(text) {
  return /課題|問題|レポート|提出|回答|assignment|homework|report|submit|question/i.test(text);
}

export function isUrlStrongAssignmentCandidate(url) {
  const route = parseMoocsCourseRoute(url.href);
  const page = route?.page || '';
  const path = route?.url?.pathname || url.pathname;
  return /(?:report-\d+|report|assignment|homework|submit|task|kadai)/i.test(`${page} ${path}`);
}

export function isUrlAssignmentReviewPage(url) {
  const route = parseMoocsCourseRoute(url.href);
  const page = route?.page || '';
  const path = route?.url?.pathname || url.pathname;
  return /(?:^|\/)review(?:\/|$)|^review$/i.test(`${page} ${path}`);
}

export function classifyAssignmentLinkCandidate(link, url, options = {}) {
  const text = getAssignmentLinkSearchText(link);
  const href = link.getAttribute('href') || '';
  const isPageTab = Boolean(options.isPageTab);
  const tabKind = options.tabKind || '';
  const isAttendanceTabKind = typeof options.isAttendanceTabKind === 'function'
    ? options.isAttendanceTabKind
    : () => false;
  const route = parseMoocsCourseRoute(url.href);
  const page = route?.page || '';
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
  if (isUrlStrongAssignmentCandidate(url)) {
    score += 4;
    reasons.push('assignment-url');
  }
  if (isUrlAssignmentReviewPage(url)) {
    score += 2;
    reasons.push('assignment-review-url');
  }
  if (hasStrongAssignmentLinkText(`${text} ${href}`)) {
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
  if (hasNonAssignmentLinkText(text) && !isUrlStrongAssignmentCandidate(url)) {
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

export function sortCollectedAssignmentRecords(records) {
  return [...new Map(records.map((record) => [record.url, record])).values()].sort((a, b) => {
    const routeA = parseMoocsCourseRoute(a.url);
    const routeB = parseMoocsCourseRoute(b.url);
    const pageA = routeA?.page || a.url;
    const pageB = routeB?.page || b.url;
    return pageA.localeCompare(pageB, 'ja', { numeric: true });
  });
}

export function findAssignmentEvidenceLine(lines, patterns, rejectPatterns = []) {
  for (const line of lines) {
    if (!patterns.some((pattern) => pattern.test(line))) continue;
    if (rejectPatterns.some((pattern) => pattern.test(line))) continue;
    return line.slice(0, 180);
  }
  return '';
}

export function isElementLikeNode(node) {
  return Boolean(node && node.nodeType === 1 && typeof node.matches === 'function');
}

export function isNodeStaticallyHidden(node) {
  if (!isElementLikeNode(node)) return false;
  for (let element = node; element; element = element.parentElement) {
    if (element.hidden || element.getAttribute('aria-hidden') === 'true') return true;
    const style = (element.getAttribute('style') || '').replace(/\s+/g, '').toLowerCase();
    if (/display:none|visibility:hidden|opacity:0/.test(style)) return true;
  }
  return false;
}

function isOwnedExtensionNode(node) {
  return Boolean(node?.closest?.('[data-um-module], [data-um-owned="true"]'));
}

function defaultIsVisiblePageContentNode(node) {
  return !isOwnedExtensionNode(node) && !isNodeStaticallyHidden(node);
}

function isDocumentVisiblePageContentNode(doc, node, options = {}) {
  if (!isElementLikeNode(node)) return false;
  if (isOwnedExtensionNode(node)) return false;
  if (doc === options.currentDocument && options.isVisiblePageContentNode) {
    return options.isVisiblePageContentNode(node);
  }
  return !isNodeStaticallyHidden(node);
}

function isSubmissionNodeAvailable(doc, node, options = {}) {
  return isDocumentVisiblePageContentNode(doc, node, options);
}

function isSubmissionAnswerNodeAvailable(doc, node, options = {}) {
  if (isSubmissionNodeAvailable(doc, node, options)) return true;
  if (doc !== options.currentDocument || !node.matches('input[type="file"]')) return false;

  const isVisiblePageContentNode = options.isVisiblePageContentNode || defaultIsVisiblePageContentNode;
  const problemRoot = node.closest('.problem-contentpage');
  if (!problemRoot || !isVisiblePageContentNode(problemRoot)) return false;
  const uploadRoot = node.closest('.file-container') || problemRoot;
  return [...uploadRoot.querySelectorAll('button, a.btn, label')]
    .filter((control) => isVisiblePageContentNode(control))
    .some((control) => /ファイルをアップロード|アップロード|upload/i.test(
      control.textContent || control.getAttribute('aria-label') || control.getAttribute('title') || '',
    ));
}

export function hasSubmissionFormInDocument(doc, options = {}) {
  if (options.isAttendanceDocument?.(doc)) return false;
  const hasForm = [...doc.querySelectorAll('form')].some((form) => {
    if (isOwnedExtensionNode(form)) return false;
    const hasAnswerInput = [...form.querySelectorAll(SUBMISSION_ANSWER_SELECTOR)]
      .some((node) => isSubmissionAnswerNodeAvailable(doc, node, options));
    const submitText = [...form.querySelectorAll('button, input[type="submit"], input[type="button"]')]
      .filter((node) => isSubmissionNodeAvailable(doc, node, options))
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
    if (isOwnedExtensionNode(root)) return false;
    const hasAnswerInput = [...root.querySelectorAll(SUBMISSION_ANSWER_SELECTOR)]
      .some((node) => isSubmissionAnswerNodeAvailable(doc, node, options));
    if (!hasAnswerInput) return false;
    const submitText = [...root.querySelectorAll('button, input[type="submit"], input[type="button"], a.btn')]
      .filter((node) => isSubmissionNodeAvailable(doc, node, options))
      .map((node) => node.textContent || node.value || node.getAttribute('aria-label') || '')
      .join(' ');
    return /提出|送信|回答|submit|turn in/i.test(submitText);
  });
}

export function collectDocumentContentLines(doc, options = {}) {
  const isVisiblePageContentNode = options.isVisiblePageContentNode || defaultIsVisiblePageContentNode;
  return [
    ...doc.querySelectorAll('h1, h2, h3, h4, p, li, label, .box, .panel, .card, .content-header, .box-title'),
  ]
    .filter((node) => (doc === options.currentDocument ? isVisiblePageContentNode(node) : !isOwnedExtensionNode(node) && !isNodeStaticallyHidden(node)))
    .map((node) => normalizeAssignmentText(node.textContent || ''))
    .flatMap((text) => text.split(/(?<=。)|[\n\r]+/))
    .map((line) => normalizeAssignmentText(line))
    .filter((line) => line.length >= 2);
}

export function findDocumentUnpublishedAssignmentEvidence(doc, options = {}) {
  const coverpageEvidence = findDocumentUnpublishedProblemCoverpageEvidence(doc, options);
  if (coverpageEvidence) return coverpageEvidence;
  if (hasSubmissionFormInDocument(doc, options)) return '';
  return findAssignmentEvidenceLine(collectDocumentContentLines(doc, options), [
    /現在この問題は非公開です。?/,
    /この問題は非公開です。?/,
    /問題は非公開です。?/,
  ]);
}

export function findDocumentUnpublishedProblemCoverpageEvidence(doc, options = {}) {
  const coverpages = [
    ...new Set([
      ...doc.querySelectorAll('.problem-container .problem-coverpage'),
      ...doc.querySelectorAll('.problem-coverpage'),
    ]),
  ];
  for (const coverpage of coverpages) {
    if (!isDocumentVisiblePageContentNode(doc, coverpage, options)) continue;
    const container = coverpage.closest?.('.problem-container');
    const contentpage = container?.querySelector?.('.problem-contentpage');
    if (contentpage && isDocumentVisiblePageContentNode(doc, contentpage, options)) continue;
    const evidence = findAssignmentEvidenceLine([normalizeAssignmentText(coverpage.textContent || '')], [
      /現在この問題は非公開です。?/,
      /この問題は非公開です。?/,
      /問題は非公開です。?/,
    ]);
    if (!evidence) continue;
    const openControl = findAssignmentEvidenceLine(
      [...coverpage.querySelectorAll('button, a.btn, a[href], input[type="button"], input[type="submit"]')]
        .filter((node) => isDocumentVisiblePageContentNode(doc, node, options))
        .map((node) => normalizeAssignmentText(
          node.textContent || node.value || node.getAttribute('aria-label') || node.getAttribute('title') || '',
        )),
      [/問題を開く|問題を表示|open\s+(?:the\s+)?(?:problem|question)/i],
    );
    return openControl ? `${evidence} / ${openControl}` : evidence;
  }
  return '';
}

export function findDocumentProblemOpenControlEvidence(doc, options = {}) {
  const isVisiblePageContentNode = options.isVisiblePageContentNode || defaultIsVisiblePageContentNode;
  const controls = [...doc.querySelectorAll('button, a.btn, a[href], input[type="button"], input[type="submit"]')].filter((node) =>
    doc === options.currentDocument ? isVisiblePageContentNode(node) : !isOwnedExtensionNode(node) && !isNodeStaticallyHidden(node),
  );
  for (const control of controls) {
    const text = normalizeAssignmentText(
      control.textContent || control.value || control.getAttribute('aria-label') || control.getAttribute('title') || '',
    );
    if (/問題を開く|問題を表示|open\s+(?:the\s+)?(?:problem|question)/i.test(text)) return text.slice(0, 120);
  }
  return '';
}

export function findDocumentAssignmentHeading(doc) {
  const headings = [
    doc.title,
    ...[...doc.querySelectorAll('h1, h2, h3, .content-header h1, .content-header h2, .box-title')]
      .map((node) => normalizeAssignmentText(node.textContent))
      .filter(Boolean)
      .slice(0, 10),
  ]
    .map((text) => normalizeAssignmentText(text))
    .filter(Boolean);
  return headings.find((text) => {
    if (hasNonAssignmentLinkText(text)) return false;
    return /^(?:課題|レポート)\s*\d+(?:[-ー－]\d+)?(?:\s|:|：|$)|^(?:assignment|homework|report)\s*\d+/i.test(text);
  }) || '';
}

export function detectAssignmentSignalInDocument(doc, url, candidate, options = {}) {
  if (options.isAttendanceDocument?.(doc)) {
    return {
      ok: false,
      status: '',
      confidence: 'high',
      evidence: '出席確認ページのタイトルまたは教室・座席入力欄を検出しました。',
      attendancePage: true,
    };
  }
  const unpublishedEvidence = findDocumentUnpublishedAssignmentEvidence(doc, options);
  if (unpublishedEvidence) {
    const openControlEvidence = findDocumentProblemOpenControlEvidence(doc, options);
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
    if (!candidate.likelyAssignment && !isUrlStrongAssignmentCandidate(url)) {
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
  if (hasSubmissionFormInDocument(doc, options)) {
    return {
      ok: true,
      status: 'not_submitted',
      confidence: 'medium',
      evidence: '提出フォームを検出しました。提出済み表示はまだ見つかっていません。',
    };
  }
  const problemRoot = doc.querySelector('.problem-contentpage');
  if (problemRoot && !isNodeStaticallyHidden(problemRoot)) {
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
      .map((node) => normalizeAssignmentText(node.textContent))
      .filter(Boolean)
      .slice(0, 10),
  ].join(' ');
  const assignmentHeading = findDocumentAssignmentHeading(doc);
  const lines = collectDocumentContentLines(doc, options);
  const bodySignal = findAssignmentEvidenceLine(lines, [
    /回答は自動的に記録されます/,
    /最後に「?提出」?ボタンをクリック/,
    /提出フォーム/,
    /ファイルをアップロード/,
  ]);
  const textLooksExcluded = hasNonAssignmentLinkText(`${titleText} ${candidate.text}`) && !bodySignal;
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
  if (candidate.likelyAssignment && !textLooksExcluded && isUrlStrongAssignmentCandidate(url)) {
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
