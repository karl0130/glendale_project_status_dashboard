// Gmail API 로 메일을 보낸다. 로그인한 사람의 계정에서 나간다.
//
// 서버가 없어도 되는 이유는 시트와 같다 — 브라우저가 받은 액세스 토큰으로 직접 호출한다.
// 스코프는 gmail.send 하나뿐이라 이 앱은 메일함을 읽지 못한다. 보내기만 한다.

import { getToken } from './auth.js';

const API = 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send';

function toBase64(text) {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  bytes.forEach((b) => {
    binary += String.fromCharCode(b);
  });
  return btoa(binary);
}

function toBase64Url(text) {
  return toBase64(text).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** RFC 2822 헤더에는 한글을 그대로 못 넣는다. MIME encoded-word 로 감싼다. */
function encodeHeader(text) {
  return `=?UTF-8?B?${toBase64(text)}?=`;
}

/** base64 본문은 76자마다 접는다 (RFC 2045). */
function wrap(base64) {
  return base64.match(/.{1,76}/g)?.join('\r\n') ?? base64;
}

export class MailScopeMissing extends Error {
  constructor() {
    super('메일 발송 권한이 없습니다 — 로그아웃 후 다시 로그인하면 권한을 다시 요청합니다');
    this.name = 'MailScopeMissing';
  }
}

/**
 * @param {{to: string[], subject: string, body: string}} message
 */
export async function sendMail({ to, subject, body }) {
  const recipients = (to ?? []).filter(Boolean);
  if (!recipients.length) throw new Error('받는 사람 주소가 없습니다');

  const token = await getToken();
  const raw = toBase64Url(
    [
      `To: ${recipients.join(', ')}`,
      `Subject: ${encodeHeader(subject)}`,
      'MIME-Version: 1.0',
      'Content-Type: text/plain; charset="UTF-8"',
      'Content-Transfer-Encoding: base64',
      '',
      wrap(toBase64(body)),
    ].join('\r\n')
  );

  const res = await fetch(API, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ raw }),
  });

  if (res.status === 403) {
    // 스코프를 추가하기 전에 받은 토큰이면 여기로 온다. 재로그인해야 권한이 붙는다.
    throw new MailScopeMissing();
  }
  if (!res.ok) {
    let detail = await res.text();
    try {
      detail = JSON.parse(detail).error?.message || detail;
    } catch {
      /* 원문 그대로 */
    }
    throw new Error(`메일 발송 실패 (${res.status}) — ${detail}`);
  }
  return res.json();
}
