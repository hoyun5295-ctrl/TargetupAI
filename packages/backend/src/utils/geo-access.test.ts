/**
 * 국외 접근 통제 — 전송자격인증 2.2 (★2026-08-19)
 *
 * 이 게이트는 **전 고객의 로그인을 막을 수 있다.** 그래서 테스트가 지키는 것은 차단이 아니라
 * "막지 말아야 할 때 막지 않는가"다.
 *
 *   1. ★ 시행일 스위치 — `GEO_BLOCK_ENFORCE_FROM` 미설정이면 **배포만으로는 아무도 안 막힌다**.
 *   2. ★ 판정 불가는 전부 통과 — 대역 테이블이 비었거나, 사설 IP거나, 조회가 실패하면 `unknown`이고 통과다.
 *      "모른다"를 차단으로 접으면 그 순간 전 고객이 막힌다.
 *   3. ★ 예외 승인이 있으면 국외라도 통과 — 해외 근무 담당자·해외 본사 서버가 여기로 산다.
 *   4. 시행 전에는 국외를 만나도 `record`(기록)까지다. `block`은 시행 후에만 나온다.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../config/database', () => ({ query: vi.fn(), pool: { connect: vi.fn() } }));

import { query } from '../config/database';
import {
  isGeoBlockEnforced, isGeoSchemaMissing, normalizeIp, isPrivateIp,
  classifyOrigin, evaluateLoginOrigin, invalidateGeoCache,
  isOriginAllowlistEnforced, evaluateMachineOrigin,
} from './geo-access';

const q = query as unknown as ReturnType<typeof vi.fn>;
const KR = '211.234.56.78';
const US = '8.8.8.8';

/** geo_allow_cidrs 대역 보유 여부 → 매칭 결과 순서로 응답을 깐다 */
function mockGeo(opts: { hasData: boolean; matches?: boolean; exception?: boolean }) {
  q.mockReset();
  q.mockImplementation(async (sql: string) => {
    if (sql.includes('geo_allow_cidrs') && sql.includes('COUNT')) {
      return { rows: [{ n: opts.hasData ? 6000 : 0 }], rowCount: 1 };
    }
    if (sql.includes('geo_allow_cidrs')) {
      return { rows: opts.matches ? [{ ok: 1 }] : [], rowCount: opts.matches ? 1 : 0 };
    }
    if (sql.includes('access_origin_allowlist')) {
      return { rows: opts.exception ? [{ ok: 1 }] : [], rowCount: opts.exception ? 1 : 0 };
    }
    return { rows: [], rowCount: 0 };
  });
}

beforeEach(() => invalidateGeoCache());

describe('★ 시행일 스위치 — 배포만으로는 아무도 막히지 않는다', () => {
  const saved = process.env.GEO_BLOCK_ENFORCE_FROM;
  afterEach(() => {
    if (saved === undefined) delete process.env.GEO_BLOCK_ENFORCE_FROM;
    else process.env.GEO_BLOCK_ENFORCE_FROM = saved;
  });

  it('미설정이면 미시행', () => {
    delete process.env.GEO_BLOCK_ENFORCE_FROM;
    expect(isGeoBlockEnforced(new Date('2027-12-31T00:00:00+09:00'))).toBe(false);
  });

  it('시행일 전이면 미시행', () => {
    process.env.GEO_BLOCK_ENFORCE_FROM = '2026-10-01T00:00:00+09:00';
    expect(isGeoBlockEnforced(new Date('2026-09-30T23:59:59+09:00'))).toBe(false);
  });

  it('시행일 이후면 시행', () => {
    process.env.GEO_BLOCK_ENFORCE_FROM = '2026-10-01T00:00:00+09:00';
    expect(isGeoBlockEnforced(new Date('2026-10-01T00:00:01+09:00'))).toBe(true);
  });

  it('★ 값이 날짜가 아니면 미시행 — 오타로 전 고객을 막지 않는다', () => {
    process.env.GEO_BLOCK_ENFORCE_FROM = '시월일일';
    expect(isGeoBlockEnforced(new Date('2027-12-31T00:00:00+09:00'))).toBe(false);
  });
});

