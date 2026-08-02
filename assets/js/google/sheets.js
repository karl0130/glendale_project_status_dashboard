// Google Sheets API 어댑터. 시트의 행 ↔ 앱의 객체를 옮긴다.
//
// 읽기는 batchGet 한 번으로 4개 탭 + 메타를 모두 가져온다 (왕복 1회).
// 쓰기는 바뀐 탭 하나만 통째로 다시 쓴다. 수백 행 규모에서는 이게 가장 단순하고 안전하다.

import { GOOGLE, META, SCHEMA } from '../config.js';
import { getToken } from './auth.js';

const API = 'https://sheets.googleapis.com/v4/spreadsheets';

async function call(path, init = {}) {
  const token = await getToken();
  const res = await fetch(`${API}/${GOOGLE.spreadsheetId}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(init.headers || {}),
    },
  });
  if (!res.ok) {
    const body = await res.text();
    let detail = body;
    try {
      detail = JSON.parse(body).error?.message || body;
    } catch {
      /* 원문 그대로 */
    }
    if (res.status === 403) {
      throw new Error(`시트 접근 권한이 없습니다 — 스프레드시트가 이 계정에 공유돼 있는지 확인하세요 (${detail})`);
    }
    if (res.status === 404) {
      throw new Error('스프레드시트를 찾을 수 없습니다 — config.js 의 spreadsheetId 를 확인하세요');
    }
    throw new Error(`Sheets API ${res.status}: ${detail}`);
  }
  return res.json();
}

// ── 값 변환 ─────────────────────────────────────────────────────────────────

function decode(schema, column, raw) {
  const value = raw == null ? '' : String(raw).trim();
  switch (schema.types?.[column]) {
    case 'list':
      return value ? value.split(',').map((s) => s.trim()).filter(Boolean) : [];
    case 'boolean':
      return !/^(false|f|no|n|0|)$/i.test(value);
    default:
      return value;
  }
}

function encode(schema, column, value) {
  switch (schema.types?.[column]) {
    case 'list':
      return (value ?? []).join(',');
    case 'boolean':
      return value === false ? 'FALSE' : 'TRUE';
    default:
      return value == null ? '' : String(value);
  }
}

/** 헤더 이름으로 열을 찾는다 — 시트에서 열 순서를 바꿔도 안 깨진다. */
function toObjects(schema, values) {
  if (!values || values.length < 2) return [];
  const header = (values[0] || []).map((h) => String(h ?? '').trim());
  return values
    .slice(1)
    .filter((row) => (row || []).some((cell) => String(cell ?? '').trim() !== ''))
    .map((row) => {
      const obj = {};
      for (const column of schema.columns) {
        const i = header.indexOf(column);
        obj[column] = decode(schema, column, i >= 0 ? row[i] : '');
      }
      return obj;
    })
    .filter((obj) => obj.id); // id 없는 행은 사람이 실수로 남긴 흔적으로 본다
}

function toMatrix(schema, records) {
  return [
    schema.columns,
    ...records.map((rec) => schema.columns.map((c) => encode(schema, c, rec[c]))),
  ];
}

// ── 읽기 ────────────────────────────────────────────────────────────────────

export async function readAll() {
  const keys = Object.keys(SCHEMA);
  const ranges = keys.map((k) => `${SCHEMA[k].tab}!A1:Z`);
  ranges.push(`${META.tab}!A1:B5`);

  const query = ranges.map((r) => `ranges=${encodeURIComponent(r)}`).join('&');
  const res = await call(`/values:batchGet?${query}&majorDimension=ROWS`);

  const out = { revision: 0 };
  keys.forEach((key, i) => {
    out[key] = toObjects(SCHEMA[key], res.valueRanges?.[i]?.values);
  });

  const metaRows = res.valueRanges?.[keys.length]?.values ?? [];
  const revRow = metaRows.find((r) => String(r?.[0] ?? '').trim() === 'revision');
  out.revision = Number(revRow?.[1] ?? 0) || 0;
  return out;
}

/** 저장 직전에 리비전만 다시 읽는다 (가볍다). */
export async function readRevision() {
  const res = await call(`/values/${encodeURIComponent(`${META.tab}!A1:B5`)}`);
  const rows = res.values ?? [];
  const revRow = rows.find((r) => String(r?.[0] ?? '').trim() === 'revision');
  return Number(revRow?.[1] ?? 0) || 0;
}

// ── 쓰기 ────────────────────────────────────────────────────────────────────

/**
 * 컬렉션 하나를 통째로 다시 쓴다.
 * 행이 줄었을 때 옛 행이 남지 않도록 이전 행 수까지 빈 줄로 덮는다.
 *
 * @param {number} expectedRevision  읽어올 때의 리비전. 그 사이 남이 저장했으면 거부한다.
 * @returns {number} 새 리비전
 */
export async function writeCollection(key, records, expectedRevision, savedBy = '') {
  const schema = SCHEMA[key];
  if (!schema) throw new Error(`알 수 없는 컬렉션: ${key}`);

  const current = await readRevision();
  if (expectedRevision != null && current !== expectedRevision) {
    throw new Error(
      '다른 사람이 먼저 저장했습니다. 새로고침해 최신 내용을 받은 뒤 다시 시도하세요.'
    );
  }

  const matrix = toMatrix(schema, records);
  const padTo = Math.max(matrix.length, (previousRowCount.get(key) ?? 0) + 1);
  const width = schema.columns.length;
  while (matrix.length < padTo) matrix.push(new Array(width).fill(''));
  previousRowCount.set(key, records.length);

  const nextRevision = current + 1;
  const stamp = new Date().toISOString().slice(0, 19).replace('T', ' ');

  await call('/values:batchUpdate', {
    method: 'POST',
    body: JSON.stringify({
      valueInputOption: 'RAW',
      data: [
        { range: `${schema.tab}!A1`, values: matrix },
        { range: `${META.tab}!A1:B3`, values: [
          ['revision', String(nextRevision)],
          ['savedBy', savedBy],
          ['savedAt', stamp],
        ] },
      ],
    }),
  });

  return nextRevision;
}

/** 삭제로 행이 줄었을 때 잔여 행을 지우기 위해 직전 행 수를 기억한다. */
const previousRowCount = new Map();

export function rememberRowCounts(data) {
  for (const key of Object.keys(SCHEMA)) {
    previousRowCount.set(key, (data[key] ?? []).length);
  }
}

// ── 최초 1회: 빈 시트에 탭과 헤더를 만든다 ──────────────────────────────────

export async function bootstrap(seed) {
  const info = await call('?fields=sheets.properties.title');
  const existing = new Set((info.sheets ?? []).map((s) => s.properties.title));

  const wanted = [...Object.values(SCHEMA).map((s) => s.tab), META.tab];
  const missing = wanted.filter((t) => !existing.has(t));

  if (missing.length) {
    await call(':batchUpdate', {
      method: 'POST',
      body: JSON.stringify({
        requests: missing.map((title) => ({ addSheet: { properties: { title } } })),
      }),
    });
  }

  const data = [
    ...Object.entries(SCHEMA).map(([key, schema]) => ({
      range: `${schema.tab}!A1`,
      values: toMatrix(schema, seed[key] ?? []),
    })),
    { range: `${META.tab}!A1:B3`, values: [['revision', '1'], ['savedBy', ''], ['savedAt', '']] },
  ];

  await call('/values:batchUpdate', {
    method: 'POST',
    body: JSON.stringify({ valueInputOption: 'RAW', data }),
  });

  rememberRowCounts(seed);
  return { created: missing, revision: 1 };
}

export const _internal = { toObjects, toMatrix, decode, encode };
