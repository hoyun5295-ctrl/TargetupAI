/**
 * dm-viewer.ts — 모바일 DM 공개 뷰어 HTML 렌더러
 *
 * D119: 슬라이드 기반 (pages[])
 * D125: 섹션 기반 세로 스크롤 (sections[]) 추가 — layout_mode로 분기
 *
 * 인라인 HTML/CSS/JS로 서버사이드 렌더링.
 * 이미지: base64 인라인 (외부 CDN 의존 최소화).
 * 폰트: Pretendard CDN + 시스템 폰트 fallback 체인.
 */
import { inlineImage, youtubeEmbedUrl } from './dm-viewer-utils';
export { inlineImage, youtubeEmbedUrl };
export declare function renderDmViewerHtml(dm: any, trackApiBase: string): string;
/**
 * 샘플 고객 데이터로 변수 치환 후 뷰어 HTML 렌더 (에디터 미리보기/검수용).
 * 페이지 단위로 섹션들을 치환 후 렌더.
 */
export declare function renderDmViewerHtmlWithCustomer(dm: any, trackApiBase: string, customer: Record<string, any> | null, companyId: string): Promise<string>;
export declare function renderDmErrorHtml(message: string): string;
//# sourceMappingURL=dm-viewer.d.ts.map