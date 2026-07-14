/**
 * ★ CT design-core/palette.ts — 3채널 공용 근원 팔레트 (디자인 4.0 M1, 2026-07-14)
 *
 * 한 척추 원칙: 브랜드 룩(색·서체 페어링·무드·아트디렉션 경향)의 정의는 여기 한 곳.
 * 채널은 이 정의를 "가지"로 재해석한다:
 *   - DM     = frontend dm-themes.ts (brand_kit 패치 프리셋 — 값 미러, M3 동기 테스트로 고정)
 *   - 이메일 = frontend email-themes.ts (campaign design 패치 — 값 미러, M3 동기 테스트로 고정)
 *   - 인앱   = SDK inapp-theme.ts 시그니처 테마 (토큰 내장 — 재해석 값은 inapp 필드에 명시)
 *
 * 값의 출처(2026-07-14 실측): DM·이메일 8종은 이미 동일값, 인앱 시그니처 7종은
 * 채널 재해석 값(면 리터럴·기본 강조색)이 존재 — 실수 드리프트가 아니라 의도된 가지이므로
 * 근원(primary/accent/background)과 재해석(inapp.defaultAccent)을 모두 이 파일이 소유한다.
 * 값 변경은 반드시 여기서 시작하고, 미러 파일(M3 동기 테스트 대상)을 함께 갱신한다.
 */

export type CorePaletteId =
  | 'editorial' | 'luxury-dark' | 'minimal' | 'bold-sale'
  | 'soft-pastel' | 'paper' | 'city-night' | 'festive';

export type CoreTone = 'premium' | 'friendly' | 'urgent' | 'elegant' | 'playful';

export interface CorePalette {
  id: CorePaletteId;
  name: string;
  description: string;
  /** 근원색 — DM(brand_kit)·이메일(design.palette)이 그대로 소비 */
  primary: string;
  accent: string;
  background: string;
  /** 카드 미리보기 스와치(좌→우) — 픽커 공용 */
  swatches: [string, string, string];
  /** 헤드라인 전용 서체 css (null = 본문과 동일) */
  fontDisplay: string | null;
  /** 아트디렉션 경향 — DM art_direction·이메일 design.art_direction이 그대로 소비 */
  artDirection: {
    typeScale: 'editorial' | 'bold' | 'minimal';
    headlineFont: 'sans' | 'serif';
    spacingDensity: 'compact' | 'standard' | 'airy';
    accentMotif: 'none' | 'rule' | 'index' | 'bracket' | 'dot';
    sectionDivider: 'none' | 'hairline' | 'gap' | 'rule';
    grain?: boolean;
  };
  /** 이 톤들에 추천 (recommend.ts가 소비) */
  recommendedTones: CoreTone[];
  /** 인앱 가지 — SDK 시그니처 테마 재해석 값 명시 (실측 2026-07-14 보존 — 회귀 0) */
  inapp: {
    /** true = SDK 시그니처 테마 존재 / false = SDK 기본 테마 재사용 */
    signature: boolean;
    /** 회사 accent 미설정 시 SDK가 쓰는 기본 강조색 (signature=false면 null) */
    defaultAccent: string | null;
    /** 재해석 사유 — 근원값과 다른 이유를 기록(가지 판단 근거) */
    note?: string;
  };
}

