/**
 * ★ CT-99: Brand Voice Prompt Builder — D225+ (2026-05-28 Harold 명시)
 *
 * 본질
 *   회사별 대표 문안 + 자동 추출 가이드라인을 AI 시스템 프롬프트에 주입하는 목소리 CT(I2 · 고객 글 생산자는 전부 이 CT 를 지난다 · R24).
 *
 * ★ 2026-10-28 AI 메모리 설계(docs/2026-10-28-ai-memory-brand-voice-design.md) K6:
 *   - voiceLearned(companyId) = 주입할 목소리가 있는가(I3 · 확인된 묶음의 지금 문안 뼈대 1건 이상 또는 사람 행 칸 1개 이상).
 *   - composeVoicePrompt = 이관된 생산자의 길. 회사 문안 글자 = 사람이 확인한 묶음(상태 행 reviewed)의 뼈대 · 문구 칸뿐(I16).
 *   - 옛 껍데기 buildSystemPromptWithBrandVoice = 묶음 B 끝에 지움(고객 글 생산자 전부 composeVoicePrompt · R24 래칫 0).
 *   - 5분 TTL in-memory 캐시 · 회사 격리(캐시 키 = company_id) · 쓰기마다 invalidateBrandVoiceCache 의무.
 */

import { query } from '../config/database';
import { parseVoiceEdit, editFormLines, type VoiceEditRow } from './voice-habits';
import { buildBrandLinkPromptSection, type BrandLink, type LinkHabit } from './brand-link-core';
import { parseState, voiceStatusOf, type BrandVoiceState, type ReviewedPhrases, type VoiceStatus } from './brand-voice-state';
import type { CompanyShape } from './copy-shape';
import { textHash } from './brand-voice-skeleton';
import { isCopyContentType, kindOfContentType, type CopyContentType } from './copy-content-type';
import {
  voiceFormSlotsOf, pickableSkeletons, companyFormValuesOf, voiceFormAsksOf, resolveFormLink, voiceFormPromptSection, currentVoiceForm, onceLinkPromptSection,
  type VoiceFormDecision, type VoiceFormSlot, type CompanyFormValues,
} from './voice-form-slots';
import { getCompanyBrandKitRaw } from './dm/dm-brand-kit';

// ════════════════════════════════════════════════════════════════════
// 타입
// ════════════════════════════════════════════════════════════════════

/** ★ 2026-10-28 AI 메모리 설계 K1-5 — (광고) · 080 위치 칸은 법(buildAdMessage)이 정해 목소리 값에서 지웠다(옛 행에 남은 값은 아무도 읽지 않는다) */
export interface BrandGuideline {
  tone_signature: string;
  avg_length_chars: number;
  avg_length_bytes: number;
  frequent_expressions: string[];
  greeting_pattern: string;
  cta_patterns: string[];
  signature: string;
  emoji_whitelist: string[];
  extracted_at: string;
  admin_edited: boolean;
  // ★ 브랜드 키트 (문안 두뇌 — 회사 admin 명시 자산, 자동 추출이 덮지 않음). 전부 optional.
  signature_locked?: string;            // 문안 끝에 항상 조합할 고정 시그니처/맺음말
  signature_mode?: 'append' | 'ai_blend'; // append=끝에 부착 / ai_blend=톤에 녹임 (기본 append)
  slogans?: string[];                   // 슬로건/태그라인 (문맥 맞을 때만 활용)
  required_words?: string[];            // 가능하면 포함할 표현
  banned_words?: string[];              // 절대 사용 금지 단어 (출력 가드 연동)
  // ★ 2026-07-02 형태 명세 (대표 문안에서 추출한 구조 정보 — 없으면 섹션 생략 = 기존 회사 영향 0)
  hook_types?: string[];                // 첫 후크 유형 빈도순 최대 2 (질문형/선언형/영문 슬로건/혜택 직접형)
  body_structure?: string[];            // 본문 구조 순서 (예: ["(광고)+브랜드", "후크", "본문", "기간/조건", "CTA"])
  sentence_ending_style?: '해요체' | '합쇼체' | '혼합';
  sentence_ending_examples?: string[];  // 대표 종결어미 2~3 (예: "~해보세요", "~습니다")
  customer_address?: string;            // 고객 호칭 (예: "고객님", "실버 등급 고객님")
  symbol_style?: string;                // 기호·구분선 사용 패턴 서술 (예: "CTA 끝에 > 부착")
  length_range?: { min_chars: number; max_chars: number }; // 본문 길이 범위
  link_habit?: LinkHabit;               // 링크 습관 (코드 정규식 스캔 — brand-link-core)
  /** ★ 2026-10-20 이 가이드라인을 뽑은 문안의 성격(없는 옛 행 = 마케팅) · 설계서 docs/2026-10-18-ai-line-design.md §17 */
  voice_kind?: BrandVoiceKind;
  /** ★ 2026-10-28 K5-2 코드가 잰 회사 기준값(그 성격 표본 · 칸마다 n<3 = 미측정) */
  shape?: CompanyShape;
}

/** ★ 2026-10-20 문자 성격 · 마케팅(광고) · 안부/알림. 가이드라인 행 = main(마케팅 · 옛 소비처가 읽는 행) · notice(안부/알림 · 있을 때만) */
export type BrandVoiceKind = 'marketing' | 'notice';

/** 사람 행(brand_voice_admin) 칸 = 확인 없이 쓰이는 사람 글 */
export type AdminFieldRow = Record<string, { value: unknown; at: string; by: string | null }>;

