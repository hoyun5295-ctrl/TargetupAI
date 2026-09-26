/**
 * 수신거부 파일 등록 = 같은 등록 CT를 동시 5건으로 (★2026-09-26 한줄로 V2 R1-17)
 *
 * 옛: 번호마다 registerUnsubscribe(격리 판정 + INSERT)를 순서대로 기다렸다 → 1만 건 = 쿼리 2만 번 순차.
 * 처방: 번호끼리 독립이라 등록 판정(CT)은 그대로 두고 동시성만(입력 순서 보존 CT mapWithConcurrency · 상한 5).
 *   격리 차단 예외는 종전처럼 403(업로드 전 선검사가 이미 막으므로 경합 때만).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const route = readFileSync(join(__dirname, '..', '..', 'routes', 'unsubscribes.ts'), 'utf8');
const helper = readFileSync(join(__dirname, '..', 'unsubscribe-helper.ts'), 'utf8');

describe('수신거부 파일 등록 동시성', () => {
  it('상한은 CT가 소유한다', () => {
    expect(helper).toContain('export const UNSUB_UPLOAD_CONCURRENCY = 5;');
  });
  it('업로드 라우트가 같은 CT를 동시 상한으로 부른다(번호별 순차 루프 없음)', () => {
    const blk = route.slice(route.indexOf('const grid = parseUnsubFileToGrid(filePath, safeName);'));
    expect(blk).toContain('await mapWithConcurrency(phones, UNSUB_UPLOAD_CONCURRENCY, async (cleanPhone) =>');
    expect(blk).toContain("registerUnsubscribe(companyId, userId, userType || 'company_user', cleanPhone, 'upload')");
    expect(blk).not.toContain('for (const cleanPhone of phones) {');
  });
});
