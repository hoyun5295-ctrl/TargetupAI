/**
 * reference-skeleton-promote.ts — 참조 골격 승격 CT (슈퍼관리자 · 2026-09-03 · 설계서 §7)
 *
 * 직원 실물(dm_pages · email_campaigns)에서 **섹션 타입 순서만** 뽑아 best_copy_assets(kind='structure')에 append한다.
 * ⛔ props를 읽지 않는다 — 행에서 pages/sections를 받아도 손에 쥐는 것은 extractTypeSequence의 type 배열뿐(계약 테스트: 이 파일에 `.props` 0).
 * ⛔ 파이프라인 산출물(플래너 exec_meta.dm_id/email_campaign_id · 아웃리치 assets payload.dmId · 제목 접두 [플래너]/[영업])은 후보에서 뺀다
 *    — AI 산출이 AI 학습이 되는 자기 강화 루프 차단(LESSONS_META 23·24). 자동 승격 0.
 * ⛔ 업종은 사람이 지정한다(샘플 회사가 인비토라 companies.industry_code로 매칭되지 않는다 · 0903 실측).
 * 컬럼 실측(0903 information_schema): planner_touchpoints.exec_meta jsonb · sales_outreach_assets.kind text / payload jsonb ·
 *   dm_pages 27컬럼 · email_campaigns 26컬럼 · users.name/login_id · companies.name (SCHEMA.md).
 */
import { query } from '../config/database';
import { extractFlatSectionsFromDm } from './dm/dm-builder';
import { normalizeSectionChain } from './dm/dm-section-layout';
import { EMAIL_BLOCK_WHITELIST } from './email/email-blocks';
import { isIndustryCode } from './industry-codes';
import {
  extractTypeSequence,
  inferAuthorType,
  normalizationNotes,
  type AuthorType,
  type SkeletonChain,
  type SkeletonChannel,
} from './dm/dm-structure-resolve';
import { listStructureSkeletons, saveStructureSkeleton } from './best-copy-assets';

/** 업종 무관 초판 골격의 industry_code 값 — INDUSTRY_CODES 밖의 예약어 */
export const SKELETON_INDUSTRY_GENERAL = 'general';

export function isSkeletonIndustry(value: string | null | undefined): boolean {
  return value === SKELETON_INDUSTRY_GENERAL || isIndustryCode(value);
}

export function isSkeletonChannel(value: string | null | undefined): value is SkeletonChannel {
  return value === 'DM' || value === 'EMAIL';
}

const PIPELINE_TITLE_PREFIXES = ['[플래너]', '[영업]'];
const MIN_SECTIONS = 3;
const CANDIDATE_LIMIT_MAX = 50;

export interface PromotionCandidate {
  id: string;
  title: string;
  createdBy: string | null;
  createdAt: string;
  sectionCount: number;
  types: string[];
  inferredAuthorType: AuthorType;
  /** AI 초안을 사람이 편집한 실물(ai_prompt·ai_generated 존재) */
  aiEdited: boolean;
  alreadyPromoted: boolean;
  /** null = 승격 가능 */
  rejectReason: string | null;
}

interface SourceRow {
  id: string;
  title: string;
  created_at: string;
  created_by: string | null;
  ai_edited: boolean;
  from_planner: boolean;
  from_outreach: boolean;
  pages?: unknown;
  sections?: unknown;
}

function parseJsonMaybe(v: unknown): unknown {
  if (typeof v !== 'string') return v;
  try { return JSON.parse(v); } catch { return null; }
}

async function loadDmRows(companyId: string, limit: number, ids?: string[]): Promise<SourceRow[]> {
  const params: unknown[] = [companyId, limit];
  const idFilter = ids && ids.length ? ' AND d.id = ANY($3::uuid[])' : '';
  if (idFilter) params.push(ids);
  const r = await query(
    `SELECT d.id, d.title, d.created_at, d.pages, d.sections,
            (d.ai_prompt IS NOT NULL) AS ai_edited,
            COALESCE(u.name, u.login_id) AS created_by,
            EXISTS(SELECT 1 FROM planner_touchpoints t WHERE t.exec_meta->>'dm_id' = d.id::text) AS from_planner,
            EXISTS(SELECT 1 FROM sales_outreach_assets a WHERE a.kind = 'dm' AND a.payload->>'dmId' = d.id::text) AS from_outreach
       FROM dm_pages d
       LEFT JOIN users u ON u.id = d.created_by
      WHERE d.company_id = $1 AND d.status = 'published'${idFilter}
      ORDER BY d.created_at DESC
      LIMIT $2`,
    params,
  );
  return r.rows as SourceRow[];
}

