// 상세 4 — 휴가 관리. 휴가 신청 · 수정 · 삭제.
// 여기서 등록한 일정은 Overview의 금주 휴가 표와 Resource Planning 간트에 자동 반영된다.

import * as store from '../store.js';
import { chartCard, rangeNav, renderGantt, renderTable } from '../gantt.js';
import { confirmDialog, el, openForm, toast } from '../ui.js';
import {
  addDays,
  addMonths,
  endOfMonth,
  escapeHtml,
  fmtRange,
  isWeekend,
  eachDay,
  parseDate,
  startOfMonth,
  startOfWeek,
  today,
  toISO,
  uid,
} from '../util.js';
import { vacationTooltip } from './overview.js';

let anchor = null; // 표시 중인 달의 1일
let scope = 'upcoming'; // upcoming | all

export function render(ctx) {
  if (!anchor) anchor = startOfMonth(today());
  const start = anchor;
  const end = endOfMonth(anchor);

  const view = el('div', 'view__inner');
  view.appendChild(pageHead(ctx));
  view.appendChild(summaryStrip(start, end));
  view.appendChild(monthCard(ctx, start, end));
  view.appendChild(listCard(ctx));
  return view;
}

function pageHead(ctx) {
  const head = el('div', 'page-head');
  head.innerHTML = `
    <div>
      <h1 class="page-title">휴가 관리</h1>
      <p class="page-sub"><span class="subline">휴가 신청 · 수정 · 삭제</span><span class="subline">등록 즉시 Overview 금주 휴가 표와 Resource Planning 간트에 자동 반영</span></p>
    </div>
  `;
  const btn = el('button', 'btn btn--primary', '+ 휴가 신청');
  btn.addEventListener('click', () => openVacationForm(ctx, null));
  head.appendChild(btn);
  return head;
}

function summaryStrip(start, end) {
  const weekStart = startOfWeek(today());
  const weekEnd = addDays(weekStart, 6);
  const thisMonth = store.vacationsInRange(start, end);
  const thisWeek = store.vacationsInRange(weekStart, weekEnd);

  const strip = el('div', 'submit-strip');
  strip.innerHTML = `
    <span class="submit-strip__label">이번 달 <strong>${new Set(thisMonth.map((v) => v.employeeId)).size}명</strong> · ${thisMonth.length}건</span>
    <span class="submit-strip__label">금주 <strong>${new Set(thisWeek.map((v) => v.employeeId)).size}명</strong> · ${thisWeek.length}건</span>
    <span class="submit-strip__chips">
      ${store
        .employees()
        .map((e) => {
          const on = thisWeek.some((v) => v.employeeId === e.id);
          return `<span class="chip chip--${on ? 'leave' : 'pending'}">
            <span aria-hidden="true">${on ? '휴' : '·'}</span>${escapeHtml(e.name)}
          </span>`;
        })
        .join('')}
    </span>
  `;
  return strip;
}

/** 월간 휴가 간트 — 단일 시리즈라 범례 상자는 두지 않는다(제목이 이미 말해준다). */
function monthCard(ctx, start, end) {
  const rows = store.employees().map((emp) => {
    const blocks = store.vacationBlocks(emp.id).filter((v) => v.start <= end && start <= v.end);
    return {
      id: emp.id,
      label: emp.name,
      sub: emp.role,
      bars: blocks.map((v) => ({
        start: v.start,
        end: v.end,
        label: v.type,
        kind: 'vacation',
        color: 0,
        tooltip: vacationTooltip(emp.name, v),
        aria: `${emp.name} ${v.type}`,
        onClick: () => openVacationForm(ctx, store.byId('vacations', v.id)),
      })),
    };
  });

  const monthList = store
    .vacationsInRange(start, end)
    .sort((a, b) => a.startDate.localeCompare(b.startDate));

  return chartCard({
    title: `월간 휴가 현황 — ${start.getFullYear()}년 ${start.getMonth() + 1}월`,
    subtitle: '바 클릭 시 수정',
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
    chart: renderGantt({
      start,
      end,
      dayWidth: 30,
      labelHeader: '인력',
      rows,
      emptyText: '등록된 인력 없음',
    }),
    table: renderTable(
      [
        { key: 'name', label: '이름' },
        { key: 'type', label: '유형' },
        { key: 'period', label: '기간' },
        { key: 'days', label: '영업일', align: 'right' },
        { key: 'note', label: '비고' },
      ],
      monthList.map(toRow),
      '이 달에 등록된 휴가 없음'
    ),
  });
}

function toRow(v) {
  const s = parseDate(v.startDate);
  const e = parseDate(v.endDate);
  const half = v.type.startsWith('반차');
  return {
    name: store.employeeName(v.employeeId),
    role: store.byId('employees', v.employeeId)?.role ?? '',
    type: v.type,
    period: fmtRange(v.startDate, v.endDate),
    days: half ? '0.5일' : `${eachDay(s, e).filter((d) => !isWeekend(d)).length}일`,
    note: v.note || '—',
    _id: v.id,
  };
}

