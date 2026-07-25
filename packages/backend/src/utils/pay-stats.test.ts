import { describe, it, expect, vi } from 'vitest';
import { fetchCustNames, groupStoreRows, validateStatsDateRange, resolveRelayOwnerCustId, isRelayCustId } from './pay-stats';

// RSRM_SalesStts 집계 결과 원본 행 형태(SUM alias tot/ok/fl/rd)
const raw = (o: Partial<{ DestDt: string; CustId: string; StoreId: string; MsgType: string; tot: number; ok: number; fl: number; rd: number }>) =>
  ({ DestDt: '20260723', CustId: 'B0039', StoreId: '', MsgType: 'S', tot: 0, ok: 0, fl: 0, rd: 0, ...o });

// mysql2 pool.query는 [rows, fields]를 반환한다. fetchCustNames는 `const [rows] = await pool.query(...)`로 첫 요소만 쓴다.
function fakePool(rows: any[], capture?: { sql?: string; params?: any[] }) {
  return {
    query: async (sql: string, params: any[]) => {
      if (capture) { capture.sql = sql; capture.params = params; }
      return [rows, []];
    },
  } as any;
}

describe('fetchCustNames — 발송ID(CustId) → 발급명(CustNm) 맵 (서수란 2026-07-25)', () => {
  it('빈 입력 — 빈 맵, 쿼리 미실행', async () => {
    const q = vi.fn();
    const map = await fetchCustNames({ query: q } as any, []);
    expect(map.size).toBe(0);
    expect(q).not.toHaveBeenCalled();
  });

  it('기본 매핑 — CustId → CustNm', async () => {
    const map = await fetchCustNames(fakePool([{ CustId: 'B0039', CustNm: '마리오아울렛_EBIZ' }]), ['B0039']);
    expect(map.get('B0039')).toBe('마리오아울렛_EBIZ');
  });

  it('중복행 — ORDER BY로 먼저 온 최신행 채택(first-wins)', async () => {
    const map = await fetchCustNames(
      fakePool([
        { CustId: 'B0039', CustNm: '새이름' }, // ORDER BY UpdTm DESC 로 최신행이 앞에 옴
        { CustId: 'B0039', CustNm: '옛이름' },
      ]),
      ['B0039'],
    );
    expect(map.get('B0039')).toBe('새이름');
  });

  it('공란 이름은 건너뛰고 유효 이름 채택', async () => {
    const map = await fetchCustNames(
      fakePool([
        { CustId: 'B0040', CustNm: '' },
        { CustId: 'B0040', CustNm: '유효이름' },
      ]),
      ['B0040'],
    );
    expect(map.get('B0040')).toBe('유효이름');
  });

  it('CustId·CustNm 공백 트림', async () => {
    const map = await fetchCustNames(fakePool([{ CustId: ' B0041 ', CustNm: ' 이름 ' }]), ['B0041']);
    expect(map.get('B0041')).toBe('이름');
  });

  it('입력 CustId 중복·공란 제거 후 placeholder 생성', async () => {
    const cap: { sql?: string; params?: any[] } = {};
    await fetchCustNames(fakePool([], cap), ['B0039', 'B0039', ' ', '', 'C0001']);
    expect(cap.params).toEqual(['B0039', 'C0001']);
    expect(cap.sql).toContain('IN (?,?)');
  });

  it('조회 실패 — 빈 맵 폴백(throw 안 함)', async () => {
    const errPool = { query: async () => { throw new Error('boom'); } } as any;
    const map = await fetchCustNames(errPool, ['B0039']);
    expect(map.size).toBe(0);
  });
});

