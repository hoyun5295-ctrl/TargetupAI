/**
 * image-studio-templates-discount.ts — 할인 포스터 트랙(kind 'discount') 템플릿(★ 2026-11-08 C114 B)
 *
 * Harold 1107 「할인혜택이나 이벤트혜택을 예쁘게 만든 템플릿 · 제목에 제품명 · 밑에 할인혜택 · 제품 자리 정해 둠」 · 1108 「오픈 AI 로 가자」.
 * 01 ~ 06 = 1108 서버 샘플(scripts/discount-template-samples.ts · 12/12 숫자 그대로)과 같은 장면 · 글 지시 · 07 · 08 = 세트(같은 틀 · 세트 줄).
 * 숫자 · 할인 · 틀 줄은 studio-discount.ts 가 붙인다(여기 문자열에 금액 · 비율 0 = 카탈로그 계약 시험).
 */
import type { StudioTemplate } from './image-studio-templates';

export const TEMPLATES_DISCOUNT: StudioTemplate[] = [
  {
    id: 'discount-price-cream', name: '가격 할인 크림', category: '할인·혜택', kind: 'discount', offer: 'price',
    desc: '크림 베이지 받침대 위 제품, 큰 판매가', accent: '#c8a27a',
    useCase: '뷰티, 기초 제품을 특가로 알릴 때. 원래 가격과 판매가를 한눈에',
    scaffold: 'A bright premium cosmetics promotion scene: warm cream-beige seamless studio backdrop with a smooth, plain upper half, soft diffused daylight, a round matte ivory pedestal in the lower center for the product, a few delicate dried flowers only at the far bottom edges. Clean, airy, high-end shopping-mall promotion styling.',
    textStyle: 'Modern bold Korean sans-serif in deep warm brown, the discount rate and the strike line in a refined red, generous spacing, premium department-store sale typography.',
    defaultTexts: { label: 'SPECIAL PRICE', title: '{productName}' },
    sample: { title: '촉촉한 앰버 세럼' },
  },
  {
    id: 'discount-price-black', name: '가격 할인 블랙', category: '할인·혜택', kind: 'discount', offer: 'price',
    desc: '스포트라이트 블랙 무대, 금빛 판매가', accent: '#1f1f22',
    useCase: '의류, 프리미엄 제품 한정 특가. 고급스럽게 가격을 강조할 때',
    scaffold: 'A premium dark fashion promotion scene: deep charcoal-black studio, a soft warm spotlight from above onto a low glossy black plinth in the lower center, subtle haze, the upper half dark and plain. Luxurious, high-contrast, editorial.',
    textStyle: 'Bold clean white Korean sans-serif headline, gold-yellow accents for the discount rate and the strike line, crisp high-contrast luxury sale typography.',
    defaultTexts: { label: 'LIMITED OFFER', title: '{productName}' },
    sample: { title: '울 케이블 니트' },
  },
  {
    id: 'discount-price-cafe', name: '가격 할인 웜 카페', category: '할인·혜택', kind: 'discount', offer: 'price',
    desc: '창가 햇살 나무 테이블, 따뜻한 메뉴판', accent: '#a8743f',
    useCase: '카페, 디저트 메뉴 할인. 시간대 특가, 신메뉴 오픈 특가',
    scaffold: 'A warm, cozy cafe promotion scene: warm caramel-beige backdrop with a plain upper half, a light wooden tabletop in the lower part for the cup, soft window light, a few coffee beans only at the bottom edges. Cozy, appetizing, modern cafe menu-board styling.',
    textStyle: 'Bold friendly Korean sans-serif in dark espresso brown, the discount rate in warm red-orange, appetizing modern menu typography.',
    defaultTexts: { title: '{productName}' },
    sample: { title: '부드러운 크림 라떼' },
  },
  {
    id: 'discount-nplus-coral', name: '하나 더 코랄', category: '할인·혜택', kind: 'discount', offer: 'nplus',
    desc: '선명한 코랄 바탕, 흰 알약 표지', accent: '#ff5e4d',
    useCase: '카페, 간식, 생활용품 하나 더 행사. 밝고 경쾌하게',
    scaffold: 'A vivid, cheerful cafe promotion scene: saturated coral-red seamless backdrop with a smooth, plain upper half, a simple round light pedestal in the lower center, a few soft confetti dots only at the edges. Energetic, playful, modern delivery-app promotion styling.',
    textStyle: 'Extra-bold rounded Korean display type in white, the offer badge as a white pill with coral-red text, punchy and playful.',
    defaultTexts: { title: '{productName}' },
    sample: { title: '부드러운 크림 라떼' },
  },
  {
    id: 'discount-nplus-sky', name: '하나 더 하늘', category: '할인·혜택', kind: 'discount', offer: 'nplus',
    desc: '하늘빛 물결, 파란 원 표지', accent: '#3b82f6',
    useCase: '스킨케어, 생활용품 묶음 행사. 산뜻하고 깨끗하게',
    scaffold: 'A fresh, clean skincare promotion scene: soft sky-blue gradient backdrop with a plain upper half, a glossy white round pedestal in the lower center with gentle water reflections, airy morning light. Fresh, clean, modern.',
    textStyle: 'Bold modern Korean sans-serif in deep navy, the offer badge as a vivid blue circle with white text, clean and confident.',
    defaultTexts: { title: '{productName}' },
    sample: { title: '맑은 앰버 세럼' },
  },
  {
    id: 'discount-period-navy', name: '기간 특가 네이비', category: '할인·혜택', kind: 'discount', offer: 'price',
    desc: '네이비 캠페인, 노란 기간 알약, 증정 칸', accent: '#1e3a8a',
    useCase: '기간을 정한 특가, 사은품 행사. 날짜와 증정을 함께 알릴 때',
    scaffold: 'A confident fashion sale scene: deep navy-blue studio backdrop with a subtle gradient and a plain upper area, a light stone pedestal in the lower center, crisp soft light. Modern, trustworthy, campaign-like.',
    textStyle: 'Bold white Korean sans-serif headline, bright yellow accents for the date pill, the discount rate and the strike line, strong and clean sale typography.',
    defaultTexts: { title: '{productName}' },
    sample: { title: '울 케이블 니트' },
  },
  {
    id: 'discount-set-beige', name: '세트 묶음 베이지', category: '할인·혜택', kind: 'discount', offer: 'set',
    desc: '넓은 받침대에 나란히, 세트가 강조', accent: '#d6c3a5',
    useCase: '여러 제품을 묶어 세트로 팔 때. 따로 사면 가격과 세트가를 비교',
    scaffold: 'A premium gift-set promotion scene: soft warm beige studio backdrop with a plain upper half, one wide low ivory pedestal in the lower center holding all the products side by side, gentle daylight, a thin ribbon detail only at the far edges. Elegant, curated, department-store set styling.',
    textStyle: 'Refined bold Korean sans-serif in deep brown, the set price large in a refined red-brown, clean premium set-offer typography.',
    defaultTexts: { title: '{productName}' },
    sample: { title: '데일리 스킨 세트' },
  },
  {
    id: 'discount-set-white', name: '세트 묶음 화이트', category: '할인·혜택', kind: 'discount', offer: 'set',
    desc: '하얀 미니멀 무대, 검정 큰 세트가', accent: '#e5e7eb',
    useCase: '의류, 생활용품 세트를 깔끔하게. 군더더기 없는 구성 비교',
    scaffold: 'A clean minimal set promotion scene: bright white seamless studio with a soft gray floor shadow, one long low white plinth in the lower center holding all the products side by side, even soft light, a plain upper half. Minimal, modern, gallery-like.',
    textStyle: 'Bold black Korean sans-serif, the discount rate in vivid red, the set price largest in black, crisp minimal commerce typography.',
    defaultTexts: { title: '{productName}' },
    sample: { title: '겨울 아우터 세트' },
  },
];
