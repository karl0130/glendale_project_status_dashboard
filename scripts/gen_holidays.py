"""data/holidays.json 을 생성한다.

python-holidays 의 SouthKorea 달력을 쓴다. 음력 공휴일(설날·추석·부처님오신날)과
대체공휴일, 그리고 연도별 법 개정까지 반영된다 — 예를 들어 제헌절은 2008년에 빠졌다가
2026년부터 다시 공휴일로 잡힌다.

GitHub Actions 가 매년 12월에 돌려 커밋한다 (.github/workflows/holidays.yml).
직접 돌리려면:  pip install holidays && python scripts/gen_holidays.py

생성 시각은 일부러 파일에 넣지 않는다. 넣으면 공휴일이 그대로여도 매번 diff 가 생겨
의미 없는 커밋이 쌓인다. 언제 갱신했는지는 git 이력이 말해준다.
"""

import json
import pathlib
from datetime import date

import holidays

# 올해부터 3년치. 12월에 돌리면 다음 해와 그 다음 해까지 미리 확보된다.
SPAN = 3
OUT = pathlib.Path(__file__).resolve().parent.parent / "data" / "holidays.json"


def collect(start_year: int, span: int):
    days = []
    years = list(range(start_year, start_year + span))
    for year in years:
        kr = holidays.SouthKorea(years=year, language="ko")
        for day in sorted(kr):
            days.append({"date": day.isoformat(), "name": kr[day]})
    return years, days


def main():
    years, days = collect(date.today().year, SPAN)
    payload = {
        "source": "python-holidays (SouthKorea)",
        "note": "임시공휴일처럼 갑자기 지정되는 날은 여기에 직접 추가할 것",
        "years": years,
        "days": days,
    }
    OUT.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"{OUT} — {len(years)}개 연도 / {len(days)}일")


if __name__ == "__main__":
    main()
