export function createGlobalDriveButtonController({
  document: documentRef,
  isOwnedNode,
}) {
  let button = null;

  function findDriveLink() {
    return [...documentRef.querySelectorAll('a[href]')].find((link) =>
      !isOwnedNode(link) && /drive\.google\.com|docs\.google\.com/i.test(link.href),
    );
  }

  function ensureMounted(enabled) {
    const driveLink = findDriveLink();

    if (!enabled || !driveLink) {
      button?.remove();
      button = null;
      return;
    }

    if (!button || !button.isConnected) {
      button = documentRef.createElement('a');
      button.className = 'um-drive-button';
      button.dataset.umOwned = 'true';
      button.target = '_blank';
      button.rel = 'noreferrer';
      button.textContent = 'Drive';
      documentRef.body.append(button);
    }

    button.href = driveLink.href;
  }

  return { ensureMounted };
}
