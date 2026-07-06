import { runtimeSendMessage, storageAddChangeListener } from '../shared/browserApi.js';
import { createMessage, MESSAGE_TYPES } from '../shared/messages.js';
import {
  getAiSummaries,
  getAssignmentStatus,
  saveAiSummaries,
  saveAssignmentStatus,
  getMemos,
  saveMemos,
  STORAGE_KEYS,
} from '../shared/storage.js';
import {
  dedupeAssignmentRecords,
  formatAssignmentDeadline,
  getAssignmentDeadlineState,
  getAssignmentDeadlineTimestamp,
} from '../shared/assignmentDeadline.js';
import {
  SETTING_DEFINITIONS,
  cloneDefaultSettings,
  getValueByPath,
  setValueByPath,
  validateAndNormalizeSettings,
} from '../shared/defaultSettings.js';

const elements = {
  root: document.querySelector('#settings-root'),
  settingsNav: document.querySelector('#settings-nav'),
  topTabs: document.querySelectorAll('[data-view]'),
  settingsView: document.querySelector('#settings-view'),
  backupView: document.querySelector('#backup-view'),
  saveButton: document.querySelector('#save-settings'),
  resetButton: document.querySelector('#reset-settings'),
  exportButton: document.querySelector('#export-settings'),
  importInput: document.querySelector('#import-settings'),
  memoSearch: document.querySelector('#memo-search'),
  memoExport: document.querySelector('#memo-export'),
  memoImport: document.querySelector('#memo-import'),
  memoResults: document.querySelector('#memo-results'),
  memoListSection: document.querySelector('#memo-list-section'),
  assignmentListSection: document.querySelector('#assignment-list-section'),
  assignmentSearch: document.querySelector('#assignment-search'),
  assignmentFilter: document.querySelector('#assignment-filter'),
  assignmentSort: document.querySelector('#assignment-sort'),
  assignmentRefresh: document.querySelector('#assignment-refresh'),
  assignmentExport: document.querySelector('#assignment-export'),
  assignmentClearFiltered: document.querySelector('#assignment-clear-filtered'),
  assignmentQuickFilters: document.querySelector('#assignment-quick-filters'),
  assignmentCourseTabs: document.querySelector('#assignment-course-tabs'),
  assignmentLectureTabs: document.querySelector('#assignment-lecture-tabs'),
  assignmentResults: document.querySelector('#assignment-results'),
  assignmentSummary: document.querySelector('#assignment-summary'),
  aiSummarySection: document.querySelector('#ai-summary-section'),
  aiSummarySearch: document.querySelector('#ai-summary-search'),
  aiSummaryRefresh: document.querySelector('#ai-summary-refresh'),
  aiSummaryResults: document.querySelector('#ai-summary-results'),
  aiSummaryUsage: document.querySelector('#ai-summary-usage'),
  diagnosticsTab: document.querySelector('#diagnostics-tab'),
  diagnosticsSection: document.querySelector('#diagnostics-section'),
  diagnosticsSummary: document.querySelector('#diagnostics-summary'),
  diagnosticsRefresh: document.querySelector('#diagnostics-refresh'),
  diagnosticsExport: document.querySelector('#diagnostics-export'),
  diagnosticsResults: document.querySelector('#diagnostics-results'),
  saveStatus: document.querySelector('#save-status'),
};

let currentSettings = cloneDefaultSettings();
let currentMemos = {};
let currentAssignmentStatus = {};
let currentAiSummaries = {};
let currentDiagnostics = null;
let hasUnsavedChanges = false;
let activeCategory = 'basic';
let activeAssignmentCourse = 'all';
let activeAssignmentLecture = 'all';
let activeAssignmentQuickFilter = 'all';

const CATEGORY_UI = Object.freeze({
  basic: {
    title: '基本設定',
    icon: 'settings',
    accent: 'blue',
    description: 'よく使う機能だけをまとめています。迷ったらまずここを確認してください。',
    fields: [
      'appearance.enableGlassmorphism',
      'appearance.backgroundImageUrl',
      'downloads.enableDownloadPanel',
      'downloads.enableGoogleSlidesPdf',
      'downloads.enableScreenshotShortcut',
      'navigation.enableTabColoring',
      'memo.enablePageMemo',
    ],
  },
  appearance: {
    title: '見た目',
    icon: 'palette',
    accent: 'purple',
    description: '背景、ガラス風UI、固定ヘッダーなどMOOCs画面の見た目を調整します。',
  },
  downloads: {
    title: '資料保存',
    icon: 'folder-down',
    accent: 'green',
    description: 'ページ・講義回・科目単位の資料保存とGoogle Slides保存を制御します。',
  },
  navigation: {
    title: 'ページ操作',
    icon: 'route',
    accent: 'cyan',
    description: 'ページ番号の色分けや前後移動ショートカットを調整します。',
  },
  inputHelper: {
    title: '入力支援',
    icon: 'keyboard',
    accent: 'orange',
    description: 'textareaの文字数表示、自動リサイズ、提出後リロードを制御します。',
  },
  memo: {
    title: 'メモ',
    icon: 'note',
    accent: 'yellow',
    description: 'ページごとのメモ、メモ一覧、メモ書き出しを制御します。',
  },
  course: {
    title: 'コース',
    icon: 'book',
    accent: 'indigo',
    description: 'コース一覧の並び替え、お気に入り、非表示を制御します。',
  },
  assignments: {
    title: '課題',
    icon: 'clipboard-check',
    accent: 'red',
    description: '提出状態の確認と、MOOCsトップに表示する講義回別の課題状況を調整します。',
  },
  iniadPlus: {
    title: 'INIAD Plus',
    icon: 'plug',
    accent: 'teal',
    description: 'ACE時間割、外部リンク、Driveボタン、スライド表示調整など周辺機能を制御します。',
  },
  ai: {
    title: 'AI要約',
    icon: 'sparkles',
    accent: 'pink',
    description: 'INIAD AI MOPを使ったスライド要約の設定です。送信前確認とtoken節約を前提にしています。',
  },
  debug: {
    title: '上級・デバッグ',
    icon: 'terminal',
    accent: 'gray',
    description: '内部状態表示やデバッグログなど、検証用の設定です。',
  },
});

const CATEGORY_ICON_SVG = Object.freeze({
  settings: '<svg viewBox="0 0 24 24"><path d="M4 7h10"/><path d="M18 7h2"/><path d="M16 5v4"/><path d="M4 17h2"/><path d="M10 17h10"/><path d="M8 15v4"/></svg>',
  palette: '<svg viewBox="0 0 24 24"><path d="M12 4a8 8 0 0 0 0 16h1.5a1.8 1.8 0 0 0 1.2-3.1 1.6 1.6 0 0 1 1.1-2.9H17a3 3 0 0 0 3-3 7 7 0 0 0-8-7Z"/><circle cx="8" cy="10" r="1"/><circle cx="11" cy="8" r="1"/><circle cx="14" cy="9" r="1"/></svg>',
  'folder-down': '<svg viewBox="0 0 24 24"><path d="M4 7.5A2.5 2.5 0 0 1 6.5 5H10l2 2h5.5A2.5 2.5 0 0 1 20 9.5V17a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2Z"/><path d="M12 10v5"/><path d="m9.5 12.5 2.5 2.5 2.5-2.5"/></svg>',
  route: '<svg viewBox="0 0 24 24"><path d="M6 5h.01"/><path d="M18 19h.01"/><path d="M7 5h4a3 3 0 0 1 0 6H9a3 3 0 0 0 0 6h8"/><circle cx="6" cy="5" r="2"/><circle cx="18" cy="19" r="2"/></svg>',
  keyboard: '<svg viewBox="0 0 24 24"><rect x="3" y="6" width="18" height="12" rx="2"/><path d="M7 10h.01"/><path d="M11 10h.01"/><path d="M15 10h.01"/><path d="M17 14H7"/></svg>',
  note: '<svg viewBox="0 0 24 24"><path d="M7 4h8l4 4v12H7a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z"/><path d="M14 4v5h5"/><path d="M8 13h8"/><path d="M8 16h5"/></svg>',
  book: '<svg viewBox="0 0 24 24"><path d="M5 5.5A2.5 2.5 0 0 1 7.5 3H20v16H7.5A2.5 2.5 0 0 0 5 21Z"/><path d="M5 5.5V21"/><path d="M9 7h7"/></svg>',
  'clipboard-check': '<svg viewBox="0 0 24 24"><path d="M9 4h6l1 2h2a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h2Z"/><path d="M9 4v3h6V4"/><path d="m8 14 2.5 2.5L16 11"/></svg>',
  plug: '<svg viewBox="0 0 24 24"><path d="M8 4v6"/><path d="M16 4v6"/><path d="M7 10h10v3a5 5 0 0 1-10 0Z"/><path d="M12 18v3"/></svg>',
  sparkles: '<svg viewBox="0 0 24 24"><path d="M12 3 14 8l5 2-5 2-2 5-2-5-5-2 5-2Z"/><path d="M19 15v4"/><path d="M17 17h4"/><path d="M5 4v3"/><path d="M3.5 5.5h3"/></svg>',
  terminal: '<svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m7 9 3 3-3 3"/><path d="M12 15h5"/></svg>',
});

