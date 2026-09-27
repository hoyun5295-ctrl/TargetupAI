/**
 * 카카오·제어 JSON 묶음 (★ 2026-09-27 한줄로 V2 차수 1 KAKAO·KETC)
 *
 * m048 알림톡 적재가 제어 JSON 폭을 1024로 하드코딩 → 비토 라인(8192)에서도 SENDER_KEY 없이 적재돼 9999 → 테이블 실제 폭(폭 CT).
 * m049 브랜드 조립 폭을 넘기지 않는 경로(직접발송 워커 · AI · 직접 · /brand-send 기본형) → 적재 테이블 폭.
 * m050 예약 /brand-send가 즉시 completed → 취소 게이트를 못 지남 → 미래 예약이면 scheduled.
 * m102 (원복 · Codex KAKAO 1R high) 완료 캠페인 queueOnly 정지는 건수 환불과 정산 스위퍼 미적재 환불이 같은 삭제분을 이중 환불 →
 *      옛 코드로 되돌리고 A-04(환불 목표 기준 통일) 설계 과제에 합류. 슈퍼관리자 취소 = scheduled만(종전).
 * R088 IMC 변경 10곳이 결과와 무관하게 PG를 바꿈 → IMC 성공일 때만.
 * R089 브랜드 기본형 수정이 PG에 updated_at만 → 보낸 칸을 등록과 같은 매핑으로.
 * R301 발신프로필 가져오기 중복 판정이 사용 중지 프로필까지 → 활성만(신규 등록·유니크 인덱스와 같은 정책).
 * R302 4014(키 중복) 복구 분기가 죽어 있음(templateCode가 늘 채워짐) → 분기 제거(동작 변화 0 · 살리면 원격 삭제·본문 불일치 · Codex KAKAO 1R).
 * R360 유형 없는 추천 폴백이 전 키워드 + 템플릿 단독 +5 → 목표에 있는 키워드만 · 가산 없음.
 * R361 발신프로필 상태 동기화가 순서 없이 200건 → id 순환 커서.
 * R427 템플릿 목록 순회가 상한에서 조용히 끊김 → 경보.
 * (★ TDD 순서 위반 공개: 이 묶음은 코드를 먼저 적용하고 테스트를 뒤에 썼다 — 장부 기록)
 */
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { brandTemplateColumnsFromBody } from '../brand-template-columns';

const src =(...p: string[]) => readFileSync(join(__dirname, '..', ...p), 'utf8');

describe('m048 알림톡 적재 폭', () => {
  it('비토 라인은 테이블 실제 폭 · 1024 하드코딩 제거', () => {
    const s = src('sms-queue.ts');
    const at = s.indexOf('export async function insertAlimtalkQueue(');
    const body = s.slice(at, at + 9000);
    expect(body).toContain('const etcCap = bitoSenderKey ? await getEtcJsonCapacity(table) : K_ETC_JSON_BASE_MAX;');
    expect(body).toContain('if (mergedEtc.length <= etcCap) {');
    expect(body).not.toContain('mergedEtc.length <= 1024');
  });
});

describe('m049 브랜드 조립 폭 = 적재 테이블 폭', () => {
  it('직접발송 워커 · AI · 직접 경로', () => {
    const d = src('direct-send-processor.ts');
    expect(d).toContain('const etcJsonMax = await getEtcJsonCapacity(p.companyTables[0]);');
    expect(d).toMatch(/carouselJson: p\.kakaoCarouselJson \|\| undefined,\s*etcJsonMax,/);
    const c = src('..', 'routes', 'campaigns.ts');
    expect(c).toContain("const aiEtcJsonMax = (sendChannel === 'kakao' || sendChannel === 'both') ? await getEtcJsonCapacity(companyTables[0]) : undefined;");
    expect(c).toContain('etcJsonMax: aiEtcJsonMax,');
    expect(c).toContain('const directEtcJsonMax = await getEtcJsonCapacity(companyTables[0]);');
    expect(c).toContain('etcJsonMax: directEtcJsonMax,');
  });
  it('/brand-send 기본형도 조립 앞에서 테이블을 확정하고 폭을 넘긴다(자유형과 같은 순서)', () => {
    const b = src('brand-message.ts');
    const at = b.indexOf('export async function sendBrandMessageTemplate(');
    const fn = b.slice(at, at + 9000);
    const tablesAt = fn.indexOf('const tables = await getCompanySmsTables(params.companyId, params.userId);');
    const buildAt = fn.indexOf('queuePayload = buildBrandQueuePayload({');
    const deductAt = fn.indexOf('await prepaidDeduct(');
    expect(tablesAt).toBeGreaterThan(0);
    expect(tablesAt).toBeLessThan(buildAt);
    expect(buildAt).toBeLessThan(deductAt);
    expect(fn).toContain('const etcJsonMax = await getEtcJsonCapacity(tables[0]);');
    expect(fn).toMatch(/couponVariableJson: params\.couponVariableJson,\s*etcJsonMax,/);
    // 테이블 확정은 한 번만
    expect(fn.split('await getCompanySmsTables(').length - 1).toBe(1);
  });
});

