// 데이터 스토어.
//
// 데이터 출처는 두 가지다.
//
//   local   — 구글 로그인 전. data/*.json 을 읽고 수정분은 localStorage 에만 쌓인다.
//             다른 사람에게 공유되지 않는다.
//   sheets  — 구글 로그인 후. Google Sheets 가 유일한 원본이고, 저장하면 즉시 팀에 반영된다.
//
// 화면 코드는 이 차이를 몰라도 된다. all / byId / upsert / remove 만 쓰면 된다.

import * as auth from './google/auth.js';
import * as sheets from './google/sheets.js';
import { COLLECTIONS, LEAVE_POLICY } from './config.js';
import { businessDays, setHolidays } from './holidays.js';
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
  source: 'local', // local | sheets
  base: null, // 레포에 커밋된 원본 (local 모드의 기준선)
  remote: null, // 시트에서 마지막으로 읽은 값 (sheets 모드의 기준선)
  data: null, // 화면이 보고 있는 현재 값
  revision: 0,
  loaded: false,
  saveState: 'idle', // idle | saving | saved | error
  saveError: '',
  sheetStatus: 'disconnected', // disconnected | needs-bootstrap
  missingTabs: [],
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

// ── 로드 ────────────────────────────────────────────────────────────────────

export async function load() {
  // 공휴일은 영업일 계산의 전제라 먼저 채운다. 없어도 화면은 돌아야 하므로 실패는 삼킨다.
  try {
    const res = await fetch(`data/holidays.json?v=${Date.now()}`, { cache: 'no-store' });
    if (res.ok) setHolidays((await res.json()).days);
  } catch {
    console.warn('공휴일 데이터를 불러오지 못했습니다 — 주말만 제외해 계산합니다');
  }

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
      for (const key of COLLECTIONS) {
        if (Array.isArray(local[key])) state.data[key] = local[key];
      }
    } catch {
      localStorage.removeItem(LS_KEY);
    }
  }
  state.loaded = true;
  emit();
}

/**
 * 시트에 연결한다.
 *
 * 탭이 아직 없는 빈 스프레드시트일 수 있으므로, 읽기 전에 탭 존재 여부부터 확인한다.
 * 없으면 sheets 모드로 넘어가지 않는다 — 빈 시트를 원본으로 삼으면 화면이 비어 보이고,
 * 그 상태에서 뭔가 저장하면 빈 데이터가 시트에 박힌다.
 *
 * @param {boolean} interactive  true 면 로그인 팝업을 띄운다 (사용자 클릭에서만 호출할 것)
 * @returns {false | 'needs-bootstrap' | true}
 */
export async function connect({ interactive = false } = {}) {
  if (!auth.isConfigured()) throw new Error('config.js 에 clientId / spreadsheetId 가 없습니다');
  if (interactive) await auth.signIn();
  else if (!(await auth.restore())) return false;

  const missing = sheets.missingTabs(await sheets.listTabs());
  if (missing.length) {
    state.sheetStatus = 'needs-bootstrap';
    state.missingTabs = missing;
    emit();
    return 'needs-bootstrap';
  }

  await pull();
  return true;
}

export function sheetStatus() {
  if (state.source === 'sheets') return 'connected';
  return state.sheetStatus; // disconnected | needs-bootstrap
}

export function missingTabs() {
  return state.missingTabs;
}

/** 시트에서 다시 읽어온다. 로컬 수정분은 버려진다. */
export async function pull() {
  const remote = await sheets.readAll();
  state.revision = remote.revision;
  delete remote.revision;
  state.remote = clone(remote);
  state.data = clone(remote);
  state.source = 'sheets';
  state.sheetStatus = 'connected';
  state.missingTabs = [];
  sheets.rememberRowCounts(remote);
  localStorage.setItem(LS_KEY, JSON.stringify(state.data)); // 다음 진입 때 즉시 렌더용 캐시
  setSaveState('idle');
  emit();
  return remote;
}

export function disconnect() {
  auth.signOut();
  state.source = 'local';
  state.sheetStatus = 'disconnected';
  state.missingTabs = [];
  state.remote = null;
  state.revision = 0;
  setSaveState('idle');
  emit();
}

export function source() {
  return state.source;
}

export function account() {
  return auth.currentAccount();
}

export function isSignedIn() {
  return auth.isSignedIn();
}

export function revision() {
  return state.revision;
}

// ── 저장 상태 ───────────────────────────────────────────────────────────────

function setSaveState(next, message = '') {
  state.saveState = next;
  state.saveError = message;
  emit();
}

