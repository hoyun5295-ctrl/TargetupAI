/**
 * gateway-template-mapping.test.ts — Track C 게이트웨이 매핑 CT 계약 (2026-07-20)
 *
 * 계약 원천 = docs/2026-07-14-template-migration-track-bc-design.md §4-0(API 계약)·§4-0-1(결함 회피)·§4-9-C(불변 규칙 8).
 * 이 테스트가 고정하는 불변 규칙:
 *   1. tran_tmplcd 빈 값 전송 절대 금지 — 빌더가 빈 값이면 tmplcd 복사 (0720 서버 결함 회피 유지·회귀 방어)
 *   2. billid 리터럴 보존 — 병기('P0042;R0003') 분해·재조합·대문자화 금지
 *   3. server 분기 — P=54 / R=58, 병기·B잔재는 접두 추론 불가(저장된 등록서버 값 사용)
 *   4. 응답코드 매핑 — 00/01/02=성공, 21/24/27=영구 오류(재시도 무의미), 22/23=재시도 가능
 *   5. 백오프 스케줄 — 1m→5m→30m→2h→6h, 8회 초과=failed(null)
 *   6. 대조 diff — tmplcd·tran_tmplcd·usemod·billnm 4필드만(GET 응답에 senderkey 없음 §4-9-E)
 *   7. 레이트리밋 — 호출 간 최소 200ms(5/s ≪ 500/s)
 * DB import 0 — 순수 함수만.
 */
import { describe, it, expect } from 'vitest';
import {
  buildMappingPayload,
  inferServerFromBillId,
  resolveGatewayEndpoint,
  classifyGatewayResponse,
  computeBackoffMs,
  computeRateDelayMs,
  diffMappingFields,
  prepareSeedImport,
  deriveCompanyCodeFromBillId,
  defaultUsemodForServer,
  MIN_CALL_INTERVAL_MS,
  MAX_PUSH_ATTEMPTS,
} from '../gateway-template-mapping';

