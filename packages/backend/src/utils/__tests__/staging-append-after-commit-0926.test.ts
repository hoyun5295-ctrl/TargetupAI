/**
 * 커밋된 발송 준비분에 덧붙인 행이 차감 없이 나가지 않는다 (★2026-09-26 한줄로 V2 F38)
 *
 * /direct-send/stage는 받은 stagingId가 이미 커밋(캠페인 연결)됐는지·다른 회사 것인지 보지 않고 행을 넣었다.
 * 워커는 차감 건수(total)로 자르지 않고 청크 LIMIT만큼 읽어, 커밋 뒤 덧붙인 행까지 적재했다
 * → 차감 없는 발송 · 정제(수신거부·중복) 누락. 화면은 이 경로를 쓰지 않지만 API로 가능했다.
 *
 * 못 박는 것
 *   1. stage: 이미 캠페인에 연결된 준비분 = 409 · 다른 회사 행이 있는 준비분 = 404(존재를 드러내지 않는다).
 *   2. 워커 청크 = min(청크 크기, total − processed) — 덧붙은 행(더 큰 id)은 읽지 않는다. 정제는 가장 작은 id를 남긴다.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const routes = readFileSync(join(__dirname, '..', '..', 'routes', 'campaigns.ts'), 'utf8');
const worker = readFileSync(join(__dirname, '..', 'direct-send-worker.ts'), 'utf8');

describe('/direct-send/stage 덧붙이기 차단', () => {
  const stage = () => routes.slice(routes.indexOf("router.post('/direct-send/stage'"), routes.indexOf("router.post('/direct-send/count'"));

  it('받은 stagingId가 캠페인에 연결돼 있으면 409', () => {
    const s = stage();
    expect(s).toContain('SELECT 1 FROM campaigns WHERE staging_id = $1::uuid LIMIT 1');
    expect(s).toContain("code: 'STAGING_COMMITTED'");
  });

  it('다른 회사 행이 있는 준비분이면 404(회사 조건으로 거른다)', () => {
    const s = stage();
    expect(s).toContain('SELECT 1 FROM campaign_send_staging WHERE staging_id = $1::uuid AND company_id <> $2::uuid LIMIT 1');
    expect(s).toContain("code: 'STAGING_NOT_FOUND'");
  });

  it('두 검사는 INSERT 실행보다 앞이다(잠금 안)', () => {
    const s = stage();
    const lock = s.slice(s.indexOf('await withStagingLock(stagingId, async () => {'));
    expect(lock.indexOf("code: 'STAGING_COMMITTED'")).toBeLessThan(lock.indexOf('await insertRows();'));
    expect(lock.indexOf("code: 'STAGING_NOT_FOUND'")).toBeLessThan(lock.indexOf('await insertRows();'));
  });
});

describe('워커 청크 = 남은 건수까지만', () => {
  it('청크 크기를 total − processed로 자른다', () => {
    expect(worker).toContain('const chunkLimit = Math.min(CHUNK, total - processed);');
    const i = worker.indexOf('const chunkLimit = Math.min(CHUNK, total - processed);');
    const chunkQuery = worker.slice(i, worker.indexOf('if (chunkRes.rows.length === 0) break;', i));
    expect(chunkQuery).not.toMatch(/\[stagingId, CHUNK/);
    expect((chunkQuery.match(/chunkLimit/g) || []).length).toBeGreaterThanOrEqual(3);
  });
});

/**
 * ★ Codex 1R high — stage의 "커밋 여부 검사"와 INSERT 사이에 commit이 끼어들 수 있었다(검사 통과 → commit 확정 → 늦은 INSERT).
 * 같은 준비분의 stage(검사+INSERT)와 commit(만료 확인 → 집계 → 캠페인 생성)을 준비분 단위 advisory 잠금으로 직렬화한다.
 */
describe('준비분 잠금으로 stage·commit 직렬화', () => {
  it('stage는 이어 붙일 때(incoming) 검사와 INSERT를 잠금 안에서 한다', () => {
    const stage = routes.slice(routes.indexOf("router.post('/direct-send/stage'"), routes.indexOf("router.post('/direct-send/count'"));
    const iLock = stage.indexOf('await withStagingLock(stagingId, async () => {');
    expect(iLock).toBeGreaterThan(0);
    expect(iLock).toBeLessThan(stage.indexOf("code: 'STAGING_COMMITTED'"));
    expect(iLock).toBeLessThan(stage.indexOf('SELECT 1 FROM campaigns WHERE staging_id = $1::uuid LIMIT 1'));
  });

  it('commit은 만료 확인·집계·캠페인 생성을 같은 잠금 안에서 한다', () => {
    const iLock = routes.indexOf('return await withStagingLock(stagingId, async () => {');
    expect(iLock).toBeGreaterThan(0);
    const after = routes.slice(iLock);
    expect(after.indexOf('resolveStagingCommitState(stagingId, companyId)')).toBeGreaterThan(0);
    expect(after.indexOf('resolveStagingCommitState(stagingId, companyId)')).toBeLessThan(after.indexOf('countStagingFiltered(stagingId'));
    expect(after.indexOf('countStagingFiltered(stagingId')).toBeLessThan(after.indexOf('await createDirectSendCampaign({'));
  });
});
