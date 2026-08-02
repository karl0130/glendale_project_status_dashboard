// 상세 2 — Resource Planning. 별도 입력 없이 Project Status와 휴가 관리에서 자동 산출한다.
// 구간은 Project Status의 프로젝트 일정과 동일한 4주 기준이다.

import * as store from '../store.js';
import { chartCard, rangeNav, renderGantt, renderLegend } from '../gantt.js';
import { el } from '../ui.js';
import { addDays, fmtDate, startOfWeek, today } from '../util.js';
import { buildResourceRows, resourceTable } from './overview.js';

let anchor = null; // 표시 중인 4주 구간의 첫 월요일

export function render(ctx) {
  if (!anchor) anchor = startOfWeek(today());
  const start = anchor;
  const end = addDays(start, 27); // 4주

  const view = el('div', 'view__inner');
  view.appendChild(pageHead());

  const rows = buildResourceRows(start, end);

  const legendItems = store
    .projectsInRange(start, end, store.ACTIVE_STATUSES)
    .map((p) => ({ color: store.projectColor(p.id), label: p.name }));
  legendItems.push({ color: 'vacation', label: '휴가' });

  view.appendChild(
    chartCard({
      title: '인력별 투입 현황 (4주)',
      actions: rangeNav({
        label: `${fmtDate(start)} – ${fmtDate(end)}`,
        onPrev: () => {
          anchor = addDays(anchor, -28);
          ctx.rerender();
        },
        onNext: () => {
          anchor = addDays(anchor, 28);
          ctx.rerender();
        },
        onToday: () => {
          anchor = startOfWeek(today());
          ctx.rerender();
        },
      }),
      legend: renderLegend(legendItems),
      chart: renderGantt({
        start,
        end,
        dayWidth: 26,
        labelHeader: '인력',
        rows,
        uniformRows: true, // 사람마다 투입 프로젝트 수가 달라도 행 높이는 동일하게
        emptyText: '등록된 인력 없음',
      }),
      table: resourceTable(rows, start, end),
    })
  );

  return view;
}

function pageHead() {
  const head = el('div', 'page-head');
  head.innerHTML = `
    <div>
      <h1 class="page-title">Resource Planning</h1>
      <p class="page-sub">인원별 담당 프로젝트 및 일정 관리</p>
    </div>
  `;
  return head;
}
