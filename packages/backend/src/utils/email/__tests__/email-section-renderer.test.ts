/**
 * email-section-renderer.test.ts — 이메일 디자인 2.0 골격 고정 (2026-07-07(5))
 *
 * "이메일 = 평면 흰 카드 + 단색 버튼" 회귀 차단: 브랜드 밴드·프리헤더·그라데이션 버튼·
 * 쿠폰 티켓 2톤이 실제 산출 HTML에 존재해야 한다. 순수 함수(DB-free) — vitest 단독 실행 가능.
 */
import { describe, it, expect } from 'vitest';
import { renderEmailSections, extractEmailText } from '../email-section-renderer';
import type { Section } from '../../dm/dm-section-registry';

const sec = (type: string, props: Record<string, unknown>, order = 0, visible = true): Section =>
  ({ id: `s-${type}-${order}`, type, order, visible, props } as unknown as Section);

const SAMPLE: Section[] = [
  sec('hero', { headline: '여름 신상품 출시', sub_copy: '지금 만나보세요' }, 0),
  sec('text_card', { headline: '소개', body: '본문 내용입니다' }, 1),
  sec('coupon', { discount_label: '10% 할인', coupon_code: 'SUMMER10', usage_condition: '온라인 전용' }, 2),
  sec('cta', { buttons: [{ label: '지금 보기', url: 'https://shop.example.com', style: 'primary' }] }, 3),
  sec('footer', { notes: '본 메일 안내', cs_phone: '1544-0000' }, 4),
];

