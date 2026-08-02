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
  parseDate,
  startOfMonth,
  startOfWeek,
  today,
  toISO,
  uid,
} from '../util.js';
import { businessDays } from '../holidays.js';
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

// 이 화면은 조회 전용이다. 신청 · 수정 · 삭제는 전부 My Page 에서 한다 —
// 팀 전체가 보는 화면에서 남의 휴가를 건드릴 수 있으면 안 된다.
function pageHead(ctx) {
  const head = el('div', 'page-head');
  head.innerHTML = `
    <div>
      <h1 class="page-title">휴가 관리</h1>
      <p class="page-sub">팀 전체 휴가 일정 조회</p>
    </div>
  `;
  const btn = el('button', 'btn btn--primary', 'My Page 에서 휴가 신청 →');
  btn.addEventListener('click', () => ctx.navigate('mypage'));
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
        label: v.pending ? `${v.type} (대기)` : v.type,
        kind: v.pending ? 'vacation-pending' : 'vacation',
        color: 0,
        tooltip: vacationTooltip(emp.name, v),
        aria: `${emp.name} ${v.type}`,
      })),
    };
  });

  const monthList = store
    .vacationsInRange(start, end)
    .sort((a, b) => a.startDate.localeCompare(b.startDate));

  return chartCard({
    title: `월간 휴가 현황 — ${start.getFullYear()}년 ${start.getMonth() + 1}월`,
    subtitle: ['※ My page 에서 휴가 신청 · 수정 · 삭제 가능', '점선 바는 승인 대기 중'],
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
      // 사유(비고)는 싣지 않는다. 팀 전체가 보는 화면이라 개인 사정이 드러나면 안 된다.
      [
        { key: 'name', label: '이름' },
        { key: 'status', label: '상태', html: statusCell },
        { key: 'type', label: '유형' },
        { key: 'period', label: '기간' },
        { key: 'days', label: '영업일' },
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
    status: store.vacationStatus(v),
    period: fmtRange(v.startDate, v.endDate),
    days: half ? '0.5일' : `${businessDays(s, e)}일`,
    note: v.note || '—',
    _id: v.id,
  };
}

const STATUS_TONE = { 신청: 'hold', 승인: 'won', 반려: 'done' };

function statusCell(r) {
  return `<span class="pill pill--${STATUS_TONE[r.status] ?? 'neutral'}">${escapeHtml(r.status)}</span>`;
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
        <h2 class="card__title">팀 휴가 일정</h2>
        <p class="card__sub">${list.length}건 · 전체 ${all.length}건 · 신청과 수정은 My Page 에서</p>
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
      { key: 'status', label: '상태', html: statusCell },
      { key: 'type', label: '유형' },
      { key: 'period', label: '기간' },
      { key: 'days', label: '영업일' },
    ],
    list.map(toRow),
    scope === 'upcoming' ? '예정된 휴가 없음' : '등록된 휴가 없음'
  );

  const body = el('div', 'card__body');
  body.appendChild(table);
  card.appendChild(body);
  return card;
}

export function openVacationForm(ctx, vacation, { employeeId = '' } = {}) {
  const isNew = !vacation;
  const me = store.currentEmployee();
  const applicantId = vacation?.employeeId || employeeId || me?.id || '';
  const applicant = store.byId('employees', applicantId);

  if (!applicant) {
    toast('로그인한 계정에 해당하는 직원을 찾을 수 없습니다', 'warning');
    return;
  }

  // 수정 중이라면 그 건이 이미 잔여에서 빠져 있으므로 되돌려 놓고 한도를 계산한다.
  const balance = store.leaveBalance(applicantId, parseDate(vacation?.startDate) ?? today());
  const alreadyCounted = vacation ? store.leaveCost(vacation) : 0;
  const availableDays = balance.remaining + alreadyCounted;

  openForm({
    title: isNew ? '휴가 신청' : '휴가 수정',
    subtitle: store.canApprove(me)
      ? '승인권자 계정 — 신청 없이 바로 승인 처리됨'
      : '신청 후 승인권자의 승인이 필요',
    submitLabel: isNew ? '신청' : '저장',
    fields: [
      // 신청자는 고를 수 없다. 남의 휴가를 대신 신청하는 경로를 만들지 않는다.
      {
        name: 'applicant',
        label: '신청자',
        type: 'readonly',
        value: applicant ? `${applicant.name} (${applicant.role})` : '—',
      },
      {
        name: 'available',
        label: '신청 가능 일수',
        type: 'readonly',
        value: `${availableDays}일 (부여 ${balance.total}일 · 사용 ${balance.used}일 · 대기 ${balance.pending}일)`,
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
    // 수정 모드에서만 삭제 버튼을 붙인다. 새로 신청하는 중에는 지울 대상이 없다.
    onDelete: vacation
      ? () => {
          const who = store.employeeName(vacation.employeeId);
          const when = fmtRange(vacation.startDate, vacation.endDate);
          if (!confirmDialog(`${who} · ${vacation.type} (${when}) 일정을 삭제할까요?`)) return false;
          store.remove('vacations', vacation.id);
          toast('삭제 완료', 'info');
          ctx.rerender();
          return true;
        }
      : null,
    onSubmit: (data) => {
      if (data.startDate > data.endDate) throw new Error('종료일이 시작일보다 빠름');

      // 부여된 연차를 넘겨 신청할 수 없다. 공가처럼 차감 없는 유형은 이 검사를 통과한다.
      const cost = store.leaveCost({
        type: data.type,
        startDate: data.startDate,
        endDate: data.endDate,
      });
      if (cost > availableDays) {
        throw new Error(
          `신청 가능 일수를 초과함 — 신청 ${cost}일 / 가능 ${availableDays}일 ` +
            `(부여 ${balance.total} · 사용 ${balance.used} · 대기 ${balance.pending})`
        );
      }

      const clash = store
        .all('vacations')
        .find(
          (v) =>
            v.employeeId === applicantId &&
            v.id !== vacation?.id &&
            v.startDate <= data.endDate &&
            data.startDate <= v.endDate
        );
      if (clash) {
        throw new Error(`이미 등록된 휴가와 겹침 — ${fmtRange(clash.startDate, clash.endDate)} ${clash.type}`);
      }
      // 승인권자 본인의 신청은 승인 단계를 거치지 않는다.
      // 수정일 때는 기존 상태를 유지한다 — 승인된 건을 고쳤다고 다시 대기로 돌리지 않는다.
      const status = vacation
        ? store.vacationStatus(vacation)
        : store.canApprove(applicant)
          ? '승인'
          : '신청';
      const stamp = toISO(today());

      store.upsert('vacations', {
        id: vacation?.id ?? uid('vac'),
        employeeId: applicantId,
        type: data.type,
        startDate: data.startDate,
        endDate: data.endDate,
        note: data.note,
        status,
        requestedAt: vacation?.requestedAt || stamp,
        decidedBy: vacation?.decidedBy ?? (status === '승인' ? me?.id ?? applicant?.id ?? '' : ''),
        decidedAt: vacation?.decidedAt ?? (status === '승인' ? stamp : ''),
        decisionNote: vacation?.decisionNote ?? '',
      });

      anchor = startOfMonth(parseDate(data.startDate)); // 신청한 달로 화면을 옮긴다
      toast(
        isNew ? (status === '승인' ? '휴가 등록 완료' : '휴가 신청 완료 — 승인 대기') : '저장 완료',
        'good'
      );
      ctx.rerender();
    },
  });
}
