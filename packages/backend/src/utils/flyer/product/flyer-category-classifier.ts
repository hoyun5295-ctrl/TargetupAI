/**
 * ★ 전단AI: 상품 자동 카테고리 분류
 *
 * 3단계 파이프라인:
 *  1. 키워드 규칙 매칭 (즉시, 80%+ 커버)
 *  2. 카탈로그 DB 참조 (기존 등록 상품)
 *  3. AI 폴백 (미분류만 배치 호출)
 *
 * 업종별 키워드 맵 지원 (mart/butcher).
 */

import { query } from '../../../config/database';
import { callAIWithFallback } from '../../../services/ai';

// ============================================================
// 업종별 키워드 규칙
// ============================================================

const MART_KEYWORDS: Array<{ category: string; pattern: RegExp }> = [
  { category: '축산', pattern: /삼겹살|목살|갈비|등심|안심|차돌|불고기|돼지|소고기|닭|오리|양고기|한우|수입육|제비추리|부채살|꽃등심|육전|스테이크|베이컨|소시지|햄/i },
  { category: '수산', pattern: /연어|새우|고등어|갈치|꽁치|조기|오징어|문어|전복|굴|멸치|참치|광어|우럭|방어|대게|킹크랩|랍스터|조개|홍합|게맛살|어묵|맛살|미역|다시마|김/i },
  { category: '청과/야채', pattern: /사과|배|감|귤|딸기|포도|수박|참외|토마토|감자|양파|마늘|고추|오이|배추|무|당근|브로콜리|파프리카|시금치|상추|깻잎|대파|부추|콩나물|버섯|고구마|바나나|키위|망고|블루베리|아보카도|레몬|자몽|체리|복숭아|자두|멜론/i },
  { category: '유제품', pattern: /우유|요거트|요구르트|치즈|버터|크림|생크림|연유|분유|두유|아이스크림/i },
  { category: '냉동', pattern: /만두|피자|냉동|빙과|아이스|냉면|떡볶이|치킨너겟|핫도그|동그랑땡/i },
  { category: '음료/주류', pattern: /맥주|소주|막걸리|와인|위스키|콜라|사이다|커피|차|주스|물|탄산|에너지드링크|식혜|수정과|제로|스파클링/i },
  { category: '공산품', pattern: /라면|과자|빵|통조림|소스|장류|조미료|식용유|참기름|들기름|간장|된장|고추장|김치|반찬|떡|두부|젓갈|밀가루|설탕|소금|후추/i },
  { category: '생활용품', pattern: /세제|샴푸|린스|치약|칫솔|휴지|물티슈|건전지|비누|핸드워시|섬유유연제|주방세제|방향제|쓰레기봉투|랩|호일/i },
];

const BUTCHER_KEYWORDS: Array<{ category: string; pattern: RegExp }> = [
  { category: '한우', pattern: /한우|1\+\+|1\+|투플러스|원플러스|꽃등심|채끝|안심|등심|갈비살|치마살|업진살|토시살|제비추리|부채살/i },
  { category: '돼지', pattern: /삼겹살|목살|앞다리|뒷다리|갈비|항정살|가브리살|돼지|족발|보쌈|수육/i },
  { category: '수입육', pattern: /수입|미국산|호주산|캐나다|뉴질랜드|앵거스|블랙앵거스|척아이롤|부채살|토마호크|티본|립아이/i },
  { category: '닭/오리', pattern: /닭|오리|치킨|닭가슴살|닭다리|닭날개|훈제오리|통닭/i },
  { category: '양념/가공', pattern: /양념|불고기|제육|소시지|햄|베이컨|육포|떡갈비|동그랑땡|완자/i },
  { category: '선물세트', pattern: /선물|세트|한우세트|명절|추석|설날|모둠/i },
];

// ============================================================
// 1단계: 키워드 규칙 매칭
// ============================================================

