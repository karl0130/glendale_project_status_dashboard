// 셸 + 해시 라우터.

import * as store from './store.js';
import { el, hideTooltip, toast } from './ui.js';
import { fmtDate, today } from './util.js';
import * as overview from './views/overview.js';
import * as projects from './views/projects.js';
import * as resources from './views/resources.js';
import * as weekly from './views/weekly.js';
import * as dataView from './views/data.js';

const ROUTES = [
  { id: 'overview', num: '', label: 'Overview', sub: '전체 현황', render: overview.render },
  { id: 'projects', num: '1', label: 'Project Status', sub: '프로젝트 등록 · 일정', render: projects.render },
  { id: 'resources', num: '2', label: 'Resource Planning', sub: '인력 투입 현황', render: resources.render },
  { id: 'weekly', num: '3', label: 'Weekly Work Updates', sub: '주간 업무 보고', render: weekly.render },
  { id: 'data', num: '', label: '데이터 & 아카이브', sub: '반영 · 백업', render: dataView.render },
];

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
    main.appendChild(el('p', 'callout callout--warning', `화면을 그리는 중 오류가 발생했습니다: ${err.message}`));
  }
  bodyEl.appendChild(main);
  app.appendChild(bodyEl);
}

function topbar() {
  const bar = el('header', 'topbar');
  bar.innerHTML = `
    <div class="brand">
      <span class="brand__mark" aria-hidden="true"></span>
      <div class="brand__text">
        <h1 class="brand__title">Glendale Korea Project Dashboard</h1>
        <p class="brand__sub">프로젝트 일정 · 인력 리소스 · 주간 업무 통합 관리</p>
      </div>
    </div>
    <div class="topbar__meta">
      <span class="topbar__date">${fmtDate(today())}</span>
    </div>
  `;

  const meta = bar.querySelector('.topbar__meta');
  if (store.hasLocalChanges()) {
    const badge = el(
      'button',
      'savestate savestate--dirty',
      '<span class="dot dot--warning" aria-hidden="true"></span>미반영 변경 있음'
    );
    badge.title = '이 브라우저에만 저장된 변경이 있습니다. 클릭하면 반영 화면으로 이동합니다.';
    badge.addEventListener('click', () => ctx.navigate('data'));
    meta.appendChild(badge);
  } else {
    meta.appendChild(
      el('span', 'savestate', '<span class="dot dot--good" aria-hidden="true"></span>레포와 동일')
    );
  }
  return bar;
}

function sidebar(active) {
  const nav = el('nav', 'sidebar');
  nav.setAttribute('aria-label', '상세 페이지');

  const main = ROUTES.filter((r) => r.id === 'overview');
  const details = ROUTES.filter((r) => r.num);
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
        ${route.num ? `<span class="navlink__num">${route.num}</span>` : '<span class="navlink__num navlink__num--dot">•</span>'}
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

store
  .load()
  .then(() => {
    paint();
    if (store.hasLocalChanges()) {
      toast('이 브라우저에 저장된 변경사항을 불러왔습니다.', 'info');
    }
  })
  .catch((err) => {
    console.error(err);
    app.innerHTML = `
      <div class="fatal">
        <h1>데이터를 불러오지 못했습니다</h1>
        <p>${err.message}</p>
        <p class="fatal__hint">파일을 직접 열지 말고 로컬 서버로 실행해야 합니다:
          <code>python -m http.server 8000</code> 실행 후 <code>http://localhost:8000</code> 으로 접속하세요.</p>
      </div>`;
  });
