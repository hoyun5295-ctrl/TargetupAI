/**
 * ★ CT design-core/art-direction.ts — 3채널 공용 아트디렉션 리터럴 (디자인 4.0 M1, 2026-07-14)
 *
 * 타입스케일·여백 밀도·톤 기본 경향의 단일 소유자.
 * 2026-07-14 실측: DM BE(dm-art-direction)·DM FE(dm-tokens)·이메일 BE(email-tokens) 3벌이
 * 값까지 완전 일치(드리프트 0)했고, M2에서 backend 2벌이 이 파일을 소비하도록 전환한다.
 * FE 미러 2벌은 물리 격리(패키지 분리) 때문에 값 미러 유지 — M3 동기 테스트가 기계 고정.
 *
 * 값 변경 절차: 이 파일 수정 → M0 골든 스냅샷 갱신 의무 → FE 미러(dm-tokens·blockTheme) 동기.
 */

export type CoreTypeScale = 'editorial' | 'bold' | 'minimal';
export type CoreDensity = 'compact' | 'standard' | 'airy';
export type CoreMotif = 'none' | 'rule' | 'index' | 'bracket' | 'dot';
export type CoreDivider = 'none' | 'hairline' | 'gap' | 'rule';
export type CoreHeadlineFont = 'sans' | 'serif';

/** 타입스케일 — hero/h1은 3채널 공용, emailH2는 이메일 가지 전용 파생값 */
export const CORE_TYPE_SCALE: Record<CoreTypeScale, {
  hero: string; heroWeight: string; heroLs: string; h1: string; emailH2: string;
}> = {
  editorial: { hero: '40px', heroWeight: '800', heroLs: '-0.03em', h1: '28px', emailH2: '22px' },
  bold:      { hero: '34px', heroWeight: '900', heroLs: '-0.02em', h1: '24px', emailH2: '20px' },
  minimal:   { hero: '28px', heroWeight: '600', heroLs: '0',       h1: '22px', emailH2: '19px' },
};

/** 여백 밀도 배율 — DM은 String() 변환 소비, 이메일은 숫자 소비 (값 동일) */
export const CORE_DENSITY_SCALE: Record<CoreDensity, number> = { compact: 0.8, standard: 1, airy: 1.4 };

/** tone → 아트디렉션 기본 경향(결정적) — AI·사용자가 명시 안 했을 때만 적용 */
export const CORE_TONE_DEFAULTS: Record<string, { typeScale: CoreTypeScale; headlineFont: CoreHeadlineFont; spacingDensity: CoreDensity }> = {
  premium:  { typeScale: 'editorial', headlineFont: 'serif', spacingDensity: 'airy' },
  elegant:  { typeScale: 'editorial', headlineFont: 'serif', spacingDensity: 'airy' },
  urgent:   { typeScale: 'bold', headlineFont: 'sans', spacingDensity: 'compact' },
  playful:  { typeScale: 'bold', headlineFont: 'sans', spacingDensity: 'standard' },
  friendly: { typeScale: 'minimal', headlineFont: 'sans', spacingDensity: 'standard' },
};

/**
 * 채널 능력표 — 억지 파생 구조 차단(품질 게이트 5 "안 되는 채널은 명시 제외"의 기계 근거).
 * 값의 출처: 2026-07-14 실측 (이메일=클라이언트 제약, 인앱=SDK 구현 축).
 */
export const CHANNEL_CAPABILITIES = {
  dm: {
    motion: true, grain: true,
    density: ['compact', 'standard', 'airy'] as readonly CoreDensity[],
    motifs: ['none', 'rule', 'index', 'bracket', 'dot'] as readonly CoreMotif[],
    dividers: ['none', 'hairline', 'gap', 'rule'] as readonly CoreDivider[],
  },
  email: {
    motion: false, grain: false, // 수신 클라이언트가 애니메이션·질감 레이어를 지움
    density: ['compact', 'standard', 'airy'] as readonly CoreDensity[],
    motifs: ['none', 'rule', 'dot', 'bracket', 'index'] as readonly CoreMotif[],
    dividers: ['none', 'hairline', 'gap', 'rule'] as readonly CoreDivider[],
  },
  inapp: {
    motion: true, grain: false,
    density: ['airy', 'compact'] as readonly CoreDensity[], // standard = SDK 미설정(현행 13px)
    motifs: ['rule', 'dot', 'bracket'] as readonly CoreMotif[],
    dividers: [] as readonly CoreDivider[], // 인앱은 divider 블록이 별도 존재 — 아트디렉션 축 아님
  },
} as const;

export type CoreChannel = keyof typeof CHANNEL_CAPABILITIES;

/**
 * 구도 허용표 공용 시그니처 — 값은 채널 어댑터 소유(채널 제약이 실체),
 * 해석기는 전 채널 동일 fail-closed 규약: 미등재 섹션/미허용 값 = 'classic'.
 */
export type TreatmentTable = Record<string, readonly string[]>;

export function resolveTreatmentFailClosed(table: TreatmentTable, sectionType: string, requested?: string | null): string {
  const allowed = table[sectionType];
  if (!allowed) return 'classic';
  return requested && allowed.includes(requested) ? requested : 'classic';
}
