/**
 * NewSections.tsx — D216+ 신규 16 섹션 렌더링 컴포넌트 통합
 *
 * 카테고리:
 *   A. 시각 카드형 (4): ProductCarousel / Gallery / Slideshow / TabCards
 *   B. 인터랙션 수집형 (4): Poll / Survey / EmailCapture / ClickRewards
 *   C. 참여형 이벤트 (4): LuckyDraw / Roulette / InstantCoupon / LimitedQuantity
 *   D. 외부 임베드 + 매장 안내 (4): YoutubeEmbed / InstagramEmbed / MapStoreLocator / Reviews
 *
 * 디자인 매트릭스:
 *   - 옛 dm-builder.css 변수 활용 (--dm-neutral-* / --dm-primary / --dm-sp-*)
 *   - 카드 영역 = bg + border + rounded + padding 정합
 *   - placeholder 안내 = `[직접 작성해주세요]` 영역 명시 (영구 룰 정합)
 */
import { useState } from 'react';
import type {
  ProductCarouselProps,
  GalleryProps,
  SlideshowProps,
  TabCardsProps,
  PollProps,
  SurveyProps,
  EmailCaptureProps,
  ClickRewardsProps,
  LuckyDrawProps,
  RouletteProps,
  InstantCouponProps,
  LimitedQuantityProps,
  YoutubeEmbedProps,
  InstagramEmbedProps,
  MapStoreLocatorProps,
  ReviewsProps,
} from '../../../utils/dm-section-defaults';
import { dmImageUrl } from '../../../utils/dm-image-url';
import { DmIcon, DmEventCard, DM_CTA_STYLE } from './dm-primitives';

// ────────────── 공통 영역 ──────────────

const CARD_STYLE: React.CSSProperties = {
  background: 'var(--dm-bg)',
  border: '1px solid var(--dm-neutral-200)',
  borderRadius: 'var(--dm-radius-lg)',
  padding: 'var(--dm-sp-4)',
  margin: 'var(--dm-sp-3) 0',
};

const TITLE_STYLE: React.CSSProperties = {
  fontSize: 'var(--dm-fs-h3)',
  fontWeight: 700,
  color: 'var(--dm-neutral-900)',
  marginBottom: 'var(--dm-sp-2)',
};

const PLACEHOLDER_STYLE: React.CSSProperties = {
  color: 'var(--dm-neutral-400)',
  fontSize: 'var(--dm-fs-small)',
  background: 'var(--dm-neutral-50)',
  border: '1px dashed var(--dm-neutral-300)',
  borderRadius: 'var(--dm-radius-lg)',
  padding: 'var(--dm-sp-6)',
  textAlign: 'center',
};

// ────────────── 카테고리 A. 시각 카드형 ──────────────

