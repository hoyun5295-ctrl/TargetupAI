/**
 * dm-section-renderer.ts — DM 섹션 11종 HTML 렌더러 (Backend)
 *
 * 설계서: status/DM-PRO-DESIGN.md §7 (섹션 시스템) + §8 (디자인 시스템)
 *
 * 소비처:
 *  - dm-viewer.ts (renderSectionsHtml — 세로 스크롤 DM HTML)
 *
 * 재사용 유틸:
 *  - inlineImage / youtubeEmbedUrl → dm-viewer.ts에서 export
 *  - renderDmTokensCss / renderDmBaseCss → dm-tokens.ts
 *
 * 원칙:
 *  - 외부 CDN 의존 최소화 (이미지 base64 인라인, 폰트는 CDN fallback 체인)
 *  - 모든 사용자 입력은 escapeHtml로 이스케이프
 *  - 디자인 토큰은 CSS 변수(var(--dm-*))로 참조
 *  - style_variant는 data 속성으로 전달 (CSS 측에서 상세 매핑)
 */
import type { Section } from './dm-section-registry';
import type { DmBrandKit } from './dm-tokens';
export type SectionRenderContext = {
    brandKit?: DmBrandKit;
    storeName?: string;
    trackApiBase?: string;
    shortCode?: string;
    isPreview?: boolean;
};
export declare function escapeHtml(input: unknown): string;
/** URL이 안전한 스킴(http/https/tel/mailto)인지 검증. 그 외는 # 로 대체 */
export declare function safeUrl(url: unknown): string;
/** 단일 섹션 렌더링 */
export declare function renderSection(section: Section, ctx: SectionRenderContext): string;
/** 섹션 배열 전체를 세로 스크롤로 렌더링 */
export declare function renderSections(sections: Section[], ctx: SectionRenderContext): string;
/** 카운트다운 섹션용 클라이언트 스크립트 (뷰어에서 섹션 존재 시에만 삽입) */
export declare const COUNTDOWN_SCRIPT = "\n(function(){\n  function tick() {\n    var nodes = document.querySelectorAll('.dm-countdown[data-end]');\n    nodes.forEach(function(node){\n      var end = node.getAttribute('data-end');\n      if (!end) return;\n      var diff = new Date(end).getTime() - Date.now();\n      if (diff < 0) diff = 0;\n      var d = Math.floor(diff / 86400000);\n      var h = Math.floor((diff % 86400000) / 3600000);\n      var m = Math.floor((diff % 3600000) / 60000);\n      var s = Math.floor((diff % 60000) / 1000);\n      var map = { d: d, h: h, m: m, s: s };\n      Object.keys(map).forEach(function(k){\n        var el = node.querySelector('[data-unit=\"' + k + '\"]');\n        if (el) el.textContent = String(map[k]).padStart(2, '0');\n      });\n    });\n  }\n  tick();\n  setInterval(tick, 1000);\n})();\n";
//# sourceMappingURL=dm-section-renderer.d.ts.map