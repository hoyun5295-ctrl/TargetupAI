/**
 * kakao-bulk-migration.test.ts — 카카오 템플릿 일괄 이관 CT 계약 (2026-07-20)
 *
 * 계약 원천 = docs/2026-07-14-template-migration-track-bc-design.md §4-9-H · 0720 운영 DB 실측.
 * 이 테스트가 고정하는 불변 규칙:
 *   1. pull 대상은 B_ 계열만 — bizp_·업체지정·자사코드류 제외
 *   2. 회사 단위 senderKey 합집합 — bill이 2개여도 pull 1회, senderKey가 2개면 둘 다 대상
 *   3. 대조 기준 = distinct 템플릿코드(행수 아님) · 판정 = 포함 관계(등호 아님)
 *   4. 누락은 반드시 사유별 분류 — 0715 아난티 62건(sender_not_connected)이 이 분류의 기원
 *   5. 실행 순서 = 코드수 오름차순(소규모부터, 더화이트 마지막)
 *   6. 이관분 alarm_notified_status = 종결 상태 기록(검수 알림·5분 폴링 루프 진입 차단)
 * DB import 0 — 순수 함수만.
 */
import { describe, it, expect } from 'vitest';
import {
  isBSeriesCode,
  extractImcSenderKey,
  extractImcTemplateCode,
  indexImcTemplates,
  buildCompanyTargets,
  classifyMissingSeedCodes,
  summarizeMissing,
  importedAlarmNotifiedStatus,
  GatewayMappingRow,
} from '../kakao-bulk-migration';

// 0720 실측 값 — 아난티 senderKey 2개(하나만 연결돼 62코드 누락)
const ANANTI_LINKED = '6be1390acc6dceecd2441f93fd14324d6d82ed1d';
const ANANTI_UNLINKED = '7dc0de76dfebb45e58864851efa4bc64d8508c6e';

describe('isBSeriesCode — pull 대상 접두 (규칙 1)', () => {
  it('B_ 계열만 통과', () => {
    expect(isBSeriesCode('B_EJ_006_02_60788')).toBe(true);
    expect(isBSeriesCode('B_KM_2506_01_12345')).toBe(true);
  });

  it('다우(bizp_)·업체지정·자사코드류는 제외 — IMC에 없어 pull 금지', () => {
    expect(isBSeriesCode('bizp_template_01')).toBe(false);
    expect(isBSeriesCode('SJT_0001')).toBe(false);
    expect(isBSeriesCode('ACS_0001')).toBe(false);
    expect(isBSeriesCode('tryon_01')).toBe(false);
    expect(isBSeriesCode('19032201')).toBe(false);
  });

  it('접두만 B이고 언더스코어가 없으면 제외 (B0067 같은 bill 형식 오인 차단)', () => {
    expect(isBSeriesCode('B0067')).toBe(false);
  });

  it('공백·null 안전', () => {
    expect(isBSeriesCode('  B_EJ_006_02_60788  ')).toBe(true);
    expect(isBSeriesCode('')).toBe(false);
    expect(isBSeriesCode(null)).toBe(false);
    expect(isBSeriesCode(undefined)).toBe(false);
  });
});

describe('extractImcSenderKey / extractImcTemplateCode — 응답 구조 실측 규약 (D217+)', () => {
  it('senderKey 최상위 우선', () => {
    expect(extractImcSenderKey({ senderKey: ANANTI_LINKED })).toBe(ANANTI_LINKED);
  });

  it('profile.senderKey fallback (0715 probe 실측 형태)', () => {
    expect(extractImcSenderKey({ profile: { senderKey: ANANTI_UNLINKED } })).toBe(ANANTI_UNLINKED);
  });

  it('키가 없으면 null — 조용히 빈 문자열로 묶이지 않게', () => {
    expect(extractImcSenderKey({})).toBeNull();
    expect(extractImcSenderKey({ senderKey: '   ' })).toBeNull();
  });

  it('templateCode 우선, 없으면 templateKey', () => {
    expect(extractImcTemplateCode({ templateCode: 'B_A_1', templateKey: 'Tmp_1' })).toBe('B_A_1');
    expect(extractImcTemplateCode({ templateKey: 'Tmp_1' })).toBe('Tmp_1');
    expect(extractImcTemplateCode({})).toBeNull();
  });
});

