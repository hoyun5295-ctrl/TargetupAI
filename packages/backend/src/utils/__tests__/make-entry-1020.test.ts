/**
 * ★ 2026-10-20 임은지 접수 cmvewqxm21 「만들기 - 그 밖에 버튼」
 *
 * 증상: 만들기 「그 밖에」 [한 줄로 자동 생성] · [이미지로 불러오기 · 저장 소재에서] = 제작 화면이 아니라 모바일 DM 첫 화면.
 * 구조: 만들기 → DM · 이메일 진입은 `?other=` 글자 하나로 오가는데 주인이 없었다. 두 버튼 모두 `?other=1` 로 갔고,
 *   9/30 개편이 받는 쪽의 `1` 처리를 지워 아무 동작도 하지 않았다. 형제 = 이메일 상태의 [질문 몇 개로] → 모바일 DM 으로 감.
 * 처방 계약: utils/make-entry.ts 한 곳이 버튼 목록 · 라벨 · 주소 · 읽기를 소유하고, 받는 쪽은 종류마다 실제 동작을 한다.
 */
import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';
import {
  handOffMakeImages, makeEntryState, makeOtherHref, makeOtherItems, readDmEntry, readEmailEntry, readMakeEntryLine, takeMakeImages,
} from '../../../../frontend/src/utils/make-entry';

const FE = path.resolve(__dirname, '../../../../frontend/src');
const read = (rel: string) => fs.readFileSync(path.join(FE, rel), 'utf8');

describe('① 버튼 목록 · 라벨 = 채널마다(없는 입구는 감춘다)', () => {
  it('모바일 DM · 카탈로그 = 한 줄 · 완성 이미지 · 저장 소재 · 블록(★ 2026-10-21 질문 몇 개로 = 한 줄 창으로 흡수)', () => {
    const want = [
      { kind: 'line', label: '한 줄로 자동 생성' },
      { kind: 'images', label: '완성 이미지로' },
      { kind: 'library', label: '저장 소재에서' },
      { kind: 'blocks', label: '블록으로 직접 만들기' },
    ];
    expect(makeOtherItems('dm')).toEqual(want);
    expect(makeOtherItems('catalog')).toEqual(want);
  });
  it('이메일 = 질문 몇 개로 · 완성 이미지 없음(이메일 화면에 그 입구가 없다)', () => {
    expect(makeOtherItems('email')).toEqual([
      { kind: 'line', label: '한 줄로 자동 생성' },
      { kind: 'library', label: '저장 소재로 이미지 이메일' },
      { kind: 'blocks', label: '블록으로 직접 만들기' },
    ]);
  });
});

describe('② 주소 ↔ 읽기 = 같은 약속', () => {
  it('모바일 DM 주소', () => {
    expect(makeOtherHref('dm', 'line')).toBe('/dm-builder?other=line');
    expect(makeOtherHref('dm', 'onestep')).toBe('/dm-builder?other=onestep');
    expect(makeOtherHref('dm', 'library')).toBe('/dm-builder?other=library');
    expect(makeOtherHref('dm', 'blocks')).toBe('/dm-builder?other=blocks');
    expect(makeOtherHref('catalog', 'line')).toBe('/dm-builder?other=line');
    expect(makeOtherHref('dm', 'images')).toBe('/dm-builder?other=images');
  });
  it('이메일 주소(블록 = 옛 blank 그대로)', () => {
    expect(makeOtherHref('email', 'line')).toBe('/email-campaigns?other=line');
    expect(makeOtherHref('email', 'library')).toBe('/email-campaigns?other=library');
    expect(makeOtherHref('email', 'blocks')).toBe('/email-campaigns?other=blank');
  });
  it('받는 쪽 읽기 = 낸 주소의 종류 그대로 · 옛 1 · 모르는 값 = 없음', () => {
    for (const k of ['line', 'images', 'library', 'blocks']) expect(readDmEntry(k)).toBe(k);
    expect(readDmEntry('onestep')).toBe('line');   // ★ 2026-10-21 옛 주소 = 한 줄 창
    expect(readDmEntry('1')).toBeNull();
    expect(readDmEntry(null)).toBeNull();
    expect(readEmailEntry('line')).toBe('line');
    expect(readEmailEntry('library')).toBe('library');
    expect(readEmailEntry('blank')).toBe('blocks');
    expect(readEmailEntry('onestep')).toBeNull();
    expect(readEmailEntry('1')).toBeNull();
  });
});

