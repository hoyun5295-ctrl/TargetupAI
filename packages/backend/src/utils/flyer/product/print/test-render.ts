/**
 * ★ 인쇄전단 V2 (D129) — 테스트 렌더 스크립트 v2
 *
 * 2절 세로(545×788mm) + Line B 친근 파스텔 모듈러 + 더미 60개+ 상품
 * (축산/수산/청과/주류 4카테고리 블록 골고루 채움)
 *
 * 실행:
 *   npx tsx packages/backend/src/utils/flyer/product/print/test-render.ts
 *
 * 출력:
 *   packages/backend/pdfs/mart_spring_v1_test.pdf
 *   packages/backend/pdfs/mart_spring_v1_test.png   (debug screenshot)
 *   packages/backend/pdfs/mart_spring_v1_test.html  (debug html dump)
 */

import fs from 'fs';
import path from 'path';
import { renderFlyerPdf } from './renderer/paged-pdf';
import type { RawFlyerInput } from './renderer/slot-filler';
import { closePdfBrowser } from '../flyer-pdf';

// ─── SVG placeholder (외부 네트워크 의존 없음) ─────
function svgPlaceholder(label: string, bg = '#F0FDF4', fg = '#0F172A'): string {
  const esc = label.replace(/[<>&"']/g, '').slice(0, 8);
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='300' height='300' viewBox='0 0 300 300'>
    <rect width='300' height='300' fill='${bg}'/>
    <circle cx='150' cy='130' r='60' fill='${fg}' opacity='0.12'/>
    <text x='150' y='215' font-family='Pretendard, Arial, sans-serif' font-size='32' font-weight='700' fill='${fg}' text-anchor='middle'>${esc}</text>
  </svg>`.replace(/\s+/g, ' ').trim();
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

// 카테고리별 색상 팔레트 (썸네일 배경)
const PALETTE = {
  meat:   { bg: '#FEF3F2', fg: '#BE123C' },   // 축산 - 따뜻한 핑크
  fish:   { bg: '#EFF6FF', fg: '#1E40AF' },   // 수산 - 쿨블루
  fruit:  { bg: '#FFFBEB', fg: '#B45309' },   // 청과 - 따뜻한 옐로
  liquor: { bg: '#F3F4F6', fg: '#374151' },   // 주류 - 차분한 그레이
  main:   { bg: '#FFE4E6', fg: '#BE123C' },   // 메인 - 포인트 핑크
  sub:    { bg: '#EEF2FF', fg: '#3730A3' },   // 서브 - 인디고
};

// ─── 더미 입력 ─────────────────────────────────────────────────
const dummyInput: RawFlyerInput = {
  store: {
    name: '테스트마켓',
    address: '의정부시 우리동 1번지',
    phone: '031-000-0000',
    hours: '08:00~22:00',
    deliveryHours: '10:00~19:00',
    logoUrl: '',
    mapUrl: '',
  },
  qr: {
    title: '온라인 쇼핑몰',
    subtitle: '테스트마켓',
    imageUrl: '',
  },
  heroTitle: '봄 세일',
  heroSubcopy: '봄맞이 인기상품 알뜰 가격으로 만나보세요',
  slotOverrides: {
    hero_period: { value: '🗓 04.17 (목) ~ 04.23 (수)' },
    section_main: { label: '오늘의 특가' },
    section_recommend: { label: '베스트 픽' },
    section_fresh: { label: '신선 코너', sublabel: '매일 들어오는 신선한 상품' },
    footer_notice: {
      text: '행사상품은 조기 품절될 수 있습니다. 사진은 이미지컷이며 실제와 다를 수 있습니다. 단가 사정에 따라 냉동으로 대체될 수 있습니다.',
    },
    footer_brand: { value: '🔵 한줄로 · hanjul.ai' },
  },
  products: [
    // ══════════════ 메인 6칸 (promoType=main) — 할인율 높은 순 ══════════════
    { productName: '한우 등심', salePrice: 12900, originalPrice: 28900, unit: '100g', promoType: 'main', category: '축산', aiCopy: '제주 1등급 한우', imageUrl: svgPlaceholder('한우', PALETTE.main.bg, PALETTE.main.fg) },
    { productName: '완도 전복', salePrice: 1943, originalPrice: 2775, unit: '1미', promoType: 'main', category: '수산', aiCopy: '자연산 킹사이즈', imageUrl: svgPlaceholder('전복', PALETTE.main.bg, PALETTE.main.fg) },
    { productName: '제주 딸기', salePrice: 3990, originalPrice: 7900, unit: '500g', promoType: 'main', category: '청과', aiCopy: '당도 12브릭스', imageUrl: svgPlaceholder('딸기', PALETTE.main.bg, PALETTE.main.fg) },
    { productName: '수입 오렌지', salePrice: 9990, originalPrice: 15900, unit: '8개입', promoType: 'main', category: '청과', imageUrl: svgPlaceholder('오렌지', PALETTE.main.bg, PALETTE.main.fg) },
    { productName: '삼다수', salePrice: 990, originalPrice: 1500, unit: '2L', promoType: 'main', category: '음료', imageUrl: svgPlaceholder('삼다수', PALETTE.main.bg, PALETTE.main.fg) },
    { productName: '스위티오 바나나', salePrice: 3990, originalPrice: 5900, unit: '1송이', promoType: 'main', category: '청과', imageUrl: svgPlaceholder('바나나', PALETTE.main.bg, PALETTE.main.fg) },

    // ══════════════ 추천 8칸 (promoType=sub) ══════════════
    { productName: '사과', salePrice: 3900, originalPrice: 6900, unit: '5개', promoType: 'sub', category: '청과', imageUrl: svgPlaceholder('사과', PALETTE.sub.bg, PALETTE.sub.fg) },
    { productName: '참외', salePrice: 4900, originalPrice: 7900, unit: '3개', promoType: 'sub', category: '청과', imageUrl: svgPlaceholder('참외', PALETTE.sub.bg, PALETTE.sub.fg) },
    { productName: '딸기', salePrice: 5900, originalPrice: 9900, unit: '500g', promoType: 'sub', category: '청과', imageUrl: svgPlaceholder('딸기', PALETTE.sub.bg, PALETTE.sub.fg) },
    { productName: '우유', salePrice: 2500, originalPrice: 3900, unit: '1L', promoType: 'sub', category: '유제품', imageUrl: svgPlaceholder('우유', PALETTE.sub.bg, PALETTE.sub.fg) },
    { productName: '계란', salePrice: 4900, originalPrice: 7900, unit: '30구', promoType: 'sub', category: '축산', imageUrl: svgPlaceholder('계란', PALETTE.sub.bg, PALETTE.sub.fg) },
    { productName: '김치', salePrice: 6900, originalPrice: 11900, unit: '1kg', promoType: 'sub', category: '반찬', imageUrl: svgPlaceholder('김치', PALETTE.sub.bg, PALETTE.sub.fg) },
    { productName: '두부', salePrice: 1500, originalPrice: 2500, unit: '300g', promoType: 'sub', category: '가공식품', imageUrl: svgPlaceholder('두부', PALETTE.sub.bg, PALETTE.sub.fg) },
    { productName: '라면', salePrice: 3900, originalPrice: 5900, unit: '5개', promoType: 'sub', category: '가공식품', imageUrl: svgPlaceholder('라면', PALETTE.sub.bg, PALETTE.sub.fg) },

    // ══════════════ 축산 8개 (fresh_block_1) ══════════════
    { productName: '한우 등심', salePrice: 19900, originalPrice: 28900, unit: '100g', promoType: 'general', category: '축산', imageUrl: svgPlaceholder('등심', PALETTE.meat.bg, PALETTE.meat.fg) },
    { productName: '돼지 목살', salePrice: 9900, originalPrice: 14900, unit: '100g', promoType: 'general', category: '축산', imageUrl: svgPlaceholder('목살', PALETTE.meat.bg, PALETTE.meat.fg) },
    { productName: '닭가슴살', salePrice: 6900, originalPrice: 9900, unit: '1kg', promoType: 'general', category: '축산', imageUrl: svgPlaceholder('닭', PALETTE.meat.bg, PALETTE.meat.fg) },
    { productName: '오리훈제', salePrice: 8900, originalPrice: 12900, unit: '500g', promoType: 'general', category: '축산', imageUrl: svgPlaceholder('오리', PALETTE.meat.bg, PALETTE.meat.fg) },
    { productName: '소시지', salePrice: 4900, originalPrice: 6900, unit: '500g', promoType: 'general', category: '축산', imageUrl: svgPlaceholder('소시지', PALETTE.meat.bg, PALETTE.meat.fg) },
    { productName: '베이컨', salePrice: 5900, originalPrice: 8900, unit: '300g', promoType: 'general', category: '축산', imageUrl: svgPlaceholder('베이컨', PALETTE.meat.bg, PALETTE.meat.fg) },
    { productName: '햄', salePrice: 3900, originalPrice: 5900, unit: '340g', promoType: 'general', category: '축산', imageUrl: svgPlaceholder('햄', PALETTE.meat.bg, PALETTE.meat.fg) },
    { productName: '갈비세트', salePrice: 19900, originalPrice: 29900, unit: '1kg', promoType: 'general', category: '축산', imageUrl: svgPlaceholder('갈비', PALETTE.meat.bg, PALETTE.meat.fg) },

    // ══════════════ 수산 8개 (fresh_block_2) ══════════════
    { productName: '고등어', salePrice: 3900, originalPrice: 6900, unit: '2마리', promoType: 'general', category: '수산', imageUrl: svgPlaceholder('고등어', PALETTE.fish.bg, PALETTE.fish.fg) },
    { productName: '오징어', salePrice: 2900, originalPrice: 4900, unit: '1마리', promoType: 'general', category: '수산', imageUrl: svgPlaceholder('오징어', PALETTE.fish.bg, PALETTE.fish.fg) },
    { productName: '새우', salePrice: 9900, originalPrice: 14900, unit: '500g', promoType: 'general', category: '수산', imageUrl: svgPlaceholder('새우', PALETTE.fish.bg, PALETTE.fish.fg) },
    { productName: '전복', salePrice: 15900, originalPrice: 22900, unit: '5미', promoType: 'general', category: '수산', imageUrl: svgPlaceholder('전복', PALETTE.fish.bg, PALETTE.fish.fg) },
    { productName: '연어', salePrice: 12900, originalPrice: 18900, unit: '300g', promoType: 'general', category: '수산', imageUrl: svgPlaceholder('연어', PALETTE.fish.bg, PALETTE.fish.fg) },
    { productName: '참치회', salePrice: 19900, originalPrice: 29900, unit: '200g', promoType: 'general', category: '수산', imageUrl: svgPlaceholder('참치', PALETTE.fish.bg, PALETTE.fish.fg) },
    { productName: '조기', salePrice: 5900, originalPrice: 8900, unit: '3마리', promoType: 'general', category: '수산', imageUrl: svgPlaceholder('조기', PALETTE.fish.bg, PALETTE.fish.fg) },
    { productName: '꽁치', salePrice: 3900, originalPrice: 5900, unit: '5마리', promoType: 'general', category: '수산', imageUrl: svgPlaceholder('꽁치', PALETTE.fish.bg, PALETTE.fish.fg) },

    // ══════════════ 청과 8개 (fresh_block_3) ══════════════
    { productName: '귤', salePrice: 3900, originalPrice: 6900, unit: '1kg', promoType: 'general', category: '청과', imageUrl: svgPlaceholder('귤', PALETTE.fruit.bg, PALETTE.fruit.fg) },
    { productName: '오렌지', salePrice: 5900, originalPrice: 8900, unit: '5개', promoType: 'general', category: '청과', imageUrl: svgPlaceholder('오렌지', PALETTE.fruit.bg, PALETTE.fruit.fg) },
    { productName: '포도', salePrice: 7900, originalPrice: 11900, unit: '1송이', promoType: 'general', category: '청과', imageUrl: svgPlaceholder('포도', PALETTE.fruit.bg, PALETTE.fruit.fg) },
    { productName: '배', salePrice: 4900, originalPrice: 7900, unit: '3개', promoType: 'general', category: '청과', imageUrl: svgPlaceholder('배', PALETTE.fruit.bg, PALETTE.fruit.fg) },
    { productName: '대파', salePrice: 1900, originalPrice: 2900, unit: '1단', promoType: 'general', category: '청과', imageUrl: svgPlaceholder('대파', PALETTE.fruit.bg, PALETTE.fruit.fg) },
    { productName: '감자', salePrice: 2900, originalPrice: 4900, unit: '1kg', promoType: 'general', category: '청과', imageUrl: svgPlaceholder('감자', PALETTE.fruit.bg, PALETTE.fruit.fg) },
    { productName: '당근', salePrice: 1500, originalPrice: 2500, unit: '500g', promoType: 'general', category: '청과', imageUrl: svgPlaceholder('당근', PALETTE.fruit.bg, PALETTE.fruit.fg) },
    { productName: '브로콜리', salePrice: 2500, originalPrice: 3900, unit: '1개', promoType: 'general', category: '청과', imageUrl: svgPlaceholder('브로콜리', PALETTE.fruit.bg, PALETTE.fruit.fg) },

    // ══════════════ 주류 8개 (fresh_block_4) ══════════════
    { productName: '참이슬', salePrice: 1590, originalPrice: 1890, unit: '1병', promoType: 'general', category: '주류', imageUrl: svgPlaceholder('참이슬', PALETTE.liquor.bg, PALETTE.liquor.fg) },
    { productName: '테라', salePrice: 1890, originalPrice: 2390, unit: '1병', promoType: 'general', category: '주류', imageUrl: svgPlaceholder('테라', PALETTE.liquor.bg, PALETTE.liquor.fg) },
    { productName: '카스', salePrice: 1790, originalPrice: 2290, unit: '1병', promoType: 'general', category: '주류', imageUrl: svgPlaceholder('카스', PALETTE.liquor.bg, PALETTE.liquor.fg) },
    { productName: '클라우드', salePrice: 1990, originalPrice: 2490, unit: '1병', promoType: 'general', category: '주류', imageUrl: svgPlaceholder('클라우드', PALETTE.liquor.bg, PALETTE.liquor.fg) },
    { productName: '막걸리', salePrice: 1500, originalPrice: 2000, unit: '1병', promoType: 'general', category: '주류', imageUrl: svgPlaceholder('막걸리', PALETTE.liquor.bg, PALETTE.liquor.fg) },
    { productName: '와인 레드', salePrice: 9900, originalPrice: 15900, unit: '750ml', promoType: 'general', category: '주류', imageUrl: svgPlaceholder('와인', PALETTE.liquor.bg, PALETTE.liquor.fg) },
    { productName: '위스키', salePrice: 29900, originalPrice: 45900, unit: '700ml', promoType: 'general', category: '주류', imageUrl: svgPlaceholder('위스키', PALETTE.liquor.bg, PALETTE.liquor.fg) },
    { productName: '사이다', salePrice: 1290, originalPrice: 1890, unit: '1.5L', promoType: 'general', category: '음료', imageUrl: svgPlaceholder('사이다', PALETTE.liquor.bg, PALETTE.liquor.fg) },
  ],
};

// ─── 메인 ──────────────────────────────────────────────────────
// CLI 인자로 템플릿 ID 지정 가능. 없으면 mart_spring_v1 사용.
// npx tsx ...test-render.ts [templateId] — 'all' 이면 4종 전부 렌더
const ALL_TEMPLATES = ['mart_spring_v1', 'mart_hot_v1', 'mart_premium_v1', 'mart_weekend_v1'];

async function renderOne(templateId: string) {
  console.log('━'.repeat(60));
  console.log('▶', templateId);
  console.log('━'.repeat(60));

  const t0 = Date.now();
  const result = await renderFlyerPdf({
    templateId,
    input: dummyInput,
    debug: true,
    timeoutMs: 90000,
  });

  const outDir = path.resolve(process.cwd(), 'packages/backend/pdfs');
  fs.mkdirSync(outDir, { recursive: true });

  if (result.pdf) {
    const pdfPath = path.join(outDir, `${templateId}_test.pdf`);
    fs.writeFileSync(pdfPath, result.pdf);
    console.log('   PDF      :', pdfPath, '(' + (result.pdf.length / 1024).toFixed(1) + ' KB)');
  }

  if (result.screenshot) {
    const pngPath = path.join(outDir, `${templateId}_test.png`);
    fs.writeFileSync(pngPath, result.screenshot);
    console.log('   PNG      :', pngPath, '(' + (result.screenshot.length / 1024).toFixed(1) + ' KB)');
  }
  if (result.html) {
    const htmlPath = path.join(outDir, `${templateId}_test.html`);
    fs.writeFileSync(htmlPath, result.html);
  }

  console.log('   용지     :', result.paperSize, '(' + result.orientation + ')');
  console.log('   페이지   :', result.pageCount);
  console.log('   소요시간 :', Date.now() - t0, 'ms');
}

async function main() {
  const arg = process.argv[2] || 'mart_spring_v1';
  const targets = arg === 'all' ? ALL_TEMPLATES : [arg];
  console.log('상품수 :', dummyInput.products.length, '개, 대상 템플릿:', targets);

  const t0 = Date.now();
  try {
    for (const id of targets) {
      try {
        await renderOne(id);
      } catch (e: any) {
        console.error('❌', id, '렌더 실패:', e?.message || e);
      }
    }
    console.log('━'.repeat(60));
    console.log('✅ 전체 완료 —', Date.now() - t0, 'ms');
  } finally {
    await closePdfBrowser().catch(() => {});
  }
}

main();
