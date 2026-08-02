// 셸 + 해시 라우터.

import * as store from './store.js';
import { el, hideTooltip, toast } from './ui.js';
import { escapeHtml, fmtDate, today } from './util.js';
import * as overview from './views/overview.js';
import * as projects from './views/projects.js';
import * as resources from './views/resources.js';
import * as weekly from './views/weekly.js';
import * as vacations from './views/vacations.js';
import * as mypage from './views/mypage.js';
import * as dataView from './views/data.js';

// 아이콘은 전부 인라인 SVG — 외부 아이콘 폰트나 CDN에 기대지 않는다.
const ICONS = {
  overview: '<rect x="3" y="3" width="7.5" height="7.5" rx="1.6"/><rect x="13.5" y="3" width="7.5" height="7.5" rx="1.6"/><rect x="3" y="13.5" width="7.5" height="7.5" rx="1.6"/><rect x="13.5" y="13.5" width="7.5" height="7.5" rx="1.6"/>',
  projects: '<path d="M6 3h7.5L18 7.5V21H6z"/><path d="M13.5 3v4.5H18"/><path d="M9 12.5h6M9 16.5h6"/>',
  resources: '<circle cx="9" cy="8" r="3.2"/><path d="M3 20.5c0-3.4 2.7-6.2 6-6.2s6 2.8 6 6.2"/><circle cx="17.5" cy="9.5" r="2.4"/><path d="M16.6 14.6c2.6.5 4.4 2.9 4.4 5.9"/>',
  weekly: '<rect x="3" y="5" width="18" height="16" rx="2.2"/><path d="M8 3v4M16 3v4M3 10.5h18"/><path d="M9 15.5l2 2 4-4"/>',
  vacations: '<circle cx="12" cy="12" r="3.8"/><path d="M12 3v2.2M12 18.8V21M3 12h2.2M18.8 12H21M5.6 5.6l1.6 1.6M16.8 16.8l1.6 1.6M18.4 5.6l-1.6 1.6M7.2 16.8l-1.6 1.6"/>',
  data: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-1.8-.3 1.7 1.7 0 00-1 1.5V21a2 2 0 11-4 0v-.1A1.7 1.7 0 008 19.3a1.7 1.7 0 00-1.8.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.7 1.7 0 00.3-1.8 1.7 1.7 0 00-1.5-1H2a2 2 0 110-4h.1A1.7 1.7 0 003.7 8a1.7 1.7 0 00-.3-1.8l-.1-.1a2 2 0 112.8-2.8l.1.1a1.7 1.7 0 001.8.3H8a1.7 1.7 0 001-1.5V2a2 2 0 114 0v.1a1.7 1.7 0 001 1.5 1.7 1.7 0 001.8-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 00-.3 1.8V8a1.7 1.7 0 001.5 1H22a2 2 0 110 4h-.1a1.7 1.7 0 00-1.5 1z"/>',
};

const ROUTES = [
  { id: 'overview', label: 'Overview', sub: '전체 현황', render: overview.render },
  { id: 'projects', label: 'Project Status', sub: '프로젝트 등록 · 일정', render: projects.render },
  { id: 'resources', label: 'Resource Planning', sub: '인력 투입 현황', render: resources.render },
  { id: 'weekly', label: 'Weekly Work Updates', sub: '주간 업무 보고', render: weekly.render },
  { id: 'vacations', label: '휴가 관리', sub: '휴가 신청 · 일정', render: vacations.render },
  { id: 'data', label: '설정', sub: '시트 연결 · 백업', render: dataView.render },
  // 사이드바에는 넣지 않는다. 상단 계정 영역의 아이콘으로만 들어간다.
  { id: 'mypage', label: 'My Page', sub: '내 연차 · 휴가 신청', render: mypage.render },
];

const DETAIL_IDS = ['projects', 'resources', 'weekly', 'vacations'];

const app = document.getElementById('app');