export function ProductCarouselSection({ props, treatment }: { props: ProductCarouselProps; treatment?: string }) {
  const products = props?.products || [];
  // ★ 2026-07-14 상품 이미지 맞춤(남지현 신고) — 채우기(cover 기본)=잘릴 수 있음 / 맞추기(contain)=전체 보임(잘림 X).
  //   정렬(image_focus)은 cover일 때 어느 부분을 보일지(object-position). 미지정=cover/center = 기존 렌더 동일(회귀 0). 발행 SSR(productImgFit)과 미러.
  // ★ 2026-07-15 맞추기 여백 배경·이미지 높이·글씨공간/섹션 배경(서수란) — SSR productImgFitCss/Height 미러. 미지정=현행.
  const imgFit: React.CSSProperties = props?.image_fit === 'contain'
    ? { objectFit: 'contain', background: props?.background_color || 'var(--dm-neutral-50)' }
    : (props?.image_focus === 'top' || props?.image_focus === 'bottom')
      ? { objectFit: 'cover', objectPosition: `center ${props.image_focus}` }
      : { objectFit: 'cover' };
  const imgH = props?.image_height === 'sm' ? 120 : props?.image_height === 'lg' ? 220 : 150;
  // ★ 2026-07-16 focus/list 구도 이미지 높이(서수란) — SSR renderProductFocus/renderProductList 미러
  const focusBigH = props?.image_height === 'sm' ? 170 : props?.image_height === 'lg' ? 260 : 210;
  const focusRestH = props?.image_height === 'sm' ? 96 : props?.image_height === 'lg' ? 150 : 120;
  const listThumbH = props?.image_height === 'sm' ? 60 : props?.image_height === 'lg' ? 96 : 76;
  const cardBg = props?.caption_bg_color || 'var(--dm-bg)';
  // ★ 2026-07-13 디자인 3.0 — 구도 미러 (SSR renderProductFocus/renderProductList와 구조 동일)
  const priceRow = (p: ProductCarouselProps['products'][number], big: boolean) => {
    const price = Number(p.price || 0);
    const discount = Number(p.discount_price || 0);
    const manual = Math.round(Number(p.discount_rate));
    const rate = Number.isFinite(manual) && manual > 0 && manual < 100
      ? manual
      : (price > 0 && discount > 0 && discount < price ? Math.round((1 - discount / price) * 100) : null);
    const finalPrice = discount > 0 ? discount : price;
    return (
      <div style={{ display: 'flex', gap: 6, alignItems: 'baseline', flexWrap: 'wrap' }}>
        {rate !== null && <span style={{ fontSize: big ? 'var(--dm-fs-h3)' : 'var(--dm-fs-small)', color: 'var(--dm-error)', fontWeight: 800 }}>{rate}%</span>}
        <span style={{ fontSize: big ? 'var(--dm-fs-h3)' : 'var(--dm-fs-small)', fontWeight: 800, color: 'var(--dm-neutral-900)' }}>{finalPrice.toLocaleString('ko-KR')}원</span>
        {rate !== null && <span style={{ fontSize: 'var(--dm-fs-tiny)', color: 'var(--dm-neutral-400)', textDecoration: 'line-through' }}>{price.toLocaleString('ko-KR')}원</span>}
      </div>
    );
  };
  if (treatment === 'focus' && products.length > 0) {
    const [first, ...rest] = products;
    return (
      <div className="dm-section dm-product-carousel" style={{ padding: 'var(--dm-sp-6) var(--dm-sp-5)', ...(props.background_color ? { background: props.background_color } : {}) }}>
        {props.title && <div style={TITLE_STYLE}>{props.title}</div>}
        <div className="dm-pc-items" style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
          <div style={{ width: '100%', background: cardBg, border: '1px solid var(--dm-neutral-200)', borderRadius: 18, overflow: 'hidden', boxShadow: 'var(--dm-shadow-md)' }}>
            {first.image_url ? <img src={dmImageUrl(first.image_url)} alt={first.name} style={{ width: '100%', height: focusBigH, display: 'block', ...imgFit }} /> : <div style={{ width: '100%', height: focusBigH, background: 'var(--dm-neutral-100)' }} />}
            <div style={{ padding: '14px 16px 16px', background: cardBg }}>
              <div style={{ fontSize: 'var(--dm-fs-h3)', fontWeight: 700, color: 'var(--dm-neutral-900)', lineHeight: 1.4, overflowWrap: 'break-word' }}>{first.name}</div>
              <div style={{ marginTop: 6 }}>{priceRow(first, true)}</div>
            </div>
          </div>
          {rest.map((p, i) => (
            <div key={p.id || i} style={{ width: 'calc(50% - 6px)', background: cardBg, border: '1px solid var(--dm-neutral-200)', borderRadius: 14, overflow: 'hidden', boxShadow: 'var(--dm-shadow-sm)', display: 'flex', flexDirection: 'column' }}>
              {p.image_url ? <img src={dmImageUrl(p.image_url)} alt={p.name} style={{ width: '100%', height: focusRestH, display: 'block', flexShrink: 0, ...imgFit }} /> : <div style={{ width: '100%', height: focusRestH, background: 'var(--dm-neutral-100)', flexShrink: 0 }} />}
              <div style={{ padding: '8px 10px 10px', flex: 1, display: 'flex', flexDirection: 'column', background: cardBg }}>
                <div style={{ fontSize: 'var(--dm-fs-small)', fontWeight: 600, color: 'var(--dm-neutral-900)', lineHeight: 1.4, overflowWrap: 'break-word' }}>{p.name}</div>
                <div style={{ marginTop: 'auto', paddingTop: 4 }}>{priceRow(p, false)}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }
  if (treatment === 'list' && products.length > 0) {
    return (
      <div className="dm-section dm-product-carousel" style={{ padding: 'var(--dm-sp-6) var(--dm-sp-5)', ...(props.background_color ? { background: props.background_color } : {}) }}>
        {props.title && <div style={TITLE_STYLE}>{props.title}</div>}
        <div className="dm-pc-items" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {products.map((p, i) => (
            <div key={p.id || i} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 12px', background: cardBg, border: '1px solid var(--dm-neutral-200)', borderRadius: 14 }}>
              {p.image_url ? <img src={dmImageUrl(p.image_url)} alt={p.name} style={{ width: listThumbH, height: listThumbH, borderRadius: 12, flexShrink: 0, ...imgFit }} /> : <div style={{ width: listThumbH, height: listThumbH, background: 'var(--dm-neutral-100)', borderRadius: 12, flexShrink: 0 }} />}
              <div style={{ flex: 1, minWidth: 0, textAlign: 'left' }}>
                <div style={{ fontSize: 'var(--dm-fs-small)', fontWeight: 600, color: 'var(--dm-neutral-900)', lineHeight: 1.4, overflowWrap: 'break-word' }}>{p.name}</div>
                <div style={{ marginTop: 4 }}>{priceRow(p, false)}</div>
              </div>
              {p.link_url ? <span aria-hidden="true" style={{ color: 'var(--dm-neutral-400)', flexShrink: 0 }}>→</span> : null}
            </div>
          ))}
        </div>
      </div>
    );
  }
  return (
    <div className="dm-section dm-product-carousel" style={props.background_color ? { ...CARD_STYLE, background: props.background_color } : CARD_STYLE}>
      {props.title && <div style={TITLE_STYLE}>{props.title}</div>}
      {products.length === 0 ? (
        <div style={PLACEHOLDER_STYLE}>[상품을 추가해주세요]</div>
      ) : (
        <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'var(--dm-section-justify, center)', gap: 12 }}>
          {products.map((p, i) => {
            // ★ 2026-07-02(2) 할인 자동 계산 표시 + 링크 연결 표시 — 뷰어 SSR(renderProductCarousel)과 동일 규칙
            const price = Number(p.price || 0);
            const discount = Number(p.discount_price || 0);
            const manual = Math.round(Number(p.discount_rate));
            const rate = Number.isFinite(manual) && manual > 0 && manual < 100
              ? manual
              : (price > 0 && discount > 0 && discount < price ? Math.round((1 - discount / price) * 100) : null);
            const finalPrice = discount > 0 ? discount : price;
            return (
              // ★ 2026-07-16 (#2 재오픈): classic 카드 구조·스타일을 발행 SSR renderProductCarousel과 정확히 미러.
              //   드리프트였던 카드 테두리·그림자·radius(8→16)·overflow·내부 패딩(10 12 12)·가격 글씨(크기 fs-small→h3/body·굵기 700→800)를
              //   발행물 기준으로 통일. 가격 줄 = 카드 하단 고정(marginTop auto)로 같은 행 카드 가격 위치 일정(임은지 건의 유지).
              <div key={p.id || i} style={{ width: 'calc(50% - 8px)', maxWidth: 220, boxSizing: 'border-box', display: 'flex', flexDirection: 'column', background: cardBg, border: '1px solid var(--dm-neutral-200)', borderRadius: 16, overflow: 'hidden', boxShadow: 'var(--dm-shadow-sm)' }}>
                {p.image_url ? (
                  <img src={dmImageUrl(p.image_url)} alt={p.name} style={{ width: '100%', height: imgH, display: 'block', flexShrink: 0, ...imgFit }} />
                ) : (
                  <div style={{ width: '100%', height: imgH, background: 'var(--dm-neutral-100)', flexShrink: 0 }} />
                )}
                <div style={{ padding: '10px 12px 12px', flex: 1, display: 'flex', flexDirection: 'column', background: cardBg }}>
                  <div style={{ fontSize: 'var(--dm-fs-small)', fontWeight: 600, color: 'var(--dm-neutral-900)', lineHeight: 1.4 }}>{p.name}</div>
                  <div style={{ display: 'flex', gap: 6, alignItems: 'baseline', marginTop: 'auto', paddingTop: 4, flexWrap: 'wrap', fontVariantNumeric: 'tabular-nums' }}>
                    {rate !== null && (
                      <span style={{ fontSize: 'var(--dm-fs-h3)', color: 'var(--dm-error)', fontWeight: 800 }}>{rate}%</span>
                    )}
                    <span style={{ fontSize: 'var(--dm-fs-body)', fontWeight: 800, color: 'var(--dm-neutral-900)' }}>
                      {finalPrice.toLocaleString('ko-KR')}원
                    </span>
                    {rate !== null && (
                      <span style={{ fontSize: 'var(--dm-fs-tiny)', color: 'var(--dm-neutral-400)', textDecoration: 'line-through' }}>
                        {price.toLocaleString('ko-KR')}원
                      </span>
                    )}
                  </div>
                  {p.link_url ? (
                    <div style={{ fontSize: 10, color: 'var(--dm-primary)', marginTop: 4 }}>링크 연결됨</div>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function GallerySection({ props, treatment }: { props: GalleryProps; treatment?: string }) {
  const images = props?.images || [];
  // ★ 2026-07-13 디자인 3.0 — mosaic 구도 미러 (SSR renderGallery mosaic 분기와 구조 동일)
  const mosaic = treatment === 'mosaic';
  const isList = !mosaic && props?.layout === 'list_1xN';
  const cols = mosaic ? 2 : props?.layout === 'grid_3x3' ? 3 : isList ? 1 : 2;
  // ★ 2026-07-15 풀화면(full_bleed) = 완성 이미지 화면 꽉 채움. SSR renderGallery와 미러(패딩·테두리·라운드·간격 0).
  const fullBleed = props?.full_bleed === true;
  const radius = fullBleed ? 0 : 6;
  // list_1xN(세로 1열) = 완성 이미지/디자인 시안 대응: 원본 비율 풀폭(크롭 X). grid류는 1:1 cover 유지.
  const imgStyle: React.CSSProperties = isList
    ? { width: '100%', height: 'auto', display: 'block', borderRadius: radius }
    : { width: '100%', aspectRatio: '1', objectFit: 'cover', borderRadius: radius };
  const sectionStyle: React.CSSProperties = fullBleed
    ? { padding: 0, margin: 0 }
    : CARD_STYLE;
  return (
    <div className="dm-section dm-gallery" style={sectionStyle}>
      {props.title && <div style={fullBleed ? { ...TITLE_STYLE, padding: 'var(--dm-sp-4) var(--dm-sp-5) 0' } : TITLE_STYLE}>{props.title}</div>}
      {images.length === 0 ? (
        <div style={PLACEHOLDER_STYLE}>[이미지를 추가해주세요]</div>
      ) : (
        <div className="dm-gal-grid" style={{ display: 'grid', gridTemplateColumns: `repeat(${cols}, 1fr)`, gap: fullBleed ? 0 : (isList ? 10 : 6) }}>
          {images.map((img, i) => (
            <img
              key={i}
              src={dmImageUrl(img.url)}
              alt={img.caption || ''}
              style={mosaic && i === 0
                ? { width: '100%', aspectRatio: '16/10', objectFit: 'cover', borderRadius: fullBleed ? 0 : 10, gridColumn: '1 / -1' }
                : imgStyle}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export function SlideshowSection({ props }: { props: SlideshowProps }) {
  const slides = props?.slides || [];
  const [idx, setIdx] = useState(0);
  const cur = slides[idx];
  return (
    <div className="dm-section dm-slideshow" style={{ ...CARD_STYLE, position: 'relative' }}>
      {slides.length === 0 ? (
        <div style={PLACEHOLDER_STYLE}>[슬라이드를 추가해주세요]</div>
      ) : (
        <>
          {cur?.image_url ? (
            <img src={dmImageUrl(cur.image_url)} alt={cur.caption || ''} style={{ width: '100%', aspectRatio: '16/9', objectFit: 'cover', borderRadius: 8 }} />
          ) : (
            <div style={{ width: '100%', aspectRatio: '16/9', background: 'var(--dm-neutral-100)', borderRadius: 8 }} />
          )}
          {cur?.caption && <div style={{ fontSize: 13, color: 'var(--dm-neutral-700)', marginTop: 8 }}>{cur.caption}</div>}
          <div style={{ display: 'flex', justifyContent: 'center', gap: 6, marginTop: 10 }}>
            {slides.map((_, i) => (
              <button
                key={i}
                onClick={() => setIdx(i)}
                style={{
                  width: 8, height: 8, borderRadius: '50%',
                  background: i === idx ? 'var(--dm-primary)' : 'var(--dm-neutral-300)',
                  border: 'none', cursor: 'pointer',
                }}
                aria-label={`슬라이드 ${i + 1}`}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

export function TabCardsSection({ props }: { props: TabCardsProps }) {
  const tabs = props?.tabs || [];
  const [idx, setIdx] = useState(props?.default_tab_index || 0);
  const cur = tabs[idx];
  return (
    <div className="dm-section dm-tab-cards" style={CARD_STYLE}>
      <div style={{ display: 'flex', gap: 4, borderBottom: '1px solid var(--dm-neutral-200)', marginBottom: 12 }}>
        {tabs.map((t, i) => (
          <button
            key={i}
            onClick={() => setIdx(i)}
            style={{
              padding: '8px 12px',
              background: 'transparent',
              border: 'none',
              borderBottom: i === idx ? '2px solid var(--dm-primary)' : '2px solid transparent',
              color: i === idx ? 'var(--dm-primary)' : 'var(--dm-neutral-600)',
              fontSize: 13, fontWeight: 600, cursor: 'pointer',
            }}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div style={{ fontSize: 13, color: 'var(--dm-neutral-800)', lineHeight: 1.6 }}>
        {cur?.content || <span style={PLACEHOLDER_STYLE}>[내용을 추가해주세요]</span>}
      </div>
    </div>
  );
}

// ────────────── 카테고리 B. 인터랙션 수집형 ──────────────

export function PollSection({ props }: { props: PollProps }) {
  const options = props?.options || [];
  return (
    <div className="dm-section dm-poll" style={CARD_STYLE}>
      <div style={TITLE_STYLE}>{props.question || '[질문을 작성해주세요]'}</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {options.map((o) => (
          <button
            key={o.id}
            style={{
              padding: '10px 14px',
              background: 'var(--dm-neutral-50)',
              border: '1px solid var(--dm-neutral-200)',
              borderRadius: 8, fontSize: 13, fontWeight: 500, color: 'var(--dm-neutral-900)',
              cursor: 'pointer', textAlign: 'left',
            }}
          >
            {o.label}
          </button>
        ))}
      </div>
      {props.one_vote_per_user && (
        <div style={{ fontSize: 11, color: 'var(--dm-neutral-500)', marginTop: 8 }}>1인 1회 투표</div>
      )}
    </div>
  );
}

export function SurveySection({ props }: { props: SurveyProps }) {
  const questions = props?.questions || [];
  return (
    <div className="dm-section dm-survey" style={CARD_STYLE}>
      {props.title && <div style={TITLE_STYLE}>{props.title}</div>}
      {questions.length === 0 ? (
        <div style={PLACEHOLDER_STYLE}>[설문 질문을 추가해주세요]</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {questions.map((q) => (
            <div key={q.id}>
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--dm-neutral-900)', marginBottom: 6 }}>
                {q.question}
                {q.required && <span style={{ color: 'var(--dm-error)' }}> *</span>}
              </div>
              {q.type === 'text' ? (
                <input style={{ width: '100%', padding: 8, border: '1px solid var(--dm-neutral-200)', borderRadius: 6, fontSize: 13 }} placeholder="답변" />
              ) : q.type === 'rating' ? (
                <div style={{ display: 'flex', gap: 4 }}>
                  {[1, 2, 3, 4, 5].map((n) => <span key={n} style={{ fontSize: 20, color: 'var(--dm-neutral-300)' }}>★</span>)}
                </div>
              ) : (
                (q.options || []).map((opt, i) => (
                  <label key={i} style={{ display: 'block', padding: '6px 0', fontSize: 13 }}>
                    <input type={q.type === 'multiple' ? 'checkbox' : 'radio'} name={q.id} style={{ marginRight: 8 }} />
                    {opt}
                  </label>
                ))
              )}
            </div>
          ))}
        </div>
      )}
      {props.completion_reward_text && (
        <div style={{ fontSize: 12, color: 'var(--dm-primary)', marginTop: 12, fontWeight: 600 }}>{props.completion_reward_text}</div>
      )}
    </div>
  );
}

export function EmailCaptureSection({ props }: { props: EmailCaptureProps }) {
  return (
    <div className="dm-section dm-email-capture" style={CARD_STYLE}>
      <div style={TITLE_STYLE}>{props.headline || '[헤드라인을 작성해주세요]'}</div>
      {props.description && (
        <div style={{ fontSize: 13, color: 'var(--dm-neutral-700)', marginBottom: 12, lineHeight: 1.6 }}>{props.description}</div>
      )}
      <input
        type="email"
        placeholder="이메일 주소"
        style={{ width: '100%', padding: 10, border: '1px solid var(--dm-neutral-200)', borderRadius: 6, fontSize: 13, marginBottom: 10 }}
      />
      <label style={{ display: 'flex', alignItems: 'flex-start', gap: 6, fontSize: 12, color: 'var(--dm-neutral-700)', marginBottom: 10 }}>
        <input type="checkbox" style={{ marginTop: 2 }} />
        <span>{props.consent_text}</span>
      </label>
      <button
        style={{
          width: '100%', height: 40, background: 'var(--dm-primary)', color: '#fff',
          border: 'none', borderRadius: 6, fontSize: 13, fontWeight: 700, cursor: 'pointer',
        }}
      >
        {props.reward_description ? `참여하고 ${props.reward_description}` : '참여하기'}
      </button>
      {props.legal_notice && (
        <div style={{ fontSize: 10, color: 'var(--dm-neutral-500)', marginTop: 8, lineHeight: 1.5 }}>{props.legal_notice}</div>
      )}
    </div>
  );
}

export function ClickRewardsSection({ props }: { props: ClickRewardsProps }) {
  const iconMap: Record<string, 'heart' | 'star'> = { like: 'heart', share: 'star', scroll: 'star' };
  return (
    <div className="dm-section dm-click-rewards" style={CARD_STYLE}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--dm-sp-3)', marginBottom: 'var(--dm-sp-2)' }}>
        <div style={{ color: 'var(--dm-accent)' }}><DmIcon name={iconMap[props.reward_type] || 'star'} size={28} /></div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 'var(--dm-fs-small)', fontWeight: 600, color: 'var(--dm-neutral-900)' }}>{props.reward_description}</div>
          {props.show_progress && (
            <div style={{ fontSize: 'var(--dm-fs-tiny)', color: 'var(--dm-neutral-500)', marginTop: 2 }}>
              목표 {props.target_count}회
            </div>
          )}
        </div>
      </div>
      {props.show_progress && (
        <div style={{ width: '100%', height: 6, background: 'var(--dm-neutral-200)', borderRadius: 'var(--dm-radius-full)', overflow: 'hidden' }}>
          <div style={{ width: '0%', height: '100%', background: 'var(--dm-accent)' }} />
        </div>
      )}
    </div>
  );
}

// ────────────── 카테고리 C. 참여형 이벤트 ──────────────

export function LuckyDrawSection({ props }: { props: LuckyDrawProps }) {
  return (
    <div className="dm-section dm-lucky-draw">
      <DmEventCard accentVar="--dm-accent" icon="gift" overline="EVENT">
        <div style={TITLE_STYLE}>{props.title || '[추첨 이벤트 제목을 작성해주세요]'}</div>
        {props.description && (
          <div style={{ fontSize: 'var(--dm-fs-small)', color: 'var(--dm-neutral-700)', marginBottom: 'var(--dm-sp-3)', lineHeight: 1.6 }}>{props.description}</div>
        )}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--dm-sp-2)', marginBottom: 'var(--dm-sp-3)' }}>
          {(props.form_fields || []).map((f) => (
            <input
              key={f.name}
              placeholder={f.name === 'name' ? '이름' : f.name === 'phone' ? '전화번호' : '이메일'}
              style={{ padding: 12, border: '1px solid var(--dm-neutral-300)', borderRadius: 'var(--dm-radius-md)', fontSize: 'var(--dm-fs-small)', background: 'var(--dm-bg)' }}
              required={f.required}
            />
          ))}
        </div>
        <label style={{ display: 'flex', alignItems: 'flex-start', gap: 6, fontSize: 'var(--dm-fs-tiny)', color: 'var(--dm-neutral-600)', marginBottom: 'var(--dm-sp-3)' }}>
          <input type="checkbox" style={{ marginTop: 2 }} />
          <span>{props.consent_text}</span>
        </label>
        <button style={{ ...DM_CTA_STYLE, width: '100%' }}>응모하기</button>
        {props.draw_at && (
          <div style={{ fontSize: 'var(--dm-fs-tiny)', color: 'var(--dm-neutral-500)', marginTop: 'var(--dm-sp-2)', textAlign: 'center' }}>
            발표: {new Date(props.draw_at).toLocaleString('ko-KR')}
          </div>
        )}
      </DmEventCard>
    </div>
  );
}

export function RouletteSection({ props }: { props: RouletteProps }) {
  const segments = props?.segments || [];
  return (
    <div className="dm-section dm-roulette">
      <DmEventCard accentVar="--dm-primary" icon="wheel" overline="EVENT">
        <div style={TITLE_STYLE}>룰렛 이벤트</div>
        <div
          style={{
            width: 200, height: 200, borderRadius: '50%',
            background: 'conic-gradient(var(--dm-primary) 0deg 45deg, var(--dm-primary-light) 45deg 90deg, var(--dm-accent) 90deg 135deg, var(--dm-neutral-100) 135deg 180deg, var(--dm-primary) 180deg 225deg, var(--dm-primary-light) 225deg 270deg, var(--dm-accent) 270deg 315deg, var(--dm-neutral-100) 315deg 360deg)',
            margin: '12px auto',
            border: '4px solid var(--dm-bg)',
            boxShadow: 'var(--dm-shadow-md)',
          }}
        />
        <button style={DM_CTA_STYLE}>룰렛 돌리기</button>
        {props.one_spin_per_user && (
          <div style={{ fontSize: 'var(--dm-fs-tiny)', color: 'var(--dm-neutral-500)', marginTop: 'var(--dm-sp-2)' }}>1인 1회 한정</div>
        )}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, justifyContent: 'center', marginTop: 'var(--dm-sp-3)' }}>
          {segments.map((s) => (
            <span key={s.id} style={{ fontSize: 'var(--dm-fs-tiny)', padding: '4px 8px', background: 'var(--dm-bg)', border: '1px solid var(--dm-neutral-200)', borderRadius: 'var(--dm-radius-full)', color: 'var(--dm-neutral-700)' }}>
              {s.label}
            </span>
          ))}
        </div>
      </DmEventCard>
    </div>
  );
}

export function InstantCouponSection({ props }: { props: InstantCouponProps }) {
  return (
    <div className="dm-section dm-instant-coupon">
      <div style={{ padding: 'var(--dm-sp-6) var(--dm-sp-5)', background: 'var(--dm-primary-light)', border: '2px dashed var(--dm-primary)', borderRadius: 'var(--dm-radius-xl)', margin: 'var(--dm-sp-3) 0' }}>
        <div style={{ color: 'var(--dm-primary)', marginBottom: 'var(--dm-sp-3)' }}><DmIcon name="ticket" size={26} /></div>
        <div style={{ ...TITLE_STYLE, color: 'var(--dm-primary)' }}>{props.coupon_label}</div>
        <div style={{ fontSize: 'var(--dm-fs-small)', color: 'var(--dm-neutral-700)', marginBottom: 'var(--dm-sp-3)' }}>{props.discount_description}</div>
        {props.expires_at && (
          <div style={{ fontSize: 'var(--dm-fs-tiny)', color: 'var(--dm-primary)', marginBottom: 'var(--dm-sp-3)', fontWeight: 600 }}>
            만료: {new Date(props.expires_at).toLocaleString('ko-KR')}
          </div>
        )}
        <button style={DM_CTA_STYLE}>쿠폰 받기</button>
        {props.conditions && (
          <div style={{ fontSize: 'var(--dm-fs-tiny)', color: 'var(--dm-neutral-500)', marginTop: 'var(--dm-sp-2)', whiteSpace: 'pre-wrap' }}>{props.conditions}</div>
        )}
        {props.usage_instructions && (
          <div style={{ fontSize: 'var(--dm-fs-tiny)', color: 'var(--dm-neutral-500)', marginTop: 4, whiteSpace: 'pre-wrap' }}>{props.usage_instructions}</div>
        )}
      </div>
    </div>
  );
}

export function LimitedQuantitySection({ props }: { props: LimitedQuantityProps }) {
  const remaining = props.current_remaining ?? props.total_quantity;
  const percent = props.total_quantity > 0 ? (remaining / props.total_quantity) * 100 : 0;
  return (
    <div className="dm-section dm-limited-quantity">
      <DmEventCard accentVar="--dm-accent" icon="clock" overline="LIMITED">
        <div style={TITLE_STYLE}>{props.title || '[선착순 이벤트 제목을 작성해주세요]'}</div>
        {props.description && (
          <div style={{ fontSize: 'var(--dm-fs-small)', color: 'var(--dm-neutral-700)', marginBottom: 'var(--dm-sp-3)', lineHeight: 1.6 }}>{props.description}</div>
        )}
        <div style={{ marginBottom: 'var(--dm-sp-3)' }}>
          <div style={{ fontSize: 'var(--dm-fs-tiny)', color: 'var(--dm-neutral-600)', marginBottom: 6, display: 'flex', justifyContent: 'space-between' }}>
            <span>남은 수량</span>
            <span style={{ fontWeight: 700 }}>{remaining} / {props.total_quantity}</span>
          </div>
          <div style={{ width: '100%', height: 8, background: 'var(--dm-neutral-200)', borderRadius: 'var(--dm-radius-full)', overflow: 'hidden' }}>
            <div style={{ width: `${percent}%`, height: '100%', background: 'var(--dm-accent)', transition: 'width 0.3s' }} />
          </div>
        </div>
        <button style={{ ...DM_CTA_STYLE, width: '100%' }}>선착순 참여하기</button>
      </DmEventCard>
    </div>
  );
}

// ────────────── 카테고리 D. 외부 임베드 + 매장 안내 ──────────────

function getYoutubeId(url: string): string | null {
  const match = url.match(/(?:youtu\.be\/|v=|embed\/)([A-Za-z0-9_-]{11})/);
  return match ? match[1] : null;
}

export function YoutubeEmbedSection({ props }: { props: YoutubeEmbedProps }) {
  const videoId = props.video_url ? getYoutubeId(props.video_url) : null;
  return (
    <div className="dm-section dm-youtube-embed" style={CARD_STYLE}>
      {videoId ? (
        <div style={{ position: 'relative', paddingBottom: '56.25%', height: 0 }}>
          <iframe
            src={`https://www.youtube.com/embed/${videoId}${props.auto_play ? '?autoplay=1&mute=1' : ''}`}
            title="YouTube"
            style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', border: 'none', borderRadius: 8 }}
            allow="autoplay; encrypted-media"
            allowFullScreen
          />
        </div>
      ) : (
        <div style={{ width: '100%', aspectRatio: '16/9', background: 'var(--dm-neutral-100)', borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--dm-neutral-500)', fontSize: 13 }}>
          [YouTube URL을 입력해주세요]
        </div>
      )}
    </div>
  );
}

export function InstagramEmbedSection({ props }: { props: InstagramEmbedProps }) {
  return (
    <div className="dm-section dm-instagram-embed" style={CARD_STYLE}>
      {props.post_url ? (
        <a
          href={props.post_url}
          target="_blank"
          rel="noopener noreferrer"
          style={{
            display: 'block',
            padding: 'var(--dm-sp-5)',
            background: 'var(--dm-neutral-50)',
            border: '1px solid var(--dm-neutral-200)',
            borderRadius: 'var(--dm-radius-md)',
            textAlign: 'center',
            textDecoration: 'none',
            boxShadow: 'var(--dm-shadow-sm)',
          }}
        >
          <div style={{ color: 'var(--dm-accent)', display: 'flex', justifyContent: 'center', marginBottom: 6 }}><DmIcon name="image" size={26} /></div>
          <div style={{ fontSize: 'var(--dm-fs-small)', fontWeight: 600, color: 'var(--dm-neutral-800)' }}>Instagram 게시물 보기</div>
        </a>
      ) : (
        <div style={PLACEHOLDER_STYLE}>[Instagram URL을 입력해주세요]</div>
      )}
    </div>
  );
}

export function MapStoreLocatorSection({ props }: { props: MapStoreLocatorProps }) {
  const stores = props?.stores || [];
  return (
    <div className="dm-section dm-map-store-locator" style={CARD_STYLE}>
      <div style={{ ...TITLE_STYLE, display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{ color: 'var(--dm-primary)' }}><DmIcon name="map" size={18} /></span>매장 찾기
      </div>
      <div style={{
        width: '100%',
        height: 200,
        background: 'var(--dm-neutral-100)',
        borderRadius: 'var(--dm-radius-md)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: 'var(--dm-neutral-400)',
        marginBottom: 'var(--dm-sp-3)',
      }}>
        <DmIcon name="map" size={32} />
      </div>
      {stores.length === 0 ? (
        <div style={PLACEHOLDER_STYLE}>[매장 정보를 추가해주세요]</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--dm-sp-2)' }}>
          {stores.map((s) => (
            <div key={s.id} style={{ padding: 'var(--dm-sp-3)', background: 'var(--dm-neutral-50)', borderRadius: 'var(--dm-radius-md)' }}>
              <div style={{ fontSize: 'var(--dm-fs-small)', fontWeight: 600, color: 'var(--dm-neutral-900)' }}>{s.name}</div>
              <div style={{ fontSize: 'var(--dm-fs-tiny)', color: 'var(--dm-neutral-600)', marginTop: 2 }}>{s.address}</div>
              {s.phone && (
                <div style={{ fontSize: 'var(--dm-fs-tiny)', color: 'var(--dm-primary)', marginTop: 4 }}>전화 {s.phone}</div>
              )}
              {s.hours && (
                <div style={{ fontSize: 'var(--dm-fs-tiny)', color: 'var(--dm-neutral-500)', marginTop: 2 }}>영업 {s.hours}</div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function ReviewsSection({ props, treatment }: { props: ReviewsProps; treatment?: string }) {
  const reviews = props?.reviews || [];
  const avg = reviews.length > 0
    ? (reviews.reduce((sum, r) => sum + (r.rating || 0), 0) / reviews.length).toFixed(1)
    : '0.0';
  // ★ 2026-07-13 디자인 3.0 — quote 구도 미러 (SSR renderReviewsQuote와 구조 동일)
  if (treatment === 'quote' && reviews.length > 0) {
    const [first, ...rest] = reviews.slice(0, 3);
    return (
      <div className="dm-section dm-reviews" style={{ padding: 'calc(var(--dm-sp-8) * var(--dm-section-pad-scale)) var(--dm-sp-6)' }}>
        {props.title && <div style={TITLE_STYLE}>{props.title}</div>}
        <div aria-hidden="true" style={{ fontFamily: 'var(--dm-font-display)', fontSize: 52, lineHeight: 0.6, color: 'var(--dm-accent)', opacity: 0.85 }}>&ldquo;</div>
        <div style={{ marginTop: 'var(--dm-sp-3)', fontSize: 'var(--dm-fs-h2)', fontWeight: 700, lineHeight: 1.55, fontFamily: 'var(--dm-font-display)', color: 'var(--dm-neutral-900)' }}>{first.body}</div>
        <div style={{ marginTop: 'var(--dm-sp-3)', display: 'flex', gap: 8, alignItems: 'baseline' }}>
          <span style={{ color: 'var(--dm-accent)', letterSpacing: 2, fontSize: 'var(--dm-fs-small)' }}>{'★'.repeat(first.rating || 0)}{'☆'.repeat(Math.max(0, 5 - (first.rating || 0)))}</span>
          <span style={{ fontSize: 'var(--dm-fs-tiny)', color: 'var(--dm-neutral-500)' }}>{first.author}</span>
        </div>
        {rest.length > 0 && (
          <div style={{ marginTop: 'var(--dm-sp-5)' }}>
            {rest.map((r, i) => (
              <div key={i} style={{ display: 'flex', gap: 10, alignItems: 'baseline', padding: '10px 0', borderTop: '1px solid var(--dm-neutral-200)', textAlign: 'left' }}>
                <span style={{ color: 'var(--dm-accent)', fontSize: 'var(--dm-fs-tiny)', letterSpacing: 1, flexShrink: 0 }}>{'★'.repeat(r.rating || 0)}</span>
                <span style={{ flex: 1, fontSize: 'var(--dm-fs-small)', color: 'var(--dm-neutral-700)', lineHeight: 1.6 }}>{r.body}</span>
                <span style={{ fontSize: 'var(--dm-fs-tiny)', color: 'var(--dm-neutral-500)', flexShrink: 0 }}>{r.author}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }
  return (
    <div className="dm-section dm-reviews" style={CARD_STYLE}>
      {props.title && <div style={TITLE_STYLE}>{props.title}</div>}
      {props.show_average_rating !== false && reviews.length > 0 && (
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 'var(--dm-sp-3)' }}>
          <span style={{ fontSize: 'var(--dm-fs-h1)', fontWeight: 700, color: 'var(--dm-neutral-900)' }}>{avg}</span>
          <span style={{ color: 'var(--dm-accent)' }}>★★★★★</span>
          <span style={{ fontSize: 'var(--dm-fs-tiny)', color: 'var(--dm-neutral-500)' }}>({reviews.length}건)</span>
        </div>
      )}
      {reviews.length === 0 ? (
        <div style={PLACEHOLDER_STYLE}>[리뷰를 추가해주세요]</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--dm-sp-2)' }}>
          {reviews.slice(0, 3).map((r, i) => (
            <div key={i} style={{ padding: 'var(--dm-sp-3)', background: 'var(--dm-neutral-50)', borderRadius: 'var(--dm-radius-md)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                <span style={{ color: 'var(--dm-accent)', fontSize: 'var(--dm-fs-small)', letterSpacing: 1 }}>{'★'.repeat(r.rating)}{'☆'.repeat(5 - r.rating)}</span>
                <span style={{ fontSize: 'var(--dm-fs-tiny)', color: 'var(--dm-neutral-500)' }}>{r.author}</span>
              </div>
              <div style={{ fontSize: 'var(--dm-fs-small)', color: 'var(--dm-neutral-800)', lineHeight: 1.5 }}>{r.body}</div>
              {r.date && (
                <div style={{ fontSize: 'var(--dm-fs-tiny)', color: 'var(--dm-neutral-400)', marginTop: 4 }}>{r.date}</div>
              )}
            </div>
          ))}
        </div>
      )}
      {props.show_more_link && reviews.length > 3 && (
        <a href={props.show_more_link} style={{ display: 'block', textAlign: 'center', marginTop: 10, fontSize: 12, color: 'var(--dm-primary)', textDecoration: 'none' }}>
          전체 리뷰 보기 →
        </a>
      )}
    </div>
  );
}
