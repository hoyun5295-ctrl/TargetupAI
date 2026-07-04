// copy-seed-curator.ts — 큐레이션 시드 채굴·저장(하이브리드). 9천 코퍼스에서 업종 베스트 후보를
//   채굴→탈색→누출/스팸 게이트→(사람 승인 후) sentinel tenant 행으로 저장. 저장분이 Track B 검색 시드.
//   ⚠️ INSERT는 슈퍼관리자 승인 흐름에서만 호출(자동 저장 금지). 규격은 training-logger 미러(멱등 ON CONFLICT).
import pool from '../config/database';
import { getSourceRef, getTenantRef } from './training-logger';
import { CURATED_SEED_KEY } from './copy-rag-retriever';
import { rankBestCandidates, type CandidateRow } from './copy-best-ranker';
import { deBrand, hasIdentifierLeak } from './copy-deidentify';
import { scoreSpamRisk } from './copy-spam-risk';

const SPAM_SEED_EXCLUDE = 0.5;

/** 순수: 후보 행 → 베스트 순 탈색·중복제거·누출/스팸 제외 → 시드 텍스트 상위 N. */
export function selectSeedCandidates(rows: CandidateRow[], limit: number): string[] {
  const nonSpamRows = rows.filter((r) => (r.spam_blocked || 0) === 0);
  const ranked = rankBestCandidates(nonSpamRows, Math.max(limit * 3, 30));

  const seen = new Set<string>();
  const out: string[] = [];
  for (const r of ranked) {
    const clean = deBrand(r.text);
    if (!clean || hasIdentifierLeak(clean)) continue; // 누출 시드 금지
    if (clean.replace(/\s/g, '').length < 12) continue; // 인사말·조각 등 저가치 시드 제외(예: "고객님 안녕하세요")
    if (scoreSpamRisk(clean).score >= SPAM_SEED_EXCLUDE) continue; // 스팸 위험 시드 금지
    const key = clean.replace(/\s+/g, ' ');
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(clean);
    if (out.length >= limit) break;
  }
  return out;
}

/** 채굴(읽기 전용): 원본 코퍼스(비-sentinel)에서 업종·채널·광고여부별 시드 후보를 뽑는다. */
export async function mineCuratedCandidates(opts: {
  industryCode: string;
  channels: string[];
  isAd: boolean;
  limit?: number;
}): Promise<string[]> {
  const curatedTenant = getTenantRef(CURATED_SEED_KEY);
  const res = await pool.query(
    `SELECT final_message, final_source, spam_blocked, sent_count, success_count
     FROM ai_training_logs
     WHERE tenant_ref <> $1 AND industry_code = $2 AND message_type = ANY($3::text[]) AND is_ad = $4
       AND final_message IS NOT NULL AND length(final_message) >= 10
     ORDER BY created_at DESC
     LIMIT 300`,
    [curatedTenant, opts.industryCode, opts.channels, opts.isAd],
  );
  return selectSeedCandidates(res.rows as CandidateRow[], opts.limit ?? 10);
}

/** 저장(쓰기): 승인된 시드를 sentinel tenant 행으로 INSERT. 멱등(source_ref ON CONFLICT). 반환=신규 저장 수. */
export async function insertCuratedSeeds(items: {
  text: string;
  industryCode: string;
  messageType: string;
  isAd: boolean;
}[]): Promise<number> {
  const tenantRef = getTenantRef(CURATED_SEED_KEY);
  let inserted = 0;
  for (const it of items) {
    const clean = deBrand(it.text);
    if (!clean || hasIdentifierLeak(clean) || scoreSpamRisk(clean).score >= SPAM_SEED_EXCLUDE) continue;
    const sourceRef = getSourceRef(
      `curated:${it.industryCode}:${it.messageType}:${it.isAd ? 1 : 0}:${clean.replace(/\s+/g, ' ')}`,
    );
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
        sourceRef, tenantRef, it.industryCode, null,
        null, null, null, 'curated_seed',
        it.messageType, it.isAd, null, null,
        clean, 'manual', JSON.stringify({}),  // ★ final_source=CHECK 제약(ck_training_final_source) 허용값. 시드 표식=tenant+segment_key
        new Date(),
        'v1', 'v1', 'v1',
        null, null,
        null, 'v1_regex',
      ],
    );
    if (r.rowCount && r.rowCount > 0) inserted++;
  }
  return inserted;
}

/** 현재 저장된 큐레이션 시드 목록(슈퍼관리자 검수·관리용). */
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

/** 시드 삭제(sentinel tenant 한정 — 실 학습 행은 절대 삭제되지 않음). */
export async function deleteCuratedSeed(id: string): Promise<boolean> {
  const tenantRef = getTenantRef(CURATED_SEED_KEY);
  const r = await pool.query(
    `DELETE FROM ai_training_logs WHERE id = $1::uuid AND tenant_ref = $2`,
    [id, tenantRef],
  );
  return (r.rowCount || 0) > 0;
}