describe('m050 예약 브랜드 발송 = 예약 상태', () => {
  it('미래 reservedDate면 캠페인·회차 모두 scheduled', () => {
    const c = src('..', 'routes', 'campaigns.ts');
    const at = c.indexOf("router.post('/brand-send'");
    const body = c.slice(at, at + 12000);
    expect(body).toContain('const brandReserved = !!reservedDate && new Date(reservedDate).getTime() > Date.now();');
    expect(body).toContain("const brandStatus = brandReserved ? 'scheduled' : 'completed';");
    expect(body).toContain('`UPDATE campaigns SET status = $3, target_count = $1 WHERE id = $2`,');
    expect(body).toContain('[campaignId, result.sentCount, brandStatus]');
    expect(body).not.toContain("SET status = 'completed', target_count = $1 WHERE id = $2");
  });
});

describe('m102 원복 — 슈퍼관리자 취소는 예약만(완료 정지는 A-04와 함께)', () => {
  it('scheduled만 · queueOnly 없음', () => {
    const a = src('..', 'routes', 'admin.ts');
    const at = a.indexOf("router.post('/campaigns/:id/cancel'");
    const body = a.slice(at, at + 5000);
    expect(body).toContain("if (check.rows[0].status !== 'scheduled') {");
    expect(body).not.toContain('queueOnly');
  });
});

