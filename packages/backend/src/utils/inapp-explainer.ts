/**
 * ★ CT-81: In-app Message Explainer — D215+ (2026-05-25)
 *
 * 🎯 목적
 *   인앱 메시지 CTR 영향 요인 분석 + 개선 추천 (AI Operator 호출 — model: 'opus').
 *   - 5 영향 요인: 이미지 / CTA 색상 / 트리거 시점 / 본문 길이 / 세그먼트 정확도
 *   - 회사 평균 비교 기준 (anonymized — 옛 메시지 평균)
 *   - 개선 추천 3건 (high/medium/low 우선순위)
 *
 * ⛔ 영구 원칙
 *   - 모델명 사용자 노출 X (시스템 프롬프트 안 모델명 0건)
 *   - 회사 격리 (company_id 의무)
 *   - Source caption 의무 (모든 factor에 dataSource 명시)
 */

import { callAIWithFallback } from '../services/ai';
import { query } from '../config/database';

// ════════════════════════════════════════════════════════════════════
// 타입
// ════════════════════════════════════════════════════════════════════

export interface ImpactFactor {
  factor: string;
  impact: number;              // 0~1
  direction: 'positive' | 'negative' | 'neutral';
  description: string;
  dataSource: string;
}

export interface Recommendation {
  title: string;
  description: string;
  priority: 'high' | 'medium' | 'low';
  actionType?: 'ai_refine' | 'time_optimize' | 'segment_refine' | 'manual';
}

export interface InAppExplainResult {
  messageId: string;
  topInsight: string;
  factors: ImpactFactor[];
  recommendations: Recommendation[];
  comparisonContext: {
    messageCTR: number;
    companyAvgCTR: number;
    deltaPercent: number;
    sampleSize: number;
  };
  reasoning: string;
}

// ════════════════════════════════════════════════════════════════════
// 메시지 + 통계 + 회사 평균 수집
// ════════════════════════════════════════════════════════════════════

interface MessageContextForExplain {
  id: string;
  title: string;
  bodyLength: number;
  template: string;
  hasImage: boolean;
  buttonCount: number;
  primaryColor: string;
  triggerEvent: string;
  hasTriggerCondition: boolean;
  sendStartHour: number | null;
  sendEndHour: number | null;
  hasSegmentConditions: boolean;
  impressions: number;
  clicks: number;
  dismisses: number;
  ctr: number;
  dismissRate: number;
  hours24Stats: { hour: number; impressions: number; clicks: number }[];
}

async function loadMessageContext(
  companyId: string,
  messageId: string
): Promise<MessageContextForExplain | null> {
  const r = await query(
    `SELECT m.id, m.title, m.body, m.template, m.image_url, m.buttons,
            m.background_color, m.trigger_event, m.trigger_conditions, m.segment_conditions,
            m.send_start_hour, m.send_end_hour,
            COUNT(*) FILTER (WHERE i.event_type = 'impression')::int AS impressions,
            COUNT(*) FILTER (WHERE i.event_type = 'click')::int AS clicks,
            COUNT(*) FILTER (WHERE i.event_type = 'dismiss')::int AS dismisses
     FROM cdp_inapp_messages m
     LEFT JOIN cdp_inapp_impressions i ON i.message_id = m.id AND i.company_id = m.company_id
     WHERE m.company_id = $1::uuid AND m.id = $2::uuid
     GROUP BY m.id, m.title, m.body, m.template, m.image_url, m.buttons,
              m.background_color, m.trigger_event, m.trigger_conditions, m.segment_conditions,
              m.send_start_hour, m.send_end_hour`,
    [companyId, messageId]
  );
  if (r.rows.length === 0) return null;
  const row = r.rows[0];

  // 시간대별 통계 (24h)
  const hoursR = await query(
    `SELECT EXTRACT(HOUR FROM occurred_at AT TIME ZONE 'Asia/Seoul')::int AS hour,
            COUNT(*) FILTER (WHERE event_type = 'impression')::int AS impressions,
            COUNT(*) FILTER (WHERE event_type = 'click')::int AS clicks
     FROM cdp_inapp_impressions
     WHERE company_id = $1::uuid AND message_id = $2::uuid
     GROUP BY hour
     ORDER BY hour ASC`,
    [companyId, messageId]
  );

  const impressions = Number(row.impressions || 0);
  const clicks = Number(row.clicks || 0);
  const dismisses = Number(row.dismisses || 0);
  const buttons = Array.isArray(row.buttons) ? row.buttons : [];
  const segmentConds = row.segment_conditions || {};
  const triggerConds = row.trigger_conditions || {};

  return {
    id: row.id,
    title: row.title || '',
    bodyLength: (row.body || '').length,
    template: row.template || 'top_banner',
    hasImage: Boolean(row.image_url),
    buttonCount: buttons.length,
    primaryColor: row.background_color || '#4f46e5',
    triggerEvent: row.trigger_event || 'page_load',
    hasTriggerCondition: Object.keys(triggerConds).length > 1,  // event 외 추가 조건
    sendStartHour: row.send_start_hour,
    sendEndHour: row.send_end_hour,
    hasSegmentConditions: Object.keys(segmentConds.customer || {}).length > 0 ||
                          Object.keys(segmentConds.events || {}).length > 0,
    impressions,
    clicks,
    dismisses,
    ctr: impressions > 0 ? clicks / impressions : 0,
    dismissRate: impressions > 0 ? dismisses / impressions : 0,
    hours24Stats: hoursR.rows.map((h: any) => ({
      hour: Number(h.hour),
      impressions: Number(h.impressions),
      clicks: Number(h.clicks),
    })),
  };
}

