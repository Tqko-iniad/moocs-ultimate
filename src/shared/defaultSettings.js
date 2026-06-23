export const DEFAULT_SETTINGS = Object.freeze({
  version: 1,
  appearance: {
    enableGlassmorphism: true,
    backgroundImageUrl: '',
    backgroundColor: '#f8fafc',
    contentOpacity: 0.92,
    stickyHeader: false,
    stickySidebar: false,
    showScrollTopButton: true,
  },
  inputHelper: {
    enableTextareaCounter: true,
    enableTextareaAutoResize: true,
    reloadAfterSubmit: false,
  },
  navigation: {
    enableTabColoring: true,
    tabColorMode: 'badge',
    shortcutPrevious: 'Mod+ArrowLeft',
    shortcutNext: 'Mod+ArrowRight',
    colors: {
      attendanceTest: '#38bdf8',
      attendanceAssignment: '#22c55e',
      assignment: '#f59e0b',
      check: '#a855f7',
      slide: '#ef4444',
    },
  },
  downloads: {
    enableDownloadPanel: true,
    enableCurrentPageDownload: true,
    enableLectureDownload: true,
    enableCourseDownload: false,
    enableGoogleSlidesPdf: true,
    enableGoogleSlidesPng: false,
    enableDirectFileDownload: true,
    enableScreenshotShortcut: true,
    screenshotShortcutAction: 'download',
    downloadFolderPattern: 'MOOCs Ultimate/{course}/{lecture}',
  },
  memo: {
    enablePageMemo: false,
    enableMemoList: true,
    enableMemoExport: true,
  },
  course: {
    enableCourseSort: false,
    enableCourseFavorite: false,
    enableCourseHide: false,
  },
  assignments: {
    enableSubmissionCheck: true,
    enableAssignmentOverview: true,
    hideCompletedAssignmentLectures: true,
    assignmentOverviewWarningDays: 7,
    assignmentOverviewLimit: 10,
  },
  iniadPlus: {
    enableAceTimetableDownload: false,
    enableExternalLinksPanel: true,
    enableDriveButton: true,
    enableSlideResizeTools: false,
  },
  ai: {
    enableAiSummary: false,
    provider: 'iniad-ai-mop',
    apiBaseUrl: 'https://api.openai.iniad.org/api/v1',
    apiKey: '',
    model: 'gpt-5.4-mini',
    dailyTokenBudget: 480000,
    summaryMode: 'standard',
    sendImages: false,
    confirmBeforeSend: true,
    maxInputChars: 24000,
    maxOutputTokens: 2400,
  },
  debug: {
    enableDebugLog: false,
    showInternalStatus: true,
  },
});