describe('groupStoreRows — 대상ID(StoreId)별 그룹핑·정렬 (서수란 2026-07-25 #2)', () => {
  it('빈 입력 — 빈 배열', () => {
    expect(groupStoreRows([], { scope: 'company', view: 'daily' })).toEqual([]);
  });

  it('대상ID별 분해 — 같은 발송ID·유형이라도 대상ID가 다르면 별 행(마리오 200/400)', () => {
    const rows = groupStoreRows(
      [
        raw({ StoreId: '400', tot: 100, ok: 98, fl: 2 }),
        raw({ StoreId: '200', tot: 50, ok: 50 }),
      ],
      { scope: 'company', view: 'daily' },
    );
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.store_id)).toEqual(['200', '400']); // 대상ID 사전순
    expect(rows.find((r) => r.store_id === '400')).toMatchObject({ sent: 100, success: 98, fail: 2 });
  });

  it('같은 (기간·발송ID·대상ID·유형)은 합산', () => {
    const rows = groupStoreRows(
      [
        raw({ StoreId: '400', tot: 10, ok: 9, fl: 1, rd: 2 }),
        raw({ StoreId: '400', tot: 5, ok: 5, rd: 3 }),
      ],
      { scope: 'company', view: 'daily' },
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ sent: 15, success: 14, fail: 1, pending: 5 });
  });

  it('공백만 있는 대상ID는 ""로 정규화 — 빈 값과 한 버킷(유령 중복 방지)', () => {
    const rows = groupStoreRows(
      [
        raw({ StoreId: '', tot: 10, ok: 10 }),
        raw({ StoreId: '   ', tot: 5, ok: 5 }),
        raw({ StoreId: '\t', tot: 1, ok: 1 }),
      ],
      { scope: 'company', view: 'daily' },
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].store_id).toBe('');
    expect(rows[0].sent).toBe(16);
  });

  it('대상ID 원본 보존 — 인코딩 손상값도 그대로(정산 키)', () => {
    const corrupted = 'ÇÑ¼ÖÃà»êµÐ»êÁ¡';
    const rows = groupStoreRows(
      [
        raw({ CustId: 'B0081', StoreId: '한솔축산둔산점', tot: 10 }),
        raw({ CustId: 'B0081', StoreId: corrupted, tot: 7 }),
      ],
      { scope: 'company', view: 'daily' },
    );
    expect(rows).toHaveLength(2); // 인코딩 손상분은 별 대상ID로 남는다(복원은 별도 과제)
    expect(rows.map((r) => r.store_id)).toContain(corrupted);
  });

  it('대상ID 합 = 발송ID 집계(화면 축)와 일치 — 정산 대조 불변식', () => {
    const rows = groupStoreRows(
      [
        raw({ StoreId: 'A', tot: 100, ok: 90, fl: 10, rd: 1 }),
        raw({ StoreId: 'B', tot: 50, ok: 45, fl: 5, rd: 2 }),
        raw({ StoreId: '', tot: 7, ok: 7, rd: 3 }),
      ],
      { scope: 'company', view: 'daily' },
    );
    const sum = (k: 'sent' | 'success' | 'fail' | 'pending') => rows.reduce((a, r) => a + r[k], 0);
    expect(sum('sent')).toBe(157);
    expect(sum('success')).toBe(142);
    expect(sum('fail')).toBe(15);
    expect(sum('pending')).toBe(6);
  });

  it('company scope — company_name 미부여', () => {
    const rows = groupStoreRows([raw({ StoreId: '400', tot: 1 })], { scope: 'company', view: 'daily' });
    expect(rows[0].company_name).toBeUndefined();
  });

  it('admin scope — 매핑된 CustId만 남기고 회사명 부여(집계 총량 보존)', () => {
    const custToCompany = new Map([['B0039', '마리오아울렛']]);
    const rows = groupStoreRows(
      [
        raw({ CustId: 'B0039', StoreId: '400', tot: 10 }),
        raw({ CustId: 'Z9999', StoreId: 'x', tot: 999 }), // 매핑 없는 발송ID = 제외
      ],
      { scope: 'admin', view: 'daily', custToCompany },
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ agent_send_id: 'B0039', company_name: '마리오아울렛' });
  });

  it('발급명(nameMap) 부착 — 없으면 미부여', () => {
    const rows = groupStoreRows(
      [
        raw({ CustId: 'B0039', StoreId: '400', tot: 1 }),
        raw({ CustId: 'D0002', StoreId: '', tot: 1 }),
      ],
      { scope: 'company', view: 'daily', nameMap: new Map([['B0039', '마리오아울렛_EBIZ']]) },
    );
    expect(rows.find((r) => r.agent_send_id === 'B0039')!.cust_name).toBe('마리오아울렛_EBIZ');
    expect(rows.find((r) => r.agent_send_id === 'D0002')!.cust_name).toBeUndefined();
  });

  it('유형 라벨 — S/L/M/K 매핑', () => {
    const rows = groupStoreRows(
      [
        raw({ MsgType: 'S', StoreId: 'a', tot: 1 }),
        raw({ MsgType: 'L', StoreId: 'a', tot: 1 }),
        raw({ MsgType: 'M', StoreId: 'a', tot: 1 }),
        raw({ MsgType: 'K', StoreId: 'a', tot: 1 }),
      ],
      { scope: 'company', view: 'daily' },
    );
    expect(rows.map((r) => r.type_label)).toEqual(['SMS', 'LMS', 'MMS', '카카오알림톡']); // typeOrder 순
  });

  it('미지 유형 다수 — 동일 typeOrder라 msg_type 사전순 tiebreak로 결정적 정렬', () => {
    // X=팩스로 등록된 유형이라 tiebreak 검증에 부적합 → 미등록 Y/Z로 실제 localeCompare 분기를 태운다
    const rows = groupStoreRows(
      [
        raw({ MsgType: 'Z', StoreId: 'a', tot: 1 }),
        raw({ MsgType: 'Y', StoreId: 'a', tot: 1 }),
      ],
      { scope: 'company', view: 'daily' },
    );
    expect(rows.map((r) => r.msg_type)).toEqual(['Y', 'Z']);
  });

  it('정렬 — 기간 desc → 회사명 → 발송ID → 대상ID', () => {
    const custToCompany = new Map([['B0039', '나회사'], ['B0040', '나회사'], ['B0041', '가회사']]);
    const rows = groupStoreRows(
      [
        raw({ DestDt: '20260722', CustId: 'B0039', StoreId: '400', tot: 1 }),
        raw({ DestDt: '20260723', CustId: 'B0040', StoreId: '200', tot: 1 }),
        raw({ DestDt: '20260723', CustId: 'B0039', StoreId: '900', tot: 1 }),
        raw({ DestDt: '20260723', CustId: 'B0039', StoreId: '100', tot: 1 }),
        raw({ DestDt: '20260723', CustId: 'B0041', StoreId: 'z', tot: 1 }),
      ],
      { scope: 'admin', view: 'daily', custToCompany },
    );
    expect(rows.map((r) => `${r.period}|${r.company_name}|${r.agent_send_id}|${r.store_id}`)).toEqual([
      '2026-07-23|가회사|B0041|z',
      '2026-07-23|나회사|B0039|100',
      '2026-07-23|나회사|B0039|900',
      '2026-07-23|나회사|B0040|200',
      '2026-07-22|나회사|B0039|400',
    ]);
  });

  it('monthly view — 기간이 YYYY-MM으로 묶임', () => {
    const rows = groupStoreRows(
      [
        raw({ DestDt: '20260703', StoreId: '400', tot: 10 }),
        raw({ DestDt: '20260728', StoreId: '400', tot: 5 }),
      ],
      { scope: 'company', view: 'monthly' },
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ period: '2026-07', sent: 15 });
  });

  it('DestDt 형식 밖 행은 무시(엑셀 경로)', () => {
    const rows = groupStoreRows(
      [raw({ DestDt: '2026-07-23', StoreId: '400', tot: 999 }), raw({ DestDt: '', StoreId: '400', tot: 5 })],
      { scope: 'company', view: 'daily' },
    );
    expect(rows).toEqual([]);
  });
});

