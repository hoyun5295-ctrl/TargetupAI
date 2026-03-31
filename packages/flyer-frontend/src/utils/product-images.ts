/**
 * 프론트엔드 상품 이미지 매핑 컨트롤타워
 * ★ D100: Pixabay 로컬 이미지로 전환 (Unsplash 외국 식재료 → Pixabay 한국 마트 실사)
 * 백엔드 product-images.ts와 동일한 매핑 데이터.
 * FlyerPage.tsx FlyerPreviewRenderer에서 사용.
 */

import { API_BASE } from '../App';

interface ProductEntry {
  keyword: string;
  emoji: string;
  image: string;  // 로컬 파일명 (API URL로 변환)
}

const PRODUCT_MAP: ProductEntry[] = [
  // ── 과일 ──
  { keyword: '딸기', emoji: '🍓', image: '딸기.jpg' },
  { keyword: '사과', emoji: '🍎', image: '사과.jpg' },
  { keyword: '배', emoji: '🍐', image: '배.jpg' },
  { keyword: '귤', emoji: '🍊', image: '귤.jpg' },
  { keyword: '오렌지', emoji: '🍊', image: '귤.jpg' },
  { keyword: '바나나', emoji: '🍌', image: '바나나.jpg' },
  { keyword: '포도', emoji: '🍇', image: '포도.jpg' },
  { keyword: '수박', emoji: '🍉', image: '수박.jpg' },
  { keyword: '참외', emoji: '🍈', image: '참외.jpg' },
  { keyword: '복숭아', emoji: '🍑', image: '복숭아.jpg' },
  { keyword: '체리', emoji: '🍒', image: '체리.jpg' },
  { keyword: '토마토', emoji: '🍅', image: '토마토.jpg' },
  { keyword: '블루베리', emoji: '🫐', image: '블루베리.jpg' },
  { keyword: '키위', emoji: '🥝', image: '키위.jpg' },
  { keyword: '망고', emoji: '🥭', image: '망고.jpg' },

  // ── 채소 ──
  { keyword: '양배추', emoji: '🥬', image: '양배추.jpg' },
  { keyword: '브로콜리', emoji: '🥦', image: '브로콜리.jpg' },
  { keyword: '당근', emoji: '🥕', image: '당근.jpg' },
  { keyword: '감자', emoji: '🥔', image: '감자.jpg' },
  { keyword: '고구마', emoji: '🍠', image: '고구마.jpg' },
  { keyword: '양파', emoji: '🧅', image: '양파.jpg' },
  { keyword: '마늘', emoji: '🧄', image: '마늘.jpg' },
  { keyword: '옥수수', emoji: '🌽', image: '옥수수.jpg' },
  { keyword: '고추', emoji: '🌶️', image: '고추.jpg' },
  { keyword: '버섯', emoji: '🍄', image: '버섯.jpg' },
  { keyword: '파프리카', emoji: '🫑', image: '파프리카.jpg' },
  { keyword: '시금치', emoji: '🥬', image: '시금치.jpg' },
  { keyword: '호박', emoji: '🎃', image: '호박.jpg' },
  { keyword: '오이', emoji: '🥒', image: '오이.jpg' },
  { keyword: '배추', emoji: '🥬', image: '양배추.jpg' },

  // ── 축산 ──
  { keyword: '소고기', emoji: '🥩', image: '소고기.jpg' },
  { keyword: '한우', emoji: '🥩', image: '한우.jpg' },
  { keyword: '삼겹살', emoji: '🥓', image: '삼겹살.jpg' },
  { keyword: '목살', emoji: '🥩', image: '목살.jpg' },
  { keyword: '닭', emoji: '🍗', image: '닭고기.jpg' },
  { keyword: '닭고기', emoji: '🍗', image: '닭고기.jpg' },
  { keyword: '오리', emoji: '🦆', image: '오리고기.jpg' },
  { keyword: '오리고기', emoji: '🦆', image: '오리고기.jpg' },

  // ── 수산 ──
  { keyword: '연어', emoji: '🐟', image: '연어.jpg' },
  { keyword: '고등어', emoji: '🐟', image: '고등어.jpg' },
  { keyword: '새우', emoji: '🦐', image: '새우.jpg' },
  { keyword: '오징어', emoji: '🦑', image: '오징어.jpg' },
  { keyword: '게', emoji: '🦀', image: '게.jpg' },
  { keyword: '조개', emoji: '🐚', image: '조개.jpg' },

  // ── 유제품/가공 ──
  { keyword: '계란', emoji: '🥚', image: '계란.jpg' },
  { keyword: '달걀', emoji: '🥚', image: '계란.jpg' },
  { keyword: '우유', emoji: '🥛', image: '우유.jpg' },
  { keyword: '치즈', emoji: '🧀', image: '치즈.jpg' },
  { keyword: '두부', emoji: '🫘', image: '두부.jpg' },
  { keyword: '소시지', emoji: '🌭', image: '소시지.jpg' },

  // ── 가공식품 ──
  { keyword: '김치', emoji: '🥬', image: '김치.jpg' },
  { keyword: '라면', emoji: '🍜', image: '라면.jpg' },
  { keyword: '비비고왕교자', emoji: '🥟', image: '비비고왕교자.webp' },
  { keyword: '비비고 왕교자', emoji: '🥟', image: '비비고왕교자.webp' },
  { keyword: '카스맥주', emoji: '🍺', image: '카스맥주.jpeg' },
];

export interface ProductDisplay {
  emoji: string;
  imageUrl: string | null;
}

/** 상품명에서 키워드 매칭 → 이모지 + 이미지 URL 반환 */
export function getProductDisplay(productName: string): ProductDisplay {
  const name = productName.toLowerCase();
  for (const entry of PRODUCT_MAP) {
    if (name.includes(entry.keyword)) {
      const imageUrl = `${API_BASE}/api/flyer/flyers/product-images/${encodeURIComponent(entry.image)}`;
      return { emoji: entry.emoji, imageUrl };
    }
  }
  return { emoji: '📦', imageUrl: null };
}
