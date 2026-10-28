/**
 * 문자 생성 출구 CT (★ 2026-10-28 AI 메모리 설계 K12 · I14 · docs/2026-10-28-ai-memory-brand-voice-design.md)
 *
 * applyCopyExitGuards = generateMessages 의 안 하나 출구 고리(옛 services/ai.ts 1366~1503)를 옮긴 것 · 견본(K9)도 같은 함수.
 *   순서 = (광고) · 080 제거 → 스타일 후처리(구분선 · 빈 줄 = 회사 기준 · K2-3) → 이모지(글자표 = 법) → 템플릿 문법 → 금지어
 *        → 혜택 · 효능 · 날짜(법 · 근거 글 대조) → 제목 같은 대조 → 변수 검증 → 링크 → 전송자 명칭(K1-1) → 직접 채울 칸 잔존 판정(K12-3).
 * 회차 재생성 예산(K12-2) = 한 회차(자동마케팅 · 운영자) 생성 호출 상한 하나를 바깥 · 안쪽 재생성이 함께 쓴다.
 * 도우미 셋(바이트 셈 · 이모지 빼기 · 변수 검증)은 services/ai.ts 에서 글자 그대로 옮겼다(순환 import 없이 출구 CT 가 쓰게).
 */
import { AsyncLocalStorage } from 'node:async_hooks';
import { detectLiquidSyntax, flattenLiquidToPlainText } from './liquid-templating';
import { findBannedWords } from './copy-similarity-guard';
import { findInventedBenefits, replaceInventedBenefits, dropInventedEfficacy, findInventedDates, replaceInventedDates, hasAiFillPlaceholder } from './copy-benefit-detector';
import { cleanLeftoverVars, ensureSenderName } from './messageUtils';
import { applyBrandLinkTokens, type BrandLink } from './brand-link-core';

/**
 * 메시지 내 개인화 변수 검증
 * - 메시지에서 %...% 패턴을 추출하여 available_vars에 없는 것이 있으면 invalid 반환
 * - 발송 전 반드시 호출하여 잘못된 변수가 고객에게 노출되는 것을 방지
 */
export function validatePersonalizationVars(
  message: string,
  availableVars: string[]
): { valid: boolean; invalidVars: string[] } {
  const found = message.match(/%[^%\s]{1,20}%/g) || [];
  const varNames = found.map(v => v.replace(/%/g, ''));
  const invalidVars = varNames.filter(v => !availableVars.includes(v));
  return { valid: invalidVars.length === 0, invalidVars };
}

// ============================================================
// SMS 바이트 계산 (한글 2바이트, 영문/숫자/특수문자 1바이트)
export function calculateKoreanBytes(text: string): number {
  let bytes = 0;
  for (let i = 0; i < text.length; i++) {
    bytes += text.charCodeAt(i) > 127 ? 2 : 1;
  }
  return bytes;
}

/**
 * SMS/LMS/MMS 이모지 강제 제거 안전장치
 * - AI가 프롬프트 무시하고 이모지를 넣는 경우 후처리로 제거
 * - 허용: ★☆●○◎◇◆□■△▲▽▼→←↑↓♠♣♥♡♦※☎▶◀【】「」『』 등 KS X 1001 특수문자
 * - 제거: 유니코드 이모지 (Emoticons, Pictographs, Transport, Flags 등)
 * - 카카오 채널은 이모지 허용이므로 호출하지 않음
 */
