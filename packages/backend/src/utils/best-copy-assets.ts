// best-copy-assets.ts — 베스트 문안 진화 자산 CT (2026-07-04 설계: specs/2026-07-04-best-copy-evolution-design.md)
//   ① 시드 사용 기록/근사 성과 집계(best_copy_seed_usage)
//   ② 업종 승리 공식·AI 재창작 예시 저장(best_copy_assets — kind='formula'|'style_example')
//   ③ 유사도 가드(jaccard3) — 재창작 예시가 시드 원문과 닮지 않았는지 검사
//   테이블 미생성(42P01) = 조용히 degrade(기록 skip·조회 빈 결과) — 배포 순서 자유.
import crypto from 'crypto';
import pool from '../config/database';
import { getTenantRef } from './training-logger';

const UNDEFINED_TABLE = '42P01';

function isMissingTable(e: any): boolean {
  return e?.code === UNDEFINED_TABLE;
}

// ───────────────── 유사도 가드 ─────────────────

/** word 3-gram 집합 (2단어 이하 문장은 단어 집합) */
function trigrams(text: string): Set<string> {
  const words = String(text || '').toLowerCase().replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
  const out = new Set<string>();
  if (words.length < 3) { for (const w of words) out.add(w); return out; }
  for (let i = 0; i <= words.length - 3; i++) out.add(`${words[i]} ${words[i + 1]} ${words[i + 2]}`);
  return out;
}

/** word 3-gram Jaccard 유사도 0~1 — 재창작 예시 vs 시드 원문 닮음 검사 */
export function jaccard3(a: string, b: string): number {
  const A = trigrams(a);
  const B = trigrams(b);
  if (A.size === 0 || B.size === 0) return 0;
  let inter = 0;
  for (const g of A) if (B.has(g)) inter++;
  return inter / (A.size + B.size - inter);
}

export const EXAMPLE_SIMILARITY_MAX = 0.35; // 이상이면 시드와 과유사 — 게시 금지

// ───────────────── ① 시드 사용 기록 + 근사 성과 ─────────────────

/** Track B 서빙 시 시드 사용 기록 — fire-and-forget(실패해도 생성 무영향). */
export async function recordSeedUsage(companyId: string, seedIds: string[], channel: string): Promise<void> {
  if (!seedIds.length) return;
  try {
    const tenantRef = getTenantRef(companyId);
    const values: string[] = [];
    const params: any[] = [];
    seedIds.forEach((sid, i) => {
      values.push(`($${i * 3 + 1}::uuid, $${i * 3 + 2}, $${i * 3 + 3})`);
      params.push(sid, tenantRef, channel);
    });
    await pool.query(
      `INSERT INTO best_copy_seed_usage (seed_id, tenant_ref, channel) VALUES ${values.join(',')}`,
      params,
    );
  } catch (e: any) {
    if (!isMissingTable(e)) console.warn('[best-copy] 시드 사용 기록 실패(무시):', e?.message);
  }
}

export interface SeedUsageStat {
  uses: number;          // 참고 횟수(정확 — 프롬프트 서빙 횟수)
  approxSent: number;    // 참고 후 7일 내 같은 회사 발송 합(근사)
  approxSuccess: number;
}

/** 시드별 참고 횟수 + 근사 성과. 테이블 없으면 빈 맵. */
export async function getSeedUsageStats(): Promise<Record<string, SeedUsageStat>> {
  try {
    const r = await pool.query(
      `SELECT u.seed_id::text AS seed_id,
              COUNT(DISTINCT u.id)::int AS uses,
              COALESCE(SUM(t.sent_count), 0)::bigint AS sent,
              COALESCE(SUM(t.success_count), 0)::bigint AS success
       FROM best_copy_seed_usage u
       LEFT JOIN ai_training_logs t
         ON t.tenant_ref = u.tenant_ref AND t.sent_count IS NOT NULL
        AND t.send_at >= u.used_at AND t.send_at < u.used_at + INTERVAL '7 days'
       GROUP BY u.seed_id`,
    );
    const out: Record<string, SeedUsageStat> = {};
    for (const row of r.rows) {
      out[row.seed_id] = { uses: row.uses, approxSent: Number(row.sent), approxSuccess: Number(row.success) };
    }
    return out;
  } catch (e: any) {
    if (!isMissingTable(e)) console.warn('[best-copy] 사용 집계 실패(빈 결과):', e?.message);
    return {};
  }
}