describe('validateStatsDateRange — 엑셀 조회 기간 검증 (2026-07-25)', () => {
  it('정상 기간 통과 — 정규화된 날짜 동반 반환', () => {
    expect(validateStatsDateRange('2026-07-01', '2026-07-25')).toEqual({ ok: true, startDate: '2026-07-01', endDate: '2026-07-25' });
  });

  it('같은 날짜(하루) 통과', () => {
    expect(validateStatsDateRange('2026-07-25', '2026-07-25')).toEqual({ ok: true, startDate: '2026-07-25', endDate: '2026-07-25' });
  });

  it('누락 — 무제한 전체 조회 차단', () => {
    expect(validateStatsDateRange('', '2026-07-25').ok).toBe(false);
    expect(validateStatsDateRange('2026-07-01', undefined).ok).toBe(false);
    expect(validateStatsDateRange(undefined, undefined).ok).toBe(false);
  });

  it('형식 위반 — YYYY-MM-DD 아니면 거부(toDestDt가 조용히 무시하던 경로)', () => {
    for (const bad of ['x', '20260701', '2026/07/01', '2026-7-1']) {
      expect(validateStatsDateRange(bad, '2026-07-25').ok).toBe(false);
    }
  });

  it('존재하지 않는 날짜 거부', () => {
    expect(validateStatsDateRange('2026-13-45', '2026-07-25').ok).toBe(false);
    expect(validateStatsDateRange('2026-02-30', '2026-07-25').ok).toBe(false);
  });

  it('역순 기간 거부 — 조용한 빈 CSV 대신 오류로 표면화', () => {
    const r = validateStatsDateRange('2026-07-25', '2026-07-01');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('시작일');
  });

  it('앞뒤 공백은 트림해 정규화 반환 — 호출부가 이 값을 써야 월 확장이 안 깨진다', () => {
    // 원본을 그대로 넘기면 expandMonthly의 substring(0,7)이 ' 2026-0'을 만들어 시작일 필터가 조용히 빠졌다(Codex R3)
    expect(validateStatsDateRange(' 2026-07-01 ', ' 2026-07-25 ')).toEqual({ ok: true, startDate: '2026-07-01', endDate: '2026-07-25' });
  });

  it('상한 초과 기간 거부 — 대상ID 그레인 조회 폭증 차단', () => {
    const r = validateStatsDateRange('2025-01-01', '2026-12-31');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('최대');
  });

  it('상한 경계 — 366일 통과 / 367일 거부', () => {
    expect(validateStatsDateRange('2026-01-01', '2027-01-01').ok).toBe(true); // 366일
    expect(validateStatsDateRange('2026-01-01', '2027-01-02').ok).toBe(false); // 367일
  });

  it('상한은 호출부가 조정 가능(maxDays)', () => {
    expect(validateStatsDateRange('2026-07-01', '2026-07-31', 31).ok).toBe(true);
    expect(validateStatsDateRange('2026-07-01', '2026-08-01', 31).ok).toBe(false);
  });

  it('윤년 — 2024-02-29 통과 / 2025-02-29 거부', () => {
    expect(validateStatsDateRange('2024-02-29', '2024-03-01').ok).toBe(true);
    expect(validateStatsDateRange('2025-02-29', '2025-03-01').ok).toBe(false);
  });
});

