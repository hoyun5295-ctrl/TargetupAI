/**
 * ★ CT-96: AI Column Mapper — D219+ Part 2 (2026-05-27 신설)
 *
 * 🎯 목적
 *   Wizard step 3: 사용자가 업로드한 Excel/CSV 컬럼명 + 샘플 5건 → AI Opus 4.7 호출 →
 *   customers 표준 컬럼 자동 매핑 + confidence score 반환.
 *
 *   사용자 직접 매핑 form 30+ 클릭 → AI 자동 매핑 + confirm 1 click 흐름 정합.
 *
 *   ★ confidence 0.8 미만 = 사용자 수동 정정 의무 안내 (UI 안 dropdown 활성).
 *
 * 📋 활용
 *   const { mappings, confidenceScore } = await mapColumnsWithAi({
 *     companyId,
 *     columnNames: ['이름', '연락처', '생년월일', '구매일'],
 *     sampleRows: [['홍길동', '010-1234-5678', '1990-05-15', '2026-04-01'], ...],
 *   });
 *   // mappings = [{ source: '이름', target: 'name', confidence: 0.98 }, ...]
 */

import { callAIWithFallback } from '../services/ai';

// ════════════════════════════════════════════════════════════════════
// 타입
// ════════════════════════════════════════════════════════════════════

export interface MapColumnsInput {
  companyId: string;
  /** Excel/CSV 첫 행 컬럼명 매트릭스. */
  columnNames: string[];
  /** 첫 5건 샘플 데이터 (각 row = columnNames와 같은 길이 배열). */
  sampleRows: Array<Array<string | number | null>>;
}

export interface ColumnMapping {
  /** 원본 컬럼명 (사용자 파일 안). */
  source: string;
  /** customers 표준 컬럼 (또는 custom_fields.{key}). null = 매핑 안 함 (skip). */
  target: string | null;
  /** AI 추론 신뢰도 (0.0 ~ 1.0). 0.8 미만 = 사용자 정정 안내 의무. */
  confidence: number;
  /** AI 추론 근거 (사용자 안내). */
  reason: string;
}

export interface MapColumnsResult {
  mappings: ColumnMapping[];
  /** 전체 평균 신뢰도. */
  confidenceScore: number;
  /** 사용자 정정 필요 여부 (0.8 미만 항목 있으면 true). */
  needsManualReview: boolean;
}

export class ColumnMappingError extends Error {
  constructor(public code: string, message: string) {
    super(message);
    this.name = 'ColumnMappingError';
  }
}

// ════════════════════════════════════════════════════════════════════
// 표준 컬럼 매트릭스 (AI 시스템 프롬프트 안 명시)
// ════════════════════════════════════════════════════════════════════

const TARGET_COLUMNS: Array<{ key: string; label: string; example: string }> = [
  { key: 'phone', label: '휴대폰', example: '010-1234-5678 또는 01012345678' },
  { key: 'name', label: '고객명', example: '홍길동' },
  { key: 'email', label: '이메일', example: 'user@example.com' },
  { key: 'gender', label: '성별', example: 'M / F / 남 / 여' },
  { key: 'birth_date', label: '생년월일', example: '1990-05-15 또는 19900515' },
  { key: 'age', label: '나이', example: '30' },
  { key: 'address', label: '주소', example: '서울시 강남구' },
  { key: 'region', label: '지역', example: '서울' },
  { key: 'grade', label: '회원 등급', example: 'VIP / 골드 / 일반' },
  { key: 'store_code', label: '매장 코드', example: 'ST001' },
  { key: 'store_name', label: '매장명', example: '강남점' },
  { key: 'points', label: '포인트', example: '15000' },
  { key: 'recent_purchase_date', label: '최근 구매일', example: '2026-04-01' },
  { key: 'recent_purchase_amount', label: '최근 구매 금액', example: '50000' },
  { key: 'total_purchase_amount', label: '누적 구매 금액', example: '500000' },
  { key: 'purchase_count', label: '구매 횟수', example: '5' },
  { key: 'wedding_anniversary', label: '결혼기념일', example: '2020-09-10' },
  { key: 'is_married', label: '결혼 여부', example: 'true / false / Y / N' },
  { key: 'sms_opt_in', label: 'SMS 수신 동의', example: 'true / false / Y / N' },
];

