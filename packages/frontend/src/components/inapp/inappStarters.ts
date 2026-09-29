/**
 * inappStarters — 「용도로 바로 시작」 완성본(★ 2026-09-29 인앱 만들기 개편 3차 · 설계서 §2 · §3)
 *
 * 누르면 문안·장이 채워진 편집기가 열린다 — 사진만 넣고 글자를 눌러 고치면 끝(Harold 0929 「템플릿 → 사진 → 글 편집」).
 * ⛔ 혜택은 만들지 않는다 — 혜택 자리는 [혜택 안내: 직접 작성해주세요] (AI·템플릿 임의 혜택 금지 · 발행 전 서버가 막는다).
 * ⛔ 사진은 넣지 않는다 — 가짜 사진이 발행되지 않게 빈 사진 칸으로 연다(발행 전 점검이 장마다 사진을 요구).
 * 문안 = 줄표(—) 없이 · 고객 이름은 %이름% (고객으로 보기에서 치환 확인).
 */
import { layoutStyle, newSlideKey, type LayoutKey, type WsSlide } from './inappSlides';

export const BENEFIT_SLOT = '[혜택 안내: 직접 작성해주세요]';

export interface InAppStarter {
  id: string;
  title: string;
  desc: string;
  layout: LayoutKey;
  /** 웹 전용 모양(앱은 그리지 않는다) */
  webOnly?: boolean;
  /** 편집기 시작 상태(장 · flat · 표시 조건) */
  seed: () => Record<string, any>;
}

const slide = (layout: 'event_card' | 'banner_sheet' | 'overlay', s: Record<string, any>): WsSlide => ({
  ...layoutStyle(layout),
  image_url: '',
  ...s,
  _k: newSlideKey(),
});

export const INAPP_STARTERS: InAppStarter[] = [
  {
    id: 'new_arrivals',
    title: '새 소식 · 신상품',
    desc: '사진 3장 이벤트 카드',
    layout: 'event_card',
    seed: () => ({
      template: 'full_image',
      design: { poster_layout: 'event_card', dismiss_mode: 'snooze_day' },
      display_frequency: 'once_per_day',
      slides_ws: [
        slide('event_card', { eyebrow: 'NEW', title: '이번 주 새로 나왔어요', body: '가장 먼저 만나 보세요\n지금 확인하고 골라 보세요' }),
        slide('event_card', { eyebrow: 'NEW', title: '%이름%님이 좋아할 만한 신상품', body: '자주 보신 상품과 비슷한\n새 상품을 모았어요' }),
        slide('event_card', { eyebrow: 'EVENT', title: '이번 달 이벤트', body: BENEFIT_SLOT }),
      ],
    }),
  },
  {
    id: 'sale_banner',
    title: '기획전 · 할인',
    desc: '큰 글 배너 시트',
    layout: 'banner_sheet',
    seed: () => ({
      template: 'full_image',
      design: { poster_layout: 'banner_sheet', dismiss_mode: 'snooze_day' },
      display_frequency: 'once_per_day',
      slides_ws: [
        slide('banner_sheet', { eyebrow: '기획전', subtitle: '이번 주만 열리는', title: '특가 기획전', body: BENEFIT_SLOT, cta: { label: '기획전 보기', action_url: '' } }),
      ],
    }),
  },
  {
    id: 'season_poster',
    title: '시즌 포스터',
    desc: '사진 위에 한 줄 · 여러 장 넘기기',
    layout: 'overlay',
    seed: () => ({
      template: 'full_image',
      design: { dismiss_mode: 'snooze_day' },
      display_frequency: 'once_per_day',
      slides_ws: [
        slide('overlay', { eyebrow: 'SEASON', title: '이번 시즌 새 컬렉션', body: '지금 가장 많이 찾는 상품을 모았어요', cta: { label: '컬렉션 보기', action_url: '' } }),
      ],
    }),
  },
  {
    id: 'welcome_back',
    title: '다시 오신 고객 환영',
    desc: '가운데 팝업 · 이름 넣기',
    layout: 'center_modal',
    seed: () => ({
      template: 'center_modal',
      title: '%이름%님, 다시 오셨네요',
      body: `오랜만에 들러 주셔서 반가워요\n${BENEFIT_SLOT}`,
      badge_text: 'WELCOME BACK',
      display_frequency: 'once_per_session',
    }),
  },
  {
    id: 'cart_nudge',
    title: '장바구니 살리기',
    desc: '오른쪽 아래 작은 카드',
    layout: 'slide_in',
    webOnly: true,
    seed: () => ({
      template: 'slide_in',
      title: '장바구니에 담아 두신 상품이 있어요',
      body: '품절되기 전에 확인해 보세요',
      trigger_event: 'cart_view',
      trigger_conditions: { event: 'cart_view' },
      display_frequency: 'once_per_session',
      buttons: [{ id: 'btn_0', label: '장바구니 보기', action_url: '/order/basket.html', style: 'primary', background_color: '#4f46e5', text_color: '#ffffff' }],
    }),
  },
];

/** 모양만 고른 빈 시작 상태(입구 갤러리) — 포스터 계열은 빈 장 1개 · 새 모양은 하루 보지 않기 기본(설계서 §1-3). */
export function blankSeedFor(layout: LayoutKey): Record<string, any> {
  if (layout === 'event_card' || layout === 'banner_sheet' || layout === 'overlay') {
    return {
      template: 'full_image',
      design: layout === 'overlay' ? { dismiss_mode: 'snooze_day' } : { poster_layout: layout, dismiss_mode: 'snooze_day' },
      slides_ws: [slide(layout, {})],
    };
  }
  return { template: layout, title: '', body: '' };
}
