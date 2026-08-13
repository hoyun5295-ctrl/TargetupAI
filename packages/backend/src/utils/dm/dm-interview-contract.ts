/**
 * dm-interview-contract.ts — 인터뷰 답 → DM 섹션 체인 계약 (순수 · ★ 2026-08-13 Phase 1)
 *
 * 설계서 = docs/2026-08-13-one-step-content-interview-design.md §4-2·§0 판정 D
 *
 * **질문 하나하나가 결과를 실제로 바꾸는지를 이 파일이 보증한다.**
 * 눌러도 결과가 안 변하는 질문은 죽은 질문이고, 죽은 질문은 신뢰를 깨뜨린다.
 *
 * ⛔ 불변
 *   - 계약의 단정 대상은 **정규화 이후 최종 체인**이다(§0 판정 D). `normalizeSectionChain`이
 *     header·footer를 강제하고 hero·cta를 보강하므로, 정규화 **이전** 값으로 검사하면
 *     초록인데 실물은 다른 상태가 된다.
 *   - 그래서 header·footer·hero·cta는 **묻지 않는다** — 답이 반영될 자리가 없다.
 *   - 결정값은 프롬프트 문장이 아니라 **섹션 체인**으로 간다. 문장으로 넣으면 생성기의 기존 지시와
 *     싸워서 진다(이미지·매장 축이 그 부류다).
 */
import { normalizeSectionChain } from './dm-section-layout';
import type { SectionType } from './dm-section-registry';
import type { CampaignObjective, CampaignTone } from './dm-ai';
import type { InterviewDecisions, InterviewObjective, InterviewQuestionKey } from '../content-interview';

/**
 * 목적별 뼈대 — 직원 시안 실측(2026-08-13 · 18건 149섹션)에서 반복된 구성 공식.
 * ⛔ 시안은 **참조**지 정답이 아니다(미완성 값·타 시안 복사 잔존이 실측됐다). 뼈대만 가져온다.
 */
const OBJECTIVE_SKELETON: Record<InterviewObjective, SectionType[]> = {
  // 상품 프로모션형 — 후킹 → 상품 → 증거 → 혜택 → 긴급성 → 행동
  new_product: ['hero', 'product_carousel'],
  promotion: ['hero', 'product_carousel'],
  bestseller: ['product_carousel', 'hero'],
  // 브랜드 스토리형 — 영상이 앞, 긴급성 장치 없음(질문 자체를 건너뛴다)
  brand_story: ['video', 'hero', 'text_card'],
  // 장소 안내형
  store_visit: ['hero', 'gallery'],
};

/** 증거 종류 → 섹션. 유튜브 주소면 전용 임베드로 간다(같은 'video'라도 렌더가 다르다). */
function proofSection(d: InterviewDecisions): SectionType | null {
  if (d.proof === 'review') return 'reviews';
  if (d.proof === 'instagram') return 'instagram_embed';
  if (d.proof === 'video') {
    const url = String(d.proofUrl || '');
    return /youtube\.com|youtu\.be/.test(url) ? 'youtube_embed' : 'video';
  }
  return null;
}

/**
 * (순수) 결정값 → 섹션 체인(정규화 전 제안).
 * 순서가 곧 읽는 순서다 — 후킹 → 상품 → 증거 → 혜택 → 긴급성 → 매장.
 */
export function buildSectionTypes(d: InterviewDecisions, opts?: { hasBenefit?: boolean }): SectionType[] {
  const out: SectionType[] = [...OBJECTIVE_SKELETON[d.objective]];

  // 상품이 0개면 캐러셀을 넣지 않는다 — 빈 캐러셀은 결함으로 읽힌다.
  if (d.curationCount === 0) {
    for (let i = out.length - 1; i >= 0; i--) if (out[i] === 'product_carousel') out.splice(i, 1);
  }

  // 이미지를 따로 준비하는 경우에만 갤러리 — 상품 이미지만 쓰면 캐러셀이 그 자리다.
  if ((d.imageSource === 'studio' || d.imageSource === 'upload') && !out.includes('gallery')) out.push('gallery');

  const proof = proofSection(d);
  if (proof) out.push(proof);

  // 혜택을 적었을 때만 혜택 섹션 — 비면 넣지 않는다(AI가 혜택을 지어내지 않는다).
  if (opts?.hasBenefit) out.push('instant_coupon');

  if (d.urgency === 'deadline') out.push('countdown');
  if (d.urgency === 'quantity') out.push('limited_quantity');

  if (d.storeShown) out.push('store_info');

  return out;
}

