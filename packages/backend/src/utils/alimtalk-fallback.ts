/**
 * CT: 알림톡 전환재발송(대체발송) 규칙 단일 진입점 — 2026-07-27
 *
 * 사용자 선택은 두 갈래다(대체 안함 포함 3지):
 *   - 원문 그대로   = 'L'(LMS) / 'S'(SMS) — 게이트웨이가 우리가 넣은 msg_contents를 그대로 전환발송한다.
 *   - 대체문안 직접 = 'B'(LMS) / 'A'(SMS) — k_next_contents에 넣은 문구로 전환발송한다.
 *   - 대체 안함     = 'N'
 *
 * QTmsg 사용설명서 4.0 원문(qtmsg-manual.txt:166-169):
 *   N:보내지 말고 에러처리 / S:기존카톡문구로 SMS / L:기존카톡문구로 LMS
 *   A:대체문구(k_next_contents)로 SMS / B:대체문구로 LMS
 *
 * 이 CT가 닫는 구멍:
 *   ① 'B'인데 대체문안이 비면 k_next_contents=NULL로 큐에 들어가 무엇이 나가는지 매뉴얼에 없다 → 차단.
 *   ② 'L'인데 대체문안이 남아 있으면 이중 진실(저장값 ≠ 실제 발송문) → NULL로 정규화.
 *   ③ LMS 전환(L/B)은 title_str이 없으면 통신사 검증 실패로 미수신(D225+ 사고) → 제목 필수.
 *
 * 화면 검증(AlimtalkChannelPanel)·저장 검증(라우트)·발송 적재(insertAlimtalkQueue 호출부)가
 * 전부 이 파일의 같은 규칙을 쓴다. 경로별 인라인 판정 금지.
 */

export type AlimtalkNextType = 'N' | 'S' | 'L' | 'A' | 'B';

/** 값 미지정 시 기본 — 기존 4경로의 `|| 'L'` 폴백과 동일(원문 그대로 LMS 전환). */
export const DEFAULT_ALIMTALK_NEXT_TYPE: AlimtalkNextType = 'L';

const VALID_NEXT_TYPES: AlimtalkNextType[] = ['N', 'S', 'L', 'A', 'B'];

export interface AlimtalkFallbackInput {
  nextType?: string | null;
  /** 대체문안 — 변수 치환까지 끝난 값을 넘긴다(치환은 호출부 담당). */
  nextContents?: string | null;
  /** LMS 전환 시 제목(title_str). */
  nextSubject?: string | null;
}

export interface ResolvedAlimtalkFallback {
  nextType: AlimtalkNextType;
  /** 큐 k_next_contents — 원문 그대로(L/S)·대체 안함(N)이면 undefined(NULL 적재). */
  nextContents?: string;
  /** 큐 title_str — LMS 전환(L/B)일 때만. */
  titleStr?: string;
  /** 행 단위 호출에서 치환 결과가 비어 그 행만 전환 없음(N)으로 내렸을 때 true. 호출부는 로그를 남긴다. */
  downgradedToNone?: boolean;
}

export interface ResolveAlimtalkFallbackOptions {
  /**
   * 대체문안이 비었을 때의 처리.
   *  - 'throw'(기본) = 설정 검증용. 저장·활성화·설정 단위 확인에서 쓴다.
   *  - 'disableFallback' = 수신자별 치환 결과 검증용. 설정은 이미 통과했는데 그 수신자에서만
   *    변수가 전부 빈 값이라 문안이 사라진 경우다. 여기서 throw하면 배치 도중에 죽어
   *    앞 청크는 이미 발송된 채 뒤 청크만 안 나가는 부분 발송이 된다(6원칙 ①·②).
   *    그 행만 전환 없음(N)으로 내리고 알림톡 본 발송은 그대로 보낸다 — 빈 대체문안을
   *    큐에 넣어 게이트웨이 임의 동작에 맡기지 않는다.
   */
  emptyContentsPolicy?: 'throw' | 'disableFallback';
}

export class AlimtalkFallbackError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AlimtalkFallbackError';
  }
}

