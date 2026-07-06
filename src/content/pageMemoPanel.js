import {
  collectMemoPageContextFromDocument,
  createMemoNote,
  normalizeMemoRecord,
} from '../shared/pageMemo.js';

export function createPageMemoPanelController({
  document: documentRef,
  location: locationRef,
  getCurrentSettings,
  getMemos,
  saveMemos,
  getPageKey,
  createButton,
  downloadTextFile,
}) {
  let panel = null;
  let memoQueue = Promise.resolve();
  let searchQuery = '';

  function withMemoLock(task) {
    const result = memoQueue.then(task, task);
    memoQueue = result.then(
      () => {},
      () => {},
    );
    return result;
  }

  function getPageContext() {
    return collectMemoPageContextFromDocument(
      documentRef,
      getPageKey(),
      documentRef.title || locationRef.href,
    );
  }

  function normalizeCurrentMemoRecord(record) {
    return normalizeMemoRecord(record, getPageContext());
  }

  async function saveCurrentMemoRecord(record) {
    const memos = await getMemos();
    memos[getPageKey()] = normalizeCurrentMemoRecord(record);
    await saveMemos(memos);
  }

  async function render() {
    if (!panel) return;

    const memos = await getMemos();
    const record = normalizeCurrentMemoRecord(memos[getPageKey()]);
    const list = panel.querySelector('.um-memo-list');
    list.replaceChildren();

    const query = searchQuery.trim().toLowerCase();
    const visibleNotes = query
      ? record.notes.filter((note) => String(note.body || '').toLowerCase().includes(query))
      : record.notes;

    const countLabel = panel.querySelector('.um-memo-search-count');
    if (countLabel) {
      countLabel.textContent = query ? `${visibleNotes.length} / ${record.notes.length}件` : '';
    }

    for (const note of visibleNotes) {
      const item = documentRef.createElement('article');
      item.className = 'um-memo-item';
      item.dataset.memoId = note.id;

      const textarea = documentRef.createElement('textarea');
      textarea.className = 'um-memo-textarea';
      textarea.value = note.body || '';
      textarea.placeholder = 'メモを書く';
      textarea.addEventListener('input', () => {
        withMemoLock(async () => {
          const latest = normalizeCurrentMemoRecord((await getMemos())[getPageKey()]);
          const target = latest.notes.find((entry) => entry.id === note.id);
          if (!target) return;
          target.body = textarea.value;
          target.updatedAt = new Date().toISOString();
          latest.updatedAt = target.updatedAt;
          await saveCurrentMemoRecord(latest);
        }).catch((error) => console.warn('[ultimateMoocs:memo] save failed', error));
      });

      const actions = documentRef.createElement('div');
      actions.className = 'um-memo-actions';
      const downloadButton = createButton('DL');
      downloadButton.title = 'このメモをダウンロード';
      downloadButton.addEventListener('click', () => {
        downloadTextFile(`${documentRef.title || 'moocs-memo'}.txt`, textarea.value);
      });
      const deleteButton = createButton('削除');
      deleteButton.addEventListener('click', () => {
        withMemoLock(async () => {
          const latest = normalizeCurrentMemoRecord((await getMemos())[getPageKey()]);
          latest.notes = latest.notes.filter((entry) => entry.id !== note.id);
          latest.updatedAt = new Date().toISOString();
          await saveCurrentMemoRecord(latest);
        })
          .then(() => render())
          .catch((error) => console.warn('[ultimateMoocs:memo] delete failed', error));
      });
      actions.append(downloadButton, deleteButton);
      item.append(textarea, actions);
      list.append(item);
    }
  }

  async function addNote(body = '', options = {}) {
    await withMemoLock(async () => {
      const memos = await getMemos();
      const record = normalizeCurrentMemoRecord(memos[getPageKey()]);
      const now = new Date().toISOString();
      const note = createMemoNote(body, now);
      if (options.prepend) record.notes.unshift(note);
      else record.notes.push(note);
      record.updatedAt = now;
      await saveCurrentMemoRecord(record);
    });
    await render();
  }

  async function ensureMounted() {
    const enabled = Boolean(getCurrentSettings()?.memo?.enablePageMemo);

    if (!enabled) {
      panel?.remove();
      panel = null;
      return;
    }

    if (!panel || !panel.isConnected) {
      panel = documentRef.createElement('aside');
      panel.className = 'um-memo-panel';
      panel.dataset.umModule = 'memo';
      panel.innerHTML = `
        <div class="um-panel-header">
          <strong>Memo</strong>
          <div class="um-panel-actions"></div>
        </div>
        <div class="um-memo-search-row">
          <input type="search" class="um-memo-search-input" placeholder="メモを検索" />
          <span class="um-memo-search-count"></span>
        </div>
        <div class="um-memo-list"></div>
      `;
      const actions = panel.querySelector('.um-panel-actions');
      const addButton = createButton('追加');
      addButton.addEventListener('click', () => {
        addNote('').catch((error) => console.warn('[ultimateMoocs:memo] add failed', error));
      });
      const exportButton = createButton('JSON');
      exportButton.addEventListener('click', async () => {
        const record = normalizeCurrentMemoRecord((await getMemos())[getPageKey()]);
        downloadTextFile('moocs-ultimate-page-memo.json', `${JSON.stringify(record, null, 2)}\n`, 'application/json');
      });
      actions.append(addButton, exportButton);

      const searchInput = panel.querySelector('.um-memo-search-input');
      searchInput.addEventListener('input', () => {
        searchQuery = searchInput.value;
        render().catch((error) => console.warn('[ultimateMoocs:memo] search render failed', error));
      });

      documentRef.body.append(panel);
    }

    await render();
  }

  return {
    addNote,
    ensureMounted,
    render,
  };
}
