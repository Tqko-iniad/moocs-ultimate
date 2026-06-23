const MESSAGE_PREFIX = 'ultimateMoocs:slides.';
const runtimeApi = globalThis.browser?.runtime ? globalThis.browser : globalThis.chrome;
const INLINE_IMAGE_CONCURRENCY = 6;
let fastSvgSessionCache = null;

function visibleText(selector) {
  return [...document.querySelectorAll(selector)]
    .map((node) => node.textContent?.trim())
    .find(Boolean);
}

function getTitle() {
  return (
    visibleText('[aria-label*="title" i], .punch-viewer-title, .docs-title-input-label') ||
    document.title.replace(/[-–|].*$/, '').trim() ||
    'google-slides'
  );
}

function parsePageInfoFromText() {
  const text = document.body?.innerText || '';
  const patterns = [
    /(\d+)\s*(?:\/|of)\s*(\d+)/i,
    /スライド\s*(\d+)\s*(?:\/|中)\s*(\d+)/,
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) {
      return {
        currentPage: Number(match[1]),
        totalPages: Number(match[2]),
      };
    }
  }
  return null;
}

function getThumbnailCount() {
  const candidates = [
    '[aria-label*="Slide" i]',
    '[aria-label*="スライド"]',
    '.punch-filmstrip-thumbnail',
    '.punch-filmstrip-thumbnail-container',
    '.punch-viewer-thumbnail',
  ];
  return Math.max(0, ...candidates.map((selector) => document.querySelectorAll(selector).length));
}

function getSessionInfo() {
  const pageInfo = parsePageInfoFromText();
  const thumbnailCount = getThumbnailCount();
  const viewerTotalPages = getViewerTotalPages();
  const viewerCurrentPage = getViewerCurrentPage();
  const totalPages = Math.max(viewerTotalPages || 0, pageInfo?.totalPages || 0, thumbnailCount || 0, 1);
  const currentPage = Math.min(Math.max(viewerCurrentPage || pageInfo?.currentPage || 1, 1), totalPages);
  return {
    title: getTitle(),
    currentPage,
    totalPages,
    url: location.href,
  };
}

function normalizeText(value, fallback = '') {
  if (typeof value !== 'string') return fallback;
  const normalized = value.replace(/\s+/g, ' ').trim();
  return normalized || fallback;
}

function getPageCaptionElement() {
  return (
    document.querySelector('.docs-material-menu-button-flat-default-caption[aria-setsize]') ||
    [...document.querySelectorAll('[aria-setsize]')].find((node) => {
      const value = Number.parseInt(node.getAttribute('aria-setsize') || '', 10);
      return Number.isFinite(value) && value > 0;
    }) ||
    null
  );
}

function getViewerTotalPages() {
  const value = Number.parseInt(getPageCaptionElement()?.getAttribute('aria-setsize') || '', 10);
  return Number.isFinite(value) && value > 0 ? value : null;
}

function getViewerCurrentPage() {
  const value = Number.parseInt(normalizeText(getPageCaptionElement()?.textContent), 10);
  return Number.isFinite(value) && value > 0 ? value : null;
}

function getSlideSvg() {
  const focusedSvgs = [...document.querySelectorAll('.punch-viewer-svgpage-svgcontainer svg')];
  if (focusedSvgs.length > 0) return focusedSvgs.at(-1);

  const svgs = [...document.querySelectorAll('svg')].filter((svg) => {
    const rect = svg.getBoundingClientRect();
    return rect.width > 200 && rect.height > 100;
  });
  return svgs.at(-1) || null;
}

function hashTextSampled(text, step = 1) {
  const normalized = normalizeText(text);
  if (!normalized) return '0';
  let hash = 0;
  const stride = Math.max(1, step);
  for (let index = 0; index < normalized.length; index += stride) {
    hash = (hash * 33 + normalized.charCodeAt(index)) >>> 0;
  }
  return hash.toString(16);
}

