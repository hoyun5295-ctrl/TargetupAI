/**
 * 여정 발송 실패분 환불 경로 (★2026-09-26 한줄로 V2 F05·F06·F11)
 *
 * 여정은 발송 1건마다 선불 1건을 차감하는데 차감 참조가 reference_type='journey' · reference_id=여정 id였다.
 * 정산 스위퍼는 캠페인(reference_type='campaign' · 캠페인 id)의 차감만 읽어, 여정 단계 캠페인은 차감 0으로 보였다
 * → 통신사 실패분이 영구 과금되고, 성공 2건 이상인 단계 캠페인마다 "초과환불 잔존" 거짓 경보가 났다.
 *
 * 처방: 차감 참조를 **단계 캠페인 id**로 바꾸고(유형 'journey'는 유지 = 차감이력 [여정 발송] 표시 그대로),
 * 스위퍼가 여정 단계 캠페인은 (journey, 캠페인 id) 원장을 읽게 한다. 알림톡 단계는 campaigns.message_type이 CHECK 제약 때문에
 * 'LMS'로 저장되지만 차감은 'KAKAO'다 — 원장 축은 채널로 정한다.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { resolveCampaignLedger } from '../billing-types';
import { isStepCampaignDayClosed, JOURNEY_LEDGER_CONFIG } from '../journey-step-campaign';

describe('resolveCampaignLedger', () => {
  it('여정 문자 단계 = journey 원장 · 발송 유형 축', () => {
    expect(resolveCampaignLedger('journey', 'sms', 'LMS')).toEqual({ referenceType: 'journey', axes: [{ type: 'LMS', scope: 'all' }] });
    expect(resolveCampaignLedger('journey', 'sms', 'SMS')).toEqual({ referenceType: 'journey', axes: [{ type: 'SMS', scope: 'all' }] });
  });

  it('여정 알림톡 단계 = journey 원장 · KAKAO 축(캠페인 행의 LMS가 아니다)', () => {
    expect(resolveCampaignLedger('journey', 'alimtalk', 'LMS')).toEqual({ referenceType: 'journey', axes: [{ type: 'KAKAO', scope: 'all' }] });
  });

  it('그 외 캠페인은 종전 그대로(campaign 원장 · resolveRefundAxes)', () => {
    expect(resolveCampaignLedger('direct', 'both', 'LMS')).toEqual({
      referenceType: 'campaign', axes: [{ type: 'LMS', scope: 'nonBrand' }, { type: 'BRAND', scope: 'brand' }],
    });
    expect(resolveCampaignLedger('auto', null, 'SMS')).toEqual({ referenceType: 'campaign', axes: [{ type: 'SMS', scope: 'all' }] });
    expect(resolveCampaignLedger(null, 'alimtalk', 'LMS')).toEqual({ referenceType: 'campaign', axes: [{ type: 'LMS', scope: 'all' }] });
  });
});

describe('여정 실행기 차감 참조', () => {
  const src = readFileSync(join(__dirname, '..', 'journey-executor.ts'), 'utf8');
  it('차감은 단계 캠페인 id를 참조한다(여정 id 아님) · 유형은 journey 유지', () => {
    expect(src).toContain("const deduct = await prepaidDeduct(exec.company_id, 1, prepaidMsgType as any, campaignId, exec.created_by || undefined, 'journey');");
    expect(src).not.toContain("prepaidDeduct(exec.company_id, 1, prepaidMsgType as any, exec.journey_id,");
  });
});

describe('여정 단계 캠페인 — 새 원장 표식 · 하루 마감 (Codex 1R)', () => {
  const stepSrc = readFileSync(join(__dirname, '..', 'journey-step-campaign.ts'), 'utf8');

  it('새로 만드는 단계 캠페인은 send_config에 새 원장 표식을 싣는다(배포 전 캠페인과 경계)', () => {
    expect(JOURNEY_LEDGER_CONFIG).toEqual({ journeyLedger: 'campaign' });
    expect(stepSrc).toMatch(/mms_image_paths, send_type, send_config\s*\)/);
    expect(stepSrc).toContain('JSON.stringify(JOURNEY_LEDGER_CONFIG)');
  });

  it('하루 마감 = 발송 기준 시각의 KST 날짜가 지금의 KST 날짜보다 앞', () => {
    // 2026-09-26 23:30 KST = 14:30Z · 다음 날 00:10 KST = 15:10Z
    expect(isStepCampaignDayClosed('2026-09-26T14:30:00Z', new Date('2026-09-26T15:10:00Z'))).toBe(true);
    // 같은 KST 날짜(09-26 09:00 → 09-26 23:59)
    expect(isStepCampaignDayClosed('2026-09-26T00:00:00Z', new Date('2026-09-26T14:59:00Z'))).toBe(false);
    // UTC 날짜는 같아도 KST로는 다음 날(09-26 08:00 KST = 09-25 23:00Z → 09-27 01:00 KST = 09-26 16:00Z)
    expect(isStepCampaignDayClosed('2026-09-25T23:00:00Z', new Date('2026-09-26T16:00:00Z'))).toBe(true);
    expect(isStepCampaignDayClosed(null, new Date())).toBe(false);
    expect(isStepCampaignDayClosed('not-a-date', new Date())).toBe(false);
  });
});

/**
 * ★ Codex 2R high — 여정만 적재 → 차감 순서라, 결과가 차감보다 먼저 보이는 틈에 회수가 돌면 정상 환불을 빼가고 되살리지 못했다.
 * 날짜 마감으로는 닫힘을 증명할 수 없다(MySQL 쿼리·PG 문장에 시간 상한이 없다). 다른 모든 경로처럼 **차감 → 적재**로 되돌린다.
 * (06-06 J1이 적재 뒤 차감으로 바꾼 이유 = 적재 실패분 환불 경로가 없었다 → 이제 스위퍼 미적재 환불이 그 몫을 돌려준다.)
 */
describe('여정 실행기 — 차감이 적재보다 앞', () => {
  const src = readFileSync(join(__dirname, '..', 'journey-executor.ts'), 'utf8');
  const deductAt = src.indexOf('const deduct = await prepaidDeduct(exec.company_id, 1, prepaidMsgType as any, campaignId,');
  const tryAt = src.indexOf("// ★ D188 Phase 2-B-2 (2026-05-21): 10. queue INSERT");
  const loadAt = src.indexOf("await bulkInsertSmsQueue(tables, [row], true, { companyId: exec.company_id, source: 'journey' });");
  const alimAt = src.indexOf('await insertAlimtalkQueue(');
  const sentLogAt = src.indexOf("gen_random_uuid(), $1::uuid, $2::uuid, $3::uuid, NOW(), 'sent', $4");

  it('차감 호출은 하나이고 큐 적재(문자·알림톡)와 sent 기록보다 앞이다', () => {
    expect((src.match(/await prepaidDeduct\(/g) || []).length).toBe(1);
    expect(deductAt).toBeGreaterThan(0);
    expect(deductAt).toBeLessThan(tryAt);
    expect(deductAt).toBeLessThan(loadAt);
    expect(deductAt).toBeLessThan(alimAt);
    expect(deductAt).toBeLessThan(sentLogAt);
  });

  it('차감 실패면 적재하지 않고 여정을 정지한 뒤 돌아간다', () => {
    const seg = src.slice(deductAt, tryAt);
    expect(seg).toContain('if (!deduct.ok) {');
    expect(seg).toContain('await pauseJourney(exec.journey_id');
    expect(seg).toContain("await logFailedStep(exec.execution_id, step.id, 'insufficient_balance');");
    expect(seg).toContain("return 'paused_balance';");
  });
});
