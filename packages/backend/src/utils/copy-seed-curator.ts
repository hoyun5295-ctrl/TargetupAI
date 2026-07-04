// copy-seed-curator.ts — 업종 베스트 문안(큐레이션 시드) 저장·관리 CT.
//   직원 직접 입력(베스트 문안 페이지) + AI 전수 채굴(best-copy-miner) 승인분을 sentinel tenant 행으로 저장.
//   저장분만 Track B(브랜드보이스 미등록 업체) 생성 참고 원문으로 서빙된다(copy-rag-retriever).
//   ★ 2026-07-04 재설계: 휴리스틱 채굴(mineCuratedCandidates·selectSeedCandidates) 폐기 —
//     AI 판정 채굴은 best-copy-miner.ts, 저장 게이트는 gateSeedText 단일 진입(직접 입력·승인 공용).
//   ⚠️ INSERT/UPDATE/DELETE 전부 sentinel tenant 한정 — 실 학습 행은 절대 건드리지 않는다.
import pool from '../config/database';
import { getSourceRef, getTenantRef } from './training-logger';
import { CURATED_SEED_KEY } from './copy-rag-retriever';
import { deBrand, hasIdentifierLeak } from './copy-deidentify';
import { scoreSpamRisk } from './copy-spam-risk';

const SPAM_SEED_EXCLUDE = 0.5;

export type SeedGateFail = 'too_short' | 'leak' | 'spam' | 'duplicate' | 'not_found';
export type SeedGateResult = { ok: true; text: string } | { ok: false; reason: SeedGateFail };

export interface SeedInput {
  text: string;
  industryCode: string;
  messageType: string;
  isAd: boolean;
}

/** 저장 게이트 단일 진입 — 탈색(deBrand) 적용 후 길이·누출·스팸 검사. 통과 시 탈색본 반환. */
export function gateSeedText(raw: string): SeedGateResult {
  const clean = deBrand(raw);
  if (!clean || clean.replace(/\s/g, '').length < 12) return { ok: false, reason: 'too_short' };
  if (hasIdentifierLeak(clean)) return { ok: false, reason: 'leak' };
  if (scoreSpamRisk(clean).score >= SPAM_SEED_EXCLUDE) return { ok: false, reason: 'spam' };
  return { ok: true, text: clean };
}

/** 시드 멱등 키 — 내용·업종·채널·광고여부 기반(training-logger 규격 미러). */
function seedSourceRef(industryCode: string, messageType: string, isAd: boolean, clean: string): string {
  return getSourceRef(`curated:${industryCode}:${messageType}:${isAd ? 1 : 0}:${clean.replace(/\s+/g, ' ')}`);
}

/** 단건 저장 — 게이트 불통과·중복 시 사유 반환(직원 화면 안내용). */
export async function saveCuratedSeedOne(item: SeedInput): Promise<SeedGateResult> {
  const gate = gateSeedText(item.text);
  if (!gate.ok) return gate;
  const tenantRef = getTenantRef(CURATED_SEED_KEY);
  const sourceRef = seedSourceRef(item.industryCode, item.messageType, item.isAd, gate.text);
  const r = await pool.query(
    `INSERT INTO ai_training_logs (
      source_ref, tenant_ref, industry_code, brand_tone,
      user_prompt, target_filter, target_count, segment_key,
      message_type, is_ad, candidates, selected_candidate_id,
      final_message, final_source, message_features,
      send_at,
      prompt_version, persona_version, policy_version,
      model_id, model_params,
      guardrail_actions, redaction_version
    ) VALUES (
      $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23
    ) ON CONFLICT (source_ref) DO NOTHING`,
    [
      sourceRef, tenantRef, item.industryCode, null,
      null, null, null, 'curated_seed',
      item.messageType, item.isAd, null, null,
      gate.text, 'manual', JSON.stringify({}), // final_source=CHECK 제약 허용값. 시드 표식=tenant+segment_key
      new Date(),
      'v1', 'v1', 'v1',
      null, null,
      null, 'v1_regex',
    ],
  );
  if (!r.rowCount) return { ok: false, reason: 'duplicate' };
  return { ok: true, text: gate.text };
}

/** 일괄 저장(AI 채굴 승인 흐름) — 게이트 불통과분 skip, 신규 저장 수 반환. 멱등. */
export async function insertCuratedSeeds(items: SeedInput[]): Promise<number> {
  let inserted = 0;
  for (const it of items) {
    const one = await saveCuratedSeedOne(it);
    if (one.ok) inserted++;
  }
  return inserted;
}

/** 시드 수정(sentinel 한정) — 게이트 재검사 + source_ref 재계산. 동일 문안 존재 시 duplicate. */
export async function updateCuratedSeed(id: string, item: SeedInput): Promise<SeedGateResult> {
  const gate = gateSeedText(item.text);
  if (!gate.ok) return gate;
  const tenantRef = getTenantRef(CURATED_SEED_KEY);
  const sourceRef = seedSourceRef(item.industryCode, item.messageType, item.isAd, gate.text);
  try {
    const r = await pool.query(
      `UPDATE ai_training_logs
       SET final_message = $1, industry_code = $2, message_type = $3, is_ad = $4, source_ref = $5
       WHERE id = $6::uuid AND tenant_ref = $7`,
      [gate.text, item.industryCode, item.messageType, item.isAd, sourceRef, id, tenantRef],
    );
    if (!r.rowCount) return { ok: false, reason: 'not_found' };
    return { ok: true, text: gate.text };
  } catch (e: any) {
    if (e?.code === '23505') return { ok: false, reason: 'duplicate' };
    throw e;
  }
}

/** 현재 저장된 큐레이션 시드 목록(베스트 문안 페이지용). */
export async function listCuratedSeeds(industryCode?: string): Promise<
  { id: string; text: string; industryCode: string; messageType: string; isAd: boolean }[]
> {
  const tenantRef = getTenantRef(CURATED_SEED_KEY);
  const params: any[] = [tenantRef];
  let where = 'tenant_ref = $1';
  if (industryCode) { where += ' AND industry_code = $2'; params.push(industryCode); }
  const r = await pool.query(
    `SELECT id, final_message, industry_code, message_type, is_ad
     FROM ai_training_logs WHERE ${where} ORDER BY created_at DESC LIMIT 200`,
    params,
  );
  return r.rows.map((x: any) => ({
    id: x.id, text: x.final_message, industryCode: x.industry_code, messageType: x.message_type, isAd: x.is_ad,
  }));
}

/** 업종별 저장 개수(카테고리 칩 뱃지용). */
export async function listCuratedSeedCounts(): Promise<Record<string, number>> {
  const tenantRef = getTenantRef(CURATED_SEED_KEY);
  const r = await pool.query(
    `SELECT industry_code, COUNT(*)::int AS cnt FROM ai_training_logs WHERE tenant_ref = $1 GROUP BY 1`,
    [tenantRef],
  );
  const out: Record<string, number> = {};
  for (const row of r.rows) out[row.industry_code] = row.cnt;
  return out;
}

/** 시드 삭제(sentinel tenant 한정 — 실 학습 행은 절대 삭제되지 않음). */
export async function deleteCuratedSeed(id: string): Promise<boolean> {
  const tenantRef = getTenantRef(CURATED_SEED_KEY);
  const r = await pool.query(
    `DELETE FROM ai_training_logs WHERE id = $1::uuid AND tenant_ref = $2`,
    [id, tenantRef],
  );
  return (r.rowCount || 0) > 0;
}