async function loadCompanyAverageCTR(companyId: string): Promise<{ avgCTR: number; sampleSize: number }> {
  const r = await query(
    `SELECT COUNT(*) FILTER (WHERE event_type = 'impression')::int AS impressions,
            COUNT(*) FILTER (WHERE event_type = 'click')::int AS clicks,
            COUNT(DISTINCT message_id)::int AS sample_size
     FROM cdp_inapp_impressions
     WHERE company_id = $1::uuid
       AND occurred_at >= NOW() - INTERVAL '30 days'`,
    [companyId]
  );
  const impressions = Number(r.rows[0]?.impressions || 0);
  const clicks = Number(r.rows[0]?.clicks || 0);
  return {
    avgCTR: impressions > 0 ? clicks / impressions : 0,
    sampleSize: Number(r.rows[0]?.sample_size || 0),
  };
}

// ════════════════════════════════════════════════════════════════════
// 핵심 — Explain 호출
// ════════════════════════════════════════════════════════════════════

export async function explainInAppMessage(
  companyId: string,
  messageId: string
): Promise<InAppExplainResult> {
  if (!companyId || !messageId) throw new Error('companyId + messageId 필수');

  const ctx = await loadMessageContext(companyId, messageId);
  if (!ctx) throw new Error('메시지를 찾을 수 없습니다.');

  const companyAvg = await loadCompanyAverageCTR(companyId);
  const deltaPercent = companyAvg.avgCTR > 0
    ? ((ctx.ctr - companyAvg.avgCTR) / companyAvg.avgCTR) * 100
    : 0;

  // 데이터 부족 = AI 호출 X (간단 분석만)
  if (ctx.impressions < 50) {
    return buildShortAnalysisForLowVolume(ctx, companyAvg, deltaPercent);
  }

  // 시간대 최고 CTR
  const bestHour = ctx.hours24Stats.reduce((best, h) => {
    const hCtr = h.impressions > 0 ? h.clicks / h.impressions : 0;
    const bestCtr = best.impressions > 0 ? best.clicks / best.impressions : 0;
    return hCtr > bestCtr ? h : best;
  }, ctx.hours24Stats[0] || { hour: 0, impressions: 0, clicks: 0 });

  const system = `당신은 한국 마케팅 자동화 인앱 메시지 성과 분석 전문가입니다.
회사 admin이 인앱 메시지 CTR 영향 요인을 알고 싶어 합니다.
아래 메시지 + 통계 + 회사 평균을 기반으로 5 영향 요인 분석 + 개선 추천 3건을 JSON으로 응답합니다.

[분석 대상 메시지]
- 제목: ${ctx.title}
- 본문 길이: ${ctx.bodyLength}자
- 템플릿: ${ctx.template}
- 이미지: ${ctx.hasImage ? '있음' : '없음'}
- CTA 버튼 수: ${ctx.buttonCount}개
- 주 색상: ${ctx.primaryColor}
- 트리거: ${ctx.triggerEvent} ${ctx.hasTriggerCondition ? '+ 추가 조건' : '(단순)'}
- 시간대 제한: ${ctx.sendStartHour !== null && ctx.sendEndHour !== null ? `${ctx.sendStartHour}~${ctx.sendEndHour}시` : '제한 없음'}
- 세그먼트 조건: ${ctx.hasSegmentConditions ? '있음' : '없음 (전체 회원)'}

[통계 (누적)]
- impression: ${ctx.impressions.toLocaleString()}건
- click: ${ctx.clicks.toLocaleString()}건
- dismiss: ${ctx.dismisses.toLocaleString()}건
- CTR: ${(ctx.ctr * 100).toFixed(2)}%
- Dismiss rate: ${(ctx.dismissRate * 100).toFixed(2)}%

[회사 평균 (최근 30일)]
- 평균 CTR: ${(companyAvg.avgCTR * 100).toFixed(2)}% (${companyAvg.sampleSize}개 메시지 누적)
- 본 메시지 격차: ${deltaPercent >= 0 ? '+' : ''}${deltaPercent.toFixed(1)}%

[시간대 최고 CTR]
- ${bestHour.hour}시 — impression ${bestHour.impressions}건 / click ${bestHour.clicks}건

[★ 5 영향 요인 분석 가이드 ★]

1. 이미지 (image_url) — 시선 끌기. 이미지 있음 = CTR +30~50% 일반
2. CTA 색상 (background_color) — 대비 명확 + 브랜드 정합 = CTR +10~20%
3. 트리거 시점 (trigger_event + 시간대) — page_load 단순 = CTR 낮음 / cart_view·time_on_page = CTR 높음 일반
4. 본문 길이 (bodyLength) — 50자 미만 너무 짧음 / 500자 초과 너무 김 / 200~400자 권장
5. 세그먼트 정확도 (hasSegmentConditions) — 전체 회원 = CTR 낮음 / 세그먼트 정확 = CTR +50~100%

각 요인:
- impact: 0~1 (영향력 절대값 — 0.8 = 매우 높음 / 0.5 = 보통 / 0.2 = 낮음)
- direction: 'positive' (현재 잘 적용) / 'negative' (개선 필요) / 'neutral' (영향 없음)
- description: 한국어 1~2 문장 진단
- dataSource: 어디 데이터 기준 (예: "회사 누적 30일 평균 / 본 메시지 30일 통계")

[★ 개선 추천 3건 우선순위 ★]

actionType:
- 'ai_refine' — AI 본문 다듬기 (감성/실용/캐주얼 톤 3안 자동 생성)
- 'time_optimize' — 시간대 최적화 (best hour 자동 적용)
- 'segment_refine' — 세그먼트 정밀화 (high LTV / 활성 사용자 한정)
- 'manual' — 회사 admin 직접 작업 (이미지 추가 / CTA 색상 변경 등)

priority: high / medium / low

[★ 응답 JSON 형식 ★]

\`\`\`json
{
  "topInsight": "본 메시지 CTR이 회사 평균 대비 N% (높음/낮음) — 핵심 진단 한 줄",
  "factors": [
    { "factor": "이미지", "impact": 0.7, "direction": "negative", "description": "이미지 없음 — 시선 끌기 약함. 추가 시 CTR +30% 예상", "dataSource": "회사 누적 평균 vs 본 메시지" },
    ...총 5건
  ],
  "recommendations": [
    { "title": "이미지 추가", "description": "...", "priority": "high", "actionType": "manual" },
    ...총 3건
  ],
  "reasoning": "본 분석 진행 근거 (한국어 3~5 문장)"
}
\`\`\`

응답은 반드시 위 JSON 객체만. JSON 외 텍스트 X.`;

  const userMessage = `위 메시지 + 통계 + 회사 평균을 분석하여 5 영향 요인 + 개선 추천 3건을 도출해주세요.

영구 룰:
- 모든 factor에 dataSource 명시 (데이터 출처 투명성)
- direction = 'negative'인 요인이 개선 추천 1순위
- 회사 admin이 실제 적용 가능한 구체 추천 (추상적 X)

응답은 위 JSON 형식 그대로.`;

  const aiResult = await callAIWithFallback({
    system,
    userMessage,
    model: 'opus',
    maxTokens: 3072,
    temperature: 0.5,
    companyId,
    source: 'inapp-explainer', // ★ D227+ 종량제: 인앱 설명·개선추천 1크레딧
  });

  const jsonText = extractJSON(aiResult || '');
  let parsed: any;
  try {
    parsed = JSON.parse(jsonText);
  } catch (e: any) {
    throw new Error(`AI 응답 JSON 파싱 실패: ${e.message}\n응답 앞 300자: ${jsonText.slice(0, 300)}`);
  }

  const factors: ImpactFactor[] = Array.isArray(parsed.factors)
    ? parsed.factors.slice(0, 5).map((f: any) => ({
        factor: String(f.factor || ''),
        impact: Math.max(0, Math.min(1, Number(f.impact) || 0)),
        direction: ['positive', 'negative', 'neutral'].includes(f.direction) ? f.direction : 'neutral',
        description: String(f.description || ''),
        dataSource: String(f.dataSource || '회사 누적 30일'),
      }))
    : [];

  const recommendations: Recommendation[] = Array.isArray(parsed.recommendations)
    ? parsed.recommendations.slice(0, 3).map((r: any) => ({
        title: String(r.title || ''),
        description: String(r.description || ''),
        priority: ['high', 'medium', 'low'].includes(r.priority) ? r.priority : 'medium',
        actionType: ['ai_refine', 'time_optimize', 'segment_refine', 'manual'].includes(r.actionType)
          ? r.actionType
          : 'manual',
      }))
    : [];

  return {
    messageId: ctx.id,
    topInsight: String(parsed.topInsight || ''),
    factors,
    recommendations,
    comparisonContext: {
      messageCTR: ctx.ctr,
      companyAvgCTR: companyAvg.avgCTR,
      deltaPercent,
      sampleSize: companyAvg.sampleSize,
    },
    reasoning: String(parsed.reasoning || ''),
  };
}

