/**
 * 초안(draft) 물리 삭제 — 실행 행이나 발송 큐 행이 있으면 막는다 (★2026-09-26 한줄로 V2 F09 · Codex 4차 1R high)
 *
 * 적재 뒤 예외에서 상태 기록까지 실패하면 캠페인이 draft로 남는다. DELETE /:id는 draft면 campaign_runs·campaigns를 물리 삭제해,
 * 큐의 예약분은 그대로 나가는데 결과 동기화·정산의 기준 행이 사라졌다(사용자는 취소 성공 응답).
 * 처방: 실행 행이 있거나 발송 큐에 그 캠페인 행이 하나라도 있으면 409 — 예약 취소(큐 삭제 · 정산)를 쓰게 한다.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const src = readFileSync(join(__dirname, '..', '..', 'routes', 'campaigns.ts'), 'utf8');
const h = src.slice(src.indexOf("router.delete('/:id'"), src.indexOf('router.', src.indexOf("router.delete('/:id'") + 10));

describe('초안 삭제 가드', () => {
  it('실행 행이 있으면 409', () => {
    expect(h).toContain('SELECT 1 FROM campaign_runs WHERE campaign_id = $1 LIMIT 1');
    expect(h).toContain("code: 'DRAFT_HAS_SEND'");
  });

  it('발송 큐에 행이 있으면 409(동기 직접발송 초안 포함)', () => {
    expect(h).toContain("await smsCountAll(draftQueueTables, 'app_etc1 = ?', [campaignId])");
  });

  it('가드는 물리 삭제보다 앞', () => {
    expect(h.indexOf("code: 'DRAFT_HAS_SEND'")).toBeLessThan(h.indexOf('DELETE FROM campaigns'));
  });
});

/**
 * ★ Codex 4차 2R high — 가드(실행 행·큐 0 확인)와 동시 발송 시작(실행 행 생성 → 차감 → 적재) 사이 경합.
 * 발송 시작(존재 재확인 → 중복 확인 → 실행 행 생성)과 초안 삭제(가드 → 삭제)를 같은 캠페인 잠금 안에서 한다.
 * 같은 잠금이 동시 발송 두 건의 중복 방지(S1-H07 · 조회 뒤 삽입)도 한 줄로 세운다.
 */
describe('초안 삭제 ↔ 발송 시작 직렬화', () => {
  it('초안 삭제는 가드부터 물리 삭제까지 캠페인 발송 시작 잠금 안', () => {
    const iLock = h.indexOf('withCampaignStartLock(campaignId, async () => {');
    expect(iLock).toBeGreaterThan(-1);
    expect(iLock).toBeLessThan(h.indexOf('SELECT 1 FROM campaign_runs WHERE campaign_id = $1 LIMIT 1'));
    expect(iLock).toBeLessThan(h.indexOf('DELETE FROM campaigns'));
  });

  it('발송 시작은 존재 재확인 → 중복 확인 → 실행 행 생성이 같은 잠금 안', () => {
    const iLock = src.indexOf('const startGate = await withCampaignStartLock(id, async () => {');
    expect(iLock).toBeGreaterThan(-1);
    const g = src.slice(iLock, src.indexOf('const campaignRun = startGate.run;', iLock));
    const iAlive = g.indexOf('SELECT 1 FROM campaigns WHERE id = $1 AND company_id = $2');
    const iDup = g.indexOf("SELECT id FROM campaign_runs WHERE campaign_id = $1 AND status IN ('sending', 'scheduled') LIMIT 1");
    const iIns = g.indexOf('INSERT INTO campaign_runs (');
    expect(iAlive).toBeGreaterThan(-1);
    expect(iDup).toBeGreaterThan(iAlive);
    expect(iIns).toBeGreaterThan(iDup);
  });
});