function getSlideA11yLabel() {
  return normalizeText(
    document.querySelector('.punch-viewer-svgpage-a11yelement')?.getAttribute('aria-label'),
  );
}

function getSvgTextSignature(svg) {
  const textContent = normalizeText(svg?.textContent);
  return [textContent.length, hashTextSampled(textContent, 1), hashTextSampled(textContent, 17)].join(':');
}

function getSvgImageSignature(svg) {
  const hrefs = [...(svg?.querySelectorAll('image') || [])]
    .map((image) =>
      normalizeText(image.getAttribute('href')) ||
      normalizeText(image.getAttributeNS('http://www.w3.org/1999/xlink', 'href')) ||
      normalizeText(image.getAttribute('xlink:href')),
    )
    .filter(Boolean)
    .join('|');
  return [hrefs.length, hashTextSampled(hrefs, 29)].join(':');
}

function getSnapshot() {
  const svg = getSlideSvg();
  if (!svg) return `${location.href}\n${document.body?.innerText?.slice(0, 10000) || ''}`;
  const markup = svg.innerHTML || '';
  const page = getViewerCurrentPage() || getSessionInfo().currentPage || 0;
  const a11yLabel = getSlideA11yLabel();
  return [
    page,
    svg.childElementCount,
    svg.getAttribute('viewBox') || '',
    markup.length,
    hashTextSampled(markup, 97),
    getSvgTextSignature(svg),
    getSvgImageSignature(svg),
    a11yLabel.length,
    hashTextSampled(a11yLabel, 17),
  ].join(':');
}

function clickControl(patterns) {
  const controls = [...document.querySelectorAll('button, [role="button"], a')];
  const target = controls.find((control) => {
    const label = [
      control.getAttribute('aria-label'),
      control.getAttribute('title'),
      control.textContent,
    ]
      .filter(Boolean)
      .join(' ');
    return patterns.some((pattern) => pattern.test(label));
  });
  if (!target) return false;
  target.click();
  return true;
}

function sendKey(key) {
  const eventOptions = {
    key,
    code: key,
    bubbles: true,
    cancelable: true,
  };
  document.dispatchEvent(new KeyboardEvent('keydown', eventOptions));
  document.body?.dispatchEvent(new KeyboardEvent('keydown', eventOptions));
  document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', eventOptions));
}

function dispatchArrowKey(direction) {
  const key = direction === 'left' ? 'ArrowLeft' : 'ArrowRight';
  const keyCode = direction === 'left' ? 37 : 39;
  const eventOptions = {
    key,
    code: key,
    keyCode,
    which: keyCode,
    bubbles: true,
    cancelable: true,
  };
  document.dispatchEvent(new KeyboardEvent('keydown', eventOptions));
  document.dispatchEvent(new KeyboardEvent('keyup', eventOptions));
}

async function waitForChange(previousSnapshot, timeoutMs = 7000) {
  const start = Date.now();
  let lastSnapshot = getSnapshot();
  while (Date.now() - start < timeoutMs) {
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const nextSnapshot = getSnapshot();
    if (nextSnapshot && nextSnapshot !== previousSnapshot && nextSnapshot !== lastSnapshot) {
      return nextSnapshot;
    }
    lastSnapshot = nextSnapshot;
  }
  return lastSnapshot;
}

async function goToFirstSlide() {
  let safety = 0;
  while ((getViewerCurrentPage() || getSessionInfo().currentPage) !== 1 && safety < 1000) {
    dispatchArrowKey('left');
    await new Promise((resolve) => setTimeout(resolve, 30));
    safety += 1;
  }
  await waitForStableSlide('', 1);
  return getSessionInfo();
}