export function stripEmojis(text: string): string {
  return text
    // Surrogate pair 이모지 (U+1F000 이상) — 대부분의 컬러 이모지
    .replace(/[\u{1F600}-\u{1F64F}]/gu, '')   // Emoticons
    .replace(/[\u{1F300}-\u{1F5FF}]/gu, '')   // Misc Symbols & Pictographs
    .replace(/[\u{1F680}-\u{1F6FF}]/gu, '')   // Transport & Map
    .replace(/[\u{1F700}-\u{1F77F}]/gu, '')   // Alchemical
    .replace(/[\u{1F780}-\u{1F7FF}]/gu, '')   // Geometric Extended
    .replace(/[\u{1F800}-\u{1F8FF}]/gu, '')   // Supplemental Arrows
    .replace(/[\u{1F900}-\u{1F9FF}]/gu, '')   // Supplemental Symbols
    .replace(/[\u{1FA00}-\u{1FA6F}]/gu, '')   // Chess Symbols
    .replace(/[\u{1FA70}-\u{1FAFF}]/gu, '')   // Symbols Extended-A
    .replace(/[\u{1F1E0}-\u{1F1FF}]/gu, '')   // Regional Indicators (Flags)
    .replace(/[\u{231A}-\u{231B}]/gu, '')     // ⌚⌛
    .replace(/[\u{23E9}-\u{23F3}]/gu, '')     // ⏩~⏳
    .replace(/[\u{23F8}-\u{23FA}]/gu, '')     // ⏸~⏺
    .replace(/[\u{25FB}-\u{25FE}]/gu, '')     // ◻◼◽◾
    .replace(/[\u{2614}-\u{2615}]/gu, '')     // ☔☕
    .replace(/[\u{2648}-\u{2653}]/gu, '')     // ♈~♓ (별자리)
    .replace(/[\u{267F}]/gu, '')              // ♿
    .replace(/[\u{2693}]/gu, '')              // ⚓
    .replace(/[\u{26A1}]/gu, '')              // ⚡
    .replace(/[\u{26AA}-\u{26AB}]/gu, '')     // ⚪⚫
    .replace(/[\u{26BD}-\u{26BE}]/gu, '')     // ⚽⚾
    .replace(/[\u{26C4}-\u{26C5}]/gu, '')     // ⛄⛅
    .replace(/[\u{26D4}]/gu, '')              // ⛔
    .replace(/[\u{26EA}]/gu, '')              // ⛪
    .replace(/[\u{26F2}-\u{26F3}]/gu, '')     // ⛲⛳
    .replace(/[\u{26F5}]/gu, '')              // ⛵
    .replace(/[\u{26FA}]/gu, '')              // ⛺
    .replace(/[\u{26FD}]/gu, '')              // ⛽
    .replace(/[\u{2702}]/gu, '')              // ✂
    .replace(/[\u{2705}]/gu, '')              // ✅
    .replace(/[\u{2708}-\u{270D}]/gu, '')     // ✈~✍
    .replace(/[\u{270F}]/gu, '')              // ✏
    .replace(/[\u{2712}]/gu, '')              // ✒
    .replace(/[\u{2714}]/gu, '')              // ✔
    .replace(/[\u{2716}]/gu, '')              // ✖
    .replace(/[\u{271D}]/gu, '')              // ✝
    .replace(/[\u{2721}]/gu, '')              // ✡
    .replace(/[\u{2728}]/gu, '')              // ✨
    .replace(/[\u{2733}-\u{2734}]/gu, '')     // ✳✴
    .replace(/[\u{2744}]/gu, '')              // ❄
    .replace(/[\u{2747}]/gu, '')              // ❇
    .replace(/[\u{274C}]/gu, '')              // ❌
    .replace(/[\u{274E}]/gu, '')              // ❎
    .replace(/[\u{2753}-\u{2755}]/gu, '')     // ❓❔❕
    .replace(/[\u{2757}]/gu, '')              // ❗
    .replace(/[\u{2763}-\u{2764}]/gu, '')     // ❣❤
    .replace(/[\u{2795}-\u{2797}]/gu, '')     // ➕➖➗
    .replace(/[\u{27A1}]/gu, '')              // ➡
    .replace(/[\u{27B0}]/gu, '')              // ➰
    .replace(/[\u{27BF}]/gu, '')              // ➿
    .replace(/[\u{FE0F}]/gu, '')              // Variation Selector-16
    .replace(/[\u{200D}]/gu, '')              // Zero Width Joiner
    .replace(/[\u{20E3}]/gu, '')              // Combining Enclosing Keycap
    // 연속 공백 정리
    .replace(/  +/g, ' ')
    .replace(/ *\n/g, '\n')    // 줄 끝 공백 제거
    .replace(/\n /g, '\n')     // 줄 시작 공백 제거
    .trim();
}

// ════════════════════════════════════════════════════════════════════
// 안 하나 출구
// ════════════════════════════════════════════════════════════════════

