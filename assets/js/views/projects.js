// 상세 1 — Project Status. 입력 + 4주 간트 + 전체 표.

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
} from '../util.js';
import { barLabel, projectTooltip } from './overview.js';

let anchor = null;
const filters = { status: 'all', q: '' };

export function render(ctx) {
  if (!anchor) anchor = startOfWeek(today());
  const start = anchor;
  const end = addDays(start, 27); // 4주

  const view = el('div', 'view__inner');
  view.appendChild(pageHead(ctx));
  view.appendChild(filterBar(ctx));

  const list = visibleProjects();

  view.appendChild(
    chartCard({
      title: '프로젝트 일정 (4주)',
      subtitle: '아래 표의 입력값을 4주 구간으로 시각화',
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
      legend: list.length
        ? renderLegend(list.map((p) => ({ color: store.projectColor(p.id), label: p.name })))
        : null,
      chart: renderGantt({
        start,
        end,
        dayWidth: 26,
        labelHeader: '고객사 / 프로젝트',
        rows: list
          .filter((p) => parseDate(p.startDate) <= end && start <= parseDate(p.endDate))
          .map((p) => ({
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
                onClick: () => openProjectForm(ctx, p),
              },
            ],
          })),
        emptyText: '이 구간에 해당하는 프로젝트 없음',
      }),
      table: buildTable(ctx, list),
    })
  );

  view.appendChild(tableCard(ctx, list));
  return view;
}

function visibleProjects() {
  const q = filters.q.trim().toLowerCase();
  return store
    .projects()
    .filter((p) => filters.status === 'all' || p.status === filters.status)
    .filter(
      (p) =>
        !q ||
        [p.client, p.endClient, p.name, store.employeeName(p.managerId)]
          .join(' ')
          .toLowerCase()
          .includes(q)
    )
    .sort((a, b) => a.startDate.localeCompare(b.startDate) || a.client.localeCompare(b.client, 'ko'));
}

function pageHead(ctx) {
  const head = el('div', 'page-head');
  head.innerHTML = `
    <div>
      <h1 class="page-title">Project Status</h1>
      <p class="page-sub"><span class="subline">진행 중인 모든 프로젝트의 기본 정보와 일정 관리</span><span class="subline">누구나 입력 · 수정 가능</span></p>
    </div>
  `;
  const btn = el('button', 'btn btn--primary', '+ 프로젝트 추가');
  btn.addEventListener('click', () => openProjectForm(ctx, null));
  head.appendChild(btn);
  return head;
}

// 필터는 카드 안이 아니라 카드들 위에 한 줄로 둔다 — 같은 슬라이스가 모든 시각화에 적용된다.
function filterBar(ctx) {
  const bar = el('div', 'filterbar');
  bar.innerHTML = `
    <label class="filterbar__field">
      <span>진행 상황</span>
      <select data-status>
        <option value="all">전체</option>
        ${store.PROJECT_STATUSES.map(
          (s) => `<option value="${s}"${filters.status === s ? ' selected' : ''}>${s}</option>`
        ).join('')}
      </select>
    </label>
    <label class="filterbar__field filterbar__field--grow">
      <span>검색</span>
      <input type="search" data-q value="${escapeHtml(filters.q)}" placeholder="고객사 · 프로젝트명 · PM">
    </label>
  `;
  bar.querySelector('[data-status]').addEventListener('change', (e) => {
    filters.status = e.target.value;
    ctx.rerender();
  });
  const input = bar.querySelector('[data-q]');
  input.addEventListener('input', (e) => {
    filters.q = e.target.value;
    clearTimeout(input._t);
    input._t = setTimeout(() => ctx.rerender({ focus: '[data-q]' }), 220);
  });
  return bar;
}

function buildTable(ctx, list) {
  return renderTable(
    [
      { key: 'client', label: '고객사' },
      { key: 'endClient', label: 'End client' },
      { key: 'name', label: '프로젝트명' },
      { key: 'status', label: '진행 상황' },
      { key: 'pm', label: 'PM' },
      { key: 'members', label: '팀원' },
      { key: 'period', label: '기간' },
    ],
    list.map(toRow)
  );
}

function toRow(p) {
  return {
    client: p.client,
    endClient: p.endClient || '—',
    name: p.name,
    status: p.status,
    pm: store.employeeName(p.managerId),
    members: (p.memberIds ?? []).map(store.employeeName).join(', ') || '—',
    period: fmtRange(p.startDate, p.endDate),
    _id: p.id,
  };
}