describe('IP 정규화', () => {
  it('IPv6로 감싼 IPv4를 벗긴다 — Express가 ::ffff: 접두로 준다', () => {
    expect(normalizeIp('::ffff:211.234.56.78')).toBe('211.234.56.78');
  });

  it('공백·포트를 걷어낸다', () => {
    expect(normalizeIp('  211.234.56.78 ')).toBe('211.234.56.78');
  });

  it('값이 없거나 IP가 아니면 null', () => {
    expect(normalizeIp('')).toBeNull();
    expect(normalizeIp(null)).toBeNull();
    expect(normalizeIp('unknown')).toBeNull();
  });

  it('★ 사설·루프백은 사설로 본다 — 내부 호출·프록시를 국외로 오판하면 안 된다', () => {
    for (const ip of ['127.0.0.1', '10.0.0.5', '172.16.3.4', '192.168.0.10', '::1']) {
      expect(isPrivateIp(ip), ip).toBe(true);
    }
    expect(isPrivateIp(KR)).toBe(false);
    expect(isPrivateIp(US)).toBe(false);
  });
});

describe('★ 판정 불가는 전부 unknown — 모른다를 차단으로 접지 않는다', () => {
  it('대역 테이블이 비어 있으면 unknown', async () => {
    mockGeo({ hasData: false });
    expect(await classifyOrigin(US)).toBe('unknown');
  });

  it('사설 IP는 조회조차 하지 않고 unknown', async () => {
    mockGeo({ hasData: true, matches: false });
    expect(await classifyOrigin('10.0.0.5')).toBe('unknown');
  });

  it('IP를 못 읽으면 unknown', async () => {
    mockGeo({ hasData: true, matches: false });
    expect(await classifyOrigin('')).toBe('unknown');
  });

  it('★ 조회가 실패해도 unknown — 필터 오류로 로그인이 막히면 안 된다', async () => {
    q.mockReset();
    q.mockRejectedValue(new Error('connection terminated'));
    expect(await classifyOrigin(US)).toBe('unknown');
  });

  it('테이블이 아직 없어도 unknown', async () => {
    q.mockReset();
    q.mockRejectedValue(new Error('relation "geo_allow_cidrs" does not exist'));
    expect(await classifyOrigin(US)).toBe('unknown');
  });
});

describe('국내·국외 판정', () => {
  it('등록 대역에 들면 domestic', async () => {
    mockGeo({ hasData: true, matches: true });
    expect(await classifyOrigin(KR)).toBe('domestic');
  });

  it('등록 대역 밖이면 foreign', async () => {
    mockGeo({ hasData: true, matches: false });
    expect(await classifyOrigin(US)).toBe('foreign');
  });
});

describe('★ 로그인 판정 — block은 시행 후에만 나온다', () => {
  const saved = process.env.GEO_BLOCK_ENFORCE_FROM;
  afterEach(() => {
    if (saved === undefined) delete process.env.GEO_BLOCK_ENFORCE_FROM;
    else process.env.GEO_BLOCK_ENFORCE_FROM = saved;
  });
  const NOW = new Date('2026-12-01T00:00:00+09:00');
  const ON = () => { process.env.GEO_BLOCK_ENFORCE_FROM = '2026-10-01T00:00:00+09:00'; };
  const OFF = () => { delete process.env.GEO_BLOCK_ENFORCE_FROM; };

  it('국내면 언제나 allow', async () => {
    ON(); mockGeo({ hasData: true, matches: true });
    const v = await evaluateLoginOrigin({ ip: KR, userId: 'u1', companyId: 'c1', now: NOW });
    expect(v.decision).toBe('allow');
    expect(v.country).toBe('domestic');
  });

  it('★ 시행 전에는 국외라도 record — 차단하지 않는다', async () => {
    OFF(); mockGeo({ hasData: true, matches: false, exception: false });
    const v = await evaluateLoginOrigin({ ip: US, userId: 'u1', companyId: 'c1', now: NOW });
    expect(v.country).toBe('foreign');
    expect(v.decision).toBe('record');
  });

  it('시행 후 국외 + 예외 없음 = block', async () => {
    ON(); mockGeo({ hasData: true, matches: false, exception: false });
    const v = await evaluateLoginOrigin({ ip: US, userId: 'u1', companyId: 'c1', now: NOW });
    expect(v.decision).toBe('block');
  });

  it('★ 예외 승인이 있으면 시행 후 국외라도 allow', async () => {
    ON(); mockGeo({ hasData: true, matches: false, exception: true });
    const v = await evaluateLoginOrigin({ ip: US, userId: 'u1', companyId: 'c1', now: NOW });
    expect(v.decision).toBe('allow');
    expect(v.exempted).toBe(true);
    expect(v.exceptionUnknown).toBe(false);
  });

  it('★ 예외 조회가 실패하면 통과시키되 예외로 기록하지 않는다 (0819 Codex)', async () => {
    ON();
    q.mockReset();
    q.mockImplementation(async (sql: string) => {
      if (sql.includes('geo_allow_cidrs') && sql.includes('COUNT')) return { rows: [{ n: 6000 }], rowCount: 1 };
      if (sql.includes('geo_allow_cidrs')) return { rows: [], rowCount: 0 };
      throw new Error('connection terminated');   // 예외 조회만 실패
    });
    const v = await evaluateLoginOrigin({ ip: US, userId: 'u1', companyId: 'c1', now: NOW });
    expect(v.country).toBe('foreign');
    expect(v.decision).toBe('record');      // 차단하지 않는다
    expect(v.exempted).toBe(false);         // 승인 행이 없으므로 예외가 아니다
    expect(v.exceptionUnknown).toBe(true);
  });

  it('★ unknown은 시행 후에도 allow — 판정 못 한 것을 막지 않는다', async () => {
    ON(); mockGeo({ hasData: false });
    const v = await evaluateLoginOrigin({ ip: US, userId: 'u1', companyId: 'c1', now: NOW });
    expect(v.country).toBe('unknown');
    expect(v.decision).toBe('allow');
  });
});

