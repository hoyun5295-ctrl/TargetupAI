/**
 * 동기화 오류 문장 단일 창구 (★2026-09-13(3) 싱크 ⓐ)
 *
 * 오류 문장은 세 출구로 나간다: 서버 전송(sendSyncLog errorMessage) · 로컬 로그(logResult → 로그 요청 명령으로 서버 업로드) ·
 * 알림(alertManager). 종전에는 셋 다 문장을 가리지 않았고, zod 열거형 오류 기본 문장은 **받은 값**을 그대로 담았다.
 * ⛔ 가릴 것을 찾기 전에 받은 값이 문장에 들어가지 않게 만든다: 검증 문장은 경로·코드로 다시 만들고,
 *   남는 자유 문장(API·드라이버 오류)만 이 창구에서 가린 뒤 자른다.
 * ⛔ 서버 전송 형식 `[CODE] message; …`(최대 5건)은 유지한다. 운영 SQL 점검 문서가 이 모양을 눈으로 읽는다.
 */
import type { ZodIssue } from 'zod';
import type { SyncError } from '../types/sync';
import { scrubText } from '../logger/masking';

/** zod 기본 문장이 입력값을 담지 않는 코드. 문장이 스키마 상수(타입 이름·길이·사용자 정의 문구)로만 만들어진다 */
const SAFE_MESSAGE_CODES = new Set<string>([
  'invalid_type', 'too_small', 'too_big', 'custom', 'invalid_date',
  'not_multiple_of', 'not_finite', 'invalid_literal', 'invalid_union', 'invalid_string',
]);

/** 검증 실패를 경로·코드 문장으로. 열거형은 받은 값 대신 허용값(스키마 상수)만 적는다 */
export function formatValidationIssues(issues: ZodIssue[]): string {
  return issues.map((i) => {
    const path = i.path.join('.') || '(root)';
    if (i.code === 'invalid_enum_value') {
      const opts = (i as { options?: unknown[] }).options ?? [];
      return `${path}: 허용되지 않은 값(허용: ${opts.map(String).join('|')})`;
    }
    if (SAFE_MESSAGE_CODES.has(i.code)) return `${path}: ${i.message}`;
    return `${path}: ${i.code}`;
  }).join(', ');
}

/** 자유 문장 한 줄의 최대 길이 */
export const SYNC_ERROR_TEXT_MAX = 500;

/** 문장 속 이메일·휴대폰 번호를 가린 뒤 자른다(먼저 자르면 경계에 걸린 이메일 앞부분이 남는다) */
export function safeErrorText(message: string): string {
  const s = scrubText(String(message ?? ''));
  return s.length > SYNC_ERROR_TEXT_MAX ? `${s.slice(0, SYNC_ERROR_TEXT_MAX)}…` : s;
}

/** 서버 동기화 로그의 오류 문장(최대 5건). 오류가 없으면 보내지 않는다 */
export function buildSyncLogErrorMessage(errors: SyncError[]): string | undefined {
  if (errors.length === 0) return undefined;
  return errors.slice(0, 5).map((e) => `[${e.code}] ${safeErrorText(e.message)}`).join('; ');
}
