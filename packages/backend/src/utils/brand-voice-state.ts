/**
 * 브랜드 보이스 학습 상태 행 CT (★ 2026-10-28 AI 메모리 설계 K7-1 · K5-4 · K9-3 · I10 · I11 · docs/2026-10-28-ai-memory-brand-voice-design.md)
 *
 * 행 = ai_company_memory(memory_type='brand_voice_state', memory_key='main') · DDL 0.
 * 세대값 gen = 진행 중 학습을 무효화하는 모든 쓰기(대표 문안 추가 · 고침 · 삭제 · 초기화 · 직접 정정 · AI 에게 다시 맡기기)마다 +1.
 * 추출 · 견본 저장 · 확인 · 모든 쓰기 = 같은 상태 행을 SELECT … FOR UPDATE 로 잠근 트랜잭션 안(R12 · 판정과 쓰기 같은 잠금).
 * 전이는 순수 함수(시험 = 세대 전이 표) · DB 는 잠금 · 읽기 · 쓰기 셋뿐.
 */
import type { PoolClient } from 'pg';
import { query } from '../config/database';
import type { BrandVoiceKind } from './brand-voice-prompt';

/** 확인된 묶음의 문안 하나 뼈대(글 해시가 지금 문안과 맞을 때만 쓴다) */
export interface ReviewedSkeleton { hash: string; text: string }
/** 확인된 묶음의 성격별 문구 칸(빈출 표현 · CTA · 서명 · 인사 · 어미 예시 · 칸 친 뒤) */
export interface ReviewedPhrases {
  frequent_expressions?: string[];
  cta_patterns?: string[];
  signature?: string;
  greeting_pattern?: string;
  sentence_ending_examples?: string[];
}

export interface BrandVoiceState {
  gen: number;
  /** 지금 가이드라인이 유효한 세대(추출 성공 · 학습 완료 뒤 직접 정정) */
  guidelineGen: number;
  /** 확인 대기 추출본(유효한 마지막 추출) · 초기화가 비운다 */
  extract: { gen: number; at: string } | null;
  /** 마지막 추출 실패(그 단계가 성공하거나 세대가 바뀌면 지운다) */
  extractError: { gen: number; code: StageErrorCode; at: string } | null;
  /** 사람이 확인한 묶음 = 생성 프롬프트에 들어가는 AI 추출 글자의 전부(I16) */
  reviewed: {
    extractGen: number;
    at: string;
    by: string | null;
    skeletons: Record<string, ReviewedSkeleton>;
    phrases: Partial<Record<BrandVoiceKind, ReviewedPhrases>>;
  } | null;
  sample: { gen: number; at: string; error: StageErrorCode | null; result: unknown | null } | null;
}

export type StageErrorCode = 'credit' | 'ai' | 'parse' | 'stale';

export const EMPTY_STATE: BrandVoiceState = { gen: 0, guidelineGen: 0, extract: null, extractError: null, reviewed: null, sample: null };

export function parseState(raw: unknown): BrandVoiceState {
  let v: any = raw;
  if (typeof raw === 'string') { try { v = JSON.parse(raw); } catch { v = null; } }
  if (!v || typeof v !== 'object') return { ...EMPTY_STATE };
  const int = (x: unknown) => (Number.isInteger(Number(x)) && Number(x) >= 0 ? Number(x) : 0);
  return {
    gen: int(v.gen),
    guidelineGen: int(v.guidelineGen),
    extract: v.extract && Number.isInteger(v.extract.gen) ? { gen: v.extract.gen, at: String(v.extract.at || '') } : null,
    extractError: v.extractError && Number.isInteger(v.extractError.gen) ? v.extractError : null,
    reviewed: v.reviewed && Number.isInteger(v.reviewed.extractGen) ? {
      extractGen: v.reviewed.extractGen,
      at: String(v.reviewed.at || ''),
      by: v.reviewed.by ?? null,
      skeletons: v.reviewed.skeletons && typeof v.reviewed.skeletons === 'object' ? v.reviewed.skeletons : {},
      phrases: v.reviewed.phrases && typeof v.reviewed.phrases === 'object' ? v.reviewed.phrases : {},
    } : null,
    sample: v.sample && Number.isInteger(v.sample.gen) ? { gen: v.sample.gen, at: String(v.sample.at || ''), error: v.sample.error ?? null, result: v.sample.result ?? null } : null,
  };
}

const now = () => new Date().toISOString();

// ─────────────── 전이(순수) ───────────────

/** 대표 문안 추가 · 고침 · 삭제 = gen + 1(옛 가이드라인은 다음 학습 전까지 그대로 쓰인다 · 학습 미완) */
export function onMessageWrite(s: BrandVoiceState): BrandVoiceState {
  return { ...s, gen: s.gen + 1, extractError: null };
}

/** 직접 정정 · AI 에게 다시 맡기기 = gen + 1 · 학습 완료였을 때만 guidelineGen 을 이어받는다(Codex 8R) · reviewed 는 그대로 */
export function onAdminEdit(s: BrandVoiceState): BrandVoiceState {
  const gen = s.gen + 1;
  return { ...s, gen, guidelineGen: s.guidelineGen === s.gen ? gen : s.guidelineGen, extractError: null };
}

/** 초기화 = gen + 1 · 대기 추출본 · 확인된 묶음 · 견본 비움(guidelineGen 옛 값 = 학습 미완) */
export function onReset(s: BrandVoiceState): BrandVoiceState {
  return { ...s, gen: s.gen + 1, extract: null, extractError: null, reviewed: null, sample: null };
}

