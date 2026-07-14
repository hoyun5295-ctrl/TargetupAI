/**
 * ★ CT design-core/template-registry.ts — 채널 중립 골든 템플릿 체계 (디자인 4.0 M1/M4, 2026-07-14)
 *
 * 품질 헌장(Harold 2026-07-14):
 *   1. 템플릿은 색깔놀이가 아니다 — 정의 = 목적 × 스토리 구조 × 조판 × 데이터 슬롯.
 *   2. 수량보다 품질 — 1차 = 정예 10종만.
 *   3. 단순 양산 금지 — difference("이 템플릿이 만드는 차이") 서술 의무. 구분 안 되면 등록 불가.
 *
 * 층위: 이 파일 = 채널 중립 정의(뿌리). 채널 산출물은 template-compilers.ts(가지)가 번역.
 * 문안 원칙: 혜택 수치 0 — 구체 혜택은 전부 BENEFIT_PLACEHOLDER (AI 임의 혜택 영구 룰).
 * 등록 게이트: validateGoldenTemplate — §3.4 기계 판정 항목(1·2·3·5·6). 4(실데이터 엣지)는
 * 컴파일 테스트, 7(Harold 시각 승인)은 스크린샷 실측 후 visual_approved 갱신.
 */
import type { CorePaletteId } from './palette';
import { getCorePalette } from './palette';
import { CHANNEL_CAPABILITIES, type CoreChannel } from './art-direction';

export const BENEFIT_PLACEHOLDER = '[혜택 직접 작성해주세요]';
export const URL_PLACEHOLDER = '';

export type CorePurpose =
  | 'first_purchase'  // 첫구매
  | 'repurchase'      // 재구매
  | 'recovery'        // 회복(장바구니·휴면)
  | 'relationship'    // 관계(VIP·팔로업)
  | 'notice'          // 공지(신상·행사)
  | 'urgency'         // 긴급성(마감)
  | 'proof';          // 증거(후기·신뢰)

export type CoreDataSlot =
  | 'product_live'      // 살아있는 상품 카드(이름·가격·링크·이미지)
  | 'personalization'   // 개인화 변수(이름·등급 등)
  | 'event_text'        // 행사 원문 verbatim
  | 'social_proof'      // 사회적 증거(후기·별점·판매수)
  | 'purchase_history'  // 구매 이력
  | 'grade'             // 고객 등급
  | 'countdown'         // 마감 시한
  | 'brand';            // 브랜드 킷(로고·고객센터)

export type StoryRole = 'hook' | 'context' | 'evidence' | 'benefit' | 'visual' | 'action' | 'care';

export type StoryKind =
  | 'headline'      // 히어로 헤드라인
  | 'text'          // 본문 카드
  | 'product_live'  // 상품 카드(실데이터)
  | 'coupon'        // 혜택(placeholder 강제)
  | 'countdown'     // 마감 타이머 (이메일 = 정적 D-day)
  | 'social_proof'  // 후기·별점 (인앱 = 인용 압축)
  | 'guide'         // 사용 가이드·케어 콘텐츠
  | 'cta';          // 행동

export interface StoryBlock {
  role: StoryRole;
  kind: StoryKind;
  copy?: { tag?: string; headline?: string; body?: string };
  cta?: { label: string };
  dataSlot?: CoreDataSlot;
}

export interface GoldenTemplateChannels {
  dm: { include: boolean; adjust?: string };
  email: { include: boolean; adjust?: string };
  inapp: { include: boolean; adjust?: string };
}

export interface CoreGoldenTemplate {
  id: string;
  label: string;
  purpose: CorePurpose;
  /** 품질 헌장 3 — 이 템플릿이 만드는 차이(왜 다른 템플릿보다 이 목적에 나은가). 의무. */
  difference: string;
  /** 스토리 구조 — 시퀀스 논리 서술 + 블록 골격 */
  story: { logic: string; blocks: StoryBlock[] };
  dataSlots: CoreDataSlot[];
  /** 권장 발동 맥락 (인앱=트리거 / 이메일·DM=발송 시점) */
  triggerHint: { inapp?: string; sendTime?: string };
  /** 디자인 큐레이션 — 코어 팔레트 참조(리터럴 금지) */
  design: { palette: CorePaletteId };
  channels: GoldenTemplateChannels;
  /** §3.4 게이트 7 — Harold 시각 승인(스크린샷 실측) 후 true */
  visual_approved: boolean;
}

