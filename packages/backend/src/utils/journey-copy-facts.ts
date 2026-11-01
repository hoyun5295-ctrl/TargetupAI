/**
 * journey-copy-facts.ts — 여정 사람 값 원장(혜택 · 링크) · 근거 규칙 한 곳
 *
 * ★ 2026-11-01 여정 재발 방지 설계 B1-3(docs/2026-11-01-journey-recurrence-prevention-design.md · Codex 설계 6R approve)
 *   Harold 1101 「내가 분명히 혜택을 넣었는데도 혜택은 직접 넣으라고 여전히 나온다 · 마지막엔 10% 할인쿠폰 · 위엔 직접입력해주세요」.
 *   원인 = 사람이 정한 혜택 · 링크가 여정 어디에도 남지 않았다(생성 때 한 번 쓰고 버림) → 칸마다 다른 근거로 문안을 만들어 자리표시가 남았다.
 *   처방 = journeys.copy_facts(DDL-A) 에 사람 값을 남기고, 여정 문안을 만드는 모든 자리가 같은 근거 함수(journeyCopyGround)를 지난다.
 *
 * 쓰는 길 셋(혜택 · 링크 따로 · 한쪽만 쓰면 다른 쪽은 그대로): 생성(질문표 · by=question) · 채우기(by=fill) · 승인(배포 2 · by=approve).
 * ⛔ 본문에서 저절로 뽑지 않는다(Codex 설계 1R #4) — 칸 저장 요청의 어떤 표시도 사람 작성의 증거가 아니다.
 * 칸이 없으면(DDL 전) 읽기 = unset(옛 동작) · 쓰기 라우트 = 503 DB_MIGRATION_PENDING(CLAUDE.md db_alter_safety_net).
 */
import { query } from '../config/database';
import { wholeLink } from './voice-form-slots';

export type CopyFactsBy = 'question' | 'fill' | 'approve';
export interface CopyFactBenefit { text: string; by: CopyFactsBy; at: string }
export type CopyFactLink = { url: string; by: CopyFactsBy; at: string } | { omit: true; by: CopyFactsBy; at: string };
export interface JourneyCopyFacts {
  /** null = 아직 안 정함(옛 근거) · [] = 사람이 「혜택 없음」으로 정함 · 1개 이상 = 정함 */
  benefits: CopyFactBenefit[] | null;
  /** null = 아직 안 정함 · { url } = 정함 · { omit } = 링크 뺌 */
  link: CopyFactLink | null;
}

export const COPY_FACTS_BENEFIT_MAX = 5;
export const COPY_FACTS_BENEFIT_TEXT_MAX = 200;

const BYS: readonly CopyFactsBy[] = ['question', 'fill', 'approve'];

/** (순수) jsonb 값 → 원장(못 읽는 칸 = 안 정함) */
export function parseCopyFacts(raw: unknown): JourneyCopyFacts {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, any>;
  const by = (v: unknown): CopyFactsBy => (BYS.includes(v as CopyFactsBy) ? (v as CopyFactsBy) : 'question');
  let benefits: CopyFactBenefit[] | null = null;
  if (Array.isArray(o.benefits)) {
    benefits = o.benefits
      .map((b: any) => ({ text: String(b?.text ?? '').trim().slice(0, COPY_FACTS_BENEFIT_TEXT_MAX), by: by(b?.by), at: String(b?.at ?? '') }))
      .filter((b: CopyFactBenefit) => b.text)
      .slice(0, COPY_FACTS_BENEFIT_MAX);
  }
  let link: CopyFactLink | null = null;
  if (o.link && typeof o.link === 'object') {
    if (o.link.omit === true) link = { omit: true, by: by(o.link.by), at: String(o.link.at ?? '') };
    else {
      const url = wholeLink(o.link.url);
      if (url) link = { url, by: by(o.link.by), at: String(o.link.at ?? '') };
    }
  }
  return { benefits, link };
}

export interface CopyFactsView {
  benefit: { state: 'unset' | 'none' | 'set'; ground: string };
  link: { state: 'unset' | 'omit' | 'set'; url: string | null };
}

/** (순수) 원장 → 상태 · 근거 글 */
export function journeyCopyFacts(facts: JourneyCopyFacts | null | undefined): CopyFactsView {
  const f = facts || { benefits: null, link: null };
  const benefit = f.benefits === null
    ? { state: 'unset' as const, ground: '' }
    : f.benefits.length === 0
      ? { state: 'none' as const, ground: '' }
      : { state: 'set' as const, ground: f.benefits.map((b) => b.text).join('\n') };
  const link = f.link === null
    ? { state: 'unset' as const, url: null }
    : 'omit' in f.link ? { state: 'omit' as const, url: null } : { state: 'set' as const, url: f.link.url };
  return { benefit, link };
}

/**
 * (순수) 여정 문안 혜택 근거 — 여정 생산자 전부가 이 함수 하나를 부른다(규칙 두 벌 없음 · 배포 2 finishCopy 도 이 함수).
 *   쓰기 모드(생성 · 칸 넣기 · 다음 칸 · 날짜 칸) = set → 원장 글 · none → '' · unset → 옛 근거(legacy)
 *   고치기 모드(다듬기 · 편집 · 재작성) = 위 + 지금 본문(사람이 칸에 직접 친 혜택은 그 칸을 다시 고칠 때 산다)
 */
