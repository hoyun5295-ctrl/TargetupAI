/**
 * CT: 마케팅 진단 결과(DiagnosisResultV1) 조립 (2026-08-16 신설 — 설계서 §5-4·§7-2)
 *
 * 순수 함수 — AI 호출 0(원칙 2)·DB/IO 0. 서버가 계산해 result jsonb로 스냅샷하고
 * 프론트·관리 메뉴는 읽기만 한다(§7-2 단일 스키마).
 *
 * 원칙(설계서 §0·§2)
 *   - 수치는 계산 가능한 것만 — 임의 %·매출 추정·단가 절감(회사별 협상값) 절대 금지.
 *   - 모든 effect에 source(출처 문구) 의무 — 프론트 Source caption이 그대로 쓴다.
 *   - "잠금 해제" 소견은 실효 게이트 실측(§3-1) 4축만: DM·자동발송·AI·자사몰 연동.
 *     고객DB는 FREE에서도 열려 있어 잠금 근거로 쓰면 거짓 리포트다.
 *   - 크레딧 환산 = CREDIT_COST_MAP 파생(원 단가 노출 금지 — 횟수만).
 *   - 숫자는 확정형으로 저장(반올림은 계산 시점 1회). 무제한(NULL)은 "unlimited" 문자열.
 */
import { CREDIT_COST_MAP } from './ai-credit-calc';
import type { DiagnosisDefinition } from './plan-recommend';
import type { RecommendResult } from './plan-recommend';
import type { MonthlyUsage } from './monthly-usage';

export type GrantOutcome = 'granted' | 'already_granted' | 'not_eligible' | 'not_applicable' | null;

export interface DiagnosisEffect {
  kind: 'credit_conversion' | 'limit' | 'usage' | 'compare';
  label: string;
  value: string;
  source: string;
}

export interface DiagnosisFinding {
  key: string;
  text: string;
}

export interface DiagnosisResultV1 {
  v: 1;
  summary: string;
  findings: DiagnosisFinding[];
  effects: DiagnosisEffect[];
  recommendation: {
    plan_code: string;
    plan_name: string;
    monthly_price: number;
    reasons: Array<{ question: string; option: string; column: string }>;
  } | null;
  no_match: boolean;
  grant_outcome: GrantOutcome;
  examples: { industry: string | null };
}

export interface ReportInputs {
  definition: DiagnosisDefinition;
  answers: Record<string, string>;
  recommend: RecommendResult;
  /** 퍼널 A = 이번 달 실측 사용(monthly-usage CT). 퍼널 B = null(금액 0 원칙 — §2-8). */
  usage: MonthlyUsage | null;
  brandVoiceMissing: boolean;
  grantOutcome: GrantOutcome;
}

/** 크레딧 환산 표 — 마케터 언어 작업 3종만(CREDIT_COST_MAP 파생 · 원 단가 비노출). 공개 /credit-costs도 이 표를 쓴다. */
export const CONVERSION_TASKS: Array<{ source: keyof typeof CREDIT_COST_MAP & string; label: string }> = [
  { source: 'generate-messages', label: '문안 생성' },
  { source: 'dm-builder', label: '모바일 DM 발행' },
  { source: 'image-studio-generate', label: '이미지 스튜디오 생성' },
];

export function buildDiagnosisResult(inp: ReportInputs): DiagnosisResultV1 {
  const { definition, answers, recommend, usage, brandVoiceMissing, grantOutcome } = inp;

  const industryQ = definition.questions.find((q) => q.type === 'industry_grid');
  const industry = industryQ ? answers[industryQ.key] ?? null : null;

  const findings: DiagnosisFinding[] = [];
  // 잠금 해제 소견 — FREE에서 실제로 잠긴 4축만(§3-1 실측. 고객DB 제외).
  findings.push({
    key: 'locked_features',
    text: '지금(미가입) 상태에서는 모바일 DM·자동 발송·AI 제작·자사몰 연동이 잠겨 있어요. 유료 요금제에서 전부 열립니다.',
  });
  if (brandVoiceMissing) {
    findings.push({
      key: 'brand_voice_missing',
      text: '브랜드 보이스가 아직 등록되지 않았어요. 등록하면 AI가 만드는 문안이 우리 브랜드 말투를 따라갑니다.',
    });
  }

  const effects: DiagnosisEffect[] = [];

  if (usage) {
    const parts: string[] = [];
    if (usage.smsSent > 0) parts.push(`SMS ${usage.smsSent.toLocaleString()}건`);
    if (usage.lmsSent > 0) parts.push(`LMS ${usage.lmsSent.toLocaleString()}건`);
    if (usage.mmsSent > 0) parts.push(`MMS ${usage.mmsSent.toLocaleString()}건`);
    if (usage.kakaoSent > 0) parts.push(`카카오 ${usage.kakaoSent.toLocaleString()}건`);
    effects.push({
      kind: 'usage',
      label: '이번 달 발송 실적',
      value: usage.totalSuccess > 0
        ? `성공 ${usage.totalSuccess.toLocaleString()}건 (${parts.join(' · ')})`
        : '이번 달 발송 이력이 아직 없어요',
      source: '이번 달 발송 결과 실측',
    });
    if (usage.monthlyCost > 0) {
      effects.push({
        kind: 'usage',
        label: '이번 달 사용 금액',
        value: `${Math.round(usage.monthlyCost).toLocaleString()}원`,
        source: '이번 달 발송 결과 × 계약 단가(부가세 포함)',
      });
    }
  }

  if (recommend.plan) {
    const credits = Number(recommend.plan['ai_credits_per_month'] ?? 0) || 0;
    if (credits > 0) {
      const conv = CONVERSION_TASKS
        .map(({ source, label }) => {
          const cost = CREDIT_COST_MAP[source];
          if (!cost || cost <= 0) return null;
          return `${label} 월 ${Math.floor(credits / cost).toLocaleString()}회`;
        })
        .filter(Boolean)
        .join(' 또는 ');
      if (conv) {
        effects.push({
          kind: 'credit_conversion',
          label: '기본 제공 AI 크레딧으로 할 수 있는 일',
          value: conv,
          source: '요금제 월 기본 크레딧 ÷ 작업별 크레딧',
        });
      }
    }
  }

  const recommendation = recommend.plan
    ? {
        plan_code: String(recommend.plan.plan_code),
        plan_name: String(recommend.plan.plan_name),
        monthly_price: Math.round(Number(recommend.plan.monthly_price) || 0),
        reasons: recommend.reasons,
      }
    : null;

  const summary = recommend.no_match
    ? '딱 맞는 요금제는 상담으로 함께 확인해 드릴게요.'
    : `답변해 주신 내용 기준으로, 지금 단계에는 ${recommendation!.plan_name} 요금제가 알맞아요.`;

  return {
    v: 1,
    summary,
    findings,
    effects,
    recommendation,
    no_match: recommend.no_match,
    grant_outcome: grantOutcome,
    examples: { industry },
  };
}
