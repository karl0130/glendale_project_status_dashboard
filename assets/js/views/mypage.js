// My Page — 내 연차 현황, 내 휴가 신청 내역, (승인권자만) 승인 대기 목록.
//
// 로그인한 구글 계정을 employees 의 email 열로 맞춰 "나"를 찾는다.
// email 이 비어 있으면 여기서 막히므로 그 사실을 분명히 알려준다.

import * as store from '../store.js';
import { LEAVE_POLICY } from '../config.js';
import { renderTable } from '../gantt.js';
import { confirmDialog, el, openForm, toast } from '../ui.js';
import { escapeHtml, fmtDate, fmtRange, parseDate } from '../util.js';
import { notifyVacationDecided } from '../notify.js';
import { openVacationForm } from './vacations.js';

export function render(ctx) {
  const view = el('div', 'view__inner');
  const me = store.currentEmployee();

  view.appendChild(pageHead(me, ctx));

  if (store.source() !== 'sheets') {
    view.appendChild(
      el(
        'p',
        'callout callout--warning',
        '<strong>로그인 필요</strong> · My Page 는 로그인한 계정 기준으로 동작<br>' +
          '우측 상단 <strong>구글 로그인</strong> 버튼으로 연결할 것'
      )
    );
    return view;
  }

  if (!me) {
    view.appendChild(
      el(
        'p',
        'callout callout--warning',
        `<strong>${escapeHtml(store.account()?.email ?? '')} 에 해당하는 직원을 찾을 수 없음</strong><br>` +
          '<code>employees</code> 탭의 <code>email</code> 열에 이 주소가 등록돼 있어야 함'
      )
    );
    return view;
  }

  if (store.canApprove(me)) view.appendChild(approvalCard(ctx, me));
  view.appendChild(balanceCard(me));
  view.appendChild(myVacationsCard(ctx, me));
  return view;
}

function pageHead(me, ctx) {
  const head = el('div', 'page-head');
  head.innerHTML = `
    <div>
      <h1 class="page-title">My Page</h1>
      <p class="page-sub">${
        me
          ? `${escapeHtml(me.name)} · ${escapeHtml(me.role)}${store.canApprove(me) ? ' · 휴가 승인권자' : ''}`
          : '내 연차 현황 및 휴가 신청 내역'
      }</p>
    </div>
  `;
  if (me) {
    const request = el('button', 'btn btn--primary', '+ 휴가 신청');
    request.addEventListener('click', () => openVacationForm(ctx, null, { employeeId: me.id }));
    head.appendChild(request);
  }
  return head;
}

// ── 승인권자: 승인 대기 목록 ────────────────────────────────────────────────

