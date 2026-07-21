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