// ───────────────── ② 공식 + 재창작 예시 저장 ─────────────────

export interface IndustryFormulaMeta {
  hooks: string[];        // 통하는 후킹 유형
  structure: string;      // 구성 흐름
  tone: string;
  cta: string;
  length_hint: string;
  donts: string[];
}

export interface StoredFormula { content: string; meta: IndustryFormulaMeta; createdAt: string }
export interface StyleExample { id: string; text: string; tags: string[] }

/** 업종 공식 조회 — 없거나 테이블 미생성이면 null. */
export async function getIndustryFormula(industryCode: string): Promise<StoredFormula | null> {
  try {
    const r = await pool.query(
      `SELECT content, meta, created_at FROM best_copy_assets
       WHERE kind = 'formula' AND industry_code = $1
       ORDER BY created_at DESC LIMIT 1`,
      [industryCode],
    );
    if (!r.rows.length) return null;
    const row = r.rows[0];
    return { content: row.content, meta: row.meta as IndustryFormulaMeta, createdAt: String(row.created_at) };
  } catch (e: any) {
    if (!isMissingTable(e)) console.warn('[best-copy] 공식 조회 실패(null):', e?.message);
    return null;
  }
}

/** 업종 공식 교체 저장(업종당 1행). 테이블 없으면 false. */
export async function saveIndustryFormula(industryCode: string, content: string, meta: IndustryFormulaMeta): Promise<boolean> {
  try {
    await pool.query(`DELETE FROM best_copy_assets WHERE kind = 'formula' AND industry_code = $1`, [industryCode]);
    await pool.query(
      `INSERT INTO best_copy_assets (id, kind, industry_code, content, meta) VALUES ($1, 'formula', $2, $3, $4)`,
      [crypto.randomUUID(), industryCode, content, JSON.stringify(meta)],
    );
    return true;
  } catch (e: any) {
    if (!isMissingTable(e)) console.warn('[best-copy] 공식 저장 실패:', e?.message);
    return false;
  }
}

/** 업종 재창작 예시 교체 저장. 테이블 없으면 false. */
export async function replaceStyleExamples(industryCode: string, examples: { text: string; tags: string[] }[]): Promise<boolean> {
  try {
    await pool.query(`DELETE FROM best_copy_assets WHERE kind = 'style_example' AND industry_code = $1`, [industryCode]);
    for (const ex of examples) {
      await pool.query(
        `INSERT INTO best_copy_assets (id, kind, industry_code, content, meta) VALUES ($1, 'style_example', $2, $3, $4)`,
        [crypto.randomUUID(), industryCode, ex.text, JSON.stringify({ tags: ex.tags })],
      );
    }
    return true;
  } catch (e: any) {
    if (!isMissingTable(e)) console.warn('[best-copy] 예시 저장 실패:', e?.message);
    return false;
  }
}

/** 업종 재창작 예시 목록 — 사용자 갤러리·관리자 미리보기 공용. 테이블 없으면 빈 배열. */
export async function listStyleExamples(industryCode: string): Promise<StyleExample[]> {
  try {
    const r = await pool.query(
      `SELECT id, content, meta FROM best_copy_assets
       WHERE kind = 'style_example' AND industry_code = $1
       ORDER BY created_at ASC LIMIT 6`,
      [industryCode],
    );
    return r.rows.map((row: any) => ({
      id: row.id,
      text: row.content,
      tags: Array.isArray(row.meta?.tags) ? row.meta.tags : [],
    }));
  } catch (e: any) {
    if (!isMissingTable(e)) console.warn('[best-copy] 예시 조회 실패(빈 결과):', e?.message);
    return [];
  }
}