/** 가이드라인 문구 칸(AI 가 원문에서 뽑는 글귀 · 확인된 묶음에 있는 것만 싣는다) */
export const PHRASE_FIELDS = ['frequent_expressions', 'cta_patterns', 'signature', 'greeting_pattern', 'sentence_ending_examples'] as const;

export interface RepresentativeMessage {
  id?: string;
  channel: 'SMS' | 'LMS' | 'MMS';
  message_text: string;
  message_subject?: string;
  image_url?: string | null;
  manual_priority: number;
  /** ★ 2026-10-20 성격(없는 옛 행 = 마케팅) */
  kind: BrandVoiceKind;
  /** ★ 2026-10-28 K4 종류(없으면 null = 종류 미정) */
  content_type?: CopyContentType | null;
  /** ★ 2026-10-28 K5-4 지금 글의 확인 대기 뼈대가 있는가(학습 미완 판정 · 글자는 싣지 않는다) */
  has_pending_skeleton?: boolean;
}

interface BrandVoiceCacheEntry {
  /** memory_key='main' (옛 소비처 전부가 읽는 행) */
  guideline: BrandGuideline | null;
  /** ★ 2026-10-20 memory_key='notice' (안부/알림 문안이 있을 때만) */
  noticeGuideline: BrandGuideline | null;
  messages: RepresentativeMessage[];
  links: BrandLink[];
  /** ★ 2026-10-28 K7 상태 행 · K5-4 사람 행(성격별) */
  state: BrandVoiceState;
  admin: Partial<Record<BrandVoiceKind, AdminFieldRow>>;
  /** ★ 2026-10-28 K14-1 사람이 받아들인 글귀 · 자동 형식 값 */
  edit: VoiceEditRow;
  expiresAt: number;
}

// ════════════════════════════════════════════════════════════════════
// 5분 TTL in-memory 캐시
// ════════════════════════════════════════════════════════════════════

const CACHE_TTL_MS = 5 * 60 * 1000;
const cache = new Map<string, BrandVoiceCacheEntry>();

function getCacheKey(companyId: string): string {
  return `brand_voice:${companyId}`;
}

function parseJson(raw: unknown): any {
  if (typeof raw !== 'string') return raw;
  try { return JSON.parse(raw); } catch { return null; }
}

/** 대표 문안 보관 상한(주입은 5 · K6-2) */
export const REPRESENTATIVE_KEEP = 30;

async function loadFromDb(companyId: string): Promise<BrandVoiceCacheEntry> {
  const [guidelineRes, messagesRes, linksRes, stateRes, adminRes, editRes] = await Promise.all([
    // ★ 2026-10-20 행 = main · notice 둘까지. 키를 지정해 읽는다(LIMIT 1 이면 notice 행이 옛 소비처에 섞인다)
    query(
      `SELECT memory_key, memory_value FROM ai_company_memory
       WHERE company_id = $1::uuid AND memory_type = 'brand_guideline' AND memory_key IN ('main', 'notice')`,
      [companyId],
    ),
    query(
      `SELECT id, memory_value FROM ai_company_memory
       WHERE company_id = $1::uuid AND memory_type = 'representative_message'
       ORDER BY created_at ASC, memory_key ASC
       LIMIT ${REPRESENTATIVE_KEEP}`,
      [companyId],
    ),
    // ★ 2026-07-02 브랜드 링크 — 회사 등록 URL (memory_key = 라벨). 같은 테이블 재사용, ALTER 0.
    query(
      `SELECT id, memory_key, memory_value FROM ai_company_memory
       WHERE company_id = $1::uuid AND memory_type = 'brand_link'
       ORDER BY created_at ASC
       LIMIT 20`,
      [companyId],
    ),
    query(
      `SELECT memory_value FROM ai_company_memory
       WHERE company_id = $1::uuid AND memory_type = 'brand_voice_state' AND memory_key = 'main'`,
      [companyId],
    ),
    query(
      `SELECT memory_key, memory_value FROM ai_company_memory
       WHERE company_id = $1::uuid AND memory_type = 'brand_voice_admin' AND memory_key IN ('marketing', 'notice')`,
      [companyId],
    ),
    query(
      `SELECT memory_value FROM ai_company_memory
       WHERE company_id = $1::uuid AND memory_type = 'voice_edit' AND memory_key = 'main'`,
      [companyId],
    ),
  ]);

  let guideline: BrandGuideline | null = null;
  let noticeGuideline: BrandGuideline | null = null;
  for (const row of guidelineRes.rows) {
    const parsed: BrandGuideline | null = parseJson(row.memory_value) || null;
    if (row.memory_key === 'notice') noticeGuideline = parsed;
    else guideline = parsed;
  }
  // ★ Codex 1020 R1 — 안부 문안만 있는 회사 = main 하나가 안부 말투(voice_kind notice · 복제 행 없음 = 진실 하나)
  if (!noticeGuideline && guideline?.voice_kind === 'notice') noticeGuideline = guideline;

  const messages: RepresentativeMessage[] = [];
  for (const row of messagesRes.rows) {
    const parsed = parseJson(row.memory_value);
    if (parsed && typeof parsed.message_text === 'string') {
      const contentType = isCopyContentType(parsed.content_type) ? parsed.content_type : null;
      messages.push({
        id: String(row.id),
        channel: parsed.channel === 'MMS' ? 'MMS' : parsed.channel === 'SMS' ? 'SMS' : 'LMS',
        message_text: parsed.message_text,
        message_subject: parsed.message_subject || undefined,
        image_url: parsed.image_url || null,
        manual_priority: Number(parsed.manual_priority) || 0,
        // 종류가 있으면 종류에서 파생(I4) · 옛 행 = 지금 kind 그대로
        kind: contentType ? kindOfContentType(contentType) : parsed.kind === 'notice' ? 'notice' : 'marketing',
        content_type: contentType,
        has_pending_skeleton: !!parsed.skeleton && typeof parsed.skeleton.text === 'string' && parsed.skeleton.hash === textHash(parsed.message_text),
      });
    }
  }
  messages.sort((a, b) => a.manual_priority - b.manual_priority);

  const links: BrandLink[] = [];
  for (const row of linksRes.rows) {
    const parsed = parseJson(row.memory_value);
    if (parsed && typeof parsed.url === 'string' && parsed.url.trim()) {
      links.push({
        id: row.id,
        label: String(parsed.label || row.memory_key || '').trim(),
        url: parsed.url.trim(),
      });
    }
  }

  const admin: Partial<Record<BrandVoiceKind, AdminFieldRow>> = {};
  for (const row of adminRes.rows) {
    const v = parseJson(row.memory_value);
    if (v && typeof v === 'object' && (row.memory_key === 'marketing' || row.memory_key === 'notice')) admin[row.memory_key as BrandVoiceKind] = v;
  }

  return {
    guideline,
    noticeGuideline,
    messages,
    links,
    state: parseState(stateRes.rows[0]?.memory_value),
    admin,
    edit: parseVoiceEdit(editRes.rows[0]?.memory_value),
    expiresAt: Date.now() + CACHE_TTL_MS,
  };
}

