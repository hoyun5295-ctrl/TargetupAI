/**
 * 보안 · 인증 묶음 = 대표 · 지원팀장만 계약 (★2026-10-03 Harold · 설계서 docs/2026-10-03-admin-dashboard-split-design.md §0 · §2 · §3 · §4)
 *
 * 왜 있나
 *   Harold 1003 「보안 · 인증 전 메뉴 ceo · suran · AI 영업도 ceo · suran · 감사 로그는 오직 나만」 → 「등급표를 교체하면 되잖아」.
 *   사용 중인 계정 = ceo(대표) · suran(지원팀장) · 지원팀원 2명이라, 등급표의 지원팀원 칸을 닫으면 그대로 「ceo · suran」이 된다.
 *   그전에는 금칙어 · 국외 접근 통제(설정 · 예외) · 로그인 차단 라우트가 등급을 보지 않아 지원팀원도 바꿀 수 있었다.
 *   등급표는 3.2 접근권한 분류표의 원본이라 「시스템과 문서 일치」(반려 3.2 ②)가 이 시험에 걸려 있다.
 *
 * 못 박는 것
 *   1. 보안 · 인증 축 7개에서 지원팀원은 전부 「없음」, 감사 로그는 대표만, 직원 계정은 지원팀장 조회만.
 *   2. 요청 방식 판정(조회 · 변경 · 삭제)과 메뉴 노출 판정이 등급표 하나에서 나온다.
 *   3. 막는 장치가 실제로 막는다(미들웨어 실행 · 조회 실패 = 닫힘) · 라우트마다 빠짐없이 붙어 있다.
 *   4. AI 영업 기본 허용 = ceo · suran.
 *   5. 화면: 메뉴 7묶음 · 항목 33개 각 1번(★1006 기능 관심 업체 +1 · ★1007 본인인증 현황 +1) · 묶음 활성은 항목에서 계산 · 보안 메뉴는 서버 판정으로만 노출 · 진단 뱃지 60초 주기.
 *
 * ⚠ mock 은 실제 SELECT 보다 관대하면 안 된다 — `fetchAdminRole` 은 `SELECT role … AND is_active = true` 만 본다.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

// middlewares/auth.ts 는 불러올 때 JWT_SECRET 이 없으면 프로세스를 끝낸다 — 시험 전용 값(도달 불가)을 먼저 둔다
vi.hoisted(() => { if (!process.env.JWT_SECRET) process.env.JWT_SECRET = 'test-only-not-a-secret'; });
vi.mock('../../config/database', () => ({ query: vi.fn() }));

import { query } from '../../config/database';
import { PERMISSION_MATRIX, canRead, canWrite, canDelete, canForMethod, readMapFor, type AdminRole } from '../admin-role';
import { requireAdminArea } from '../../middlewares/auth';

const mockQuery = query as unknown as ReturnType<typeof vi.fn>;
const SRC = join(__dirname, '..', '..');
const read = (p: string) => readFileSync(join(SRC, p), 'utf8');

const SECURITY_KEYS = ['adminAccounts', 'loginBlocks', 'geoAccess', 'geoHits', 'spamBlock', 'auditLogs', 'opsRecords'];
const lv = (key: string) => PERMISSION_MATRIX.find((r) => r.key === key)?.levels;

describe('1. 등급표 — 보안 · 인증 축', () => {
  it('7개 축이 모두 등급표에 있다(없으면 전원 NONE 이라 대표도 막힌다)', () => {
    for (const k of SECURITY_KEYS) expect(lv(k), k).toBeDefined();
  });

  it('지원팀원은 7개 축 전부 「없음」', () => {
    for (const k of SECURITY_KEYS) expect(lv(k)?.support, k).toBe('NONE');
  });

  it('감사 로그는 대표만(Harold 「오직 나만」)', () => {
    expect(lv('auditLogs')).toEqual({ super: 'R', lead: 'NONE', support: 'NONE' });
  });

  it('직원 계정은 지원팀장 조회만 · 변경 · 삭제는 대표만', () => {
    expect(lv('adminAccounts')).toEqual({ super: 'RWD', lead: 'R', support: 'NONE' });
    expect(canRead('lead', 'adminAccounts')).toBe(true);
    expect(canWrite('lead', 'adminAccounts')).toBe(false);
    expect(canDelete('lead', 'adminAccounts')).toBe(false);
  });

  it('금칙어 · 국외 접근 통제 · 로그인 차단 = 대표 · 지원팀장 조회 · 변경 · 삭제', () => {
    for (const k of ['spamBlock', 'geoAccess', 'loginBlocks']) {
      expect(lv(k), k).toEqual({ super: 'RWD', lead: 'RWD', support: 'NONE' });
    }
  });

  it('운영 기록 대장 = 대표 · 지원팀장 작성 · 확인(작성자 ≠ 확인자가 성립하는 두 사람)', () => {
    expect(lv('opsRecords')).toEqual({ super: 'RW', lead: 'RW', support: 'NONE' });
  });

  it('보안 축 밖의 운영 축(고객 · 발송 · 요금)은 지원팀원 그대로 — 이번 변경이 실무 화면을 닫지 않는다', () => {
    for (const k of ['customers', 'sending', 'billing']) expect(lv(k)?.support, k).toBe('RW');
  });
});

describe('2. 요청 방식 판정 · 메뉴 노출 판정 = 같은 등급표', () => {
  it('조회 = GET · HEAD, 삭제 = DELETE, 그 밖 = 변경', () => {
    expect(canForMethod('lead', 'adminAccounts', 'GET')).toBe(true);
    expect(canForMethod('lead', 'adminAccounts', 'head')).toBe(true);
    expect(canForMethod('lead', 'adminAccounts', 'POST')).toBe(false);
    expect(canForMethod('lead', 'adminAccounts', 'PATCH')).toBe(false);
    expect(canForMethod('lead', 'adminAccounts', 'DELETE')).toBe(false);
    expect(canForMethod('lead', 'spamBlock', 'DELETE')).toBe(true);
    // 조회 · 변경만 있는 축(RW)은 DELETE 를 막는다 — DELETE 를 변경으로 접으면 이 줄이 깨진다
    expect(canForMethod('lead', 'opsRecords', 'DELETE')).toBe(false);
    expect(canForMethod('lead', 'opsRecords', 'POST')).toBe(true);
    for (const m of ['GET', 'POST', 'PUT', 'PATCH', 'DELETE']) expect(canForMethod('support', 'spamBlock', m), m).toBe(false);
  });

  it('readMapFor = 등급표 축마다 canRead 그대로', () => {
    for (const role of ['super', 'lead', 'support'] as AdminRole[]) {
      const map = readMapFor(role);
      expect(Object.keys(map).sort()).toEqual(PERMISSION_MATRIX.map((r) => r.key).sort());
      for (const r of PERMISSION_MATRIX) expect(map[r.key], `${role}:${r.key}`).toBe(canRead(role, r.key));
    }
    expect(readMapFor('lead').auditLogs).toBe(false);
    expect(readMapFor('support').opsRecords).toBe(false);
    expect(readMapFor('super').loginBlocks).toBe(true);
  });
});

describe('3. 막는 장치가 실제로 막는다', () => {
  const ROLE: Record<string, { role: string | null; active: boolean }> = {
    'id-ceo': { role: 'super', active: true },
    'id-suran': { role: 'lead', active: true },
    'id-eunji': { role: 'support', active: true },
    'id-off': { role: 'super', active: false },
  };
  beforeEach(() => {
    mockQuery.mockReset();
    mockQuery.mockImplementation(async (sql: string, params: any[]) => {
      if (!/SELECT\s+role\s+FROM\s+super_admins\s+WHERE\s+id\s*=\s*\$1\s+AND\s+is_active\s*=\s*true/i.test(sql)) {
        throw new Error(`예상하지 못한 SQL: ${sql}`);
      }
      const r = ROLE[params?.[0]];
      return { rows: r && r.active ? [{ role: r.role }] : [] };
    });
  });

  async function run(key: string, userId: string | undefined, method: string) {
    const res: any = { code: 0, body: null, status(c: number) { this.code = c; return this; }, json(b: any) { this.body = b; return this; } };
    const next = vi.fn();
    await requireAdminArea(key)({ user: userId ? { userId } : undefined, method } as any, res, next);
    return { passed: next.mock.calls.length === 1, code: res.code };
  }

  it('대표 · 지원팀장은 통과, 지원팀원은 403', async () => {
    expect((await run('loginBlocks', 'id-ceo', 'DELETE')).passed).toBe(true);
    expect((await run('loginBlocks', 'id-suran', 'POST')).passed).toBe(true);
    const e = await run('loginBlocks', 'id-eunji', 'GET');
    expect(e.passed).toBe(false);
    expect(e.code).toBe(403);
  });

  it('지원팀장은 직원 계정 조회만 통과 · 변경은 403', async () => {
    expect((await run('adminAccounts', 'id-suran', 'GET')).passed).toBe(true);
    expect((await run('adminAccounts', 'id-suran', 'PATCH')).code).toBe(403);
  });

  it('비활성 · 미로그인 · 조회 실패는 닫힌다(fail-closed)', async () => {
    expect((await run('spamBlock', 'id-off', 'GET')).code).toBe(403);
    expect((await run('spamBlock', undefined, 'GET')).code).toBe(403);
    mockQuery.mockImplementation(async () => { throw new Error('db down'); });
    expect((await run('spamBlock', 'id-ceo', 'GET')).code).toBe(403);
  });
});

describe('3-2. 라우트마다 빠짐없이 붙어 있다', () => {
  const admin = read('routes/admin.ts');
  const routeLines = (re: RegExp) => admin.split('\n').filter((l) => re.test(l));

  it('금칙어 라우트 전부 requireAdminArea(spamBlock)', () => {
    const lines = routeLines(/router\.(get|post|put|patch|delete)\('\/spam-block/);
    expect(lines.length).toBeGreaterThanOrEqual(6);
    for (const l of lines) expect(l, l).toContain("authenticate, requireSuperAdmin, requireAdminArea('spamBlock'), async");
  });

  it('국외 라우트 — 이력은 geoHits, 그 밖 전부 geoAccess', () => {
    const lines = routeLines(/router\.(get|post|put|patch|delete)\('\/geo\//);
    expect(lines.length).toBeGreaterThanOrEqual(6);
    for (const l of lines) {
      const key = l.includes("'/geo/hits'") ? 'geoHits' : 'geoAccess';
      expect(l, l).toContain(`authenticate, requireSuperAdmin, requireAdminArea('${key}'), async`);
    }
  });

  it('로그인 차단 — 라우터 전체를 슈퍼관리자 확인 뒤 loginBlocks 로 막는다', () => {
    const lb = read('routes/admin/login-blocks.ts');
    const gate = lb.indexOf("router.use(requireAdminArea('loginBlocks'));");
    expect(gate).toBeGreaterThan(lb.indexOf("req.user?.userType !== 'super_admin'"));
    expect(gate).toBeLessThan(lb.indexOf("router.get('/active'"));
  });

  it('메뉴 노출 API 와 직원 계정 쓰기 표시', () => {
    expect(admin).toContain("router.get('/my-permissions', authenticate, requireSuperAdmin, async");
    expect(admin).toContain('return res.json({ role, canRead: readMapFor(role) });');
    expect(admin).toContain("canWrite: canWrite(myRole, 'adminAccounts'),");
  });

  it('미들웨어 = 등급 조회 + 요청 방식 판정 + 403', () => {
    const auth = read('middlewares/auth.ts');
    const body = auth.slice(auth.indexOf('export const requireAdminArea'), auth.indexOf('export const requireCompanyAdmin'));
    expect(body).toContain('await fetchAdminRole(req.user?.userId)');
    expect(body).toContain('canForMethod(role, key, req.method)');
    expect(body).toContain('res.status(403)');
  });
});

describe('4. AI 영업 = ceo · suran', () => {
  it('허용 목록 기본값', () => {
    expect(read('utils/audit-log.ts')).toContain("isSuperAdminAllowed(superAdminId, 'SALES_OUTREACH_ALLOWED_USERS', 'ceo,suran', 'sales-outreach', 'salesOutreach')");
    expect(lv('salesOutreach')?.lead).not.toBe('NONE');
  });
});

describe('5. 화면 — 메뉴 7묶음 · 노출 · 뱃지', () => {
  const page = readFileSync(join(SRC, '../../frontend/src/pages/AdminDashboard.tsx'), 'utf8');
  const menu = page.slice(page.indexOf('{/* 드롭다운 그룹 메뉴 */}'), page.indexOf('const c = colorMap[group.color] || colorMap.blue;'));

  it('묶음 7개 · 순서', () => {
    const labels = [...menu.matchAll(/label: '([^']+)', color: '(\w+)'/g)].map((m) => m[1]);
    expect(labels).toEqual(['고객 관리', '발송 관리', '대행 발송', '요금/정산', '보안 · 인증', '연동 · 인프라', 'AI · 콘텐츠']);
  });

  it('항목 33개 · 각 1번(삭제 0 · 중복 0)', () => {
    const keys = [...menu.matchAll(/\{ key: '(\w+)', label: '/g)].map((m) => m[1]);
    expect(keys.length).toBe(33);
    expect(new Set(keys).size).toBe(33);
    for (const k of ['companies', 'users', 'marketingDiagnosis', 'salesOutreach', 'callbacks', 'templates', 'scheduled', 'allCampaigns', 'stats',
      'agencyMail', 'agencyLedger', 'campaignAgency', 'plans', 'requests', 'deposits', 'credits', 'billing',
      'adminAccounts', 'loginBlocks', 'geoAccess', 'spamBlock', 'auditLogs', 'identityStatus', 'opsRecords',
      'syncAgents', 'agentDeploy', 'lineGroups', 'bestCopy', 'bestLayout', 'aiTraining', 'helpQuestions', 'precheckUsage', 'featureInterest']) {
      expect(keys, k).toContain(k);
    }
  });

  it('묶음 활성은 항목에서 계산(손으로 적는 탭 목록 없음) · 빈 묶음은 숨김', () => {
    expect(menu).not.toMatch(/tabs:\s*\[/);
    expect(page).not.toContain('group.tabs');
    expect(menu).toContain('const isGroupActive = group.items.some((it: any) => it.key === activeTab);');
    expect(menu).toContain('.filter((group) => group.items.length > 0)');
  });

  it('보안 · 인증 메뉴는 서버 판정으로만 노출', () => {
    for (const k of ['loginBlocks', 'geoAccess', 'spamBlock', 'opsRecords']) {
      expect(menu, k).toContain(`...(myPermRead.${k} === true ? [{ key: '${k}'`);
    }
    expect(menu).toContain("...(adminAccountsAllowed ? [{ key: 'adminAccounts'");
    expect(menu).toContain("...(auditAccessAllowed ? [{ key: 'auditLogs'");
    expect(page).toContain("fetch('/api/admin/my-permissions'");
    expect(page).toContain("setMyPermRead(d?.canRead && typeof d.canRead === 'object' ? d.canRead : {});");
  });

  it('직원 계정 쓰기 버튼은 서버 canWrite 일 때만', () => {
    expect(page).toContain('setAdminAccountsCanWrite(body.canWrite === true);');
    const tab = page.slice(page.indexOf("{activeTab === 'adminAccounts' && ("), page.indexOf('접근권한 변경 이력 대장'));
    expect(tab.indexOf('{adminAccountsCanWrite ? (')).toBeGreaterThan(-1);
    expect(tab.indexOf('{adminAccountsCanWrite ? (')).toBeLessThan(tab.indexOf('setAdminCreate('));
    const rowBtns = tab.slice(tab.indexOf('<td className="px-4 py-2 text-right whitespace-nowrap">'));
    expect(rowBtns.indexOf('{adminAccountsCanWrite ? (')).toBeLessThan(rowBtns.indexOf('setAdminRoleEdit('));
  });

  it('진단 뱃지 = 60초 주기 · 허용 계정만', () => {
    const tick = page.slice(page.indexOf('let diagInFlight = false;'), page.indexOf('const timer = setInterval(tick, 60000);'));
    expect(tick).toContain('if (diagnosisAllowedRef.current && !diagInFlight) {');
    expect(tick).toContain('loadDiagnosisBadge().finally(() => { diagInFlight = false; });');
    // 기존 두 카운트의 공용 진행 표시는 진단 응답을 기다리지 않는다(1003 Codex 1R) — 진단을 await 하면 깨진다
    expect(tick).toContain('try { await Promise.allSettled([loadSenderRegPendingCount(), loadPendingBadges()]); } finally { inFlight = false; }');
    expect(tick).not.toMatch(/await\s+(diag\b|loadDiagnosisBadge)/);
    expect(page).toContain('diagnosisAllowedRef.current = true;');
  });
});
