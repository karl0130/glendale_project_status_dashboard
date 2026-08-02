// Google 연동 설정.
//
// clientId 와 spreadsheetId 는 비밀값이 아니다 — 브라우저에 그대로 노출되는 것이 정상이다.
// 실제 접근 통제는 두 겹으로 이뤄진다:
//   1) OAuth 앱이 Internal 이라 회사 Workspace 계정만 로그인된다
//   2) 스프레드시트의 Drive 공유 권한이 있는 사람만 읽고 쓸 수 있다
// 따라서 이 값들이 공개 레포에 있어도 외부인은 아무것도 못 본다.

export const GOOGLE = {
  clientId: '319006066033-nlim9nfk5og7qii0h00242jcnt87oqv9.apps.googleusercontent.com',
  spreadsheetId: '1KR6pc9w2tyRvYhN-DNkkxPlWOv5Pr3DH9esVpRO6kzY',
  // userinfo.email 은 로그인한 사람이 employees 의 누구인지 맞추는 데 쓴다.
  // gmail.send 는 휴가 신청·결재 알림 메일용. 민감 스코프지만 Internal 앱이라
  // 구글 검토 없이 쓸 수 있다. 읽기 권한은 요구하지 않는다 — 보내기만 한다.
  scope: [
    'https://www.googleapis.com/auth/spreadsheets',
    'https://www.googleapis.com/auth/userinfo.email',
    'https://www.googleapis.com/auth/gmail.send',
  ].join(' '),
};

/**
 * 탭 구조와 열 정의.
 *
 * 읽을 때는 1행의 헤더 이름으로 열을 찾는다 — 시트에서 열 순서를 바꿔도 깨지지 않는다.
 * 쓸 때는 아래 columns 순서대로 다시 정렬해 내보낸다.
 */
export const SCHEMA = {
  employees: {
    tab: 'employees',
    columns: [
      'id', 'name', 'nameEn', 'role', 'team', 'email',
      'joinDate', 'annualLeave', 'canApprove', 'active',
    ],
    types: { annualLeave: 'number', canApprove: 'boolean', active: 'boolean' },
  },
  projects: {
    tab: 'projects',
    columns: [
      'id', 'client', 'endClient', 'name', 'status', 'managerId', 'memberIds',
      'startDate', 'endDate', 'note', 'updatedAt', 'updatedBy',
    ],
    types: { memberIds: 'list' },
  },
  vacations: {
    tab: 'vacations',
    columns: [
      'id', 'employeeId', 'startDate', 'endDate', 'type', 'note',
      'status', 'requestedAt', 'decidedBy', 'decidedAt', 'decisionNote',
    ],
    types: {},
  },
  weeklyUpdates: {
    tab: 'weekly_updates',
    columns: ['id', 'employeeId', 'projectId', 'task', 'detail', 'startDate', 'endDate', 'status'],
    types: {},
  },
};

/** 동시 저장 충돌을 잡기 위한 리비전 칸. */
export const META = { tab: '_meta', revisionCell: 'B1', savedByCell: 'B2', savedAtCell: 'B3' };

/**
 * 연차 정책.
 *
 * exempt 에 있는 유형은 연차 일수에서 차감하지 않는다.
 * 반차는 기간과 무관하게 0.5일, 나머지는 주말을 뺀 영업일 수만큼 차감한다.
 *
 * 산정 주기는 입사일 기준이다 — 사람마다 갱신 시점이 다르다.
 * 부여 일수는 employees.annualLeave 로 개인별 관리한다 (비어 있으면 defaultAnnual).
 */
export const LEAVE_POLICY = {
  exempt: ['공가', '경조휴가'],
  halfDayTypes: ['반차(오전)', '반차(오후)'],
  defaultAnnual: 15,
};

export const COLLECTIONS = Object.keys(SCHEMA);
