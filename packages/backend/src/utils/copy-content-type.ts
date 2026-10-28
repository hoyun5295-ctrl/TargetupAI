/**
 * 문안 종류 · 성격 CT (★ 2026-10-28 AI 메모리 설계 K4 · I4 · I5 · docs/2026-10-28-ai-memory-brand-voice-design.md)
 *
 * 종류 5 = 상수 하나 · 성격(마케팅 · 안부/알림)은 종류에서만 파생한다.
 * 생성 때 순서 = 입력 종류 > 생산자 목적 코드 > AI 판정 > 광고 여부(마지막 수단 · 저장 안 함).
 * 광고 여부는 법 축(바이트 · 광고 문장)만 정한다 · 종류 · 성격이 바꾸지 못한다(K4-5).
 */
import type { BrandVoiceKind } from './brand-voice-prompt';

export const COPY_CONTENT_TYPES = ['promo', 'launch', 'howto', 'greeting', 'notice'] as const;
export type CopyContentType = typeof COPY_CONTENT_TYPES[number];

/** 화면 라벨(서버가 내린다 · 화면은 그린다) */
export const COPY_CONTENT_TYPE_LABEL: Record<CopyContentType, string> = {
  promo: '행사 · 할인',
  launch: '신제품 · 입고',
  howto: '기능 · 사용법',
  greeting: '안부 · 감사',
  notice: '공지 · 안내',
};

export function isCopyContentType(v: unknown): v is CopyContentType {
  return typeof v === 'string' && (COPY_CONTENT_TYPES as readonly string[]).includes(v);
}

/** 성격 = 종류에서만 파생(안부 · 공지 = notice · 나머지 = marketing) */
export function kindOfContentType(t: CopyContentType): BrandVoiceKind {
  return t === 'greeting' || t === 'notice' ? 'notice' : 'marketing';
}

/** 여정 목적 코드(journeys.template_code) → 종류 · custom = 없음 */
const JOURNEY_PURPOSE: Record<string, CopyContentType> = {
  onboarding: 'greeting', birthday: 'greeting', reservation: 'notice',
  repeat: 'promo', dormant: 'promo', cart: 'promo',
};
/** 자동마케팅 운영자 대상 힌트(target_hint) → 종류 · all = 없음 */
const OPERATOR_PURPOSE: Record<string, CopyContentType> = {
  birthday: 'greeting', new_customers: 'greeting',
  dormant: 'promo', vip: 'promo', recent_buyers: 'promo',
};

export interface CopyPurpose { journeyTemplate?: string | null; operatorTargetHint?: string | null }

export function contentTypeOfPurpose(p: CopyPurpose | null | undefined): CopyContentType | null {
  if (!p) return null;
  return JOURNEY_PURPOSE[String(p.journeyTemplate || '')] ?? OPERATOR_PURPOSE[String(p.operatorTargetHint || '')] ?? null;
}

export type CopyIntentSource = 'input' | 'purpose' | 'ai' | 'ad';

/**
 * (순수) 생성 때 종류 · 성격 판정 순서(K4-4). 종류를 하나도 못 정하면 성격만 광고 여부로(저장하지 않는 마지막 수단).
 */
export function resolveCopyIntent(input: {
  inputType?: unknown;
  purpose?: CopyPurpose | null;
  aiType?: unknown;
  isAd: boolean;
}): { contentType: CopyContentType | null; kind: BrandVoiceKind; source: CopyIntentSource } {
  if (isCopyContentType(input.inputType)) return { contentType: input.inputType, kind: kindOfContentType(input.inputType), source: 'input' };
  const byPurpose = contentTypeOfPurpose(input.purpose);
  if (byPurpose) return { contentType: byPurpose, kind: kindOfContentType(byPurpose), source: 'purpose' };
  if (isCopyContentType(input.aiType)) return { contentType: input.aiType, kind: kindOfContentType(input.aiType), source: 'ai' };
  return { contentType: null, kind: input.isAd ? 'marketing' : 'notice', source: 'ad' };
}

/** AI 판정 지시(추출 · 사실 읽기 · 짧은 판정이 같은 문장을 쓴다) */
export const CONTENT_TYPE_JUDGE_RULES = `- promo = 할인 · 쿠폰 · 이벤트 · 행사 · 특가처럼 혜택으로 구매를 권하는 글
- launch = 신제품 · 신상 · 입고 · 출시 · 재입고 소식
- howto = 기능 · 사용법 · 성분 · 관리 방법 설명
- greeting = 안부 · 감사 인사 · 생일 · 기념일 축하
- notice = 공지 · 배송 · 예약 · 소멸 · 영업시간 같은 안내
- 어느 쪽인지 정할 수 없으면 null`;

// ─────────────── 짧은 판정 호출(직접 생성 · 옛 자동발송 = 목적 칸 없음 · K4-4) ───────────────

const CLASSIFY_TTL_MS = 24 * 60 * 60 * 1000;
const classifyCache = new Map<string, { type: CopyContentType | null; expiresAt: number }>();

function classifyKey(companyId: string, text: string): string {
  // 같은 회사 + 같은 글 = 같은 판정(프로세스 캐시 24시간)
  let h = 0;
  for (let i = 0; i < text.length; i++) h = (h * 31 + text.charCodeAt(i)) | 0;
  return `${companyId}:${text.length}:${h}`;
}

/**
 * 생성 앞 종류 판정 1회(단가 0 · 사람이 누른 생성 한 번의 안쪽 호출). 실패 · 모름 = null(생성을 막지 않는다).
 * 회사 id 를 AI 호출에 넘기지 않는다 = 회사 월 AI 호출 한도를 한 번 더 세지 않는다(한도 면제 목록은 손대지 않음 · 캐시 키는 회사별).
 * callAI 는 호출부가 넘긴다(services/ai 를 이 파일이 import 하면 순환).
 */
export async function classifyCopyIntent(
  companyId: string,
  text: string,
  callAI: (p: { system: string; userMessage: string; maxTokens: number; temperature: number; source: string; creditCost: number }) => Promise<string>,
): Promise<CopyContentType | null> {
  const src = String(text || '').trim().slice(0, 500);
  if (!companyId || src.length < 2) return null;
  const key = classifyKey(companyId, src);
  const hit = classifyCache.get(key);
  if (hit && hit.expiresAt > Date.now()) return hit.type;
  let type: CopyContentType | null = null;
  try {
    const raw = await callAI({
      system: `문자 요청 한 줄의 종류를 하나로 판정합니다.\n${CONTENT_TYPE_JUDGE_RULES}\n응답 = promo · launch · howto · greeting · notice · null 중 한 낱말만.`,
      userMessage: src,
      maxTokens: 10,
      temperature: 0,
      source: 'copy-intent-classify',
      creditCost: 0,
    });
    const word = String(raw || '').trim().toLowerCase().replace(/[^a-z]/g, '');
    type = isCopyContentType(word) ? word : null;
  } catch {
    type = null;
  }
  classifyCache.set(key, { type, expiresAt: Date.now() + CLASSIFY_TTL_MS });
  return type;
}
