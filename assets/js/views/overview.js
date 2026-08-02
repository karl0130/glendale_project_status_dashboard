// 메인 화면 — 상단(핵심 지표 2 + 금주 휴가), 2주 단위 프로젝트/리소스 간트.

import * as store from '../store.js';
import { chartCard, rangeNav, renderGantt, renderLegend, renderTable } from '../gantt.js';
import { el } from '../ui.js';
import {
  addDays,
  diffDays,
  eachDay,
  escapeHtml,
  fmtDate,
  fmtRange,
  intersectRange,
  parseDate,
  startOfWeek,
  subtractRanges,
  today,
  weekLabel,
  weekSpan,
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

  // 상단: 왼쪽에 지표 2개(세로), 오른쪽에 같은 높이로 금주 휴가.
  const top = el('div', 'overview-top');
  top.appendChild(kpiColumn(weekStart, weekEnd));
  top.appendChild(vacationCard(weekStart, weekEnd));
  view.appendChild(top);

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
  return view;
}

// ── 핵심 지표 ───────────────────────────────────────────────────────────────

function kpiColumn(weekStart, weekEnd) {
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
      sub: `미배정 ${staff.length - staffed.size}명 · ${weekLabel(weekStart)}`,
    },
  ];

  const column = el('div', 'overview-top__stats');
  for (const tile of tiles) {
    const node = el('div', 'stat');
    node.innerHTML = `
      <span class="stat__label">${escapeHtml(tile.label)}</span>
      <span class="stat__value">${tile.value}<span class="stat__unit">${escapeHtml(tile.unit)}</span></span>
      <span class="stat__sub">${escapeHtml(tile.sub)}</span>
    `;
    column.appendChild(node);
  }
  return column;
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
      type: v.type,
      period: fmtRange(v.startDate, v.endDate),
      days: half ? '0.5일' : `${inWeek.filter((d) => d.getDay() !== 0 && d.getDay() !== 6).length}일`,
      note: v.note || '—',
    };
  });

  const card = el('section', 'card card--fill');
  card.innerHTML = `
    <header class="card__head">
      <div class="card__titles">
        <h2 class="card__title">금주 휴가</h2>
        <p class="card__sub">${escapeHtml(weekLabel(weekStart))} (월–일) 기준 · 총 ${new Set(list.map((v) => v.employeeId)).size}명</p>
      </div>
    </header>
  `;
  const body = el('div', 'card__body card__body--scroll');
  body.appendChild(
    renderTable(
      [
        { key: 'name', label: '이름' },
        { key: 'type', label: '휴가 유형' },
        { key: 'period', label: '일정' },
        { key: 'days', label: '영업일', align: 'right' },
        { key: 'note', label: '비고' },
      ],
      rows,
      '금주 등록된 휴가 없음'
    )
  );
  card.appendChild(body);
  return card;
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

/**
 * 프로젝트 바 라벨 — 이름 뒤에 전체 기간을 주 단위로 붙인다.
 * 화면에 보이는 구간이 아니라 프로젝트 전체 길이라서, 2주·4주 어느 구간을 보고 있어도
 * 같은 값이 나온다.
 */
export function barLabel(p) {
  const weeks = weekSpan(p.startDate, p.endDate);
  return weeks ? `${p.name} (${weeks}w)` : p.name;
}

