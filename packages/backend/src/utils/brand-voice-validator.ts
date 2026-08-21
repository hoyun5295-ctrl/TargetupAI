/**
 * ★ CT-100: Brand Voice Validator — D225+ (2026-05-28 Harold 명시)
 *
 * 본질
 *   AI 생성 문안이 회사 brand voice 가이드라인에 일치하는지 자가 검증.
 *   필수 3 + 선택 1 (경고) — 미달 시 호출부에서 자동 재생성 max 3회 처리.
 *
 * 사용 흐름
 *   1. AI 호출 응답 직후 = validateBrandVoiceCompliance(generated, guideline) 호출
 *   2. valid === false + retries < 3 = 재호출 (issues 명시 추가 userMessage prefix)
 *   3. retries === 3 + 여전히 미달 = 최선 결과 반환 + UI 안 "1회 더 다듬기" 옵션
 *
 * 검증 매트릭스
 *   필수 1 — 빈출 표현 1건 이상 포함 (frequent_expressions 영역 안 1건+ 출현)
 *   필수 2 — 광고 표기 "(광고)" 위치 일치 (front / back)
 *   필수 3 — 이모지 화이트리스트 정합 (허용 외 이모지 출현 X)
 *   필수 4 — 종결어미 스타일 일치 (2026-07-02 형태 명세 — sentence_ending_style 있을 때만, SMS 제외)
 *   필수 5 — 본문 길이 범위 ±20% 슬랙 (2026-07-02 — length_range 있고 channel LMS/MMS일 때만)
 *   선택 — 길이 평균 ±30% 이내 (벗어남 = 경고만, 미달 분기 X)
 *
 * 영구 원칙 정합
 *   - 사실 보존 우선 (D152 4-1) — 본 검증 = 톤 검증 한정, 사실 영역 검증 X
 *   - 모델 분리 (D170+) — Sonnet/Opus 모두 활용 가능 (호출부 자유)
 */

import type { BrandGuideline } from './brand-voice-prompt';

export interface ValidationResult {
  valid: boolean;
  issues: string[];      // 필수 미달 영역 (재생성 트리거)
  warnings: string[];    // 선택 경고 영역 (재생성 트리거 X)
}

// 한글 + 영문 + 숫자 외 이모지/특수문자 추출 정규식 (NFC 정규화 후)
const EMOJI_PATTERN = /[\u{1F300}-\u{1F9FF}\u{2600}-\u{27BF}\u{2700}-\u{27BF}\u{FE0F}\u{200D}★♥▶◆◇■□●○☆♡▷◀▶♣♠♦♪♬✓✔✕✖]/gu;

