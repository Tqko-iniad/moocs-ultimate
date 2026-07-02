function isDriveLikeUrl(value) {
  return /drive\.google\.com|docs\.google\.com/i.test(String(value || ''));
}

export function cleanCourseCardTitle(text) {
  return String(text || '')
    .replace(/View Course/gi, '')
    .replace(/ドライブで探す/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function findDriveLinkInCourseNode(node, options = {}) {
  const isOwnedNode = options.isOwnedNode || (() => false);
  return [...(node?.querySelectorAll?.('a[href]') || [])].find((link) =>
    !isOwnedNode(link) && isDriveLikeUrl(link.href || link.getAttribute?.('href')),
  );
}

export function getCourseCardTitle(item) {
  const heading =
    item.container.querySelector?.('h1, h2, h3, h4, .course-title, .box-title, .panel-title')?.textContent || '';
  const imageAlt = item.container.querySelector?.('img[alt]')?.getAttribute('alt') || '';
  const containerTitle = cleanCourseCardTitle(item.container.textContent);
  const anchorTitle = cleanCourseCardTitle(item.anchor.textContent || item.anchor.getAttribute('title') || '');
  return cleanCourseCardTitle(heading) || cleanCourseCardTitle(imageAlt) || containerTitle || anchorTitle || 'INIAD MOOCs';
}

export function getCourseCardDriveUrl(item, options = {}) {
  const driveLink = findDriveLinkInCourseNode(item.container, options);
  if (driveLink) return driveLink.href || driveLink.getAttribute('href');
  return `https://drive.google.com/drive/search?q=${encodeURIComponent(getCourseCardTitle(item))}`;
}

export function isCourseCardElement(item, options = {}) {
  const isOwnedNode = options.isOwnedNode || (() => false);
  if (!item?.container || isOwnedNode(item.container)) return false;
  const anchorText = item.anchor.textContent?.trim() || '';
  const containerText = cleanCourseCardTitle(item.container.textContent);
  const hasCourseAction = /view\s*course|コースを見る|course/i.test(anchorText);
  const hasCourseImage = Boolean(item.container.querySelector?.('img'));
  const hasEnoughContent = containerText.length >= 2 && containerText !== cleanCourseCardTitle(anchorText);
  return hasEnoughContent && (hasCourseAction || hasCourseImage);
}

export function collectCourseCardElements(doc, options = {}) {
  const baseHref = options.baseHref || '';
  const currentHost = options.currentHost || '';
  const anchors = [...doc.querySelectorAll('a[href*="/courses/"], a[href*="/course/"]')].filter(
    (anchor) => {
      try {
        const url = new URL(anchor.href || anchor.getAttribute('href'), baseHref);
        return !currentHost || url.host === currentHost;
      } catch {
        return false;
      }
    },
  );

  return anchors
    .map((anchor) => {
      const container =
        anchor.closest('.box, .panel, .course, .coursebox, li, tr, article, .col-md-3, .col-md-4, .col-sm-6') ||
        anchor;
      return {
        id: new URL(anchor.href || anchor.getAttribute('href'), baseHref).pathname,
        title: anchor.textContent?.trim() || anchor.getAttribute('title') || anchor.href,
        anchor,
        container,
        parent: container.parentElement,
      };
    })
    .filter((item, index, items) => items.findIndex((candidate) => candidate.id === item.id) === index);
}