describe('indexImcTemplates — 전량 스캔 1회 → senderKey 그룹', () => {
  const items = [
    { senderKey: ANANTI_LINKED, templateCode: 'B_A_1' },
    { senderKey: ANANTI_LINKED, templateCode: 'B_A_2' },
    { profile: { senderKey: ANANTI_UNLINKED }, templateCode: 'B_EJ_006_02_60788' },
    { templateCode: 'B_ORPHAN_1' }, // senderKey 없음
  ];

  it('senderKey별로 묶고 계정 전체 코드 집합을 함께 만든다', () => {
    const idx = indexImcTemplates(items);
    expect(idx.bySender.get(ANANTI_LINKED)?.length).toBe(2);
    expect(idx.bySender.get(ANANTI_UNLINKED)?.length).toBe(1);
    expect(idx.allCodes.has('B_EJ_006_02_60788')).toBe(true);
    expect(idx.total).toBe(4);
  });

  it('senderKey를 못 읽은 item은 그룹에 넣지 않고 별도 카운트 (응답 구조 변화 조기 발견)', () => {
    const idx = indexImcTemplates(items);
    expect(idx.senderKeyMissing).toBe(1);
    expect(idx.allCodes.has('B_ORPHAN_1')).toBe(true);
  });
});

describe('buildCompanyTargets — 회사 단위 합집합 (규칙 2·3·5)', () => {
  // 마리오아울렛 = bill 2개(P0013·R0041)에 같은 코드가 양쪽 등록 → 행 4 / 코드 2 (0720 실측)
  const marioRows: GatewayMappingRow[] = [
    { company_id: 'c-mario', company_name: '마리오아울렛', bill_id: 'P0013', senderkey: 'k1', tmplcd: 'B_M_1' },
    { company_id: 'c-mario', company_name: '마리오아울렛', bill_id: 'P0013', senderkey: 'k1', tmplcd: 'B_M_2' },
    { company_id: 'c-mario', company_name: '마리오아울렛', bill_id: 'R0041', senderkey: 'k2', tmplcd: 'B_M_1' },
    { company_id: 'c-mario', company_name: '마리오아울렛', bill_id: 'R0041', senderkey: 'k2', tmplcd: 'B_M_2' },
  ];

  it('bill 2개 회사 = 회사 1건으로 합쳐지고 senderKey는 합집합', () => {
    const [t] = buildCompanyTargets(marioRows);
    expect(t.billIds).toEqual(['P0013', 'R0041']);
    expect(t.senderKeys).toEqual(['k1', 'k2']);
  });

  it('대조 기준은 행수(4)가 아니라 distinct 코드(2) — 양쪽 서버 중복 등록분 이중 집계 차단', () => {
    const [t] = buildCompanyTargets(marioRows);
    expect(t.seedBCodes).toEqual(['B_M_1', 'B_M_2']);
  });

  it('B_ 아닌 행은 pull 대상에서 빼고 따로 센다 — pull 0건이 정상인 회사를 설명', () => {
    const rows: GatewayMappingRow[] = [
      { company_id: 'c-ioli', company_name: '아이올리(더에이몰)', bill_id: 'P0019', senderkey: 'k9', tmplcd: 'ACS_0001' },
      { company_id: 'c-ioli', company_name: '아이올리(더에이몰)', bill_id: 'P0019', senderkey: 'k9', tmplcd: 'ANH_0002' },
    ];
    const [t] = buildCompanyTargets(rows);
    expect(t.seedBCodes).toEqual([]);
    expect(t.nonBRows).toBe(2);
  });

  it('실행 순서 = 코드수 오름차순 — 소규모 먼저, 더화이트 마지막', () => {
    const rows: GatewayMappingRow[] = [
      { company_id: 'c-white', company_name: '더화이트(수퍼빈)', bill_id: 'P0032', senderkey: 'w1', tmplcd: 'B_W_1' },
      { company_id: 'c-white', company_name: '더화이트(수퍼빈)', bill_id: 'P0032', senderkey: 'w2', tmplcd: 'B_W_2' },
      { company_id: 'c-white', company_name: '더화이트(수퍼빈)', bill_id: 'P0032', senderkey: 'w3', tmplcd: 'B_W_3' },
      { company_id: 'c-yeomiji', company_name: '여미지', bill_id: 'P0076', senderkey: 'y1', tmplcd: 'B_Y_1' },
      ...marioRows,
    ];
    expect(buildCompanyTargets(rows).map((t) => t.companyName)).toEqual([
      '여미지',
      '마리오아울렛',
      '더화이트(수퍼빈)',
    ]);
  });

  it('company_id 없는 행은 무시 (미연결 bill)', () => {
    expect(buildCompanyTargets([{ company_id: '', bill_id: 'P0001', senderkey: 'k', tmplcd: 'B_X_1' }])).toEqual([]);
  });
});