async function getBrandVoiceData(companyId: string): Promise<BrandVoiceCacheEntry> {
  const key = getCacheKey(companyId);
  const cached = cache.get(key);
  if (cached && cached.expiresAt > Date.now()) {
    return cached;
  }
  const fresh = await loadFromDb(companyId);
  cache.set(key, fresh);
  return fresh;
}

export function invalidateBrandVoiceCache(companyId: string): void {
  cache.delete(getCacheKey(companyId));
}

export async function getBrandGuideline(companyId: string): Promise<BrandGuideline | null> {
  const data = await getBrandVoiceData(companyId);
  return data.guideline;
}

// ════════════════════════════════════════════════════════════════════
// ★ 2026-10-28 K6-1 목소리 판정 · 해석(이관된 생산자 · 화면 · 3안 · 두뇌가 같은 읽기)
// ════════════════════════════════════════════════════════════════════

/** (순수) 확인된 묶음 중 지금 있는 문안이고 글 해시가 맞는 뼈대 */
export function liveSkeletons(state: BrandVoiceState, messages: ReadonlyArray<RepresentativeMessage>): Array<{ message: RepresentativeMessage; skeleton: string }> {
  const sk = state.reviewed?.skeletons || {};
  const out: Array<{ message: RepresentativeMessage; skeleton: string }> = [];
  for (const m of messages) {
    const s = m.id ? sk[m.id] : undefined;
    if (s && typeof s.text === 'string' && s.text.trim() && s.hash === textHash(m.message_text)) out.push({ message: m, skeleton: s.text });
  }
  return out;
}

function adminFieldCount(admin: Partial<Record<BrandVoiceKind, AdminFieldRow>>, kind?: BrandVoiceKind): number {
  const kinds: BrandVoiceKind[] = kind ? [kind] : ['marketing', 'notice'];
  return kinds.reduce((n, k) => n + Object.keys(admin[k] || {}).length, 0);
}

/** (순수) I3 = 주입할 목소리가 있다(성격을 주면 그 성격 기준) */
export function voiceLearnedOf(data: Pick<BrandVoiceCacheEntry, 'state' | 'messages' | 'admin'>, kind?: BrandVoiceKind): boolean {
  const live = liveSkeletons(data.state, data.messages).filter((x) => !kind || x.message.kind === kind);
  return live.length > 0 || adminFieldCount(data.admin, kind) > 0;
}

export async function voiceLearned(companyId: string | undefined, kind?: BrandVoiceKind): Promise<boolean> {
  if (!companyId) return false;
  try {
    return voiceLearnedOf(await getBrandVoiceData(companyId), kind);
  } catch {
    return false;
  }
}

/**
 * (순수) 성격의 해석된 가이드라인 = AI 가이드라인 행(문구 아닌 칸 · 모양) + 확인된 묶음의 문구 칸 + 그 성격 사람 행(덮기).
 * 미확인 AI 문구 칸은 비운다(I16 · 확인 대기 0).
 */
