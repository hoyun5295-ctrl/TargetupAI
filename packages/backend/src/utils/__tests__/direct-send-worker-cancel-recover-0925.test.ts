/**
 * 직접발송 워커 — 적재 중 취소 · 끊긴 적재 계약 (★2026-09-25 한줄로 전수점검 C-10 · C-11)
 *
 * C-10 적재 중 취소를 감지하면 큐를 지우고 곧바로 return해 종결 블록의 미적재 환불을 타지 않았다.
 *      적재 전에 취소된 queued는 due 조건(status != 'cancelled')에 걸려 영영 집히지 않았다 → 선차감 미환불.
 * C-11 적재 중(processing) 프로세스가 죽으면 되돌리는 코드가 없었다 → 나머지 미발송 · 미환불 · "발송 중" 고정.
 * 워커는 DB·MySQL·환불이 얽혀 런타임 모의가 크다 — 돈이 새는 자리의 모양을 소스 스캔으로 고정한다.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const src = readFileSync(join(__dirname, '..', 'direct-send-worker.ts'), 'utf8');
const between = (a: string, b: string) => {
  const i = src.indexOf(a);
  expect(i).toBeGreaterThan(-1);
  const j = src.indexOf(b, i + a.length);
  expect(j).toBeGreaterThan(i);
  return src.slice(i, j);
};

describe('C-10 적재 중·적재 전 취소', () => {
  it('due 조회는 취소된 queued도 집는다', () => {
    expect(src).toContain("`SELECT id FROM campaigns WHERE send_phase = 'queued' ORDER BY created_at ASC LIMIT 5`");
    expect(src).not.toContain("send_phase = 'queued' AND status != 'cancelled'");
  });

  it('루프 안 취소 감지는 break로 종결 블록에 넘긴다(큐·staging을 지우고 return하지 않는다)', () => {
    const loop = between('while (processed < total) {', 'const recipients: ChunkRecipient[]');
    // ★ 2026-09-26 F10·F31·F32: 취소 판정 = isLoadStopped(상태 또는 대행 적재 중단 표식)
    expect(loop).toMatch(/load_cancelled\)\) \{\s*console\.log\([^\n]*\);\s*break;\s*\}/);
    expect(loop).not.toContain('DELETE FROM campaign_send_staging');
    expect(loop).not.toMatch(/return;/);
  });

  it('종결의 취소 분기 = 큐 삭제 → 캠페인 전체 기준 정산 → 성공해야만 sent 표시(실패면 processing 유지 · recover 재정산)', () => {
    const branch = between('if (fin.rowCount === 0) {', '// ★ 2026-07-27 (B-0727-1): 환불 미완료 표시');
    const iDel = branch.indexOf('DELETE FROM SMSQ_SEND');
    const iSettle = branch.indexOf('settleCancelledLoadRefund(');
    const iSent = branch.indexOf("send_phase = 'sent'");
    const iFail = branch.indexOf('if (!settled) {');
    expect(iDel).toBeGreaterThan(-1);
    expect(iSettle).toBeGreaterThan(iDel);
    // sent 표시는 정산 성공 분기 안에서만
    expect(iSent).toBeGreaterThan(iSettle);
    expect(branch.slice(iSettle, iSent)).toContain('if (settled) {');
    // 실패면 processing 그대로 돌아간다
    expect(iFail).toBeGreaterThan(iSent);
    expect(branch.slice(iFail)).toContain('return;');
    // ★ 2026-09-26 F35: 정산 함수는 공용 CT(cancel-settle.ts)로 옮겼다 — 본문 계약은 그 파일에서 본다.
    const ct = readFileSync(join(__dirname, '..', 'cancel-settle.ts'), 'utf8');
    const settle = ct.slice(ct.indexOf('export async function settleCancelledLoadRefund('), ct.indexOf('export interface CancelSettleCampaign'));
    expect(settle).toContain('refundKey: REFUND_KEYS.CANCEL, keepCount: kept');
    expect(settle).toContain("'kept'");
  });

  it('취소 종결은 한 오류 경계 — 큐 삭제·정산·sent 표시가 같은 try 안이고 실패면 processing 유지(Codex 2R)', () => {
    const branch = between('if (fin.rowCount === 0) {', '// ★ 2026-07-27 (B-0727-1): 환불 미완료 표시');
    const iTry = branch.indexOf('try {');
    expect(iTry).toBeGreaterThan(-1);
    expect(iTry).toBeLessThan(branch.indexOf('DELETE FROM SMSQ_SEND'));
    expect(branch).toContain('} catch (settleErr: any) {');
    // 바깥 최후 안전망은 어떤 캠페인도 failed로 바꾸지 않는다(★0926 F02·F37 — recover가 다시 봐야 한다)
    const outer = between('처리 실패:`, e);', '// ★ 2026-07-27 (B-0727-1): 미완료 환불 재시도는');
    expect(outer).not.toContain("send_phase = 'failed'");
  });

  it('전체 정산이 끝난 취소 캠페인에는 미적재 재시도 의무를 남기지 않는다(전체 정산이 그 몫을 포함)', () => {
    expect(src).toContain('if (refundPending && fin.rowCount !== 0) {');
    expect(src).not.toContain('markRefundPendingAxes');
  });
});

describe('C-11 끊긴 적재', () => {
  it('10분 넘게 멈춘 processing을 recover 모드로 다시 집는다', () => {
    expect(src).toMatch(/send_phase = 'processing' AND updated_at < NOW\(\) - INTERVAL '10 minutes'/);
    expect(src).toContain("await processCampaign(row.id, 'recover');");
  });

  it('recover는 적재하지 않고 MySQL 실측 적재 수로 종결한다', () => {
    expect(src).toContain("const skipLoad = mode === 'recover' || cancelledAtClaim;");
    const loop = between('while (processed < total) {', 'isLoadStopped(cancelCheck');
    expect(loop).toContain('if (skipLoad) break;');
    expect(src).toMatch(/if \(mode === 'recover'\) \{\s*const measured = await measureLoadedRows\(/);
  });

  it('이미 취소된 캠페인은 미적재 환불을 건너뛰고 취소 분기의 전체 정산 하나로 채운다(직전 상태 재확인)', () => {
    expect(src).toContain('const skipNotLoadedRefund = cancelledAtClaim || isLoadStopped(statusBeforeRefund.rows[0]?.status, statusBeforeRefund.rows[0]?.load_cancelled);');
    const iRecheck = src.indexOf('const statusBeforeRefund = await query(');
    const iLoop = src.indexOf('if (skipNotLoadedRefund) break;');
    expect(iRecheck).toBeGreaterThan(-1);
    expect(iLoop).toBeGreaterThan(iRecheck);
  });
});

/**
 * ★2026-09-26 한줄로 V2 F02·F37 — 적재 루프 앞뒤 예외가 선차감을 영구 미환불로 굳혔다.
 * 바깥 catch가 send_phase='failed'로 바꾸면 recover(processing만 집는다)·sweeper('sent'·NULL만)·재시도(refundPending만)
 * 누구도 다시 보지 않는다. 이제 바깥 catch는 사유만 남기고 단계를 그대로 둔다:
 *   queued = 다음 주기에 다시 선점 · processing = 10분 뒤 recover가 MySQL 실측 적재 수로 종결(적재분 발송 · 나머지 미적재 환불).
 * recover가 적재에만 쓰는 준비(필드 매핑·080 번호·브랜드 이미지)에 막히면 영영 정산을 못 하므로 그 준비는 적재할 때만 한다.
 */
describe('F02·F37 적재 루프 밖 예외', () => {
  const outer = () => between('처리 실패:`, e);', '// ★ 2026-07-27 (B-0727-1): 미완료 환불 재시도는');

  it('바깥 catch는 단계를 바꾸지 않고 사유만 남긴다', () => {
    const o = outer();
    expect(o).not.toMatch(/send_phase\s*=\s*'failed'/);
    expect(o).toContain("'{failure}'");
    expect(o).toContain("WHERE id = $1 AND send_phase IS DISTINCT FROM 'sent'");
  });

  it('필드 매핑·080 번호는 적재할 때만 준비한다(recover가 여기에 막히지 않는다)', () => {
    expect(src).toContain('= skipLoad ? {} : await prepareFieldMappings(companyId);');
    expect(src).toContain("const opt080 = finalIsAd && !skipLoad ? await getOpt080Number(userId || null, companyId) : '';");
  });
});
