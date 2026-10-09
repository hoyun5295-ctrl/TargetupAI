/**
 * 본인인증 현황 (★2026-10-07 Harold 「모바일인증 현황도 슈퍼관리자에 나만 볼 수 있게」 · 「가림 적용」)
 *
 * 원천 = identity_verifications · 감사 기록 identity_verify_fail(새 칸 · 새 테이블 0) · 열람 = IDENTITY_STATUS_VIEWER_IDS(기본 ceo) AND 등급표.
 *
 * 못 박는 것
 *   1. 이름 · 번호는 가린 값만 나간다(이 화면이 3.4 · 3.5 증빙 캡처 화면이다) — 응답 어디에도 원문이 없다.
 *   2. 요청번호 = 인증 요청에 실은 값(`kmcCertNumOf`) · 한국모바일인증 건만 · 모양이 아니면 빈 값.
 *   3. 명단 계정별 인증 여부 · 담당자 번호 = 인증 번호 판정(원문 비교는 서버에서 · 결과만) · 없는 아이디 표시.
 *   4. 전 계정 시행(`*`)이면 명단 표 대신 사용 중 계정 수.
 *   5. 열람 = 전용 ENV(기본 ceo) AND 등급표(대표만) · 판정 실패 = 닫힘 · 경로 두 개 모두 게이트 · 표 없음 = 503.
 *
 * ⚠ mock 은 실제 SQL 보다 관대하면 안 된다 — 아래 fake 는 SQL 문자열을 보고 그 문장에만 답한다.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'fs';
import { join, resolve } from 'path';
import { readAdminScreenSource } from './source-scan';

vi.mock('../../config/database', () => {
  const pool = { connect: vi.fn() };
  return { query: vi.fn(), mysqlQuery: vi.fn(), pool, default: pool };
});

import { query } from '../../config/database';
import { loadIdentityStatus, identityRequestNo, identityRowStatus, IDENTITY_HISTORY_LIMIT } from '../identity-status';
import { registerIdentityProvider, IdentityProvider } from '../identity-verify';
import { isIdentityStatusViewer } from '../audit-log';

const q = query as unknown as ReturnType<typeof vi.fn>;
const back = (rel: string) => readFileSync(join(__dirname, '..', '..', rel), 'utf8').replace(/\r\n/g, '\n');
const FRONT = resolve(__dirname, '../../../../frontend/src');
const front = (rel: string) => readFileSync(join(FRONT, rel), 'utf8').replace(/\r\n/g, '\n');

const ENV_KEYS = ['IDENTITY_VERIFY_ENFORCE_FROM', 'IDENTITY_VERIFY_PILOT_LOGIN_IDS', 'IDENTITY_VERIFY_PROVIDER', 'IDENTITY_STATUS_VIEWER_IDS'];
const savedEnv: Record<string, string | undefined> = {};
const kmc: IdentityProvider = { name: 'kmc', buildStart: async () => ({}), verify: async () => ({ name: '', phone: '' }) };

const VID = 'A1B2C3D4-0000-4000-8000-00000000000A';
const VID_NO = VID.replace(/-/g, '').toLowerCase();
// 도달 불가 시험 번호(형식만 유효)
const PHONE = '01000001234';

type Rows = { counts?: any; history?: any[]; failures?: any[]; pilot?: any[]; all?: any };
/** SQL 문장마다 그 문장에만 답한다 — 모르는 문장은 던진다(관대한 mock 금지) */
function fakeDb(rows: Rows) {
  q.mockImplementation(async (sql: string, params?: any[]) => {
    const s = String(sql);
    if (s.includes('COUNT(DISTINCT user_id)')) return { rows: [rows.counts ?? { verified_accounts: 0, changes: 0, history_total: 0, failures: 0 }] };
    if (s.includes('FROM identity_verifications iv') && s.includes('ORDER BY iv.created_at DESC')) {
      expect(params).toEqual([IDENTITY_HISTORY_LIMIT]);
      return { rows: rows.history ?? [] };
    }
    if (s.includes("al.action = 'identity_verify_fail'")) return { rows: rows.failures ?? [] };
    if (s.includes('LOWER(u.login_id) = ANY($1::text[])')) {
      const wanted: string[] = params?.[0] ?? [];
      return { rows: (rows.pilot ?? []).filter((r) => wanted.includes(String(r.login_id).toLowerCase())) };
    }
    if (s.includes("WHERE u.is_active = true AND u.status = 'active'")) return { rows: [rows.all ?? { total: 0, verified: 0 }] };
    throw new Error(`모르는 SQL: ${s.slice(0, 80)}`);
  });
}

