/**
 * CT: 마케팅 진단 결과 조립 (2026-08-16 신설 · v3 스토리형 개편 — v3 설계서 §4·§5)
 *
 * 순수 함수 — AI 호출 0(원칙 2)·DB/IO 0. 서버가 계산해 result jsonb로 스냅샷하고
 * 프론트·관리 메뉴는 읽기만 한다.
 *
 * v3 (2026-08-16 브레인스토밍 수렴)
 *   - definition에 축 게이트(axis)가 있으면 **V2 스토리형**(표지·관찰·칭찬·판정·병목 인과 3단·30일 실행)을,
 *     없으면(v1·v2 seed) 기존 **V1**을 그대로 조립한다 — 활성 seed 전환 전후 모두 안전.
 *   - V2는 V1의 상위집합(summary·findings·effects·recommendation·no_match·grant_outcome·examples 전부 유지)
 *     — 관리 화면·구버전 렌더러가 무수정으로 계속 동작한다(회의론자 C4 폐쇄).
 *   - 판정: 총점·백분율 없음. 축 등급 = 게이트 level 하나. 단계 = 관문 사다리(선행 축이 결정).
 *   - 문장 전부 marketing-diagnosis-copy.ts 원장 — 여기는 조립만.
 *   - 수치는 계산 가능한 것만: 실측 usage(A) · manual_count 연환산(답변 하한 × 12) · 크레딧 환산.
 *   - 자사명은 plan30 각주(≤2)와 추천 카드에만 — 관찰·칭찬·병목·표지 0(개수 테스트 고정).
 */
import { CREDIT_COST_MAP } from './ai-credit-calc';
import type { DiagnosisDefinition, DiagnosisQuestion, DiagnosisAxis } from './plan-recommend';
import type { RecommendResult } from './plan-recommend';
import type { MonthlyUsage } from './monthly-usage';
import {
  AXIS_META, LEVEL_LABELS, STAGES, COVER_STRENGTH, COVER_GAP, OBSERVE_LEAD,
  PRAISES, ASSET_PRAISE, GAPS, DIRECTIONS, PRESCRIPTIONS, NO_PRESCRIPTION_VARIANTS,
  FOOTNOTES, COMBO_OBSERVATIONS, UPGRADE_SUGGESTIONS, MANUAL_COUNT_MIN,
  TOUCH_SUBJECT, fillTouch,
} from './marketing-diagnosis-copy';

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

