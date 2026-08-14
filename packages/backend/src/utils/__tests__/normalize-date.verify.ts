/**
 * normalize-date.verify.ts — normalizeDate 달력 유효성 단위 검증
 *
 * 실행: npx tsx packages/backend/src/utils/__tests__/normalize-date.verify.ts
 * (순수 함수만 — DB 연결 불필요.)
 *
 * 기원(2026-08-14 아난티 전량 동기화): 정규화 분기 7개 중 한국식·YYMMDD 둘만 범위 검사가 있었고
 * 나머지 5개는 무검사였다. 8자리 쓰레기값 `20144850`이 `2014-48-50`으로 통과해 PostgreSQL이
 * `date/time field value out of range`로 행을 거절했다(13행 유실).
 *
 * 이 파일이 지키는 불변식: **어떤 입력 형식이든 달력에 실재하는 날짜만 통과한다.**
 * 아래 "사고 실측값" 블록이 깨지면 toValidDate 단일 출구를 우회하는 분기가 생긴 것이다.
 */
import assert from 'node:assert';
import { normalizeDate } from '../normalize';

let passed = 0;
function ok(name: string, fn: () => void) {
  fn();
  passed++;
  console.log(`  ok - ${name}`);
}
const eq = (input: any, expected: string | null) =>
  assert.strictEqual(normalizeDate(input), expected, `normalizeDate(${JSON.stringify(input)})`);

console.log('[normalizeDate] 사고 실측값 — 2026-08-14 아난티 거절 6종은 전부 null');
ok('20144850 (48월)', () => eq('20144850', null));
ok('19475870 (58월 70일)', () => eq('19475870', null));
ok('20202811 (28월)', () => eq('20202811', null));
ok('20116813 (68월)', () => eq('20116813', null));
ok('20201861 (18월 61일)', () => eq('20201861', null));
ok('20211872 (18월 72일)', () => eq('20211872', null));
ok('이미 잘린 모양 "2014-48-50"도 통과 금지 (ISO 접두 분기 구멍)', () => eq('2014-48-50', null));

console.log('[normalizeDate] 달력 실재 — 범위만 맞고 존재하지 않는 날짜');
ok('19900230 (2월 30일)', () => eq('19900230', null));
ok('19900431 (4월 31일)', () => eq('19900431', null));
ok('19000229 (1900년은 윤년 아님)', () => eq('19000229', null));
ok('20000229 (2000년은 윤년)', () => eq('20000229', '2000-02-29'));
ok('20240229 (윤년)', () => eq('20240229', '2024-02-29'));

console.log('[normalizeDate] 연도 범위 1900~2099');
ok('18991231 → null', () => eq('18991231', null));
ok('19000101 → 통과', () => eq('19000101', '1900-01-01'));
ok('20991231 → 통과', () => eq('20991231', '2099-12-31'));
ok('21000101 → null', () => eq('21000101', null));

console.log('[normalizeDate] 정상 형식 전부 보존 (회귀 방지)');
ok('ISO', () => eq('1990-05-03', '1990-05-03'));
ok('ISO + 시각 접미', () => eq('1990-05-03T14:59:08.000Z', '1990-05-03'));
ok('YYYYMMDD', () => eq('19900503', '1990-05-03'));
ok('YYYY/MM/DD', () => eq('1990/05/03', '1990-05-03'));
ok('YYYY.MM.DD', () => eq('1990.05.03', '1990-05-03'));
ok('한국식 "2025. 12. 17." (D83)', () => eq('2025. 12. 17.', '2025-12-17'));
ok('한국식 한자리 "2025. 1. 3."', () => eq('2025. 1. 3.', '2025-01-03'));
ok('YYMMDD 6자리 250103 (D79)', () => eq('250103', '2025-01-03'));
ok('YYMMDD 6자리 900503 → 1990', () => eq('900503', '1990-05-03'));
ok('미국식 MM/DD/YYYY', () => eq('05/03/1990', '1990-05-03'));
ok('Date 객체 (D99 UTC 올림)', () => eq(new Date('1990-05-03T00:00:00.000Z'), '1990-05-03'));

console.log('[normalizeDate] 빈 값');
ok('null', () => eq(null, null));
ok('undefined', () => eq(undefined, null));
ok('빈 문자열', () => eq('', null));
ok('공백만', () => eq('   ', null));
ok('날짜가 아닌 문자열', () => eq('생년월일없음', null));

console.log(`\n${passed} assertions passed`);
