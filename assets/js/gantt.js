// 간트 차트 렌더러.
//
// 마크 규칙(전 화면 공통):
//   · 바 높이 18px (24px 상한 이하), 양 끝 4px 라운드 — 양쪽 모두 데이터 끝이므로.
//   · 맞닿는 바는 테두리가 아니라 2px 표면 간격으로 분리한다.
//   · 격자/축은 1px 실선 헤어라인. 점선은 쓰지 않는다(임계선으로 오독됨).
//   · 색은 "프로젝트"라는 개체를 따라간다. 필터가 바뀌어도 재배정하지 않는다.
//   · 모든 바에 이름을 직접 라벨링한다. 색만으로 식별을 요구하지 않는다.
//   · 툴팁은 보조 수단이고, 같은 값이 항상 '표 보기'에도 존재한다.

import {
  diffDays,
  eachDay,
  escapeHtml,
  fmtMD,
  isWeekend,
  isoWeekNumber,
  parseDate,
  today,
  WEEKDAY_KO,
} from './util.js';
import { bindTooltip, el } from './ui.js';

const BAR_H = 18;
const LANE_GAP = 4;
const ROW_PAD = 8;

/* 행 높이는 바 개수만으로 정하면 안 된다 — 좌측 라벨(이름 + 부제 + 배지)이
   그보다 높으면 글자가 잘린다. 둘 중 큰 쪽을 쓰고 바는 세로 중앙에 놓는다. */
const LABEL_MIN_H = { plain: 40, sub: 54, badge: 78 };

/** 연속된 날짜를 주(월요일 시작) 단위로 묶는다. 부분 주도 그대로 처리된다. */
function groupByWeek(days) {
  const groups = [];
  for (const day of days) {
    const key = `${day.getFullYear()}-W${isoWeekNumber(day)}`;
    const last = groups[groups.length - 1];
    if (last && last.key === key) last.days.push(day);
    else groups.push({ key, days: [day] });
  }
  return groups;
}

/** 겹치는 바를 서로 다른 레인에 배치한다. 한 사람의 동시 투입이 시각적으로 드러난다. */
function packLanes(bars) {
  const lanes = [];
  for (const bar of bars) {
    let placed = false;
    for (const lane of lanes) {
      if (lane.every((b) => bar.startIndex > b.endIndex || bar.endIndex < b.startIndex)) {
        lane.push(bar);
        placed = true;
        break;
      }
    }
    if (!placed) lanes.push([bar]);
  }
  lanes.forEach((lane, i) => lane.forEach((bar) => (bar.lane = i)));
  return lanes.length || 1;
}

/**
 * @param {Object}   opts
 * @param {Date}     opts.start        표시 구간 시작
 * @param {Date}     opts.end          표시 구간 끝 (포함)
 * @param {string}   opts.labelHeader  좌측 라벨 열 제목
 * @param {Array}    opts.rows         [{ id, label, sub, badge, bars }]
 * @param {string}   opts.emptyText    행이 없을 때 문구
 * @param {number}   opts.dayWidth     하루 최소 폭(px)
 */
