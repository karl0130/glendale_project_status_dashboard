// 상세 3 — Weekly Work Updates. 주간 업무 입력 + 작성자·프로젝트별 주간 간트 + 상세 보고.
//
// 행은 (작성자 × 프로젝트) 단위다. 같은 프로젝트 안에서 업무가 여러 건이면 한 행에 모이고,
// 기간이 겹칠 때만 그 행 안에서 줄이 나뉜다. 프로젝트가 다르면 행이 나뉜다.
// 색은 프로젝트가 아니라 업무 '상태'를 나타낸다 — 프로젝트는 왼쪽 열이 이미 말해준다.

import * as store from '../store.js';
import { chartCard, rangeNav, renderGantt, renderLegend, renderTable } from '../gantt.js';
import { confirmDialog, el, openForm, toast } from '../ui.js';
import {
  addDays,
  escapeHtml,
  fmtDate,
  fmtRange,
  intersectRange,
  parseDate,
  startOfWeek,
  subtractRanges,
  today,
  toISO,
  uid,
  weekLabel,
} from '../util.js';
import { vacationTooltip, widestIndex } from './overview.js';

let anchor = null; // 표시 중인 주의 월요일
let employeeFilter = 'all';

/** 상태 → 색 토큰. 상태색은 예약 토큰이고 항상 범례의 글자와 함께 쓴다. */
const STATUS_COLOR = { 진행중: 'st-progress', 완료: 'st-done', 지연: 'st-late' };

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
  const rows = buildRows(staff, updates, start, end, ctx);

  view.appendChild(
    chartCard({
      title: '주간 업무 현황',
      subtitle: [
        '작성자 · 프로젝트별로 한 행',
        '같은 프로젝트의 업무는 한 행에 모이고, 기간이 겹칠 때만 줄이 나뉨',
        '휴가 기간에는 업무 바가 끊기고 그 자리에 휴가 표시',
      ],
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
      legend: renderLegend(buildLegend(updates, rows)),
      chart: renderGantt({
        start,
        end,
        dayWidth: 88,
        columns: [
          { label: '작성자', width: 146 },
          { label: '고객사', width: 108 },
          { label: '프로젝트', width: 196 },
        ],
        rows,
        uniformRows: true, // 사람마다 줄 수가 달라도 행 높이는 동일하게
        emptyText: '이 주에 등록된 업무 없음',
      }),
      table: renderTable(
        [
          { key: 'name', label: '작성자' },
          { key: 'client', label: '고객사' },
          { key: 'project', label: '프로젝트' },
          { key: 'task', label: '수행 업무' },
          { key: 'period', label: '기간' },
          { key: 'status', label: '상태' },
        ],
        updates.map((u) => {
          const p = u.projectId ? store.byId('projects', u.projectId) : null;
          return {
            name: store.employeeName(u.employeeId),
            client: p?.client ?? '—',
            project: p?.name ?? '비프로젝트 업무',
            task: u.task,
            period: fmtRange(u.startDate, u.endDate),
            status: u.status,
          };
        }),
        '이 주에 등록된 업무 없음'
      ),
    })
  );

  view.appendChild(detailCard(ctx, staff, updates));
  return view;
}

// ── 행 구성 ─────────────────────────────────────────────────────────────────

/** 겹치는 항목만 다른 줄로 밀어내는 그리디 배치. 줄 번호를 미리 확정해 둔다. */
function assignLanes(items) {
  const lanes = [];
  for (const item of items) {
    let index = lanes.findIndex((lane) =>
      lane.every((other) => item.s > other.e || item.e < other.s)
    );
    if (index === -1) {
      index = lanes.length;
      lanes.push([]);
    }
    lanes[index].push(item);
    item.lane = index;
  }
  return lanes.length || 1;
}

/**
 * 행은 작성자 한 명당 하나다.
 * 한 사람이 프로젝트를 둘 이상 하면 그 행 안에서 프로젝트마다 줄(레인)이 나뉘고,
 * 고객사·프로젝트 열도 같은 줄 위치에 맞춰 쪼개진다. 작성자 이름은 행에 한 번만 나온다.
 * 같은 프로젝트 안에서 기간이 겹치는 업무가 있으면 그 프로젝트가 줄을 하나 더 쓰지만,
 * 라벨은 그 줄 묶음 전체에 걸쳐 한 번만 표시한다 (반복하면 다른 프로젝트로 오독된다).
 */
