// 상세 3 — Weekly Work Updates. 주간 업무 입력 + 직원별 주간 간트 + 상세 보고 열람.

import * as store from '../store.js';
import { chartCard, rangeNav, renderGantt, renderLegend, renderTable } from '../gantt.js';
import { confirmDialog, el, openForm, toast } from '../ui.js';
import {
  addDays,
  escapeHtml,
  fmtDate,
  fmtRange,
  parseDate,
  startOfWeek,
  today,
  toISO,
  uid,
  weekLabel,
} from '../util.js';

let anchor = null; // 표시 중인 주의 월요일
let employeeFilter = 'all';

export function render(ctx) {
  if (!anchor) anchor = startOfWeek(today());
  const start = anchor;
  const end = addDays(start, 6);

  const view = el('div', 'view__inner');
  view.appendChild(pageHead(ctx, start));
  view.appendChild(submissionStrip(start, end));
  view.appendChild(filterBar(ctx));

  const updates = store
    .updatesInRange(start, end)
    .filter((u) => employeeFilter === 'all' || u.employeeId === employeeFilter)
    .sort((a, b) => a.startDate.localeCompare(b.startDate));

  const staff = store.employees().filter((e) => employeeFilter === 'all' || e.id === employeeFilter);

  const rows = staff.map((emp) => {
    const mine = updates.filter((u) => u.employeeId === emp.id);
    return {
      id: emp.id,
      label: emp.name,
      sub: emp.role,
      badge: mine.length
        ? null
        : { tone: 'warning', icon: '●', text: '미제출' },
      bars: mine.map((u) => {
        const p = u.projectId ? store.byId('projects', u.projectId) : null;
        return {
          start: u.startDate,
          end: u.endDate,
          label: u.task,
          color: p ? store.projectColor(p.id) : 0,
          tooltip: `
            <strong>${escapeHtml(p ? `${p.client} · ${p.name}` : '비프로젝트 업무')}</strong>
            <span class="tooltip__title">${escapeHtml(u.task)}</span>
            <dl class="tooltip__list">
              <dt>기간</dt><dd>${escapeHtml(fmtRange(u.startDate, u.endDate))}</dd>
              <dt>상태</dt><dd>${escapeHtml(u.status)}</dd>
            </dl>
            ${u.detail ? `<p class="tooltip__body">${escapeHtml(u.detail)}</p>` : ''}`,
          aria: `${emp.name}, ${u.task}, ${fmtRange(u.startDate, u.endDate)}`,
          onClick: () => openUpdateForm(ctx, u),
        };
      }),
    };
  });

  const legendProjects = [
    ...new Set(updates.map((u) => u.projectId).filter(Boolean)),
  ].map((id) => ({ color: store.projectColor(id), label: store.byId('projects', id)?.name ?? id }));

  view.appendChild(
    chartCard({
      title: '주간 업무 현황',
      subtitle: '직원별로 이번 주 수행 업무를 요일 단위로 표시합니다. 바를 클릭하면 수정됩니다.',
      actions: rangeNav({
        label: `${weekLabel(start)} (${fmtDate(start)} 주)`,
        onPrev: () => {
          anchor = addDays(anchor, -7);
          ctx.rerender();
        },
        onNext: () => {
          anchor = addDays(anchor, 7);
          ctx.rerender();
        },
        onToday: () => {
          anchor = startOfWeek(today());
          ctx.rerender();
        },
      }),
      legend: legendProjects.length ? renderLegend(legendProjects) : null,
      chart: renderGantt({
        start,
        end,
        dayWidth: 92,
        labelHeader: '작성자',
        rows,
        emptyText: '이 주에 등록된 업무가 없습니다.',
      }),
      table: renderTable(
        [
          { key: 'name', label: '작성자' },
          { key: 'project', label: '프로젝트' },
          { key: 'task', label: '수행 업무' },
          { key: 'period', label: '기간' },
          { key: 'status', label: '상태' },
        ],
        updates.map((u) => ({
          name: store.employeeName(u.employeeId),
          project: u.projectId ? store.projectLabel(u.projectId) : '비프로젝트 업무',
          task: u.task,
          period: fmtRange(u.startDate, u.endDate),
          status: u.status,
        })),
        '이 주에 등록된 업무가 없습니다.'
      ),
    })
  );

  view.appendChild(detailCard(ctx, staff, updates));
  return view;
}

