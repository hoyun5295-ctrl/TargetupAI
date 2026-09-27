/**
 * CT-56 utils/ai-cache.ts (D209+ 2026-05-22)
 *
 * Phase D 비용 안전 매트릭스 — 자연어 입력 동일 영역 cache (회사별 hash)
 *
 * 본질: 동일 회사 동일 system + userMessage 영역 5분 안 재호출 = AI 호출 0건 + 비용 0
 *
 * 영구 원칙 정합:
 *  - SHA-256 hash (회사 격리 + 충돌 0)
 *  - 5분 TTL (단기 cache — 시즌 변동 영역 안전)
 *  - in-memory (Redis 의존 X — Map 정합)
 *  - 응답 X 영역은 cache 저장 X (오류 안전)
 *  - cache 매트릭스 통계 진단 (hit/miss 카운트)
 *  - 매트릭스 메모리 영역 폭증 차단 (1000 진입 시 가장 오래된 entry 제거)
 */

import crypto from 'crypto';

interface CacheEntry {
  response: string;
  expiresAt: number;
  createdAt: number;
  companyId?: string;   // ★ 2026-09-27 R073·R300 — 회사별 통계용
}

const responseCache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 5 * 60 * 1000;  // 5분
const CACHE_MAX_SIZE = 1000;

let hitCount = 0;
let missCount = 0;
// ★ 2026-09-27 한줄로 V2 R073·R300 — 회사별 적중·실패(옛: 프로세스 전역 수만 있어 모든 회사 화면에 전사 합산과 그로 계산한 절감액이 나갔다)
const companyCounts = new Map<string, { hit: number; miss: number }>();
function bump(companyId: string | undefined, kind: 'hit' | 'miss'): void {
  if (!companyId) return;
  const c = companyCounts.get(companyId) || { hit: 0, miss: 0 };
  c[kind] += 1;
  companyCounts.set(companyId, c);
}

/**
 * 회사별 입력 hash 생성 (SHA-256)
 */
export function generateCacheKey(companyId: string, system: string, userMessage: string): string {
  return crypto
    .createHash('sha256')
    .update(`${companyId}|${system}|${userMessage}`)
    .digest('hex');
}

/**
 * cache 조회 — hit 시 response 반환, miss 시 null
 */
export function getCachedResponse(key: string, companyId?: string): string | null {
  const entry = responseCache.get(key);
  if (!entry) {
    missCount++;
    bump(companyId, 'miss');
    return null;
  }
  if (entry.expiresAt <= Date.now()) {
    responseCache.delete(key);
    missCount++;
    bump(companyId, 'miss');
    return null;
  }
  hitCount++;
  bump(companyId, 'hit');
  return entry.response;
}

/**
 * cache 저장 — 5분 TTL + 메모리 영역 자동 관리
 */
export function setCachedResponse(key: string, response: string, companyId?: string): void {
  if (!response || response.length === 0) return;
  if (responseCache.size >= CACHE_MAX_SIZE) {
    const oldestKey = responseCache.keys().next().value;
    if (oldestKey) responseCache.delete(oldestKey);
  }
  responseCache.set(key, {
    response,
    expiresAt: Date.now() + CACHE_TTL_MS,
    createdAt: Date.now(),
    companyId,
  });
}

/**
 * cache 통계 (관리자 진단용)
 */
export function getCacheStats(companyId?: string): { size: number; hit: number; miss: number; hitRate: number } {
  // ★ 2026-09-27 R073·R300 — 회사 화면은 그 회사 몫만(회사 id가 오면 회사별 · 없으면 종전 전역)
  if (companyId) {
    const c = companyCounts.get(companyId) || { hit: 0, miss: 0 };
    let size = 0;
    const now = Date.now();
    for (const e of responseCache.values()) if (e.companyId === companyId && e.expiresAt > now) size++;
    const t = c.hit + c.miss;
    return { size, hit: c.hit, miss: c.miss, hitRate: t > 0 ? c.hit / t : 0 };
  }
  const total = hitCount + missCount;
  return {
    size: responseCache.size,
    hit: hitCount,
    miss: missCount,
    hitRate: total > 0 ? hitCount / total : 0,
  };
}
