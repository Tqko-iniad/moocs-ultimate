import {
  collectCourseCardElements,
  getCourseCardDriveUrl,
  isCourseCardElement,
} from '../shared/courseCards.js';

export function createCourseToolsController({
  document: documentRef,
  location: locationRef,
  window: windowRef,
  getCurrentSettings,
  getCourseOrder,
  getCoursePrefs,
  saveCourseOrder,
  saveCoursePrefs,
  createButton,
  isOwnedNode,
  onRefresh,
  onError,
}) {
  let refreshTimer = 0;

  function getCourseCardElements() {
    return collectCourseCardElements(documentRef, {
      baseHref: locationRef.href,
      currentHost: locationRef.host,
    });
  }

  function ensureDriveButtonsMounted(enabled) {
    for (const node of documentRef.querySelectorAll('.um-course-drive-button')) node.remove();
    if (!enabled) return;

    const seen = new Set();
    for (const item of getCourseCardElements()) {
      if (!isCourseCardElement(item, { isOwnedNode }) || seen.has(item.id)) continue;
      seen.add(item.id);

      const button = documentRef.createElement('a');
      button.className = 'um-course-drive-button';
      button.dataset.umOwned = 'true';
      button.href = getCourseCardDriveUrl(item, { isOwnedNode });
      button.target = '_blank';
      button.rel = 'noreferrer';
      button.textContent = 'ドライブで探す';

      item.anchor.insertAdjacentElement('afterend', button);
    }
  }

  function scheduleRefresh() {
    if (refreshTimer) return;
    refreshTimer = windowRef.setTimeout(() => {
      refreshTimer = 0;
      ensureMounted().catch((error) => onError?.('[ultimateMoocs:course]', error));
      onRefresh?.();
    }, 120);
  }

  async function moveCourseCardById(courseId, direction) {
    const items = getCourseCardElements();
    const ids = items.map((item) => item.id);
    const index = ids.indexOf(courseId);
    const nextIndex = index + direction;
    if (index < 0 || nextIndex < 0 || nextIndex >= ids.length) return;
    const [id] = ids.splice(index, 1);
    ids.splice(nextIndex, 0, id);
    await saveCourseOrder(ids);
    scheduleRefresh();
  }

  async function ensureMounted() {
    const courseSettings = getCurrentSettings()?.course || {};
    const enabled = Boolean(
      courseSettings.enableCourseSort || courseSettings.enableCourseFavorite || courseSettings.enableCourseHide,
    );

    for (const node of documentRef.querySelectorAll('.um-course-tools')) node.remove();
    for (const node of documentRef.querySelectorAll('[data-um-course-hidden="true"]')) {
      node.hidden = false;
      node.removeAttribute('data-um-course-hidden');
    }

    if (!enabled) return;

    const items = getCourseCardElements();
    if (!items.length) return;

    const [order, prefs] = await Promise.all([getCourseOrder(), getCoursePrefs()]);
    const orderIndex = new Map(order.map((id, index) => [id, index]));
    const sortableItems = items.filter((item) => item.parent);
    sortableItems.sort((a, b) => (orderIndex.get(a.id) ?? 9999) - (orderIndex.get(b.id) ?? 9999));
    for (const item of sortableItems) {
      item.parent.append(item.container);
    }

    for (const item of getCourseCardElements()) {
      const pref = prefs[item.id] || {};
      if (courseSettings.enableCourseHide && pref.hidden) {
        item.container.hidden = true;
        item.container.dataset.umCourseHidden = 'true';
      }

      const tools = documentRef.createElement('div');
      tools.className = 'um-course-tools';
      tools.dataset.umOwned = 'true';
      tools.dataset.umCourseId = item.id;

      if (courseSettings.enableCourseFavorite) {
        const favoriteButton = createButton(pref.favorite ? '★' : '☆');
        favoriteButton.title = 'お気に入り';
        favoriteButton.addEventListener('click', async () => {
          const latest = await getCoursePrefs();
          latest[item.id] = { ...(latest[item.id] || {}), favorite: !latest[item.id]?.favorite };
          await saveCoursePrefs(latest);
          scheduleRefresh();
        });
        tools.append(favoriteButton);
        item.container.classList.toggle('um-course-favorite', Boolean(pref.favorite));
      }

      if (courseSettings.enableCourseHide) {
        const hideButton = createButton(pref.hidden ? '表示' : '非表示');
        hideButton.title = 'コースを非表示';
        hideButton.addEventListener('click', async () => {
          const latest = await getCoursePrefs();
          latest[item.id] = { ...(latest[item.id] || {}), hidden: !latest[item.id]?.hidden };
          await saveCoursePrefs(latest);
          scheduleRefresh();
        });
        tools.append(hideButton);
      }

      if (courseSettings.enableCourseSort) {
        const upButton = createButton('↑');
        const downButton = createButton('↓');
        upButton.addEventListener('click', () => moveCourseCardById(item.id, -1));
        downButton.addEventListener('click', () => moveCourseCardById(item.id, 1));
        tools.append(upButton, downButton);
      }

      item.container.prepend(tools);
    }
  }

  return {
    ensureDriveButtonsMounted,
    ensureMounted,
  };
}
