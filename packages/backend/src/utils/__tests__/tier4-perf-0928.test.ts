/**
 * 한줄로 V2 차수 4 PERF·FILES 묶음 (★2026-09-28) — 고친 자리가 되돌아가지 않게 못 박는다.
 *
 *   m005 스팸 검사 배치 결과 = 변형들의 결과를 한 번에 읽는다(변형마다 조회 금지).
 *   R070 감사 로그 액션 목록 = 캐시 CT(조회마다 audit_logs 전체 DISTINCT 금지).
 *   R110 고객 목록 = 총 개수를 목록과 한 번에(중복 접기 뷰를 두 번 계산 금지) · 마지막 페이지 뒤만 따로 센다.
 *   R149 원스텝 회신번호 그룹 = 건수만(수신자 객체 두 벌 금지).
 *   R263 여정 등급별 통계 = 고객 단위 한 번 집계(실행마다 하위 쿼리 · 반복 진입 중복 합산 금지).
 *   R354 이메일 접수 = 저장한 이미지를 반려·중복 종결·트랜잭션 예외에서 지운다(커밋 결과를 모르면 지우지 않는다).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const SRC = join(__dirname, '..', '..');
const read = (rel: string) => readFileSync(join(SRC, rel), 'utf8').replace(/\r\n/g, '\n');
const between = (s: string, a: string, b: string) => {
  const i = s.indexOf(a);
  expect(i, a).toBeGreaterThanOrEqual(0);
  const j = s.indexOf(b, i + a.length);
  expect(j, b).toBeGreaterThan(i);
  return s.slice(i, j);
};

describe('m005 스팸 검사 배치 결과', () => {
  const fn = between(read('utils/spam-test-queue.ts'), 'export async function getSpamTestBatchResults(', '// [5] 테스트 완료 대기');
  it('결과는 한 번의 조회(ANY)로 읽고 반복 안에서는 조회하지 않는다', () => {
    expect(fn).toContain('WHERE test_id = ANY($1::uuid[]) ORDER BY carrier, message_type');
    const loop = fn.slice(fn.indexOf('for (const test of tests.rows) {'));
    expect(loop).not.toContain('await query(');
  });
});

describe('R070 감사 로그 액션 목록', () => {
  it('캐시 CT로 읽는다', () => {
    const admin = read('routes/admin.ts');
    const i = admin.indexOf('SELECT DISTINCT action FROM audit_logs ORDER BY action');
    expect(i).toBeGreaterThan(0);
    const before = admin.slice(i - 400, i);
    expect(before).toContain("key: 'admin:audit-log-actions'");
    expect(before).toContain('await swrCache({');
  });
});

describe('R110 고객 목록 총 개수', () => {
  const route = between(read('routes/customers.ts'), '// 목록 조회 — ★ B17-01', 'return res.json({\n      customers,');
  it('목록 쿼리가 COUNT(*) OVER() 로 개수를 함께 싣는다', () => {
    expect(route).toContain('COUNT(*) OVER() AS total_count_all');
  });
  it('따로 세는 것은 행이 0이고 첫 페이지가 아닐 때뿐이다 · 응답에서 보조 칸을 뺀다', () => {
    expect(route).toMatch(/if \(result\.rows\.length === 0 && Number\(page\) > 1\) \{\s*const countResult = await query\(/);
    expect(route).toContain('params.slice(0, whereParamCount)');
    expect(route).toContain('result.rows.map(({ total_count_all: _t, ...row }: any) => row)');
  });
});

describe('R149 원스텝 회신번호 그룹', () => {
  const src = read('utils/agency-send-intake.ts');
  it('그룹 타입에 수신자 배열이 없다 · 그룹 표는 건수만 센다', () => {
    expect(src).toMatch(/export interface OneStepGroup \{ callback: string; count: number; registered: boolean \}/);
    expect(src).toContain('const groupMap = new Map<string, number>();');
    expect(src).toContain('groupMap.set(groupKey, (groupMap.get(groupKey) || 0) + 1);');
  });
});

describe('R263 여정 등급별 통계', () => {
  const fn = between(read('utils/journey-stats.ts'), 'async function getJourneySegmentStats(', '// 4. 시간대별 통계');
  it('고객 단위로 모아 등급별로 더한다(실행마다 하위 쿼리 없음)', () => {
    expect(fn).toContain('WITH ex AS (');
    expect(fn).not.toContain('ce.customer_id = c.id');
    expect(fn).toContain('GROUP BY ex.segment');
  });
  it('전환은 첫 진입 뒤 구매 1건당 1번 · 클릭은 여정 id 를 글자로 비교', () => {
    expect(fn).toContain('MIN(e.entered_at) AS first_entered_at');
    expect(fn).toContain('ce.occurred_at > ex.first_entered_at');
    expect(fn).toContain("lower(ce.properties->>'journey_id') = lower($1::text)");
  });
});

describe('R354 이메일 접수 이미지 정리', () => {
  const src = read('utils/agency-send-mail-worker.ts');
  it('반려 · 중복 종결 · 트랜잭션 예외가 같은 정리 함수를 부른다', () => {
    expect(src).toMatch(/const reject = async \([^)]*\) => \{\s*dropSavedImages\(\);/);
    expect(src).toMatch(/if \(plans\.length === 0\) \{\s*dropSavedImages\(\);/);
    expect(src).toMatch(/await txClient\.query\('ROLLBACK'\)\.catch\(\(\) => \{ \/\* noop \*\/ \}\);\s*if \(!commitSent\) dropSavedImages\(\);/);
  });
  it('COMMIT 을 보낸 뒤의 오류에서는 지우지 않는다(커밋됐을 수 있다)', () => {
    expect(src).toMatch(/commitSent = true;\s*await txClient\.query\('COMMIT'\);/);
  });
});
