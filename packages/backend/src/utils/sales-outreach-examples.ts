/**
 * ★ 2026-09-05 AI 영업 아웃리치 : 실물 예시 학습 CT (DB 층 · 베스트 구성 화면이 부른다)
 * 설계 = docs/2026-09-05-ai-sales-outreach-refinement-design.md §20
 *
 * 흐름 = 단축코드 붙여넣기 → resolve(내부 전용 회사 안에서 dm_pages.short_code · 수신자 토큰 코드 둘 다) → 같은 회사 이메일 후보(브랜드명 일치 제안)
 *      → promote(마스킹 CT → 위생 검사 → best_copy_assets kind='outreach_example' append) → 생성 경로가 DB+seed 합산 원천을 읽는다.
 *
 * 규율:
 * - 회사 = 호출부가 넘긴 companyId 하나(라우트가 ENV OUTREACH_COMPANY_ID로 고정). 다른 회사 행은 읽지 않는다.
 * - 마스킹·위생은 sales-outreach-exemplar-mask(순수)가 소유하고, 이 파일은 읽기·판정·저장만 한다. 위생 실패 = 저장 거부(사유 반환).
 * - 중복 = 같은 출처 id(meta.source.id) 1건. 같은 실물을 두 번 올려도 행이 늘지 않는다.
 * - 이 파일은 reference-skeleton-promote(props 미열람 계약)와 별도다 — 여기는 문구를 읽는 것이 목적이다.
 */
import { query } from '../config/database';
import { extractFlatSectionsFromDm } from './dm/dm-builder';
import { isIndustryCode } from './industry-codes';
import {
  listOutreachExamples, insertOutreachExample, deleteOutreachExample, findOutreachExampleBySource,
  type OutreachExampleChannel, type OutreachExampleMeta, type OutreachExampleRow,
} from './best-copy-assets';
import { deriveBrandAliases, collectProductNames, buildExemplarBody, checkExemplarHygiene } from './sales-outreach-exemplar-mask';
import { exemplarSourceFromRows, mergeExemplarSources, exemplarGroupOf } from './sales-outreach-exemplars';
import { OUTREACH_EXEMPLAR_SEED } from './sales-outreach-exemplar-seed';

const MIN_SECTIONS = 3;
const PIPELINE_TITLE_PREFIXES = ['[플래너]', '[영업]'];
const EMAIL_CANDIDATE_DAYS = 120;
const EMAIL_CANDIDATE_LIMIT = 100;
export const OUTREACH_EXAMPLE_CODE_MAX = 60;

// ===== 순수 헬퍼 (export = 테스트 대상) =====