describe('renderEmailSections — 디자인 2.0 골격', () => {
  it('셸 = 브랜드 밴드(그라데이션 6px) + 슬레이트 배경 + 카드 보더/그림자', () => {
    const html = renderEmailSections(SAMPLE, {});
    expect(html).toContain('height:6px');
    expect(html).toContain('linear-gradient(90deg');   // bandGrad
    expect(html).toContain('#eef1f6');                 // shellBg 기본
    expect(html).toContain('box-shadow:0 12px 32px');  // 카드 그림자
    expect(html).toContain('border-radius:20px');      // radius xl
  });

  it('프리헤더 — 본문 첫 텍스트가 hidden 블록으로 삽입 + zwnj 패딩', () => {
    const html = renderEmailSections(SAMPLE, {});
    expect(html).toContain('display:none;font-size:1px');
    expect(html).toContain('여름 신상품 출시');
    expect(html).toContain('&zwnj;');
  });

  it('primary 버튼 = 그라데이션 + solid 폴백 + 800 굵기', () => {
    const html = renderEmailSections(SAMPLE, {});
    expect(html).toContain('background-image:linear-gradient(180deg');
    expect(html).toContain('font-weight:800');
    // 폴백 solid — background:{primary} 가 background-image 앞에 존재
    expect(html).toMatch(/background:#[0-9a-f]{6};background-image:linear-gradient/);
  });

  it('상품명 줄바꿈 — product_carousel 제품명 개행이 <br>로 반영 (2026-07-22 직원 요청, DM 미러)', () => {
    const html = renderEmailSections([sec('product_carousel', { products: [{ image_url: 'https://ex.com/a.jpg', name: '줄1\n줄2', price: 1000 }] }, 0)], {});
    expect(html).toContain('줄1<br>줄2');
  });

  it('쿠폰 = 티켓 2톤 (COUPON 인장 + 워시 본권 + 절취 대시 + 코드 스터브)', () => {
    const html = renderEmailSections(SAMPLE, {});
    expect(html).toContain('COUPON');
    expect(html).toContain('2px dashed');
    expect(html).toContain('SUMMER10');
    expect(html).toContain('letter-spacing:3px');
    // 옛 골격(단색 primary 박스 + 흰 라벨) 폐기 확인 — 라벨은 primary 색 대형 타이포
    expect(html).toContain('font-size:30px');
  });

  it('쿠폰 코드 없음 = 스터브 없이 본권 단독 (radius 전체)', () => {
    const html = renderEmailSections([sec('coupon', { discount_label: '사은품 증정' }, 0)], {});
    expect(html).toContain('사은품 증정');
    expect(html).not.toContain('letter-spacing:3px');
  });

  it('brandKit primary가 밴드·버튼·쿠폰에 반영', () => {
    const html = renderEmailSections(SAMPLE, { brandKit: { primary_color: '#10b981' } });
    expect(html).toContain('#10b981');
    expect(html).toContain('rgba(16,185,129,0.08)'); // primarySoft 워시
  });

  it('visible=false 제외 + order 정렬 (기존 동작 회귀 가드)', () => {
    const html = renderEmailSections([
      sec('text_card', { headline: '숨김' }, 0, false),
      sec('text_card', { headline: '표시' }, 1),
    ], {});
    expect(html).toContain('표시');
    expect(html).not.toContain('숨김');
  });

  it('extractEmailText — 텍스트만 순서대로 추출', () => {
    const text = extractEmailText(SAMPLE);
    expect(text).toContain('여름 신상품 출시');
    expect(text).toContain('10% 할인');
  });

  // ★ 2026-07-07(5) 실측 발견 결함 재발 차단 — style="..." 안 폰트 스택 큰따옴표가
  //   속성을 조기 종료시켜 HTML 파손 + 폰트 무효 (Pretendard/JetBrains Mono 전부).
  it('style 속성 안 폰트 큰따옴표 0건 (HTML 파손 차단) + 작은따옴표 폰트 적용', () => {
    const html = renderEmailSections(SAMPLE, {});
    expect(html).not.toContain('font-family:"');
    expect(html).toContain("font-family:'Pretendard Variable'");
  });

  it('store_info/매장 = 헤어라인 보더 카드 (평면 전폭 블록 폐기)', () => {
    const html = renderEmailSections([
      sec('store_info', { address: '서울 강남구', phone: '02-000-0000' }, 0),
    ], {});
    expect(html).toContain('border-radius:14px');
    expect(html).toContain('border:1px solid');
  });

  // ★ 2026-07-12 편집기 스타일 소비 고정 — 죽은 컨트롤(크기 selector 미반영) 재발 차단
  it('폰트 크기 직접 지정(headline_size/body_size/sub_copy_size) = 인라인 px 반영 + 범위 clamp', () => {
    const html = renderEmailSections([
      sec('hero', { headline: '큰 제목', sub_copy: '부제', headline_size: 40, sub_copy_size: 18 }, 0),
      sec('text_card', { headline: '소제목', body: '본문', headline_size: 28, body_size: 200 }, 1),
    ], {});
    expect(html).toContain('font-size:40px');
    expect(html).toContain('font-size:18px');
    expect(html).toContain('font-size:28px');
    expect(html).toContain('font-size:64px'); // 200 → 64 clamp
  });

  it('폰트 크기 미지정 = 기본 토큰 유지 (기존 산출 회귀 0)', () => {
    const html = renderEmailSections([sec('hero', { headline: '제목' }, 0)], {});
    expect(html).not.toContain('font-size:NaN');
    expect(html).toContain('제목');
  });

  it('섹션 공통 정렬(section.align) = hero/text_card props.align으로 주입', () => {
    const secs: Section[] = [
      { ...sec('hero', { headline: '좌측 제목' }, 0), align: 'left' } as Section,
      { ...sec('text_card', { headline: '우측 카드', body: '본문', align: 'left' }, 1), align: 'right' } as Section,
    ];
    const html = renderEmailSections(secs, {});
    expect(html).toContain('text-align:left');
    expect(html).toContain('text-align:right'); // section.align이 props.align(left)을 덮음
  });

  it('섹션 강조색(accent_color) = 그 블록의 버튼·워시에만 반영 (다른 블록은 브랜드 색 유지)', () => {
    const secs: Section[] = [
      { ...sec('cta', { buttons: [{ label: '보기', url: 'https://a.example.com', style: 'primary' }] }, 0), accent_color: '#e11d48' } as Section,
      sec('coupon', { discount_label: '혜택', coupon_code: 'C1' }, 1),
    ];
    const html = renderEmailSections(secs, {});
    expect(html).toContain('#e11d48');                    // 지정 블록(CTA) 반영
    expect(html).toContain('rgba(225,29,72,0.45)');       // primaryDashed 파생(CTA 그림자)
    // 쿠폰(미지정 블록)은 accent 파생 워시(primarySoft)를 쓰지 않아야 — 블록 단위 격리 확인
    expect(html).not.toContain('rgba(225,29,72,0.08)');
    expect(html).toMatch(/COUPON/);                        // 쿠폰 블록은 기본 브랜드 색으로 렌더됨
  });
});

/**
 * ★ 2026-09-08 (남지현 접수 `cmtqsp5uw09yujnot3k93uh62` "메일 수신 시 가로 폭 정렬")
 * 셸 폭 계약 — 600px를 지키는 근거가 `max-width` 하나뿐이면, 그 속성을 해석하지 않는 뷰어에서는
 * 인라인 `width:100%`만 남아 카드가 **부모 컨테이너 폭까지 늘어난다**(로컬 측정 600 → 976).
 * 그래서 폭은 px로 싣고(`width:600px`), 좁은 화면은 미디어쿼리가 푼다(덮는 쪽도 함께 고정).
 */
describe('셸 폭 계약 — 뷰어의 max-width 해석에 기대지 않는다', () => {
  const SHELL_SAMPLE: Section[] = [sec('hero', { headline: '폭 계약' }, 0)];

  it('셸 인라인 = width:600px (px 고정) + max-width:600px 병기', () => {
    const html = renderEmailSections(SHELL_SAMPLE, {});
    const shell = html.match(/<table[^>]*class="em-shell"[^>]*>/)?.[0] || '';
    expect(shell).toMatch(/(^|;|")width:600px/);          // max-width:600px에 묻히지 않게 선언 자체를 본다
    expect(shell).toContain('max-width:600px');
    expect(shell).toContain('width="600"');               // 속성도 유지(CSS 미해석 클라이언트 폴백)
  });

  it('셸 인라인에 width:100%를 두지 않는다 (부모 폭을 따라가면 계약이 사라진다)', () => {
    const html = renderEmailSections(SHELL_SAMPLE, {});
    const shell = html.match(/<table[^>]*class="em-shell"[^>]*>/)?.[0] || '';
    expect(shell).not.toMatch(/(^|;|\s)width:\s*100%/);
  });

  it('덮는 쪽 — 좁은 화면(@media)에서는 .em-shell이 100%로 풀린다', () => {
    const html = renderEmailSections(SHELL_SAMPLE, {});
    expect(html).toContain('@media (max-width:600px)');
    expect(html).toMatch(/\.em-shell\{width:100% !important/);
  });
});

/**
 * ★ 2026-09-08(2) 상품 격자 비율 맞춤 — 맞추기(contain)에서 사진 크기가 제각각으로 보이던 것.
 * 서버(`utils/image-serve.ts`)가 같은 비율로 구워 주도록 렌더러가 URL에 지시를 붙인다.
 * 잘림을 되살리지 않으면서(0905 지적 유지) 크기만 맞추는 방식이라, 이 계약이 깨지면 둘 중 하나가 되돌아간다.
 */
describe('상품 격자 — 비율 맞춤 요청', () => {
  const grid = (props: Record<string, unknown>): string =>
    renderEmailSections([sec('product_carousel', {
      products: [
        { image_url: '/api/dm/v/images/co/a.jpg', name: '가로형 상품', price: 1000 },
        { image_url: '/api/dm/v/images/co/b.jpg', name: '세로형 상품', price: 2000 },
      ],
      ...props,
    }, 0)], {});

  it('맞추기(contain) = 우리 서버 이미지에 fit을 붙인다', () => {
    const html = grid({ image_fit: 'contain' });
    const imgs = html.match(/<img[^>]*a\.jpg[^>]*>/g) || [];
    expect(imgs.length).toBe(1);
    expect(imgs[0]).toContain('a.jpg?fit=1x1');
    // CSS 쪽(구형 뷰어용 폴백)도 그대로 남는다 — 싣는 쪽과 덮는 쪽을 함께 둔다.
    expect(imgs[0]).toContain('object-fit:contain');
  });

  it('여백 색을 렌더러가 정해 보내지 않는다 — 사진을 보고 서버가 고른다', () => {
    // 색을 실어 보내면 야외컷에 색 덩어리가 붙는다(2026-09-08 비교 캡처). URL에는 비율만 담긴다.
    const html = grid({ image_fit: 'contain', background_color: '#123456' });
    const img = (html.match(/<img[^>]*a\.jpg[^>]*>/) || [''])[0];
    expect(img).toContain('fit=1x1');
    expect(img).not.toContain('bg=');
    expect(img).toContain('background:#123456');   // CSS 폴백은 종전대로 섹션 배경을 쓴다
  });

  it('채우기(cover)는 손대지 않는다 — 이미 크기가 맞고, 옛 출력이 한 글자도 안 바뀌어야 한다', () => {
    const html = grid({});
    expect(html).not.toContain('fit=1x1');
    expect(html).toContain('object-fit:cover');
  });

  it('외부 주소에는 붙이지 않는다 — 우리 서버를 거치지 않아 무의미하고 그쪽 URL을 깨뜨린다', () => {
    const html = renderEmailSections([sec('product_carousel', {
      image_fit: 'contain',
      products: [{ image_url: 'https://cdn.other.example.com/x.jpg?sig=abc', name: '외부', price: 100 }],
    }, 0)], {});
    expect(html).toContain('https://cdn.other.example.com/x.jpg?sig=abc');
    expect(html).not.toContain('fit=1x1');
  });

  it('섹션 배경이 CSS 함수·색 이름이어도 맞춤은 그대로 요청한다 (색은 서버가 정하므로 무관)', () => {
    const html = grid({ image_fit: 'contain', background_color: 'rgba(0,0,0,0.5)' });
    expect(html).toContain('fit=1x1');
    expect(html).toContain('object-fit:contain');
  });
});
