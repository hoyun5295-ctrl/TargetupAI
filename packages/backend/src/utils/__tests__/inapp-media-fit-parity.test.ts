import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

/**
 * ★ 2026-07-21 인앱 이미지 블록 "전체보기(natural)" — 실렌더 ↔ 편집 미리보기 ↔ 편집기 기본값 미러 게이트.
 *
 * [근본] 미디어(이미지) 블록이 고정 16:9 박스 + object-fit:cover라 세로 이미지(전신 모델 등)가 잘렸다.
 *   aspect='natural'이면 크롭 없이 원본 비율(height:auto·62vh 상한, object-fit:contain)로 통짜 렌더한다.
 * [게이트] 값 존재만이 아니라 "박스 제거가 isNatural로 가드되는지 / 헬퍼가 배너만 16:9인지 / 실렌더 오버레이가
 *   콘텐츠 초과 시 스크롤하는지"까지 구조로 확인 — 한 곳만 바꾸면 편집 화면 ≠ 실물이 되어 push 차단.
 */

function read(cands: string[]): string {
  const p = cands.find((x) => fs.existsSync(x)) || '';
  return p ? fs.readFileSync(p, 'utf8') : '';
}

/** 소스에서 [시작 마커, 끝 마커) 구간을 자른다. */
function slice(src: string, from: string, to: string): string {
  const a = src.indexOf(from);
  if (a === -1) return '';
  const b = src.indexOf(to, a + from.length);
  return src.slice(a, b === -1 ? undefined : b);
}

const sdkBlocks = read([
  path.resolve(process.cwd(), '../sdk-js/src/inapp-blocks.ts'),
  path.resolve(process.cwd(), 'packages/sdk-js/src/inapp-blocks.ts'),
]);
const sdkApp = read([
  path.resolve(process.cwd(), '../sdk-js/src/inapp.ts'),
  path.resolve(process.cwd(), 'packages/sdk-js/src/inapp.ts'),
]);
const preview = read([
  path.resolve(process.cwd(), '../frontend/src/components/inapp/BlockPreview.tsx'),
  path.resolve(process.cwd(), 'packages/frontend/src/components/inapp/BlockPreview.tsx'),
]);
const editor = read([
  path.resolve(process.cwd(), '../frontend/src/pages/InAppMessagesPage.tsx'),
  path.resolve(process.cwd(), 'packages/frontend/src/pages/InAppMessagesPage.tsx'),
]);