export function vacationTooltip(name, block) {
  return `<strong>${escapeHtml(name)} — ${escapeHtml(block.type)}</strong>
    <dl class="tooltip__list">
      <dt>기간</dt><dd>${escapeHtml(fmtDate(block.start))}${block.start.getTime() === block.end.getTime() ? '' : ` – ${escapeHtml(fmtDate(block.end))}`}</dd>
      ${block.note ? `<dt>비고</dt><dd>${escapeHtml(block.note)}</dd>` : ''}
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
        label: barLabel(p),
        color: store.projectColor(p.id),
        tooltip: projectTooltip(p),
        aria: `${p.client} ${p.name}, ${fmtRange(p.startDate, p.endDate)}`,
      },
    ],
  }));

  return chartCard({
    title: 'Ongoing Projects',
    subtitle: '수주 · 수행 중 프로젝트 2주 구간',
    actions: nav,
    legend: list.length
      ? renderLegend(list.map((p) => ({ color: store.projectColor(p.id), label: p.name })))
      : null,
    chart: renderGantt({
      start,
      end,
      labelHeader: '고객사 / 프로젝트',
      rows,
      emptyText: '이 구간에 진행 중인 프로젝트 없음',
    }),
    table: renderTable(
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
    ),
  });
}

function remainingWorkdays(p) {
  const end = parseDate(p.endDate);
  const from = today();
  if (!end || end < from) return 0;
  return workdayCount(from, end);
}

// ── 리소스 간트 ─────────────────────────────────────────────────────────────

/**
 * 인원별 행. 프로젝트 하나가 한 레인(줄)을 차지하고, 그 사람이 휴가인 날에는
 * 프로젝트 바가 끊기고 같은 줄 그 자리에 휴가 블록이 들어간다.
 * 동시에 2개 프로젝트면 줄이 2개가 되고, 휴가는 두 줄 모두에서 치환된다.
 */
export function buildResourceRows(start, end) {
  const assignments = store.assignments();

  return store.employees().map((emp) => {
    const mine = assignments.filter(
      (a) =>
        a.employeeId === emp.id && parseDate(a.startDate) <= end && start <= parseDate(a.endDate)
    );
    const vacations = store.vacationBlocks(emp.id);
    const bars = [];

    mine.forEach((a, lane) => {
      const p = store.byId('projects', a.projectId);
      const aStart = parseDate(a.startDate);
      const aEnd = parseDate(a.endDate);

      // 이 배정 기간과 겹치는 휴가만 잘라낸다.
      const blocks = vacations
        .map((v) => {
          const hit = intersectRange(v.start, v.end, aStart, aEnd);
          return hit ? { ...v, ...hit } : null;
        })
        .filter(Boolean);

      // 휴가로 쪼개진 조각마다 이름을 붙이면 짧은 조각의 라벨이 옆 블록 위로 밀려
      // 겹쳐 읽힌다. 가장 넓은 조각 하나만 라벨을 갖는다 (나머지는 툴팁·표에 그대로).
      const segments = subtractRanges(aStart, aEnd, blocks);
      const labelled = widestIndex(segments, start, end);

      segments.forEach((seg, i) => {
        bars.push({
          start: seg.start,
          end: seg.end,
          lane,
          label: i === labelled ? `${p.client} · ${p.name}` : '',
          color: store.projectColor(a.projectId),
          tooltip: `${projectTooltip(p)}<dl class="tooltip__list"><dt>역할</dt><dd>${a.role}</dd></dl>`,
          aria: `${emp.name}, ${p.client} ${p.name}, ${a.role}`,
        });
      });
      for (const block of blocks) {
        bars.push({
          start: block.start,
          end: block.end,
          lane,
          label: block.type,
          kind: 'vacation',
          color: 0,
          tooltip: vacationTooltip(emp.name, block),
          aria: `${emp.name} ${block.type}`,
        });
      }
    });

    // 배정이 하나도 없어도 휴가는 보여야 한다.
    if (!mine.length) {
      for (const v of vacations.filter((v) => v.start <= end && start <= v.end)) {
        bars.push({
          start: v.start,
          end: v.end,
          lane: 0,
          label: v.type,
          kind: 'vacation',
          color: 0,
          tooltip: vacationTooltip(emp.name, v),
          aria: `${emp.name} ${v.type}`,
        });
      }
    }

    return {
      id: emp.id,
      label: emp.name,
      sub: emp.role,
      badge: overloadBadge(mine, start, end),
      bars,
      _assignments: mine,
    };
  });
}

/**
 * 라벨을 달 조각의 인덱스.
 * 길이는 반드시 '화면에 보이는 구간으로 자른 뒤' 재야 한다 — 전체 기간 기준으로 고르면
 * 지금 보이지도 않는 조각이 뽑혀 화면의 바가 전부 무명이 된다.
 * 길이가 같으면 뒤쪽(오른쪽 여백이 있을 가능성이 큰 쪽)을 고르고, 보이는 조각이 없으면 -1.
 */
export function widestIndex(segments, start, end) {
  let best = -1;
  let bestLen = -1;
  segments.forEach((seg, i) => {
    const visible = intersectRange(seg.start, seg.end, start, end);
    if (!visible) return;
    const len = diffDays(visible.start, visible.end);
    if (len >= bestLen) {
      bestLen = len;
      best = i;
    }
  });
  return best;
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

/** 리소스 간트의 표 보기 — 배정과 휴가를 그대로 나열한다. */
export function resourceTable(rows, start, end) {
  const flat = [];
  for (const row of rows) {
    for (const a of row._assignments) {
      const p = store.byId('projects', a.projectId);
      flat.push({
        name: row.label,
        role: row.sub,
        kind: '프로젝트',
        item: `${p.client} · ${p.name}`,
        detail: a.role,
        period: fmtRange(a.startDate, a.endDate),
      });
    }
    for (const v of store.vacationBlocks(row.id).filter((v) => v.start <= end && start <= v.end)) {
      flat.push({
        name: row.label,
        role: row.sub,
        kind: '휴가',
        item: v.type,
        detail: v.note || '—',
        period: `${fmtDate(v.start)}${v.start.getTime() === v.end.getTime() ? '' : ` – ${fmtDate(v.end)}`}`,
      });
    }
    if (!row._assignments.length && !row.bars.length) {
      flat.push({ name: row.label, role: row.sub, kind: '—', item: '배정 없음', detail: '—', period: '—' });
    }
  }
  return renderTable(
    [
      { key: 'name', label: '이름' },
      { key: 'role', label: '직책' },
      { key: 'kind', label: '구분' },
      { key: 'item', label: '내용' },
      { key: 'detail', label: '역할 / 비고' },
      { key: 'period', label: '기간' },
    ],
    flat
  );
}

function resourcePlan(start, end, nav) {
  const rows = buildResourceRows(start, end);
  const legendItems = store
    .projectsInRange(start, end, store.ACTIVE_STATUSES)
    .map((p) => ({ color: store.projectColor(p.id), label: p.name }));
  legendItems.push({ color: 'vacation', label: '휴가' });

  return chartCard({
    title: 'Resource Planning',
    subtitle: [
      'Project Status 입력값에서 자동 산출',
      '휴가 기간에는 프로젝트 바가 끊기고 그 자리에 휴가 표시',
    ],
    actions: nav,
    legend: renderLegend(legendItems),
    chart: renderGantt({
      start,
      end,
      labelHeader: '인력',
      rows,
      emptyText: '등록된 인력 없음',
    }),
    table: resourceTable(rows, start, end),
  });
}
