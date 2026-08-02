// 날짜 · 문자열 유틸. 모든 날짜는 'YYYY-MM-DD' 문자열과 로컬 Date 객체 사이만 오간다.
// (UTC 파싱을 쓰면 KST에서 하루 밀리므로 반드시 로컬 생성자를 쓴다.)

export const WEEKDAY_KO = ['일', '월', '화', '수', '목', '금', '토'];
export const DAY_MS = 86400000;

export function parseDate(iso) {
  if (!iso) return null;
  const parts = String(iso).slice(0, 10).split('-').map(Number);
  if (parts.length !== 3 || parts.some(Number.isNaN)) return null;
  return new Date(parts[0], parts[1] - 1, parts[2]);
}

export function toISO(date) {
  if (!date) return '';
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${m}-${d}`;
}

export function today() {
  const n = new Date();
  return new Date(n.getFullYear(), n.getMonth(), n.getDate());
}

export function addDays(date, n) {
  const d = new Date(date);
  d.setDate(d.getDate() + n);
  return d;
}

export function addMonths(date, n) {
  return new Date(date.getFullYear(), date.getMonth() + n, 1);
}

/** 주 시작은 월요일 */
export function startOfWeek(date) {
  return addDays(date, -((date.getDay() + 6) % 7));
}

export function startOfMonth(date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

export function endOfMonth(date) {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0);
}

export function diffDays(a, b) {
  return Math.round((b - a) / DAY_MS);
}

export function eachDay(start, end) {
  const out = [];
  for (let c = new Date(start); c <= end; c = addDays(c, 1)) out.push(new Date(c));
  return out;
}

export function isWeekend(date) {
  const g = date.getDay();
  return g === 0 || g === 6;
}

export function isSameDay(a, b) {
  return a && b && a.getTime() === b.getTime();
}

/** 두 기간이 하루라도 겹치는지 */
export function overlaps(aStart, aEnd, bStart, bEnd) {
  return aStart <= bEnd && bStart <= aEnd;
}

/**
 * [start, end] 에서 blocks 구간들을 도려내고 남은 조각들을 돌려준다.
 * 휴가 기간에 프로젝트 바를 끊어 같은 줄에 휴가 블록을 끼워 넣는 데 쓴다.
 * @param {Array<{start: Date, end: Date}>} blocks
 * @returns {Array<{start: Date, end: Date}>}
 */
export function subtractRanges(start, end, blocks) {
  let segments = [{ start, end }];
  for (const block of blocks) {
    const next = [];
    for (const seg of segments) {
      if (block.end < seg.start || block.start > seg.end) {
        next.push(seg);
        continue;
      }
      if (block.start > seg.start) next.push({ start: seg.start, end: addDays(block.start, -1) });
      if (block.end < seg.end) next.push({ start: addDays(block.end, 1), end: seg.end });
    }
    segments = next;
  }
  return segments;
}

/** 두 기간의 교집합. 겹치지 않으면 null. */
export function intersectRange(aStart, aEnd, bStart, bEnd) {
  const start = aStart > bStart ? aStart : bStart;
  const end = aEnd < bEnd ? aEnd : bEnd;
  return start <= end ? { start, end } : null;
}

/** 주말을 뺀 영업일 수 */
export function workdayCount(start, end) {
  return eachDay(start, end).filter((d) => !isWeekend(d)).length;
}

/**
 * 프로젝트 전체 기간이 몇 주에 걸치는지. 시작·종료일을 모두 포함해 세고 올림한다.
 * (화면에 보이는 구간이 아니라 프로젝트 전체 길이 기준)
 */
export function weekSpan(startIso, endIso) {
  const s = parseDate(startIso);
  const e = parseDate(endIso);
  if (!s || !e || e < s) return null;
  return Math.ceil((diffDays(s, e) + 1) / 7);
}

export function fmtMD(date) {
  return `${date.getMonth() + 1}/${date.getDate()}`;
}

export function fmtDate(date) {
  if (!date) return '';
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}.${m}.${d}`;
}

export function fmtRange(startIso, endIso) {
  const s = parseDate(startIso);
  const e = parseDate(endIso);
  if (!s || !e) return '';
  if (s.getTime() === e.getTime()) return fmtDate(s);
  return `${fmtDate(s)} – ${fmtDate(e)}`;
}

export function weekLabel(monday) {
  const sunday = addDays(monday, 6);
  return `${fmtMD(monday)} – ${fmtMD(sunday)}`;
}

/** ISO 8601 주차 */
export function isoWeekNumber(date) {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  d.setDate(d.getDate() + 3 - ((d.getDay() + 6) % 7));
  const week1 = new Date(d.getFullYear(), 0, 4);
  return 1 + Math.round(((d - week1) / DAY_MS - 3 + ((week1.getDay() + 6) % 7)) / 7);
}

export function uid(prefix) {
  return `${prefix}-${Date.now().toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`;
}

export function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** 정렬용 안전 비교 (한국어 로케일) */
export function byKo(a, b) {
  return String(a).localeCompare(String(b), 'ko');
}
