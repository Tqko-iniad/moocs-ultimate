function getJapaneseTodayLabels(date = new Date()) {
  const day = date.getDay();
  const ja = ['日', '月', '火', '水', '木', '金', '土'][day];
  const en = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][day];
  return [ja, en];
}

function findUpcomingTextOnCurrentPage(documentRef) {
  const nodes = [...documentRef.querySelectorAll('a, li, tr, .box, .panel')]
    .map((node) => node.textContent?.trim())
    .filter(Boolean)
    .filter((text) => /次回|直近|今日|明日|講義|授業|lesson|lecture/i.test(text))
    .slice(0, 5);
  return nodes.map((text) => ({ title: text, source: 'MOOCs page' }));
}

function findMountTarget(documentRef) {
  return (
    documentRef.querySelector('.content-wrapper .content') ||
    documentRef.querySelector('.content-wrapper') ||
    documentRef.body
  );
}

export function createUpcomingPanelController({
  document: documentRef,
  getCurrentSettings,
  getAceTimetable,
}) {
  let panel = null;

  async function ensureMounted() {
    const enabled = Boolean(getCurrentSettings()?.iniadPlus?.enableAceTimetableDownload);

    if (!enabled) {
      panel?.remove();
      panel = null;
      return;
    }

    const timetable = await getAceTimetable();
    const labels = getJapaneseTodayLabels();
    const timetableItems = (timetable.items || [])
      .filter((item) => labels.some((label) => String(item.day || item.rawText || '').includes(label)))
      .slice(0, 5)
      .map((item) => ({
        title: [item.period, item.title].filter(Boolean).join(' ') || item.rawText,
        source: 'ACE timetable',
      }));
    const items = [...timetableItems, ...findUpcomingTextOnCurrentPage(documentRef)].slice(0, 6);

    if (!items.length) {
      panel?.remove();
      panel = null;
      return;
    }

    if (!panel || !panel.isConnected) {
      panel = documentRef.createElement('section');
      panel.className = 'um-upcoming-panel';
      panel.dataset.umModule = 'upcoming';
      findMountTarget(documentRef).prepend(panel);
    }

    const list = documentRef.createElement('ul');
    for (const item of items) {
      const row = documentRef.createElement('li');
      row.textContent = `${item.title} (${item.source})`;
      list.append(row);
    }
    panel.replaceChildren();
    const title = documentRef.createElement('strong');
    title.textContent = '直近の講義';
    panel.append(title, list);
  }

  return { ensureMounted };
}
