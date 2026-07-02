import { parseMoocsCourseRoute } from './moocsRoute.js';

const DIRECT_FILE_PATTERN =
  /\.(pdf|ppt|pptx|doc|docx|xls|xlsx|zip|rar|7z|txt|csv|png|jpe?g|gif|webp|svg|mp3|wav|m4a|mp4|mov|webm)(?:[?#].*)?$/i;
const STREAMING_PATTERN = /\.(m3u8|mpd)(?:[?#].*)?$/i;

function getCurrentLocationFallback() {
  return typeof location !== 'undefined' ? location : null;
}

function getCurrentDocumentFallback() {
  return typeof document !== 'undefined' ? document : null;
}

function isOwnedExtensionNode(node) {
  return Boolean(node?.closest?.('[data-um-module], [data-um-owned="true"]'));
}

function normalizeDownloadText(value) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim();
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function isLikelyLectureTitleLabel(value) {
  const text = normalizeDownloadText(value);
  return /^(#?\d+|第?\d+回|lecture\s*\d+|part\s*\d+|[0-9]{1,2}[-:：].+)$/i.test(text);
}

function findCourseTitleCandidate(doc, route) {
  const courseCode = normalizeDownloadText(route?.course || '');
  const candidates = [
    ...doc.querySelectorAll(
      '.breadcrumb li, .breadcrumb a, .content-header h1, .content-header h2, h1, h2, .box-title',
    ),
  ]
    .map((node) => normalizeDownloadText(node.textContent))
    .filter(Boolean)
    .filter((text) => text !== courseCode)
    .filter((text) => !/^\d{4}$/.test(text))
    .filter((text) => !/^#?\d+$/.test(text))
    .filter((text) => !isLikelyLectureTitleLabel(text));

  const nonGeneric = candidates.find((text) => !/^(list of courses|course|courses|講義|資料)$/i.test(text));
  return nonGeneric || '';
}

function buildCourseDownloadFolderName(doc, route) {
  const courseCode = normalizeDownloadText(route?.course || '');
  const courseTitle = courseCode
    ? findCourseTitleCandidate(doc, route).replace(new RegExp(`\\[?${escapeRegExp(courseCode)}\\]?`, 'i'), '').trim()
    : findCourseTitleCandidate(doc, route);
  if (courseCode && courseTitle) return `${courseTitle}[${courseCode}]`;
  return courseCode || courseTitle || getCurrentDocumentFallback()?.title || 'course';
}

export function sanitizePathPart(value, fallback = 'untitled') {
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

export function getMoocsPageTitle(doc, pageUrl) {
  const title =
    [...doc.querySelectorAll('h1, h2, .content-header h1, .content-header h2, .box-title')]
      .map((node) => node.textContent?.trim())
      .filter(Boolean)
      .find(Boolean) || '';
  if (title) return title;
  try {
    return new URL(pageUrl, getCurrentLocationFallback()?.href || 'https://moocs.iniad.org/').pathname
      .split('/')
      .filter(Boolean)
      .at(-1) || 'page';
  } catch {
    return 'page';
  }
}

export function getFilenameFromUrl(url, fallback = 'download', baseUrl = getCurrentLocationFallback()?.href || '') {
  try {
    const parsed = new URL(url, baseUrl || 'https://moocs.iniad.org/');
    const name = decodeURIComponent(parsed.pathname.split('/').filter(Boolean).at(-1) || fallback);
    return sanitizePathPart(name, fallback);
  } catch {
    return sanitizePathPart(fallback, fallback);
  }
}

export function getDownloadNamingContext(
  doc = getCurrentDocumentFallback(),
  pageUrl = getCurrentLocationFallback()?.href || '',
) {
  const headings = [...doc.querySelectorAll('h1, h2, .content-header h1, .content-header h2')]
    .map((node) => node.textContent?.trim())
    .filter(Boolean);
  const route = parseMoocsCourseRoute(pageUrl);
  const year = route?.year || new Date().getFullYear();
  const lectureName = getMoocsPageTitle(doc, pageUrl);
  return {
    year: String(year),
    courseName: buildCourseDownloadFolderName(doc, route) || headings[0] || getCurrentDocumentFallback()?.title || 'course',
    lectureGroup: route?.lecture || headings[1] || 'lecture',
    lectureName,
  };
}

export function buildDownloadCandidateFilename(candidate, context) {
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

export function convertDriveFileUrlToDownloadUrl(url, baseUrl = getCurrentLocationFallback()?.href || '') {
  try {
    const parsed = new URL(url, baseUrl || 'https://moocs.iniad.org/');
    if (!/drive\.google\.com$/i.test(parsed.hostname)) return url;
    const fileMatch = parsed.pathname.match(/\/file\/d\/([^/]+)/);
    const id = fileMatch?.[1] || parsed.searchParams.get('id');
    return id ? `https://drive.google.com/uc?export=download&id=${encodeURIComponent(id)}` : url;
  } catch {
    return url;
  }
}

export function createDownloadCandidateId(entry) {
  return `${entry.kind || 'unknown'}::${entry.url || entry.downloadUrl || entry.filename}`;
}

export function classifyDownloadCandidateKind(entry) {
  if (entry.kind === 'google_slides') return 'slides';
  if (/drive\.google\.com/i.test(entry.url || entry.downloadUrl || '')) return 'drive';
  if (entry.disabled && /stream/i.test(entry.disabledReason || '')) return 'streaming';
  if (entry.kind === 'direct_file') return 'file';
  return 'unknown';
}

export function getDownloadCandidateKindLabel(kind) {
  const labels = {
    slides: 'Slides',
    drive: 'Drive',
    file: 'File',
    streaming: 'Streaming',
    unknown: 'Other',
  };
  return labels[kind] || labels.unknown;
}

export function getDownloadCandidateDisplayTitle(entry) {
  const filename = String(entry.filename || '').split('/').filter(Boolean).at(-1);
  return filename || entry.url || 'download';
}

export function normalizeDownloadCandidateForRendering(entry) {
  const id = createDownloadCandidateId(entry);
  const kindLabel = classifyDownloadCandidateKind(entry);
  return {
    ...entry,
    id,
    candidateKind: kindLabel,
    title: getDownloadCandidateDisplayTitle(entry),
    selectable: !entry.disabled,
  };
}

export function createDownloadCandidateFromUrl(
  rawUrl,
  source,
  context,
  label = '',
  baseUrl = getCurrentLocationFallback()?.href || '',
) {
  let url;
  try {
    url = new URL(rawUrl, baseUrl || 'https://moocs.iniad.org/');
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
  const currentHost = getCurrentLocationFallback()?.host || 'moocs.iniad.org';
  if (url.host === currentHost && !DIRECT_FILE_PATTERN.test(url.pathname)) return null;

  const baseName = label || getFilenameFromUrl(href, isSlides ? 'google-slides' : 'download', baseUrl);
  const extensionName = isSlides
    ? `${sanitizePathPart(baseName, 'google-slides')}.slides`
    : getFilenameFromUrl(href, sanitizePathPart(baseName, 'download'), baseUrl);
  const candidate = {
    url: href,
    sourceUrl: href,
    downloadUrl: isDriveFile ? convertDriveFileUrlToDownloadUrl(href, baseUrl) : href,
    source,
    kind: isSlides ? 'google_slides' : 'direct_file',
    filename: extensionName,
    disabled: isStreaming,
    disabledReason: isStreaming ? 'Streaming playlist is not downloaded in this phase' : '',
  };
  candidate.filename = buildDownloadCandidateFilename(candidate, context);
  return candidate;
}

export function collectDownloadCandidatesFromDocument(
  doc = getCurrentDocumentFallback(),
  pageUrl = getCurrentLocationFallback()?.href || '',
) {
  if (!doc) return [];
  const context = getDownloadNamingContext(doc, pageUrl);
  const candidates = [];

  for (const link of doc.querySelectorAll('a[href]')) {
    if (isOwnedExtensionNode(link)) continue;
    const candidate = createDownloadCandidateFromUrl(
      link.getAttribute('href'),
      'link',
      context,
      link.textContent?.trim(),
      pageUrl,
    );
    if (candidate) candidates.push(candidate);
  }

  for (const frame of doc.querySelectorAll('iframe[src], embed[src]')) {
    if (isOwnedExtensionNode(frame)) continue;
    const candidate = createDownloadCandidateFromUrl(
      frame.getAttribute('src'),
      frame.tagName.toLowerCase(),
      context,
      frame.title,
      pageUrl,
    );
    if (candidate) candidates.push(candidate);
  }

  for (const object of doc.querySelectorAll('object[data]')) {
    if (isOwnedExtensionNode(object)) continue;
    const candidate = createDownloadCandidateFromUrl(object.getAttribute('data'), 'object', context, object.title, pageUrl);
    if (candidate) candidates.push(candidate);
  }

  return [...new Map(candidates.map((candidate) => [candidate.url, candidate])).values()];
}