export const ALIMTALK_FALLBACK_ERRORS = {
  /** 저장·발송 공통 문구 — 기존 campaigns.ts 직접발송 문구와 동일하게 유지(사용자 학습 비용 0). */
  NO_SUBJECT: 'LMS 대체 발송 시 LMS 제목을 입력해주세요.',
  NO_CONTENTS: '대체문안을 직접 작성하도록 선택했습니다. 대체문안을 입력하거나 "원문 그대로 발송"을 선택해주세요.',
} as const;

/** 문자열/미지정 값을 유효한 전환 타입으로 정규화. 알 수 없는 값은 기본값(L). */
export function normalizeAlimtalkNextType(raw: string | null | undefined): AlimtalkNextType {
  const v = String(raw ?? '').trim().toUpperCase();
  return (VALID_NEXT_TYPES as string[]).includes(v)
    ? (v as AlimtalkNextType)
    : DEFAULT_ALIMTALK_NEXT_TYPE;
}

/** 대체문안(k_next_contents)을 쓰는 타입인가 — A/B. */
export function usesCustomContents(t: AlimtalkNextType): boolean {
  return t === 'A' || t === 'B';
}

/** LMS로 전환하는 타입인가 — L/B (제목 필수). */
export function usesLmsFallback(t: AlimtalkNextType): boolean {
  return t === 'L' || t === 'B';
}

/**
 * 저장 시점 검증 — 위반 사유 문자열, 통과면 null.
 * 라우트에서 400 응답 문구로 그대로 쓴다(throw 없이 판정만 필요한 자리).
 */
export function validateAlimtalkFallback(input: AlimtalkFallbackInput): string | null {
  const nextType = normalizeAlimtalkNextType(input.nextType);
  if (usesCustomContents(nextType) && String(input.nextContents ?? '').trim() === '') {
    return ALIMTALK_FALLBACK_ERRORS.NO_CONTENTS;
  }
  if (usesLmsFallback(nextType) && String(input.nextSubject ?? '').trim() === '') {
    return ALIMTALK_FALLBACK_ERRORS.NO_SUBJECT;
  }
  return null;
}

/**
 * 발송 적재 직전 확정 — insertAlimtalkQueue에 넘길 3개 값을 만든다.
 * 저장 검증을 우회해 들어온 행(옛 데이터·API 직접 호출)은 여기서 throw로 막힌다.
 * 워커에서 호출할 때는 바깥 catch가 실행행에 사유를 남기도록 한다(2026-07-27 여정 교훈).
 */
export function resolveAlimtalkFallback(
  input: AlimtalkFallbackInput,
  options: ResolveAlimtalkFallbackOptions = {},
): ResolvedAlimtalkFallback {
  const nextType = normalizeAlimtalkNextType(input.nextType);
  const contentsEmpty = usesCustomContents(nextType) && String(input.nextContents ?? '').trim() === '';

  // 제목 누락은 행 단위에서도 설정 결함이다 — 강등 분기보다 먼저 막는다.
  // (먼저 강등하면 B에 문안·제목이 둘 다 빈 입력이 조용히 N으로 빠져나가 제목 검증이 사라진다.)
  if (usesLmsFallback(nextType) && String(input.nextSubject ?? '').trim() === '') {
    throw new AlimtalkFallbackError(ALIMTALK_FALLBACK_ERRORS.NO_SUBJECT);
  }
  // 수신자별 치환 결과가 빈 경우 — 그 행만 전환 없음으로.
  if (contentsEmpty && options.emptyContentsPolicy === 'disableFallback') {
    return { nextType: 'N', nextContents: undefined, titleStr: undefined, downgradedToNone: true };
  }

  const violation = validateAlimtalkFallback(input);
  if (violation) throw new AlimtalkFallbackError(violation);

  return {
    nextType,
    // 원문 그대로(L/S)·대체 안함(N)은 NULL 적재 — 게이트웨이는 msg_contents를 쓴다.
    nextContents: usesCustomContents(nextType) ? String(input.nextContents).trim() : undefined,
    titleStr: usesLmsFallback(nextType) ? String(input.nextSubject).trim() : undefined,
  };
}
