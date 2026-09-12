/**
 * db-column-probe.ts — 컬럼 존재 탐지 (CT)
 *
 * 🎯 목적
 *   DDL과 코드 배포 사이의 창에서 **없는 컬럼을 조회해 터지는 것**을 막는다.
 *   컬럼이 아직 없으면 옛 경로로, 생기면 새 경로로 — 배포 순서가 어느 쪽이어도 기능이 살아 있게 한다.
 *
 * ⛔ 원칙
 *   - **양성(있음)은 영구 캐시**한다. 컬럼이 생겼다가 사라지는 일은 없다.
 *   - **음성(없음)은 5분 뒤 재탐지**한다. DDL이 재기동 없이 적용되는 창을 덮는다.
 *   - 조회 자체가 실패하면 "없음"으로 본다(fail-closed) — 새 경로를 타서 터지는 것보다 옛 경로가 낫다.
 *
 * 참고: 같은 판정을 파일마다 인라인으로 쓰던 곳이 여럿 있다(`email-channel`·`inapp-message`·
 *   `copy-rag-retriever` 등). 그 통합은 별도 과제로 두고, 여기서는 새로 쓰는 곳만 받는다.
 */

import { query } from '../config/database';

const NEGATIVE_TTL_MS = 5 * 60 * 1000;
const cache = new Map<string, { value: boolean; checkedAt: number }>();

/**
 * `table`에 `column`이 있는가.
 * @param table  테이블 이름(public 스키마)
 * @param column 컬럼 이름
 */
export async function hasColumn(table: string, column: string): Promise<boolean> {
  const key = `${table}.${column}`;
  const hit = cache.get(key);
  const now = Date.now();
  if (hit && (hit.value || now - hit.checkedAt < NEGATIVE_TTL_MS)) return hit.value;

  try {
    const r = await query(
      `SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = $1 AND column_name = $2
        LIMIT 1`,
      [table, column],
    );
    cache.set(key, { value: r.rows.length > 0, checkedAt: now });
  } catch {
    cache.set(key, { value: false, checkedAt: now });
  }
  return cache.get(key)!.value;
}

/** 테스트·운영 점검용 — 캐시를 비운다(운영 경로에서 부르지 않는다) */
export function clearColumnProbeCache(): void {
  cache.clear();
}