export function renderGantt({
  start,
  end,
  labelHeader = '',
  rows = [],
  emptyText = '표시할 항목이 없습니다.',
  dayWidth = 34,
}) {
  const days = eachDay(start, end);
  const total = days.length;
  const now = today();
  const showToday = now >= start && now <= end;
  const todayPct = showToday ? ((diffDays(start, now) + 0.5) / total) * 100 : null;

  const root = el('div', 'gantt');
  const scroll = el('div', 'gantt__scroll');
  const inner = el('div', 'gantt__inner');
  inner.style.minWidth = `${total * dayWidth}px`;

  // ── 헤더 ──
  const head = el('div', 'gantt__head');
  head.appendChild(el('div', 'gantt__labelcol gantt__labelcol--head', escapeHtml(labelHeader)));

  const headTrack = el('div', 'gantt__headtrack');
  const weekRow = el('div', 'gantt__weeks');
  for (const group of groupByWeek(days)) {
    const cell = el('div', 'gantt__week');
    cell.style.flexGrow = String(group.days.length);
    // 1~2일짜리 조각 주에는 라벨을 넣지 않는다. 좁은 칸에서 '8/3…' 처럼 잘리면
    // 없는 것보다 나쁘게 읽힌다 (아래 날짜 줄이 이미 날짜를 말해준다).
    cell.textContent =
      group.days.length >= 3
        ? `${fmtMD(group.days[0])} – ${fmtMD(group.days[group.days.length - 1])}`
        : '';
    weekRow.appendChild(cell);
  }
  const dayRow = el('div', 'gantt__days');
  for (const day of days) {
    const cell = el('div', `gantt__day${isWeekend(day) ? ' is-weekend' : ''}${day.getTime() === now.getTime() ? ' is-today' : ''}`);
    cell.innerHTML = `<span class="gantt__daynum">${day.getDate()}</span><span class="gantt__dow">${WEEKDAY_KO[day.getDay()]}</span>`;
    dayRow.appendChild(cell);
  }
  headTrack.append(weekRow, dayRow);
  head.appendChild(headTrack);
  inner.appendChild(head);

  // ── 본문 ──
  const body = el('div', 'gantt__body');

  if (!rows.length) {
    body.appendChild(el('div', 'gantt__empty', escapeHtml(emptyText)));
  }

  for (const row of rows) {
    const bars = (row.bars ?? [])
      .map((bar) => {
        const s = bar.start instanceof Date ? bar.start : parseDate(bar.start);
        const e = bar.end instanceof Date ? bar.end : parseDate(bar.end);
        if (!s || !e) return null;
        const startIndex = Math.max(0, diffDays(start, s));
        const endIndex = Math.min(total - 1, diffDays(start, e));
        if (endIndex < 0 || startIndex > total - 1) return null;
        return {
          ...bar,
          startIndex,
          endIndex,
          clippedStart: s < start,
          clippedEnd: e > end,
        };
      })
      .filter(Boolean)
      .sort((a, b) => a.startIndex - b.startIndex || a.endIndex - b.endIndex);

    const laneCount = packLanes(bars);
    const barsHeight = laneCount * BAR_H + (laneCount - 1) * LANE_GAP;
    const labelMin = row.badge ? LABEL_MIN_H.badge : row.sub ? LABEL_MIN_H.sub : LABEL_MIN_H.plain;
    const rowHeight = Math.max(barsHeight + ROW_PAD * 2, labelMin);
    const barsTop = Math.round((rowHeight - barsHeight) / 2);

    const rowEl = el('div', 'gantt__row');
    rowEl.style.height = `${rowHeight}px`;

    const labelCell = el('div', 'gantt__labelcol');
    labelCell.innerHTML = `
      <span class="gantt__rowlabel">${escapeHtml(row.label)}</span>
      ${row.sub ? `<span class="gantt__rowsub">${escapeHtml(row.sub)}</span>` : ''}
      ${row.badge ? badgeHtml(row.badge) : ''}
    `;
    rowEl.appendChild(labelCell);

    const track = el('div', 'gantt__track');
    const grid = el('div', 'gantt__grid');
    for (const day of days) {
      grid.appendChild(el('div', `gantt__gridcell${isWeekend(day) ? ' is-weekend' : ''}`));
    }
    track.appendChild(grid);

    if (showToday) {
      const line = el('div', 'gantt__todayline');
      line.style.left = `${todayPct}%`;
      track.appendChild(line);
    }

    const barLayer = el('div', 'gantt__bars');
    for (const bar of bars) {
      const leftPct = (bar.startIndex / total) * 100;
      const widthPct = ((bar.endIndex - bar.startIndex + 1) / total) * 100;
      const node = el('div', `gbar gbar--c${bar.color ?? 0}${bar.kind ? ` gbar--${bar.kind}` : ''}`);
      node.style.left = `calc(${leftPct}% + 1px)`; // 좌우 1px씩 → 맞닿는 바 사이 2px 표면 간격
      node.style.width = `calc(${widthPct}% - 2px)`;
      node.style.top = `${barsTop + bar.lane * (BAR_H + LANE_GAP)}px`;
      node.style.height = `${BAR_H}px`;
      if (bar.clippedStart) node.classList.add('is-clipped-start');
      if (bar.clippedEnd) node.classList.add('is-clipped-end');
      node.tabIndex = 0;
      node.setAttribute('role', 'img');
      node.setAttribute('aria-label', bar.aria ?? `${row.label} ${bar.label}`);
      node.innerHTML = `<span class="gbar__label">${escapeHtml(bar.label)}</span>`;
      if (bar.tooltip) bindTooltip(node, bar.tooltip);
      if (bar.onClick) {
        node.classList.add('is-clickable');
        node.addEventListener('click', bar.onClick);
        node.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            bar.onClick(e);
          }
        });
      }
      barLayer.appendChild(node);
    }
    track.appendChild(barLayer);
    rowEl.appendChild(track);
    body.appendChild(rowEl);
  }

  inner.appendChild(body);
  scroll.appendChild(inner);
  root.appendChild(scroll);

  // 라벨이 바 안에 안 들어가면 자르지 않고 바 바깥으로 내보낸다.
  // (overflow:hidden 으로 글자를 잘라내는 것이 라벨 없는 것보다 나쁘다.)
  const observer = new ResizeObserver(() => {
    if (root.clientWidth > 0) {
      fitLabels(root);
      observer.disconnect();
    }
  });
  observer.observe(root);
  requestAnimationFrame(() => fitLabels(root));

  return root;
}

