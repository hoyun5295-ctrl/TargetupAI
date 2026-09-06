/**
 * ★ 2026-09-05 AI 영업 아웃리치 : 샘플 예시(few-shot) 선택 CT
 * 설계 = docs/2026-09-05-ai-sales-outreach-refinement-design.md(프로토타입 검증 → 운영 이식)
 *
 * 무엇을 하나: 직원 실물 DM 10건·이메일 9건을 마스킹한 예시(seed)에서 채널·업종에 맞는 것을 골라
 * 프롬프트에 붙일 문자열 하나를 만든다. 예시는 "구성·리듬·문장 길이·톤"의 참고이고, 문장 차용은
 * 규칙(`OUTREACH_GENERATION_RULES`)이 금지한다.
 *
 * 규율:
 * - 예시 문자열에 브랜드명·상품명·혜택 수치·링크·연락처가 없다(seed 생성기가 〔〕로 가린다 · 계약 테스트가 고정).
 * - 같은 업종 예시를 먼저, 부족하면 다른 업종으로 채운다. 예산(문자 수)·개수 상한을 넘기지 않는다.
 * - 서빙 우선순위(후속) = DB(best_copy_assets kind='style_example') → seed. 지금은 seed만(둘째 원천은 별건).
 * - 순수 함수만. 네트워크 0 · DB 0.
 */
import { OUTREACH_EXEMPLAR_SEED } from './sales-outreach-exemplar-seed';
import { withExemplarHeader } from './sales-outreach-exemplar-mask';

export type ExemplarChannel = 'DM' | 'EMAIL';

/** DB 행(머리줄 없는 본문) → 원천 Record(`채널:업종군` · 머리줄 부착). 순수. */
export interface ExemplarRowLike { channel: ExemplarChannel; industryCode: string; content: string }
export function exemplarSourceFromRows(rows: readonly ExemplarRowLike[]): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const r of rows) {
    if (!r || (r.channel !== 'DM' && r.channel !== 'EMAIL') || !String(r.content || '').trim()) continue;
    const group = exemplarGroupOf(r.industryCode);
    (out[`${r.channel}:${group}`] ||= []).push(withExemplarHeader(r.content, r.channel, group));
  }
  return out;
}

function exemplarBodyKey(s: string): string {
  // 머리줄·공백 차이를 무시한 본문 키(중복 제거용)
  return String(s || '').replace(/^\[예시[^\]]*\]\s*/m, '').replace(/\s+/g, ' ').trim().toLowerCase();
}

/** 두 원천 병합(순수) — primary(DB)가 앞 · 같은 본문은 1번만. 키는 합집합. */
export function mergeExemplarSources(
  primary: Record<string, readonly string[]>,
  secondary: Record<string, readonly string[]>,
): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  const seen = new Set<string>();
  const add = (k: string, s: string) => {
    const key = exemplarBodyKey(s);
    if (!key || seen.has(key)) return;
    seen.add(key);
    (out[k] ||= []).push(s);
  };
  for (const [k, list] of Object.entries(primary)) for (const s of list) add(k, s);
  for (const [k, list] of Object.entries(secondary)) for (const s of list) add(k, s);
  return out;
}

/** 업종 코드(industry-codes 15종) → 예시 군(seed 3군). 표에 없는 업종은 commerce(범용 커머스). */
const INDUSTRY_TO_EXEMPLAR_GROUP: Record<string, 'fashion' | 'beauty' | 'commerce'> = {
  fashion: 'fashion', sports: 'fashion', baby: 'fashion',
  beauty: 'beauty', health: 'beauty',
};

export function exemplarGroupOf(industry: string | null | undefined): 'fashion' | 'beauty' | 'commerce' {
  return (industry && INDUSTRY_TO_EXEMPLAR_GROUP[industry]) || 'commerce';
}

export interface PickExemplarsOptions {
  /** 총 문자 예산(기본 9000) */
  budget?: number;
  /** 최대 개수(기본 5) */
  max?: number;
  /** seed 대신 쓸 원천(테스트·후속 DB 서빙용) */
  source?: Record<string, readonly string[]>;
}