const FIELD_UI = Object.freeze({
  'appearance.enableGlassmorphism': ['ダークグラスUI', 'MOOCsのカードやヘッダーを背景が透ける黒いガラス風にします。'],
  'appearance.backgroundImageUrl': ['背景画像URL', 'MOOCs全体の背景に使う画像URLです。夜景など暗めの画像がおすすめです。'],
  'appearance.backgroundColor': ['背景色', '背景画像がない時や画像読み込み前に表示する色です。'],
  'appearance.contentOpacity': ['透過度', 'UI面の透け具合に影響します。Glass UIでは読みやすさのため内部で調整されます。'],
  'appearance.stickyHeader': ['ヘッダー追従', '上部ヘッダーをスクロール時も画面上部に固定します。'],
  'appearance.stickySidebar': ['サイドバー追従', '左サイドバーをスクロール時も追従させます。'],
  'appearance.showScrollTopButton': ['上へ戻るボタン', '右下にページ上部へ戻るボタンを表示します。'],
  'inputHelper.enableTextareaCounter': ['文字数カウンター', '回答欄の下に文字数を表示します。'],
  'inputHelper.enableTextareaAutoResize': ['入力欄の自動リサイズ', '入力内容に合わせてtextareaの高さを自動調整します。'],
  'inputHelper.reloadAfterSubmit': ['提出後に自動リロード', '提出操作後にページを再読み込みします。不要ならOFF推奨です。'],
  'navigation.enableTabColoring': ['ページ番号の色分け', '出席確認・課題・スライドなどをページ番号の色で見分けます。'],
  'navigation.tabColorMode': ['色分けモード', '通常リンク向けの色表示方法です。ページ番号は面で色付けします。'],
  'navigation.shortcutPrevious': ['前ページショートカット', '前ページへ移動するキーです。ModはMacならCommand、それ以外はCtrlです。'],
  'navigation.shortcutNext': ['次ページショートカット', '次ページへ移動するキーです。入力中は動作しません。'],
  'navigation.colors.attendanceTest': ['出席テスト色', '出席テストページの色です。'],
  'navigation.colors.attendanceAssignment': ['出席課題色', '出席課題ページの色です。'],
  'navigation.colors.assignment': ['課題色', '課題ページの色です。'],
  'navigation.colors.check': ['確認・テスト色', '理解度確認やテストページの色です。'],
  'navigation.colors.slide': ['スライド・資料色', 'スライドや資料ページの色です。'],
  'downloads.enableDownloadPanel': ['資料保存パネル', '講義ページにMOOCs Ultimateの資料保存パネルを表示します。'],
  'downloads.enableCurrentPageDownload': ['このページの資料保存', '現在ページ内の資料を保存できるようにします。'],
  'downloads.enableLectureDownload': ['この回の資料保存', '同じ講義回のページを巡回して資料を保存できるようにします。'],
  'downloads.enableCourseDownload': ['この科目を収集', '科目内の講義ページを巡回します。時間がかかるため必要時だけON推奨です。'],
  'downloads.enableGoogleSlidesPdf': ['Google Slides PDF保存', 'Google SlidesをPDFとして保存します。高速/回避ダウンロードの表示に対応しています。'],
  'downloads.enableGoogleSlidesPng': ['Google Slides PNG保存', 'Slidesを1ページ1画像として保存します。通常はOFFで十分です。'],
  'downloads.enableDirectFileDownload': ['直接ファイル保存', 'PDF、ZIP、画像などの直接リンクをdownloads APIで保存します。'],
  'downloads.enableScreenshotShortcut': ['スクリーンショットショートカット', 'Command + Shift + Sで現在表示しているMOOCs画面をPNG保存します。入力中は動作しません。'],
  'downloads.screenshotShortcutAction': ['スクリーンショットの動作', 'ショートカットを押した時に、PNGをダウンロードするかクリップボードにコピーするか選びます。'],
  'downloads.downloadFolderPattern': ['保存フォルダ形式', '資料の保存先フォルダ名です。現在は内部形式として扱います。'],
  'memo.enablePageMemo': ['ページメモ', 'MOOCsページ上にメモ欄を表示します。'],
  'memo.enableMemoList': ['メモ一覧', '設定ページ内のメモ一覧タブを表示します。'],
  'memo.enableMemoExport': ['メモの書き出し', 'メモをJSONやTXTとして保存できるようにします。'],
  'course.enableCourseSort': ['コース並び替え', 'トップページのコース順序を変更できるようにします。'],
  'course.enableCourseFavorite': ['コースお気に入り', 'コースをお気に入りとして目立たせます。'],
  'course.enableCourseHide': ['コース非表示', '不要なコースを隠せるようにします。'],
  'assignments.enableSubmissionCheck': [
    '課題提出確認',
    '課題ページ上に提出状態を表示します。強い根拠がない場合は確認不能として扱います。',
  ],
  'assignments.enableAssignmentOverview': [
    '講義ごとの課題状況',
    'MOOCsトップに、講義回ごとの課題数・残り・最も近い提出期限を表示します。',
  ],
  'assignments.hideCompletedAssignmentLectures': [
    '完了済みの講義回を隠す',
    '記録されている課題がすべて提出済みの講義回を、MOOCsトップの課題状況から除外します。',
  ],
  'assignments.assignmentOverviewWarningDays': [
    '期限を強調する日数',
    '指定日数以内の提出期限を「あとN日」として強調します。1〜30日で指定できます。',
  ],
  'assignments.assignmentOverviewLimit': [
    '最大表示講義数',
    'MOOCsトップへ表示する講義回の最大数です。3〜30回で指定できます。',
  ],
  'assignments.enableCalendarExport': ['カレンダー書き出し', '課題概況パネルに締切を .ics ファイルとして書き出すボタンを表示します。'],
  'iniadPlus.enableAceTimetableDownload': ['ACE時間割ダウンロード', 'ACEページで時間割を取得し、ローカルに保存します。'],
  'iniadPlus.enableExternalLinksPanel': ['外部リンク一覧', '現在ページ内の外部リンクを折りたたみパネルに表示します。'],
  'iniadPlus.enableDriveButton': ['Driveボタン', 'Google Drive系リンクがあるページでDriveボタンを表示します。'],
  'iniadPlus.enableSlideResizeTools': ['スライド表示調整', '埋め込みスライドの幅・高さ・拡大率を調整するUIを表示します。'],
  'navigation.enableSlidePositionRestore': ['スライド位置の復元', 'ページ移動後に戻ったとき、スライドを前回の表示位置から再開します。'],
  'navigation.slidePositionMaxEntries': ['スライド位置の最大保存件数', '保存するスライド位置の上限です。超過分は古い順に削除されます。'],
  'navigation.slidePositionStorage': ['スライド位置の保存先', 'session: ブラウザを閉じたら消える / local: 永続保存'],
  'ai.enableAiSummary': ['AI要約', 'スライドや資料テキストをINIAD AI MOPへ送って要約する機能を有効にします。'],
  'ai.provider': ['AIプロバイダー', '現在はINIAD AI MOPのOpenAI互換APIを使います。'],
  'ai.apiBaseUrl': ['API Base URL', 'INIAD AI MOPのOpenAI互換APIのURLです。通常は変更しません。'],
  'ai.apiKey': ['APIキー', 'INIAD AI MOPで発行した個人APIキーです。content scriptへは渡さずbackgroundで使います。'],
  'ai.model': ['モデル', 'まずはgpt-5.4-mini推奨です。節約重視ならnano、品質重視なら通常モデルを選びます。'],
  'ai.summaryMode': ['要約モード', '短め、標準、詳しめのどれで復習ノートを作るかを選びます。'],
  'ai.sendImages': ['画像も送信する', '現在はテキストのみで要約します。画像送信は将来対応予定です。'],
  'ai.confirmBeforeSend': ['送信前に確認する', '抽出テキストと推定tokenを確認してからAIへ送るための設定です。'],
  'ai.maxInputChars': ['最大入力文字数', 'スライド本文をAPIへ送る前にこの文字数まで切り詰めます。'],
  'ai.maxOutputTokens': ['最大出力token', 'AI要約の最大出力tokenです。短くすると節約できます。'],
  'debug.enableDebugLog': [
    'デベロッパーモード',
    '課題判定の根拠・信頼度・開発用操作とconsoleログを表示します。問題調査時だけON推奨です。',
  ],
  'debug.showInternalStatus': ['内部状態表示', '右下にMOOCs Ultimateの動作バッジを表示します。'],
});

const BASIC_STATUS_CARDS = Object.freeze([
  {
    label: '見た目',
    paths: ['appearance.enableGlassmorphism', 'appearance.backgroundImageUrl'],
    detail: '背景とダークグラスUI',
  },
  {
    label: '資料保存',
    paths: ['downloads.enableDownloadPanel', 'downloads.enableCurrentPageDownload', 'downloads.enableLectureDownload'],
    detail: 'ページ・講義回の保存',
  },
  {
    label: 'Slides PDF',
    paths: ['downloads.enableGoogleSlidesPdf'],
    detail: '高速/回避ダウンロード',
  },
  {
    label: '学習補助',
    paths: ['navigation.enableTabColoring', 'inputHelper.enableTextareaCounter', 'assignments.enableSubmissionCheck'],
    detail: '色分け・入力・提出確認',
  },
  {
    label: 'INIAD Plus',
    paths: ['iniadPlus.enableDriveButton', 'iniadPlus.enableExternalLinksPanel', 'iniadPlus.enableAceTimetableDownload'],
    detail: 'Drive・リンク・ACE',
  },
  {
    label: 'AI要約',
    paths: ['ai.enableAiSummary', 'ai.apiKey'],
    detail: 'MOP連携・token節約',
  },
]);

const QUICK_PRESETS = Object.freeze([
  {
    id: 'glass',
    title: 'GlassMOOCs風',
    description: '背景・黒いグラスUI・ページ色分けを中心にONにします。',
    values: {
      'appearance.enableGlassmorphism': true,
      'appearance.showScrollTopButton': true,
      'navigation.enableTabColoring': true,
      'downloads.enableDownloadPanel': true,
      'downloads.enableGoogleSlidesPdf': true,
      'downloads.enableScreenshotShortcut': true,
      'downloads.screenshotShortcutAction': 'download',
      'iniadPlus.enableDriveButton': true,
    },
  },
  {
    id: 'downloads',
    title: '資料保存重視',
    description: '資料保存パネルとPDF保存をON、PNG保存はOFFにします。',
    values: {
      'downloads.enableDownloadPanel': true,
      'downloads.enableCurrentPageDownload': true,
      'downloads.enableLectureDownload': true,
      'downloads.enableCourseDownload': true,
      'downloads.enableGoogleSlidesPdf': true,
      'downloads.enableGoogleSlidesPng': false,
      'downloads.enableDirectFileDownload': true,
      'downloads.enableScreenshotShortcut': true,
      'downloads.screenshotShortcutAction': 'download',
    },
  },
  {
    id: 'quiet',
    title: '最小構成',
    description: '見た目と保存パネルだけを残し、補助UIを控えめにします。',
    values: {
      'downloads.enableDownloadPanel': true,
      'downloads.enableGoogleSlidesPdf': true,
      'memo.enablePageMemo': false,
      'course.enableCourseSort': false,
      'course.enableCourseFavorite': false,
      'course.enableCourseHide': false,
      'debug.enableDebugLog': false,
      'debug.showInternalStatus': false,
    },
  },
]);