async function loadEmailRows(companyId: string, limit: number, ids?: string[]): Promise<SourceRow[]> {
  const params: unknown[] = [companyId, limit];
  const idFilter = ids && ids.length ? ' AND e.id = ANY($3::uuid[])' : '';
  if (idFilter) params.push(ids);
  const r = await query(
    `SELECT e.id, e.name AS title, e.created_at, e.sections,
            COALESCE(e.ai_generated, false) AS ai_edited,
            COALESCE(u.name, u.login_id) AS created_by,
            EXISTS(SELECT 1 FROM planner_touchpoints t WHERE t.exec_meta->>'email_campaign_id' = e.id::text) AS from_planner,
            false AS from_outreach
       FROM email_campaigns e
       LEFT JOIN users u ON u.id = e.created_by
      WHERE e.company_id = $1 AND e.sections IS NOT NULL${idFilter}
      ORDER BY e.created_at DESC
      LIMIT $2`,
    params,
  );
  return r.rows as SourceRow[];
}

/** 행 → 타입 순서. DM은 pages 우선(extractFlatSectionsFromDm 규칙) · EMAIL은 sections. type 외에는 아무것도 꺼내지 않는다. */
function typesOfRow(row: SourceRow, channel: SkeletonChannel): string[] {
  if (channel === 'DM') {
    return extractTypeSequence(extractFlatSectionsFromDm({ pages: row.pages, sections: row.sections }));
  }
  return extractTypeSequence(parseJsonMaybe(row.sections));
}

function rejectReasonOf(row: SourceRow, types: string[], channel: SkeletonChannel): string | null {
  const title = String(row.title || '');
  if (row.from_planner || row.from_outreach || PIPELINE_TITLE_PREFIXES.some((p) => title.startsWith(p))) {
    return '플래너·AI 영업이 만든 산출물';
  }
  if (types.length < MIN_SECTIONS) return `미완성(섹션 ${MIN_SECTIONS}개 미만)`;
  if (channel === 'EMAIL') {
    const outside = types.filter((t) => !(EMAIL_BLOCK_WHITELIST as readonly string[]).includes(t));
    if (outside.length) return `이메일에서 렌더되지 않는 구성 포함(${[...new Set(outside)].join(', ')})`;
  }
  return null;
}

function toCandidate(row: SourceRow, channel: SkeletonChannel, promotedIds: Set<string>): PromotionCandidate {
  const types = typesOfRow(row, channel);
  return {
    id: String(row.id),
    title: String(row.title || ''),
    createdBy: row.created_by ? String(row.created_by) : null,
    createdAt: String(row.created_at),
    sectionCount: types.length,
    types,
    inferredAuthorType: inferAuthorType(types, channel),
    aiEdited: row.ai_edited === true,
    alreadyPromoted: promotedIds.has(String(row.id)),
    rejectReason: rejectReasonOf(row, types, channel),
  };
}

/** 채널의 모든 골격 행(업종 불문)에 이미 들어간 ref.id — "이미 올림" 표시용 */
async function promotedIdsOf(channel: SkeletonChannel): Promise<Set<string>> {
  const rows = await listStructureSkeletons();
  const out = new Set<string>();
  for (const r of rows) {
    if (r.channel !== channel) continue;
    for (const c of r.meta.chains) if (c.ref?.id) out.add(String(c.ref.id));
  }
  return out;
}

