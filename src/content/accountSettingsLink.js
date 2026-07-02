export function createAccountSettingsLinkController({
  document: documentRef,
  location: locationRef,
  window: windowRef,
  openOptions,
  getOptionsUrl,
  isContextInvalidated,
}) {
  let panel = null;

  function findMountTarget() {
    return (
      documentRef.querySelector('.content-wrapper .content') ||
      documentRef.querySelector('.content-wrapper') ||
      documentRef.body
    );
  }

  function ensureMounted() {
    const isAccountPage = /account|settings|profile|users/i.test(locationRef.pathname + locationRef.search);
    if (!isAccountPage) {
      panel?.remove();
      panel = null;
      return;
    }

    if (panel && panel.isConnected) return;

    panel = documentRef.createElement('section');
    panel.className = 'um-settings-link-panel';
    panel.dataset.umOwned = 'true';
    const button = documentRef.createElement('button');
    button.type = 'button';
    button.className = 'um-settings-link-button';
    button.textContent = 'MOOCs Ultimate 設定を開く';
    button.addEventListener('click', async () => {
      try {
        const response = await openOptions();
        if (!response?.opened) throw new Error(response?.error || 'Options page open failed');
      } catch (error) {
        if (isContextInvalidated(error)) {
          button.textContent = '拡張機能を更新しました。ページを再読み込みしてください';
          button.disabled = true;
          return;
        }
        const optionsUrl = getOptionsUrl();
        if (/^chrome-extension:|^moz-extension:/.test(optionsUrl)) {
          windowRef.open(optionsUrl, '_blank', 'noopener,noreferrer');
        } else {
          button.textContent = error?.message || '設定を開けません。ページを再読み込みしてください';
        }
      }
    });
    panel.append(button);
    findMountTarget().prepend(panel);
  }

  return { ensureMounted };
}