describe('R088 IMC 성공일 때만 PG 반영', () => {
  it('10곳 전부 결과 확인 뒤 UPDATE', () => {
    const s = src('..', 'routes', 'alimtalk.ts');
    const marks = s.split('★ 2026-09-27 한줄로 V2 R088').length - 1;
    expect(marks).toBe(10);
    const re = /★ 2026-09-27 한줄로 V2 R088[^\n]*\n\s*if \(r\.code === '0000'\) \{\n\s*await query\(/g;
    expect((s.match(re) || []).length).toBe(10);
    // 결과를 보기 전에 PG를 바꾸는 옛 모양이 남지 않았다: IMC 호출 직후 await query( 뒤에 곧바로 res.json(success: r.code...)
    const bare = /\n {6}await query\([\s\S]{0,400}?\n {6}\);\n {6}res\.json\(\{ success: r\.code === '0000', imc: r \}\);/g;
    expect((s.match(bare) || []).length).toBe(0);
  });
});

describe('R089 브랜드 템플릿 수정 → PG 칸', () => {
  // ★ 0927 pre-push 시간 초과 정정 — 순수 CT를 바로 불러온다(옛: 모듈 캐시를 비우고 발송 모듈 전체를 다시 불러와 전체 실행 부하에서 5초 초과)
  it('보낸 칸만 · 등록과 같은 변환', () => {
    const cols = brandTemplateColumnsFromBody({
      content: '새 본문', buttons: [{ name: 'b' }], variables: ['x'], attachment: null, adult: undefined,
    });
    const by = Object.fromEntries(cols.map((c) => [c.column, c]));
    expect(Object.keys(by).sort()).toEqual(['attachment', 'buttons', 'content', 'variables']);
    expect(by.content.value).toBe('새 본문');
    expect(by.buttons).toEqual({ column: 'buttons', value: JSON.stringify([{ name: 'b' }]), cast: '::jsonb' });
    expect(by.variables).toEqual({ column: 'variables', value: ['x'], cast: '::text[]' });
    expect(by.attachment.value).toBeNull();
    expect(brandTemplateColumnsFromBody({})).toEqual([]);
    expect(brandTemplateColumnsFromBody({ adult: '' })[0]).toEqual({ column: 'adult_yn', value: 'N', cast: '' });
  });
  it('수정 라우트가 IMC 성공 뒤 그 칸을 싣는다', () => {
    const s = src('..', 'routes', 'alimtalk.ts');
    const at = s.indexOf("'/brand-templates/:templateKey',\n  requireCompanyAdmin");
    const body = s.slice(at, at + 3000);
    expect(body).toContain('const setCols = brandTemplateColumnsFromBody(req.body || {});');
    expect(body).toContain("`UPDATE brand_message_templates SET ${[...sets, 'updated_at = now()'].join(', ')} WHERE id = $1`,");
  });
});

describe('R301 · R302 발신프로필 가져오기 · 4014 복구', () => {
  it('가져오기 중복은 활성 프로필만', () => {
    const s = src('..', 'routes', 'alimtalk.ts');
    expect(s).toContain('WHERE company_id = $1 AND yellow_id = $2 AND COALESCE(is_active, true) = true');
  });
  it('죽은 4014 복구 분기 제거 · 4014는 오류 응답 · 등록 롤백은 이 요청이 만든 템플릿에만', () => {
    const s = src('..', 'routes', 'alimtalk.ts');
    const at = s.indexOf("router.post(\n  '/templates',");
    const body = s.slice(at, at + 12000);
    expect(body).not.toContain("r.code === '4014'");
    expect(body).not.toContain('B3 복구: 기존 IMC 템플릿 연결');
    expect(body).toContain('const r = await imc.createAlimtalkTemplate(senderKey, {');
    expect(body).toContain("if (r.code !== '0000' || !templateCode) {");
  });
});

describe('R360 유형 없는 추천 폴백', () => {
  const tpl = (id: string, content: string) => ({
    id, template_code: id, template_name: id, profile_id: 'p', profile_name: 'p', content, status: 'APPROVED',
    category: null, message_type: 'BA', emphasize_type: 'NONE', emphasize_title: null,
  });
  const run = async (objective: string, templates: any[], campaignType?: string) => {
    vi.resetModules();
    const query = vi.fn(async (sql: string) => (sql.includes('FROM kakao_templates') ? { rows: templates } : { rows: [{ enabled_fields: [] }] }));
    vi.doMock('../../config/database', () => ({ query }));
    vi.doMock('../../services/ai', () => ({ callAIWithFallback: vi.fn(async () => { throw new Error('AI 없음'); }) }));
    vi.doMock('../company-memory', () => ({ buildMemoryPromptContext: vi.fn(async () => '') }));
    const { matchAlimtalkTemplate } = await import('../alimtalk-ai-matcher');
    const r = await matchAlimtalkTemplate({ companyId: 'co-1', campaignObjective: objective, campaignType });
    vi.doUnmock('../../config/database');
    vi.doUnmock('../../services/ai');
    vi.doUnmock('../company-memory');
    return r;
  };
  it('목표와 무관한 템플릿은 키워드가 많아도 추천하지 않는다', async () => {
    const noisy = tpl('t-noisy', '가입 환영 신규 시작 재구매 다시 구매 주문 결제 휴면 오랜만 쿠폰 예약 방문 확인 특별 감사 우수 선물');
    const r = await run('배송 지연 안내', [noisy]);
    expect(r.matched).toBe(false);
    expect(r.matchScore).toBe(0);
  });
  it('목표에 있는 키워드가 템플릿에도 있으면 추천', async () => {
    const r = await run('생일 축하 쿠폰', [tpl('t-bday', '생일 축하 쿠폰을 드립니다')]);
    expect(r.matched).toBe(true);
    expect(r.matchScore).toBe(60);
  });
  it('유형이 있으면 종전 규칙(템플릿 단독 +5) 그대로', async () => {
    const r = await run('이번 달 소식', [tpl('t-vip', 'VIP 특별 감사 우수 고객')], 'vip');
    expect(r.matchScore).toBeGreaterThan(0);
  });
});

describe('R361 발신프로필 상태 동기화 순환 커서', () => {
  it('id 순 · 커서 이후 · 끝에 닿으면 처음부터', () => {
    const s = src('alimtalk-jobs.ts');
    expect(s).toContain('const SENDER_SYNC_BATCH = 200;');
    expect(s).toContain("${from ? 'AND id > $1::uuid' : ''}");
    expect(s).toContain('ORDER BY id ASC');
    expect(s).toContain('senderSyncCursor = rows.length >= SENDER_SYNC_BATCH ? String(rows[rows.length - 1].id) : null;');
  });
});

describe('R427 템플릿 목록 상한 경보', () => {
  it('두 순회 모두 마지막 허용 쪽이 꽉 차면 경보', () => {
    const s = src('kakao-template-sync.ts');
    expect(s).toContain("import { sendSystemAlert } from './system-alert';");
    expect(s).toContain("if (page === IMC_MAX_PAGES - 1) warnImcListCap('코드');");
    expect(s).toContain("if (page === IMC_MAX_PAGES - 1) warnImcListCap('상태');");
    // 경보는 "쪽이 꽉 찼다"(= items.length < IMC_PAGE_SIZE 로 끝나지 않았다) 뒤에만 닿는다
    const loop1 = s.indexOf("warnImcListCap('코드')");
    expect(s.lastIndexOf('if (items.length < IMC_PAGE_SIZE) break;', loop1)).toBeGreaterThan(s.lastIndexOf('for (', loop1));
  });
});