async function goToSlide(page) {
  const targetPage = Number(page);
  const currentPage = getViewerCurrentPage() || getSessionInfo().currentPage;
  if (!Number.isFinite(targetPage) || targetPage < 1) {
    throw new Error('Invalid target slide page');
  }
  if (!currentPage) {
    throw new Error('Current slide page is unavailable');
  }

  const direction = targetPage > currentPage ? 'right' : 'left';
  let safety = 0;
  const stepCount = Math.min(50, Math.abs(targetPage - currentPage));
  for (let index = 0; index < stepCount; index += 1) {
    dispatchArrowKey(direction);
    await new Promise((resolve) => setTimeout(resolve, 25));
  }

  while ((getViewerCurrentPage() || getSessionInfo().currentPage) !== targetPage && safety < 1000) {
    dispatchArrowKey(direction);
    await new Promise((resolve) => setTimeout(resolve, 35));
    safety += 1;
  }

  return {
    snapshot: getSnapshot(),
    session: getSessionInfo(),
  };
}

async function goToNextSlide(previousSnapshot) {
  const currentPage = getViewerCurrentPage() || getSessionInfo().currentPage;
  if (currentPage) {
    return goToSlide(currentPage + 1);
  }

  const clicked = clickControl([/next/i, /次/, /次へ/, /進む/]);
  if (!clicked) sendKey('ArrowRight');
  const snapshot = await waitForChange(previousSnapshot, 7000);
  return {
    snapshot,
    session: getSessionInfo(),
  };
}

async function waitForStableSlide(previousSnapshot, expectedPage = null) {
  const startedAt = Date.now();
  const timeoutMs = 3500;
  let lastSnapshot = '';
  let repeated = 0;

  while (Date.now() - startedAt < timeoutMs) {
    await new Promise((resolve) => setTimeout(resolve, 90));
    const currentPage = getViewerCurrentPage() || getSessionInfo().currentPage;
    if (expectedPage && currentPage !== expectedPage) {
      lastSnapshot = '';
      repeated = 0;
      continue;
    }

    const svg = getSlideSvg();
    if (!svg || svg.childElementCount <= 0) {
      lastSnapshot = '';
      repeated = 0;
      continue;
    }

    const rect = svg.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) {
      lastSnapshot = '';
      repeated = 0;
      continue;
    }

    const snapshot = getSnapshot();
    if (snapshot === lastSnapshot) {
      repeated += 1;
    } else {
      lastSnapshot = snapshot;
      repeated = 1;
    }

    const changedOrPageConfirmed = !previousSnapshot || snapshot !== previousSnapshot || expectedPage;
    if (changedOrPageConfirmed && repeated >= 2) {
      return {
        snapshot,
        session: getSessionInfo(),
      };
    }
  }

  return {
    snapshot: lastSnapshot || getSnapshot(),
    session: getSessionInfo(),
  };
}

function getSvgDimensions(svg) {
  const viewBox = normalizeText(svg?.getAttribute('viewBox'));
  if (viewBox) {
    const parts = viewBox
      .split(/[\s,]+/)
      .map((value) => Number.parseFloat(value))
      .filter((value) => Number.isFinite(value));
    if (parts.length === 4 && parts[2] > 0 && parts[3] > 0) {
      return { viewBoxWidth: parts[2], viewBoxHeight: parts[3] };
    }
  }

  const rect = svg?.getBoundingClientRect?.();
  return { viewBoxWidth: rect?.width || 0, viewBoxHeight: rect?.height || 0 };
}

