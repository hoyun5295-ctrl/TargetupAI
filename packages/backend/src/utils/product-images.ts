/**
 * CT: product-images.ts — 상품 이미지 자동 매핑 컨트롤타워
 *
 * 마트 주요 상품명 → 이모지 + 이미지 URL 매핑.
 * Unsplash 무료 이미지 사용 (상업용 허용, 핫링크 가능).
 *
 * 사용처: short-urls.ts (전단지 공개 페이지 렌더링)
 * 향후: Unsplash API 연동 시 이 파일만 수정하면 됨.
 */

export interface ProductDisplay {
  emoji: string;
  imageUrl: string | null;
}

interface ProductEntry {
  keyword: string;
  emoji: string;
  image: string;
}

/** 마트 주요 상품 이미지 매핑 (Unsplash 큐레이션) */
const PRODUCT_MAP: ProductEntry[] = [
  // ── 과일 ──
  { keyword: '딸기', emoji: '🍓', image: 'https://images.unsplash.com/photo-1464965911861-746a04b4bca6?w=200&h=200&fit=crop' },
  { keyword: '사과', emoji: '🍎', image: 'https://images.unsplash.com/photo-1560806887-1e4cd0b6cbd6?w=200&h=200&fit=crop' },
  { keyword: '배', emoji: '🍐', image: 'https://images.unsplash.com/photo-1514756331096-242fdeb70d4a?w=200&h=200&fit=crop' },
  { keyword: '감', emoji: '🍊', image: 'https://images.unsplash.com/photo-1603532648955-039310d9ed75?w=200&h=200&fit=crop' },
  { keyword: '귤', emoji: '🍊', image: 'https://images.unsplash.com/photo-1557800636-894a64c1696f?w=200&h=200&fit=crop' },
  { keyword: '오렌지', emoji: '🍊', image: 'https://images.unsplash.com/photo-1557800636-894a64c1696f?w=200&h=200&fit=crop' },
  { keyword: '바나나', emoji: '🍌', image: 'https://images.unsplash.com/photo-1571771894821-ce9b6c11b08e?w=200&h=200&fit=crop' },
  { keyword: '포도', emoji: '🍇', image: 'https://images.unsplash.com/photo-1537640538966-79f369143f8f?w=200&h=200&fit=crop' },
  { keyword: '수박', emoji: '🍉', image: 'https://images.unsplash.com/photo-1563114773-84221bd62daa?w=200&h=200&fit=crop' },
  { keyword: '참외', emoji: '🍈', image: 'https://images.unsplash.com/photo-1571575173700-afb9492e6a50?w=200&h=200&fit=crop' },
  { keyword: '복숭아', emoji: '🍑', image: 'https://images.unsplash.com/photo-1629903439461-1e57e0e804c0?w=200&h=200&fit=crop' },
  { keyword: '체리', emoji: '🍒', image: 'https://images.unsplash.com/photo-1559181567-c3190ca9959b?w=200&h=200&fit=crop' },
  { keyword: '토마토', emoji: '🍅', image: 'https://images.unsplash.com/photo-1558818498-28c1e002b655?w=200&h=200&fit=crop' },
  { keyword: '블루베리', emoji: '🫐', image: 'https://images.unsplash.com/photo-1498557850523-fd3d118b962e?w=200&h=200&fit=crop' },
  { keyword: '키위', emoji: '🥝', image: 'https://images.unsplash.com/photo-1585059895524-72f83a8c8809?w=200&h=200&fit=crop' },
  { keyword: '레몬', emoji: '🍋', image: 'https://images.unsplash.com/photo-1590502593747-42a996133562?w=200&h=200&fit=crop' },
  { keyword: '망고', emoji: '🥭', image: 'https://images.unsplash.com/photo-1553279768-865429fa0078?w=200&h=200&fit=crop' },
  { keyword: '파인애플', emoji: '🍍', image: 'https://images.unsplash.com/photo-1550258987-190a2d41a8ba?w=200&h=200&fit=crop' },
  { keyword: '자몽', emoji: '🍊', image: 'https://images.unsplash.com/photo-1577234286642-fc512a5f8f11?w=200&h=200&fit=crop' },
  { keyword: '멜론', emoji: '🍈', image: 'https://images.unsplash.com/photo-1571575173700-afb9492e6a50?w=200&h=200&fit=crop' },

  // ── 채소 ──
  { keyword: '양배추', emoji: '🥬', image: 'https://images.unsplash.com/photo-1594282486552-05b4d80fbb9f?w=200&h=200&fit=crop' },
  { keyword: '브로콜리', emoji: '🥦', image: 'https://images.unsplash.com/photo-1615485290382-441e4d049cb5?w=200&h=200&fit=crop' },
  { keyword: '당근', emoji: '🥕', image: 'https://images.unsplash.com/photo-1598170845058-32b9d6a5da37?w=200&h=200&fit=crop' },
  { keyword: '감자', emoji: '🥔', image: 'https://images.unsplash.com/photo-1518977676601-b53f82aba655?w=200&h=200&fit=crop' },
  { keyword: '고구마', emoji: '🍠', image: 'https://images.unsplash.com/photo-1590165482129-1b8b27698780?w=200&h=200&fit=crop' },
  { keyword: '양파', emoji: '🧅', image: 'https://images.unsplash.com/photo-1518977956812-cd3dbadaaf31?w=200&h=200&fit=crop' },
  { keyword: '마늘', emoji: '🧄', image: 'https://images.unsplash.com/photo-1540148426945-6cf22a6b2383?w=200&h=200&fit=crop' },
  { keyword: '옥수수', emoji: '🌽', image: 'https://images.unsplash.com/photo-1551754655-cd27e38d2076?w=200&h=200&fit=crop' },
  { keyword: '고추', emoji: '🌶️', image: 'https://images.unsplash.com/photo-1588252303782-cb80119abd6d?w=200&h=200&fit=crop' },
  { keyword: '버섯', emoji: '🍄', image: 'https://images.unsplash.com/photo-1504545102780-26774c1bb073?w=200&h=200&fit=crop' },
  { keyword: '파프리카', emoji: '🫑', image: 'https://images.unsplash.com/photo-1563565375-f3fdfdbefa83?w=200&h=200&fit=crop' },
  { keyword: '시금치', emoji: '🥬', image: 'https://images.unsplash.com/photo-1576045057995-568f588f82fb?w=200&h=200&fit=crop' },
  { keyword: '상추', emoji: '🥬', image: 'https://images.unsplash.com/photo-1622206151226-18ca2c9ab4a1?w=200&h=200&fit=crop' },
  { keyword: '호박', emoji: '🎃', image: 'https://images.unsplash.com/photo-1570586437263-ab629fccc818?w=200&h=200&fit=crop' },
  { keyword: '오이', emoji: '🥒', image: 'https://images.unsplash.com/photo-1449300079323-02e209d9d3a6?w=200&h=200&fit=crop' },
  { keyword: '배추', emoji: '🥬', image: 'https://images.unsplash.com/photo-1594282486552-05b4d80fbb9f?w=200&h=200&fit=crop' },

  // ── 축산 ──
  { keyword: '소고기', emoji: '🥩', image: 'https://images.unsplash.com/photo-1529692236671-f1f6cf9683ba?w=200&h=200&fit=crop' },
  { keyword: '한우', emoji: '🥩', image: 'https://images.unsplash.com/photo-1529692236671-f1f6cf9683ba?w=200&h=200&fit=crop' },
  { keyword: '돼지', emoji: '🥩', image: 'https://images.unsplash.com/photo-1544025162-d76694265947?w=200&h=200&fit=crop' },
  { keyword: '삼겹살', emoji: '🥓', image: 'https://images.unsplash.com/photo-1544025162-d76694265947?w=200&h=200&fit=crop' },
  { keyword: '목살', emoji: '🥩', image: 'https://images.unsplash.com/photo-1544025162-d76694265947?w=200&h=200&fit=crop' },
  { keyword: '닭', emoji: '🍗', image: 'https://images.unsplash.com/photo-1587593810167-a84920ea0781?w=200&h=200&fit=crop' },
  { keyword: '오리', emoji: '🦆', image: 'https://images.unsplash.com/photo-1504674900247-0877df9cc836?w=200&h=200&fit=crop' },

  // ── 수산 ──
  { keyword: '생선', emoji: '🐟', image: 'https://images.unsplash.com/photo-1510130113356-d26b1e38e34c?w=200&h=200&fit=crop' },
  { keyword: '연어', emoji: '🐟', image: 'https://images.unsplash.com/photo-1574781330855-d0db8cc6a79c?w=200&h=200&fit=crop' },
  { keyword: '참치', emoji: '🐟', image: 'https://images.unsplash.com/photo-1544551763-46a013bb70d5?w=200&h=200&fit=crop' },
  { keyword: '새우', emoji: '🦐', image: 'https://images.unsplash.com/photo-1565680018093-ebb6b9e3a057?w=200&h=200&fit=crop' },
  { keyword: '오징어', emoji: '🦑', image: 'https://images.unsplash.com/photo-1504544750208-dc0358e63f7f?w=200&h=200&fit=crop' },
  { keyword: '게', emoji: '🦀', image: 'https://images.unsplash.com/photo-1510130113356-d26b1e38e34c?w=200&h=200&fit=crop' },
  { keyword: '굴', emoji: '🦪', image: 'https://images.unsplash.com/photo-1606685614236-05afdb945058?w=200&h=200&fit=crop' },
  { keyword: '조개', emoji: '🐚', image: 'https://images.unsplash.com/photo-1606685614236-05afdb945058?w=200&h=200&fit=crop' },
  { keyword: '전복', emoji: '🐚', image: 'https://images.unsplash.com/photo-1606685614236-05afdb945058?w=200&h=200&fit=crop' },
  { keyword: '고등어', emoji: '🐟', image: 'https://images.unsplash.com/photo-1544551763-46a013bb70d5?w=200&h=200&fit=crop' },
  { keyword: '갈치', emoji: '🐟', image: 'https://images.unsplash.com/photo-1544551763-46a013bb70d5?w=200&h=200&fit=crop' },

  // ── 유제품/가공 ──
  { keyword: '계란', emoji: '🥚', image: 'https://images.unsplash.com/photo-1582722872445-44dc5f7e3c8f?w=200&h=200&fit=crop' },
  { keyword: '달걀', emoji: '🥚', image: 'https://images.unsplash.com/photo-1582722872445-44dc5f7e3c8f?w=200&h=200&fit=crop' },
  { keyword: '우유', emoji: '🥛', image: 'https://images.unsplash.com/photo-1563636619-e9143da7973b?w=200&h=200&fit=crop' },
  { keyword: '치즈', emoji: '🧀', image: 'https://images.unsplash.com/photo-1486297678162-eb2a19b0a32d?w=200&h=200&fit=crop' },
  { keyword: '빵', emoji: '🍞', image: 'https://images.unsplash.com/photo-1509440159596-0249088772ff?w=200&h=200&fit=crop' },
  { keyword: '두부', emoji: '🫘', image: 'https://images.unsplash.com/photo-1585032226651-759b368d7246?w=200&h=200&fit=crop' },
  { keyword: '쌀', emoji: '🍚', image: 'https://images.unsplash.com/photo-1586201375761-83865001e31c?w=200&h=200&fit=crop' },
  { keyword: '햄', emoji: '🥩', image: 'https://images.unsplash.com/photo-1529692236671-f1f6cf9683ba?w=200&h=200&fit=crop' },
  { keyword: '소시지', emoji: '🌭', image: 'https://images.unsplash.com/photo-1612871689353-cdc79da28ad3?w=200&h=200&fit=crop' },

  // ── 음료 ──
  { keyword: '커피', emoji: '☕', image: 'https://images.unsplash.com/photo-1495474472287-4d71bcdd2085?w=200&h=200&fit=crop' },
  { keyword: '맥주', emoji: '🍺', image: 'https://images.unsplash.com/photo-1535958636474-b021ee887b13?w=200&h=200&fit=crop' },
  { keyword: '와인', emoji: '🍷', image: 'https://images.unsplash.com/photo-1510812431401-41d2bd2722f3?w=200&h=200&fit=crop' },
  { keyword: '주스', emoji: '🧃', image: 'https://images.unsplash.com/photo-1621506289937-a8e4df240d0b?w=200&h=200&fit=crop' },
  { keyword: '물', emoji: '💧', image: 'https://images.unsplash.com/photo-1548839140-29a749e1cf4d?w=200&h=200&fit=crop' },

  // ── 간식 ──
  { keyword: '케이크', emoji: '🎂', image: 'https://images.unsplash.com/photo-1578985545062-69928b1d9587?w=200&h=200&fit=crop' },
  { keyword: '초콜릿', emoji: '🍫', image: 'https://images.unsplash.com/photo-1606312619070-d48b4c652a52?w=200&h=200&fit=crop' },
  { keyword: '과자', emoji: '🍪', image: 'https://images.unsplash.com/photo-1499636136210-6f4ee915583e?w=200&h=200&fit=crop' },
  { keyword: '쿠키', emoji: '🍪', image: 'https://images.unsplash.com/photo-1499636136210-6f4ee915583e?w=200&h=200&fit=crop' },
  { keyword: '아이스크림', emoji: '🍦', image: 'https://images.unsplash.com/photo-1497034825429-c343d7c6a68f?w=200&h=200&fit=crop' },

  // ── 가공식품 ──
  { keyword: '김치', emoji: '🥬', image: 'https://images.unsplash.com/photo-1583224964978-2257b960c3d3?w=200&h=200&fit=crop' },
  { keyword: '라면', emoji: '🍜', image: 'https://images.unsplash.com/photo-1569058242567-93de6f36f8e6?w=200&h=200&fit=crop' },
  { keyword: '국수', emoji: '🍜', image: 'https://images.unsplash.com/photo-1569058242567-93de6f36f8e6?w=200&h=200&fit=crop' },
  { keyword: '만두', emoji: '🥟', image: 'https://images.unsplash.com/photo-1534422298391-e4f8c172dddb?w=200&h=200&fit=crop' },
  { keyword: '피자', emoji: '🍕', image: 'https://images.unsplash.com/photo-1565299624946-b28f40a0ae38?w=200&h=200&fit=crop' },

  // ── 꽃 (향후 꽃집 확장) ──
  { keyword: '꽃', emoji: '💐', image: 'https://images.unsplash.com/photo-1490750967868-88aa4f44baee?w=200&h=200&fit=crop' },
  { keyword: '장미', emoji: '🌹', image: 'https://images.unsplash.com/photo-1490750967868-88aa4f44baee?w=200&h=200&fit=crop' },
];

