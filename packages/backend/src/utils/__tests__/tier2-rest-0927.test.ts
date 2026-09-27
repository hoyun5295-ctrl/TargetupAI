/**
 * 차수 2 나머지 (★ 2026-09-27 한줄로 V2 — SEC·PRIV · STATS-FAKE·WORDING · TX·TZ·YEAR)
 *
 * R105 공개 문의 메일 본문에 방문자 입력을 이스케이프 없이 HTML로 넣었다 → 기존 이스케이프 CT.
 * R126 상품 이미지 가져오기가 DNS 조회 뒤 fetch가 다시 해석(재바인딩 창) · 사설 판정이 약했다 → 가드 이미지 CT(연결 IP 고정).
 * R342 승인된 발신 담당자를 재승인 없이 바꾸는 수정 라우트(화면 소비처 0) → 라우트·CT 제거.
 * R372 카페24 옛 웹훅 서명을 === 로 비교 → 상수 시간 비교.
 * R092 AI 분석이 이탈 위험 고객 20명의 이름·전화 원문을 AI 지시문·저장·응답에 실었다 → 가림.
 * R203 필터 호환 래퍼가 호출마다 필터·SQL·파라미터(검색값)를 로그에 남겼다 → 제거.
 * S2-02 비밀번호 변경에 요청 제한이 없었다 → 로그인과 같은 제한기.
 * S2-04 API 활동 갱신이 회사 세션 설정과 무관하게 30분 · 화면 타이머는 입력만으로 연장하고 서버에 알리지 않았다.
 * R073·R300 AI 캐시 적중률이 프로세스 전역이라 모든 회사 화면에 전사 합산이 나갔다 → 회사별.
 * R252 인앱 기기 분포가 실측 없이 모바일 70·PC 30 → 가짜 지표 제거.
 * m075 차감 실패를 모두 402 잔액 부족으로 응답(DB 오류도 충전 안내) → 잔액 부족만 402.
 * R295 사용자 오류 문구의 '영역' 은어.
 * R325 고객 삭제 3종이 구매 → 동의 → 고객을 트랜잭션 없이 → 한 트랜잭션.
 * R202 days_within 기준일이 UTC 날짜 → KST.  R274 싱크 '오늘' = UTC 자정 → KST.  R411 도움말 일 한도 = UTC 날짜 → KST.
 * R111 연령 통계 연도 2026 하드코딩 → KST 현재 연도.  R199 명절 창이 2026 날짜 고정 → 그해 음력 공휴일 표에서 계산 · 2027 확정분 추가.
 * (R134 PAY 일괄 초기 비밀번호 = Harold 0720 지정 · 미사용 계정 수는 서버 측정 → Harold 확인 필요 · 코드 없음)
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { createHmac } from 'crypto';

const src = (...p: string[]) => readFileSync(join(__dirname, '..', ...p), 'utf8');
const fe = (...p: string[]) => readFileSync(join(__dirname, '..', '..', '..', '..', 'frontend', 'src', ...p), 'utf8');
const routeBody = (s: string, start: string, next = '\nrouter.') => {
  const at = s.indexOf(start);
  if (at < 0) throw new Error(`라우트를 못 찾음: ${start}`);
  const end = s.indexOf(next, at + start.length);
  return s.slice(at, end < 0 ? undefined : end);
};
afterEach(() => { vi.doUnmock('../../config/database'); vi.resetModules(); });

describe('SEC', () => {
  it('R105 문의 메일 = 방문자 입력 이스케이프', () => {
    const c = src('..', 'routes', 'companies.ts');
    const b = routeBody(c, "router.post('/inquiry'");
    for (const f of ['companyName', 'contactName', 'phone', 'email', 'planInterest', 'message']) {
      expect(b, f).toContain(`escapeHtml(${f})`);
    }
    expect(b).not.toMatch(/>\$\{message\}</);
    expect(b).not.toContain('mailto:${email}');
  });
  it('R126 상품 이미지 가져오기 = 가드 CT(연결 IP 고정) · 라우트 인라인 판정기 제거', () => {
    const r = src('..', 'routes', 'image-studio.ts');
    const b = routeBody(r, "imageStudioRouter.post('/ingest-product'", '\nimageStudioRouter.');
    expect(b).toContain('const img = await fetchImageGuarded(rawUrl);');
    expect(b).not.toContain('dns.promises.lookup');
    expect(r).not.toContain('function isPrivateIp(');
  });
  it('R342 담당자 수정 라우트·CT 제거(화면 소비처 0)', () => {
    expect(src('..', 'routes', 'sender-registration.ts')).not.toContain("router.put('/managers/:id'");
    expect(src('sender-registration.ts')).not.toContain('export async function updateManager(');
  });
  it('R372 카페24 옛 서명 = 상수 시간 비교(행동)', async () => {
    const { verifyCafe24WebhookSignature } = await import('../cafe24-client');
    const body = '{"a":1}';
    const sig = createHmac('sha256', 'sec').update(body).digest('base64');
    expect(verifyCafe24WebhookSignature(body, sig, 'sec')).toBe(true);
    expect(verifyCafe24WebhookSignature(body, sig.slice(0, -2) + 'AA', 'sec')).toBe(false);
    expect(verifyCafe24WebhookSignature(body, 'short', 'sec')).toBe(false);
    const s = src('cafe24-client.ts');
    const fn = s.slice(s.indexOf('export function verifyCafe24WebhookSignature'), s.indexOf('export function verifyCafe24WebhookApiKey'));
    expect(fn).toContain('timingSafeEqual(');
    expect(fn).not.toContain('computed === signature');
  });
  it('S2-02 비밀번호 변경 = 로그인과 같은 요청 제한기', () => {
    expect(src('..', 'routes', 'auth.ts')).toContain("router.post('/change-password', loginLimiter, async");
  });
  it('S2-04 API 활동 갱신 = 회사 세션 설정(연장 라우트와 같은 규칙) · 화면은 입력 5분마다 서버에 알림', () => {
    const m = src('..', 'middlewares', 'auth.ts');
    expect(m).toContain('NULLIF(c.session_timeout_minutes, 0)');
    expect(m).not.toContain(': 30; // 기본값, extend-session에서 정확한 값으로 갱신');
    const h = fe('hooks', 'useSessionTimeout.ts');
    expect(h).toContain('const SERVER_PING_INTERVAL_MS = 5 * 60 * 1000;');
    expect(h).toContain('if (!warningShownRef.current && Date.now() - lastServerPingRef.current > SERVER_PING_INTERVAL_MS) pingServer();');
  });
});

describe('PRIV', () => {
  it('R092 이름 가림 CT', async () => {
    const { maskPersonName } = await import('../pii-masking');
    expect(maskPersonName('홍길동')).toBe('홍**');
    expect(maskPersonName('김철')).toBe('김*');
    expect(maskPersonName('A')).toBe('*');
    expect(maskPersonName('')).toBe('');
    expect(maskPersonName(null)).toBe('');
  });
  it('R092 이탈 위험 고객 = 가린 뒤 AI·저장·응답', () => {
    const a = src('..', 'routes', 'analysis.ts');
    expect(a).toContain('collectedData.churnRiskCustomers = churnRisk.rows.map((r: any) => ({ ...r, name: maskPersonName(r.name), phone: maskPhone(r.phone) }));');
  });
  it('R203 필터 래퍼 디버그 로그 제거', () => {
    expect(src('customer-filter.ts')).not.toContain('CT-01 DEBUG');
  });
});

describe('STATS-FAKE · WORDING', () => {
  it('R073·R300 AI 캐시 통계 = 회사별(행동)', async () => {
    const c = await import('../ai-cache');
    const kA = c.generateCacheKey('co-A', 'sys', 'u1');
    c.setCachedResponse(kA, 'r', 'co-A');
    expect(c.getCachedResponse(kA, 'co-A')).toBe('r');
    expect(c.getCachedResponse(c.generateCacheKey('co-A', 'sys', 'u2'), 'co-A')).toBeNull();
    expect(c.getCachedResponse(c.generateCacheKey('co-B', 'sys', 'u3'), 'co-B')).toBeNull();
    const a = c.getCacheStats('co-A');
    const b = c.getCacheStats('co-B');
    expect(a).toEqual({ size: 1, hit: 1, miss: 1, hitRate: 0.5 });
    expect(b).toEqual({ size: 0, hit: 0, miss: 1, hitRate: 0 });
  });
  it('R073·R300 회사 화면 3곳이 자기 회사 몫만', () => {
    const u = src('..', 'routes', 'ai-usage.ts');
    expect((u.match(/getCacheStats\(companyId\)/g) || []).length).toBe(2);
    const ai = src('..', 'routes', 'ai.ts');
    expect(ai).toContain('const cache = getCacheStats(companyId);');
    const svc = src('..', 'services', 'ai.ts');
    expect(svc).toMatch(/getCachedResponse\(cacheKey, params\.companyId\)/);
    expect(svc).toMatch(/setCachedResponse\(cacheKey, [^,]+, params\.companyId\)/);
  });
  it('R252 인앱 기기 분포 = 실측이 없으면 비운다(가짜 70·30 제거) · 화면은 있을 때만', async () => {
    const f = src('inapp-funnel-stats.ts');
    expect(f).not.toContain('0.7)');
    const p = fe('pages', 'InAppMessagesPage.tsx');
    expect(p).toContain('{stats.device.length > 0 && (');
    expect(p).not.toContain('추정 분포');
  });
  it('m075 차감 실패 응답 CT = 잔액 부족만 402', async () => {
    const { deductFailureHttp } = await import('../prepaid');
    expect(deductFailureHttp({ ok: false, error: '잔액이 부족합니다', insufficientBalance: true, balance: 10, amount: 20 }))
      .toEqual({ status: 402, body: { error: '잔액이 부족합니다', insufficientBalance: true, balance: 10, requiredAmount: 20 } });
    expect(deductFailureHttp({ ok: false, error: '차감 처리 중 오류가 발생했습니다' }))
      .toEqual({ status: 500, body: { error: '차감 처리 중 오류가 발생했습니다', insufficientBalance: false, balance: undefined, requiredAmount: undefined } });
    const c = src('..', 'routes', 'campaigns.ts');
    expect(c).not.toContain('insufficientBalance: true');
    expect((c.match(/deductFailureHttp\(/g) || []).length).toBe(5);
  });
  it("R295 사용자 문구 '영역' 0", () => {
    const ai = src('..', 'routes', 'ai.ts');
    const lines = ai.split('\n').filter((l) => /영역/.test(l) && !/^\s*(\/\/|\*|\/\*)/.test(l) && !/\/\/.*영역/.test(l));
    expect(lines).toEqual([]);
  });
});

describe('TX · TZ · YEAR', () => {
  it('R325 고객 삭제 3종 = 한 트랜잭션', () => {
    const c = src('..', 'routes', 'customers.ts');
    for (const r of ["router.delete('/:id', blockIfSyncActive", "router.post('/bulk-delete'", "router.post('/delete-all'"]) {
      const b = routeBody(c, r);
      expect(b, r).toContain("await client.query('BEGIN');");
      expect(b, r).toContain("await client.query('COMMIT');");
      expect(b, r).toContain("await client.query('ROLLBACK')");
      expect(b, r).not.toMatch(/await query\('DELETE FROM (purchases|consents|customers)/);
    }
  });
  it('R202 days_within 기준일 = KST', () => {
    const f = src('customer-filter.ts');
    expect(f).not.toContain("daysAgo.toISOString().split('T')[0]");
    expect((f.match(/kstDateMinusDays\(new Date\(\), days\)/g) || []).length).toBe(2);
  });
  it('R274 싱크 오늘 = KST 0시 CT', () => {
    const s = src('..', 'routes', 'admin-sync.ts');
    expect(s).not.toContain('started_at >= CURRENT_DATE');
    // 차수 3 R063 — 시각 폴백(COALESCE(started_at, completed_at))으로 바뀌어도 오늘 경계는 KST CT 두 곳
    expect((s.match(/COALESCE\(started_at, completed_at\) >= \$\{KST_TODAY_START_SQL\}/g) || []).length).toBe(2);
    expect(src('stats-aggregation.ts')).toContain("export const KST_TODAY_START_SQL = `(date_trunc('day', NOW() AT TIME ZONE 'Asia/Seoul') AT TIME ZONE 'Asia/Seoul')`;");
  });
  it('R411 도움말 일 한도 = KST 자정 초기화(행동)', async () => {
    const h = await import('../help-answer');
    h.resetHelpQuota();
    // KST 23:xx(= UTC 14:xx)에 일 한도를 채운다 — 분 한도(3)를 피해 분마다 3건
    let t = Date.parse('2026-09-27T14:00:00Z');
    for (let i = 0; i < h.HELP_DAILY_LIMIT; i++) {
      expect(h.takeHelpQuota('co-q', new Date(t + Math.floor(i / h.HELP_MINUTE_LIMIT) * 60_000))).toBe(true);
    }
    expect(h.takeHelpQuota('co-q', new Date('2026-09-27T14:59:00Z'))).toBe(false);   // KST 23:59 = 아직 같은 날
    expect(h.takeHelpQuota('co-q', new Date('2026-09-27T15:01:00Z'))).toBe(true);    // KST 00:01 = 다음 날
    h.resetHelpQuota();
  });
  it('R111 연령 통계 = KST 현재 연도', () => {
    const c = src('..', 'routes', 'customers.ts');
    expect(c).not.toContain('(2026 - c.birth_year)');
    expect((c.match(/\(\$\{KST_CURRENT_YEAR_SQL\} - c\.birth_year\)/g) || []).length).toBe(6);
  });
  it('R199 명절 창 = 그해 음력 공휴일 표 · 2027 확정분 · 표에 없는 해는 명절 문맥 없음(행동)', async () => {
    const { buildIndustryEvents, buildTemporalContext } = await import('../copy-context');
    const kst = (s: string) => new Date(`${s}T12:00:00+09:00`);
    const seollal = (d: string) => buildIndustryEvents(null, kst(d)).find((e) => e.key === 'lunar_new_year');
    expect(seollal('2026-02-12')?.window).toBe('02-10~02-18');          // 2026 = 종전 창과 같다
    expect(buildIndustryEvents(null, kst('2026-09-20')).find((e) => e.key === 'chuseok')?.window).toBe('09-18~09-26');
    expect(seollal('2027-02-01')?.window).toBe('01-31~02-08');          // 2027 설 = 02-06~02-08
    expect(seollal('2027-02-12')).toBeUndefined();                      // 옛 고정 창(02-10~02-18)은 여기서 설이라 했다
    expect(seollal('2028-01-25')).toBeUndefined();                      // 확정 전 해 = 만들지 않는다
    expect(buildTemporalContext(kst('2027-09-15')).holiday).toBe('추석');
    expect(buildTemporalContext(kst('2027-05-13')).holiday).toBe('부처님오신날');
  });
});
