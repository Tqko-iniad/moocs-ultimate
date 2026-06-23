(function ultimateMoocsInstallAlertHook() {
  var alertMessageType = 'ultimateMoocs:page.alert';
  var hookVersion = 2;

  if (window.__ultimateMoocsAlertHookVersion === hookVersion) return;
  window.__ultimateMoocsAlertHookInstalled = true;
  window.__ultimateMoocsAlertHookVersion = hookVersion;

  var originalAlert = window.alert;

  function publishAlert(message) {
    var payload = {
      source: 'ultimateMoocs:page',
      type: alertMessageType,
      message: String(message == null ? '' : message),
      href: location.href,
      capturedAt: Date.now(),
    };

    try {
      window.postMessage(payload, location.origin);
    } catch {
      // Keep the page behavior unchanged even if the extension bridge fails.
    }

    try {
      window.dispatchEvent(new CustomEvent('ultimateMoocs:page-alert', { detail: payload }));
    } catch {
      // CustomEvent may be blocked by an unusual page context. postMessage above is enough.
    }
  }

  window.alert = function ultimateMoocsAlertHook(message) {
    publishAlert(message);

    return originalAlert.apply(this, arguments);
  };
})();
