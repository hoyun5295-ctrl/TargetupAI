/**
 * pay-agent-balance.test.ts — queryPayAgentBalances 순수 선택 로직(pickLatestBalances) 검증
 * (★ 2026-07-24 §5-2 에이전트 선불 잔액 · Codex R1 정정 회귀 방지)
 *
 * 핵심 계약:
 *  - 통계 행 없는 ID = rem_amt null(집계 전) — 0원으로 합성 금지 (Codex R1-2)
 *  - CustId별 선택 = DestDt 최대 → UpdTm 최신 → MsgType·StoreId 사전순 결정적 (Codex R1-1)
 *  - 입력 행 순서와 무관하게 같은 결과 (SQL ORDER BY 의존 제거)
 *  - custIds 순서 보존 + 전 ID 반환 (조용한 누락 방지)
 */
import { describe, it, expect } from 'vitest';
import { pickLatestBalances, PayBalanceSourceRow, parseAgentLedgerFields, parseAgentLedgerPatch, parseAgentCharges, toChargeRow, matchHealWindow } from '../pay-stats';

const row = (o: Partial<PayBalanceSourceRow>): PayBalanceSourceRow => o;

describe('pickLatestBalances', () => {
  it('통계 행이 없는 ID는 rem_amt null(집계 전)로 반환 — 0원 합성 금지', () => {
    const out = pickLatestBalances(['C0119'], []);
    expect(out).toHaveLength(1);
    expect(out[0].agent_send_id).toBe('C0119');
    expect(out[0].rem_amt).toBeNull();
    expect(out[0].as_of_date).toBe('');
  });

  it('CustId별 MAX(DestDt) 행의 RemAmt를 선택하고 as_of_date를 YYYY-MM-DD로 변환', () => {
    const out = pickLatestBalances(['D0079'], [
      row({ CustId: 'D0079', DestDt: '20260722', RemAmt: 10396100, UpdTm: '2026-07-24 05:00:17' }),
      row({ CustId: 'D0079', DestDt: '20260723', RemAmt: 10383500, UpdTm: '2026-07-24 05:00:17' }),
      row({ CustId: 'D0079', DestDt: '20260721', RemAmt: 10511100, UpdTm: '2026-07-24 05:00:17' }),
    ]);
    expect(out[0].rem_amt).toBe(10383500);
    expect(out[0].as_of_date).toBe('2026-07-23');
  });

  it('같은 DestDt·같은 RemAmt면 UpdTm 최신 행을 선택 (Date 객체 UpdTm 포함)', () => {
    const out = pickLatestBalances(['C0130'], [
      row({ CustId: 'C0130', DestDt: '20260703', RemAmt: 200, UpdTm: new Date('2026-07-07T05:00:00') }),
      row({ CustId: 'C0130', DestDt: '20260703', RemAmt: 200, UpdTm: new Date('2026-07-07T07:00:00') }),
    ]);
    expect(out[0].rem_amt).toBe(200);
    expect(out[0].updated_at).toContain('07:00:00');
  });

  it('권위 행 = StoreId 빈 계정 합계 행만 — 상세 행(RemAmt 0)이 잔액을 가리지 않는다 (§8-9 행 단위 실측: D0130)', () => {
    const account = row({ CustId: 'D0130', DestDt: '20260723', StoreId: '', MsgType: 'L', RemAmt: 18445, UpdTm: '2026-07-24 05:00:17' });
    const account2 = row({ CustId: 'D0130', DestDt: '20260723', StoreId: '', MsgType: 'S', RemAmt: 18445, UpdTm: '2026-07-24 05:00:17' });
    const detail = row({ CustId: 'D0130', DestDt: '20260723', StoreId: 'c2dca7c8-50be-44fd-b8e1-0a24cc2f642d', MsgType: 'L', RemAmt: 0, UpdTm: '2026-07-24 05:00:17' });
    const o1 = pickLatestBalances(['D0130'], [detail, account, account2]);
    const o2 = pickLatestBalances(['D0130'], [account2, detail, account]);
    expect(o1[0].rem_amt).toBe(18445);
    expect(o2[0].rem_amt).toBe(18445);
  });

  it('상세 행만 있으면(계정 행 부재) 잔액 미확정 null — 상세 행 0을 잔액으로 오인하지 않는다', () => {
    const out = pickLatestBalances(['B0001'], [
      row({ CustId: 'B0001', DestDt: '20260721', StoreId: 'alarm', MsgType: 'S', RemAmt: 0, UpdTm: '2026-07-24 08:00:07' }),
    ]);
    expect(out[0].rem_amt).toBeNull();
  });

  it('최신 날짜에 계정 행이 없으면 계정 행이 있는 이전 날짜로 — 상세 행 날짜에 끌려가지 않는다', () => {
    const out = pickLatestBalances(['D0130'], [
      row({ CustId: 'D0130', DestDt: '20260723', StoreId: 'ca3fef1f-b614-485e-9cc5-ebd0a27f093f', MsgType: 'L', RemAmt: 0, UpdTm: '2026-07-24 05:00:17' }),
      row({ CustId: 'D0130', DestDt: '20260722', StoreId: '', MsgType: 'L', RemAmt: 18445, UpdTm: '2026-07-24 05:00:17' }),
    ]);
    expect(out[0].rem_amt).toBe(18445);
    expect(out[0].as_of_date).toBe('2026-07-22');
  });

  it('같은 UpdTm에 값이 어긋나면 MsgType 사전순 — 큰 값 우선 아님(과대 표시 편향 차단, Codex R3), 입력 순서 무관', () => {
    const a = row({ CustId: 'B0225', DestDt: '20260723', UpdTm: '2026-07-24 05:00:17', MsgType: 'L', StoreId: '', RemAmt: 111 });
    const b = row({ CustId: 'B0225', DestDt: '20260723', UpdTm: '2026-07-24 05:00:17', MsgType: 'S', StoreId: '', RemAmt: 222 });
    const o1 = pickLatestBalances(['B0225'], [a, b]);
    const o2 = pickLatestBalances(['B0225'], [b, a]);
    expect(o1[0].rem_amt).toBe(111); // MsgType 'L' < 'S' — 222(큰 값)가 아니라 사전순 승자
    expect(o2[0].rem_amt).toBe(111);
  });

  it('RemAmt null·빈 문자열은 0으로 강제 변환하지 않고 null(미확정) (Codex R2 실버그)', () => {
    const onlyNull = pickLatestBalances(['A0'], [
      row({ CustId: 'A0', DestDt: '20260701', RemAmt: null, UpdTm: '2026-07-02 05:00:00' }),
      row({ CustId: 'A0', DestDt: '20260701', RemAmt: '', UpdTm: '2026-07-02 06:00:00' }),
    ]);
    expect(onlyNull[0].rem_amt).toBeNull();

    // 같은 UpdTm이면 값 보유 행 우선
    const sameTime = pickLatestBalances(['A1'], [
      row({ CustId: 'A1', DestDt: '20260701', RemAmt: null, UpdTm: '2026-07-02 05:00:00' }),
      row({ CustId: 'A1', DestDt: '20260701', RemAmt: 7390.1, UpdTm: '2026-07-02 05:00:00' }),
    ]);
    expect(sameTime[0].rem_amt).toBe(7390.1);

    // 최신 스냅샷(UpdTm)이 값 없음이면 fail-closed로 null — 옛 값으로 과대/과소 표시하지 않는다 (Codex R3 방향)
    const newerNull = pickLatestBalances(['A2'], [
      row({ CustId: 'A2', DestDt: '20260701', RemAmt: null, UpdTm: '2026-07-02 07:00:00' }),
      row({ CustId: 'A2', DestDt: '20260701', RemAmt: 7390.1, UpdTm: '2026-07-02 05:00:00' }),
    ]);
    expect(newerNull[0].rem_amt).toBeNull();
  });

  it('custIds 순서를 보존하고 전 ID를 반환한다 (일부만 통계 보유)', () => {
    const out = pickLatestBalances(['B0225', 'C0119', 'D0079'], [
      row({ CustId: 'D0079', DestDt: '20260723', RemAmt: 10383500, UpdTm: '2026-07-24 05:00:17' }),
      row({ CustId: 'B0225', DestDt: '20260601', RemAmt: 91277, UpdTm: '2026-06-02 05:00:01' }),
    ]);
    expect(out.map((o) => o.agent_send_id)).toEqual(['B0225', 'C0119', 'D0079']);
    expect(out[0].rem_amt).toBe(91277);
    expect(out[1].rem_amt).toBeNull();
    expect(out[2].rem_amt).toBe(10383500);
  });

  it('RemAmt가 수치가 아니면 null(미확정) — NaN 노출 금지 / 음수·0은 실값 그대로', () => {
    const out = pickLatestBalances(['A1', 'A2', 'A3'], [
      row({ CustId: 'A1', DestDt: '20260701', RemAmt: 'abc', UpdTm: '2026-07-02 05:00:00' }),
      row({ CustId: 'A2', DestDt: '20260701', RemAmt: -645884, UpdTm: '2026-07-02 05:00:00' }),
      row({ CustId: 'A3', DestDt: '20260701', RemAmt: 0, UpdTm: '2026-07-02 05:00:00' }),
    ]);
    expect(out[0].rem_amt).toBeNull();
    expect(out[1].rem_amt).toBe(-645884);
    expect(out[2].rem_amt).toBe(0);
  });

  it('CustId 빈 행은 무시하고, 대상 외 CustId 행은 결과에 섞이지 않는다', () => {
    const out = pickLatestBalances(['D0079'], [
      row({ CustId: '', DestDt: '20260723', RemAmt: 999, UpdTm: '2026-07-24 05:00:17' }),
      row({ CustId: 'Z9999', DestDt: '20260723', RemAmt: 888, UpdTm: '2026-07-24 05:00:17' }),
      row({ CustId: 'D0079', DestDt: '20260716', RemAmt: 6822770, UpdTm: '2026-07-19 05:00:40' }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].rem_amt).toBe(6822770);
  });
});

describe('parseAgentLedgerFields (§5-1 원장 입력 검증)', () => {
  it('미지정/빈 값 = postpaid + 단가 전부 null — 기존 등록 동작 보존', () => {
    expect(parseAgentLedgerFields({})).toEqual({
      billingType: 'postpaid', costPerSms: null, costPerLms: null, costPerMms: null, costPerKakao: null,
    });
    expect(parseAgentLedgerFields({ billingType: '', costPerSms: '' })).toEqual({
      billingType: 'postpaid', costPerSms: null, costPerLms: null, costPerMms: null, costPerKakao: null,
    });
  });

  it('prepaid + 소수 단가 허용·문자열 숫자 수용·빈 문자열 = null', () => {
    expect(parseAgentLedgerFields({ billingType: 'prepaid', costPerSms: '8.4', costPerLms: '', costPerKakao: 6.5 })).toEqual({
      billingType: 'prepaid', costPerSms: 8.4, costPerLms: null, costPerMms: null, costPerKakao: 6.5,
    });
    expect(parseAgentLedgerFields({ billingType: 'prepaid', costPerMms: 0 })).toEqual({
      billingType: 'prepaid', costPerSms: null, costPerLms: null, costPerMms: 0, costPerKakao: null,
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
