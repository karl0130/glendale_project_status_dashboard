// 상세 2 — Resource Planning. 별도 입력 없이 Project Status에서 자동 산출한다.

import * as store from '../store.js';
import { chartCard, rangeNav, renderGantt, renderLegend, renderTable } from '../gantt.js';
import { el } from '../ui.js';
import {
  addMonths,
  eachDay,
  endOfMonth,
  escapeHtml,
  isWeekend,
  parseDate,
  startOfMonth,
  today,
} from '../util.js';
import { buildResourceRows } from './overview.js';

let anchor = null; // 표시 중인 달의 1일

export function render(ctx) {
  if (!anchor) anchor = startOfMonth(today());
  const start = anchor;
  const end = endOfMonth(anchor);

  const view = el('div', 'view__inner');
  view.appendChild(pageHead());
  view.appendChild(note());

  const rows = buildResourceRows(start, end);
  const util = utilization(start, end);

  const legendItems = store
    .projectsInRange(start, end, store.ACTIVE_STATUSES)
    .map((p) => ({ color: store.projectColor(p.id), label: p.name }));

  view.appendChild(
    chartCard({
      title: `인력별 투입 현황 — ${start.getFullYear()}년 ${start.getMonth() + 1}월`,
      subtitle: '한 사람의 바가 세로로 겹쳐 보이면 같은 기간에 여러 프로젝트에 투입된 상태입니다. 회색 바는 휴가입니다.',
      actions: rangeNav({
        label: `${start.getFullYear()}. ${String(start.getMonth() + 1).padStart(2, '0')}`,
        onPrev: () => {
          anchor = addMonths(anchor, -1);
          ctx.rerender();
        },
        onNext: () => {
          anchor = addMonths(anchor, 1);
          ctx.rerender();
        },
        onToday: () => {
          anchor = startOfMonth(today());
          ctx.rerender();
        },
      }),
      legend: legendItems.length ? renderLegend(legendItems) : null,
      chart: renderGantt({
        start,
        end,
        dayWidth: 30,
        labelHeader: '인력',
        rows,
        emptyText: '등록된 인력이 없습니다.',
      }),
      table: renderTable(
        [
          { key: 'name', label: '이름' },
          { key: 'role', label: '직책' },
          { key: 'projects', label: '투입 프로젝트' },
          { key: 'busy', label: '투입 영업일', align: 'right' },
          { key: 'rate', label: '가동률', align: 'right' },
        ],
        util
      ),
    })
  );

  view.appendChild(utilizationCard(util));
  return view;
}

function pageHead() {
  const head = el('div', 'page-head');
  head.innerHTML = `
    <div>
      <h1 class="page-title">Resource Planning</h1>
      <p class="page-sub">인원별 월간 투입 일정입니다. 누가 어느 프로젝트에 언제까지 들어가 있는지 확인합니다.</p>
    </div>
  `;
  return head;
}

function note() {
  return el(
    'p',
    'callout',
    '이 화면은 <strong>입력 화면이 아닙니다.</strong> Project Status에 등록된 PM·팀원·기간에서 자동으로 만들어집니다. 배정을 바꾸려면 Project Status에서 해당 프로젝트를 수정하세요.'
  );
}

/** 월 영업일 대비 투입 영업일. 휴가는 가용일에서 빼지 않고 별도 표기한다. */
function utilization(start, end) {
  const businessDays = eachDay(start, end).filter((d) => !isWeekend(d));
  const assignments = store.assignments();

  return store.employees().map((emp) => {
    const mine = assignments.filter((a) => a.employeeId === emp.id);
    const busy = businessDays.filter((day) =>
      mine.some((a) => parseDate(a.startDate) <= day && day <= parseDate(a.endDate))
    ).length;
    const names = [
      ...new Set(
        mine
          .filter((a) => parseDate(a.startDate) <= end && start <= parseDate(a.endDate))
          .map((a) => store.byId('projects', a.projectId)?.name)
          .filter(Boolean)
      ),
    ];
    const rate = businessDays.length ? Math.round((busy / businessDays.length) * 100) : 0;
    return {
      id: emp.id,
      name: emp.name,
      role: emp.role,
      projects: names.join(', ') || '—',
      busy: `${busy} / ${businessDays.length}`,
      rate: `${rate}%`,
      _rate: rate,
      _count: names.length,
    };
  });
}

/**
 * 가동률은 "한 값 대 상한"이므로 차트가 아니라 미터가 맞는 형태다.
 * 트랙은 같은 램프의 옅은 단계로 두어 채워지지 않은 구간도 함께 읽히게 한다.
 */
function utilizationCard(util) {
  const card = el('section', 'card');
  card.innerHTML = `
    <header class="card__head">
      <div class="card__titles">
        <h2 class="card__title">월간 가동률</h2>
        <p class="card__sub">해당 월 영업일 중 프로젝트에 배정된 날의 비율입니다.</p>
      </div>
    </header>
  `;
  const body = el('div', 'card__body');
  const list = el('ul', 'meters');
  for (const row of [...util].sort((a, b) => b._rate - a._rate)) {
    const item = el('li', 'meter');
    item.innerHTML = `
      <span class="meter__name">${escapeHtml(row.name)}<span class="meter__role">${escapeHtml(row.role)}</span></span>
      <span class="meter__track"><span class="meter__fill" style="width:${row._rate}%"></span></span>
      <span class="meter__value">${escapeHtml(row.rate)}</span>
      <span class="meter__note">${row._count ? `${row._count}개 프로젝트` : '미배정'}</span>
    `;
    list.appendChild(item);
  }
  body.appendChild(list);
  card.appendChild(body);
  return card;
}