export const SETTING_DEFINITIONS = Object.freeze([
  {
    key: 'appearance',
    title: 'Appearance',
    fields: [
      { path: 'appearance.enableGlassmorphism', label: 'Glassmorphism', type: 'checkbox' },
      { path: 'appearance.backgroundImageUrl', label: 'Background image URL', type: 'text' },
      { path: 'appearance.backgroundColor', label: 'Background color', type: 'color' },
      {
        path: 'appearance.contentOpacity',
        label: 'Content opacity',
        type: 'range',
        min: 0.4,
        max: 1,
        step: 0.01,
      },
      { path: 'appearance.stickyHeader', label: 'Sticky header', type: 'checkbox' },
      { path: 'appearance.stickySidebar', label: 'Sticky sidebar', type: 'checkbox' },
      { path: 'appearance.showScrollTopButton', label: 'Scroll top button', type: 'checkbox' },
    ],
  },
  {
    key: 'inputHelper',
    title: 'Input Helper',
    fields: [
      { path: 'inputHelper.enableTextareaCounter', label: 'Textarea counter', type: 'checkbox' },
      { path: 'inputHelper.enableTextareaAutoResize', label: 'Textarea auto resize', type: 'checkbox' },
      { path: 'inputHelper.reloadAfterSubmit', label: 'Reload after submit', type: 'checkbox' },
    ],
  },
  {
    key: 'navigation',
    title: 'Navigation',
    fields: [
      { path: 'navigation.enableTabColoring', label: 'Tab coloring', type: 'checkbox' },
      {
        path: 'navigation.tabColorMode',
        label: 'Tab color mode',
        type: 'select',
        options: ['full', 'badge', 'icon'],
      },
      { path: 'navigation.shortcutPrevious', label: 'Shortcut previous', type: 'text' },
      { path: 'navigation.shortcutNext', label: 'Shortcut next', type: 'text' },
      { path: 'navigation.colors.attendanceTest', label: 'Attendance test', type: 'color' },
      {
        path: 'navigation.colors.attendanceAssignment',
        label: 'Attendance assignment',
        type: 'color',
      },
      { path: 'navigation.colors.assignment', label: 'Assignment', type: 'color' },
      { path: 'navigation.colors.check', label: 'Check', type: 'color' },
      { path: 'navigation.colors.slide', label: 'Slide', type: 'color' },
    ],
  },
  {
    key: 'downloads',
    title: 'Downloads',
    fields: [
      { path: 'downloads.enableDownloadPanel', label: 'Download panel', type: 'checkbox' },
      {
        path: 'downloads.enableCurrentPageDownload',
        label: 'Current page download',
        type: 'checkbox',
      },
      { path: 'downloads.enableLectureDownload', label: 'Lecture download', type: 'checkbox' },
      { path: 'downloads.enableCourseDownload', label: 'Course download', type: 'checkbox' },
      { path: 'downloads.enableGoogleSlidesPdf', label: 'Google Slides PDF', type: 'checkbox' },
      { path: 'downloads.enableGoogleSlidesPng', label: 'Google Slides PNG', type: 'checkbox' },
      { path: 'downloads.enableDirectFileDownload', label: 'Direct file download', type: 'checkbox' },
      { path: 'downloads.enableScreenshotShortcut', label: 'Screenshot shortcut', type: 'checkbox' },
      {
        path: 'downloads.screenshotShortcutAction',
        label: 'Screenshot action',
        type: 'select',
        options: ['download', 'clipboard'],
      },
      { path: 'downloads.downloadFolderPattern', label: 'Download folder pattern', type: 'text' },
    ],
  },
  {
    key: 'memo',
    title: 'Memo',
    fields: [
      { path: 'memo.enablePageMemo', label: 'Page memo', type: 'checkbox' },
      { path: 'memo.enableMemoList', label: 'Memo list', type: 'checkbox' },
      { path: 'memo.enableMemoExport', label: 'Memo export', type: 'checkbox' },
    ],
  },
  {
    key: 'course',
    title: 'Course',
    fields: [
      { path: 'course.enableCourseSort', label: 'Course sort', type: 'checkbox' },
      { path: 'course.enableCourseFavorite', label: 'Course favorite', type: 'checkbox' },
      { path: 'course.enableCourseHide', label: 'Course hide', type: 'checkbox' },
    ],
  },
  {
    key: 'assignments',
    title: 'Assignments',
    fields: [
      {
        path: 'assignments.enableSubmissionCheck',
        label: 'Submission check',
        type: 'checkbox',
      },
      {
        path: 'assignments.enableAssignmentOverview',
        label: 'Assignment overview',
        type: 'checkbox',
      },
      {
        path: 'assignments.hideCompletedAssignmentLectures',
        label: 'Hide completed assignment lectures',
        type: 'checkbox',
      },
      {
        path: 'assignments.assignmentOverviewWarningDays',
        label: 'Assignment overview warning days',
        type: 'number',
        min: 1,
        max: 30,
        step: 1,
      },
      {
        path: 'assignments.assignmentOverviewLimit',
        label: 'Assignment overview limit',
        type: 'number',
        min: 3,
        max: 30,
        step: 1,
      },
    ],
  },
  {
    key: 'iniadPlus',
    title: 'INIAD Plus',
    fields: [
      {
        path: 'iniadPlus.enableAceTimetableDownload',
        label: 'ACE timetable download',
        type: 'checkbox',
      },
      {
        path: 'iniadPlus.enableExternalLinksPanel',
        label: 'External links panel',
        type: 'checkbox',
      },
      { path: 'iniadPlus.enableDriveButton', label: 'Drive button', type: 'checkbox' },
      {
        path: 'iniadPlus.enableSlideResizeTools',
        label: 'Slide resize tools',
        type: 'checkbox',
      },
    ],
  },
  {
    key: 'ai',
    title: 'AI Summary',
    fields: [
      { path: 'ai.enableAiSummary', label: 'AI summary', type: 'checkbox' },
      {
        path: 'ai.provider',
        label: 'AI provider',
        type: 'select',
        options: ['iniad-ai-mop'],
      },
      { path: 'ai.apiBaseUrl', label: 'API base URL', type: 'text' },
      { path: 'ai.apiKey', label: 'API key', type: 'password' },
      {
        path: 'ai.model',
        label: 'Model',
        type: 'select',
        options: ['gpt-5.4-mini', 'gpt-5.4-nano', 'gpt-5.4'],
      },
      {
        path: 'ai.summaryMode',
        label: 'Summary mode',
        type: 'select',
        options: ['brief', 'standard', 'detailed'],
        optionLabels: {
          brief: '短め (最低 1600 token)',
          standard: '標準 (最低 2600 token)',
          detailed: '詳しめ (最低 3600 token)',
        },
      },
      { path: 'ai.sendImages', label: 'Send images', type: 'checkbox' },
      { path: 'ai.confirmBeforeSend', label: 'Confirm before send', type: 'checkbox' },
      {
        path: 'ai.maxInputChars',
        label: 'Max input characters',
        type: 'number',
        min: 1000,
        max: 200000,
        step: 1000,
      },
      {
        path: 'ai.maxOutputTokens',
        label: 'Max output tokens',
        type: 'number',
        min: 128,
        max: 8192,
        step: 128,
      },
    ],
  },
  {
    key: 'debug',
    title: 'Debug',
    fields: [
      { path: 'debug.enableDebugLog', label: 'Developer mode', type: 'checkbox' },
      { path: 'debug.showInternalStatus', label: 'Internal status', type: 'checkbox' },
    ],
  },
]);

