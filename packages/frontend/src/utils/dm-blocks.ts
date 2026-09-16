/**
 * dm-blocks.ts — 블록 조립 팔레트 (CT · 2026-09-16 Harold 승인 설계서 §2)
 *
 * 블록은 **기존 섹션 타입**이다. 새 섹션·새 저장 축을 만들지 않는다.
 * 여기서 정하는 것은 "어떤 섹션을 어떤 기본값으로 얹고, 무엇이 채워져야 끝난 것인가"뿐이다.
 *
 * 소비처 = 조립 화면(DmBlockBuilder) · 블록 창(BlockEditModal) · (단계 5) AI 자동제작 자동 배정.
 * 블록 창의 입력 폼은 기존 섹션 편집기(SectionPropsEditor)를 그대로 쓴다 — 여기에 폼을 다시 만들지 않는다.
 */
import type { SectionType } from './dm-section-defaults';

export type DmBlockGroup = '시작' | '상품' | '혜택' | '참여' | '정보' | '마무리';

export interface DmBlockDef {
  key: string;
  label: string;
  icon: string;
  desc: string;
  group: DmBlockGroup;
  section: SectionType;
  /** createSection 기본값 위에 덮을 값 */
  defaults?: Record<string, any>;
  /** 이 블록이 "내용이 찼는가" */
  ready: (props: any) => boolean;
  /** 안 찼을 때 무엇이 필요한지 한 줄 */
  need: string;
  /** 사진 자리가 있는 블록(이미지 스튜디오 제작 버튼을 띄운다) */
  photo?: boolean;
}

const nonEmpty = (v: any) => typeof v === 'string' && v.trim().length > 0;
const arr = (v: any) => (Array.isArray(v) ? v : []);

export const DM_BLOCKS: readonly DmBlockDef[] = [
  {
    key: 'headline', label: '헤드라인', icon: '🖼️', desc: '대표 사진과 제목', group: '시작',
    section: 'hero', photo: true,
    ready: (p) => nonEmpty(p?.headline) && nonEmpty(p?.image_url),
    need: '사진 1장과 제목',
  },
  {
    key: 'text', label: '설명 문단', icon: '✍️', desc: '행사 내용을 글로', group: '시작',
    section: 'text_card', photo: true,
    ready: (p) => nonEmpty(p?.body),
    need: '본문',
  },
  {
    key: 'products', label: '상품 페이지', icon: '🛍️', desc: '사진·가격·보러가기', group: '상품',
    section: 'product_carousel',
    ready: (p) => arr(p?.products).length > 0,
    need: '상품 1개 이상',
  },
  {
    key: 'linkchip', label: '링크 칩', icon: '🔗', desc: '누르면 이동하는 알약 버튼', group: '상품',
    section: 'cta',
    defaults: { layout: 'row', buttons: [{ label: '전체 상품 보기', url: '', style: 'outline' }] },
    ready: (p) => arr(p?.buttons).some((b: any) => nonEmpty(b?.label) && nonEmpty(b?.url)),
    need: '칩 글자와 주소',
  },
  {
    key: 'video', label: '동영상', icon: '▶️', desc: '유튜브·영상 주소', group: '정보',
    section: 'video',
    ready: (p) => nonEmpty(p?.video_url),
    need: '영상 주소',
  },
  {
    key: 'coupon', label: '쿠폰', icon: '🎟️', desc: '할인 금액과 기한', group: '혜택',
    section: 'coupon',
    ready: (p) => nonEmpty(p?.discount_label),
    need: '혜택 표시',
  },
  {
    key: 'countdown', label: '카운트다운', icon: '⏳', desc: '마감까지 남은 시간', group: '혜택',
    section: 'countdown',
    ready: (p) => nonEmpty(p?.end_datetime),
    need: '마감 시각',
  },
  {
    key: 'draw', label: '추첨 이벤트', icon: '🎁', desc: '응모 받고 자동 추첨', group: '참여',
    section: 'lucky_draw',
    ready: (p) => nonEmpty(p?.title) && nonEmpty(p?.draw_at),
    need: '경품 제목과 추첨 시각',
  },
  {
    key: 'poll', label: '투표', icon: '📊', desc: '질문과 보기', group: '참여',
    section: 'poll',
    ready: (p) => nonEmpty(p?.question) && arr(p?.options).length >= 2,
    need: '질문과 보기 2개',
  },
  {
    key: 'survey', label: '설문', icon: '📝', desc: '질문 여러 개와 보상', group: '참여',
    section: 'survey',
    ready: (p) => arr(p?.questions).length > 0,
    need: '질문 1개 이상',
  },
  {
    key: 'store', label: '매장 안내', icon: '🗺️', desc: '지도와 매장 위치', group: '정보',
    section: 'map_store_locator',
    ready: (p) => arr(p?.stores).length > 0,
    need: '매장 1곳',
  },
  {
    key: 'reviews', label: '후기 모음', icon: '⭐', desc: '고객 후기와 별점', group: '정보',
    section: 'reviews',
    ready: (p) => arr(p?.reviews).length > 0,
    need: '후기 1건 이상',
  },
  {
    key: 'cta', label: '버튼', icon: '👉', desc: '가장 중요한 한 번의 행동', group: '마무리',
    section: 'cta',
    ready: (p) => arr(p?.buttons).some((b: any) => nonEmpty(b?.label) && nonEmpty(b?.url)),
    need: '버튼 글자와 주소',
  },
  {
    key: 'foot', label: '안내 문구', icon: '📄', desc: '문의처·수신거부', group: '마무리',
    section: 'footer',
    ready: (p) => nonEmpty(p?.cs_phone) || nonEmpty(p?.notes),
    need: '문의처 또는 안내 문구',
  },
] as const;