// 종결어미 카운트 — 한글 음절이 조합형이라 어미는 음절 단위로 판정.
// 해요체 = "...요" 종결 (단, 하세요/해보세요 등 '세요'는 합쇼체 문안에도 흔해 제외)
const HAEYO_ENDING_RE = /(?<!세)요(?=[\s.!?~,)"']|$)/g;
// 합쇼체 = "...니다/니까/십시오" 종결
const HAPSHO_ENDING_RE = /(니다|니까|십시오)(?=[\s.!?~,)"']|$)/g;

/**
 * AI 생성 문안 자가 검증.
 *
 * @param generated AI 생성 문안 (LMS/MMS 본문)
 * @param guideline 회사 brand voice 가이드라인
 * @param opts.channel 채널 (SMS는 압축 우선이라 종결어미·길이 범위 검증 제외)
 * @returns 검증 결과 (valid + issues + warnings)
 */
export function validateBrandVoiceCompliance(
  generated: string,
  guideline: BrandGuideline,
  opts?: { channel?: string },
): ValidationResult {
  const issues: string[] = [];
  const warnings: string[] = [];

  if (!generated || generated.trim().length === 0) {
    issues.push('생성 문안이 비어있음');
    return { valid: false, issues, warnings };
  }

  // ─────────────────────────────────────────────────────────────
  // 필수 1: 빈출 표현 1건 이상 포함
  // ─────────────────────────────────────────────────────────────
  if (guideline.frequent_expressions.length > 0) {
    const hasExpression = guideline.frequent_expressions.some((expr) => {
      if (!expr || expr.trim().length === 0) return false;
      return generated.includes(expr);
    });
    if (!hasExpression) {
      issues.push(`빈출 표현 1건 이상 포함 의무: 활용 가능 표현: ${guideline.frequent_expressions.join(' / ')}`);
    }
  }

  // ─────────────────────────────────────────────────────────────
  // 필수 2: 광고 표기 "(광고)" 위치 일치
  // ─────────────────────────────────────────────────────────────
  const hasAdPrefix = generated.includes('(광고)');
  if (hasAdPrefix) {
    const front = /^\s*\(광고\)/.test(generated);
    const back = /\(광고\)\s*$/.test(generated);
    if (guideline.ad_prefix_position === 'front' && !front) {
      issues.push('"(광고)" 표기 위치 = 본문 앞 (현재 본문 뒤)');
    } else if (guideline.ad_prefix_position === 'back' && !back) {
      issues.push('"(광고)" 표기 위치 = 본문 뒤 (현재 본문 앞)');
    }
  }

  // ─────────────────────────────────────────────────────────────
  // 필수 3: 이모지 화이트리스트 정합 — 카카오 제외 (이모지 허용 채널, 화이트리스트는 LMS 학습값)
  // ─────────────────────────────────────────────────────────────
  const channelUpper = String(opts?.channel || '').toUpperCase();
  const isKakao = channelUpper === 'KAKAO' || channelUpper === '카카오';
  const usedEmojis = isKakao ? [] : (generated.match(EMOJI_PATTERN) || []);
  if (usedEmojis.length > 0) {
    const uniqueUsed = Array.from(new Set(usedEmojis));
    const invalid = uniqueUsed.filter((e) => !guideline.emoji_whitelist.includes(e));
    if (invalid.length > 0) {
      const allowedStr = guideline.emoji_whitelist.length > 0
        ? guideline.emoji_whitelist.join(' / ')
        : '(이모지 사용 금지)';
      issues.push(`허용되지 않은 이모지 사용: ${invalid.join(' / ')}: 활용 가능: ${allowedStr}`);
    }
  }

  // ─────────────────────────────────────────────────────────────
  // 필수 4 (2026-07-02): 종결어미 스타일 일치 — SMS 제외 (압축 우선)
  // ─────────────────────────────────────────────────────────────
  const channel = channelUpper;
  const skipFormChecks = channel === 'SMS';
  if (!skipFormChecks && (guideline.sentence_ending_style === '합쇼체' || guideline.sentence_ending_style === '해요체')) {
    const haeyoCount = (generated.match(HAEYO_ENDING_RE) || []).length;
    const hapshoCount = (generated.match(HAPSHO_ENDING_RE) || []).length;
    if (guideline.sentence_ending_style === '합쇼체' && haeyoCount > hapshoCount && haeyoCount >= 2) {
      issues.push(`종결어미 스타일 = 합쇼체(~습니다) 의무. 현재 해요체(~요) 위주 (해요체 ${haeyoCount} / 합쇼체 ${hapshoCount})`);
    } else if (guideline.sentence_ending_style === '해요체' && hapshoCount > haeyoCount && hapshoCount >= 2) {
      issues.push(`종결어미 스타일 = 해요체(~요) 의무. 현재 합쇼체(~습니다) 위주 (합쇼체 ${hapshoCount} / 해요체 ${haeyoCount})`);
    }
  }

  // ─────────────────────────────────────────────────────────────
  // 필수 5 (2026-07-02): 본문 길이 범위 — length_range + LMS/MMS 채널일 때만 (±20% 슬랙)
  // ─────────────────────────────────────────────────────────────
  const range = guideline.length_range;
  if (
    (channel === 'LMS' || channel === 'MMS') &&
    range && range.min_chars > 0 && range.max_chars >= range.min_chars
  ) {
    const len = generated.length;
    const minAllowed = Math.floor(range.min_chars * 0.8);
    const maxAllowed = Math.ceil(range.max_chars * 1.2);
    if (len < minAllowed || len > maxAllowed) {
      const dir = len < minAllowed ? '미달' : '초과';
      issues.push(`본문 길이 범위 ${range.min_chars}~${range.max_chars}자 ${dir} (현재 ${len}자). 범위 안으로 작성`);
    }
  }

  // ─────────────────────────────────────────────────────────────
  // 선택 (경고): 길이 평균 ±30% 이내
  // ─────────────────────────────────────────────────────────────
  if (guideline.avg_length_chars > 0) {
    const lenDiffRatio = Math.abs(generated.length - guideline.avg_length_chars) / guideline.avg_length_chars;
    if (lenDiffRatio > 0.3) {
      const dir = generated.length > guideline.avg_length_chars ? '초과' : '미달';
      warnings.push(`평균 길이 ±30% ${dir} (생성 ${generated.length}자 / 평균 ${guideline.avg_length_chars}자)`);
    }
  }

  return {
    valid: issues.length === 0,
    issues,
    warnings,
  };
}

/**
 * issues 영역을 AI 재호출 시 userMessage prefix용 텍스트로 변환.
 *
 * @param issues validateBrandVoiceCompliance 결과 issues 배열
 * @returns AI 재호출 시 추가 prompt
 */
export function buildRetryHintFromIssues(issues: string[]): string {
  if (issues.length === 0) return '';
  return `\n\n[자가 검증 미달: 다음 항목 정정 의무]\n${issues.map((i) => `- ${i}`).join('\n')}`;
}
