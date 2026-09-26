/**
 * 인앱 메시지 게시 과금 — 수정(PUT)으로 게시할 때 무료 게시·게시 없는 과금이 없다 (★2026-09-26 한줄로 V2 R1-03 · Codex 7차 1R 구조 정정)
 *
 * 옛: 초안을 PUT으로 active 전환하면 잔액 확인 없이 먼저 게시되고 뒤에서 차감을 시도했다(실패해도 게시 유지 = 무료 게시).
 * 1R: "전환 앞 과금"은 과금 뒤 메시지가 사라지면 복구 불가(게시 없는 과금) · URL id 원문 키는 UUID 표기만 바꾸면 재과금.
 * 처방(인앱 수정 CT는 자체 연결이라 한 트랜잭션으로 못 묶는다 → 보상 순서):
 *   ①전환 전 = 정규 id로 이전 상태를 읽고, 아직 과금 안 된 메시지면 잔액 확인(부족 = 402 · 흔한 경우를 여기서 막는다)
 *   ②게시(updateInAppMessage) ③게시로 넘어간 경우에만(이전 상태 ≠ active) 수정 결과의 정규 id 키로 과금
 *   ④과금 실패 = 게시를 이전 상태로 되돌리고 거절 → "과금됐는데 게시 안 됨"은 생길 수 없다.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const src = readFileSync(join(__dirname, '..', '..', 'routes', 'cdp.ts'), 'utf8');
const put = src.slice(src.indexOf("router.put('/inapp/:id',"), src.indexOf("router.put('/inapp/:id/audience-filter'"));

describe('PUT 게시 과금 순서', () => {
  it('전환 전: 정규 id·이전 상태를 읽고 미과금이면 잔액 확인', () => {
    expect(put).toContain('SELECT id, channel, status FROM cdp_inapp_messages WHERE id = $1::uuid AND company_id = $2::uuid');
    const iCheck = put.indexOf('if (!(await isChargedByKey(companyId, `inapp-publish:${canonicalId}`))) {');
    expect(iCheck).toBeGreaterThan(-1);
    expect(iCheck).toBeLessThan(put.indexOf('await updateInAppMessage('));
  });

  it('게시 뒤 = 게시로 넘어간 경우에만 수정 결과의 정규 id 키로 과금', () => {
    const iUpdate = put.indexOf('await updateInAppMessage(');
    const iCharge = put.indexOf('const publishOutcome = await deductCreditOutcome({');
    expect(iCharge).toBeGreaterThan(iUpdate);
    // ★ Codex 7차 2R — 상태를 active로 요청했고 이전 상태를 확실히 읽었을 때만(상태 생략 수정은 과금·되돌림 없음)
    expect(put).toContain("const publishing = wantsActive && prevStatus !== null && prevStatus !== 'active' && message.status === 'active';");
    expect(put.slice(iCharge, iCharge + 400)).toContain('idempotencyKey: `inapp-publish:${message.id}`');
    expect(put).not.toContain('idempotencyKey: `inapp-publish:${req.params.id}`');
  });

  it('과금 실패 = 게시를 이전 상태로 되돌리고 거절(잔액 부족 402 · 그 밖 503)', () => {
    const blk = put.slice(put.indexOf("if (publishOutcome === 'failed') {"), put.indexOf('return res.json({ success: true, message });'));
    expect(blk).toContain("UPDATE cdp_inapp_messages SET status = $3, updated_at = NOW()");
    expect(blk).toContain("WHERE id = $1::uuid AND company_id = $2::uuid AND status = 'active'");
    expect(blk).toMatch(/res\.status\(402\)/);
    expect(blk).toMatch(/res\.status\(503\)/);
  });

  it('잔액 부족 예외는 402로 답한다', () => {
    const c = put.slice(put.indexOf('} catch (err: any) {'));
    expect(c).toMatch(/if \(err instanceof InsufficientCreditError\) \{\s*return res\.status\(402\)/);
  });
});

describe('동시성·상태 생략 (Codex 7차 2R high)', () => {
  it('메시지 단위 잠금 안에서 이전 상태 조회부터 되돌림까지 한다', () => {
    const iLock = put.indexOf("return await withKeyedLock('inapp-publish', uuidLockKey(String(req.params.id)), async () => {");
    expect(iLock).toBeGreaterThan(-1);
    expect(iLock).toBeLessThan(put.indexOf('SELECT id, channel, status FROM cdp_inapp_messages'));
    expect(iLock).toBeLessThan(put.indexOf('const publishOutcome = await deductCreditOutcome({'));
  });
  it('게시 요청인데 이전 상태 조회가 실패하면 503(모르는 상태로 진행하지 않는다)', () => {
    const blk = put.slice(put.indexOf('SELECT id, channel, status FROM cdp_inapp_messages'), put.indexOf('await updateInAppMessage('));
    expect(blk).toContain("code: 'INAPP_STATE_UNKNOWN'");
    expect(blk).toMatch(/res\.status\(503\)/);
  });
});