export interface CopyExitContext {
  channel: string;
  isAd: boolean;
  bannedWords: ReadonlyArray<string>;
  /** 혜택 · 효능 · 날짜의 근거 글(사람 글) */
  benefitGround: string;
  baseDate: Date;
  /** 변수 검증 목록(개인화 = 고른 변수 · 아님 = 전체) */
  validationVars: string[];
  /** 칼럼 0개(변수 없이) = 남은 %변수% 전부 지움 */
  stripAllVars: boolean;
  brandLinks: BrandLink[];
  senderNames: ReadonlyArray<string | null | undefined>;
  /**
   * ★ K2-3 스타일 후처리 = 규칙이 살아 있을 때만 · 회사 기준값.
   *   keepDividers = 구분선 규칙이 꺼진 목소리 회사(사람 표본에 구분선) · maxBlankRun = 회사 최대 연속 빈 줄(없으면 지금 1).
   */
  style?: { keepDividers?: boolean; maxBlankRun?: number | null };
}

export interface CopyExitFlags {
  liquid: boolean;
  inventedBenefits: string[];
  efficacyDropped: string[];
  inventedDates: string[];
  /** 출력에 남은 직접 채울 칸(뼈대 칸 · 혜택 · 날짜 자리표시 포함) = 법 문제(재생성 조건 · K12-3) */
  placeholderLeft: boolean;
  senderAdded: boolean;
}

