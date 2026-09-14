/**
 * woocommerce-routes.test.ts — 우커머스 라우트·배선 소스 계약(W2 · 설계서 §3 라우트 층 · §2 불변 7·8)
 *  웹훅 수신 = 원본 바이트 서명(rawBody) · 몰 후보 행마다 서명 대조 · 미연동 몰 200 무시 · 서명 실패 401 · cdp_webhook_deliveries 멱등 ·
 *  첫 검증 통과 = 연결 신호(markWooConnected) · 관리자 게이트 · 회사 식별자는 세션에서만 · app.ts 리미터·rawBody 경로·마운트·워커 기동 · registry 등록.
 *  DB·네트워크 0(소스 문자열 — 선례 ai-auto-build-routes.test.ts).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';

const SRC = resolve(__dirname, '..', '..');
const code = (rel: string) => readFileSync(resolve(SRC, rel), 'utf-8').replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ');

describe('routes/woocommerce.ts — 웹훅 수신', () => {
  const route = () => code('routes/woocommerce.ts');
  it('공개 웹훅은 자체 json 파서 + rawBody 캡처(전역 파서 앞 마운트 대비) · 몰 경로 파라미터', () => {
    const r = route();
    expect(r).toContain("json({ limit: '1mb', verify: (req: any, _res, buf) => { req.rawBody = buf; } })");
    expect(r).toContain("'/webhook/:mallId'");
  });
  it('서명은 원본 바이트로 · 몰 후보 행마다 대조(같은 몰 주소를 두 회사가 적어도 secret 이 가른다) · 실패 401 · 미연동 몰 200 무시', () => {
    const r = route();
    expect(r).toContain('listWooIntegrationsByMallId(');
    expect(r).toMatch(/verifyWebhookSignature\(rawBody/);
    expect(r).toMatch(/candidates\.find\(/);
    expect(r).toMatch(/status\(401\)/);
    expect(r).toMatch(/ignored: true/);
  });
  it('첫 서명 통과 = 연결 신호 · 멱등 = cdp_webhook_deliveries UNIQUE(company_id, source, idempotency_key) · 상태 3종', () => {
    const r = route();
    expect(r).toContain('markWooConnected(');
    expect(r).toContain('INSERT INTO cdp_webhook_deliveries');
    expect(r).toContain("'woocommerce'");
    expect(r).toContain('ON CONFLICT (company_id, source, idempotency_key) DO NOTHING');
    expect(r).toContain("status = 'duplicate'");
    expect(r).toContain("status = 'processed'");
    expect(r).toContain("status = 'failed'");
    // 전송 고유값(delivery id)을 멱등키 재료로 넘긴다
    expect(r).toMatch(/x-wc-webhook-delivery-id/);
    expect(r).toContain('buildIdempotencyKey(');
    // 재처리 워커가 payload.resource 를 꺼내므로 저장 본문에 resource 키가 있어야 한다
    expect(r).toMatch(/JSON\.stringify\(\{[^}]*resource/);
  });
  it('처리는 어댑터 한 함수(processWebhookEvent) — 라우트가 identify/syncOrder 를 직접 부르지 않는다', () => {
    const r = route();
    expect(r).toContain('woocommerceAdapter.processWebhookEvent(');
    expect(r).not.toMatch(/identifyCustomer\(|syncOrder\(/);
  });
});

describe('routes/woocommerce.ts — 관리자 라우트', () => {
  const route = () => code('routes/woocommerce.ts');
  it('자격 저장·연결·해제·secret 재발급은 회사 관리자 전용 · 요금제 게이트 · 회사 식별자는 세션에서만', () => {
    const r = route();
    expect(r).toContain('company_admin');
    expect(r).toContain('isCdpEnabledForPlan(');
    expect(r).not.toMatch(/req\.(body|query|params)\??\.\.?(companyId|company_id)/);
    for (const p of ["'/credentials'", "'/connect'", "'/status'", "'/disconnect'", "'/rotate-secret'"]) expect(r).toContain(p);
  });
  it('저장 응답에 웹훅 URL·secret(1회) · 연결은 검증 1콜 뒤 백필(회원 → 주문) 백그라운드 · REST 키 없는 몰은 오류가 아니라 안내', () => {
    const r = route();
    expect(r).toContain('saveWooCredentials(');
    expect(r).toContain('webhook_secret:');
    expect(r).toContain('verifyWooConnection(');
    expect(r).toMatch(/backfillWooCustomers\([\s\S]{0,400}backfillWooOrders\(/);
    expect(r).toMatch(/no_keys/);
  });
});

describe('배선 — app.ts · register-providers.ts · 워커', () => {
  it('app.ts: 공개 리미터 + rawBody json 경로에 /api/woocommerce/webhook · 마운트 · 워커 기동', () => {
    // app.ts 는 주석 제거를 하지 않는다 — `type: '*/*'` 문자열이 블록 주석 닫힘으로 읽혀 리미터 블록이 통째로 지워진다
    const app = readFileSync(resolve(SRC, 'app.ts'), 'utf-8');
    const limiter = app.slice(app.indexOf('cdpPublicLimiter'), app.indexOf('cdpPublicLimiter);') + 20);
    expect(limiter).toContain("'/api/woocommerce/webhook'");
    const rawIdx = app.indexOf("req.rawBody = buf");
    const rawBlock = app.slice(app.lastIndexOf('app.use(', rawIdx), rawIdx);
    expect(rawBlock).toContain("'/api/woocommerce/webhook'");
    // rawBody 캡처 파서가 전역 json 파서보다 앞이어야 한다
    expect(rawIdx).toBeLessThan(app.indexOf('app.use(express.json({ limit: LIMITS.requestBodySize }))'));
    expect(app).toContain("app.use('/api/woocommerce', woocommerceRoutes)");
    expect(app).toContain('startWoocommerceSyncWorker()');
  });
  it('register-providers.ts 가 어댑터를 등록한다(부팅 1회 단일 출처) · 어댑터 파일은 스스로 등록하지 않는다', () => {
    expect(code('utils/register-providers.ts')).toContain('registerProvider(woocommerceAdapter)');
    expect(code('utils/woocommerce-adapter.ts')).not.toMatch(/^\s*registerProvider\(/m);
  });
  it('주기 수집 워커가 실존한다 — 없으면 "자동 수집" 이 거짓말이 된다', () => {
    expect(existsSync(resolve(SRC, 'utils/woocommerce-sync-worker.ts'))).toBe(true);
  });
});

