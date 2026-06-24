/**
 * 이미지 src를 base64 data URL로 인라인 변환.
 * 외부 URL/이미 data URL은 그대로 반환.
 * 서버 파일이 없으면 원본 src 유지.
 */
export declare function inlineImage(src: string): string;
/**
 * YouTube 워치 URL / 짧은 URL / 이미 embed URL → embed URL로 정규화.
 * 변환 불가능하면 null.
 */
export declare function youtubeEmbedUrl(url: string): string | null;
//# sourceMappingURL=dm-viewer-utils.d.ts.map