export const SETTINGS_VERSION = DEFAULT_SETTINGS.version;

export function cloneDefaultSettings() {
  return structuredClone(DEFAULT_SETTINGS);
}

export function getValueByPath(source, path) {
  return path.split('.').reduce((value, key) => value?.[key], source);
}

export function setValueByPath(target, path, value) {
  const keys = path.split('.');
  const lastKey = keys.pop();
  const parent = keys.reduce((node, key) => {
    if (!node[key] || typeof node[key] !== 'object') {
      node[key] = {};
    }
    return node[key];
  }, target);
  parent[lastKey] = value;
}

export function validateAndNormalizeSettings(candidate) {
  const normalized = cloneDefaultSettings();
  const errors = [];

  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
    return {
      ok: false,
      settings: normalized,
      errors: ['設定JSONはオブジェクトである必要があります。'],
    };
  }

  for (const category of SETTING_DEFINITIONS) {
    for (const field of category.fields) {
      const value = getValueByPath(candidate, field.path);
      if (value === undefined) continue;

      if (field.type === 'checkbox' && typeof value !== 'boolean') {
        errors.push(`${field.path} は boolean である必要があります。`);
        continue;
      }

      if ((field.type === 'text' || field.type === 'password' || field.type === 'color') && typeof value !== 'string') {
        errors.push(`${field.path} は string である必要があります。`);
        continue;
      }

      if (field.type === 'range' || field.type === 'number') {
        const numericValue = Number(value);
        if (!Number.isFinite(numericValue)) {
          errors.push(`${field.path} は数値である必要があります。`);
          continue;
        }
        const min = Number(field.min);
        const max = Number(field.max);
        if (numericValue < min || numericValue > max) {
          errors.push(`${field.path} は ${min} から ${max} の範囲である必要があります。`);
          continue;
        }
        setValueByPath(normalized, field.path, numericValue);
        continue;
      }

      if (field.type === 'select' && !field.options.includes(value)) {
        errors.push(`${field.path} は ${field.options.join(', ')} のいずれかです。`);
        continue;
      }

      setValueByPath(normalized, field.path, value);
    }
  }

  normalized.version = SETTINGS_VERSION;

  return {
    ok: errors.length === 0,
    settings: normalized,
    errors,
  };
}