/** 붙여넣은 한 줄 → 단축코드. URL(hlj.kr/xxx · /api/dm/v/dm-xxx) · `dm-` 접두 · 공백을 걷고 대소문자는 **보존**한다(base62 · varchar 등가 비교). 형식 밖 = null. */
export function normalizeShortCodeInput(raw: string): string | null {
  let s = String(raw || '').trim();
  if (!s) return null;
  s = s.replace(/^https?:\/\//i, '').replace(/^hlj\.kr\//i, '').replace(/^[^/]*\/api\/dm\/v\/(s\/)?/i, '').replace(/^dm-/, '');
  s = s.split(/[?#]/)[0].replace(/\/+$/, '');
  if (s.includes('/')) s = s.slice(s.lastIndexOf('/') + 1);
  s = s.replace(/^dm-/, '').trim();
  return /^[0-9A-Za-z]{6,12}$/.test(s) ? s : null;
}

/** 여러 줄·쉼표·공백 구분 목록 → 정규화·중복 제거(순서 보존) · 상한. 한글 라벨·직원 표기 같은 비코드 토큰은 조용히 넘기고, 코드처럼 생겼는데 틀린 것만 invalid로 보고한다. */
export function parseCodeList(text: string, cap = OUTREACH_EXAMPLE_CODE_MAX): { codes: string[]; invalid: string[] } {
  const codes: string[] = [];
  const invalid: string[] = [];
  const seen = new Set<string>();
  for (const part of String(text || '').split(/[\s,;]+/)) {
    const p = part.trim();
    if (!p) continue;
    const c = normalizeShortCodeInput(p);
    if (!c) { if (/^[A-Za-z0-9\-_/.:?=&]+$/.test(p)) invalid.push(p.slice(0, 40)); continue; }
    if (seen.has(c)) continue;
    seen.add(c);
    codes.push(c);
    if (codes.length >= cap) break;
  }
  return { codes, invalid };
}

/** 제목 → 브랜드 키(직원 표기·공백·기호 제거 · 소문자) : 이메일 제안 매칭용 */
export function brandKeyOf(title: string): string {
  return String(title || '')
    .replace(/\([가-힣]{2,4}\d{0,2}\)/g, ' ')
    .replace(/[()\[\]{}·|,/.\-_:&x×]+/gi, ' ')
    .replace(/\s+/g, '')
    .toLowerCase();
}

/** DM 제목과 이메일 이름·제목이 같은 브랜드를 가리키는가(앞 2자 이상 토큰 포함 관계) */
export function suggestEmailForDm(dmTitle: string, emails: ReadonlyArray<{ id: string; name: string; subject?: string | null }>): string | null {
  const dmKey = brandKeyOf(dmTitle);
  if (!dmKey) return null;
  const tokens = String(dmTitle || '').replace(/\([가-힣]{2,4}\d{0,2}\)/g, ' ').split(/[\s·|,/()]+/).map((t) => t.trim().toLowerCase()).filter((t) => t.length >= 2);
  const head = tokens[0] || dmKey.slice(0, 2);
  let best: { id: string; score: number } | null = null;
  for (const e of emails) {
    const key = brandKeyOf(`${e.name || ''} ${e.subject || ''}`);
    let score = 0;
    if (key.includes(dmKey) || dmKey.includes(brandKeyOf(e.name || '').slice(0, Math.max(2, brandKeyOf(e.name || '').length)))) score += 3;
    if (head && key.includes(head)) score += 2;
    for (const t of tokens.slice(1)) if (key.includes(t)) score += 1;
    if (score > 0 && (!best || score > best.score)) best = { id: e.id, score };
  }
  return best && best.score >= 2 ? best.id : null;
}

function rejectReasonOf(title: string, sectionCount: number): string | null {
  if (PIPELINE_TITLE_PREFIXES.some((p) => String(title || '').startsWith(p))) return '플래너·AI 영업이 만든 산출물';
  if (sectionCount < MIN_SECTIONS) return `미완성(섹션 ${MIN_SECTIONS}개 미만)`;
  return null;
}

// ===== 조회 =====

export interface ResolvedDm {
  code: string;
  /** 같은 DM을 가리킨 다른 코드(수신자 링크 여러 개를 붙여넣은 경우) */
  otherCodes: string[];
  id: string;
  title: string;
  storeName: string | null;
  createdBy: string | null;
  createdAt: string;
  sectionCount: number;
  alreadyPromoted: boolean;
  rejectReason: string | null;
  /** 마스킹 미리보기(머리줄 없음) */
  preview: string;
  aliases: string[];
  suggestedEmailId: string | null;
}
export interface EmailCandidate {
  id: string;
  name: string;
  subject: string | null;
  createdBy: string | null;
  createdAt: string;
  sectionCount: number;
  alreadyPromoted: boolean;
  rejectReason: string | null;
  preview: string;
  aliases: string[];
}

interface DmRow { code: string; id: string; title: string; store_name: string | null; created_by: string | null; created_at: string; pages: unknown; sections: unknown }
interface EmailRow { id: string; name: string; subject: string | null; created_by: string | null; created_at: string; sections: unknown }

function parseJsonMaybe(v: unknown): unknown {
  if (typeof v !== 'string') return v;
  try { return JSON.parse(v); } catch { return null; }
}

async function companyNameOf(companyId: string): Promise<string | null> {
  const r = await query('SELECT name FROM companies WHERE id = $1', [companyId]);
  return r.rows[0]?.name ? String(r.rows[0].name) : null;
}

async function loadDmRowsByCodes(companyId: string, codes: string[]): Promise<DmRow[]> {
  if (codes.length === 0) return [];
  const direct = await query(
    `SELECT d.short_code AS code, d.id, d.title, d.store_name, d.created_at, d.pages, d.sections,
            COALESCE(u.name, u.login_id) AS created_by
       FROM dm_pages d LEFT JOIN users u ON u.id = d.created_by
      WHERE d.company_id = $1 AND d.short_code = ANY($2)`,
    [companyId, codes],
  );
  const found = new Set(direct.rows.map((r: any) => String(r.code)));
  const rest = codes.filter((c) => !found.has(c));
  let viaToken: any[] = [];
  if (rest.length) {
    const r = await query(
      `SELECT t.short_code AS code, d.id, d.title, d.store_name, d.created_at, d.pages, d.sections,
              COALESCE(u.name, u.login_id) AS created_by
         FROM dm_recipient_tokens t JOIN dm_pages d ON d.id = t.dm_id LEFT JOIN users u ON u.id = d.created_by
        WHERE d.company_id = $1 AND t.short_code = ANY($2)`,
      [companyId, rest],
    );
    viaToken = r.rows;
  }
  return [...direct.rows, ...viaToken] as DmRow[];
}

async function loadEmailRows(companyId: string, ids?: string[]): Promise<EmailRow[]> {
  const params: unknown[] = [companyId, EMAIL_CANDIDATE_DAYS, EMAIL_CANDIDATE_LIMIT];
  const idFilter = ids && ids.length ? ' AND e.id = ANY($4::uuid[])' : '';
  if (idFilter) params.push(ids);
  const r = await query(
    `SELECT e.id, e.name, e.subject, e.created_at, e.sections, COALESCE(u.name, u.login_id) AS created_by
       FROM email_campaigns e LEFT JOIN users u ON u.id = e.created_by
      WHERE e.company_id = $1 AND e.sections IS NOT NULL${idFilter}
        AND e.created_at > NOW() - ($2 || ' days')::interval
      ORDER BY e.created_at DESC LIMIT $3`,
    params,
  );
  return r.rows as EmailRow[];
}

function dmSectionsOf(row: DmRow): any[] {
  return extractFlatSectionsFromDm({ pages: row.pages, sections: row.sections });
}
function emailSectionsOf(row: EmailRow): any[] {
  const s = parseJsonMaybe(row.sections);
  return Array.isArray(s) ? s : [];
}

function buildDmExample(row: DmRow, companyName: string | null, extraAliases?: readonly string[]) {
  const sections = dmSectionsOf(row);
  const aliases = deriveBrandAliases({ title: row.title, storeName: row.store_name, companyName, sections, extra: extraAliases });
  const productNames = collectProductNames(sections);
  const body = buildExemplarBody(sections, { aliases, productNames });
  return { sections, aliases, productNames, body };
}
function buildEmailExample(row: EmailRow, companyName: string | null, extraAliases?: readonly string[]) {
  const sections = emailSectionsOf(row);
  const aliases = deriveBrandAliases({ title: row.name, companyName, sections, extra: extraAliases });
  const productNames = collectProductNames(sections);
  const body = buildExemplarBody(sections, { aliases, productNames }, row.subject);
  return { sections, aliases, productNames, body };
}

/** 코드 목록 → 내부 전용 회사 안의 DM 해석 + 같은 회사 이메일 후보(제안 매칭 포함) */
export async function resolveOutreachExampleCodes(input: { companyId: string; codes: string[] }): Promise<{
  company: { id: string; name: string | null };
  resolved: Array<{ code: string; dm: ResolvedDm | null }>;
  emails: EmailCandidate[];
}> {
  const codes = Array.from(new Set(input.codes.map((c) => normalizeShortCodeInput(c)).filter((c): c is string => !!c))).slice(0, OUTREACH_EXAMPLE_CODE_MAX);
  const [companyName, dmRows, emailRows, examples] = await Promise.all([
    companyNameOf(input.companyId),
    loadDmRowsByCodes(input.companyId, codes),
    loadEmailRows(input.companyId),
    listOutreachExamples({ force: true }),
  ]);
  const promotedDm = new Set(examples.filter((e) => e.meta?.source?.kind === 'dm').map((e) => e.meta.source.id));
  const promotedEmail = new Set(examples.filter((e) => e.meta?.source?.kind === 'email').map((e) => e.meta.source.id));

  const emails: EmailCandidate[] = emailRows.map((row) => {
    const b = buildEmailExample(row, companyName);
    return {
      id: String(row.id), name: String(row.name || ''), subject: row.subject ? String(row.subject) : null,
      createdBy: row.created_by ? String(row.created_by) : null, createdAt: String(row.created_at),
      sectionCount: b.sections.length, alreadyPromoted: promotedEmail.has(String(row.id)),
      rejectReason: rejectReasonOf(String(row.name || ''), b.sections.length),
      preview: b.body, aliases: b.aliases,
    };
  });
  const byCode = new Map(dmRows.map((r) => [String(r.code), r] as const));
  // 같은 DM을 가리키는 코드는 1행으로 합친다(수신자 링크 여러 개 붙여넣기) — 화면 키·체크 상태가 겹치지 않게
  const seenDm = new Map<string, string[]>();
  const resolved: Array<{ code: string; dm: ResolvedDm | null }> = [];
  for (const code of codes) {
    const row = byCode.get(code);
    if (!row) { resolved.push({ code, dm: null }); continue; }
    const dmId = String(row.id);
    if (seenDm.has(dmId)) { seenDm.get(dmId)!.push(code); continue; }
    const others: string[] = [];
    seenDm.set(dmId, others);
    const b = buildDmExample(row, companyName);
    const dm: ResolvedDm = {
      code, otherCodes: others, id: dmId, title: String(row.title || ''), storeName: row.store_name ? String(row.store_name) : null,
      createdBy: row.created_by ? String(row.created_by) : null, createdAt: String(row.created_at),
      sectionCount: b.sections.length, alreadyPromoted: promotedDm.has(String(row.id)),
      rejectReason: rejectReasonOf(String(row.title || ''), b.sections.length),
      preview: b.body, aliases: b.aliases,
      suggestedEmailId: suggestEmailForDm(String(row.title || ''), emails.filter((e) => !e.rejectReason)),
    };
    resolved.push({ code, dm });
  }
  return { company: { id: input.companyId, name: companyName }, resolved, emails };
}

// ===== 승격 =====

export interface PromoteExampleItem {
  kind: 'dm' | 'email';
  id: string;
  industryCode: string;
  /** 사람이 더한 별칭(선택) */
  aliasesExtra?: string[] | null;
}

export type PromoteExamplesResult =
  | { ok: true; added: number; skipped: Array<{ kind: string; id: string; reason: string }>; previews: Array<{ kind: string; id: string; rowId: string; title: string; chars: number; group: string }> }
  | { ok: false; reason: 'table_missing' | 'nothing_to_promote'; skipped: Array<{ kind: string; id: string; reason: string }> };

/**
 * 실물 → 예시 승격. 화면을 믿지 않고 게이트(회사·미완성·파이프라인·중복·위생)를 서버가 다시 본다.
 * 저장은 행 append. 위생 실패는 저장하지 않고 사유를 돌려준다(사람이 별칭을 더해 다시 올릴 수 있다).
 */
export async function promoteOutreachExamples(input: {
  companyId: string;
  items: PromoteExampleItem[];
  promotedBy: string | null;
  nowIso: string;
}): Promise<PromoteExamplesResult> {
  const skipped: Array<{ kind: string; id: string; reason: string }> = [];
  const previews: Array<{ kind: string; id: string; rowId: string; title: string; chars: number; group: string }> = [];
  const items = input.items
    .filter((it) => it && (it.kind === 'dm' || it.kind === 'email') && /^[0-9a-f-]{36}$/i.test(String(it.id || '')))
    .map((it) => ({ ...it, id: String(it.id).toLowerCase(), aliasesExtra: (it.aliasesExtra || []).map((a) => String(a).trim().slice(0, 40)).filter(Boolean).slice(0, 10) }));
  if (items.length === 0) return { ok: false, reason: 'nothing_to_promote', skipped };
  const companyName = await companyNameOf(input.companyId);
  const dmIds = items.filter((i) => i.kind === 'dm').map((i) => i.id);
  const emailIds = items.filter((i) => i.kind === 'email').map((i) => i.id);
  const [dmRows, emailRows] = await Promise.all([
    dmIds.length ? query(
      `SELECT d.short_code AS code, d.id, d.title, d.store_name, d.created_at, d.pages, d.sections, COALESCE(u.name, u.login_id) AS created_by
         FROM dm_pages d LEFT JOIN users u ON u.id = d.created_by WHERE d.company_id = $1 AND d.id = ANY($2::uuid[])`,
      [input.companyId, dmIds],
    ).then((r) => r.rows as DmRow[]) : Promise.resolve([] as DmRow[]),
    emailIds.length ? loadEmailRows(input.companyId, emailIds) : Promise.resolve([] as EmailRow[]),
  ]);
  const dmById = new Map(dmRows.map((r) => [String(r.id), r] as const));
  const emailById = new Map(emailRows.map((r) => [String(r.id), r] as const));

  let added = 0;
  let tableMissing = false;
  for (const it of items) {
    if (!isIndustryCode(it.industryCode)) { skipped.push({ kind: it.kind, id: it.id, reason: '업종을 선택해주세요.' }); continue; }
    const row = it.kind === 'dm' ? dmById.get(it.id) : emailById.get(it.id);
    if (!row) { skipped.push({ kind: it.kind, id: it.id, reason: '내부 전용 회사에서 찾을 수 없습니다.' }); continue; }
    const title = it.kind === 'dm' ? String((row as DmRow).title || '') : String((row as EmailRow).name || '');
    const built = it.kind === 'dm'
      ? buildDmExample(row as DmRow, companyName, it.aliasesExtra || undefined)
      : buildEmailExample(row as EmailRow, companyName, it.aliasesExtra || undefined);
    const reject = rejectReasonOf(title, built.sections.length);
    if (reject) { skipped.push({ kind: it.kind, id: it.id, reason: reject }); continue; }
    const hygiene = checkExemplarHygiene(built.body, built.aliases);
    if (!hygiene.ok) { skipped.push({ kind: it.kind, id: it.id, reason: `마스킹 검사 실패: ${hygiene.violations.join(' · ')}` }); continue; }
    const rowId = String(row.id).toLowerCase();
    const dup = await findOutreachExampleBySource(it.kind, rowId);
    if (!dup.ok) {
      // 중복 판정을 못 하면 저장하지 않는다(fail-closed) — 테이블 부재는 회차 중단
      if (dup.reason === 'table_missing') { tableMissing = true; break; }
      skipped.push({ kind: it.kind, id: it.id, reason: '중복 확인에 실패해 저장하지 않았습니다. 다시 시도해주세요.' });
      continue;
    }
    if (dup.id) { skipped.push({ kind: it.kind, id: it.id, reason: '이미 올린 실물입니다.' }); continue; }
    const channel: OutreachExampleChannel = it.kind === 'dm' ? 'DM' : 'EMAIL';
    const meta: OutreachExampleMeta = {
      v: 1,
      source: {
        kind: it.kind, id: rowId, shortCode: it.kind === 'dm' ? String((row as DmRow).code || '') || null : null, title,
        companyId: input.companyId, createdBy: row.created_by ? String(row.created_by) : null, createdAt: row.created_at ? String(row.created_at) : null,
      },
      aliases: built.aliases,
      productNames: built.productNames.length,
      chars: built.body.length,
      promotedBy: input.promotedBy,
      promotedAt: input.nowIso,
    };
    const saved = await insertOutreachExample({ channel, industryCode: it.industryCode, content: built.body, meta });
    if (!saved.ok) {
      if (saved.reason === 'table_missing') { tableMissing = true; break; }
      skipped.push({ kind: it.kind, id: it.id, reason: '저장에 실패했습니다.' });
      continue;
    }
    added++;
    previews.push({ kind: it.kind, id: it.id, rowId: saved.id, title, chars: built.body.length, group: exemplarGroupOf(it.industryCode) });
  }
  if (tableMissing) return { ok: false, reason: 'table_missing', skipped };
  if (added === 0) return { ok: false, reason: 'nothing_to_promote', skipped };
  return { ok: true, added, skipped, previews };
}

/** 관리 목록(캐시 무시 · 최신순) */
export async function listOutreachExamplesForAdmin(): Promise<OutreachExampleRow[]> {
  return listOutreachExamples({ force: true });
}

export async function removeOutreachExample(id: string): Promise<{ ok: true } | { ok: false; reason: 'not_found' | 'table_missing' | 'db_error' }> {
  return deleteOutreachExample(id);
}

/** 생성 경로 원천 = DB(5분 캐시) 앞 + seed 뒤 · 같은 본문 1번. DB가 비거나 실패해도 seed로 돈다(무후퇴). */
export async function loadOutreachExemplarSource(): Promise<Record<string, readonly string[]>> {
  const rows = await listOutreachExamples();
  return mergeExemplarSources(exemplarSourceFromRows(rows), OUTREACH_EXEMPLAR_SEED);
}
