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

import { extractJsonFromAiText, aiStr } from './ai-json';   // ★ 2026-09-30 WP4 AI 응답 JSON 파싱 = CT(문자열 안 제어문자 복구)
import { query } from '../config/database';
import { callAIWithFallback } from '../services/ai';
import { runChargedAi } from './ai-credit';
import { getCreditCost } from './ai-credit-calc';

/** 매칭 프롬프트에 싣는 승인 템플릿 상한(본문 200자 × N · 프롬프트 길이 보호) */
const MATCH_CANDIDATES_MAX = 80;
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
  /** ★ 2026-10-25 #112 — 후보 상한을 넘어 최신 N개만 봤을 때 사람 문장(없으면 칸 없음) */
  note?: string;
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
          : `유사 매칭 (${bestMatch.fieldLabel}). 회사 admin 검토 권장`
        : '매칭 실패. 회사 admin 직접 입력 필요',
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
     ORDER BY t.created_at DESC`,
    [input.companyId]
  );
  // ★ 2026-10-25 원장 #112 — 승인 템플릿 전부를 후보로 본다. 프롬프트 길이 상한(MATCH_CANDIDATES_MAX)을 넘으면 최신순 앞 N개만 · 응답에 그 사실을 싣는다
  //   (옛: 조용히 50개 · 51번째부터 매칭 후보에서 빠졌다).
  const truncatedNote = tplRes.rows.length > MATCH_CANDIDATES_MAX
    ? `승인 템플릿 ${tplRes.rows.length.toLocaleString()}개 중 최근 ${MATCH_CANDIDATES_MAX}개에서 골랐어요.`
    : null;

  const templates: AlimtalkTemplate[] = tplRes.rows.slice(0, MATCH_CANDIDATES_MAX).map((r: any) => ({
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
3. 정합 점수 50 미만 시 matched=false 반환 (자동완화 절대 금지, AI가 임의 매칭 X)
4. 회사 admin이 검토 + 승인 후 발송 (AI 단독 실행 X, 영구 원칙 #1)

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
  // ★ 2026-10-25 원장 #113 · Z4 — 돈 = AI 결과 정산 한 곳: AI 가 고를 템플릿을 낸 때만 1크레딧. AI 실패 · 읽지 못함 = 키워드 대체 결과(0원)
  //   (옛: 응답 순간 1크레딧 · 읽지 못해 키워드 결과를 주면서도 걷었다). 바깥 묶음(AI 한줄로)이면 걷지 않는다(그 입구가 기본으로 걷는다).
  const { result } = await runChargedAi({
    companyId: input.companyId, cost: getCreditCost('alimtalk-matcher'), source: 'alimtalk-matcher',
    run: async (): Promise<{ r: AlimtalkMatchResult; ai: boolean }> => {
      let aiResponse = '';
      try {
        aiResponse = (await callAIWithFallback({
          model: 'sonnet',
          system: systemPrompt,
          userMessage,
          maxTokens: 2000,
          temperature: 0,
          companyId: input.companyId,
          source: 'alimtalk-matcher',
        })) || '';
      } catch (err: any) {
        console.error('[AlimtalkAIMatcher] AI 호출 실패:', err?.message || err);
        return { r: fallbackMatch(templates, input), ai: false };
      }
      try {
        const jsonMatch = aiResponse.match(/\{[\s\S]*\}/);
        if (!jsonMatch) return { r: fallbackMatch(templates, input), ai: false };
        const parsed = extractJsonFromAiText(jsonMatch[0]);
        const matched = parsed.matched === true && parsed.match_score >= 50;
        const bestTemplate = matched && parsed.best_template_id
          ? templates.find((t) => t.id === parsed.best_template_id) || null
          : null;
        // 변수 자동 매핑 (best template 정합 시)
        const variableMappings: VariableMapping[] = bestTemplate ? autoMapVariables(bestTemplate.content, enabledFieldKeys) : [];
        // 차선 추천 매트릭스
        const alternativeTemplates: AlimtalkMatchResult['alternativeTemplates'] = [];
        const alternatives = Array.isArray(parsed.alternatives) ? parsed.alternatives.slice(0, 3) : [];
        for (const alt of alternatives) {
          const altTpl = templates.find((t) => t.id === alt.template_id);
          if (altTpl && alt.match_score >= 30) {
            alternativeTemplates.push({ template: altTpl, matchScore: Number(alt.match_score) || 0, matchReason: aiStr(alt.match_reason) });
          }
        }
        return {
          r: {
            matched,
            template: bestTemplate,
            matchScore: Number(parsed.match_score) || 0,
            matchReason: aiStr(parsed.match_reason),
            variableMappings,
            alternativeTemplates,
            suggestion: matched ? null : (parsed.suggestion || '정합되는 알림톡 템플릿이 없습니다. 캠페인 의도에 맞는 템플릿을 추가 등록해주세요.'),
          },
          ai: true,
        };
      } catch (parseErr: any) {
        console.error('[AlimtalkAIMatcher] JSON 파싱 실패:', parseErr?.message);
        return { r: fallbackMatch(templates, input), ai: false };
      }
    },
    accept: (x) => x.ai && (!!x.r.template || x.r.alternativeTemplates.length > 0),
  });
  return truncatedNote ? { ...result.r, note: truncatedNote } : result.r;
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

  // ★ 2026-09-27 한줄로 V2 R360 — 유형이 없으면 **목표에 실제로 있는 키워드만** 쓰고, 템플릿에만 있는 키워드 가산(+5)은 하지 않는다.
  //   옛: 전 키워드를 쓰고 템플릿에만 있어도 +5라 '확인'·'결제'·'쿠폰'이 든 무관한 템플릿이 점수를 얻었다. 유형이 있으면 종전 그대로.
  const typed = !!(input.campaignType && KEYWORD_MAP[input.campaignType]);
  const objectiveKeywords = typed
    ? KEYWORD_MAP[input.campaignType as string]
    : Array.from(new Set(Object.values(KEYWORD_MAP).flat())).filter((kw) => objective.includes(kw.toLowerCase()));

  let bestScore = 0;
  let bestTemplate: AlimtalkTemplate | null = null;
  const scored: Array<{ template: AlimtalkTemplate; score: number }> = [];

  for (const tpl of templates) {
    const tplText = `${tpl.template_name} ${tpl.content} ${tpl.category || ''} ${tpl.emphasize_title || ''}`.toLowerCase();
    let score = 0;
    for (const kw of objectiveKeywords) {
      if (objective.includes(kw.toLowerCase()) && tplText.includes(kw.toLowerCase())) {
        score += 20;
      } else if (typed && tplText.includes(kw.toLowerCase())) {
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
      matchReason: 'AI 분석 실패. 키워드 기반 단순 매칭 (회사 admin 검토 권장)',
    }));

  return {
    matched: bestScore >= 50,
    template: bestScore >= 50 ? bestTemplate : null,
    matchScore: bestScore,
    matchReason: bestScore >= 50
      ? `AI 분석 실패. 키워드 기반 fallback 매칭 (정합 점수 ${bestScore}). 회사 admin 검토 권장.`
      : `정합 점수 ${bestScore} 미만. 정합되는 템플릿이 없습니다.`,
    variableMappings: bestScore >= 50 && bestTemplate
      ? autoMapVariables(bestTemplate.content, [])
      : [],
    alternativeTemplates,
    suggestion: bestScore < 50
      ? '정합되는 알림톡 템플릿이 없습니다. 캠페인 의도에 맞는 템플릿을 추가 등록해주세요.'
      : null,
  };
}
