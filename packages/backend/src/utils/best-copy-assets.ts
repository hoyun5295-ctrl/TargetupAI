// best-copy-assets.ts — 베스트 문안 진화 자산 CT (2026-07-04 설계: specs/2026-07-04-best-copy-evolution-design.md)
//   ① 시드 사용 기록/근사 성과 집계(best_copy_seed_usage)
//   ② 업종 승리 공식·AI 재창작 예시 저장(best_copy_assets — kind='formula'|'style_example')
//   ③ 유사도 가드(jaccard3) — 재창작 예시가 시드 원문과 닮지 않았는지 검사
//   테이블 미생성(42P01) = 조용히 degrade(기록 skip·조회 빈 결과) — 배포 순서 자유.
import crypto from 'crypto';
import pool from '../config/database';
import { getTenantRef } from './training-logger';
import { appendChains, buildSkeletonContent, type SkeletonChain, type SkeletonChannel, type SkeletonMeta } from './dm/dm-structure-resolve';

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

// ───────────────── ★ 2026-09-05 아웃리치 실물 예시 (kind='outreach_example') ─────────────────
//   설계 = docs/2026-09-05-ai-sales-outreach-refinement-design.md §20. 행 = 예시 1개(마스킹 본문 · 머리줄 없음). channel = DM|EMAIL · industry_code = 15종.
//   ⛔ style_example과 kind를 나눈다 — style_example은 직원 갤러리(routes/ai.ts)에 노출되고 재증류가 DELETE 후 재INSERT(replaceStyleExamples)한다.
//   읽기 = 5분 캐시(생성 경로가 매 잡마다 부른다) · 쓰기 뒤 invalidate. 42P01 폴백 = 조회 빈 배열 · 쓰기 reason.

export const OUTREACH_EXAMPLE_KIND = 'outreach_example';
export type OutreachExampleChannel = 'DM' | 'EMAIL';
export interface OutreachExampleMeta {
  v: 1;
  source: { kind: 'dm' | 'email'; id: string; shortCode: string | null; title: string; companyId: string; createdBy: string | null; createdAt: string | null };
  aliases: string[];
  productNames: number;
  chars: number;
  promotedBy: string | null;
  promotedAt: string;
}
export interface OutreachExampleRow {
  id: string;
  channel: OutreachExampleChannel;
  industryCode: string;
  content: string;
  meta: OutreachExampleMeta;
  createdAt: string;
}

const OUTREACH_EXAMPLE_TTL_MS = 5 * 60 * 1000;
const OUTREACH_EXAMPLE_LIMIT = 300;
let outreachExampleCache: { at: number; rows: OutreachExampleRow[] } | null = null;

export function invalidateOutreachExampleCache(): void {
  outreachExampleCache = null;
}

/** 실물 예시 전량(최신순 · 상한 300) — 캐시 5분. 테이블 없음·오류 = 빈 배열(throw 0). */
export async function listOutreachExamples(opts?: { force?: boolean }): Promise<OutreachExampleRow[]> {
  if (!opts?.force && outreachExampleCache && Date.now() - outreachExampleCache.at < OUTREACH_EXAMPLE_TTL_MS) return outreachExampleCache.rows;
  try {
    const r = await pool.query(
      `SELECT id, channel, industry_code, content, meta, created_at FROM best_copy_assets
        WHERE kind = $1 ORDER BY created_at DESC LIMIT $2`,
      [OUTREACH_EXAMPLE_KIND, OUTREACH_EXAMPLE_LIMIT],
    );
    const rows: OutreachExampleRow[] = r.rows
      .filter((row: any) => (row.channel === 'DM' || row.channel === 'EMAIL') && typeof row.content === 'string' && row.content.trim())
      .map((row: any) => ({
        id: String(row.id),
        channel: row.channel as OutreachExampleChannel,
        industryCode: String(row.industry_code || 'etc'),
        content: String(row.content),
        meta: (row.meta && typeof row.meta === 'object' ? row.meta : { v: 1, source: { kind: 'dm', id: '', shortCode: null, title: '', companyId: '', createdBy: null, createdAt: null }, aliases: [], productNames: 0, chars: 0, promotedBy: null, promotedAt: '' }) as OutreachExampleMeta,
        createdAt: String(row.created_at),
      }));
    outreachExampleCache = { at: Date.now(), rows };
    return rows;
  } catch (e: any) {
    if (!isMissingTable(e)) console.warn('[best-copy] 실물 예시 조회 실패(빈 결과):', e?.message);
    return [];
  }
}