export function resolveGuidelineFor(
  data: Pick<BrandVoiceCacheEntry, 'guideline' | 'noticeGuideline' | 'state' | 'admin'>,
  kind: BrandVoiceKind,
): BrandGuideline | null {
  const base = kind === 'notice' ? (data.noticeGuideline || data.guideline) : data.guideline;
  const admin = data.admin[kind] || {};
  if (!base && Object.keys(admin).length === 0) return null;
  const g: BrandGuideline = {
    tone_signature: '', avg_length_chars: 0, avg_length_bytes: 0, frequent_expressions: [], greeting_pattern: '',
    cta_patterns: [], signature: '', emoji_whitelist: [], extracted_at: '', admin_edited: false,
    ...(base || {}),
  };
  const phrases: ReviewedPhrases = data.state.reviewed?.phrases?.[kind] || {};
  g.frequent_expressions = Array.isArray(phrases.frequent_expressions) ? phrases.frequent_expressions : [];
  g.cta_patterns = Array.isArray(phrases.cta_patterns) ? phrases.cta_patterns : [];
  g.signature = typeof phrases.signature === 'string' ? phrases.signature : '';
  g.greeting_pattern = typeof phrases.greeting_pattern === 'string' ? phrases.greeting_pattern : '';
  g.sentence_ending_examples = Array.isArray(phrases.sentence_ending_examples) ? phrases.sentence_ending_examples : [];
  for (const [field, cell] of Object.entries(admin)) (g as any)[field] = cell?.value;
  g.voice_kind = kind;
  return g;
}

/**
 * ★ 2026-10-20 이 성격의 말투를 배웠는가(AI 한줄로 확인 판 안내 한 줄).
 * ★ 2026-10-28 K6-4 — learned = voiceLearned(주입할 목소리) · kindLearned = 그 성격 목소리.
 */
export async function getBrandVoiceFit(companyId: string, kind: BrandVoiceKind): Promise<{ learned: boolean; kindLearned: boolean }> {
  const data = await getBrandVoiceData(companyId);
  return { learned: voiceLearnedOf(data), kindLearned: voiceLearnedOf(data, kind) };
}

/** (순수) 화면 · 칩 상태 한 곳(AI 메모리 · AI 한줄로 확인 판 · 생성 화면이 같은 판정 · K7-5) */
export function voiceStatusOfSnapshot(data: Pick<BrandVoiceCacheEntry, 'state' | 'messages' | 'admin' | 'guideline' | 'noticeGuideline'>): VoiceStatus {
  const live = new Set(liveSkeletons(data.state, data.messages).map((x) => x.message.id));
  const unskeletoned = data.messages.filter((m) => !m.has_pending_skeleton && !live.has(m.id)).length;
  const hasGuideline = !!data.guideline || !!data.noticeGuideline || adminFieldCount(data.admin) > 0;
  return voiceStatusOf(data.state, { messageCount: data.messages.length, unskeletonedCount: unskeletoned, hasGuideline });
}

/** 화면 · 라우트 · 견본용 읽기(캐시 공유) */
export async function getBrandVoiceSnapshot(companyId: string): Promise<BrandVoiceCacheEntry> {
  return getBrandVoiceData(companyId);
}

/**
 * ★ 2026-10-20 (순수) 가이드라인 추출 응답 → 문안마다 성격 · 성격별 응답 묶음(설계서 docs/2026-10-18-ai-line-design.md §17).
 * 사람이 정한 성격(adminKinds[i])은 AI 판정이 덮지 않는다. **AI 판정이 없거나 허용값이 아니면 null**(기본값으로 메우지 않는다 ·
 * ★ Codex R2 — 「모르면 마케팅」이 빠진 판정을 숨겨 저장 검사를 통과했다). 묶음 = 성격 키(marketing · notice) 객체만.
 * ★ Codex R3 — 옛 모양(성격 키 없이 14항목 한 묶음) 호환 분기는 지웠다(같은 부류 세 번째 · 호환 조건이 새 구멍이 됐다) · 그런 응답 = 묶음 0 = 저장 0.
 */
export function splitBrandVoiceExtraction(parsed: unknown, adminKinds: ReadonlyArray<BrandVoiceKind | null>): {
  kinds: Array<BrandVoiceKind | null>;
  byKind: Partial<Record<BrandVoiceKind, Record<string, unknown>>>;
} {
  const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
  const p: Record<string, unknown> = isObj(parsed) ? parsed : {};
  const aiKinds = Array.isArray(p.kinds) ? p.kinds : [];
  const kinds: Array<BrandVoiceKind | null> = adminKinds.map((a, i) =>
    a ?? (aiKinds[i] === 'notice' || aiKinds[i] === 'marketing' ? aiKinds[i] as BrandVoiceKind : null));
  const byKind: Partial<Record<BrandVoiceKind, Record<string, unknown>>> = {};
  for (const k of ['marketing', 'notice'] as const) {
    const g = p[k];
    if (kinds.includes(k) && isObj(g)) byKind[k] = g;
  }
  return { kinds, byKind };
}

/**
 * ★ Codex 1020 R1 (순수) 성격별 가이드라인 → 저장할 행. 진실 하나 원칙:
 *   마케팅 + 안부 = main(마케팅) · notice(안부) / 마케팅만 = main · notice 지움 / 안부만 = main 하나가 안부 말투 · notice 지움(복제 행 없음).
 *   문안이 있는 성격의 묶음이 빠지면 저장하지 않는다(불완전한 응답이 기존 학습을 지우거나 덮지 않게).
 * ★ 2026-10-28 K4-3 — 종류 미정(성격 null) 문안은 거절 사유가 아니다(저장 · 예시 「전체」에는 남고 성격별 표본에서 빠진다).
 *   분류된 문안이 0건이면 지금처럼 쓰기 0.
 */
