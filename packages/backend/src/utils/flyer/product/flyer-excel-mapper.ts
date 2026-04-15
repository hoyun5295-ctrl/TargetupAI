/**
 * ★ CT-F24 — 전단AI 엑셀 업로드 + AI 자동 매핑
 *
 * 한줄로AI upload.ts의 AI 매핑 패턴을 전단AI에 적용.
 * 엑셀(xlsx/xls) 업로드 → 헤더 추출 → AI 자동 매핑 → 상품 데이터 변환
 *
 * 매핑 대상 필드:
 *   - product_name: 상품명 (필수)
 *   - sale_price: 판매가/할인가 (필수)
 *   - original_price: 원가/정가
 *   - unit: 단위/규격 (kg, g, 팩, 봉 등)
 *   - category: 카테고리 (축산, 청과, 수산 등)
 *   - promo_type: 행사구분 (메인/서브/일반)
 *   - origin: 원산지
 *   - image_url: 이미지 URL
 */

import { AI_MODELS, AI_MAX_TOKENS } from '../../../config/defaults';

// ============================================================
// 타입
// ============================================================
export interface FlyerProductMapping {
  [excelHeader: string]: string | null;
}

export interface FlyerMappingResult {
  success: boolean;
  mapping: FlyerProductMapping;
  unmapped: string[];
  hasProductName: boolean;
  hasSalePrice: boolean;
  message: string;
}

export interface MappedProduct {
  productName: string;
  salePrice: number;
  originalPrice: number;
  unit: string;
  category: string;
  promoType: 'main' | 'sub' | 'general';
  origin: string;
  imageUrl: string;
}

// ============================================================
// 매핑 대상 필드 정의
// ============================================================
const FLYER_PRODUCT_FIELDS: Record<string, string> = {
  product_name: '상품명 (필수 — 상품이름, 품명, 품목, 제품명)',
  sale_price: '판매가/할인가 (필수 — 가격, 판매금액, 행사가, 특가)',
  original_price: '원가/정가 (정상가, 기존가, 원래가격)',
  unit: '단위/규격 (kg, g, 팩, 봉, 개, 박스, 100g 등)',
  category: '카테고리 (축산, 정육, 청과, 과일, 채소, 수산, 유제품, 가공식품, 주류, 생활용품, 베이커리 등)',
  promo_type: '행사구분 (메인행사, 서브행사, 일반, 특가, BEST 등)',
  origin: '원산지 (국내산, 미국산, 호주산 등)',
  image_url: '이미지 URL',
};