function listCard(ctx) {
  const now = toISO(today());
  const all = [...store.all('vacations')];
  const list = (scope === 'upcoming' ? all.filter((v) => v.endDate >= now) : all).sort((a, b) =>
    scope === 'upcoming' ? a.startDate.localeCompare(b.startDate) : b.startDate.localeCompare(a.startDate)
  );

  const card = el('section', 'card');
  card.innerHTML = `
    <header class="card__head">
      <div class="card__titles">
        <h2 class="card__title">휴가 신청 내역</h2>
        <p class="card__sub">${list.length}건 · 전체 ${all.length}건</p>
      </div>
    </header>
  `;

  const toggle = el('div', 'segmented');
  toggle.innerHTML = `
    <button type="button" class="segmented__btn${scope === 'upcoming' ? ' is-active' : ''}" data-scope="upcoming">예정 · 진행</button>
    <button type="button" class="segmented__btn${scope === 'all' ? ' is-active' : ''}" data-scope="all">전체</button>
  `;
  toggle.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-scope]');
    if (!btn) return;
    scope = btn.dataset.scope;
    ctx.rerender();
  });
  const tools = el('div', 'card__tools');
  tools.appendChild(toggle);
  card.querySelector('.card__head').appendChild(tools);

  const table = renderTable(
    [
      { key: 'name', label: '이름' },
      { key: 'role', label: '직책' },
      { key: 'type', label: '유형' },
      { key: 'period', label: '기간' },
      { key: 'days', label: '영업일', align: 'right' },
      { key: 'note', label: '비고' },
      {
        key: 'actions',
        label: '',
        align: 'right',
        html: (r) => `<span class="rowactions">
          <button type="button" class="link-btn" data-edit="${r._id}">수정</button>
          <button type="button" class="link-btn link-btn--danger" data-del="${r._id}">삭제</button>
        </span>`,
      },
    ],
    list.map(toRow),
    scope === 'upcoming' ? '예정된 휴가 없음' : '등록된 휴가 없음'
  );

  table.addEventListener('click', (e) => {
    const edit = e.target.closest('[data-edit]');
    const del = e.target.closest('[data-del]');
    if (edit) openVacationForm(ctx, store.byId('vacations', edit.dataset.edit));
    if (del && confirmDialog('이 휴가 일정을 삭제할까요?')) {
      store.remove('vacations', del.dataset.del);
      toast('삭제 완료', 'info');
      ctx.rerender();
    }
  });

  const body = el('div', 'card__body');
  body.appendChild(table);
  card.appendChild(body);
  return card;
}

export function openVacationForm(ctx, vacation) {
  const isNew = !vacation;
  openForm({
    title: isNew ? '휴가 신청' : '휴가 수정',
    subtitle: '등록 즉시 Overview와 Resource Planning에 반영',
    submitLabel: isNew ? '신청' : '저장',
    fields: [
      {
        name: 'employeeId',
        label: '신청자',
        type: 'select',
        required: true,
        options: store.employees().map((e) => ({ value: e.id, label: `${e.name} (${e.role})` })),
      },
      {
        name: 'type',
        label: '휴가 유형',
        type: 'select',
        required: true,
        options: store.VACATION_TYPES.map((t) => ({ value: t, label: t })),
      },
      { name: 'startDate', label: '시작일', type: 'date', required: true },
      {
        name: 'endDate',
        label: '종료일',
        type: 'date',
        required: true,
        hint: '하루만 쓸 경우 시작일과 같게 지정',
      },
      { name: 'note', label: '사유 / 비고', type: 'text', colspan: 2 },
    ],
    values: vacation ?? { type: '연차', startDate: toISO(today()), endDate: toISO(today()) },
    onSubmit: (data) => {
      if (data.startDate > data.endDate) throw new Error('종료일이 시작일보다 빠름');
      const clash = store
        .all('vacations')
        .find(
          (v) =>
            v.employeeId === data.employeeId &&
            v.id !== vacation?.id &&
            v.startDate <= data.endDate &&
            data.startDate <= v.endDate
        );
      if (clash) {
        throw new Error(`이미 등록된 휴가와 겹침 — ${fmtRange(clash.startDate, clash.endDate)} ${clash.type}`);
      }
      store.upsert('vacations', { id: vacation?.id ?? uid('vac'), ...data });
      anchor = startOfMonth(parseDate(data.startDate)); // 신청한 달로 화면을 옮긴다
      toast(isNew ? '휴가 신청 완료' : '저장 완료', 'good');
      ctx.rerender();
    },
  });
}
