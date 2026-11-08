/**
 * lib/studio-layers.ts — 이미지 스튜디오 로고 층 화면 판단(★ 2026-11-07 · 설계서 docs/2026-11-07-c112-studio-brand-logo-design.md D8 · D9 · D11 · D12)
 *
 * 스튜디오 결과 카드와 DM 삽입 창 결과 단계가 같은 함수를 지난다(한쪽만 고치면 시험이 빨간불).
 * 표시값 = 서버가 돌려준 확정 설정(토글 표시 = 실제 동작) · 저장 = 그 확정 설정 그대로(서버는 저장 때 자리를 다시 재지 않는다).
 * 검증 = backend/src/utils/__tests__/c112-studio-logo-1107.test.ts F 절
 */

// ── 서버 LogoView 사본(backend utils/studio-logo.ts · 글자 대조 = 같은 시험 파일 계약 절) ──
export type LogoCorner = 'tl' | 'tr' | 'bl' | 'br';
export type LogoSize = 's' | 'm' | 'l';
export type LogoUnusableReason = 'format' | 'small' | 'fetch';
export type LogoView =
  | { state: 'ready'; on: boolean; corner: LogoCorner; size: LogoSize; key: string; plate: boolean; corners: LogoCorner[]; sizes: Array<{ id: LogoSize; ok: boolean }> }
  | { state: 'none'; homepage: string | null }
  | { state: 'unusable'; reason: LogoUnusableReason };

/** 결과 카드 한 장의 로고 상태 — 확정 보기 · 합성 미리보기(data URL) · 첫 미리보기 실패 */
export interface LogoCardState { logo: LogoView | null; layered: string | null; logoFailed: boolean }
/** ★ C113 D9 — 홈페이지에서 찾은 로고 후보(서버 임시 · 보기 = data URL · 「이 로고로 저장」만 키트에 쓴다) */
export interface LogoCandidate { tempId: string; preview: string; width: number; height: number }
export interface LogoSettings { on: boolean; corner: LogoCorner | null; size: LogoSize | null }
export interface SaveLayers { logo: { on: true; corner: LogoCorner; size: LogoSize; key: string }; textless: boolean }

export const LOGO_SAVED_TEXT = '저장한 포스터는 로고를 바꿀 수 없어요. 바꾸려면 다시 만들어 주세요.';
export const LOGO_LIMIT_TEXT = '로고는 저장하기 전, 만든 지 7일 안에만 바꿀 수 있어요.';
export const LOGO_SMALL_SIZE_TEXT = '원본 로고가 작아서 더 큰 크기는 흐려져요.';
export const LOGO_FAILED_TEXT = '로고를 얹지 못했어요';
const RETRY = '다시 얹기';

const CORNER_ORDER: Array<[LogoCorner, string]> = [['tl', '왼쪽 위'], ['tr', '오른쪽 위'], ['bl', '왼쪽 아래'], ['br', '오른쪽 아래']];
const SIZE_ORDER: Array<[LogoSize, string]> = [['s', '작게'], ['m', '보통'], ['l', '크게']];

export function logoUnusableText(reason: LogoUnusableReason): string {
  if (reason === 'format') return '이 로고 파일은 쓸 수 없어요. AI 메모리 › 브랜드 키트에서 PNG 로고로 바꿔 주세요.';
  if (reason === 'small') return '로고 파일이 너무 작아요. 더 큰 PNG로 바꿔 주세요.';
  return '로고 파일을 불러오지 못했어요. 잠시 뒤 다시 얹어 주세요.';
}

export type LogoRowView =
  | { mode: 'hidden' }
  | { mode: 'saved'; text: string }
  | { mode: 'failed'; text: string; action: string }
  | { mode: 'note'; text: string; action: string | null }
  | { mode: 'read'; text: string; hint: string; button: string; homepage: string | null }
  | { mode: 'controls'; on: boolean; corner: LogoCorner; size: LogoSize; corners: Array<{ id: LogoCorner; label: string }>; sizes: Array<{ id: LogoSize; label: string }>; sizeNote: string | null };

/** 로고 줄 보기 — 저장한 카드 · 첫 미리보기 실패 · 미리보기 전 · 키트 로고 없음 · 쓸 수 없음 · 준비됨 */
export function logoRowView({ saved, failed, logo }: { saved: boolean; failed: boolean; logo: LogoView | null }): LogoRowView {
  if (saved) return { mode: 'saved', text: LOGO_SAVED_TEXT };
  if (failed) return { mode: 'failed', text: LOGO_FAILED_TEXT, action: RETRY };
  if (!logo) return { mode: 'hidden' };
  if (logo.state === 'none') {
    return { mode: 'read', text: '브랜드 키트에 로고가 없어요', hint: '저장하면 DM과 이메일에도 이 로고가 쓰여요', button: '로고 찾기', homepage: logo.homepage };   // ★ C113 D9 찾기 · 저장 두 단계
  }
  if (logo.state === 'unusable') return { mode: 'note', text: logoUnusableText(logo.reason), action: logo.reason === 'fetch' ? RETRY : null };
  // 고를 수 있는 것만 그린다(누를 수 없는 칩 = 그리지 않는다 · 하나뿐이면 고를 것이 없다)
  const corners = CORNER_ORDER.filter(([id]) => logo.corners.includes(id)).map(([id, label]) => ({ id, label }));
  const okSizes = SIZE_ORDER.filter(([id]) => logo.sizes.some((s) => s.id === id && s.ok)).map(([id, label]) => ({ id, label }));
  return {
    mode: 'controls', on: logo.on, corner: logo.corner, size: logo.size,
    corners: corners.length > 1 ? corners : [],
    sizes: okSizes.length > 1 ? okSizes : [],
    sizeNote: logo.sizes.some((s) => !s.ok) ? LOGO_SMALL_SIZE_TEXT : null,
  };
}

/**
 * 지금 설정 — 확정 값(AI 수정 · 다시 얹기 뒤 같은 자리) · 준비됨이 아니면 **꺼짐** · 자리 · 크기 자동.
 *   ★ C118 E2 · Codex 구현 1R ② 로고 = 기본 꺼짐(생성 직후 /layers 와 같은 값) — 못 읽은 카드에서 AI 수정 · 다시 시도가 로고를 켜지 않는다(켜기 = 사용자 동작만).
 */
export function logoSettingsOf(logo: LogoView | null): LogoSettings {
  return logo?.state === 'ready' ? { on: logo.on, corner: logo.corner, size: logo.size } : { on: false, corner: null, size: null };
}

/** /layers 요청 몸 */
export function layerRequest(baseTempId: string, s: LogoSettings, textless: boolean) {
  return { baseTempId, logo: { on: s.on, corner: s.corner, size: s.size }, textless };
}

/** 저장 layers — 확정 설정이 켜짐일 때만(끔 · 없음 · 쓸 수 없음 · 첫 미리보기 실패 · 미리보기 전 = null = 보이는 그대로 바탕 저장) */
export function layersForSave(logo: LogoView | null, failed: boolean, textless: boolean): SaveLayers | null {
  if (failed || logo?.state !== 'ready' || !logo.on) return null;
  return { logo: { on: true, corner: logo.corner, size: logo.size, key: logo.key }, textless };
}