function setStatus(message, isError = false) {
  elements.saveStatus.textContent = message;
  elements.saveStatus.classList.toggle('error', isError);
  updateDirtyState();
}

function createField(field) {
  const label = document.createElement('label');
  label.className = 'um-field';
  label.dataset.settingPath = field.path;

  const fieldMeta = FIELD_UI[field.path] || [field.label, ''];
  const labelBody = document.createElement('div');
  labelBody.className = 'um-field-label';

  const text = document.createElement('span');
  text.textContent = fieldMeta[0];
  labelBody.append(text);

  if (fieldMeta[1]) {
    const description = document.createElement('p');
    description.className = 'um-field-description';
    description.textContent = fieldMeta[1];
    labelBody.append(description);
  }

  let control;
  if (field.type === 'select') {
    control = document.createElement('select');
    for (const option of field.options) {
      const optionNode = document.createElement('option');
      optionNode.value = option;
      optionNode.textContent = field.optionLabels?.[option] || option;
      control.append(optionNode);
    }
  } else {
    control = document.createElement('input');
    control.type = field.type;
    if (field.type === 'range' || field.type === 'number') {
      control.min = field.min;
      control.max = field.max;
      control.step = field.step;
    }
  }

  control.dataset.settingPath = field.path;
  control.dataset.settingType = field.type;
  control.addEventListener('input', () => handleControlInput(control));
  control.addEventListener('change', () => handleControlInput(control));

  const controlWrap = document.createElement('span');
  controlWrap.className = 'um-field-control';
  controlWrap.dataset.type = field.type;
  controlWrap.append(control);
  label.append(labelBody, controlWrap);
  return label;
}

function handleControlInput(changedControl) {
  const path = changedControl.dataset.settingPath;
  for (const control of elements.root.querySelectorAll(`[data-setting-path="${CSS.escape(path)}"]`)) {
    if (control === changedControl) continue;
    setControlValue(control, getControlValue(changedControl));
  }
  markUnsaved();
  updateBasicOverview();
  updateAssignmentOverviewControlState();
}

function updateAssignmentOverviewControlState() {
  const overviewToggle = elements.root.querySelector(
    '[data-setting-path="assignments.enableAssignmentOverview"][data-setting-type]',
  );
  const enabled = Boolean(overviewToggle?.checked);
  for (const path of [
    'assignments.hideCompletedAssignmentLectures',
    'assignments.assignmentOverviewWarningDays',
    'assignments.assignmentOverviewLimit',
  ]) {
    for (const control of elements.root.querySelectorAll(
      `[data-setting-path="${path}"][data-setting-type]`,
    )) {
      control.disabled = !enabled;
    }
  }
}

function getCategoryFields(category) {
  if (category.key === 'basic') {
    const allFields = SETTING_DEFINITIONS.flatMap((entry) => entry.fields);
    const wanted = new Set(CATEGORY_UI.basic.fields);
    return allFields.filter((field) => wanted.has(field.path));
  }
  return SETTING_DEFINITIONS.find((entry) => entry.key === category.key)?.fields || [];
}

function createCategorySection(categoryKey) {
  const meta = CATEGORY_UI[categoryKey];
  const section = document.createElement('section');
  section.className = 'um-panel';
  section.dataset.settingCategory = categoryKey;
  section.hidden = categoryKey !== activeCategory;

  const title = document.createElement('h2');
  title.textContent = meta.title;
  section.append(title);

  if (meta.description) {
    const description = document.createElement('p');
    description.className = 'um-section-description';
    description.textContent = meta.description;
    section.append(description);
  }

  if (categoryKey === 'basic') {
    section.append(createBasicOverview());
  }

  for (const field of getCategoryFields({ key: categoryKey })) {
    section.append(createField(field));
  }

  return section;
}

function createBasicOverview() {
  const overview = document.createElement('div');
  overview.className = 'um-basic-overview';

  const statusGrid = document.createElement('div');
  statusGrid.className = 'um-status-grid';
  for (const card of BASIC_STATUS_CARDS) {
    const item = document.createElement('article');
    item.className = 'um-status-card';
    item.dataset.statusPaths = card.paths.join(',');
    item.innerHTML = `
      <span class="um-status-pill">OFF</span>
      <strong>${card.label}</strong>
      <small>${card.detail}</small>
    `;
    statusGrid.append(item);
  }

  const quick = document.createElement('div');
  quick.className = 'um-quick-presets';
  const heading = document.createElement('div');
  heading.className = 'um-quick-heading';
  heading.innerHTML = '<strong>クイック設定</strong><span>よく使う組み合わせをまとめて切り替えます。</span>';
  quick.append(heading);

  const list = document.createElement('div');
  list.className = 'um-preset-list';
  for (const preset of QUICK_PRESETS) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'um-preset-button';
    button.dataset.preset = preset.id;
    button.innerHTML = `<strong>${preset.title}</strong><span>${preset.description}</span>`;
    button.addEventListener('click', () => applyQuickPreset(preset));
    list.append(button);
  }
  quick.append(list);

  overview.append(statusGrid, quick);
  return overview;
}

function getLiveSettingsSnapshot() {
  if (!elements.root.querySelector('[data-setting-path]')) {
    return structuredClone(currentSettings);
  }
  return collectSettings();
}

function isPathEnabled(settings, path) {
  const value = getValueByPath(settings, path);
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') return Boolean(value.trim());
  if (typeof value === 'number') return value > 0;
  return Boolean(value);
}

function updateBasicOverview() {
  const overview = elements.root.querySelector('.um-basic-overview');
  if (!overview) return;
  const snapshot = getLiveSettingsSnapshot();

  for (const card of overview.querySelectorAll('.um-status-card')) {
    const paths = card.dataset.statusPaths.split(',');
    const activeCount = paths.filter((path) => isPathEnabled(snapshot, path)).length;
    const pill = card.querySelector('.um-status-pill');
    const state = activeCount === 0 ? 'off' : activeCount === paths.length ? 'on' : 'partial';
    card.dataset.state = state;
    pill.textContent = state === 'on' ? 'ON' : state === 'partial' ? '一部ON' : 'OFF';
  }
}

function applyQuickPreset(preset) {
  for (const [path, value] of Object.entries(preset.values)) {
    const controls = elements.root.querySelectorAll(`[data-setting-path="${CSS.escape(path)}"]`);
    for (const control of controls) {
      setControlValue(control, value);
    }
  }
  markUnsaved();
  updateBasicOverview();
  setStatus(`${preset.title} を反映しました。保存するとMOOCsページへ適用されます。`);
}

function mountSettingsNav() {
  const fragment = document.createDocumentFragment();
  fragment.append(createWindowControls());
  for (const [key, meta] of Object.entries(CATEGORY_UI)) {
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.category = key;
    button.dataset.accent = meta.accent;
    const icon = document.createElement('span');
    icon.className = 'um-nav-icon';
    icon.setAttribute('aria-hidden', 'true');
    icon.innerHTML = CATEGORY_ICON_SVG[meta.icon] || CATEGORY_ICON_SVG.settings;
    const label = document.createElement('span');
    label.className = 'um-nav-label';
    label.textContent = meta.title;
    button.append(icon, label);
    button.setAttribute('aria-current', String(key === activeCategory));
    button.addEventListener('click', () => selectCategory(key));
    fragment.append(button);
  }
  elements.settingsNav.replaceChildren(fragment);
}

function createWindowControls() {
  const controls = document.createElement('div');
  controls.className = 'um-window-controls';
  controls.setAttribute('aria-label', 'クイック操作');

  const closeButton = document.createElement('button');
  closeButton.type = 'button';
  closeButton.className = 'um-window-control um-window-close';
  closeButton.title = '設定ページを閉じる';
  closeButton.setAttribute('aria-label', '設定ページを閉じる');
  closeButton.addEventListener('click', () => {
    window.close();
    window.setTimeout(() => {
      setStatus('このタブはChrome側で閉じられませんでした。手動で閉じてください。');
    }, 120);
  });

  const backupButton = document.createElement('button');
  backupButton.type = 'button';
  backupButton.className = 'um-window-control um-window-minimize';
  backupButton.title = 'バックアップを開く';
  backupButton.setAttribute('aria-label', 'バックアップを開く');
  backupButton.addEventListener('click', () => {
    switchView('backup');
    setStatus('バックアップを開きました。');
  });

  const saveButton = document.createElement('button');
  saveButton.type = 'button';
  saveButton.className = 'um-window-control um-window-save';
  saveButton.title = '設定を保存';
  saveButton.setAttribute('aria-label', '設定を保存');
  saveButton.addEventListener('click', () => {
    saveSettings().catch((error) => {
      console.error('[ultimateMoocs:options]', error);
      setStatus(error.message, true);
    });
  });

  controls.append(closeButton, backupButton, saveButton);
  return controls;
}

function mountSettingsForm() {
  const fragment = document.createDocumentFragment();

  for (const categoryKey of Object.keys(CATEGORY_UI)) {
    fragment.append(createCategorySection(categoryKey));
  }

  elements.root.replaceChildren(fragment);
  mountSettingsNav();
}

function selectCategory(categoryKey) {
  activeCategory = categoryKey;
  for (const section of elements.root.querySelectorAll('[data-setting-category]')) {
    section.hidden = section.dataset.settingCategory !== categoryKey;
  }
  for (const button of elements.settingsNav.querySelectorAll('[data-category]')) {
    button.setAttribute('aria-current', String(button.dataset.category === categoryKey));
  }
}

function markUnsaved() {
  if (hasUnsavedChanges) return;
  hasUnsavedChanges = true;
  setStatus('未保存の変更があります。保存するとMOOCsページへ反映されます。');
}

function updateDirtyState() {
  elements.saveButton.classList.toggle('dirty', hasUnsavedChanges);
  elements.saveStatus.classList.toggle('dirty', hasUnsavedChanges && !elements.saveStatus.classList.contains('error'));
}