/**
 * 상품명에서 키워드를 매칭하여 이모지 + 이미지 URL을 반환.
 * 매칭되지 않으면 이모지만 '📦', 이미지는 null.
 */
export function getProductDisplay(productName: string): ProductDisplay {
  const name = productName.toLowerCase();
  for (const entry of PRODUCT_MAP) {
    if (name.includes(entry.keyword)) {
      return { emoji: entry.emoji, imageUrl: entry.image };
    }
  }
  return { emoji: '📦', imageUrl: null };
}

/**
 * 이모지만 반환 (하위호환용 — 기존 getEmoji 대체)
 */
export function getEmoji(productName: string): string {
  return getProductDisplay(productName).emoji;
}

/**
 * 이미지 태그 또는 이모지 태그 반환 (HTML 렌더링용)
 * @param size - 이미지 크기 (기본 48px)
 */
export function renderProductImage(productName: string, size: number = 48): string {
  const { emoji, imageUrl } = getProductDisplay(productName);
  if (imageUrl) {
    return `<img src="${imageUrl}" alt="${productName}" style="width:${size}px;height:${size}px;object-fit:cover;border-radius:8px;" loading="lazy" onerror="this.style.display='none';this.nextElementSibling.style.display='block'"><span style="display:none;font-size:${size * 0.6}px">${emoji}</span>`;
  }
  return `<span style="font-size:${size * 0.6}px">${emoji}</span>`;
}