function decodeEscapedGoogleSvg(input) {
  return String(input || '')
    .replace(/\\\//g, '/')
    .replace(/\\x([0-9a-fA-F]{2})/g, (_, hex) => String.fromCharCode(Number.parseInt(hex, 16)))
    .replace(/\\u([0-9a-fA-F]{4})/g, (_, hex) => String.fromCharCode(Number.parseInt(hex, 16)));
}

function decodeHtmlEntities(input) {
  const textarea = document.createElement('textarea');
  textarea.innerHTML = String(input || '');
  return textarea.value;
}

function decodeLooseJsString(input) {
  return decodeHtmlEntities(
    decodeEscapedGoogleSvg(input)
      .replace(/\\"/g, '"')
      .replace(/\\'/g, "'")
      .replace(/\\n/g, '\n')
      .replace(/\\t/g, ' '),
  );
}

function isUsefulSlideText(value) {
  const text = normalizeText(value);
  if (text.length < 2 || text.length > 260) return false;
  if (/^[A-Z]:\\/.test(text)) return false;
  if (/\\(?:Users|Documents|SkyDrive|OneDrive|Desktop|Downloads)\\/i.test(text)) return false;
  if (/^https?:\/\//i.test(text)) return false;
  if (/\.(?:bmp|png|jpe?g|gif|webp|svg|ico)(?:\s|$)/i.test(text)) return false;
  if (/[{}[\]<>]{2,}/.test(text)) return false;
  if (/\.(?:js|css|png|jpe?g|gif|svg|woff2?)(?:\?|$)/i.test(text)) return false;
  if (/「.+」の画像検索結果/.test(text)) return false;
  if (/画像検索結果$/.test(text)) return false;
  if (/^(?:パソコンを使う|データベース|サラリーマン|OL・女性会社員).*(?:イラスト|画像)$/i.test(text)) {
    return false;
  }
  if (/^(true|false|null|undefined|function|style|class|width|height|viewBox)$/i.test(text)) return false;
  return /[\u3040-\u30ff\u3400-\u9fff]|[A-Za-z]{3,}\s+[A-Za-z]{3,}/.test(text);
}

function extractReadableTextFromHtmlSources(sources) {
  const chunks = [];
  const seen = new Set();
  const add = (value) => {
    const text = normalizeText(value);
    if (!isUsefulSlideText(text) || seen.has(text)) return;
    seen.add(text);
    chunks.push(text);
  };

  for (const source of sources) {
    const html = String(source || '');
    for (const match of html.matchAll(/"((?:\\.|[^"\\]){2,})"|'((?:\\.|[^'\\]){2,})'/g)) {
      add(decodeLooseJsString(match[1] || match[2] || ''));
      if (chunks.length >= 420) break;
    }
    if (chunks.length >= 420) break;
  }

  return chunks;
}

function extractFastSlideSvgs(html) {
  const matches = String(html || '').match(/\\x3csvg[\s\S]*?\\x3c\\\/svg\\x3e/g) || [];
  const svgs = matches
    .map((match) => decodeEscapedGoogleSvg(match))
    .filter((svgText) => /^<svg[\s\S]*<\/svg>$/i.test(svgText.trim()))
    .filter(isLikelySlideSvgText);
  return [...new Map(svgs.map((svgText) => [svgText, svgText])).values()];
}

function getSvgTextDimensions(svgText) {
  const viewBox = String(svgText || '').match(/\sviewBox=["']([^"']+)["']/i)?.[1] || '';
  const values = viewBox
    .split(/[\s,]+/)
    .map((value) => Number.parseFloat(value))
    .filter((value) => Number.isFinite(value));
  if (values.length === 4 && values[2] > 0 && values[3] > 0) {
    return { width: values[2], height: values[3] };
  }

  const width = Number.parseFloat(String(svgText || '').match(/\swidth=["']([0-9.]+)/i)?.[1] || '');
  const height = Number.parseFloat(String(svgText || '').match(/\sheight=["']([0-9.]+)/i)?.[1] || '');
  return Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0
    ? { width, height }
    : null;
}

function isLikelySlideSvgText(svgText) {
  const text = String(svgText || '').trim();
  if (text.length < 1000) return false;
  if (!/(<g\b|<image\b|<path\b|<text\b)/i.test(text)) return false;

  const dimensions = getSvgTextDimensions(text);
  if (!dimensions) return true;
  const ratio = dimensions.width / dimensions.height;
  return ratio > 1.15 && ratio < 2.35;
}

function getReliableFastSlideCount(foundCount) {
  const pageInfo = parsePageInfoFromText();
  const candidates = [getViewerTotalPages(), pageInfo?.totalPages, getThumbnailCount()]
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value) && value > 0 && value <= foundCount);
  return candidates.length ? Math.max(...candidates) : foundCount;
}

async function loadFastSvgSession() {
  if (fastSvgSessionCache?.url === location.href) return fastSvgSessionCache;

  const sources = [];
  const response = await fetch(location.href, { credentials: 'include' });
  if (response.ok) sources.push(await response.text());
  sources.push(document.documentElement?.innerHTML || '');

  const svgs = sources.flatMap(extractFastSlideSvgs);
  const uniqueSvgs = [...new Map(svgs.map((svgText) => [svgText, svgText])).values()];
  if (uniqueSvgs.length === 0) {
    throw new Error('Fast SVG slide data was not found');
  }
  const reliableCount = getReliableFastSlideCount(uniqueSvgs.length);
  const slideSvgs = uniqueSvgs.slice(0, reliableCount);

  fastSvgSessionCache = {
    url: location.href,
    title: getTitle(),
    totalPages: slideSvgs.length,
    svgs: slideSvgs,
    rawSvgCount: uniqueSvgs.length,
    sourceTextChunks: extractReadableTextFromHtmlSources(sources),
  };
  return fastSvgSessionCache;
}

function parseSvgText(svgText) {
  const documentFromSvg = new DOMParser().parseFromString(svgText, 'image/svg+xml');
  const parserError = documentFromSvg.querySelector('parsererror');
  if (parserError) throw new Error('Fast SVG parse failed');
  const svg = documentFromSvg.documentElement;
  if (!(svg instanceof SVGElement) || svg.tagName.toLowerCase() !== 'svg') {
    throw new Error('Fast SVG root was not found');
  }
  svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  svg.setAttribute('xmlns:xlink', 'http://www.w3.org/1999/xlink');
  return svg;
}

async function serializeFastSlideSvg(page) {
  const session = await loadFastSvgSession();
  const pageIndex = Number(page) - 1;
  const svgText = session.svgs[pageIndex];
  if (!svgText) throw new Error(`Fast SVG page ${page} was not found`);
  const svg = parseSvgText(svgText);
  await inlineSlideImages(svg);
  const dimensions = getSvgDimensions(svg);
  return {
    svgText: new XMLSerializer().serializeToString(svg),
    viewBoxWidth: dimensions.viewBoxWidth || 960,
    viewBoxHeight: dimensions.viewBoxHeight || 540,
  };
}

function extractTextFromSlideSvg(svgText, page) {
  const svg = parseSvgText(svgText);
  const textNodes = [...svg.querySelectorAll('text, tspan, title, desc')]
    .flatMap((node) => [
      normalizeText(node.textContent),
      normalizeText(node.getAttribute('aria-label')),
      normalizeText(node.getAttribute('title')),
    ])
    .filter(Boolean);
  const ariaTexts = [...svg.querySelectorAll('[aria-label], [title], [data-tooltip]')]
    .flatMap((node) => [
      normalizeText(node.getAttribute('aria-label')),
      normalizeText(node.getAttribute('title')),
      normalizeText(node.getAttribute('data-tooltip')),
    ])
    .filter(Boolean);
  const chunks = textNodes.length || ariaTexts.length ? [...textNodes, ...ariaTexts] : [normalizeText(svg.textContent)];
  const uniqueChunks = [];
  for (const chunk of chunks) {
    if (isUsefulSlideText(chunk) && uniqueChunks.at(-1) !== chunk) uniqueChunks.push(chunk);
  }
  return uniqueChunks.length ? [`--- Slide ${page} ---`, ...uniqueChunks].join('\n') : '';
}

async function extractFastSlidesText() {
  const session = await loadFastSvgSession();
  const pages = session.svgs
    .map((svgText, index) => extractTextFromSlideSvg(svgText, index + 1))
    .filter(Boolean);
  let text = pages.join('\n\n').trim();
  let method = 'svg_text';
  if (!text && session.sourceTextChunks?.length) {
    text = ['--- Slides embedded text candidates ---', ...session.sourceTextChunks].join('\n');
    method = 'html_candidates';
  }
  if (!text) throw new Error('Slides text candidates were not found');
  return {
    title: session.title,
    totalPages: session.totalPages,
    text,
    method,
  };
}

async function readBlobAsDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('FileReader failure'));
    reader.readAsDataURL(blob);
  });
}

async function fetchPdfExportDataUrl(rawUrl) {
  const url = new URL(rawUrl, location.href);
  if (url.origin !== location.origin || !/^\/presentation\//i.test(url.pathname)) {
    throw new Error('Invalid Slides PDF export URL');
  }

  const response = await fetch(url.href, { credentials: 'include' });
  if (!response.ok) {
    throw new Error(`Slides PDF export failed: HTTP ${response.status}`);
  }

  const blob = await response.blob();
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const contentType = String(response.headers.get('content-type') || blob.type || '').toLowerCase();
  const isPdf =
    contentType.includes('application/pdf') &&
    bytes.length >= 4 &&
    bytes[0] === 0x25 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x44 &&
    bytes[3] === 0x46;
  if (!isPdf) {
    throw new Error(`Slides PDF export returned non-PDF content: ${contentType || 'unknown'}`);
  }

  return readBlobAsDataUrl(new Blob([bytes], { type: 'application/pdf' }));
}

async function fetchImageViaBackground(url) {
  const response = await runtimeApi.runtime.sendMessage({
    type: 'ultimateMoocs:slides.imageDataUrl',
    payload: { url: url.toString() },
  });
  if (!response?.ok || !response.payload?.dataUrl) {
    throw new Error(response?.error || 'Background image fetch failed');
  }
  return response.payload.dataUrl;
}

async function fetchImageDataUrl(url) {
  try {
    const response = await fetch(url.toString(), { credentials: 'include' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const blob = await response.blob();
    if (!String(blob.type || '').startsWith('image/')) {
      throw new Error(`Not an image: ${blob.type || 'unknown'}`);
    }
    return await readBlobAsDataUrl(blob);
  } catch {
    return fetchImageViaBackground(url);
  }
}

async function mapWithConcurrency(items, limit, worker) {
  const queue = [...items];
  const workerCount = Math.max(1, Math.min(limit, queue.length));
  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (queue.length > 0) {
        const item = queue.shift();
        if (item) await worker(item);
      }
    }),
  );
}

async function inlineSlideImages(svg) {
  const imageNodes = [...svg.querySelectorAll('image')];
  await mapWithConcurrency(imageNodes, INLINE_IMAGE_CONCURRENCY, async (imageNode) => {
    const href =
      normalizeText(imageNode.getAttribute('href')) ||
      normalizeText(imageNode.getAttributeNS('http://www.w3.org/1999/xlink', 'href')) ||
      normalizeText(imageNode.getAttribute('xlink:href'));
    if (!href || href.startsWith('data:')) return;

    let url;
    try {
      url = new URL(href, window.location.href);
    } catch {
      return;
    }
    if (url.protocol !== 'https:') return;
    const allowed =
      url.hostname === 'docs.google.com' ||
      url.hostname.endsWith('.googleusercontent.com') ||
      url.hostname.endsWith('.gstatic.com');
    if (!allowed) return;

    try {
      const dataUrl = await fetchImageDataUrl(url);
      imageNode.setAttribute('href', dataUrl);
      imageNode.setAttributeNS('http://www.w3.org/1999/xlink', 'xlink:href', dataUrl);
    } catch (error) {
      console.warn('[ultimateMoocs:slides] image inline failed', url.toString(), error);
    }
  });
}

async function serializeCurrentSlideSvg(page) {
  const svg = getSlideSvg();
  if (!svg) throw new Error(`${page} page SVG was not found`);
  const currentPage = getViewerCurrentPage() || getSessionInfo().currentPage;
  if (currentPage && currentPage !== page) {
    throw new Error(`${page} page is not currently visible`);
  }

  const cloned = svg.cloneNode(true);
  if (!(cloned instanceof SVGElement)) {
    throw new Error(`${page} page SVG clone failed`);
  }
  cloned.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  cloned.setAttribute('xmlns:xlink', 'http://www.w3.org/1999/xlink');
  await inlineSlideImages(cloned);

  const dimensions = getSvgDimensions(svg);
  const rect = svg.getBoundingClientRect();
  return {
    svgText: new XMLSerializer().serializeToString(cloned),
    renderWidth: rect.width || dimensions.viewBoxWidth || 0,
    renderHeight: rect.height || dimensions.viewBoxHeight || 0,
    viewBoxWidth: dimensions.viewBoxWidth || 0,
    viewBoxHeight: dimensions.viewBoxHeight || 0,
  };
}

async function imageFromSvgText(svgText) {
  const blob = new Blob([svgText], { type: 'image/svg+xml;charset=utf-8' });
  const blobUrl = URL.createObjectURL(blob);
  try {
    return await new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error('Serialized slide image failed to load'));
      image.src = blobUrl;
    });
  } finally {
    URL.revokeObjectURL(blobUrl);
  }
}

