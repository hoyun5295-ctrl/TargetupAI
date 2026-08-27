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
import { useState, type CSSProperties } from 'react';
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
// ★ 2026-07-22 탭 카드 content_type='product_list' — 발행 SSR과 같은 붙여넣기 파서 재사용(편집=단말).
import { parsePastedProducts } from '../../../utils/product-paste';
import { DmIcon, DmEventCard, DM_CTA_STYLE } from './dm-primitives';

// ────────────── 공통 영역 ──────────────

// ★ 2026-07-21 발행 SSR 섹션 셸 정합(Codex 지적) — 발행 dm-section은 카드 테두리·radius·margin 없이 padding만.
//   편집 캔버스도 동일하게(편집=발행). LG=상품/갤러리/탭카드/매장/후기(sp-6 sp-5), SM=슬라이드쇼/유튜브/인스타(sp-4).
//   이벤트형(투표/설문/이메일수집/클릭리워드/추첨/룰렛/선착순)은 DmEventCard 셸(발행 dmEventCard 미러).
const SECTION_SHELL_LG: React.CSSProperties = { padding: 'var(--dm-sp-6) var(--dm-sp-5)' };
const SECTION_SHELL_SM: React.CSSProperties = { padding: 'var(--dm-sp-4)' };

// 발행 SSR도 인라인 fs-h3로 제목을 그리는 섹션 전용(설문·추첨·선착순 — dm-section-renderer 964/1007/1046).
const TITLE_STYLE: React.CSSProperties = {
  fontSize: 'var(--dm-fs-h3)',
  fontWeight: 700,
  color: 'var(--dm-neutral-900)',
  marginBottom: 'var(--dm-sp-2)',
};

// ★ 2026-07-20 남지현 재오픈("편집 화면 ≠ 출력 화면") 근본 — 발행 SSR은 섹션 제목에 dm-text-h2 클래스를 붙이는데
//   편집 캔버스는 클래스 없는 div였다. 아트디렉션 모티프(rule = 제목 위 30x3 강조색 막대 / bracket / index)가
//   `.dm-text-h2::before`·`::after`로 걸리는 구조라, 클래스가 없으면 편집 화면에서만 장식이 통째로 사라진다.
//   크기(h2)·굵기는 클래스가 주므로 인라인에 두지 않는다(인라인이 클래스를 덮어 h3로 되돌아감).
//   여백은 SSR과 동일하게 sp-4, 후기 classic만 sp-3(dm-section-renderer 1117).
const H2_TITLE_STYLE: React.CSSProperties = {
  color: 'var(--dm-neutral-900)',
  marginBottom: 'var(--dm-sp-4)',
};

// ★ 2026-08-26 상품 슬라이드 제목 크기·색(임은지 신고) — classic·list·focus 세 구도가 이 함수 하나를 쓴다.
//   구도마다 따로 쓰면 한 구도에만 먹는 결함이 다시 난다(2026-07-16 서수란 선례). SSR productTitleHtml 미러.
//   미지정이면 H2_TITLE_STYLE 그대로 = 현행.
const productTitleStyle = (p: { title_size?: 'sm' | 'md' | 'lg'; title_color?: string }): React.CSSProperties => ({
  ...H2_TITLE_STYLE,
  ...(p?.title_color ? { color: p.title_color } : null),
  ...(p?.title_size === 'sm'
    ? { fontSize: 'var(--dm-fs-body)' }
    : p?.title_size === 'lg'
      ? { fontSize: 'var(--dm-fs-h1)' }
      : null),
});

