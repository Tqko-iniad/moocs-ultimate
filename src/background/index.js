import { browserApi, downloadsDownload } from '../shared/browserApi.js';
import { MESSAGE_TYPES, isUltimateMoocsMessage } from '../shared/messages.js';
import {
  createDefaultDownloadState,
  getAiQuota as getSavedAiQuota,
  getAiSummaries,
  getAiUsage,
  getDownloadState,
  getSettings,
  resetSettings,
  saveAiSummaries,
  saveAiUsage,
  saveDownloadState,
  saveSettings,
} from '../shared/storage.js';

let activeDownloadRun = null;
let lastScreenshotCaptureAt = 0;

const WINDOWS_RESERVED_NAMES = new Set([
  'CON',
  'PRN',
  'AUX',
  'NUL',
  'COM1',
  'COM2',
  'COM3',
  'COM4',
  'COM5',
  'COM6',
  'COM7',
  'COM8',
  'COM9',
  'LPT1',
  'LPT2',
  'LPT3',
  'LPT4',
  'LPT5',
  'LPT6',
  'LPT7',
  'LPT8',
  'LPT9',
]);

const PDF_PAGE_WIDTH = 960;
const PDF_PAGE_HEIGHT = 540;
const AI_CACHE_VERSION = 2;

function estimateTokens(text) {
  const normalized = String(text || '').trim();
  if (!normalized) return 0;
  return Math.ceil(normalized.length / 2.5);
}

function hashText(text) {
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function normalizeAiBaseUrl(value) {
  const fallback = 'https://api.openai.iniad.org/api/v1';
  try {
    const url = new URL(String(value || fallback));
    if (url.protocol !== 'https:' || url.hostname !== 'api.openai.iniad.org') {
      throw new Error('unsupported AI API host');
    }
    url.pathname = url.pathname.replace(/\/+$/g, '');
    return url.toString().replace(/\/+$/g, '');
  } catch {
    throw new Error('AI API URLは https://api.openai.iniad.org/ 配下のみ使用できます。');
  }
}

function buildAiSystemPrompt(mode) {
  const detail =
    mode === 'brief'
      ? '短時間で復習できるよう、結論、重要語句、3行まとめを中心に短くまとめてください。'
      : mode === 'detailed'
        ? '授業ノートとして読み返せるよう、流れ、重要語句、つまずきポイント、理解チェック、復習ポイントを丁寧にまとめてください。'
        : '後で読み返しやすい復習ノートとして、要点、流れ、重要語句、つまずきポイントを整理してください。';
  return [
    'あなたはINIAD MOOCsの学習補助AIです。',
    '入力はユーザーが自分の学習のために抽出した講義資料テキストです。',
    detail,
    '人間が読みやすいノートにしてください。単なる箇条書きの羅列にせず、重要度と関係性が分かるように整理してください。',
    '画像ファイル名、ローカルパス、検索結果、装飾的な文言は要約に含めないでください。',
    '出力は日本語Markdownで、次の順番と見出しを守ってください。',
    '## まず何の話？',
    '講義全体を1〜2文で説明してください。',
    '## 話の流れ',
    '授業の流れが追えるように3〜6個の番号付きリストでまとめてください。',
    '## 重要ポイント',
    '重要な概念を3〜6個、太字のキーワード + やさしい説明でまとめてください。',
    '## 用語メモ',
    '初学者が混乱しやすい用語を短く説明してください。不要なら省略してください。',
    '## つまずきやすいところ',
    '誤解しやすい点や注意点を2〜4個書いてください。資料から判断できない場合は無理に作らないでください。',
    '## 3行まとめ',
    '最後に3行だけで復習できるまとめを書いてください。',
  ].join('\n');
}

function getMinimumAiOutputTokens(mode) {
  if (mode === 'brief') return 1600;
  if (mode === 'detailed') return 3600;
  return 2600;
}

function getEffectiveAiOutputTokens(aiSettings, mode) {
  const configured = Number(aiSettings.maxOutputTokens || 0);
  return Math.min(8192, Math.max(getMinimumAiOutputTokens(mode), configured || 0));
}

function buildAiCacheKey({ sourceUrl, title, text, model, summaryMode }) {
  return [
    `v${AI_CACHE_VERSION}`,
    model || '',
    summaryMode || '',
    hashText(sourceUrl || ''),
    hashText(title || ''),
    hashText(text || ''),
  ].join(':');
}

function normalizeAiSourceUrl(value) {
  try {
    const url = new URL(String(value || ''));
    url.hash = '';
    if (url.hostname === 'moocs.iniad.org' && url.pathname.startsWith('/courses/')) {
      url.search = '';
    } else {
      url.searchParams.delete('_');
    }
    return url.href.replace(/\/+$/, '');
  } catch {
    return String(value || '')
      .replace(/[?#].*$/, '')
      .replace(/\/+$/, '');
  }
}

function parseAiMoocsRoute(value) {
  try {
    const url = new URL(String(value || ''));
    if (url.hostname !== 'moocs.iniad.org') return null;
    const parts = url.pathname.split('/').filter(Boolean);
    if (parts[0] !== 'courses' || !parts[1] || !parts[2] || !parts[3]) return null;
    return {
      year: parts[1] || '',
      course: parts[2] || '',
      lecture: parts[3] || '',
      page: parts[4] || '',
    };
  } catch {
    return null;
  }
}

function isSameAiSource(itemSourceUrl, requestedSourceUrl) {
  if (!requestedSourceUrl) return true;
  const itemUrl = normalizeAiSourceUrl(itemSourceUrl);
  const requestedUrl = normalizeAiSourceUrl(requestedSourceUrl);
  if (itemUrl && requestedUrl && itemUrl === requestedUrl) return true;

  const itemRoute = parseAiMoocsRoute(itemSourceUrl);
  const requestedRoute = parseAiMoocsRoute(requestedSourceUrl);
  if (!itemRoute || !requestedRoute) return false;
  if (
    itemRoute.year !== requestedRoute.year ||
    itemRoute.course !== requestedRoute.course ||
    itemRoute.lecture !== requestedRoute.lecture
  ) {
    return false;
  }
  if (requestedRoute.page) return itemRoute.page === requestedRoute.page;
  if (itemRoute.page) return false;
  return true;
}

function extractAiTextPayload(payload, maxInputChars) {
  const text = String(payload?.text || '').replace(/\r\n?/g, '\n').trim();
  if (!text) throw new Error('要約するテキストがありません。');
  return text.slice(0, maxInputChars);
}

async function requestAiChatCompletion(aiSettings, messages, options = {}) {
  const apiKey = String(aiSettings.apiKey || '').trim();
  if (!apiKey) {
    throw new Error('INIAD AI MOP APIキーが未設定です。設定ページでAPIキーを入力してください。');
  }

  const endpoint = `${normalizeAiBaseUrl(aiSettings.apiBaseUrl)}/chat/completions`;
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: aiSettings.model || 'gpt-5.4-mini',
      messages,
      stream: false,
      max_completion_tokens: Number(options.maxOutputTokens || aiSettings.maxOutputTokens || 2400),
    }),
  });

  const rawText = await response.text();
  let data = null;
  try {
    data = rawText ? JSON.parse(rawText) : null;
  } catch {
    data = null;
  }

  if (!response.ok) {
    const reason = data?.error?.message || rawText || `HTTP ${response.status}`;
    throw new Error(`INIAD AI MOP request failed: ${reason}`);
  }

  const summary = data?.choices?.[0]?.message?.content;
  if (typeof summary !== 'string' || !summary.trim()) {
    throw new Error('INIAD AI MOPの応答から要約文を取得できませんでした。');
  }
  const finishReason = data?.choices?.[0]?.finish_reason || '';
  if (finishReason === 'length') {
    throw new Error('AI要約が長さ制限で途中終了しました。出力token上限を上げてもう一度実行してください。');
  }

  return {
    summary: summary.trim(),
    usage: data?.usage || null,
    finishReason,
  };
}

