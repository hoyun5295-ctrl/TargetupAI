/**
 * ★ 2026-09-26 한줄로 V2 — 프로세스 안 키별 잠금 공용 CT.
 *
 * 준비분 잠금(staging-sweeper withStagingLock · F38)에 있던 뮤텍스를 한 벌로 뽑았다. 같은 이름공간·같은 키의 작업을
 * 들어온 순서대로 하나씩 돌린다(Promise 사슬). 기다리는 동안 DB 연결을 전혀 쥐지 않는다 — DB advisory 잠금 연결을 쥔 채
 * 본문이 풀 연결을 또 빌리면 동시 요청이 풀을 채워 교착됐다(3차 2R high).
 *
 * ⛔ 전제: 백엔드는 PM2 fork **단일 프로세스**다(ecosystem.config.js targetup-backend instances 1 · exec_mode fork).
 *   클러스터로 바꾸면 이 잠금은 프로세스끼리 보이지 않는다 — 그때는 이 파일만 바꾸면 된다(호출부 불변).
 *
 * 쓰는 곳
 *   - 'staging'        = 직접발송 준비분 stage ↔ commit (staging-sweeper withStagingLock)
 *   - 'campaign-start' = AI 캠페인 발송 시작(존재 재확인 → 중복 확인 → 실행 행 생성) ↔ 초안 삭제(가드 → 삭제)
 *                        (Codex 4차 2R high · 같은 잠금이 S1-H07 동시 발송 중복 방지도 한 줄로 세운다)
 *   - 'cancel-obligation' = 취소 CT의 환불 의무 기록 ↔ 취소 환불 재시도 워커의 캠페인별 처리(Codex 4차 5R)
 */
const _chains = new Map<string, Promise<void>>();

export async function withKeyedLock<T>(namespace: string, key: string, fn: () => Promise<T>): Promise<T> {
  const k = `${namespace}:${key}`;
  const prev = _chains.get(k) || Promise.resolve();
  let release!: () => void;
  const mine = new Promise<void>((resolve) => { release = resolve; });
  const tail = prev.then(() => mine);
  _chains.set(k, tail);
  await prev;
  try {
    return await fn();
  } finally {
    release();
    if (_chains.get(k) === tail) _chains.delete(k);
  }
}

/** UUID 잠금 키 = 16진수만 남긴 소문자 — 대소문자·하이픈·중괄호 표기가 달라도 PostgreSQL uuid로는 같으므로 같은 잠금이어야 한다. */
export function uuidLockKey(id: string): string {
  return String(id || '').toLowerCase().replace(/[^0-9a-f]/g, '');
}

/**
 * 캠페인 취소 의무(send_config.refundPendingCancel) 쓰기 직렬화 — 취소 CT의 의무 기록 ↔ 취소 환불 재시도 워커의 캠페인별 처리.
 * (Codex 4차 5R) 워커가 옛 의무를 읽은 뒤 취소 CT가 새 의무로 덮으면, 워커의 해제·연기가 새 의무를 지우거나 되돌렸다.
 */
export function withCancelObligationLock<T>(campaignId: string, fn: () => Promise<T>): Promise<T> {
  return withKeyedLock('cancel-obligation', uuidLockKey(campaignId), fn);
}

/** 캠페인 발송 시작 ↔ 초안 삭제 직렬화 */
export function withCampaignStartLock<T>(campaignId: string, fn: () => Promise<T>): Promise<T> {
  return withKeyedLock('campaign-start', uuidLockKey(campaignId), fn);
}