function setControlValue(control, value) {
  if (control.dataset.settingType === 'checkbox') {
    control.checked = Boolean(value);
    return;
  }

  control.value = value ?? '';
}

function getControlValue(control) {
  if (control.dataset.settingType === 'checkbox') {
    return control.checked;
  }

  if (control.dataset.settingType === 'range' || control.dataset.settingType === 'number') {
    return Number(control.value);
  }

  return control.value;
}

function render(settings) {
  currentSettings = settings;
  for (const control of elements.root.querySelectorAll('[data-setting-path]')) {
    setControlValue(control, getValueByPath(settings, control.dataset.settingPath));
  }
  updateBasicOverview();
  updateAssignmentOverviewControlState();
  elements.topTabs.forEach((button) => {
    if (button.dataset.view === 'memos') button.disabled = !settings.memo.enableMemoList;
  });
  const developerMode = Boolean(settings.debug.enableDebugLog);
  elements.diagnosticsTab.hidden = !developerMode;
  elements.diagnosticsTab.disabled = !developerMode;
  if (!developerMode && !elements.diagnosticsSection.hidden) {
    switchView('settings');
  }
  if (!settings.memo.enableMemoList && !elements.memoListSection.hidden) {
    switchView('settings');
  }
  elements.memoExport.disabled = !settings.memo.enableMemoExport;
  elements.memoImport.disabled = !settings.memo.enableMemoExport;
}

function collectSettings() {
  const nextSettings = structuredClone(currentSettings);
  for (const control of elements.root.querySelectorAll('[data-setting-path]')) {
    setValueByPath(nextSettings, control.dataset.settingPath, getControlValue(control));
  }
  return nextSettings;
}

async function requestSettings(type, payload = {}) {
  const response = await runtimeSendMessage(createMessage(type, payload));
  if (!response?.ok) {
    throw new Error(response?.error || '設定操作に失敗しました。');
  }
  return response.payload;
}

async function loadSettings() {
  setStatus('読み込み中...');
  const payload = await requestSettings(MESSAGE_TYPES.settingsGet);
  render(payload.settings);
  hasUnsavedChanges = false;
  updateDirtyState();
  setStatus('設定を読み込みました。');
}

async function saveSettings(settings = collectSettings(), successMessage = '保存しました。') {
  const validation = validateAndNormalizeSettings(settings);
  if (!validation.ok) {
    throw new Error(validation.errors.join('\n'));
  }

  setStatus('保存中...');
  const payload = await requestSettings(MESSAGE_TYPES.settingsSet, {
    settings: validation.settings,
  });
  render(payload.settings);
  hasUnsavedChanges = false;
  updateDirtyState();
  setStatus(successMessage);
}

async function resetSettings() {
  if (!window.confirm('MOOCs Ultimateの設定を初期化します。よろしいですか？')) {
    setStatus('初期化をキャンセルしました。');
    return;
  }
  setStatus('初期化中...');
  const payload = await requestSettings(MESSAGE_TYPES.settingsReset);
  render(payload.settings);
  hasUnsavedChanges = false;
  updateDirtyState();
  setStatus('初期設定に戻しました。');
}

function switchView(viewName) {
  const views = {
    settings: elements.settingsView,
    memos: elements.memoListSection,
    assignments: elements.assignmentListSection,
    'ai-summaries': elements.aiSummarySection,
    diagnostics: elements.diagnosticsSection,
    backup: elements.backupView,
  };
  for (const [key, view] of Object.entries(views)) {
    if (view) view.hidden = key !== viewName;
  }
  for (const button of elements.topTabs) {
    button.setAttribute('aria-selected', String(button.dataset.view === viewName));
  }
  if (viewName === 'diagnostics') {
    loadDiagnostics().catch((error) => {
      currentDiagnostics = null;
      elements.diagnosticsExport.disabled = true;
      elements.diagnosticsSummary.textContent = error.message;
      setStatus(error.message, true);
    });
  }
}

function renderDiagnostics(payload) {
  currentDiagnostics = payload;
  elements.diagnosticsResults.replaceChildren();
  elements.diagnosticsSummary.textContent = `${payload.manifest.name} ${payload.manifest.version} / Manifest V${payload.manifest.manifestVersion} / ${new Date(payload.generatedAt).toLocaleString()}`;
  for (const check of payload.checks || []) {
    const card = document.createElement('article');
    card.className = 'um-diagnostic-card';
    card.dataset.status = check.status;
    const title = document.createElement('strong');
    title.textContent = check.label;
    const detail = document.createElement('span');
    detail.textContent = check.detail;
    card.append(title, detail);
    elements.diagnosticsResults.append(card);
  }
  elements.diagnosticsExport.disabled = false;
}

async function loadDiagnostics() {
  if (!currentSettings.debug.enableDebugLog) {
    throw new Error('デベロッパーモードを保存してから診断を開いてください。');
  }
  elements.diagnosticsRefresh.disabled = true;
  elements.diagnosticsSummary.textContent = '診断中...';
  try {
    const payload = await requestSettings(MESSAGE_TYPES.diagnosticsGet);
    renderDiagnostics(payload);
    setStatus('診断が完了しました。');
  } finally {
    elements.diagnosticsRefresh.disabled = false;
  }
}

