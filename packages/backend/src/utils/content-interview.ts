/**
 * content-interview.ts — 원스텝 AI 컨텐츠 생성: 인터뷰 판정 CT (순수 · ★ 2026-08-13 Phase 1)
 *
 * 설계서 = docs/2026-08-13-one-step-content-interview-design.md (판정 원장 §0 · 질문표 §2 · 백엔드 §4)
 *
 * **마케터는 질문에 답하고, 마스터프롬프트는 시스템이 조립한다.**
 * 이 파일이 소유하는 것 = 질문표 · 분기(보이는 질문) · 답 검증 · 파생 기본값 · 결정값(decisions) · 원문 직렬화.
 *
 * ⛔ 불변 (설계서 §0)
 *   - **AI를 부르지 않는다. DB를 만지지 않는다.** (계약 테스트가 import 0을 고정 — 인터뷰가 무과금인 근거)
 *   - **원문(eventText)에는 사용자가 직접 타이핑·확인한 값만 넣는다**(§0-6). 기계가 채운 프리필을 섞으면
 *     그 값이 "사용자가 직접 입력한 사실" 자격을 얻어 환각 차단 가드가 자기 참조가 된다.
 *   - **혜택은 프리필하지 않는다**(AI 임의 혜택 금지). 비면 그 축을 결과에서 뺀다 — 억지로 채우지 않는다.
 *   - **긴급성은 마감 시각이 실존할 때만 ON**(§0 판정 C). 기간 문구만 있는 원문으로 카운트다운을 켜면
 *     마감 없는 카운트다운이 나간다.
 *   - **증거(리뷰·영상·인스타)는 파생할 수 없다**(§0-4). 물어야만 알고, 안 물었으면 기본 OFF다.
 *   - **모르는 질문 키는 500이 아니라 무시**한다(버전이 올라가 저장된 세션에 옛 키가 남았을 때).
 */

// ── 축 ───────────────────────────────────────────────────────────────
export const INTERVIEW_QUESTION_KEYS = [
  'objective', 'products', 'benefit', 'urgency', 'proof', 'imageSource', 'storeInfo',
] as const;
export type InterviewQuestionKey = (typeof INTERVIEW_QUESTION_KEYS)[number];

/** Q1 — 무엇을 알리는가. 구성 공식을 고르는 축이다(§2-3). */
export const INTERVIEW_OBJECTIVES = ['new_product', 'promotion', 'bestseller', 'brand_story', 'store_visit'] as const;
export type InterviewObjective = (typeof INTERVIEW_OBJECTIVES)[number];

export type UrgencyKind = 'deadline' | 'quantity' | 'none';
export type ProofKind = 'review' | 'video' | 'instagram' | 'none';
export type ImageSource = 'studio' | 'upload' | 'product';

/** 상품 1건 — `origin`이 원문 자격을 가른다(mall = 기계가 채움 → 원문에 넣지 않는다). */
export interface InterviewProduct {
  name: string;
  price?: string;
  url?: string;
  origin: 'mall' | 'manual';
}

export interface InterviewAnswers {
  objective?: InterviewObjective;
  products?: InterviewProduct[];
  /** null = "혜택 없음"을 사용자가 고른 것. undefined = 아직 안 답함. */
  benefit?: string | null;
  urgency?: { kind: UrgencyKind; endsAt?: string; quantity?: number };
  proof?: { kind: ProofKind; text?: string; url?: string };
  imageSource?: ImageSource;
  storeInfo?: boolean;
  /** 자유 보충 1칸 — 사용자가 직접 쓴 것이라 원문에 [유의사항]으로 들어간다. */
  note?: string;
}

/** 프리필 조회 결과(서버가 채워 넘긴다 — 이 파일은 조회하지 않는다). */
export interface InterviewContext {
  eventTitle?: string;
  startsOn?: string;
  endsOn?: string;
  /** ⛔ 마감 **시각**이 실존할 때만 값이 있다. 기간 문구만 있는 경우는 null이어야 한다(§0 판정 C). */
  periodEnd?: string | null;
  /** 연동몰 정확 일치분만(애매·부분 일치는 넘기지 않는다). */
  mallProducts?: InterviewProduct[];
  hasStoreAddress?: boolean;
}

// ── 질문표 v1 ────────────────────────────────────────────────────────
export interface InterviewQuestion {
  key: InterviewQuestionKey;
  /** 화면 문구 — 고객 언어. 내부 코드명·개발 용어를 쓰지 않는다. */
  title: string;
  hint?: string;
  /** true = 프리필이 불가능한 축(사용자만 안다). */
  userOnly?: boolean;
}

