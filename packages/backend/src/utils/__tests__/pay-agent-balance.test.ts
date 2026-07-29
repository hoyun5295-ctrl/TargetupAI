/**
 * pay-agent-balance.test.ts — queryPayAgentBalances 순수 선택 로직(pickLedgerBalances) 검증
 * (★ 2026-07-24 §5-2 에이전트 선불 잔액 · ★ 2026-07-27 잔액 소스 정정)
 *
 * ★ 2026-07-27 소스 교체: 일별 통계 `RSRM_SalesStts.RemAmt` → 계정 원장 `RSRM_SalesMst.RemAmt`.
 *   통계 행은 잔액이 아니었다(C0130 전 기간 0 vs 원장 640,281.625) — 화면이 "07-09 기준 0원"을 현재 잔액처럼 보여줬다.
 *   옛 pickLatestBalances(DestDt/UpdTm 기준 선택)는 그 잘못된 소스 전용이라 폐기.
 *
 * 핵심 계약:
 *  - 원장 행 없는 ID = rem_amt null(no_row) — 0원 합성 금지
 *  - 권위 행 = StoreId = CustId(계정 대표 행). 지점 행(RemAmt 0)이 잔액을 가리지 않는다
 *  - 대표 행이 없는 계정 = null(no_account_row) — **지점 행 합산 금지**(근거 없음, 돈은 틀린 숫자보다 미확정)
 *  - 입력 행 순서와 무관하게 같은 결과 / custIds 순서 보존 + 전 ID 반환(조용한 누락 방지)
 */
import { describe, it, expect } from 'vitest';
import { pickLedgerBalances, PayLedgerRow, parseAgentLedgerFields, parseAgentLedgerPatch, parseAgentCharges, toChargeRow, matchHealWindow } from '../pay-stats';

const row = (o: Partial<PayLedgerRow>): PayLedgerRow => o;