describe('③ 만들기 칸에 쓴 글 = 다시 입력 없이 옮겨 간다', () => {
  it('글이 있으면 담고 · 없으면 담지 않는다', () => {
    expect(makeEntryState('  가을 신상 니트 3종 20%  ')).toEqual({ makeLine: '가을 신상 니트 3종 20%' });
    expect(makeEntryState('   ')).toBeUndefined();
  });
  it('Codex 1R 긴 글도 자르지 않는다(길이 판정 = 도착 화면 관문)', () => {
    const long = `가을 행사 ${'상품 설명 '.repeat(300)}마감 10월 31일`;
    expect(long.length).toBeGreaterThan(1500);
    expect(readMakeEntryLine(makeEntryState(long))).toBe(long);
  });
  it('받는 쪽 읽기 = 글자만 · 이상한 값은 빈칸', () => {
    expect(readMakeEntryLine({ makeLine: '가을 신상' })).toBe('가을 신상');
    expect(readMakeEntryLine(null)).toBe('');
    expect(readMakeEntryLine({ makeLine: 3 })).toBe('');
  });
});

describe('④ 완성 이미지 = 만들기 화면에서 고른 파일을 DM 화면이 한 번만 받는다', () => {
  it('넘기고 → 한 번 받고 → 다시 받으면 없음 · 빈 선택은 넘기지 않는다', () => {
    const f1 = { name: 'a.jpg' } as unknown as File;
    const f2 = { name: 'b.jpg' } as unknown as File;
    expect(handOffMakeImages([f1, f2])).toBe(true);
    expect(takeMakeImages()).toEqual([f1, f2]);
    expect(takeMakeImages()).toBeNull();
    expect(handOffMakeImages([])).toBe(false);
    expect(takeMakeImages()).toBeNull();
  });
});

describe('⑤ 배선', () => {
  it('만들기 = 버튼 목록 · 주소를 make-entry 에서만 만든다(화면 안 ?other= 글자 0 · 옛 라벨 0)', () => {
    const page = read('pages/QuickCampaignPage.tsx');
    expect(page).toContain('makeOtherItems(channel)');
    expect(page).toContain('makeOtherHref(channel,');
    expect(page).toContain('handOffMakeImages(');
    expect(page).not.toMatch(/['`]\/(dm-builder|email-campaigns)\?other=/);
    expect(page).not.toContain('이미지로 불러오기 · 저장 소재에서');
  });
  it('모바일 DM 화면 = 다섯 종류 모두 실제 동작 · 빠지면 tsc 오류(never)', () => {
    const page = read('pages/DmBuilderPage.tsx');
    expect(page).toContain('readDmEntry(entry.other)');
    for (const k of ['line', 'onestep', 'images', 'library', 'blocks']) expect(page, k).toContain(`case '${k}':`);
    expect(page).toMatch(/const unhandled: never = kind;/);
    expect(page).toContain('takeMakeImages()');
    expect(page).toContain('readMakeEntryLine(location.state)');
  });
  it('이메일 화면 = 세 종류 모두 실제 동작 · 빠지면 tsc 오류(never)', () => {
    const page = read('pages/EmailCampaignsPage.tsx');
    expect(page).toContain('readEmailEntry(entryOther)');
    for (const k of ['line', 'library', 'blocks']) expect(page, k).toContain(`case '${k}':`);
    expect(page).toMatch(/const unhandled: never = kind;/);
    expect(page).toContain('readMakeEntryLine(location.state)');
  });
  it('진입 값은 한 번만 — 두 화면 모두 처리하면서 주소의 other 를 지운다(새로 고침이 고르기 창을 되풀이하지 않게)', () => {
    for (const rel of ['pages/DmBuilderPage.tsx', 'pages/EmailCampaignsPage.tsx']) {
      const page = read(rel);
      expect(page, rel).toContain("rest.delete('other');");
      expect(page, rel).toContain('setSearchParams(rest, { replace: true });');
    }
  });
  it('한 줄 칸 = 들어오면 커서(focusSignal)', () => {
    const cmd = read('components/zone/ZoneCommand.tsx');
    expect(cmd).toContain('focusSignal?: number');
    expect(cmd).toMatch(/inputRef\.current\?\.focus\(\)/);
  });
});