async function canvasToImageDataUrl(canvas, type = 'image/jpeg', quality = 0.88) {
  const blob = await new Promise((resolve, reject) => {
    canvas.toBlob(
      (value) => {
        if (!value) {
          reject(new Error('Slide image export failed'));
          return;
        }
        resolve(value);
      },
      type,
      quality,
    );
  });
  return readBlobAsDataUrl(blob);
}

async function rasterizeCurrentSlideImage(page, options = {}) {
  const serialized = await serializeCurrentSlideSvg(page);
  const requestedWidth = Math.max(
    1,
    Math.round(Number(serialized.renderWidth) || Number(serialized.viewBoxWidth) || 0),
  );
  const requestedHeight = Math.max(
    1,
    Math.round(Number(serialized.renderHeight) || Number(serialized.viewBoxHeight) || 0),
  );
  const scale = Number.isFinite(options.scale) && options.scale > 0 ? options.scale : 1.5;
  const minWidth = Number.isFinite(options.minWidth) ? Math.max(1, options.minWidth) : 1024;
  const minHeight = Number.isFinite(options.minHeight) ? Math.max(1, options.minHeight) : 576;
  const targetWidth = Math.max(
    minWidth,
    requestedWidth ? Math.round(requestedWidth * scale) : 0,
    Number(serialized.viewBoxWidth) ? Math.round(Number(serialized.viewBoxWidth) * scale) : 0,
  );
  const targetHeight = Math.max(
    minHeight,
    requestedHeight ? Math.round(requestedHeight * scale) : 0,
    Number(serialized.viewBoxHeight) ? Math.round(Number(serialized.viewBoxHeight) * scale) : 0,
  );
  const quality =
    Number.isFinite(options.quality) && options.quality > 0
      ? Math.min(1, Math.max(0.1, options.quality / 100))
      : 0.88;
  const type = options.type === 'image/png' ? 'image/png' : 'image/jpeg';
  const image = await imageFromSvgText(serialized.svgText);
  const canvas = document.createElement('canvas');
  canvas.width = targetWidth;
  canvas.height = targetHeight;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Slide JPEG canvas context unavailable');

  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, targetWidth, targetHeight);
  context.drawImage(image, 0, 0, targetWidth, targetHeight);

  return {
    dataUrl: await canvasToImageDataUrl(canvas, type, quality),
    width: targetWidth,
    height: targetHeight,
  };
}