describe('classifyMissingSeedCodes — 대조·누락 사유 분류 (규칙 4)', () => {
  const idx = indexImcTemplates([
    { senderKey: ANANTI_LINKED, templateCode: 'B_OK_1' },
    { senderKey: ANANTI_LINKED, templateCode: 'B_FAILED_1' },
    { senderKey: 'other-key', templateCode: 'B_MISMATCH_1' },
  ]);

  const base = {
    codeSenderKey: new Map<string, string>([
      ['B_OK_1', ANANTI_LINKED],
      ['B_FAILED_1', ANANTI_LINKED],
      ['B_MISMATCH_1', ANANTI_LINKED],
      ['B_GONE_1', ANANTI_LINKED],
      ['B_EJ_006_02_60788', ANANTI_UNLINKED],
    ]),
    connectedSenderKeys: new Set([ANANTI_LINKED]),
    imc: idx,
  };

  it('보유분은 누락이 아니다 — 포함 관계 판정(IMC가 더 많아도 통과)', () => {
    const missing = classifyMissingSeedCodes({
      ...base,
      seedBCodes: ['B_OK_1'],
      presentCodes: new Set(['B_OK_1', 'B_EXTRA_FROM_IMC']),
    });
    expect(missing).toEqual([]);
  });

  it('senderKey 미연결 = sender_not_connected — 0715 아난티 62건 유형', () => {
    const missing = classifyMissingSeedCodes({
      ...base,
      seedBCodes: ['B_EJ_006_02_60788'],
      presentCodes: new Set(),
    });
    expect(missing).toEqual([
      { tmplcd: 'B_EJ_006_02_60788', senderkey: ANANTI_UNLINKED, reason: 'sender_not_connected' },
    ]);
  });

  it('IMC 해당 그룹에 있는데 행이 없으면 insert_failed', () => {
    const missing = classifyMissingSeedCodes({ ...base, seedBCodes: ['B_FAILED_1'], presentCodes: new Set() });
    expect(missing[0].reason).toBe('insert_failed');
  });

  it('IMC 다른 senderKey 밑에 있으면 imc_sender_mismatch — 귀속 불일치 신호', () => {
    const missing = classifyMissingSeedCodes({ ...base, seedBCodes: ['B_MISMATCH_1'], presentCodes: new Set() });
    expect(missing[0].reason).toBe('imc_sender_mismatch');
  });

  it('IMC 어디에도 없으면 not_in_imc — 게이트웨이 고아(자동 삭제 금지·사람 판단)', () => {
    const missing = classifyMissingSeedCodes({ ...base, seedBCodes: ['B_GONE_1'], presentCodes: new Set() });
    expect(missing[0].reason).toBe('not_in_imc');
  });

  it('사유별 집계', () => {
    const missing = classifyMissingSeedCodes({
      ...base,
      seedBCodes: ['B_OK_1', 'B_FAILED_1', 'B_MISMATCH_1', 'B_GONE_1', 'B_EJ_006_02_60788'],
      presentCodes: new Set(['B_OK_1']),
    });
    expect(summarizeMissing(missing)).toEqual({
      sender_not_connected: 1,
      not_in_imc: 1,
      imc_sender_mismatch: 1,
      insert_failed: 1,
    });
  });
});

describe('importedAlarmNotifiedStatus — 검수 알림·폴링 루프 진입 차단 (규칙 6)', () => {
  it('승인 계열 = APPROVED 기록', () => {
    expect(importedAlarmNotifiedStatus('APPROVED')).toBe('APPROVED');
    expect(importedAlarmNotifiedStatus('APR')).toBe('APPROVED');
  });

  it('반려 계열 = REJECTED 기록 (KREJ 포함 — 아난티 20건 유형)', () => {
    expect(importedAlarmNotifiedStatus('REJECTED')).toBe('REJECTED');
    expect(importedAlarmNotifiedStatus('KREJ')).toBe('REJECTED');
    expect(importedAlarmNotifiedStatus('REJ')).toBe('REJECTED');
  });

  it('비종결은 null 유지 — 정상 폴링·알림 흐름을 그대로 탄다', () => {
    for (const s of ['REG', 'REQ', 'REQUESTED', 'REVIEWING', 'KREQ', 'HREJ', '', null, undefined]) {
      expect(importedAlarmNotifiedStatus(s)).toBeNull();
    }
  });
});
