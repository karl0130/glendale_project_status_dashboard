// 휴가 알림 메일 문안.
//
// 메일 발송은 부수적인 일이다. 실패해도 신청·승인 자체는 이미 시트에 저장돼 있어야 하고,
// 화면은 그 사실을 정확히 구분해 알려야 한다 — 그래서 던지지 않고 결과를 돌려준다.

import * as store from './store.js';
import { sendMail } from './google/mail.js';
import { fmtDate, fmtRange, parseDate } from './util.js';

/** 배포된 대시보드 주소. 메일에서 바로 들어올 수 있게 붙인다. */
function dashboardUrl(route = '') {
  return `${location.origin}${location.pathname}${route}`;
}

function daysText(v) {
  const cost = store.leaveCost(v);
  return cost ? `${cost}일` : '차감 없음';
}

function periodText(v) {
  const s = parseDate(v.startDate);
  const e = parseDate(v.endDate);
  return s && e && s.getTime() === e.getTime() ? fmtDate(s) : fmtRange(v.startDate, v.endDate);
}

function line(label, value) {
  return `  ${label.padEnd(10, ' ')}${value}`;
}

async function attempt(payload) {
  try {
    await sendMail(payload);
    return { ok: true };
  } catch (err) {
    console.error(err);
    return { ok: false, error: err.message, recipients: payload.to };
  }
}

/** 팀원이 휴가를 신청했을 때 → 승인권자 전원에게. */
export async function notifyVacationRequested(vacation) {
  const applicant = store.byId('employees', vacation.employeeId);
  const approvers = store.employees().filter((e) => e.canApprove && e.email);
  if (!approvers.length) {
    return { ok: false, error: 'employees 탭에 이메일이 등록된 승인권자가 없습니다' };
  }

  const balance = store.leaveBalance(vacation.employeeId, parseDate(vacation.startDate));
  const cost = store.leaveCost(vacation);

  const body = [
    `${applicant?.name ?? ''} (${applicant?.role ?? ''}) 님이 휴가를 신청했습니다.`,
    '',
    line('유형', vacation.type),
    line('기간', `${periodText(vacation)}`),
    line('차감', daysText(vacation)),
    line('사유', vacation.note || '(없음)'),
    '',
    line('연간 부여', `${balance.total}일`),
    line('사용', `${balance.used}일`),
    line('승인 시 잔여', `${balance.total - balance.used - cost}일`),
    '',
    '승인 · 반려는 대시보드 My Page 에서 처리할 수 있습니다.',
    dashboardUrl('#/mypage'),
    '',
    '— Glendale Korea Project Dashboard',
  ].join('\n');

  return attempt({
    to: approvers.map((a) => a.email),
    subject: `[휴가 신청] ${applicant?.name ?? ''} · ${vacation.type} ${daysText(vacation)} (${periodText(vacation)})`,
    body,
  });
}

/** 승인권자가 처리했을 때 → 신청자에게. */
export async function notifyVacationDecided(vacation, decision, decidedBy) {
  const applicant = store.byId('employees', vacation.employeeId);
  if (!applicant?.email) {
    return { ok: false, error: `${applicant?.name ?? '신청자'} 의 이메일이 employees 탭에 없습니다` };
  }

  const approved = decision === '승인';
  const balance = store.leaveBalance(vacation.employeeId, parseDate(vacation.startDate));

  const body = [
    `${decidedBy?.name ?? ''} (${decidedBy?.role ?? ''}) 님이 휴가 신청을 ${decision}했습니다.`,
    '',
    line('유형', vacation.type),
    line('기간', periodText(vacation)),
    line('차감', daysText(vacation)),
    ...(approved ? [] : [line('반려 사유', vacation.decisionNote || '(없음)')]),
    '',
    line('현재 잔여', `${balance.remaining}일`),
    '',
    dashboardUrl('#/mypage'),
    '',
    '— Glendale Korea Project Dashboard',
  ].join('\n');

  return attempt({
    to: [applicant.email],
    subject: `[휴가 ${decision}] ${vacation.type} ${daysText(vacation)} (${periodText(vacation)})`,
    body,
  });
}