beforeEach(() => {
  for (const k of ENV_KEYS) { savedEnv[k] = process.env[k]; delete process.env[k]; }
  registerIdentityProvider(null);
  q.mockReset();
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
  registerIdentityProvider(null);
});

describe('1. 가림 — 응답 어디에도 이름 · 번호 원문이 없다', () => {
  it('인증 이름 · 계정 이름 · 인증 번호 · 담당자 번호 = 가린 값', async () => {
    process.env.IDENTITY_VERIFY_PILOT_LOGIN_IDS = 'hoyun';
    fakeDb({
      history: [{
        id: VID.toLowerCase(), purpose: 'first_login', status: 'verified', provider: 'kmc', verified_name: '홍길동',
        verified_phone: PHONE, ip_address: '::ffff:203.0.113.7', at: '2026-10-06T12:44:16Z', lapsed: false,
        login_id: 'hoyun', account_name: '테스트계정', company_name: '인비토',
      }],
      pilot: [{ login_id: 'hoyun', name: '테스트계정', phone: PHONE, mfa_phone: PHONE, active: true, company_name: '인비토', verified_at: '2026-10-06T12:44:16Z', verified_phone: PHONE }],
    });
    const d = await loadIdentityStatus();
    const h = d.history[0];
    expect(h.verifiedName).toBe('홍**');
    expect(h.accountName).toBe('테****');
    expect(h.verifiedPhone).toBe('010-****-1234');
    expect(h.ip).toBe('203.0.113.7');
    expect(d.pilot[0].accountName).toBe('테****');
    expect(d.pilot[0].contactPhone).toBe('010-****-1234');
    const all = JSON.stringify(d);
    for (const raw of [PHONE, '00001234', '길동', '스트계정']) expect(all, raw).not.toContain(raw);
  });
});

describe('2. 요청번호 · 상태', () => {
  it('요청번호 = 인증 건 번호 하이픈 제거(소문자) · 모양이 아니면 빈 값', () => {
    expect(identityRequestNo(VID)).toBe(VID_NO);
    expect(identityRequestNo('not-a-uuid')).toBe('');
    expect(identityRequestNo(PHONE)).toBe('');
    expect(identityRequestNo(null)).toBe('');
  });

  it('한국모바일인증 건만 요청번호 · 실패 기록은 감사 기록의 인증 건 번호에서', async () => {
    fakeDb({
      history: [
        { id: VID.toLowerCase(), purpose: 'change', status: 'superseded', provider: 'kmc', at: '2026-10-07T00:00:00Z', lapsed: false },
        { id: VID.toLowerCase(), purpose: 'first_login', status: 'pending', provider: 'stub', at: '2026-10-07T00:00:00Z', lapsed: true },
      ],
      failures: [
        { created_at: '2026-10-07T01:00:00Z', ip: '203.0.113.9', login_id: 'gwchae', company_name: '인비토',
          details: { purpose: 'first_login', result: 'rejected', reason: 'provider', detail: 'KMC_TOKEN_APR02', verificationId: VID.toLowerCase() } },
        { created_at: '2026-10-07T02:00:00Z', ip: null, login_id: 'sgbaek', company_name: null, details: { result: 'expired', verificationId: null } },
      ],
    });
    const d = await loadIdentityStatus();
    expect(d.history.map((h) => h.requestNo)).toEqual([VID_NO, '']);
    expect(d.history.map((h) => h.status)).toEqual(['superseded', 'lapsed']);
    expect(d.failures[0]).toMatchObject({ loginId: 'gwchae', result: 'rejected', reason: 'provider', detail: 'KMC_TOKEN_APR02', requestNo: VID_NO, ip: '203.0.113.9' });
    expect(d.failures[1]).toMatchObject({ result: 'expired', requestNo: '', ip: '', companyName: '' });
  });

  it('대기 행 = 시간 안이면 진행 중 · 넘기면 중단', () => {
    expect(identityRowStatus('pending', false)).toBe('pending');
    expect(identityRowStatus('pending', true)).toBe('lapsed');
    expect(identityRowStatus('verified', true)).toBe('verified');
    expect(identityRowStatus('superseded', false)).toBe('superseded');
  });
});

