/**
 * operator-recipients 순수 SQL 계약 — vitest 편입 (2026-08-03 5R)
 *
 * 왜 있나: 계약 검증 38건이 `__tests__/operator-recipients.verify.ts`에 있는데 그 파일명은 기본 vitest 패턴에
 *   걸리지 않아 `npm test`로 한 번도 실행되지 않았다. 돌지 않는 검증은 보호가 아니다 — 여기서 함께 돌린다.
 *   (verify 스크립트는 실패 시 assert가 throw하므로 import 자체가 검증이다. 단독 실행 방법도 그대로 유지.)
 */
import { describe, it, expect } from 'vitest';

describe('operator-recipients 순수 SQL 계약(verify 스크립트 동반 실행)', () => {
  it('38건 계약 검증이 전부 통과한다', async () => {
    await expect(import('./__tests__/operator-recipients.verify')).resolves.toBeDefined();
  });
});
