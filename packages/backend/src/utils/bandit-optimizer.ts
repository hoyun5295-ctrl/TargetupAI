/**
 * ★ CT-31: Bandit Optimizer (Thompson Sampling) — D177 Self-Optimizing (2026-05-19)
 *
 * 🎯 목적
 *   Continuous Operator 제안서에 박힌 message variant A/B/C에 대해 발송 결과(click/conversion)
 *   누적 → Thompson Sampling으로 다음 발송 시 가장 좋은 variant 자동 추천.
 *   영구 원칙 #1 정합: 추천만 박음, 사용자 승인 후 발송 (AI 단독 실행 X).
 *
 * 📊 Beta-Bernoulli Thompson Sampling
 *   - 각 variant는 Beta(α, β) 분포 박음 (success_prior, failure_prior)
 *   - 발송 결과: click 시 α += 1, click X 시 β += 1
 *   - sampling: 각 variant에서 Beta(α, β) sample → 최대값 variant 추천
 *   - 초기 prior: α=1, β=1 (uniform — 정보 없음)
 *
 * 📋 사용 흐름
 *   1. generateProposalForOperator → orchestrate → messages 3안 박음
 *   2. operator_proposal_variants INSERT (variant_index 0/1/2, α=1, β=1 박음)
 *   3. 사용자 승인 → 한 variant 발송 (Bandit 추천 또는 사용자 직접 선택)
 *   4. 발송 결과 박힘 → recordVariantReward(α/β 갱신)
 *   5. 다음 제안서 박을 때 동일 operator의 누적 reward 기반으로 Bandit 추천
 *
 * ⛔ 영구 원칙
 *   - Bandit은 추천만 박음 (AI 단독 실행 X)
 *   - Zero-Count: target 0건이면 Bandit 호출 X (continuous-operator에서 차단)
 *   - 초기 3회 미만은 explore (모든 variant 박을 기회 동등 박음)
 */

import { query } from '../config/database';

// ════════════════════════════════════════════════════════════════════
// 타입
// ════════════════════════════════════════════════════════════════════

export interface ProposalVariant {
  id: string;
  proposalId: string;
  variantIndex: number;
  messageBody: string;
  byteCount: number;
  armAlpha: number;
  armBeta: number;
  sentCount: number;
  clickCount: number;
  conversionCount: number;
  rewardTotal: number;
  createdAt: Date;
}

export interface BanditRecommendation {
  variantId: string;
  variantIndex: number;
  messageBody: string;
  posteriorMean: number;     // α / (α + β) — 평균 click rate
  posteriorSample: number;   // 본 호출에서 박힌 Beta sample
  totalTrials: number;       // α + β - 2 (실제 발송 누적)
  reasoning: string;         // 사용자 노출용 한국어 사유
}

// ════════════════════════════════════════════════════════════════════
// Beta 분포 sampling (Marsaglia and Tsang method via Gamma)
// ════════════════════════════════════════════════════════════════════

/**
 * Gamma(shape, 1) 분포 sample — Marsaglia & Tsang 2000 (TOMS Algorithm).
 */
