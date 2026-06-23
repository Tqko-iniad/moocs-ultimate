import { getSettings, saveAceTimetable } from '../shared/storage.js';

function createButton(label) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'um-ace-button';
  button.textContent = label;
  return button;
}

function downloadText(filename, text, type) {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function csvEscape(value) {
  const text = String(value ?? '');
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function toCsv(items) {
  const headers = ['day', 'period', 'title', 'room', 'teacher', 'rawText'];
  return [
    headers.join(','),
    ...items.map((item) => headers.map((key) => csvEscape(item[key])).join(',')),
  ].join('\n');
}

function parseTimetableItems() {
  const items = [];
  const rows = [...document.querySelectorAll('table tr')];
  for (const row of rows) {
    const cells = [...row.querySelectorAll('th, td')].map((cell) => cell.textContent?.trim()).filter(Boolean);
    if (cells.length < 2) continue;
    const rawText = cells.join(' ');
    if (!/[月火水木金土日]|Mon|Tue|Wed|Thu|Fri|Sat|Sun|[1-7]\s*限|period/i.test(rawText)) continue;
    items.push({
      day: cells.find((cell) => /月|火|水|木|金|土|日|Mon|Tue|Wed|Thu|Fri|Sat|Sun/i.test(cell)) || '',
      period: cells.find((cell) => /[1-7]\s*限|period\s*[1-7]/i.test(cell)) || '',
      title: cells.find((cell) => cell.length > 3 && !/[月火水木金土日]|限/.test(cell)) || cells.at(-1) || '',
      room: cells.find((cell) => /教室|room|iniad|hub|[0-9]{3}/i.test(cell)) || '',
      teacher: cells.find((cell) => /先生|教授|准教授|講師|teacher/i.test(cell)) || '',
      rawText,
    });
  }

  if (items.length) return items;

  return [...document.querySelectorAll('a, div, li, span')]
    .map((node) => node.textContent?.trim())
    .filter((text) => text && text.length > 8 && /[月火水木金土日]|[1-7]\s*限/.test(text))
    .slice(0, 80)
    .map((rawText) => ({
      day: rawText.match(/[月火水木金土日]/)?.[0] || '',
      period: rawText.match(/[1-7]\s*限/)?.[0] || '',
      title: rawText,
      room: '',
      teacher: '',
      rawText,
    }));
}

async function collectTimetable() {
  const timetable = {
    exportedAt: new Date().toISOString(),
    source: location.href,
    items: parseTimetableItems(),
  };
  await saveAceTimetable(timetable);
  return timetable;
}

function mountAcePanel() {
  if (document.querySelector('.um-ace-panel')) return;

  const panel = document.createElement('section');
  panel.className = 'um-ace-panel';
  panel.innerHTML = `
    <strong>MOOCs Ultimate ACE</strong>
    <p class="um-ace-status">時間割をローカルに保存できます。</p>
    <div class="um-ace-actions"></div>
  `;
  const status = panel.querySelector('.um-ace-status');
  const actions = panel.querySelector('.um-ace-actions');

  const jsonButton = createButton('時間割JSON保存');
  jsonButton.addEventListener('click', async () => {
    const timetable = await collectTimetable();
    downloadText('ace-timetable.json', `${JSON.stringify(timetable, null, 2)}\n`, 'application/json');
    status.textContent = `${timetable.items.length}件をJSON保存しました。`;
  });

  const csvButton = createButton('時間割CSV保存');
  csvButton.addEventListener('click', async () => {
    const timetable = await collectTimetable();
    downloadText('ace-timetable.csv', `${toCsv(timetable.items)}\n`, 'text/csv');
    status.textContent = `${timetable.items.length}件をCSV保存しました。`;
  });

  actions.append(jsonButton, csvButton);
  document.body.prepend(panel);
}

async function boot() {
  try {
    const settings = await getSettings();
    if (!settings.iniadPlus.enableAceTimetableDownload) return;
    mountAcePanel();
  } catch (error) {
    console.warn('[ultimateMoocs:ace]', error);
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot, { once: true });
} else {
  boot();
}

