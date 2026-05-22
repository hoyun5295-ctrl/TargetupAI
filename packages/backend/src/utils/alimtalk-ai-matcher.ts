/**
 * ★ CT-48: 알림톡 자동 템플릿 매칭 + 변수 자동 매핑 (AI 판단) — D190 #3 (2026-05-22)
 *
 * 🎯 목적
 *   캠페인 의도(자연어) → 회사 보유 승인 템플릿 매트릭스 → Opus 4.7 매칭 판단 → 정합 1건 추천 + 변수 자동 매핑
 *   진정 AI Operator 본질 정합 — AI 의견 제안 + 회사 admin 검토 + 승인 후 발송 (영구 원칙 #1)
 *
 * 📋 매칭 원칙
 *   - 회사 보유 승인 템플릿 (kakao_templates WHERE status='APPROVED') 중 매칭
 *   - 캠페인 의도 키워드 + 템플릿 본문/제목/카테고리 매트릭스 정합
 *   - Memory 학습 데이터 통합 (회사별 과거 사용 패턴 + 클릭률 누적)
 *   - 정합 0건 시 추천 X — 회사 admin에게 템플릿 등록 안내 (자동완화 금지)
 *
 * 🔧 변수 자동 매핑
 *   - 템플릿 변수 (#{변수명}) → customer 표준 필드 자동 매핑 (FIELD_MAP 기반)
 *   - 정확 매칭 + 유사도 매칭 (#{고객명} ↔ name / #{등급} ↔ grade 등)
 *   - 미매핑 변수 = 회사 admin 직접 입력 영역 (강제 X)
 *
 * ⛔ 영구 원칙
 *   - AI 추천만 — 회사 admin 검토 + 승인 후 발송 (AI 단독 실행 X)
 *   - 모델 분리 — Opus 4.7 (AI Operator 영역, Sonnet 4.6 흐름 영향 0건)
 *   - 회사 격리 — 본 회사 보유 템플릿만 매트릭스 정독
 */

import { query } from '../config/database';
import { callAIWithFallback } from '../services/ai';
import { buildMemoryPromptContext } from './company-memory';

// ════════════════════════════════════════════════════════════════════
// 타입
// ════════════════════════════════════════════════════════════════════

export interface AlimtalkTemplate {
  id: string;
  template_code: string;
  template_name: string;
  profile_id: string;
  profile_name?: string | null;
  content: string;
  status: string;
  category?: string | null;
  message_type?: string | null;
  emphasize_type?: string | null;
  emphasize_title?: string | null;
}

export interface VariableMapping {
  templateVariable: string;       // 예: #{고객명}
  customerFieldKey: string | null; // 예: name (자동 매핑) / null (미매핑)
  customerFieldLabel: string | null;
  reasoning: string;               // 매핑 근거 (사용자 노출용)
  isExactMatch: boolean;           // 정확 매칭 vs 유사 매칭
}

export interface AlimtalkMatchResult {
  matched: boolean;
  template: AlimtalkTemplate | null;
  matchScore: number;              // 0~100 (정합도)
  matchReason: string;             // 매칭 근거 (한국어, 사용자 노출용)
  variableMappings: VariableMapping[];
  alternativeTemplates: Array<{    // 차선 추천 (최대 3건)
    template: AlimtalkTemplate;
    matchScore: number;
    matchReason: string;
  }>;
  suggestion: string | null;       // 정합 0건 시 회사 admin 안내 텍스트
}

export interface MatchInput {
  companyId: string;
  campaignObjective: string;       // 자연어 캠페인 의도
  campaignType?: string;           // 'onboarding' / 'repeat' / 'dormant' 등 (선택)
}

// ════════════════════════════════════════════════════════════════════
// 변수 매핑 — FIELD_MAP 기반 자동 매트릭스
// ════════════════════════════════════════════════════════════════════

interface FieldMapping {
  fieldKey: string;
  fieldLabel: string;
  variableAliases: string[];       // 템플릿 변수 패턴 (정확/유사 매칭 영역)
}

/**
 * 한국 알림톡 표준 변수 + customers 표준 필드 매핑 매트릭스
 * - 정확 매칭 우선 + 유사 매칭 fallback
 */