function buildRows(staff, updates, start, end, ctx) {
  const rows = [];

  for (const emp of staff) {
    const mine = updates.filter((u) => u.employeeId === emp.id);
    const vacations = store
      .vacationBlocks(emp.id)
      .map((v) => {
        const hit = intersectRange(v.start, v.end, start, end);
        return hit ? { ...v, ...hit } : null;
      })
      .filter(Boolean);

    if (!mine.length) {
      // 업무 기록이 없어도 휴가는 보여야 하고, 미제출도 드러나야 한다.
      rows.push({
        id: emp.id,
        cells: [{ text: emp.name, sub: emp.role }, { text: '—' }, { text: '—' }],
        badge: { tone: 'warning', icon: '●', text: '미제출' },
        bars: vacations.map((v) => vacationBar(emp, v, 0)),
      });
      continue;
    }

    // 프로젝트별로 묶는다. 비프로젝트 업무는 하나의 묶음으로 모은다.
    const grouped = new Map();
    for (const u of mine) {
      const key = u.projectId || '__none__';
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key).push(u);
    }

    const bars = [];
    const clientLines = [];
    const projectLines = [];
    let baseLane = 0;

    // 프로젝트 순서는 그 주에 처음 착수한 순서
    const groups = [...grouped.entries()]
      .map(([key, items]) => ({
        key,
        project: key === '__none__' ? null : store.byId('projects', key),
        tasks: items
          .map((u) => ({ u, s: parseDate(u.startDate), e: parseDate(u.endDate) }))
          .filter((t) => t.s && t.e)
          .sort((a, b) => a.s - b.s || a.e - b.e),
      }))
      .filter((g) => g.tasks.length)
      .sort((a, b) => a.tasks[0].s - b.tasks[0].s);

    for (const group of groups) {
      const p = group.project;
      const laneCount = assignLanes(group.tasks);

      for (const t of group.tasks) {
        const blocks = vacations
          .map((v) => {
            const hit = intersectRange(v.start, v.end, t.s, t.e);
            return hit ? { ...v, ...hit } : null;
          })
          .filter(Boolean);

        // 휴가로 쪼개진 조각 중 가장 넓은 하나만 라벨을 갖는다 — 짧은 조각의 라벨은
        // 바깥으로 밀려 옆 블록과 겹친다 (값은 툴팁·표에 그대로 남는다).
        const segments = subtractRanges(t.s, t.e, blocks);
        const labelled = widestIndex(segments, start, end);

        segments.forEach((seg, i) => {
          bars.push({
            start: seg.start,
            end: seg.end,
            lane: baseLane + t.lane,
            label: i === labelled ? t.u.task : '',
            color: STATUS_COLOR[t.u.status] ?? 'st-progress',
            tooltip: taskTooltip(p, t.u),
            aria: `${emp.name}, ${t.u.task}, ${fmtRange(t.u.startDate, t.u.endDate)}, ${t.u.status}`,
            onClick: () => openUpdateForm(ctx, t.u),
          });
        });
      }

      clientLines.push({ text: p?.client ?? '—', lane: baseLane, span: laneCount });
      projectLines.push({ text: p?.name ?? '비프로젝트 업무', lane: baseLane, span: laneCount });
      baseLane += laneCount;
    }

    // 휴가는 그 사람의 모든 줄에서 같은 자리에 나타난다.
    for (let lane = 0; lane < baseLane; lane += 1) {
      for (const v of vacations) bars.push(vacationBar(emp, v, lane));
    }

    rows.push({
      id: emp.id,
      cells: [
        { text: emp.name, sub: emp.role },
        { lines: clientLines },
        { lines: projectLines },
      ],
      bars,
    });
  }
  return rows;
}

function vacationBar(emp, block, lane) {
  return {
    start: block.start,
    end: block.end,
    lane,
    label: block.type,
    kind: 'vacation',
    color: 0,
    tooltip: vacationTooltip(emp.name, block),
    aria: `${emp.name} ${block.type}`,
  };
}

function taskTooltip(p, u) {
  return `
    <strong>${escapeHtml(p ? `${p.client} · ${p.name}` : '비프로젝트 업무')}</strong>
    <span class="tooltip__title">${escapeHtml(u.task)}</span>
    <dl class="tooltip__list">
      <dt>기간</dt><dd>${escapeHtml(fmtRange(u.startDate, u.endDate))}</dd>
      <dt>상태</dt><dd>${escapeHtml(u.status)}</dd>
    </dl>
    ${u.detail ? `<p class="tooltip__body">${escapeHtml(u.detail)}</p>` : ''}`;
}

/** 범례는 실제로 화면에 있는 상태만 싣는다. 휴가 블록이 있으면 그것도 함께. */
function buildLegend(updates, rows) {
  const present = new Set(updates.map((u) => u.status));
  const items = ['진행중', '완료', '지연']
    .filter((s) => present.has(s))
    .map((s) => ({ color: STATUS_COLOR[s], label: s }));
  if (rows.some((r) => r.bars.some((b) => b.kind === 'vacation'))) {
    items.push({ color: 'vacation', label: '휴가' });
  }
  return items;
}

// ── 상단 ────────────────────────────────────────────────────────────────────

function pageHead(ctx, start) {
  const head = el('div', 'page-head');
  head.innerHTML = `
    <div>
      <h1 class="page-title">Weekly Work Updates</h1>
      <p class="page-sub"><span class="subline">주간 수행 업무 기입</span><span class="subline">요일별 간트와 상세 보고로 자동 정리</span></p>
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
        <p class="card__sub">작성자별 상세 기입 내용</p>
      </div>
    </header>
  `;
  const body = el('div', 'card__body');

  const withWork = staff.filter((e) => updates.some((u) => u.employeeId === e.id));
  if (!withWork.length) {
    body.appendChild(el('p', 'empty', '이 주에 등록된 보고 없음'));
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
          <span class="swatch swatch--${STATUS_COLOR[u.status] ?? 'st-progress'}" aria-hidden="true"></span>
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
      toast('삭제 완료', 'info');
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
    subtitle: '한 건씩 기입 · 수행 기간을 요일 단위로 지정하면 간트에 그대로 표시',
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
        hint: '비워두면 비프로젝트 업무로 기록',
        options: store
          .projects()
          .filter((p) => p.status !== '종료')
          .map((p) => ({ value: p.id, label: `${p.client} · ${p.name}` })),
      },
      {
        name: 'task',
        label: '수행 업무',
        type: 'text',
        required: true,
        colspan: 2,
        placeholder: '예: 고객사 인터뷰 5건 진행 및 시사점 정리',
      },
      {
        name: 'detail',
        label: '상세 내용',
        type: 'textarea',
        rows: 5,
        colspan: 2,
        hint: '결과물 · 진행 상황 · 이슈 · 다음 주 계획 등 구체적으로 기입',
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
      if (data.startDate > data.endDate) throw new Error('종료일이 시작일보다 빠름');
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
      toast(isNew ? '주간 업무 기입 완료' : '저장 완료', 'good');
      ctx.rerender();
    },
  });
}
