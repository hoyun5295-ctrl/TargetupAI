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
}

export interface RepresentativeMessage {
  channel: 'LMS' | 'MMS';
  message_text: string;
  message_subject?: string;
  image_url?: string | null;
  manual_priority: number;
}

interface BrandVoiceCacheEntry {
  guideline: BrandGuideline | null;
  messages: RepresentativeMessage[];
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
  const [guidelineRes, messagesRes] = await Promise.all([
    query(
      `SELECT memory_value FROM ai_company_memory
       WHERE company_id = $1::uuid AND memory_type = 'brand_guideline'
       LIMIT 1`,
      [companyId],
    ),
    query(
      `SELECT memory_value FROM ai_company_memory
       WHERE company_id = $1::uuid AND memory_type = 'representative_message'
       ORDER BY memory_key ASC
       LIMIT 10`,
      [companyId],
    ),
  ]);

  let guideline: BrandGuideline | null = null;
  if (guidelineRes.rows[0]) {
    try {
      const raw = guidelineRes.rows[0].memory_value;
      guideline = typeof raw === 'string' ? JSON.parse(raw) : raw;
    } catch {
      guideline = null;
    }
  }

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
        });
      }
    } catch {
      // skip
    }
  }
  messages.sort((a, b) => a.manual_priority - b.manual_priority);

  return {
    guideline,
    messages,
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
// 시스템 프롬프트 통합 — 6 호출 위치 공통 진입점
// ════════════════════════════════════════════════════════════════════

/**
 * 회사 brand voice 가이드라인 + 5 대표 문안 Few-shot 예시를 시스템 프롬프트에 자동 prefix.
 *
 * @param companyId 회사 UUID
 * @param basePrompt 옛 시스템 프롬프트 (사실 보존 base — 절대 변경 X)
 * @returns enriched prompt — 본 가이드라인 미존재 시 basePrompt 그대로 반환
 */
export async function buildSystemPromptWithBrandVoice(
  companyId: string | undefined,
  basePrompt: string,
): Promise<string> {
  if (!companyId) return basePrompt;

  let data: BrandVoiceCacheEntry;
  try {
    data = await getBrandVoiceData(companyId);
  } catch (err) {
    console.error('[Brand Voice] DB 조회 실패 — basePrompt 그대로 반환:', err);
    return basePrompt;
  }

  // ★ A6/B2-1 (2026-06-30): AND 완화 — 가이드라인만 있어도 톤 적용. 대표문안은 있으면 few-shot 보강, 없으면 생략.
  if (!data.guideline) {
    return basePrompt;
  }

  const g = data.guideline;
  const adPositionKr = g.ad_prefix_position === 'front' ? '본문 앞' : '본문 뒤';
  const rejectPositionKr = g.reject_position === 'front' ? '본문 앞' : '본문 뒤';
  const emojiListStr = g.emoji_whitelist.length > 0
    ? g.emoji_whitelist.join(' / ')
    : '(이모지 사용 없음)';

  const hasFewShot = data.messages.length > 0;
  const fewShotSection = hasFewShot
    ? data.messages.map((m, i) => {
        const meta = m.message_subject ? ` · 제목: ${m.message_subject}` : '';
        return `### 예시 ${i + 1} (채널: ${m.channel}${meta})\n${m.message_text}`;
      }).join('\n\n')
    : '';

  const brandVoiceSection = `

## 회사 Brand Voice 가이드라인 (반드시 일치 의무)

본 회사의 마케팅 문안 5건 분석 결과 자동 추출된 가이드라인입니다. AI 생성 문안은 본 가이드라인에 반드시 일치해야 회사 아이덴티티가 살아납니다.

- 톤 시그니처: ${g.tone_signature}
- 평균 길이: ${g.avg_length_chars} 글자 (${g.avg_length_bytes} 바이트)
- 빈출 표현 (1건 이상 자연 활용 의무): ${g.frequent_expressions.length > 0 ? g.frequent_expressions.join(' / ') : '(빈출 표현 없음)'}
- 광고 표기 "(광고)" 위치: ${adPositionKr}
- 인사말 패턴: ${g.greeting_pattern || '(특정 패턴 없음)'}
- CTA 패턴 (1건 자연 활용): ${g.cta_patterns.length > 0 ? g.cta_patterns.join(' / ') : '(특정 CTA 없음)'}
- 시그니처 (메시지 마지막 부분): ${g.signature || '(시그니처 없음)'}
- 무료수신거부 080 위치: ${rejectPositionKr}
- 활용 가능 이모지/특수문자: ${emojiListStr} (다른 이모지 절대 금지)

## SMS 자동 생성 시 압축 처리 의무

SMS 90바이트 - (광고) 6바이트 - 무료수신거부080XXXXXXXX 18바이트 = 66바이트 = 33글자 한도입니다.
LMS 톤 학습 결과 기반으로 핵심 CTA 1건 + 빈출 표현 1건 우선 + 시그니처 생략 형식으로 자동 압축하세요.

${hasFewShot ? `## In-Context Learning — 회사 대표 문안 Few-shot 예시

아래 ${data.messages.length}건은 본 회사의 실제 마케팅 문안입니다. AI 생성 문안은 본 톤/문체/구조를 자연스럽게 정합하세요. 단, 본문 내용 자체를 복사하지 말고 톤만 학습하세요.

${fewShotSection}
` : ''}
## 우선순위 충돌 시 처리

본 Brand Voice 가이드라인과 옛 시스템 프롬프트(사실 보존 base) 충돌 시 = 사실 보존을 우선합니다 (회사 admin 작성 사실 정확성 > 톤 일치).

## ★ 출력 형식 재확인 (최우선)

위 회사 대표 문안은 톤 학습용 예시일 뿐입니다. 절대 예시 문안처럼 본문 텍스트만 단독 출력하지 마세요.
최종 응답은 반드시 앞에서 지정한 JSON 형식(코드펜스 없이 순수 JSON 객체) 그대로여야 합니다. 본문은 JSON 안 해당 필드 값으로만 작성하세요.`;

  return `${basePrompt}${brandVoiceSection}`;
}
