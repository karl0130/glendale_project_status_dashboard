// 데이터 & 아카이브.
//
// 이 화면이 "저장 버튼"의 역할을 한다. 서버가 없으므로 브라우저의 입력은
// 자동으로 공유되지 않는다 — 내보낸 JSON을 data/ 아래에 커밋해야 팀 전체에 반영된다.
// 그리고 그 커밋 이력 자체가 아카이브가 된다.

import * as store from '../store.js';
import { confirmDialog, el, openForm, toast } from '../ui.js';
import { escapeHtml, fmtDate, today, toISO } from '../util.js';

const COLLECTIONS = [
  { key: 'projects', label: '프로젝트', desc: 'Project Status 입력값' },
  { key: 'weeklyUpdates', label: '주간 업무', desc: 'Weekly Work Updates 입력값' },
  { key: 'vacations', label: '휴가', desc: '휴가 관리 입력값' },
  { key: 'employees', label: '인력', desc: '구성원 명단' },
];

export function render(ctx) {
  const view = el('div', 'view__inner');
  view.appendChild(pageHead());
  view.appendChild(syncCard(ctx));
  view.appendChild(archiveCard());
  return view;
}

function pageHead() {
  const head = el('div', 'page-head');
  head.innerHTML = `
    <div>
      <h1 class="page-title">데이터 &amp; 아카이브</h1>
      <p class="page-sub">대시보드 데이터 관리 및 아카이브</p>
    </div>
  `;
  return head;
}

// ── 반영(내보내기) ──────────────────────────────────────────────────────────

function syncCard(ctx) {
  const changed = store.changedCollections();
  const card = el('section', 'card');
  card.innerHTML = `
    <header class="card__head">
      <div class="card__titles">
        <h2 class="card__title">변경사항 반영</h2>
        <p class="card__sub">브라우저에 저장된 변경을 레포의 <code>data/</code> 파일로 이관</p>
      </div>
    </header>
  `;

  const body = el('div', 'card__body');
  body.appendChild(
    el(
      'p',
      `callout${changed.length ? ' callout--warning' : ''}`,
      changed.length
        ? `<strong>이 브라우저에만 저장된 변경 ${changed.length}건</strong> · 해당 파일을 내려받아 <code>data/</code> 에 덮어쓰고 커밋해야 팀에 반영`
        : '레포에 커밋된 데이터와 동일'
    )
  );

  const list = el('div', 'sync-list');
  for (const col of COLLECTIONS) {
    const isChanged = changed.includes(col.key);
    const row = el('div', `sync-row${isChanged ? ' is-changed' : ''}`);
    row.innerHTML = `
      <div class="sync-row__meta">
        <span class="sync-row__name">${escapeHtml(col.label)}
          <code>data/${store.FILENAMES[col.key]}</code>
        </span>
        <span class="sync-row__desc">${escapeHtml(col.desc)} · ${store.all(col.key).length}건
          ${isChanged ? '<span class="pill pill--hold">변경됨</span>' : '<span class="pill pill--neutral">동일</span>'}
        </span>
      </div>
      <div class="sync-row__actions">
        <button type="button" class="btn btn--ghost" data-copy="${col.key}">복사</button>
        <button type="button" class="btn" data-download="${col.key}">내려받기</button>
        <button type="button" class="btn btn--ghost" data-import="${col.key}">가져오기</button>
      </div>
    `;
    list.appendChild(row);
  }

  list.addEventListener('click', async (e) => {
    const copy = e.target.closest('[data-copy]');
    const download = e.target.closest('[data-download]');
    const imp = e.target.closest('[data-import]');
    if (copy) {
      await navigator.clipboard.writeText(store.exportJSON(copy.dataset.copy));
      toast('JSON 클립보드 복사 완료', 'good');
    }
    if (download) {
      const key = download.dataset.download;
      downloadFile(store.FILENAMES[key], store.exportJSON(key));
    }
    if (imp) {
      const key = imp.dataset.import;
      openForm({
        title: `${COLLECTIONS.find((c) => c.key === key).label} 가져오기`,
        subtitle: 'JSON 배열 붙여넣기 · 현재 데이터를 덮어씀',
        submitLabel: '덮어쓰기',
        fields: [{ name: 'json', label: 'JSON', type: 'textarea', rows: 12, required: true, colspan: 2 }],
        onSubmit: (data) => {
          store.importJSON(key, data.json); // JSON 오류는 폼이 잡아서 표시한다
          toast('가져오기 완료', 'good');
          ctx.rerender();
        },
      });
    }
  });

  body.appendChild(list);

  const foot = el('div', 'sync-foot');
  const reset = el('button', 'btn btn--danger-ghost', '레포 원본으로 되돌리기');
  reset.addEventListener('click', () => {
    if (confirmDialog('이 브라우저의 변경사항을 모두 버리고 레포 데이터로 되돌립니다.\n계속할까요?')) {
      store.resetToRepo();
      toast('레포 데이터로 되돌림', 'info');
      ctx.rerender();
    }
  });
  foot.appendChild(reset);
  body.appendChild(foot);

  card.appendChild(body);
  return card;
}

// ── 아카이브 ────────────────────────────────────────────────────────────────

function archiveCard() {
  const card = el('section', 'card');
  card.innerHTML = `
    <header class="card__head">
      <div class="card__titles">
        <h2 class="card__title">스냅샷 아카이브</h2>
        <p class="card__sub">특정 시점의 전체 데이터를 한 파일로 보관</p>
      </div>
    </header>
  `;
  const body = el('div', 'card__body');
  body.appendChild(
    el(
      'p',
      'callout',
      '일상적인 아카이빙은 <strong>git 커밋 이력이 대신함</strong> · <code>data/</code> 를 커밋해두면 "8월 1일 시점의 프로젝트 현황"을 언제든 복원 가능<br>아래 스냅샷은 월말 보고처럼 파일 하나로 남겨야 할 때만 사용'
    )
  );

  const btn = el('button', 'btn btn--primary', `${fmtDate(today())} 스냅샷 내려받기`);
  btn.addEventListener('click', () => {
    const snapshot = {
      snapshotDate: toISO(today()),
      generatedBy: 'Glendale Korea Project Dashboard',
      employees: JSON.parse(store.exportJSON('employees')),
      projects: JSON.parse(store.exportJSON('projects')),
      vacations: JSON.parse(store.exportJSON('vacations')),
      weeklyUpdates: JSON.parse(store.exportJSON('weeklyUpdates')),
    };
    downloadFile(`glendale-snapshot-${toISO(today())}.json`, `${JSON.stringify(snapshot, null, 2)}\n`);
  });
  body.appendChild(btn);
  card.appendChild(body);
  return card;
}

function downloadFile(filename, text) {
  const blob = new Blob([text], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
  toast(`${filename} 내려받기 완료`, 'good');
}