function sampleGamma(shape: number): number {
  if (shape < 1) {
    // Boost: Gamma(shape) = Gamma(shape + 1) * U^(1/shape)
    const u = Math.random();
    return sampleGamma(shape + 1) * Math.pow(u, 1 / shape);
  }
  const d = shape - 1 / 3;
  const c = 1 / Math.sqrt(9 * d);
  while (true) {
    let x: number, v: number;
    do {
      x = sampleNormal();
      v = 1 + c * x;
    } while (v <= 0);
    v = v * v * v;
    const u = Math.random();
    if (u < 1 - 0.0331 * x * x * x * x) return d * v;
    if (Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v;
  }
}

/**
 * Box-Muller transform — N(0, 1) sample.
 */
function sampleNormal(): number {
  let u = 0, v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
}

/**
 * Beta(alpha, beta) 분포 sample.
 */
export function sampleBeta(alpha: number, beta: number): number {
  const x = sampleGamma(alpha);
  const y = sampleGamma(beta);
  return x / (x + y);
}

// ════════════════════════════════════════════════════════════════════
// Thompson Sampling — variant 선택
// ════════════════════════════════════════════════════════════════════

/**
 * 주어진 variant 목록에서 Thompson Sampling으로 최선의 variant 추천.
 * - 각 variant Beta(α, β) sample → 최대값 추천
 * - 초기(누적 trials < 3)는 explore (random) — cold start 정합
 */
export function thompsonSamplingChoice(variants: ProposalVariant[]): BanditRecommendation | null {
  if (variants.length === 0) return null;

  const totalTrials = variants.reduce((sum, v) => sum + v.sentCount, 0);

  // Cold start: 발송 누적 3회 미만이면 explore (random) — 모든 variant 동등 박음
  if (totalTrials < 3) {
    const randomIdx = Math.floor(Math.random() * variants.length);
    const chosen = variants[randomIdx];
    return {
      variantId: chosen.id,
      variantIndex: chosen.variantIndex,
      messageBody: chosen.messageBody,
      posteriorMean: chosen.armAlpha / (chosen.armAlpha + chosen.armBeta),
      posteriorSample: 0,
      totalTrials,
      reasoning: `초기 탐색 단계 (누적 발송 ${totalTrials}회 < 3회) — 모든 variant 동등 기회 제공. 누적 3회 이상부터 Bandit 추천이 작동합니다.`,
    };
  }

  // Thompson Sampling — 각 variant Beta sample
  let bestIdx = 0;
  let bestSample = -1;
  const samples: number[] = [];
  for (let i = 0; i < variants.length; i++) {
    const v = variants[i];
    const sample = sampleBeta(v.armAlpha, v.armBeta);
    samples.push(sample);
    if (sample > bestSample) {
      bestSample = sample;
      bestIdx = i;
    }
  }

  const chosen = variants[bestIdx];
  const posteriorMean = chosen.armAlpha / (chosen.armAlpha + chosen.armBeta);
  const allMeans = variants.map((v) => v.armAlpha / (v.armAlpha + v.armBeta));
  const bestMeanIdx = allMeans.indexOf(Math.max(...allMeans));

  let reasoning = '';
  if (bestIdx === bestMeanIdx) {
    reasoning = `누적 발송 ${totalTrials}회 — Variant ${chosen.variantIndex + 1} 평균 클릭률 ${(posteriorMean * 100).toFixed(1)}% (최우수). Thompson Sampling 추천.`;
  } else {
    reasoning = `누적 발송 ${totalTrials}회 — Variant ${chosen.variantIndex + 1} 평균 클릭률 ${(posteriorMean * 100).toFixed(1)}% / 본 sample ${(bestSample * 100).toFixed(1)}%. Thompson Sampling이 탐색 균형을 위해 추천 (최고 평균과 다를 수 있음 — 학습 진행 정합).`;
  }

  return {
    variantId: chosen.id,
    variantIndex: chosen.variantIndex,
    messageBody: chosen.messageBody,
    posteriorMean,
    posteriorSample: bestSample,
    totalTrials,
    reasoning,
  };
}

// ════════════════════════════════════════════════════════════════════
// DB CRUD — operator_proposal_variants
// ════════════════════════════════════════════════════════════════════

export interface InsertVariantInput {
  proposalId: string;
  variantIndex: number;
  messageBody: string;
  byteCount: number;
}

export async function insertProposalVariants(variants: InsertVariantInput[]): Promise<void> {
  if (variants.length === 0) return;
  // 일괄 INSERT — α=1, β=1 prior 박음 (uniform)
  const values: string[] = [];
  const params: any[] = [];
  let i = 1;
  for (const v of variants) {
    values.push(`(gen_random_uuid(), $${i++}::uuid, $${i++}, $${i++}, $${i++}, 1.0, 1.0, 0, 0, 0, 0, NOW())`);
    params.push(v.proposalId, v.variantIndex, v.messageBody, v.byteCount);
  }
  await query(
    `INSERT INTO operator_proposal_variants
      (id, proposal_id, variant_index, message_body, byte_count, arm_alpha, arm_beta, sent_count, click_count, conversion_count, reward_total, created_at)
     VALUES ${values.join(', ')}
     ON CONFLICT (proposal_id, variant_index) DO NOTHING`,
    params
  );
}

export async function listVariantsByProposal(proposalId: string): Promise<ProposalVariant[]> {
  const result = await query(
    `SELECT id, proposal_id, variant_index, message_body, byte_count,
            arm_alpha, arm_beta, sent_count, click_count, conversion_count, reward_total, created_at
     FROM operator_proposal_variants
     WHERE proposal_id = $1::uuid
     ORDER BY variant_index ASC`,
    [proposalId]
  );
  return result.rows.map(mapRow);
}

/**
 * 동일 Operator의 옛 proposal 누적 variant — Bandit 학습 통합 (operator 단위 학습).
 * - 최근 50개 proposal 박은 영역까지 누적
 * - variant_index 기준 같은 자리 (0/1/2) 박힌 영역 박음
 */
export async function listAccumulatedVariantsByOperator(operatorId: string, limit: number = 50): Promise<ProposalVariant[]> {
  const result = await query(
    `SELECT v.id, v.proposal_id, v.variant_index, v.message_body, v.byte_count,
            v.arm_alpha, v.arm_beta, v.sent_count, v.click_count, v.conversion_count, v.reward_total, v.created_at
     FROM operator_proposal_variants v
     JOIN operator_proposals p ON v.proposal_id = p.id
     WHERE p.operator_id = $1::uuid
     ORDER BY p.created_at DESC, v.variant_index ASC
     LIMIT $2`,
    [operatorId, limit * 3]
  );
  return result.rows.map(mapRow);
}

/**
 * 발송 결과 박은 후 reward 누적 — α/β 갱신.
 * - click 박힘: α += 1
 * - click 박지 X: β += 1
 * - conversion 박힘: 추가 reward (변환 가중치 박음)
 */
export interface RecordRewardInput {
  variantId: string;
  sent: number;          // 본 발송 박음 count
  clicked: number;       // click 누적
  converted: number;     // conversion 누적
}

export async function recordVariantReward(input: RecordRewardInput): Promise<void> {
  const { variantId, sent, clicked, converted } = input;
  if (sent <= 0) return;
  const notClicked = Math.max(sent - clicked, 0);
  // reward_total은 click 1점 + conversion 3점 가중 박음
  const rewardIncrement = clicked + converted * 3;
  await query(
    `UPDATE operator_proposal_variants SET
       sent_count = sent_count + $2,
       click_count = click_count + $3,
       conversion_count = conversion_count + $4,
       arm_alpha = arm_alpha + $3,
       arm_beta = arm_beta + $5,
       reward_total = reward_total + $6
     WHERE id = $1::uuid`,
    [variantId, sent, clicked, converted, notClicked, rewardIncrement]
  );
}

/**
 * Bandit 추천 — 주어진 proposal의 variant 중 최선 박음.
 * - operator 단위 누적 학습은 옵션 (operatorId 박으면 옛 proposal까지 박음)
 */
export async function recommendVariantForProposal(
  proposalId: string,
  options: { operatorId?: string; useAccumulated?: boolean } = {}
): Promise<BanditRecommendation | null> {
  let variants: ProposalVariant[];
  if (options.useAccumulated && options.operatorId) {
    // operator 누적 학습 박음 — variant_index 별로 α/β 합산
    const allVariants = await listAccumulatedVariantsByOperator(options.operatorId, 50);
    const byIndex = new Map<number, ProposalVariant>();
    for (const v of allVariants) {
      const existing = byIndex.get(v.variantIndex);
      if (!existing) {
        byIndex.set(v.variantIndex, { ...v });
      } else {
        // 누적 α/β 박음
        existing.armAlpha += v.armAlpha - 1; // -1 to avoid double prior
        existing.armBeta += v.armBeta - 1;
        existing.sentCount += v.sentCount;
        existing.clickCount += v.clickCount;
        existing.conversionCount += v.conversionCount;
        existing.rewardTotal += v.rewardTotal;
      }
    }
    // 본 proposal의 variant 박은 후 누적 reward 합산
    const proposalVariants = await listVariantsByProposal(proposalId);
    variants = proposalVariants.map((pv) => {
      const acc = byIndex.get(pv.variantIndex);
      if (!acc) return pv;
      return {
        ...pv,
        armAlpha: pv.armAlpha + acc.armAlpha - 1,
        armBeta: pv.armBeta + acc.armBeta - 1,
        sentCount: pv.sentCount + acc.sentCount,
      };
    });
  } else {
    variants = await listVariantsByProposal(proposalId);
  }
  return thompsonSamplingChoice(variants);
}

// ════════════════════════════════════════════════════════════════════
// 헬퍼
// ════════════════════════════════════════════════════════════════════

function mapRow(r: any): ProposalVariant {
  return {
    id: r.id,
    proposalId: r.proposal_id,
    variantIndex: r.variant_index,
    messageBody: r.message_body,
    byteCount: r.byte_count || 0,
    armAlpha: parseFloat(r.arm_alpha) || 1.0,
    armBeta: parseFloat(r.arm_beta) || 1.0,
    sentCount: r.sent_count || 0,
    clickCount: r.click_count || 0,
    conversionCount: r.conversion_count || 0,
    rewardTotal: parseFloat(r.reward_total) || 0,
    createdAt: new Date(r.created_at),
  };
}

// ════════════════════════════════════════════════════════════════════
// ★ D188 Phase 2-B-3 (2026-05-21): journey_step_variants — Journey A/B + Bandit 통합
//   - journey_steps 단일 step에 multiple variants (variant_id varchar 'A'/'B'/'C' 정합)
//   - thompsonSamplingChoice 재사용 (ProposalVariant interface 변환)
//   - journey-executor processExecution message step 진입 시 variants 박혀있으면 선택 후 발송
// ════════════════════════════════════════════════════════════════════

export interface JourneyStepVariant {
  id: string;
  stepId: string;
  variantId: string;              // 'A' / 'B' / 'C'
  messageTemplate: string | null;
  subject: string | null;
  channel: string | null;
  alimtalkTemplateCode: string | null;
  alimtalkVariableMap: Record<string, string> | null;
  trafficWeight: number;
  banditAlpha: number;
  banditBeta: number;
  sentCount: number;
  clickCount: number;
  conversionCount: number;
}

export interface JourneyStepVariantRecommendation {
  variant: JourneyStepVariant;
  posteriorMean: number;
  posteriorSample: number;
  totalTrials: number;
  reasoning: string;
}

/**
 * journey_step의 variants 매트릭스 조회 (step_order ASC, variant_id ASC).
 */
export async function listJourneyStepVariants(stepId: string): Promise<JourneyStepVariant[]> {
  const r = await query(
    `SELECT id, step_id, variant_id, message_template, subject, channel,
            alimtalk_template_code, alimtalk_variable_map,
            traffic_weight, bandit_alpha, bandit_beta,
            sent_count, click_count, conversion_count
     FROM journey_step_variants
     WHERE step_id = $1::uuid
     ORDER BY variant_id ASC`,
    [stepId]
  );
  return r.rows.map((row: any) => ({
    id: row.id,
    stepId: row.step_id,
    variantId: row.variant_id,
    messageTemplate: row.message_template,
    subject: row.subject,
    channel: row.channel,
    alimtalkTemplateCode: row.alimtalk_template_code,
    alimtalkVariableMap: row.alimtalk_variable_map,
    trafficWeight: parseFloat(row.traffic_weight) || 0.5,
    banditAlpha: parseFloat(row.bandit_alpha) || 1.0,
    banditBeta: parseFloat(row.bandit_beta) || 1.0,
    sentCount: row.sent_count || 0,
    clickCount: row.click_count || 0,
    conversionCount: row.conversion_count || 0,
  }));
}

/**
 * journey_step variants 중 Bandit Thompson Sampling으로 최선 variant 선택.
 * 누적 발송 3회 미만 = cold start explore (균등 random).
 */
export function selectJourneyStepVariant(variants: JourneyStepVariant[]): JourneyStepVariantRecommendation | null {
  if (variants.length === 0) return null;
  const totalTrials = variants.reduce((sum, v) => sum + v.sentCount, 0);

  if (totalTrials < 3) {
    const randomIdx = Math.floor(Math.random() * variants.length);
    const chosen = variants[randomIdx];
    return {
      variant: chosen,
      posteriorMean: chosen.banditAlpha / (chosen.banditAlpha + chosen.banditBeta),
      posteriorSample: 0,
      totalTrials,
      reasoning: `초기 탐색 단계 (누적 발송 ${totalTrials}회 < 3회) — 모든 variant 동등 기회. 누적 3회 이상부터 Bandit 추천 작동.`,
    };
  }

  let bestIdx = 0;
  let bestSample = -1;
  for (let i = 0; i < variants.length; i++) {
    const v = variants[i];
    const sample = sampleBeta(v.banditAlpha, v.banditBeta);
    if (sample > bestSample) {
      bestSample = sample;
      bestIdx = i;
    }
  }
  const chosen = variants[bestIdx];
  const posteriorMean = chosen.banditAlpha / (chosen.banditAlpha + chosen.banditBeta);
  const reasoning = `누적 발송 ${totalTrials}회 — Variant ${chosen.variantId} 평균 클릭률 ${(posteriorMean * 100).toFixed(1)}% / 본 sample ${(bestSample * 100).toFixed(1)}%. Thompson Sampling 추천.`;
  return {
    variant: chosen,
    posteriorMean,
    posteriorSample: bestSample,
    totalTrials,
    reasoning,
  };
}

/**
 * journey_step_variants 발송 reward 누적 — α/β 갱신.
 */
export async function recordJourneyStepVariantReward(
  variantId: string,
  sent: number,
  clicked: number,
  converted: number
): Promise<void> {
  if (sent <= 0) return;
  const notClicked = Math.max(sent - clicked, 0);
  await query(
    `UPDATE journey_step_variants SET
       sent_count = sent_count + $2,
       click_count = click_count + $3,
       conversion_count = conversion_count + $4,
       bandit_alpha = bandit_alpha + $3,
       bandit_beta = bandit_beta + $5,
       updated_at = NOW()
     WHERE id = $1::uuid`,
    [variantId, sent, clicked, converted, notClicked]
  );
}

/**
 * variant CRUD — step에 신규 variant 추가.
 */
export async function createJourneyStepVariant(input: {
  stepId: string;
  variantId: string;
  messageTemplate?: string;
  subject?: string;
  channel?: string;
  alimtalkTemplateCode?: string;
  alimtalkVariableMap?: Record<string, string>;
  trafficWeight?: number;
}): Promise<string> {
  const r = await query(
    `INSERT INTO journey_step_variants (
      id, step_id, variant_id, message_template, subject, channel,
      alimtalk_template_code, alimtalk_variable_map,
      traffic_weight, bandit_alpha, bandit_beta,
      sent_count, click_count, conversion_count, created_at, updated_at
    ) VALUES (
      gen_random_uuid(), $1::uuid, $2, $3, $4, $5,
      $6, $7::jsonb,
      $8, 1.0, 1.0,
      0, 0, 0, NOW(), NOW()
    ) ON CONFLICT (step_id, variant_id) DO UPDATE SET
      message_template = EXCLUDED.message_template,
      subject = EXCLUDED.subject,
      channel = EXCLUDED.channel,
      alimtalk_template_code = EXCLUDED.alimtalk_template_code,
      alimtalk_variable_map = EXCLUDED.alimtalk_variable_map,
      traffic_weight = EXCLUDED.traffic_weight,
      updated_at = NOW()
    RETURNING id`,
    [
      input.stepId,
      input.variantId.slice(0, 8),
      input.messageTemplate?.slice(0, 2000) || null,
      input.subject?.slice(0, 50) || null,
      input.channel || null,
      input.alimtalkTemplateCode || null,
      input.alimtalkVariableMap ? JSON.stringify(input.alimtalkVariableMap) : null,
      input.trafficWeight != null ? Math.max(0, Math.min(1, input.trafficWeight)) : 0.5,
    ]
  );
  return r.rows[0].id as string;
}

export async function deleteJourneyStepVariant(variantId: string): Promise<boolean> {
  const r = await query(
    `DELETE FROM journey_step_variants WHERE id = $1::uuid RETURNING id`,
    [variantId]
  );
  return r.rows.length > 0;
}

// ════════════════════════════════════════════════════════════════════
// ★ D210+ Phase 3 (2026-05-23 Harold 명시): declareVariantWinner — A/B winner 자동 선언 매트릭스
//
//   본질 (사용자 승인하 자동화):
//     - AI 자기 traffic 영역 변경 X — 회사 admin 명시 적용 의무
//     - 본 함수 = 안내만 (winner 영역 + 신뢰도 + 권장 traffic) — 회사 admin 명시 확인 의무
//     - feedback_no_target_auto_relax 정합 (자동 변경 X)
//
//   알고리즘 (Monte Carlo posterior sampling):
//     1. Beta(α, β) posterior 1,000회 sampling — 각 회 안 최선 variant 카운트
//     2. winner 비율 = winCount / 1000
//     3. 신뢰도 영역 매트릭스:
//        - 95%+ → "Winner 영역 (95%+ 신뢰도)" + 100% traffic 권장
//        - 80~95% → "선두 영역 (XX% 신뢰도)" + 80% traffic 권장
//        - 80% 미만 → "데이터 부족" + 균등 영역
//     4. Cold start (누적 < 30회) → 균등 영역 정합 (Bandit 흐름 유지)
// ════════════════════════════════════════════════════════════════════

export interface VariantWinnerDeclaration {
  winnerVariantId: string | null;                    // null = 신뢰도 부족 영역
  winnerConfidence: number;                           // 0~1 (winner 비율)
  recommendedTrafficWeights: Record<string, number>;  // variantId → traffic (0~1)
  totalTrials: number;
  variantProbabilities: Record<string, number>;       // variantId → winner 비율 (1,000회 sampling)
  reasoning: string;                                  // 회사 admin 안내 한국어 사유
  status: 'cold_start' | 'low_confidence' | 'leading' | 'winner';
}

export function declareVariantWinner(variants: JourneyStepVariant[]): VariantWinnerDeclaration {
  if (variants.length === 0) {
    return {
      winnerVariantId: null,
      winnerConfidence: 0,
      recommendedTrafficWeights: {},
      totalTrials: 0,
      variantProbabilities: {},
      reasoning: 'variant 영역 0건',
      status: 'cold_start',
    };
  }

  const totalTrials = variants.reduce((sum, v) => sum + v.sentCount, 0);

  // Cold start — 누적 30회 미만 영역
  if (totalTrials < 30) {
    const equalWeight = 1.0 / variants.length;
    const weights: Record<string, number> = {};
    variants.forEach((v) => (weights[v.variantId] = equalWeight));
    return {
      winnerVariantId: null,
      winnerConfidence: 0,
      recommendedTrafficWeights: weights,
      totalTrials,
      variantProbabilities: {},
      reasoning: `데이터 누적 영역 (누적 ${totalTrials}회 < 30회) — 균등 영역 정합 + Bandit 자동 추천 흐름 유지 영역.`,
      status: 'cold_start',
    };
  }

  // 1,000회 Monte Carlo posterior sampling
  const ITER = 1000;
  const winCounts: Record<string, number> = {};
  variants.forEach((v) => (winCounts[v.variantId] = 0));

  for (let i = 0; i < ITER; i++) {
    let bestIdx = 0;
    let bestSample = -Infinity;
    for (let j = 0; j < variants.length; j++) {
      const s = sampleBeta(variants[j].banditAlpha, variants[j].banditBeta);
      if (s > bestSample) {
        bestSample = s;
        bestIdx = j;
      }
    }
    winCounts[variants[bestIdx].variantId]++;
  }

  // 영역별 winner 비율
  const variantProbabilities: Record<string, number> = {};
  variants.forEach((v) => (variantProbabilities[v.variantId] = winCounts[v.variantId] / ITER));

  // 최대 winner 영역 식별
  let topVariantId = variants[0].variantId;
  let topProbability = variantProbabilities[topVariantId];
  variants.forEach((v) => {
    if (variantProbabilities[v.variantId] > topProbability) {
      topProbability = variantProbabilities[v.variantId];
      topVariantId = v.variantId;
    }
  });

  const topVariant = variants.find((v) => v.variantId === topVariantId)!;
  const topClickRate = topVariant.banditAlpha / (topVariant.banditAlpha + topVariant.banditBeta);
  const trafficWeights: Record<string, number> = {};

  if (topProbability >= 0.95) {
    // 95%+ 신뢰도 영역 — winner 100% traffic 권장
    variants.forEach((v) => (trafficWeights[v.variantId] = v.variantId === topVariantId ? 1.0 : 0.0));
    return {
      winnerVariantId: topVariantId,
      winnerConfidence: topProbability,
      recommendedTrafficWeights: trafficWeights,
      totalTrials,
      variantProbabilities,
      reasoning: `Winner = Variant ${topVariantId} (신뢰도 ${(topProbability * 100).toFixed(1)}% / 평균 클릭률 ${(topClickRate * 100).toFixed(1)}%) — 100% traffic 적용 권장. 회사 admin 명시 적용 의무.`,
      status: 'winner',
    };
  }

  if (topProbability >= 0.80) {
    // 80~95% 신뢰도 영역 — 선두 80% + 그 외 균등
    const remainingWeight = (1 - 0.80) / Math.max(variants.length - 1, 1);
    variants.forEach((v) => (trafficWeights[v.variantId] = v.variantId === topVariantId ? 0.80 : remainingWeight));
    return {
      winnerVariantId: topVariantId,
      winnerConfidence: topProbability,
      recommendedTrafficWeights: trafficWeights,
      totalTrials,
      variantProbabilities,
      reasoning: `선두 = Variant ${topVariantId} (신뢰도 ${(topProbability * 100).toFixed(1)}% / 평균 클릭률 ${(topClickRate * 100).toFixed(1)}%) — 80% traffic 권장 + 추가 발송 후 재평가 의무.`,
      status: 'leading',
    };
  }

  // 80% 미만 — 데이터 부족 영역
  const equalWeight = 1.0 / variants.length;
  variants.forEach((v) => (trafficWeights[v.variantId] = equalWeight));
  return {
    winnerVariantId: null,
    winnerConfidence: topProbability,
    recommendedTrafficWeights: trafficWeights,
    totalTrials,
    variantProbabilities,
    reasoning: `데이터 영역 부족 — 선두 Variant ${topVariantId} 영역 ${(topProbability * 100).toFixed(1)}% 영역 (95% 이상 의무) — 균등 영역 정합 + 추가 발송 후 재평가.`,
    status: 'low_confidence',
  };
}

// ════════════════════════════════════════════════════════════════════
// ★ D211+ Phase 1 (2026-05-23 Harold 명시): Beta-Bernoulli 95% 신뢰 구간 계산
//
//   본질 (회사 admin 입장 안 winner 자동 선언 신뢰 본질):
//     - winner 자동 선언 = Monte Carlo 영역 (기존 영역)
//     - 신뢰 구간 = 평균 클릭률 ± 1.96 × stddev (95% credible interval)
//     - 회사 admin 인지 = "평균 12.3% (95% 신뢰 구간: 8.5%~16.1%)" 본질
//
//   알고리즘 (Beta 분포 통계):
//     mean = α / (α + β)
//     variance = αβ / ((α+β)² × (α+β+1))
//     stddev = sqrt(variance)
//     95% CI = clamp(mean ± 1.96 × stddev, 0, 1)
//
//   사용처:
//     - routes/ai.ts variants GET 응답 안 variantsCI 통합
//     - JourneyVariantsEditor.tsx 안 막대 시각화
// ════════════════════════════════════════════════════════════════════

export interface BetaCredibleInterval {
  mean: number;          // α / (α + β)
  stddev: number;        // sqrt(variance)
  lower95: number;       // clamp(mean - 1.96 × stddev, 0, 1)
  upper95: number;       // clamp(mean + 1.96 × stddev, 0, 1)
  intervalWidth: number; // upper95 - lower95 (좁을수록 신뢰도 높음)
}

export function computeBetaCredibleInterval(alpha: number, beta: number): BetaCredibleInterval {
  const safeAlpha = Math.max(0.001, alpha);
  const safeBeta = Math.max(0.001, beta);
  const sum = safeAlpha + safeBeta;
  const mean = safeAlpha / sum;
  const variance = (safeAlpha * safeBeta) / (sum * sum * (sum + 1));
  const stddev = Math.sqrt(variance);
  const lower95 = Math.max(0, Math.min(1, mean - 1.96 * stddev));
  const upper95 = Math.max(0, Math.min(1, mean + 1.96 * stddev));
  return {
    mean,
    stddev,
    lower95,
    upper95,
    intervalWidth: upper95 - lower95,
  };
}

export interface VariantCI {
  variantId: string;
  ci: BetaCredibleInterval;
}

export function computeVariantsCI(variants: JourneyStepVariant[]): VariantCI[] {
  return variants.map((v) => ({
    variantId: v.variantId,
    ci: computeBetaCredibleInterval(v.banditAlpha, v.banditBeta),
  }));
}