// ════════════════════════════════════════════════════════════════════
// 데이터 부족 시 간단 분석 (AI 호출 X)
// ════════════════════════════════════════════════════════════════════

function buildShortAnalysisForLowVolume(
  ctx: MessageContextForExplain,
  companyAvg: { avgCTR: number; sampleSize: number },
  deltaPercent: number
): InAppExplainResult {
  return {
    messageId: ctx.id,
    topInsight: `데이터 누적 부족 (impression ${ctx.impressions}건 < 50건) — 충분한 데이터 후 분석 권장`,
    factors: [
      {
        factor: '데이터 누적',
        impact: 0.9,
        direction: 'neutral',
        description: `현재 impression ${ctx.impressions}건. 50건 이상 누적 후 정확한 영향 요인 분석 가능`,
        dataSource: '본 메시지 누적 impression',
      },
    ],
    recommendations: [
      {
        title: '메시지 활성 유지',
        description: '최소 50건 impression 누적까지 활성 유지 후 재분석 진입',
        priority: 'high',
        actionType: 'manual',
      },
    ],
    comparisonContext: {
      messageCTR: ctx.ctr,
      companyAvgCTR: companyAvg.avgCTR,
      deltaPercent,
      sampleSize: companyAvg.sampleSize,
    },
    reasoning: '데이터 누적 부족 — AI 분석 정확도 보장 X. 50건 이상 누적 후 재분석.',
  };
}

// ════════════════════════════════════════════════════════════════════
// 헬퍼
// ════════════════════════════════════════════════════════════════════

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