/** 같은 출처(dm/email id)의 예시 행 id — 중복 승격 판정. 조회 자체가 실패하면 ok:false(호출부는 저장하지 않는다 = fail-closed). */
export async function findOutreachExampleBySource(kind: 'dm' | 'email', id: string): Promise<{ ok: true; id: string | null } | { ok: false; reason: 'table_missing' | 'db_error' }> {
  try {
    const r = await pool.query(
      `SELECT id FROM best_copy_assets WHERE kind = $1 AND meta->'source'->>'kind' = $2 AND lower(meta->'source'->>'id') = lower($3) LIMIT 1`,
      [OUTREACH_EXAMPLE_KIND, kind, id],
    );
    return { ok: true, id: r.rows[0]?.id ? String(r.rows[0].id) : null };
  } catch (e: any) {
    if (isMissingTable(e)) return { ok: false, reason: 'table_missing' };
    console.warn('[best-copy] 실물 예시 출처 조회 실패:', e?.message);
    return { ok: false, reason: 'db_error' };
  }
}

/** 실물 예시 1행 append(치환 금지). is_ad는 NULL. 성공 시 캐시 무효화. */
export async function insertOutreachExample(input: {
  channel: OutreachExampleChannel; industryCode: string; content: string; meta: OutreachExampleMeta;
}): Promise<{ ok: true; id: string } | { ok: false; reason: 'table_missing' | 'db_error' }> {
  const id = crypto.randomUUID();
  try {
    await pool.query(
      `INSERT INTO best_copy_assets (id, kind, industry_code, channel, content, meta) VALUES ($1, $2, $3, $4, $5, $6::jsonb)`,
      [id, OUTREACH_EXAMPLE_KIND, input.industryCode, input.channel, input.content, JSON.stringify(input.meta)],
    );
    invalidateOutreachExampleCache();
    return { ok: true, id };
  } catch (e: any) {
    if (isMissingTable(e)) return { ok: false, reason: 'table_missing' };
    console.warn('[best-copy] 실물 예시 저장 실패:', e?.message);
    return { ok: false, reason: 'db_error' };
  }
}

/** 실물 예시 1행 삭제(kind 조건 결속 · 다른 kind는 못 지운다). 3값 — 없음·테이블 부재·오류를 구분한다(실패를 "없음"으로 접지 않는다). */
export async function deleteOutreachExample(id: string): Promise<{ ok: true } | { ok: false; reason: 'not_found' | 'table_missing' | 'db_error' }> {
  try {
    const r = await pool.query(`DELETE FROM best_copy_assets WHERE id = $1 AND kind = $2 RETURNING id`, [id, OUTREACH_EXAMPLE_KIND]);
    if (r.rows.length === 0) return { ok: false, reason: 'not_found' };
    invalidateOutreachExampleCache();
    return { ok: true };
  } catch (e: any) {
    if (isMissingTable(e)) return { ok: false, reason: 'table_missing' };
    console.warn('[best-copy] 실물 예시 삭제 실패:', e?.message);
    return { ok: false, reason: 'db_error' };
  }
}

// ───────────────── ★ 2026-09-03 참조 골격 (kind='structure') ─────────────────
//   설계 = docs/2026-09-03-reference-skeleton-learning-design.md §4·§5-7
//   행 = (industry_code, channel) 1개. meta = { v, chains, stats, perf, serving }. serving.enabled=false가 기본 — 끄면 생성 경로는 현행과 문자 단위 동일.
//   ⛔ 저장은 append(치환 금지 · 불변 8) · 조회 실패는 null(throw 0 · 불변 5) · 상한값을 저장하지 않는다(불변 6).

export const STRUCTURE_KIND = 'structure';

export interface StructureSkeletonRow {
  id: string;
  industryCode: string;
  channel: SkeletonChannel;
  content: string;
  meta: SkeletonMeta;
  createdAt: string;
}

function parseSkeletonMeta(raw: unknown): SkeletonMeta | null {
  const m = (typeof raw === 'string' ? (() => { try { return JSON.parse(raw); } catch { return null; } })() : raw) as any;
  if (!m || typeof m !== 'object' || !Array.isArray(m.chains) || !m.stats || typeof m.stats !== 'object') return null;
  return {
    v: 1,
    chains: m.chains,
    stats: m.stats,
    perf: m.perf && typeof m.perf === 'object' ? m.perf : { basis: null, n: 0, confident: false, updated_at: null },
    serving: m.serving && typeof m.serving === 'object'
      ? { enabled: m.serving.enabled === true, enabled_by: m.serving.enabled_by ?? null, enabled_at: m.serving.enabled_at ?? null }
      : { enabled: false, enabled_by: null, enabled_at: null },
  };
}

function rowToSkeleton(row: any): StructureSkeletonRow | null {
  const meta = parseSkeletonMeta(row?.meta);
  if (!meta) return null;
  return {
    id: String(row.id),
    industryCode: String(row.industry_code),
    channel: row.channel === 'EMAIL' ? 'EMAIL' : 'DM',
    content: String(row.content || ''),
    meta,
    createdAt: String(row.created_at),
  };
}

/**
 * 참조 골격 조회 — 생성 경로의 유일 입구. requireServing(기본 true)이면 serving.enabled=false는 null.
 * 테이블 부재·예외·형식 불일치 전부 null = 현행 동작(불변 5).
 */