/**
 * 채널·업종에 맞는 예시를 골라 하나의 문자열로. 같은 업종군 → 다른 업종군 순. 예산·개수 상한 준수.
 * 아무것도 없으면 빈 문자열(호출부가 "[예시]" 블록을 생략한다). picked = 실제로 실린 수 · total = 채널 원천 전량(근거 문구는 picked를 쓴다).
 */
export function pickOutreachExemplarsDetail(channel: ExemplarChannel, industry: string | null | undefined, opts?: PickExemplarsOptions): { text: string; picked: number; total: number } {
  const budget = opts?.budget ?? 9000;
  const max = opts?.max ?? 5;
  const source = opts?.source ?? OUTREACH_EXEMPLAR_SEED;
  const group = exemplarGroupOf(industry);
  const same = source[`${channel}:${group}`] || [];
  const others = Object.entries(source)
    .filter(([k]) => k.startsWith(channel + ':') && k !== `${channel}:${group}`)
    .flatMap(([, v]) => v);
  const picked: string[] = [];
  let used = 0;
  for (const e of [...same, ...others]) {
    if (picked.length >= max) break;
    if (used + e.length > budget) continue;
    picked.push(e);
    used += e.length;
  }
  return { text: picked.join('\n\n'), picked: picked.length, total: same.length + others.length };
}

export function pickOutreachExemplars(channel: ExemplarChannel, industry: string | null | undefined, opts?: PickExemplarsOptions): string {
  return pickOutreachExemplarsDetail(channel, industry, opts).text;
}

/** 예시 원천의 채널별 건수(근거 패널 "참고 예시 n건" 문구용). */
export function countOutreachExemplars(channel: ExemplarChannel, source: Record<string, readonly string[]> = OUTREACH_EXEMPLAR_SEED): number {
  return Object.entries(source).filter(([k]) => k.startsWith(channel + ':')).reduce((n, [, v]) => n + v.length, 0);
}

/**
 * 생성 규칙(DM·이메일·문안 공통) : 프로토타입 2회전에서 심사가 잡은 결함(조건 결합·어구 차용·재료 초과)을 막는 줄이 들어 있다.
 * 프롬프트 문자열 안에 구체 혜택 수치(%·원·쿠폰명)를 박지 않는다(LESSONS_BACKEND 체크리스트).
 */
export const OUTREACH_GENERATION_RULES = [
  '[절대 규칙]',
  '- 브랜드명은 대상 업체명만 쓴다. 예시에 나온 〔브랜드〕는 다른 회사다: 그 이름·상품·문구를 옮겨 적지 마라.',
  '- 혜택 수치(퍼센트·금액·N+1·쿠폰·무료·사은품)는 [홈페이지에서 읽은 내용]에 글자 그대로 있는 것만 쓴다. 없으면 수치 없이 쓴다.',
  '- 행사명·기간·상품명은 원문·[수집한 상품]에 있는 것만 쓴다. 지어내지 마라.',
  '- 예시는 "구성·리듬·문장 길이·톤"의 참고다. 문장을 베끼지 마라. 예시에 나온 어구를 5어절 이상 그대로 쓰지 마라.',
  '- 사용 조건·기간·세트 구성 설명은 [홈페이지에서 읽은 내용]에 같은 문장이 있을 때만 쓴다. 근거 문장을 못 찾으면 그 값을 빈 문자열로 둔다. 서로 다른 혜택의 조건을 합치지 마라.',
  '- 상품 묶음·갤러리 개수는 [재료 용량]에 적힌 최대치를 넘기지 마라. 같은 상품을 두 묶음에 넣지 마라.',
  '- 행사가 있으면 행사 중심(행사명이 헤드라인에 그대로 · 기간·상품이 본문에) · 행사가 없을 때만 브랜드 중심. 한국어 · 존댓말 · 과장·강요 없이 · 이모지 0 · 줄표 0.',
  '- 출력은 JSON 하나만(코드블록·설명 금지).',
].join('\n');