/** 세대 g 의 추출이 이미 끝났는가(같은 세대 추출 결과는 불변 · 다시 걷지도 덮지도 않는다 · 시작 판정과 저장 판정이 같은 함수) */
export function extractDoneFor(s: BrandVoiceState, g: number): boolean {
  return !!s.extract && s.extract.gen === g && s.guidelineGen === g;
}

/** 추출 성공 저장(시작 세대 g 가 지금 세대이고 그 세대 추출이 아직일 때만 · 동시 두 요청의 뒤엣것 = done) */
export function onExtractSuccess(s: BrandVoiceState, g: number): { ok: true; state: BrandVoiceState } | { ok: false; code: 'stale' | 'done' } {
  if (s.gen !== g) return { ok: false, code: 'stale' };
  if (extractDoneFor(s, g)) return { ok: false, code: 'done' };
  return { ok: true, state: { ...s, guidelineGen: g, extract: { gen: g, at: now() }, extractError: null } };
}

export function onExtractError(s: BrandVoiceState, g: number, code: StageErrorCode): BrandVoiceState {
  return s.gen === g ? { ...s, extractError: { gen: g, code, at: now() } } : s;
}

/** 확인 = 화면이 본 추출 세대만(유효한 대기 추출본이 있고 그 세대일 때) · 아니면 409 */
export function onReview(
  s: BrandVoiceState,
  seenExtractGen: number,
  payload: { by: string | null; skeletons: Record<string, ReviewedSkeleton>; phrases: Partial<Record<BrandVoiceKind, ReviewedPhrases>> },
): { ok: true; state: BrandVoiceState } | { ok: false } {
  if (!s.extract || s.extract.gen !== seenExtractGen) return { ok: false };
  return { ok: true, state: { ...s, reviewed: { extractGen: seenExtractGen, at: now(), by: payload.by, skeletons: payload.skeletons, phrases: payload.phrases } } };
}

/** 견본을 만들 · 쓸 수 있는 세대인가(K9-3) */
export function canSample(s: BrandVoiceState, g: number): boolean {
  return s.gen === g && s.guidelineGen === g && !!s.extract && !!s.reviewed && s.reviewed.extractGen === s.extract.gen;
}

export function onSample(s: BrandVoiceState, g: number, result: unknown): { ok: true; state: BrandVoiceState } | { ok: false } {
  if (!canSample(s, g)) return { ok: false };
  return { ok: true, state: { ...s, sample: { gen: g, at: now(), error: null, result } } };
}

export type VoiceStatus = 'none' | 'incomplete' | 'review_pending' | 'sample_pending' | 'ready';

/**
 * (순수) 화면 · 칩 상태(K7-5). 대표 문안 0 = none · 학습 미완 = guidelineGen < gen 또는 뼈대 없는 문안 · 추출본 확인 전 = review_pending ·
 * 확인 뒤 지금 세대 견본 없음 = sample_pending · 그 밖 = ready.
 */
export function voiceStatusOf(s: BrandVoiceState, info: { messageCount: number; unskeletonedCount: number; hasGuideline: boolean }): VoiceStatus {
  if (info.messageCount === 0) return 'none';
  if (!info.hasGuideline || s.guidelineGen < s.gen || info.unskeletonedCount > 0) return 'incomplete';
  if (s.extract && (!s.reviewed || s.reviewed.extractGen !== s.extract.gen)) return 'review_pending';
  if (!s.reviewed) return 'incomplete';
  if (!s.sample || s.sample.gen !== s.gen || !s.sample.result) return 'sample_pending';
  return 'ready';
}

// ─────────────── DB(잠금 · 읽기 · 쓰기) ───────────────

const STATE_WHERE = `company_id = $1::uuid AND memory_type = 'brand_voice_state' AND memory_key = 'main'`;

/** 트랜잭션 안에서 상태 행을 잠근다(없으면 만든 뒤 잠근다) */
export async function lockBrandVoiceState(client: PoolClient, companyId: string): Promise<BrandVoiceState> {
  await client.query(
    `INSERT INTO ai_company_memory (id, company_id, memory_type, memory_key, memory_value, importance, source, metadata, last_accessed_at, created_at, updated_at)
     VALUES (gen_random_uuid(), $1::uuid, 'brand_voice_state', 'main', $2, 10, 'system', '{}'::jsonb, NOW(), NOW(), NOW())
     ON CONFLICT (company_id, memory_type, memory_key) DO NOTHING`,
    [companyId, JSON.stringify(EMPTY_STATE)],
  );
  const r = await client.query(`SELECT memory_value FROM ai_company_memory WHERE ${STATE_WHERE} FOR UPDATE`, [companyId]);
  return parseState(r.rows[0]?.memory_value);
}

export async function writeBrandVoiceState(client: PoolClient, companyId: string, s: BrandVoiceState): Promise<void> {
  await client.query(`UPDATE ai_company_memory SET memory_value = $2, updated_at = NOW() WHERE ${STATE_WHERE}`, [companyId, JSON.stringify(s)]);
}

/** 잠금 없이 읽기(화면 · 생성) */
export async function readBrandVoiceState(companyId: string): Promise<BrandVoiceState> {
  const r = await query(`SELECT memory_value FROM ai_company_memory WHERE ${STATE_WHERE}`, [companyId]);
  return parseState(r.rows[0]?.memory_value);
}
