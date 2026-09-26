/**
 * 후불 청구에 여정 발송을 담는다 (★2026-09-26 한줄로 V2 F07)
 *
 * 옛: 청구 대상 선택(selectBillingSendIds)이 캠페인 실행 축(ai·auto = campaign_runs)과 직접발송 배관 축(direct·operator)만 모아
 *     여정 단계 캠페인(send_type='journey' · campaign_runs 없음 · 직접 배관 아님)이 어느 축에도 안 걸렸다 → 후불 회사 여정 발송 0원.
 * 처방: 여정 단계 캠페인 id를 **기간 조건이 붙는 캠페인 축(periodCampaignIds)** 으로 보낸다.
 *   큐 행 식별값(app_etc1) = 단계 캠페인 id(문자·알림톡 공통)라 그 축의 `app_etc1 IN + sendreq_time 기간`으로 정확히 잡힌다.
 *   후보는 생성일 기준 앞뒤 하루를 넓혀 뽑는다(자정 직전 생성 · 다음 날 적재도 그 달 청구에서 빠지지 않게) —
 *   실제 수량은 큐의 기간 조건이 정하므로 이웃 달 이중 계상은 없다.
 *   선불 회사는 발행 대상이 아니다(billable = billing_type !== 'prepaid') → 이미 차감된 여정이 다시 청구되지 않는다.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { partitionBillingSendIds } from '../send-usage-aggregation';

describe('partitionBillingSendIds 여정 축', () => {
  it('여정 단계 캠페인은 periodCampaignIds로 간다', () => {
    const out = partitionBillingSendIds({ runs: [], directs: [], legacyDirects: [], journeys: [{ campaign_id: 'j1' }] });
    expect(out.periodCampaignIds).toEqual(['j1']);
    expect(out.eventIds).toEqual([]);
  });
  it('eventIds에 있는 id와 겹치지 않는다', () => {
    const out = partitionBillingSendIds({ runs: [], directs: [{ run_id: 'x' }], legacyDirects: [], journeys: [{ campaign_id: 'x' }, { campaign_id: 'j2' }] });
    expect(out.periodCampaignIds).toEqual(['j2']);
  });
  it('여정 입력이 없어도 기존 결과 그대로', () => {
    expect(partitionBillingSendIds({ runs: [], directs: [], legacyDirects: [] })).toEqual({ eventIds: [], periodCampaignIds: [] });
  });
});

describe('selectBillingSendIds 여정 조회', () => {
  const src = readFileSync(join(__dirname, '..', 'send-usage-aggregation.ts'), 'utf8');
  const fn = src.slice(src.indexOf('export async function selectBillingSendIds('), src.indexOf('export function countBillingSendIds('));
  it('여정 단계 캠페인을 뽑아 journeys로 넘긴다(계정 필터 동반 · 생성일 앞뒤 하루)', () => {
    expect(fn).toContain("AND c4.send_type = 'journey'");
    expect(fn).toMatch(/c4\.created_at >= \(\$\{kstStart\('\$2'\)\}\) - INTERVAL '1 day'/);
    expect(fn).toMatch(/c4\.created_at < \(\$\{kstEnd\('\$3'\)\}\) \+ INTERVAL '1 day'/);
    expect(fn).toContain('${userWhereJourney}');
    expect(fn).toContain('journeys: journeyResult.rows as any[],');
  });
});
