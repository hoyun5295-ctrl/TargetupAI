/**
 * 확인 창을 오래 둔 뒤 발송 — 적재분이 만료됐으면 발송하지 않고 "만료"로 안내한다 (★2026-09-26 한줄로 전수점검 S1-H08)
 *
 * 정리 워커(staging-sweeper)는 모든 행이 24시간 지난 적재분만 통째로 지운다. commit은 23시간 넘은 적재분을 만료로 거절한다 —
 * 그래서 정리가 손대는 적재분은 결코 발송으로 접수되지 않는다(일부만 지워진 적재분이 발송되면 나머지가 조용히 빠진다 · Codex 1R high).
 * 이 판정은 건수 확정·차감·캠페인 생성보다 앞에 있어야 한다(기간계 흐름 불변 · 막힐 때 돈이 움직이지 않는다).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const src = readFileSync(join(__dirname, '..', '..', 'routes', 'campaigns.ts'), 'utf8');
const at0 = src.indexOf("router.post('/direct-send/commit',");
const route = src.slice(at0, src.indexOf('\nrouter.', at0 + 10));

describe('/direct-send/commit 적재 만료', () => {
  it('만료 판정은 CT(staging-sweeper resolveStagingCommitState) 하나를 쓴다', () => {
    // ★ 2026-09-26 F38 Codex 1R: 같은 CT에서 준비분 잠금(withStagingLock)도 함께 가져온다
    expect(src).toMatch(/import \{ resolveStagingCommitState(, withStagingLock)? \} from '\.\.\/utils\/staging-sweeper'/);
    expect(route).toContain("(await resolveStagingCommitState(stagingId, companyId)) === 'expired'");
  });

  it('만료면 코드 STAGING_EXPIRED로 400', () => {
    expect(route).toContain("code: 'STAGING_EXPIRED'");
    expect(route).toContain('발송 준비가 만료됐습니다. 발송을 다시 눌러 주세요.');
  });

  it('만료 판정 → 건수 확정 → "대상 없음" 판정 → 캠페인 생성(차감) 순서', () => {
    const iExpired = route.indexOf('resolveStagingCommitState(');
    const iCount = route.indexOf('countStagingFiltered(');
    const iEmpty = route.indexOf('정제 후 발송 대상이 없습니다');
    const iCreate = route.indexOf('createDirectSendCampaign(');
    expect(iExpired).toBeGreaterThan(-1);
    expect(iExpired).toBeLessThan(iCount);
    expect(iCount).toBeLessThan(iEmpty);
    expect(iEmpty).toBeLessThan(iCreate);
  });
});