describe('resolveRelayOwnerCustId — 부달 재전송 원 발송ID 해석 (서수란 2026-07-25 #4)', () => {
  it('실측 형태 전부 — 접두 4자리를 대문자로 뽑는다', () => {
    // 2026-07-25 62 실측 덤프에서 확인된 형태들
    expect(resolveRelayOwnerCustId('b0093_16006217')).toBe('B0093');
    expect(resolveRelayOwnerCustId('b0179_1600-1279')).toBe('B0179');
    expect(resolveRelayOwnerCustId('b0067_metrocity')).toBe('B0067');
    expect(resolveRelayOwnerCustId('B0179_1522-5954')).toBe('B0179');
    expect(resolveRelayOwnerCustId('b0179_07074671900')).toBe('B0179');
    expect(resolveRelayOwnerCustId('B0131')).toBe('B0131'); // 구분자 없는 단독 형태
  });

  it('앞뒤 공백은 트림 후 판정', () => {
    expect(resolveRelayOwnerCustId('  b0179_16601910  ')).toBe('B0179');
  });

  it('형식 밖 값은 null — 추측 귀속 금지(오귀속=남의 청구서)', () => {
    for (const bad of ['', '   ', '400', '한솔축산둔산점', '점육정_', 'evision_japan', '농심가3호점_쿠스코', 'alarm', 'B012', 'BB0179_1', '0179_160']) {
      expect(resolveRelayOwnerCustId(bad)).toBeNull();
    }
  });

  it('인코딩 손상값도 접두가 ASCII가 아니면 null', () => {
    expect(resolveRelayOwnerCustId('ÇÑ¼ÖÃà»êµÐ»êÁ¡')).toBeNull();
  });

  it('null·undefined 안전', () => {
    expect(resolveRelayOwnerCustId(null)).toBeNull();
    expect(resolveRelayOwnerCustId(undefined)).toBeNull();
  });

  it('중계 계정 판별 — 대소문자·공백 무시', () => {
    expect(isRelayCustId('B0061')).toBe(true);
    expect(isRelayCustId(' b0061 ')).toBe(true);
    expect(isRelayCustId('B0179')).toBe(false);
    expect(isRelayCustId('')).toBe(false);
  });
});
