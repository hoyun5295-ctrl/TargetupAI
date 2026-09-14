/**
 * 동기화 오류 문장 계약 (★2026-09-13(3) 싱크 ⓐ)
 *
 *   서버 전송(sendSyncLog errorMessage)·로컬 로그(logResult)·알림(alertManager) 세 출구가 오류 문장을 가리지 않았다.
 *   zod 열거형 오류 기본 문장은 **받은 값**을 그대로 담는다(gender 등). 가릴 것을 찾기 전에, 받은 값이 문장에 들어가지
 *   않게 구조(경로·코드)로 다시 만들고, 남는 자유 문장(API·드라이버 오류)은 한 창구에서 가린 뒤 자른다.
 */
import { describe, it, expect } from 'vitest';
import { CustomerSchema } from '../types/customer';
import { formatValidationIssues, safeErrorText, buildSyncLogErrorMessage, SYNC_ERROR_TEXT_MAX } from './error-text';

describe('동기화 오류 문장: 받은 값을 내보내지 않는다', () => {
  it('열거형 실패 문장에 받은 값이 없고 허용값과 경로만 남는다', () => {
    const r = CustomerSchema.safeParse({ phone: '01000000001', gender: '받은값비밀' });
    expect(r.success).toBe(false);
    const text = formatValidationIssues((r as any).error.issues);
    expect(text).not.toContain('받은값비밀');
    expect(text).toContain('gender');
    expect(text).toContain('M|F');
  });

  it('입력값을 담지 않는 코드(필수·타입)는 종전 문장 그대로 남는다(진단 회귀 없음)', () => {
    const r = CustomerSchema.safeParse({ gender: 'M' });
    expect(r.success).toBe(false);
    const issues = (r as any).error.issues;
    const legacy = issues.map((i: any) => `${i.path.join('.')}: ${i.message}`).join(', ');
    expect(formatValidationIssues(issues)).toBe(legacy);
  });

  it('API·네트워크 오류 문장은 가림 대상이 아니다(오탐 없음)', () => {
    for (const m of ['Request failed with status code 500', 'timeout of 60000ms exceeded', 'connect ECONNREFUSED 10.0.0.1:443']) {
      expect(safeErrorText(m)).toBe(m);
    }
  });

  it('문장 속 이메일·휴대폰은 가리고, 가린 뒤 자른다', () => {
    const out = safeErrorText("Duplicate entry 'row@example.com' 010-0000-1234");
    expect(out).not.toContain('row@example.com');
    expect(out).not.toContain('0000-1234');
    const long = safeErrorText('a'.repeat(900));
    expect(long.length).toBeLessThanOrEqual(SYNC_ERROR_TEXT_MAX + 1);
    // 경계에 걸린 이메일 앞부분이 남지 않는다
    const edge = safeErrorText(`${' '.repeat(SYNC_ERROR_TEXT_MAX - 5)}alice@example.com`);
    expect(edge).not.toContain('alice@');
  });

  it('서버 전송 형식은 종전과 같은 [CODE] message; … 최대 5건이고, 오류가 없으면 보내지 않는다', () => {
    const errs = Array.from({ length: 7 }, (_, i) => ({ code: 'NORMALIZE_FAILED', message: `m${i}` }));
    const s = buildSyncLogErrorMessage(errs)!;
    expect(s.split('; ')).toHaveLength(5);
    expect(s.startsWith('[NORMALIZE_FAILED] m0')).toBe(true);
    expect(buildSyncLogErrorMessage([])).toBeUndefined();
  });
});
