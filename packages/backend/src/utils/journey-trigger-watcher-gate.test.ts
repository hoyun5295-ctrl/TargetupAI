/**
 * 판정 불가 게이트 — 제어 흐름 행동 검증 (2026-08-01)
 *
 * 왜 별도인가
 *   같은 취지의 소스 스캔 테스트(journey-entry-invariants)는 토큰 존재만 본다.
 *   Codex 2R이 실제로 `if (!judgement.canJudge)`를 반전시켜 보니 그 단정들이 **전부 통과**했다.
 *   판정 가능한 여정을 멈추고 판정 불가능한 여정을 발송으로 보내는 회귀인데 테스트는 초록이었다.
 *   그래서 "무엇이 호출되는가"를 직접 단정한다.
 *
 * 못 박는 것:
 *   1. canJudge=false → 여정 정지 UPDATE가 나가고 **추출은 호출되지 않는다**.
 *   2. canJudge=true  → 추출이 호출되고 정지 UPDATE는 나가지 않는다.
 *   3. 정지 쓰기는 company_id를 WHERE에 포함한다(회사 격리).
 *   4. 판정 근거는 워커가 한 번 계산해 **그대로 추출에 넘긴다**(재조회로 생기는 창 차단).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../config/database', () => ({
  query: vi.fn(),
  pool: { connect: vi.fn() },
}));
vi.mock('./company-data-profile', () => ({
  getCompanyIdentityCapability: vi.fn(),
}));
vi.mock('./journey-target-extractor', () => ({
  selectJourneyTargetCustomerIds: vi.fn(),
  selectCdpEventRowsForCursor: vi.fn(),
  selectCartAbandonProperties: vi.fn(),
  JOURNEY_COUNT_CAP: 100000,
}));

import { query } from '../config/database';
import { getCompanyIdentityCapability } from './company-data-profile';
import { selectJourneyTargetCustomerIds } from './journey-target-extractor';
import { runJourneyTriggerWatcher } from './journey-trigger-watcher';

const q = query as unknown as ReturnType<typeof vi.fn>;
const cap = getCompanyIdentityCapability as unknown as ReturnType<typeof vi.fn>;
const extract = selectJourneyTargetCustomerIds as unknown as ReturnType<typeof vi.fn>;

const JOURNEY_ID = '11111111-1111-1111-1111-111111111111';
const COMPANY_ID = '22222222-2222-2222-2222-222222222222';

/** 활성 여정 1건(신규가입)을 돌려주는 SELECT + 그 밖 호출은 빈 결과. */
function mockActiveSignupJourney() {
  q.mockImplementation(async (sql: string) => {
    if (/FROM journeys/.test(sql) && /status = 'active'/.test(sql) && /SELECT/.test(sql)) {
      return {
        rows: [{
          id: JOURNEY_ID,
          company_id: COMPANY_ID,
          template_code: 'onboarding',
          trigger_event: 'customer.created',
          trigger_filters: {},
          allow_reentry: false,
          reentry_cooldown_days: null,
          stats_total_entered: 0,
          threshold_recipients_per_step: null,
          last_event_cursor: null,
        }],
      };
    }
    return { rows: [], rowCount: 0 };
  });
}

/** 정지 UPDATE 호출만 골라낸다. */
function pauseCalls() {
  return q.mock.calls.filter(([sql]) => typeof sql === 'string' && /UPDATE journeys SET status = 'paused'/.test(sql));
}

const NO_SIGNALS = {
  hasPurchaseCount: false, hasRecentPurchaseDate: false, hasTotalPurchaseAmount: false,
  hasPoints: false, hasLastPurchaseDate: false, hasPurchaseLedger: false,
  defaultGrade: null, signupDateColumn: null,
};
const HAS_SIGNAL = { ...NO_SIGNALS, hasPurchaseCount: true };

describe('신규 고객 판정 불가 게이트', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockActiveSignupJourney();
    extract.mockResolvedValue([]);
  });

  it('판정 근거가 없으면 발송 추출을 아예 하지 않는다', async () => {
    cap.mockResolvedValue(NO_SIGNALS);
    const summary = await runJourneyTriggerWatcher();

    expect(extract).not.toHaveBeenCalled();
    expect(summary).toEqual({ matched: 0, enqueued: 0, skipped: 0 });
  });

  it('판정 근거가 없으면 사유를 남기고 여정을 정지한다 — 조용한 0건 금지', async () => {
    cap.mockResolvedValue(NO_SIGNALS);
    await runJourneyTriggerWatcher();

    const calls = pauseCalls();
    expect(calls).toHaveLength(1);
    const [, params] = calls[0];
    expect(String(params[2])).toContain('신규 고객 판정 불가');
  });

  it('정지 쓰기는 company_id로 회사를 강제한다', async () => {
    cap.mockResolvedValue(NO_SIGNALS);
    await runJourneyTriggerWatcher();

    const [sql, params] = pauseCalls()[0];
    expect(sql).toMatch(/company_id = \$2::uuid/);
    expect(params[0]).toBe(JOURNEY_ID);
    expect(params[1]).toBe(COMPANY_ID);
  });

  it('판정 근거가 있으면 정지하지 않고 추출로 넘어간다', async () => {
    cap.mockResolvedValue(HAS_SIGNAL);
    await runJourneyTriggerWatcher();

    expect(pauseCalls()).toHaveLength(0);
    expect(extract).toHaveBeenCalledTimes(1);
  });

  // ★ 2026-08-01 Codex 3R — 능력을 추출에 넘기던 계약을 폐기했다.
  //   술어는 고객 데이터로만 평가되므로 추출은 능력을 알 필요가 없고, 넘기면 능력을 읽은 시점과
  //   고객 행을 읽는 시점이 갈려 경합이 남는다. 그래서 "넘기지 않는다"를 대신 못 박는다.
  it('회사 능력은 게이트에서 한 번만 조회하고 추출에 넘기지 않는다', async () => {
    cap.mockResolvedValue(HAS_SIGNAL);
    await runJourneyTriggerWatcher();

    expect(cap).toHaveBeenCalledTimes(1);
    const args = extract.mock.calls[0];
    expect(args).toHaveLength(6);                      // companyId·trigger·filters·limit·journeyId·reentry
    expect(args.some((a: unknown) => a === HAS_SIGNAL)).toBe(false);
  });
});