function fitLabels(root) {
  for (const bar of root.querySelectorAll('.gbar')) {
    const label = bar.querySelector('.gbar__label');
    if (!label) continue;
    bar.classList.remove('has-outside-label');
    if (label.scrollWidth + 14 > bar.clientWidth) bar.classList.add('has-outside-label');
  }
}

function badgeHtml(badge) {
  return `<span class="badge badge--${badge.tone}">
    <span class="badge__icon" aria-hidden="true">${badge.icon}</span>${escapeHtml(badge.text)}
  </span>`;
}

/** 범례 — 시리즈가 2개 이상이면 항상 표시한다. */
export function renderLegend(items) {
  const node = el('div', 'legend');
  node.innerHTML = items
    .map(
      (item) =>
        `<span class="legend__item"><span class="legend__swatch legend__swatch--c${item.color}"></span>${escapeHtml(item.label)}</span>`
    )
    .join('');
  return node;
}

/**
 * 카드 껍데기 + '차트 / 표' 전환.
 * 모든 차트는 표 보기 쌍을 갖는다 — 색만으로 정보가 갇히지 않게 하기 위한 장치다.
 */
export function chartCard({ title, subtitle, actions, legend, chart, table, id }) {
  const card = el('section', 'card');
  if (id) card.id = id;

  const head = el('header', 'card__head');
  head.innerHTML = `
    <div class="card__titles">
      <h2 class="card__title">${escapeHtml(title)}</h2>
      ${subtitle ? `<p class="card__sub">${escapeHtml(subtitle)}</p>` : ''}
    </div>
  `;
  const tools = el('div', 'card__tools');
  if (actions) tools.appendChild(actions);
  if (table) {
    const toggle = el('div', 'segmented');
    toggle.innerHTML = `
      <button type="button" class="segmented__btn is-active" data-mode="chart">차트</button>
      <button type="button" class="segmented__btn" data-mode="table">표</button>
    `;
    tools.appendChild(toggle);
    toggle.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-mode]');
      if (!btn) return;
      toggle.querySelectorAll('.segmented__btn').forEach((b) => b.classList.toggle('is-active', b === btn));
      const isChart = btn.dataset.mode === 'chart';
      chartWrap.hidden = !isChart;
      tableWrap.hidden = isChart;
    });
  }
  head.appendChild(tools);
  card.appendChild(head);

  if (legend) card.appendChild(legend);

  const chartWrap = el('div', 'card__body');
  chartWrap.appendChild(chart);
  card.appendChild(chartWrap);

  let tableWrap = null;
  if (table) {
    tableWrap = el('div', 'card__body');
    tableWrap.hidden = true;
    tableWrap.appendChild(table);
    card.appendChild(tableWrap);
  }

  return card;
}

/** 데이터 표. columns: [{ key, label, align, html }] */
export function renderTable(columns, rows, emptyText = '데이터가 없습니다.') {
  const wrap = el('div', 'table-scroll');
  if (!rows.length) {
    wrap.appendChild(el('p', 'empty', escapeHtml(emptyText)));
    return wrap;
  }
  const table = el('table', 'table');
  table.innerHTML = `
    <thead><tr>${columns
      .map((c) => `<th${c.align ? ` class="is-${c.align}"` : ''} scope="col">${escapeHtml(c.label)}</th>`)
      .join('')}</tr></thead>
    <tbody>${rows
      .map(
        (row) =>
          `<tr>${columns
            .map(
              (c) =>
                `<td${c.align ? ` class="is-${c.align}"` : ''}>${c.html ? c.html(row) : escapeHtml(row[c.key] ?? '')}</td>`
            )
            .join('')}</tr>`
      )
      .join('')}</tbody>
  `;
  wrap.appendChild(table);
  return wrap;
}

/** 이전/다음 구간 이동 컨트롤 */
export function rangeNav({ label, onPrev, onNext, onToday }) {
  const node = el('div', 'rangenav');
  node.innerHTML = `
    <button type="button" class="icon-btn" data-prev aria-label="이전 구간">‹</button>
    <span class="rangenav__label">${escapeHtml(label)}</span>
    <button type="button" class="icon-btn" data-next aria-label="다음 구간">›</button>
    <button type="button" class="btn btn--ghost" data-today>오늘</button>
  `;
  node.querySelector('[data-prev]').addEventListener('click', onPrev);
  node.querySelector('[data-next]').addEventListener('click', onNext);
  node.querySelector('[data-today]').addEventListener('click', onToday);
  return node;
}
