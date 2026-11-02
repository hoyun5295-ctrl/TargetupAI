/**
 * bug-sweep-1019.test.ts — 1019 버그 정리 묶음 3 의 새 판정(순수 · DB 모의)
 *   B-1005-5② 등록 번호 집합 = 원문 규격 → 숫자
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('../../config/database', () => ({ query: vi.fn() }));
import { query } from '../../config/database';
import { getRegisteredCallbackSet } from '../callback-filter';

describe('B-1005-5② 등록 번호 집합 = 저장 원문 규격 → 숫자만', () => {
  it('괄호 · 공백 표기 정상 번호는 숫자로 들어가고 · 허용 문자 밖(#) 번호는 빠진다', async () => {
    (query as any).mockResolvedValue({ rows: [{ phone: '(02) 123-4567' }, { phone: '010-1234-5678#' }, { phone: '1588-1234' }] });
    const set = await getRegisteredCallbackSet('c1');
    expect(set.has('021234567')).toBe(true);
    expect(set.has('15881234')).toBe(true);
    expect([...set].some((v) => v.startsWith('0101234'))).toBe(false);
  });
});

describe('B-1018-1 factsOnly 근거 = 한 줄 원문의 혜택 자리도 뺀다', () => {
  it('근거에서 혜택이 빠지면 교차 조합 「5% 할인」 이 지어낸 혜택으로 걸린다', async () => {
    const { withoutBenefitSpans, findInventedBenefits } = await import('../copy-benefit-detector');
    const line = '가을 세일 10% 할인 · 5% 적립 이번 주';
    const g = withoutBenefitSpans(line);
    expect(g).not.toMatch(/\d+%/);
    expect(g).toContain('가을 세일');
    expect(findInventedBenefits('지금 5% 할인', g).length).toBeGreaterThan(0);
    expect(findInventedBenefits('가을 세일 소식을 전해요', g)).toEqual([]);
  });
});

describe('B-1018-1 혜택 자리 빼기 = 검증과 같은 정규화(F2)', () => {
  it('「10퍼센트 할인 · 5프로 적립」 도 근거에서 빠져 「5% 할인」 이 걸린다', async () => {
    const { withoutBenefitSpans, findInventedBenefits } = await import('../copy-benefit-detector');
    const g = withoutBenefitSpans('10퍼센트 할인 · 5프로 적립 가을 세일');
    expect(g).not.toMatch(/퍼센트|프로|%/);
    expect(findInventedBenefits('지금 5% 할인', g).length).toBeGreaterThan(0);
  });
});

describe('B-1009-6 켜진 여정 문안 수정 = 발송 시점 관문 · 판마다 검사 표식(F3)', () => {
  it('수정 스냅샷 = 0 · 실행기는 그 판이 100 이 될 때까지 문자 발송을 미루고 · 스캐너 통과가 그 판을 100 으로 올린다', async () => {
    const { readFileSync } = await import('fs');
    const { join } = await import('path');
    const ex = readFileSync(join(__dirname, '..', 'journey-executor.ts'), 'utf8');
    const jb = readFileSync(join(__dirname, '..', 'journey-builder.ts'), 'utf8');
    // ★ 2026-11-02 판 읽기 = CT-J1 조각(journey-step-versions latestSnapshotSql · 본문 · 제목 · 시각 · 신뢰도 · id 한 SELECT)
    expect(ex).toContain("SELECT snap.* FROM ${latestSnapshotSql('$2::uuid', '$1::uuid')} snap");
    expect(ex.indexOf('pendingSnapshotAt = snap.created_at ?? null;')).toBeLessThan(ex.indexOf('const gate = await query('));
    expect(ex).not.toContain('last_pretest_passed_at');
    expect(jb).toContain('VALUES ($1, $2, $3, NULL, $4, $5, $6, $7, $8, $9, $10, 0)');
    const pn = readFileSync(join(__dirname, '..', 'journey-pretest-notifier.ts'), 'utf8');
    expect(pn.indexOf("if (verdict === 'pass') {")).toBeGreaterThan(-1);
    // ★ 1031 통과 = 그 판 100 + 기록 = 판 확인 쓰기 한 트랜잭션(recordIfCurrent · markChecked) · ★ 1102 E3-3 기록 = notified(통과 안내 문자 0)
    expect(pn.indexOf("await recordIfCurrent(b, snapId, { status: 'notified', markChecked: true });")).toBeGreaterThan(pn.indexOf("if (verdict === 'pass') {"));
    const rif = pn.slice(pn.indexOf('export async function recordIfCurrent('));
    expect(rif).toContain('SET confidence_score = 100 WHERE id = $1::uuid AND confidence_score < 100');
    // ★ 2026-11-02 설계서 3-9 — 판 본문 덮어쓰기(자동 반영) 지움 · 수정안 반영 = 새 판(applyPassedCandidate)
    expect(pn).not.toContain('SET message_body = $2, confidence_score = 100 WHERE id = $1::uuid');
    // F4 — 재검사 전 판은 날짜별 처리 기록으로 건너뛰지 않는다(★1025 #2 = 후보 SQL 안 · LIMIT 앞) · 조회 실패는 문자 칸을 미룬다
    // ★ 1102 E3-2 — 후보 SQL 안 · LIMIT 앞: 지금 판 표식 < 100 = 고름(지금 판 보류만 빼고 · 날짜 기록과 무관)
    expect(pn).toContain('COALESCE(snap.confidence, 100) AS confidence');
    expect(pn).toContain('(b.confidence < 100 AND NOT ${heldNow})');
    expect(pn.indexOf("OR NOT ${pretestDoneSql('je.journey_id', 's.id', day)}")).toBeLessThan(pn.indexOf('LIMIT ${PRETEST_SCAN_BUNDLE_LIMIT}'));
    expect(ex).toContain('snapshotReadFailed = true;');
    // ★ 1102 묶음 발송 — 문자 칸 판정 = isTextChannel 한 값(칸마다 한 번)
    expect(ex).toContain("const isTextChannel = ['sms', 'lms', 'mms'].includes(String(step.channel));");
    expect(ex.indexOf('if (snap.snapshotReadFailed && isTextChannel)')).toBeGreaterThan(ex.indexOf('const gate = await query('));
    expect(jb).not.toContain('UPDATE journey_executions je SET next_run_at');
    // ★ 1031 새 스냅숏 · 그 칸 검사 기록 지우기 = 같은 트랜잭션(run · 설계서 2026-10-31 §2-8 · Codex 설계 7R)
    // ★ 2026-11-02 켜진 여정 칸 저장 = 새 판 · 기록 지우기 · 보낼 글 판정(CT-J10 · 409)이 한 트랜잭션(판정이 던지면 저장 · 새 판 · 지우기가 함께 되돌아간다)
    expect(jb).toContain("      await createStepSnapshot(companyId, journeyId, stepId, run);\n      await run(`DELETE FROM journey_pretest_schedules WHERE journey_id = $1::uuid AND step_id = $2::uuid`, [journeyId, stepId]);\n    }");
    expect(jb).toContain('    const out = await applyStepPatchInLock(run, journey, companyId, journeyId, stepId, patch);\n');
    expect(jb).toContain('      await assertStepCopySendable(run, companyId, stepId);\n');
    expect(jb).not.toContain('pretest dedup 리셋 skip');
  });
});