export const INTERVIEW_QUESTIONS: Record<InterviewQuestionKey, InterviewQuestion> = {
  objective: { key: 'objective', title: '무엇을 알리는 건가요?' },
  products: { key: 'products', title: '어떤 상품인가요?', hint: '연동된 쇼핑몰에서 고르거나 직접 적을 수 있어요' },
  benefit: {
    key: 'benefit', title: '혜택이 있나요?', userOnly: true,
    hint: '직접 입력. AI가 대신 만들지 않습니다. 비워 두면 혜택 안내 없이 만듭니다',
  },
  urgency: { key: 'urgency', title: '언제까지인가요?', hint: '마감이 있으면 남은 시간을, 수량이 한정이면 남은 수량을 보여줍니다' },
  proof: { key: 'proof', title: '보여줄 후기나 영상이 있나요?', userOnly: true, hint: '없는 후기는 만들지 않습니다' },
  imageSource: { key: 'imageSource', title: '이미지는 어떻게 할까요?' },
  storeInfo: { key: 'storeInfo', title: '매장·문의 안내를 넣을까요?' },
};

/**
 * (순수) 보이는 질문 — 분기의 전부.
 * ⛔ 브랜드 이야기에는 긴급성을 묻지 않는다(장치 자체를 안 넣으므로 물으면 죽은 질문이 된다).
 * ⛔ header·footer·hero·cta는 묻지 않는다 — 정규화가 강제하는 축이라 답이 반영될 자리가 없다(§0 판정 D).
 */
export function visibleQuestions(answers: InterviewAnswers): InterviewQuestion[] {
  return INTERVIEW_QUESTION_KEYS
    .filter((key) => !(key === 'urgency' && answers.objective === 'brand_story'))
    .map((key) => INTERVIEW_QUESTIONS[key]);
}

/** (순수) 다음에 물을 질문 — 아직 답이 없는 첫 번째. 없으면 null(= 생성 준비 완료). */
export function nextQuestion(answers: InterviewAnswers): InterviewQuestion | null {
  return visibleQuestions(answers).find((q) => !isAnswered(answers, q.key)) || null;
}

function isAnswered(answers: InterviewAnswers, key: InterviewQuestionKey): boolean {
  const v = (answers as Record<string, unknown>)[key];
  if (v === undefined) return false;
  if (key === 'products') return Array.isArray(v) && v.length > 0;
  return true; // benefit=null(없음), storeInfo=false 도 답한 것이다
}

/** (순수) 사용자가 직접 채워야만 하는 축이 몇 개 남았는가 — 화면 "확인할 것 N개". */
export function remainingUserInputs(answers: InterviewAnswers): number {
  return visibleQuestions(answers).filter((q) => q.userOnly && !isAnswered(answers, q.key)).length;
}

// ── 검증 ─────────────────────────────────────────────────────────────
export interface ValidationResult { ok: boolean; error?: string }

const HTTPS_HOSTS: Record<Exclude<ProofKind, 'review' | 'none'>, string[]> = {
  video: ['youtube.com', 'youtu.be', 'vimeo.com'],
  instagram: ['instagram.com'],
};

/**
 * (순수) 증거 URL 형식 검증 — **도달성은 확인하지 않는다**(설계서 §6-3).
 * 외부 호출은 원가·지연·실패 축을 늘리고, 외부 응답 때문에 생성이 막히면 안 된다.
 */
export function isValidProofUrl(kind: ProofKind, url: string): boolean {
  if (kind === 'review' || kind === 'none') return true;
  try {
    const u = new URL(String(url));
    if (u.protocol !== 'https:') return false;
    const host = u.hostname.replace(/^www\./, '');
    return HTTPS_HOSTS[kind].some((h) => host === h || host.endsWith(`.${h}`));
  } catch {
    return false;
  }
}