async function summarizeWithAi(payload = {}) {
  const settings = await getSettings();
  const aiSettings = settings.ai || {};
  if (!aiSettings.enableAiSummary) {
    throw new Error('AI要約は設定でOFFになっています。');
  }
  const warnings = [];
  if (aiSettings.sendImages) {
    warnings.push('画像送信は未実装のため、テキストのみで要約しました。');
  }

  const maxInputChars = Math.max(1000, Number(aiSettings.maxInputChars || 24000));
  const text = extractAiTextPayload(payload, maxInputChars);
  const title = String(payload.title || 'MOOCs slide').trim();
  const sourceUrl = String(payload.sourceUrl || '').trim();
  const model = aiSettings.model || 'gpt-5.4-mini';
  const summaryMode = aiSettings.summaryMode || 'standard';
  const estimatedInputTokens = estimateTokens(text);
  const effectiveOutputTokens = getEffectiveAiOutputTokens(aiSettings, summaryMode);
  const estimatedOutputTokens = Math.max(128, effectiveOutputTokens);
  const usage = await getAiUsage();
  const projectedTokens = usage.estimatedInputTokens + usage.estimatedOutputTokens + estimatedInputTokens + estimatedOutputTokens;
  const budget = Math.max(1000, Number(aiSettings.dailyTokenBudget || 480000));
  if (projectedTokens > budget) {
    throw new Error(`今日のAI token予算を超えそうです。推定 ${projectedTokens} / 上限 ${budget}`);
  }

  const cacheKey = buildAiCacheKey({ sourceUrl, title, text, model, summaryMode });
  const summaries = await getAiSummaries();
  if (!payload.forceRefresh && summaries[cacheKey]?.summary) {
    return {
      summary: summaries[cacheKey].summary,
      cached: true,
      cacheKey,
      estimatedInputTokens,
      estimatedOutputTokens: 0,
      usage,
      warnings,
    };
  }

  const messages = [
    { role: 'system', content: buildAiSystemPrompt(summaryMode) },
    {
      role: 'user',
      content: [`タイトル: ${title}`, sourceUrl ? `URL: ${sourceUrl}` : '', '', text].filter(Boolean).join('\n'),
    },
  ];
  const result = await requestAiChatCompletion(aiSettings, messages, { maxOutputTokens: effectiveOutputTokens });
  const outputTokens = Number(result.usage?.completion_tokens || estimateTokens(result.summary));
  const nextUsage = await saveAiUsage({
    ...usage,
    estimatedInputTokens: usage.estimatedInputTokens + Number(result.usage?.prompt_tokens || estimatedInputTokens),
    estimatedOutputTokens: usage.estimatedOutputTokens + outputTokens,
    requestCount: usage.requestCount + 1,
  });

  summaries[cacheKey] = {
    version: AI_CACHE_VERSION,
    sourceUrl,
    title,
    model,
    summaryMode,
    summary: result.summary,
    estimatedInputTokens,
    estimatedOutputTokens: outputTokens,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  await saveAiSummaries(summaries);

  return {
    summary: result.summary,
    cached: false,
    cacheKey,
    estimatedInputTokens,
    estimatedOutputTokens: outputTokens,
    usage: nextUsage,
    warnings,
  };
}

async function listAiSummaries(payload = {}) {
  const summaries = await getAiSummaries();
  const sourceUrl = String(payload.sourceUrl || '').trim();
  const normalizedSourceUrl = normalizeAiSourceUrl(sourceUrl);
  const items = Object.entries(summaries)
    .filter(([, item]) => item && typeof item === 'object' && typeof item.summary === 'string')
    .filter(([, item]) => !sourceUrl || isSameAiSource(item.sourceUrl, normalizedSourceUrl))
    .map(([cacheKey, item]) => ({
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
    }))
    .sort((a, b) => String(b.updatedAt || b.createdAt).localeCompare(String(a.updatedAt || a.createdAt)));
  return {
    summaries: items,
    usage: await getAiUsage(),
    quota: await getSavedAiQuota(),
  };
}

async function deleteAiSummary(payload = {}) {
  const cacheKey = String(payload.cacheKey || '').trim();
  if (!cacheKey) throw new Error('削除するAI要約が指定されていません。');
  const summaries = await getAiSummaries();
  delete summaries[cacheKey];
  await saveAiSummaries(summaries);
  return listAiSummaries(payload);
}

function normalizeExtractedText(text) {
  return String(text || '')
    .replace(/\r\n?/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

async function fetchSlidesExportText(url, exportUrl) {
  const response = await fetch(exportUrl, { credentials: 'include' });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const contentType = response.headers.get('content-type') || '';
  const text = normalizeExtractedText(await response.text());
  if (/text\/html/i.test(contentType) && /<html|<!doctype/i.test(text.slice(0, 300))) {
    throw new Error('Slides text export returned HTML. Login or sharing settings may block text export.');
  }
  if (!text) throw new Error('Slides text export is empty.');
  return {
    url,
    ok: true,
    text,
    method: 'export_txt',
    error: '',
  };
}

async function extractSlidesTextViaHelper(url) {
  let tab = null;
  const [initialActiveTab] = await tabsQuery({ active: true, currentWindow: true }).catch(() => []);
  try {
    tab = await tabsCreate({ url, active: false });
    await waitForTabComplete(tab.id);
    await keepSlidesTabInBackground(tab.id, initialActiveTab?.id);
    const payload = await sendSlidesMessage(tab.id, 'ultimateMoocs:slides.extractText', {}, 8);
    if (!payload?.text) throw new Error('Slides helper returned empty text.');
    return {
      url,
      ok: true,
      text: normalizeExtractedText(payload.text),
      method: payload.method === 'html_candidates' ? 'html_candidates' : 'svg_helper',
      title: payload.title || '',
      totalPages: payload.totalPages || 0,
      error: '',
    };
  } finally {
    if (tab?.id) await tabsRemove(tab.id).catch(() => {});
  }
}

async function extractSlidesText(payload = {}) {
  const urls = Array.isArray(payload.urls) ? payload.urls : [];
  const results = [];

  for (const rawUrl of urls.slice(0, 12)) {
    const url = String(rawUrl || '').trim();
    if (!url) continue;

    const exportUrl = getGoogleSlidesTextExportUrl(url);
    if (!exportUrl) {
      results.push({ url, ok: false, text: '', error: 'Google Slides URLとして扱えませんでした。' });
      continue;
    }

    try {
      results.push(await fetchSlidesExportText(url, exportUrl));
    } catch (exportError) {
      try {
        results.push(await extractSlidesTextViaHelper(url));
      } catch (helperError) {
        results.push({
          url,
          ok: false,
          text: '',
          error:
            helperError instanceof Error
              ? helperError.message
              : exportError instanceof Error
                ? exportError.message
                : String(helperError || exportError),
        });
      }
    }
  }

  return { results };
}

function sanitizePathPart(value, fallback = 'untitled') {
  let text = String(value || fallback)
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/[\u0000-\u001f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/g, '');
  if (!text) text = fallback;
  if (WINDOWS_RESERVED_NAMES.has(text.toUpperCase())) text = `${text}_file`;
  return text.slice(0, 120);
}

function sanitizeFilename(value, fallback = 'download') {
  const parts = String(value || fallback)
    .split('/')
    .map((part) => sanitizePathPart(part, fallback))
    .filter(Boolean);
  return parts.join('/');
}

function stripExtension(filename) {
  return String(filename || '').replace(/\.[a-z0-9]+$/i, '');
}

function getGoogleSlidesPdfExportUrl(rawUrl) {
  try {
    const url = new URL(rawUrl);
    if (url.hostname !== 'docs.google.com') return '';

    const privateMatch = url.pathname.match(/^\/presentation\/d\/([^/]+)/i);
    if (privateMatch) {
      return `https://docs.google.com/presentation/d/${encodeURIComponent(privateMatch[1])}/export/pdf`;
    }

    const publishedMatch = url.pathname.match(/^\/presentation\/d\/e\/([^/]+)/i);
    if (publishedMatch) {
      return `https://docs.google.com/presentation/d/e/${encodeURIComponent(publishedMatch[1])}/pub?output=pdf`;
    }
  } catch {
    return '';
  }
  return '';
}

function getGoogleSlidesTextExportUrl(rawUrl) {
  try {
    const url = new URL(rawUrl);
    if (url.hostname !== 'docs.google.com') return '';

    const privateMatch = url.pathname.match(/^\/presentation\/d\/([^/]+)/i);
    if (privateMatch) {
      return `https://docs.google.com/presentation/d/${encodeURIComponent(privateMatch[1])}/export/txt`;
    }

    const publishedMatch = url.pathname.match(/^\/presentation\/d\/e\/([^/]+)/i);
    if (publishedMatch) {
      return `https://docs.google.com/presentation/d/e/${encodeURIComponent(publishedMatch[1])}/pub?output=txt`;
    }
  } catch {
    return '';
  }
  return '';
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function bytesToBase64(bytes) {
  let binary = '';
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }
  return btoa(binary);
}

async function blobToDataUrl(blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  return `data:${blob.type || 'application/octet-stream'};base64,${bytesToBase64(bytes)}`;
}

async function dataUrlToBytes(dataUrl) {
  const response = await fetch(dataUrl);
  return new Uint8Array(await response.arrayBuffer());
}

function isPdfBytes(bytes) {
  return (
    bytes?.length >= 4 &&
    bytes[0] === 0x25 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x44 &&
    bytes[3] === 0x46
  );
}

function createPdfBuilder() {
  const encoder = new TextEncoder();
  const catalogId = 1;
  const pagesId = 2;
  const chunks = [encoder.encode('%PDF-1.4\n%\xFF\xFF\xFF\xFF\n')];
  const offsets = [0];
  const pageRefs = [];
  let currentOffset = chunks[0].length;
  let nextObjectId = 3;
  let pageCount = 0;

  function appendChunk(chunk) {
    chunks.push(chunk);
    currentOffset += chunk.length;
  }

  function appendObject(id, contentChunks) {
    offsets[id] = currentOffset;
    contentChunks.forEach(appendChunk);
  }

  function addJpegPage(page) {
    pageCount += 1;
    const imageId = nextObjectId++;
    const contentId = nextObjectId++;
    const pageId = nextObjectId++;
    const imageName = `Im${pageCount}`;
    const scale = Math.min(PDF_PAGE_WIDTH / page.width, PDF_PAGE_HEIGHT / page.height);
    const drawWidth = page.width * scale;
    const drawHeight = page.height * scale;
    const offsetX = (PDF_PAGE_WIDTH - drawWidth) / 2;
    const offsetY = (PDF_PAGE_HEIGHT - drawHeight) / 2;
    const contentStream = [
      'q',
      `${drawWidth.toFixed(2)} 0 0 ${drawHeight.toFixed(2)} ${offsetX.toFixed(2)} ${offsetY.toFixed(2)} cm`,
      `/${imageName} Do`,
      'Q',
      '',
    ].join('\n');

    appendObject(imageId, [
      encoder.encode(`${imageId} 0 obj\n`),
      encoder.encode(
        `<< /Type /XObject /Subtype /Image /Width ${page.width} /Height ${page.height} ` +
          `/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${page.jpegBytes.length} >>\nstream\n`,
      ),
      page.jpegBytes,
      encoder.encode('\nendstream\nendobj\n'),
    ]);

    const contentBytes = encoder.encode(contentStream);
    appendObject(contentId, [
      encoder.encode(`${contentId} 0 obj\n<< /Length ${contentBytes.length} >>\nstream\n`),
      contentBytes,
      encoder.encode('\nendstream\nendobj\n'),
    ]);

    appendObject(pageId, [
      encoder.encode(
        `${pageId} 0 obj\n` +
          `<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${PDF_PAGE_WIDTH} ${PDF_PAGE_HEIGHT}] ` +
          `/Resources << /XObject << /${imageName} ${imageId} 0 R >> >> ` +
          `/Contents ${contentId} 0 R >>\nendobj\n`,
      ),
    ]);
    pageRefs.push(`${pageId} 0 R`);
  }

  function finalize() {
    appendObject(pagesId, [
      encoder.encode(
        `${pagesId} 0 obj\n<< /Type /Pages /Count ${pageCount} /Kids [${pageRefs.join(' ')}] >>\nendobj\n`,
      ),
    ]);
    appendObject(catalogId, [
      encoder.encode(`${catalogId} 0 obj\n<< /Type /Catalog /Pages ${pagesId} 0 R >>\nendobj\n`),
    ]);

    const xrefOffset = currentOffset;
    const totalObjects = nextObjectId - 1;
    const xrefLines = ['xref', `0 ${totalObjects + 1}`, '0000000000 65535 f '];
    for (let objectId = 1; objectId <= totalObjects; objectId += 1) {
      xrefLines.push(`${String(offsets[objectId] || 0).padStart(10, '0')} 00000 n `);
    }

    appendChunk(
      encoder.encode(
        [
          ...xrefLines,
          'trailer',
          `<< /Size ${totalObjects + 1} /Root ${catalogId} 0 R >>`,
          'startxref',
          String(xrefOffset),
          '%%EOF',
          '',
        ].join('\n'),
      ),
    );

    return new Blob(chunks, { type: 'application/pdf' });
  }

  return { addJpegPage, finalize };
}

function callbackApi(invoker) {
  return new Promise((resolve, reject) => {
    try {
      invoker((result) => {
        const lastError = chrome.runtime.lastError;
        if (lastError) {
          reject(new Error(lastError.message));
          return;
        }
        resolve(result);
      });
    } catch (error) {
      reject(error);
    }
  });
}

function tabsCreate(options) {
  return callbackApi((done) => chrome.tabs.create(options, done));
}

function tabsGet(tabId) {
  return callbackApi((done) => chrome.tabs.get(tabId, done));
}

function tabsRemove(tabId) {
  return callbackApi((done) => chrome.tabs.remove(tabId, done));
}

function tabsQuery(queryInfo) {
  return callbackApi((done) => chrome.tabs.query(queryInfo, done));
}

function tabsSendMessage(tabId, message) {
  return callbackApi((done) => chrome.tabs.sendMessage(tabId, message, done));
}

function tabsUpdate(tabId, updateProperties) {
  return callbackApi((done) => chrome.tabs.update(tabId, updateProperties, done));
}

function tabsCaptureVisibleTab(windowId, options) {
  return callbackApi((done) => chrome.tabs.captureVisibleTab(windowId, options, done));
}

function scriptingInsertCSS(tabId, files) {
  return callbackApi((done) => chrome.scripting.insertCSS({ target: { tabId }, files }, done));
}

function scriptingExecuteFiles(tabId, files) {
  return callbackApi((done) => chrome.scripting.executeScript({ target: { tabId }, files }, done));
}

async function reconnectOpenMoocsTabs() {
  if (!chrome.scripting?.executeScript || !chrome.scripting?.insertCSS) return;
  const tabs = await tabsQuery({ url: 'https://moocs.iniad.org/*' });
  await Promise.all(
    tabs
      .filter((tab) => Number.isInteger(tab.id))
      .map(async (tab) => {
        try {
          if (tab.status === 'loading') return;
          try {
            await tabsSendMessage(tab.id, { type: 'ultimateMoocs:content.probe' });
            return;
          } catch {
            // No live content script is attached after an extension reload.
          }
          await scriptingInsertCSS(tab.id, ['styles/content.css']);
          await scriptingExecuteFiles(tab.id, ['content/index.js']);
        } catch (error) {
          console.warn('[ultimateMoocs:background] failed to reconnect MOOCs tab', tab.id, error);
        }
      }),
  );
}

function runtimeOpenOptionsPage() {
  return callbackApi((done) => chrome.runtime.openOptionsPage(done));
}

function timestampForFilename(date = new Date()) {
  const pad = (value) => String(value).padStart(2, '0');
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
    `${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`,
  ].join('-');
}

async function captureVisibleScreenshot(sender = {}, payload = {}) {
  const now = Date.now();
  if (now - lastScreenshotCaptureAt < 1200) {
    return { skipped: true, filename: '' };
  }
  lastScreenshotCaptureAt = now;

  const tab = sender.tab || payload.tab;
  if (!tab?.windowId) {
    throw new Error('スクリーンショット対象のタブを取得できませんでした。');
  }

  const pageTitle = sanitizePathPart(payload.title || tab.title || 'moocs-page', 'moocs-page');
  const filename = sanitizeFilename(
    `moocs-ultimate/screenshots/${timestampForFilename()}_${pageTitle}.png`,
    'moocs-screenshot.png',
  );
  const dataUrl = await tabsCaptureVisibleTab(tab.windowId, { format: 'png' });
  if (payload.action === 'clipboard') {
    return {
      filename,
      copied: false,
      dataUrl,
      error: '',
    };
  }

  await downloadsDownload({
    url: dataUrl,
    filename,
    saveAs: false,
    conflictAction: 'uniquify',
  });
  return { filename };
}

async function captureScreenshotFromActiveTab() {
  const settings = await getSettings();
  if (!settings.downloads?.enableScreenshotShortcut) return;

  const [tab] = await tabsQuery({ active: true, currentWindow: true });
  if (!tab?.id || !/^https:\/\/moocs\.iniad\.org\//i.test(tab.url || '')) return;
  const action = settings.downloads.screenshotShortcutAction === 'clipboard' ? 'clipboard' : 'download';
  const result = await captureVisibleScreenshot({ tab }, { action, title: tab.title, href: tab.url });

  if (action === 'clipboard') {
    if (result.skipped) return;
    await tabsSendMessage(tab.id, {
      type: MESSAGE_TYPES.screenshotShowCopyDialog,
      payload: {
        dataUrl: result.dataUrl,
        error: result.error,
      },
    }).catch(() => {});
  }
}

async function waitForTabComplete(tabId, timeoutMs = 30000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const tab = await tabsGet(tabId);
    if (tab.status === 'complete') return tab;
    await delay(250);
  }
  throw new Error('Slides tab load timed out');
}

async function keepSlidesTabInBackground(tabId, restoreTabId = null) {
  const tab = await tabsGet(tabId);
  if (tab.active && restoreTabId && restoreTabId !== tabId) {
    await tabsUpdate(restoreTabId, { active: true }).catch(() => {});
    await delay(300);
    return tabsGet(tabId);
  }
  return tab;
}

async function assertSlidesTabInBackground(tabId, restoreTabId = null) {
  const tab = await keepSlidesTabInBackground(tabId, restoreTabId);
  if (tab.active) {
    throw new Error('Slides tab was activated during export. Export was stopped to avoid interfering with user actions.');
  }
}

async function sendSlidesMessage(tabId, type, payload = {}, retries = 20) {
  let lastError = null;
  for (let attempt = 0; attempt < retries; attempt += 1) {
    try {
      const response = await tabsSendMessage(tabId, { type, payload });
      if (!response?.ok) throw new Error(response?.error || 'Slides helper failed');
      return response.payload;
    } catch (error) {
      lastError = error;
      await delay(250);
    }
  }
  throw lastError || new Error('Slides helper unavailable');
}

async function downloadDataUrl(dataUrl, filename) {
  await downloadsDownload({
    url: dataUrl,
    filename: sanitizeFilename(filename),
    saveAs: false,
    conflictAction: 'uniquify',
  });
}

async function downloadPdfBlob(blob, filename) {
  await downloadDataUrl(await blobToDataUrl(blob), filename);
}

async function tryExportSlidesPdfDirect(entry, outputBase, run) {
  const exportUrl = getGoogleSlidesPdfExportUrl(entry.sourceUrl || entry.url || entry.downloadUrl);
  if (!exportUrl) return false;

  await updateDownloadState({ currentFile: `${outputBase}.pdf`, downloadModeLabel: '高速ダウンロード' }, run);
  try {
    const response = await fetch(exportUrl, { credentials: 'include' });
    if (!response.ok) return false;

    const blob = await response.blob();
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const contentType = String(response.headers.get('content-type') || blob.type || '').toLowerCase();
    const looksLikePdf = contentType.includes('application/pdf') || isPdfBytes(bytes);
    if (!looksLikePdf) {
      console.warn('[ultimateMoocs:slides] fast PDF export returned non-PDF content', {
        contentType,
        bytes: bytes.length,
        url: exportUrl,
      });
      return false;
    }

    await downloadPdfBlob(new Blob([bytes], { type: 'application/pdf' }), `${outputBase}.pdf`);
    return true;
  } catch (error) {
    console.warn('[ultimateMoocs:slides] fast PDF export failed, falling back to SVG export', error);
    return false;
  }
}

async function exportSlidesPdf(tabId, outputBase, totalPages, previousSnapshot, run, restoreTabId) {
  const pdfBuilder = createPdfBuilder();
  let snapshot = previousSnapshot || '';

  for (let page = 1; page <= totalPages; page += 1) {
    if (run.canceled) throw new Error('Canceled');
    await assertSlidesTabInBackground(tabId, restoreTabId);
    await updateDownloadState({
      currentFile: `${outputBase}.pdf (${page}/${totalPages})`,
      downloadModeLabel: '回避ダウンロード',
    }, run);

    const stable = await sendSlidesMessage(tabId, 'ultimateMoocs:slides.stable', {
      page,
      previousSnapshot: snapshot,
    });
    snapshot = stable.snapshot || snapshot;

    const rasterized = await sendSlidesMessage(tabId, 'ultimateMoocs:slides.rasterizeJpeg', {
      page,
      quality: 88,
      scale: 1.5,
      minWidth: 1024,
      minHeight: 576,
    });
    if (!rasterized?.dataUrl || !rasterized.width || !rasterized.height) {
      throw new Error(`Slides page ${page} JPEG export failed`);
    }

    pdfBuilder.addJpegPage({
      width: Number(rasterized.width),
      height: Number(rasterized.height),
      jpegBytes: await dataUrlToBytes(rasterized.dataUrl),
    });

    if (page < totalPages) {
      await sendSlidesMessage(tabId, 'ultimateMoocs:slides.goto', {
        page: page + 1,
      });
    }
  }

  await updateDownloadState({ currentFile: `${outputBase}.pdf` }, run);
  await downloadPdfBlob(pdfBuilder.finalize(), `${outputBase}.pdf`);
}

async function exportSlidesFastPdf(tabId, outputBase, session, run, restoreTabId) {
  const totalPages = Math.max(1, Number(session.totalPages || 1));
  const pdfBuilder = createPdfBuilder();

  for (let page = 1; page <= totalPages; page += 1) {
    if (run.canceled) throw new Error('Canceled');
    await assertSlidesTabInBackground(tabId, restoreTabId);
    await updateDownloadState({
      currentFile: `${outputBase}.pdf (${page}/${totalPages})`,
      downloadModeLabel: '高速ダウンロード',
    }, run);

    const rasterized = await sendSlidesMessage(tabId, 'ultimateMoocs:slides.fastRasterizeJpeg', {
      page,
      quality: 88,
      scale: 1.5,
      minWidth: 1024,
      minHeight: 576,
    });
    if (!rasterized?.dataUrl || !rasterized.width || !rasterized.height) {
      throw new Error(`Slides fast page ${page} JPEG export failed`);
    }

    pdfBuilder.addJpegPage({
      width: Number(rasterized.width),
      height: Number(rasterized.height),
      jpegBytes: await dataUrlToBytes(rasterized.dataUrl),
    });
  }

  await updateDownloadState({ currentFile: `${outputBase}.pdf` }, run);
  await downloadPdfBlob(pdfBuilder.finalize(), `${outputBase}.pdf`);
}

async function exportSlidesPng(tabId, outputBase, totalPages, previousSnapshot, run, restoreTabId) {
  let snapshot = previousSnapshot || '';

  for (let page = 1; page <= totalPages; page += 1) {
    if (run.canceled) throw new Error('Canceled');
    await assertSlidesTabInBackground(tabId, restoreTabId);
    const padded = String(page).padStart(3, '0');
    const filename = `${outputBase}_p${padded}.png`;
    await updateDownloadState({
      currentFile: `${filename} (${page}/${totalPages})`,
      downloadModeLabel: '回避ダウンロード',
    }, run);

    const stable = await sendSlidesMessage(tabId, 'ultimateMoocs:slides.stable', {
      page,
      previousSnapshot: snapshot,
    });
    snapshot = stable.snapshot || snapshot;

    const rasterized = await sendSlidesMessage(tabId, 'ultimateMoocs:slides.rasterizePng', {
      page,
      scale: 1.5,
      minWidth: 1024,
      minHeight: 576,
    });
    if (!rasterized?.dataUrl) {
      throw new Error(`Slides page ${page} PNG export failed`);
    }
    await downloadDataUrl(rasterized.dataUrl, filename);

    if (page < totalPages) {
      await sendSlidesMessage(tabId, 'ultimateMoocs:slides.goto', {
        page: page + 1,
      });
    }
  }
}

async function exportSlidesFastPng(tabId, outputBase, session, run, restoreTabId) {
  const totalPages = Math.max(1, Number(session.totalPages || 1));

  for (let page = 1; page <= totalPages; page += 1) {
    if (run.canceled) throw new Error('Canceled');
    await assertSlidesTabInBackground(tabId, restoreTabId);
    const padded = String(page).padStart(3, '0');
    const filename = `${outputBase}_p${padded}.png`;
    await updateDownloadState({
      currentFile: `${filename} (${page}/${totalPages})`,
      downloadModeLabel: '高速ダウンロード',
    }, run);

    const rasterized = await sendSlidesMessage(tabId, 'ultimateMoocs:slides.fastRasterizePng', {
      page,
      scale: 1.5,
      minWidth: 1024,
      minHeight: 576,
    });
    if (!rasterized?.dataUrl) {
      throw new Error(`Slides fast page ${page} PNG export failed`);
    }
    await downloadDataUrl(rasterized.dataUrl, filename);
  }
}

function getSlidesOutputBase(entry, session) {
  const base = stripExtension(entry.filename || session.title || 'google-slides');
  const folderParts = sanitizeFilename(base).split('/');
  folderParts[folderParts.length - 1] = sanitizePathPart(session.title || folderParts.at(-1), 'google-slides');
  return folderParts.join('/');
}

async function processGoogleSlides(entry, run) {
  let tab = null;
  const format = entry.exportFormat === 'png' ? 'png' : 'pdf';
  try {
    if (format === 'pdf') {
      const outputBase = getSlidesOutputBase(entry, {});
      if (await tryExportSlidesPdfDirect(entry, outputBase, run)) {
        return;
      }
    }

    const [initialActiveTab] = await tabsQuery({ active: true, currentWindow: true }).catch(() => []);
    tab = await tabsCreate({ url: entry.url, active: false });
    await waitForTabComplete(tab.id);
    await keepSlidesTabInBackground(tab.id, initialActiveTab?.id);

    try {
      const fastSession = await sendSlidesMessage(tab.id, 'ultimateMoocs:slides.fastSession', {}, 4);
      if (fastSession.rawSvgCount && fastSession.rawSvgCount > fastSession.totalPages) {
        console.info('[ultimateMoocs:slides] ignored extra SVG snapshots', {
          rawSvgCount: fastSession.rawSvgCount,
          totalPages: fastSession.totalPages,
          url: entry.url,
        });
      }
      const outputBase = getSlidesOutputBase(entry, fastSession);
      if (format === 'pdf') {
        await exportSlidesFastPdf(tab.id, outputBase, fastSession, run, initialActiveTab?.id);
        return;
      }
      await exportSlidesFastPng(tab.id, outputBase, fastSession, run, initialActiveTab?.id);
      return;
    } catch (error) {
      console.warn('[ultimateMoocs:slides] fast SVG export failed, falling back to viewer export', error);
    }

    let session = await sendSlidesMessage(tab.id, 'ultimateMoocs:slides.session');
    session = await sendSlidesMessage(tab.id, 'ultimateMoocs:slides.first');
    let snapshotPayload = await sendSlidesMessage(tab.id, 'ultimateMoocs:slides.stable');
    let previousSnapshot = snapshotPayload.snapshot;
    const totalPages = Math.max(1, Number(session.totalPages || snapshotPayload.session?.totalPages || 1));
    const outputBase = getSlidesOutputBase(entry, session);

    if (format === 'pdf') {
      await assertSlidesTabInBackground(tab.id, initialActiveTab?.id);
      await exportSlidesPdf(tab.id, outputBase, totalPages, previousSnapshot, run, initialActiveTab?.id);
      return;
    }

    await exportSlidesPng(tab.id, outputBase, totalPages, previousSnapshot, run, initialActiveTab?.id);
  } catch (error) {
    throw error;
  } finally {
    if (tab?.id) await tabsRemove(tab.id).catch(() => {});
  }
}

async function updateDownloadState(patch, run = activeDownloadRun) {
  const current = await getDownloadState();
  if (run?.id && current.runId && current.runId !== run.id) {
    return current;
  }
  return saveDownloadState({ ...current, ...patch, runId: run?.id || current.runId });
}

async function processDownloadQueue(entries, scope) {
  if (activeDownloadRun) {
    activeDownloadRun.canceled = true;
  }

  const run = {
    id: `um-run-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    canceled: false,
  };
  activeDownloadRun = run;
  const state = createDefaultDownloadState({
    runId: run.id,
    status: 'running',
    scope,
    total: entries.length,
    completed: 0,
    failed: 0,
    failures: [],
    currentFile: '',
    downloadModeLabel: '',
    queuedAt: new Date().toISOString(),
    canceled: false,
  });
  await saveDownloadState(state);

  for (const entry of entries) {
    if (run.canceled) {
      await updateDownloadState({ status: 'canceled', currentFile: '', canceled: true }, run);
      if (activeDownloadRun === run) activeDownloadRun = null;
      return;
    }

    const currentState = await getDownloadState();
    await updateDownloadState({
      status: 'running',
      currentFile: entry.filename || entry.url,
      downloadModeLabel: entry.kind === 'google_slides' ? '' : '',
    }, run);

    try {
      if (entry.kind === 'google_slides') {
        await processGoogleSlides(entry, run);
        await updateDownloadState({ completed: currentState.completed + 1 }, run);
        continue;
      }

      if (entry.disabled) {
        throw new Error(entry.disabledReason || 'This candidate is disabled');
      }

      await downloadsDownload({
        url: entry.downloadUrl || entry.url,
        filename: sanitizeFilename(entry.filename),
        saveAs: false,
        conflictAction: 'uniquify',
      });

      await updateDownloadState({ completed: currentState.completed + 1 }, run);
    } catch (error) {
      const latest = await getDownloadState();
      if (latest.runId && latest.runId !== run.id) {
        continue;
      }
      await updateDownloadState({
        failed: latest.failed + 1,
        failures: [
          ...latest.failures,
          {
            filename: entry.filename || entry.url,
            url: entry.url,
            reason: error instanceof Error ? error.message : String(error),
          },
        ],
      }, run);
    }
  }

  await updateDownloadState({ status: 'complete', currentFile: '', downloadModeLabel: '' }, run);
  if (activeDownloadRun === run) activeDownloadRun = null;
}

function sendAsync(handler) {
  return (message, sender, sendResponse) => {
    if (!isUltimateMoocsMessage(message)) {
      return false;
    }

    handler(message, sender)
      .then((payload) => {
        sendResponse({ ok: true, payload });
      })
      .catch((error) => {
        console.error('[ultimateMoocs:background]', error);
        sendResponse({
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        });
      });

    return true;
  };
}

async function handleMessage(message, sender) {
  switch (message.type) {
    case MESSAGE_TYPES.contentPing:
      return {
        pong: true,
        tabId: sender.tab?.id ?? null,
        url: sender.url ?? sender.tab?.url ?? '',
      };

    case MESSAGE_TYPES.settingsGet:
      return {
        settings: await getSettings(),
      };

    case MESSAGE_TYPES.settingsSet:
      return {
        settings: await saveSettings(message.payload?.settings),
      };

    case MESSAGE_TYPES.settingsReset:
      return {
        settings: await resetSettings(),
      };

    case MESSAGE_TYPES.diagnosticsGet: {
      const settings = await getSettings();
      if (!settings.debug?.enableDebugLog) {
        throw new Error('デベロッパーモードがOFFのため診断機能は利用できません。');
      }
      const manifest = browserApi.runtime.getManifest();
      const moocsTabs = await tabsQuery({ url: 'https://moocs.iniad.org/*' }).catch(() => []);
      const probeResults = await Promise.all(
        moocsTabs
          .filter((tab) => Number.isInteger(tab.id))
          .map(async (tab) => {
            try {
              const response = await tabsSendMessage(tab.id, { type: 'ultimateMoocs:content.probe' });
              return Boolean(response?.ok && response?.ready);
            } catch {
              return false;
            }
          }),
      );
      const connectedTabs = probeResults.filter(Boolean).length;
      const downloadState = await getDownloadState();
      const apiChecks = [
        ['storage', 'Storage API', Boolean(browserApi.storage?.local)],
        ['downloads', 'Downloads API', Boolean(browserApi.downloads?.download)],
        ['tabs', 'Tabs API', Boolean(browserApi.tabs?.query)],
        ['scripting', 'Scripting API', Boolean(browserApi.scripting?.executeScript)],
      ].map(([id, label, available]) => ({
        id,
        label,
        status: available ? 'ok' : 'error',
        detail: available ? '利用可能' : '利用できません',
      }));
      const contentStatus = !moocsTabs.length
        ? 'info'
        : connectedTabs === moocsTabs.length
          ? 'ok'
          : 'warning';
      return {
        generatedAt: new Date().toISOString(),
        manifest: {
          name: manifest.name,
          version: manifest.version,
          manifestVersion: manifest.manifest_version,
        },
        checks: [
          { id: 'background', label: 'Background service worker', status: 'ok', detail: '応答しています' },
          ...apiChecks,
          {
            id: 'content',
            label: 'MOOCs content script',
            status: contentStatus,
            detail: moocsTabs.length
              ? `${connectedTabs} / ${moocsTabs.length} タブ接続`
              : '開いているMOOCsタブはありません',
          },
          {
            id: 'download-state',
            label: '資料保存キュー',
            status: downloadState.status === 'running' ? 'info' : 'ok',
            detail: `状態: ${downloadState.status} / 完了 ${downloadState.completed} / 失敗 ${downloadState.failed}`,
          },
        ],
      };
    }

    case MESSAGE_TYPES.optionsOpen:
      try {
        await runtimeOpenOptionsPage();
      } catch {
        await tabsCreate({ url: chrome.runtime.getURL('options/index.html'), active: true });
      }
      return { opened: true };

    case MESSAGE_TYPES.downloadPrepare:
      return {
        downloadsReady: Boolean(browserApi?.downloads?.download),
        note: 'downloads API is available for the next implementation phase.',
      };

    case MESSAGE_TYPES.downloadStateGet:
      return {
        state: await getDownloadState(),
      };

    case MESSAGE_TYPES.screenshotCapture:
      return captureVisibleScreenshot(sender, message.payload);

    case MESSAGE_TYPES.aiUsageGet:
      return {
        usage: await getAiUsage(),
      };

    case MESSAGE_TYPES.aiSummaryList:
      return listAiSummaries(message.payload);

    case MESSAGE_TYPES.aiSummaryDelete:
      return deleteAiSummary(message.payload);

    case MESSAGE_TYPES.slidesTextExtract:
    case MESSAGE_TYPES.aiExtractSlidesText:
      return extractSlidesText(message.payload);

    case MESSAGE_TYPES.aiSummarize:
      return summarizeWithAi(message.payload);

    case 'ultimateMoocs:slides.imageDataUrl': {
      const url = String(message.payload?.url || '');
      const response = await fetch(url, { credentials: 'include' });
      if (!response.ok) throw new Error(`Image fetch failed: HTTP ${response.status}`);
      const blob = await response.blob();
      if (!String(blob.type || '').startsWith('image/')) {
        throw new Error(`Image fetch returned non-image content: ${blob.type || 'unknown'}`);
      }
      return {
        dataUrl: await blobToDataUrl(blob),
      };
    }

    case MESSAGE_TYPES.downloadCancel:
      if (activeDownloadRun) activeDownloadRun.canceled = true;
      await updateDownloadState({ status: 'canceled', currentFile: '', canceled: true });
      return {
        state: await getDownloadState(),
      };

    case MESSAGE_TYPES.downloadEnqueue: {
      const entries = Array.isArray(message.payload?.entries) ? message.payload.entries : [];
      const scope = String(message.payload?.scope || 'page');
      const uniqueEntries = [
        ...new Map(
          entries
            .filter((entry) => entry && typeof entry.url === 'string')
            .map((entry) => [entry.url, entry]),
        ).values(),
      ];
      processDownloadQueue(uniqueEntries, scope).catch((error) => {
        console.error('[ultimateMoocs:download]', error);
      });
      return {
        state: await getDownloadState(),
      };
    }

    case MESSAGE_TYPES.debugLog:
      console.debug('[ultimateMoocs:debug]', message.payload);
      return { logged: true };

    default:
      throw new Error(`Unsupported message type: ${message.type}`);
  }
}

browserApi.runtime.onInstalled.addListener(async () => {
  await saveSettings(await getSettings());
  await reconnectOpenMoocsTabs();
  console.info('[ultimateMoocs:background] installed');
});

browserApi.runtime.onMessage.addListener(sendAsync(handleMessage));

chrome.commands?.onCommand?.addListener((command) => {
  if (command !== 'ultimateMoocs.captureScreenshot') return;
  captureScreenshotFromActiveTab().catch(() => {});
});

export async function downloadUrl({ url, filename }) {
  return downloadsDownload({
    url,
    filename,
    saveAs: false,
    conflictAction: 'uniquify',
  });
}
