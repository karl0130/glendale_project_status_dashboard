// 메인 화면 — 2주 단위 프로젝트/리소스 간트 + 금주 휴가.

import * as store from '../store.js';
import { chartCard, rangeNav, renderGantt, renderLegend, renderTable } from '../gantt.js';
import { el } from '../ui.js';
import {
  addDays,
  eachDay,
  escapeHtml,
  fmtDate,
  fmtRange,
  parseDate,
  startOfWeek,
  today,
  weekLabel,
  workdayCount,
} from '../util.js';

let anchor = null; // 표시 중인 2주 구간의 첫 월요일

export function render(ctx) {
  if (!anchor) anchor = startOfWeek(today());
  const start = anchor;
  const end = addDays(start, 13);
  const weekStart = startOfWeek(today());
  const weekEnd = addDays(weekStart, 6);

  const view = el('div', 'view__inner');
  view.appendChild(kpiRow(weekStart, weekEnd));

  const nav = () =>
    rangeNav({
      label: `${fmtDate(start)} – ${fmtDate(end)}`,
      onPrev: () => {
        anchor = addDays(anchor, -14);
        ctx.rerender();
      },
      onNext: () => {
        anchor = addDays(anchor, 14);
        ctx.rerender();
      },
      onToday: () => {
        anchor = startOfWeek(today());
        ctx.rerender();
      },
    });

  view.appendChild(ongoingProjects(start, end, nav()));
  view.appendChild(resourcePlan(start, end, nav()));
  view.appendChild(vacationCard(weekStart, weekEnd));
  return view;
}

// ── KPI ─────────────────────────────────────────────────────────────────────

function kpiRow(weekStart, weekEnd) {
  const projects = store.projects();
  const running = projects.filter((p) => p.status === '수행중');
  const proposals = projects.filter((p) => p.status === '제안서');
  const staff = store.employees();

  const staffed = new Set(
    store
      .assignments()
      .filter((a) => parseDate(a.startDate) <= weekEnd && weekStart <= parseDate(a.endDate))
      .map((a) => a.employeeId)
  );
  const onLeave = new Set(store.vacationsInRange(weekStart, weekEnd).map((v) => v.employeeId));
  const reported = store.reportedEmployeeIds(weekStart, weekEnd);

  const tiles = [
    {
      label: '수행 중 프로젝트',
      value: running.length,
      unit: '건',
      sub: `제안 단계 ${proposals.length}건 · 전체 ${projects.length}건`,
    },
    {
      label: '금주 가동 인원',
      value: staffed.size,
      unit: `/ ${staff.length}명`,
      sub: `미배정 ${staff.length - staffed.size}명`,
    },
    {
      label: '금주 휴가 인원',
      value: onLeave.size,
      unit: '명',
      sub: weekLabel(weekStart),
    },
    {
      label: '금주 보고 제출',
      value: reported.size,
      unit: `/ ${staff.length}명`,
      sub:
        reported.size === staff.length
          ? '전원 제출 완료'
          : `미제출 ${staff
              .filter((e) => !reported.has(e.id))
              .map((e) => e.name)
              .join(', ')}`,
      tone: reported.size === staff.length ? 'good' : 'warning',
    },
  ];

  const row = el('div', 'kpi-row');
  for (const tile of tiles) {
    const node = el('div', 'stat');
    node.innerHTML = `
      <span class="stat__label">${escapeHtml(tile.label)}</span>
      <span class="stat__value">${tile.value}<span class="stat__unit">${escapeHtml(tile.unit)}</span></span>
      <span class="stat__sub${tile.tone ? ` stat__sub--${tile.tone}` : ''}">
        ${tile.tone ? `<span class="dot dot--${tile.tone}" aria-hidden="true"></span>` : ''}${escapeHtml(tile.sub)}
      </span>
    `;
    row.appendChild(node);
  }
  return row;
}

// ── 진행 프로젝트 간트 ───────────────────────────────────────────────────────

