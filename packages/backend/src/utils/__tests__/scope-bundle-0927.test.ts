/**
 * 사용자 격리 (★ 2026-09-27 한줄로 V2 차수 2 SCOPE 묶음)
 *
 * 원칙(Harold 상시): 고객사 관리자는 전부 · 사용자는 자기 것만(작성자 소유 · 고객은 분류코드 범위).
 * m103 캠페인 id 라우트 9곳(발송·상세·진행률·취소·수신자 조회·수신자 삭제·시간 변경·문구 수정)이 회사 조건만 → 작성자 소유 CT.
 * m044 스팸 검사 이력·단건이 회사 조건만(단건은 first_recipient 고객 정보 포함) → 담당자는 본인 검사만.
 * m128 스테이징 집계의 중복·수신거부 수에 회사 조건 없음.
 * R061 주소록 그룹 = 사용자마다 따로인 이름인데 관리자 조회·추가·삭제가 이름만으로 묶어 남의 같은 이름 그룹을 합치고 함께 지웠다
 *      → (주인, 이름)으로 식별(주인 CT · 화면이 주인을 함께 보낸다).
 * R080 자동마케팅 상태값이 타입 선언만 → 선언된 4개만(격리 = Harold 0619 결정 「회사 스코프」라 그대로).
 * R113 고객 상세·360 타임라인이 분류코드 범위 없음(구매 이력만 있었다).
 * R117 DM id 라우트 20곳에 소유 가드 없음 → 가드 CT(dm-access)로 옮기고 미들웨어로.
 * R132 관리자 계정 삭제 차단이 DB 값('admin')이 아닌 JWT 값('company_admin')과 비교 → 늘 통과.
 * R170 브랜드 기본정보 저장이 담당자에게도 상호·사업자번호·업태·종목(세금계산서 공급받는자)을 열어 둠 · 사업자번호 형식 검증 없음.
 * R340 세그먼트 사용 시각 갱신이 id만으로 UPDATE.
 * S5-04 비문자 타겟(인원·명단)·DM 대상 발송·이메일 대상(즉시·예약)·여정 추출이 분류코드 범위 없음 → 범위 SQL CT 하나(리터럴 · 별칭).
 *       여정은 작성자 기준 · 추출 SQL 안(LIMIT 앞)에 건다(뒤에서 거르면 범위 밖 고객이 매 회차 상한을 차지해 범위 안 고객이 굶는다).
 */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const src = (...p: string[]) => readFileSync(join(__dirname, '..', ...p), 'utf8');
const fe = (...p: string[]) => readFileSync(join(__dirname, '..', '..', '..', '..', 'frontend', 'src', ...p), 'utf8');
/** 라우트 시작 문자열부터 다음 라우트 정의 직전까지 */
const routeBody = (s: string, start: string, next = '\nrouter.') => {
  const at = s.indexOf(start);
  if (at < 0) throw new Error(`라우트를 못 찾음: ${start}`);
  const end = s.indexOf(next, at + start.length);
  return s.slice(at, end < 0 ? undefined : end);
};
const U1 = '11111111-1111-4111-8111-111111111111';
const U2 = '22222222-2222-4222-8222-222222222222';

afterEach(() => { vi.doUnmock('../../config/database'); vi.resetModules(); });

describe('작성자 소유 CT (owner-scope)', () => {
  // owner-scope → normalize(isUuid CT) → standard-field-map → config/database 가 import 때 연결을 연다 → 모의로 막는다
  beforeEach(() => { vi.doMock('../../config/database', () => ({ query: vi.fn(async () => ({ rows: [] })) })); });
  it('canAccessOwnedRow — 관리자·슈퍼 = 회사 전체 · 담당자 = 본인 것만 · 작성자 없음은 닫힘', async () => {
    const { canAccessOwnedRow } = await import('../owner-scope');
    const r = (userType: string, userId = U1) => ({ user: { userType, userId } }) as any;
    expect(canAccessOwnedRow(r('company_admin'), U2)).toBe(true);
    expect(canAccessOwnedRow(r('super_admin'), null)).toBe(true);
    expect(canAccessOwnedRow(r('company_user'), U1)).toBe(true);
    expect(canAccessOwnedRow(r('company_user'), U2)).toBe(false);
    expect(canAccessOwnedRow(r('company_user'), null)).toBe(false);
  });
  it('resolveTargetOwner — 담당자 = 늘 본인 · 관리자 = 요청 주인(없거나 형식 오류면 본인) · none = 작성자 없는 옛 행', async () => {
    const { resolveTargetOwner } = await import('../owner-scope');
    const r = (userType: string) => ({ user: { userType, userId: U1 } }) as any;
    expect(resolveTargetOwner(r('company_user'), U2)).toBe(U1);
    expect(resolveTargetOwner(r('company_admin'), U2)).toBe(U2);
    expect(resolveTargetOwner(r('company_admin'), undefined)).toBe(U1);
    expect(resolveTargetOwner(r('company_admin'), "x' OR 1=1")).toBe(U1);
    expect(resolveTargetOwner(r('company_admin'), 'none')).toBeNull();
    expect(resolveTargetOwner(r('company_user'), 'none')).toBe(U1);
  });
});

