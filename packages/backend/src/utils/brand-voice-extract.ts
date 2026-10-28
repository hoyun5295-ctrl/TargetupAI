/**
 * 브랜드 보이스 추출 CT (★ 2026-10-28 AI 메모리 설계 K4-3 · K5-2 · K5-4 · K7-4 · docs/2026-10-28-ai-memory-brand-voice-design.md)
 *
 * 추출 지시(문안마다 종류 · 사실 조각 + 성격별 가이드라인) · 추출 응답 → 문안 값(종류 · 성격 · 뼈대) · 성격별 가이드라인 조립(순수).
 * 문구 칸 = 사실 조각 · 코드 판정으로 칸을 친 뒤 · 모양 · 길이 범위 · 링크 습관 = 코드가 잰다.
 * 대표 문안 · 가이드라인 값 타입과 형태 명세 정제는 routes/ai-memory.ts 에서 글자 그대로 옮겼다(라우트 · CT 가 같은 타입을 쓴다).
 */
import type { LinkHabit } from './brand-link-core';
import { scanLinkHabit } from './brand-link-core';
import { splitBrandVoiceExtraction, planBrandVoiceRows, type BrandVoiceKind } from './brand-voice-prompt';
import { buildSkeleton, maskPhrase, textHash, type FactPieces } from './brand-voice-skeleton';
import { CONTENT_TYPE_JUDGE_RULES, isCopyContentType, kindOfContentType, type CopyContentType } from './copy-content-type';
import { buildCompanyShape, normalizeForShape, type CompanyShape } from './copy-shape';
import { aiStr } from './ai-json';

export interface RepresentativeMessageValue {
  /** ★ 2026-10-28 K7-6 단문 칸 허용 */
  channel: 'SMS' | 'LMS' | 'MMS';
  message_text: string;
  message_subject?: string;
  image_url?: string | null;
  manual_priority: number;
  created_by_admin: boolean;
  /** ★ 2026-10-20 문자 성격(마케팅 · 안부/알림) · 없으면 가이드라인 추출 때 AI 가 판정 · 설계서 docs/2026-10-18-ai-line-design.md §17 */
  kind?: BrandVoiceKind;
  /** admin = 사람이 정함(추출이 덮지 않는다) · ai = 추출이 판정 */
  kind_source?: 'admin' | 'ai';
  /** ★ 2026-10-28 K4 종류 · 출처(사람이 고른 종류는 추출이 덮지 않는다) */
  content_type?: CopyContentType;
  content_type_source?: 'admin' | 'ai';
  /** ★ 2026-10-28 K5-4 확인 대기 뼈대(추출 세대 · 글 해시 · 출처) · 생성에는 확인된 묶음만 쓰인다 */
  skeleton?: { text: string; hash: string; extractGen: number; source: 'ai' | 'admin' };
  /** ★ 2026-10-28 K8 출처(직접 올림 · 보낸 문자) */
  source?: 'admin_input' | 'sent_history';
  source_campaign_id?: string;
}

export interface BrandGuidelineValue {
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
  // ★ 브랜드 키트 (admin 명시 자산 — AI 추출이 덮지 않고 보존). 전부 optional.
  signature_locked?: string;
  signature_mode?: 'append' | 'ai_blend';
  slogans?: string[];
  required_words?: string[];
  banned_words?: string[];
  // ★ 2026-07-02 형태 명세 — CT-99 BrandGuideline과 동일 구조 (주입·검증이 소비)
  hook_types?: string[];
  body_structure?: string[];
  sentence_ending_style?: '해요체' | '합쇼체' | '혼합';
  sentence_ending_examples?: string[];
  customer_address?: string;
  symbol_style?: string;
  length_range?: { min_chars: number; max_chars: number };
  link_habit?: LinkHabit;
  /** ★ 2026-10-20 이 가이드라인을 뽑은 문안의 성격(main 행 · 없으면 마케팅) */
  voice_kind?: BrandVoiceKind;
  /** ★ 2026-10-28 K5-2 코드가 잰 회사 기준값 */
  shape?: CompanyShape;
}

