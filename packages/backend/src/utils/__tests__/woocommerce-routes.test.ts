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

describe('routes/woocommerce.ts — 인증 라우트(★0918 권한 CT 경유 · 설계서 docs/2026-09-18-mall-integration-user-scope-design.md §3-5)', () => {
  const route = () => code('routes/woocommerce.ts');
  it('자격 저장·연결·해제·secret 재발급은 권한 CT(resolveIntegrationActor) 하나로 판정 · 요금제 게이트 · 회사 식별자는 세션에서만', () => {
    const r = route();
    expect(r).toContain('resolveIntegrationActor(');
    expect(r).not.toContain('function gateAdmin');
    expect(r).not.toContain("userType !== 'company_admin'");
    expect(r).toContain('isCdpEnabledForPlan(');
    expect(r).not.toMatch(/req\.(body|query|params)\??\.\.?(companyId|company_id)/);
    for (const p of ["'/credentials'", "'/connect'", "'/status'", "'/disconnect'", "'/rotate-secret'"]) expect(r).toContain(p);
  });
  it('★0918 분류코드는 본문이 아니라 권한 CT 가 정한다 — 본문 store_code 는 pickStoreCodeForConnect 의 선택지로만 · 저장 함수에 직접 흐르지 않는다', () => {
    const r = route();
    expect(r).toMatch(/pickStoreCodeForConnect\(actor, req\.body\?\.store_code\)/);
    expect(r).not.toMatch(/saveWooCredentials\([\s\S]{0,400}req\.body\?\.store_code/);
    expect(r).not.toMatch(/storeCode:\s*req\.body/);
  });
  it('★0918 몰 소유 = canTouchIntegration — 연결·해제·secret 재발급 전 확인 · 남의 분류코드 몰은 409/403 코드로 · 연결된 몰의 분류코드 변경은 지원하지 않는다', () => {
    const r = route();
    const block = (from: string, to: string) => r.slice(r.indexOf(from), r.indexOf(to));
    // 변경 라우트 셋(연결 · secret 재발급 · 해제)은 몰을 읽은 뒤 소유 게이트를 지난다
    expect(block("'/connect'", "'/connect-url'")).toMatch(/getWooIntegration\([\s\S]{0,300}gateMall\(res, actor, integ\.storeCode\)/);
    expect(block("'/rotate-secret'", "'/status'")).toMatch(/getWooIntegration\([\s\S]{0,200}gateMall\(res, actor, owned\.storeCode\)/);
    expect(block("'/disconnect'", 'export default')).toMatch(/getWooIntegration\([\s\S]{0,200}gateMall\(res, actor, owned\.storeCode\)/);
    // 저장 계열(자격 저장 · 1클릭 시작)은 기존 행의 소유·변경 규칙을 decideStoreCode 로 지난다
    expect(block("'/credentials'", "'/connect'")).toContain('decideStoreCode(');
    expect(block("'/connect-url'", "'/rotate-secret'")).toContain('decideStoreCode(');
    expect(r).toContain("'MALL_OWNED_BY_OTHER_STORE'");
    expect(r).toContain("'STORE_CODE_CHANGE_NOT_SUPPORTED'");
    // 기존 행에는 storeCode 를 덮어쓰지 않는다(undefined 로 저장)
    expect(r).toMatch(/storeCode: existing \? undefined : pick\.storeCode/);
  });
  it('★0918 잠금 사유 문장은 CT(integrationLockMessage)가 소유 — 라우트에 관리자 한정 문구를 손으로 적지 않는다', () => {
    const r = route();
    expect(r).toContain('integrationLockMessage(');
    expect(r).not.toContain('우커머스 연동은 회사 관리자만 가능합니다.');
  });
  it('★0918 /status 는 주체 범위로 몰을 거르고(사용자 = 자기 분류코드 몰만) 화면이 계산하지 않도록 can_connect · lock_reason · connect_store_codes · store_code_options 를 내려 준다', () => {
    const r = route();
    const block = r.slice(r.indexOf("'/status'"), r.indexOf("'/disconnect'"));
    expect(block).toContain('resolveIntegrationActor(');
    expect(block).toContain('canTouchIntegration(');
    for (const k of ['can_connect', 'lock_reason', 'lock_message', 'connect_store_codes', 'store_code_options']) expect(block).toContain(k);
    expect(block).toContain('listCompanyStoreCodes(');
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

describe('① 1클릭 연결 라우트 — connect-url(관리자) · auth-callback(공개 · 우커머스 서버가 POST) · auth-return(공개 · 브라우저) · plugin.zip', () => {
  const route = () => code('routes/woocommerce.ts');
  it('공개 라우트(auth-callback · auth-return · plugin.zip)는 authenticate 앞에 있다', () => {
    const r = route();
    const auth = r.indexOf('router.use(authenticate)');
    for (const p of ["'/auth-callback'", "'/auth-return'", "'/plugin.zip'"]) {
      expect(r.indexOf(p), p).toBeGreaterThan(-1);
      expect(r.indexOf(p), `${p} 가 authenticate 뒤에 있다`).toBeLessThan(auth);
    }
    expect(r.indexOf("'/connect-url'")).toBeGreaterThan(auth);
  });
  it('connect-url: 몰 저장(pending) → 서명 state + 1회용 state 행(oauth_state) → authorize_url(몰 식별자로만 만든다 · 입력 URL 그대로 리다이렉트 금지)', () => {
    const r = route();
    const block = r.slice(r.indexOf("'/connect-url'"), r.indexOf("'/rotate-secret'"));
    expect(block).toContain('saveWooCredentials(');
    expect(block).toContain('signWooAuthState(');
    expect(block).toContain("'oauth_state'");
    expect(block).toContain('buildWooAuthorizeUrl(integ.siteUrl');
    expect(block).toContain('authorize_url:');
  });
  it('auth-callback: state 서명 검증 → 1회용 행 삭제 → 키 저장 → 즉시 200 → 뒤에 검증 1콜·웹훅 4개 생성·백필(백그라운드)', () => {
    const r = route();
    const block = r.slice(r.indexOf("'/auth-callback'"), r.indexOf("'/auth-return'"));
    expect(block).toContain('verifyWooAuthState(');
    expect(block).toContain('DELETE FROM cdp_webhook_deliveries');
    expect(block).toContain('saveWooRestKeysFromAuth(');
    const respond = block.indexOf('res.json({ success: true');
    expect(respond).toBeGreaterThan(block.indexOf('saveWooRestKeysFromAuth('));
    expect(block.indexOf('verifyWooConnection(')).toBeGreaterThan(respond);
    expect(block.indexOf('ensureWooWebhooks(')).toBeGreaterThan(block.indexOf('verifyWooConnection('));
    expect(block.indexOf('backfillWooCustomers(')).toBeGreaterThan(block.indexOf('ensureWooWebhooks('));
    expect(block).toContain('recordWooSetupError(');
    // 검증 실패 state 는 400 · 위조된 콜백이 키를 꽂지 못한다
    expect(block).toMatch(/status\(400\)/);
  });
  it('auth-return: DB 쓰기 없이 서명만 보고 HTML(부모 창에 postMessage · 자동 닫기) · success=0 은 취소 안내', () => {
    const r = route();
    const block = r.slice(r.indexOf("'/auth-return'"), r.indexOf("'/plugin.zip'"));
    expect(block).not.toMatch(/INSERT|UPDATE|DELETE/);
    expect(block).toContain('renderWooReturnHtml(');
    expect(r).toContain('postMessage');
    expect(r).toContain("hanjullo:woocommerce");
    expect(block).toMatch(/취소/);
  });
  it('plugin.zip: 저장 zip 작성기로 wp-plugin 폴더를 묶어 application/zip 으로 준다(비밀 없음 · 캐시)', () => {
    const r = route();
    expect(r).toContain('buildWooPluginZip(');
    expect(r).toContain("'application/zip'");
  });
  it('disconnect 는 몰의 웹훅을 먼저 지우려 시도한다(실패해도 해제는 진행)', () => {
    const r = route();
    const block = r.slice(r.indexOf("'/disconnect'"), r.indexOf('export default router'));
    expect(block.indexOf('removeWooWebhooks(')).toBeLessThan(block.indexOf('disconnectWoo('));
  });
});

describe('② 플러그인 — wp-plugin/hanjullo-woocommerce 소스 계약', () => {
  const PLUGIN = resolve(SRC, '..', 'wp-plugin', 'hanjullo-woocommerce');
  const php = () => readFileSync(resolve(PLUGIN, 'hanjullo-woocommerce.php'), 'utf-8');
  it('플러그인 헤더 · 직접 접근 차단 · 설정 화면 · head 스크립트 · 회원 식별 · REST 수신동의 노출 필터 2종', () => {
    const p = php();
    expect(p).toMatch(/^\s*<\?php/);
    expect(p).toMatch(/Plugin Name:\s*한줄로/);
    expect(p).toContain("defined( 'ABSPATH' ) || exit");
    expect(p).toContain("add_action( 'wp_head'");
    expect(p).toContain("add_action( 'wp_footer'");
    expect(p).toContain('data-hjl-key=');
    expect(p).toContain('window.hjl.identify(');
    expect(p).toContain("add_filter( 'woocommerce_rest_prepare_customer'");
    expect(p).toContain("add_filter( 'woocommerce_rest_prepare_shop_order_object'");
    expect(p).toContain('mssms_agreement');
    expect(p).toContain("add_action( 'admin_menu'");
  });
  it('SDK 경로·버전은 서버(cdp-sdk-script 와 같은 값)를 쓰고 · 모델명·서버 IP·비밀값이 없다', () => {
    const p = php();
    expect(p).toMatch(/https:\/\/app\.hanjul\.ai\/api\/cdp\/sdk\/v\d+\.\d+\.\d+\/hanjul\.min\.js/);
    expect(p).not.toMatch(/Opus|Sonnet|Haiku|GPT|Claude|Anthropic/);
    expect(p).not.toMatch(/\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/);
    expect(p).not.toMatch(/consumer_secret|webhook_secret/);
    // 출력 이스케이프
    expect(p).toContain('esc_attr(');
    expect(p).toContain('esc_url(');
  });
  it('readme.txt 가 있고 플러그인 폴더 파일이 zip 작성기 입력이 된다(routes 가 buildWooPluginZip 을 부른다)', () => {
    expect(existsSync(resolve(PLUGIN, 'readme.txt'))).toBe(true);
    expect(code('utils/woocommerce-plugin-zip.ts')).toContain('buildStoredZip(');
  });
});