const H2_TITLE_STYLE_TIGHT: React.CSSProperties = {
  color: 'var(--dm-neutral-900)',
  marginBottom: 'var(--dm-sp-3)',
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
        {props.title && <div className="dm-text-h2" style={productTitleStyle(props)}>{props.title}</div>}
        <div className="dm-pc-items" style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
          <div style={{ width: '100%', background: cardBg, border: '1px solid var(--dm-neutral-200)', borderRadius: 18, overflow: 'hidden', boxShadow: 'var(--dm-shadow-md)' }}>
            {first.image_url ? <img src={dmImageUrl(first.image_url)} alt={first.name} style={{ width: '100%', height: focusBigH, display: 'block', ...imgFit }} /> : <div style={{ width: '100%', height: focusBigH, background: 'var(--dm-neutral-100)' }} />}
            <div style={{ padding: '14px 16px 16px', background: cardBg }}>
              <div style={{ fontSize: 'var(--dm-fs-h3)', fontWeight: 700, color: 'var(--dm-neutral-900)', lineHeight: 1.4, overflowWrap: 'break-word', whiteSpace: 'pre-line' }}>{first.name}</div>
              <div style={{ marginTop: 6 }}>{priceRow(first, true)}</div>
            </div>
          </div>
          {rest.map((p, i) => (
            <div key={p.id || i} style={{ width: 'calc(50% - 6px)', background: cardBg, border: '1px solid var(--dm-neutral-200)', borderRadius: 14, overflow: 'hidden', boxShadow: 'var(--dm-shadow-sm)', display: 'flex', flexDirection: 'column' }}>
              {p.image_url ? <img src={dmImageUrl(p.image_url)} alt={p.name} style={{ width: '100%', height: focusRestH, display: 'block', flexShrink: 0, ...imgFit }} /> : <div style={{ width: '100%', height: focusRestH, background: 'var(--dm-neutral-100)', flexShrink: 0 }} />}
              <div style={{ padding: '8px 10px 10px', flex: 1, display: 'flex', flexDirection: 'column', background: cardBg }}>
                <div style={{ fontSize: 'var(--dm-fs-small)', fontWeight: 600, color: 'var(--dm-neutral-900)', lineHeight: 1.4, overflowWrap: 'break-word', whiteSpace: 'pre-line' }}>{p.name}</div>
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
        {props.title && <div className="dm-text-h2" style={productTitleStyle(props)}>{props.title}</div>}
        <div className="dm-pc-items" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {products.map((p, i) => (
            <div key={p.id || i} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 12px', background: cardBg, border: '1px solid var(--dm-neutral-200)', borderRadius: 14 }}>
              {p.image_url ? <img src={dmImageUrl(p.image_url)} alt={p.name} style={{ width: listThumbH, height: listThumbH, borderRadius: 12, flexShrink: 0, ...imgFit }} /> : <div style={{ width: listThumbH, height: listThumbH, background: 'var(--dm-neutral-100)', borderRadius: 12, flexShrink: 0 }} />}
              <div style={{ flex: 1, minWidth: 0, textAlign: 'left' }}>
                <div style={{ fontSize: 'var(--dm-fs-small)', fontWeight: 600, color: 'var(--dm-neutral-900)', lineHeight: 1.4, overflowWrap: 'break-word', whiteSpace: 'pre-line' }}>{p.name}</div>
                <div style={{ marginTop: 4 }}>{priceRow(p, false)}</div>
              </div>
              {p.link_url ? <span aria-hidden="true" style={{ color: 'var(--dm-neutral-400)', flexShrink: 0 }}>→</span> : null}
            </div>
          ))}
        </div>
      </div>
    );
  }
  // ★ 2026-07-21 (#4a 임은지) classic = 상품 3개 초과 시 가로 스와이프 캐러셀 + 인디케이터 (SSR renderProductCarousel 미러). 2개 이하 = 기존 그리드.
  // ★ 2026-07-22 (임은지 재신고) 점=페이지 단위(ceil(N/PC_PER_PAGE)). 카드를 페이지당 PC_PER_PAGE개씩 페이지 래퍼(.dm-pc-page)로 묶어
  //   각 페이지가 scroll-snap-align:start → 스크롤 자식=페이지, 점=페이지 수. 발행 SSR renderProductCarousel과 동일 구조.
  const PC_PER_PAGE = 2; // = DM_PRODUCT_CAROUSEL_PER_PAGE (SoT: 백엔드 dm-property-contract.ts). 카드 2개 = 1페이지.
  const isScroll = products.length > 2;
  const showDots = isScroll && props.show_indicator !== false;
  const cardEls = products.map((p, i) => {
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
      //   가격 줄 = 카드 하단 고정(marginTop auto)로 같은 행 카드 가격 위치 일정(임은지 건의 유지).
      //   ★ 2026-07-22 스와이프 스냅은 카드가 아니라 페이지(.dm-pc-page)가 담당 → 카드에서 scrollSnapAlign 제거.
      <div key={p.id || i} style={{ ...(isScroll ? { flex: '0 0 calc(50% - 6px)' } : { width: 'calc(50% - 8px)' }), maxWidth: 220, boxSizing: 'border-box', display: 'flex', flexDirection: 'column', background: cardBg, border: '1px solid var(--dm-neutral-200)', borderRadius: 16, overflow: 'hidden', boxShadow: 'var(--dm-shadow-sm)' }}>
        {p.image_url ? (
          <img src={dmImageUrl(p.image_url)} alt={p.name} style={{ width: '100%', height: imgH, display: 'block', flexShrink: 0, ...imgFit }} />
        ) : (
          <div style={{ width: '100%', height: imgH, background: 'var(--dm-neutral-100)', flexShrink: 0 }} />
        )}
        <div style={{ padding: '10px 12px 12px', flex: 1, display: 'flex', flexDirection: 'column', background: cardBg }}>
          <div style={{ fontSize: 'var(--dm-fs-small)', fontWeight: 600, color: 'var(--dm-neutral-900)', lineHeight: 1.4, whiteSpace: 'pre-line' }}>{p.name}</div>
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
  });
  // 스크롤이면 카드를 페이지 단위로 묶는다(발행 SSR 페이지 래퍼 미러). 그리드면 카드 나열.
  const pcPages: React.ReactElement[] = [];
  if (isScroll) {
    for (let i = 0; i < cardEls.length; i += PC_PER_PAGE) {
      pcPages.push(
        <div key={i} className="dm-pc-page" style={{ flex: '0 0 100%', boxSizing: 'border-box', scrollSnapAlign: 'start', display: 'flex', gap: 12 }}>
          {cardEls.slice(i, i + PC_PER_PAGE)}
        </div>,
      );
    }
  }
  const pageCount = pcPages.length;
  return (
    <div className="dm-section dm-product-carousel" style={props.background_color ? { ...SECTION_SHELL_LG, background: props.background_color } : SECTION_SHELL_LG}>
      {props.title && <div className="dm-text-h2" style={productTitleStyle(props)}>{props.title}</div>}
      {products.length === 0 ? (
        <div style={PLACEHOLDER_STYLE}>[상품을 추가해주세요]</div>
      ) : (
        <>
        <div className="dm-pc-items" style={isScroll
          ? { display: 'flex', flexWrap: 'nowrap', overflowX: 'auto', scrollSnapType: 'x mandatory', gap: 0 }
          : { display: 'flex', flexWrap: 'wrap', justifyContent: 'var(--dm-section-justify, center)', gap: 12 }}>
          {isScroll ? pcPages : cardEls}
        </div>
        {/* ★ 2026-07-22 (임은지 재신고) 인디케이터 점 = 페이지 수(ceil(N/2)). 발행 SSR renderProductCarousel 미러. 캔버스는 미리보기라 첫 점 활성 정적. */}
        {showDots && (
          <div style={{ display: 'flex', justifyContent: 'center', gap: 6, marginTop: 'var(--dm-sp-3)' }}>
            {Array.from({ length: pageCount }, (_, i) => (
              <span key={i} style={{ width: 8, height: 8, borderRadius: '50%', background: i === 0 ? 'var(--dm-primary)' : 'var(--dm-neutral-300)' }} />
            ))}
          </div>
        )}
        </>
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
    : SECTION_SHELL_LG;
  return (
    <div className="dm-section dm-gallery" style={sectionStyle}>
      {props.title && <div className="dm-text-h2" style={fullBleed ? { ...H2_TITLE_STYLE, padding: 'var(--dm-sp-4) var(--dm-sp-5) 0' } : H2_TITLE_STYLE}>{props.title}</div>}
      {images.length === 0 ? (
        <div style={PLACEHOLDER_STYLE}>[이미지를 추가해주세요]</div>
      ) : (
        <div className="dm-gal-grid" style={{ display: 'grid', gridTemplateColumns: `repeat(${cols}, 1fr)`, gap: fullBleed ? 0 : (isList ? 10 : 6) }}>
          {images.map((img, i) => {
            const isMosaicFirst = mosaic && i === 0;
            return (
              <div key={i} style={isMosaicFirst ? { gridColumn: '1 / -1' } : undefined}>
                <img
                  src={dmImageUrl(img.url)}
                  alt={img.caption || ''}
                  style={isMosaicFirst
                    ? { width: '100%', aspectRatio: '16/10', objectFit: 'cover', borderRadius: fullBleed ? 0 : 10 }
                    : imgStyle}
                />
                {/* ★ 2026-07-21 갤러리 이미지별 캡션 표시(임은지 신고) — SSR renderGallery 미러. 미입력=미표시. */}
                {img.caption && (
                  <div style={{ fontSize: 'var(--dm-fs-small)', color: 'var(--dm-neutral-700)', marginTop: 'var(--dm-sp-2)', ...(fullBleed ? { padding: '0 var(--dm-sp-5)' } : {}) }}>
                    {img.caption}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function SlideshowSection({ props }: { props: SlideshowProps }) {
  const slides = props?.slides || [];
  const [idx, setIdx] = useState(0);
  const cur = slides[idx];
  // ★ 2026-07-30 (남지현 접수) 슬라이드 크기 — 발행 SSR(renderSlideshow) 미러. 16:9(기본)/1:1/3:4=cover, original=원본 비율(크롭 0).
  const ratio = (props?.slide_ratio === '1:1' || props?.slide_ratio === '3:4' || props?.slide_ratio === 'original') ? props.slide_ratio : '16:9';
  const slideImgStyle: CSSProperties = ratio === 'original'
    ? { width: '100%', height: 'auto', display: 'block', borderRadius: 8 }
    : { width: '100%', aspectRatio: ratio === '1:1' ? '1/1' : ratio === '3:4' ? '3/4' : '16/9', objectFit: 'cover', borderRadius: 8 };
  return (
    <div className="dm-section dm-slideshow" style={{ ...SECTION_SHELL_SM, position: 'relative' }}>
      {slides.length === 0 ? (
        <div style={PLACEHOLDER_STYLE}>[슬라이드를 추가해주세요]</div>
      ) : (
        <>
          {/* ★ 2026-07-21 (#2 임은지) 일시정지 버튼 — 발행물(renderSlideshow) 미러. 캔버스는 미리보기라 비상호작용(pointer-events:none). */}
          {props.show_pause !== false && slides.length > 1 && (
            <div aria-hidden style={{ position: 'absolute', top: 'var(--dm-sp-3)', right: 'var(--dm-sp-3)', width: 32, height: 32, borderRadius: 999, background: 'rgba(0,0,0,0.45)', color: '#fff', fontSize: 13, display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 2, pointerEvents: 'none' }}>⏸</div>
          )}
          {cur?.image_url ? (
            <img src={dmImageUrl(cur.image_url)} alt={cur.caption || ''} style={slideImgStyle} />
          ) : (
            <div style={{ width: '100%', aspectRatio: ratio === 'original' ? '16/9' : ratio === '1:1' ? '1/1' : ratio === '3:4' ? '3/4' : '16/9', background: 'var(--dm-neutral-100)', borderRadius: 8 }} />
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
  // ★ 2026-07-22 (임은지) content_type 실제 렌더 미러(발행 renderTabPanelContent) — image=이미지 / product_list=상품 행 / text=텍스트.
  const content = (cur?.content || '').trim();
  const plItems = cur?.content_type === 'product_list' ? parsePastedProducts(cur?.content || '') : [];
  let panel: React.ReactNode;
  if (!content) {
    panel = <span style={PLACEHOLDER_STYLE}>[내용을 추가해주세요]</span>;
  } else if (cur?.content_type === 'image') {
    panel = <img src={dmImageUrl(content)} alt="" style={{ width: '100%', height: 'auto', display: 'block', borderRadius: 'var(--dm-radius-md)' }} />;
  } else if (cur?.content_type === 'product_list' && plItems.length > 0) {
    panel = (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {plItems.map((it, i) => {
          const rate = it.discount_rate ?? (it.price && it.discount_price && it.discount_price < it.price ? Math.round((1 - it.discount_price / it.price) * 100) : null);
          const finalPrice = it.discount_price ?? it.price ?? 0;
          return (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', background: 'var(--dm-neutral-50)', border: '1px solid var(--dm-neutral-200)', borderRadius: 12 }}>
              <div style={{ flex: 1, minWidth: 0, textAlign: 'left' }}>
                <div style={{ fontSize: 'var(--dm-fs-small)', fontWeight: 600, color: 'var(--dm-neutral-900)' }}>{it.name}</div>
                {it.price ? (
                  <div style={{ marginTop: 2, fontVariantNumeric: 'tabular-nums' }}>
                    {rate !== null && <span style={{ fontSize: 'var(--dm-fs-tiny)', color: 'var(--dm-error)', fontWeight: 800 }}>{rate}% </span>}
                    <span style={{ fontWeight: 800 }}>{finalPrice.toLocaleString('ko-KR')}원</span>
                  </div>
                ) : null}
              </div>
              {it.link_url ? <span aria-hidden="true" style={{ color: 'var(--dm-neutral-400)', flexShrink: 0 }}>→</span> : null}
            </div>
          );
        })}
      </div>
    );
  } else {
    panel = <div style={{ fontSize: 'var(--dm-fs-small)', lineHeight: 1.7, whiteSpace: 'pre-wrap', color: 'var(--dm-neutral-700)' }}>{cur?.content}</div>;
  }
  return (
    <div className="dm-section dm-tab-cards" style={SECTION_SHELL_LG}>
      {/* ★ 2026-07-22 (임은지) 발행 SSR renderTabCards = 알약(pill) 세그먼트 탭(활성 #171717 배경+흰 글자). 편집 캔버스도 미러(옛 밑줄 탭 → 알약) = 편집=단말. */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 'var(--dm-sp-4)', flexWrap: 'wrap' }}>
        {tabs.map((t, i) => (
          <button
            key={i}
            onClick={() => setIdx(i)}
            style={{
              padding: '9px 16px',
              cursor: 'pointer',
              border: 'none',
              borderRadius: 999,
              // ★ 2026-07-23 (임은지) 활성 탭 배경/글씨색 지정(미지정=현행) + 글씨 크기=섹션 '제목 크기'(--dm-fs-tab). 발행 renderTabCards 미러.
              background: i === idx ? (props.tab_active_bg || '#171717') : 'var(--dm-neutral-100)',
              color: i === idx ? (props.tab_active_text_color || '#fff') : 'var(--dm-neutral-600)',
              fontSize: 'var(--dm-fs-tab, 13px)', fontWeight: 600,
              transition: 'all 150ms',
            }}
          >
            {t.label}
          </button>
        ))}
      </div>
      {panel}
    </div>
  );
}

// ────────────── 카테고리 B. 인터랙션 수집형 ──────────────

export function PollSection({ props }: { props: PollProps }) {
  const options = props?.options || [];
  // ★ 2026-07-21 발행 renderPoll이 dmEventCard(icon:poll·overline:POLL)로 감싸므로 셸을 DmEventCard로 정합(옛 단순 카드 → 편집=발행).
  return (
    <div className="dm-section dm-poll">
      <DmEventCard accentVar="--dm-primary" icon="poll" overline="POLL">
        <div className="dm-text-h2" style={H2_TITLE_STYLE}>{props.question || '[질문을 작성해주세요]'}</div>
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
        {/* ★ 2026-07-21 (#6 복수 선택) 발행 renderPoll 미러 — allow_multiple이면 [투표하기] 제출 버튼 */}
        {props.allow_multiple && (
          <button className="dm-cta dm-cta-primary" style={{ width: '100%', marginTop: 'var(--dm-sp-3)' }}>투표하기</button>
        )}
        {props.one_vote_per_user && (
          <div style={{ fontSize: 11, color: 'var(--dm-neutral-500)', marginTop: 8 }}>1인 1회 투표{props.allow_multiple ? ' · 복수 선택 가능' : ''}</div>
        )}
      </DmEventCard>
    </div>
  );
}

export function SurveySection({ props }: { props: SurveyProps }) {
  const questions = props?.questions || [];
  // ★ 2026-07-21 발행 renderSurvey가 dmEventCard(icon:survey·overline:SURVEY)로 감싸므로 셸을 DmEventCard로 정합.
  //   [의도적 차이] 발행은 질문 0개면 셸 없이 '[설문 질문을 추가해주세요]'만(early-return) — 편집기는 작성 도구라
  //   빈 상태에서도 제목·플레이스홀더를 유지(제목부터 쓰고 질문 채우는 흐름). Harold 결정(2026-07-21).
  return (
    <div className="dm-section dm-survey">
      <DmEventCard accentVar="--dm-primary" icon="survey" overline="SURVEY">
        {props.title && <div style={{ ...TITLE_STYLE, marginBottom: 'var(--dm-sp-3)' }}>{props.title}</div>}
        {/* ★ 2026-07-21 (#6 진행률) 발행 renderSurvey 미러 — show_progress면 진행률(캔버스는 정적 0/N 미리보기) */}
        {props.show_progress && questions.length > 0 && (
          <div style={{ fontSize: 11, color: 'var(--dm-neutral-500)', marginBottom: 'var(--dm-sp-3)', textAlign: 'left' }}>
            0 / {questions.length} 답변
            <div style={{ height: 4, background: 'var(--dm-neutral-200)', borderRadius: 2, marginTop: 4, overflow: 'hidden' }}>
              <div style={{ height: '100%', width: '0%', background: 'var(--dm-primary)' }} />
            </div>
          </div>
        )}
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
      </DmEventCard>
    </div>
  );
}

export function EmailCaptureSection({ props }: { props: EmailCaptureProps }) {
  // ★ 2026-07-21 발행 renderEmailCapture가 dmEventCard(icon:mail·overline:JOIN US)로 감싸므로 셸을 DmEventCard로 정합.
  return (
    <div className="dm-section dm-email-capture">
      <DmEventCard accentVar="--dm-primary" icon="mail" overline="JOIN US">
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
      </DmEventCard>
    </div>
  );
}

export function ClickRewardsSection({ props }: { props: ClickRewardsProps }) {
  const iconMap: Record<string, 'heart' | 'star'> = { like: 'heart', share: 'star', scroll: 'star' };
  // ★ 2026-07-21 발행 renderClickRewards가 dmEventCard(accentVar:--dm-accent, icon/overline 없음)로 감싸므로 셸 정합.
  // ★ 2026-07-22 (임은지) 발행엔 [참여하기] 버튼(data-dm-claim)이 있는데 편집엔 없었고, 반대로 편집엔 정적 진행바가 있었으나
  //   발행엔 없다(실시간 참여수 집계 미구축이라 바는 항상 0% = 거짓 표시). 발행 SSR과 정확히 미러(버튼 O·바 X) = 편집=단말.
  return (
    <div className="dm-section dm-click-rewards">
      <DmEventCard accentVar="--dm-accent">
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--dm-sp-3)' }}>
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
        <button style={{ ...DM_CTA_STYLE, width: '100%', marginTop: 'var(--dm-sp-3)' }}>참여하기</button>
      </DmEventCard>
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
        {/* ★ 2026-07-22 (임은지) 경품 등급(prizes)을 발행 SSR과 동일하게 노출(응모 유도) — 편집기서 입력해도 DM에 안 보이던 갭. */}
        {(props.prizes || []).length > 0 && (
          <div style={{ marginBottom: 'var(--dm-sp-3)' }}>
            <div style={{ fontSize: 'var(--dm-fs-tiny)', fontWeight: 700, color: 'var(--dm-primary)', letterSpacing: 1, marginBottom: 4 }}>경품</div>
            {(props.prizes || []).map((pr, i) => (
              <div key={i} style={{ fontSize: 'var(--dm-fs-small)', color: 'var(--dm-neutral-700)' }}>
                {pr.rank}등 {pr.name}{pr.count ? <span style={{ color: 'var(--dm-neutral-500)' }}> ({pr.count}명)</span> : null}
              </div>
            ))}
          </div>
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
        {/* ★ 2026-07-21 SSR(renderRoulette) 여백 sp-3 정합. RouletteProps엔 title 타입·편집 UI가 없어(beta)
            SSR의 p.title fallback은 항상 '룰렛 이벤트' — 하드코딩과 결과 동일(커스텀 제목 입력 경로 0). */}
        <div style={{ ...TITLE_STYLE, marginBottom: 'var(--dm-sp-3)' }}>룰렛 이벤트</div>
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
        {/* ★ 2026-07-22 (임은지) 당첨 경품(prize_count>0)만 발행 SSR과 동일 필터로 노출(전 세그먼트 나열 아님). 휠엔 라벨이 없어 경품 안내 역할. */}
        {segments.filter((s) => Number(s.prize_count) > 0).length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, justifyContent: 'center', marginTop: 'var(--dm-sp-3)' }}>
            {segments.filter((s) => Number(s.prize_count) > 0).map((s) => (
              <span key={s.id} style={{ fontSize: 'var(--dm-fs-tiny)', padding: '4px 10px', background: 'var(--dm-primary-light)', color: 'var(--dm-primary)', borderRadius: 999, fontWeight: 600 }}>
                {s.reward_description || s.label}
              </span>
            ))}
          </div>
        )}
      </DmEventCard>
    </div>
  );
}

export function InstantCouponSection({ props }: { props: InstantCouponProps }) {
  return (
    <div className="dm-section dm-instant-coupon">
      {/* ★ 2026-07-21 발행 renderInstantCoupon v2 셸 정합 — 옛 점선 상자(2px dashed·아이콘26·오버라인 없음) →
          라운드 카드(sp-8 sp-6·1px solid·radius20·shadow)+아이콘 칩 44+COUPON 오버라인. bg는 primary-light라 DmEventCard 대신 인라인 미러. */}
      <div style={{ padding: 'var(--dm-sp-8) var(--dm-sp-6)', background: 'var(--dm-primary-light)', border: '1px solid var(--dm-neutral-200)', borderRadius: 20, boxShadow: 'var(--dm-shadow-md)', margin: 'var(--dm-sp-2) 0' }}>
        <div style={{ width: 44, height: 44, borderRadius: 12, background: 'var(--dm-bg)', color: 'var(--dm-primary)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', marginBottom: 'var(--dm-sp-4)' }}><DmIcon name="ticket" size={22} /></div>
        <div className="dm-overline" style={{ color: 'var(--dm-primary)', marginBottom: 'var(--dm-sp-2)' }}>COUPON</div>
        <div style={{ ...TITLE_STYLE, color: 'var(--dm-primary)' }}>{props.coupon_label}</div>
        <div style={{ fontSize: 'var(--dm-fs-small)', color: 'var(--dm-neutral-700)', marginBottom: 'var(--dm-sp-3)' }}>{props.discount_description}</div>
        {props.expires_at && (
          <div style={{ fontSize: 'var(--dm-fs-tiny)', color: 'var(--dm-primary)', marginBottom: 'var(--dm-sp-3)', fontWeight: 600 }}>
            만료: {new Date(props.expires_at).toLocaleString('ko-KR')}
          </div>
        )}
        {/* ★ 2026-07-23 (임은지) '쿠폰 받기' 버튼 배경/글씨색(미지정=DM_CTA_STYLE 기본·회귀 0). 발행 renderInstantCoupon 미러. */}
        <button style={{ ...DM_CTA_STYLE, ...(props.button_bg_color ? { background: props.button_bg_color } : {}), ...(props.button_text_color ? { color: props.button_text_color } : {}) }}>쿠폰 받기</button>
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
        {/* ★ 2026-07-22 (임은지) signup_url이 있으면 발행 SSR은 링크(a href)로, 없으면 참여 버튼으로 렌더한다.
            편집 캔버스는 항상 버튼이라 "참여 링크"를 입력해도 단말은 링크·편집은 버튼으로 달랐다 → 발행과 동일 분기 미러. */}
        {props.signup_url ? (
          <a href={props.signup_url} target="_blank" rel="noopener noreferrer" style={{ ...DM_CTA_STYLE, width: '100%', display: 'block', textAlign: 'center', textDecoration: 'none' }}>선착순 참여하기</a>
        ) : (
          <button style={{ ...DM_CTA_STYLE, width: '100%' }}>선착순 참여하기</button>
        )}
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
    <div className="dm-section dm-youtube-embed" style={SECTION_SHELL_SM}>
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
    <div className="dm-section dm-instagram-embed" style={SECTION_SHELL_SM}>
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
    <div className="dm-section dm-map-store-locator" style={SECTION_SHELL_LG}>
      {/* ★ 2026-07-22 (임은지) 발행 SSR renderMapStoreLocator는 2026-07-07에 기능 없는 200px 회색 지도 자리(죽은 장식)를 제거했다.
          편집 캔버스에만 남아 편집엔 회색 상자가 보이고 단말엔 없던 불일치 → 캔버스에서도 제거(제목+매장 카드만). */}
      <div style={{ ...TITLE_STYLE, marginBottom: 'var(--dm-sp-3)', display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{ color: 'var(--dm-primary)' }}><DmIcon name="map" size={18} /></span>매장 찾기
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
        {props.title && <div className="dm-text-h2" style={H2_TITLE_STYLE}>{props.title}</div>}
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
    <div className="dm-section dm-reviews" style={SECTION_SHELL_LG}>
      {/* ★ 2026-07-21 SSR(renderReviews classic)은 제목 앞에 accent 별 아이콘 flex — 편집기에도 미러 */}
      {props.title && (
        <div className="dm-text-h2" style={{ ...H2_TITLE_STYLE_TIGHT, display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ color: 'var(--dm-accent)' }}><DmIcon name="star" size={20} /></span>{props.title}
        </div>
      )}
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
