/**
 * 직원 계정 등급 관문 계약 (★2026-08-27 전송자격인증 3.2·3.3)
 *
 * 왜 있나
 *   `isSuperAdminAllowed`는 감사 로그·국외 접근 이력·AI 학습·AI 영업 등 **8개 축이 공유하는 단일 코어**다.
 *   여기에 등급 관문을 AND로 붙였는데 이 함수에는 테스트가 한 건도 없었다. 판정이 한 칸만 틀어져도
 *   여덟 화면이 한꺼번에 열리거나(개방 사고) 한꺼번에 닫힌다(대표까지 감사 로그를 못 봄).
 *
 * 못 박는 것
 *   1. 등급과 ENV 둘 다 통과해야 열린다(AND). 어느 한쪽만으로는 안 열린다.
 *   2. **등급 도입이 권한 개방이 되지 않는다** — ENV가 막는 계정은 등급이 super여도 여전히 막힌다.
 *   3. role이 NULL·빈값·모르는 값이면 최저 등급(support)으로 접힌다. 오타가 전권이 되지 않는다.
 *   4. 조회 실패·미등록·미로그인은 전부 닫힌다(fail-closed).
 *   5. 권한분류표에 없는 축(permKey 미지정)은 등급 관문을 건너뛴다 — 새 축을 조용히 막지 않는다.
 *
 * ⚠ mock은 실제 SELECT보다 관대하면 안 된다(2026-08-27 교훈).
 *   `fetchAdminRole`은 `SELECT role ... AND is_active = true`, 화이트리스트는 `SELECT login_id ...`를 쓴다.
 *   아래 fake는 **SQL 문자열을 보고 그 문이 실제로 고르는 컬럼만** 돌려준다.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../config/database', () => ({ query: vi.fn() }));

import { query } from '../../config/database';
import { isAuditLogViewer, isGeoHitsViewer, isLineGroupAdmin } from '../audit-log';

const mockQuery = query as unknown as ReturnType<typeof vi.fn>;

/** 운영과 같은 모양의 계정 원장 */
type Row = { login_id: string; role: string | null; is_active: boolean };
const LEDGER: Record<string, Row> = {
  'id-ceo': { login_id: 'ceo', role: 'super', is_active: true },
  'id-suran': { login_id: 'suran', role: 'lead', is_active: true },
  'id-eunji': { login_id: 'eunji_admin', role: 'support', is_active: true },
  'id-nullrole': { login_id: 'ceo', role: null, is_active: true },
  'id-typo': { login_id: 'ceo', role: 'SUPERUSER', is_active: true },
  'id-inactive': { login_id: 'ceo', role: 'super', is_active: false },
};

function installLedger() {
  mockQuery.mockImplementation(async (sql: string, params: any[]) => {
    const row = LEDGER[params?.[0]];
    // fetchAdminRole — role만 고르고, 비활성은 애초에 행이 없다
    if (/SELECT\s+role\s+FROM\s+super_admins/i.test(sql)) {
      if (!row || !row.is_active) return { rows: [] };
      return { rows: [{ role: row.role }] };
    }
    // 화이트리스트 — login_id만 고른다(role을 얹어주면 mock이 실제보다 관대해진다)
    if (/SELECT\s+login_id\s+FROM\s+super_admins/i.test(sql)) {
      return { rows: row ? [{ login_id: row.login_id }] : [] };
    }
    throw new Error(`예상하지 못한 SQL: ${sql}`);
  });
}

const ENV_KEYS = ['AUDIT_LOG_VIEWER_IDS', 'GEO_HITS_VIEWER_IDS', 'LINE_GROUP_ADMIN_USERS'];
const savedEnv: Record<string, string | undefined> = {};

beforeEach(() => {
  mockQuery.mockReset();
  installLedger();
  for (const k of ENV_KEYS) savedEnv[k] = process.env[k];
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k]!;
  }
});

describe('등급 관문 — 감사 로그(super 전용 축)', () => {
  it('대표(super)는 통과한다 — 등급 도입으로 대표가 막히면 안 된다', async () => {
    await expect(isAuditLogViewer('id-ceo')).resolves.toBe(true);
  });

  it('지원팀장(lead)은 등급에서 막힌다 — ENV에 넣어줘도 열리지 않는다', async () => {
    process.env.AUDIT_LOG_VIEWER_IDS = 'ceo,suran';
    await expect(isAuditLogViewer('id-suran')).resolves.toBe(false);
  });

  it('지원팀원(support)도 막힌다', async () => {
    process.env.AUDIT_LOG_VIEWER_IDS = 'ceo,eunji_admin';
    await expect(isAuditLogViewer('id-eunji')).resolves.toBe(false);
  });
});

describe('등급 관문 — 국외 접근 이력(super·lead 축)', () => {
  it('지원팀장(lead)은 통과한다 — 분류표가 이 축을 lead에게 열어 뒀다', async () => {
    process.env.GEO_HITS_VIEWER_IDS = 'ceo,suran';
    await expect(isGeoHitsViewer('id-suran')).resolves.toBe(true);
  });

  it('지원팀원(support)은 막힌다', async () => {
    process.env.GEO_HITS_VIEWER_IDS = 'ceo,suran,eunji_admin';
    await expect(isGeoHitsViewer('id-eunji')).resolves.toBe(false);
  });
});

describe('AND 결합 — 등급이 열어도 ENV가 막으면 막힌다', () => {
  it('대표라도 ENV 목록에서 빠지면 열리지 않는다(등급 도입 ≠ 권한 개방)', async () => {
    process.env.AUDIT_LOG_VIEWER_IDS = 'someone_else';
    await expect(isAuditLogViewer('id-ceo')).resolves.toBe(false);
  });

  it('ENV가 열어도 등급이 막으면 열리지 않는다', async () => {
    process.env.LINE_GROUP_ADMIN_USERS = 'ceo,eunji_admin';
    await expect(isLineGroupAdmin('id-eunji')).resolves.toBe(false);
  });
});

describe('fail-closed — 모르는 것은 전부 닫는다', () => {
  it('role이 NULL이면 최저 등급으로 접혀 막힌다', async () => {
    await expect(isAuditLogViewer('id-nullrole')).resolves.toBe(false);
  });

  it('role에 모르는 값이 들어 있어도 전권이 되지 않는다', async () => {
    await expect(isAuditLogViewer('id-typo')).resolves.toBe(false);
  });

  it('비활성 계정은 등급 조회에서 행이 없어 막힌다', async () => {
    await expect(isAuditLogViewer('id-inactive')).resolves.toBe(false);
  });

  it('미로그인(id 없음)은 조회조차 하지 않고 막힌다', async () => {
    await expect(isAuditLogViewer(null)).resolves.toBe(false);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('조회가 던지면 막힌다', async () => {
    mockQuery.mockImplementation(async () => { throw new Error('connection terminated'); });
    await expect(isAuditLogViewer('id-ceo')).resolves.toBe(false);
  });
});

describe('등급 관문이 실제로 걸려 있다', () => {
  it('등급 조회 SQL이 먼저 돈다 — permKey를 안 넘긴 축이 생기면 이 계약이 깨진다', async () => {
    await isAuditLogViewer('id-ceo');
    const sqls = mockQuery.mock.calls.map((c: any[]) => String(c[0]));
    expect(sqls.some((q) => /SELECT\s+role\s+FROM\s+super_admins/i.test(q))).toBe(true);
  });
});