function classifyByKeywords(
  items: Array<{ name: string }>,
  businessType: string
): { classified: Record<string, string[]>; unclassified: string[] } {
  const rules = businessType === 'butcher' ? BUTCHER_KEYWORDS : MART_KEYWORDS;
  const classified: Record<string, string[]> = {};
  const unclassified: string[] = [];

  for (const item of items) {
    const name = item.name.trim();
    if (!name) continue;

    let matched = false;
    for (const rule of rules) {
      if (rule.pattern.test(name)) {
        if (!classified[rule.category]) classified[rule.category] = [];
        classified[rule.category].push(name);
        matched = true;
        break;
      }
    }
    if (!matched) unclassified.push(name);
  }

  return { classified, unclassified };
}

// ============================================================
// 2단계: 카탈로그 DB 참조
// ============================================================

async function classifyByCatalog(
  unclassified: string[],
  companyId: string
): Promise<{ classified: Record<string, string[]>; remaining: string[] }> {
  if (unclassified.length === 0) return { classified: {}, remaining: [] };

  const placeholders = unclassified.map((_, i) => `$${i + 2}`).join(',');
  const result = await query(
    `SELECT product_name, category FROM flyer_catalog
     WHERE company_id = $1 AND product_name IN (${placeholders}) AND category IS NOT NULL`,
    [companyId, ...unclassified]
  );

  const catalogMap = new Map<string, string>();
  for (const row of result.rows) {
    catalogMap.set(row.product_name, row.category);
  }

  const classified: Record<string, string[]> = {};
  const remaining: string[] = [];

  for (const name of unclassified) {
    const cat = catalogMap.get(name);
    if (cat) {
      if (!classified[cat]) classified[cat] = [];
      classified[cat].push(name);
    } else {
      remaining.push(name);
    }
  }

  return { classified, remaining };
}

// ============================================================
// 3단계: AI 폴백 (미분류만 배치)
// ============================================================

async function classifyByAI(
  remaining: string[],
  businessType: string,
  availableCategories: string[]
): Promise<Record<string, string[]>> {
  if (remaining.length === 0) return {};

  const catList = availableCategories.join(', ');
  const itemList = remaining.map((n, i) => `${i + 1}. ${n}`).join('\n');
  const bizLabel = businessType === 'butcher' ? '정육점' : '마트';

  const result = await callAIWithFallback({
    system: `당신은 ${bizLabel} 상품 분류 전문가입니다. 주어진 카테고리 중 하나로 분류해주세요.`,
    userMessage: `다음 상품들을 아래 카테고리 중 하나로 분류해주세요.
카테고리: [${catList}]

상품 목록:
${itemList}

JSON으로만 응답하세요. 형식: {"카테고리명": ["상품1", "상품2"]}
카테고리에 맞지 않으면 "기타"로 분류하세요.`,
    maxTokens: 512,
    temperature: 0.3,
  });

  try {
    const jsonMatch = result.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return { '기타': remaining };
    return JSON.parse(jsonMatch[0]);
  } catch {
    return { '기타': remaining };
  }
}

// ============================================================
// 통합 파이프라인
// ============================================================

export async function classifyProducts(
  items: Array<{ name: string }>,
  businessType: string,
  companyId: string
): Promise<Record<string, string[]>> {
  // 1단계: 키워드
  const step1 = classifyByKeywords(items, businessType);

  // 2단계: 카탈로그 DB
  const step2 = await classifyByCatalog(step1.unclassified, companyId);

  // 결과 머지
  const merged: Record<string, string[]> = { ...step1.classified };
  for (const [cat, names] of Object.entries(step2.classified)) {
    if (!merged[cat]) merged[cat] = [];
    merged[cat].push(...names);
  }

  // 3단계: AI (미분류 5개 이상일 때만 — 비용 절약)
  if (step2.remaining.length > 0) {
    const allCategories = Object.keys(merged);
    if (step2.remaining.length >= 5) {
      const step3 = await classifyByAI(step2.remaining, businessType, allCategories);
      for (const [cat, names] of Object.entries(step3)) {
        if (!merged[cat]) merged[cat] = [];
        merged[cat].push(...names);
      }
    } else {
      if (!merged['기타']) merged['기타'] = [];
      merged['기타'].push(...step2.remaining);
    }
  }

  return merged;
}
