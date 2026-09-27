/**
 * 차수 3 ② 데이터 손상·유실 (★ 2026-09-27 한줄로 V2)
 *
 * R144 매핑 검증·백그라운드 저장이 늘 첫 행을 헤더로 → 무헤더 파일은 첫 고객이 빠지고 매핑 이름(컬럼N)이 어긋났다 → 헤더·행 나누기 CT 하나.
 * R145 타입 감지가 배열 행을 헤더 이름으로 읽어 표본이 늘 비고 → 정의 저장 CT가 매 업로드 VARCHAR로 덮었다 → 열 위치로 읽기 · 못 알아내면 기존 타입 유지.
 * R367 업종 예시·공식 교체가 트랜잭션 없는 DELETE→INSERT · 예시 0건이어도 교체 → 한 트랜잭션 · 0건이면 두기.
 * R127 스튜디오 MMS 저장이 원본을 지운 뒤 용량 한도 검사 → 한도 통과 뒤에 원본 소비.
 * R241 숨긴 템플릿 골격이 붙은 최종 프롬프트가 소재 기록·목록 API로 → 저장 안 함 · 응답에서 뺀다.
 * R245 비회원 주문(회원 id 없음)은 적재 CT가 예외 → 주문 외부 id CT(회원 → guest:휴대폰 → order:주문번호 · 고도몰 규칙) · 아임웹·카페24·네이버.
 * R179 브라우저 SDK 적재 버스트 제한이 회사 단위 → 쇼핑객 합산이 막혀 이벤트 유실 → 방문자 단위.
 * R346 싱크 구매 수량·단가·금액 0이 NULL로(falsy 폴백) → 금액 정규화 CT.
 * R219 마감 추첨이 실행 권리를 먼저 커밋 → 중간 실패면 다시 안 돈다 → 한 트랜잭션.
 * R217 응답과 연결 안 된 사전 당첨자는 같은 엑셀 재업로드로 중복 → 같은 DM·섹션·번호면 건너뜀.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const src = (...p: string[]) => readFileSync(join(__dirname, '..', ...p), 'utf8');
const between = (s: string, a: string, b: string) => {
  const i = s.indexOf(a);
  if (i < 0) throw new Error(`못 찾음: ${a}`);
  const j = s.indexOf(b, i + a.length);
  return s.slice(i, j < 0 ? undefined : j);
};
afterEach(() => { vi.doUnmock('../../config/database'); vi.resetModules(); });

describe('R144 · R145 고객 업로드', () => {
  it('헤더·행 나누기 CT(행동)', async () => {
    const { splitHeaderRows } = await import('../excel-columns');
    const withHeader = splitHeaderRows([['이름', '전화', '이름'], ['홍', '01011112222', 'x']]);
    expect(withHeader).toEqual({ headers: ['이름', '전화', '이름 (2)'], rows: [['홍', '01011112222', 'x']], hasHeader: true });
    const noHeader = splitHeaderRows([['01011112222', '1000'], ['01033334444', '2000']]);
    expect(noHeader).toEqual({ headers: ['컬럼1', '컬럼2'], rows: [['01011112222', '1000'], ['01033334444', '2000']], hasHeader: false });
  });
  it('세 경로가 같은 CT · 라우트 인라인 헤더 함수 제거', () => {
    const u = src('..', 'routes', 'upload.ts');
    expect((u.match(/splitHeaderRows\(/g) || []).length).toBe(3);
    expect(u).not.toContain('function dedupeHeaders(');
  });
  it('타입 감지는 열 위치로 · 못 알아내면 기존 타입 유지', () => {
    const u = src('..', 'routes', 'upload.ts');
    expect(u).not.toContain('.map((r: any) => r[header])');
    expect(u).toContain('const colIdx = headers.indexOf(header);');
    const m = src('standard-field-map.ts');
    expect(m).toContain('field_type = CASE WHEN $6::boolean THEN EXCLUDED.field_type ELSE customer_field_definitions.field_type END,');
  });
});

describe('R367 업종 예시·공식 교체', () => {
  it('한 트랜잭션 · 예시 0건이면 기존 유지', () => {
    const b = src('best-copy-assets.ts');
    const ex = between(b, 'export async function replaceStyleExamples(', '\nexport ');
    expect(ex).toContain('if (examples.length === 0) return false;');
    expect(ex).toContain("await client.query('BEGIN');");
    expect(ex).toContain("await client.query('COMMIT');");
    const fm = between(b, 'export async function saveIndustryFormula(', '\nexport ');
    expect(fm).toContain("await client.query('BEGIN');");
  });
});

describe('R127 · R241 이미지 스튜디오 저장', () => {
  it('원본 소비는 용량 한도 통과 뒤', () => {
    const r = src('..', 'routes', 'image-studio.ts');
    const b = between(r, "imageStudioRouter.post('/save'", '\nimageStudioRouter.');
    expect(b.indexOf('consumeOriginal?.();')).toBeGreaterThan(b.indexOf('if (projected > usage.limitBytes) {'));
    expect(b).not.toContain('try { fs.unlinkSync(found.absPath); } catch { /* noop */ }\n      try { fs.unlinkSync(path.join(dir, `${tempId}.json`)); } catch { /* noop */ }\n      effTempId');
  });
  it('내부 프롬프트는 소재 기록에 싣지 않고 목록 응답에서도 뺀다', () => {
    const r = src('..', 'routes', 'image-studio.ts');
    const b = between(r, "imageStudioRouter.post('/save'", '\nimageStudioRouter.');
    expect(b).toContain('prompt: null,');
    const a = src('..', 'routes', 'assets.ts');
    expect(a).toContain('assets: assets.map(({ prompt: _p, ...rest }: any) => rest)');
  });
});

