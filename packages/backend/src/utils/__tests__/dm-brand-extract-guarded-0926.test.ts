/**
 * DM 브랜드 추출 — ★ 2026-11-07 C113 K18 · R15 · R80: 브랜드 키트 URL 추출 사슬(화면 모달 → POST /dm/brand-kit/extract →
 * previewBrandExtract · suggestBrandKitFromUrl → extractBrandFromUrl · toBrandKitPatch)은 화면 모달이 2026-07-21 제거된 뒤
 * 쓰는 곳 0 이라 지웠다. 옛 시험(★2026-09-26 R1-28 · 보호된 요청만 쓰는가)은 지운 함수를 가리켜, 그 함수가 없음을 고정한다.
 * 같은 모듈의 살아 있는 외부 요청(fetchHtmlGuarded · fetchProductOgImages)은 그 모듈 시험들이 계속 본다.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

const be = (rel: string) => readFileSync(join(__dirname, '..', '..', rel), 'utf8');

describe('브랜드 키트 URL 추출 사슬 — 쓰는 곳 0 이라 없다', () => {
  it('추출기에 메인 추출 · 패치 변환이 없다', () => {
    const src = be('utils/dm/dm-brand-extractor.ts');
    expect(src).not.toContain('export async function extractBrandFromUrl(');
    expect(src).not.toContain('export function toBrandKitPatch(');
  });
  it('키트 CT 에 미리보기 · 제안이 없다', () => {
    const src = be('utils/dm/dm-brand-kit.ts');
    expect(src).not.toContain('previewBrandExtract');
    expect(src).not.toContain('suggestBrandKitFromUrl');
  });
  it('DM 라우터에 추출 주소가 없다', () => {
    expect(be('routes/dm.ts')).not.toContain("'/brand-kit/extract'");
  });
  it('화면 모달 파일이 없다', () => {
    expect(existsSync(join(__dirname, '..', '..', '..', '..', 'frontend', 'src', 'components', 'dm', 'modals', 'BrandKitModal.tsx'))).toBe(false);
  });
});
