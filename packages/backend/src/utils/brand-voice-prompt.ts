/**
 * ★ CT-99: Brand Voice Prompt Builder — D225+ (2026-05-28 Harold 명시)
 *
 * 본질
 *   회사별 LMS 대표 문안 5건 + 자동 추출 가이드라인 9 항목을 AI 시스템 프롬프트에 자동 주입.
 *   AI 다듬기 + 자동 생성 + 여정 step + 추천 모든 호출 위치에서 동일 헬퍼 활용 = 일관성 100%.
 *
 * 사용 흐름
 *   1. 옛 AI 호출 영역 (refineDirectMessage / generateMessages / refineStepMessage /
 *      generateJourneyPackage / recommend-target / recommend-next-campaign) 6건 안에서 호출
 *   2. buildSystemPromptWithBrandVoice(companyId, basePrompt) → enriched prompt 반환
 *   3. 회사 brand_guideline 미존재 시 = basePrompt 그대로 반환 (옛 흐름 영향 0)
 *   4. 5분 TTL in-memory 캐시 — 매 호출마다 DB 조회 X (성능 안전)
 *   5. 5 대표 문안 정정/추가/삭제 + 가이드라인 재추출/정정 시 invalidateBrandVoiceCache 호출 의무
 *
 * 영구 원칙 정합
 *   - 회사 격리 — company_id 기반 캐시 키 (다른 회사 데이터 노출 차단)
 *   - 사실 보존 우선 (D152 4-1) — 본 가이드라인 = 톤 강화 prefix, 옛 시스템 프롬프트 = 사실 보존 base
 *   - 모델 분리 (D170+) — 본 헬퍼 = Sonnet/Opus 모두 활용 가능 (호출부 model 파라미터 그대로 활용)
 *   - SMS 학습 X — LMS 위주 학습 + SMS 자동 생성 시 33글자 압축 안내 자동 prefix
 */

import { query } from '../config/database';
import { buildBrandLinkPromptSection, type BrandLink, type LinkHabit } from './brand-link-core';

// ════════════════════════════════════════════════════════════════════
// 타입
// ════════════════════════════════════════════════════════════════════

export interface BrandGuideline {
  tone_signature: string;
  avg_length_chars: number;
  avg_length_bytes: number;
  frequent_expressions: string[];
  ad_prefix_position: 'front' | 'back';
  greeting_pattern: string;
  cta_patterns: string[];
  signature: string;
  reject_position: 'front' | 'back';
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
}

/** ★ 2026-10-20 문자 성격 · 마케팅(광고) · 안부/알림. 가이드라인 행 = main(마케팅 · 옛 소비처가 읽는 행) · notice(안부/알림 · 있을 때만) */
export type BrandVoiceKind = 'marketing' | 'notice';

export interface RepresentativeMessage {
  channel: 'LMS' | 'MMS';
  message_text: string;
  message_subject?: string;
  image_url?: string | null;
  manual_priority: number;
  /** ★ 2026-10-20 성격(없는 옛 행 = 마케팅) */
  kind: BrandVoiceKind;
}