// ────────────── 정예 10종 (2026-07-14 Harold 컨펌 difference 서술) ──────────────

export const CORE_GOLDEN_TEMPLATES: readonly CoreGoldenTemplate[] = [
  {
    id: 'welcome-first',
    label: '신규 환영 · 첫구매 길잡이',
    purpose: 'first_purchase',
    difference: '10종 중 유일하게 구매 전 고객 전용 — 상품·혜택을 앞세우지 않고 브랜드 서사와 부담 없는 첫 행동으로 문턱을 낮춘다. 나머지 9종은 전부 구매·행사 맥락을 전제한다.',
    story: {
      logic: '환영 → 브랜드 서사 → 첫 방문 길잡이 → 부담 없는 행동',
      blocks: [
        { role: 'hook', kind: 'headline', copy: { headline: '만나서 반가워요, %고객명%님', body: '함께하게 되어 기뻐요' } },
        { role: 'context', kind: 'text', copy: { tag: 'WELCOME', headline: '저희는 이런 브랜드예요', body: '[브랜드 소개를 작성해주세요]' }, dataSlot: 'brand' },
        { role: 'benefit', kind: 'text', copy: { tag: '첫걸음', headline: '처음이라면 여기부터', body: '[첫 방문 고객 안내를 작성해주세요]' } },
        { role: 'action', kind: 'cta', cta: { label: '천천히 둘러보기' } },
      ],
    },
    dataSlots: ['personalization', 'brand'],
    triggerHint: { inapp: '가입 직후 첫 방문', sendTime: '가입 당일 ~ 익일 낮' },
    design: { palette: 'soft-pastel' },
    channels: { dm: { include: true }, email: { include: true }, inapp: { include: true, adjust: '압축 스토리(서사 1블록)' } },
    visual_approved: false,
  },
  {
    id: 'cart-recovery',
    label: '장바구니 회복',
    purpose: 'recovery',
    difference: '고객이 이미 고른 상품(장바구니 실물 카드)이 히어로 — 상품 데이터가 설득의 주체이고 문안은 보조. 망설임 해소(증거) 블록을 CTA 직전에 고정한 유일한 구조다.',
    story: {
      logic: '담아둔 것 상기 → 상품 실물(살아있는 카드) → 망설임 해소 → 행동',
      blocks: [
        { role: 'hook', kind: 'headline', copy: { headline: '담아두신 상품이 기다리고 있어요', body: '%고객명%님이 고르셨던 그 상품' } },
        { role: 'visual', kind: 'product_live', dataSlot: 'product_live' },
        { role: 'evidence', kind: 'text', copy: { tag: '안심', headline: '망설이셨다면', body: '[교환·반품 등 안심 안내를 작성해주세요]' } },
        { role: 'action', kind: 'cta', cta: { label: '장바구니 이어보기' } },
      ],
    },
    dataSlots: ['product_live', 'personalization'],
    triggerHint: { inapp: '장바구니 담기 후 이탈 재방문', sendTime: '담은 뒤 24~48시간' },
    design: { palette: 'minimal' },
    channels: { dm: { include: true }, email: { include: true }, inapp: { include: true } },
    visual_approved: false,
  },
  {
    id: 'dormant-comeback',
    label: '휴면 고객 안부',
    purpose: 'recovery',
    difference: '떠난 사이 쌓인 변화(신상 축약 피드)로 복귀 명분을 만드는 유일한 구조 — 장바구니 회복이 "이미 고른 것"을 되살린다면 이 템플릿은 "새로 생긴 것"으로 부른다. 안부 톤, 세일 압박 배제.',
    story: {
      logic: '안부 → 그동안의 변화(신상 축약) → 다시 올 이유 → 행동',
      blocks: [
        { role: 'hook', kind: 'headline', copy: { headline: '오랜만이에요, %고객명%님', body: '그동안 잘 지내셨나요?' } },
        { role: 'context', kind: 'product_live', dataSlot: 'product_live' },
        { role: 'benefit', kind: 'text', copy: { tag: 'AGAIN', headline: '다시 오실 이유', body: '[돌아온 고객 안내를 작성해주세요]' } },
        { role: 'action', kind: 'cta', cta: { label: '새 소식 보기' } },
      ],
    },
    dataSlots: ['product_live', 'personalization'],
    triggerHint: { inapp: '휴면 후 첫 재방문', sendTime: '휴면 판정 시점(마지막 활동 N일 경과)' },
    design: { palette: 'paper' },
    channels: { dm: { include: true }, email: { include: true }, inapp: { include: true } },
    visual_approved: false,
  },
  {
    id: 'repurchase-cycle',
    label: '재구매 시점 리마인드',
    purpose: 'repurchase',
    difference: '구매 이력이 논리의 근거("지난 구매 후 시점 도래") — 시간 논리로 설득하는 유일한 템플릿. 행동은 원클릭 재주문 하나로 고정한다.',
    story: {
      logic: '지난 구매 상기 → 재구매 시점 논리 → 원클릭 행동',
      blocks: [
        { role: 'hook', kind: 'headline', copy: { headline: '슬슬 다시 필요하실 때가 됐어요', body: '지난번 구매하신 그 상품' }, dataSlot: 'purchase_history' },
        { role: 'context', kind: 'product_live', dataSlot: 'product_live' },
        { role: 'action', kind: 'cta', cta: { label: '다시 주문하기' } },
      ],
    },
    dataSlots: ['purchase_history', 'product_live'],
    triggerHint: { sendTime: '구매 주기 도래 시점(상품 소모 주기 기준)' },
    design: { palette: 'minimal' },
    channels: { dm: { include: true }, email: { include: true }, inapp: { include: true } },
    visual_approved: false,
  },
  {
    id: 'deadline-sale',
    label: '마감 임박 세일',
    purpose: 'urgency',
    difference: '카운트다운이 스토리의 1번 블록 — 시한이 훅이고 상품이 증거인 손실 회피 골격. 10종 중 유일하게 압축 밀도와 스티키 CTA가 기본이다.',
    story: {
      logic: '시한 선언(카운트다운) → 대상 상품 → 놓치면 잃는 것 → 행동',
      blocks: [
        { role: 'hook', kind: 'countdown', dataSlot: 'countdown' },
        { role: 'visual', kind: 'product_live', dataSlot: 'product_live' },
        { role: 'benefit', kind: 'coupon', copy: { headline: BENEFIT_PLACEHOLDER } },
        { role: 'action', kind: 'cta', cta: { label: '지금 확인하기' } },
      ],
    },
    dataSlots: ['event_text', 'product_live', 'countdown'],
    triggerHint: { inapp: '행사 기간 중 방문 즉시', sendTime: '마감 24~48시간 전' },
    design: { palette: 'bold-sale' },
    channels: {
      dm: { include: true },
      email: { include: true, adjust: '카운트다운 = 정적 D-day 표기(클라이언트 제약)' },
      inapp: { include: true },
    },
    visual_approved: false,
  },
  {
    id: 'vip-private',
    label: 'VIP 프라이빗',
    purpose: 'relationship',
    difference: '혜택보다 자격 인정이 선행하는 유일한 구조 — 등급 슬롯이 훅이다. 격조 조판(럭셔리 다크)과 절제된 단일 CTA로 세일 조판과 구분된다.',
    story: {
      logic: '자격 인정 → 프라이빗 제안 → 격조 있는 행동',
      blocks: [
        { role: 'hook', kind: 'headline', copy: { tag: 'PRIVATE', headline: '%고객명%님께만 드리는 초대', body: '오랜 시간 함께해주신 분께' }, dataSlot: 'grade' },
        { role: 'benefit', kind: 'coupon', copy: { headline: BENEFIT_PLACEHOLDER } },
        { role: 'action', kind: 'cta', cta: { label: '초대 확인하기' } },
      ],
    },
    dataSlots: ['grade', 'personalization'],
    triggerHint: { inapp: 'VIP 세그먼트 방문 시', sendTime: '평일 낮(프라이빗 톤 유지)' },
    design: { palette: 'luxury-dark' },
    channels: { dm: { include: true }, email: { include: true }, inapp: { include: true } },
    visual_approved: false,
  },
  {
    id: 'new-arrival',
    label: '신상 발표',
    purpose: 'notice',
    difference: '비주얼 공개가 목적 — 상품 이미지가 스토리의 정점이고 텍스트는 기대감 조성만 담당한다. CTA 문턱(둘러보기)이 10종 중 가장 낮다.',
    story: {
      logic: '기대감 훅 → 신상 공개(비주얼) → 첫 반응 유도',
      blocks: [
        { role: 'hook', kind: 'headline', copy: { tag: 'NEW', headline: '새로운 소식을 가장 먼저', body: '기다리셨던 신상품이 도착했어요' } },
        { role: 'visual', kind: 'product_live', dataSlot: 'product_live' },
        { role: 'action', kind: 'cta', cta: { label: '신상품 둘러보기' } },
      ],
    },
    dataSlots: ['product_live', 'event_text'],
    triggerHint: { inapp: '신상 공개 후 첫 방문', sendTime: '공개 당일 오전' },
    design: { palette: 'editorial' },
    channels: { dm: { include: true }, email: { include: true }, inapp: { include: true } },
    visual_approved: false,
  },
  {
    id: 'social-proof',
    label: '후기가 말하는 신뢰',
    purpose: 'proof',
    difference: '사회적 증거(별점·판매수·후기)가 훅으로 선행하는 유일한 구조 — 상품보다 "남들의 선택"이 먼저 나온다. 증거를 스크롤 전과 CTA 직전에 이중 배치한다(고전환 ESP 해부학).',
    story: {
      logic: '사회적 증거 선행 → 대상 상품 → 증거 재확인 → 행동',
      blocks: [
        { role: 'hook', kind: 'social_proof', dataSlot: 'social_proof' },
        { role: 'visual', kind: 'product_live', dataSlot: 'product_live' },
        { role: 'evidence', kind: 'text', copy: { tag: 'REVIEW', headline: '이런 후기가 이어지고 있어요', body: '[대표 후기를 붙여넣어주세요]' }, dataSlot: 'social_proof' },
        { role: 'action', kind: 'cta', cta: { label: '직접 확인하기' } },
      ],
    },
    dataSlots: ['social_proof', 'product_live'],
    triggerHint: { sendTime: '후기 축적 후 상시' },
    design: { palette: 'editorial' },
    channels: {
      dm: { include: true },
      email: { include: true },
      inapp: { include: true, adjust: '후기 = 인용 본문으로 압축(전용 블록 없음)' },
    },
    visual_approved: false,
  },
  {
    id: 'post-purchase',
    label: '구매 후 팔로업',
    purpose: 'relationship',
    difference: '판매 CTA가 없는 유일한 템플릿 — 감사, 사용 가이드, 다음 단계 제안으로 이어지는 케어 콘텐츠가 본문이다. 재구매 템플릿의 선행 관계 자산을 만든다.',
    story: {
      logic: '감사 → 사용 가이드/케어 → 다음 단계 제안',
      blocks: [
        { role: 'hook', kind: 'headline', copy: { headline: '구매해주셔서 감사해요', body: '%고객명%님의 선택이 오래 만족스럽도록' }, dataSlot: 'purchase_history' },
        { role: 'care', kind: 'guide', copy: { tag: 'CARE', headline: '이렇게 쓰시면 더 좋아요', body: '[사용·관리 가이드를 작성해주세요]' } },
        { role: 'care', kind: 'cta', cta: { label: '가이드 자세히 보기' } },
      ],
    },
    dataSlots: ['purchase_history', 'personalization'],
    triggerHint: { sendTime: '구매 확정 2~3일 후' },
    design: { palette: 'soft-pastel' },
    channels: { dm: { include: true }, email: { include: true }, inapp: { include: true } },
    visual_approved: false,
  },
  {
    id: 'event-invite',
    label: '행사 초대장',
    purpose: 'notice',
    difference: '행사 원문 verbatim 슬롯이 골격의 중심 — 혜택·기간을 AI가 아니라 원문이 공급한다(환각 0 게이트). 초대 서사 구조라서 마감 세일의 시한 압박과 구분된다.',
    story: {
      logic: '초대 서사 → 행사 핵심(원문 기반) → 참여 행동',
      blocks: [
        { role: 'hook', kind: 'headline', copy: { tag: 'INVITATION', headline: '%고객명%님을 초대합니다', body: '준비한 자리에 함께해주세요' } },
        { role: 'context', kind: 'text', copy: { tag: '행사 안내', headline: '이런 행사예요', body: '[행사 핵심 내용 — 행사 원문에서 자동 채움]' }, dataSlot: 'event_text' },
        { role: 'visual', kind: 'product_live', dataSlot: 'product_live' },
        { role: 'action', kind: 'cta', cta: { label: '초대 받기' } },
      ],
    },
    dataSlots: ['event_text', 'product_live', 'personalization'],
    triggerHint: { inapp: '행사 기간 방문 시', sendTime: '행사 시작 1~3일 전' },
    design: { palette: 'festive' },
    channels: { dm: { include: true }, email: { include: true }, inapp: { include: true } },
    visual_approved: false,
  },
];

