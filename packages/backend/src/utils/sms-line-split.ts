// utils/sms-line-split.ts
// ★ 순수 함수 (DB import 0) — MMS/문자 라인 분리 결정. TDD 대상(sms-line-split.verify.ts).
//
// 배경(2026-06-20 실측): 단일 bind 게이트웨이에서 같은 라인에 MMS와 문자가 섞이면,
//   무거운 MMS가 그 라인을 점유해 뒤에 깔린 문자(LMS/SMS)가 길게 대기한다
//   (시세이도 즉시발송 LMS가 MMS 백로그 뒤에서 40분 지연).
// 대책: 한 회사 라인 "안"에서 MMS와 문자를 서로 겹치지 않는 라인으로 가른다.
//   → 문자가 MMS 뒤에 안 깔린다. 회사 라인 안에서만 나누므로 메시지는 여전히
//     회사 라인 집합 안에 있고, 집계·취소·정산(회사 라인 union 조회)은 무영향.
//
// ※ 회사 밖 유휴 라인으로 문자를 빼는 방식은 집계·취소가 그 라인을 못 봐
//    라인불일치 사고(2026-06-11)를 재현하므로 채택하지 않는다.

/** 혼합 배치에서 MMS 전용 라인 수(나머지는 문자). 문자 우선 = 다수 라인. 튜닝 상수. */
export const MMS_LANE_COUNT = 1;

/**
 * 회사 라인을 MMS용/문자용으로 가른다.
 * - 라인 2개 미만 또는 한 종류만 있으면 분리 불가/불필요 → 양쪽 모두 전 라인(기존 동작).
 * - 혼합(MMS+문자) + 라인 2개 이상이면 → 앞쪽 MMS_LANE_COUNT개는 MMS, 나머지(다수)는 문자.
 *   문자 라인 최소 1개를 보장한다(MMS가 라인을 다 가져가지 않음).
 */
export function splitLinesByMsgType(
  tables: string[],
  hasMms: boolean,
  hasText: boolean,
): { mmsLines: string[]; textLines: string[] } {
  if (tables.length < 2 || !hasMms || !hasText) {
    return { mmsLines: tables, textLines: tables };
  }
  const mmsCount = Math.min(MMS_LANE_COUNT, tables.length - 1);
  return {
    mmsLines: tables.slice(0, mmsCount),
    textLines: tables.slice(mmsCount),
  };
}