/** 채널 공통 줄(★ 2026-09-06 S2 · 실물 통계 반영: hero sub_copy 60자 · CTA 목적지 이름형 10~16자) */
const SECTION_CONTRACT_COMMON = {
  header: '- header: { "brand_name": "업체명" }',
  hero: '- hero: { "headline": "메인 헤드라인(18자 이내 · 행사가 있으면 행사명 그대로)", "sub_copy": "부제 1문장(60자 이내)" }',
  textCard: '- text_card: { "tag": "짧은 라벨", "headline": "소제목(20자 이내)", "body": "본문 1~3문장" }',
  carousel: '- product_carousel: { "title": "상품 묶음 제목" }   (products는 코드가 채운다: 넣지 마라)',
  gallery: '- gallery: {}                                       (제목·images는 코드가 채운다: 넣지 마라)',
  coupon: '- coupon: { "discount_label": "혜택 한 줄", "usage_condition": "조건 한 줄" }   (원문에 혜택 문구가 그대로 있을 때만)',
  countdown: '- countdown: { "urgency_text": "마감 임박 문구(6~14자)", "end_datetime": "YYYY-MM-DDTHH:mm:ss" }  (원문에 종료일이 있을 때만)',
  cta: '- cta: { "buttons": [{ "label": "목적지 이름 + 동사(10~16자 · 예: 기획전 보러 가기 / 베스트 바로가기 · 자세히 보기 같은 범용어 금지)" }] }   (url은 코드가 채운다 · cta는 2~3개: 첫 상품 묶음 뒤 1개, 마지막 1개)',
  footer: '- footer: { "notes": "안내 한 줄" }',
} as const;

/** DM 섹션 계약(프롬프트용) : 이 밖의 type·props는 코드가 버린다. products·images·url은 코드가 채운다. DM 리듬 = 이미지 블록 연속(text_card 0~1 · 실물 10건 중 2건). */
export const OUTREACH_DM_SECTION_CONTRACT = [
  '[사용 가능한 섹션 type과 props · 이 밖의 type·props 금지]',
  SECTION_CONTRACT_COMMON.header,
  SECTION_CONTRACT_COMMON.hero,
  `${SECTION_CONTRACT_COMMON.textCard}   (DM에서는 0~1개만 · 이미지 블록 사이를 텍스트로 끊지 마라)`,
  SECTION_CONTRACT_COMMON.carousel,
  SECTION_CONTRACT_COMMON.gallery,
  SECTION_CONTRACT_COMMON.coupon,
  SECTION_CONTRACT_COMMON.countdown,
  SECTION_CONTRACT_COMMON.cta,
  SECTION_CONTRACT_COMMON.footer,
].join('\n');

/** 이메일 블록 계약(★ S2 독립 문자열 · DM 파생 아님) : countdown 없음(이메일 클라이언트) · 이메일 리듬 = 상품 묶음 앞에 text_card 3칸(실물 9건 중 9건 · 17/18 세 칸 전부). */
export const OUTREACH_EMAIL_SECTION_CONTRACT = [
  '[사용 가능한 블록 type과 props · 이 밖의 type·props 금지]',
  SECTION_CONTRACT_COMMON.header,
  SECTION_CONTRACT_COMMON.hero,
  `${SECTION_CONTRACT_COMMON.textCard}   (상품 묶음 앞에는 반드시 text_card 1개를 두고 tag·headline·body 세 칸을 모두 채워라 · 빈 칸 금지)`,
  SECTION_CONTRACT_COMMON.carousel,
  SECTION_CONTRACT_COMMON.gallery,
  SECTION_CONTRACT_COMMON.coupon,
  SECTION_CONTRACT_COMMON.cta,
  SECTION_CONTRACT_COMMON.footer,
].join('\n');

export const OUTREACH_DM_TYPES: readonly string[] = ['header', 'hero', 'text_card', 'product_carousel', 'gallery', 'coupon', 'countdown', 'cta', 'footer'];
export const OUTREACH_EMAIL_TYPES: readonly string[] = ['header', 'hero', 'text_card', 'product_carousel', 'gallery', 'coupon', 'cta', 'footer'];

/** 예시 문자열에 남아 있으면 안 되는 것(계약 테스트가 seed 전량에 건다 · 모델명 0은 불변식 테스트가 축 파일 전체에 건다) */
export const EXEMPLAR_FORBIDDEN_PATTERNS: readonly RegExp[] = [
  /https?:\/\//i,                       // 링크
  /\d{2,4}-\d{3,4}-\d{4}/,              // 연락처
  /\d{1,3}\s*%/,                        // 할인율
  /\d[\d,]{2,}\s*원/,                   // 금액
];