/** 입력/AI 응답에서 형태 명세 필드만 안전 정제 (extract·update 공용) */
export function sanitizeFormSpec(input: any): Pick<BrandGuidelineValue,
  'hook_types' | 'body_structure' | 'sentence_ending_style' | 'sentence_ending_examples' | 'customer_address' | 'symbol_style'> {
  const arr = (v: any, max: number): string[] => Array.isArray(v)
    ? v.map((s: any) => String(s || '').trim()).filter(Boolean).slice(0, max) : [];
  const endingStyle = input?.sentence_ending_style;
  return {
    hook_types: arr(input?.hook_types, 2),
    body_structure: arr(input?.body_structure, 7),
    sentence_ending_style: endingStyle === '해요체' || endingStyle === '합쇼체' || endingStyle === '혼합' ? endingStyle : undefined,
    sentence_ending_examples: arr(input?.sentence_ending_examples, 3),
    customer_address: String(input?.customer_address || '').trim().slice(0, 50) || undefined,
    symbol_style: String(input?.symbol_style || '').trim().slice(0, 200) || undefined,
  };
}

/** 추출 지시(문안마다 종류 · 사실 조각 + 성격별 가이드라인 · K4-3 · K5-4) */
export function buildVoiceExtractionPrompt(n: number): string {
  return `당신은 회사 문자 메시지를 분석해 회사 목소리 가이드라인을 JSON 으로 뽑는 전문가입니다.

분석 대상 = 같은 회사의 대표 문안 ${n}건(SMS · LMS · MMS). 이 문안들이 회사 목소리 그 자체입니다.

## 1단계: 문안마다 종류 판정 + 사실 조각

종류(content_type):
${CONTENT_TYPE_JUDGE_RULES}
- "종류: …(사람이 정함)" 또는 "성격: …(사람이 정함)" 이 붙은 문안은 그대로 둔다.

사실 조각(facts) = 그 문안에만 해당하는 사실을 **원문 글자 그대로** 옮긴다(고쳐 쓰거나 요약하지 않는다 · 없으면 빈 배열):
- products 상품명 · events 행사명 · stores 매장 · periods 기간 표현 · benefits 혜택 표현

## 2단계: 성격별 가이드라인

성격 = promo · launch · howto 는 marketing · greeting · notice 는 notice. 성격별로 따로 분석한다. 문안이 0건인 성격은 null.

{
  "tone_signature": "친근/캐주얼 | 정중/격조 | 활기/감성 | 정보/실용 | 럭셔리/세련 중 1",
  "avg_length_chars": 245,
  "avg_length_bytes": 380,
  "frequent_expressions": ["2건 이상 나온 표현 3~5"],
  "greeting_pattern": "자주 쓰는 인사 꼴 1(없으면 빈 문자열)",
  "cta_patterns": ["행동 유도 표현 3"],
  "signature": "맺음 · 서명(없으면 빈 문자열)",
  "emoji_whitelist": ["실제로 쓴 기호"],
  "hook_types": ["질문형 | 선언형 | 영문 슬로건 | 혜택 직접형 중 1~2"],
  "body_structure": ["실제 문안에 있는 블록 순서 3~7"],
  "sentence_ending_style": "해요체 | 합쇼체 | 혼합",
  "sentence_ending_examples": ["대표 어미 2~3"],
  "customer_address": "고객 호칭(없으면 빈 문자열)",
  "symbol_style": "기호 사용 꼴 한 줄(없으면 빈 문자열)"
}

## 응답 형식

JSON 하나만. 설명 · 코드블록 없음. 시작 = "{" · 끝 = "}".
{ "messages": [ { "content_type": "promo | launch | howto | greeting | notice | null", "facts": { "products": [], "events": [], "stores": [], "periods": [], "benefits": [] } } … 문안 순서대로 ${n}개 ], "marketing": {위 항목} 또는 null, "notice": {위 항목} 또는 null }`;
}