export function saveState() {
  return { status: state.saveState, message: state.saveError };
}

/** 저장 요청이 겹쳐도 순서대로 처리되도록 직렬화한다. */
let chain = Promise.resolve();

function enqueue(task) {
  const run = chain.then(task, task);
  chain = run.catch(() => {});
  return run;
}

/** 저장에 실패한 컬렉션. 재로그인 후 이어서 다시 밀어넣는다. */
const pending = new Set();

function pushCollection(key) {
  return enqueue(async () => {
    setSaveState('saving');
    try {
      state.revision = await sheets.writeCollection(
        key,
        state.data[key],
        state.revision,
        auth.currentAccount()?.email ?? ''
      );
      state.remote[key] = clone(state.data[key]);
      pending.delete(key);
      setSaveState(pending.size ? 'error' : 'saved');
    } catch (err) {
      pending.add(key);
      // 세션 만료는 "저장 실패"와 다르다. 사용자가 할 일이 재시도가 아니라 로그인이다.
      setSaveState(err.name === 'ReauthRequired' ? 'reauth' : 'error', err.message);
    }
  });
}

export function hasPendingSaves() {
  return pending.size > 0;
}

/** 재로그인한 뒤 못 보낸 저장을 이어서 처리한다. */
export async function reauthAndRetry() {
  await auth.signIn();
  const keys = [...pending];
  for (const key of keys) await pushCollection(key);
  return pending.size === 0;
}

/** 화면에 들고 있는 데이터가 한 건도 없는지 (= 시트가 비어 있는 상태로 연결됨). */
export function isEmpty() {
  return COLLECTIONS.every((key) => (state.data?.[key] ?? []).length === 0);
}

/**
 * 빈 스프레드시트에 탭·헤더를 만들고 데이터를 밀어넣는다 (최초 1회).
 *
 * 씨앗은 화면에 들고 있는 데이터다. 다만 빈 시트에 연결된 상태라면 그 데이터도 비어 있어서
 * 빈 헤더만 만들고 끝나버린다 — 그 경우에는 레포의 표본 데이터로 채운다.
 */
export async function bootstrapSheet() {
  const seed = isEmpty() ? state.base : state.data;
  const result = await sheets.bootstrap(seed);
  await pull();
  return result;
}

function persist() {
  localStorage.setItem(LS_KEY, JSON.stringify(state.data));
  emit();
}

// ── 조회 · 변경 ─────────────────────────────────────────────────────────────

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
  if (state.source === 'sheets') pushCollection(collection);
  return record;
}

export function remove(collection, id) {
  state.data[collection] = state.data[collection].filter((row) => row.id !== id);
  persist();
  if (state.source === 'sheets') pushCollection(collection);
}

// ── 변경 감지 · 내보내기 (local 모드에서 쓰는 기능) ─────────────────────────

function baseline() {
  return state.source === 'sheets' ? state.remote : state.base;
}

export function hasLocalChanges() {
  if (!state.loaded || !baseline()) return false;
  return JSON.stringify(baseline()) !== JSON.stringify(state.data);
}

export function changedCollections() {
  const ref = baseline();
  if (!state.loaded || !ref) return [];
  return COLLECTIONS.filter((key) => JSON.stringify(ref[key]) !== JSON.stringify(state.data[key]));
}

export function exportJSON(collection) {
  return `${JSON.stringify(state.data[collection], null, 2)}\n`;
}

export function importJSON(collection, text) {
  const parsed = JSON.parse(text);
  if (!Array.isArray(parsed)) throw new Error('최상위가 배열인 JSON이어야 합니다.');
  state.data[collection] = parsed;
  persist();
  if (state.source === 'sheets') pushCollection(collection);
}

