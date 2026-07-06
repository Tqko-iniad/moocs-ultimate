export const MESSAGE_TYPES = Object.freeze({
  contentPing: 'ultimateMoocs:content.ping',
  settingsGet: 'ultimateMoocs:settings.get',
  settingsSet: 'ultimateMoocs:settings.set',
  settingsReset: 'ultimateMoocs:settings.reset',
  optionsOpen: 'ultimateMoocs:options.open',
  downloadPrepare: 'ultimateMoocs:download.prepare',
  downloadEnqueue: 'ultimateMoocs:download.enqueue',
  downloadCancel: 'ultimateMoocs:download.cancel',
  downloadStateGet: 'ultimateMoocs:download.state.get',
  screenshotCapture: 'ultimateMoocs:screenshot.capture',
  screenshotShowCopyDialog: 'ultimateMoocs:screenshot.showCopyDialog',
  aiSummarize: 'ultimateMoocs:ai.summarize',
  slidesTextExtract: 'ultimateMoocs:slidesText.extract',
  aiExtractSlidesText: 'ultimateMoocs:ai.slidesText.extract',
  aiUsageGet: 'ultimateMoocs:ai.usage.get',
  aiSummaryList: 'ultimateMoocs:ai.summary.list',
  aiSummaryDelete: 'ultimateMoocs:ai.summary.delete',
  aiSummaryCheckStale: 'ultimateMoocs:ai.summary.checkStale',
  diagnosticsGet: 'ultimateMoocs:diagnostics.get',
  debugLog: 'ultimateMoocs:debug.log',
  slidePositionSave: 'ultimateMoocs:slidePosition.save',
  slidePositionGet: 'ultimateMoocs:slidePosition.get',
});

export function createMessage(type, payload = {}) {
  return {
    type,
    payload,
    sentAt: new Date().toISOString(),
  };
}

export function isUltimateMoocsMessage(message) {
  return Boolean(
    message &&
      typeof message === 'object' &&
      typeof message.type === 'string' &&
      message.type.startsWith('ultimateMoocs:'),
  );
}