function pageHead(ctx, start) {
  const head = el('div', 'page-head');
  head.innerHTML = `
    <div>
      <h1 class="page-title">Weekly Work Updates</h1>
      <p class="page-sub">주간 수행 업무를 기입하면 요일별 간트와 상세 보고로 함께 정리됩니다.</p>
    </div>
  `;
  const btn = el('button', 'btn btn--primary', '+ 주간 업무 기입');
  btn.addEventListener('click', () => openUpdateForm(ctx, null, start));
  head.appendChild(btn);
  return head;
}

/** 제출 현황 — 리더가 가장 먼저 보는 정보라 상단에 고정한다. */
function submissionStrip(start, end) {
  const reported = store.reportedEmployeeIds(start, end);
  const staff = store.employees();
  const strip = el('div', 'submit-strip');
  strip.innerHTML = `
    <span class="submit-strip__label">제출 현황 <strong>${reported.size} / ${staff.length}</strong></span>
    <span class="submit-strip__chips">
      ${staff
        .map(
          (e) =>
            `<span class="chip chip--${reported.has(e.id) ? 'good' : 'pending'}">
              <span aria-hidden="true">${reported.has(e.id) ? '✓' : '○'}</span>${escapeHtml(e.name)}
            </span>`
        )
        .join('')}
    </span>
  `;
  return strip;
}

function filterBar(ctx) {
  const bar = el('div', 'filterbar');
  bar.innerHTML = `
    <label class="filterbar__field">
      <span>작성자</span>
      <select data-emp>
        <option value="all">전체</option>
        ${store
          .employees()
          .map(
            (e) => `<option value="${e.id}"${employeeFilter === e.id ? ' selected' : ''}>${escapeHtml(e.name)}</option>`
          )
          .join('')}
      </select>
    </label>
  `;
  bar.querySelector('[data-emp]').addEventListener('change', (e) => {
    employeeFilter = e.target.value;
    ctx.rerender();
  });
  return bar;
}

/** 간트는 '언제'를 보여주고, 이 카드가 '무엇을 얼마나 자세히'를 보여준다. */
function detailCard(ctx, staff, updates) {
  const card = el('section', 'card');
  card.innerHTML = `
    <header class="card__head">
      <div class="card__titles">
        <h2 class="card__title">주간 보고 상세</h2>
        <p class="card__sub">작성자별 상세 기입 내용입니다.</p>
      </div>
    </header>
  `;
  const body = el('div', 'card__body');

  const withWork = staff.filter((e) => updates.some((u) => u.employeeId === e.id));
  if (!withWork.length) {
    body.appendChild(el('p', 'empty', '이 주에 등록된 보고가 없습니다.'));
  }

  for (const emp of withWork) {
    const block = el('div', 'report');
    block.innerHTML = `<h3 class="report__name">${escapeHtml(emp.name)}<span class="report__role">${escapeHtml(emp.role)}</span></h3>`;
    const list = el('ul', 'report__list');
    for (const u of updates.filter((x) => x.employeeId === emp.id)) {
      const p = u.projectId ? store.byId('projects', u.projectId) : null;
      const item = el('li', 'report__item');
      item.innerHTML = `
        <div class="report__head">
          <span class="swatch swatch--c${p ? store.projectColor(p.id) : 0}" aria-hidden="true"></span>
          <span class="report__project">${escapeHtml(p ? `${p.client} · ${p.name}` : '비프로젝트 업무')}</span>
          <span class="pill pill--${u.status === '완료' ? 'done' : u.status === '지연' ? 'hold' : 'running'}">${escapeHtml(u.status)}</span>
          <span class="report__period">${escapeHtml(fmtRange(u.startDate, u.endDate))}</span>
          <span class="rowactions">
            <button type="button" class="link-btn" data-edit="${u.id}">수정</button>
            <button type="button" class="link-btn link-btn--danger" data-del="${u.id}">삭제</button>
          </span>
        </div>
        <p class="report__task">${escapeHtml(u.task)}</p>
        ${u.detail ? `<p class="report__detail">${escapeHtml(u.detail)}</p>` : ''}
      `;
      list.appendChild(item);
    }
    block.appendChild(list);
    body.appendChild(block);
  }

  body.addEventListener('click', (e) => {
    const edit = e.target.closest('[data-edit]');
    const del = e.target.closest('[data-del]');
    if (edit) openUpdateForm(ctx, store.byId('weeklyUpdates', edit.dataset.edit));
    if (del && confirmDialog('이 주간 업무 기록을 삭제할까요?')) {
      store.remove('weeklyUpdates', del.dataset.del);
      toast('삭제했습니다.', 'info');
      ctx.rerender();
    }
  });

  card.appendChild(body);
  return card;
}

