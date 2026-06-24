/**
 * dm-tokens.ts (backend) — 모바일 DM 빌더 디자인 토큰 (뷰어 HTML 렌더용)
 *
 * ⚠️ SSOT(Single Source of Truth) — 값은 반드시 frontend와 동기화
 *    프론트 미러: packages/frontend/src/utils/dm-tokens.ts
 *    CSS 변수 매핑: packages/frontend/src/styles/dm-builder.css
 *    값 변경 시 세 파일 동시 수정 필수.
 *
 * 용도: dm-viewer.ts가 HTML 렌더 시 <style>:root{...}</style> 블록을 인라인 주입.
 *       외부 CDN 의존 없이 뷰어 HTML 자체에 토큰을 내장.
 *
 * 설계서: status/DM-PRO-DESIGN.md §8
 */
export declare const DM_COLOR_TOKENS: {
    readonly neutral: {
        readonly 0: "#ffffff";
        readonly 50: "#fafafa";
        readonly 100: "#f5f5f5";
        readonly 200: "#e5e5e5";
        readonly 300: "#d4d4d4";
        readonly 400: "#a3a3a3";
        readonly 500: "#737373";
        readonly 600: "#525252";
        readonly 700: "#404040";
        readonly 800: "#262626";
        readonly 900: "#171717";
        readonly 1000: "#000000";
    };
    readonly brand: {
        readonly primary: "#4f46e5";
        readonly primaryHover: "#4338ca";
        readonly primaryLight: "#eef2ff";
        readonly accent: "#f59e0b";
    };
    readonly semantic: {
        readonly success: "#10b981";
        readonly warning: "#f59e0b";
        readonly error: "#ef4444";
        readonly info: "#3b82f6";
    };
    readonly industry: {
        readonly beauty: {
            readonly primary: "#ec4899";
            readonly accent: "#fbcfe8";
        };
        readonly fashion: {
            readonly primary: "#18181b";
            readonly accent: "#fde68a";
        };
        readonly food: {
            readonly primary: "#ea580c";
            readonly accent: "#fef3c7";
        };
        readonly tech: {
            readonly primary: "#0ea5e9";
            readonly accent: "#cffafe";
        };
        readonly luxury: {
            readonly primary: "#1e3a8a";
            readonly accent: "#d4af37";
        };
    };
};
export declare const DM_TYPOGRAPHY: {
    readonly fontFamily: {
        readonly primary: "\"Pretendard Variable\", Pretendard, -apple-system, BlinkMacSystemFont, system-ui, Roboto, \"Helvetica Neue\", \"Segoe UI\", \"Apple SD Gothic Neo\", \"Noto Sans KR\", sans-serif";
        readonly serif: "\"Noto Serif KR\", serif";
        readonly mono: "\"JetBrains Mono\", Menlo, Consolas, monospace";
    };
    readonly scale: {
        readonly hero: {
            readonly size: "32px";
            readonly lineHeight: "1.2";
            readonly weight: 800;
            readonly letterSpacing: "-0.02em";
        };
        readonly h1: {
            readonly size: "24px";
            readonly lineHeight: "1.3";
            readonly weight: 700;
            readonly letterSpacing: "-0.01em";
        };
        readonly h2: {
            readonly size: "20px";
            readonly lineHeight: "1.4";
            readonly weight: 700;
            readonly letterSpacing: "0";
        };
        readonly h3: {
            readonly size: "18px";
            readonly lineHeight: "1.4";
            readonly weight: 600;
            readonly letterSpacing: "0";
        };
        readonly body: {
            readonly size: "15px";
            readonly lineHeight: "1.6";
            readonly weight: 400;
            readonly letterSpacing: "0";
        };
        readonly small: {
            readonly size: "13px";
            readonly lineHeight: "1.5";
            readonly weight: 400;
            readonly letterSpacing: "0";
        };
        readonly tiny: {
            readonly size: "11px";
            readonly lineHeight: "1.4";
            readonly weight: 400;
            readonly letterSpacing: "0";
        };
    };
};
export declare const DM_SPACING: {
    readonly 0: "0";
    readonly 1: "4px";
    readonly 2: "8px";
    readonly 3: "12px";
    readonly 4: "16px";
    readonly 5: "20px";
    readonly 6: "24px";
    readonly 8: "32px";
    readonly 10: "40px";
    readonly 12: "48px";
    readonly 16: "64px";
    readonly 20: "80px";
};
export declare const DM_RADIUS: {
    readonly none: "0";
    readonly sm: "4px";
    readonly md: "8px";
    readonly lg: "12px";
    readonly xl: "16px";
    readonly '2xl': "24px";
    readonly full: "9999px";
};
export declare const DM_SHADOW: {
    readonly sm: "0 1px 2px rgba(0,0,0,0.05)";
    readonly md: "0 4px 6px -1px rgba(0,0,0,0.08), 0 2px 4px -1px rgba(0,0,0,0.04)";
    readonly lg: "0 10px 15px -3px rgba(0,0,0,0.1), 0 4px 6px -2px rgba(0,0,0,0.05)";
    readonly xl: "0 20px 25px -5px rgba(0,0,0,0.1), 0 10px 10px -5px rgba(0,0,0,0.04)";
};
export type DmBrandKit = {
    logo_url?: string;
    primary_color?: string;
    secondary_color?: string;
    accent_color?: string;
    neutral_color?: string;
    background_color?: string;
    font_family?: string;
    tone?: 'premium' | 'friendly' | 'urgent' | 'elegant' | 'playful';
    contact?: {
        phone?: string;
        email?: string;
        website?: string;
    };
    sns?: {
        instagram?: string;
        youtube?: string;
        kakao?: string;
        naver?: string;
    };
};
/**
 * 뷰어 HTML의 <head> 안 <style> 블록에 주입할 :root CSS 문자열 반환.
 * brandKit이 있으면 기본값을 override.
 */
export declare function renderDmTokensCss(brandKit?: DmBrandKit): string;
/**
 * 뷰어 HTML의 <head> 안에 삽입할 기본 리셋/공통 CSS.
 * 토큰 변수 :root 블록은 renderDmTokensCss()로 별도 주입.
 */
export declare function renderDmBaseCss(): string;
/**
 * 두 색의 WCAG 대비비 계산. AA 기준 4.5:1 이상.
 */
export declare function getContrastRatio(fgHex: string, bgHex: string): number;
/** brandKit의 primary_color가 흰 배경에서 WCAG AA 통과하는지 확인 */
export declare function isBrandKitPrimaryAccessible(brandKit?: DmBrandKit): boolean;
//# sourceMappingURL=dm-tokens.d.ts.map