export function planBrandVoiceRows<G>(kinds: ReadonlyArray<BrandVoiceKind | null>, byKind: Partial<Record<BrandVoiceKind, G>>):
  { ok: false; missing: BrandVoiceKind[]; unclassified: number } | { ok: true; main: G; notice: G | null } {
  const unclassified = kinds.filter((k) => k === null).length;
  const need = (['marketing', 'notice'] as const).filter((k) => kinds.includes(k));
  const missing = need.filter((k) => !byKind[k]);
  if (need.length === 0 || missing.length > 0) return { ok: false, missing, unclassified };
  if (byKind.marketing) return { ok: true, main: byKind.marketing, notice: byKind.notice ?? null };
  return { ok: true, main: byKind.notice as G, notice: null };
}

/** 회사 브랜드 링크 (5분 TTL 캐시 공유 — CRUD 시 invalidateBrandVoiceCache 호출 의무) */
export async function getBrandLinks(companyId: string): Promise<BrandLink[]> {
  const data = await getBrandVoiceData(companyId);
  return data.links;
}

// ════════════════════════════════════════════════════════════════════
// 공용 조각(옛 껍데기 · 새 길이 같은 문장을 쓴다)
// ════════════════════════════════════════════════════════════════════

function formSpecLinesOf(g: BrandGuideline, opts: { withSymbolStyle: boolean }): string[] {
  const formSpecLines: string[] = [];
  if (Array.isArray(g.hook_types) && g.hook_types.length > 0) {
    formSpecLines.push(`- 첫 줄 후크 유형: ${g.hook_types.join(' 또는 ')}. 본문을 이 유형의 후크로 시작하세요.`);
  }
  if (Array.isArray(g.body_structure) && g.body_structure.length > 0) {
    formSpecLines.push(`- 본문 구조 순서: ${g.body_structure.join(' → ')}. 이 순서 그대로 구성하세요.`);
  }
  if (g.sentence_ending_style) {
    const endingEx = Array.isArray(g.sentence_ending_examples) && g.sentence_ending_examples.length > 0
      ? ` (대표 어미: ${g.sentence_ending_examples.join(' / ')})`
      : '';
    formSpecLines.push(`- 문장 종결어미: ${g.sentence_ending_style}${endingEx}. 다른 어체로 바꾸지 마세요.`);
  }
  if (g.customer_address) {
    formSpecLines.push(`- 고객 호칭: "${g.customer_address}" 그대로 사용하세요.`);
  }
  if (opts.withSymbolStyle && g.symbol_style) {
    formSpecLines.push(`- 기호·구분선 스타일: ${g.symbol_style}`);
  }
  if (g.length_range && g.length_range.min_chars > 0 && g.length_range.max_chars >= g.length_range.min_chars) {
    formSpecLines.push(`- 본문 길이: ${g.length_range.min_chars}~${g.length_range.max_chars}자 범위로 작성하세요 (LMS/MMS 기준, SMS는 압축 규칙 우선).`);
  }
  return formSpecLines;
}

function smsSectionOf(useNotice: boolean, isAd: boolean | undefined): string {
  // ★ 2026-10-28 K1-6 — SMS 바이트 문장은 성격이 아니라 광고 여부 한 출처(안부 말투 + 광고 = 66바이트). 광고 여부를 안 주는 호출 = 지금 글자 그대로(성격으로).
  const adBytes = isAd ?? !useNotice;
  const SMS_AD_BYTES = 'SMS 90바이트 - (광고) 6바이트 - 무료수신거부080XXXXXXXX 18바이트 = 66바이트 = 33글자 한도입니다.';
  const SMS_PLAIN_BYTES = 'SMS 90바이트 한도입니다.';
  const SMS_NOTICE_TONE = '학습된 안부 · 알림 톤으로 핵심 안내 1건 + 빈출 표현 1건 우선 + 시그니처 생략 형식으로 압축하세요.';
  const SMS_MARKETING_TONE = 'LMS 톤 학습 결과 기반으로 핵심 CTA 1건 + 빈출 표현 1건 우선 + 시그니처 생략 형식으로 자동 압축하세요.';
  const smsBody = useNotice
    ? (adBytes ? `${SMS_AD_BYTES}\n${SMS_NOTICE_TONE}` : `${SMS_PLAIN_BYTES} ${SMS_NOTICE_TONE}`)
    : `${adBytes ? SMS_AD_BYTES : SMS_PLAIN_BYTES}\n${SMS_MARKETING_TONE}`;
  return `## SMS 자동 생성 시 압축 처리 의무

${smsBody}
`;
}

// ════════════════════════════════════════════════════════════════════
// ★ 2026-10-28 K6-1 새 길 — composeVoicePrompt(이관된 생산자)
// ════════════════════════════════════════════════════════════════════

export type VoiceProducerMode = 'write' | 'rewrite';
/** 예시 주입 상한(보관 30 · 주입 5 · K6-2) */
export const VOICE_EXAMPLE_LIMIT = 5;

/** (순수) 예시 고르기 = 같은 종류 → 같은 성격 → 전체 순 · 확인된 뼈대만 */
export function pickVoiceExamples(
  live: ReadonlyArray<{ message: RepresentativeMessage; skeleton: string }>,
  kind: BrandVoiceKind,
  contentType: CopyContentType | null | undefined,
): Array<{ message: RepresentativeMessage; skeleton: string }> {
  const seen = new Set<string>();
  const out: Array<{ message: RepresentativeMessage; skeleton: string }> = [];
  const take = (xs: ReadonlyArray<{ message: RepresentativeMessage; skeleton: string }>) => {
    for (const x of xs) {
      if (out.length >= VOICE_EXAMPLE_LIMIT) return;
      const k = x.message.id || x.skeleton;
      if (!seen.has(k)) { seen.add(k); out.push(x); }
    }
  };
  if (contentType) take(live.filter((x) => x.message.content_type === contentType));
  take(live.filter((x) => x.message.kind === kind));
  take(live);
  return out;
}

