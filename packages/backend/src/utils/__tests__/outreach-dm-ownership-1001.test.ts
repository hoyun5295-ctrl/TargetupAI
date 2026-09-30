/**
 * ★ 2026-10-01 AI 영업 DM 소유 판정 · 파기된 영업 건 DM 목록 숨김 (서수란 접수 · 삭제 건이 mobile 계정 DM 목록에 깨진 「중지」 카드로 남음)
 *
 * 닫힘 사슬
 *   ① EXCLUDE_PURGED_OUTREACH_DMS_SQL 의 의미 = 실제 PostgreSQL 16 에서 픽스처로 실측(pg-mem 은 바깥 표를 가리키는 하위 조회를
 *      못 풀어 여기서 돌리지 않는다 · 실측 기록 = memory project_2026_1001_ai_sales_tickets)
 *   ② getDmList 가 켜졌을 때만 그 상수를 그대로 싣고(두 쿼리 공통 조건 변수), 꺼지면 SQL 에 없다(다른 고객사 무변경)
 *   ③ 목록 라우트가 영업 회사일 때만 켠다(원문 계약)
 *   ④ JS 판정(ownedOutreachDmIds · isImportedOutreachDmAsset) = 불러온 지원팀 DM 은 중지·파기 대상이 아니다
 */
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';

vi.mock('../../config/database', () => ({ query: vi.fn(async () => ({ rows: [] })) }));
import { query } from '../../config/database';
import { getDmList } from '../dm/dm-builder';
import {
  EXCLUDE_PURGED_OUTREACH_DMS_SQL,
  isImportedOutreachDmAsset,
  ownedOutreachDmIds,
} from '../sales-outreach-dm-ownership';

const qmock = query as unknown as ReturnType<typeof vi.fn>;

const CO = '00000000-0000-0000-0000-0000000000c0';

describe('② getDmList 는 켜졌을 때만 조건을 싣는다', () => {
  it('영업 회사 목록 = 일반 조회에 조건이 그대로 실린다', async () => {
    qmock.mockClear();
    await getDmList(CO, null, { hidePurgedOutreach: true });
    expect(String(qmock.mock.calls[0][0])).toContain(EXCLUDE_PURGED_OUTREACH_DMS_SQL);
  });

  it('예비 조회(토큰 표 없음)에도 같은 조건이 실린다', async () => {
    qmock.mockReset();
    qmock.mockRejectedValueOnce(new Error('relation "dm_recipient_tokens" does not exist')).mockResolvedValueOnce({ rows: [] });
    await getDmList(CO, 'u1', { hidePurgedOutreach: true });
    expect(qmock.mock.calls).toHaveLength(2);
    expect(String(qmock.mock.calls[1][0])).toContain(EXCLUDE_PURGED_OUTREACH_DMS_SQL);
    expect(qmock.mock.calls[1][1]).toEqual([CO, 'u1']);
    qmock.mockReset();
    qmock.mockResolvedValue({ rows: [] });
  });

  it('다른 고객사 목록(인자 없음) = 영업 표를 읽지 않는다', async () => {
    qmock.mockClear();
    await getDmList(CO, 'u1');
    const sql = String(qmock.mock.calls[0][0]);
    expect(sql).not.toContain('sales_outreach');
    expect(qmock.mock.calls[0][1]).toEqual([CO, 'u1']);
  });
});

describe('③ 목록 라우트는 영업 회사일 때만 켠다', () => {
  it('routes/dm.ts 목록 = getOutreachContext 회사와 같을 때만 hidePurgedOutreach', () => {
    const src = readFileSync(path.resolve(__dirname, '../../routes/dm.ts'), 'utf8');
    const start = src.indexOf("dmRouter.get('/', async");
    expect(start).toBeGreaterThan(-1);
    const body = src.slice(start, src.indexOf('\n});', start));
    expect(body).toMatch(/hidePurgedOutreach = String\(companyId\) === getOutreachContext\(\)\?\.companyId/);
    expect(body).toMatch(/getDmList\(companyId, isDmAdmin \? null : req\.user\?\.userId, \{ hidePurgedOutreach \}\)/);
  });
});

describe('④ JS 판정 — 불러온 지원팀 DM 은 중지·파기 대상이 아니다', () => {
  it('직접 만든 기록 = DM 과 카탈로그 짝 번호', () => {
    expect(ownedOutreachDmIds({ dmId: 'a', catalogDmId: 'b' })).toEqual(['a', 'b']);
    expect(ownedOutreachDmIds({ dmId: 'a' })).toEqual(['a']);
  });
  it('불러온 기록·빈 값 = 빈 배열', () => {
    expect(ownedOutreachDmIds({ dmId: 'a', imported: true })).toEqual([]);
    expect(ownedOutreachDmIds(null)).toEqual([]);
    expect(isImportedOutreachDmAsset({ imported: true })).toBe(true);
    expect(isImportedOutreachDmAsset({ imported: 'true' })).toBe(false);
    expect(isImportedOutreachDmAsset(undefined)).toBe(false);
  });
});
