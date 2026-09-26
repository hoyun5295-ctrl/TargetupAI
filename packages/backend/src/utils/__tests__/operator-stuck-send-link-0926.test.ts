/**
 * AI 자동마케팅 제안 — 캠페인 생성 뒤 표식 전에 멈추면 같은 대상에게 두 번 나가던 것 (★ 2026-09-26 한줄로 V2 m104 · CRASH 묶음)
 *
 * 흐름: 제안 claim(sending) → 적재(staging) → 발송 캠페인 생성(커밋) → 제안에 campaign_id 표식.
 * 캠페인 생성과 표식 사이에 멈추면 표식이 없어 회복 패스가 "커밋 전 중단"으로 보고 담당자 검토로 내렸고,
 * 담당자가 다시 승인하면 이미 나간 대상에게 한 번 더 나갔다.
 *
 * 처방: 캠페인을 만들기 **전에** 적재 묶음 id를 제안에 적는다(proposal_json.meta.sendStagingId).
 *   캠페인 행은 만들어질 때 staging_id를 함께 갖는다(원자) → 회복 패스가 그 id로 캠페인을 찾으면 표식을 채우고 보냄으로 마감.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { decideStuckSendingRecovery } from '../autosend-policy';

const now = new Date('2026-12-01T01:00:00Z');
const old = new Date('2026-12-01T00:10:00Z');

describe('회복 판정', () => {
  it('표식이 있으면 종전대로 보냄 마감', () => {
    expect(decideStuckSendingRecovery({ campaignId: 'c1', reviewedAt: old, linkedCampaignId: null }, now)).toBe('mark_sent');
  });
  it('표식이 없어도 적재 묶음으로 찾은 캠페인이 있으면 이어서 보냄 마감(검토로 내리지 않는다)', () => {
    expect(decideStuckSendingRecovery({ campaignId: null, reviewedAt: old, linkedCampaignId: 'c9' }, now)).toBe('link_and_mark_sent');
  });
  it('찾은 캠페인이 없으면 종전대로 오래된 것만 검토로', () => {
    expect(decideStuckSendingRecovery({ campaignId: null, reviewedAt: old, linkedCampaignId: null }, now)).toBe('demote_admin_review');
    expect(decideStuckSendingRecovery({ campaignId: null, reviewedAt: new Date('2026-12-01T00:50:00Z') }, now)).toBe('keep');
  });
});

describe('배선', () => {
  const src = readFileSync(resolve(__dirname, '../continuous-operator.ts'), 'utf8');
  it('캠페인 생성 전에 적재 묶음 id를 제안에 적는다', () => {
    const mark = src.indexOf("'{meta,sendStagingId}'");
    const create = src.indexOf('await createDirectSendCampaign(');
    expect(mark).toBeGreaterThan(-1);
    expect(create).toBeGreaterThan(-1);
    expect(mark).toBeLessThan(create);
  });
  it('회복 패스가 적재 묶음으로 캠페인을 찾는다', () => {
    const fn = src.slice(src.indexOf('async function reconcileStuckSending'), src.indexOf('async function sendScheduledProposal'));
    expect(fn).toContain("sendStagingId");
    expect(fn).toMatch(/FROM campaigns[\s\S]*staging_id = \$1::uuid[\s\S]*company_id = \$2::uuid/);
    // 활성화된 캠페인만 잇는다 — preparing(차감·활성화 전 중단)·failed는 나간 적이 없다(대행 선례 agency-send-campaign.ts:71)
    expect(fn).toMatch(/send_phase IN \('queued', 'processing', 'sent'\)/);
    expect(fn).toContain('link_and_mark_sent');
  });
  it('조회 실패는 "없음"이 아니다 — 그 제안은 sending으로 두고 다음 패스(Codex 1R ③)', () => {
    const fn = src.slice(src.indexOf('async function reconcileStuckSending'), src.indexOf('async function sendScheduledProposal'));
    expect(fn).not.toMatch(/staging_id = \$1::uuid[\s\S]{0,300}\.catch\(\(\) => \(\{ rows: \[\]/);
    expect(fn).toMatch(/catch \(lookupErr: any\)[\s\S]{0,200}continue;/);
  });
  it('표식 문장은 발송 경로와 회복 경로가 같은 함수를 쓴다', () => {
    const uses = src.split('buildProposalSendMarkerSql(').length - 1;
    expect(uses).toBeGreaterThanOrEqual(3); // 정의 1 + 발송 1 + 회복 1
  });
});