describe('m103 캠페인 id 라우트 = 작성자 소유', () => {
  const c = src('..', 'routes', 'campaigns.ts');
  const routes = [
    "router.post('/:id/send'", "router.get('/:id', ", "router.get('/:id/send-progress'", "router.post('/:id/cancel'",
    "router.get('/:id/recipients'", "router.delete('/:id/recipients/:idx'", "router.put('/:id/reschedule'", "router.put('/:id/message'",
  ];
  for (const r of routes) {
    it(r, () => {
      expect(routeBody(c, r)).toContain('canAccessOwnedRow(req');
    });
  }
  it('취소는 CT를 부르기 전에 소유를 본다(취소 CT는 작성자를 대조하지 않는다)', () => {
    const b = routeBody(c, "router.post('/:id/cancel'");
    expect(b.indexOf('canAccessOwnedRow(req')).toBeLessThan(b.indexOf('await cancelCampaign('));
  });
});

describe('m044 스팸 검사 = 담당자는 본인 것만', () => {
  const s = src('..', 'routes', 'spam-filter.ts');
  it('이력 목록: 담당자면 mine과 무관하게 본인', () => {
    const b = routeBody(s, "router.get('/tests', authenticate");
    expect(b).toContain('const ownerId = resolveOwnerScope(req);');
    expect(b).toContain('const mineOnly = req.query.mine === \'true\' || !!ownerId;');
  });
  it('단건: 담당자면 user_id 조건', () => {
    const b = routeBody(s, "router.get('/tests/:id', authenticate");
    expect(b).toContain('resolveOwnerScope(req)');
    expect(b).toContain('AND t.user_id = $3');
  });
});

describe('m128 스테이징 집계 = 회사 조건', () => {
  it('중복·수신거부 수도 회사 조건', () => {
    const d = src('direct-send-core.ts');
    expect(d).toContain('FROM campaign_send_staging WHERE staging_id = $1 AND company_id = $2`,');
    expect(d).toContain('WHERE s.staging_id = $1 AND s.company_id = $3`,');
  });
});