export function journeyCopyGround(facts: JourneyCopyFacts | null | undefined, mode: 'write' | 'fix', legacy: string, current = ''): string {
  const v = journeyCopyFacts(facts);
  const base = v.benefit.state === 'set' ? v.benefit.ground : v.benefit.state === 'none' ? '' : String(legacy || '');
  return mode === 'fix' ? [base, String(current || '')].filter((x) => x.trim()).join('\n') : base;
}

// ── 칸 유무(DDL-A 전 = unset) · 참은 기억 · 거짓은 5분 뒤 다시(lineageColumnsReady 규약) ──
let ready = false;
let absentUntil = 0;
let checking: Promise<boolean> | null = null;
const RECHECK_MS = 5 * 60 * 1000;
export async function copyFactsColumnReady(): Promise<boolean> {
  if (ready) return true;
  if (Date.now() < absentUntil) return false;
  if (!checking) {
    checking = (async () => {
      try {
        const r = await query(
          `SELECT COUNT(*)::int AS n FROM information_schema.columns WHERE table_name = 'journeys' AND column_name = 'copy_facts'`,
        );
        const ok = Number(r.rows[0]?.n || 0) === 1;
        if (ok) ready = true;
        else absentUntil = Date.now() + RECHECK_MS;
        return ok;
      } finally {
        checking = null;
      }
    })();
  }
  return checking;
}

/** 여정 원장 읽기(칸이 없거나 여정이 없으면 안 정함) */
export async function readJourneyCopyFacts(companyId: string, journeyId: string): Promise<JourneyCopyFacts> {
  if (!(await copyFactsColumnReady())) return { benefits: null, link: null };
  const r = await query(`SELECT copy_facts FROM journeys WHERE id = $1::uuid AND company_id = $2::uuid`, [journeyId, companyId]);
  return parseCopyFacts(r.rows[0]?.copy_facts);
}

export interface CopyFactsPatch {
  /** 문자열 배열 = 정함([] = 혜택 없음) · undefined = 손대지 않음 */
  benefits?: string[];
  /** 주소 = 정함 · 'omit' = 링크 뺌 · undefined = 손대지 않음 */
  link?: string | 'omit';
}

/** (순수) 입력 → 저장할 조각(혜택 · 링크 각각 · 못 쓰는 링크 = 거절) */
export function buildCopyFactsPatch(patch: CopyFactsPatch, by: CopyFactsBy, at = new Date().toISOString()): { benefits?: CopyFactBenefit[]; link?: CopyFactLink; error?: string } {
  const out: { benefits?: CopyFactBenefit[]; link?: CopyFactLink; error?: string } = {};
  if (patch.benefits !== undefined) {
    out.benefits = patch.benefits
      .map((t) => String(t ?? '').trim().slice(0, COPY_FACTS_BENEFIT_TEXT_MAX))
      .filter(Boolean)
      .slice(0, COPY_FACTS_BENEFIT_MAX)
      .map((text) => ({ text, by, at }));
  }
  if (patch.link !== undefined) {
    if (patch.link === 'omit') out.link = { omit: true, by, at };
    else {
      const url = wholeLink(patch.link);
      if (!url) return { error: '링크 주소를 확인해 주세요(예: https://shop.com/event).' };
      out.link = { url, by, at };
    }
  }
  return out;
}

type SqlRunner = (text: string, params?: any[]) => Promise<any>;

/**
 * 원장 쓰기 — 혜택 · 링크를 **따로** 덮는다(한쪽만 쓰면 다른 쪽은 그대로). 칸이 없으면 PG 가 column … does not exist 를 던진다
 * → 쓰는 라우트가 503 DB_MIGRATION_PENDING 으로 돌린다. 생성 길(질문표)은 칸이 있을 때만 부른다(없으면 unset = 옛 동작).
 */
export async function writeJourneyCopyFacts(run: SqlRunner, journeyId: string, patch: { benefits?: CopyFactBenefit[]; link?: CopyFactLink }): Promise<void> {
  if (patch.benefits === undefined && patch.link === undefined) return;
  let expr = `COALESCE(copy_facts, '{}'::jsonb)`;
  const params: any[] = [journeyId];
  if (patch.benefits !== undefined) { params.push(JSON.stringify(patch.benefits)); expr = `jsonb_set(${expr}, '{benefits}', $${params.length}::jsonb)`; }
  if (patch.link !== undefined) { params.push(JSON.stringify(patch.link)); expr = `jsonb_set(${expr}, '{link}', $${params.length}::jsonb)`; }
  await run(`UPDATE journeys SET copy_facts = ${expr} WHERE id = $1::uuid`, params);
}

/** (순수) 혜택 자리표시 — 시스템이 실제로 심는 표기(「혜택」 + 「직접 수정 · 작성해주세요」 · 화면 message-placeholders 와 같은 꼴) */
const BENEFIT_SPOT_SOURCE = '\\[[^\\[\\]\\n]*혜택[^\\[\\]\\n]*직접\\s*(?:수정|작성)해\\s*주세요[^\\[\\]\\n]*\\]';
export function hasBenefitSpot(text: string | null | undefined): boolean {
  return new RegExp(BENEFIT_SPOT_SOURCE).test(String(text || ''));
}
export function fillBenefitSpots(text: string | null | undefined, benefit: string): string {
  const src = String(text || '');
  const v = String(benefit || '').trim();
  return v ? src.replace(new RegExp(BENEFIT_SPOT_SOURCE, 'g'), () => v) : src;
}
