/**
 * 이미지 스튜디오 개편 1016 — 템플릿 고르기 하나로 · 만든 포스터를 채널로 바로
 * 설계서 = docs/2026-10-16-image-studio-picker-channel-design.md
 *
 * 못 박는 것:
 *   1. 문구 자동 채움 = 비어 있거나 직전 자동값 그대로인 칸만 바꾼다(사람 값 · 블록 문구 보존) — frontend/src/lib/studio-texts.ts
 *   2. /save 409 두 코드를 한 함수가 가른다(STORAGE_FULL · ALREADY_SAVED → 라이브러리에서 찾기 · 못 찾으면 만료) — frontend/src/lib/studio-api.ts
 *   3. /save 를 부르는 화면은 그 함수 하나를 지난다(같은 응답 코드를 받는 창 전수 · LESSONS_FRONTEND)
 *   4. 스튜디오는 고르기 부품을 언마운트하지 않는다(보던 쪽 유지 · Harold 0811) · 창은 첫 장 자동 선택이 없다(Harold 1016)
 *   5. 인앱 채널 = 관리자만 · 겹친 창 Esc 가 부모까지 닫지 않는다 · /templates 업종 칸
 * 프론트에 테스트 러너가 없어 순수 함수는 직접 import 하고, 배선은 소스 계약으로 고정한다(선례 auth-object-url.test.ts · dm-blocks-contract.test.ts).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { applyAutoTexts, autoStudioTexts, fillStudioTokens, EMPTY_STUDIO_TEXTS } from '../../../../frontend/src/lib/studio-texts';
import { saveStudioTemp, findSavedStudioAsset } from '../../../../frontend/src/lib/studio-api';

const FRONT = resolve(__dirname, '..', '..', '..', '..', 'frontend', 'src');
const front = (p: string) => readFileSync(join(FRONT, p), 'utf8');
const back = (p: string) => readFileSync(resolve(__dirname, '..', '..', p), 'utf8');

describe('1. 문구 자동 채움 규칙', () => {
  const tpl = { label: 'ONLINE EXCLUSIVE', title: '{productName}', subtitle: '{salePrice}' };
  it('토큰 = 연동 몰 실데이터 · 상품이 없으면 빈칸', () => {
    expect(fillStudioTokens('{productName} 출시', { name: '수분 크림' })).toBe('수분 크림 출시');
    expect(fillStudioTokens('{salePrice}', { name: 'x', salePrice: 12000 })).toBe('12,000원');
    expect(fillStudioTokens('{productName}{salePrice}', null)).toBe('');
    expect(autoStudioTexts(tpl, null)).toEqual({ label: 'ONLINE EXCLUSIVE', title: '', subtitle: '' });
  });
  it('처음엔 빈 칸을 모두 자동값으로 채운다', () => {
    expect(applyAutoTexts(EMPTY_STUDIO_TEXTS, EMPTY_STUDIO_TEXTS, autoStudioTexts(tpl, null))).toEqual({ label: 'ONLINE EXCLUSIVE', title: '', subtitle: '' });
  });
  it('호출부(블록)가 넘긴 문구는 덮지 않는다 · 빈 칸만 채운다', () => {
    const cur = { label: '', title: '가을 신상 20종', subtitle: '이번 주말까지' };
    expect(applyAutoTexts(cur, EMPTY_STUDIO_TEXTS, autoStudioTexts(tpl, null))).toEqual({ label: 'ONLINE EXCLUSIVE', title: '가을 신상 20종', subtitle: '이번 주말까지' });
  });
  it('상품을 고르면 직전 자동값 그대로인 칸만 바뀌고, 사람이 친 칸은 남는다', () => {
    const prevAuto = autoStudioTexts(tpl, null);
    const cur = { label: '단독 판매', title: '', subtitle: '' }; // 라벨은 사람이 고쳤다
    const nextAuto = autoStudioTexts(tpl, { name: '수분 크림', salePrice: 12000 });
    expect(applyAutoTexts(cur, prevAuto, nextAuto)).toEqual({ label: '단독 판매', title: '수분 크림', subtitle: '12,000원' });
  });
  it('훅은 직전 자동값을 지역 상수로 잡아 갱신 함수에 넘긴다(늦게 도는 갱신 함수가 새 값을 직전 값으로 읽지 않게 · Codex 1R)', () => {
    const src = front('components/studio/StudioMake.tsx');
    const body = src.slice(src.indexOf('if (!template) return;'), src.indexOf('}, [template, product]);'));
    expect(body).toContain('const prev = autoRef.current;');
    expect(body).toContain('setTexts((cur) => applyAutoTexts(cur, prev, next));');
    expect(body).not.toMatch(/applyAutoTexts\(cur, autoRef\.current/);
  });
  it('템플릿을 바꾸면 자동값 칸은 새 템플릿 기본 문구로, 사람 칸은 그대로', () => {
    const prevAuto = autoStudioTexts(tpl, null);
    const cur = { label: 'ONLINE EXCLUSIVE', title: '멤버십 데이', subtitle: '' };
    const nextAuto = autoStudioTexts({ label: 'MEMBERSHIP', title: '고객 감사', subtitle: '' }, null);
    expect(applyAutoTexts(cur, prevAuto, nextAuto)).toEqual({ label: 'MEMBERSHIP', title: '멤버십 데이', subtitle: '' });
  });
});

describe('2. /save 결과 가르기 (saveStudioTemp)', () => {
  const realFetch = globalThis.fetch;
  const reply = (status: number, body: any) => ({ ok: status >= 200 && status < 300, status, json: async () => body }) as any;
  beforeEach(() => { (globalThis as any).localStorage = { getItem: (k: string) => (k === 'token' ? 'tok-1' : null) }; });
  afterEach(() => { globalThis.fetch = realFetch; delete (globalThis as any).localStorage; });

  it('성공 = 저장 소재 주소 · 토큰을 붙인다', async () => {
    const spy = vi.fn(async (_u: string, init?: RequestInit) => reply(200, { success: true, asset: { id: 'a1', url: '/api/cdp/inapp/image/c/t1.jpeg' } }));
    globalThis.fetch = spy as any;
    expect(await saveStudioTemp('t1', '제목')).toEqual({ ok: true, asset: { id: 'a1', url: '/api/cdp/inapp/image/c/t1.jpeg', filename: null } });
    expect((spy.mock.calls[0][1] as any).headers.Authorization).toBe('Bearer tok-1');
    expect(JSON.parse(String((spy.mock.calls[0][1] as any).body))).toEqual({ tempId: 't1', title: '제목' });
  });
  it('409 ALREADY_SAVED + 라이브러리에 그 파일이 있으면 = 저장된 것(응답 유실 · 두 번 누름)', async () => {
    globalThis.fetch = vi.fn(async (u: string) => (String(u).includes('/save')
      ? reply(409, { success: false, code: 'ALREADY_SAVED', error: '이미 저장됐거나 만료된 이미지입니다.' })
      : reply(200, { success: true, assets: [{ id: 'x', url: '/api/cdp/inapp/image/c/other.jpg', filename: 'a.jpg' }, { id: 'a9', url: '/api/cdp/inapp/image/c/t9.jpeg', filename: '헤드_포스터.jpg' }] }))) as any;
    expect(await saveStudioTemp('t9')).toEqual({ ok: true, asset: { id: 'a9', url: '/api/cdp/inapp/image/c/t9.jpeg', filename: '헤드_포스터.jpg' } });
  });
  it('409 ALREADY_SAVED + 라이브러리에 없으면 = 기간 만료', async () => {
    globalThis.fetch = vi.fn(async (u: string) => (String(u).includes('/save')
      ? reply(409, { success: false, code: 'ALREADY_SAVED' })
      : reply(200, { success: true, assets: [] }))) as any;
    const r = await saveStudioTemp('t2');
    expect(r.ok).toBe(false);
    expect(!r.ok && r.code).toBe('EXPIRED');
  });
  it('파일명 접두만 같은 다른 소재는 같은 그림으로 치지 않는다', async () => {
    globalThis.fetch = vi.fn(async () => reply(200, { success: true, assets: [{ id: 'z', url: '/api/cdp/inapp/image/c/t20.jpeg' }] })) as any;
    expect(await findSavedStudioAsset('t2')).toEqual({ status: 'missing' });
  });
  it('409 ALREADY_SAVED + 라이브러리 조회 장애 = 만료로 단정하지 않고 다시 누르게 한다(Codex 1R)', async () => {
    globalThis.fetch = vi.fn(async (u: string) => (String(u).includes('/save')
      ? reply(409, { success: false, code: 'ALREADY_SAVED' })
      : reply(500, { success: false, error: 'db' }))) as any;
    const r = await saveStudioTemp('t5');
    expect(r.ok).toBe(false);
    expect(!r.ok && r.code).toBe('FAILED');
    globalThis.fetch = vi.fn(async (u: string) => (String(u).includes('/save')
      ? reply(409, { success: false, code: 'ALREADY_SAVED' })
      : (() => { throw new TypeError('network'); })())) as any;
    const r2 = await saveStudioTemp('t5');
    expect(!r2.ok && r2.code).toBe('FAILED');
  });
  it('409 STORAGE_FULL = 정리 안내 코드 · 서버 문구', async () => {
    globalThis.fetch = vi.fn(async () => reply(409, { success: false, code: 'STORAGE_FULL', error: '저장 용량 한도를 초과했습니다.' })) as any;
    expect(await saveStudioTemp('t3')).toEqual({ ok: false, code: 'STORAGE_FULL', error: '저장 용량 한도를 초과했습니다.' });
  });
  it('연결 실패 = 던지지 않고 실패 결과', async () => {
    globalThis.fetch = vi.fn(async () => { throw new TypeError('network'); }) as any;
    const r = await saveStudioTemp('t4');
    expect(r.ok).toBe(false);
    expect(!r.ok && r.code).toBe('FAILED');
  });
});

describe('3. /save 를 부르는 화면은 공용 함수 하나를 지난다', () => {
  const walk = (dir: string): string[] => readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : /\.(ts|tsx)$/.test(n) ? [p] : [];
  });
  it("'/api/image-studio/save' 주소를 직접 쓰는 곳 = lib/studio-api.ts 뿐", () => {
    // 주석(경로 설명)은 호출이 아니다 — 코드 줄만 본다
    const codeHas = (f: string) => readFileSync(f, 'utf8').split('\n').some((l) => {
      const t = l.trim();
      return !t.startsWith('*') && !t.startsWith('//') && !t.startsWith('/*') && t.includes('/api/image-studio/save');
    });
    const hits = walk(FRONT).filter(codeHas).map((f) => f.slice(FRONT.length + 1).replace(/\\/g, '/'));
    expect(hits).toEqual(['lib/studio-api.ts']);
  });
  it('공용 함수가 STORAGE_FULL · ALREADY_SAVED 를 가르고, 두 화면이 그 함수를 부른다', () => {
    const api = front('lib/studio-api.ts');
    expect(api).toContain("data.code === 'ALREADY_SAVED'");
    expect(api).toContain("data.code === 'STORAGE_FULL'");
    for (const f of ['pages/ImageStudioPage.tsx', 'components/dm/build/StudioInsertModal.tsx']) {
      const src = front(f);
      expect(src, f).toContain('saveStudioTemp(');
      expect(src, f).toMatch(/STORAGE_FULL/);
    }
  });
});

describe('4. 고르기 부품 · 첫 장 자동 선택', () => {
  it('스튜디오는 TemplatePicker 를 hidden 감싸개로 숨기고 단계 조건부로 지우지 않는다(보던 쪽 유지)', () => {
    const page = front('pages/ImageStudioPage.tsx');
    expect(page).toMatch(/<div hidden=\{stage !== 'gallery'\}>\s*<TemplatePicker /);
    expect(page).not.toMatch(/stage === 'gallery' && [(]?\s*<TemplatePicker/);
    // 감싸개에 display 클래스가 붙으면 hidden 이 무력해진다
    expect(page).not.toMatch(/<div hidden=\{stage !== 'gallery'\}[^>]*className=/);
  });
  it('쪽 초기화는 카테고리 · 트랙 · 세부 · 검색어가 바뀔 때만이다(부르는 쪽 단계 전환은 의존성 밖)', () => {
    const picker = front('components/studio/TemplatePicker.tsx');
    expect(picker).toContain('useEffect(() => { setTplPage(1); }, [category, trackKind, sub, searchKey]);');
    expect(picker).not.toMatch(/setTplPage\(1\);\s*\},\s*\[[^\]]*stage/);
  });
  it('DM 삽입 창에 첫 항목 자동 선택이 없다(Harold 1016 폐기) · 고르기 단계엔 만들기 버튼을 그리지 않는다', () => {
    const modal = front('components/dm/build/StudioInsertModal.tsx');
    expect(modal).not.toMatch(/list\[0\]|setPicked/);
    expect(modal).toMatch(/step === 'make' \?[\s\S]*step === 'result' \?[\s\S]*: undefined;/);
  });
  it('DM 창은 처음 열 때 · 넣기 성공 뒤에만 처음 상태로 연다(그 밖의 다시 열기 = 쓰던 그대로 · Codex 1R)', () => {
    const modal = front('components/dm/build/StudioInsertModal.tsx');
    expect(modal).toContain('if (!open || !freshRef.current) return;');
    const insert = modal.slice(modal.indexOf('const insert = async'), modal.indexOf('const remake'));
    // 넣기 성공(onInserted) 뒤에만 다음 열기를 처음 상태로 표시한다 · 실패 분기에서는 표시하지 않는다
    expect(insert.indexOf('freshRef.current = true;')).toBeGreaterThan(insert.indexOf('onInserted(r.asset.url);'));
    expect(insert.slice(0, insert.indexOf('onInserted(r.asset.url);'))).not.toContain('freshRef.current = true');
    expect(modal.match(/freshRef\.current = true/g)?.length).toBe(1);
  });
  it('업종 자동 진입은 창 전용 · 업종 카테고리가 하나일 때만', () => {
    const picker = front('components/studio/TemplatePicker.tsx');
    expect(picker).toContain('autoOpenIndustry && ic && ic.length === 1');
    expect(front('components/dm/build/StudioInsertModal.tsx')).toMatch(/<TemplatePicker[\s\S]*autoOpenIndustry/);
    expect(front('pages/ImageStudioPage.tsx')).not.toContain('autoOpenIndustry');
  });
});

describe('5. 채널 · 겹친 창 · 업종 응답', () => {
  it('인앱 채널은 관리자만(공유 화면) · 판정은 ChannelButtons 한 곳', () => {
    const page = front('pages/ImageStudioPage.tsx');
    expect(page).toMatch(/key: 'inapp'[^\n]*adminOnly: true/);
    expect(page).toContain('.filter((ch) => !ch.adminOnly || isAdmin)');
    expect(page.match(/<ChannelButtons /g)?.length).toBe(2); // 결과 카드 · 발사대
  });
  it('채널 이동은 저장이 성공한 뒤에만 초안을 넣는다', () => {
    const page = front('pages/ImageStudioPage.tsx');
    const body = page.slice(page.indexOf('const saveAndGo'), page.indexOf('const goChannel'));
    expect(body.indexOf('if (!asset) return;')).toBeGreaterThan(-1);
    expect(body.indexOf('if (!asset) return;')).toBeLessThan(body.indexOf('launch('));
  });
  it('위에 뜬 스튜디오 창의 Esc 가 부모 창까지 닫지 않는다', () => {
    expect(front('components/dm/build/CatalogPageModal.tsx')).toContain('closeOnEsc={studioAt === null');
    expect(front('components/dm/build/BlockEditModal.tsx')).toContain('closeOnEsc={!studioOpen');
  });
  it('/templates 는 회사 업종 카테고리를 기존 조회 함수로 싣고 공용 캐시를 붙이지 않는다', () => {
    const r = back('routes/image-studio.ts');
    const at = r.indexOf("imageStudioRouter.get('/templates'");
    const h = r.slice(at, r.indexOf('imageStudioRouter.', at + 10));
    expect(h).toContain('studioIndustryCategories(await resolveCompanyIndustry(companyId))');
    expect(h).toContain('industryCategories');
    expect(h).not.toMatch(/Cache-Control/);
  });
});
