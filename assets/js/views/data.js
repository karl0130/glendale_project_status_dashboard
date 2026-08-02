// 데이터 & 아카이브.
//
// 이 화면이 "저장 버튼"의 역할을 한다. 서버가 없으므로 브라우저의 입력은
// 자동으로 공유되지 않는다 — 내보낸 JSON을 data/ 아래에 커밋해야 팀 전체에 반영된다.
// 그리고 그 커밋 이력 자체가 아카이브가 된다.

import * as store from '../store.js';
import { GOOGLE } from '../config.js';
import { confirmDialog, el, openForm, toast } from '../ui.js';
import { escapeHtml, fmtDate, today, toISO } from '../util.js';

const COLLECTIONS = [
  { key: 'projects', label: '프로젝트', desc: 'Project Status 입력값' },
  { key: 'weeklyUpdates', label: '주간 업무', desc: 'Weekly Work Updates 입력값' },
  { key: 'vacations', label: '휴가', desc: '휴가 관리 입력값' },
  { key: 'employees', label: '인력', desc: '구성원 명단' },
];

export function render(ctx) {
  const connected = store.source() === 'sheets';
  const view = el('div', 'view__inner');
  view.appendChild(pageHead());
  view.appendChild(connectionCard(ctx));
  // 시트에 연결되면 data/*.json 은 더 이상 저장 경로가 아니다.
  // 내보내기-커밋 흐름을 그대로 두면 실제 데이터를 공개 레포에 올리게 된다.
  view.appendChild(connected ? repoFilesCard() : syncCard(ctx));
  view.appendChild(archiveCard(connected));
  return view;
}

// ── 시트 연결 후: 레포 JSON 의 역할 안내 ────────────────────────────────────

function repoFilesCard() {
  const card = el('section', 'card');
  card.innerHTML = `
    <header class="card__head">
      <div class="card__titles">
        <h2 class="card__title">레포의 <code>data/*.json</code></h2>
        <p class="card__sub">지금은 저장 경로가 아님 · 로그인 전에 보이는 표본 데이터</p>
      </div>
    </header>
  `;
  const body = el('div', 'card__body');
  body.appendChild(
    el(
      'p',
      'callout callout--warning',
      '<strong>시트의 실제 데이터를 이 파일들에 커밋하지 말 것</strong><br>' +
        '<code>data/</code> 는 GitHub Pages 로 그대로 공개되므로, 커밋하는 순간 고객사명과 인력 배치가 ' +
        'URL 아는 사람 누구에게나 보인다. 백업이 필요하면 아래 스냅샷을 쓸 것'
    )
  );
  body.appendChild(
    el(
      'p',
      'callout',
      '이 파일들은 <strong>로그인하지 않은 사람에게 보이는 화면</strong>을 채우는 용도로만 남아 있다. ' +
        '표본 데이터로 두는 것이 맞다'
    )
  );
  card.appendChild(body);
  return card;
}

// ── 구글 시트 연결 ──────────────────────────────────────────────────────────

function connectionCard(ctx) {
  const status = store.sheetStatus(); // disconnected | needs-bootstrap | connected
  const card = el('section', 'card');
  card.innerHTML = `
    <header class="card__head">
      <div class="card__titles">
        <h2 class="card__title">구글 시트 연결</h2>
        <p class="card__sub">연결하면 입력이 즉시 팀 전체에 반영</p>
      </div>
    </header>
  `;

  const body = el('div', 'card__body');
  const actions = el('div', 'sync-row__actions');
  actions.style.padding = '0 18px 14px';

  const runBootstrap = async () => {
    if (
      !confirmDialog(
        '스프레드시트에 탭과 헤더를 만들고 현재 화면의 데이터를 넣습니다.\n' +
          '이미 같은 이름의 탭이 있으면 그 내용은 덮어써집니다.\n\n계속할까요?'
      )
    ) {
      return;
    }
    try {
      const res = await store.bootstrapSheet();
      toast(
        res.created.length ? `시트 초기화 완료 (탭 ${res.created.length}개 생성)` : '시트 초기화 완료',
        'good'
      );
      ctx.rerender();
    } catch (err) {
      toast(`초기화 실패 — ${err.message}`, 'warning');
    }
  };

  if (status === 'connected') {
    body.appendChild(
      el(
        'p',
        'callout',
        `<strong>연결됨</strong> · ${escapeHtml(store.account()?.email ?? '')} · 리비전 ${store.revision()}<br>` +
          '모든 입력이 구글 시트에 바로 저장되고 팀원 화면에도 반영'
      )
    );

    const refresh = el('button', 'btn', '시트에서 다시 불러오기');
    refresh.addEventListener('click', async () => {
      try {
        await store.pull();
        toast('최신 내용을 불러왔습니다', 'good');
        ctx.rerender();
      } catch (err) {
        toast(`불러오기 실패 — ${err.message}`, 'warning');
      }
    });
    actions.appendChild(refresh);

    const again = el('button', 'btn btn--ghost', '시트 다시 초기화');
    again.title = '탭이나 헤더가 망가졌을 때만 사용 — 현재 화면 데이터로 덮어씁니다';
    again.addEventListener('click', runBootstrap);
    actions.appendChild(again);
  } else if (status === 'needs-bootstrap') {
    const missing = store.missingTabs();
    body.appendChild(
      el(
        'p',
        'callout callout--warning',
        '<strong>로그인은 됐지만 시트가 비어 있음</strong> · 아래 버튼을 누르면 탭과 헤더를 만들고 ' +
          '현재 화면의 데이터를 넣음<br>' +
          `없는 탭: <code>${missing.map(escapeHtml).join('</code> <code>')}</code>`
      )
    );
    const init = el('button', 'btn btn--primary', '시트 초기화 — 탭 만들고 데이터 넣기');
    init.addEventListener('click', runBootstrap);
    actions.appendChild(init);
  } else {
    body.appendChild(
      el(
        'p',
        'callout callout--warning',
        '<strong>연결 안 됨</strong> · 지금 입력하는 내용은 이 브라우저에만 저장되고 공유되지 않음<br>' +
          '우측 상단 <strong>구글 로그인</strong> 버튼으로 연결'
      )
    );
    const signIn = el('button', 'btn btn--primary', '구글 로그인하고 연결');
    signIn.addEventListener('click', () => ctx.connect({ interactive: true }));
    actions.appendChild(signIn);
  }

  body.appendChild(actions);
  card.appendChild(body);
  return card;
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

function archiveCard(connected) {
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
      connected
        ? '일상적인 이력은 <strong>구글 시트의 버전 기록이 대신함</strong> · 시트에서 ' +
            '<code>파일 → 버전 기록 → 버전 기록 보기</code> 로 언제든 되돌리기 가능<br>' +
            '아래 스냅샷은 월말 보고용 파일이나 구글 밖 백업이 필요할 때 사용'
        : '<code>data/</code> 를 커밋해두면 git 이력이 그대로 시점별 기록이 됨<br>' +
            '아래 스냅샷은 월말 보고처럼 파일 하나로 남겨야 할 때만 사용'
    )
  );

  if (connected) {
    const link = el('p', 'callout');
    link.innerHTML =
      `<a href="https://docs.google.com/spreadsheets/d/${escapeHtml(GOOGLE.spreadsheetId)}/edit" ` +
      'target="_blank" rel="noopener"><strong>스프레드시트 열기 →</strong></a> · 원본 데이터와 버전 기록';
    body.appendChild(link);
  }

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
