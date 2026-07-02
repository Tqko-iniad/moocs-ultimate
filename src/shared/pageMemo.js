export function collectMemoPageContextFromDocument(doc, pageUrl, fallbackTitle = '') {
  const headings = [...doc.querySelectorAll('h1, h2, .content-header h1, .content-header h2')]
    .map((node) => node.textContent?.trim())
    .filter(Boolean);
  return {
    url: pageUrl,
    title: fallbackTitle || headings[0] || pageUrl,
    courseTitle: headings[0] || '',
    lectureTitle: headings[1] || headings[0] || '',
  };
}

export function normalizeMemoRecord(record, context, now = new Date().toISOString()) {
  return {
    url: record?.url || context.url,
    title: record?.title || context.title,
    courseTitle: record?.courseTitle || context.courseTitle,
    lectureTitle: record?.lectureTitle || context.lectureTitle,
    updatedAt: record?.updatedAt || now,
    notes: Array.isArray(record?.notes) ? record.notes : [],
  };
}

export function createMemoNote(body = '', now = new Date().toISOString(), randomId = Math.random().toString(36).slice(2)) {
  const timestamp = new Date(now).getTime();
  return {
    id: `memo-${Number.isNaN(timestamp) ? Date.now() : timestamp}-${randomId}`,
    body,
    createdAt: now,
    updatedAt: now,
  };
}
