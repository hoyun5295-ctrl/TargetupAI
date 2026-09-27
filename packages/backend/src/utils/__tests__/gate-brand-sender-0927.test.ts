/**
 * 발신프로필 격리 · 브랜드 발신키 소유 (★ 2026-09-27 한줄로 V2 차수 1 GATE 묶음 — S2-01 · R100 · m119 일부)
 *
 * S2-01 발신프로필 단건 조회(GET /senders/:id)·브랜드 타기팅 확인(GET /senders/:id/brand-targeting-check)이 회사 조건 없이 id로 읽었다
 *       → 로그인한 다른 회사가 발신키(profile_key)·080 인증번호를 읽을 수 있었다. 화면은 두 경로를 부르지 않는다(grep 0).
 *       → 조회 범위 CT: 슈퍼관리자는 전체 · 그 밖은 자기 회사 것만(발신프로필 목록과 같은 규칙).
 * R100 브랜드 발송이 발신키 소유·카카오 사용 여부를 확인하지 않았다(/brand-send) — 같은 모양이 테스트 발송·AI 캠페인 생성·AI 발송·
 *       직접발송 대량(commit)·직접발송 동기에도 있다. 카카오 사용 여부 검사는 3곳에 같은 인라인 문장, commit에는 없었다(m119).
 *       → 게이트 CT 하나: 카카오 사용 여부 + 들어온 발신키가 그 회사의 활성 프로필 키인가. 키가 비면 소유 검사는 건너뛴다
 *         (지금 동작 유지 · 화면이 반드시 채우는 /brand-send만 필수).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const state = { kakaoEnabled: true as any, owned: true };
const sqlLog: Array<{ sql: string; params: any[] }> = [];
const queryMock = vi.fn(async (sql: string, params: any[] = []) => {
  const s = String(sql);
  sqlLog.push({ sql: s, params });
  if (s.includes('SELECT kakao_enabled FROM companies')) return { rows: state.kakaoEnabled === null ? [] : [{ kakao_enabled: state.kakaoEnabled }] };
  if (s.includes('FROM kakao_sender_profiles')) return { rows: state.owned ? [{ ok: 1 }] : [] };
  return { rows: [] };
});
vi.mock('../../config/database', () => ({
  default: { query: (...a: any[]) => (queryMock as any)(...a) },
  query: (...a: any[]) => (queryMock as any)(...a),
}));

import { checkBrandSendGate, senderProfileScope } from '../kakao-brand-gate';

beforeEach(() => { state.kakaoEnabled = true; state.owned = true; sqlLog.length = 0; queryMock.mockClear(); });

describe('브랜드 발송 게이트 CT', () => {
  it('카카오 미사용 회사 = 403 KAKAO_NOT_ENABLED(발신키를 보지 않는다)', async () => {
    state.kakaoEnabled = false;
    const r = await checkBrandSendGate('c1', 'KEY1');
    expect(r).toEqual({ ok: false, status: 403, code: 'KAKAO_NOT_ENABLED', error: '카카오 브랜드메시지가 활성화되지 않은 고객사입니다.' });
    expect(sqlLog.some((q) => q.sql.includes('kakao_sender_profiles'))).toBe(false);
  });
  it('발신키가 그 회사의 활성 프로필 키가 아니면 403 SENDER_KEY_NOT_OWNED', async () => {
    state.owned = false;
    const r: any = await checkBrandSendGate('c1', 'OTHER_KEY');
    expect(r.ok).toBe(false);
    expect(r.status).toBe(403);
    expect(r.code).toBe('SENDER_KEY_NOT_OWNED');
    const q = sqlLog.find((x) => x.sql.includes('kakao_sender_profiles'))!;
    expect(q.sql).toMatch(/WHERE company_id = \$1 AND profile_key = \$2 AND COALESCE\(is_active, true\) = true/);
    expect(q.params).toEqual(['c1', 'OTHER_KEY']);
  });
  it('자기 회사 활성 프로필 키면 통과', async () => {
    expect(await checkBrandSendGate('c1', 'KEY1')).toEqual({ ok: true });
  });
  it('키가 비면 소유 검사를 건너뛴다(지금 동작 유지) · 필수로 부른 곳은 400', async () => {
    expect(await checkBrandSendGate('c1', '')).toEqual({ ok: true });
    expect(sqlLog.some((q) => q.sql.includes('kakao_sender_profiles'))).toBe(false);
    const r: any = await checkBrandSendGate('c1', '  ', { requireKey: true });
    expect(r.status).toBe(400);
    expect(r.code).toBe('SENDER_KEY_REQUIRED');
  });
});

describe('발신프로필 조회 범위 CT', () => {
  it('슈퍼관리자 = 전체 · 회사 사용자 = 자기 회사 · 회사 없음 = null', () => {
    expect(senderProfileScope({ userType: 'super_admin' } as any, 2)).toEqual({ sql: '', params: [] });
    expect(senderProfileScope({ userType: 'company_admin', companyId: 'c1' } as any, 2)).toEqual({ sql: ' AND company_id = $2', params: ['c1'] });
    expect(senderProfileScope({ userType: 'company_user' } as any, 2)).toBeNull();
    expect(senderProfileScope(undefined as any, 2)).toBeNull();
  });
});

describe('배선', () => {
  const alim = readFileSync(join(__dirname, '..', '..', 'routes', 'alimtalk.ts'), 'utf8');
  const camp = readFileSync(join(__dirname, '..', '..', 'routes', 'campaigns.ts'), 'utf8');

  it('S2-01 단건 조회·타기팅 확인이 조회 범위 CT를 쓴다', () => {
    for (const head of ["router.get('/senders/:id', async", "'/senders/:id/brand-targeting-check',"]) {
      const at = alim.indexOf(head);
      expect(at).toBeGreaterThan(-1);
      const body = alim.slice(at, at + 1200);
      expect(body).toContain('senderProfileScope(req.user');
      expect(body).toMatch(/FROM kakao_sender_profiles WHERE id = \$1\$\{scope\.sql\}/);
    }
  });

  it('R100 브랜드 발송 경로 6곳이 게이트 CT를 쓰고, 카카오 사용 인라인 검사는 남지 않는다', () => {
    expect(camp).not.toContain("await query('SELECT kakao_enabled FROM companies WHERE id = $1', [companyId]);");
    expect(camp.split('await checkBrandSendGate(').length - 1).toBe(6);
    // /brand-send는 키 필수
    const bs = camp.slice(camp.indexOf("router.post('/brand-send'"), camp.indexOf("router.post('/brand-send'") + 3000);
    expect(bs).toContain('await checkBrandSendGate(companyId, senderKey, { requireKey: true })');
  });
});