// ============================================================
// AI 자동 매핑
// ============================================================
export async function mapFlyerExcelHeaders(headers: string[]): Promise<FlyerMappingResult> {
  const mappingPrompt = `엑셀 파일의 컬럼명을 마트 전단지 상품 데이터 필드에 매핑해줘.

엑셀 컬럼명: ${JSON.stringify(headers)}

매핑 대상 필드:
${Object.entries(FLYER_PRODUCT_FIELDS).map(([k, v]) => `- ${k}: ${v}`).join('\n')}

규칙:
1. 의미가 비슷하면 매핑 (예: 품명 → product_name, 가격 → sale_price, 정상가 → original_price)
2. 매핑할 수 없는 컬럼은 null
3. product_name(상품명)과 sale_price(판매가)는 반드시 찾아서 매핑
4. "가격"이 하나만 있으면 sale_price로 매핑
5. "가격"이 두 개면 큰 쪽을 original_price, 작은 쪽을 sale_price
6. 행사구분이 없으면 promo_type은 null (자동 분류됨)

JSON 형식으로만 응답 (다른 설명 없이):
{"엑셀컬럼명": "필드명(영문) 또는 null", ...}

예시: {"상품명": "product_name", "가격": "sale_price", "정가": "original_price", "규격": "unit", "분류": "category", "NO": null}
⚠️ 반드시 영문 필드명을 값으로 넣어야 합니다!`;

  let aiText = '{}';

  // 1차: Claude
  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY || '',
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: AI_MODELS.claude,
        max_tokens: AI_MAX_TOKENS.fieldMapping || 1024,
        messages: [{ role: 'user', content: mappingPrompt }],
      }),
    });
    const aiResult: any = await response.json();
    if (aiResult.error) throw new Error(aiResult.error.message);
    aiText = aiResult.content?.[0]?.text || '{}';
    console.log('[CT-F24] AI 매핑 성공 (Claude)');
  } catch (claudeErr: any) {
    console.warn(`[CT-F24] Claude 실패 (${claudeErr.message}) → GPT fallback`);

    // 2차: GPT fallback
    if (!process.env.OPENAI_API_KEY) throw new Error('Claude 실패 + OPENAI_API_KEY 미설정');
    const gptRes = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: AI_MODELS.gpt || 'gpt-4o-mini',
        max_completion_tokens: AI_MAX_TOKENS.fieldMapping || 1024,
        messages: [{ role: 'user', content: mappingPrompt }],
      }),
    });
    const gptResult: any = await gptRes.json();
    aiText = gptResult.choices?.[0]?.message?.content || '{}';
    console.log('[CT-F24] AI 매핑 성공 (GPT fallback)');
  }

  // 응답 파싱
  let mapping: FlyerProductMapping = {};
  try {
    const jsonMatch = aiText.match(/\{[\s\S]*\}/);
    if (jsonMatch) mapping = JSON.parse(jsonMatch[0]);
  } catch {
    console.error('[CT-F24] AI 응답 파싱 실패:', aiText);
    headers.forEach(h => { mapping[h] = null; });
  }

  const hasProductName = Object.values(mapping).includes('product_name');
  const hasSalePrice = Object.values(mapping).includes('sale_price');
  const unmapped = Object.entries(mapping).filter(([_, v]) => v === null).map(([k]) => k);

  return {
    success: true,
    mapping,
    unmapped,
    hasProductName,
    hasSalePrice,
    message: hasProductName && hasSalePrice
      ? 'AI 매핑 완료'
      : !hasProductName
        ? '상품명 컬럼을 찾을 수 없습니다.'
        : '가격 컬럼을 찾을 수 없습니다.',
  };
}

// ============================================================
// 매핑 적용: 엑셀 row 데이터 → 상품 배열 변환
// ============================================================
export function applyFlyerMapping(
  rows: Record<string, any>[],
  mapping: FlyerProductMapping,
): MappedProduct[] {
  // 역매핑: DB필드 → 엑셀헤더
  const reverseMap: Record<string, string> = {};
  for (const [excelHeader, field] of Object.entries(mapping)) {
    if (field) reverseMap[field] = excelHeader;
  }

  return rows
    .map(row => {
      const getName = (field: string) => {
        const header = reverseMap[field];
        if (!header) return '';
        const val = row[header];
        return val != null ? String(val).trim() : '';
      };
      const getNum = (field: string) => {
        const val = getName(field).replace(/[,원₩\s]/g, '');
        return parseInt(val, 10) || 0;
      };

      const productName = getName('product_name');
      if (!productName) return null;

      const salePrice = getNum('sale_price');
      const originalPrice = getNum('original_price');
      const promoTypeRaw = getName('promo_type').toLowerCase();

      let promoType: 'main' | 'sub' | 'general' = 'general';
      if (/메인|best|특가|대표/.test(promoTypeRaw)) promoType = 'main';
      else if (/서브|추천|인기/.test(promoTypeRaw)) promoType = 'sub';
      else if (originalPrice > 0 && salePrice > 0) {
        const discRate = Math.round((1 - salePrice / originalPrice) * 100);
        if (discRate >= 30) promoType = 'main';
        else if (discRate >= 10) promoType = 'sub';
      }

      return {
        productName,
        salePrice,
        originalPrice,
        unit: getName('unit'),
        category: getName('category') || '기타',
        promoType,
        origin: getName('origin'),
        imageUrl: getName('image_url'),
      };
    })
    .filter((p): p is MappedProduct => p !== null);
}

// ============================================================
// 매핑 대상 필드 목록 (프론트엔드 UI용)
// ============================================================
export function getFlyerMappingFields() {
  return Object.entries(FLYER_PRODUCT_FIELDS).map(([key, desc]) => ({
    fieldKey: key,
    displayName: desc.split('(')[0].trim(),
    description: desc,
    required: key === 'product_name' || key === 'sale_price',
  }));
}