export async function listPromotionCandidates(input: {
  companyId: string;
  channel: SkeletonChannel;
  limit?: number;
}): Promise<{ company: { id: string; name: string } | null; candidates: PromotionCandidate[] }> {
  const limit = Math.max(1, Math.min(CANDIDATE_LIMIT_MAX, Number(input.limit) || CANDIDATE_LIMIT_MAX));
  const [companyRes, rows, promotedIds] = await Promise.all([
    query('SELECT id, name FROM companies WHERE id = $1', [input.companyId]),
    input.channel === 'DM' ? loadDmRows(input.companyId, limit) : loadEmailRows(input.companyId, limit),
    promotedIdsOf(input.channel),
  ]);
  const company = companyRes.rows[0] ? { id: String(companyRes.rows[0].id), name: String(companyRes.rows[0].name || '') } : null;
  return { company, candidates: rows.map((r) => toCandidate(r, input.channel, promotedIds)) };
}

export interface PromoteItem {
  id: string;
  authorTypeOverride?: AuthorType | null;
}

export type PromoteResult =
  | {
      ok: true;
      added: number;
      skippedDuplicate: number;
      total: number;
      skipped: Array<{ id: string; reason: string }>;
      /** 정규화 예고 — DM만(이메일은 화이트리스트 검사뿐). 자동 보정을 조용히 하지 않는다 */
      previews: Array<{ id: string; title: string; notes: string[] }>;
    }
  | { ok: false; reason: 'table_missing' | 'db_error' | 'conflict' | 'nothing_to_promote'; skipped: Array<{ id: string; reason: string }> };

export async function promoteReferenceSkeleton(input: {
  companyId: string;
  channel: SkeletonChannel;
  industryCode: string;
  items: PromoteItem[];
  promotedBy: string | null;
  nowIso: string;
}): Promise<PromoteResult> {
  const ids = [...new Set(input.items.map((it) => String(it.id)).filter(Boolean))];
  const skipped: Array<{ id: string; reason: string }> = [];
  if (ids.length === 0) return { ok: false, reason: 'nothing_to_promote', skipped };

  // 화면을 믿지 않는다 — id 목록으로 다시 읽고 같은 게이트를 다시 통과시킨다.
  const rows = input.channel === 'DM'
    ? await loadDmRows(input.companyId, CANDIDATE_LIMIT_MAX, ids)
    : await loadEmailRows(input.companyId, CANDIDATE_LIMIT_MAX, ids);
  const byId = new Map(rows.map((r) => [String(r.id), r]));
  const overrides = new Map(input.items.map((it) => [String(it.id), it.authorTypeOverride || null]));
  const promotedIds = await promotedIdsOf(input.channel);

  const chains: SkeletonChain[] = [];
  const previews: Array<{ id: string; title: string; notes: string[] }> = [];
  for (const id of ids) {
    const row = byId.get(id);
    if (!row) { skipped.push({ id, reason: '이 회사의 발행된 실물이 아닙니다' }); continue; }
    const cand = toCandidate(row, input.channel, promotedIds);
    if (cand.rejectReason) { skipped.push({ id, reason: cand.rejectReason }); continue; }
    const override = overrides.get(id);
    const authorType: AuthorType = override === 'media' || override === 'catalog' ? override : cand.inferredAuthorType;
    chains.push({
      seq: cand.types as SkeletonChain['seq'],
      author_type: authorType,
      author_type_source: override ? 'human' : 'auto',
      src: cand.aiEdited ? 'human_edited' : 'human',
      ref: {
        kind: input.channel === 'DM' ? 'dm' : 'email',
        id,
        promoted_at: input.nowIso,
        promoted_by: input.promotedBy,
      },
    });
    if (input.channel === 'DM') {
      const notes = normalizationNotes(cand.types, normalizeSectionChain(cand.types as SkeletonChain['seq']));
      if (notes.length) previews.push({ id, title: cand.title, notes });
    }
  }
  if (chains.length === 0) return { ok: false, reason: 'nothing_to_promote', skipped };

  const saved = await saveStructureSkeleton(input.industryCode, input.channel, chains);
  if (!saved.ok) return { ok: false, reason: saved.reason, skipped };
  return { ok: true, added: saved.added, skippedDuplicate: saved.skippedDuplicate, total: saved.total, skipped, previews };
}
