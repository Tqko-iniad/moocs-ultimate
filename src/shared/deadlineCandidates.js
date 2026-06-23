const DEADLINE_CONTEXT_PATTERN =
  /提出\s*(?:期限|締切|締め切り|〆切)|(?:期限|締切|締め切り|〆切)\s*(?:日|日時)?|提出.{0,40}まで|まで.{0,20}提出/i;
const DATE_PATTERN = /(?<!\d)(?:(\d{4})\s*(年|[/.-])\s*)?(\d{1,2})\s*(月|[/.-])\s*(\d{1,2})\s*日?(?!\d)/g;
const COLON_TIME_PATTERN = /(?:^|\D)([01]?\d|2[0-3])\s*[:：]\s*([0-5]\d)(?:\D|$)/;
const JAPANESE_TIME_PATTERN = /(?:^|\D)([01]?\d|2[0-3])\s*時(?:\s*([0-5]?\d)\s*分?)?/;

function normalizeText(value) {
  return String(value || '').normalize('NFKC').replace(/\s+/g, ' ').trim();
}

function isValidDate(year, month, day) {
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function parseTime(text) {
  const colon = text.match(COLON_TIME_PATTERN);
  if (colon) return `${String(Number(colon[1])).padStart(2, '0')}:${colon[2]}`;
  const japanese = text.match(JAPANESE_TIME_PATTERN);
  if (japanese) {
    return `${String(Number(japanese[1])).padStart(2, '0')}:${String(Number(japanese[2] || 0)).padStart(2, '0')}`;
  }
  return '';
}

export function extractDeadlineCandidatesFromLines(lines, options = {}) {
  const fallbackYear = Number(options.defaultYear) || new Date().getFullYear();
  const allowLooseDates = Boolean(options.allowLooseDates);
  const candidates = new Map();
  for (const rawLine of Array.isArray(lines) ? lines : []) {
    const line = normalizeText(rawLine);
    if (!line) continue;
    DATE_PATTERN.lastIndex = 0;
    for (const match of line.matchAll(DATE_PATTERN)) {
      const explicitYear = Boolean(match[1]);
      const year = explicitYear ? Number(match[1]) : fallbackYear;
      const month = Number(match[3]);
      const day = Number(match[5]);
      if (!isValidDate(year, month, day)) continue;
      const matchStart = Number(match.index || 0);
      const matchEnd = matchStart + match[0].length;
      const contextStart = Math.max(0, matchStart - 70);
      const contextText = line.slice(contextStart, matchEnd + 90);
      const contextMatched = DEADLINE_CONTEXT_PATTERN.test(contextText);
      const dateSeparator = match[4];
      const isChainedHyphenId = dateSeparator === '-' && (line[matchStart - 1] === '-' || line[matchEnd] === '-');
      if (isChainedHyphenId) continue;

      // Without deadline wording, accept only unambiguous date notation. This keeps
      // lecture identifiers such as 01-1 and 02-3 out of loose suggestions.
      const isLooseDateSyntax = explicitYear || dateSeparator === '/' || dateSeparator === '月';
      if (!contextMatched && (!allowLooseDates || !isLooseDateSyntax)) continue;

      const parsedTime = parseTime(contextText);
      const time = parsedTime || '23:59';
      const date = [year, String(month).padStart(2, '0'), String(day).padStart(2, '0')].join('-');
      const id = `${date}T${time}`;
      if (candidates.has(id)) continue;
      candidates.set(id, {
        id,
        date,
        time,
        sourceText: contextText.slice(0, 220),
        inferredYear: !explicitYear,
        inferredTime: !parsedTime,
        contextMatched,
      });
    }
  }
  return [...candidates.values()]
    .sort((a, b) => Number(b.contextMatched) - Number(a.contextMatched) || a.id.localeCompare(b.id))
    .slice(0, 5);
}
