/**
 * mall-user-scope-routes.test.ts — 몰별 사용자 범위의 배선 소스 계약 (설계서 docs/2026-09-18-mall-integration-user-scope-design.md §3-4 · §3-5 · §4)
 *  라우트 층은 DB·네트워크 0 소스 계약으로 고정한다(선례 woocommerce-routes.test.ts).
 *  - 브라우저 수집(/api/cdp/ingest): 검증된 Origin 으로 분류코드를 찾아 배치에 싣는다(요청 본문 값 금지).
 *  - 상품 피커(mall-products): 사용자는 자기 분류코드의 우커머스 몰만 탭·조회한다.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const SRC = resolve(__dirname, '..', '..');
const code = (rel: string) => readFileSync(resolve(SRC, rel), 'utf-8').replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ');

describe('routes/cdp.ts — /ingest 의 분류코드는 Origin 에서', () => {
  it('resolveStoreCodeByOriginHost(companyId, Origin 헤더) → ingestBrowserEvents 배치의 storeCode · 본문에서 읽지 않는다', () => {
    const r = code('routes/cdp.ts');
    const block = r.slice(r.indexOf("router.post('/ingest'"), r.indexOf("router.post('/identify'"));
    expect(block).toMatch(/resolveStoreCodeByOriginHost\(companyId, [^)]*origin/);
    expect(block).toMatch(/ingestBrowserEvents\(companyId, \{[\s\S]{0,400}storeCode/);
    expect(block).not.toMatch(/req\.body\??\.store_code|req\.body\??\.storeCode/);
  });
});

describe('frontend — 우커머스 폼은 서버 값으로만 잠근다(화면이 권한을 계산하지 않는다 · 프론트에 테스트 파일이 없어 여기서 소스로 고정)', () => {
  const FRONT = resolve(SRC, '..', '..', 'frontend', 'src');
  const front = (rel: string) => readFileSync(resolve(FRONT, rel), 'utf-8').replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ');
  it('CdpWooConnectForm: 버튼 잠금 = 서버 can_connect · 잠금 사유 = 서버 문장 · 분류 코드 칸 · 옛 관리자 한정 문구 0', () => {
    const r = front('components/cdp/CdpConnectForms.tsx');
    const woo = r.slice(r.indexOf('export function CdpWooConnectForm'));
    expect(woo).not.toContain('!p.isAdmin');
    expect(woo).not.toContain('NOT_ADMIN_NOTE');
    expect(woo).toContain('!p.canConnect');
    expect(woo).toContain('p.lockMessage');
    expect(woo).toContain('분류 코드');
    expect(woo).not.toMatch(/>[^<]*store_code[^<]*</); // 화면 문구(JSX 텍스트)에 내부 낱말 0 · 키 이름은 코드에서만
    // 나머지 5개 폼(카페24·네이버·메이크샵·아임웹·고도몰)은 이번 범위 밖 = 관리자 한정 그대로
    const others = r.slice(0, r.indexOf('export function CdpWooConnectForm'));
    expect((others.match(/!p\.isAdmin/g) || []).length).toBeGreaterThanOrEqual(5);
  });
  it('CdpSettingsPage: 연결 요청 본문에 고른 분류 코드(store_code)를 싣고, 폼에는 서버 상태 값을 그대로 넘긴다', () => {
    const r = front('pages/CdpSettingsPage.tsx');
    const connectUrl = r.slice(r.indexOf("'/api/woocommerce/connect-url'"), r.indexOf("'/api/woocommerce/credentials'"));
    const credentials = r.slice(r.indexOf("'/api/woocommerce/credentials'"), r.indexOf("'/api/woocommerce/connect'"));
    expect(connectUrl).toContain('store_code:');
    expect(credentials).toContain('store_code:');
    const wiring = r.slice(r.indexOf('<CdpWooConnectForm'), r.indexOf('/>', r.indexOf('<CdpWooConnectForm')));
    for (const k of ['canConnect=', 'lockMessage=', 'storeCodeOptions=', 'connectStoreCodes=', 'storeCode=', 'onStoreCodeChange=']) expect(wiring).toContain(k);
  });
});

describe('routes/mall-products.ts — 사용자 범위', () => {
  it('providers 목록과 몰 조회(wooMallOf)가 권한 CT 로 자기 분류코드 몰만 통과시킨다', () => {
    const r = code('routes/mall-products.ts');
    expect(r).toContain('resolveIntegrationActor(');
    expect(r).toContain('canTouchIntegration(');
    const providers = r.slice(r.indexOf("'/providers'"), r.indexOf("'/preview'"));
    expect(providers).toMatch(/canTouchIntegration\(actor, m\.storeCode\)/);
    const helper = r.slice(r.indexOf('async function wooMallOf'), r.indexOf('export const mallProductsRouter'));
    expect(helper).toContain('canTouchIntegration(');
  });
});