/** 여정 패키지처럼 한 호출이 여러 단계를 만드는 생산자 = 성격별 블록을 함께 싣는다(K11-4) */
export const VOICE_KIND_BY_STEP = 'by_step' as const;

export interface ComposeVoiceInput {
  companyId: string | undefined;
  /** 생산자 이름(R24 · 로그) */
  producer: string;
  mode: VoiceProducerMode;
  kind: BrandVoiceKind | typeof VOICE_KIND_BY_STEP;
  contentType?: CopyContentType | null;
  channel?: string;
  isAd?: boolean;
  basePrompt: string;
  /** 생산자가 넘기는 출력 형식 한 줄(없으면 싣지 않는다) */
  outputFormat?: string;
  brandLinks?: boolean;
  /**
   * ★ K11-2 text = 문자(모양 · 기호 · 뼈대까지) · tone = HTML · SNS 생산자(이메일 · DM · 인앱 · SNS) = 어미 · 호칭 · 맺음 · 톤만
   *   (모양 · 이모지 = 그 채널 규칙 · 문자 뼈대를 싣지 않는다)
   */
  scope?: 'text' | 'tone';
  /** ★ 2026-10-29 목소리 꼴 칸 결정(질문 단계 답 · 저장된 결정 · 설계서 docs/2026-10-29-voice-form-slots-ask-design.md) */
  formDecision?: VoiceFormDecision | null;
}

export interface ComposeVoiceResult {
  system: string;
  guideline: BrandGuideline | null;
  shape: CompanyShape | null;
  voiceLearned: boolean;
  exampleCount: number;
}

/**
 * ★ 2026-10-29 (순수) 성격 하나의 꼴 칸 — 생성이 그 성격 · 범위에서 실제로 싣는 글과 같은 자료(§7-4 · §7-5).
 *   text = 고를 수 있는 뼈대 예시 전부 + 확인된 문구 칸 · tone = 뼈대 0 · 서명 · 어미 예시(voiceSectionFor 가 tone 에도 싣는 칸)
 */
export function voiceFormSlotsForData(
  data: Pick<BrandVoiceCacheEntry, 'guideline' | 'noticeGuideline' | 'state' | 'admin' | 'messages'>,
  kind: BrandVoiceKind, scope: 'text' | 'tone' = 'text',
): VoiceFormSlot[] {
  const g = resolveGuidelineFor(data, kind);
  if (!g) return [];
  const tone = scope === 'tone';
  const live = liveSkeletons(data.state, data.messages);
  const skeletons = tone ? [] : pickableSkeletons((c) => pickVoiceExamples(live, kind, c));
  const phrases = [
    g.signature, ...(g.sentence_ending_examples || []),
    ...(tone ? [] : [g.greeting_pattern, ...g.cta_patterns, ...g.frequent_expressions]),
  ].filter((x): x is string => typeof x === 'string' && x.length > 0);
  return voiceFormSlotsOf({ skeletons, phrases });
}

async function companyFormValues(companyId: string, links: readonly BrandLink[]): Promise<CompanyFormValues> {
  const kit = await getCompanyBrandKitRaw(companyId).catch(() => null);
  return companyFormValuesOf(links, (kit as any)?.contact);
}

/**
 * ★ 2026-10-29 질문 단계가 부르는 한 자리 — 꼴 칸 · 회사 값 · 물을 칸(결정 제외). 목소리 미학습 · 조회 실패 = 빈 목록(지금 동작).
 * kinds = 그 입구가 만들 수 있는 성격(모르면 둘 다) · scope = 그 생산자의 목소리 범위.
 */
export async function voiceFormAsksFor(
  companyId: string | undefined, opts: { kinds: readonly BrandVoiceKind[]; scope?: 'text' | 'tone'; decision?: VoiceFormDecision | null },
): Promise<{ slots: VoiceFormSlot[]; values: CompanyFormValues; asks: VoiceFormSlot[] }> {
  const empty = { slots: [], values: { link: false, phone: null }, asks: [] };
  if (!companyId) return empty;
  let data: BrandVoiceCacheEntry;
  try { data = await getBrandVoiceData(companyId); } catch { return empty; }
  const set = new Set<VoiceFormSlot>();
  for (const k of opts.kinds) for (const s of voiceFormSlotsForData(data, k, opts.scope || 'text')) set.add(s);
  const slots = (['link', 'store', 'phone'] as const).filter((s) => set.has(s));
  if (slots.length === 0) return { ...empty };
  const values = await companyFormValues(companyId, data.links);
  return { slots, values, asks: voiceFormAsksOf(slots, values, opts.decision) };
}

