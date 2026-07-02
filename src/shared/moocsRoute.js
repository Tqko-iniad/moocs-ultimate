const MOOCS_ROUTE_PATTERN =
  /^\/courses\/(?<year>\d{4})(?:\/(?<course>[^/?#]+)(?:\/(?<lecture>[^/?#]+)(?:\/(?<page>[^/?#]+))?)?)?\/?$/;

function getCurrentLocationFallback() {
  return typeof location !== 'undefined' ? location : null;
}

function isOwnedExtensionNode(node) {
  return Boolean(node?.closest?.('[data-um-module], [data-um-owned="true"]'));
}

export function parseMoocsCourseRoute(rawUrl = getCurrentLocationFallback()?.href || '') {
  try {
    const currentLocation = getCurrentLocationFallback();
    const url = new URL(rawUrl, currentLocation?.href || 'https://moocs.iniad.org/');
    const expectedHost = currentLocation?.host || 'moocs.iniad.org';
    if (url.host !== expectedHost) return null;
    const match = url.pathname.match(MOOCS_ROUTE_PATTERN);
    if (!match?.groups) return null;
    return {
      url,
      year: match.groups.year || '',
      course: match.groups.course || '',
      lecture: match.groups.lecture || '',
      page: match.groups.page || '',
    };
  } catch {
    return null;
  }
}

export function getCanonicalMoocsUrl(rawUrl = getCurrentLocationFallback()?.href || '') {
  try {
    const currentLocation = getCurrentLocationFallback();
    const url = new URL(rawUrl, currentLocation?.href || 'https://moocs.iniad.org/');
    const expectedHost = currentLocation?.host || 'moocs.iniad.org';
    if (url.host === expectedHost && url.pathname.startsWith('/courses/')) {
      url.hash = '';
      url.search = '';
      return url.href.replace(/\/+$/, '');
    }
    url.hash = '';
    url.searchParams.delete('_');
    return url.href.replace(/\/+$/, '');
  } catch {
    return String(rawUrl || '').replace(/[?#].*$/, '').replace(/\/+$/, '');
  }
}

export function collectMoocsRouteLinksFromDocument(doc, pageUrl, predicate) {
  const links = [...doc.querySelectorAll('a[href]')]
    .map((link) => {
      if (isOwnedExtensionNode(link)) return null;
      try {
        const url = new URL(link.getAttribute('href'), pageUrl);
        const route = parseMoocsCourseRoute(url.href);
        if (!route || !predicate(route, link)) return null;
        return {
          url,
          route,
          title: link.textContent?.trim().replace(/\s+/g, ' ') || '',
        };
      } catch {
        return null;
      }
    })
    .filter(Boolean);

  return dedupeRouteEntries(links);
}

export function collectLecturePageRouteLinksFromDocument(
  doc = typeof document !== 'undefined' ? document : null,
  pageUrl = getCurrentLocationFallback()?.href || '',
  maxCount = Infinity,
) {
  if (!doc) return [];
  const currentRoute = parseMoocsCourseRoute(pageUrl);
  if (!currentRoute?.course || !currentRoute.lecture) return [];
  return collectMoocsRouteLinksFromDocument(doc, pageUrl, (route) => {
    if (route.year !== currentRoute.year || route.course !== currentRoute.course) return false;
    return route.lecture === currentRoute.lecture && Boolean(route.page);
  }).slice(0, maxCount);
}

export function collectCourseLectureRouteLinksFromDocument(
  doc = typeof document !== 'undefined' ? document : null,
  pageUrl = getCurrentLocationFallback()?.href || '',
) {
  if (!doc) return [];
  const currentRoute = parseMoocsCourseRoute(pageUrl);
  if (!currentRoute?.course) return [];
  return collectMoocsRouteLinksFromDocument(doc, pageUrl, (route) => {
    if (route.year !== currentRoute.year || route.course !== currentRoute.course) return false;
    return Boolean(route.lecture) && !route.page;
  });
}

export function dedupeRouteEntries(entries, maxCount = Infinity) {
  return [...new Map(entries.map((entry) => [entry.url.href.replace(/#.*$/, ''), entry])).values()].slice(
    0,
    maxCount,
  );
}
