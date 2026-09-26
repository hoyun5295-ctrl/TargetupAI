/**
 * AI 캠페인 발송 — 적재가 끝난 뒤 예외가 나도 적재된 캠페인을 failed로 덮지 않는다 (★2026-09-26 한줄로 V2 F09)
 *
 * 전량(또는 일부) 적재 뒤 후처리(실행 행·캠페인 UPDATE 등)에서 예외가 나면 catch가 상태를 'failed'로 덮고 실행 행도 실패로 닫았다.
 * 예약 캠페인은 취소 게이트(scheduled·draft만)에서 빠져 **누구도 취소할 수 없는 채로** 예약 시각에 나갔고,
 * 응답은 "차감된 금액은 자동 환불됩니다"라 사실과 달랐다(실제 환불은 미적재분뿐).
 * 처방: 한 건이라도 적재됐으면 정상 경로와 같은 종결 상태(예약 = scheduled · 즉시 = completed)로 두고 실행 행도 같게 · 안내는 사실대로.
 *       한 건도 적재되지 않았으면 종전 그대로(failed · 실행 행 실패 · 전액 미적재 환불).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const src = readFileSync(join(__dirname, '..', '..', 'routes', 'campaigns.ts'), 'utf8');
const c = src.slice(src.indexOf("console.error('[AI발송] 큐 처리 전체 실패 — 차감 환불 처리:', sendError);"), src.indexOf("console.error('캠페인 발송 에러:', error);"));

describe('AI 발송 catch — 적재된 캠페인', () => {
  it('미적재 환불(축별) 뒤에 적재 여부로 가른다', () => {
    const iLoaded = c.indexOf('const loadedAny = aiSmsInserted + aiBrandInsertedTotal > 0;');
    expect(iLoaded).toBeGreaterThan(0);
    expect(c.indexOf('await markRefundPendingAxes(id, aiPending);')).toBeLessThan(c.indexOf('if (loadedAny) {'));
  });

  it('적재됐으면 정상 경로와 같은 종결 상태 · 실행 행도 같게 · failed·실패 종결을 하지 않는다', () => {
    const b = c.slice(c.indexOf('if (loadedAny) {'), c.indexOf("await query(`UPDATE campaigns SET status = 'failed', updated_at = NOW() WHERE id = $1`, [id]);"));
    expect(b).toContain("const finalStatus = isScheduled ? 'scheduled' : 'completed';");
    expect(b).toContain('UPDATE campaigns SET status = $1, sent_count = GREATEST(COALESCE(sent_count, 0), $2), updated_at = NOW() WHERE id = $3');
    expect(b).toContain('UPDATE campaign_runs SET status = $1, sent_count = GREATEST(COALESCE(sent_count, 0), $2) WHERE id = $3');
    expect(b).not.toContain('failCampaignRun(');
    expect(b).toContain('error: loadedSendFailureMessage(!!isScheduled)');
  });
});

/** 같은 모양(적재 여부와 무관하게 failed + "자동 환불" 안내)이 동기 직접발송(/direct-send) catch에도 있었다 — 같은 처방. */
describe('동기 직접발송 catch — 적재된 캠페인', () => {
  const d = src.slice(src.indexOf("console.error('[직접발송] 큐 처리 전체 실패 — 차감 환불 처리:', sendError);"), src.indexOf("console.error('[직접발송] 환불 처리 중 추가 오류:', refundErr);"));
  const tail = src.slice(src.indexOf("console.error('[직접발송] 환불 처리 중 추가 오류:', refundErr);"), src.indexOf("console.error('[직접발송] 환불 처리 중 추가 오류:', refundErr);") + 600);

  it('적재됐으면 failed로 덮지 않는다(예약 = 그대로 scheduled · 즉시 = completed)', () => {
    expect(d).toContain('const loadedAny = directSmsSentCount + directKakaoSentCount + directAlimtalkSentCount > 0;');
    expect(d).toMatch(/if \(loadedAny\) \{\s*if \(!scheduled\) \{/);
    expect(d).toContain("SET status = 'completed', sent_count = GREATEST(COALESCE(sent_count, 0), $2)");
    expect(d).toMatch(/\} else \{\s*await query\(`UPDATE campaigns SET status = 'failed', updated_at = NOW\(\) WHERE id = \$1`, \[campaignId\]\);/);
  });

  it('안내는 적재 여부에 따라 사실대로', () => {
    expect(tail).toContain("error: loadedAny ? loadedSendFailureMessage(!!scheduled) : '발송 처리 중 오류가 발생했습니다. 차감된 금액은 자동 환불됩니다.'");
  });
});

describe('loadedSendFailureMessage', () => {
  it('예약·즉시 안내', async () => {
    const { loadedSendFailureMessage } = await import('../direct-send-spec');
    expect(loadedSendFailureMessage(true)).toContain('예약 시각에 발송되며, 예약 목록에서 취소할 수 있습니다');
    expect(loadedSendFailureMessage(false)).toContain('이미 발송 대기에 올라간 문자는 발송됩니다');
    expect(loadedSendFailureMessage(false)).toContain('올라가지 못한 몫은 자동으로 환불됩니다');
  });
});
