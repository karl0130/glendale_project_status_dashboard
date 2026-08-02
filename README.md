# Glendale Korea Project Dashboard

부티크 컨설팅 팀(10명 미만)을 위한 프로젝트 일정 · 인력 리소스 · 주간 업무 보고 통합 대시보드.
빌드 도구 없이 동작하는 정적 사이트라서 **GitHub Pages에 그대로 올라간다.**

## 화면

| 경로 | 화면 | 내용 |
|---|---|---|
| `#/overview` | Overview | 2주 단위 프로젝트 간트 · 2주 단위 리소스 간트 · 금주 휴가 표 · KPI |
| `#/projects` | 1. Project Status | 프로젝트 등록/수정 + 4주 간트 + 전체 목록 |
| `#/resources` | 2. Resource Planning | 인원별 월간 투입 간트 + 가동률 (자동 산출) |
| `#/weekly` | 3. Weekly Work Updates | 주간 업무 기입 + 직원별 주간 간트 + 상세 보고 |
| `#/data` | 데이터 & 아카이브 | 변경사항 반영 · 휴가 관리 · 스냅샷 |

## 데이터가 저장되는 방식

서버가 없으므로 저장은 2계층으로 나뉜다.

```
data/*.json  ← 레포에 커밋된 "공식" 데이터. 모두가 보는 값.
    ↑ 내보내기 후 커밋
localStorage ← 브라우저에서 입력·수정한 값. 그 브라우저에만 있다.
```

브라우저에서 입력한 내용은 **자동으로 공유되지 않는다.** 반영하려면:

1. `데이터 & 아카이브` 화면에서 변경된 파일을 `내려받기`(또는 `복사`)
2. `data/` 아래 같은 이름 파일에 덮어쓰기
3. 커밋 & 푸시

상단 우측의 `미반영 변경 있음` 배지가 아직 커밋되지 않은 변경이 있다는 표시다.

### 아카이빙

**별도 아카이브 테이블이 필요 없다.** `data/`를 커밋해두면 git 이력이 그대로 시점별 기록이 된다.

```bash
git log --oneline -- data/projects.json     # 변경 이력
git show <commit>:data/projects.json        # 그 시점의 프로젝트 현황
```

월말 보고처럼 단일 파일로 남겨야 할 때는 `데이터 & 아카이브` 화면에서 전체 스냅샷을 내려받는다.

### 데이터 파일

| 파일 | 내용 | 입력 위치 |
|---|---|---|
| `data/employees.json` | 구성원 명단 | 직접 편집 |
| `data/projects.json` | 프로젝트 (고객사, End client, 상태, PM, 팀원, 기간) | Project Status |
| `data/weekly-updates.json` | 주간 수행 업무 | Weekly Work Updates |
| `data/vacations.json` | 휴가 일정 | 데이터 & 아카이브 |

Resource Planning은 **입력이 없다.** `projects.json`의 PM·팀원·기간에서 자동으로 산출된다.

## 로컬 실행

`fetch()`와 ES 모듈을 쓰므로 `index.html`을 파일로 직접 열면 동작하지 않는다. 로컬 서버가 필요하다.

```bash
python -m http.server 8000
# 또는
npx serve .
```

→ http://localhost:8000

## GitHub Pages 배포

1. 이 레포를 GitHub에 푸시
2. Settings → Pages → Source: **GitHub Actions** 선택
   (`.github/workflows/pages.yml` 이 포함되어 있어 푸시할 때마다 자동 배포된다)
3. `https://<계정>.github.io/<레포명>/` 로 접속

`Deploy from a branch` 방식을 쓴다면 워크플로 없이 브랜치 루트를 그대로 지정해도 된다. `.nojekyll` 이 있어 Jekyll 처리는 건너뛴다.

> **주의 — 공개 범위.** GitHub Pages로 배포한 사이트는 레포가 private이어도 **URL을 아는 사람은 누구나 볼 수 있다.** 고객사명·인력 배치가 외부에 노출돼도 무방한 수준인지 먼저 판단하고, 접근 제어가 필요하면 Cloudflare Pages + Access 등으로 옮기는 것을 권한다.

## 구조

```
index.html
assets/css/style.css
assets/js/
  app.js          라우터 + 셸
  store.js        데이터 로드 · 수정 · 내보내기
  gantt.js        간트 렌더러 · 표 · 범례 · 카드
  ui.js           모달 폼 · 툴팁 · 토스트
  util.js         날짜 유틸
  views/          overview · projects · resources · weekly · data
data/*.json
```

## 시각화 규칙

일관되게 지킨 규칙들 (수정할 때 함께 유지할 것):

- **색은 프로젝트를 따라간다.** 필터나 화면이 바뀌어도 같은 프로젝트는 같은 색이다. 색을 순위/행 번호에 배정하지 않는다.
- **카테고리 색은 8슬롯이 상한.** 9번째 프로젝트부터는 새 색을 만들지 않고 중립 회색으로 접는다. 슬롯 순서 자체가 색각이상 대비 안전장치이므로 재배열하지 않는다.
- **상태색(good/warning/critical)은 예약어.** 프로젝트 식별에 전용하지 않고, 항상 아이콘 + 글자와 함께 쓴다.
- **모든 차트에 표 보기 쌍이 있다.** 색만으로 갇히는 정보가 없다.
- **바 라벨은 잘리지 않는다.** 바 안에 안 들어가면 바깥으로 내보낸다.
- 격자/축은 1px 실선 헤어라인. 점선은 임계선으로 오독되므로 쓰지 않는다.

## 다음 단계 (프로토타입 이후)

지금 구조의 한계는 "입력한 사람이 직접 커밋해야 반영된다"는 점이다. 실제 운영으로 넘어갈 때 선택지:

- **Google Apps Script 웹앱** — 시트를 DB로 두고 쓰기 엔드포인트만 추가. 무료, 비개발자가 시트에서 직접 편집 가능.
- **Cloudflare Pages + Workers + D1** — 무료 티어, Cloudflare Access로 회사 계정 로그인 제한 가능.
- **Supabase** — Postgres + 인증 + 행 수준 보안.

`store.js`의 `load` / `upsert` / `remove` 만 교체하면 나머지 화면 코드는 그대로 쓸 수 있게 분리해 두었다.