describe('DDL 미적용 감지', () => {
  it('컬럼·릴레이션 부재를 둘 다 잡는다', () => {
    expect(isGeoSchemaMissing(new Error('column "cidr" does not exist'))).toBe(true);
    expect(isGeoSchemaMissing(new Error('relation "geo_allow_cidrs" does not exist'))).toBe(true);
    expect(isGeoSchemaMissing(new Error('connection terminated'))).toBe(false);
  });
});

describe('★ 기계 경로(SDK · 싱크에이전트) — 국가로 막지 않는다', () => {
  const saved = process.env.ORIGIN_ALLOWLIST_ENFORCE_FROM;
  afterEach(() => {
    if (saved === undefined) delete process.env.ORIGIN_ALLOWLIST_ENFORCE_FROM;
    else process.env.ORIGIN_ALLOWLIST_ENFORCE_FROM = saved;
  });

  it('★ 시행 스위치가 사람 경로와 별개다 — 같은 날 켜면 수집·발송이 함께 멈춘다', () => {
    delete process.env.ORIGIN_ALLOWLIST_ENFORCE_FROM;
    process.env.GEO_BLOCK_ENFORCE_FROM = '2026-10-01T00:00:00+09:00';   // 사람 경로만 시행
    expect(isOriginAllowlistEnforced(new Date('2027-01-01T00:00:00+09:00'))).toBe(false);
    delete process.env.GEO_BLOCK_ENFORCE_FROM;
  });

  it('★ 미등록 출발지라도 미시행이면 record — 연동을 끊지 않는다', async () => {
    delete process.env.ORIGIN_ALLOWLIST_ENFORCE_FROM;
    mockGeo({ hasData: true, matches: false, exception: false });
    const v = await evaluateMachineOrigin({ ip: US, companyId: 'c1', scope: 'company_api' });
    expect(v.decision).toBe('record');
    expect(v.registered).toBe(false);
  });

  it('★ 해외 본사라도 등록 대역이면 통과 — 국가를 보지 않는다', async () => {
    process.env.ORIGIN_ALLOWLIST_ENFORCE_FROM = '2026-10-01T00:00:00+09:00';
    mockGeo({ hasData: true, matches: false, exception: true });
    const v = await evaluateMachineOrigin({ ip: US, companyId: 'c1', scope: 'company_agent', now: new Date('2026-12-01T00:00:00+09:00') });
    expect(v.decision).toBe('allow');
    expect(v.registered).toBe(true);
  });

  it('시행 후 미등록 출발지는 block', async () => {
    process.env.ORIGIN_ALLOWLIST_ENFORCE_FROM = '2026-10-01T00:00:00+09:00';
    mockGeo({ hasData: true, matches: false, exception: false });
    const v = await evaluateMachineOrigin({ ip: US, companyId: 'c1', scope: 'company_api', now: new Date('2026-12-01T00:00:00+09:00') });
    expect(v.decision).toBe('block');
  });

  it('★ 사설 IP는 판정하지 않고 통과 — 프록시 뒤 호출을 막지 않는다', async () => {
    process.env.ORIGIN_ALLOWLIST_ENFORCE_FROM = '2026-10-01T00:00:00+09:00';
    mockGeo({ hasData: true, matches: false, exception: false });
    const v = await evaluateMachineOrigin({ ip: '10.0.0.5', companyId: 'c1', scope: 'company_api', now: new Date('2026-12-01T00:00:00+09:00') });
    expect(v.decision).toBe('allow');
  });
});
