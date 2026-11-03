/**
 * journey-purchase-ledger.ts — 구매 원장을 여정 커서로 읽기 위한 판정 (2026-08-01, 설계서 §11-4)
 *
 * 정하는 것 둘뿐이다.
 *   1. 얼마나 오래된 구매까지 트리거로 인정하는가 · 원장 문을 언제 도는가
 *   2. 화면 문 안내(어느 문으로 · 마지막으로 언제 들어왔나)
 * 조회 SQL은 journey-target-extractor(추출 단일 출처)가 소유한다.
 *
 * ★ 2026-11-04 C99 — 「문은 회사마다 하나」(자사몰 문이 최근 30일 살아 있으면 원장 문을 닫는다)를 지웠다.
 *   그 규칙은 자사몰 주문을 ERP 로도 받는 회사의 중복 진입을 막으려던 것인데, 자사몰과 매장 싱크를 둘 다 쓰는 회사에서
 *   매장 구매를 여정 · 요약 칸 · 조건 · 상품 · 성과에서 통째로 뺐다(뿌리 R54). 이제 두 문을 늘 다 읽고,
 *   같은 구매 판정은 two-door-purchase(CT-D1 · CT-D2) · 진입 중복은 같은 날 다른 문 진입 소유(CT-D5)가 막는다.
 *
 * ⛔ 과거분 소급 차단은 발생 시각 하나에 걸린다
 *   커서는 도착 축이라(§11-3) 이관·전량 재적재로 3년 치가 오늘 들어오면 전부 커서 앞에 선다.
 *   막는 것은 **구매일이 최근인 것만 인정**하는 조건이다. 도착 시각으로는 아무것도 못 막는다.
 *   날짜 없는 행·미래 날짜 행도 제외한다 — 언제 일어났는지 모르면 트리거가 아니다.
 *
 * ⛔ 적재 주기에 기대지 않는다 — 정책으로 못 박는다 (2026-08-01 Harold 정정)
 *   처음엔 "그 회사 에이전트의 구매 적재 주기 × 3주기"로 창을 계산했다. 틀렸다 —
 *   **동기화 주기는 고객사가 자기 환경에서 설정하는 값이고 우리 권한이 아니다.**
 *   우리 DB의 `sync_agents` 값이 현장 설정과 같다는 보장이 없고, 고객사가 언제든 바꿔도 우리는 모른다.
 *   모르는 값에 동작을 걸면 그 값이 어긋나는 순간 **구매가 조용히 안 잡힌다.**
 *
 *   **해법은 주기를 알아내는 게 아니라 주기와 무관해지는 것이다(Harold).**
 *   매장 구매는 **하루 모아 다음 날 오전에 내보낸다.** 고객사가 10분마다 올리든 밤에 한 번 올리든,
 *   그날 안에 도착한 것은 다음 아침에 함께 나간다. 주기가 바뀌어도 동작이 안 바뀐다.
 *   덤으로 매장의 성질과도 맞는다 — 배치 적재라 "방금 구매 감사"는 애초에 불가능하고,
 *   "어제 다녀가셔서 감사합니다"가 정직한 문안이다. 야간 발송 차단과도 부딪히지 않는다.
 *
 *   ⚠ 2026-08-10 정정 — 자사몰 문(cdp_events)도 **같은 창을 쓴다**.
 *     옛 문장은 "자사몰 주문은 즉시 들어오므로 실시간 그대로"였는데, 그 전제가 참이 아니었다.
 *     고도몰은 연결 시 90일 백필을 돌리고(godo-client.backfillGodoOrders) 주기 수집도 과거 창을 다시 읽는다.
 *     즉시 들어오는 것은 **웹훅 몰**이지 자사몰 전부가 아니다. 창은 실시간 웹훅에 걸리지 않으므로
 *     (발생 시각이 곧 지금) 실시간성은 그대로고, 소급 적재만 걸러진다.
 *
 * 발생 시각 창도 이 정책에서 나온다 (임의 상수가 아니다)
 *   최악 조합 = 고객사가 하루 한 번 동기화(최대 1일 지연) + 우리가 하루 한 번 실행(최대 1일 대기).
 *   거기에 하루 여유 = **3일**. 그보다 오래된 구매는 보내지 않는다.
 *   이관 배치는 발생일이 몇 달·몇 년 전이라 이 조건에서 통째로 걸러진다.
 */

