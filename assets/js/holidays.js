// 대한민국 공휴일.
//
// 설날·추석·부처님오신날은 음력이라 매년 날짜가 바뀌고, 대체공휴일 규칙까지 붙는다.
// 계산으로 구할 수 없어서 날짜 목록을 들고 있어야 한다.
// data/holidays.json 은 GitHub Actions 가 매년 12월에 갱신해 커밋한다.
//
// 영업일 판정은 전부 이 모듈을 거친다 — 주말만 빼는 계산이 여기저기 흩어져 있으면
// 어디는 공휴일을 반영하고 어디는 안 하는 상태가 된다.

import { eachDay, isWeekend, toISO } from './util.js';

let byDate = new Map();

export function setHolidays(days) {
  byDate = new Map((days ?? []).map((h) => [h.date, h.name]));
}

export function holidayCount() {
  return byDate.size;
}

/** 공휴일이면 이름, 아니면 null. */
export function holidayName(date) {
  return byDate.get(toISO(date)) ?? null;
}

export function isHoliday(date) {
  return byDate.has(toISO(date));
}

/** 주말이거나 공휴일. 간트 음영과 영업일 계산의 공통 기준. */
export function isNonWorkingDay(date) {
  return isWeekend(date) || isHoliday(date);
}

/** 주말과 공휴일을 뺀 실제 영업일 수. */
export function businessDays(start, end) {
  if (!start || !end || end < start) return 0;
  return eachDay(start, end).filter((d) => !isNonWorkingDay(d)).length;
}