interface BrandVoiceCacheEntry {
  /** memory_key='main' (옛 소비처 전부가 읽는 행) */
  guideline: BrandGuideline | null;
  /** ★ 2026-10-20 memory_key='notice' (안부/알림 문안이 있을 때만) */
  noticeGuideline: BrandGuideline | null;
  messages: RepresentativeMessage[];
  links: BrandLink[];
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

async function loadFromDb(companyId: string): Promise<BrandVoiceCacheEntry> {
  const [guidelineRes, messagesRes, linksRes] = await Promise.all([
    // ★ 2026-10-20 행 = main · notice 둘까지. 키를 지정해 읽는다(LIMIT 1 이면 notice 행이 옛 소비처에 섞인다)
    query(
      `SELECT memory_key, memory_value FROM ai_company_memory
       WHERE company_id = $1::uuid AND memory_type = 'brand_guideline' AND memory_key IN ('main', 'notice')`,
      [companyId],
    ),
    query(
      `SELECT memory_value FROM ai_company_memory
       WHERE company_id = $1::uuid AND memory_type = 'representative_message'
       ORDER BY memory_key ASC
       LIMIT 10`,
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
  ]);

  let guideline: BrandGuideline | null = null;
  let noticeGuideline: BrandGuideline | null = null;
  for (const row of guidelineRes.rows) {
    let parsed: BrandGuideline | null = null;
    try {
      const raw = row.memory_value;
      parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    } catch {
      parsed = null;
    }
    if (row.memory_key === 'notice') noticeGuideline = parsed;
    else guideline = parsed;
  }
  // ★ Codex 1020 R1 — 안부 문안만 있는 회사 = main 하나가 안부 말투(voice_kind notice · 복제 행 없음 = 진실 하나)
  if (!noticeGuideline && guideline?.voice_kind === 'notice') noticeGuideline = guideline;

  const messages: RepresentativeMessage[] = [];
  for (const row of messagesRes.rows) {
    try {
      const raw = row.memory_value;
      const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
      if (parsed && typeof parsed.message_text === 'string') {
        messages.push({
          channel: parsed.channel === 'MMS' ? 'MMS' : 'LMS',
          message_text: parsed.message_text,
          message_subject: parsed.message_subject || undefined,
          image_url: parsed.image_url || null,
          manual_priority: Number(parsed.manual_priority) || 0,
          kind: parsed.kind === 'notice' ? 'notice' : 'marketing',
        });
      }
    } catch {
      // skip
    }
  }
  messages.sort((a, b) => a.manual_priority - b.manual_priority);

  const links: BrandLink[] = [];
  for (const row of linksRes.rows) {
    try {
      const raw = row.memory_value;
      const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
      if (parsed && typeof parsed.url === 'string' && parsed.url.trim()) {
        links.push({
          id: row.id,
          label: String(parsed.label || row.memory_key || '').trim(),
          url: parsed.url.trim(),
        });
      }
    } catch {
      // skip
    }
  }

  return {
    guideline,
    noticeGuideline,
    messages,
    links,
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

/**
 * ★ 2026-10-20 이 성격의 말투를 배웠는가(AI 한줄로 확인 판 안내 한 줄). learned = 가이드라인이 하나라도 있음 ·
 * kindLearned = 그 성격 문안으로 뽑은 가이드라인이 있음(main 은 voice_kind 가 notice 가 아니면 마케팅 · 옛 행 포함).
 */
export async function getBrandVoiceFit(companyId: string, kind: BrandVoiceKind): Promise<{ learned: boolean; kindLearned: boolean }> {
  const data = await getBrandVoiceData(companyId);
  const learned = !!data.guideline || !!data.noticeGuideline;
  const kindLearned = kind === 'notice' ? !!data.noticeGuideline : !!data.guideline && data.guideline.voice_kind !== 'notice';
  return { learned, kindLearned };
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
 *   성격을 모르는 문안이 하나라도 있거나(★ R2) 문안이 있는 성격의 묶음이 빠지면 저장하지 않는다(불완전한 응답이 기존 학습을 지우거나 덮지 않게).
 */
export function planBrandVoiceRows<G>(kinds: ReadonlyArray<BrandVoiceKind | null>, byKind: Partial<Record<BrandVoiceKind, G>>):
  { ok: false; missing: BrandVoiceKind[]; unclassified: number } | { ok: true; main: G; notice: G | null } {
  const unclassified = kinds.filter((k) => k === null).length;
  const need = (['marketing', 'notice'] as const).filter((k) => kinds.includes(k));
  const missing = need.filter((k) => !byKind[k]);
  if (unclassified > 0 || need.length === 0 || missing.length > 0) return { ok: false, missing, unclassified };
  if (byKind.marketing) return { ok: true, main: byKind.marketing, notice: byKind.notice ?? null };
  return { ok: true, main: byKind.notice as G, notice: null };
}

/** 회사 브랜드 링크 (5분 TTL 캐시 공유 — CRUD 시 invalidateBrandVoiceCache 호출 의무) */
export async function getBrandLinks(companyId: string): Promise<BrandLink[]> {
  const data = await getBrandVoiceData(companyId);
  return data.links;
}

// ════════════════════════════════════════════════════════════════════
// 시스템 프롬프트 통합 — 6 호출 위치 공통 진입점
// ════════════════════════════════════════════════════════════════════

/**
 * 회사 brand voice 가이드라인 + 5 대표 문안 Few-shot 예시를 시스템 프롬프트에 자동 prefix.
 *
 * @param companyId 회사 UUID
 * @param basePrompt 옛 시스템 프롬프트 (사실 보존 base — 절대 변경 X)
 * @param opts.brandLinks true = 브랜드 링크 규칙 섹션 포함 (문자 생성 경로 한정 — 여정/이메일/DM 기본 OFF)
 * @param opts.kind ★ 2026-10-20 문자 성격. 주면 그 성격 가이드라인(안부 = notice 행 · 없으면 main) + 그 성격 대표 문안(없으면 전체).
 *   안 주면 지금과 글자 그대로(main + 전체 대표 문안).
 * @returns enriched prompt — 본 가이드라인 미존재 시 basePrompt 그대로 반환
 */
export async function buildSystemPromptWithBrandVoice(
  companyId: string | undefined,
  basePrompt: string,
  opts?: { brandLinks?: boolean; kind?: BrandVoiceKind },
): Promise<string> {
  if (!companyId) return basePrompt;

  let data: BrandVoiceCacheEntry;
  try {
    data = await getBrandVoiceData(companyId);
  } catch (err) {
    console.error('[Brand Voice] DB 조회 실패 — basePrompt 그대로 반환:', err);
    return basePrompt;
  }

  // ★ 2026-07-02 브랜드 링크 규칙 — 문자 생성 경로(opts.brandLinks)에서만. 가이드라인 유무와 독립.
  const linkSection = opts?.brandLinks
    ? buildBrandLinkPromptSection(data.links, data.guideline?.link_habit || null)
    : '';

  // ★ 2026-10-20 성격. 안부/알림이면 notice 가이드라인(없으면 main) · 대표 문안은 그 성격만(없으면 전체). 성격을 안 주면 지금 그대로.
  const kind = opts?.kind;
  const useNotice = kind === 'notice' && !!data.noticeGuideline;
  const chosen = useNotice ? data.noticeGuideline : data.guideline;
  const sameKind = kind ? data.messages.filter((m) => m.kind === kind) : [];
  const fewShotMessages = sameKind.length > 0 ? sameKind : data.messages;

  // ★ A6/B2-1 (2026-06-30): AND 완화 — 가이드라인만 있어도 톤 적용. 대표문안은 있으면 few-shot 보강, 없으면 생략.
  if (!chosen) {
    return linkSection ? `${basePrompt}${linkSection}` : basePrompt;
  }

  const g = chosen;
  const adPositionKr = g.ad_prefix_position === 'front' ? '본문 앞' : '본문 뒤';
  const rejectPositionKr = g.reject_position === 'front' ? '본문 앞' : '본문 뒤';
  const emojiListStr = g.emoji_whitelist.length > 0
    ? g.emoji_whitelist.join(' / ')
    : '(이모지 사용 없음)';

  const hasFewShot = fewShotMessages.length > 0;
  const fewShotSection = hasFewShot
    ? fewShotMessages.map((m, i) => {
        const meta = m.message_subject ? ` · 제목: ${m.message_subject}` : '';
        return `### 예시 ${i + 1} (채널: ${m.channel}${meta})\n${m.message_text}`;
      }).join('\n\n')
    : '';

  // ★ 2026-07-02 형태 준수 규칙 — 형태 명세 필드가 있을 때만 생성 (없으면 생략 = 기존 회사 영향 0).
  //   few-shot(참고)과 달리 "규칙"으로 격상 — AI가 자기 기본 스타일로 되돌아가는 것을 차단.
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
  if (g.symbol_style) {
    formSpecLines.push(`- 기호·구분선 스타일: ${g.symbol_style}`);
  }
  if (g.length_range && g.length_range.min_chars > 0 && g.length_range.max_chars >= g.length_range.min_chars) {
    formSpecLines.push(`- 본문 길이: ${g.length_range.min_chars}~${g.length_range.max_chars}자 범위로 작성하세요 (LMS/MMS 기준, SMS는 압축 규칙 우선).`);
  }
  const formSpecSection = formSpecLines.length > 0
    ? `
## 형태 준수 규칙 (참고가 아니라 규칙, 반드시 준수)

이 회사 대표 문안들에서 추출한 문안 형태입니다. 톤뿐 아니라 아래 형태 자체를 규칙으로 지키세요.

${formSpecLines.join('\n')}
`
    : '';

  // ★ 2026-10-20 안부/알림 가이드라인을 쓸 때만 문장이 바뀐다(광고 표기 · 080 · 광고 압축 줄 없음). 그 밖은 지금 글자 그대로.
  const voiceLabel = useNotice ? '안부 · 알림 문안' : '마케팅 문안 5건';
  const adLine = useNotice ? '' : `
- 광고 표기 "(광고)" 위치: ${adPositionKr}`;
  const rejectLine = useNotice ? '' : `
- 무료수신거부 080 위치: ${rejectPositionKr}`;
  const smsSection = useNotice
    ? `## SMS 자동 생성 시 압축 처리 의무

SMS 90바이트 한도입니다. 학습된 안부 · 알림 톤으로 핵심 안내 1건 + 빈출 표현 1건 우선 + 시그니처 생략 형식으로 압축하세요.
`
    : `## SMS 자동 생성 시 압축 처리 의무

SMS 90바이트 - (광고) 6바이트 - 무료수신거부080XXXXXXXX 18바이트 = 66바이트 = 33글자 한도입니다.
LMS 톤 학습 결과 기반으로 핵심 CTA 1건 + 빈출 표현 1건 우선 + 시그니처 생략 형식으로 자동 압축하세요.
`;
  const fewShotKindLabel = kind === 'notice' && sameKind.length > 0 ? '안부 · 알림 문안' : '마케팅 문안';

  const brandVoiceSection = `

## 회사 Brand Voice 가이드라인 (반드시 일치 의무)

본 회사의 ${voiceLabel} 분석 결과 자동 추출된 가이드라인입니다. AI 생성 문안은 본 가이드라인에 반드시 일치해야 회사 아이덴티티가 살아납니다.

- 톤 시그니처: ${g.tone_signature}
- 평균 길이: ${g.avg_length_chars} 글자 (${g.avg_length_bytes} 바이트)
- 빈출 표현 (1건 이상 자연 활용 의무): ${g.frequent_expressions.length > 0 ? g.frequent_expressions.join(' / ') : '(빈출 표현 없음)'}${adLine}
- 인사말 패턴: ${g.greeting_pattern || '(특정 패턴 없음)'}
- CTA 패턴 (1건 자연 활용): ${g.cta_patterns.length > 0 ? g.cta_patterns.join(' / ') : '(특정 CTA 없음)'}
- 시그니처 (메시지 마지막 부분): ${g.signature || '(시그니처 없음)'}${rejectLine}
- 활용 가능 이모지/특수문자: ${emojiListStr} (다른 이모지 절대 금지)
${formSpecSection}
${smsSection}
${hasFewShot ? `## In-Context Learning: 회사 대표 문안 Few-shot 예시

아래 ${fewShotMessages.length}건은 본 회사의 실제 ${fewShotKindLabel}입니다. AI 생성 문안은 본 톤/문체/구조를 자연스럽게 정합하세요. 단, 본문 내용 자체를 복사하지 말고 톤만 학습하세요.

${fewShotSection}
` : ''}
## 우선순위 충돌 시 처리

- 사실(혜택·날짜·금액) 충돌 시 = 사실 보존 우선 (회사 admin 작성 사실 정확성 > 톤 일치).
- ★ 톤/문체 충돌 시 = 본 Brand Voice의 "톤 시그니처: ${g.tone_signature}"를 최우선 적용하세요. base 프롬프트의 기본 감성·심리 카피 스타일보다 학습된 회사 톤을 우선합니다 (예: 학습 톤이 "정보/실용"이면 과한 감성 표현·미사여구를 빼고 정보·실용 중심으로 작성). 회사 아이덴티티 일치가 핵심입니다.

## ★ 출력 형식 재확인 (최우선)

위 회사 대표 문안은 톤 학습용 예시일 뿐입니다. 절대 예시 문안처럼 본문 텍스트만 단독 출력하지 마세요.
최종 응답은 반드시 앞에서 지정한 JSON 형식(코드펜스 없이 순수 JSON 객체) 그대로여야 합니다. 본문은 JSON 안 해당 필드 값으로만 작성하세요.`;

  return `${basePrompt}${brandVoiceSection}${linkSection}`;
}