/** (순수) 최종 체인 — 생성기에 넘어가는 값이자 계약 단정 대상. */
export function buildFinalSectionTypes(d: InterviewDecisions, opts?: { hasBenefit?: boolean }): SectionType[] {
  return normalizeSectionChain(buildSectionTypes(d, opts), d.objective);
}

/**
 * 질문 ↔ 그 답이 최종 체인에서 움직이는 섹션 — **죽은 질문 감시표**.
 * 계약 테스트가 각 행마다 "답을 바꾸면 최종 체인이 실제로 달라진다"를 확인한다.
 */
export const INTERVIEW_SECTION_CONTRACT: Record<InterviewQuestionKey, { moves: SectionType[]; note: string }> = {
  // ⛔ hero·cta는 정규화가 항상 보장하므로 여기 적지 않는다 — 적으면 거짓 계약이 된다.
  objective: { moves: ['product_carousel', 'video', 'text_card', 'gallery'], note: '목적이 뼈대를 고른다' },
  products: { moves: ['product_carousel'], note: '상품 0개면 캐러셀을 빼고, 1개 이상이면 넣는다' },
  benefit: { moves: ['instant_coupon'], note: '혜택을 적었을 때만 혜택 섹션이 선다' },
  urgency: { moves: ['countdown', 'limited_quantity'], note: '마감이면 남은 시간, 수량이면 남은 수량' },
  proof: { moves: ['reviews', 'video', 'youtube_embed', 'instagram_embed'], note: '고른 증거만 붙는다' },
  imageSource: { moves: ['gallery'], note: '이미지를 따로 준비할 때만 갤러리' },
  storeInfo: { moves: ['store_info'], note: '매장 안내 선택 시에만' },
};

/** 정규화가 강제하는 축 — 물으면 죽은 질문이 되므로 질문표에 두지 않는다. */
export const FORCED_SECTIONS: SectionType[] = ['header', 'footer', 'hero', 'cta'];

// ── 생성기 입력 조립 (★ Phase 2) ────────────────────────────────────
/**
 * 목적 → 생성기의 톤·목표 축. **이 매핑은 여기가 소유한다** —
 * `dm-ai`가 인터뷰 타입을 알면 생성기가 특정 기능에 묶인다(그 반대 방향이어야 한다).
 */
const OBJECTIVE_AXIS: Record<InterviewObjective, { tone: CampaignTone; objective: CampaignObjective }> = {
  new_product: { tone: 'premium', objective: 'sale' },
  promotion: { tone: 'urgent', objective: 'sale' },
  bestseller: { tone: 'friendly', objective: 'sale' },
  brand_story: { tone: 'premium', objective: 'awareness' },
  store_visit: { tone: 'friendly', objective: 'loyalty' },
};

/**
 * (순수) 인터뷰 결정값 → `oneShotGenerate({ structure })` 입력.
 * 이 값이 넘어가면 생성기는 `parsePrompt`·`designSectionLayout`을 부르지 않는다(§0-5).
 */
export function buildDmStructure(
  d: InterviewDecisions,
  opts?: { hasBenefit?: boolean },
): { sectionTypes: SectionType[]; toneHint: CampaignTone; objective: CampaignObjective } {
  const axis = OBJECTIVE_AXIS[d.objective];
  return {
    sectionTypes: buildSectionTypes(d, opts),
    toneHint: axis.tone,
    objective: axis.objective,
  };
}
