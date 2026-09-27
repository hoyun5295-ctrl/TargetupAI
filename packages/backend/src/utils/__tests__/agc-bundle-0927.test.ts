/**
 * 대행 충전·대행 발송 (★ 2026-09-27 한줄로 V2 차수 1 AGC 묶음)
 *
 * m013 발송 번호(SeqNo) 없이 「실반영 확인」으로 해소한 충전 요청의 주문이 대사 대상에서 빠져 '처리 중'에 영영 남았다
 *      → 해소 시점에 사람이 실반영을 확인했으니 그 주문을 완료로 넘긴다(번호가 있으면 종전대로 대사 워커가 넘긴다).
 * m014 대사 워커가 늘 가장 오래된 20건만 봐, 끝내 반영 안 되는 요청 20건이 쌓이면 뒤 요청이 영영 확인되지 않았다 → 순환 커서.
 * m015 링크 승인이 발송ID가 지금도 주문 회사 소유인지 보지 않았다(매핑이 바뀌면 다른 회사 지갑 충전) → 주문 선점 조건에 소유 대조.
 * m018 이메일 접수는 커밋 뒤 1차 검사를 깨우지 않아 다음 워커 주기(최대 5분)까지 밀렸다 → 커밋 뒤 건마다 kick.
 * m020 배관 거절(잔액 부족 등) 뒤 만료까지 매 주기 명단 전체를 다시 썼다 → 방금(10분 안) 거절된 건은 그 사이 건너뛴다.
 * m023 한 통도 적재 안 된 실패 캠페인도 「나갔을 수 있음」이라 취소 안내가 「이미 발송」으로 틀렸다 → 적재 0이면 제외.
 * m025 1차 검사 묶음을 순서대로 처리해 뒤 행의 선점 시각이 낡았다(30분 회수로 재실행 · 테스트 중복) → 행마다 선점 갱신.
 * R286 접수 목록이 100건 고정이었다 → 건너뛰기·전체 건수 · 화면은 「이전 접수 더 불러오기」.
 * R355 스팸 통과 뒤 승인 기한이 이미 지났는지 보기 전에 담당자 테스트 문자를 먼저 보냈다 → 기한 판정을 앞으로.
 * R151 메일함 누적(지우지 않음)은 보관 기간 결정(되돌릴 수 없는 삭제)이라 이 묶음에서 코드를 넣지 않는다(Harold 확인 필요).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const src = (...p: string[]) => readFileSync(join(__dirname, '..', ...p), 'utf8');
const admin = src('..', 'routes', 'admin.ts');
const reconciler = src('agent-charge-reconciler.ts');
const core = src('agent-charge-core.ts');
const mail = src('agency-send-mail-worker.ts');
const worker = src('agency-send-worker.ts');
const route = src('..', 'routes', 'agency-send.ts');

describe('m013 번호 없는 실반영 확인 = 해소 때 주문 완료', () => {
  it('확인 해소면서 번호가 없으면 주문을 완료로 — 해소 전이와 한 트랜잭션(Codex AGC 1R)', () => {
    const at = admin.indexOf("const next = outcome === 'confirmed' ? 'registered' : 'not_applied';");
    const body = admin.slice(at, admin.indexOf('불확실 해소 ${requestId}', at));
    expect(body).toContain("const fulfillHere = next === 'registered' && !chargesHaveSeqNo(rowCharges);");
    const iBegin = body.indexOf("await resolveClient.query('BEGIN');");
    const iReq = body.indexOf('UPDATE agent_charge_requests');
    const iOrd = body.indexOf('UPDATE agent_charge_orders');
    const iCommit = body.indexOf("await resolveClient.query('COMMIT');");
    expect(iBegin).toBeGreaterThan(-1);
    expect(iBegin).toBeLessThan(iReq);
    expect(iReq).toBeLessThan(iOrd);
    expect(iOrd).toBeLessThan(iCommit);
  });
});

describe('m014 대사 워커 순환 커서', () => {
  it('지난 틱이 본 자리 뒤부터 보고, 끝에 닿으면 처음으로', async () => {
    expect(reconciler).toContain('(r.created_at, r.id) > ($2::timestamptz, $3::uuid)');
    expect(reconciler).toContain('ORDER BY r.created_at ASC, r.id ASC');
    const { nextReconcileCursor } = await import('../agent-charge-reconciler');
    const rows = [{ id: 'a', created_at: new Date('2026-09-01T00:00:00Z') }, { id: 'b', created_at: new Date('2026-09-02T00:00:00Z') }];
    expect(nextReconcileCursor(rows, 2)).toEqual({ createdAt: '2026-09-02T00:00:00.000Z', id: 'b' });
    expect(nextReconcileCursor(rows, 20)).toBeNull();   // 한 틱 상한보다 적게 나왔다 = 끝 → 처음부터
  });
});

describe('m015 링크 승인 = 발송ID가 지금도 주문 회사 소유일 때만', () => {
  it('주문 선점 UPDATE가 회사 소유를 대조한다(아니면 선점 실패 → 전체 롤백)', () => {
    const claim = core.slice(core.indexOf('UPDATE agent_charge_orders'), core.indexOf('if ((claimed.rowCount ?? 0) !== orderIds.length) {'));
    expect(claim).toMatch(/AND EXISTS \(\s*SELECT 1 FROM company_agent_ids cai\s+WHERE cai\.agent_send_id = agent_charge_orders\.agent_send_id\s+AND cai\.company_id = agent_charge_orders\.company_id\s*\)/);
  });
});

describe('m018 이메일 접수 커밋 뒤 1차 검사 즉시', () => {
  it('커밋(COMMIT) 뒤 접수 건마다 kick', () => {
    const iCommit = mail.indexOf("await txClient.query('COMMIT');");
    const iKick = mail.indexOf('for (const r of requestRows) kickFirstTest(r.id);');
    expect(iKick).toBeGreaterThan(iCommit);
    expect(mail).toMatch(/kickFirstTest,?[\s\S]{0,200}from '\.\/agency-send-intake'/);
  });
});

describe('m020 방금 거절된 건은 10분 동안 다시 쓰지 않는다', () => {
  it('당일 재검사·적재 후보에서 최근 dispatch_retry 건을 뺀다', () => {
    const at = worker.indexOf('async function runFinalTest(');
    const body = worker.slice(at, worker.indexOf('async function finalTestRow(', at));
    expect(body).toContain("AND NOT EXISTS (SELECT 1 FROM agency_send_events e WHERE e.request_id = agency_send_requests.id AND e.kind = 'dispatch_retry' AND e.created_at > NOW() - ($");
    expect(worker).toContain('const DISPATCH_RETRY_BACKOFF_MINUTES = 10;');
  });
});

describe('m023 적재 0인 실패 캠페인은 「나갔을 수 있음」이 아니다', () => {
  it('판정 CT', async () => {
    const { campaignMayHaveSent } = await import('../agency-send-campaign');
    expect(campaignMayHaveSent({ id: 'c', phase: 'failed', sent: 0 })).toBe(false);
    expect(campaignMayHaveSent({ id: 'c', phase: 'failed', sent: 3 })).toBe(true);
    expect(campaignMayHaveSent({ id: 'c', phase: 'failed', sent: null })).toBe(true);   // 모르면 나갔을 수 있음(보수)
    expect(campaignMayHaveSent({ id: 'c', phase: 'preparing', sent: null })).toBe(false);
    expect(campaignMayHaveSent({ id: null, phase: null, sent: null })).toBe(false);
  });
  it('캠페인 조회 두 곳이 적재 수를 함께 읽는다', () => {
    const c = src('agency-send-campaign.ts');
    expect(c).toContain('SELECT id, status, send_phase, sent_count FROM campaigns');
    expect(worker).toContain('SELECT id, status, send_phase, sent_count FROM campaigns');
  });
});

describe('m025 1차 검사 행마다 선점 갱신', () => {
  it('처리 직전에 소유권 조건으로 lock_at을 새로 찍고, 잃었으면 건너뛴다', () => {
    const at = worker.indexOf('for (const row of picked.rows) {');
    const loop = worker.slice(at, worker.indexOf('const { passed, finalContent, rounds, detail } = await runSpamRound(row, 0);', at));
    expect(loop).toContain('if (!(await touchTestingLock(row.id, token))) continue;');
    expect(worker).toMatch(/UPDATE agency_send_requests SET lock_at = NOW\(\)\s+WHERE id = \$1::uuid AND lock_token = \$2::uuid AND status = 'testing'/);
  });
});

describe('R286 접수 목록 건너뛰기 · 전체 건수', () => {
  it('서버가 offset·limit(최대 100)을 받고 total을 돌려준다', () => {
    const at = route.indexOf("router.get('/', async");
    const body = route.slice(at, route.indexOf("router.post('/', async", at));
    expect(body).toContain('LIMIT $3 OFFSET $4');
    expect(body).toContain('SELECT COUNT(*)::int AS n FROM agency_send_requests');
    expect(body).toContain('total,');
  });
  it('화면은 이전 접수를 더 불러온다', () => {
    const page = readFileSync(join(__dirname, '..', '..', '..', '..', 'frontend', 'src', 'pages', 'AgencySendPage.tsx'), 'utf8');
    const api = readFileSync(join(__dirname, '..', '..', '..', '..', 'frontend', 'src', 'components', 'agency', 'agency-send-api.ts'), 'utf8');
    expect(api).toContain('export async function fetchAgencyRequests(offset = 0): Promise<{ requests: AgencySendRequest[]; total: number }>');
    expect(page).toContain('이전 접수 더 불러오기');
    expect(page).toContain('fetchAgencyRequests(requests.length)');
  });
});

describe('R355 승인 기한 판정이 테스트 문자보다 앞', () => {
  it('기한이 지났으면 테스트 문자·맞춤법 검사를 하지 않는다', () => {
    const at = worker.indexOf("await logEvent(row.id, 'awaiting_approval', { rounds, sameDaySend });");
    const iExpired = worker.indexOf("if (isApprovalExpired('awaiting_approval', new Date(row.requested_at), passedAt, sameDaySend ? passedAt : null)) {", at);
    const iTest = worker.indexOf('await sendManagerTest({', at);
    const iSpell = worker.indexOf('await runAgencySpellAfterTest({', at);
    expect(iExpired).toBeGreaterThan(at);
    expect(iExpired).toBeLessThan(iTest);
    expect(iExpired).toBeLessThan(iSpell);
  });
});