export function projectTooltip(p) {
  const members = (p.memberIds ?? []).map(store.employeeName).join(', ') || '—';
  return `
    <strong>${escapeHtml(p.client)}${p.endClient ? ` → ${escapeHtml(p.endClient)}` : ''}</strong>
    <span class="tooltip__title">${escapeHtml(p.name)}</span>
    <dl class="tooltip__list">
      <dt>상태</dt><dd>${escapeHtml(p.status)}</dd>
      <dt>PM</dt><dd>${escapeHtml(store.employeeName(p.managerId))}</dd>
      <dt>팀원</dt><dd>${escapeHtml(members)}</dd>
      <dt>기간</dt><dd>${escapeHtml(fmtRange(p.startDate, p.endDate))}</dd>
    </dl>`;
}

function ongoingProjects(start, end, nav) {
  const list = store
    .projectsInRange(start, end, store.ACTIVE_STATUSES)
    .sort((a, b) => a.startDate.localeCompare(b.startDate));

  const rows = list.map((p) => ({
    id: p.id,
    label: p.client,
    sub: p.name,
    bars: [
      {
        start: p.startDate,
        end: p.endDate,
        label: p.name,
        color: store.projectColor(p.id),
        tooltip: projectTooltip(p),
        aria: `${p.client} ${p.name}, ${fmtRange(p.startDate, p.endDate)}`,
      },
    ],
  }));

  const table = renderTable(
    [
      { key: 'client', label: '고객사' },
      { key: 'name', label: '프로젝트' },
      { key: 'status', label: '상태' },
      { key: 'pm', label: 'PM' },
      { key: 'period', label: '기간' },
      { key: 'left', label: '잔여 영업일', align: 'right' },
    ],
    list.map((p) => ({
      client: p.client,
      name: p.name,
      status: p.status,
      pm: store.employeeName(p.managerId),
      period: fmtRange(p.startDate, p.endDate),
      left: remainingWorkdays(p),
    }))
  );

  return chartCard({
    title: 'Ongoing Projects',
    subtitle: '수주·수행 중 프로젝트를 2주 구간으로 표시합니다.',
    actions: nav,
    legend: list.length ? renderLegend(list.map((p) => ({ color: store.projectColor(p.id), label: p.name }))) : null,
    chart: renderGantt({
      start,
      end,
      labelHeader: '고객사 / 프로젝트',
      rows,
      emptyText: '이 구간에 진행 중인 프로젝트가 없습니다.',
    }),
    table,
  });
}

function remainingWorkdays(p) {
  const end = parseDate(p.endDate);
  const from = today();
  if (!end || end < from) return 0;
  return workdayCount(from, end);
}

// ── 리소스 간트 ─────────────────────────────────────────────────────────────

export function buildResourceRows(start, end, { includeVacation = true } = {}) {
  const assignments = store.assignments();
  const vacations = includeVacation ? store.vacationsInRange(start, end) : [];

  return store.employees().map((emp) => {
    const mine = assignments.filter(
      (a) =>
        a.employeeId === emp.id &&
        parseDate(a.startDate) <= end &&
        start <= parseDate(a.endDate)
    );

    const bars = mine.map((a) => {
      const p = store.byId('projects', a.projectId);
      return {
        start: a.startDate,
        end: a.endDate,
        label: `${p.client} · ${p.name}`,
        color: store.projectColor(a.projectId),
        tooltip: `${projectTooltip(p)}<dl class="tooltip__list"><dt>역할</dt><dd>${a.role}</dd></dl>`,
        aria: `${emp.name}, ${p.client} ${p.name}, ${a.role}`,
      };
    });

    for (const v of vacations.filter((v) => v.employeeId === emp.id)) {
      bars.push({
        start: v.startDate,
        end: v.endDate,
        label: v.type,
        kind: 'vacation',
        color: 0,
        tooltip: `<strong>${escapeHtml(emp.name)} — ${escapeHtml(v.type)}</strong>
          <dl class="tooltip__list"><dt>기간</dt><dd>${escapeHtml(fmtRange(v.startDate, v.endDate))}</dd>
          ${v.note ? `<dt>비고</dt><dd>${escapeHtml(v.note)}</dd>` : ''}</dl>`,
        aria: `${emp.name} ${v.type} ${fmtRange(v.startDate, v.endDate)}`,
      });
    }

    return {
      id: emp.id,
      label: emp.name,
      sub: emp.role,
      badge: overloadBadge(mine, start, end),
      bars,
      _projectCount: mine.length,
    };
  });
}