export const CORE_PALETTES: readonly CorePalette[] = [
  {
    id: 'editorial',
    name: '에디토리얼',
    description: '세리프 헤드라인 · 넉넉한 여백 · 헤어라인 구분 — 잡지 화보 톤',
    primary: '#111827', accent: '#b45309', background: '#ffffff',
    swatches: ['#111827', '#b45309', '#ffffff'],
    fontDisplay: '"Noto Serif KR", serif',
    artDirection: { typeScale: 'editorial', headlineFont: 'serif', spacingDensity: 'airy', accentMotif: 'rule', sectionDivider: 'hairline' },
    recommendedTones: ['premium', 'elegant'],
    inapp: { signature: true, defaultAccent: '#b45309', note: '잉크는 카드 면 대비 위해 stone(#1c1917) 재해석' },
  },
  {
    id: 'luxury-dark',
    name: '럭셔리 다크',
    description: '딥 다크 서피스 · 골드 액센트 — 프라이빗 오퍼 톤',
    primary: '#b89150', accent: '#d4af37', background: '#0e1018',
    swatches: ['#0e1018', '#d4af37', '#b89150'],
    fontDisplay: '"Noto Serif KR", serif',
    artDirection: { typeScale: 'editorial', headlineFont: 'serif', spacingDensity: 'airy', accentMotif: 'rule', sectionDivider: 'rule', grain: true },
    recommendedTones: ['premium'],
    inapp: { signature: true, defaultAccent: '#d4af37' },
  },
  {
    id: 'minimal',
    name: '미니멀',
    description: '절제된 크기 · 여백 구분 · 무장식 — 조용하고 정갈한 안내 톤',
    primary: '#3b82f6', accent: '#93c5fd', background: '#ffffff',
    swatches: ['#3b82f6', '#93c5fd', '#ffffff'],
    fontDisplay: null,
    artDirection: { typeScale: 'minimal', headlineFont: 'sans', spacingDensity: 'standard', accentMotif: 'none', sectionDivider: 'gap' },
    recommendedTones: ['friendly'],
    inapp: { signature: false, defaultAccent: null, note: 'SDK 기본 테마 minimal(모노 에디토리얼) 재사용' },
  },
  {
    id: 'bold-sale',
    name: '볼드 세일',
    description: '검은고딕 임팩트 · 압축 밀도 · 섹션 넘버링 — 세일 전용 조판',
    primary: '#18181b', accent: '#fde68a', background: '#ffffff',
    swatches: ['#18181b', '#fde68a', '#ef4444'],
    fontDisplay: '"Black Han Sans", sans-serif',
    artDirection: { typeScale: 'bold', headlineFont: 'sans', spacingDensity: 'compact', accentMotif: 'index', sectionDivider: 'none' },
    recommendedTones: ['urgent'],
    inapp: { signature: true, defaultAccent: '#ef4444', note: '연노랑(#fde68a)은 인앱 칩·버튼 대비 미달 — 세일 레드 재해석' },
  },
  {
    id: 'soft-pastel',
    name: '소프트 파스텔',
    description: '옅은 핑크 서피스 · 도트 포인트 — 부드러운 안부·복귀 톤',
    primary: '#ec4899', accent: '#fbcfe8', background: '#fffafc',
    swatches: ['#ec4899', '#fbcfe8', '#fffafc'],
    fontDisplay: null,
    artDirection: { typeScale: 'minimal', headlineFont: 'sans', spacingDensity: 'airy', accentMotif: 'dot', sectionDivider: 'gap' },
    recommendedTones: ['friendly', 'playful'],
    inapp: { signature: true, defaultAccent: '#ec4899' },
  },
  {
    id: 'paper',
    name: '웜 페이퍼',
    description: '종이 질감 배경 · 고운바탕 세리프 — 따뜻한 로컬 톤',
    primary: '#9a5b33', accent: '#e8b96a', background: '#faf6ef',
    swatches: ['#9a5b33', '#e8b96a', '#faf6ef'],
    fontDisplay: '"Gowun Batang", serif',
    artDirection: { typeScale: 'editorial', headlineFont: 'serif', spacingDensity: 'airy', accentMotif: 'dot', sectionDivider: 'hairline', grain: true },
    recommendedTones: ['friendly', 'elegant'],
    inapp: { signature: true, defaultAccent: '#9a5b33' },
  },
  {
    id: 'city-night',
    name: '시티 나이트',
    description: '다크 배경 · 시안 네온 — 테크·이벤트 밤 무드',
    primary: '#0ea5e9', accent: '#22d3ee', background: '#0b1220',
    swatches: ['#0b1220', '#0ea5e9', '#22d3ee'],
    fontDisplay: null,
    artDirection: { typeScale: 'bold', headlineFont: 'sans', spacingDensity: 'standard', accentMotif: 'index', sectionDivider: 'none', grain: true },
    recommendedTones: ['premium', 'urgent'],
    inapp: { signature: true, defaultAccent: '#22d3ee' },
  },
  {
    id: 'festive',
    name: '페스티브',
    description: '로즈×앰버 · 브래킷 포인트 — 팝업·이벤트 초대장 톤',
    primary: '#e11d48', accent: '#fbbf24', background: '#ffffff',
    swatches: ['#e11d48', '#fbbf24', '#ffffff'],
    fontDisplay: null,
    artDirection: { typeScale: 'bold', headlineFont: 'sans', spacingDensity: 'standard', accentMotif: 'bracket', sectionDivider: 'none' },
    recommendedTones: ['playful', 'urgent'],
    inapp: { signature: true, defaultAccent: '#e11d48' },
  },
];

export function getCorePalette(id: string): CorePalette | undefined {
  return CORE_PALETTES.find((p) => p.id === id);
}

/** SDK 시그니처 테마 키 목록 (minimal 제외 7종) — 인앱 화이트리스트 파생용 */
export function signaturePaletteIds(): CorePaletteId[] {
  return CORE_PALETTES.filter((p) => p.inapp.signature).map((p) => p.id);
}