export function applyCopyExitGuards(
  input: { message_text?: unknown; subject?: unknown },
  ctx: CopyExitContext,
): { message_text: string; subject: string | undefined; flags: CopyExitFlags } {
  const flags: CopyExitFlags = { liquid: false, inventedBenefits: [], efficacyDropped: [], inventedDates: [], placeholderLeft: false, senderAdded: false };
  const channel = ctx.channel;
  let msgField = String(input.message_text || '');

  // ★ 안전장치: AI가 (광고), 무료거부 등을 포함했으면 자동 제거
  //   D137: 기존 `\n?무료...` 패턴에서 `\n?` 제거 → 텍스트만 제거, 앞 개행은 원본 그대로 보존.
  //   이로써 AI 생성 본문 `...\n\n무료수신거부 080...`에서 \n\n 2개가 제거되지 않고
  //   buildAdMessage 호출 시 trailingCount=2로 계산되어 LMS/MMS 빈 줄 1개 유지.
  msgField = msgField.replace(/^\(광고\)\s?/g, '');
  msgField = msgField.replace(/무료거부\d{8,11}/g, '');
  msgField = msgField.replace(/무료수신거부\s?\d{3}-?\d{3,4}-?\d{4}/g, '');
  // ★ 안전장치: 구분선 자동 제거 (모바일 줄넘김 방지) · ★ K2-3 구분선 규칙이 꺼진 목소리 회사는 그대로(사람 표본에 구분선)
  if (!ctx.style?.keepDividers) msgField = msgField.replace(/[━─═＿_~\-]{3,}/g, '');
  // ★ D124 (N5): 빈 줄 과도 방지는 `\n{3,}→\n\n` 1중 방어선만 유지.
  //   D123 P12에서 추가한 dnCount ≤ 3 강제 축소는 자연스러운 단락 구분(특히 마무리/연락처 앞 빈 줄)까지
  //   단일 줄바꿈으로 축소시켜 하단이 붙는 문제 발생 → 제거. 프롬프트 규칙(줄바꿈 균형)으로 통제.
  // ★ K2-3 목소리 회사 = 회사 최대 연속 빈 줄 기준(없으면 지금 1 = `\n{3,}→\n\n`)
  const maxBlank = Math.max(1, Math.floor(Number(ctx.style?.maxBlankRun) || 1));
  msgField = msgField.replace(new RegExp(`\\n{${maxBlank + 2},}`, 'g'), '\n'.repeat(maxBlank + 1));
  // ★ 안전장치: SMS/LMS/MMS 이모지 강제 제거 (카카오만 허용)
  if (channel !== '카카오' && channel !== 'KAKAO') {
    msgField = stripEmojis(msgField);
  }
  // ★ 2026-07-06 Liquid 출구 가드 — 이 생성물은 %변수% 세계. 프롬프트 지시와 무관하게(모델은 확률적으로
  //   지시를 어긴다 — psy5868 실측) 템플릿 문법({{ }}·{% %}) 검출 시 결정적 평문화(중립 렌더 → 잔존 제거).
  //   "존재하지 않는 필드 기반 문법"이 편집기·발송에 노출되는 것을 코드가 보장 차단. 검출 시 재생성 1회도 트리거.
  if (detectLiquidSyntax(msgField)) {
    flags.liquid = true;
    msgField = flattenLiquidToPlainText(msgField);
  }
  // ★ ② 출력 금지어 가드 (2026-06-30) — 브랜드 키트 banned_words 제거
  //   ★ 2026-10-24 자리표시(혜택 · 효능)를 넣기 **전**에 지운다 — 뒤에서 지우면 금지어가 자리표시 글자(「직접」 등)를 깎아 발송 길목을 지나간다(Codex 3R)
  if (ctx.bannedWords.length > 0) {
    const hit = findBannedWords(msgField, [...ctx.bannedWords]);
    if (hit.length > 0) {
      for (const w of hit) msgField = msgField.split(w).join('');
      msgField = msgField.replace(/  +/g, ' ');
      console.log(`[copy-guard] 금지어 제거: ${hit.join(', ')}`);
    }
  }
  // ★ 2026-09-30 WP2 혜택 서버 차단 — 근거에 없는 혜택 값 · 낱말은 자리표시로 바꾸고 재생성 1회를 유도한다.
  //   남은 자리표시는 발송 길목(send-placeholder-gate)이 막는다(사람이 채우거나 지운 뒤에만 발송).
  const inventedHere = findInventedBenefits(msgField, ctx.benefitGround);
  if (inventedHere.length > 0) {
    flags.inventedBenefits.push(...inventedHere);
    msgField = replaceInventedBenefits(msgField, ctx.benefitGround);
  }
  // ★ 2026-10-24 효능 단정 거름 — 근거 글에 없는 단정 문장은 빼고 재생성 1회 · 다 빠지면 직접 채울 자리
  const effHere = dropInventedEfficacy(msgField, ctx.benefitGround);
  if (effHere.dropped.length > 0) {
    flags.efficacyDropped.push(...effHere.dropped);
    msgField = effHere.text;
  }
  // ★ 2026-10-28 K1-4 없는 날짜 · 기간(법) — 근거 글에 없는 날짜 자리 = 직접 채울 자리 + 재생성 1회
  const datesHere = findInventedDates(msgField, ctx.benefitGround, ctx.baseDate);
  if (datesHere.length > 0) {
    flags.inventedDates.push(...datesHere);
    msgField = replaceInventedDates(msgField, ctx.benefitGround, ctx.baseDate);
  }
  msgField = msgField.trim();

  // ★ D28: 제목에서 %변수% 강제 제거 · 제목도 템플릿 문법 평문화 · 같은 혜택 · 효능 · 날짜 대조(발송 길목이 제목까지 본다)
  let subject: string | undefined = input.subject ? String(input.subject) : undefined;
  if (subject) {
    let subj = subject;
    if (detectLiquidSyntax(subj)) {
      flags.liquid = true;
      subj = flattenLiquidToPlainText(subj);
    }
    const subjInvented = findInventedBenefits(subj, ctx.benefitGround);
    if (subjInvented.length > 0) {
      flags.inventedBenefits.push(...subjInvented);
      subj = replaceInventedBenefits(subj, ctx.benefitGround);
    }
    const subjEff = dropInventedEfficacy(subj, ctx.benefitGround);
    if (subjEff.dropped.length > 0) {
      flags.efficacyDropped.push(...subjEff.dropped);
      subj = subjEff.text;
    }
    const subjDates = findInventedDates(subj, ctx.benefitGround, ctx.baseDate);
    if (subjDates.length > 0) {
      flags.inventedDates.push(...subjDates);
      subj = replaceInventedDates(subj, ctx.benefitGround, ctx.baseDate);
    }
    subject = cleanLeftoverVars(subj).replace(/  +/g, ' ').trim();
  }

  // ★ #11 수정: 개인화 모드일 때 선택된 변수만 허용, 비선택 변수 제거
  const validation = validatePersonalizationVars(msgField, ctx.validationVars);
  if (!validation.valid) {
    console.warn(`[AI 변수 검증] 잘못된 변수 발견: ${validation.invalidVars.join(', ')} → 제거`);
    let cleaned = msgField;
    for (const invalidVar of validation.invalidVars) {
      cleaned = cleaned.replace(new RegExp(`%${invalidVar}%\\s*`, 'g'), '');
      cleaned = cleaned.replace(new RegExp(`\\s*%${invalidVar}%`, 'g'), '');
    }
    msgField = cleaned.replace(/  +/g, ' ').replace(/\n /g, '\n').trim();
  }
  // ★ 2026-10-18 exactVars = [] (칼럼 0개 = 변수 없이) — 남은 %변수% 전부 지운다
  if (ctx.stripAllVars) msgField = cleanLeftoverVars(msgField).replace(/  +/g, ' ').trim();

  // ★ 2026-07-02 브랜드 링크 토큰 치환 — 미등록 라벨 = [링크를 입력해주세요] placeholder → 발송 전 가드가 차단.
  const linkApplied = applyBrandLinkTokens(msgField, ctx.brandLinks);
  if (linkApplied.replacedCount > 0 || linkApplied.unresolvedCount > 0) {
    msgField = linkApplied.text;
    if (linkApplied.unresolvedCount > 0) {
      console.log(`[brand-link] 미등록 라벨 토큰 ${linkApplied.unresolvedCount}건 → placeholder 전환 (발송 시 편집 유도)`);
    }
  }
  // ★ 2026-10-28 K1-1 전송자 명칭(법) — 광고 문안의 제목(LMS · MMS) · 본문 첫 줄에 이름이 없으면 맨 앞에 붙인다(바이트 계산 앞 · K1-3 이 몫을 미리 뺐다)
  const sender = ensureSenderName(msgField, { isAd: ctx.isAd, channel, subject: subject || null, names: ctx.senderNames });
  if (sender.added) { msgField = sender.text; flags.senderAdded = true; }
  // ★ K12-3 출력에 남은 직접 채울 칸 = 법 문제(재생성 조건 · 남으면 발송 길목이 막는다)
  flags.placeholderLeft = hasAiFillPlaceholder(msgField) || (!!subject && hasAiFillPlaceholder(subject));
  return { message_text: msgField, subject, flags };
}

