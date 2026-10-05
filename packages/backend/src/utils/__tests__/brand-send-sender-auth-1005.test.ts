/**
 * ★1005 브랜드메시지 발신 인증 (전송자격인증 3.5 · Harold 결정 D-9)
 *
 * 못 박는 것:
 *   1. `/brand-send` 가 직접발송과 같은 게이트(checkSenderAuthGate)를 캠페인 생성 앞에서 세우고, 걸리면 403 인증 요구를 돌려준다.
 *   2. 화면(Dashboard 브랜드 발송)이 그 응답을 받으면 인증 창을 띄우고 같은 발송을 다시 실행한다.
 *   3. 인증 창이 브랜드메시지 창(body 포털 · 겹침 2000) 위에 뜬다.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const read = (p: string) => readFileSync(resolve(__dirname, p), 'utf8');

describe('브랜드메시지 발신 인증', () => {
  it('서버 — 캠페인 생성 앞에서 게이트를 세우고 걸리면 인증 요구로 돌려준다', () => {
    const src = read('../../routes/campaigns.ts');
    const start = src.indexOf("router.post('/brand-send'");
    expect(start).toBeGreaterThan(-1);
    const body = src.slice(start, src.indexOf('\nrouter.', start + 1));
    const gate = body.indexOf('checkSenderAuthGate(');
    const insert = body.indexOf('INSERT INTO campaigns');
    expect(gate, '게이트 호출이 없다').toBeGreaterThan(-1);
    expect(insert).toBeGreaterThan(-1);
    expect(gate, '게이트가 캠페인 생성 뒤에 있다').toBeLessThan(insert);
    expect(body).toMatch(/if \(!brandSenderGate\.ok\) return res\.status\(403\)\.json\(senderAuthRejection\(brandSenderGate\)\)/);
  });

  it('화면 — 인증 요구를 받으면 창을 띄우고 같은 발송을 다시 실행한다(실패 처리보다 먼저)', () => {
    const src = read('../../../../frontend/src/pages/Dashboard.tsx');
    const start = src.indexOf("fetch('/api/campaigns/brand-send'");
    expect(start).toBeGreaterThan(-1);
    const seg = src.slice(start, start + 1200);
    const handle = seg.indexOf('senderAuth.handleResponse(data, () => { void sendBrand(payload); })');
    const fail = seg.indexOf("throw new Error(data?.error || '브랜드메시지 발송 실패')");
    expect(handle, '인증 요구 처리가 없다').toBeGreaterThan(-1);
    expect(handle, '실패 처리가 먼저 던진다').toBeLessThan(fail);
    expect(src).toMatch(/onSend=\{async function sendBrand\(payload: any\)/);
  });

  it('화면 — 인증 창이 브랜드메시지 창(2000) 위 층에 body 포털로 뜬다', () => {
    const src = read('../../../../frontend/src/pages/Dashboard.tsx');
    expect(src).toMatch(/senderAuthState && createPortal\(\s*<div style=\{\{ position: 'relative', zIndex: 2100 \}\}>\s*<SenderAuthModal/);
    const modal = read('../../../../frontend/src/components/BrandSendModal.tsx');
    expect(modal).toMatch(/zIndex: 2000/);
  });
});
