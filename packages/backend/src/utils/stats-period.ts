/**
 * stats-period.ts — 통계 조회 기간 계산 컨트롤타워 (★ 2026-07-25 신설)
 *
 * 신설 사유: 월별(monthly) 조회에서 시작·종료일을 월 단위로 넓히는 규칙이 **두 벌 따로 있었다.**
 *   - `stats-aggregation.ts` querySendStats 안 인라인 블록 (발송통계 화면 웹 탭)
 *   - `pay-stats.ts` 파일 로컬 `expandMonthly` (에이전트 통계·CSV)
 *
 * 그런데 0725에 발송통계 엑셀의 웹 행 소스를 청구 집계(`send-usage-aggregation`)로 바꾸면서
 * **웹 행만 이 확장을 안 거치게 됐다.** 결과는 조용한 과소집계다 —
 * 월별 보기에서 기본 날짜(오늘~오늘)로 받으면 같은 파일 안에서
 * 에이전트 행은 그 달 전체, 웹 행은 하루치인데 기간 라벨은 둘 다 `YYYY-MM`으로 같다.
 * 이 파일은 정산 대조에 쓰이므로 축이 갈리면 대조 자체가 성립하지 않는다.
 *
 * 그래서 규칙을 여기 하나로 모으고 세 소비처가 같은 함수를 부른다. 복사하면 언젠가 또 갈라진다.
 */

/**
 * (순수) 월별 조회 시 기간을 그 달 전체로 넓힌다. daily면 받은 값을 그대로 돌려준다.
 *
 * 시작일 → 그 달 1일 / 종료일 → 그 달 말일.
 *
 * ※ 입력은 **정규화(trim)된 `YYYY-MM-DD`** 여야 한다. 공백이 낀 값을 그대로 넘기면
 *   `substring(0, 7)`이 `' 2026-0'`처럼 깨져 시작일 필터가 조용히 빠진다
 *   (`pay-stats.ts` validateStatsDateRange가 정규화 값을 돌려주는 이유가 이것이다).
 */
export function expandMonthlyRange(
  view: 'daily' | 'monthly',
  startDate?: string,
  endDate?: string,
): { startDate?: string; endDate?: string } {
  if (view !== 'monthly') return { startDate, endDate };

  let s = startDate;
  let e = endDate;
  if (s) s = s.substring(0, 7) + '-01';
  if (e) {
    const d = new Date(e);
    d.setMonth(d.getMonth() + 1, 0); // 다음 달 0일 = 이번 달 말일
    e = d.toISOString().split('T')[0];
  }
  return { startDate: s, endDate: e };
}