describe('R245 비회원 주문 외부 id', () => {
  it('CT(행동) — 회원 → guest:휴대폰 → order:주문번호', async () => {
    const { orderExternalId } = await import('../cdp-order-identity');
    expect(orderExternalId('m1', '010-1', 'o1')).toBe('m1');
    expect(orderExternalId('', '010-1111-2222', 'o1')).toBe('guest:010-1111-2222');
    expect(orderExternalId(null, '', 'o1')).toBe('order:o1');
    expect(orderExternalId(undefined, undefined, 'o2')).toBe('order:o2');
  });
  it('아임웹·카페24(2)·네이버·고도몰이 CT를 쓴다', () => {
    expect(src('imweb-client.ts')).toContain('externalId: orderExternalId(resource.memberUid || resource.member_uid, resource.call || resource.mobile || resource.phone, resource.orderNo || resource.order_no),');
    expect((src('cafe24-client.ts').match(/externalId: orderExternalId\(resource\.member_id \|\| resource\.customer_id, resource\.buyer_cellphone \|\| resource\.buyer_phone, resource\.order_id\),/g) || []).length).toBe(2);
    expect(src('naver-commerce-client.ts')).toContain('externalId: orderExternalId(resource.member_id || resource.customer_id, resource.buyer_cellphone || resource.phone, resource.order_id || resource.product_order_id),');
    expect(src('godo-parse.ts')).toContain('const externalId = orderExternalId(memId, phone, orderId);');
  });
});

describe('R179 브라우저 적재 = 방문자 단위', () => {
  it('키 인자 · /ingest만 방문자 키', () => {
    const b = src('cdp-burst-limit.ts');
    expect(b).toContain('export function cdpBurstLimit(maxPerWindow: number, windowMs: number, keyOf?: (req: Request, companyId: string) => string)');
    const c = src('..', 'routes', 'cdp.ts');
    expect(c).toContain("router.post('/ingest', requireCdpBrowserOrigin, cdpIngestBurst, async");
    expect(c).toContain('const cdpIngestBurst = cdpBurstLimit(50, 10_000, (req, companyId) => `${companyId}:v:${String((req.body || {}).anonymous_id || req.ip || \'\')}`);');
  });
  it('방문자 키로 세면 다른 방문자는 막히지 않는다(행동)', async () => {
    const { cdpBurstLimit } = await import('../cdp-burst-limit');
    const mw = cdpBurstLimit(2, 10_000, (req: any, companyId) => `${companyId}:v:${req.body.anonymous_id}`);
    const call = (anon: string) => {
      let status = 200;
      const res: any = { status(c: number) { status = c; return this; }, json() { return this; } };
      let passed = false;
      mw({ cdp: { companyId: 'co-burst' }, body: { anonymous_id: anon } } as any, res, () => { passed = true; });
      return passed ? 200 : status;
    };
    expect(call('a')).toBe(200); expect(call('a')).toBe(200); expect(call('a')).toBe(429);
    expect(call('b')).toBe(200);
  });
});

describe('R346 싱크 구매 0값', () => {
  it('금액 정규화 CT', () => {
    const s = src('..', 'routes', 'sync.ts');
    expect(s).toContain('quantity: normalizeAmount(p.quantity), unit_price: normalizeAmount(p.unit_price), total_amount: normalizeAmount(p.total_amount),');
  });
});

describe('R219 · R217 DM 당첨자', () => {
  it('추첨 = 권리 선점·명단·적재 한 트랜잭션', () => {
    const d = src('dm', 'dm-interaction.ts');
    const b = between(d, 'export async function runLuckyDrawForCampaign(', '\n}\n');
    expect(b).toContain("await client.query('BEGIN');");
    expect(b).toContain('const claimed = await claimDrawRun(c.campaignId, c.sectionId, seed, q);');
    expect(b).toContain("await client.query('COMMIT');");
    expect(b).toContain("await client.query('ROLLBACK')");
  });
  it('사전 당첨자 중복 건너뜀(같은 DM·섹션·번호)', () => {
    const d = src('dm', 'dm-interaction.ts');
    const b = between(d, 'export async function importPresetWinners(', '\n}\n');
    expect(b).toContain("AND section_id IS NOT DISTINCT FROM $3 AND win_method = 'preset' AND winner_phone IS NOT DISTINCT FROM $8");
  });
});
