/**
 * 플래너 날짜 축 계약 — 소스 스캔 (★ 2026-08-21 임은지 접수 "행사 1건 담은 뒤 화면을 불러오지 못했습니다")
 *
 * 사고: `planner_events.starts_on/ends_on`은 `date` 컬럼이고, 이 코드베이스의 pg 드라이버는 1114(timestamp)만
 * 재정의해서 date는 **JS Date 객체**로 온다. 플래너 5파일이 `String(r.starts_on).slice(0, 10)`으로 'YYYY-MM-DD'를
 * 만들었는데 그 결과는 "Fri Aug 21"이었다. 화면은 그 값으로 날짜 산술(nextDay → toISOString)을 하다 RangeError로
 * 죽어 오류 경계가 페이지 전체를 덮었고, 실행 워커의 "예정일 당일" 판정은 영영 맞지 않았다.
 * 같은 뿌리 = LESSONS_BACKEND "PG timestamptz는 런타임 Date 객체"(0803 RAG createdAt) — 이번엔 date 판.
 *
 * 계약: 플래너 SQL의 SELECT 목록에서 `starts_on`·`ends_on`을 읽으면 반드시 `::text`로 받는다(정산 관례와 동일).
 * 런타임 테스트(mock pg)로는 안 잡힌다 — 드라이버 타입 변환은 mock이 흉내 내지 않는다. 그래서 소스 계약으로 고정한다.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const read = (p: string) => readFileSync(resolve(__dirname, p), 'utf8');

/** 플래너에서 planner_events의 날짜 컬럼을 읽는 파일 전수 — 새 파일이 생기면 여기 추가한다. */
const PLANNER_SQL_FILES = [
  '../routes/marketing-planner.ts',
  './planner-approval.ts',
  './planner-report.ts',
  './planner-touchpoint.ts',
];

/** 템플릿 리터럴 SQL 중 SELECT 문의 "SELECT ~ FROM" 구간(선택 목록)만 뽑는다. */
function selectLists(src: string): string[] {
  const out: string[] = [];
  const re = /`\s*SELECT\b([\s\S]*?)\bFROM\b/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) out.push(m[1]);
  return out;
}

describe('플래너 날짜 축 계약 (2026-08-21)', () => {
  for (const file of PLANNER_SQL_FILES) {
    it(`${file} — SELECT 목록에서 starts_on/ends_on을 읽으면 ::text로 받는다`, () => {
      const src = read(file);
      const lists = selectLists(src);
      const touching = lists.filter((l) => /\b(e\.)?starts_on\b|\b(e\.)?ends_on\b/.test(l));
      expect(touching.length, `${file}에서 starts_on을 읽는 SELECT를 찾지 못했다 — 파일 목록이 낡았다`).toBeGreaterThan(0);
      for (const l of touching) {
        expect(l, `starts_on은 ::text로 받아야 한다 (JS Date → "Fri Aug 21" 사고)\n${l}`).toMatch(/starts_on::text AS starts_on/);
        expect(l, `ends_on은 ::text로 받아야 한다\n${l}`).toMatch(/ends_on::text AS ends_on/);
        // 캐스트 없는 원본 컬럼이 선택 목록에 같이 남아 있으면 어느 쪽이 행에 실리는지 드라이버 순서에 맡기는 것이다.
        expect(l.replace(/starts_on::text AS starts_on/g, '').replace(/ends_on::text AS ends_on/g, ''))
          .not.toMatch(/\b(e\.)?(starts_on|ends_on)\b/);
      }
    });
  }

  it('드라이버 파서는 1114(timestamp)만 재정의한다 — date(1082)를 전역으로 바꾸면 전 라우트 영향이라 여기서는 캐스트로 푼다', () => {
    const db = read('../config/database.ts');
    expect(db).toContain('setTypeParser(1114');
    // 이 줄이 추가되면 플래너 계약의 전제가 바뀐 것이다 — 전 소비처 영향표 없이 넣지 않는다.
    expect(db).not.toContain('setTypeParser(1082');
  });
});