interface DiagnosisResultBase {
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

export interface DiagnosisResultV1 extends DiagnosisResultBase {
  v: 1;
}

export interface DiagnosisStage {
  key: string;
  label: string;
  line: string;
  position: number;
  /** unknown 계열 답 3개 이상 = 눈금 미발행("확인이 더 필요해요") — 감점이 아니라 미판정(M4). */
  issued: boolean;
  /** 4단계 이름 전체 — 눈금 렌더용(프론트 하드코딩 금지: 스냅샷이 자기 눈금을 소유). */
  scale: string[];
}

export interface DiagnosisCover {
  /** 퍼널 B 표지 1층(회사명이 폼 뒤에나 생긴다 — C3): 접점 구절. A는 프론트가 회사명으로 대체 가능. */
  subject: string | null;
  strength_clause: string | null;
  gap_clause: string | null;
  headline: string;
}

export interface DiagnosisObservationItem {
  text: string;
  /** true = 답변이 아니라 서버 실측(퍼널 A prefill — 인용형으로 쓰면 거짓이라 서술을 가른다). */
  measured?: boolean;
}

export interface DiagnosisAxisRow {
  axis: DiagnosisAxis;
  label: string;
  level: number;
  level_label: string;
}

export interface DiagnosisGapV2 {
  axis: DiagnosisAxis;
  label: string;
  /** 인과 1단 — 게이트 답 라벨 인용(집필 0). */
  heard: string;
  cause: string;
  effect: string;
  direction: string;
}

export interface DiagnosisPlanStep {
  week: string;
  title: string;
  action: string;
  /** 자사 연결 각주 — 처방 카드 하단 작은 활자 전용. 리포트 전체 ≤2. */
  footnote?: string;
}

export interface DiagnosisResultV2 extends DiagnosisResultBase {
  v: 2;
  stage: DiagnosisStage | null;
  cover: DiagnosisCover;
  observation: { items: DiagnosisObservationItem[]; source: string };
  praises: string[];
  axes: DiagnosisAxisRow[];
  /** 모순 조합 관찰문(강등 아님 — 소견 승격) + 고도화 제안 일부. */
  insights: string[];
  gaps: DiagnosisGapV2[];
  plan30: DiagnosisPlanStep[];
  no_match_kind: 'over_range' | 'other' | null;
}

export type DiagnosisResult = DiagnosisResultV1 | DiagnosisResultV2;

export interface ReportInputs {
  definition: DiagnosisDefinition;
  /** 검증 통과 answers — 퍼널 A prefill은 라우트가 실측 값을 병합해 넘긴다(저장은 병합 전 원본). */
  answers: Record<string, string>;
  recommend: RecommendResult;
  /** 퍼널 A = 이번 달 실측 사용(monthly-usage CT). 퍼널 B = null(금액 0 원칙 — §2-8). */
  usage: MonthlyUsage | null;
  brandVoiceMissing: boolean;
  grantOutcome: GrantOutcome;
  /** 퍼널 A — sending 축이 서버 실측으로 채워졌을 때(관찰 서술을 실측형으로 가른다 · M1). */
  prefill?: { sending?: { optionKey: string; sentCount: number } };
}

/** 크레딧 환산 표 — 마케터 언어 작업 3종만(CREDIT_COST_MAP 파생 · 원 단가 비노출). 공개 /credit-costs도 이 표를 쓴다. */
export const CONVERSION_TASKS: Array<{ source: keyof typeof CREDIT_COST_MAP & string; label: string }> = [
  { source: 'generate-messages', label: '문안 생성' },
  { source: 'dm-builder', label: '모바일 DM 발행' },
  { source: 'image-studio-generate', label: '이미지 스튜디오 생성' },
];

function effectiveLevel(q: DiagnosisQuestion, optionKey: string): number | null {
  const idx = q.options.findIndex((o) => o.key === optionKey);
  if (idx < 0) return null;
  return q.options[idx].level ?? idx;
}

function buildEffects(inp: ReportInputs): DiagnosisEffect[] {
  const { answers, recommend, usage } = inp;
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

  // 반복 손 발송 연환산 — 응답자가 스스로 말한 월 횟수의 하한 × 12(추정 % 금지 계약을 지키는 유일한 시간 축)
  const mc = answers['manual_count'];
  if (mc && MANUAL_COUNT_MIN[mc] !== undefined) {
    const min = MANUAL_COUNT_MIN[mc];
    effects.push({
      kind: 'usage',
      label: '손으로 챙기는 반복 발송',
      value: `월 ${min}번 이상, 1년이면 ${(min * 12).toLocaleString()}번이 넘는 수작업이에요`,
      source: '답변하신 월 횟수 × 12개월',
    });
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
  return effects;
}

function buildRecommendation(recommend: RecommendResult): DiagnosisResultBase['recommendation'] {
  return recommend.plan
    ? {
        plan_code: String(recommend.plan.plan_code),
        plan_name: String(recommend.plan.plan_name),
        monthly_price: Math.round(Number(recommend.plan.monthly_price) || 0),
        reasons: recommend.reasons,
      }
    : null;
}

/** v1·v2 seed(축 게이트 없음) — 기존 V1 조립 그대로(스냅샷·프리뷰 계약 무변경). */
function buildLegacyV1(inp: ReportInputs, industry: string | null): DiagnosisResultV1 {
  const { recommend, brandVoiceMissing, grantOutcome } = inp;
  const findings: DiagnosisFinding[] = [];
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
  const recommendation = buildRecommendation(inp.recommend);
  const summary = recommend.no_match
    ? '딱 맞는 요금제는 상담으로 함께 확인해 드릴게요.'
    : `답변해 주신 내용 기준으로, 지금 단계에는 ${recommendation!.plan_name} 요금제가 알맞아요.`;
  return {
    v: 1,
    summary,
    findings,
    effects: buildEffects(inp),
    recommendation,
    no_match: recommend.no_match,
    grant_outcome: grantOutcome,
    examples: { industry },
  };
}

export function buildDiagnosisResult(inp: ReportInputs): DiagnosisResult {
  const { definition, answers, recommend, brandVoiceMissing, grantOutcome, prefill } = inp;

  const industryQ = definition.questions.find((q) => q.type === 'industry_grid');
  const industryRaw = industryQ ? answers[industryQ.key] ?? null : null;
  // 「그 외」 업종은 목업 자산이 없다 — null이면 예시 블록이 생략된다(m2 · 404 iframe 차단)
  const industry = industryRaw === 'etc' ? null : industryRaw;

  const gates = definition.questions.filter((q) => q.axis !== undefined);
  if (gates.length === 0) return buildLegacyV1(inp, industry);

  const touch = answers['touchpoint'] ?? null;

  // ── 축 등급(게이트 level 하나 — 총점·가산·캡 전부 없음) ──
  const levels = new Map<DiagnosisAxis, { level: number; optionLabel: string; question: DiagnosisQuestion }>();
  for (const q of gates) {
    const a = answers[q.key];
    if (!a) continue;
    const lv = effectiveLevel(q, a);
    const opt = q.options.find((o) => o.key === a);
    if (lv === null || !opt) continue;
    levels.set(q.axis as DiagnosisAxis, { level: lv, optionLabel: opt.label, question: q });
  }

  // unknown 계열 답 개수(전 문항) — 3개 이상 = 단계 눈금 미발행(M4)
  let unknownCount = 0;
  for (const q of definition.questions) {
    const a = answers[q.key];
    if (!a) continue;
    const opt = q.options.find((o) => o.key === a);
    if (opt?.unknown === true) unknownCount++;
  }

  // ── 단계 관문 사다리(선행 축이 결정 — 위에서 첫 일치) ──
  const lv = (axis: DiagnosisAxis) => levels.get(axis)?.level ?? 0;
  let stagePos: number;
  if (lv('list') === 0) stagePos = 0;
  else if (lv('targeting') <= 1) stagePos = 1;
  else if (lv('repeat') <= 1 || lv('measure') <= 1) stagePos = 2;
  else stagePos = 3;
  const stageRow = STAGES[stagePos];
  const stage: DiagnosisStage = {
    key: stageRow.key,
    label: stageRow.label,
    line: stageRow.line,
    position: stagePos,
    issued: unknownCount < 3,
    scale: STAGES.map((s) => s.label),
  };

  // ── 축별 판정 표(강한 축 위 — 시선이 칭찬 → 아쉬움 순서로 흐른다) ──
  const axes: DiagnosisAxisRow[] = [...levels.entries()]
    .map(([axis, v]) => ({
      axis,
      label: AXIS_META[axis].label,
      level: v.level,
      level_label: LEVEL_LABELS[Math.min(3, Math.max(0, v.level))],
    }))
    .sort((a, b) => b.level - a.level || AXIS_META[a.axis].priority - AXIS_META[b.axis].priority);

  // ── 병목(level ≤ 1 축 · 우선순위 정렬 · 최대 3) → 인과 3단 ──
  const bottleneckAxes = [...levels.entries()]
    .filter(([, v]) => v.level <= 1)
    .sort((a, b) => a[1].level - b[1].level || AXIS_META[a[0]].priority - AXIS_META[b[0]].priority)
    .slice(0, 3);

  const gaps: DiagnosisGapV2[] = [];
  for (const [axis, v] of bottleneckAxes) {
    const entry = GAPS[axis]?.[v.level as 0 | 1];
    if (!entry) continue; // 원장에 문장이 없는 조합은 병목으로 단정하지 않는다(빈칸은 채우지 않고 뺀다)
    gaps.push({
      axis,
      label: AXIS_META[axis].label,
      heard: `${OBSERVE_LEAD[axis]} 「${v.optionLabel}」`,
      cause: entry.cause,
      effect: fillTouch(entry.effect, touch),
      direction: fillTouch(DIRECTIONS[axis], touch),
    });
  }

  // ── 모순 조합 관찰문(강등 아님 — 소견 승격 · 전용 집필 2종) ──
  const insights: string[] = [];
  if (lv('targeting') === 3 && answers['list_fields'] === 'contact_only') {
    insights.push(COMBO_OBSERVATIONS.headless_criteria);
  }
  if (answers['inflow_capture'] === 'no_capture' && lv('list') <= 1) {
    insights.push(fillTouch(COMBO_OBSERVATIONS.paid_inflow_leak, touch));
  }

  // ── 칭찬(level 2+ 상위 2 · 근거 없으면 접점 자산 문장 1개 보장 — 억지 칭찬 금지 M6) ──
  const praiseAxes = [...levels.entries()]
    .filter(([, v]) => v.level >= 2)
    .sort((a, b) => b[1].level - a[1].level || AXIS_META[a[0]].priority - AXIS_META[b[0]].priority)
    .slice(0, 2);
  const praises: string[] = praiseAxes.map(([axis]) => PRAISES[axis]);
  if (praises.length === 0 && touch && ASSET_PRAISE[touch]) praises.push(ASSET_PRAISE[touch]);

  // ── 관찰(들은 것) — 판단 0 · 라벨 인용. prefill 축은 실측 서술(인용형은 거짓 — 회의 확정) ──
  const obsOrder: DiagnosisAxis[] = ['list', 'targeting', 'sending', 'repeat', 'measure'];
  const obsItems: DiagnosisObservationItem[] = [];
  for (const axis of obsOrder) {
    const v = levels.get(axis);
    if (!v) continue;
    if (axis === 'sending' && prefill?.sending) {
      obsItems.push({
        text: `지난 30일 동안 실제로 ${prefill.sending.sentCount.toLocaleString()}번의 발송이 나갔어요.`,
        measured: true,
      });
    } else {
      obsItems.push({ text: `${OBSERVE_LEAD[axis]} 「${v.optionLabel}」${obsItems.length === 0 ? '라고 답해 주셨어요' : ''}.` });
    }
  }
  const observation = {
    items: obsItems,
    source: prefill?.sending
      ? '답변해 주신 내용과 이번 달 발송 실측만으로 계산했어요. 외부 추정 없음'
      : '답변해 주신 내용만으로 계산했어요. 외부 추정 없음',
  };

  // ── 30일 실행 — 병목별 처방(심화 답이 변형 선택). 병목 0 = 고도화 제안 경로 ──
  const weekLabels = ['1주차', '2주차', '한 달 안에'];
  const plan30: DiagnosisPlanStep[] = [];
  let footnotesUsed = 0;
  for (const gap of gaps) {
    const pres = PRESCRIPTIONS[gap.axis];
    let action = pres.default;
    let skipped = false;
    for (const [variantKey, text] of Object.entries(pres.variants ?? {})) {
      const [qKey, aKey] = variantKey.split(':');
      if (answers[qKey] === aKey) {
        if (NO_PRESCRIPTION_VARIANTS.has(variantKey)) { skipped = true; break; }
        action = text;
        break;
      }
    }
    // "지금은 필요 없어서요"에는 처방하지 않는다(억지 처방 금지)
    if (!skipped && answers['measure_reason'] === 'no_need' && gap.axis === 'measure') skipped = true;
    if (skipped) continue;
    const step: DiagnosisPlanStep = {
      week: weekLabels[Math.min(plan30.length, weekLabels.length - 1)],
      title: AXIS_META[gap.axis].label,
      action: fillTouch(action, touch),
    };
    if (footnotesUsed < 2) {
      step.footnote = FOOTNOTES[gap.axis];
      footnotesUsed++;
    }
    plan30.push(step);
  }
  if (plan30.length === 0) {
    // 전 축 상위 — 요금제를 밀지 않고 심화 답에서 파생한 고도화 제안(자사명 0)
    for (const u of UPGRADE_SUGGESTIONS) {
      if (answers[u.q] === u.a && plan30.length < 3) {
        plan30.push({ week: weekLabels[Math.min(plan30.length, 2)], title: '한 단계 더', action: u.text });
      }
    }
  }

  // ── 표지 — 강점절 + 약점절 2행(강점 근거 0이면 1행 — M6) ──
  // 약점절은 축 × level(★Codex 1R — level 1 정상 답변에 level 0 문구가 나가면 표지가 거짓이 된다)
  const strengthAxis = praiseAxes[0]?.[0] ?? null;
  const gapAxis = gaps[0]?.axis ?? null;
  const gapLevel = gapAxis ? (levels.get(gapAxis)?.level ?? 0) : 0;
  const strength_clause = strengthAxis && gapAxis ? COVER_STRENGTH[strengthAxis] : null;
  const gap_clause = gapAxis ? COVER_GAP[gapAxis]?.[gapLevel as 0 | 1] ?? null : null;
  // 단계 미발행이면 단계 문장을 표지로 단정하지 않는다(★Codex 2R — 미확인 사실 단정 금지)
  const headline = strength_clause && gap_clause
    ? `${strength_clause}, ${gap_clause}`
    : gap_clause ?? (stage.issued ? stageRow.line : '확인된 답변만으로 정리했어요');
  const cover: DiagnosisCover = {
    subject: touch ? TOUCH_SUBJECT[touch] ?? null : null,
    strength_clause,
    gap_clause,
    headline,
  };

  // ── V1 호환 필드(관리 화면·구버전 렌더러) — 판매 문구 소견은 폐기(회의 물증 1호) ──
  const findings: DiagnosisFinding[] = [];
  if (stage.issued) findings.push({ key: 'stage', text: `지금 단계: ${stage.label}` });
  for (const gap of gaps) findings.push({ key: `gap_${gap.axis}`, text: gap.cause });
  if (brandVoiceMissing) {
    findings.push({
      key: 'brand_voice_missing',
      text: '브랜드 보이스가 아직 등록되지 않았어요. 등록하면 AI가 만드는 문안이 우리 브랜드 말투를 따라갑니다.',
    });
  }

  return {
    v: 2,
    summary: headline,
    findings,
    effects: buildEffects(inp),
    recommendation: buildRecommendation(recommend),
    no_match: recommend.no_match,
    no_match_kind: recommend.no_match ? recommend.no_match_kind : null,
    grant_outcome: grantOutcome,
    examples: { industry },
    stage,
    cover,
    observation,
    praises,
    axes,
    insights,
    gaps,
    plan30,
  };
}
