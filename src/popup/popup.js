import { runtimeOpenOptionsPage, runtimeSendMessage } from '../shared/browserApi.js';
import { createMessage, MESSAGE_TYPES } from '../shared/messages.js';
import { getSettings } from '../shared/storage.js';

const status = document.querySelector('#popup-status');
const statusTitle = document.querySelector('#popup-status-title');
const featureList = document.querySelector('#feature-list');
const featureCount = document.querySelector('#feature-count');
const openOptionsButton = document.querySelector('#open-options');

const FEATURE_SUMMARY = [
  ['見た目カスタム', (settings) => settings.appearance.enableGlassmorphism],
  [
    '入力支援',
    (settings) =>
      settings.inputHelper.enableTextareaCounter ||
      settings.inputHelper.enableTextareaAutoResize ||
      settings.inputHelper.reloadAfterSubmit,
  ],
  ['資料保存', (settings) => settings.downloads.enableDownloadPanel],
  ['ページメモ', (settings) => settings.memo.enablePageMemo],
  [
    'コース整理',
    (settings) =>
      settings.course.enableCourseSort ||
      settings.course.enableCourseFavorite ||
      settings.course.enableCourseHide,
  ],
  [
    'INIAD Plus',
    (settings) => Object.values(settings.iniadPlus).some(Boolean),
  ],
  ['AI要約', (settings) => settings.ai.enableAiSummary],
  ['デベロッパーモード', (settings) => settings.debug.enableDebugLog],
];

function renderFeatures(settings) {
  let enabledCount = 0;
  featureList.replaceChildren(
    ...FEATURE_SUMMARY.map(([label, getter]) => {
      const enabled = Boolean(getter(settings));
      if (enabled) enabledCount += 1;
      const item = document.createElement('li');
      const name = document.createElement('span');
      const state = document.createElement('span');
      name.textContent = label;
      state.textContent = enabled ? '有効' : '無効';
      state.className = enabled ? 'um-on' : 'um-off';
      item.append(name, state);
      return item;
    }),
  );
  featureCount.textContent = `${enabledCount} / ${FEATURE_SUMMARY.length} 有効`;
}

async function checkBackground() {
  const [settings, response] = await Promise.all([
    getSettings(),
    runtimeSendMessage(createMessage(MESSAGE_TYPES.downloadPrepare)),
  ]);

  if (!response?.ok) {
    throw new Error(response?.error || 'backgroundに接続できませんでした。');
  }

  renderFeatures(settings);
  if (response.payload.downloadsReady) {
    document.body.dataset.status = 'ready';
    statusTitle.textContent = '正常に動作しています';
    status.textContent = '資料保存機能を利用できます。';
  } else {
    document.body.dataset.status = 'warning';
    statusTitle.textContent = '一部機能を利用できません';
    status.textContent = '資料保存機能へ接続できません。';
  }
}

openOptionsButton.addEventListener('click', () => {
  runtimeOpenOptionsPage().catch((error) => {
    console.error('[ultimateMoocs:popup]', error);
    document.body.dataset.status = 'error';
    statusTitle.textContent = '設定ページを開けませんでした';
    status.textContent = error.message;
  });
});

checkBackground().catch((error) => {
  console.error('[ultimateMoocs:popup]', error);
  document.body.dataset.status = 'error';
  statusTitle.textContent = '接続を確認してください';
  status.textContent = error.message;
});
