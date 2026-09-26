/**
 * AI 다듬기 변형 = 일시정지로 만들고 사용자가 검토해 켠다 (★2026-09-26 한줄로 V2 R1-45 · Harold 결정 「일시정지로 생성」)
 *
 * 옛: AI가 만든 변형 3건이 검토 없이 status='active'로 바로 방문자에게 노출됐다(승자 자동 선택까지).
 * 처방: ①AI 다듬기가 만든 변형은 'paused'(노출 선택은 켜진 변형만 본다 · 수동 생성은 종전처럼 켜짐)
 *   ②변형 켜기·끄기 = /inapp/variant action 'set_status'(변형 행만 · 부모·회사 확인 · 과금 없음 = 변형 생성도 무료)
 *   ③인앱 화면에 변형 검토 창(다듬기 직후 열림 · 메시지에서 다시 열 수 있음) — 화면이 변형을 목록에서 숨기므로 켤 길이 있어야 한다.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const optimizer = readFileSync(join(__dirname, '..', 'inapp-variant-optimizer.ts'), 'utf8');
const quick = readFileSync(join(__dirname, '..', 'inapp-quick-action.ts'), 'utf8');
const cdp = readFileSync(join(__dirname, '..', '..', 'routes', 'cdp.ts'), 'utf8');
const page = readFileSync(join(__dirname, '..', '..', '..', '..', 'frontend', 'src', 'pages', 'InAppMessagesPage.tsx'), 'utf8');

describe('변형 상태', () => {
  it('생성 CT가 상태를 받는다(기본 active = 수동 생성 종전)', () => {
    expect(optimizer).toContain("status?: 'active' | 'paused';");
    expect(optimizer).toContain("input.status === 'paused' ? 'paused' : 'active',");
    expect(optimizer).not.toMatch(/\$20, \$21, 'active',/);
  });
  it('AI 다듬기는 일시정지로 만든다', () => {
    expect(quick).toContain("status: 'paused',");
  });
  it('켜기·끄기 = 변형 행만 · 과금 없음', () => {
    const r = cdp.slice(cdp.indexOf("router.post('/inapp/variant'"), cdp.indexOf("router.post('/inapp/upload-image'"));
    expect(r).toContain("action === 'set_status'");
    expect(r).toContain('await setVariantStatus(auth.companyId, String(parent_message_id)');
    expect(r).not.toContain('deductCredit');
    expect(optimizer).toContain('export async function setVariantStatus(');
    expect(optimizer).toContain('AND parent_message_id = $3::uuid');
  });
  it('화면: 다듬기 뒤 변형 검토 창 · 메시지에서 다시 열기', () => {
    expect(page).toContain('<VariantReviewModal');
    expect(page).toContain("action: 'set_status'");
  });
});
