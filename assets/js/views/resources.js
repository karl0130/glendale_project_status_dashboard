// 상세 2 — Resource Planning. 별도 입력 없이 Project Status와 휴가 관리에서 자동 산출한다.

import * as store from '../store.js';
import { chartCard, rangeNav, renderGantt, renderLegend } from '../gantt.js';
import { el } from '../ui.js';
import { addMonths, endOfMonth, startOfMonth, today } from '../util.js';
import { buildResourceRows, resourceTable } from './overview.js';

let anchor = null; // 표시 중인 달의 1일

export function render(ctx) {
  if (!anchor) anchor = startOfMonth(today());
  const start = anchor;
  const end = endOfMonth(anchor);

  const view = el('div', 'view__inner');
  view.appendChild(pageHead());
  view.appendChild(note());

  const rows = buildResourceRows(start, end);

  const legendItems = store
    .projectsInRange(start, end, store.ACTIVE_STATUSES)
    .map((p) => ({ color: store.projectColor(p.id), label: p.name }));
  legendItems.push({ color: 'vacation', label: '휴가' });

  view.appendChild(
    chartCard({
      title: `인력별 투입 현황 — ${start.getFullYear()}년 ${start.getMonth() + 1}월`,
      subtitle: [
        '프로젝트 하나가 한 줄을 차지',
        '휴가 기간에는 그 줄의 프로젝트 바가 끊기고 자리에 휴가 표시',
        '두 프로젝트 동시 진행 시 줄이 둘로 나뉘고 휴가는 양쪽 모두에 표시',
      ],
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
      legend: renderLegend(legendItems),
      chart: renderGantt({
        start,
        end,
        dayWidth: 30,
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
      <p class="page-sub">
        <span class="subline">인원별 월간 투입 일정</span>
        <span class="subline">누가 어느 프로젝트에 언제까지 투입되는지 확인</span>
      </p>
    </div>
  `;
  return head;
}

function note() {
  return el(
    'p',
    'callout',
    '<strong>입력 화면 아님</strong> · Project Status의 PM · 팀원 · 기간과 휴가 관리 일정에서 자동 생성<br>' +
      '배정 변경은 <strong>Project Status</strong>에서, 휴가 변경은 <strong>휴가 관리</strong>에서'
  );
}