import { query } from '../config/database';

/**
 * 구매 트리거로 인정할 최대 구매 경과 시간.
 * 근거 = 하루 수집 + 다음 날 오전 실행 정책의 최악 지연(동기화 1일 + 실행 대기 1일 + 여유 1일).
 */
export const PURCHASE_TRIGGER_MAX_AGE_HOURS = 3 * 24;

/**
 * 원장 문을 도는 시간대(KST). 이 밖에는 커서를 돌리지 않는다 — 도착분은 커서 뒤에 쌓여 다음 아침에 잡힌다.
 *
 * 창을 한 시각이 아니라 구간으로 두는 이유: 워커는 5분 주기이고 한 회차가 1,000행까지만 처리한다.
 * 구간이 넓어야 하루치가 많은 회사도 그 아침에 다 소화한다(09~12시 = 최대 36회차).
 * 진입 시각이 그 안에서 흩어져도 **발송 시각은 첫 스텝 설정(delay_mode·target_hour_kst)이 통제**한다.
 */
export const LEDGER_RUN_START_HOUR_KST = 9;
export const LEDGER_RUN_END_HOUR_KST = 12;

/**
 * 이 KST 시(hour)가 원장 문을 도는 시간대인가 — 순수 함수.
 *
 * ⛔ 시각은 **DB 시계에서 받은 것만** 넣는다(Codex 지적 수용).
 *   창 끝(자정)과 구매 나이는 DB 시계로 재는데 게이트만 앱 시계로 재면 축이 둘이 된다.
 *   시계가 어긋나면 발송 시간대가 밀리고, 뒤로 가면 같은 구간을 다시 열 수 있다.
 */
export function isLedgerRunWindowHour(kstHour: number): boolean {
  return kstHour >= LEDGER_RUN_START_HOUR_KST && kstHour < LEDGER_RUN_END_HOUR_KST;
}

/**
 * ★ 2026-10-27 자사몰 대비 K1-9 — 「주문 시도」 조각(별칭 alias 의 cdp_events 행) = 결제됐든 결제 전이든 주문을 넣었다.
 *   장바구니 포기 · 둘러보고 안 삼의 **제외 판정**만 쓴다(결제 전 주문이 있는 고객에게 「안 샀어요」 문자를 보내지 않는다).
 *   시작 · 목표 · 구매 문에는 쓰지 않는다(구매 사건 = purchase 만 · I1).
 */
export function orderAttemptSql(alias: string): string {
  return `${alias}.event_name IN ('purchase', 'order_placed')`;
}

/**
 * ★ 2026-08-02 §13-5 — 화면이 "매장 구매는 하루 모아 다음 날 오전에 나갑니다"를 말하려면 **마지막으로 언제 도착했는지**를 알아야 한다.
 * ★ 2026-11-04 C99 T8 — 두 문을 따로 알린다(들어온 적 있는 문만 · 옛: 문 하나만 골라 두 문 회사에 매장 안내가 없었다).
 *   ⛔ 시각은 도착 축(created_at)이다 — 발생 축(occurred_at)으로 보여주면 "언제 동기화됐나"가 아니라
 *     "언제 샀나"가 되어 사용자가 동기화 상태를 오판한다.
 */
export interface PurchaseDoorStatus {
  /** 자사몰 주문(결제 전 주문 포함) — 들어온 적이 없으면 null. */
  mall: { lastArrivalAt: string } | null;
  /** 매장 · ERP 원장 — 들어온 적이 없으면 null. */
  ledger: { lastArrivalAt: string } | null;
}

export async function getPurchaseDoorStatus(companyId: string): Promise<PurchaseDoorStatus> {
  // ★ 1027 K1-9 — 자사몰 마지막 도착 = 결제 전 주문 도착도 포함(동기화 상태를 말하는 시각)
  const r = await query(
    `SELECT (SELECT MAX(created_at)::text FROM cdp_events WHERE company_id = $1::uuid AND event_name IN ('purchase', 'order_placed')) AS mall,
            (SELECT MAX(created_at)::text FROM purchases WHERE company_id = $1::uuid) AS ledger`,
    [companyId],
  );
  const x = r.rows[0] || {};
  return { mall: x.mall ? { lastArrivalAt: x.mall } : null, ledger: x.ledger ? { lastArrivalAt: x.ledger } : null };
}
