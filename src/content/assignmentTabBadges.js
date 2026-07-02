import { getAssignmentStatusDisplayLabel } from '../shared/assignmentStatus.js';
import { reportContentError } from '../shared/domUtils.js';
import { getAssignmentStatus } from '../shared/storage.js';
import { getCanonicalMoocsUrl, parseMoocsCourseRoute } from '../shared/moocsRoute.js';

export function createAssignmentTabBadgesController({
  document: documentRef,
  location: locationRef,
  getCurrentSettings,
  getTabCanonicalUrl,
  isNumberPageTab,
  classifyNumberPageTab,
  isAttendanceTabKind,
}) {
  function removeAssignmentTabStatusBadge(link) {
    link.classList.remove('um-assignment-tab-status');
    link.removeAttribute('data-um-assignment-status');
    link.querySelectorAll(':scope > .um-assignment-tab-marker').forEach((node) => node.remove());
    if (link.dataset.umOriginalTitle) {
      link.title = link.dataset.umOriginalTitle;
      delete link.dataset.umOriginalTitle;
    } else if (link.dataset.umAssignmentTitle === 'true') {
      link.removeAttribute('title');
      delete link.dataset.umAssignmentTitle;
    }
  }

  function clearAssignmentTabStatusBadges() {
    for (const link of documentRef.querySelectorAll('.um-assignment-tab-status')) {
      removeAssignmentTabStatusBadge(link);
    }
  }

  function buildAssignmentStatusLookup(records) {
    const lookup = new Map();
    for (const record of Object.values(records || {})) {
      if (!record || typeof record !== 'object' || !record.status) continue;
      for (const key of [record.url, record.pageKey].filter(Boolean)) {
        lookup.set(getCanonicalMoocsUrl(key), record);
      }
    }
    return lookup;
  }

  function isAssignmentTabStatusVisible(status) {
    return ['submitted', 'not_submitted', 'pending_confirmation', 'unpublished', 'unchecked', 'unknown'].includes(status);
  }

  function getAssignmentTabStatusTitle(record) {
    const label = getAssignmentStatusDisplayLabel(record.status);
    const title = record.title ? `: ${record.title}` : '';
    return `課題 ${label}${title}`;
  }

  async function applyAssignmentTabStatusBadges() {
    if (!getCurrentSettings()?.assignments?.enableSubmissionCheck) {
      clearAssignmentTabStatusBadges();
      return;
    }
    const route = parseMoocsCourseRoute(locationRef.href);
    if (!route?.course || !route.lecture) {
      clearAssignmentTabStatusBadges();
      return;
    }

    let lookup;
    try {
      lookup = buildAssignmentStatusLookup(await getAssignmentStatus());
    } catch (error) {
      reportContentError('[ultimateMoocs:assignment-tabs] failed to load assignment statuses', error);
      return;
    }

    const numberTabs = [...documentRef.querySelectorAll('.pagination a, .pagination span, .pagination button')]
      .filter((link) => isNumberPageTab(link));
    const nativeKinds = new Map(await Promise.all(numberTabs.map(async (link) => [link, await classifyNumberPageTab(link)])));
    const touched = new Set();
    for (const link of numberTabs) {
      touched.add(link);
      if (isAttendanceTabKind(nativeKinds.get(link))) {
        removeAssignmentTabStatusBadge(link);
        continue;
      }
      const tabUrl = getTabCanonicalUrl(link);
      if (!tabUrl) {
        removeAssignmentTabStatusBadge(link);
        continue;
      }
      const record = lookup.get(tabUrl);
      if (!record || !isAssignmentTabStatusVisible(record.status)) {
        removeAssignmentTabStatusBadge(link);
        continue;
      }
      const markerText = record.status === 'submitted' ? '✓' : '';
      let marker = link.querySelector(':scope > .um-assignment-tab-marker');
      if (!link.classList.contains('um-assignment-tab-status')) {
        link.classList.add('um-assignment-tab-status');
      }
      if (link.dataset.umAssignmentStatus !== record.status) {
        link.dataset.umAssignmentStatus = record.status;
      }
      if (!marker) {
        marker = documentRef.createElement('span');
        marker.className = 'um-assignment-tab-marker';
        marker.setAttribute('aria-hidden', 'true');
        link.append(marker);
      }
      if (marker.textContent !== markerText) marker.textContent = markerText;
      const nextTitle = getAssignmentTabStatusTitle(record);
      if (link.dataset.umAssignmentTitle === 'true') {
        if (link.title !== nextTitle) link.title = nextTitle;
      } else if (link.title) {
        const originalTitle = link.dataset.umOriginalTitle || link.title;
        if (!link.dataset.umOriginalTitle) link.dataset.umOriginalTitle = originalTitle;
        const title = `${originalTitle} / ${nextTitle}`;
        if (link.title !== title) link.title = title;
      } else if (link.title !== nextTitle) {
        link.dataset.umAssignmentTitle = 'true';
        link.title = nextTitle;
      }
    }
    for (const link of documentRef.querySelectorAll('.um-assignment-tab-status')) {
      if (!touched.has(link)) removeAssignmentTabStatusBadge(link);
    }
  }

  return {
    applyAssignmentTabStatusBadges,
    clearAssignmentTabStatusBadges,
    buildAssignmentStatusLookup,
    isAssignmentTabStatusVisible,
  };
}