function approvalCard(ctx, me) {
  const pending = store.pendingVacations();
  const card = el('section', 'card');
  card.innerHTML = `
    <header class="card__head">
      <div class="card__titles">
        <h2 class="card__title">휴가 승인 대기 ${pending.length ? `<span class="pill pill--hold">${pending.length}건</span>` : ''}</h2>
        <p class="card__sub">승인하면 해당 인원의 연차에서 차감되고 일정에 확정 표시</p>
      </div>
    </header>
  `;

  const body = el('div', 'card__body');
  const table = renderTable(
    [
      { key: 'name', label: '신청자' },
      { key: 'type', label: '유형' },
      { key: 'period', label: '기간' },
      { key: 'days', label: '차감' },
      { key: 'remaining', label: '승인 후 잔여' },
      { key: 'note', label: '사유' },
      {
        key: 'actions',
        label: '',
        align: 'right',
        html: (r) => `<span class="rowactions">
          <button type="button" class="link-btn" data-approve="${r._id}">승인</button>
          <button type="button" class="link-btn link-btn--danger" data-reject="${r._id}">반려</button>
        </span>`,
      },
    ],
    pending.map((v) => {
      const bal = store.leaveBalance(v.employeeId);
      const cost = store.leaveCost(v);
      return {
        name: store.employeeName(v.employeeId),
        type: v.type,
        period: fmtRange(v.startDate, v.endDate),
        days: cost ? `${cost}일` : '차감 없음',
        remaining: `${bal.total - bal.used - cost}일`,
        note: v.note || '—',
        _id: v.id,
      };
    }),
    '승인 대기 중인 휴가 없음'
  );

  table.addEventListener('click', (e) => {
    const approve = e.target.closest('[data-approve]');
    const reject = e.target.closest('[data-reject]');
    if (approve) {
      const v = store.byId('vacations', approve.dataset.approve);
      const cost = store.leaveCost(v);
      if (
        !confirmDialog(
          `${store.employeeName(v.employeeId)} · ${v.type} (${fmtRange(v.startDate, v.endDate)})\n` +
            `${cost ? `연차 ${cost}일 차감` : '연차 차감 없음'}\n\n승인할까요?`
        )
      ) {
        return;
      }
      store.decideVacation(v.id, '승인', me.id);
      toast('승인했습니다', 'good');
      ctx.rerender();
      notifyDecision(v.id, '승인', me);
    }
    if (reject) {
      const v = store.byId('vacations', reject.dataset.reject);
      openForm({
        title: '휴가 반려',
        subtitle: `${store.employeeName(v.employeeId)} · ${v.type} · ${fmtRange(v.startDate, v.endDate)}`,
        submitLabel: '반려',
        fields: [
          { name: 'reason', label: '반려 사유', type: 'textarea', rows: 3, colspan: 2, hint: '신청자에게 표시됨 (선택)' },
        ],
        onSubmit: (data) => {
          store.decideVacation(v.id, '반려', me.id, data.reason);
          toast('반려했습니다', 'info');
          ctx.rerender();
          notifyDecision(v.id, '반려', me);
        },
      });
    }
  });

  body.appendChild(table);
  card.appendChild(body);
  return card;
}

// ── 내 연차 현황 ────────────────────────────────────────────────────────────

function balanceCard(me) {
  const bal = store.leaveBalance(me.id);
  const card = el('section', 'card');
  card.innerHTML = `
    <header class="card__head">
      <div class="card__titles">
        <h2 class="card__title">내 연차 현황</h2>
        <p class="card__sub">산정 기간 ${escapeHtml(fmtDate(bal.period.start))} – ${escapeHtml(fmtDate(bal.period.end))}${
          me.joinDate
            ? ` · 입사일 ${escapeHtml(fmtDate(parseDate(me.joinDate)))} 기준`
            : ' · 입사일 미등록으로 회계연도 기준'
        }</p>
      </div>
    </header>
  `;

  const body = el('div', 'card__body');

  const row = el('div', 'kpi-row');
  const tiles = [
    { label: '연간 부여', value: bal.total, sub: me.joinDate ? '입사일 기준' : '회계연도 기준' },
    { label: '사용', value: bal.used, sub: '승인 완료' },
    { label: '승인 대기', value: bal.pending, sub: bal.pending ? '승인 시 차감 예정' : '없음' },
    { label: '잔여', value: bal.remaining, sub: '대기분 제외 기준', accent: true },
  ];
  for (const t of tiles) {
    const tile = el('div', 'stat');
    tile.innerHTML = `
      <span class="stat__label">${escapeHtml(t.label)}</span>
      <span class="stat__value"${t.accent ? '' : ' style="color:var(--ink-primary)"'}>${t.value}<span class="stat__unit">일</span></span>
      <span class="stat__sub">${escapeHtml(t.sub)}</span>
    `;
    row.appendChild(tile);
  }
  body.appendChild(row);

  // 사용 · 대기 · 잔여를 한 줄로 — 숫자만으로는 비율이 안 잡힌다.
  const meter = el('div', 'leavebar');
  const pct = (n) => (bal.total ? (n / bal.total) * 100 : 0);
  meter.innerHTML = `
    <span class="leavebar__track">
      <span class="leavebar__used" style="width:${pct(bal.used)}%"></span>
      <span class="leavebar__pending" style="width:${pct(bal.pending)}%"></span>
    </span>
    <span class="leavebar__legend">
      <span class="legend__item"><span class="legend__swatch leavebar__key--used"></span>사용 ${bal.used}일</span>
      <span class="legend__item"><span class="legend__swatch leavebar__key--pending"></span>대기 ${bal.pending}일</span>
      <span class="legend__item"><span class="legend__swatch leavebar__key--left"></span>잔여 ${bal.remaining}일</span>
    </span>
  `;
  body.appendChild(meter);

  // 면제 유형은 정책에서 그대로 읽는다. 문구를 손으로 적어두면 정책이 바뀔 때 어긋난다.
  body.appendChild(
    el(
      'p',
      'callout',
      `<strong>${LEAVE_POLICY.exempt.map(escapeHtml).join(' · ')}</strong>는 연차에서 차감되지 않음 · ` +
        '<strong>반차</strong>는 0.5일 · 주말과 공휴일은 제외하고 계산'
    )
  );

  card.appendChild(body);
  return card;
}