describe('인앱 이미지 블록 전체보기(natural) — 실렌더·미리보기·편집기 미러', () => {
  it('네 소스를 모두 찾는다', () => {
    expect(sdkBlocks, 'SDK inapp-blocks.ts 못 찾음 — cwd=' + process.cwd()).toBeTruthy();
    expect(sdkApp, 'SDK inapp.ts 못 찾음').toBeTruthy();
    expect(preview, 'BlockPreview.tsx 못 찾음').toBeTruthy();
    expect(editor, 'InAppMessagesPage.tsx 못 찾음').toBeTruthy();
  });

  it('SDK renderMedia — natural 박스 제거가 isNatural로 가드된다(paddingTop 무조건 제거 방지)', () => {
    const body = slice(sdkBlocks, 'function renderMedia(', 'function renderEyebrow(');
    expect(body).toContain('const isNatural =');
    expect(body).toContain("=== 'natural'");
    // 박스(paddingTop)는 isNatural일 때만 제거 — 항상 제거되면 배너/기존 발행물이 깨진다
    expect(body).toMatch(/isNatural\s*\?\s*\{\}\s*:\s*\{\s*paddingTop/);
    // natural img = 62vh 상한 + contain(크롭 0)
    expect(body).toMatch(/isNatural[\s\S]*maxHeight:\s*'62vh'[\s\S]*objectFit:\s*'contain'/);
  });

  it('BlockPreview media — SDK와 같은 natural 가드(62vh · contain · paddingTop 가드)', () => {
    const body = slice(preview, "case 'media'", "case 'cta_group'");
    expect(body).toContain('const isNatural =');
    expect(body).toContain("=== 'natural'");
    expect(body).toMatch(/isNatural\s*\?\s*\{\}\s*:\s*\{\s*paddingTop/);
    expect(body).toMatch(/isNatural[\s\S]*maxHeight:\s*'62vh'[\s\S]*objectFit:\s*'contain'/);
  });

  it('편집기 defaultMediaAspect — 배너만 16:9, 그 외 natural(항상 16:9 방지)', () => {
    // 배너 목록은 BANNER_INAPP_TEMPLATES Set로 정의(top/bottom 배너만 크롭 띠 유지)
    expect(editor).toContain("BANNER_INAPP_TEMPLATES = new Set(['top_banner', 'bottom_banner'])");
    const body = slice(editor, 'function defaultMediaAspect(', 'convertToBlocks');
    expect(body).toBeTruthy();
    expect(body).toContain('BANNER_INAPP_TEMPLATES.has');
    // 삼항으로 배너=16:9 / 그 외=natural — 항상 16:9로 바뀌면 실패
    expect(body).toMatch(/\?\s*'16:9'\s*:\s*'natural'/);
  });

  it('편집기 업로드·변환이 하드코딩 16:9가 아니라 헬퍼(+position 폴백)를 쓴다', () => {
    expect(editor).toContain('aspect: defaultMediaAspect(prev.template || prev.position)');
    expect(editor).toContain('aspect: defaultMediaAspect(m.template || m.position)');
    // 기존 미디어 블록 갱신 시에도 aspect 보존/기본 부여(icon→image 무aspect 크롭 방지)
    expect(editor).toContain('nb[idx].aspect || defaultMediaAspect(prev.template || prev.position)');
  });

  it('실렌더 오버레이 3종(center_modal·full_screen·slide_in) content에 스크롤 가드(overflowY:auto)', () => {
    const regions: [string, string, string][] = [
      ['center_modal', "template === 'center_modal'", "motionContext: 'modal'"],
      ['full_screen', "template === 'full_screen'", "motionContext: 'full'"],
      ['slide_in', "template === 'slide_in'", "motionContext: 'slide-right'"],
    ];
    for (const [name, from, to] of regions) {
      const body = slice(sdkApp, from, to);
      expect(body, `${name} 분기 못 찾음`).toBeTruthy();
      expect(body, `${name}에 overflowY:auto 스크롤 가드 없음`).toMatch(/overflowY:\s*'auto'/);
    }
  });
});

/**
 * ★ 2026-09-04 CTA 배치(세로/가로)가 말풍선 카드에서는 효과가 없다 — 그러면 컨트롤도 없어야 한다.
 *
 * 기본 카드에서는 SDK(`inapp-blocks.ts`)와 미리보기(`BlockPreview.tsx`) 둘 다 `b.layout !== 'inline'`로
 * 방향을 정한다(이미 미러 일치). 그런데 **말풍선(bubble)은 양쪽 다 칩을 가로로 고정**해 그리므로
 * 그 카드에서는 「정렬」 선택이 출력을 못 바꾼다. 고르는 대로 안 바뀌는 컨트롤을 남기면
 * DM CTA와 같은 접수가 인앱에서 다시 온다(`no_dead_controls`).
 */
describe('인앱 CTA 배치 — 말풍선에서는 컨트롤을 감춘다 (2026-09-04)', () => {
  it('기본 카드는 SDK·미리보기가 같은 판정을 쓴다 (회귀 고정)', () => {
    expect(sdkBlocks, 'SDK가 layout을 안 읽으면 편집 화면과 단말이 갈린다').toContain("b.layout !== 'inline'");
    expect(preview, '미리보기가 layout을 안 읽으면 편집 화면과 단말이 갈린다').toContain("b.layout !== 'inline'");
  });

  it('말풍선 분기는 양쪽 다 가로 고정이다 = 배치가 무효인 근거', () => {
    const sdkBubble = slice(sdkBlocks, "ctx.cardStyle === 'bubble'", 'buttons.slice');
    const pvBubble = slice(preview, "ctx.cardStyle === 'bubble'", 'buttons.slice');
    expect(sdkBubble).toContain("flexDirection: 'row'");
    expect(pvBubble).toContain("flexDirection: 'row'");
    expect(sdkBubble, '말풍선이 layout을 읽기 시작했으면 편집기 게이트도 함께 풀어야 한다').not.toContain('b.layout');
    expect(pvBubble).not.toContain('b.layout');
  });

  it('편집기가 말풍선에서 배치 컨트롤을 감춘다', () => {
    const ctaCase = slice(editor, "case 'cta_group':", '(b.buttons || []).map');
    expect(ctaCase, '배치 컨트롤이 카드 형태를 안 본다 — 말풍선에서 죽은 컨트롤이 된다')
      .toMatch(/cardStyle/);
    // ⛔ "조건이 있다"만 보면 `{true && (`가 통과한다(0904 DM에서 겪고 고친 것과 같은 약점).
    //    게이트가 **카드 형태 판정의 결과**인지까지 본다.
    const gate = ctaCase.slice(0, ctaCase.indexOf('세로'));
    const lastAnd = gate.lastIndexOf('&&');
    expect(lastAnd, '조건 없이 그려지고 있다').toBeGreaterThan(-1);
    const gateLine = gate.slice(gate.lastIndexOf('\n', lastAnd) + 1);
    expect(gateLine, `배치 컨트롤의 게이트가 카드 형태와 무관하다: ${gateLine.trim()}`)
      .toMatch(/cardStyle/);
  });
});