/**
 * 같은 날 2개 이상 프로젝트에 물려 있으면 표시한다.
 * 색만으로 알리지 않고 아이콘 + 텍스트를 함께 붙인다(상태색 사용 규칙).
 */
function overloadBadge(assignments, start, end) {
  let peak = 0;
  for (const day of eachDay(start, end)) {
    const n = assignments.filter(
      (a) => parseDate(a.startDate) <= day && day <= parseDate(a.endDate)
    ).length;
    if (n > peak) peak = n;
  }
  if (peak >= 3) return { tone: 'critical', icon: '▲', text: `동시 ${peak}건` };
  if (peak === 2) return { tone: 'warning', icon: '●', text: '동시 2건' };
  if (peak === 0) return { tone: 'idle', icon: '○', text: '미배정' };
  return null;
}

function resourcePlan(start, end, nav) {
  const rows = buildResourceRows(start, end);
  const flat = [];
  for (const row of rows) {
    for (const bar of row.bars) {
      flat.push({
        name: row.label,
        role: row.sub,
        item: bar.label,
        kind: bar.kind === 'vacation' ? '휴가' : '프로젝트',
        period: fmtRange(
          typeof bar.start === 'string' ? bar.start : '',
          typeof bar.end === 'string' ? bar.end : ''
        ),
      });
    }
    if (!row.bars.length) {
      flat.push({ name: row.label, role: row.sub, item: '배정 없음', kind: '—', period: '—' });
    }
  }

  const legendItems = store
    .projectsInRange(start, end, store.ACTIVE_STATUSES)
    .map((p) => ({ color: store.projectColor(p.id), label: p.name }));

  return chartCard({
    title: 'Resource Planning',
    subtitle: 'Project status 입력값에서 자동 산출됩니다. 회색 바는 휴가입니다.',
    actions: nav,
    legend: legendItems.length ? renderLegend(legendItems) : null,
    chart: renderGantt({
      start,
      end,
      labelHeader: '인력',
      rows,
      emptyText: '등록된 인력이 없습니다.',
    }),
    table: renderTable(
      [
        { key: 'name', label: '이름' },
        { key: 'role', label: '직책' },
        { key: 'kind', label: '구분' },
        { key: 'item', label: '내용' },
        { key: 'period', label: '기간' },
      ],
      flat
    ),
  });
}

// ── 금주 휴가 ───────────────────────────────────────────────────────────────

function vacationCard(weekStart, weekEnd) {
  const list = store
    .vacationsInRange(weekStart, weekEnd)
    .sort((a, b) => a.startDate.localeCompare(b.startDate));

  const rows = list.map((v) => {
    const s = parseDate(v.startDate);
    const e = parseDate(v.endDate);
    const inWeek = eachDay(s > weekStart ? s : weekStart, e < weekEnd ? e : weekEnd);
    const half = v.type.startsWith('반차');
    return {
      name: store.employeeName(v.employeeId),
      role: store.byId('employees', v.employeeId)?.role ?? '',
      type: v.type,
      period: fmtRange(v.startDate, v.endDate),
      days: half ? '0.5일' : `${inWeek.filter((d) => d.getDay() !== 0 && d.getDay() !== 6).length}일`,
      note: v.note || '—',
    };
  });

  const card = el('section', 'card');
  card.innerHTML = `
    <header class="card__head">
      <div class="card__titles">
        <h2 class="card__title">금주 휴가</h2>
        <p class="card__sub">${escapeHtml(weekLabel(weekStart))} (월–일) 기준 · 총 ${new Set(list.map((v) => v.employeeId)).size}명</p>
      </div>
    </header>
  `;
  const body = el('div', 'card__body');
  body.appendChild(
    renderTable(
      [
        { key: 'name', label: '이름' },
        { key: 'role', label: '직책' },
        { key: 'type', label: '휴가 유형' },
        { key: 'period', label: '일정' },
        { key: 'days', label: '영업일', align: 'right' },
        { key: 'note', label: '비고' },
      ],
      rows,
      '금주 등록된 휴가가 없습니다.'
    )
  );
  card.appendChild(body);
  return card;
}
