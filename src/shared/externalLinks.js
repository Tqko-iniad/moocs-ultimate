function cleanExternalLinkLabel(value) {
  const normalized = String(value || '')
    .replace(/[\u200b-\u200d\ufeff]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!normalized) return '';
  return normalized.length > 96 ? `${normalized.slice(0, 95)}…` : normalized;
}

export function createExternalLinkEntry({
  href,
  baseHref,
  currentOrigin,
  labels = [],
} = {}) {
  let url;
  try {
    url = new URL(String(href || ''), String(baseHref || ''));
  } catch {
    return null;
  }

  if (!/^https?:$/.test(url.protocol) || url.origin === currentOrigin) return null;
  url.hash = '';

  const hostname = url.hostname.replace(/^www\./i, '');
  const label = labels.map(cleanExternalLinkLabel).find(Boolean) || hostname;
  return {
    href: url.href,
    hostname,
    label: /^https?:\/\//i.test(label) ? hostname : label,
  };
}

export function dedupeExternalLinkEntries(entries, limit = 20) {
  const result = [];
  const seen = new Set();
  const safeLimit = Math.max(0, Number(limit) || 0);
  if (safeLimit === 0) return result;

  for (const entry of entries || []) {
    if (!entry?.href || seen.has(entry.href)) continue;
    seen.add(entry.href);
    result.push(entry);
    if (result.length >= safeLimit) break;
  }
  return result;
}

export function collectExternalLinksFromDocument(doc, options = {}) {
  const {
    baseHref = '',
    currentOrigin = '',
    isOwnedNode = () => false,
    limit = 20,
  } = options;
  const entries = [];
  for (const link of doc.querySelectorAll('a[href]')) {
    if (
      isOwnedNode(link) ||
      link.closest('[hidden], [aria-hidden="true"]')
    ) {
      continue;
    }
    const entry = createExternalLinkEntry({
      href: link.getAttribute('href') || link.href,
      baseHref,
      currentOrigin,
      labels: [
        link.textContent,
        link.getAttribute('aria-label'),
        link.getAttribute('title'),
        link.querySelector('img[alt]')?.getAttribute('alt'),
      ],
    });
    if (entry) entries.push(entry);
  }
  return dedupeExternalLinkEntries(entries, limit);
}
