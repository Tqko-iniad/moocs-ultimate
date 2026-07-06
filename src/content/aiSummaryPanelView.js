export function createAiSummaryPanelElement(documentRef, handlers = {}) {
  const panel = documentRef.createElement('section');
  panel.className = 'um-ai-panel';
  panel.dataset.umModule = 'ai-summary';
  panel.innerHTML = `
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
      <button type="button" data-um-ai="check-stale">更新確認</button>
      <button type="button" data-um-ai="regenerate">再生成</button>
    </div>
    <p class="um-ai-stale-notice" hidden>⚠ ページ内容が前回の要約作成時から変わっている可能性があります。</p>
    <div class="um-ai-output" hidden></div>
    <div class="um-ai-output-actions" hidden>
      <button type="button" data-um-ai="copy">コピー</button>
      <button type="button" data-um-ai="download">TXT保存</button>
      <button type="button" data-um-ai="memo">メモへ追加</button>
    </div>
  `;
  panel.addEventListener('click', (event) => {
    const button = event.target instanceof Element ? event.target.closest('[data-um-ai]') : null;
    if (button) handlers.onAction?.(button.dataset.umAi);
  });
  return panel;
}

export function setAiSummaryPanelStatus(panel, text, isError = false) {
  if (!panel) return;
  const status = panel.querySelector('.um-ai-status');
  status.textContent = text;
  status.classList.toggle('error', isError);
}

export function setAiSummaryBusyState(panel, isBusy) {
  if (!panel) return;
  panel.dataset.umAiBusy = String(isBusy);
  for (const button of panel.querySelectorAll(
    '[data-um-ai="summarize"], [data-um-ai="regenerate"], [data-um-ai="check-stale"]',
  )) {
    button.disabled = isBusy;
  }
}

export function updateAiSummaryTokenEstimate(panel, estimatedTokens = null) {
  if (!panel) return;
  const indicator = panel.querySelector('.um-ai-token-indicator');
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

export function updateAiSummaryActionButtons(panel, aiSummaryBusy, { hasCachedSummary = false, isShowingCached = false } = {}) {
  if (!panel) return;
  const mainButton = panel.querySelector('[data-um-ai="summarize"]');
  const regenerateButton = panel.querySelector('[data-um-ai="regenerate"]');
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

export function updateAiSummaryCacheStateView(panel, updateLectureToolTabStatus, { cached = false, updatedAt = '', hasApiKey = true } = {}) {
  if (!panel) return;
  const state = panel.querySelector('.um-ai-state');
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
  updateLectureToolTabStatus?.('ai', tabStatus, stateName);
}

export function resetAiSummaryPanelForSource(panel, sourceUrl) {
  if (!panel) return false;
  if (panel.dataset.umSourceUrl === sourceUrl) return false;

  panel.dataset.umSourceUrl = sourceUrl;
  panel.dataset.cachedSummaryKey = '';

  const output = panel.querySelector('.um-ai-output');
  const outputActions = panel.querySelector('.um-ai-output-actions');
  const cacheRow = panel.querySelector('.um-ai-cache-row');
  const cacheText = panel.querySelector('.um-ai-cache-text');
  const staleNotice = panel.querySelector('.um-ai-stale-notice');

  if (output) {
    output.hidden = true;
    output.dataset.rawSummary = '';
    output.replaceChildren();
  }
  if (outputActions) outputActions.hidden = true;
  if (cacheRow) cacheRow.hidden = true;
  if (cacheText) cacheText.textContent = '';
  if (staleNotice) staleNotice.hidden = true;
  return true;
}

export function setAiSummaryStaleState(panel, isStale) {
  if (!panel) return;
  const staleNotice = panel.querySelector('.um-ai-stale-notice');
  if (staleNotice) staleNotice.hidden = !isStale;
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

export function renderMarkdownSummaryBlocks(markdown) {
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

export function renderAiSummaryOutput(panel, summary, meta = {}) {
  if (!panel) return null;
  const output = panel.querySelector('.um-ai-output');
  const outputActions = panel.querySelector('.um-ai-output-actions');
  if (!output || !outputActions) return null;
  output.hidden = false;
  outputActions.hidden = false;
  output.dataset.rawSummary = summary;
  output.replaceChildren(renderMarkdownSummaryBlocks(summary));
  const cached = meta.cached ? '保存済み要約を表示中。APIは使っていません' : '新しい要約を作成しました';
  const warnings = Array.isArray(meta.warnings) ? meta.warnings.filter(Boolean) : [];
  const warningText = warnings.length ? ` / ${warnings.join(' / ')}` : '';
  const tokenText = meta.cached ? '' : ` / 約${Number(meta.estimatedInputTokens || 0).toLocaleString()} input tokens`;
  return {
    statusText: `${cached}${tokenText}${warningText}`,
    isCached: Boolean(meta.cached),
  };
}