describe('buildMappingPayload — payload 6필드 빌더 (트림·필수·tran 복사)', () => {
  const base = {
    billid: 'R0001',
    senderkey: '6be1390acc6dceecd2441f93fd14324d6d82ed1d',
    usemod: 'DPK_HM1;DPK_HM2;DPK_HM3;DPK_HM4;DPK_HM5;DPK_HM6',
    tmplcd: 'B_KM_2506_01_12345',
  };

  it('정상 입력 — 6필드 전부 채워 반환', () => {
    const r = buildMappingPayload({ ...base, billnm: '한줄로연동테스트', tran_tmplcd: 'B_KM_2506_01_12345' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.payload).toEqual({
      billid: 'R0001',
      billnm: '한줄로연동테스트',
      senderkey: base.senderkey,
      usemod: base.usemod,
      tmplcd: 'B_KM_2506_01_12345',
      tran_tmplcd: 'B_KM_2506_01_12345',
    });
  });

  it('★불변 1: tran_tmplcd 빈 값/미지정/공백 → tmplcd 복사 (빈 값 전송 절대 금지)', () => {
    for (const tran of [undefined, null, '', '   ']) {
      const r = buildMappingPayload({ ...base, tran_tmplcd: tran as any });
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.payload.tran_tmplcd).toBe(base.tmplcd);
      expect(r.payload.tran_tmplcd.length).toBeGreaterThan(0);
    }
  });

  it('전 필드 트림', () => {
    const r = buildMappingPayload({
      billid: '  R0001 ',
      senderkey: ` ${base.senderkey} `,
      usemod: ' DPK_HM1 ',
      tmplcd: ' T01 ',
      tran_tmplcd: ' T01 ',
      billnm: ' 아난티 ',
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.payload.billid).toBe('R0001');
    expect(r.payload.usemod).toBe('DPK_HM1');
    expect(r.payload.tmplcd).toBe('T01');
    expect(r.payload.billnm).toBe('아난티');
  });

  it('필수 4필드(billid·senderkey·usemod·tmplcd) 빈 값 → 실패(필드명 적시)', () => {
    for (const field of ['billid', 'senderkey', 'usemod', 'tmplcd'] as const) {
      const r = buildMappingPayload({ ...base, [field]: '  ' });
      expect(r.ok).toBe(false);
      if (r.ok) return;
      expect(r.error).toContain(field);
    }
  });

  it('billnm 미지정 → 빈 문자열(선택 필드)', () => {
    const r = buildMappingPayload(base);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.payload.billnm).toBe('');
  });

  it('★불변 2: 병기 billid(P0042;R0003) 리터럴 보존 — 분해·대문자화 금지', () => {
    const r = buildMappingPayload({ ...base, billid: 'P0042;R0003' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.payload.billid).toBe('P0042;R0003');
  });

  it('소문자 billid도 리터럴 보존(대문자화 금지 — 시드 그대로)', () => {
    const r = buildMappingPayload({ ...base, billid: 'b0067' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.payload.billid).toBe('b0067');
  });
});

describe('inferServerFromBillId — 접두 P/R 분기 (신규 등록용 추론)', () => {
  it('P 접두 → 54', () => {
    expect(inferServerFromBillId('P0001')).toBe('54');
    expect(inferServerFromBillId('P0074')).toBe('54');
  });

  it('R 접두 → 58', () => {
    expect(inferServerFromBillId('R0001')).toBe('58');
    expect(inferServerFromBillId('R0007')).toBe('58');
  });

  it('★불변 3: 병기(세미콜론 포함)는 접두 추론 불가 → null (저장된 등록서버 값을 쓴다)', () => {
    expect(inferServerFromBillId('P0042;R0003')).toBeNull();
  });

  it('B 잔재(유성소프트 옛 형식)·빈 값·기타 → null', () => {
    expect(inferServerFromBillId('B0067')).toBeNull();
    expect(inferServerFromBillId('')).toBeNull();
    expect(inferServerFromBillId('X9999')).toBeNull();
  });
});

describe('resolveGatewayEndpoint — server → 엔드포인트', () => {
  it('54/58 기본 엔드포인트 (58.227.193.54/.58:25230/tmpl-mgr)', () => {
    expect(resolveGatewayEndpoint('54')).toBe('http://58.227.193.54:25230/tmpl-mgr');
    expect(resolveGatewayEndpoint('58')).toBe('http://58.227.193.58:25230/tmpl-mgr');
  });

  it('env 오버라이드 (GATEWAY_TMPL_54_URL/58_URL)', () => {
    process.env.GATEWAY_TMPL_54_URL = 'http://127.0.0.1:9954/tmpl-mgr';
    try {
      expect(resolveGatewayEndpoint('54')).toBe('http://127.0.0.1:9954/tmpl-mgr');
    } finally {
      delete process.env.GATEWAY_TMPL_54_URL;
    }
  });
});

describe('classifyGatewayResponse — req_result 코드 매핑 (§4-0)', () => {
  it('00=조회 성공 / 01=update / 02=insert → 성공', () => {
    expect(classifyGatewayResponse({ req_result: '00' })).toMatchObject({ ok: true, kind: 'query_ok' });
    expect(classifyGatewayResponse({ req_result: '01' })).toMatchObject({ ok: true, kind: 'updated' });
    expect(classifyGatewayResponse({ req_result: '02' })).toMatchObject({ ok: true, kind: 'inserted' });
  });

  it('★불변 4: 21(인증)·24(body 없음)·27(필수 공백) = 영구 오류 — 재시도 무의미(retryable=false)', () => {
    for (const code of ['21', '24', '27']) {
      const r = classifyGatewayResponse({ req_result: code });
      expect(r.ok).toBe(false);
      expect(r.retryable).toBe(false);
    }
  });

  it('22(DB)·23(시스템) = 재시도 가능', () => {
    for (const code of ['22', '23']) {
      const r = classifyGatewayResponse({ req_result: code });
      expect(r.ok).toBe(false);
      expect(r.retryable).toBe(true);
    }
  });

  it('미지·빈 응답 = 실패·재시도 가능 (레이트리밋 무응답 reject 포함 — §4-9-C 8)', () => {
    expect(classifyGatewayResponse({})).toMatchObject({ ok: false, retryable: true });
    expect(classifyGatewayResponse(null)).toMatchObject({ ok: false, retryable: true });
    expect(classifyGatewayResponse({ req_result: '99' })).toMatchObject({ ok: false, retryable: true });
  });
});

describe('computeBackoffMs — 백오프 스케줄 (1m→5m→30m→2h→6h, 8회 초과=failed)', () => {
  it('★불변 5: 스케줄 고정', () => {
    expect(computeBackoffMs(1)).toBe(60 * 1000);
    expect(computeBackoffMs(2)).toBe(5 * 60 * 1000);
    expect(computeBackoffMs(3)).toBe(30 * 60 * 1000);
    expect(computeBackoffMs(4)).toBe(2 * 60 * 60 * 1000);
    expect(computeBackoffMs(5)).toBe(6 * 60 * 60 * 1000);
    expect(computeBackoffMs(8)).toBe(6 * 60 * 60 * 1000);
  });

  it('8회 초과 = null (failed 확정 + 알림)', () => {
    expect(MAX_PUSH_ATTEMPTS).toBe(8);
    expect(computeBackoffMs(9)).toBeNull();
    expect(computeBackoffMs(100)).toBeNull();
  });

  it('0 이하 방어 — 첫 스케줄로', () => {
    expect(computeBackoffMs(0)).toBe(60 * 1000);
    expect(computeBackoffMs(-1)).toBe(60 * 1000);
  });
});

describe('computeRateDelayMs — 직렬 레이트리밋 (호출 간 최소 200ms)', () => {
  it('★불변 7: 최소 간격 200ms (5/s ≪ 500/s)', () => {
    expect(MIN_CALL_INTERVAL_MS).toBe(200);
  });

  it('직전 호출 직후 → 잔여 대기 반환', () => {
    expect(computeRateDelayMs(1000, 1000)).toBe(200);
    expect(computeRateDelayMs(1100, 1000)).toBe(100);
  });

  it('간격 경과 → 0 (음수 금지)', () => {
    expect(computeRateDelayMs(1200, 1000)).toBe(0);
    expect(computeRateDelayMs(9999, 1000)).toBe(0);
  });

  it('첫 호출(직전 없음) → 0', () => {
    expect(computeRateDelayMs(1000, null)).toBe(0);
  });
});

describe('diffMappingFields — 대조 4필드 (usemod 포함, senderkey 제외 §4-9-E)', () => {
  const desired = {
    tmplcd: 'B_KM_01',
    tran_tmplcd: 'B_KM_01',
    usemod: 'DPK_HM1;DPK_HM2;DPK_HM3',
    billnm: '아난티',
  };

  it('완전 일치 → []', () => {
    expect(diffMappingFields(desired, { ...desired })).toEqual([]);
  });

  it('★불변 6: usemod 불일치 검출 (서버 실값 상시 대조 — §4-0-2)', () => {
    const d = diffMappingFields(desired, { ...desired, usemod: 'DPK_HM1;DPK_HM2;DPK_HM3;DPK_HM4' });
    expect(d).toEqual(['usemod']);
  });

  it('복수 필드 불일치 전부 나열', () => {
    const d = diffMappingFields(desired, {
      tmplcd: 'B_KM_01',
      tran_tmplcd: 'OTHER',
      usemod: 'DPK_DW1',
      billnm: '',
    });
    expect(d).toContain('tran_tmplcd');
    expect(d).toContain('usemod');
    expect(d).toContain('billnm');
    expect(d).not.toContain('tmplcd');
  });

  it('원격 값 트림·null 허용 비교 (공백 차이는 불일치 아님)', () => {
    const d = diffMappingFields(desired, {
      tmplcd: ' B_KM_01 ',
      tran_tmplcd: 'B_KM_01',
      usemod: ' DPK_HM1;DPK_HM2;DPK_HM3',
      billnm: '아난티 ',
    });
    expect(d).toEqual([]);
  });

  it('원격에 senderkey가 있어도 비교 대상 아님 (GET 응답 senderkey 부재가 전제)', () => {
    const d = diffMappingFields(desired, { ...desired, senderkey: 'ANY' } as any);
    expect(d).toEqual([]);
  });
});

describe('prepareSeedImport — 시드 검증·중복 정리·bill 집계 (§4-9-D-2)', () => {
  const mk = (over: Record<string, any> = {}) => ({
    server: '58',
    bill_id: 'R0007',
    billnm: '아난티',
    senderkey: 'KEY_R0007',
    usemod: 'DPK_HM1;DPK_HM2;DPK_HM3;DPK_HM4;DPK_HM5;DPK_HM6',
    tran_tmplcd: 'T01',
    tmplcd: 'T01',
    ...over,
  });

  it('정상 행 — deduped·bills 집계', () => {
    const r = prepareSeedImport([mk(), mk({ tmplcd: 'T02', tran_tmplcd: 'T02' })]);
    expect(r.invalid).toEqual([]);
    expect(r.deduped).toHaveLength(2);
    expect(r.bills).toHaveLength(1);
    expect(r.bills[0]).toMatchObject({ billId: 'R0007', server: '58', billName: '아난티' });
  });

  it('(bill_id, tmplcd) 중복 = 최신행(뒤 행) 우선', () => {
    const r = prepareSeedImport([
      mk({ billnm: '옛계정명' }),
      mk({ billnm: '새계정명' }),
    ]);
    expect(r.dupWithinPayload).toBe(1);
    expect(r.deduped).toHaveLength(1);
    expect(r.deduped[0].payload.billnm).toBe('새계정명');
  });

  it('default_usemod = 최빈 usemod', () => {
    const r = prepareSeedImport([
      mk({ tmplcd: 'A', tran_tmplcd: 'A', usemod: 'DPK_HM1' }),
      mk({ tmplcd: 'B', tran_tmplcd: 'B', usemod: 'DPK_HM1' }),
      mk({ tmplcd: 'C', tran_tmplcd: 'C', usemod: 'DPK_HM1;DPK_HM4' }),
    ]);
    expect(r.bills[0].defaultUsemod).toBe('DPK_HM1');
  });

  it('같은 bill_id 두 서버 걸침 = serverConflicts (실등록 데이터엔 0건이 정상)', () => {
    const r = prepareSeedImport([
      mk({ server: '58' }),
      mk({ server: '54', tmplcd: 'T99', tran_tmplcd: 'T99' }),
    ]);
    expect(r.serverConflicts).toHaveLength(1);
    expect(r.serverConflicts[0]).toContain('R0007');
  });

  it('잘못된 server·필수 누락 = invalid(index·사유)', () => {
    const r = prepareSeedImport([
      mk({ server: '57' }),
      mk({ senderkey: '' }),
      mk(),
    ]);
    expect(r.invalid).toHaveLength(2);
    expect(r.invalid[0].index).toBe(0);
    expect(r.invalid[1].index).toBe(1);
    expect(r.deduped).toHaveLength(1);
  });

  it('★병기 bill_id(P0042;R0003) 리터럴 보존 — 분해 없이 bill 1건', () => {
    const r = prepareSeedImport([
      mk({ bill_id: 'P0042;R0003', server: '58', billnm: '아이비케이저축' }),
    ]);
    expect(r.invalid).toEqual([]);
    expect(r.bills).toHaveLength(1);
    expect(r.bills[0].billId).toBe('P0042;R0003');
    expect(r.bills[0].server).toBe('58');
  });

  it('tran_tmplcd 공백 행도 tmplcd 복사로 시드 (빈 값 저장 금지)', () => {
    const r = prepareSeedImport([mk({ tran_tmplcd: '' })]);
    expect(r.deduped[0].payload.tran_tmplcd).toBe('T01');
  });
});

describe('defaultUsemodForServer — 신규 bill 기본값 (시드 최빈값·서팀장 구두 일치 실측)', () => {
  it('54 = HM 3개 / 58 = HM 6개 (세미콜론 풀네임 표기)', () => {
    expect(defaultUsemodForServer('54')).toBe('DPK_HM1;DPK_HM2;DPK_HM3');
    expect(defaultUsemodForServer('58')).toBe('DPK_HM1;DPK_HM2;DPK_HM3;DPK_HM4;DPK_HM5;DPK_HM6');
  });
});

describe('deriveCompanyCodeFromBillId — 일괄 회사 생성 코드 규칙 (0720 실측 R0023 관례 정합)', () => {
  it('원형 유지 — 대문자 보존', () => {
    expect(deriveCompanyCodeFromBillId('P0032')).toBe('P0032');
    expect(deriveCompanyCodeFromBillId('R0023')).toBe('R0023');
    expect(deriveCompanyCodeFromBillId('b0067')).toBe('b0067');
  });

  it('병기 세미콜론 → 하이픈', () => {
    expect(deriveCompanyCodeFromBillId('P0042;R0003')).toBe('P0042-R0003');
  });

  it('트림 + 연속 비영숫자 1개 하이픈', () => {
    expect(deriveCompanyCodeFromBillId(' R0001 ')).toBe('R0001');
    expect(deriveCompanyCodeFromBillId('P0001; ;R0002')).toBe('P0001-R0002');
  });
});