const KOREAN_VARIABLE_FIELD_MAP: FieldMapping[] = [
  { fieldKey: 'name', fieldLabel: '고객명', variableAliases: ['고객명', '이름', '성함', 'name', '님'] },
  { fieldKey: 'grade', fieldLabel: '등급', variableAliases: ['등급', '회원등급', 'grade', '레벨', 'level'] },
  { fieldKey: 'points', fieldLabel: '포인트', variableAliases: ['포인트', '적립금', '마일리지', 'points', '적립'] },
  { fieldKey: 'recent_purchase_amount', fieldLabel: '최근 구매금액', variableAliases: ['최근구매금액', '구매금액', '결제금액', '주문금액'] },
  { fieldKey: 'total_purchase_amount', fieldLabel: '누적 구매금액', variableAliases: ['누적구매금액', '총구매금액', '총결제금액'] },
  { fieldKey: 'purchase_count', fieldLabel: '구매 횟수', variableAliases: ['구매횟수', '주문횟수', '결제횟수'] },
  { fieldKey: 'birth_date', fieldLabel: '생일', variableAliases: ['생일', '생년월일', 'birthday', 'birth'] },
  { fieldKey: 'phone', fieldLabel: '전화번호', variableAliases: ['전화', '연락처', '휴대폰', 'phone', 'tel'] },
  { fieldKey: 'email', fieldLabel: '이메일', variableAliases: ['이메일', 'email', '메일'] },
  { fieldKey: 'registered_store', fieldLabel: '매장명', variableAliases: ['매장', '매장명', '지점', '지점명', 'store'] },
  { fieldKey: 'address', fieldLabel: '주소', variableAliases: ['주소', 'address'] },
  { fieldKey: 'region', fieldLabel: '지역', variableAliases: ['지역', 'region', '거주지'] },
];

/**
 * 템플릿 변수 추출 — #{변수명} 정규식 매트릭스
 */
