/**
 * ★ 2026-07-17 — Redis SWR(stale-while-revalidate) 캐시 배선.
 *
 * 판정/직렬화는 swr-cache-core.ts(순수)가 담당하고, 이 파일은 Redis 읽기/쓰기와
 * 백그라운드 갱신 dedup만 담당한다.
 *
 * 동작:
 *   fresh/legacy = 그대로 반환 (현행 60초 캐시 히트와 동일)
 *   stale        = 직전 값 즉시 반환 + 백그라운드 1회 재계산(in-flight dedup) → 다음 요청부터 새 값
 *   miss         = 동기 계산 후 저장
 *
 * 계약:
 *   - 무효화 길목(clearEnabledFieldsCache 등)의 redis.del은 엔벨로프째 지우므로
 *     데이터 변경 후 첫 진입 = 콜드 fresh 계산 (stale 반환 없음 — 즉시 반영 계약 불변)
 *   - Redis 장애 = 캐시 없이 compute (fail-open, 현행과 동일)
 *   - 백그라운드 갱신 실패 = 무시 — 다음 stale 히트가 재시도, hard TTL이 상한
 *   - compute 클로저는 백그라운드에서 재실행되므로 재진입 안전(호출마다 상태 새로 구성)해야 한다
 *   - in-flight dedup은 프로세스 메모리(pm2 fork 단일) — 다중 인스턴스여도 중복 재계산일 뿐 정합 문제 없음
 */

import { redis } from '../config/defaults';
import { classifySwrEntry, buildSwrEnvelope } from './swr-cache-core';

const inFlightRefresh = new Set<string>();

export interface SwrCacheOptions<T> {
  key: string;
  /** 이 시간 안은 fresh — 현행 캐시 TTL과 동일 값 사용 (예: 60초) */
  softTtlSec: number;
  /** Redis 물리 TTL — 이 시간이 지나면 완전 만료(동기 계산). soft보다 커야 한다 (예: 600초) */
  hardTtlSec: number;
  compute: () => Promise<T>;
  /**
   * ★ Codex 3R — 무효화 게이트웨이가 있는 캐시만 지정 (예: enabled-fields의 ENABLED_FIELDS_CACHE_GEN_KEY).
   * 게이트웨이(clearEnabledFieldsCache)가 INCR하는 세대 키. 지정 시 compute 도중 무효화가 발생하면
   * 저장을 생략해 "변형 전 결과가 hard TTL(10분)로 부활"하는 경합을 차단한다(호출자 응답 반환은 그대로).
   * 미지정(stats처럼 무효화 게이트웨이가 없는 순수 TTL 캐시)이면 가드 없이 저장.
   */
  generationKey?: string;
}

async function readGeneration(generationKey?: string): Promise<string | null> {
  if (!generationKey) return null;
  try {
    return await redis.get(generationKey);
  } catch {
    return null;
  }
}

/**
 * ★ Codex 5R — 세대 확인 + 저장을 Redis 안에서 원자로 실행 (확인과 setex 사이 무효화가 끼는
 * TOCTOU 잔여 창 제거 — 저장소 경합은 단문 원자로 닫는다는 LESSONS 표준).
 * KEYS[1]=캐시 키, KEYS[2]=세대 키 / ARGV[1]=계산 시작 시점 세대(''=미존재), ARGV[2]=TTL초,
 * ARGV[3]=엔벨로프, ARGV[4]='1'이면 키가 살아있을 때만 저장(백그라운드 갱신의 XX 의미).
 */
const GEN_GUARDED_SET_LUA = `
local g = redis.call('GET', KEYS[2])
if (g or '') ~= ARGV[1] then return 0 end
if ARGV[4] == '1' and redis.call('EXISTS', KEYS[1]) == 0 then return 0 end
redis.call('SETEX', KEYS[1], ARGV[2], ARGV[3])
return 1
`;