describe('W5 — 상품 API 접점(mall-products · 이름 매칭 · AI 자동제작 재조회) 소스 계약', () => {
  it('mall-products: providers 에 우커머스 몰별 탭(woocommerce:{mall}) · search/preview 는 회사 소속 몰만(getWooIntegration) · Store API 공개 조회', () => {
    const r = code('routes/mall-products.ts');
    expect(r).toContain('listWooIntegrations(');
    expect(r).toMatch(/provider: `woocommerce:\$\{/);
    expect(r).toContain("startsWith('woocommerce:')");
    expect(r).toContain('getWooIntegration(');
    expect(r).toContain('fetchWooStoreProducts(');
    expect(r).toContain('fetchWooStoreProductsRaw(');
  });
  it('이름 매칭 CT 가 우커머스 몰을 순회한다(provider 미지정 시 회사의 몰 전부)', () => {
    const r = code('utils/mall-product-match.ts');
    expect(r).toContain('listWooIntegrations(');
    expect(r).toContain('fetchWooStoreProducts(');
  });
  it('AI 자동제작 재조회: woocommerce:{mall} 분기 = 회사 소속 몰 확인 → include 재조회 → 가용성(품절 제외+사유) → 정규화', () => {
    const r = code('utils/campaign-quick.ts');
    const start = r.indexOf('async function lookupMallProductsByNo(');
    const block = r.slice(start, r.indexOf('export function defaultBuildDeps', start));
    expect(block).toContain("startsWith('woocommerce:')");
    expect(block).toContain('getWooIntegration(');
    expect(block).toContain('fetchWooStoreProductsRaw(');
    expect(block).toContain('wooStoreProductAvailability(');
    expect(block).toContain('normalizeWooStoreProduct(');
  });
});