export function extractTemplateVariables(content: string): string[] {
  const matches = content?.match(/#\{[^}]+\}/g) || [];
  return Array.from(new Set(matches));
}

/**
 * 변수 자동 매핑 — 정확/유사 매칭 매트릭스
 */
export function autoMapVariables(
  templateContent: string,
  enabledFieldKeys: string[],
): VariableMapping[] {
  const variables = extractTemplateVariables(templateContent);
  const mappings: VariableMapping[] = [];

  for (const variable of variables) {
    const innerName = variable.replace(/^#\{|\}$/g, '').trim().toLowerCase();
    let bestMatch: { fieldKey: string; fieldLabel: string; isExact: boolean } | null = null;

    for (const mapping of KOREAN_VARIABLE_FIELD_MAP) {
      // 회사가 활성화한 필드만 매칭 (회사별 customer_schema 정합)
      if (enabledFieldKeys.length > 0 && !enabledFieldKeys.includes(mapping.fieldKey)) continue;

      for (const alias of mapping.variableAliases) {
        const aliasLower = alias.toLowerCase();
        if (innerName === aliasLower) {
          bestMatch = { fieldKey: mapping.fieldKey, fieldLabel: mapping.fieldLabel, isExact: true };
          break;
        }
        if (!bestMatch && (innerName.includes(aliasLower) || aliasLower.includes(innerName))) {
          bestMatch = { fieldKey: mapping.fieldKey, fieldLabel: mapping.fieldLabel, isExact: false };
        }
      }
      if (bestMatch?.isExact) break;
    }

    mappings.push({
      templateVariable: variable,
      customerFieldKey: bestMatch?.fieldKey || null,
      customerFieldLabel: bestMatch?.fieldLabel || null,
      reasoning: bestMatch
        ? bestMatch.isExact
          ? `정확 매칭 (${bestMatch.fieldLabel})`
          : `유사 매칭 (${bestMatch.fieldLabel}) — 회사 admin 검토 권장`
        : '매칭 실패 — 회사 admin 직접 입력 필요',
      isExactMatch: bestMatch?.isExact || false,
    });
  }

  return mappings;
}

// ════════════════════════════════════════════════════════════════════
// AI 매칭 — Opus 4.7 Tool Use
// ════════════════════════════════════════════════════════════════════

/**
 * 캠페인 의도 + 회사 보유 알림톡 템플릿 → Opus 4.7 매칭 판단
 */
export async function matchAlimtalkTemplate(input: MatchInput): Promise<AlimtalkMatchResult> {
  // 1. 회사 보유 승인 템플릿 매트릭스 fetch
  const tplRes = await query(
    `SELECT t.id, t.template_code, t.template_name, t.profile_id, t.content, t.status,
            t.category, t.message_type, t.emphasize_type, t.emphasize_title,
            p.profile_name
     FROM kakao_templates t
     LEFT JOIN kakao_sender_profiles p ON p.id = t.profile_id
     WHERE t.company_id = $1::uuid AND UPPER(t.status) IN ('APPROVED', 'APR', 'A')
     ORDER BY t.created_at DESC
     LIMIT 50`,
    [input.companyId]
  );

  const templates: AlimtalkTemplate[] = tplRes.rows.map((r: any) => ({
    id: r.id,
    template_code: r.template_code,
    template_name: r.template_name,
    profile_id: r.profile_id,
    profile_name: r.profile_name,
    content: r.content || '',
    status: r.status,
    category: r.category,
    message_type: r.message_type,
    emphasize_type: r.emphasize_type,
    emphasize_title: r.emphasize_title,
  }));

  if (templates.length === 0) {
    return {
      matched: false,
      template: null,
      matchScore: 0,
      matchReason: '',
      variableMappings: [],
      alternativeTemplates: [],
      suggestion: '승인된 알림톡 템플릿이 없습니다. 알림톡 발송 모달에서 템플릿을 등록 + 검수 통과 후 다시 시도해주세요.',
    };
  }

  // 2. 회사 활성 필드 fetch (변수 매핑 영역)
  const fieldsRes = await query(
    `SELECT enabled_fields FROM companies WHERE id = $1::uuid`,
    [input.companyId]
  );
  const enabledFieldKeys: string[] = Array.isArray(fieldsRes.rows[0]?.enabled_fields)
    ? fieldsRes.rows[0].enabled_fields
    : [];

  // 3. Memory 학습 컨텍스트 통합 (회사별 과거 패턴)
  const memoryContext = await buildMemoryPromptContext(input.companyId, 10).catch(() => '');

  // 4. AI 시스템 프롬프트 매트릭스
  const systemPrompt = `당신은 한국 카카오 알림톡 템플릿 매칭 전문가입니다.

목표: 캠페인 의도와 가장 정합되는 알림톡 템플릿 1건 추천 + 차선 2~3건 추천.

매칭 원칙:
1. 캠페인 의도 키워드(VIP/재구매/휴면/생일/장바구니/예약/이벤트/할인 등) ↔ 템플릿 본문/제목/카테고리 키워드 정합
2. 정합 점수(0~100): 100=완벽 매칭 / 70+=우수 정합 / 50+=가능 / 50 미만=정합 X
3. 정합 점수 50 미만 시 matched=false 반환 (자동완화 절대 금지 — AI가 임의 매칭 X)
4. 회사 admin이 검토 + 승인 후 발송 (AI 단독 실행 X — 영구 원칙 #1)

${memoryContext ? `회사 학습 메모리:\n${memoryContext}\n` : ''}

응답 형식 (valid JSON only, 다른 텍스트 X):
{
  "matched": true|false,
  "best_template_id": "uuid 또는 null",
  "match_score": 0~100,
  "match_reason": "한국어 매칭 근거 (사용자 노출용, 2~3 문장)",
  "alternatives": [
    { "template_id": "uuid", "match_score": 0~100, "match_reason": "..." }
  ],
  "suggestion": "정합 0건 시 회사 admin 안내 (matched=false 시만, 한국어)"
}`;

  const userMessage = `[캠페인 의도]
${input.campaignObjective}
${input.campaignType ? `[캠페인 유형] ${input.campaignType}` : ''}

[회사 보유 승인 템플릿 ${templates.length}건]
${templates.map((t, i) => `
${i + 1}. ID: ${t.id}
   템플릿명: ${t.template_name}
   카테고리: ${t.category || '미분류'}
   메시지 유형: ${t.message_type || 'BA'} / 강조: ${t.emphasize_type || 'NONE'}
   제목: ${t.emphasize_title || '(없음)'}
   본문: ${t.content.slice(0, 200)}${t.content.length > 200 ? '...' : ''}
`).join('\n')}

위 매트릭스 정독 후 가장 정합되는 1건 + 차선 2~3건 추천 (JSON only).`;

  // ★ D209+ (Harold 명시 2026-05-22): Sonnet 4.6 전환 — 단순 템플릿 매칭 + 변수 매핑 영역.
  //   AI 추론 깊이 의무 X = 비용 80% 절감 + 품질 정합.
  //   Phase D 통합: companyId + source 전달 → 회사별 월 한도 검증 + cache + 통계 자동 활성.
  let aiResponse = '';
  try {
    const result = await callAIWithFallback({
      model: 'sonnet',
      system: systemPrompt,
      userMessage,
      maxTokens: 2000,
      temperature: 0,
      companyId: input.companyId,
      source: 'alimtalk-matcher',
    });
    aiResponse = result || '';
  } catch (err: any) {
    console.error('[AlimtalkAIMatcher] AI 호출 실패:', err?.message || err);
    return fallbackMatch(templates, input);
  }

  // 6. AI 응답 JSON 파싱
  try {
    const jsonMatch = aiResponse.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('AI 응답에서 JSON 추출 실패');
    const parsed = JSON.parse(jsonMatch[0]);

    const matched = parsed.matched === true && parsed.match_score >= 50;
    const bestTemplate = matched && parsed.best_template_id
      ? templates.find((t) => t.id === parsed.best_template_id) || null
      : null;

    // 변수 자동 매핑 (best template 정합 시)
    const variableMappings: VariableMapping[] = bestTemplate
      ? autoMapVariables(bestTemplate.content, enabledFieldKeys)
      : [];

    // 차선 추천 매트릭스
    const alternativeTemplates: AlimtalkMatchResult['alternativeTemplates'] = [];
    const alternatives = Array.isArray(parsed.alternatives) ? parsed.alternatives.slice(0, 3) : [];
    for (const alt of alternatives) {
      const altTpl = templates.find((t) => t.id === alt.template_id);
      if (altTpl && alt.match_score >= 30) {
        alternativeTemplates.push({
          template: altTpl,
          matchScore: Number(alt.match_score) || 0,
          matchReason: String(alt.match_reason || ''),
        });
      }
    }

    return {
      matched,
      template: bestTemplate,
      matchScore: Number(parsed.match_score) || 0,
      matchReason: String(parsed.match_reason || ''),
      variableMappings,
      alternativeTemplates,
      suggestion: matched ? null : (parsed.suggestion || '정합되는 알림톡 템플릿이 없습니다. 캠페인 의도에 맞는 템플릿을 추가 등록해주세요.'),
    };
  } catch (parseErr: any) {
    console.error('[AlimtalkAIMatcher] JSON 파싱 실패:', parseErr?.message);
    return fallbackMatch(templates, input);
  }
}

/**
 * AI 실패 시 fallback — 키워드 기반 단순 매칭
 */
function fallbackMatch(templates: AlimtalkTemplate[], input: MatchInput): AlimtalkMatchResult {
  const objective = input.campaignObjective.toLowerCase();
  const KEYWORD_MAP: Record<string, string[]> = {
    onboarding: ['가입', '환영', '신규', 'welcome', '시작'],
    repeat: ['재구매', '다시', '또', '구매', '주문', '결제'],
    dormant: ['휴면', '오랜만', '회수', '돌아오', '다시'],
    cart: ['장바구니', '결제', '미완료', '포기', '남아'],
    birthday: ['생일', '축하', '선물', '쿠폰', 'birthday'],
    reservation: ['예약', '방문', '확인'],
    vip: ['vip', 'VIP', '특별', '감사', '우수'],
  };

  const objectiveKeywords = input.campaignType && KEYWORD_MAP[input.campaignType]
    ? KEYWORD_MAP[input.campaignType]
    : Object.values(KEYWORD_MAP).flat();

  let bestScore = 0;
  let bestTemplate: AlimtalkTemplate | null = null;
  const scored: Array<{ template: AlimtalkTemplate; score: number }> = [];

  for (const tpl of templates) {
    const tplText = `${tpl.template_name} ${tpl.content} ${tpl.category || ''} ${tpl.emphasize_title || ''}`.toLowerCase();
    let score = 0;
    for (const kw of objectiveKeywords) {
      if (objective.includes(kw.toLowerCase()) && tplText.includes(kw.toLowerCase())) {
        score += 20;
      } else if (tplText.includes(kw.toLowerCase())) {
        score += 5;
      }
    }
    score = Math.min(100, score);
    scored.push({ template: tpl, score });
    if (score > bestScore) {
      bestScore = score;
      bestTemplate = tpl;
    }
  }

  scored.sort((a, b) => b.score - a.score);
  const alternativeTemplates = scored.slice(1, 4)
    .filter((s) => s.score >= 30)
    .map((s) => ({
      template: s.template,
      matchScore: s.score,
      matchReason: 'AI 분석 실패 — 키워드 기반 단순 매칭 (회사 admin 검토 권장)',
    }));

  return {
    matched: bestScore >= 50,
    template: bestScore >= 50 ? bestTemplate : null,
    matchScore: bestScore,
    matchReason: bestScore >= 50
      ? `AI 분석 실패 — 키워드 기반 fallback 매칭 (정합 점수 ${bestScore}). 회사 admin 검토 권장.`
      : `정합 점수 ${bestScore} 미만 — 정합되는 템플릿이 없습니다.`,
    variableMappings: bestScore >= 50 && bestTemplate
      ? autoMapVariables(bestTemplate.content, [])
      : [],
    alternativeTemplates,
    suggestion: bestScore < 50
      ? '정합되는 알림톡 템플릿이 없습니다. 캠페인 의도에 맞는 템플릿을 추가 등록해주세요.'
      : null,
  };
}
