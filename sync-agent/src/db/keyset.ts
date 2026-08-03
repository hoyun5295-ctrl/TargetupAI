/**
 * keyset.ts — 증분 커서(키셋) 공통 순수 모듈 (2026-08-03)
 *
 * 소유하는 것
 *   1) 키셋 조회 술어 조립 — (ts, pk...) 튜플 비교의 전개형. Oracle이 행값 튜플 비교를
 *      지원하지 않아 전개형이 전 DB 공통의 유일한 길이다.
 *   2) source_row_key 직렬화 — PK 값들을 이스케이프하여 결합. 서버 멱등키의 원료.
 *
 * 왜 필요했나 (2026-08-03 이새 실측)
 *   커서에 "동기화 완료 시각"을 넣던 구조가 시각 없는 판매일 컬럼과 만나 한 달 유실 98%를 만들었다.
 *   커서는 **가져온 행에서 읽은 값**이어야 하고, 시각은 **DB가 만든 원문 문자열**로 왕복해야 한다
 *   (JS Date 왕복은 프로세스 TZ 의존 — 재부팅·TZ 변경 사이에 벽시계가 밀린다).
 *
 * 순수 모듈 — DB 드라이버 import 0. 어댑터 4종(oracle·mssql·mysql·postgresql)이 공유한다.
 */

/** 증분 커서 — 마지막 처리 행의 (타임스탬프 원문, PK 값들) */
export interface IncrementalCursor {
  /** 타임스탬프 DB 원문 문자열 — 어댑터 자신이 조회 때 실어 준 형식 그대로 */
  tsRaw: string;
  /** PK 값들 (복합 PK = 다열). string|number만 — Date·객체는 결정적 직렬화 불가라 진입 전에 잠근다 */
  keys: (string | number)[];
}

/** 행별 커서 성분 — 조회 결과 rows[i]와 1:1 */
export interface RowCursorMeta {
  tsRaw: string;
  keys: (string | number)[];
}

/**
 * 키셋 술어 조립.
 *   (ts > B) OR (ts = B AND (k0 > p0 OR (k0 = p0 AND (k1 > p1 ...))))
 *
 * @param tsColExpr  타임스탬프 컬럼 식(quoting 완료 상태로 받는다)
 * @param wrapTsBind 타임스탬프 바인드 토큰을 컬럼 타입에 맞는 상수식으로 감싸는 함수
 *                   (예: t => `TO_TIMESTAMP(${t},'...')`) — 변환은 항상 상수 쪽. 컬럼 쪽 캐스트는 인덱스를 죽인다.
 * @param bind       바인드 토큰 생성기. 이름('ts'|'k0'|'k1'...)을 받아 자리 토큰을 돌려준다.
 *                   위치 기반 dialect(?)는 이 호출 시점에 값을 push하는 클로저로 순서를 맞춘다.
 *                   'ts'는 두 번, 마지막 키 이전의 'k{i}'도 두 번 호출된다.
 * @param pkColExprs PK 컬럼 식 목록(quoting 완료). 빈 배열이면 ts 단독 비교(호출부가 사전에 잠그므로 방어용).
 */
export function buildKeysetPredicate(
  tsColExpr: string,
  wrapTsBind: (bindToken: string) => string,
  bind: (name: string) => string,
  pkColExprs: string[],
): string {
  if (pkColExprs.length === 0) {
    return `${tsColExpr} > ${wrapTsBind(bind('ts'))}`;
  }
  const tail = (i: number): string => {
    const gt = `${pkColExprs[i]} > ${bind(`k${i}`)}`;
    if (i === pkColExprs.length - 1) return gt;
    return `${gt} OR (${pkColExprs[i]} = ${bind(`k${i}`)} AND (${tail(i + 1)}))`;
  };
  return `(${tsColExpr} > ${wrapTsBind(bind('ts'))} OR (${tsColExpr} = ${wrapTsBind(bind('ts'))} AND (${tail(0)})))`;
}

// ─── source_row_key 직렬화 ──────────────────────────────

/** 서버 purchases.source_row_key varchar(200)과 같은 값 — 초과 키는 보내지 않는다(자르면 다른 행이 같은 키). */
export const MAX_SOURCE_ROW_KEY_LEN = 200;

/** 구분자 '|'와 이스케이프 문자 '\'를 이스케이프 — 값 안의 '|'가 행 경계를 흉내 내지 못하게. */
export function escapeKeyPart(v: string): string {
  return v.replace(/\\/g, '\\\\').replace(/\|/g, '\\|');
}

/**
 * PK 값들 → source_row_key. 결정적이어야 한다 — 같은 행은 언제 봐도 같은 키.
 * null 반환 = 이 행은 키 없이(legacy 경로로) 적재된다:
 *   - PK 값에 NULL이 있다(행 식별 불가)
 *   - string|number|bigint 밖의 타입(Date·객체 — TZ 의존 직렬화라 결정적이지 않다)
 *   - 결합 길이가 상한 초과(자르지 않는다)
 */
export function serializeSourceRowKey(values: unknown[]): string | null {
  if (values.length === 0) return null;
  const parts: string[] = [];
  for (const v of values) {
    if (v === null || v === undefined) return null;
    if (typeof v === 'number' && Number.isFinite(v)) parts.push(String(v));
    else if (typeof v === 'bigint') parts.push(v.toString());
    else if (typeof v === 'string') parts.push(v);
    else return null;
  }
  const joined = parts.map(escapeKeyPart).join('|');
  return joined.length > MAX_SOURCE_ROW_KEY_LEN ? null : joined;
}

/** 커서 키 값이 결정적 왕복 가능한 스칼라인지 — 아니면 증분을 잠근다. */
export function cursorKeysValid(keys: unknown[]): keys is (string | number)[] {
  return keys.every(
    (k) => typeof k === 'string' || (typeof k === 'number' && Number.isFinite(k)),
  );
}

/**
 * 드라이버 결과 행에서 커서 성분(원문 ts + PK 값)을 뽑고 내부 원문 컬럼을 제거한다.
 * 어댑터 4종 공용 — 각 어댑터는 이 결과의 cleanRows에 자기 normalizeRows를 적용해 반환한다.
 * PK 값은 드라이버 원형 그대로 둔다(bigint→string 변환은 드라이버 설정 몫, 스칼라 검증은 엔진 몫).
 */
export function extractRowCursorMeta(
  driverRows: Record<string, unknown>[],
  rawAlias: string,
  pkColumns: string[],
): { cleanRows: Record<string, unknown>[]; meta: RowCursorMeta[] } {
  const cleanRows: Record<string, unknown>[] = [];
  const meta: RowCursorMeta[] = [];
  for (const row of driverRows) {
    const tsRaw = row[rawAlias];
    const keys = pkColumns.map((c) => row[c]) as (string | number)[];
    meta.push({ tsRaw: String(tsRaw ?? ''), keys });
    const clean: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(row)) {
      if (k === rawAlias) continue;
      clean[k] = v;
    }
    cleanRows.push(clean);
  }
  return { cleanRows, meta };
}
