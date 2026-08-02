/**
 * journey-purchase-ledger.ts — 구매 원장을 여정 커서로 읽기 위한 판정 (2026-08-01, 설계서 §11-4)
 *
 * 정하는 것 둘뿐이다.
 *   1. 이 회사의 구매는 어느 문으로 들어오는가 (원장인가 자사몰 이벤트인가)
 *   2. 얼마나 오래된 구매까지 트리거로 인정하는가
 * 조회 SQL은 journey-target-extractor(추출 단일 출처)가 소유한다.
 *
 * ⛔ 문은 회사마다 하나다
 *   자사몰 주문(`cdp-orders`)은 `cdp_events`에만 쌓고 원장에는 쓰지 않는다(`INSERT INTO purchases`는
 *   싱크 라우트 두 곳뿐 — grep 확인). 그래서 보통은 두 문이 겹치지 않는다.
 *   문제는 **자사몰 주문을 ERP에도 동기화해 우리에게 두 번 주는 회사**다. 그 회사에서 두 문을 다 읽으면
 *   같은 구매가 두 번 진입한다 — 구매 템플릿은 재진입 허용에 쿨다운 0이라 그대로 중복 발송·중복 과금이다.
 *   그러니 **자사몰 문이 살아 있으면 원장 문을 열지 않는다.** 이 판정 구조는 새로 만든 게 아니다 —
 *   `customer-purchase-aggregates`가 구매요약을 두 채널이 덮어쓰지 않게 하려고 이미 같은 방식을 쓴다.
 *
 *   "살아 있다"는 존재가 아니라 **최근**으로 본다. 옛날 테스트 이벤트 한 건이 원장 문을 영영 닫으면
 *   "켜 뒀는데 0건"이 되고, 그게 이 재설계가 없애려는 바로 그 상태다(설계서 §2-3).
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
 *   ⚠ 자사몰 문(cdp_events)은 이 정책을 쓰지 않는다. 주문이 즉시 들어오므로 실시간 그대로다.
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

/** 자사몰 문이 "살아 있다"고 볼 기간. 한 달 안에 그 문으로 구매가 들어왔으면 그 문이 현역이다. */
export const MALL_DOOR_ACTIVE_DAYS = 30;

// ── 문 판정 캐시 ──
//   ⛔ **"자사몰 문 없음"은 캐시하지 않는다**(Codex 지적 수용).
//     캐시된 false는 그 시간 동안 원장 문을 열어 둔다 — 그 사이 자사몰 첫 구매가 들어오면
//     두 문이 동시에 열려 같은 구매가 두 번 진입한다(중복 발송·중복 과금). 기본값이 열림인 장치다.
//     반대로 true(=원장 잠금)는 안전한 방향이라 캐시해도 된다.
//   조회는 EXISTS 한 줄이고, 원장 문은 하루 3시간만 도니 부하는 그 시간대의 여정 수뿐이다.
const DOOR_CLOSED_TTL_MS = 30 * 60 * 1000;
const doorCache = new Map<string, { at: number; mallActive: boolean }>();

/** 테스트 전용 — 판정 캐시 비우기. */
export function resetPurchaseLedgerCaches(): void {
  doorCache.clear();
}

/**
 * 자사몰 문이 현역인가 — 최근 구매 이벤트가 있으면 참.
 * 참이면 원장 문을 닫는다(같은 구매를 두 번 읽지 않는다).
 */
export async function isMallPurchaseDoorActive(companyId: string): Promise<boolean> {
  const cached = doorCache.get(companyId);
  // true(원장 잠금)만 캐시를 신뢰한다 — false를 캐시하면 그 사이 자사몰 구매가 들어와도 원장 문이 열려 있다.
  if (cached?.mallActive && Date.now() - cached.at < DOOR_CLOSED_TTL_MS) return true;
  const r = await query(
    `SELECT 1 FROM cdp_events
      WHERE company_id = $1::uuid
        AND event_name = 'purchase'
        AND occurred_at >= NOW() - ($2 || ' days')::interval
      LIMIT 1`,
    [companyId, String(MALL_DOOR_ACTIVE_DAYS)],
  );
  const mallActive = r.rows.length > 0;
  doorCache.set(companyId, { at: Date.now(), mallActive });
  return mallActive;
}

/**
 * ★ 2026-08-02 §13-5 — 화면이 "매장 구매는 하루 모아 다음 날 오전에 나갑니다"를 말하려면
 *   **어느 문이 진실인지**와 **마지막으로 언제 도착했는지**를 알아야 한다. 그 판정은 이 CT가 소유한다.
 *   ⛔ 시각은 도착 축(created_at)이다 — 발생 축(occurred_at)으로 보여주면 "언제 동기화됐나"가 아니라
 *     "언제 샀나"가 되어 사용자가 동기화 상태를 오판한다.
 */
export interface PurchaseDoorStatus {
  /** 'mall' = 자사몰 이벤트가 진실 · 'ledger' = 매장·ERP 원장이 진실. */
  door: 'mall' | 'ledger';
  /** 그 문으로 구매가 마지막으로 도착한 시각(ISO). 한 건도 없으면 null. */
  lastArrivalAt: string | null;
}

export async function getPurchaseDoorStatus(companyId: string): Promise<PurchaseDoorStatus> {
  const mallActive = await isMallPurchaseDoorActive(companyId);
  if (mallActive) {
    const r = await query(
      `SELECT MAX(created_at)::text AS last FROM cdp_events
        WHERE company_id = $1::uuid AND event_name = 'purchase'`,
      [companyId],
    );
    return { door: 'mall', lastArrivalAt: r.rows[0]?.last || null };
  }
  const r = await query(
    `SELECT MAX(created_at)::text AS last FROM purchases WHERE company_id = $1::uuid`,
    [companyId],
  );
  return { door: 'ledger', lastArrivalAt: r.rows[0]?.last || null };
}

export interface PurchaseLedgerGate {
  /** 원장 커서를 돌릴 것인가. */
  enabled: boolean;
  /** 닫혔다면 사유(로그용 — 화면 문구가 아니다). */
  reason?: string;
}

/**
 * 이 회사에서 원장 문을 열지 판정한다 — **어느 문인가**만 본다.
 * **언제 도는가**(실행 시간대)는 호출부가 DB 시계로 판정한다(isLedgerRunWindowHour).
 */
export async function resolvePurchaseLedgerGate(companyId: string): Promise<PurchaseLedgerGate> {
  if (await isMallPurchaseDoorActive(companyId)) {
    return { enabled: false, reason: '자사몰 구매 이벤트가 현역 — 원장 문은 닫는다(중복 진입 차단)' };
  }
  return { enabled: true };
}