/** (순수) 답 1건 검증. 모르는 키는 오류가 아니라 무시 대상이다(버전 드리프트에 500을 내지 않는다). */
export function validateAnswer(key: string, value: unknown): ValidationResult {
  if (!INTERVIEW_QUESTION_KEYS.includes(key as InterviewQuestionKey)) {
    return { ok: false, error: 'unknown_key' };
  }
  switch (key as InterviewQuestionKey) {
    case 'objective':
      return INTERVIEW_OBJECTIVES.includes(value as InterviewObjective)
        ? { ok: true } : { ok: false, error: '무엇을 알리는지 선택해 주세요.' };
    case 'products': {
      if (!Array.isArray(value)) return { ok: false, error: '상품을 선택하거나 직접 적어 주세요.' };
      if (value.length === 0) return { ok: false, error: '상품을 1개 이상 골라 주세요.' };
      const bad = value.some((p: any) => !p || !String(p.name || '').trim());
      return bad ? { ok: false, error: '상품명이 비어 있습니다.' } : { ok: true };
    }
    case 'benefit':
      if (value === null) return { ok: true }; // "없음"
      return typeof value === 'string' && value.trim().length > 0 && value.length <= 300
        ? { ok: true } : { ok: false, error: '혜택 문구를 300자 이내로 적어 주세요.' };
    case 'urgency': {
      const v = value as InterviewAnswers['urgency'];
      if (!v || !['deadline', 'quantity', 'none'].includes(v.kind)) return { ok: false, error: '마감 여부를 선택해 주세요.' };
      // ⛔ 마감을 골랐으면 **시각**이 있어야 한다 — 없으면 마감 없는 카운트다운이 나간다.
      if (v.kind === 'deadline' && !isIsoLike(v.endsAt)) return { ok: false, error: '마감 일시를 정확히 지정해 주세요.' };
      if (v.kind === 'quantity' && !(Number(v.quantity) > 0)) return { ok: false, error: '한정 수량을 1 이상으로 적어 주세요.' };
      return { ok: true };
    }
    case 'proof': {
      const v = value as InterviewAnswers['proof'];
      if (!v || !['review', 'video', 'instagram', 'none'].includes(v.kind)) return { ok: false, error: '증거 자료를 선택해 주세요.' };
      if (v.kind === 'review') {
        return String(v.text || '').trim() ? { ok: true } : { ok: false, error: '보여줄 후기 내용을 적어 주세요.' };
      }
      if (v.kind === 'none') return { ok: true };
      return isValidProofUrl(v.kind, String(v.url || ''))
        ? { ok: true } : { ok: false, error: '주소를 다시 확인해 주세요. (https 주소만 넣을 수 있어요)' };
    }
    case 'imageSource':
      return ['studio', 'upload', 'product'].includes(value as string)
        ? { ok: true } : { ok: false, error: '이미지를 어떻게 할지 선택해 주세요.' };
    case 'storeInfo':
      return typeof value === 'boolean' ? { ok: true } : { ok: false, error: '매장 안내 여부를 선택해 주세요.' };
  }
}

function isIsoLike(v: unknown): boolean {
  return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2})/.test(v);
}

/** (순수) 저장된 답 세트 정화 — 모르는 키·형식 오류를 버린다(500 금지). */
export function sanitizeAnswers(raw: unknown): InterviewAnswers {
  const out: Record<string, unknown> = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (k === 'note') { if (typeof v === 'string') out.note = v.slice(0, 500); continue; }
    if (validateAnswer(k, v).ok) out[k] = v;
  }
  return out;
}

// ── 파생 기본값 (1클릭 완주의 실체 · §4-3) ──────────────────────────
/**
 * (순수) 안 물어본 축을 프리필·파생으로 메운다. **전부 축소 방향**이라
 * "예측으로 타겟 선정 금지"·"0건 자동완화 금지"와 부딪히지 않는다.
 */
export function applyDerivedDefaults(answers: InterviewAnswers, ctx: InterviewContext): InterviewAnswers {
  const out: InterviewAnswers = { ...answers };
  if (out.objective === undefined) out.objective = guessObjective(ctx.eventTitle);
  if (out.products === undefined) out.products = ctx.mallProducts ? [...ctx.mallProducts] : [];
  // ⛔ 혜택은 파생하지 않는다 — 비면 비운 채로 간다.
  if (out.benefit === undefined) out.benefit = null;
  if (out.urgency === undefined) {
    out.urgency = ctx.periodEnd ? { kind: 'deadline', endsAt: ctx.periodEnd } : { kind: 'none' };
  }
  // ⛔ 증거는 파생 불가 — 안 물었으면 넣지 않는다.
  if (out.proof === undefined) out.proof = { kind: 'none' };
  if (out.imageSource === undefined) {
    out.imageSource = (ctx.mallProducts && ctx.mallProducts.length > 0) ? 'product' : 'studio';
  }
  if (out.storeInfo === undefined) out.storeInfo = !!ctx.hasStoreAddress;
  return out;
}

