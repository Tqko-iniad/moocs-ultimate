function getExtensionGlobal(name) {
  try {
    const api = globalThis[name];
    return api?.runtime ? api : null;
  } catch {
    return null;
  }
}

function getLastRuntimeError() {
  try {
    const chromeApi = getExtensionGlobal('chrome');
    return chromeApi?.runtime?.lastError || null;
  } catch {
    return null;
  }
}

function getRuntime() {
  try {
    return browserApi?.runtime || null;
  } catch {
    return null;
  }
}

function getStorageLocal() {
  try {
    return browserApi?.storage?.local || null;
  } catch {
    return null;
  }
}

function getStorageOnChanged() {
  try {
    return browserApi?.storage?.onChanged || null;
  } catch {
    return null;
  }
}

function getDownloads() {
  try {
    return browserApi?.downloads || null;
  } catch {
    return null;
  }
}

function getRuntimeApi() {
  return getExtensionGlobal('browser') || getExtensionGlobal('chrome');
}

export const browserApi = getRuntimeApi();

function usesPromiseApi() {
  return Boolean(getExtensionGlobal('browser') && browserApi === getExtensionGlobal('browser'));
}

export function hasExtensionApi() {
  return Boolean(browserApi);
}

export function isExtensionContextInvalidated(error) {
  return /extension context invalidated/i.test(
    [error?.message, error?.stack, String(error || '')].filter(Boolean).join('\n'),
  );
}

export function runtimeGetURL(path) {
  try {
    const runtime = getRuntime();
    return runtime?.getURL ? runtime.getURL(path) : path;
  } catch (error) {
    if (!isExtensionContextInvalidated(error)) {
      console.warn('[ultimateMoocs:runtime]', error);
    }
    return path;
  }
}

export function runtimeSendMessage(message) {
  const runtime = getRuntime();
  if (!runtime?.sendMessage) {
    return Promise.reject(new Error('Extension runtime API is unavailable.'));
  }

  if (usesPromiseApi()) {
    return runtime.sendMessage(message);
  }

  return new Promise((resolve, reject) => {
    try {
      runtime.sendMessage(message, (response) => {
        const lastError = getLastRuntimeError();
        if (lastError) {
          reject(new Error(lastError.message));
          return;
        }
        resolve(response);
      });
    } catch (error) {
      reject(error);
    }
  });
}

export function runtimeOpenOptionsPage() {
  const runtime = getRuntime();
  if (!runtime?.openOptionsPage) {
    return Promise.reject(new Error('Extension options API is unavailable.'));
  }

  if (usesPromiseApi()) {
    return runtime.openOptionsPage();
  }

  return new Promise((resolve, reject) => {
    try {
      runtime.openOptionsPage(() => {
        const lastError = getLastRuntimeError();
        if (lastError) {
          reject(new Error(lastError.message));
          return;
        }
        resolve();
      });
    } catch (error) {
      reject(error);
    }
  });
}

export function storageGet(keys) {
  const storageLocal = getStorageLocal();
  if (!storageLocal?.get) {
    return Promise.reject(new Error('Extension storage API is unavailable.'));
  }

  if (usesPromiseApi()) {
    return storageLocal.get(keys);
  }

  return new Promise((resolve, reject) => {
    try {
      storageLocal.get(keys, (result) => {
        const lastError = getLastRuntimeError();
        if (lastError) {
          reject(new Error(lastError.message));
          return;
        }
        resolve(result || {});
      });
    } catch (error) {
      reject(error);
    }
  });
}

export function storageSet(values) {
  const storageLocal = getStorageLocal();
  if (!storageLocal?.set) {
    return Promise.reject(new Error('Extension storage API is unavailable.'));
  }

  if (usesPromiseApi()) {
    return storageLocal.set(values);
  }

  return new Promise((resolve, reject) => {
    try {
      storageLocal.set(values, () => {
        const lastError = getLastRuntimeError();
        if (lastError) {
          reject(new Error(lastError.message));
          return;
        }
        resolve();
      });
    } catch (error) {
      reject(error);
    }
  });
}

export function storageAddChangeListener(listener) {
  try {
    const onChanged = getStorageOnChanged();
    if (!onChanged?.addListener) {
      return () => {};
    }

    onChanged.addListener(listener);
    return () => {
      try {
        onChanged.removeListener(listener);
      } catch {
        // The extension was likely reloaded while the page still had the old content script.
      }
    };
  } catch {
    return () => {};
  }
}

export function runtimeAddMessageListener(listener) {
  const runtime = getRuntime();
  if (!runtime?.onMessage?.addListener) {
    return () => {};
  }

  try {
    runtime.onMessage.addListener(listener);
    return () => {
      try {
        runtime.onMessage.removeListener(listener);
      } catch {
        // The extension was likely reloaded while the page still had the old content script.
      }
    };
  } catch {
    return () => {};
  }
}

export function downloadsDownload(options) {
  const downloads = getDownloads();
  if (!downloads?.download) {
    return Promise.reject(new Error('Extension downloads API is unavailable.'));
  }

  if (usesPromiseApi()) {
    return downloads.download(options);
  }

  return new Promise((resolve, reject) => {
    try {
      downloads.download(options, (downloadId) => {
        const lastError = getLastRuntimeError();
        if (lastError) {
          reject(new Error(lastError.message));
          return;
        }
        resolve(downloadId);
      });
    } catch (error) {
      reject(error);
    }
  });
}
