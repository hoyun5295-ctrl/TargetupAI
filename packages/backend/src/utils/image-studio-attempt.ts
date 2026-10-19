/**
 * image-studio-attempt.ts — 이미지 스튜디오 생성 · 수정의 시도 키 · 결과 기억(★ 2026-10-19 B-1016-3②)
 *
 * 결함: 멱등키를 성공 뒤 서버가 새로 만들어, 응답이 끊긴 뒤(프록시 대기 초과 · 연결 끊김) 다시 누르면 새로 만들고 또 걷혔다.
 * 처방: 화면이 「시도 표」(attemptToken)를 보내고 결과를 못 받았으면 같은 표로 다시 보낸다. 키 = 회사 · 표 · 입력 지문16
 *   (입력을 바꾸면 새 키 = 새 생성). 이미 걷힌 키 = 걷지 않는다 · 기억한 결과가 있으면 그대로 돌려준다.
 *   시도 표가 없는 옛 화면 = 종전(요청마다 새 키).
 * ponytail: 결과 기억 = 프로세스 메모리(단일 프로세스 · 6시간 · 200개). 재시작 뒤 같은 표 = 다시 만들되 걷지 않는다.
 */
import { createHash } from 'crypto';
import { isValidAttemptToken } from './one-line-facts';

export function studioAttemptKey(kind: 'gen' | 'edit', companyId: string, attemptToken: unknown, payload: unknown): string | null {
  if (!isValidAttemptToken(attemptToken)) return null;
  const fp = createHash('sha256').update(JSON.stringify(payload ?? null)).digest('hex').slice(0, 16);
  return `image-studio:${kind}:${companyId}:${attemptToken}:${fp}`;   // 최대 13+4+1+36+1+64+1+16 = 136 ≤ 150
}

const TTL_MS = 6 * 60 * 60 * 1000;
const MAX = 200;
const remembered = new Map<string, { at: number; value: unknown }>();

export function rememberStudioResult(key: string, value: unknown): void {
  remembered.delete(key);
  remembered.set(key, { at: Date.now(), value });
  while (remembered.size > MAX) {
    const oldest = remembered.keys().next().value;
    if (oldest === undefined) break;
    remembered.delete(oldest);
  }
}

export function recallStudioResult<T>(key: string): T | null {
  const hit = remembered.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at > TTL_MS) { remembered.delete(key); return null; }
  return hit.value as T;
}