describe('R061 주소록 그룹 = (주인, 이름)', () => {
  const a = src('..', 'routes', 'address-books.ts');
  it('그룹 목록이 주인을 함께 돌려준다', () => {
    const b = routeBody(a, "router.get('/groups'");
    expect(b).toContain('a.user_id AS owner_id');
    expect(b).toContain('GROUP BY a.group_name, a.user_id');
  });
  for (const r of ["router.get('/:groupName',", "router.get('/:groupName/export'", "router.post('/:groupName/append'", "router.delete('/:groupName'"]) {
    it(`${r} 가 주인 CT로 한 그룹만`, () => {
      const b = routeBody(a, r);
      expect(b).toContain('resolveTargetOwner(req, req.query.owner)');
      expect(b).toContain('ownerClause(');
    });
  }
  it('추가는 그 그룹 주인 이름으로 적재(관리자가 남의 그룹에 넣어도 그룹이 갈라지지 않게)', () => {
    const b = routeBody(a, "router.post('/:groupName/append'");
    expect(b).toContain('userId: ownerId');
  });
  it('화면이 모든 그룹 요청에 주인을 보낸다', () => {
    const m = fe('components', 'AddressBookModal.tsx');
    expect(m).toContain('const ownerParam = (g: AddressGroup)');
    expect((m.match(/\$\{ownerParam\(/g) || []).length).toBeGreaterThanOrEqual(5);
    expect(m).not.toMatch(/fetch\(`\/api\/address-books\/\$\{encodeURIComponent\(group\.group_name\)\}`/);
  });
});

describe('R080 자동마케팅 상태값 = 선언된 4개만', () => {
  it('상태 목록 CT · 라우트는 목록 밖 값을 무시', async () => {
    const co = src('continuous-operator.ts');
    expect(co).toContain("export const OPERATOR_STATUSES: readonly OperatorStatus[] = ['active', 'paused', 'paused_no_credit', 'archived'];");
    const ai = src('..', 'routes', 'ai.ts');
    const b = routeBody(ai, "router.put('/operator/continuous/:id'");
    expect(b).toContain('status: (OPERATOR_STATUSES as readonly string[]).includes(status) ? status : undefined,');
  });
});

describe('R113 고객 상세·타임라인 = 분류코드 범위', () => {
  const c = src('..', 'routes', 'customers.ts');
  it('상세', () => {
    const b = routeBody(c, "router.get('/:id', async");
    expect(b).toContain("const scopeSql = await getOwnerCustomerScopeSql(companyId || '', userId);");
    expect(b).toContain('c.is_active = true${scopeSql}');
  });
  it('타임라인', () => {
    const b = routeBody(c, "router.get('/:id/timeline'");
    expect(b).toContain('await getOwnerCustomerScopeSql(companyId, req.user?.userId)');
    expect(b.indexOf('getOwnerCustomerScopeSql')).toBeLessThan(b.indexOf('buildCustomerTimeline('));
  });
});

describe('R117 DM 소유 가드 = CT 미들웨어', () => {
  it('requireDmAccess — 회사 없음 403 · id 형식 400 · 남의 DM 403 · 내 DM 통과', async () => {
    vi.resetModules();
    const query = vi.fn(async (_sql: string, params: any[]) => ({ rows: params[2] === U1 ? [{ '?column?': 1 }] : [] }));
    vi.doMock('../../config/database', () => ({ query }));
    const { requireDmAccess } = await import('../dm-access');
    const mk = (user: any, id: string) => {
      const res: any = { statusCode: 0, body: null, status(c: number) { this.statusCode = c; return this; }, json(b: any) { this.body = b; return this; } };
      const next = vi.fn();
      return { req: { user, params: { id } } as any, res, next };
    };
    let t = mk({ userType: 'company_user', userId: U1, companyId: 'co' }, 'bad');
    await requireDmAccess(t.req, t.res, t.next);
    expect(t.res.statusCode).toBe(400);
    t = mk({ userType: 'company_user', userId: U2, companyId: 'co' }, U1);
    await requireDmAccess(t.req, t.res, t.next);
    expect(t.res.statusCode).toBe(403);
    expect(t.next).not.toHaveBeenCalled();
    t = mk({ userType: 'company_user', userId: U1, companyId: 'co' }, U2);
    await requireDmAccess(t.req, t.res, t.next);
    expect(t.next).toHaveBeenCalled();
    t = mk({ userType: 'company_user', userId: U1 }, U2);
    await requireDmAccess(t.req, t.res, t.next);
    expect(t.res.statusCode).toBe(403);
  });
  it('가드가 없던 20개 라우트', () => {
    const d = src('..', 'routes', 'dm.ts');
    const paths = [
      "'/:id/publish'", "'/:id/stats'", "'/:id/send-to-target'", "'/:id/recipients-tracking'", "'/:id/recipient-detail'",
      "'/:id/generate-copy'", "'/:id/render-sample'", "'/:id/convert-to-scroll'", "'/:id/test-send'", "'/:id/request-approval'",
      "'/:id/approve'", "'/:id/reject'", "'/:id/validate'", "'/:id/responses'", "'/:id/winners'", "'/:id/event-stats'",
      "'/:id/event-insight'", "'/:id/responses/export'", "'/:id/winners/import'", "'/:id/prizes'",
    ];
    for (const p of paths) expect(d, p).toMatch(new RegExp(`dmRouter\\.(get|post|put)\\(${p.replace(/[/:]/g, (m) => '\\' + m)}, requireDmAccess,`));
    // 옛 가드 함수는 CT로 옮겼다(라우트 인라인 정의 0)
    expect(d).not.toContain('async function canAccessDm(');
    expect(d).toContain("from '../utils/dm-access'");
  });
});

describe('R132 관리자 계정 삭제 차단 = DB 값', () => {
  it("user_type 'admin'", () => {
    const m = src('..', 'routes', 'manage-users.ts');
    const b = routeBody(m, "router.delete('/:id'");
    expect(b).toContain("if (check.rows[0].user_type === 'admin') {");
    expect(b).not.toContain("user_type === 'company_admin'");
  });
});

describe('R170 브랜드 기본정보 — 세금계산서 칸은 관리자만 · 사업자번호 형식', () => {
  it('바뀐 법정 칸 판정(보낸 값이 지금 값과 같으면 바뀐 것이 아니다)', async () => {
    const { findLegalFieldChanges } = await import('../brand-basic-info');
    const cur = { company_name: '(주)가', business_number: '123-45-67890', business_type: '도소매', business_category: '화장품', brand_name: 'A' };
    expect(findLegalFieldChanges(cur, { company_name: '(주)가', business_number: '123-45-67890', brand_name: 'B' })).toEqual([]);
    expect(findLegalFieldChanges(cur, { company_name: '(주)나' })).toEqual(['company_name']);
    expect(findLegalFieldChanges(cur, { business_number: '1234567890' })).toEqual([]);   // 표기만 다름 = 같은 번호
    expect(findLegalFieldChanges(cur, { business_type: '' })).toEqual(['business_type']);
  });
  it('라우트: 담당자가 법정 칸을 바꾸면 403 · 사업자번호는 바뀔 때 형식 CT', () => {
    const d = src('..', 'routes', 'dm.ts');
    const b = routeBody(d, "dmRouter.put('/brand-basic-info'", '\ndmRouter.');
    expect(b).toContain('findLegalFieldChanges(');
    expect(b).toContain('status(403)');
    const bb = src('brand-basic-info.ts');
    expect(bb).toContain('normalizeBizNumber(');
  });
  it('화면이 서버 거절 사유를 보여 준다', () => {
    const t = fe('components', 'AiMemory', 'BrandBasicInfoTab.tsx');
    expect(t).toContain("if (!r1.ok) { const d = await r1.json().catch(() => ({})); onToast(d?.error || '기본정보 저장에 실패했어요', 'error'); return; }");
  });
});

describe('R340 세그먼트 사용 시각 = 본인 것만', () => {
  it('회사·사용자 조건', () => {
    const s = src('saved-segments.ts');
    expect(s).toContain("'UPDATE saved_segments SET last_used_at = NOW() WHERE id = $1 AND company_id = $2 AND user_id = $3',");
    const r = src('..', 'routes', 'saved-segments.ts');
    expect(r).toMatch(/await touchSegment\(req\.params\.id, companyId, userId\)/);
  });
});

describe('S5-04 고객 범위 SQL CT', () => {
  it('리터럴 조각 — 별칭 · 이스케이프 · 별칭 없으면 종전 그대로', async () => {
    const { buildCustomerStoreFilterLiteral } = await import('../store-scope');
    expect(buildCustomerStoreFilterLiteral('co', ['A'])).toBe(" AND id IN (SELECT customer_id FROM customer_stores WHERE company_id = 'co' AND store_code = ANY(ARRAY['A']::text[]))");
    expect(buildCustomerStoreFilterLiteral('co', ["A'B"], 'c')).toBe(" AND c.id IN (SELECT customer_id FROM customer_stores WHERE company_id = 'co' AND store_code = ANY(ARRAY['A''B']::text[]))");
  });
  it('getOwnerCustomerScopeSql — 관리자·주인 없음 = 빈 조각 · 분류코드 사용자 = 범위 · 미배정 = FALSE', async () => {
    vi.resetModules();
    const state: any = { userType: 'user', codes: ['S1'], hasMatch: true, hasStores: true, allowFull: false };
    const query = vi.fn(async (sql: string) => {
      if (sql.includes('SELECT user_type FROM users')) return { rows: [{ user_type: state.userType }] };
      if (sql.includes('SELECT store_codes FROM users')) return { rows: [{ store_codes: state.codes }] };
      if (sql.includes('has_match')) return { rows: [{ has_match: state.hasMatch }] };
      if (sql.includes('has_stores')) return { rows: [{ has_stores: state.hasStores }] };
      if (sql.includes('allow_user_full_access')) return { rows: [{ allow_user_full_access: state.allowFull }] };
      return { rows: [] };
    });
    vi.doMock('../../config/database', () => ({ query }));
    const { getOwnerCustomerScopeSql } = await import('../store-scope');
    expect(await getOwnerCustomerScopeSql('co', null)).toBe('');
    expect(await getOwnerCustomerScopeSql('co', U1)).toBe(" AND c.id IN (SELECT customer_id FROM customer_stores WHERE company_id = 'co' AND store_code = ANY(ARRAY['S1']::text[]))");
    state.codes = [];
    expect(await getOwnerCustomerScopeSql('co', U1)).toBe(' AND FALSE');
    state.userType = 'admin';
    expect(await getOwnerCustomerScopeSql('co', U1)).toBe('');
    state.userType = 'user'; state.hasStores = false;
    expect(await getOwnerCustomerScopeSql('co', U1)).toBe('');   // 분류 체계 없는 회사 = 전체(종전)
  });
  it('여정 작성자 범위 = 여정의 created_by로 판정', () => {
    const s = src('store-scope.ts');
    expect(s).toContain('export async function getJourneyOwnerScopeSql(');
    expect(s).toContain("SELECT created_by FROM journeys WHERE id = $1::uuid AND company_id = $2::uuid");
  });
});

describe('S5-04 소비처 배선', () => {
  it('타겟 인원 CT · 명단 라우트', () => {
    const tc = src('target-count.ts');
    expect(tc).toMatch(/filter: Record<string, unknown>,\s*scopeSql = '',/);
    expect((tc.match(/\$\{filterSql\}\$\{scopeSql\}/g) || []).length).toBe(3);
    const t = src('..', 'routes', 'targets.ts');
    expect((t.match(/const scopeSql = await getOwnerCustomerScopeSql\(companyId, req\.user\?\.userId\);/g) || []).length).toBe(3);
    expect((t.match(/\$\{filterSql\}\$\{scopeSql\}/g) || []).length).toBe(2);
  });
  it('DM 대상 발송(재발송 포함)', () => {
    const d = src('..', 'routes', 'dm.ts');
    const b = routeBody(d, "dmRouter.post('/:id/send-to-target'", '\ndmRouter.');
    expect(b).toContain('const scopeSql = await getOwnerCustomerScopeSql(companyId, req.user?.userId);');
    expect((b.match(/\(\$\{dmWhere\}\)(\$\{filterSql\})?\$\{scopeSql\}/g) || []).length).toBe(2);
  });
  it('이메일 대상(즉시 = 요청자 · 예약 = 캠페인 작성자)', () => {
    const e = src('email-channel.ts');
    expect(e).toMatch(/export async function resolveCustomerRecipients\(\s*companyId: string,\s*grades\?: string\[\],\s*ownerUserId\?: string \| null,/);
    expect(e).toMatch(/export async function resolveCustomerRecipientsByFilter\(\s*companyId: string,\s*filter: Record<string, \{ operator: string; value: any \}>,\s*ownerUserId\?: string \| null,/);
    const r = src('..', 'routes', 'email.ts');
    expect(r).toContain('resolved = await resolveCustomerRecipients(auth.companyId, grades, auth.ownerId);');
    expect(r).toContain('resolved = await resolveCustomerRecipientsByFilter(auth.companyId, target.filter, auth.ownerId);');
    const sw = src('email-send-sweeper.ts');
    expect(sw).toContain('return resolveCustomerRecipients(companyId, spec.grades, ownerUserId);');
    expect(sw).toContain('return resolveCustomerRecipientsByFilter(companyId, spec.filter, ownerUserId);');
  });
  it('여정 추출 13곳 = 안전 필터 바로 뒤 범위 조각', () => {
    const x = src('journey-target-extractor.ts');
    expect((x.match(/\$\{buildJourneySafetyFilter\('c'\)\}\$\{scopeSql\}/g) || []).length).toBe(13);
    expect((x.match(/\$\{buildJourneySafetyFilter\('c'\)\}(?!\$\{scopeSql\})/g) || []).length).toBe(0);
  });
  it('여정 발송 입구(트리거 3 · 기념일 2)가 작성자 범위를 넘긴다', () => {
    const w = src('journey-trigger-watcher.ts');
    expect((w.match(/await getJourneyOwnerScopeSql\(j\.company_id, j\.id\)/g) || []).length).toBe(3);
    const a = src('journey-anchor-scheduler.ts');
    expect((a.match(/await getJourneyOwnerScopeSql\(/g) || []).length).toBe(2);
  });
});