// ── 내 휴가 신청 내역 ───────────────────────────────────────────────────────

function myVacationsCard(ctx, me) {
  const mine = store
    .all('vacations')
    .filter((v) => v.employeeId === me.id)
    .sort((a, b) => b.startDate.localeCompare(a.startDate));

  const card = el('section', 'card');
  card.innerHTML = `
    <header class="card__head">
      <div class="card__titles">
        <h2 class="card__title">내 휴가 신청 내역</h2>
        <p class="card__sub">${mine.length}건 · 승인 대기 중인 건만 수정·취소 가능</p>
      </div>
    </header>
  `;

  const body = el('div', 'card__body');
  const table = renderTable(
    [
      {
        key: 'status',
        label: '상태',
        html: (r) => `<span class="pill pill--${statusTone(r.status)}">${escapeHtml(r.status)}</span>`,
      },
      { key: 'type', label: '유형' },
      { key: 'period', label: '기간' },
      { key: 'days', label: '차감' },
      { key: 'note', label: '사유' },
      { key: 'decision', label: '처리' },
      {
        key: 'actions',
        label: '',
        align: 'right',
        html: (r) =>
          r.status === '신청'
            ? `<span class="rowactions">
                 <button type="button" class="link-btn" data-edit="${r._id}">수정</button>
                 <button type="button" class="link-btn link-btn--danger" data-cancel="${r._id}">취소</button>
               </span>`
            : '',
      },
    ],
    mine.map((v) => {
      const status = store.vacationStatus(v);
      const cost = store.leaveCost(v);
      return {
        status,
        type: v.type,
        period: fmtRange(v.startDate, v.endDate),
        days: cost ? `${cost}일` : '차감 없음',
        note: v.note || '—',
        decision:
          status === '승인'
            ? `${store.employeeName(v.decidedBy) } 승인${v.decidedAt ? ` · ${v.decidedAt}` : ''}`
            : status === '반려'
              ? `반려${v.decisionNote ? ` — ${v.decisionNote}` : ''}`
              : '대기 중',
        _id: v.id,
      };
    }),
    '신청 내역 없음'
  );

  table.addEventListener('click', (e) => {
    const edit = e.target.closest('[data-edit]');
    const cancel = e.target.closest('[data-cancel]');
    if (edit) openVacationForm(ctx, store.byId('vacations', edit.dataset.edit));
    if (cancel) {
      const v = store.byId('vacations', cancel.dataset.cancel);
      if (confirmDialog(`${v.type} (${fmtRange(v.startDate, v.endDate)}) 신청을 취소할까요?`)) {
        store.remove('vacations', v.id);
        toast('신청을 취소했습니다', 'info');
        ctx.rerender();
      }
    }
  });

  body.appendChild(table);
  card.appendChild(body);
  return card;
}

function statusTone(status) {
  return { 신청: 'hold', 승인: 'won', 반려: 'done' }[status] ?? 'neutral';
}

/**
 * 결재 결과를 신청자에게 알린다.
 * 저장 뒤에 부르므로 decideVacation 이 남긴 사유·처리자까지 반영된 레코드가 나간다.
 * 실패해도 결재 자체는 이미 끝났으므로 그 사실만 구분해 알린다.
 */
function notifyDecision(id, decision, decidedBy) {
  if (store.source() !== 'sheets') return;
  notifyVacationDecided(store.byId('vacations', id), decision, decidedBy).then((res) => {
    if (res.ok) toast('신청자에게 결과 메일을 보냈습니다', 'good');
    else toast(`${decision} 처리는 완료 · 메일 발송 실패 — ${res.error}`, 'warning');
  });
}
