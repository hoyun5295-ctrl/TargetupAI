/**
 * ★ 2026-09-27 만들기 개편 — 프론트 미리보기 주입 CT · 판정 칩 순수 함수 계약(설계서 §1 불변 4 · §7 프론트).
 *   ① CSP connect-src 'none' 은 <head> 첫 자식이다(비콘보다 먼저 선다) ② 다리 스크립트는 정확히 1개 · 마지막 </body> 앞
 *   ③ 렌더러 출력 본문은 바이트 그대로(더한 것 외 변경 0) ④ 고칠 곳 = 버튼 주소 없음이 사람 말 · must 먼저 · 중복 0
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { guardPreviewHtml, MK_PREVIEW_CSP } from '../../../../frontend/src/utils/make-preview';
import {
  fixItemsOf, fixHeadline, readCardUseNote, dmChipStatus, emailChipStatus, makeResultPath, defaultDmSmsText, blockLabel, dmPaletteItems, isNightAdHour,
} from '../../../../frontend/src/utils/make-flow';

const DOC = '<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>t</title></head><body><div data-section-id="s1">a</div><script>var x=1;</script></body></html>';

describe('guardPreviewHtml', () => {
  it('CSP 가 head 첫 자식 · 스크립트 1개 추가 · 나머지 바이트 그대로', () => {
    const out = guardPreviewHtml(DOC, { tap: true });
    const headAt = out.indexOf('<head>');
    expect(out.slice(headAt + '<head>'.length).startsWith(`<meta http-equiv="Content-Security-Policy" content="${MK_PREVIEW_CSP}">`)).toBe(true);
    expect((out.match(/<script>/g) || []).length).toBe(2); // 원래 1 + 다리 1
    const bridgeAt = out.lastIndexOf('<script>');
    expect(out.slice(bridgeAt).includes('</body></html>')).toBe(true);
    const stripped = out.replace(/<meta http-equiv="Content-Security-Policy"[^>]*>/, '').replace(/<script>\(function\(\)\{[\s\S]*?\}\)\(\);<\/script>/, '');
    expect(stripped).toBe(DOC);
  });
  it('head 없는 조각·빈 값도 안전하다', () => {
    expect(guardPreviewHtml('<p>x</p>')).toMatch(/^<head><meta http-equiv="Content-Security-Policy"/);
    expect(guardPreviewHtml('<html><body>y</body></html>')).toContain('<html><head><meta http-equiv="Content-Security-Policy"');
    expect(guardPreviewHtml('')).toContain('connect-src');
  });
  it('tap 을 끄면 탭 알림을 보내지 않는다(결과 화면 이메일 칸 등)', () => {
    expect(guardPreviewHtml(DOC, { tap: false })).toContain('TAP=false');
    expect(guardPreviewHtml(DOC, { tap: true })).toContain('TAP=true');
  });
  // ★ 2026-09-29 남지현 접수(이메일 미리보기 수신거부 클릭 = 문구 사라짐) — 다리 스크립트가 문법 오류로 한 번도 돌지 않았다
  //   (report() 의 따옴표 이스케이프 누락). 글자 포함 검사는 이것을 못 잡는다 → 실제로 해석·실행한다.
  it('다리 스크립트는 문법 오류 없이 해석되고, 가짜 문서 위에서 링크 이동을 막고 탭을 알린다', () => {
    for (const tap of [false, true]) {
      const out = guardPreviewHtml(DOC, { tap });
      const src = out.slice(out.lastIndexOf('<script>') + '<script>'.length, out.lastIndexOf('</script>'));
      expect(() => new Function(src)).not.toThrow();
      // DOM 라이브러리 없이 최소 가짜 문서로 실제 실행한다(클릭 리스너 · 링크 막기 · 탭 알림 · 선택 자리 보고)
      const docListeners: Record<string, (e: any) => void> = {};
      const sent: any[] = [];
      const section = { style: {} as Record<string, string>, getAttribute: () => 's1', getBoundingClientRect: () => ({ top: 10, height: 20 }) };
      const fakeDoc = {
        addEventListener: (t: string, fn: (e: any) => void) => { docListeners[t] = fn; },
        querySelector: (sel: string) => (sel === '[data-section-id="s1"]' ? section : null),
        querySelectorAll: () => [section],
      };
      const winListeners: Record<string, (e: any) => void> = {};
      const parent = { postMessage: (m: any) => sent.push(m) };
      const fakeWin = { parent, scrollY: 0, addEventListener: (t: string, fn: (e: any) => void) => { winListeners[t] = fn; }, scrollTo: () => {} };
      new Function('window', 'document', src)(fakeWin, fakeDoc);
      expect(sent.some((m) => m.type === 'ready')).toBe(true);
      let prevented = false;
      const link = { closest: (s: string) => (s === 'a[href]' ? {} : s === '[data-section-id]' ? section : null) };
      docListeners.click({ target: link, preventDefault: () => { prevented = true; } });
      expect(prevented).toBe(true);
      expect(sent.some((m) => m.type === 'tap')).toBe(tap);
      winListeners.message({ source: parent, data: { src: 'mk-preview', type: 'select', id: 's1', reveal: false } });
      expect(section.style.outline).toContain('#8b5cf6');
      expect(sent.find((m) => m.type === 'rect' && m.id === 's1')).toMatchObject({ top: 10, height: 20 });
    }
  });
});

describe('고칠 곳 판정', () => {
  const sections = [
    { id: 'h', type: 'hero', props: { image_url: '/x.png', headline: '가을' } },
    { id: 'c', type: 'cta', props: { buttons: [{ label: '보러 가기', url: '' }] } },
  ] as any;
  it('버튼 주소 없음 = must 1건(같은 블록 중복 0) · 사람 말 · 넣기', () => {
    const items = fixItemsOf({ items: [
      { area: 'link', severity: 'fatal', section_id: 'c', message: 'CTA 버튼 1번의 URL이 비어있어요.' },
      { area: 'link', severity: 'fatal', section_id: 'c', message: 'CTA 버튼 2번의 URL이 비어있어요.' },
      { area: 'layout', severity: 'recommend', section_id: 'h', message: '섹션 텍스트가 너무 길어요' },
    ] }, sections);
    expect(items[0]).toMatchObject({ kind: 'must', title: '버튼이 갈 주소가 없어요', sectionId: 'c', action: '넣기' });
    expect(items.filter((i) => i.kind === 'must')).toHaveLength(1);
    expect(items.some((i) => i.kind === 'ok' && i.title === '첫 화면 사진 있음')).toBe(true);
    expect(items.some((i) => i.title === '버튼 주소 넣음')).toBe(false);
    expect(fixHeadline(items)).toMatchObject({ tone: 'warn', count: 1 });
  });
  it('치명 0 = 보낼 준비 · 버튼 주소 넣음', () => {
    const items = fixItemsOf({ items: [] }, sections);
    expect(fixHeadline(items).tone).toBe('good');
    expect(items.some((i) => i.title === '버튼 주소 넣음')).toBe(true);
  });
});

// ★ 2026-09-27 Codex 2R — 보내기 창 [링크만 받기]는 첫 발행 규칙 견적(via=publish)으로만 판단한다(발송용 견적 재사용 = 확인 없는 차감)
describe('보내기 창 발행비 견적 배선', () => {
  it('발송 = via=send · 링크만 받기 = via=publish · 링크 견적을 모르면 막는다', () => {
    const src = readFileSync(resolve(__dirname, '../../../../frontend/src/components/make/MakeSendModal.tsx'), 'utf-8');
    expect(src).toContain('/publish-quote?via=send');
    expect(src).toContain('/publish-quote?via=publish');
    const link = src.slice(src.indexOf('const onLinkClick = () => {'), src.indexOf('const bubble = useMemo('));
    expect(link).toContain('if (!linkQuote)');
    expect(link).toContain('if (linkQuote.required)');
    expect(link).not.toMatch(/\bquote\?\.required|\bif \(!quote\)/);
  });
});

// ★ 2026-09-27 Codex 3R — [링크만 받기]는 화면이 확인한 금액(expected_fee)을 싣고, 서버는 지금 금액이 더 크면 차감 전에 402 로 멈춘다
describe('링크 발행 승인 금액 대조', () => {
  it('서버 /publish: expected_fee 대조가 checkCredit·publishDm·차감보다 먼저 · 크레딧제 조회는 strict · 대조 결과(chargeNow)를 차감까지 그대로', () => {
    const dm = readFileSync(resolve(__dirname, '../../routes/dm.ts'), 'utf-8');
    const body = dm.slice(dm.indexOf("const { source: costSource, cost: pubCost } = await dmPublishFeeSourceOf(companyId, req.params.id);"));
    const route = body.slice(0, body.indexOf("return res.status(500).json({ error: '서버 오류' });"));
    const iOn = route.indexOf('const creditOn = await isCreditEnabledStrict(companyId);');
    const iGuard = route.indexOf('if (creditOn && pubCost > expectedFee) {');
    expect(iOn).toBeGreaterThan(0);
    expect(iGuard).toBeGreaterThan(iOn);
    expect(route.slice(iGuard, iGuard + 300)).toContain("code: 'PUBLISH_FEE_REQUIRED'");
    expect(route).toContain('chargeNow = creditOn;');
    expect(iGuard).toBeLessThan(route.indexOf('if (chargeNow) await checkCredit(companyId, pubCost);'));
    expect(iGuard).toBeLessThan(route.indexOf('await publishDm(req.params.id, companyId)'));
    // 차감은 대조 때 정한 chargeNow 로만(firstPublish 로 다시 정하지 않는다)
    expect(route).toContain('if (chargeNow) {\n      await deductCreditSafe({');
    expect(route).not.toMatch(/if \(firstPublish\) \{\s*await deductCreditSafe/);
  });
  it('보내기 창: 링크 발행에 expected_fee · 402 = 확인 창 · 성공 뒤 서버 견적 다시 받기(임의 required=false 0)', () => {
    const src = readFileSync(resolve(__dirname, '../../../../frontend/src/components/make/MakeSendModal.tsx'), 'utf-8');
    const pub = src.slice(src.indexOf('const publishLink = useCallback('), src.indexOf('const onLinkClick = () => {'));
    expect(pub).toContain('JSON.stringify({ expected_fee: expectedFee })');
    expect(pub).toContain("d?.code === 'PUBLISH_FEE_REQUIRED'");
    expect(pub).toContain("setFeeFor('link')");
    expect(pub).toContain('await reloadQuotes()');
    expect(pub).not.toMatch(/required: false/);
    expect(src).toContain('void publishLink(linkQuote?.required ? linkQuote.cost : 0)');
  });
});

// ★ 2026-09-27 Codex 3R~12R 결론 — 읽어 온 카드 면허 = 담당자 체크(기본 꺼짐). 서버 추측 판정 0.
describe('주소 읽기 카드 면허 배선', () => {
  it('만들기 화면: 카드 면허 = "그대로 쓰기" 체크 집합(기본 빈 집합 · 새로 읽으면 비운다) · 서버 추측 필드 0', () => {
    const page = readFileSync(resolve(__dirname, '../../../../frontend/src/pages/QuickCampaignPage.tsx'), 'utf-8');
    expect(page).toContain('const [onCards, setOnCards] = useState<Set<string>>(new Set());');
    expect(page).toContain('licensed: onCards.has(c.id), images: imgs, readId: read.readId');
    expect(page).toContain('setOffCards(new Set()); setOnCards(new Set());');
    expect(page).not.toMatch(/licensable/);
    const inputs = readFileSync(resolve(__dirname, '../../../../frontend/src/components/make/MakeInputs.tsx'), 'utf-8');
    const card = inputs.slice(inputs.indexOf('export function ReadMaterialsCard('), inputs.indexOf('// ─────────────── 사진·글 판 ───────────────'));
    expect(card).toContain('checked={c.licensed}');
    expect(card).toContain('onChange={(e) => onLicensed(c.id, e.target.checked)}');
    expect(card).toContain('이 문구 그대로 쓰기');
  });
});

describe('기타 순수 함수', () => {
  it('주소 읽기 카드 안내 = 체크 상태 + 페이지에 적힌 기간 줄 그대로(해석 0)', () => {
    expect(readCardUseNote({ licensed: true, periodRaw: '2026.10.01 ~ 2026.10.10' })).toEqual({ tone: 'ok', text: '할인율·기간을 적힌 그대로 실어요 · 페이지 기간 2026.10.01 ~ 2026.10.10' });
    expect(readCardUseNote({ licensed: false, periodRaw: null })).toEqual({ tone: 'plain', text: '숫자는 빼고 실어요' });
  });
  it('칩 상태 · 결과 주소 · 문자 기본 문안(AI 0) · 야간', () => {
    expect(dmChipStatus({ status: 'stopped', short_code: 'x' })).toBe('stopped');
    expect(dmChipStatus({ status: 'draft' })).toBe('draft');
    expect(dmChipStatus({ status: 'published' })).toBe('sent');
    expect(emailChipStatus({ status: 'failed' })).toBe('failed');
    expect(makeResultPath('dm', 'a1', 'b2')).toBe('/quick-campaign/result?channel=dm&draft=a1&pair=b2');
    expect(defaultDmSmsText({ brand: '하루온', title: '가을 신상', sub: '' })).toBe('[하루온] 가을 신상\n▶ 자세히 보기 %DM링크%');
    expect(isNightAdHour(new Date(2026, 8, 27, 21, 0))).toBe(true);
    expect(isNightAdHour(new Date(2026, 8, 27, 8, 0))).toBe(false);
  });
  it('블록 이름 · 팔레트(참여형은 한 칸으로 묶는다)', () => {
    expect(blockLabel({ type: 'hero', props: {} } as any)).toBe('첫 화면');
    expect(blockLabel({ type: 'cta', props: { buttons: [{ style: 'outline' }] } } as any)).toBe('링크 칩');
    const p = dmPaletteItems();
    expect(p.main.some((i) => i.interaction)).toBe(false);
    expect(p.interaction.every((i) => i.interaction)).toBe(true);
  });
});