export const DM_BLOCK_GROUPS: readonly DmBlockGroup[] = ['시작', '상품', '혜택', '참여', '정보', '마무리'];

export function blockByKey(key: string): DmBlockDef | null {
  return DM_BLOCKS.find((b) => b.key === key) || null;
}

/**
 * 섹션 → 블록. 한 섹션 타입을 두 블록이 쓰면(cta = 링크 칩·버튼) **구분이 되는 것부터** 고른다.
 * 링크 칩은 style이 outline인 버튼을 갖는다.
 */
export function blockOfSection(section: { type: string; props?: any } | null | undefined): DmBlockDef | null {
  if (!section) return null;
  if (section.type === 'cta') {
    const outline = arr(section.props?.buttons).some((b: any) => b?.style === 'outline');
    return blockByKey(outline ? 'linkchip' : 'cta');
  }
  return DM_BLOCKS.find((b) => b.section === section.type) || null;
}

/** 블록이 채워졌는가 (섹션 기준) */
export function isSectionReady(section: { type: string; props?: any }): boolean {
  const def = blockOfSection(section);
  return def ? def.ready(section.props) : true;
}

/** 시작 세트 — 블록 3~4개를 한 번에 얹는다 */
export interface DmBlockSet { key: string; label: string; desc: string; blocks: string[] }
export const DM_BLOCK_SETS: readonly DmBlockSet[] = [
  { key: 'sale', label: '세일 한 판', desc: '헤드라인 · 쿠폰 · 상품 · 버튼', blocks: ['headline', 'coupon', 'products', 'cta'] },
  { key: 'new', label: '신상 소개', desc: '헤드라인 · 설명 · 상품 · 링크 칩', blocks: ['headline', 'text', 'products', 'linkchip'] },
  { key: 'event', label: '이벤트 응모', desc: '헤드라인 · 추첨 · 버튼', blocks: ['headline', 'draw', 'cta'] },
  { key: 'store', label: '매장 오픈', desc: '헤드라인 · 매장 · 동영상 · 버튼', blocks: ['headline', 'store', 'video', 'cta'] },
] as const;