export async function getStructureSkeleton(
  industryCode: string,
  channel: SkeletonChannel,
  opts?: { requireServing?: boolean },
): Promise<StructureSkeletonRow | null> {
  const requireServing = opts?.requireServing !== false;
  try {
    const r = await pool.query(
      `SELECT id, industry_code, channel, content, meta, created_at FROM best_copy_assets
       WHERE kind = $1 AND industry_code = $2 AND channel = $3
       ORDER BY created_at DESC LIMIT 1`,
      [STRUCTURE_KIND, industryCode, channel],
    );
    if (!r.rows.length) return null;
    const row = rowToSkeleton(r.rows[0]);
    if (!row) return null;
    if (requireServing && !row.meta.serving.enabled) return null;
    return row;
  } catch (e: any) {
    if (!isMissingTable(e)) console.warn('[best-copy] 참조 골격 조회 실패(null):', e?.message);
    return null;
  }
}

/** 채널·업종 전 행(관리자 패널용). 같은 (업종, 채널)이 여럿이면 최신 1개만. 테이블 부재 = 빈 배열. */
export async function listStructureSkeletons(): Promise<StructureSkeletonRow[]> {
  try {
    const r = await pool.query(
      `SELECT id, industry_code, channel, content, meta, created_at FROM best_copy_assets
       WHERE kind = $1 ORDER BY industry_code, channel, created_at DESC`,
      [STRUCTURE_KIND],
    );
    const out: StructureSkeletonRow[] = [];
    const seen = new Set<string>();
    for (const raw of r.rows) {
      const row = rowToSkeleton(raw);
      if (!row) continue;
      const key = `${row.industryCode}|${row.channel}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(row);
    }
    return out;
  } catch (e: any) {
    if (!isMissingTable(e)) console.warn('[best-copy] 참조 골격 목록 실패(빈 배열):', e?.message);
    return [];
  }
}

export type SaveSkeletonResult =
  | { ok: true; added: number; skippedDuplicate: number; total: number }
  | { ok: false; reason: 'table_missing' | 'db_error' | 'conflict' };

/**
 * 참조 골격 저장 = read-modify-write **append**. 같은 ref.id 무시 · stats 재계산 · serving·perf 보존 · content 재조립(순수).
 * 동시 저장 충돌은 jsonb 동등 비교(meta = $prev::jsonb)로 막고 1회 재시도. 테이블 부재 = table_missing.
 */
export async function saveStructureSkeleton(
  industryCode: string,
  channel: SkeletonChannel,
  newChains: readonly SkeletonChain[],
): Promise<SaveSkeletonResult> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const existing = await getStructureSkeleton(industryCode, channel, { requireServing: false });
      const merged = appendChains(existing?.meta, newChains);
      const content = buildSkeletonContent(merged.meta.stats, channel);
      if (existing) {
        const r = await pool.query(
          `UPDATE best_copy_assets SET content = $1, meta = $2 WHERE id = $3 AND meta = $4::jsonb`,
          [content, JSON.stringify(merged.meta), existing.id, JSON.stringify(existing.meta)],
        );
        if (r.rowCount === 1) return { ok: true, added: merged.added, skippedDuplicate: merged.skippedDuplicate, total: merged.meta.chains.length };
        continue; // 그 사이 다른 저장이 끼어들었다 — 다시 읽어 합친다
      }
      await pool.query(
        `INSERT INTO best_copy_assets (id, kind, industry_code, channel, content, meta) VALUES ($1, $2, $3, $4, $5, $6)`,
        [crypto.randomUUID(), STRUCTURE_KIND, industryCode, channel, content, JSON.stringify(merged.meta)],
      );
      return { ok: true, added: merged.added, skippedDuplicate: merged.skippedDuplicate, total: merged.meta.chains.length };
    } catch (e: any) {
      if (isMissingTable(e)) return { ok: false, reason: 'table_missing' };
      console.warn('[best-copy] 참조 골격 저장 실패:', e?.message);
      return { ok: false, reason: 'db_error' };
    }
  }
  return { ok: false, reason: 'conflict' };
}

/** 서빙 토글 — 사람이 켠다(임계 상수 0 · 불변 11). 행이 없으면 false. */
export async function setStructureServing(
  industryCode: string,
  channel: SkeletonChannel,
  enabled: boolean,
  by: string | null,
  nowIso: string,
): Promise<boolean> {
  try {
    const existing = await getStructureSkeleton(industryCode, channel, { requireServing: false });
    if (!existing) return false;
    const meta: SkeletonMeta = {
      ...existing.meta,
      serving: enabled
        ? { enabled: true, enabled_by: by, enabled_at: nowIso }
        : { enabled: false, enabled_by: null, enabled_at: null },
    };
    const r = await pool.query(`UPDATE best_copy_assets SET meta = $1 WHERE id = $2`, [JSON.stringify(meta), existing.id]);
    return r.rowCount === 1;
  } catch (e: any) {
    if (!isMissingTable(e)) console.warn('[best-copy] 참조 골격 서빙 변경 실패:', e?.message);
    return false;
  }
}