describe('3. 명단 계정별', () => {
  it('인증 여부 · 담당자 번호 = 인증 번호 판정 · 없는 아이디 · 대소문자 무시 · 숫자 칸', async () => {
    process.env.IDENTITY_VERIFY_ENFORCE_FROM = '2026-01-01';
    process.env.IDENTITY_VERIFY_PILOT_LOGIN_IDS = 'HoYun, gwchae ,sgbaek,nobody';
    registerIdentityProvider(kmc);
    fakeDb({
      counts: { verified_accounts: 2, changes: 1, history_total: 7, failures: 3 },
      pilot: [
        { login_id: 'hoyun', name: '가', phone: PHONE, mfa_phone: '010-0000-1234', active: true, company_name: '인비토', verified_at: '2026-10-06T12:44:16Z', verified_phone: PHONE },
        { login_id: 'gwchae', name: '나', phone: null, mfa_phone: null, active: true, company_name: '인비토', verified_at: null, verified_phone: null },
        { login_id: 'sgbaek', name: '다', phone: PHONE, mfa_phone: '01000005678', active: false, company_name: '인비토', verified_at: '2026-10-07T01:00:00Z', verified_phone: PHONE },
      ],
    });
    const d = await loadIdentityStatus();
    expect(d.rollout).toEqual({ enforceFrom: '2026-01-01', enforced: true, allAccounts: false, pilotCount: 4, provider: 'kmc' });
    expect(d.pilot.map((p) => [p.loginId, p.found, !!p.verifiedAt, p.phoneMatches, p.active])).toEqual([
      ['hoyun', true, true, true, true],
      ['gwchae', true, false, null, true],
      ['sgbaek', true, true, false, false],
      ['nobody', false, false, null, false],
    ]);
    expect(d.summary).toEqual({ targetAccounts: 4, targetVerified: 2, verifiedAccounts: 2, changes: 1, failures: 3 });
    expect(d.historyTotal).toBe(7);
    expect(q.mock.calls.some(([s]) => String(s).includes("u.status = 'active'") && !String(s).includes('LOWER('))).toBe(false);
  });

  it('명단이 비면 명단 조회를 하지 않는다 · 시행 꺼짐', async () => {
    fakeDb({});
    const d = await loadIdentityStatus();
    expect(d.pilot).toEqual([]);
    expect(d.rollout).toEqual({ enforceFrom: null, enforced: false, allAccounts: false, pilotCount: 0, provider: null });
    expect(q.mock.calls.some(([s]) => String(s).includes('LOWER(u.login_id)'))).toBe(false);
  });
});

describe('4. 전 계정 시행(*)', () => {
  it('명단 표 대신 사용 중 계정 수 · 그중 인증 완료', async () => {
    process.env.IDENTITY_VERIFY_ENFORCE_FROM = '2026-10-26';
    process.env.IDENTITY_VERIFY_PILOT_LOGIN_IDS = '*';
    fakeDb({ all: { total: 120, verified: 37 } });
    const d = await loadIdentityStatus();
    expect(d.rollout.allAccounts).toBe(true);
    expect(d.rollout.pilotCount).toBe(0);
    expect(d.pilot).toEqual([]);
    expect(d.summary.targetAccounts).toBe(120);
    expect(d.summary.targetVerified).toBe(37);
    expect(q.mock.calls.some(([s]) => String(s).includes('LOWER(u.login_id)'))).toBe(false);
  });
});