function tableCard(ctx, list) {
  const card = el('section', 'card');
  card.innerHTML = `
    <header class="card__head">
      <div class="card__titles">
        <h2 class="card__title">프로젝트 목록</h2>
        <p class="card__sub">${list.length}건 표시 중 · 행 클릭 시 수정</p>
      </div>
    </header>
  `;
  const body = el('div', 'card__body');
  const table = renderTable(
    [
      { key: 'client', label: '고객사' },
      { key: 'endClient', label: 'End client' },
      { key: 'name', label: '프로젝트명' },
      {
        key: 'status',
        label: '진행 상황',
        html: (r) => `<span class="pill pill--${statusTone(r.status)}">${escapeHtml(r.status)}</span>`,
      },
      { key: 'pm', label: 'PM' },
      { key: 'members', label: '팀원' },
      { key: 'period', label: '기간' },
      {
        key: 'actions',
        label: '',
        align: 'right',
        html: (r) =>
          `<span class="rowactions">
            <button type="button" class="link-btn" data-edit="${r._id}">수정</button>
            <button type="button" class="link-btn link-btn--danger" data-del="${r._id}">삭제</button>
          </span>`,
      },
    ],
    list.map(toRow),
    '조건에 맞는 프로젝트 없음'
  );

  table.addEventListener('click', (e) => {
    const edit = e.target.closest('[data-edit]');
    const del = e.target.closest('[data-del]');
    if (edit) openProjectForm(ctx, store.byId('projects', edit.dataset.edit));
    if (del) {
      const p = store.byId('projects', del.dataset.del);
      if (confirmDialog(`'${p.client} · ${p.name}' 프로젝트를 삭제할까요?\n리소스 배정과 주간 보고 연결도 함께 끊김`)) {
        store.remove('projects', p.id);
        toast('프로젝트 삭제 완료', 'info');
        ctx.rerender();
      }
    }
  });

  body.appendChild(table);
  card.appendChild(body);
  return card;
}

function statusTone(status) {
  return (
    { 제안서: 'proposal', 수주: 'won', 수행중: 'running', 보류: 'hold', 종료: 'done' }[status] ?? 'neutral'
  );
}

// ── 입력 폼 ─────────────────────────────────────────────────────────────────

export function openProjectForm(ctx, project) {
  const staff = store.employees().map((e) => ({ value: e.id, label: `${e.name} (${e.role})` }));
  const isNew = !project;

  openForm({
    title: isNew ? '프로젝트 추가' : '프로젝트 수정',
    subtitle: '입력한 팀 구성과 기간은 Resource Planning에 자동 반영',
    submitLabel: isNew ? '추가' : '저장',
    fields: [
      { name: 'client', label: '고객사 (Client)', type: 'text', required: true, placeholder: '예: 삼성전자' },
      {
        name: 'endClient',
        label: 'End client',
        type: 'text',
        hint: '해당하는 경우에만 입력 (선택)',
      },
      { name: 'name', label: '프로젝트명', type: 'text', required: true, colspan: 2 },
      {
        name: 'status',
        label: '진행 상황',
        type: 'select',
        required: true,
        options: store.PROJECT_STATUSES.map((s) => ({ value: s, label: s })),
      },
      {
        name: 'managerId',
        label: '프로젝트 담당자 (PM)',
        type: 'select',
        required: true,
        options: staff,
      },
      { name: 'startDate', label: '시작일', type: 'date', required: true },
      { name: 'endDate', label: '종료일', type: 'date', required: true },
      {
        name: 'memberIds',
        label: '프로젝트 팀원',
        type: 'multiselect',
        options: staff,
        hint: 'PM 외 투입 인원 (복수 선택)',
        colspan: 2,
      },
      { name: 'note', label: '비고', type: 'textarea', rows: 2, colspan: 2 },
    ],
    values: project ?? { status: '수행중', startDate: toISO(today()) },
    onSubmit: (data) => {
      if (data.startDate > data.endDate) throw new Error('종료일이 시작일보다 빠름');
      const record = store.stampMeta(
        {
          id: project?.id ?? uid('prj'),
          client: data.client,
          endClient: data.endClient,
          name: data.name,
          status: data.status,
          managerId: data.managerId,
          memberIds: data.memberIds.filter((id) => id !== data.managerId),
          startDate: data.startDate,
          endDate: data.endDate,
          note: data.note,
        },
        data.managerId
      );
      store.upsert('projects', record);
      toast(isNew ? '프로젝트 추가 완료' : '프로젝트 저장 완료', 'good');
      ctx.rerender();
    },
  });
}
