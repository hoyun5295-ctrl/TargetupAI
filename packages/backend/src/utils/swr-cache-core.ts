/**
 * ★ 2026-07-17 — SWR(stale-while-revalidate) 캐시 판정 순수 코어.
 *
 * 배경: 대시보드 60초 캐시(stats·enabled-fields)는 TTL이 지나면 재진입마다
 * 콜드 재계산 ~1초를 다시 문다(이새 실측 942~1,201ms). soft TTL 안은 그대로 히트,
 * soft~hard 사이는 직전 값을 즉시 반환하고 백그라운드로 1회만 재계산한다.
 *
 * 이 파일은 판정/직렬화만 담당하는 순수 함수(외부 import 0)이며,
 * Redis 배선은 swr-cache.ts가 담당한다. (순수 코어 분리 — 유닛 테스트 대상)
 */

export interface SwrClassification<T> {
  /**
   * fresh  = soft TTL 안 — 그대로 반환
   * stale  = soft 초과, hard TTL 안(키 생존) — 즉시 반환 + 백그라운드 갱신
   * legacy = 엔벨로프 없는 구형식 직저장(배포 전 60초 TTL 잔존분) — 60초 내 값이므로 fresh 취급
   * miss   = 값 없음/파싱 불가 — 동기 계산
   */
  state: 'fresh' | 'stale' | 'legacy' | 'miss';
  value?: T;
}

interface SwrEnvelope<T> {
  __swr: 1;
  at: number; // 계산 시각 (epoch ms)
  v: T;
}

/** Redis에서 읽은 raw 문자열을 SWR 상태로 판정한다. */
export function classifySwrEntry<T>(
  raw: string | null | undefined,
  softTtlSec: number,
  nowMs: number,
): SwrClassification<T> {
  if (!raw) return { state: 'miss' };
  let parsed: any;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { state: 'miss' };
  }
  if (parsed && parsed.__swr === 1 && typeof parsed.at === 'number') {
    const ageSec = (nowMs - parsed.at) / 1000;
    return { state: ageSec <= softTtlSec ? 'fresh' : 'stale', value: parsed.v as T };
  }
  // 구형식(엔벨로프 없이 payload 직저장): 물리 TTL이 60초였으므로 항상 60초 내 값 — fresh 취급
  return { state: 'legacy', value: parsed as T };
}

/** 저장용 엔벨로프 직렬화. */
export function buildSwrEnvelope<T>(value: T, nowMs: number): string {
  const envelope: SwrEnvelope<T> = { __swr: 1, at: nowMs, v: value };
  return JSON.stringify(envelope);
}
