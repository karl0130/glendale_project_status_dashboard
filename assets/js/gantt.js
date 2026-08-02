// 간트 차트 렌더러.
//
// 마크 규칙(전 화면 공통):
//   · 바 높이 18px (24px 상한 이하), 양 끝 4px 라운드 — 양쪽 모두 데이터 끝이므로.
//   · 맞닿는 바는 테두리가 아니라 2px 표면 간격으로 분리한다.
//   · 격자/축은 1px 실선 헤어라인. 점선은 쓰지 않는다(임계선으로 오독됨).
//   · 색은 개체(프로젝트 또는 상태)를 따라간다. 필터가 바뀌어도 재배정하지 않는다.
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

/** 색 슬롯 → CSS 클래스 접미사. 숫자면 카테고리 슬롯, 문자열이면 상태 토큰. */
function colorClass(color) {
  return typeof color === 'number' ? `c${color}` : String(color ?? 'c0');
}

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

/**
 * 겹치는 바를 서로 다른 레인에 배치한다.
 * bar.lane 이 미리 지정돼 있으면 그대로 존중한다 — 리소스 화면에서 "프로젝트 하나 = 한 줄,
 * 그 줄 안에서 휴가 구간만 치환" 을 보장하려면 레인이 자동 계산에 흔들리면 안 된다.
 */
function packLanes(bars) {
  const lanes = [];
  const ensure = (i) => {
    while (lanes.length <= i) lanes.push([]);
    return lanes[i];
  };

  for (const bar of bars.filter((b) => Number.isInteger(b.lane))) {
    ensure(bar.lane).push(bar);
  }

  for (const bar of bars.filter((b) => !Number.isInteger(b.lane))) {
    let placed = false;
    for (let i = 0; i < lanes.length; i += 1) {
      if (lanes[i].every((b) => bar.startIndex > b.endIndex || bar.endIndex < b.startIndex)) {
        lanes[i].push(bar);
        bar.lane = i;
        placed = true;
        break;
      }
    }
    if (!placed) {
      bar.lane = lanes.length;
      ensure(bar.lane).push(bar);
    }
  }
  return lanes.length || 1;
}

/**
 * @param {Object}   opts
 * @param {Date}     opts.start        표시 구간 시작
 * @param {Date}     opts.end          표시 구간 끝 (포함)
 * @param {string}   opts.labelHeader  좌측 라벨 열 제목 (단일 열일 때)
 * @param {Array}    opts.columns      좌측 열이 여럿일 때 [{ label, width }]
 * @param {Array}    opts.rows         [{ id, label, sub, cells, badge, bars }]
 * @param {string}   opts.emptyText    행이 없을 때 문구
 * @param {number}   opts.dayWidth     하루 최소 폭(px)
 * @param {boolean}  opts.uniformRows  모든 행 높이를 가장 높은 행에 맞춤
 */