describe('5. 열람은 Harold님만', () => {
  /** fetchAdminRole · 로그인 아이디 두 문장에만 답한다 */
  const viewerDb = (role: string | null, loginId: string | null) => q.mockImplementation(async (sql: string) => {
    const s = String(sql);
    if (s.includes('SELECT role FROM super_admins')) return { rows: role ? [{ role }] : [] };
    if (s.includes('SELECT login_id FROM super_admins')) return { rows: loginId ? [{ login_id: loginId }] : [] };
    throw new Error(`모르는 SQL: ${s.slice(0, 80)}`);
  });

  it('대표 등급 · ceo = 열림 · 지원팀장 · 다른 아이디 · 미등록 · 조회 실패 = 닫힘', async () => {
    viewerDb('super', 'ceo'); expect(await isIdentityStatusViewer('s1')).toBe(true);
    viewerDb('lead', 'ceo'); expect(await isIdentityStatusViewer('s1')).toBe(false);
    viewerDb('super', 'suran'); expect(await isIdentityStatusViewer('s1')).toBe(false);
    viewerDb(null, null); expect(await isIdentityStatusViewer('s1')).toBe(false);
    q.mockRejectedValue(new Error('down')); expect(await isIdentityStatusViewer('s1')).toBe(false);
    expect(await isIdentityStatusViewer(null)).toBe(false);
  });

  it('전용 ENV 로 다른 계정을 열 수 있다(다른 축과 별도)', async () => {
    process.env.IDENTITY_STATUS_VIEWER_IDS = 'ceo,admin';
    viewerDb('super', 'admin'); expect(await isIdentityStatusViewer('s1')).toBe(true);
  });

  it('게이트 = 전용 ENV(기본 ceo) AND 등급표(대표 조회만)', () => {
    expect(back('utils/audit-log.ts')).toContain("isSuperAdminAllowed(superAdminId, 'IDENTITY_STATUS_VIEWER_IDS', 'ceo', 'identity-status', 'identityStatus')");
    const role = back('utils/admin-role.ts');
    const at = role.indexOf("key: 'identityStatus'");
    expect(at).toBeGreaterThan(0);
    expect(role.slice(at, at + 300)).toContain("levels: { super: 'R', lead: 'NONE', support: 'NONE' }");
  });

  it('경로 두 개 모두 게이트 · 표 없음 = 503 DB_MIGRATION_PENDING', () => {
    const admin = back('routes/admin.ts');
    expect(admin).toContain("router.get('/identity-status/access', authenticate, requireSuperAdmin");
    const r = admin.slice(admin.indexOf("router.get('/identity-status', authenticate, requireSuperAdmin"));
    expect(r.slice(0, 400)).toContain('if (!(await isIdentityStatusViewer(req.user?.userId)))');
    expect(r.slice(0, 900)).toContain('if (isIdentitySchemaMissing(err)) return res.status(503).json({ success: false, ...IDENTITY_MIGRATION_RESPONSE });');
  });
});

describe('6. 화면', () => {
  const dash = readAdminScreenSource(); // ★ 2026-10-09 파일 분리 E 뒤 = 본체 + 옮겨 간 화면 합본
  const tab = front('components/admin/IdentityStatusTab.tsx');

  it('메뉴 = 보안 · 인증 묶음 · 허용 응답일 때만', () => {
    expect(dash).toContain("fetch('/api/admin/identity-status/access'");
    const group = dash.slice(dash.indexOf("label: '보안 · 인증',"), dash.indexOf("label: '연동 · 인프라'"));
    expect(group).toContain("...(identityStatusAllowed ? [{ key: 'identityStatus', label: '본인인증 현황' }] : []),");
    expect(dash).toContain("{activeTab === 'identityStatus' && identityStatusAllowed && <IdentityStatusTab />}");
  });

  it('받은 값만 그린다(화면이 번호를 다시 다루지 않는다) · 줄표 · 모델명 · native dialog 0 · 출처 줄', () => {
    expect(tab).toContain("fetch('/api/admin/identity-status'");
    expect(tab).not.toMatch(/replace\(|slice\(\d/);
    const code = tab.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, '');
    expect(code).not.toContain('—');
    expect(code).not.toMatch(/Opus|Sonnet|Haiku|GPT|Claude|Anthropic|claude-/);
    expect(code).not.toMatch(/\b(alert|confirm|prompt)\(/);
    expect(tab).toContain('Data source: ');
  });
});
