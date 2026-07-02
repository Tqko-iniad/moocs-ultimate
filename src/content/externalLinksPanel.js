import { collectExternalLinksFromDocument } from '../shared/externalLinks.js';

export function createExternalLinksPanelController({
  document: documentRef,
  location: locationRef,
  getCurrentSettings,
  isOwnedNode,
}) {
  let panel = null;

  function collectExternalLinksFromPage() {
    return collectExternalLinksFromDocument(documentRef, {
      baseHref: locationRef.href,
      currentOrigin: locationRef.origin,
      isOwnedNode,
      limit: 20,
    });
  }

  function ensureMounted() {
    const enabled = Boolean(getCurrentSettings()?.iniadPlus?.enableExternalLinksPanel);

    if (!enabled) {
      panel?.remove();
      panel = null;
      return;
    }

    const links = collectExternalLinksFromPage();
    if (!links.length) {
      panel?.remove();
      panel = null;
      return;
    }

    if (!panel || !panel.isConnected) {
      panel = documentRef.createElement('aside');
      panel.className = 'um-external-links-panel';
      panel.dataset.umModule = 'external-links';
      documentRef.body.append(panel);
    }

    const list = documentRef.createElement('ul');
    for (const entry of links) {
      const item = documentRef.createElement('li');
      const anchor = documentRef.createElement('a');
      anchor.href = entry.href;
      anchor.target = '_blank';
      anchor.rel = 'noopener noreferrer';
      const linkLabel = documentRef.createElement('span');
      linkLabel.className = 'um-external-link-label';
      linkLabel.textContent = entry.label;
      const linkHost = documentRef.createElement('span');
      linkHost.className = 'um-external-link-host';
      linkHost.textContent = entry.hostname;
      anchor.append(linkLabel, linkHost);
      item.append(anchor);
      list.append(item);
    }

    panel.replaceChildren();
    const details = documentRef.createElement('details');
    const summary = documentRef.createElement('summary');
    const label = documentRef.createElement('span');
    const count = documentRef.createElement('span');
    label.textContent = '外部リンク';
    count.textContent = String(links.length);
    summary.append(label, count);
    details.append(summary, list);
    panel.append(details);
  }

  return { ensureMounted };
}