// ────────────── §3.4 품질 게이트 (기계 판정 항목) ──────────────

export interface GateViolation { templateId: string; gate: number; reason: string }

/** 혜택 수치 금지 패턴 — 숫자+%/원, 무료/증정/사은품 (placeholder는 허용) */
const BENEFIT_NUMBER_RE = /\d+\s*%|\d+\s*원|\d+\s*만원|무료|증정|사은품|1\+1/;

export function validateGoldenTemplate(t: CoreGoldenTemplate, others: readonly CoreGoldenTemplate[]): GateViolation[] {
  const v: GateViolation[] = [];
  // 게이트 1 — difference 서술 존재·실질 길이·타 템플릿과 구분(동일 서술 금지)
  if (!t.difference || t.difference.trim().length < 20) {
    v.push({ templateId: t.id, gate: 1, reason: 'difference 서술 부재 또는 부실(20자 미만)' });
  }
  if (others.some((o) => o.id !== t.id && o.difference.trim() === t.difference.trim())) {
    v.push({ templateId: t.id, gate: 1, reason: 'difference가 기존 템플릿과 구분되지 않음' });
  }
  // 게이트 2 — 스토리 논리(시퀀스 서술 + 블록 3개 이상 + 종결 행동/케어)
  if (!t.story.logic || t.story.blocks.length < 3) {
    v.push({ templateId: t.id, gate: 2, reason: '스토리 시퀀스 논리 부재(블록 3 미만)' });
  }
  const last = t.story.blocks[t.story.blocks.length - 1];
  if (last && last.role !== 'action' && last.role !== 'care') {
    v.push({ templateId: t.id, gate: 2, reason: '스토리가 행동/케어로 종결되지 않음' });
  }
  // 게이트 3 — 데이터 슬롯 최소 1개 실사용 (정적 디자인 탈락)
  const usedSlots = t.story.blocks.filter((b) => b.dataSlot).length;
  if (t.dataSlots.length < 1 || usedSlots < 1) {
    v.push({ templateId: t.id, gate: 3, reason: '데이터 슬롯 미사용(정적 디자인)' });
  }
  // 게이트 5 — 채널 파생 성립(최소 1채널 + 능력표 위반 없는 큐레이션)
  const included = (Object.keys(t.channels) as CoreChannel[]).filter((c) => t.channels[c].include);
  if (included.length < 1) {
    v.push({ templateId: t.id, gate: 5, reason: '파생 채널 0 — 등록 불가' });
  }
  for (const ch of included) {
    if (t.story.blocks.some((b) => b.kind === 'countdown') && ch === 'email' && !t.channels.email.adjust) {
      v.push({ templateId: t.id, gate: 5, reason: '이메일 카운트다운은 정적 대체 명시(adjust) 의무' });
    }
    void CHANNEL_CAPABILITIES[ch]; // 능력표 존재 검증(컴파일러가 세부 소비)
  }
  // 게이트 6 — 혜택 수치 0
  for (const b of t.story.blocks) {
    const texts = [b.copy?.tag, b.copy?.headline, b.copy?.body, b.cta?.label].filter(Boolean) as string[];
    for (const s of texts) {
      if (BENEFIT_NUMBER_RE.test(s)) {
        v.push({ templateId: t.id, gate: 6, reason: `혜택 수치/단정 표현 포함: "${s.slice(0, 30)}"` });
      }
    }
  }
  // 디자인 — 코어 팔레트 참조 확인(리터럴 금지)
  if (!getCorePalette(t.design.palette)) {
    v.push({ templateId: t.id, gate: 5, reason: `미등록 팔레트 참조: ${t.design.palette}` });
  }
  return v;
}

/** 전 등록 템플릿 게이트 일괄 검증 — 위반 0이어야 배포 가능(테스트가 고정) */
export function validateAllGoldenTemplates(): GateViolation[] {
  const all: GateViolation[] = [];
  for (const t of CORE_GOLDEN_TEMPLATES) {
    all.push(...validateGoldenTemplate(t, CORE_GOLDEN_TEMPLATES));
  }
  return all;
}

export function getGoldenTemplate(id: string): CoreGoldenTemplate | undefined {
  return CORE_GOLDEN_TEMPLATES.find((t) => t.id === id);
}