/** (순수) 추출 응답 → 문안 값(종류 · 성격 · 뼈대) · 성격별 가이드라인(문구 칸 = 칸 친 뒤 · 모양 · 길이 · 링크 = 코드) */
export function buildExtractionResult(
  parsed: unknown,
  rows: ReadonlyArray<{ id: string; value: RepresentativeMessageValue }>,
  adminTypes: ReadonlyArray<CopyContentType | null>,
  adminKinds: ReadonlyArray<BrandVoiceKind | null>,
  g: number,
): { ok: false } | { ok: true; main: BrandGuidelineValue; notice: BrandGuidelineValue | null; messages: Array<{ id: string; value: RepresentativeMessageValue }>; unclassified: number } {
  const p: any = parsed && typeof parsed === 'object' ? parsed : {};
  const ai: any[] = Array.isArray(p.messages) ? p.messages : [];
  const types: Array<CopyContentType | null> = rows.map((_, i) => adminTypes[i] ?? (isCopyContentType(ai[i]?.content_type) ? ai[i].content_type : null));
  const kinds: Array<BrandVoiceKind | null> = rows.map((_, i) => (types[i] ? kindOfContentType(types[i]!) : adminKinds[i]));
  const facts: FactPieces[] = rows.map((_, i) => (ai[i]?.facts && typeof ai[i].facts === 'object' ? ai[i].facts : {}));
  const split = splitBrandVoiceExtraction({ kinds, marketing: p.marketing, notice: p.notice }, kinds);
  const byKind: Partial<Record<BrandVoiceKind, BrandGuidelineValue>> = {};
  for (const kind of ['marketing', 'notice'] as const) {
    const src: any = split.byKind[kind];
    const texts = rows.filter((_, i) => kinds[i] === kind).map((r) => r.value.message_text);
    if (!src || texts.length === 0) continue;
    const mask = (s: unknown) => maskPhrase(String(s ?? ''), facts);
    const lengths = texts.map((t) => Array.from(normalizeForShape(t)).length);
    byKind[kind] = {
      tone_signature: aiStr(src.tone_signature, '정보/실용') || '정보/실용',
      avg_length_chars: Number(src.avg_length_chars) || 0,
      avg_length_bytes: Number(src.avg_length_bytes) || 0,
      frequent_expressions: Array.isArray(src.frequent_expressions) ? src.frequent_expressions.map(mask).filter(Boolean).slice(0, 5) : [],
      greeting_pattern: mask(aiStr(src.greeting_pattern)),
      cta_patterns: Array.isArray(src.cta_patterns) ? src.cta_patterns.map(mask).filter(Boolean).slice(0, 5) : [],
      signature: mask(aiStr(src.signature)),
      emoji_whitelist: Array.isArray(src.emoji_whitelist) ? src.emoji_whitelist.map((s: any) => String(s)).slice(0, 20) : [],
      extracted_at: new Date().toISOString(),
      admin_edited: false,
      ...sanitizeFormSpec(src),
      sentence_ending_examples: Array.isArray(src.sentence_ending_examples) ? src.sentence_ending_examples.map(mask).filter(Boolean).slice(0, 3) : [],
      length_range: lengths.length > 0 ? { min_chars: Math.min(...lengths), max_chars: Math.max(...lengths) } : undefined,
      link_habit: scanLinkHabit(texts),
      shape: buildCompanyShape(texts),
      voice_kind: kind,
    };
  }
  const plan = planBrandVoiceRows(kinds, byKind);
  if (!plan.ok) return { ok: false };
  const messages = rows.map((r, i) => {
    const hash = textHash(r.value.message_text);
    const keepAdminSkeleton = r.value.skeleton?.source === 'admin' && r.value.skeleton.hash === hash;
    const value: RepresentativeMessageValue = {
      ...r.value,
      ...(types[i] ? { content_type: types[i]!, content_type_source: adminTypes[i] ? 'admin' : 'ai' } : {}),
      ...(kinds[i] ? { kind: kinds[i]!, kind_source: adminKinds[i] || adminTypes[i] ? 'admin' : 'ai' } : {}),
      skeleton: keepAdminSkeleton ? { ...r.value.skeleton!, extractGen: g } : { text: buildSkeleton(r.value.message_text, facts[i]), hash, extractGen: g, source: 'ai' },
    };
    return { id: r.id, value };
  });
  return { ok: true, main: plan.main, notice: plan.notice, messages, unclassified: kinds.filter((k) => k === null).length };
}