export function resetToRepo() {
  state.data = clone(state.base);
  state.source = 'local';
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

/** 로그인한 구글 계정에 해당하는 직원. employees 의 email 열로 맞춘다. */
export function currentEmployee() {
  const email = auth.currentAccount()?.email;
  if (!email) return null;
  return employees().find((e) => (e.email || '').toLowerCase() === email) ?? null;
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

// ── 휴가 승인 · 연차 ────────────────────────────────────────────────────────

export const VACATION_STATUSES = ['신청', '승인', '반려'];

/** 상태가 비어 있는 옛 기록은 이미 확정된 일정으로 본다. */
export function vacationStatus(v) {
  return v?.status || '승인';
}

/** 승인 여부와 무관하게 일정으로 잡힌 것 (반려만 제외). */
function isScheduled(v) {
  return vacationStatus(v) !== '반려';
}

export function canApprove(employee) {
  return Boolean(employee?.canApprove);
}

/** 이 사람의 휴가를 승인 없이 바로 확정해도 되는가 (승인권자 본인). */
export function selfApproves(employee) {
  return canApprove(employee);
}

/**
 * 이 휴가가 연차에서 깎는 일수.
 * 공가 등 면제 유형은 0, 반차는 기간과 무관하게 0.5, 나머지는 영업일 수.
 */
export function leaveCost(v) {
  if (LEAVE_POLICY.exempt.includes(v.type)) return 0;
  if (LEAVE_POLICY.halfDayTypes.includes(v.type)) return 0.5;
  // 주말뿐 아니라 공휴일도 빠진다. 광복절 끼고 휴가를 내면 그날은 차감되지 않는다.
  return businessDays(parseDate(v.startDate), parseDate(v.endDate));
}

/**
 * 입사일 기준 현재 연차 산정 기간. 사람마다 갱신 시점이 다르다.
 * 입사일이 없으면 회계연도(1/1~12/31)로 대체한다.
 */
export function leaveYear(employee, ref = today()) {
  const join = parseDate(employee?.joinDate);
  if (!join) {
    return { start: new Date(ref.getFullYear(), 0, 1), end: new Date(ref.getFullYear(), 11, 31) };
  }
  let start = new Date(ref.getFullYear(), join.getMonth(), join.getDate());
  if (start > ref) start = new Date(ref.getFullYear() - 1, join.getMonth(), join.getDate());
  const end = new Date(start.getFullYear() + 1, start.getMonth(), start.getDate() - 1);
  return { start, end };
}

/**
 * 연차 잔여 현황.
 * 승인분과 대기분을 따로 센다 — 대기분만 보고 있으면 반려됐을 때 되돌려야 하고,
 * 승인분만 보면 신청해둔 것을 잊고 초과 신청하게 된다.
 */
export function leaveBalance(employeeId, ref = today()) {
  const emp = byId('employees', employeeId);
  const total = emp?.annualLeave ?? LEAVE_POLICY.defaultAnnual;
  const period = leaveYear(emp, ref);

  const mine = all('vacations').filter((v) => {
    if (v.employeeId !== employeeId) return false;
    const s = parseDate(v.startDate);
    return s && s >= period.start && s <= period.end;
  });

  const sum = (rows) => rows.reduce((acc, v) => acc + leaveCost(v), 0);
  const used = sum(mine.filter((v) => vacationStatus(v) === '승인'));
  const pendingDays = sum(mine.filter((v) => vacationStatus(v) === '신청'));
  const exempt = sum(mine.filter((v) => LEAVE_POLICY.exempt.includes(v.type))); // 항상 0
  void exempt;

  return {
    total,
    used,
    pending: pendingDays,
    remaining: Math.max(0, total - used - pendingDays),
    period,
    records: mine,
  };
}

/** 승인 대기 중인 전체 신청 (승인권자 화면용). */
export function pendingVacations() {
  return all('vacations')
    .filter((v) => vacationStatus(v) === '신청')
    .sort((a, b) => a.startDate.localeCompare(b.startDate));
}

export function decideVacation(id, decision, decidedByEmployeeId, note = '') {
  const v = byId('vacations', id);
  if (!v) throw new Error('휴가 기록을 찾을 수 없습니다');
  upsert('vacations', {
    ...v,
    status: decision,
    decidedBy: decidedByEmployeeId ?? '',
    decidedAt: toISO(today()),
    decisionNote: note,
  });
}

/** 특정 기간에 걸치는 휴가 (반려된 건 일정에서 뺀다) */
export function vacationsInRange(start, end) {
  return all('vacations').filter((v) => {
    if (!isScheduled(v)) return false;
    const s = parseDate(v.startDate);
    const e = parseDate(v.endDate);
    return s && e && s <= end && start <= e;
  });
}

/**
 * 특정 인원의 휴가 구간 전체(Date 범위).
 * 프로젝트/업무 바를 이 구간에서 끊고 그 자리에 휴가 블록을 끼워 넣는 데 쓴다.
 */
export function vacationBlocks(employeeId) {
  return all('vacations')
    .filter((v) => v.employeeId === employeeId && isScheduled(v))
    .map((v) => ({
      id: v.id,
      start: parseDate(v.startDate),
      end: parseDate(v.endDate),
      type: v.type,
      note: v.note ?? '',
      status: vacationStatus(v),
      pending: vacationStatus(v) === '신청',
    }))
    .filter((v) => v.start && v.end)
    .sort((a, b) => a.start - b.start);
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
