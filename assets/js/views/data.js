// 설정 — 구글 시트 연결과 백업.
//
// 시트가 원본이 된 뒤로 이 화면이 할 일은 셋뿐이다: 연결 상태 확인, 최신 내용 다시 받기,
// 백업 받기. 예전에 있던 "JSON 내보내서 레포에 커밋" 흐름은 시트 연결 상태에서는
// 실제 데이터를 공개 레포에 올리는 길이라 아예 걷어냈다.

import * as store from '../store.js';
import { GOOGLE } from '../config.js';
import { confirmDialog, el, toast } from '../ui.js';
import { escapeHtml, fmtDate, today, toISO } from '../util.js';

const SHEET_URL = `https://docs.google.com/spreadsheets/d/${GOOGLE.spreadsheetId}/edit`;

export function render(ctx) {
  const view = el('div', 'view__inner');
  view.appendChild(pageHead());
  view.appendChild(connectionCard(ctx));
  view.appendChild(backupCard());
  return view;
}

function pageHead() {
  const head = el('div', 'page-head');
  head.innerHTML = `
    <div>
      <h1 class="page-title">설정</h1>
      <p class="page-sub">구글 시트 연결 및 백업</p>
    </div>
  `;
  return head;
}

// ── 구글 시트 연결 ──────────────────────────────────────────────────────────

function connectionCard(ctx) {
  const status = store.sheetStatus(); // disconnected | needs-bootstrap | connected
  const card = el('section', 'card');
  card.innerHTML = `
    <header class="card__head">
      <div class="card__titles">
        <h2 class="card__title">구글 시트 연결</h2>
        <p class="card__sub">데이터 원본 · 저장 즉시 팀 전체에 반영</p>
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
          '모든 입력이 시트에 바로 저장되고 팀원 화면에도 반영'
      )
    );

    const open = el('a', 'btn btn--primary', '스프레드시트 열기 ↗');
    open.href = SHEET_URL;
    open.target = '_blank';
    open.rel = 'noopener';
    actions.appendChild(open);

    const refresh = el('button', 'btn', '최신 내용 다시 받기');
    refresh.title = '다른 사람이 저장한 내용을 지금 반영합니다';
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
        '<strong>연결 안 됨</strong> · 지금 보이는 것은 <code>data/*.json</code> 의 표본 데이터이고, ' +
          '입력해도 이 브라우저에만 남는다<br>실제 데이터를 보려면 로그인이 필요'
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

// ── 백업 ────────────────────────────────────────────────────────────────────

function backupCard() {
  const connected = store.source() === 'sheets';
  const card = el('section', 'card');
  card.innerHTML = `
    <header class="card__head">
      <div class="card__titles">
        <h2 class="card__title">백업</h2>
        <p class="card__sub">전체 데이터를 한 파일로 내려받기</p>
      </div>
    </header>
  `;
  const body = el('div', 'card__body');
  body.appendChild(
    el(
      'p',
      'callout',
      connected
        ? '되돌리기는 <strong>시트의 버전 기록</strong>으로 하는 것이 빠름 — ' +
            '<code>파일 → 버전 기록 → 버전 기록 보기</code><br>' +
            '아래 파일은 구글 계정 밖에 사본을 남겨야 할 때 사용'
        : '<strong>연결 전이라 표본 데이터가 담긴다</strong> · 실제 데이터를 받으려면 먼저 로그인할 것'
    )
  );

  const btn = el('button', 'btn btn--primary', `${fmtDate(today())} 백업 내려받기`);
  btn.addEventListener('click', () => {
    const snapshot = {
      snapshotDate: toISO(today()),
      source: connected ? 'google-sheets' : 'local',
      spreadsheetId: connected ? GOOGLE.spreadsheetId : '',
      generatedBy: 'Glendale Korea Project Dashboard',
      employees: JSON.parse(store.exportJSON('employees')),
      projects: JSON.parse(store.exportJSON('projects')),
      vacations: JSON.parse(store.exportJSON('vacations')),
      weeklyUpdates: JSON.parse(store.exportJSON('weeklyUpdates')),
    };
    downloadFile(`glendale-backup-${toISO(today())}.json`, `${JSON.stringify(snapshot, null, 2)}\n`);
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
