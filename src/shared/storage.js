import { storageGet, storageSet } from './browserApi.js';
import {
  cloneDefaultSettings,
  validateAndNormalizeSettings,
} from './defaultSettings.js';

export const STORAGE_KEYS = Object.freeze({
  settings: 'ultimateMoocs.settings',
  memos: 'ultimateMoocs.memos',
  courseOrder: 'ultimateMoocs.courseOrder',
  coursePrefs: 'ultimateMoocs.coursePrefs',
  assignmentStatus: 'ultimateMoocs.assignmentStatus',
  downloadState: 'ultimateMoocs.downloadState',
  aceTimetable: 'ultimateMoocs.aceTimetable',
  aiUsage: 'ultimateMoocs.aiUsage',
  aiQuota: 'ultimateMoocs.aiQuota',
  aiSummaries: 'ultimateMoocs.aiSummaries',
  migrations: 'ultimateMoocs:migrations',
  debugLogs: 'ultimateMoocs:debug.logs',
});

export async function getSettings() {
  const result = await storageGet(STORAGE_KEYS.settings);
  const validation = validateAndNormalizeSettings(result[STORAGE_KEYS.settings]);
  return validation.settings;
}

export async function saveSettings(settings) {
  const validation = validateAndNormalizeSettings(settings);
  if (!validation.ok) {
    throw new Error(validation.errors.join('\n'));
  }
  const nextSettings = validation.settings;
  await storageSet({
    [STORAGE_KEYS.settings]: nextSettings,
  });
  return nextSettings;
}

export async function resetSettings() {
  return saveSettings(cloneDefaultSettings());
}

export async function getMemos() {
  const result = await storageGet(STORAGE_KEYS.memos);
  const memos = result[STORAGE_KEYS.memos];
  return memos && typeof memos === 'object' && !Array.isArray(memos) ? memos : {};
}

export async function saveMemos(memos) {
  const nextMemos = memos && typeof memos === 'object' && !Array.isArray(memos) ? memos : {};
  await storageSet({ [STORAGE_KEYS.memos]: nextMemos });
  return nextMemos;
}

export async function getCourseOrder() {
  const result = await storageGet(STORAGE_KEYS.courseOrder);
  const order = result[STORAGE_KEYS.courseOrder];
  return Array.isArray(order) ? order.filter((item) => typeof item === 'string') : [];
}

export async function saveCourseOrder(order) {
  const nextOrder = Array.isArray(order) ? order.filter((item) => typeof item === 'string') : [];
  await storageSet({ [STORAGE_KEYS.courseOrder]: nextOrder });
  return nextOrder;
}

export async function getCoursePrefs() {
  const result = await storageGet(STORAGE_KEYS.coursePrefs);
  const prefs = result[STORAGE_KEYS.coursePrefs];
  return prefs && typeof prefs === 'object' && !Array.isArray(prefs) ? prefs : {};
}

export async function saveCoursePrefs(prefs) {
  const nextPrefs = prefs && typeof prefs === 'object' && !Array.isArray(prefs) ? prefs : {};
  await storageSet({ [STORAGE_KEYS.coursePrefs]: nextPrefs });
  return nextPrefs;
}

export async function getAssignmentStatus() {
  const result = await storageGet(STORAGE_KEYS.assignmentStatus);
  const status = result[STORAGE_KEYS.assignmentStatus];
  return status && typeof status === 'object' && !Array.isArray(status) ? status : {};
}

export async function saveAssignmentStatus(status) {
  const nextStatus = status && typeof status === 'object' && !Array.isArray(status) ? status : {};
  await storageSet({ [STORAGE_KEYS.assignmentStatus]: nextStatus });
  return nextStatus;
}

export function createDefaultDownloadState(overrides = {}) {
  const state = {
    runId: '',
    status: 'idle',
    scope: '',
    total: 0,
    completed: 0,
    failed: 0,
    currentFile: '',
    downloadModeLabel: '',
    failures: [],
    queuedAt: '',
    updatedAt: new Date().toISOString(),
    canceled: false,
    ...overrides,
  };

  state.total = Math.max(0, Number(state.total || 0));
  state.completed = Math.min(Math.max(0, Number(state.completed || 0)), state.total);
  state.failed = Math.min(Math.max(0, Number(state.failed || 0)), Math.max(0, state.total - state.completed));
  state.failures = Array.isArray(state.failures) ? state.failures.slice(-state.failed) : [];
  return state;
}

