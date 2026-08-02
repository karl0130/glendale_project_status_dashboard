// Google Identity Services 토큰 클라이언트 래퍼.
//
// 서버가 없어도 되는 이유가 여기 있다. 이 흐름은 클라이언트 시크릿을 쓰지 않고
// 브라우저에서 바로 액세스 토큰을 받는다. 토큰 수명은 1시간이고 갱신 토큰은 주지 않으므로,
// 만료되면 조용히 다시 받아온다 (세션이 살아 있으면 팝업 없이 통과한다).

import { GOOGLE } from '../config.js';

let tokenClient = null;
let accessToken = null;
let expiresAt = 0;
let account = null; // { email }

const listeners = new Set();

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function emit() {
  listeners.forEach((fn) => fn());
}

export function isConfigured() {
  return Boolean(GOOGLE.clientId && GOOGLE.spreadsheetId);
}

export function isSignedIn() {
  return Boolean(accessToken) && Date.now() < expiresAt;
}

export function currentAccount() {
  return account;
}

/** GIS 스크립트는 비동기로 붙는다. 준비될 때까지 잠깐 기다린다. */
function waitForGis(timeout = 10000) {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    (function poll() {
      if (window.google?.accounts?.oauth2) return resolve();
      if (Date.now() - started > timeout) {
        return reject(new Error('구글 로그인 스크립트를 불러오지 못했습니다 (네트워크 차단 여부 확인 필요)'));
      }
      setTimeout(poll, 60);
    })();
  });
}

async function ensureClient() {
  if (tokenClient) return tokenClient;
  await waitForGis();
  tokenClient = window.google.accounts.oauth2.initTokenClient({
    client_id: GOOGLE.clientId,
    scope: GOOGLE.scope,
    callback: () => {}, // 요청할 때마다 갈아끼운다
  });
  return tokenClient;
}

/**
 * GIS 의 prompt 값 의미 (여기를 잘못 건드리면 매번 동의 화면이 뜬다):
 *   ''         — 필요한 것만 보여준다. 이미 동의했으면 아무것도 안 뜬다.  ← interactive
 *   'none'     — UI 를 절대 띄우지 않는다. 상호작용이 필요하면 실패.      ← silent
 *   'consent'  — 매번 동의 화면을 강제한다. 우리는 쓰지 않는다.
 *
 * @param {'silent'|'interactive'} mode
 *   silent      — 페이지 진입 시 자동 복구용. 실패해도 조용히 넘어간다.
 *   interactive — 사용자가 버튼을 눌렀을 때만. 그래야 팝업 차단에 안 걸린다.
 */
function requestToken(mode) {
  return new Promise((resolve, reject) => {
    tokenClient.callback = (res) => {
      if (res.error) return reject(new Error(res.error_description || res.error));
      accessToken = res.access_token;
      // 만료 1분 전에 미리 만료된 것으로 취급해 요청 도중 끊기는 일을 막는다.
      expiresAt = Date.now() + (Number(res.expires_in || 3600) - 60) * 1000;
      resolve(accessToken);
    };
    tokenClient.error_callback = (err) => {
      reject(new Error(err?.type === 'popup_closed' ? '로그인 창이 닫혔습니다' : err?.type || 'popup_failed'));
    };
    tokenClient.requestAccessToken({ prompt: mode === 'interactive' ? '' : 'none' });
  });
}

async function fetchAccount() {
  try {
    const res = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) return;
    const info = await res.json();
    account = { email: (info.email || '').toLowerCase(), name: info.name || '' };
  } catch {
    // 신원 조회 실패는 치명적이지 않다. 시트 읽기/쓰기는 토큰만 있으면 된다.
  }
}

/** 사용자가 로그인 버튼을 눌렀을 때. 최초 1회만 동의 화면이 뜨고, 이후엔 뜨지 않는다. */
export async function signIn() {
  await ensureClient();
  await requestToken('interactive');
  await fetchAccount();
  emit();
  return accessToken;
}

/** 페이지 진입 시 조용히 시도. 실패해도 조용히 넘어간다. */
export async function restore() {
  if (!isConfigured()) return false;
  try {
    await ensureClient();
    await requestToken('silent');
    await fetchAccount();
    emit();
    return true;
  } catch {
    return false;
  }
}

export function signOut() {
  const token = accessToken;
  accessToken = null;
  expiresAt = 0;
  account = null;
  if (token && window.google?.accounts?.oauth2) {
    window.google.accounts.oauth2.revoke(token, () => {});
  }
  emit();
}

/**
 * 재로그인이 필요하다는 신호. 저장 실패와 구분해야 한다 —
 * 사용자가 할 일이 "다시 시도"가 아니라 "로그인 버튼 클릭"이기 때문이다.
 */
export class ReauthRequired extends Error {
  constructor(message = '로그인 세션이 만료되었습니다') {
    super(message);
    this.name = 'ReauthRequired';
  }
}

/**
 * 유효한 토큰을 돌려준다. 만료됐으면 조용히 갱신을 시도한다.
 *
 * 이 흐름에는 갱신 토큰이 없어서, 조용한 갱신은 브라우저에 구글 세션이 살아 있을 때만
 * 성공한다. 보통은 성공하지만(업무 브라우저는 구글에 로그인돼 있다), 실패하면
 * 사용자가 버튼을 한 번 눌러야 하므로 그 사실을 분명히 구분해 올린다.
 */
export async function getToken() {
  if (isSignedIn()) return accessToken;
  await ensureClient();
  try {
    await requestToken('silent');
  } catch {
    accessToken = null;
    expiresAt = 0;
    emit();
    throw new ReauthRequired();
  }
  emit();
  return accessToken;
}
