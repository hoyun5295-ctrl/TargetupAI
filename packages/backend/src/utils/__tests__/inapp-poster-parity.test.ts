import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

/**
 * ★ 2026-07-21 인앱 포스터 편집 미리보기 ↔ SDK 렌더 값 미러 게이트.
 *
 * [근본] 편집기 미리보기(frontend BlockPreview.tsx PosterHero)에 "SDK mirror" 주석이 있는데,
 *   포스터형 full-bleed 분기의 최소높이(170 vs 190)·패딩·헤드라인 크기(24 vs 26)가 실제 SDK
 *   렌더(sdk-js inapp-blocks.ts renderPosterHero)와 어긋나 편집 화면 ≠ 실물이었다(DM 파리티 작업 중 Codex 발견).
 * [게이트] PosterHero full-bleed 분기의 값(`fullBleed ? TRUE : FALSE`의 TRUE값)을 양쪽에서 순서대로
 *   뽑아 단위·따옴표를 정규화(190 ↔ '190px')한 뒤 1:1 대조. 한쪽만 바꾸면 push가 막힌다.
 *   [범위] Codex 지적 지점인 PosterHero만. TicketPerforation 등은 현재 일치하나 선언 순서가 달라
 *   순서 기반 파싱이 취약 → 별도 축으로 남긴다(값 정합은 2026-07-21 시점 수동 확인 완료).
 */

function readFirst(cands: string[]): { src: string; used: string } {
  const used = cands.find((p) => fs.existsSync(p)) || '';
  return { src: used ? fs.readFileSync(used, 'utf8') : '', used };
}

/** src에서 name 선언 이후 다음 함수 선언 전까지의 본문을 자른다. */
function funcBody(src: string, markers: string[]): string {
  for (const m of markers) {
    const start = src.indexOf(m);
    if (start === -1) continue;
    const rest = src.slice(start + m.length);
    const end = rest.search(/\n(?:export\s+)?function /);
    return end === -1 ? rest : rest.slice(0, end);
  }
  return '';
}

/** `fullBleed ? TRUE : FALSE`의 TRUE값(콜론 전까지)을 순서대로 정규화해 뽑는다. */
function fullBleedTrueValues(body: string): string[] {
  return [...body.matchAll(/fullBleed \? ([^:]+?) :/g)].map((m) =>
    m[1].replace(/['"`]/g, '').replace(/px\b/g, '').trim().replace(/\s+/g, ' '),
  );
}

describe('inapp poster parity — 편집 미리보기(BlockPreview) ↔ SDK 렌더(inapp-blocks) full-bleed 값 동기', () => {
  const preview = readFirst([
    path.resolve(process.cwd(), '../frontend/src/components/inapp/BlockPreview.tsx'),
    path.resolve(process.cwd(), 'packages/frontend/src/components/inapp/BlockPreview.tsx'),
  ]);
  const sdk = readFirst([
    path.resolve(process.cwd(), '../sdk-js/src/inapp-blocks.ts'),
    path.resolve(process.cwd(), 'packages/sdk-js/src/inapp-blocks.ts'),
  ]);

  const previewVals = fullBleedTrueValues(funcBody(preview.src, ['function PosterHero(']));
  const sdkVals = fullBleedTrueValues(funcBody(sdk.src, ['export function renderPosterHero(', 'function renderPosterHero(']));

  it('양쪽 소스와 PosterHero 본문을 찾는다', () => {
    expect(preview.used, '편집 미리보기 소스를 못 찾음 — cwd=' + process.cwd()).toBeTruthy();
    expect(sdk.used, 'SDK 소스를 못 찾음 — cwd=' + process.cwd()).toBeTruthy();
    // minHeight·borderRadius·padding·eyebrow(2)·headline(3) = 8개 fullBleed 분기
    expect(previewVals.length).toBeGreaterThanOrEqual(8);
  });

  it('full-bleed 분기 값이 편집 미리보기 = SDK 렌더 (드리프트 0)', () => {
    expect(
      previewVals,
      'PosterHero full-bleed 값이 SDK와 다름 — 편집 화면 ≠ 실물. BlockPreview를 SDK(SoT)에 맞추거나 축소율을 명시하라',
    ).toEqual(sdkVals);
  });

  it('이번 신고 3지점(최소높이 190·패딩 22px 24px 18px·헤드라인 26)이 양쪽에 있다', () => {
    const joined = previewVals.join('|');
    const joinedSdk = sdkVals.join('|');
    for (const v of ['190', '22 24 18', '26']) {
      expect(joined, `편집 미리보기에 ${v} 없음`).toContain(v);
      expect(joinedSdk, `SDK에 ${v} 없음`).toContain(v);
    }
  });
});
