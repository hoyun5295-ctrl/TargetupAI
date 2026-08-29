/**
 * 충전 승인 문자 링크 계약 (★2026-08-28(3) Harold 지시 · 돈 축)
 *
 *   ① 토큰 = 전용 파생 키 + scope + kind. 대행발송 승인 토큰으로 충전을 승인할 수 없고 역방향도 안 된다.
 *   ② 승인 효과는 입구가 몇 개든 CT 한 벌 — 라우트에 인라인 트랜잭션이 되살아나면 빨간불.
 *      (무통장 = deposit-approve.ts의 FOR UPDATE 트랜잭션 · 에이전트 = agent-charge-core.ts의 Codex 7R~12R 본문)
 *   ③ 링크가 못 하는 것: 거절 · held(명의 확인) 건 승인 · uncertain 해소 — 전부 관리 화면 소유.
 *   ④ 링크의 멱등: 에이전트 = `order:<id>` 고정 키(재클릭·재문자 = 중복 차단) · 무통장 = FOR UPDATE + pending 게이트.
 *   ⑤ ENV 수신 목록이 곧 권한 목록 — 번호를 빼면 이미 나간 링크도 죽는다.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import {
  signChargeApproveToken, verifyChargeApproveToken, getChargeApprovalPhones,
  buildChargeApproveUrl, oneLineField, CHARGE_APPROVE_TOKEN_HEADER,
} from '../charge-approve-link';
import { signAgencyApproveToken } from '../agency-send-link';

const read = (p: string) => fs.readFileSync(path.resolve(__dirname, p), 'utf8');

describe('토큰 — 전용 키·scope·kind (돈 승인권의 경계)', () => {
  it('서명·검증 왕복이 된다 (kind·대상·번호 보존)', () => {
    const t = signChargeApproveToken({ kind: 'deposit', targetId: 'req-1', phone: '01000000001' });
    expect(verifyChargeApproveToken(t)).toEqual({ kind: 'deposit', targetId: 'req-1', phone: '01000000001' });
    const t2 = signChargeApproveToken({ kind: 'agent_order', targetId: 'ord-1', phone: '01000000002' });
    expect(verifyChargeApproveToken(t2)?.kind).toBe('agent_order');
  });

  it('대행발송 승인 토큰으로는 충전을 승인할 수 없다 (파생 키·scope가 다르다)', () => {
    const agency = signAgencyApproveToken({
      requestId: 'req-1', phone: '01000000001', contentVersion: 1, requestedAt: new Date(Date.now() + 3600_000),
    });
    expect(verifyChargeApproveToken(agency)).toBeNull();
  });

  it('변조·빈 토큰은 거절된다', () => {
    const t = signChargeApproveToken({ kind: 'deposit', targetId: 'req-1', phone: '01000000001' });
    expect(verifyChargeApproveToken(t.slice(0, -3) + 'abc')).toBeNull();
    expect(verifyChargeApproveToken('')).toBeNull();
  });

  it('랜딩 주소의 토큰은 fragment(#t=)에 실린다 — 접근 로그에 승인권이 남지 않는다', () => {
    const url = buildChargeApproveUrl('deposit', 'req-1', '01000000001');
    expect(url).toContain('/charge-approve#t=');
    expect(url).not.toContain('?t=');
  });
});

describe('ENV 수신 목록 = 권한 목록', () => {
  const KEY = 'CHARGE_APPROVAL_NOTIFY_PHONES';
  let saved: string | undefined;
  beforeEach(() => { saved = process.env[KEY]; });
  afterEach(() => { if (saved === undefined) delete process.env[KEY]; else process.env[KEY] = saved; });

  it('쉼표 구분·서식 혼용을 휴대폰 번호만으로 정규화한다 (중복·비번호 제거)', () => {
    process.env[KEY] = '010-0000-0001, 01000000002,없는번호,01000000001,010-0000-0001';
    expect(getChargeApprovalPhones()).toEqual(['01000000001', '01000000002']);
  });

  it('미설정 = 빈 목록 (문자 0 · 링크 입구 0)', () => {
    delete process.env[KEY];
    expect(getChargeApprovalPhones()).toEqual([]);
  });
});

describe('승인 효과는 CT 한 벌 (인라인 부활 금지)', () => {
  const admin = read('../../routes/admin.ts');

  it('무통장 승인 라우트에 트랜잭션 인라인이 되살아나지 않았다', () => {
    const seg = admin.slice(
      admin.indexOf("router.put('/deposit-requests/:id/approve'"),
      admin.indexOf('deposit_hold_resolved'),
    );
    expect(seg, '라우트가 CT를 부르지 않는다').toMatch(/approveDepositRequestTx\(/);
    expect(seg, '잔액 UPDATE가 라우트에 되살아났다').not.toMatch(/SET balance = balance \+/);
    expect(seg, '원장 INSERT가 라우트에 되살아났다').not.toMatch(/INSERT INTO balance_transactions/);
  });

  it('무통장 승인 CT는 0819 Codex 계약(FOR UPDATE 한 트랜잭션)을 그대로 갖는다', () => {
    const ct = read('../deposit-approve.ts');
    for (const key of ['FOR UPDATE', "'deposit_charge'", 'HOLD_CONFIRMATION_REQUIRED', "SET status = 'confirmed'", 'BEGIN']) {
      expect(ct, `deposit-approve CT에서 ${key}가 사라졌다`).toContain(key);
    }
    expect(ct, '링크 승인은 어느 번호가 눌렀는지 원장에 남긴다').toMatch(/링크 승인 \$\{opts\.linkPhone/);
  });

  it('에이전트 실행 라우트에 코어 로직이 되살아나지 않았다 (어댑터만 남는다)', () => {
    const seg = admin.slice(
      admin.indexOf("router.post('/agent-charges', authenticate"),
      admin.indexOf('// 반영 불확실 해소'),
    );
    expect(seg).toMatch(/executeAgentChargeBatch\(/);
    for (const key of ['pg_advisory_xact_lock', 'chargeCommitUncertain', '200_000_000', 'insertAgentCharges(']) {
      expect(seg, `코어 로직(${key})이 라우트에 되살아났다`).not.toContain(key);
    }
    // 응답 형태는 이동 전과 문자 동일(프론트 무변경 근거)
    for (const key of ['duplicated: true', 'uncertain: true', 'uncertainRequests: outcome.uncertainRequests']) {
      expect(seg, `어댑터 응답 형태(${key})가 깨졌다`).toContain(key);
    }
  });

  it('에이전트 코어 CT는 Codex 7R~12R 계약 문자열을 그대로 갖는다', () => {
    const ct = read('../agent-charge-core.ts');
    for (const key of [
      'pg_advisory_xact_lock', 'ON CONFLICT (idempotency_key) DO NOTHING', 'chargeCommitUncertain',
      "SET status = 'uncertain'", 'agent-charge-uncertain:', 'agent-charge-high:',
      "SET status = 'processing', charge_request_id", '200_000_000',
    ]) {
      expect(ct, `agent-charge-core CT에서 ${key}가 사라졌다`).toContain(key);
    }
  });
});

describe('링크 라우트 게이트 (routes/charge-approve.ts)', () => {
  const route = read('../../routes/charge-approve.ts');

  it('토큰은 헤더로만 받고, 번호가 지금도 ENV 목록에 있어야 한다', () => {
    expect(route).toMatch(/CHARGE_APPROVE_TOKEN_HEADER/);
    expect(route, 'ENV 재검증이 없으면 뺀 번호의 링크가 계속 산다').toMatch(/getChargeApprovalPhones\(\)\.includes\(payload\.phone\)/);
    expect(CHARGE_APPROVE_TOKEN_HEADER).toBe('x-charge-approve-token');
  });

  it('명의 확인 보류(held) 건은 링크로 승인되지 않는다 (전송자격인증 2.3)', () => {
    expect(route).toMatch(/held_reason/);
    expect(route).toMatch(/소명 확인 후 관리 화면에서/);
    expect(route, '링크 입구가 resolveHold를 보내면 소명 절차가 문자 한 번으로 뚫린다').not.toMatch(/resolveHold: true/);
  });

  it('에이전트 링크 승인의 멱등키는 주문 고정이다 (재클릭 = 중복 차단)', () => {
    expect(route).toMatch(/idempotencyKey: `order:\$\{resolved\.row\.id\}`/);
    expect(route, '감사 표기 = link:번호').toMatch(/requestedBy: `link:\$\{resolved\.phone\}`/);
    expect(route, '연결은 코어가 선점과 함께 소유한다 — 라우트는 orderIds만 넘긴다').toMatch(/orderIds: \[String\(resolved\.row\.id\)\]/);
    expect(route, '라우트에 연결 사본이 되살아났다').not.toMatch(/const linkRequest = async/);
  });

  it('링크에 거절·해소 경로가 없다 (승인 하나뿐 · reject_reason 표시는 무해)', () => {
    expect(route, '거절 실행 UPDATE가 생겼다').not.toMatch(/SET status = 'rejected'/);
    expect(route, 'uncertain 해소 실행이 생겼다 (판독용 not_applied 문자열은 무해)').not.toMatch(/SET status = 'not_applied'|resolveUncertain/);
    const posts = route.match(/router\.post\(/g) || [];
    expect(posts.length, '승인 외 POST가 생겼다').toBe(1);
  });
});

describe('알림 훅 (요청 생성 지점)', () => {
  it('무통장입금 요청 = 접수 후 발송 · 명의 보류 건은 문자 없음 · 실패해도 접수 무영향', () => {
    const src = read('../../routes/balance.ts');
    expect(src).toMatch(/if \(!heldReason\) \{[\s\S]{0,200}notifyChargeApprovers\(/);
    expect(src).toMatch(/notifyChargeApprovers\(\{[\s\S]{0,300}\}\)\.catch\(/);
  });

  it('에이전트 충전 요청 = 접수 후 발송 · 발송ID 동반 · 알림 I/O는 201 응답 밖(★Codex 1R medium)', () => {
    const src = read('../../routes/agent-charge-orders.ts');
    expect(src).toMatch(/setImmediate\(\(\) => \{[\s\S]{0,600}notifyChargeApprovers\(/);
    expect(src).toMatch(/extraLine: `발송ID: \$\{parsed\.agentSendId\}`/);
    expect(src).toMatch(/\)\(\)\.catch\(/);
  });

  it('발송 CT는 ENV 미설정이면 조용히 생략한다 (기존 동작 무변화)', () => {
    const ct = read('../charge-approve-link.ts');
    expect(ct).toMatch(/phones\.length === 0/);
    expect(ct, '알림 실패가 접수를 죽이면 안 된다').toMatch(/안내 문자 발송 오류/);
  });
});

describe('공개 페이지·마운트', () => {
  it('app.ts에 무인증 마운트가 있고, FE 라우트가 등록됐다', () => {
    expect(read('../../app.ts')).toMatch(/app\.use\('\/api\/charge-approve', chargeApproveRoutes\)/);
    const appTsx = fs.readFileSync(path.resolve(__dirname, '../../../../frontend/src/App.tsx'), 'utf8');
    expect(appTsx).toMatch(/path="\/charge-approve"/);
  });

  it('승인 페이지는 토큰을 헤더로만 보낸다 (fragment 수신 · URL 전송 0)', () => {
    const page = fs.readFileSync(path.resolve(__dirname, '../../../../frontend/src/pages/ChargeApprovePage.tsx'), 'utf8');
    expect(page).toMatch(/X-Charge-Approve-Token/);
    expect(page).toMatch(/window\.location\.hash/);
    expect(page, 'API URL에 토큰을 실으면 요청 로그에 남는다').not.toMatch(/approve\?t=|info\?t=/);
  });
});


describe('Codex 적대 1R·2R 정정 계약 (돈 축 — 되돌아가면 빨간불)', () => {
  const linkCt = read('../charge-approve-link.ts');
  const route = read('../../routes/charge-approve.ts');
  const core = read('../agent-charge-core.ts');
  const admin = read('../../routes/admin.ts');

  it('C1(개정 0829): 단축은 **클릭 비추적 가드와 짝**으로만 쓴다 (가드 없는 단축 = 토큰이 고객사 이벤트로 샌다)', () => {
    // Harold 0829 "단축 URL로" 재도입. 유출의 뿌리는 단축이 아니라 클릭 라우트의 cdp 기록이었다.
    const clickRoute = read('../../routes/short-url.ts');
    // ①가드: 승인류 링크는 cdp 기록을 건너뛴다(충전·대행 두 축 다 · B-0828-7 종결)
    expect(clickRoute, '승인류 비추적 가드가 사라졌다').toMatch(/charge\|agency\)-approve/);
    const guardAt = clickRoute.indexOf(')-approve');
    const trackAt = clickRoute.indexOf('void trackEvent(');
    expect(guardAt, '가드가 trackEvent보다 뒤면 기록이 먼저 나간다').toBeLessThan(trackAt);
    // ②단축 사용: 만료 = 토큰 만료 동치 · 실패 = 원본 폴백
    expect(linkCt).toMatch(/createShortUrl\(\{ companyId, fullUrl, expiresAt \}\)/);
    expect(linkCt).toMatch(/CHARGE_APPROVE_TTL_SECONDS \* 1000/);
    expect(linkCt, '단축 실패가 안내를 멈추면 안 된다').toMatch(/원본 주소로 발송/);
    expect(linkCt, '단축은 가드 전제를 주석 계약으로 남긴다').toMatch(/비추적 가드/);
  });

  it('C2(2R): 주문 선점은 **코어의 예약 트랜잭션 안**이다 — 입구가 아니라 효과 자리에 게이트가 있다', () => {
    // 링크에만 선점을 두면 화면 입구(랜덤 멱등키)가 그대로 들어가 같은 주문을 두 번 충전할 수 있었다
    expect(core).toMatch(/SET status = 'processing', charge_request_id = \$2[\s\S]{0,140}AND status = 'pending'/);
    const claimAt = core.indexOf("SET status = 'processing', charge_request_id");
    const gatewayAt = core.indexOf('insertAgentCharges(parsed.charges)');
    expect(claimAt, '선점이 게이트웨이 호출보다 뒤면 이중 충전 창이 열린다').toBeLessThan(gatewayAt);
    expect(core, '부분 선점은 일부만 충전이라는 더 나쁜 상태다 — 전건 아니면 롤백').toMatch(/!== orderIds\.length/);
    expect(route, '링크 라우트에 선점 사본이 되살아났다').not.toMatch(/SET status = 'processing', resolved_by/);
    expect(route, '연결은 코어 소유 — 라우트가 orderIds를 넘긴다').toMatch(/orderIds: \[String\(resolved\.row\.id\)\]/);
  });

  it('C2(2R): 게이트웨이 미진입 확정이면 주문 선점을 되돌린다 — 원복은 예약 삭제보다 먼저', () => {
    const releaseAt = core.indexOf("SET status = 'pending', charge_request_id = NULL");
    const deleteAt = core.indexOf('DELETE FROM agent_charge_requests');
    expect(releaseAt, '주문 원복이 없다 = pending이던 주문이 processing으로 고착').toBeGreaterThan(-1);
    expect(releaseAt, 'FK가 SET NULL이라 예약을 먼저 지우면 되돌릴 단서가 사라진다').toBeLessThan(deleteAt);
    expect(core, '원복 실패를 삼키면 아무도 그 건을 다시 처리할 수 없다').toMatch(/agent-charge-claim-stuck:/);
  });

  it('H2(2R): fulfilled 수렴을 서버 워커가 소유한다 (화면 폴링 의존 폐기)', () => {
    const worker = read('../agent-charge-reconciler.ts');
    expect(worker, '대사 워커가 없다').toMatch(/reconcileAgentChargeOrdersOnce/);
    expect(worker, '전건 반영일 때만 완료 — 부분 반영을 완료로 적으면 거짓말이다').toMatch(/every\(\(a\) => !!a\.applied\)/);
    expect(worker, 'registered 요청만 본다(uncertain·not_applied는 사람 판단)').toMatch(/r\.status = 'registered'/);
    expect(read('../../app.ts'), '워커가 기동되지 않는다').toMatch(/startAgentChargeReconciler\(\)/);
  });

  it('H2(3R): 실패 정리는 원복+예약삭제 한 트랜잭션이다 (원복 실패 시 예약 보존 = 게이트·해소가 수렴)', () => {
    const seg = core.slice(core.indexOf('커밋 전 실패'), core.indexOf('throw mysqlErr'));
    expect(seg, '정리가 트랜잭션이 아니다').toMatch(/BEGIN/);
    const restoreAt = seg.indexOf("SET status = 'pending', charge_request_id = NULL");
    const deleteAt = seg.indexOf('DELETE FROM agent_charge_requests');
    expect(restoreAt, '주문 원복이 사라졌다').toBeGreaterThan(-1);
    expect(restoreAt, '원복이 예약 삭제보다 뒤면 FK SET NULL이 단서를 지운다').toBeLessThan(deleteAt);
    expect(seg, '원복 건수 불일치를 무시하면 고착이 조용히 지나간다').toMatch(/!== orderIds\.length/);
    expect(seg, '정리 실패 시 예약을 보존해야 게이트·해소로 수렴한다').toMatch(/예약 보존/);
  });

  it('H4(3R): 대사 워커는 SeqNo 없는 요청을 SQL에서 제외한다 (기아 방지)', () => {
    const worker = read('../agent-charge-reconciler.ts');
    expect(worker).toMatch(/charges->0->>'seqNo'\) IS NOT NULL/);
  });

  it('H2(2R): 미반영 해소는 주문도 함께 되돌린다 (processing에 갇히면 아무도 다시 처리 못 한다)', () => {
    const seg = admin.slice(admin.indexOf("agent-charges/:requestId/resolve"), admin.indexOf('불확실 해소 실패'));
    expect(seg, 'not_applied 해소가 주문을 pending으로 되돌리지 않는다').toMatch(/next === 'not_applied'/);
    expect(seg).toMatch(/SET status = 'pending', charge_request_id = NULL[\s\S]{0,120}status = 'processing'/);
    expect(seg, '되돌리기 실패를 삼키면 주문이 갇힌다').toMatch(/agent-charge-order-stuck:/);
  });

  it('H3(2R): SMS 적재 오류 로그에 SQL 원문·파라미터를 남기지 않는다 (본문에 토큰이 실린다)', () => {
    const q = read('../sms-queue.ts');
    const seg = q.slice(q.indexOf('[sms-queue] bulk INSERT 실패') - 400, q.indexOf('[sms-queue] bulk INSERT 실패') + 500);
    expect(seg, '오류 객체를 통째로 찍으면 err.sql(토큰 포함)이 남는다').not.toMatch(/실패 \([^)]*\):`, batchErr\)/);
    expect(seg).toMatch(/code=\$\{batchErr\?\.code/);
  });
});

describe('Codex 적대 1R 정정 계약 (이어서)', () => {
  const linkCt = read('../charge-approve-link.ts');
  const admin = read('../../routes/admin.ts');
  const core = read('../agent-charge-core.ts');
  const route = read('../../routes/charge-approve.ts');

  it('C2: 재전송(duplicated)은 실상태로 가른다 — registered만 성공', () => {
    expect(core).toMatch(/requestStatus: \(ex\?\.status as string\) \|\| null/);
    expect(route).toMatch(/outcome\.requestStatus === 'registered'/);
    expect(route).toMatch(/outcome\.requestStatus === 'not_applied'/);
  });

  it('H1: 무통장 반려는 status=pending CAS다 (링크 승인 결과를 덮어쓰지 못한다)', () => {
    expect(admin).toMatch(/SET status = 'rejected', confirmed_by = \$1, confirmed_at = NOW\(\), admin_note = \$2[\s\S]{0,40}WHERE id = \$3 AND status = 'pending'/);
  });

  it('H3: 발신번호는 플랫폼 대표번호 CT · 적재 건수를 검증한다', () => {
    expect(linkCt).toMatch(/getPlatformNoticeCallback\(\)/);
    expect(linkCt, 'phones[0] 발신 = 발신자와 수신자가 같아 번호도용 차단에 걸린다').not.toMatch(/callback = phones\[0\]/);
    expect(linkCt).toMatch(/inserted < rows\.length/);
  });

  it('H4: 고객 입력(입금자명 등)은 단일 행으로 접히고 URL이 제거된다 (행동 검증)', () => {
    expect(oneLineField('정상입금자')).toBe('정상입금자');
    // 화이트리스트 방식 = 단어는 남고 **주소 구분자**가 사라진다(클릭 불가가 목표)
    expect(oneLineField('입금자\n[한줄로] 긴급: https://evil.example.com 에서 재승인')).not.toMatch(/[\n.:/@]/);
    expect(oneLineField('가짜안내 hanjul-fake.kr/x 클릭')).not.toContain('.kr');
    // ★2R high — URL을 먼저 걷고 나중에 문자 정제를 하면 별표가 사라져 주소가 재조립된다
    expect(oneLineField('입금자 http★://1.2.3.4 확인')).not.toMatch(/1\.2\.3\.4/);
    expect(oneLineField('ｈｔｔｐｓ://evil.example.com')).not.toMatch(/evil\.example/);
    // ★3R high — IDN·유니코드 점 변형까지: 점·콜론·슬래시·@가 통째로 빠져 호스트가 성립하지 않는다
    for (const bad of ['악성.com', '한글．com', '악성。com', 'a@b.kr', 'x.co/y', String.fromCharCode(48,46,48,46,48,46,48)]) {
      const out = oneLineField(bad);
      expect(out, bad + ' 에서 주소 형태가 남았다').not.toMatch(/[.:\/@]/);
    }
    expect(oneLineField('(주)스킨큐어 A-1, 대표'), '정상 상호가 훼손되면 안 된다').toBe('(주)스킨큐어 A-1, 대표');
    expect(oneLineField('a'.repeat(100), 20).length).toBe(20);
    expect(linkCt).toMatch(/oneLineField\(input\.companyName/);
    expect(linkCt).toMatch(/oneLineField\(input\.depositorName/);
  });
});