async function rasterizeFastSlideImage(page, options = {}) {
  const serialized = await serializeFastSlideSvg(page);
  const scale = Number.isFinite(options.scale) && options.scale > 0 ? options.scale : 1.5;
  const minWidth = Number.isFinite(options.minWidth) ? Math.max(1, options.minWidth) : 1024;
  const minHeight = Number.isFinite(options.minHeight) ? Math.max(1, options.minHeight) : 576;
  const targetWidth = Math.max(minWidth, Math.round(serialized.viewBoxWidth * scale));
  const targetHeight = Math.max(minHeight, Math.round(serialized.viewBoxHeight * scale));
  const quality =
    Number.isFinite(options.quality) && options.quality > 0
      ? Math.min(1, Math.max(0.1, options.quality / 100))
      : 0.88;
  const type = options.type === 'image/png' ? 'image/png' : 'image/jpeg';
  const image = await imageFromSvgText(serialized.svgText);
  const canvas = document.createElement('canvas');
  canvas.width = targetWidth;
  canvas.height = targetHeight;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Fast slide canvas context unavailable');

  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, targetWidth, targetHeight);
  context.drawImage(image, 0, 0, targetWidth, targetHeight);

  return {
    dataUrl: await canvasToImageDataUrl(canvas, type, quality),
    width: targetWidth,
    height: targetHeight,
  };
}