/** 성격 하나의 목소리 절(확인된 묶음 · 사람 행만 · I16) */
function voiceSectionFor(
  data: BrandVoiceCacheEntry,
  kind: BrandVoiceKind,
  input: Pick<ComposeVoiceInput, 'mode' | 'contentType' | 'channel' | 'isAd' | 'scope'>,
): { text: string; g: BrandGuideline; shape: CompanyShape | null; exampleCount: number } | null {
  const g = resolveGuidelineFor(data, kind);
  if (!g) return null;
  const tone = input.scope === 'tone';
  const examples = input.mode === 'write' && !tone ? pickVoiceExamples(liveSkeletons(data.state, data.messages), kind, input.contentType) : [];
  const shape = g.shape && g.shape.n > 0 ? g.shape : null;
  const useNotice = kind === 'notice';

  const lines: string[] = [];
  if (g.tone_signature) lines.push(`- 톤 시그니처: ${g.tone_signature}`);
  if (g.sentence_ending_style) lines.push(`- 어체: ${g.sentence_ending_style}${g.sentence_ending_examples?.length ? ` (대표 어미: ${g.sentence_ending_examples.join(' / ')})` : ''}`);
  if (g.customer_address) lines.push(`- 고객 호칭: "${g.customer_address}"`);
  if (g.signature) lines.push(`- 맺음 꼴: ${g.signature}`);
  if (!tone) {
    if (g.frequent_expressions.length > 0) lines.push(`- 자주 쓰는 표현(어울릴 때 1건): ${g.frequent_expressions.join(' / ')}`);
    if (g.greeting_pattern) lines.push(`- 인사 꼴: ${g.greeting_pattern}`);
    if (g.cta_patterns.length > 0) lines.push(`- 행동 유도 꼴: ${g.cta_patterns.join(' / ')}`);
    if (g.emoji_whitelist.length > 0) lines.push(`- 쓰는 기호: ${g.emoji_whitelist.join(' ')} (이 밖의 기호 · 이모지 쓰지 않기)`);
  }

  const formLines = tone ? [] : formSpecLinesOf(g, { withSymbolStyle: !shape }).filter((l) => !l.startsWith('- 문장 종결어미') && !l.startsWith('- 고객 호칭'));
  if (!tone && shape) {
    if (shape.lineLenP90 != null) formLines.push(`- 한 줄 길이: 보통 ${shape.lineLenP50}자 · 길어도 ${shape.lineLenP90}자 안팎`);
    if (shape.maxBlankRun != null) formLines.push(`- 빈 줄: 문단 사이 연속 ${Math.max(1, shape.maxBlankRun)}줄까지`);
    if (shape.paragraphs) formLines.push(`- 문단 수: ${shape.paragraphs.min}~${shape.paragraphs.max}개`);
    formLines.push(shape.evidence.divider ? '- 구분선: 대표 문안처럼 써도 된다' : '- 구분선: 쓰지 않는다');
    if (shape.symbols.length > 0) formLines.push(`- 기호 집합: ${shape.symbols.slice(0, 12).join(' ')}`);
  }

  const exampleSection = examples.length > 0 ? `
## 이 회사 대표 문안의 뼈대 (${examples.length}건)

모양(줄바꿈 · 빈 줄 · 기호 · 머리 · 맺음)은 뼈대를 따르고, 내용(상품 · 행사 · 혜택 · 날짜)은 복사하지 않는다.
대괄호 칸(예: [상품명: 직접 입력해주세요])은 뼈대 표시일 뿐이다. 이번 요청의 사실로 채우고, 요청에 없는 사실의 칸은 그 칸이 든 문장을 쓰지 않는다.

${examples.map((x, i) => `### 뼈대 ${i + 1} (채널: ${x.message.channel})\n${x.skeleton}`).join('\n\n')}
` : '';

  const text = `
## 회사 목소리 (사람이 확인한 이 회사 ${useNotice ? '안부 · 알림' : '마케팅'} 문자 기준 · ${tone ? '말투 · 호칭 · 맺음만 따른다 · 모양은 이 채널 규칙' : '반드시 따른다'})

${lines.join('\n')}
${formLines.length > 0 ? `
## 형태 준수 규칙 (참고가 아니라 규칙)

${formLines.join('\n')}
` : ''}
${!tone && String(input.channel || '').toUpperCase() === 'SMS' ? smsSectionOf(useNotice, input.isAd) : ''}${exampleSection}`;
  return { text, g, shape, exampleCount: examples.length };
}

/**
 * 이관된 생산자의 목소리 조립. 목소리 없는 회사(가이드라인 · 사람 행 0) = basePrompt 그대로(+ 링크 규칙) = I15.
 * 회사 문안 글자 = 사람 글(사람 행 · 키트) + 확인된 묶음(뼈대 · 문구 칸)뿐 · 확인 대기 0 · 원문 0(I16).
 * mode rewrite = 예시 0 · 원문 꼴을 지키는 규칙 줄(I12) · kind by_step = 성격별 블록 둘(여정 패키지 · K11-4).
 */
export async function composeVoicePrompt(input: ComposeVoiceInput): Promise<ComposeVoiceResult> {
  const none = (system: string): ComposeVoiceResult => ({ system, guideline: null, shape: null, voiceLearned: false, exampleCount: 0 });
  if (!input.companyId) return none(input.basePrompt);
  let data: BrandVoiceCacheEntry;
  try {
    data = await getBrandVoiceData(input.companyId);
  } catch (err) {
    console.error(`[Brand Voice] ${input.producer} DB 조회 실패 — basePrompt 그대로:`, (err as Error)?.message);
    return none(input.basePrompt);
  }
  // ★ 2026-10-29 링크 결정 한 곳(§7-3) — 지시문과 치환(services/ai generateMessages)이 같은 resolveFormLink 결과를 쓴다
  const formDecision = input.formDecision ?? currentVoiceForm();   // 묶음 B = 한 줄 단계 창 요리 문맥
  const formLink = resolveFormLink(data.links, formDecision);
  const linkSection = !input.brandLinks ? ''
    : formLink.mode === 'omit'
      ? '\n\n## 링크 (이번 문자)\n\n- 이번 문자에는 링크를 넣지 않는다(토큰 · 주소 · 자리 표시 모두 쓰지 않는다).'
      // ★ 2026-10-31 사람이 정한 링크 = 그 토큰 하나 · 꼭 한 번(설계서 docs/2026-10-31-ai-line-answer-link-design.md P2 · 등록 목록과 경쟁하지 않게)
      : formLink.mode === 'once'
        ? onceLinkPromptSection(data.guideline?.link_habit || null)
        : buildBrandLinkPromptSection(formLink.links, data.guideline?.link_habit || null);
  const kinds: BrandVoiceKind[] = input.kind === VOICE_KIND_BY_STEP ? ['marketing', 'notice'] : [input.kind];
  const sections = kinds.map((k) => ({ k, s: voiceSectionFor(data, k, input) })).filter((x) => x.s) as Array<{ k: BrandVoiceKind; s: NonNullable<ReturnType<typeof voiceSectionFor>> }>;
  if (sections.length === 0) return none(`${input.basePrompt}${linkSection}`);

  const byStep = input.kind === VOICE_KIND_BY_STEP;
  const body = byStep
    ? `

## 단계마다 성격 (각 단계에 contentType 칸 = promo · launch · howto · greeting · notice 중 하나)
- promo · launch · howto 단계 = 아래 「마케팅」 목소리 · greeting · notice 단계 = 「안부 · 알림」 목소리(없으면 있는 쪽).
${sections.map((x) => x.s.text).join('\n')}`
    : `\n${sections[0].s.text}`;
  // ★ 2026-10-28 K14-1 — 사람이 받아들인 글귀(쓸 것 · 피할 것) = 사람 글이라 허용 목록(I16) · 자동 형식 값 = 글자 0(문자 생산자만)
  const use = data.edit.accepted_use.map((a) => a.text);
  const avoid = data.edit.accepted_avoid.map((a) => a.text);
  const formEdit = input.scope === 'tone' ? [] : editFormLines(data.edit.form);
  const habitLines = [
    ...(use.length ? [`- 쓸 것: ${use.join(' / ')}`] : []),
    ...(avoid.length ? [`- 피할 것: ${avoid.join(' / ')}`] : []),
    ...formEdit,
  ];
  const habitSection = habitLines.length ? `\n## 담당자가 고쳐 온 습관(사람이 받아들인 것)\n${habitLines.join('\n')}\n` : '';
  const rewriteRule = input.mode === 'rewrite'
    ? '\n## 고치기 규칙\n- 원문의 줄바꿈 · 빈 줄 · 기호 · 머리 · 맺음 꼴은 그대로 두고, 지시한 곳만 고친다.\n'
    : '';
  // ★ 2026-10-29 꼴 칸 값(§3-③) · 호칭 반복 금지(§3-④ · Harold 1029 「%고객명% 고객님, / %고객등급% 고객님께」)
  const slotSet = new Set<VoiceFormSlot>();
  for (const x of sections) for (const sl of voiceFormSlotsForData(data, x.k, input.scope || 'text')) slotSet.add(sl);
  const formSlots = (['link', 'store', 'phone'] as const).filter((sl) => slotSet.has(sl));
  const formSection = formSlots.length > 0
    ? voiceFormPromptSection({ slots: formSlots, values: await companyFormValues(input.companyId, data.links), decision: formDecision, useLinkTokens: !!input.brandLinks })
    : '';
  const honorific = input.mode === 'write'
    ? '\n## 호칭\n- 고객 호칭(이름 · 등급 · 「고객님」)은 문안에서 한 번만 부른다. 이어지는 줄에서 「고객님」을 다시 부르지 않는다.\n'
    : '';
  const section = `${body}${habitSection}${rewriteRule}${formSection}${honorific}
## 우선순위

- 법(광고 표기 · 수신거부 · 전송자 명칭 · 바이트 · 없는 혜택 · 날짜 · 효능) > 발송 규칙 > 이번 요청 > 이 회사 목소리 > 기본 문체.
- 톤 · 문체가 기본 규칙과 부딪히면 이 회사 목소리를 따른다.
${input.outputFormat ? `\n${input.outputFormat}` : ''}`;

  const first = sections[0].s;
  const kindForLearned = byStep ? undefined : (input.kind as BrandVoiceKind);
  return {
    system: `${input.basePrompt}${section}${linkSection}`,
    guideline: first.g,
    shape: first.shape,
    voiceLearned: voiceLearnedOf(data, kindForLearned) || voiceLearnedOf(data),
    exampleCount: sections.reduce((n, x) => n + x.s.exampleCount, 0),
  };
}

/** (순수) 확인 대기 · 화면용 — 확인된 묶음에 들어갈 성격별 문구 칸(가이드라인 행의 칸 친 문구) */
export function pendingPhrasesOf(g: BrandGuideline | null): ReviewedPhrases {
  if (!g) return {};
  return {
    frequent_expressions: Array.isArray(g.frequent_expressions) ? g.frequent_expressions : [],
    cta_patterns: Array.isArray(g.cta_patterns) ? g.cta_patterns : [],
    signature: typeof g.signature === 'string' ? g.signature : '',
    greeting_pattern: typeof g.greeting_pattern === 'string' ? g.greeting_pattern : '',
    sentence_ending_examples: Array.isArray(g.sentence_ending_examples) ? g.sentence_ending_examples : [],
  };
}
