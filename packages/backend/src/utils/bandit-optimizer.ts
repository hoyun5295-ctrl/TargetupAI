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
      reasoning: `초기 탐색 단계 (누적 발송 ${totalTrials}회 < 3회) — 모든 variant 동등 기회 박음. 누적 3회 이상부터 Bandit 추천 박힙니다.`,
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
    reasoning = `누적 발송 ${totalTrials}회 — Variant ${chosen.variantIndex + 1} 평균 클릭률 ${(posteriorMean * 100).toFixed(1)}% / 본 sample ${(bestSample * 100).toFixed(1)}%. Thompson Sampling이 탐색 균형을 위해 박음 (최고 평균과 다를 수 있음 — 학습 진행 정합).`;
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