export async function getDownloadState() {
  const result = await storageGet(STORAGE_KEYS.downloadState);
  const state = result[STORAGE_KEYS.downloadState];
  return state && typeof state === 'object' && !Array.isArray(state)
    ? createDefaultDownloadState(state)
    : createDefaultDownloadState();
}

export async function saveDownloadState(state) {
  const nextState = createDefaultDownloadState({
    ...state,
    updatedAt: new Date().toISOString(),
  });
  await storageSet({ [STORAGE_KEYS.downloadState]: nextState });
  return nextState;
}

export async function getAceTimetable() {
  const result = await storageGet(STORAGE_KEYS.aceTimetable);
  const timetable = result[STORAGE_KEYS.aceTimetable];
  return timetable && typeof timetable === 'object' && !Array.isArray(timetable)
    ? timetable
    : { exportedAt: '', source: '', items: [] };
}

export async function saveAceTimetable(timetable) {
  const nextTimetable =
    timetable && typeof timetable === 'object' && Array.isArray(timetable.items)
      ? timetable
      : { exportedAt: new Date().toISOString(), source: '', items: [] };
  await storageSet({ [STORAGE_KEYS.aceTimetable]: nextTimetable });
  return nextTimetable;
}

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

export function createDefaultAiUsage(overrides = {}) {
  const usage = {
    date: todayKey(),
    estimatedInputTokens: 0,
    estimatedOutputTokens: 0,
    requestCount: 0,
    updatedAt: new Date().toISOString(),
    ...overrides,
  };

  if (usage.date !== todayKey()) {
    usage.date = todayKey();
    usage.estimatedInputTokens = 0;
    usage.estimatedOutputTokens = 0;
    usage.requestCount = 0;
  }

  usage.estimatedInputTokens = Math.max(0, Number(usage.estimatedInputTokens || 0));
  usage.estimatedOutputTokens = Math.max(0, Number(usage.estimatedOutputTokens || 0));
  usage.requestCount = Math.max(0, Number(usage.requestCount || 0));
  return usage;
}

export async function getAiUsage() {
  const result = await storageGet(STORAGE_KEYS.aiUsage);
  const usage = result[STORAGE_KEYS.aiUsage];
  return usage && typeof usage === 'object' && !Array.isArray(usage)
    ? createDefaultAiUsage(usage)
    : createDefaultAiUsage();
}

export async function saveAiUsage(usage) {
  const nextUsage = createDefaultAiUsage({
    ...usage,
    updatedAt: new Date().toISOString(),
  });
  await storageSet({ [STORAGE_KEYS.aiUsage]: nextUsage });
  return nextUsage;
}

export async function getAiQuota() {
  const result = await storageGet(STORAGE_KEYS.aiQuota);
  const quota = result[STORAGE_KEYS.aiQuota];
  return quota && typeof quota === 'object' && !Array.isArray(quota) ? quota : null;
}

export async function saveAiQuota(quota) {
  const nextQuota =
    quota && typeof quota === 'object' && !Array.isArray(quota)
      ? {
          ...quota,
          updatedAt: new Date().toISOString(),
        }
      : null;
  await storageSet({ [STORAGE_KEYS.aiQuota]: nextQuota });
  return nextQuota;
}

export async function getAiSummaries() {
  const result = await storageGet(STORAGE_KEYS.aiSummaries);
  const summaries = result[STORAGE_KEYS.aiSummaries];
  return summaries && typeof summaries === 'object' && !Array.isArray(summaries) ? summaries : {};
}

export async function saveAiSummaries(summaries) {
  const nextSummaries = summaries && typeof summaries === 'object' && !Array.isArray(summaries) ? summaries : {};
  await storageSet({ [STORAGE_KEYS.aiSummaries]: nextSummaries });
  return nextSummaries;
}
