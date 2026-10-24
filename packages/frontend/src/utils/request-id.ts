/**
 * request-id.ts — 화면이 만드는 요청 키(uuid v4 모양) 한 곳 (★ 2026-10-23 여정 결함 0)
 *   같은 요청을 다시 보낼 때 같은 키를 쓰면 서버가 한 번만 처리 · 차감한다(문장으로 만들기 · 날짜축 AI 계획).
 */
export function newRequestId(): string {
  try { if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID(); } catch { /* 아래 대체 */ }
  const h = '0123456789abcdef';
  let s = '';
  for (let i = 0; i < 32; i++) s += h[Math.floor(Math.random() * 16)];
  return `${s.slice(0, 8)}-${s.slice(8, 12)}-4${s.slice(13, 16)}-8${s.slice(17, 20)}-${s.slice(20, 32)}`;
}

/**
 * 입력마다 요청 키 하나(★ 2026-10-23 Codex 3R · 4R) — 키는 그 입력의 결과를 받을 때만 지운다.
 *   실패 · 결과 모름이면 남겨 같은 입력의 재시도가 같은 키로 간다(서버가 한 번만 차감 · 보관 결과를 돌려준다).
 *   다른 입력의 성공은 이 입력의 키를 건드리지 않는다(A 응답 끊김 → B 성공 → A 재시도 = A 의 처음 키).
 */
export class RequestKeys {
  private keys = new Map<string, string>();
  /** 이 입력의 요청 키(없으면 새로). 입력은 앞뒤 공백을 뺀 글로 가른다(서버 해시와 같은 정리). */
  keyFor(input: string): string {
    const k = String(input || '').trim();
    const found = this.keys.get(k);
    if (found) return found;
    const id = newRequestId();
    this.keys.set(k, id);
    return id;
  }
  /** 이 입력의 결과를 받았다 = 다음 요청은 새 요청. */
  settled(input: string): void {
    this.keys.delete(String(input || '').trim());
  }
}
