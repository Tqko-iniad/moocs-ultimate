import {
  classifyDownloadCandidateKind,
  getDownloadCandidateKindLabel,
} from '../shared/downloadCandidates.js';

export function createDownloadPanelElement(documentRef, handlers = {}) {
  const panel = documentRef.createElement('section');
  panel.className = 'um-download-panel';
  panel.dataset.umModule = 'downloads';
  panel.innerHTML = `
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
  panel.addEventListener('click', (event) => {
    const button = event.target instanceof Element ? event.target.closest('[data-um-download]') : null;
    if (!button) return;
    handlers.onAction?.(button.dataset.umDownload);
  });
  panel.addEventListener('change', (event) => {
    const checkbox = event.target instanceof HTMLInputElement ? event.target : null;
    if (!checkbox?.matches('[data-um-candidate-id]')) return;
    handlers.onCandidateSelectionChange?.(checkbox.dataset.umCandidateId, checkbox.checked);
  });
  return panel;
}

export function setDownloadPanelStatus(panel, text) {
  panel?.querySelector('.um-download-status')?.replaceChildren(document.createTextNode(text));
}

export function createDownloadCandidatesSummaryText(entries) {
  const counts = entries.reduce(
    (acc, entry) => {
      const kind = entry.candidateKind || classifyDownloadCandidateKind(entry);
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

export function renderDownloadCandidateList(panel, state, options = {}) {
  if (!panel) return;
  const list = panel.querySelector('.um-download-candidate-list');
  const summary = panel.querySelector('.um-download-candidate-summary');
  const saveSelectedButton = panel.querySelector('[data-um-download="save-selected"]');
  if (!list || !summary) return;

  const entries = state.entries;
  const selectedCount = entries.filter((entry) => state.selectedIds.has(entry.id)).length;
  options.updateTab?.(entries.length ? `資料保存 ${entries.length}件` : '資料保存', true);
  summary.textContent = entries.length
    ? `${createDownloadCandidatesSummaryText(entries)} / 選択 ${selectedCount}`
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
    checkbox.checked = state.selectedIds.has(entry.id);
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
      getDownloadCandidateKindLabel(entry.candidateKind),
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

export function renderDownloadQueueState(panel, state) {
  if (!panel || !state) return;
  const progress = panel.querySelector('.um-download-progress-bar');
  const total = Number(state.total || 0);
  const completed = Math.min(Math.max(0, Number(state.completed || 0)), total);
  const failed = Math.min(Math.max(0, Number(state.failed || 0)), Math.max(0, total - completed));
  const done = Math.min(total, completed + failed);
  progress.style.width = total ? `${Math.round((done / total) * 100)}%` : '0%';
  panel.querySelector('.um-download-current').textContent = state.currentFile || '-';
  panel.querySelector('.um-download-counts').textContent = `完了 ${completed} / 失敗 ${failed} / 全 ${total}`;
  panel.querySelector('.um-download-status').textContent = state.status || 'idle';
  const mode = panel.querySelector('.um-download-mode');
  if (mode) {
    mode.textContent = state.downloadModeLabel || '';
    mode.hidden = !state.downloadModeLabel;
    mode.dataset.umDownloadMode =
      state.downloadModeLabel === '回避ダウンロード' ? 'fallback' : state.downloadModeLabel ? 'fast' : '';
  }

  const failures = panel.querySelector('.um-download-failures');
  failures.replaceChildren();
  for (const failure of failed > 0 ? (state.failures || []).slice(-failed) : []) {
    const item = document.createElement('li');
    item.textContent = `${failure.filename}: ${failure.reason}`;
    failures.append(item);
  }
}
