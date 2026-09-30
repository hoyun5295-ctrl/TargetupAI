/**
 * ★ CT-76: CDP Fusion Explainer 컨트롤타워 — D214+ (2026-05-24)
 *
 * 🎯 목적
 *   자사몰 영역 진단 결과 → AI 자율 분석 + 강화 영역 추천 (Opus 4.7).
 *   - 5번 메뉴 자사몰 연동 페이지 "AI 자율 진단" 영역 진정 source
 *   - 매핑률 / 이벤트 / Webhook / 멀티 source 영역 정합 영향 요인 매트릭스
 *
 * ⛔ 영구 원칙
 *   - 모델 = Opus 4.7 (AI Operator 영역) — feedback_ai_operator_model_isolation
 *   - 영향 요인 = 실제 데이터 기반만 (mock X)
 *   - Source caption 의무 (feedback_no_mock_data_in_production)
 *   - 회사 admin 실행 가능 영역만 추천 (구체 진입 경로 명시)
 */

import { extractJsonFromAiText } from './ai-json';
import { callAIWithFallback } from '../services/ai';
import { randomUUID } from 'crypto';
import { checkCredit, settleCreditAfterSuccess, InsufficientCreditError } from './ai-credit';
import { isInCreditBundle, runInCreditBundle } from './ai-credit-context';
import { getCreditCost } from './ai-credit-calc';
import { AiRateLimitExceeded } from './ai-rate-limit';
import type { CdpDiagnosticsResult } from './cdp-diagnostics';

export interface CdpExplainFactor {
  category: 'mapping' | 'events' | 'webhook' | 'multi_source' | 'provider';
  label: string;
  impactScore: number;          // 0~1
  direction: 'positive' | 'negative' | 'neutral';
  detail: string;
  sourceField: string;
}

export interface CdpExplanation {
  overallHealthScore: number;   // 0~100 자사몰 영역 안 전체 건강도 스코어
  topInsight: string;            // 한 줄 핵심 인사이트
  factors: CdpExplainFactor[];
  recommendations: string[];     // 액션 추천 (회사 admin 실행 영역)
  explainedAt: string;
}

