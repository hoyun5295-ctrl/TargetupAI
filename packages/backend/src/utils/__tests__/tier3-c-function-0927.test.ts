/**
 * 차수 3 ③ 기능 고장 (★ 2026-09-27 한줄로 V2)
 *
 * R071 슈퍼관리자 알림톡 템플릿 수동 등록이 소문자 'approved'로 INSERT → 대문자 CHECK에 늘 실패 → 'APPROVED'.
 *      (같은 라우트군 승인·반려는 화면이 쓴다 → "frontend 미사용(dead)" 주석 정정. reviewed_by는 FK 대상 확인 뒤 = M-46)
 * R192 크레딧 부족 정지 운영자를 워커가 매분 고르지만 로더가 active만 읽어 null → 자동 재개 코드에 영영 못 닿음 → 로더가 둘 다 읽는다.
 * R194 다음 회차 생성이 같은 운영자의 admin_review를 전부 만료 → 스팸 검증 대기 리마인드가 조용히 사라짐 → 리마인드 제외.
 * R090 분석 캐시 적중 때 collected_data를 안 읽어 차트가 사라짐 → 칸 추가.
 * R273 여정 목록이 통계 응답을 data.steps로 읽어(실제 { success, stats }) 스텝 통계가 안 나옴 → data.stats.steps.
 * R404 섹션 없는 직접 HTML 이메일은 {{ customer.X }}를 치환하지 않고 지워 문장이 끊김 → 고객 데이터로 치환(수신거부 마커 보존) 뒤 잔여만 제거.
 * R231 예약 이메일 선점 뒤 수신자 해석 예외 = sending에 멈췄다가 30분 뒤 failed · 재시도 없음 → 예약으로 되돌려 다음 주기 재시도(1시간 지나면 failed).
 * R067 · R130 발신번호 등록이 대표번호를 먼저 해제한 뒤 회선 상한 검사 → 거절되면 대표번호 0 → 상한 검사 먼저 · 해제와 등록은 한 트랜잭션.
 * R280 슈퍼관리자 발신번호 수정이 정규화·중복·회선 상한 없이 번호를 저장 → 번호가 바뀔 때 등록과 같은 검사.
 * R271 싱크 [설정] 창이 60/30 고정값으로 열려 저장하면 실제 주기를 덮음 → 행의 실제 주기로 연다.
 * R065 에이전트 삭제 방지가 30분 고정(하트비트 기본 60분) → 목록 화면과 같은 온라인 판정으로 offline일 때만 삭제.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const src = (...p: string[]) => readFileSync(join(__dirname, '..', ...p), 'utf8');
const between = (s: string, a: string, b: string) => {
  const i = s.indexOf(a);
  if (i < 0) throw new Error(`못 찾음: ${a}`);
  const j = s.indexOf(b, i + a.length);
  return s.slice(i, j < 0 ? undefined : j);
};

describe('R071 알림톡 템플릿 수동 등록', () => {
  it('대문자 상태로 INSERT · 죽은 라우트 주석 정정', () => {
    const a = src('..', 'routes', 'admin.ts');
    const b = between(a, "router.post('/kakao-templates/manual'", '\nrouter.');
    expect(b).toContain("'APPROVED',NOW(),NOW(),$16,NOW()");
    expect(b).not.toContain("'approved',NOW()");
    expect(a).not.toContain('본 라우트는 frontend 미사용(dead)');
  });
});

describe('R192 · R194 운영자', () => {
  it('제안 생성 로더가 크레딧 부족 정지 운영자도 읽는다(자동 재개 도달)', () => {
    const o = src('continuous-operator.ts');
    const b = between(o, 'export async function generateProposalForOperator(', 'const operator = mapRowToOperator(');
    expect(b).toContain("WHERE o.id = $1::uuid AND o.status IN ('active', 'paused_no_credit')");
  });
  it('정지 운영자는 발송 크레딧이 있을 때만 재개(생성은 무과금이라 잔액 확인 없이는 부족한 채 살아난다)', () => {
    const o = src('continuous-operator.ts');
    const b = between(o, 'const operator = mapRowToOperator(operRes.rows[0]);', '// ★ 2026-09-26 한줄로 V2 R1-24');
    expect(b).toContain("if (operator.status === 'paused_no_credit'");
    expect(b).toContain("&& !(await hasCreditForStrict(operator.companyId, getCreditCost('continuous-operator-send'), 'continuous-operator-send'))) {");
    expect(b).toContain('await updateOperatorAfterRun(operator.id, operator.schedule, operator.scheduleTime, 0);');
    expect(b).not.toContain('checkCredit(');
  });
  it('엄격 확인 = 실제 차감과 같은 허용 한도 · 조회 실패는 던진다(Codex 차수3 1R)', async () => {
    const tx = src('ai-credit-tx.ts');
    expect(tx).toContain('export function creditOverageAllowance(row: any, source: string): number {');
    expect(tx).toContain('const overageAllowed = creditOverageAllowance(row, opts.source);');
    expect(tx).toContain('export function carriedBaseOnReset(row: any): number {');
    expect(tx).toContain('const carriedBase = carriedBaseOnReset(row);');
    const c = src('ai-credit.ts');
    const b = between(c, 'export async function hasCreditForStrict(', '\n}\n');
    expect(b).toContain('const row = await loadCreditRow(pool, companyId, false);');
    expect(b).not.toContain('catch');
    expect(b).toContain('return (base + purchased) - cost >= -creditOverageAllowance(row, source);');
    const { creditOverageAllowance, carriedBaseOnReset } = await import('../ai-credit-tx');
    // 운영 과금 = 한 달 기본분까지 음수 허용 · 그 외 = 후불 한도(선불 0)
    expect(creditOverageAllowance({ plan_credits: 100, billing_type: 'postpaid', overage_limit: 1000 }, 'continuous-operator-send')).toBe(100);
    expect(creditOverageAllowance({ plan_credits: 100, billing_type: 'postpaid', overage_limit: 1000 }, 'ai-operator-explain')).toBe(1000);
    expect(creditOverageAllowance({ plan_credits: 100, billing_type: 'prepaid', overage_limit: 1000 }, 'ai-operator-explain')).toBe(0);
    // 월 리셋 = 기본분 + (선불만) 지난달 음수 상계
    expect(carriedBaseOnReset({ plan_credits: 100, base: -30, billing_type: 'prepaid' })).toBe(70);
    expect(carriedBaseOnReset({ plan_credits: 100, base: -30, billing_type: 'postpaid' })).toBe(100);
    expect(carriedBaseOnReset({ plan_credits: 100, base: 40, billing_type: 'prepaid' })).toBe(100);
  });
  it('다음 회차 생성의 미처리 만료가 리마인드를 건드리지 않는다', () => {
    const o = src('continuous-operator.ts');
    const b = between(o, "`UPDATE operator_proposals SET status = 'expired'\n      WHERE operator_id = $1::uuid", ']');
    expect(b).toContain("AND COALESCE(proposal_json->'meta'->>'is_reminder', 'false') <> 'true'");
  });
});

describe('R090 분석 캐시', () => {
  it('캐시 조회가 수집 데이터를 함께 읽는다', () => {
    const a = src('..', 'routes', 'analysis.ts');
    expect(a).toContain('SELECT id, insights, collected_data, created_at');
  });
});

describe('R273 여정 목록 스텝 통계', () => {
  it('응답의 stats.steps를 읽는다', () => {
    const j = readFileSync(join(__dirname, '..', '..', '..', '..', 'frontend', 'src', 'pages', 'JourneysPage.tsx'), 'utf8');
    const b = between(j, 'const loadStats = async (journeyId: string) => {', '\n  };');
    expect(b).toContain('const steps = data?.stats?.steps;');
    expect(b).toContain('if (data.success && Array.isArray(steps)) {');
    expect(b).not.toContain('data.steps');
  });
});

describe('R404 직접 HTML 이메일 고객 변수', () => {
  it('고객 변수 렌더가 값 삽입보다 먼저 · HTML엔 이스케이프 사본 · 제목·텍스트는 원문', () => {
    const e = src('email-channel.ts');
    const b = between(e, "const keepKeys = ['이름', UNSUB_URL_MARKER.slice(2, -2), ...Object.keys(recipient.substitutions || {})];", 'personalizedHtml = applyTracking(');
    expect(b).toContain('personalizedHtml = renderEmailTextKeepingTokens(finalHtml, escapeCustomerForHtml(recipient.customer), keepKeys);');
    expect(b).toContain('personalizedSubject = renderEmailTextKeepingTokens(finalSubject, recipient.customer, keepKeys);');
    expect(b).toContain('personalizedHtml = personalizedHtml.replace(/\\{\\{\\s*이름\\s*\\}\\}/g, escapeEmailText(nameForToken));');
    // 렌더(값 삽입 전) → substitutions → {{이름}} 순서
    expect(b.indexOf('renderEmailTextKeepingTokens(finalHtml')).toBeLessThan(b.indexOf('if (recipient.substitutions) {'));
    expect(b.indexOf('if (recipient.substitutions) {')).toBeLessThan(b.indexOf('escapeEmailText(nameForToken)'));
  });
  it('남길 토큰을 지키며 렌더(행동) — 넣을 자리는 남고 고객 변수만 렌더', async () => {
    const { renderEmailTextKeepingTokens } = await import('../email/email-personalization');
    const out = renderEmailTextKeepingTokens('{{이름}}님 {{ customer.grade }} 등급 {{__hanjul_unsub_url__}}', { grade: 'VIP' }, ['이름', '__hanjul_unsub_url__']);
    expect(out).toBe('{{이름}}님 VIP 등급 {{__hanjul_unsub_url__}}');
  });
});

describe('R231 예약 이메일 수신자 해석 예외', () => {
  it('예약으로 되돌려 다음 주기 재시도 · 1시간 지나면 failed', () => {
    const s = src('email-send-sweeper.ts');
    const b = between(s, 'let recipients: EmailRecipient[] = [];', 'if (recipients.length === 0) {');
    expect(b).toContain('recipients = await resolveRecipients(companyId, spec, row.created_by || null);');
    expect(b).toContain("SET status = CASE WHEN scheduled_at < NOW() - INTERVAL '1 hour' THEN 'failed' ELSE 'scheduled' END");
    expect(b).toContain("WHERE id = $1::uuid AND status = 'sending'");
    expect(b).toContain('continue;');
    // 되돌린 행이 가장 오래된 5칸을 차지해 정상 예약을 막지 않게 — 재시도 행은 뒤로(Codex 차수3 1R)
    expect(s).toContain("ORDER BY COALESCE(updated_at > scheduled_at AND updated_at > NOW() - INTERVAL '2 minutes', false) ASC, scheduled_at ASC LIMIT 5");
  });
});

describe('R067 · R130 발신번호 등록 순서', () => {
  const check = (b: string, label: string) => {
    const limitAt = b.indexOf('checkSenderLineLimit(');
    const unsetAt = b.indexOf('SET is_default = false');
    expect(limitAt, label).toBeGreaterThan(0);
    expect(unsetAt, label).toBeGreaterThan(limitAt);
    expect(b, label).toContain("await client.query('BEGIN');");
    expect(b, label).toContain("await client.query('COMMIT');");
    expect(b, label).toContain("await client.query('ROLLBACK')");
  };
  it('슈퍼관리자', () => {
    const a = src('..', 'routes', 'admin.ts');
    check(between(a, "router.post('/callback-numbers',", '\nrouter.'), 'admin');
  });
  it('고객사', () => {
    const m = src('..', 'routes', 'manage-callbacks.ts');
    check(between(m, "router.post('/',", '\nrouter.'), 'manage');
  });
});

describe('R280 슈퍼관리자 발신번호 수정', () => {
  it('번호가 바뀌면 형식·중복(자기 제외)·회선 종류가 바뀔 때 상한', () => {
    const a = src('..', 'routes', 'admin.ts');
    const b = between(a, "router.put('/callback-numbers/:id',", '\nrouter.');
    expect(b).toContain('if (nextNormalized !== normalizePhone(String(cur.phone))) {');
    expect(b).toContain('if (nextNormalized.length < 8 || nextNormalized.length > 11) {');
    expect(b).toContain("AND regexp_replace(phone, '\\\\D', '', 'g') = $2 AND id <> $3");
    expect(b).toContain('if (lineKindOf(phone) !== lineKindOf(cur.phone)) {');
    expect(b).toContain("if (error?.code === '23505') {");
    // 빈 번호로 덮어쓰기 금지(Codex 차수3 1R) — 생략(null·undefined)만 기존 번호 유지
    expect(b).toContain("if (phone !== undefined && phone !== null && String(phone).trim() === '') {");
  });
});

describe('R271 · R065 싱크 에이전트 관리', () => {
  it('설정 창은 행의 실제 주기로 연다(목록이 구매 주기도 내려준다)', () => {
    const s = src('..', 'routes', 'admin-sync.ts');
    expect(s).toContain('sync_interval_purchases_min: intervals.purchasesMin,');
    const d = readFileSync(join(__dirname, '..', '..', '..', '..', 'frontend', 'src', 'pages', 'AdminDashboard.tsx'), 'utf8');
    expect(d).not.toContain('setSyncConfigForm({ sync_interval_customers: 60, sync_interval_purchases: 30 });');
    expect(d).toContain('sync_interval_customers: Number(agent.sync_interval_customers_min) || 60,');
    expect(d).toContain('sync_interval_purchases: Number(agent.sync_interval_purchases_min) || 30,');
  });
  it('삭제 방지 = 목록과 같은 온라인 판정(offline일 때만)', () => {
    const s = src('..', 'routes', 'admin-sync.ts');
    const b = between(s, "router.delete('/agents/:agentId'", '\nrouter.');
    expect(b).toContain('const liveStatus = getOnlineStatus(agent.last_heartbeat_at, agent.last_sync_at, resolveAgentIntervals(agent.config, agent));');
    expect(b).toContain("if (!force && liveStatus !== 'offline') {");
    expect(b).not.toContain('minutesSinceHeartbeat < 30');
  });
});