function exportDiagnostics() {
  if (!currentDiagnostics) return;
  const blob = new Blob([`${JSON.stringify(currentDiagnostics, null, 2)}\n`], {
    type: 'application/json',
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `moocs-ultimate-diagnostics-${Date.now()}.json`;
  link.click();
  URL.revokeObjectURL(url);
  setStatus('診断JSONを書き出しました。');
}

function exportSettings() {
  const validation = validateAndNormalizeSettings(collectSettings());
  if (!validation.ok) {
    setStatus(validation.errors.join('\n'), true);
    return;
  }

  const exportedSettings = structuredClone(validation.settings);
  if (exportedSettings.ai?.apiKey) exportedSettings.ai.apiKey = '';

  const blob = new Blob([`${JSON.stringify(exportedSettings, null, 2)}\n`], {
    type: 'application/json',
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'moocs-ultimate-settings.json';
  link.click();
  URL.revokeObjectURL(url);
  setStatus('設定JSONを書き出しました。APIキーは安全のため含めていません。');
}

function normalizeImportedMemos(parsed) {
  const source = parsed?.memos && typeof parsed.memos === 'object' ? parsed.memos : parsed;
  if (!source || typeof source !== 'object' || Array.isArray(source)) {
    throw new Error('メモJSONはオブジェクトである必要があります。');
  }

  const normalized = {};
  for (const [url, record] of Object.entries(source)) {
    if (!record || typeof record !== 'object' || Array.isArray(record)) continue;
    const notes = Array.isArray(record.notes)
      ? record.notes
          .filter((note) => note && typeof note === 'object')
          .map((note) => ({
            id: typeof note.id === 'string' ? note.id : `memo-${Date.now()}-${Math.random()}`,
            body: typeof note.body === 'string' ? note.body : '',
            createdAt: typeof note.createdAt === 'string' ? note.createdAt : new Date().toISOString(),
            updatedAt: typeof note.updatedAt === 'string' ? note.updatedAt : new Date().toISOString(),
          }))
      : [];
    normalized[url] = {
      url: typeof record.url === 'string' ? record.url : url,
      title: typeof record.title === 'string' ? record.title : url,
      courseTitle: typeof record.courseTitle === 'string' ? record.courseTitle : '',
      lectureTitle: typeof record.lectureTitle === 'string' ? record.lectureTitle : '',
      updatedAt: typeof record.updatedAt === 'string' ? record.updatedAt : new Date().toISOString(),
      notes,
    };
  }

  return normalized;
}

function renderMemoList() {
  const query = elements.memoSearch.value.trim().toLowerCase();
  const records = Object.values(currentMemos)
    .filter((record) => {
      const haystack = [
        record.url,
        record.title,
        record.courseTitle,
        record.lectureTitle,
        ...(Array.isArray(record.notes) ? record.notes.map((note) => note.body) : []),
      ]
        .join('\n')
        .toLowerCase();
      return !query || haystack.includes(query);
    })
    .sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));

  elements.memoResults.replaceChildren();

  if (!records.length) {
    const empty = document.createElement('p');
    empty.textContent = 'メモはまだありません。';
    elements.memoResults.append(empty);
    return;
  }

  for (const record of records) {
    const card = document.createElement('article');
    card.className = 'um-memo-card';

    const title = document.createElement('h3');
    const link = document.createElement('a');
    link.href = record.url;
    link.target = '_blank';
    link.rel = 'noreferrer';
    link.textContent = record.title || record.url;
    title.append(link);

    const meta = document.createElement('p');
    meta.textContent = [record.courseTitle, record.lectureTitle, record.updatedAt]
      .filter(Boolean)
      .join(' / ');

    const list = document.createElement('ul');
    for (const note of record.notes || []) {
      const item = document.createElement('li');
      item.textContent = note.body || '(空のメモ)';
      list.append(item);
    }

    const actions = document.createElement('div');
    actions.className = 'um-actions';
    const downloadButton = document.createElement('button');
    downloadButton.type = 'button';
    downloadButton.textContent = 'TXT';
    downloadButton.addEventListener('click', () => {
      const body = (record.notes || []).map((note) => note.body).join('\n\n---\n\n');
      const blob = new Blob([body], { type: 'text/plain' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `${record.title || 'moocs-memo'}.txt`;
      anchor.click();
      URL.revokeObjectURL(url);
    });
    const deleteButton = document.createElement('button');
    deleteButton.type = 'button';
    deleteButton.textContent = '削除';
    deleteButton.addEventListener('click', async () => {
      const next = { ...currentMemos };
      delete next[record.url];
      currentMemos = await saveMemos(next);
      renderMemoList();
    });
    actions.append(downloadButton, deleteButton);

    card.append(title, meta, list, actions);
    elements.memoResults.append(card);
  }
}

const ASSIGNMENT_STATUS_LABELS = Object.freeze({
  unchecked: '未確認',
  submitted: '提出済み',
  pending_confirmation: '確認待ち',
  not_submitted: '未提出の可能性',
  unpublished: '課題未公開',
  unknown: '確認不能',
});

function normalizeAssignmentRecord(key, record) {
  const source = record && typeof record === 'object' && !Array.isArray(record) ? record : {};
  const status = ASSIGNMENT_STATUS_LABELS[source.status] ? source.status : 'unknown';
  const courseName = String(source.courseName || '').trim() || '科目不明';
  const lectureGroup = String(source.lectureGroup || '').trim() || '講義回不明';
  return {
    key,
    url: String(source.url || source.pageKey || key || ''),
    title: String(source.title || source.lectureName || source.url || key || '課題'),
    courseName,
    lectureGroup,
    lectureName: String(source.lectureName || ''),
    status,
    confidence: String(source.confidence || 'low'),
    evidence: String(source.evidence || ''),
    source: String(source.source || ''),
    checkedAt: String(source.checkedAt || ''),
    attemptedAt: String(source.attemptedAt || ''),
    deadlineDate: /^\d{4}-\d{2}-\d{2}$/.test(String(source.deadlineDate || '')) ? String(source.deadlineDate) : '',
    deadlineTime: /^\d{2}:\d{2}$/.test(String(source.deadlineTime || '')) ? String(source.deadlineTime) : '',
    deadlineSource: String(source.deadlineSource || ''),
    deadlineUpdatedAt: String(source.deadlineUpdatedAt || ''),
  };
}

function sortAssignmentRecords(records) {
  const mode = elements.assignmentSort?.value || 'deadline-asc';
  return records.sort((a, b) => {
    if (mode === 'deadline-asc' || mode === 'deadline-desc') {
      const aDeadline = getAssignmentDeadlineTimestamp(a);
      const bDeadline = getAssignmentDeadlineTimestamp(b);
      if (aDeadline !== bDeadline) {
        if (!Number.isFinite(aDeadline)) return 1;
        if (!Number.isFinite(bDeadline)) return -1;
        return mode === 'deadline-asc' ? aDeadline - bDeadline : bDeadline - aDeadline;
      }
    }
    if (mode === 'updated') {
      const checkedOrder = String(b.checkedAt || '').localeCompare(String(a.checkedAt || ''));
      if (checkedOrder) return checkedOrder;
    }
    const courseOrder = a.courseName.localeCompare(b.courseName, 'ja', { numeric: true });
    if (courseOrder) return courseOrder;
    const lectureOrder = a.lectureGroup.localeCompare(b.lectureGroup, 'ja', { numeric: true });
    if (lectureOrder) return lectureOrder;
    return String(b.checkedAt || '').localeCompare(String(a.checkedAt || ''));
  });
}

function getQueryFilteredAssignmentRecords() {
  const query = elements.assignmentSearch.value.trim().toLowerCase();
  const records = dedupeAssignmentRecords(
    Object.entries(currentAssignmentStatus).map(([key, record]) => normalizeAssignmentRecord(key, record)),
  )
    .filter((record) => {
      const haystack = [
        record.url,
        record.title,
        record.courseName,
        record.lectureGroup,
        record.lectureName,
        record.status,
        ASSIGNMENT_STATUS_LABELS[record.status],
        record.evidence,
        record.deadlineDate,
        record.deadlineTime,
      ]
        .join('\n')
        .toLowerCase();
      return !query || haystack.includes(query);
    });
  return sortAssignmentRecords(records);
}

function isAssignmentQuickFilterMatch(record) {
  if (activeAssignmentQuickFilter === 'action') {
    return ['not_submitted', 'pending_confirmation'].includes(record.status);
  }
  if (activeAssignmentQuickFilter === 'unknown') {
    return ['unchecked', 'unknown'].includes(record.status);
  }
  if (activeAssignmentQuickFilter === 'unpublished') {
    return record.status === 'unpublished';
  }
  if (activeAssignmentQuickFilter === 'done') {
    return record.status === 'submitted';
  }
  return true;
}

function getFilteredAssignmentRecords() {
  const filter = elements.assignmentFilter.value || 'all';
  return getQueryFilteredAssignmentRecords()
    .filter((record) => filter === 'all' || record.status === filter)
    .filter(isAssignmentQuickFilterMatch);
}

function getVisibleAssignmentRecords() {
  return getFilteredAssignmentRecords()
    .filter((record) => activeAssignmentCourse === 'all' || record.courseName === activeAssignmentCourse)
    .filter((record) => activeAssignmentLecture === 'all' || record.lectureGroup === activeAssignmentLecture);
}

function renderAssignmentQuickFilters(baseRecords) {
  elements.assignmentQuickFilters.replaceChildren();
  const counts = getAssignmentStatusCounts(baseRecords);
  const actionCount = (counts.not_submitted || 0) + (counts.pending_confirmation || 0);
  const unknownCount = (counts.unchecked || 0) + (counts.unknown || 0);
  const filters = [
    { key: 'all', label: 'すべて', count: baseRecords.length },
    { key: 'action', label: '要対応', count: actionCount, tone: 'danger' },
    { key: 'unknown', label: '未確認', count: unknownCount, tone: 'warning' },
    { key: 'unpublished', label: '未公開', count: counts.unpublished || 0, tone: 'muted' },
    { key: 'done', label: '完了', count: counts.submitted || 0, tone: 'complete' },
  ];
  for (const filter of filters) {
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.filter = filter.key;
    if (filter.tone) button.dataset.tone = filter.tone;
    button.setAttribute('aria-selected', activeAssignmentQuickFilter === filter.key ? 'true' : 'false');
    const text = document.createElement('span');
    text.textContent = filter.label;
    const badge = document.createElement('span');
    badge.className = 'um-assignment-tab-count';
    badge.textContent = String(filter.count);
    button.append(text, badge);
    button.addEventListener('click', () => {
      activeAssignmentQuickFilter = filter.key;
      elements.assignmentFilter.value = 'all';
      activeAssignmentCourse = 'all';
      activeAssignmentLecture = 'all';
      renderAssignmentStatusList();
    });
    elements.assignmentQuickFilters.append(button);
  }
}

function createAssignmentTabButton({ label, count, selected, onClick }) {
  const button = document.createElement('button');
  button.type = 'button';
  button.setAttribute('aria-selected', selected ? 'true' : 'false');
  const text = document.createElement('span');
  text.textContent = label;
  const badge = document.createElement('span');
  badge.className = 'um-assignment-tab-count';
  badge.textContent = String(count);
  button.append(text, badge);
  button.addEventListener('click', onClick);
  return button;
}

function getAssignmentGroupCounts(records, field) {
  const counts = new Map();
  for (const record of records) counts.set(record[field], (counts.get(record[field]) || 0) + 1);
  return Array.from(counts.entries()).sort(([a], [b]) => a.localeCompare(b, 'ja', { numeric: true }));
}

function renderAssignmentTabs(filteredRecords) {
  elements.assignmentCourseTabs.replaceChildren();
  elements.assignmentLectureTabs.replaceChildren();

  if (!filteredRecords.length) {
    elements.assignmentCourseTabs.hidden = true;
    elements.assignmentLectureTabs.hidden = true;
    activeAssignmentCourse = 'all';
    activeAssignmentLecture = 'all';
    return;
  }

  elements.assignmentCourseTabs.hidden = false;
  const courseNames = new Set(filteredRecords.map((record) => record.courseName));
  if (activeAssignmentCourse !== 'all' && !courseNames.has(activeAssignmentCourse)) {
    activeAssignmentCourse = 'all';
    activeAssignmentLecture = 'all';
  }

  elements.assignmentCourseTabs.append(
    createAssignmentTabButton({
      label: 'すべての科目',
      count: filteredRecords.length,
      selected: activeAssignmentCourse === 'all',
      onClick: () => {
        activeAssignmentCourse = 'all';
        activeAssignmentLecture = 'all';
        renderAssignmentStatusList();
      },
    }),
  );
  for (const [courseName, count] of getAssignmentGroupCounts(filteredRecords, 'courseName')) {
    elements.assignmentCourseTabs.append(
      createAssignmentTabButton({
        label: courseName,
        count,
        selected: activeAssignmentCourse === courseName,
        onClick: () => {
          activeAssignmentCourse = courseName;
          activeAssignmentLecture = 'all';
          renderAssignmentStatusList();
        },
      }),
    );
  }

  const courseRecords =
    activeAssignmentCourse === 'all'
      ? filteredRecords
      : filteredRecords.filter((record) => record.courseName === activeAssignmentCourse);
  if (activeAssignmentCourse === 'all') {
    elements.assignmentLectureTabs.hidden = true;
    activeAssignmentLecture = 'all';
    return;
  }
  const lectureNames = new Set(courseRecords.map((record) => record.lectureGroup));
  if (activeAssignmentLecture !== 'all' && !lectureNames.has(activeAssignmentLecture)) {
    activeAssignmentLecture = 'all';
  }

  elements.assignmentLectureTabs.hidden = courseRecords.length === 0;
  if (!courseRecords.length) return;
  elements.assignmentLectureTabs.append(
    createAssignmentTabButton({
      label: 'すべての回',
      count: courseRecords.length,
      selected: activeAssignmentLecture === 'all',
      onClick: () => {
        activeAssignmentLecture = 'all';
        renderAssignmentStatusList();
      },
    }),
  );
  for (const [lectureGroup, count] of getAssignmentGroupCounts(courseRecords, 'lectureGroup')) {
    elements.assignmentLectureTabs.append(
      createAssignmentTabButton({
        label: lectureGroup,
        count,
        selected: activeAssignmentLecture === lectureGroup,
        onClick: () => {
          activeAssignmentLecture = lectureGroup;
          renderAssignmentStatusList();
        },
      }),
    );
  }
}

function renderAssignmentSummary(records) {
  const all = dedupeAssignmentRecords(
    Object.entries(currentAssignmentStatus).map(([key, record]) => normalizeAssignmentRecord(key, record)),
  );
  const counts = all.reduce(
    (acc, record) => {
      acc[record.status] = (acc[record.status] || 0) + 1;
      return acc;
    },
    { unchecked: 0, submitted: 0, pending_confirmation: 0, not_submitted: 0, unpublished: 0, unknown: 0 },
  );
  const deadlineCount = all.filter((record) => record.deadlineDate).length;
  const overdueCount = all.filter((record) => (
    record.status !== 'submitted' && getAssignmentDeadlineState(record).tone === 'overdue'
  )).length;
  elements.assignmentSummary.textContent = [
    `表示 ${records.length}件`,
    `期限設定 ${deadlineCount}件`,
    `期限超過 ${overdueCount}件`,
    `未確認 ${counts.unchecked || 0}件`,
    `提出済み ${counts.submitted || 0}件`,
    `確認待ち ${counts.pending_confirmation || 0}件`,
    `未提出の可能性 ${counts.not_submitted || 0}件`,
    `課題未公開 ${counts.unpublished || 0}件`,
    `確認不能 ${counts.unknown || 0}件`,
  ].join(' / ');
}

function getAssignmentStatusCounts(records) {
  return records.reduce((acc, record) => {
    acc[record.status] = (acc[record.status] || 0) + 1;
    return acc;
  }, {});
}

function createAssignmentCountPills(records) {
  const counts = getAssignmentStatusCounts(records);
  const fragment = document.createDocumentFragment();
  for (const status of ['submitted', 'pending_confirmation', 'not_submitted', 'unpublished', 'unchecked', 'unknown']) {
    const count = counts[status] || 0;
    if (!count) continue;
    const pill = document.createElement('span');
    pill.className = 'um-assignment-pill';
    pill.dataset.status = status;
    pill.textContent = `${ASSIGNMENT_STATUS_LABELS[status]} ${count}`;
    fragment.append(pill);
  }
  return fragment;
}

function groupAssignmentRecords(records) {
  const courses = new Map();
  for (const record of records) {
    if (!courses.has(record.courseName)) courses.set(record.courseName, new Map());
    const lectures = courses.get(record.courseName);
    if (!lectures.has(record.lectureGroup)) lectures.set(record.lectureGroup, []);
    lectures.get(record.lectureGroup).push(record);
  }
  return [...courses.entries()].map(([courseName, lectures]) => ({
    courseName,
    records: [...lectures.values()].flat(),
    lectures: [...lectures.entries()].map(([lectureGroup, lectureRecords]) => ({
      lectureGroup,
      records: lectureRecords,
    })),
  }));
}

function getAssignmentGroupState(records) {
  const counts = getAssignmentStatusCounts(records);
  if (counts.not_submitted) {
    return {
      state: 'danger',
      label: `要対応 ${counts.not_submitted}`,
    };
  }
  if (counts.pending_confirmation) {
    return {
      state: 'warning',
      label: `確認待ち ${counts.pending_confirmation}`,
    };
  }
  if (counts.unchecked || counts.unknown) {
    return {
      state: 'unknown',
      label: `未確認 ${(counts.unchecked || 0) + (counts.unknown || 0)}`,
    };
  }
  if (counts.unpublished && !counts.submitted) {
    return {
      state: 'muted',
      label: `未公開 ${counts.unpublished}`,
    };
  }
  if (counts.submitted && counts.submitted === records.length) {
    return {
      state: 'complete',
      label: '完了',
    };
  }
  return {
    state: 'mixed',
    label: '混在',
  };
}

function getAssignmentTaskMeta(record) {
  const source = `${record.title}\n${record.lectureName}\n${record.url}`.toLowerCase();
  const labels = [];
  if (/quiz|小テスト|確認|理解度/.test(source)) {
    labels.push('Quiz');
  } else if (/report|レポート|課題|assignment|homework/.test(source)) {
    labels.push('Report');
  } else if (/解説|answer|solution/.test(source)) {
    labels.push('課題解説');
  }

  const pageMatch = /\/([^/?#]+)$/.exec(record.url || '');
  if (pageMatch?.[1]) {
    labels.push(`#${decodeURIComponent(pageMatch[1])}`);
  }

  return labels.slice(0, 2);
}

function updateAssignmentDeadlineRecords(record, values) {
  const nextStatus = { ...currentAssignmentStatus };
  let matched = false;
  for (const [key, rawRecord] of Object.entries(nextStatus)) {
    const normalized = normalizeAssignmentRecord(key, rawRecord);
    if (key !== record.key && normalized.url !== record.url) continue;
    nextStatus[key] = { ...rawRecord, ...values };
    matched = true;
  }
  if (!matched) nextStatus[record.key] = { ...(nextStatus[record.key] || {}), ...values };
  return nextStatus;
}

async function saveAssignmentDeadlineFromOptions(record, deadlineDate, deadlineTime = '') {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(deadlineDate)) {
    setStatus('提出期限の日付を選択してください。', true);
    return;
  }
  if (deadlineTime && !/^\d{2}:\d{2}$/.test(deadlineTime)) {
    setStatus('提出期限の時刻を確認してください。', true);
    return;
  }
  const nextStatus = updateAssignmentDeadlineRecords(record, {
    deadlineDate,
    deadlineTime,
    deadlineSource: 'manual',
    deadlineUpdatedAt: new Date().toISOString(),
  });
  currentAssignmentStatus = await saveAssignmentStatus(nextStatus);
  renderAssignmentStatusList();
  setStatus(`「${record.title}」の提出期限を保存しました。`);
}

async function clearAssignmentDeadlineFromOptions(record) {
  const nextStatus = updateAssignmentDeadlineRecords(record, {
    deadlineDate: '',
    deadlineTime: '',
    deadlineSource: '',
    deadlineUpdatedAt: new Date().toISOString(),
  });
  currentAssignmentStatus = await saveAssignmentStatus(nextStatus);
  renderAssignmentStatusList();
  setStatus(`「${record.title}」の提出期限を削除しました。`);
}

function createAssignmentDeadlineEditor(record) {
  const deadline = getAssignmentDeadlineState(record);
  const details = document.createElement('details');
  details.className = 'um-assignment-deadline-editor';
  details.dataset.tone = deadline.tone;
  const summary = document.createElement('summary');
  const heading = document.createElement('span');
  heading.textContent = '提出期限';
  const value = document.createElement('strong');
  value.textContent = deadline.label;
  summary.append(heading, value);
  details.append(summary);

  const fields = document.createElement('div');
  fields.className = 'um-assignment-deadline-fields';
  const dateLabel = document.createElement('label');
  dateLabel.textContent = '日付';
  const dateInput = document.createElement('input');
  dateInput.type = 'date';
  dateInput.value = record.deadlineDate;
  dateInput.setAttribute('aria-label', '提出期限の日付');
  const datePickerRow = document.createElement('span');
  datePickerRow.className = 'um-assignment-date-picker-row';
  const calendarTrigger = document.createElement('span');
  calendarTrigger.className = 'um-assignment-calendar-trigger';
  calendarTrigger.textContent = 'カレンダー';
  const pickerInput = document.createElement('input');
  pickerInput.type = 'date';
  pickerInput.value = dateInput.value;
  pickerInput.setAttribute('aria-label', 'カレンダーから提出期限を選択');
  pickerInput.addEventListener('change', () => {
    dateInput.value = pickerInput.value;
  });
  dateInput.addEventListener('change', () => {
    pickerInput.value = dateInput.value;
  });
  calendarTrigger.append(pickerInput);
  datePickerRow.append(dateInput, calendarTrigger);
  dateLabel.append(datePickerRow);
  const timeLabel = document.createElement('label');
  timeLabel.textContent = '時刻（任意）';
  const timeInput = document.createElement('input');
  timeInput.type = 'time';
  timeInput.value = record.deadlineTime || '23:59';
  timeLabel.append(timeInput);
  const buttons = document.createElement('div');
  buttons.className = 'um-assignment-deadline-buttons';
  const saveButton = document.createElement('button');
  saveButton.type = 'button';
  saveButton.textContent = '保存';
  saveButton.addEventListener('click', () => {
    saveAssignmentDeadlineFromOptions(record, dateInput.value, timeInput.value).catch((error) => {
      console.error('[ultimateMoocs:options]', error);
      setStatus(error.message, true);
    });
  });
  const clearButton = document.createElement('button');
  clearButton.type = 'button';
  clearButton.textContent = '期限を削除';
  clearButton.disabled = !record.deadlineDate;
  clearButton.addEventListener('click', () => {
    clearAssignmentDeadlineFromOptions(record).catch((error) => {
      console.error('[ultimateMoocs:options]', error);
      setStatus(error.message, true);
    });
  });
  buttons.append(saveButton, clearButton);
  fields.append(dateLabel, timeLabel, buttons);
  details.append(fields);
  return details;
}

function renderAssignmentRecordCard(record) {
  const card = document.createElement('article');
  card.className = 'um-memo-card um-assignment-card';
  card.dataset.status = record.status;

  const header = document.createElement('div');
  header.className = 'um-assignment-card-header';

  const heading = document.createElement('div');
  heading.className = 'um-assignment-heading';

  const metaRow = document.createElement('div');
  metaRow.className = 'um-assignment-task-meta';
  for (const label of getAssignmentTaskMeta(record)) {
    const meta = document.createElement('span');
    meta.textContent = label;
    metaRow.append(meta);
  }

  const title = document.createElement('h3');
  title.textContent = record.title;

  const chips = document.createElement('div');
  chips.className = 'um-assignment-status-row';
  const statusChip = document.createElement('span');
  statusChip.className = 'um-assignment-pill';
  statusChip.dataset.status = record.status;
  statusChip.textContent = ASSIGNMENT_STATUS_LABELS[record.status] || record.status;
  chips.append(statusChip);
  const deadline = getAssignmentDeadlineState(record);
  const deadlineChip = document.createElement('span');
  deadlineChip.className = 'um-assignment-pill um-assignment-deadline-pill';
  deadlineChip.dataset.tone = deadline.tone;
  deadlineChip.textContent = deadline.label;
  chips.append(deadlineChip);
  for (const label of [record.confidence, formatDateTime(record.checkedAt)].filter(Boolean)) {
    const chip = document.createElement('span');
    chip.className = 'um-assignment-pill';
    chip.textContent = label;
    chips.append(chip);
  }
  if (metaRow.childElementCount) heading.append(metaRow);
  heading.append(title, chips);

  const actions = document.createElement('div');
  actions.className = 'um-actions';
  if (record.url) {
    const openButton = document.createElement('a');
    openButton.className = 'um-link-button';
    openButton.href = record.url;
    openButton.target = '_blank';
    openButton.rel = 'noreferrer';
    openButton.textContent = '元ページ';
    actions.append(openButton);
  }
  const statusControl = document.createElement('label');
  statusControl.className = 'um-assignment-status-control';
  const statusLabel = document.createElement('span');
  statusLabel.textContent = '状態変更';
  const statusSelect = document.createElement('select');
  statusSelect.setAttribute('aria-label', '課題提出状態を手動補正');
  for (const [status, label] of Object.entries(ASSIGNMENT_STATUS_LABELS)) {
    const option = document.createElement('option');
    option.value = status;
    option.textContent = label;
    statusSelect.append(option);
  }
  statusSelect.value = record.status;
  statusSelect.addEventListener('change', () => {
    updateAssignmentStatusRecordManually(record, statusSelect.value).catch((error) => {
      console.error('[ultimateMoocs:options]', error);
      setStatus(error.message, true);
    });
  });
  statusControl.append(statusLabel, statusSelect);
  actions.append(statusControl);
  const deleteButton = document.createElement('button');
  deleteButton.type = 'button';
  deleteButton.textContent = '削除';
  deleteButton.addEventListener('click', () => {
    deleteAssignmentStatusRecord(record);
  });
  actions.append(deleteButton);

  header.append(heading, actions);

  const evidence = document.createElement('p');
  evidence.className = 'um-assignment-evidence';
  evidence.textContent = record.evidence ? `根拠: ${record.evidence}` : '根拠テキストは保存されていません。';

  const footer = document.createElement('p');
  footer.textContent = [record.lectureName, record.source ? `source: ${record.source}` : '', record.url]
    .filter(Boolean)
    .join(' / ');

  card.append(header, createAssignmentDeadlineEditor(record), evidence, footer);
  return card;
}

function renderAssignmentGroupedTree(records) {
  for (const courseGroup of groupAssignmentRecords(records)) {
    const courseSection = document.createElement('section');
    courseSection.className = 'um-assignment-course-folder';

    const courseHeader = document.createElement('div');
    courseHeader.className = 'um-assignment-folder-header';
    const courseTitle = document.createElement('h3');
    courseTitle.textContent = courseGroup.courseName;
    const courseCounts = document.createElement('div');
    courseCounts.className = 'um-assignment-status-row';
    courseCounts.append(createAssignmentCountPills(courseGroup.records));
    courseHeader.append(courseTitle, courseCounts);
    courseSection.append(courseHeader);

    for (const lectureGroup of courseGroup.lectures) {
      const lectureState = getAssignmentGroupState(lectureGroup.records);
      const lectureDetails = document.createElement('details');
      lectureDetails.className = 'um-assignment-lecture-folder';
      lectureDetails.dataset.state = lectureState.state;
      lectureDetails.open = true;

      const summary = document.createElement('summary');
      const lectureTitle = document.createElement('span');
      lectureTitle.className = 'um-assignment-lecture-title';
      lectureTitle.textContent = lectureGroup.lectureGroup;
      const lectureStateBadge = document.createElement('span');
      lectureStateBadge.className = 'um-assignment-folder-state';
      lectureStateBadge.dataset.state = lectureState.state;
      lectureStateBadge.textContent = lectureState.label;
      const lectureCounts = document.createElement('span');
      lectureCounts.className = 'um-assignment-status-row';
      lectureCounts.append(createAssignmentCountPills(lectureGroup.records));
      summary.append(lectureTitle, lectureStateBadge, lectureCounts);
      lectureDetails.append(summary);

      const taskList = document.createElement('div');
      taskList.className = 'um-assignment-task-list';
      for (const record of lectureGroup.records) {
        taskList.append(renderAssignmentRecordCard(record));
      }
      lectureDetails.append(taskList);
      courseSection.append(lectureDetails);
    }

    elements.assignmentResults.append(courseSection);
  }
}

function renderAssignmentStatusList() {
  const baseRecords = getQueryFilteredAssignmentRecords();
  renderAssignmentQuickFilters(baseRecords);
  const filteredRecords = getFilteredAssignmentRecords();
  renderAssignmentTabs(filteredRecords);
  const records = getVisibleAssignmentRecords();
  elements.assignmentResults.replaceChildren();
  renderAssignmentSummary(records);

  if (!records.length) {
    const empty = document.createElement('p');
    empty.textContent = filteredRecords.length
      ? '選択中の科目・講義回に表示できる課題提出状態の記録はありません。'
      : '課題提出状態の記録はまだありません。MOOCsの課題ページを開くと記録されます。';
    elements.assignmentResults.append(empty);
    return;
  }

  renderAssignmentGroupedTree(records);
}

async function loadAssignmentStatusList() {
  currentAssignmentStatus = await getAssignmentStatus();
  renderAssignmentStatusList();
}

async function deleteAssignmentStatusRecord(record) {
  if (!window.confirm(`「${record.title}」の提出状態記録を削除しますか？`)) return;
  const nextStatus = { ...currentAssignmentStatus };
  delete nextStatus[record.key];
  currentAssignmentStatus = await saveAssignmentStatus(nextStatus);
  renderAssignmentStatusList();
  setStatus('課題提出状態の記録を削除しました。');
}

async function updateAssignmentStatusRecordManually(record, status) {
  const label = ASSIGNMENT_STATUS_LABELS[status];
  if (!label) return;
  const nextStatus = { ...currentAssignmentStatus };
  const previous = nextStatus[record.key] && typeof nextStatus[record.key] === 'object' ? nextStatus[record.key] : {};
  nextStatus[record.key] = {
    ...previous,
    url: record.url,
    pageKey: previous.pageKey || record.key,
    title: record.title,
    courseName: record.courseName,
    lectureGroup: record.lectureGroup,
    lectureName: record.lectureName,
    status,
    confidence: 'manual',
    evidence: `ユーザーが設定ページで手動で「${label}」に設定しました。`,
    source: 'manual',
    checkedAt: new Date().toISOString(),
  };
  currentAssignmentStatus = await saveAssignmentStatus(nextStatus);
  renderAssignmentStatusList();
  setStatus(`課題提出状態を「${label}」に変更しました。`);
}

async function clearVisibleAssignmentStatusRecords() {
  const records = getVisibleAssignmentRecords();
  if (!records.length) {
    setStatus('削除できる課題提出状態の記録はありません。');
    return;
  }
  const message =
    records.length === Object.keys(currentAssignmentStatus).length
      ? `課題提出状態の記録をすべて削除しますか？（${records.length}件）`
      : `現在表示中の課題提出状態の記録を削除しますか？（${records.length}件）`;
  if (!window.confirm(message)) return;
  const nextStatus = { ...currentAssignmentStatus };
  for (const record of records) delete nextStatus[record.key];
  currentAssignmentStatus = await saveAssignmentStatus(nextStatus);
  renderAssignmentStatusList();
  setStatus(`課題提出状態の記録を${records.length}件削除しました。`);
}

function exportAssignmentStatus() {
  const blob = new Blob(
    [
      `${JSON.stringify(
        { version: 1, exportedAt: new Date().toISOString(), assignmentStatus: currentAssignmentStatus },
        null,
        2,
      )}\n`,
    ],
    { type: 'application/json' },
  );
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'moocs-ultimate-assignment-status.json';
  link.click();
  URL.revokeObjectURL(url);
  setStatus('課題提出状態JSONを書き出しました。');
}

async function loadMemoList() {
  currentMemos = await getMemos();
  renderMemoList();
}

const AI_SUMMARY_MODE_LABELS = Object.freeze({
  brief: '短め',
  standard: '復習ノート',
  detailed: '詳しめ',
});

function formatDateTime(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

function stripMarkdownInline(value) {
  return String(value || '')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^\s*[-*]\s+/gm, '')
    .replace(/^\s*\d+\.\s+/gm, '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .trim();
}

function extractThreeLineSummary(summary) {
  const lines = String(summary || '').replace(/\r\n?/g, '\n').split('\n');
  const headingIndex = lines.findIndex((line) => /^##\s*3行まとめ\s*$/i.test(line.trim()));
  const source =
    headingIndex >= 0
      ? lines.slice(headingIndex + 1).filter((line) => !/^#{1,6}\s+/.test(line.trim()))
      : lines.filter((line) => line.trim() && !/^#{1,6}\s+/.test(line.trim()));

  return source
    .map(stripMarkdownInline)
    .filter(Boolean)
    .slice(0, 3);
}

function splitAiSummaryTitle(title, sourceUrl) {
  const parts = String(title || '')
    .split('/')
    .map((part) => part.trim())
    .filter(Boolean);
  return {
    course: parts[0] || 'MOOCs',
    lecture: parts[1] || '',
    page: parts.slice(2).join(' / ') || parts[1] || sourceUrl || 'AI要約',
  };
}

function sanitizeDownloadName(value, fallback = 'moocs-ai-summary') {
  return String(value || fallback)
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 140) || fallback;
}

function getAiSummaryItems() {
  const query = elements.aiSummarySearch.value.trim().toLowerCase();
  return Object.entries(currentAiSummaries)
    .filter(([, item]) => item && typeof item === 'object' && typeof item.summary === 'string')
    .map(([cacheKey, item]) => ({
      cacheKey,
      title: String(item.title || item.sourceUrl || 'AI要約'),
      sourceUrl: String(item.sourceUrl || ''),
      model: String(item.model || ''),
      summaryMode: String(item.summaryMode || ''),
      summary: String(item.summary || ''),
      summaryLines: extractThreeLineSummary(item.summary),
      estimatedInputTokens: Number(item.estimatedInputTokens || 0),
      estimatedOutputTokens: Number(item.estimatedOutputTokens || 0),
      createdAt: String(item.createdAt || item.updatedAt || ''),
      updatedAt: String(item.updatedAt || item.createdAt || ''),
    }))
    .filter((item) => {
      const haystack = [item.title, item.sourceUrl, item.model, item.summaryMode, item.summary].join('\n').toLowerCase();
      return !query || haystack.includes(query);
    })
    .sort((a, b) => String(b.updatedAt || b.createdAt).localeCompare(String(a.updatedAt || a.createdAt)));
}

function renderAiSummaryUsage() {
  elements.aiSummaryUsage.textContent =
    '保存済みのAI要約を確認できます。token数は要約を送信するときだけ表示します。';
}

function renderAiSummaryList() {
  const items = getAiSummaryItems();
  elements.aiSummaryResults.replaceChildren();
  renderAiSummaryUsage();

  if (!items.length) {
    const empty = document.createElement('p');
    empty.textContent = '保存済みのAI要約はまだありません。';
    elements.aiSummaryResults.append(empty);
    return;
  }

  for (const item of items) {
    const titleParts = splitAiSummaryTitle(item.title, item.sourceUrl);
    const updatedAt = formatDateTime(item.updatedAt || item.createdAt);
    const modeLabel = AI_SUMMARY_MODE_LABELS[item.summaryMode] || item.summaryMode || '要約';
    const card = document.createElement('article');
    card.className = 'um-memo-card um-ai-summary-card';

    const header = document.createElement('div');
    header.className = 'um-ai-summary-card-header';

    const heading = document.createElement('div');
    heading.className = 'um-ai-summary-heading';

    const course = document.createElement('span');
    course.className = 'um-ai-summary-course';
    course.textContent = titleParts.course;

    const title = document.createElement('h3');
    title.textContent = titleParts.page;

    const chips = document.createElement('div');
    chips.className = 'um-ai-summary-chips';
    for (const label of [titleParts.lecture, modeLabel, updatedAt].filter(Boolean)) {
      const chip = document.createElement('span');
      chip.textContent = label;
      chips.append(chip);
    }
    heading.append(course, title, chips);

    const actions = document.createElement('div');
    actions.className = 'um-actions';

    if (item.sourceUrl) {
      const openButton = document.createElement('a');
      openButton.className = 'um-link-button';
      openButton.href = item.sourceUrl;
      openButton.target = '_blank';
      openButton.rel = 'noreferrer';
      openButton.textContent = '元ページ';
      actions.append(openButton);
    }

    const downloadButton = document.createElement('button');
    downloadButton.type = 'button';
    downloadButton.textContent = 'TXT';
    downloadButton.addEventListener('click', () => {
      const blob = new Blob([`${item.summary}\n`], { type: 'text/plain' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `${sanitizeDownloadName(item.title)}.txt`;
      anchor.click();
      URL.revokeObjectURL(url);
    });

    const deleteButton = document.createElement('button');
    deleteButton.type = 'button';
    deleteButton.textContent = '削除';
    deleteButton.addEventListener('click', async () => {
      if (!window.confirm('このAI要約を削除しますか？')) return;
      const next = { ...currentAiSummaries };
      delete next[item.cacheKey];
      currentAiSummaries = await saveAiSummaries(next);
      renderAiSummaryList();
      setStatus('AI要約を削除しました。');
    });

    actions.append(downloadButton, deleteButton);
    header.append(heading, actions);

    const summaryBox = document.createElement('div');
    summaryBox.className = 'um-ai-summary-lines';
    const summaryLines = item.summaryLines.length ? item.summaryLines : [stripMarkdownInline(item.summary).slice(0, 180)];
    for (const line of summaryLines) {
      const paragraph = document.createElement('p');
      paragraph.textContent = line;
      summaryBox.append(paragraph);
    }

    const details = document.createElement('details');
    details.className = 'um-ai-summary-details';
    const detailsSummary = document.createElement('summary');
    detailsSummary.textContent = '全文を表示';
    const preview = document.createElement('pre');
    preview.className = 'um-ai-summary-preview';
    preview.textContent = item.summary;
    details.append(detailsSummary, preview);

    const footer = document.createElement('div');
    footer.className = 'um-ai-summary-card-footer';
    const meta = document.createElement('p');
    meta.textContent = [
      item.model,
      `${(item.estimatedInputTokens + item.estimatedOutputTokens).toLocaleString()} tokens`,
      item.sourceUrl,
    ]
      .filter(Boolean)
      .join(' / ');
    footer.append(meta);

    card.append(header, summaryBox, details, footer);
    elements.aiSummaryResults.append(card);
  }
}

async function loadAiSummaries() {
  currentAiSummaries = await getAiSummaries();
  renderAiSummaryList();
}

function exportMemos() {
  const blob = new Blob(
    [`${JSON.stringify({ version: 1, exportedAt: new Date().toISOString(), memos: currentMemos }, null, 2)}\n`],
    { type: 'application/json' },
  );
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'moocs-ultimate-memos.json';
  link.click();
  URL.revokeObjectURL(url);
  setStatus('メモJSONを書き出しました。');
}

async function importMemos(file) {
  if (!file) return;
  try {
    const parsed = JSON.parse(await file.text());
    const imported = normalizeImportedMemos(parsed);
    currentMemos = await saveMemos({ ...currentMemos, ...imported });
    renderMemoList();
    setStatus('メモJSONをインポートしました。');
  } catch (error) {
    console.warn('[ultimateMoocs:options] memo import failed', error);
    setStatus(error.message || 'メモJSONを読み込めませんでした。', true);
  } finally {
    elements.memoImport.value = '';
  }
}

async function importSettings(file) {
  if (!file) return;

  try {
    const text = await file.text();
    const parsed = JSON.parse(text);
    const validation = validateAndNormalizeSettings(parsed);
    if (!validation.ok) {
      setStatus(validation.errors.join('\n'), true);
      return;
    }

    await saveSettings(validation.settings, '設定JSONをインポートしました。');
  } catch (error) {
    console.warn('[ultimateMoocs:options] import failed', error);
    setStatus('設定JSONを読み込めませんでした。JSONの形式を確認してください。', true);
  } finally {
    elements.importInput.value = '';
  }
}

function bindEvents() {
  for (const button of elements.topTabs) {
    button.addEventListener('click', () => {
      if (!button.disabled) switchView(button.dataset.view);
    });
  }

  elements.saveButton.addEventListener('click', () => {
    saveSettings().catch((error) => {
      console.error('[ultimateMoocs:options]', error);
      setStatus(error.message, true);
    });
  });

  elements.resetButton.addEventListener('click', () => {
    resetSettings().catch((error) => {
      console.error('[ultimateMoocs:options]', error);
      setStatus(error.message, true);
    });
  });

  elements.exportButton.addEventListener('click', exportSettings);

  elements.importInput.addEventListener('change', () => {
    importSettings(elements.importInput.files?.[0]).catch((error) => {
      console.error('[ultimateMoocs:options]', error);
      setStatus(error.message, true);
    });
  });

  elements.memoSearch.addEventListener('input', renderMemoList);
  elements.memoExport.addEventListener('click', exportMemos);
  elements.memoImport.addEventListener('change', () => {
    importMemos(elements.memoImport.files?.[0]);
  });
  elements.assignmentSearch.addEventListener('input', () => {
    activeAssignmentQuickFilter = 'all';
    activeAssignmentCourse = 'all';
    activeAssignmentLecture = 'all';
    renderAssignmentStatusList();
  });
  elements.assignmentFilter.addEventListener('change', () => {
    activeAssignmentQuickFilter = 'all';
    activeAssignmentCourse = 'all';
    activeAssignmentLecture = 'all';
    renderAssignmentStatusList();
  });
  elements.assignmentSort.addEventListener('change', renderAssignmentStatusList);
  elements.assignmentRefresh.addEventListener('click', () => {
    loadAssignmentStatusList()
      .then(() => setStatus('課題提出状態一覧を更新しました。'))
      .catch((error) => {
        console.error('[ultimateMoocs:options]', error);
        setStatus(error.message, true);
      });
  });
  elements.assignmentExport.addEventListener('click', exportAssignmentStatus);
  elements.assignmentClearFiltered.addEventListener('click', () => {
    clearVisibleAssignmentStatusRecords().catch((error) => {
      console.error('[ultimateMoocs:options]', error);
      setStatus(error.message, true);
    });
  });
  elements.aiSummarySearch.addEventListener('input', renderAiSummaryList);
  elements.aiSummaryRefresh.addEventListener('click', () => {
    loadAiSummaries()
      .then(() => setStatus('AI要約一覧を更新しました。'))
      .catch((error) => {
        console.error('[ultimateMoocs:options]', error);
        setStatus(error.message, true);
      });
  });
  elements.diagnosticsRefresh.addEventListener('click', () => {
    loadDiagnostics().catch((error) => {
      currentDiagnostics = null;
      elements.diagnosticsExport.disabled = true;
      elements.diagnosticsSummary.textContent = error.message;
      setStatus(error.message, true);
    });
  });
  elements.diagnosticsExport.addEventListener('click', exportDiagnostics);
  storageAddChangeListener((changes, areaName) => {
    if (areaName === 'local' && changes[STORAGE_KEYS.memos]) {
      loadMemoList().catch((error) => {
        console.warn('[ultimateMoocs:options] memo refresh failed', error);
      });
    }
    if (areaName === 'local' && changes[STORAGE_KEYS.assignmentStatus]) {
      loadAssignmentStatusList().catch((error) => {
        console.warn('[ultimateMoocs:options] assignment status refresh failed', error);
      });
    }
    if (areaName === 'local' && changes[STORAGE_KEYS.aiSummaries]) {
      loadAiSummaries().catch((error) => {
        console.warn('[ultimateMoocs:options] AI summary refresh failed', error);
      });
    }
  });

  window.addEventListener('beforeunload', (event) => {
    if (!hasUnsavedChanges) return;
    event.preventDefault();
    event.returnValue = '';
  });
}

mountSettingsForm();
bindEvents();
loadSettings().catch((error) => {
  console.error('[ultimateMoocs:options]', error);
  setStatus(error.message, true);
});
loadMemoList().catch((error) => {
  console.error('[ultimateMoocs:options]', error);
  setStatus(error.message, true);
});
loadAssignmentStatusList().catch((error) => {
  console.error('[ultimateMoocs:options]', error);
  setStatus(error.message, true);
});
loadAiSummaries().catch((error) => {
  console.error('[ultimateMoocs:options]', error);
  setStatus(error.message, true);
});
