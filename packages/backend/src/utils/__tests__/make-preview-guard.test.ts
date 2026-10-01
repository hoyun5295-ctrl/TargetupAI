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
import { catalogPagesOf } from '../dm/dm-catalog-pages';
import { validateDm } from '../dm/dm-validate';

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

  // ★ 2026-10-01 박성용 접수(카탈로그 · footer 섹션 필수로 다음으로 못 넘어감) — 잠금 수 = 서버 발행 관문이 막는 수
  it('카탈로그 DM(실제 서버 검수 결과) = 잠금 0 · 보낼 수 있음 · 갈 곳 없는 [고치기] 없음', async () => {
    const pages = catalogPagesOf(Array.from({ length: 34 }, (_, i) => ({ url: `/api/dm/images/c1/cat-${i + 1}.jpg` })));
    const flat = pages.flatMap((p) => p.sections) as any;
    const v = await validateDm({ sections: flat, publish_mode: 'now' });
    expect(v.stats).toMatchObject({ fatal: 1, blocking: 0 });
    const items = fixItemsOf(v as any, flat);
    expect(items.filter((i) => i.kind === 'must')).toHaveLength(0);
    expect(fixHeadline(items).count).toBe(v.stats.blocking);
    expect(fixHeadline(items).tone).toBe('plain');
    const row = items.find((i) => i.title === '맨 아래 회사 정보 블록이 없어요');
    expect(row).toMatchObject({ kind: 'suggest' });
    expect(row?.sub).toContain('그대로 보낼 수 있어요');
    expect(row?.action).toBeUndefined();
    expect(items.every((i) => !i.action || !!i.sectionId)).toBe(true);
    expect(items.some((i) => /Footer 섹션/.test(i.title))).toBe(false);
  });
  it('넘길 수 없는 치명만 잠금 · 블록이 있는 넘길 수 있는 줄은 [고치기] 권고 · 잠금 줄이 먼저', () => {
    const v = { items: [
      { area: 'required_info', severity: 'fatal', overridable: true, message: 'Footer 섹션이 없어요. 고객센터/수신거부 정보 노출 의무를 위해 필수예요.' },
      { area: 'required_info', severity: 'fatal', overridable: true, section_id: 'f', message: '수신거부 링크가 숨김 상태예요. 광고성 메시지는 수신거부 링크 노출이 의무예요.' },
      { area: 'countdown', severity: 'fatal', section_id: 'k', message: '카운트다운 종료 일시가 이미 지나갔어요.', fix_suggestion: '미래 시점으로 다시 설정해 주세요.' },
      { area: 'layout', severity: 'fatal', message: '섹션이 하나도 없어요. 최소 1개 이상 추가해 주세요.' },
    ] } as any;
    const items = fixItemsOf(v, sections);
    const must = items.filter((i) => i.kind === 'must');
    expect(must.map((i) => i.title)).toEqual(['카운트다운 종료 일시가 이미 지나갔어요.', '섹션이 하나도 없어요. 최소 1개 이상 추가해 주세요.']);
    expect(fixHeadline(items)).toMatchObject({ tone: 'warn', count: 2 });
    expect(items.slice(0, 2).every((i) => i.kind === 'must')).toBe(true);
    expect(items.find((i) => i.sectionId === 'f')).toMatchObject({ kind: 'suggest', action: '고치기', title: '수신거부 링크가 숨김 상태예요. 광고성 메시지는 수신거부 링크 노출이 의무예요.', sub: '확인하고 그대로 보낼 수 있어요' });
    // 넘길 수 있는 항목이 남아 있으면 「회사 정보 · 수신거부 안내 있음」을 말하지 않는다
    expect(items.some((i) => i.title === '회사 정보 · 수신거부 안내 있음')).toBe(false);
  });
});

/**
 * ★ 2026-10-01 카탈로그 DM 전수점검(박성용 접수 · Harold 「뿌리를 뽑아」) — 결과 화면이 카탈로그를 일반 DM 으로 다루던 자리(소스 계약).
 *   헤드리스 실측(빌드본 · 실제 서버 검수·뷰어 출력)으로 확인한 8항목 가운데, 다시 생기면 안 되는 배선만 고정한다.
 */
describe('결과 화면 · 수정 화면의 카탈로그 배선', () => {
  const read = (rel: string) => readFileSync(resolve(__dirname, '../../../../frontend/src', rel), 'utf8');
  const page = read('pages/QuickCampaignResultPage.tsx');
  it('카탈로그 판정 = 수정 화면과 같은 값(스토어 보기 방식)', () => {
    expect(page).toContain("layoutMode === 'slides' && catalogView");
    expect(read('components/make/DmEditScreen.tsx')).toContain("s.layoutMode === 'slides' && s.catalogView");
  });
  it('다시 만들기 · 재료 다시 보기는 만든 채널로 가고 금액은 원장 키로 적는다', () => {
    expect(page).not.toContain('quick-campaign?channel=${channel}');
    expect(page.match(/quick-campaign\?channel=\$\{makeChannel\}/g)).toHaveLength(2);
    expect(page).toContain("isCatalog ? 'catalog-dm-build' : 'dm-ai-generate'");
    expect(read('pages/DmBuilderPage.tsx')).toContain("buildBar.channel === 'catalog' ? 'catalog' : 'dm'");
    expect(read('pages/DmBuilderPage.tsx')).not.toContain("navigate('/quick-campaign?channel=dm&regen=1')");
  });
  it('카탈로그는 다른 채널 1클릭을 권하지 않고 PC 책 미리보기를 보여 준다 · 쪽을 눌러도 일반 편집 창을 띄우지 않는다', () => {
    expect(page).toContain('const canMakeOther = draftFits && !isCatalog;');
    expect(page).toContain('<PcPanel kind="catalog"');
    expect(page).toContain("onTap={channel === 'dm' && !isCatalog ?");
    expect(page).toContain("{sheetOpen && channel === 'dm' && !isCatalog && selected && (");
    expect(page).toContain('makeOther={canMakeOther ?');
  });
  it('보내기 안내 글은 머리 띠 안에 둔다(띠 밖으로 내려 걸지 않는다) · 잠금 알림은 겹쳐 쌓지 않는다', () => {
    expect(page).not.toContain('top-full mt-1 whitespace-nowrap');
    expect(page).toContain('data-make="lock-hint"');
    expect(page).toContain('lockToastAt.current');
  });
  it('수정 화면 쪽 패널에 [이 쪽 빼기] — 저장소의 쪽 빼기를 쓰고 되돌릴 수 있게 남긴다 · 책 최소 쪽 수 아래로는 막는다', () => {
    const edit = read('components/make/DmEditScreen.tsx');
    expect(edit).toContain('data-make="catalog-remove-page"');
    expect(edit).toMatch(/st\.pushHistory\(\);\s*st\.removePage\(idx\);/);
    expect(edit).toContain('const CATALOG_MIN_PAGES = 2;');
    expect(edit).toContain('st.pages.length <= CATALOG_MIN_PAGES');
    // 뷰어 판정(2쪽 미만 = 책 아님)과 같은 수
    expect(readFileSync(resolve(__dirname, '../dm/dm-viewer-catalog.ts'), 'utf8')).toContain('pages.length < 2');
  });
  it('보내기 창은 만들 버튼이 없을 때 「같은 재료로 바로」를 말하지 않는다', () => {
    expect(read('components/make/MakeSendModal.tsx')).toContain("makeOther && makeOther.channel === other ? '아직 만들지 않았어요 · 같은 재료로 바로 만들 수 있어요' : '아직 만들지 않았어요'");
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