/** (순수) 재생성 결과 비교 = 법 문제 수 → 스팸 점수 → 목소리 문제 수(작을수록 낫다 · K12-3) */
export function compareCopyAttempts(
  a: { law: number; spam: number; voice: number },
  b: { law: number; spam: number; voice: number },
): number {
  return a.law - b.law || a.spam - b.spam || a.voice - b.voice;
}

// ════════════════════════════════════════════════════════════════════
// 회차 재생성 예산(K12-2) — runInCreditBundle 과 같은 AsyncLocalStorage 꼴
// ════════════════════════════════════════════════════════════════════

const regenStore = new AsyncLocalStorage<{ left: number }>();

/** 한 회차 생성 호출 상한(첫 생성 1 + 자동마케팅 스팸 재생성 상한 2) */
export const ROUND_GENERATION_LIMIT = 3;

/** fn 동안 생성 호출 상한 하나를 바깥 · 안쪽 재생성이 함께 쓴다 */
export function runWithRegenBudget<T>(fn: () => Promise<T>, limit: number = ROUND_GENERATION_LIMIT): Promise<T> {
  return regenStore.run({ left: limit }, fn);
}

/** 남은 생성 호출(예산 밖 = 무한) · 바깥 재생성이 부르기 전에 본다 */
export function generationSlotsLeft(): number {
  return regenStore.getStore()?.left ?? Number.POSITIVE_INFINITY;
}

/** 생성 호출 한 번을 쓴다(예산 밖 = 늘 참 · 지금과 같다) · 예산이 다 했으면 거짓 */
export function takeGenerationSlot(): boolean {
  const s = regenStore.getStore();
  if (!s) return true;
  if (s.left <= 0) return false;
  s.left -= 1;
  return true;
}