export async function explainCdpDiagnostics(
  companyId: string,
  diagnostics: CdpDiagnosticsResult,
  companyInfo: { company_name?: string; brand_name?: string; business_type?: string }
): Promise<CdpExplanation> {
  const brandName = companyInfo.brand_name || companyInfo.company_name || '브랜드';

  const system = `당신은 자사몰 CDP (Customer Data Platform) 운영 전문가입니다.
회사의 자사몰 연동 영역 진단 결과를 분석하여 영향 요인 매트릭스와 강화 영역 추천을 도출합니다.

영구 원칙:
- 영향 요인 = 실제 진단 데이터 기반만 (추측 / 일반론 X)
- 각 요인 = 구체 수치 + Data source 명시 의무
- 회사 admin 실행 가능 영역만 추천 (구체 진입 경로 명시)

JSON 형식으로만 응답하세요.`;

  const providerSummary = diagnostics.byProvider.map((p) =>
    `  · ${p.source}: ${p.totalLinks}건 link (매핑 ${p.mappedLinks}건 / ${(p.mappingRate * 100).toFixed(1)}%), 30일 이벤트 ${p.events30d}건`
  ).join('\n') || '  (자사몰 연동 없음)';

  const webhookSummary = diagnostics.webhookReliability.map((w) =>
    `  · ${w.source}: ${w.totalDeliveries}건 (성공 ${w.successCount} / 실패 ${w.failedCount} / 중복 ${w.duplicateCount}, 성공률 ${(w.successRate * 100).toFixed(1)}%)`
  ).join('\n') || '  (Webhook 영역 없음)';

  const conflictSummary = diagnostics.sourceConflicts.map((b) =>
    `  · active_sources ${b.activeSourceCount}건: ${b.customerCount.toLocaleString()}명`
  ).join('\n');

  const userMessage = `## 회사 정보
- 회사명: ${brandName}
- 업종: ${companyInfo.business_type || '기타'}

## 자사몰 영역 진단 결과
- 회사 전체 customer: ${diagnostics.totalCustomers.toLocaleString()}명
- cdp_identity_links 전체: ${diagnostics.totalIdentityLinks.toLocaleString()}건 / 매핑 ${diagnostics.mappedLinks.toLocaleString()}건 (매핑률 ${(diagnostics.overallMappingRate * 100).toFixed(1)}%)
- 이벤트 누적: 24h ${diagnostics.events24h.toLocaleString()} / 7d ${diagnostics.events7d.toLocaleString()} / 30d ${diagnostics.events30d.toLocaleString()}

## POS ↔ CDP 융합 격차
- POS only (싱크에이전트/업로드/수동만): ${diagnostics.posOnlyCustomers.toLocaleString()}명
- CDP only (자사몰만): ${diagnostics.cdpOnlyCustomers.toLocaleString()}명
- 융합 (양쪽 source): ${diagnostics.fusedCustomers.toLocaleString()}명

## Provider별 매트릭스
${providerSummary}

## Webhook 신뢰성 (30일)
${webhookSummary}

## 충돌 분포 (active_sources 영역 길이)
${conflictSummary}

## 요청
위 진단 결과를 분석해 자사몰 영역 강화 매트릭스를 도출해주세요:
1. 자사몰 영역 전체 건강도 스코어 (0~100, 매핑률 + 이벤트 + Webhook 종합)
2. 한 줄 핵심 인사이트 (예: "cafe24 매핑률 65%: phone 영역 없을 가능성 큼")
3. 영향 요인 3~5개:
   - category: 'mapping' | 'events' | 'webhook' | 'multi_source' | 'provider'
   - label: 짧은 명사 (예: "카페24 매핑률", "Webhook 성공률")
   - impactScore: 0~1
   - direction: 'positive' | 'negative' | 'neutral'
   - detail: 구체 수치 안내
   - sourceField: 데이터 source (예: "cdp_identity_links + cdp_events.source")
4. 추천 액션 2~4개 (회사 admin 실행 가능 영역만, 구체 진입 경로 명시)

## 출력 (JSON만)
{
  "overallHealthScore": 72,
  "topInsight": "...",
  "factors": [
    {"category": "mapping", "label": "...", "impactScore": 0.85, "direction": "positive", "detail": "...", "sourceField": "..."}
  ],
  "recommendations": ["...", "..."]
}`;

  // ★ 2026-09-27 한줄로 V2 R183 — 잔액 확인 → 묶음 실행(캐시 안 함) → 파싱·조립 성공 뒤 1회 차감(R246과 같은 모양).
  //   옛: 모든 오류를 삼켜 '건강도 50점'을 실제 결과처럼 돌려줬고, 파싱 실패에도 호출 시점에 차감됐다.
  const explainCost = isInCreditBundle() ? 0 : getCreditCost('cdp-fusion-explainer');
  if (explainCost > 0) await checkCredit(companyId, explainCost);
  try {
    const text = await runInCreditBundle(() => callAIWithFallback({
      system,
      userMessage,
      maxTokens: 2048,
      temperature: 0.3,
      // ★ AI Operator 영역 = Opus 4.7
      model: 'opus',
      companyId,
      source: 'cdp-fusion-explainer',
      noCache: true,
    }));

    // ★ 2026-09-30 WP4 — JSON 추출은 CT 하나(ai-json · 머리말 · 코드펜스 · 문자열 안 제어문자 복구). 옛 코드펜스만 벗기는 인라인은 모델이 앞에 한 줄만 붙여도 실패했다.
    const parsed: any = extractJsonFromAiText(text);
    const result: CdpExplanation = {
      overallHealthScore: typeof parsed.overallHealthScore === 'number'
        ? Math.max(0, Math.min(100, parsed.overallHealthScore))
        : 50,
      topInsight: String(parsed.topInsight || ''),
      factors: Array.isArray(parsed.factors)
        ? parsed.factors.slice(0, 5).map((f: any) => ({
            category: ['mapping', 'events', 'webhook', 'multi_source', 'provider'].includes(f.category)
              ? f.category
              : 'mapping',
            label: String(f.label || ''),
            impactScore: typeof f.impactScore === 'number' ? Math.max(0, Math.min(1, f.impactScore)) : 0.5,
            direction: ['positive', 'negative', 'neutral'].includes(f.direction) ? f.direction : 'neutral',
            detail: String(f.detail || ''),
            sourceField: String(f.sourceField || ''),
          }))
        : [],
      recommendations: Array.isArray(parsed.recommendations)
        ? parsed.recommendations.slice(0, 4).map(String)
        : [],
      explainedAt: new Date().toISOString(),
    };
    if (explainCost > 0) {
      // 차감 확정 — 동시 요청에 잔액이 먼저 쓰였으면 결과를 내주지 않는다(402 · Codex 차수3 D 1R)
      await settleCreditAfterSuccess({ companyId, cost: explainCost, source: 'cdp-fusion-explainer', idempotencyKey: `cdp-explain:${randomUUID()}` });
    }
    return result;
  } catch (err) {
    if (err instanceof InsufficientCreditError || err instanceof AiRateLimitExceeded) throw err;
    console.error('[CdpFusionExplainer] AI 호출 실패:', err);
    throw new Error('AI 진단 결과를 만들지 못했습니다. 잠시 후 다시 시도해 주세요.');
  }
}