function genGuardedSet(
  key: string,
  generationKey: string,
  genBefore: string | null,
  ttlSec: number,
  envelope: string,
  requireExists: boolean,
): Promise<unknown> {
  return redis.eval(
    GEN_GUARDED_SET_LUA,
    2,
    key,
    generationKey,
    genBefore ?? '',
    String(ttlSec),
    envelope,
    requireExists ? '1' : '0',
  );
}

export async function swrCache<T>(opts: SwrCacheOptions<T>): Promise<T> {
  const { key, softTtlSec, hardTtlSec, compute, generationKey } = opts;

  let raw: string | null = null;
  try {
    raw = await redis.get(key);
  } catch {
    /* Redis 장애 = 캐시 없이 계산 */
  }

  const entry = classifySwrEntry<T>(raw, softTtlSec, Date.now());
  if (entry.state === 'fresh' || entry.state === 'legacy') return entry.value as T;
  if (entry.state === 'stale') {
    scheduleRefresh(key, hardTtlSec, compute, generationKey);
    return entry.value as T;
  }

  // miss — 동기 계산. 세대 가드: 계산 도중 무효화(INCR)가 끼면 저장 생략(변형 전 결과 부활 차단).
  // ★ Codex 5R: 세대 확인+저장 = Lua 원자 실행 — 확인과 setex 사이에 무효화가 끼는 잔여 창 제거.
  const genBefore = await readGeneration(generationKey);
  const value = await compute();
  try {
    const envelope = buildSwrEnvelope(value, Date.now());
    if (generationKey) {
      await genGuardedSet(key, generationKey, genBefore, hardTtlSec, envelope, false);
    } else {
      await redis.setex(key, hardTtlSec, envelope);
    }
  } catch {
    /* 캐시 저장 실패 무시 */
  }
  return value;
}

/**
 * ★ 2026-07-17(3) — 사전 워밍용: compute 후 세대 가드로 저장(키 부재여도 저장).
 * 무효화 길목이 캐시를 지운 뒤 백그라운드로 새 값을 미리 데워 두는 용도 —
 * 사용자가 콜드 계산을 무는 구조 자체를 제거한다. 워밍 도중 또 무효화가 끼면
 * 세대 가드가 저장을 생략하고, 그 무효화가 예약한 다음 워밍이 이어받는다.
 */
export async function swrPrimeCache<T>(opts: {
  key: string;
  hardTtlSec: number;
  compute: () => Promise<T>;
  generationKey?: string;
}): Promise<void> {
  const { key, hardTtlSec, compute, generationKey } = opts;
  const genBefore = await readGeneration(generationKey);
  const value = await compute();
  const envelope = buildSwrEnvelope(value, Date.now());
  if (generationKey) {
    await genGuardedSet(key, generationKey, genBefore, hardTtlSec, envelope, false);
  } else {
    await redis.setex(key, hardTtlSec, envelope);
  }
}

function scheduleRefresh<T>(
  key: string,
  hardTtlSec: number,
  compute: () => Promise<T>,
  generationKey?: string,
): void {
  if (inFlightRefresh.has(key)) return;
  inFlightRefresh.add(key);
  (async () => {
    const genBefore = await readGeneration(generationKey);
    const value = await compute();
    // ★ Codex 2R·3R·5R 정정 — 재계산 도중 무효화됐으면 변형 전 데이터로 부활시키지 않는다:
    //   세대 가드 + 키 생존 확인(삭제가 항상 이김)을 Lua 원자 실행. 세대 키 미지정(stats)은 'XX'만.
    const envelope = buildSwrEnvelope(value, Date.now());
    if (generationKey) {
      await genGuardedSet(key, generationKey, genBefore, hardTtlSec, envelope, true);
    } else {
      await redis.set(key, envelope, 'EX', hardTtlSec, 'XX');
    }
  })()
    .catch(() => {
      /* 갱신 실패 = 다음 stale 히트가 재시도 */
    })
    .finally(() => inFlightRefresh.delete(key));
}