export function renderGantt({
  start,
  end,
  labelHeader = '',
  columns = null,
  rows = [],
  emptyText = '표시할 항목이 없습니다.',
  dayWidth = 34,
  uniformRows = false,
}) {
  const cols = columns ?? [{ label: labelHeader, width: 218 }];
  const offsets = [];
  cols.reduce((acc, col) => {
    offsets.push(acc);
    return acc + col.width;
  }, 0);
  const labelWidth = cols.reduce((sum, col) => sum + col.width, 0);

  const days = eachDay(start, end);
  const total = days.length;
  const now = today();
  const showToday = now >= start && now <= end;
  const todayPct = showToday ? ((diffDays(start, now) + 0.5) / total) * 100 : null;

  const root = el('div', 'gantt');
  const scroll = el('div', 'gantt__scroll');
  const inner = el('div', 'gantt__inner');
  inner.style.minWidth = `${labelWidth + total * dayWidth}px`;

  const labelCell = (col, index, content, extraClass = '') => {
    const cell = el('div', `gantt__labelcol${extraClass}`);
    cell.style.flex = `0 0 ${col.width}px`;
    cell.style.width = `${col.width}px`;
    cell.style.left = `${offsets[index]}px`;
    cell.innerHTML = content;
    return cell;
  };

  // ── 헤더 ──
  const head = el('div', 'gantt__head');
  cols.forEach((col, i) =>
    head.appendChild(labelCell(col, i, escapeHtml(col.label), ' gantt__labelcol--head'))
  );

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
    const cell = el(
      'div',
      `gantt__day${isWeekend(day) ? ' is-weekend' : ''}${day.getTime() === now.getTime() ? ' is-today' : ''}`
    );
    cell.innerHTML = `<span class="gantt__daynum">${day.getDate()}</span><span class="gantt__dow">${WEEKDAY_KO[day.getDay()]}</span>`;
    dayRow.appendChild(cell);
  }
  headTrack.append(weekRow, dayRow);
  head.appendChild(headTrack);
  inner.appendChild(head);

  // ── 본문 ──
  const body = el('div', 'gantt__body');
  if (!rows.length) body.appendChild(el('div', 'gantt__empty', escapeHtml(emptyText)));

  // 1패스 — 바를 구간에 맞춰 자르고 레인을 확정해 각 행의 자연 높이를 구한다.
  const prepared = rows.map((row) => {
    const cells = row.cells ?? [{ text: row.label, sub: row.sub }];

    const bars = (row.bars ?? [])
      .map((bar) => {
        const s = bar.start instanceof Date ? bar.start : parseDate(bar.start);
        const e = bar.end instanceof Date ? bar.end : parseDate(bar.end);
        if (!s || !e) return null;
        const startIndex = Math.max(0, diffDays(start, s));
        const endIndex = Math.min(total - 1, diffDays(start, e));
        if (endIndex < 0 || startIndex > total - 1 || endIndex < startIndex) return null;
        return { ...bar, startIndex, endIndex, clippedStart: s < start, clippedEnd: e > end };
      })
      .filter(Boolean)
      .sort((a, b) => a.startIndex - b.startIndex || a.endIndex - b.endIndex);

    const laneCount = packLanes(bars);
    const barsHeight = laneCount * BAR_H + (laneCount - 1) * LANE_GAP;
    const hasSub = cells.some((c) => c && c.sub);
    const labelMin = row.badge ? LABEL_MIN_H.badge : hasSub ? LABEL_MIN_H.sub : LABEL_MIN_H.plain;
    return {
      row,
      cells,
      bars,
      barsHeight,
      naturalHeight: Math.max(barsHeight + ROW_PAD * 2, labelMin),
    };
  });

  // 줄 수가 제각각이어도 행 높이는 같아야 읽기 편하다 — 가장 높은 행에 맞춘다.
  const uniformHeight = uniformRows
    ? prepared.reduce((max, p) => Math.max(max, p.naturalHeight), 0)
    : 0;

  // 2패스 — 확정된 높이로 그린다.
  for (const { row, cells, bars, barsHeight, naturalHeight } of prepared) {
    const rowHeight = uniformRows ? uniformHeight : naturalHeight;
    const barsTop = Math.round((rowHeight - barsHeight) / 2);

    const rowEl = el('div', 'gantt__row');
    rowEl.style.height = `${rowHeight}px`;

    cols.forEach((col, i) => {
      const cell = cells[i] ?? {};

      // cell.lines 가 있으면 그 열은 레인에 맞춰 여러 줄로 쪼개진다.
      // 각 줄을 대응하는 바 레인과 같은 y좌표에 절대배치해 세로 정렬을 보장한다
      // (한 항목이 레인 여러 개를 쓰면 span 만큼 높이를 차지하고 라벨은 한 번만 나온다).
      if (cell.lines) {
        const content = cell.lines
          .map((line) => {
            const span = line.span ?? 1;
            const top = barsTop + line.lane * (BAR_H + LANE_GAP);
            const height = span * BAR_H + (span - 1) * LANE_GAP;
            return `<span class="gantt__laneline" style="top:${top}px;height:${height}px">
              <span class="gantt__rowlabel gantt__rowlabel--sub">${escapeHtml(line.text)}</span>
            </span>`;
          })
          .join('');
        rowEl.appendChild(labelCell(col, i, content, ' gantt__labelcol--lanes'));
        return;
      }

      const content = `
        ${cell.text ? `<span class="gantt__rowlabel${i > 0 ? ' gantt__rowlabel--sub' : ''}">${escapeHtml(cell.text)}</span>` : ''}
        ${cell.sub ? `<span class="gantt__rowsub">${escapeHtml(cell.sub)}</span>` : ''}
        ${i === 0 && row.badge ? badgeHtml(row.badge) : ''}
      `;
      rowEl.appendChild(labelCell(col, i, content));
    });

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
      const node = el(
        'div',
        `gbar gbar--${colorClass(bar.color)}${bar.kind ? ` gbar--${bar.kind}` : ''}`
      );
      node.style.left = `calc(${leftPct}% + 1px)`; // 좌우 1px씩 → 맞닿는 바 사이 2px 표면 간격
      node.style.width = `calc(${widthPct}% - 2px)`;
      node.style.top = `${barsTop + bar.lane * (BAR_H + LANE_GAP)}px`;
      node.style.height = `${BAR_H}px`;
      if (bar.clippedStart) node.classList.add('is-clipped-start');
      if (bar.clippedEnd) node.classList.add('is-clipped-end');
      node.tabIndex = 0;
      node.setAttribute('role', 'img');
      node.setAttribute('aria-label', bar.aria ?? `${cells[0]?.text ?? ''} ${bar.label}`);
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

/**
 * 라벨 배치. 바 안에 들어가면 안에, 아니면 바 오른쪽 바깥으로 내보낸다.
 * 바깥에 낼 자리조차 없으면 (같은 줄에 바로 다음 바가 붙어 있으면) 아예 감춘다 —
 * 옆 바 위에 글자가 겹쳐 찍히는 것이 라벨 없는 것보다 나쁘기 때문이다.
 * 감춘 값은 툴팁과 '표' 보기에 그대로 남아 있어 어디서도 사라지지 않는다.
 */
function fitLabels(root) {
  for (const layer of root.querySelectorAll('.gantt__bars')) {
    const lanes = new Map();
    for (const bar of layer.querySelectorAll('.gbar')) {
      const key = bar.style.top;
      if (!lanes.has(key)) lanes.set(key, []);
      lanes.get(key).push(bar);
    }

    for (const lane of lanes.values()) {
      lane.sort((a, b) => a.offsetLeft - b.offsetLeft);
      lane.forEach((bar, i) => {
        const label = bar.querySelector('.gbar__label');
        if (!label) return;
        bar.classList.remove('has-outside-label', 'has-hidden-label');
        if (!label.textContent.trim()) return;
        if (label.scrollWidth + 14 <= bar.clientWidth) return;

        bar.classList.add('has-outside-label');
        const barEnd = bar.offsetLeft + bar.offsetWidth;
        const next = lane[i + 1];
        const room = (next ? next.offsetLeft : layer.clientWidth) - barEnd - 9;
        if (label.scrollWidth > room) bar.classList.add('has-hidden-label');
      });
    }
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
        `<span class="legend__item"><span class="legend__swatch legend__swatch--${colorClass(item.color)}"></span>${escapeHtml(item.label)}</span>`
    )
    .join('');
  return node;
}

/**
 * 카드 껍데기 + '차트 / 표' 전환.
 * 모든 차트는 표 보기 쌍을 갖는다 — 색만으로 정보가 갇히지 않게 하기 위한 장치다.
 */
export function chartCard({ title, subtitle, actions, legend, chart, table, id, className = '' }) {
  const card = el('section', `card ${className}`.trim());
  if (id) card.id = id;

  // 설명이 여러 갈래면 배열로 넘긴다 — 한 갈래가 한 줄을 차지해
  // 문장 도중에 줄이 접히지 않는다.
  const subHtml = Array.isArray(subtitle)
    ? subtitle.map((line) => `<span class="subline">${escapeHtml(line)}</span>`).join('')
    : subtitle
      ? escapeHtml(subtitle)
      : '';

  const head = el('header', 'card__head');
  head.innerHTML = `
    <div class="card__titles">
      <h2 class="card__title">${escapeHtml(title)}</h2>
      ${subHtml ? `<p class="card__sub">${subHtml}</p>` : ''}
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