function buildSystemPrompt(): string {
  const fields = TARGET_COLUMNS.map((c) => `- ${c.key} (${c.label}): 예: ${c.example}`).join('\n');
  return `당신은 한줄로 마케팅 SaaS의 Excel/CSV 컬럼 자동 매핑 AI입니다.
사용자가 업로드한 파일의 컬럼명 + 샘플 데이터를 보고, 각 컬럼을 표준 customers 컬럼에 매핑합니다.

[표준 customers 컬럼]
${fields}
- custom_fields.{키}: 위 표준 컬럼에 없는 사용자 정의 필드 (영문/한글 키 모두 가능)

[규칙]
1. 각 원본 컬럼마다 가장 잘 맞는 표준 컬럼을 1개만 선택 (또는 매핑 안 함 = null)
2. 컬럼명 + 샘플 데이터 양쪽 모두 참고 (이름이 명확해도 샘플 데이터가 다르면 의심)
3. confidence는 0.0 ~ 1.0 (0.8 이상이 안전 매핑)
4. 표준 컬럼에 없는 의미 있는 필드 (예: "쿠폰 보유 개수") = custom_fields.{key} 매핑 (key는 영문 snake_case)
5. 명백히 의미 없는 컬럼 (예: 순번, 빈 컬럼) = target = null, confidence = 1.0

[응답 형식: JSON 단일]
\`\`\`json
{
  "mappings": [
    { "source": "원본 컬럼명", "target": "표준 컬럼 키 또는 custom_fields.xxx 또는 null", "confidence": 0.0~1.0, "reason": "추론 근거 (한국어 1문장)" },
    ...
  ]
}
\`\`\`

[예시]
입력: 컬럼 = ["고객명", "휴대폰번호", "주소", "쿠폰개수"], 샘플 = [["홍길동", "010-1234-5678", "서울시 강남구", "3"], ...]
응답:
\`\`\`json
{
  "mappings": [
    { "source": "고객명", "target": "name", "confidence": 0.98, "reason": "컬럼명 + 한글 이름 샘플 일치" },
    { "source": "휴대폰번호", "target": "phone", "confidence": 0.99, "reason": "010-xxxx 패턴" },
    { "source": "주소", "target": "address", "confidence": 0.97, "reason": "주소 형식 일치" },
    { "source": "쿠폰개수", "target": "custom_fields.coupon_count", "confidence": 0.85, "reason": "표준 컬럼에 없는 회사별 필드" }
  ]
}
\`\`\``;
}

function extractJSON(text: string): string {
  if (text.includes('```json')) {
    const start = text.indexOf('```json') + 7;
    const end = text.indexOf('```', start);
    return text.slice(start, end).trim();
  }
  if (text.includes('```')) {
    const start = text.indexOf('```') + 3;
    const end = text.indexOf('```', start);
    return text.slice(start, end).trim();
  }
  return text.trim();
}

// ════════════════════════════════════════════════════════════════════
// 메인 함수
// ════════════════════════════════════════════════════════════════════

export async function mapColumnsWithAi(input: MapColumnsInput): Promise<MapColumnsResult> {
  const { companyId, columnNames, sampleRows } = input;

  if (!Array.isArray(columnNames) || columnNames.length === 0) {
    throw new ColumnMappingError('NO_COLUMNS', '매핑할 컬럼이 없습니다.');
  }
  if (columnNames.length > 200) {
    throw new ColumnMappingError('TOO_MANY_COLUMNS', '컬럼 수가 200개를 초과합니다.');
  }

  // 샘플 5건까지만 사용 (AI 토큰 절감)
  const limitedSamples = sampleRows.slice(0, 5);
  const userMessage = `컬럼명 매트릭스: ${JSON.stringify(columnNames)}
샘플 데이터 (최대 5건):
${limitedSamples.map((row, idx) => `${idx + 1}. ${JSON.stringify(row)}`).join('\n')}

위 컬럼을 표준 customers 컬럼 또는 custom_fields.{키}로 매핑해주세요.`;

  const aiResult = await callAIWithFallback({
    system: buildSystemPrompt(),
    userMessage,
    model: 'opus',
    maxTokens: 4096,
    temperature: 0.1, // 매핑 정확성 우선 — 매우 낮은 temperature
    companyId,
    source: 'ai-column-mapper',
  });

  let parsed: any;
  try {
    parsed = JSON.parse(extractJSON(aiResult || ''));
  } catch (e: any) {
    throw new ColumnMappingError('AI_RESPONSE_INVALID', `AI 응답 파싱 실패: ${e.message}`);
  }

  const mappings: ColumnMapping[] = (parsed?.mappings || []).map((m: any) => ({
    source: String(m.source || ''),
    target: m.target ? String(m.target) : null,
    confidence: Math.max(0, Math.min(1, Number(m.confidence) || 0)),
    reason: String(m.reason || '').slice(0, 200),
  })).filter((m: ColumnMapping) => m.source);

  if (mappings.length === 0) {
    throw new ColumnMappingError('NO_MAPPINGS', 'AI가 매핑을 추출하지 못했습니다.');
  }

  // 원본 컬럼 누락 보정 — AI가 일부 컬럼을 안내 빠뜨린 경우 target=null로 채움
  for (const col of columnNames) {
    if (!mappings.find((m) => m.source === col)) {
      mappings.push({ source: col, target: null, confidence: 0.5, reason: 'AI 매핑 결과 누락. 수동 정정 의무' });
    }
  }

  const totalConfidence = mappings.reduce((sum, m) => sum + m.confidence, 0);
  const confidenceScore = mappings.length > 0 ? totalConfidence / mappings.length : 0;
  const needsManualReview = mappings.some((m) => m.target !== null && m.confidence < 0.8);

  return {
    mappings,
    confidenceScore,
    needsManualReview,
  };
}