function currentRoute() {
  const id = location.hash.replace(/^#\/?/, '') || 'overview';
  return ROUTES.find((r) => r.id === id) ?? ROUTES[0];
}

const ctx = {
  rerender(opts = {}) {
    const main = document.getElementById('view');
    const scroll = main?.scrollTop ?? 0;
    paint();
    const next = document.getElementById('view');
    if (next) next.scrollTop = scroll;
    if (opts.focus) {
      const node = document.querySelector(opts.focus);
      if (node) {
        node.focus();
        if (node.setSelectionRange && node.value) node.setSelectionRange(node.value.length, node.value.length);
      }
    }
  },
  navigate(id) {
    location.hash = `#/${id}`;
  },
  connect,
};

function paint() {
  hideTooltip();
  const route = currentRoute();
  document.title = `${route.label} · Glendale Korea Project Dashboard`;

  app.innerHTML = '';
  app.appendChild(topbar());

  const bodyEl = el('div', 'app__body');
  bodyEl.appendChild(sidebar(route));

  const main = el('main', 'view');
  main.id = 'view';
  main.setAttribute('role', 'main');
  try {
    main.appendChild(route.render(ctx));
  } catch (err) {
    console.error(err);
    main.appendChild(el('p', 'callout callout--warning', `화면을 그리는 중 오류 발생 — ${err.message}`));
  }
  bodyEl.appendChild(main);
  app.appendChild(bodyEl);
}

/** 저장 상태만 바뀌었을 때 화면 전체를 다시 그리면 입력 포커스가 날아간다. 상단만 교체한다. */
function refreshTopbar() {
  const old = app.querySelector('.topbar');
  if (old) old.replaceWith(topbar());
}

async function connect({ interactive = false } = {}) {
  try {
    const result = await store.connect({ interactive });
    if (result === 'needs-bootstrap') {
      // 빈 스프레드시트다. 초기화 화면으로 데려간다 — 여기서 헤매기 딱 좋다.
      if (interactive) {
        toast('시트가 비어 있습니다. 초기화가 필요합니다.', 'warning');
        ctx.navigate('data');
      }
      ctx.rerender();
    } else if (result) {
      toast('구글 시트에 연결되었습니다', 'good');
      ctx.rerender();
    }
    return result;
  } catch (err) {
    console.error(err);
    if (interactive) toast(`연결 실패 — ${err.message}`, 'warning');
    refreshTopbar();
    return false;
  }
}

function topbar() {
  const bar = el('header', 'topbar');
  bar.innerHTML = `
    <div class="brand">
      <img class="brand__logo" src="assets/img/logo.png" alt="Glendale Korea" />
      <span class="brand__divider" aria-hidden="true"></span>
      <h1 class="brand__title">Glendale Korea Project Dashboard</h1>
    </div>
    <div class="topbar__meta"></div>
  `;

  const meta = bar.querySelector('.topbar__meta');

  if (store.source() === 'sheets') {
    const { status, message } = store.saveState();

    if (status === 'reauth') {
      // 세션이 끊겼다. 저장 못 한 내용이 남아 있으니 버튼 하나로 이어서 처리한다.
      const retry = el(
        'button',
        'savestate savestate--action',
        '<span class="dot dot--critical" aria-hidden="true"></span>다시 로그인하고 저장'
      );
      retry.title = '로그인 세션이 만료되어 저장하지 못한 내용이 있습니다';
      retry.addEventListener('click', async () => {
        try {
          const done = await store.reauthAndRetry();
          toast(done ? '저장했습니다' : '일부 저장에 실패했습니다', done ? 'good' : 'warning');
        } catch (err) {
          toast(`로그인 실패 — ${err.message}`, 'warning');
        }
      });
      meta.appendChild(retry);
      return bar;
    }

    // 평상시(idle)에는 아무것도 띄우지 않는다. 저장 중·실패처럼 사용자가 알아야 할
    // 순간에만 나타나게 해서 상단을 조용하게 둔다.
    if (status === 'saving' || status === 'saved' || status === 'error') {
      const chip = el('span', `savestate savestate--${status}`);
      const text = { saving: '저장 중…', saved: '저장됨', error: '저장 실패' }[status];
      const tone = { saving: 'warning', saved: 'good', error: 'critical' }[status];
      chip.innerHTML = `<span class="dot dot--${tone}" aria-hidden="true"></span>${escapeHtml(text)}`;
      if (status === 'error') chip.title = message;
      meta.appendChild(chip);
    }

    const me = store.currentEmployee();
    const pending = store.canApprove(me) ? store.pendingVacations().length : 0;

    const account = el('button', 'account');
    account.innerHTML = `
      <span class="account__email">${escapeHtml(store.account()?.email ?? '')}</span>
      <span class="account__icon" aria-hidden="true">
        <svg viewBox="0 0 24 24"><circle cx="12" cy="8.5" r="3.6"/><path d="M4.5 20.5c0-4 3.4-7.2 7.5-7.2s7.5 3.2 7.5 7.2"/></svg>
      </span>
      ${pending ? `<span class="account__badge">${pending}</span>` : ''}
    `;
    account.title = pending ? `My Page — 승인 대기 ${pending}건` : 'My Page';
    account.addEventListener('click', () => ctx.navigate('mypage'));
    meta.appendChild(account);
  } else if (store.sheetStatus() === 'needs-bootstrap') {
    const badge = el(
      'button',
      'savestate savestate--dirty',
      '<span class="dot dot--warning" aria-hidden="true"></span>시트 초기화 필요'
    );
    badge.addEventListener('click', () => ctx.navigate('data'));
    meta.appendChild(badge);
  } else {
    if (store.hasLocalChanges()) {
      const badge = el(
        'span',
        'savestate savestate--dirty',
        '<span class="dot dot--warning" aria-hidden="true"></span>이 브라우저에만 저장됨'
      );
      meta.appendChild(badge);
    }
    const signIn = el('button', 'savestate savestate--action', '구글 로그인');
    signIn.title = '구글 시트에 연결하면 입력이 팀 전체에 공유됩니다';
    signIn.addEventListener('click', () => connect({ interactive: true }));
    meta.appendChild(signIn);
  }

  return bar;
}

function sidebar(active) {
  const nav = el('nav', 'sidebar');
  nav.setAttribute('aria-label', '상세 페이지');

  const main = ROUTES.filter((r) => r.id === 'overview');
  const details = ROUTES.filter((r) => DETAIL_IDS.includes(r.id));
  const utils = ROUTES.filter((r) => r.id === 'data');

  nav.appendChild(navGroup('메인', main, active));
  nav.appendChild(navGroup('상세', details, active));
  nav.appendChild(navGroup('관리', utils, active));
  return nav;
}

function navGroup(title, routes, active) {
  const group = el('div', 'navgroup');
  group.appendChild(el('h2', 'navgroup__title', title));
  const list = el('ul', 'navlist');
  for (const route of routes) {
    const item = el('li');
    item.innerHTML = `
      <a class="navlink${route.id === active.id ? ' is-active' : ''}" href="#/${route.id}"
         ${route.id === active.id ? 'aria-current="page"' : ''}>
        <span class="navlink__icon" aria-hidden="true">
          <svg viewBox="0 0 24 24">${ICONS[route.id]}</svg>
        </span>
        <span class="navlink__text">
          <span class="navlink__label">${route.label}</span>
          <span class="navlink__sub">${route.sub}</span>
        </span>
      </a>
    `;
    list.appendChild(item);
  }
  group.appendChild(list);
  return group;
}

window.addEventListener('hashchange', paint);
window.addEventListener('scroll', hideTooltip, true);

// 저장 상태 표시만 갱신한다. 전체 리렌더는 각 화면이 직접 요청한다.
store.subscribe(refreshTopbar);

store
  .load()
  .then(() => {
    paint();
    // 캐시로 먼저 그린 뒤, 세션이 살아 있으면 조용히 시트에 붙어 최신 값으로 교체한다.
    connect({ interactive: false });
  })
  .catch((err) => {
    console.error(err);
    app.innerHTML = `
      <div class="fatal">
        <h1>데이터 불러오기 실패</h1>
        <p>${err.message}</p>
        <p class="fatal__hint">파일을 직접 여는 방식은 동작하지 않음 · 로컬 서버 실행 필요<br>
          <code>python -m http.server 8000</code> 실행 후 <code>http://localhost:8000</code> 접속</p>
      </div>`;
  });
