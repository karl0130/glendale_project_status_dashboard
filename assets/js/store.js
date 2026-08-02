// 데이터 스토어.
//
// 저장 구조는 2계층이다:
//   1) data/*.json  — 레포에 커밋된 "공식" 데이터. 모두가 보는 값.
//   2) localStorage — 이 브라우저에서 입력/수정한 값이 위에 덮어씌워진다.
//
// GitHub Pages에는 서버가 없으므로 브라우저의 입력이 저절로 공유되지는 않는다.
// 공유하려면 '데이터 관리' 화면에서 JSON을 내보내 data/ 아래에 커밋해야 한다.

import { byKo, parseDate, toISO, today } from './util.js';

const SOURCES = {
  employees: 'data/employees.json',
  projects: 'data/projects.json',
  vacations: 'data/vacations.json',
  weeklyUpdates: 'data/weekly-updates.json',
};

export const FILENAMES = {
  employees: 'employees.json',
  projects: 'projects.json',
  vacations: 'vacations.json',
  weeklyUpdates: 'weekly-updates.json',
};

export const PROJECT_STATUSES = ['제안서', '수주', '수행중', '보류', '종료'];
export const TASK_STATUSES = ['진행중', '완료', '지연'];
export const VACATION_TYPES = ['연차', '반차(오전)', '반차(오후)', '경조휴가', '공가', '기타'];

/** 활성으로 간주하는 상태 — Overview·Resource 화면의 기본 필터 */
export const ACTIVE_STATUSES = ['수주', '수행중'];

const LS_KEY = 'glendale-dashboard/v1';

const state = {
  base: null, // 서버(레포) 원본
  data: null, // 로컬 수정이 반영된 현재 값
  loaded: false,
};

const listeners = new Set();

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function emit() {
  listeners.forEach((fn) => fn());
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

export async function load() {
  const entries = await Promise.all(
    Object.entries(SOURCES).map(async ([key, path]) => {
      const res = await fetch(`${path}?v=${Date.now()}`, { cache: 'no-store' });
      if (!res.ok) throw new Error(`${path} 를 불러오지 못했습니다 (HTTP ${res.status})`);
      return [key, await res.json()];
    })
  );
  state.base = Object.fromEntries(entries);
  state.data = clone(state.base);

  const raw = localStorage.getItem(LS_KEY);
  if (raw) {
    try {
      const local = JSON.parse(raw);
      for (const key of Object.keys(SOURCES)) {
        if (Array.isArray(local[key])) state.data[key] = local[key];
      }
    } catch {
      // 손상된 로컬 데이터는 조용히 버리고 서버 값으로 진행한다.
      localStorage.removeItem(LS_KEY);
    }
  }
  state.loaded = true;
  emit();
}

function persist() {
  localStorage.setItem(LS_KEY, JSON.stringify(state.data));
  emit();
}

export function all(collection) {
  return state.data?.[collection] ?? [];
}

export function byId(collection, id) {
  return all(collection).find((row) => row.id === id) ?? null;
}

export function upsert(collection, record) {
  const list = state.data[collection];
  const index = list.findIndex((row) => row.id === record.id);
  if (index >= 0) list[index] = { ...list[index], ...record };
  else list.push(record);
  persist();
  return record;
}

export function remove(collection, id) {
  state.data[collection] = state.data[collection].filter((row) => row.id !== id);
  persist();
}

export function hasLocalChanges() {
  if (!state.loaded) return false;
  return JSON.stringify(state.base) !== JSON.stringify(state.data);
}

export function changedCollections() {
  if (!state.loaded) return [];
  return Object.keys(SOURCES).filter(
    (key) => JSON.stringify(state.base[key]) !== JSON.stringify(state.data[key])
  );
}

export function exportJSON(collection) {
  return `${JSON.stringify(state.data[collection], null, 2)}\n`;
}

export function importJSON(collection, text) {
  const parsed = JSON.parse(text);
  if (!Array.isArray(parsed)) throw new Error('최상위가 배열인 JSON이어야 합니다.');
  state.data[collection] = parsed;
  persist();
}

export function resetToRepo() {
  state.data = clone(state.base);
  localStorage.removeItem(LS_KEY);
  emit();
}

// ── 조회 헬퍼 ────────────────────────────────────────────────────────────────

export function employees() {
  return all('employees').filter((e) => e.active !== false);
}

export function employeeName(id) {
  return byId('employees', id)?.name ?? '—';
}

export function projects() {
  return all('projects');
}

export function projectLabel(id) {
  const p = byId('projects', id);
  return p ? `${p.client} · ${p.name}` : '—';
}

/** 프로젝트에 참여하는 전원 (PM + 팀원), 중복 제거 */
export function projectMembers(project) {
  return [...new Set([project.managerId, ...(project.memberIds ?? [])])].filter(Boolean);
}

/**
 * 프로젝트 → 색상 슬롯(1..8).
 * 색은 "프로젝트라는 개체"를 따라가며 화면·필터가 바뀌어도 절대 재배정하지 않는다.
 * (필터 결과 순서로 색을 주면 읽는 사람이 학습한 색-프로젝트 연결이 깨진다.)
 * id 순으로 고정 배정하고, 9개째부터는 색을 새로 만들지 않고 중립 회색으로 접는다.
 */
let colorMap = null;
export function projectColor(projectId) {
  if (!colorMap) {
    colorMap = new Map();
    [...projects()]
      .sort((a, b) => byKo(a.id, b.id))
      .forEach((p, i) => colorMap.set(p.id, i < 8 ? i + 1 : 0));
  }
  return colorMap.get(projectId) ?? 0;
}
subscribe(() => {
  colorMap = null;
});

/** 특정 기간에 걸치는 프로젝트 */
export function projectsInRange(start, end, statuses = null) {
  return projects().filter((p) => {
    if (statuses && !statuses.includes(p.status)) return false;
    const s = parseDate(p.startDate);
    const e = parseDate(p.endDate);
    return s && e && s <= end && start <= e;
  });
}

/** 특정 기간에 걸치는 휴가 */
export function vacationsInRange(start, end) {
  return all('vacations').filter((v) => {
    const s = parseDate(v.startDate);
    const e = parseDate(v.endDate);
    return s && e && s <= end && start <= e;
  });
}

/** 특정 기간에 걸치는 주간 업무 */
export function updatesInRange(start, end) {
  return all('weeklyUpdates').filter((u) => {
    const s = parseDate(u.startDate);
    const e = parseDate(u.endDate);
    return s && e && s <= end && start <= e;
  });
}

/**
 * Resource planning의 원천. 별도 입력 없이 Project status 표에서 자동 산출한다.
 * 한 사람이 같은 날 2개 이상 프로젝트에 물려 있으면 overlap으로 표시된다.
 */
export function assignments(statuses = ACTIVE_STATUSES) {
  const out = [];
  for (const p of projects()) {
    if (statuses && !statuses.includes(p.status)) continue;
    for (const empId of projectMembers(p)) {
      out.push({
        employeeId: empId,
        projectId: p.id,
        role: p.managerId === empId ? 'PM' : 'Member',
        startDate: p.startDate,
        endDate: p.endDate,
      });
    }
  }
  return out;
}

/** 주간보고 제출 여부 (해당 주에 1건 이상 기록했는지) */
export function reportedEmployeeIds(weekStart, weekEnd) {
  return new Set(updatesInRange(weekStart, weekEnd).map((u) => u.employeeId));
}

export function stampMeta(record, employeeId) {
  return { ...record, updatedAt: toISO(today()), updatedBy: employeeId ?? record.updatedBy ?? '' };
}
