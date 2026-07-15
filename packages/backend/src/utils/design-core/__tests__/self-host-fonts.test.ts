/**
 * ★ 2026-07-16 자가 호스팅 서체 게이트 (박성용 궁서 폴백 사고 재발 방지)
 *
 * 신고: 발행 DM 헤드라인 명조를 구글 Fonts CDN에서 불러오다 수신 단말서 미로드 → 궁서 폴백.
 * 정정: 우리 서버(/api/dm/v/fonts.css)에서 직접 서빙. 이 게이트가 그 불변식을 기계로 고정한다.
 *   ① selfHost 서체의 woff2가 실제 assets/dm-fonts에 있는지(가중치 추가 후 fetch 누락 차단)
 *   ② @font-face가 selfHost 서체를 전량 선언(파일명 = 실제 자산)
 *   ③ 명조 DM 뷰어 = 자가호스팅 링크+preload·구글 0 / 기본 DM = 미추가(회귀 0)
 */
import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { CORE_FONTS, renderSelfHostFontFaceCss } from '../fonts';
import { renderDmViewerHtml } from '../../dm/dm-viewer';

const FONT_DIR = join(process.cwd(), 'assets', 'dm-fonts');

describe('자가 호스팅 서체 게이트', () => {
  it('selfHost 서체의 모든 woff2(한글·라틴 × 가중치)가 assets/dm-fonts에 실존', () => {
    const missing: string[] = [];
    for (const c of CORE_FONTS) {
      if (!c.selfHost) continue;
      for (const w of c.selfHost.weights) {
        for (const sub of ['korean', 'latin']) {
          const f = `${c.selfHost.fileId}-${sub}-${w}.woff2`;
          if (!existsSync(join(FONT_DIR, f))) missing.push(f);
        }
      }
    }
    expect(missing, `누락 woff2 (fetch-dm-fonts.mjs 재실행 필요): ${missing.join(', ')}`).toEqual([]);
  });

  it('@font-face css가 selfHost 서체를 전량 선언(파일명 = 실제 자산), Pretendard 제외', () => {
    const css = renderSelfHostFontFaceCss('fonts');
    for (const c of CORE_FONTS) {
      if (!c.selfHost) continue;
      expect(css, `${c.id} @font-face 누락`).toContain(`font-family:'${c.match}'`);
      const w = c.selfHost.weights[0];
      expect(css).toContain(`fonts/${c.selfHost.fileId}-korean-${w}.woff2`);
    }
    expect(css).not.toContain("font-family:'Pretendard'");
  });

  it('명조 선택 DM 뷰어 = 자가호스팅 fonts.css + preload·구글 0 / 기본 DM = 미추가(회귀 0)', () => {
    const serif = renderDmViewerHtml({
      short_code: 'T1', layout_mode: 'scroll',
      sections: [{ id: 's', type: 'hero', treatment: 'split', props: { headline: '가나다', image_url: 'x.jpg' } }],
      brand_kit: { font_display: '"Noto Serif KR", serif', art_direction: { headlineFont: 'serif' } },
    }, '/api/dm/v');
    expect(serif).toContain('/api/dm/v/fonts.css');
    expect(serif).toContain('rel="preload"');
    expect(serif).not.toContain('fonts.googleapis.com');

    const plain = renderDmViewerHtml({
      short_code: 'T2', layout_mode: 'scroll',
      sections: [{ id: 's', type: 'hero', treatment: 'classic', props: { headline: '가나다' } }],
      brand_kit: {},
    }, '/api/dm/v');
    expect(plain).not.toContain('/api/dm/v/fonts.css');
    expect(plain).not.toContain('fonts.googleapis.com');
  });
});