describe('pickLedgerBalances', () => {
  it('원장에 계정이 없으면 rem_amt null(no_row) — 0원 합성 금지', () => {
    const out = pickLedgerBalances(['C0119'], []);
    expect(out).toHaveLength(1);
    expect(out[0].agent_send_id).toBe('C0119');
    expect(out[0].rem_amt).toBeNull();
    expect(out[0].unknown_reason).toBe('no_row');
  });

  it('대표 행(StoreId=CustId)의 RemAmt를 잔액으로 — 0727 실측값 소수까지 보존', () => {
    const out = pickLedgerBalances(['C0130', 'D0078', 'D0079'], [
      row({ CustId: 'C0130', StoreId: 'C0130', RemAmt: 640281.625, SeqNo: 9034 }),
      row({ CustId: 'D0078', StoreId: 'D0078', RemAmt: 4881227.5, SeqNo: 8956 }),
      row({ CustId: 'D0079', StoreId: 'D0079', RemAmt: 10384423, SeqNo: 8957 }),
    ]);
    expect(out.map((o) => o.rem_amt)).toEqual([640281.625, 4881227.5, 10384423]);
    expect(out.every((o) => o.unknown_reason === null)).toBe(true);
  });

  it('지점 행(RemAmt 0)이 대표 행 잔액을 가리지 않는다 — 입력 순서 무관', () => {
    const account = row({ CustId: 'C0002', StoreId: 'C0002', RemAmt: 12345.5, SeqNo: 100 });
    const branch1 = row({ CustId: 'C0002', StoreId: 'shop-a', RemAmt: 0, SeqNo: 101 });
    const branch2 = row({ CustId: 'C0002', StoreId: 'shop-b', RemAmt: 0, SeqNo: 102 });
    expect(pickLedgerBalances(['C0002'], [branch1, account, branch2])[0].rem_amt).toBe(12345.5);
    expect(pickLedgerBalances(['C0002'], [branch2, branch1, account])[0].rem_amt).toBe(12345.5);
  });

  it('대표 행이 없는 계정(지점 행만)은 합산하지 않고 null(no_account_row) — B0046형 200행 실측', () => {
    const out = pickLedgerBalances(['B0046'], [
      row({ CustId: 'B0046', StoreId: 'b1', RemAmt: 1000, SeqNo: 1 }),
      row({ CustId: 'B0046', StoreId: 'b2', RemAmt: 2000, SeqNo: 2 }),
      row({ CustId: 'B0046', StoreId: 'b3', RemAmt: 0, SeqNo: 3 }),
    ]);
    expect(out[0].rem_amt).toBeNull();
    expect(out[0].unknown_reason).toBe('no_account_row');
  });

  it('대표 행이 여럿이면 SeqNo 최대 — 입력 순서 무관하게 결정적', () => {
    const older = row({ CustId: 'B0019', StoreId: 'B0019', RemAmt: 100, SeqNo: 10 });
    const newer = row({ CustId: 'B0019', StoreId: 'B0019', RemAmt: 200, SeqNo: 20 });
    expect(pickLedgerBalances(['B0019'], [older, newer])[0].rem_amt).toBe(200);
    expect(pickLedgerBalances(['B0019'], [newer, older])[0].rem_amt).toBe(200);
  });

  it('RemAmt null·빈 문자열·비수치는 0으로 강제 변환하지 않고 null(no_value)', () => {
    const out = pickLedgerBalances(['A0', 'A1', 'A2'], [
      row({ CustId: 'A0', StoreId: 'A0', RemAmt: null, SeqNo: 1 }),
      row({ CustId: 'A1', StoreId: 'A1', RemAmt: '', SeqNo: 2 }),
      row({ CustId: 'A2', StoreId: 'A2', RemAmt: 'abc', SeqNo: 3 }),
    ]);
    expect(out.map((o) => o.rem_amt)).toEqual([null, null, null]);
    expect(out.map((o) => o.unknown_reason)).toEqual(['no_value', 'no_value', 'no_value']);
  });

  it('음수·0은 실값 그대로 (상계 계정)', () => {
    const out = pickLedgerBalances(['B0114', 'C0083'], [
      row({ CustId: 'B0114', StoreId: 'B0114', RemAmt: -645884, SeqNo: 1 }),
      row({ CustId: 'C0083', StoreId: 'C0083', RemAmt: 0, SeqNo: 2 }),
    ]);
    expect(out[0].rem_amt).toBe(-645884);
    expect(out[1].rem_amt).toBe(0);
    expect(out.every((o) => o.unknown_reason === null)).toBe(true);
  });

  it('custIds 순서를 보존하고 전 ID를 반환한다 (일부만 원장 보유)', () => {
    const out = pickLedgerBalances(['B0225', 'C0119', 'D0079'], [
      row({ CustId: 'D0079', StoreId: 'D0079', RemAmt: 10384423, SeqNo: 8957 }),
      row({ CustId: 'B0225', StoreId: 'B0225', RemAmt: 91277, SeqNo: 500 }),
    ]);
    expect(out.map((o) => o.agent_send_id)).toEqual(['B0225', 'C0119', 'D0079']);
    expect(out.map((o) => o.rem_amt)).toEqual([91277, null, 10384423]);
  });

  it('CustId 빈 행·대상 외 계정은 결과에 섞이지 않는다 · 공백/대소문자 정규화', () => {
    const out = pickLedgerBalances(['D0079'], [
      row({ CustId: '', StoreId: '', RemAmt: 999, SeqNo: 1 }),
      row({ CustId: 'Z9999', StoreId: 'Z9999', RemAmt: 888, SeqNo: 2 }),
      row({ CustId: ' d0079 ', StoreId: ' D0079 ', RemAmt: 6822770, SeqNo: 3 }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].agent_send_id).toBe('D0079');
    expect(out[0].rem_amt).toBe(6822770);
  });
});

describe('parseAgentLedgerFields (§5-1 원장 입력 검증)', () => {
  it('미지정/빈 값 = postpaid + 단가 전부 null — 기존 등록 동작 보존', () => {
    expect(parseAgentLedgerFields({})).toEqual({
      billingType: 'postpaid', costPerSms: null, costPerLms: null, costPerMms: null, costPerKakao: null, costPerBrand: null,
    });
    expect(parseAgentLedgerFields({ billingType: '', costPerSms: '' })).toEqual({
      billingType: 'postpaid', costPerSms: null, costPerLms: null, costPerMms: null, costPerKakao: null, costPerBrand: null,
    });
  });

  it('prepaid + 소수 단가 허용·문자열 숫자 수용·빈 문자열 = null', () => {
    expect(parseAgentLedgerFields({ billingType: 'prepaid', costPerSms: '8.4', costPerLms: '', costPerKakao: 6.5 })).toEqual({
      billingType: 'prepaid', costPerSms: 8.4, costPerLms: null, costPerMms: null, costPerKakao: 6.5, costPerBrand: null,
    });
    expect(parseAgentLedgerFields({ billingType: 'prepaid', costPerMms: 0 })).toEqual({
      billingType: 'prepaid', costPerSms: null, costPerLms: null, costPerMms: 0, costPerKakao: null, costPerBrand: null,
    });
  });

  it('화이트리스트 밖 billingType·음수·비수치·상한 초과 단가 = error', () => {
    expect('error' in parseAgentLedgerFields({ billingType: 'free' })).toBe(true);
    expect('error' in parseAgentLedgerFields({ costPerSms: -1 })).toBe(true);
    expect('error' in parseAgentLedgerFields({ costPerLms: 'abc' })).toBe(true);
    expect('error' in parseAgentLedgerFields({ costPerMms: 1000001 })).toBe(true);
    expect('error' in parseAgentLedgerFields({ costPerKakao: Infinity })).toBe(true);
  });
});

describe('parseAgentLedgerPatch (§5-1 PATCH 부분 갱신 — Codex 5R-1 회귀 방지)', () => {
  it('빈 body/memo만 = updates 빈 객체 — 선/후불·단가를 건드리지 않는다(전체 덮어쓰기 초기화 사고 차단)', () => {
    expect(parseAgentLedgerPatch({})).toEqual({ updates: {} });
    expect(parseAgentLedgerPatch({ memo: '메모만 수정' })).toEqual({ updates: {} });
  });

  it('온 키만 반영: 빈 문자열 단가 = 명시적 해제(null), 값 = 검증 후 세트, 빈 billingType = 미변경', () => {
    expect(parseAgentLedgerPatch({ costPerSms: '' })).toEqual({ updates: { cost_per_sms: null } });
    expect(parseAgentLedgerPatch({ billingType: 'prepaid', costPerKakao: '6.5' })).toEqual({
      updates: { billing_type: 'prepaid', cost_per_kakao: 6.5 },
    });
    expect(parseAgentLedgerPatch({ billingType: '' , costPerLms: 25 })).toEqual({ updates: { cost_per_lms: 25 } });
  });

  it('위반 값 = error (화이트리스트 밖·음수·비수치·다중 점 문자열)', () => {
    expect('error' in parseAgentLedgerPatch({ billingType: 'free' })).toBe(true);
    expect('error' in parseAgentLedgerPatch({ costPerSms: -0.1 })).toBe(true);
    expect('error' in parseAgentLedgerPatch({ costPerMms: '1.2.3' })).toBe(true);
    expect('error' in parseAgentLedgerPatch({ costPerKakao: 1000001 })).toBe(true);
  });
});

describe('parseAgentCharges (§5-3 충전 등록 입력 검증)', () => {
  it('정상 다건 + 음수 상계 허용(F6 실무 패턴), 발송ID trim', () => {
    expect(parseAgentCharges({ charges: [
      { agentSendId: ' B0023 ', amount: 1000 },
      { agentSendId: 'D0079', amount: -1000 },
    ] })).toEqual({ charges: [
      { agentSendId: 'B0023', amount: 1000 },
      { agentSendId: 'D0079', amount: -1000 },
    ] });
  });

  it('빈 배열·배열 아님·51건 초과 = error', () => {
    expect('error' in parseAgentCharges({})).toBe(true);
    expect('error' in parseAgentCharges({ charges: [] })).toBe(true);
    expect('error' in parseAgentCharges({ charges: 'x' })).toBe(true);
    const many = Array.from({ length: 51 }, () => ({ agentSendId: 'B0023', amount: 1 }));
    expect('error' in parseAgentCharges({ charges: many })).toBe(true);
  });

  it('금액 0·비수치·±1억 초과·발송ID 누락 = error', () => {
    expect('error' in parseAgentCharges({ charges: [{ agentSendId: 'B0023', amount: 0 }] })).toBe(true);
    expect('error' in parseAgentCharges({ charges: [{ agentSendId: 'B0023', amount: 'abc' }] })).toBe(true);
    expect('error' in parseAgentCharges({ charges: [{ agentSendId: 'B0023', amount: 100000001 }] })).toBe(true);
    expect('error' in parseAgentCharges({ charges: [{ agentSendId: 'B0023', amount: -100000001 }] })).toBe(true);
    expect('error' in parseAgentCharges({ charges: [{ agentSendId: '', amount: 1000 }] })).toBe(true);
  });

  it('금액 강제 변환 우회 차단 — boolean/배열/16진 문자열 거부, 십진 문자열만 수용 (Codex 8R)', () => {
    expect('error' in parseAgentCharges({ charges: [{ agentSendId: 'B0023', amount: true }] })).toBe(true);
    expect('error' in parseAgentCharges({ charges: [{ agentSendId: 'B0023', amount: [5] }] })).toBe(true);
    expect('error' in parseAgentCharges({ charges: [{ agentSendId: 'B0023', amount: '0x10' }] })).toBe(true);
    expect('error' in parseAgentCharges({ charges: [{ agentSendId: 'B0023', amount: '1e5' }] })).toBe(true);
    expect(parseAgentCharges({ charges: [{ agentSendId: 'B0023', amount: ' -1000.5 ' }] })).toEqual({
      charges: [{ agentSendId: 'B0023', amount: -1000.5 }],
    });
  });

  it('요청 내 중복 발송ID = 대소문자 무시 거부, 배치 절대합 1억 초과 = error (Codex 7R·8R)', () => {
    expect('error' in parseAgentCharges({ charges: [
      { agentSendId: 'B0023', amount: 1000 },
      { agentSendId: 'b0023', amount: 2000 },
    ] })).toBe(true);
    expect('error' in parseAgentCharges({ charges: [
      { agentSendId: 'B0023', amount: 60_000_000 },
      { agentSendId: 'D0079', amount: -60_000_000 },
    ] })).toBe(true); // 절대합 1.2억 — 부호 상쇄로 우회 불가
  });
});

describe('toChargeRow (§5-3 게이트웨이 행 정규화 — mysql2 Date 파싱 실버그 회귀 방지, Codex 12R)', () => {
  it('FillDtTm이 Date 객체여도 filledAtMs가 정확한 epoch, filledAt은 YYYY-MM-DD HH:mm:ss', () => {
    const d = new Date(2026, 6, 24, 14, 16, 51); // 2026-07-24 14:16:51 로컬
    const row = toChargeRow({ SeqNo: 7044, StoreId: 'B0023', FillAmt: 1000, FillDtTm: d, RsApplyFlag: 'Y', RsApplyDtTm: d });
    expect(row.filledAtMs).toBe(d.getTime());
    expect(row.filledAt).toBe('2026-07-24 14:16:51');
    expect(row.applied).toBe(true);
    expect(row.appliedAt).toBe('2026-07-24 14:16:51');
  });

  it('FillDtTm이 문자열이어도 filledAtMs 산출, 미반영(N)은 applied=false·appliedAt=null', () => {
    const row = toChargeRow({ SeqNo: 7045, StoreId: 'B0023', FillAmt: -1000, FillDtTm: '2026-07-24 14:22:50', RsApplyFlag: 'N', RsApplyDtTm: null });
    expect(row.filledAtMs).toBe(new Date('2026-07-24T14:22:50').getTime());
    expect(row.amount).toBe(-1000);
    expect(row.applied).toBe(false);
    expect(row.appliedAt).toBeNull();
  });
});

describe('matchHealWindow (§5-3 자가복구 수용 판정 — 원장 오염 차단, Codex 10R·11R·12R)', () => {
  const center = new Date(2026, 6, 24, 14, 16, 51).getTime();
  const mk = (seqNo: number, sid: string, amt: number, offsetMin: number) =>
    toChargeRow({ SeqNo: seqNo, StoreId: sid, FillAmt: amt, FillDtTm: new Date(center + offsetMin * 60_000), RsApplyFlag: 'Y', RsApplyDtTm: new Date(center) });

  it('시간창 내 + (발송ID, 금액) 다중집합 정확 일치 = 수용', () => {
    const out = matchHealWindow(
      [{ agentSendId: 'B0023', amount: 1000 }, { agentSendId: 'D0079', amount: -500 }],
      [mk(1, 'B0023', 1000, 1), mk(2, 'D0079', -500, 2)],
      center, 2, 10,
    );
    expect(out).not.toBeNull();
    expect(out!.map((r) => r.seqNo).sort()).toEqual([1, 2]);
  });

  it('시간창 밖 후보(과거 동일 발송ID·금액 SeqNo)는 배제 → 개수 불일치로 거부(null)', () => {
    const out = matchHealWindow(
      [{ agentSendId: 'B0023', amount: 1000 }],
      [mk(9, 'B0023', 1000, -30)], // 30분 전 = 창 밖
      center, 2, 10,
    );
    expect(out).toBeNull();
  });

  it('개수 같아도 금액이 다르면 거부 (A:+40/B:+60 vs 요청 A:+50/B:+50)', () => {
    const out = matchHealWindow(
      [{ agentSendId: 'A', amount: 50 }, { agentSendId: 'B', amount: 50 }],
      [mk(1, 'A', 40, 1), mk(2, 'B', 60, 1)],
      center, 2, 10,
    );
    expect(out).toBeNull();
  });

  it('filledAtMs가 null인 행(파싱 불가)은 창 밖 취급 → 거부', () => {
    const bad = toChargeRow({ SeqNo: 3, StoreId: 'B0023', FillAmt: 1000, FillDtTm: 'not-a-date', RsApplyFlag: 'Y', RsApplyDtTm: null });
    expect(bad.filledAtMs).toBeNull();
    expect(matchHealWindow([{ agentSendId: 'B0023', amount: 1000 }], [bad], center, 2, 10)).toBeNull();
  });
});