function rasterizeCurrentSlideJpeg(page, options = {}) {
  return rasterizeCurrentSlideImage(page, {
    ...options,
    type: 'image/jpeg',
  });
}

function rasterizeCurrentSlidePng(page, options = {}) {
  return rasterizeCurrentSlideImage(page, {
    ...options,
    type: 'image/png',
  });
}

runtimeApi?.runtime?.onMessage?.addListener((message, sender, sendResponse) => {
  if (!message?.type?.startsWith(MESSAGE_PREFIX)) return false;

  Promise.resolve()
    .then(async () => {
      switch (message.type) {
        case 'ultimateMoocs:slides.session':
          return getSessionInfo();
        case 'ultimateMoocs:slides.fastSession': {
          const session = await loadFastSvgSession();
          return {
            title: session.title,
            currentPage: 1,
            totalPages: session.totalPages,
            rawSvgCount: session.rawSvgCount,
            url: session.url,
          };
        }
        case 'ultimateMoocs:slides.extractText':
          return extractFastSlidesText();
        case 'ultimateMoocs:slides.snapshot':
          return { snapshot: getSnapshot(), session: getSessionInfo() };
        case 'ultimateMoocs:slides.first':
          return goToFirstSlide();
        case 'ultimateMoocs:slides.next':
          return goToNextSlide(message.payload?.previousSnapshot || '');
        case 'ultimateMoocs:slides.goto':
          return goToSlide(Number(message.payload?.page));
        case 'ultimateMoocs:slides.stable':
          return waitForStableSlide(
            message.payload?.previousSnapshot || '',
            Number(message.payload?.page) || null,
          );
        case 'ultimateMoocs:slides.rasterizeJpeg':
          return rasterizeCurrentSlideJpeg(Number(message.payload?.page), {
            quality: Number(message.payload?.quality),
            scale: Number(message.payload?.scale),
            minWidth: Number(message.payload?.minWidth),
            minHeight: Number(message.payload?.minHeight),
          });
        case 'ultimateMoocs:slides.rasterizePng':
          return rasterizeCurrentSlidePng(Number(message.payload?.page), {
            scale: Number(message.payload?.scale),
            minWidth: Number(message.payload?.minWidth),
            minHeight: Number(message.payload?.minHeight),
          });
        case 'ultimateMoocs:slides.fastRasterizeJpeg':
          return rasterizeFastSlideImage(Number(message.payload?.page), {
            quality: Number(message.payload?.quality),
            scale: Number(message.payload?.scale),
            minWidth: Number(message.payload?.minWidth),
            minHeight: Number(message.payload?.minHeight),
            type: 'image/jpeg',
          });
        case 'ultimateMoocs:slides.fastRasterizePng':
          return rasterizeFastSlideImage(Number(message.payload?.page), {
            scale: Number(message.payload?.scale),
            minWidth: Number(message.payload?.minWidth),
            minHeight: Number(message.payload?.minHeight),
            type: 'image/png',
          });
        case 'ultimateMoocs:slides.fetchPdfExport':
          return {
            dataUrl: await fetchPdfExportDataUrl(message.payload?.url || ''),
          };
        default:
          throw new Error(`Unsupported slides message: ${message.type}`);
      }
    })
    .then((payload) => sendResponse({ ok: true, payload }))
    .catch((error) =>
      sendResponse({
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      }),
    );

  return true;
});