// ── 입력 폼 ─────────────────────────────────────────────────────────────────

export function openUpdateForm(ctx, update, weekStart) {
  const isNew = !update;
  const monday = weekStart ?? startOfWeek(today());

  openForm({
    title: isNew ? '주간 업무 기입' : '주간 업무 수정',
    subtitle: '한 건씩 기입합니다. 수행 기간을 요일 단위로 지정하면 간트에 그대로 표시됩니다.',
    submitLabel: isNew ? '기입' : '저장',
    fields: [
      {
        name: 'employeeId',
        label: '작성자',
        type: 'select',
        required: true,
        options: store.employees().map((e) => ({ value: e.id, label: `${e.name} (${e.role})` })),
      },
      {
        name: 'projectId',
        label: '프로젝트',
        type: 'select',
        allowEmpty: true,
        hint: '비워두면 비프로젝트 업무로 기록됩니다.',
        options: store
          .projects()
          .filter((p) => p.status !== '종료')
          .map((p) => ({ value: p.id, label: `${p.client} · ${p.name}` })),
      },
      { name: 'task', label: '수행 업무', type: 'text', required: true, colspan: 2, placeholder: '예: 고객사 인터뷰 5건 진행 및 시사점 정리' },
      {
        name: 'detail',
        label: '상세 내용',
        type: 'textarea',
        rows: 5,
        colspan: 2,
        hint: '결과물, 진행 상황, 이슈, 다음 주 계획 등을 구체적으로 적습니다.',
      },
      { name: 'startDate', label: '시작일', type: 'date', required: true },
      { name: 'endDate', label: '종료일', type: 'date', required: true },
      {
        name: 'status',
        label: '상태',
        type: 'select',
        required: true,
        options: store.TASK_STATUSES.map((s) => ({ value: s, label: s })),
      },
    ],
    values: update ?? {
      status: '진행중',
      startDate: toISO(monday),
      endDate: toISO(addDays(monday, 4)),
    },
    onSubmit: (data) => {
      if (data.startDate > data.endDate) throw new Error('종료일이 시작일보다 빠릅니다.');
      store.upsert('weeklyUpdates', {
        id: update?.id ?? uid('wu'),
        employeeId: data.employeeId,
        projectId: data.projectId,
        task: data.task,
        detail: data.detail,
        startDate: data.startDate,
        endDate: data.endDate,
        status: data.status,
      });
      // 기입한 주로 화면을 옮겨 방금 넣은 항목이 바로 보이게 한다.
      anchor = startOfWeek(parseDate(data.startDate));
      toast(isNew ? '주간 업무를 기입했습니다.' : '저장했습니다.', 'good');
      ctx.rerender();
    },
  });
}