/** (순수) 행사명에서 목적 추정 — 결정적 정규식. 못 고르면 신상품(가장 무난한 기본). */
export function guessObjective(title?: string): InterviewObjective {
  const t = String(title || '');
  if (/매장|오픈|방문|팝업/.test(t)) return 'store_visit';
  if (/세일|할인|특가|프로모션|이벤트/.test(t)) return 'promotion';
  if (/베스트|인기|추천|위시/.test(t)) return 'bestseller';
  if (/신상|출시|런칭|新/.test(t)) return 'new_product';
  if (/브랜드|이야기|스토리/.test(t)) return 'brand_story';
  return 'new_product';
}

// ── 결정값 ───────────────────────────────────────────────────────────
/** 생성기의 AI 산출을 **덮는** 결정값. 프롬프트 문장이 아니라 파라미터로 간다(신호 충돌 방지). */
export interface InterviewDecisions {
  objective: InterviewObjective;
  urgency: UrgencyKind;
  urgencyEndsAt?: string;
  urgencyQuantity?: number;
  proof: ProofKind;
  proofText?: string;
  proofUrl?: string;
  curationCount: number;
  imageSource: ImageSource;
  storeShown: boolean;
  /** 몰에서 온 상품 — 원문에 넣지 않고 여기로만 전달한다(§0-6). */
  mallProducts: InterviewProduct[];
}

export function buildDecisions(answers: InterviewAnswers, ctx: InterviewContext): InterviewDecisions {
  const a = applyDerivedDefaults(answers, ctx);
  const products = a.products || [];
  return {
    objective: a.objective as InterviewObjective,
    urgency: a.urgency?.kind || 'none',
    urgencyEndsAt: a.urgency?.kind === 'deadline' ? a.urgency.endsAt : undefined,
    urgencyQuantity: a.urgency?.kind === 'quantity' ? a.urgency.quantity : undefined,
    proof: a.proof?.kind || 'none',
    proofText: a.proof?.kind === 'review' ? a.proof.text : undefined,
    proofUrl: a.proof?.kind === 'video' || a.proof?.kind === 'instagram' ? a.proof.url : undefined,
    curationCount: products.length,
    imageSource: a.imageSource as ImageSource,
    storeShown: !!a.storeInfo,
    mallProducts: products.filter((p) => p.origin === 'mall'),
  };
}

// ── 원문 직렬화 (§0-6 · 라벨은 EventBrief 필드와 1:1) ────────────────
/**
 * (순수) 마스터프롬프트의 **사실 축** — 사용자가 직접 타이핑·확인한 값만 라벨 문장으로 조립한다.
 *
 * ⛔ 몰에서 가져온 상품은 넣지 않는다. 원문은 "사용자가 직접 입력한 사실"로 선언되어
 *   환각 차단 가드 전부의 판정 기준이 되므로, 기계가 채운 값이 들어가면 그 가드가 자기 참조가 된다.
 * ⛔ 라벨 집합은 EventBrief 필드와 1:1이다 — 새 라벨을 만들면 그 축은 커버리지가 영원히 못 잡는다.
 */
export function buildInterviewEventText(answers: InterviewAnswers, ctx: InterviewContext): string {
  const lines: string[] = [];
  if (ctx.eventTitle) lines.push(`[행사명] ${ctx.eventTitle}`);
  if (ctx.startsOn && ctx.endsOn) lines.push(`[기간] ${ctx.startsOn} ~ ${ctx.endsOn}`);
  const benefit = typeof answers.benefit === 'string' ? answers.benefit.trim() : '';
  if (benefit) lines.push(`[혜택] ${benefit}`);
  const manual = (answers.products || []).filter((p) => p.origin === 'manual').map((p) => p.name.trim()).filter(Boolean);
  if (manual.length > 0) lines.push(`[상품] ${manual.join(', ')}`);
  const note = String(answers.note || '').trim();
  if (note) lines.push(`[유의사항] ${note}`);
  return lines.join('\n');
}

/** 마스터프롬프트 = 사실 원문 + 결정값. 톤은 기존 문안 두뇌가 주입하므로 여기 없다. */
export interface MasterBrief {
  eventText: string;
  decisions: InterviewDecisions;
}

export function buildMasterBrief(answers: InterviewAnswers, ctx: InterviewContext): MasterBrief {
  return {
    eventText: buildInterviewEventText(answers, ctx),
    decisions: buildDecisions(answers, ctx),
  };
}
