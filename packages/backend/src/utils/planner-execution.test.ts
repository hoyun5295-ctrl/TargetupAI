/**
 * planner-execution.test.ts — 플래너 실행 축 계약 (★ 2026-08-13 Phase 3·4)
 *
 * 고정하는 계약(어기면 돈·발송이 어긋난다):
 *  ① **예정일 당일만 실행한다.** 지난 날짜를 뒤늦게 보내면 끝난 행사 안내가 나간다.
 *  ② 멱등키는 터치포인트·회사·월로 **고정**이다 — 재시도·워커 그물·재개가 한 키로 수렴한다.
 *  ③ 알림톡은 언제나 참여자 축이다(정보성 안내). 그 밖 채널은 기입값을 따른다.
 *  ④ 알림톡 문안에는 광고 표현이 없다 — 검수 통과 조건이라 품질 문제가 아니다.
 *  ⑤ 혜택은 지시문에 **원문 그대로** 들어간다(AI가 수치를 만들지 못하게).
 *  ⑥ 취소 환불은 그 달 제작·실행이 0건일 때만 전액이다(일할 없음).
 *  ⑦ 리드타임은 영업일로 센다(주말이 검수를 진행시키지 않는다).
 *  ⑧ 실행·대조 워커는 app 부팅에 등재돼 있다 — 선언이 아니라 등재가 가동의 근거다.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  ALIMTALK_LEAD_BUSINESS_DAYS,
  ALIMTALK_MAX_RESUBMIT,
  PLANNER_SEND_SOURCE,
  buildAlimtalkNoticeBody,
  buildAlimtalkTemplateName,
  buildParticipationCtaSection,
  buildPlannerCopyObjective,
  buildPlannerEventText,
  businessDaysUntil,
  canMeetInspectionLeadTime,
  classifyExecutionWindow,
  describeTiming,
  evaluateCancelRefund,
  hasAdToneForAlimtalk,
  insertParticipationSection,
  isMaterialChannel,
  kstDateString,
  plannerProduceGenKey,
  plannerRefundKey,
  plannerSendKey,
  resolveAudienceMode,
} from './planner-execution';
import { getCreditCost } from './ai-credit-calc';

const EVENT = {
  title: '가을 감사 행사',
  startsOn: '2026-09-10',
  endsOn: '2026-09-14',
  benefitText: '전 품목 15% 할인 (9/10~9/14)',
  products: [{ name: '캐시미어 니트' }, { name: '울 코트' }],
};

describe('실행 창 — 당일만', () => {
  it('오늘이면 due, 미래면 future, 지났으면 missed', () => {
    expect(classifyExecutionWindow('2026-09-10', '2026-09-10')).toBe('due');
    expect(classifyExecutionWindow('2026-09-11', '2026-09-10')).toBe('future');
    expect(classifyExecutionWindow('2026-09-09', '2026-09-10')).toBe('missed');
  });

  it('KST 날짜 문자열은 UTC 자정 경계를 넘겨도 그날을 가리킨다', () => {
    // 2026-09-09T15:30Z = KST 2026-09-10 00:30
    expect(kstDateString(new Date('2026-09-09T15:30:00Z'))).toBe('2026-09-10');
    expect(kstDateString(new Date('2026-09-09T14:30:00Z'))).toBe('2026-09-09');
  });
});

describe('멱등키 — 고정 축', () => {
  it('생성·발송·환불 키가 서로 겹치지 않고 축이 고정이다', () => {
    expect(plannerProduceGenKey('tp-1')).toBe('planner-produce-gen:tp-1');
    expect(plannerSendKey('tp-1')).toBe('planner-send:tp-1');
    expect(plannerRefundKey('c-1', '2026-09')).toBe('planner-refund:c-1:2026-09');
    const keys = new Set([plannerProduceGenKey('tp-1'), plannerSendKey('tp-1'), plannerRefundKey('c-1', '2026-09')]);
    expect(keys.size).toBe(3);
  });

  it('제작물 과금 키는 그 채널 라우트가 쓰는 키와 같다 — 같은 제작물 이중 과금 차단', () => {
    const prod = readFileSync(path.join(__dirname, 'planner-production.ts'), 'utf8');
    expect(prod).toContain('`email-campaign-complete:${assetRef}`');
    expect(prod).toContain('`dm-publish:${assetRef}`');
    expect(prod).toContain('`inapp-publish:${assetRef}`');
    // 라우트 쪽 키와 대조 — 한쪽이 바뀌면 이 테스트가 먼저 깨진다
    expect(readFileSync(path.join(__dirname, '../routes/email.ts'), 'utf8')).toContain('email-campaign-complete:${campaign.id}');
    expect(readFileSync(path.join(__dirname, '../routes/dm.ts'), 'utf8')).toContain('dm-publish:${req.params.id}');
    expect(readFileSync(path.join(__dirname, '../routes/cdp.ts'), 'utf8')).toContain('inapp-publish:${message.id}');
  });

  it('당일 문안 source의 단가는 CREDIT_COST_MAP이 소유한다', () => {
    expect(PLANNER_SEND_SOURCE).toBe('planner-touchpoint-send');
    expect(getCreditCost(PLANNER_SEND_SOURCE)).toBeGreaterThan(0);
  });

  it('당일 문안 source는 마이너스 허용군(OPERATION_SOURCES)에 없다 — 보류가 정답이다', () => {
    const src = readFileSync(path.join(__dirname, 'ai-credit-calc.ts'), 'utf8');
    const line = src.split('\n').find((l) => l.includes('const OPERATION_SOURCES')) || '';
    expect(line).not.toContain('planner');
  });
});

describe('대상 축', () => {
  it('알림톡은 기입값과 무관하게 참여자다', () => {
    expect(resolveAudienceMode('alimtalk', { anchor: 'start' })).toBe('participants');
    expect(resolveAudienceMode('alimtalk', { anchor: 'start', audience: 'all' })).toBe('participants');
  });

  it('문자는 기입값을 따르고, 미지정은 전체다', () => {
    expect(resolveAudienceMode('sms', { anchor: 'start' })).toBe('all');
    expect(resolveAudienceMode('sms', { anchor: 'start', audience: 'participants' })).toBe('participants');
  });

  it('소재 채널은 이메일·DM·인앱 셋뿐이다', () => {
    expect(isMaterialChannel('email')).toBe(true);
    expect(isMaterialChannel('dm')).toBe(true);
    expect(isMaterialChannel('inapp')).toBe(true);
    expect(isMaterialChannel('sms')).toBe(false);
    expect(isMaterialChannel('alimtalk')).toBe(false);
  });
});

describe('당일 문안 지시문 — 혜택 verbatim', () => {
  it('고객사가 쓴 혜택 문장이 그대로 들어간다', () => {
    const obj = buildPlannerCopyObjective(EVENT, '메시징(문자)', '행사 시작일');
    expect(obj).toContain('전 품목 15% 할인 (9/10~9/14)');
    expect(obj).toContain('만들지 않는다');
  });

  it('혜택 칸이 비면 혜택 줄을 넣지 않는다 — 빈 자리를 AI가 채우지 못하게', () => {
    const obj = buildPlannerCopyObjective({ ...EVENT, benefitText: null }, '메시징(문자)', '행사 시작일');
    expect(obj).not.toContain('기입한 혜택');
  });

  it('행사 원문(소재 제작 입력)에도 기간·혜택·상품이 그대로 담긴다', () => {
    const text = buildPlannerEventText(EVENT);
    expect(text).toContain('2026-09-10 ~ 2026-09-14');
    expect(text).toContain('전 품목 15% 할인');
    expect(text).toContain('캐시미어 니트');
  });

  it('시점 라벨은 고객 언어다', () => {
    expect(describeTiming({ anchor: 'before_start', offsetDays: 5 })).toBe('행사 시작 5일 전');
    expect(describeTiming({ anchor: 'end' })).toBe('행사 종료일');
    expect(describeTiming({ anchor: 'start' })).toBe('행사 시작일');
  });
});

describe('알림톡 — 정보성 전용', () => {
  it('조립 문안에 광고 표현이 없다(검수 통과 조건)', () => {
    const body = buildAlimtalkNoticeBody(EVENT, '한줄로상사');
    expect(hasAdToneForAlimtalk(body)).toBe(false);
    expect(body).not.toContain('15%');
  });

  it('재제출본도 광고 표현이 없고 더 짧다', () => {
    const v1 = buildAlimtalkNoticeBody(EVENT, '한줄로상사', 1);
    const v2 = buildAlimtalkNoticeBody(EVENT, '한줄로상사', 2);
    expect(hasAdToneForAlimtalk(v2)).toBe(false);
    expect(v2.length).toBeLessThan(v1.length);
  });

  it('혜택 문구가 섞이면 광고로 판정한다 — 제출 자체를 막는 게이트', () => {
    expect(hasAdToneForAlimtalk('전 품목 15% 할인 안내')).toBe(true);
    expect(hasAdToneForAlimtalk('쿠폰을 드립니다')).toBe(true);
  });

  it('템플릿 이름에 월·행사가 들어간다(검수 화면에서 사람이 찾는다)', () => {
    expect(buildAlimtalkTemplateName(EVENT, '2026-09')).toBe('플래너 2026-09 가을 감사 행사');
  });

  it('리드타임은 영업일 5일이고 주말은 세지 않는다', () => {
    expect(ALIMTALK_LEAD_BUSINESS_DAYS).toBe(5);
    expect(ALIMTALK_MAX_RESUBMIT).toBe(1);
    // 2026-09-07(월) → 09-11(금) = 영업일 4일
    expect(businessDaysUntil('2026-09-07', '2026-09-11')).toBe(4);
    // 09-07(월) → 09-14(월) = 영업일 5일(주말 제외)
    expect(businessDaysUntil('2026-09-07', '2026-09-14')).toBe(5);
    expect(canMeetInspectionLeadTime('2026-09-07', '2026-09-11')).toBe(false);
    expect(canMeetInspectionLeadTime('2026-09-07', '2026-09-14')).toBe(true);
    expect(businessDaysUntil('2026-09-14', '2026-09-07')).toBe(0);
  });
});

describe('취소 환불 — 제작·실행 0건일 때만 전액', () => {
  it('아무 일도 안 했으면 전액', () => {
    const v = evaluateCancelRefund({ agencyPaid: true, agencyCredits: 1000, producedCount: 0, executedCount: 0 });
    expect(v).toMatchObject({ refundable: true, amount: 1000 });
  });

  it('제작 1건이라도 있으면 환불 없다 — 일할 계산도 없다', () => {
    expect(evaluateCancelRefund({ agencyPaid: true, agencyCredits: 1000, producedCount: 1, executedCount: 0 }).refundable).toBe(false);
    expect(evaluateCancelRefund({ agencyPaid: true, agencyCredits: 1000, producedCount: 0, executedCount: 1 }).amount).toBe(0);
  });

  it('차감 이력이 없으면 돌려줄 것도 없다', () => {
    expect(evaluateCancelRefund({ agencyPaid: false, agencyCredits: 1000, producedCount: 0, executedCount: 0 }).refundable).toBe(false);
  });
});

describe('참여 버튼 — 이메일 소재', () => {
  it('버튼은 https 주소를 물고, 수신동의와 별개임을 문구로 말한다', () => {
    const sec = buildParticipationCtaSection('https://hanjul.ai/api/marketing-planner/participate/tok');
    expect(sec.props.buttons[0].url).toMatch(/^https:\/\//);
    expect(String(sec.props.note)).toContain('광고 수신동의와 별개');
  });

  it('footer 앞에 끼우고 기존 섹션을 지우지 않는다(비파괴)', () => {
    const sections = [{ type: 'hero' }, { type: 'cta' }, { type: 'footer' }];
    const out = insertParticipationSection(sections, 'https://hanjul.ai/x');
    expect(out).toHaveLength(4);
    expect(out[2].id).toBe('planner-join');
    expect(out[3].type).toBe('footer');
    // 원본 배열은 그대로
    expect(sections).toHaveLength(3);
  });

  it('footer가 없으면 맨 뒤에 붙인다', () => {
    const out = insertParticipationSection([{ type: 'hero' }], 'https://hanjul.ai/x');
    expect(out[1].id).toBe('planner-join');
  });
});

describe('워커 등재 — 선언이 아니라 부팅 호출이 가동의 근거다', () => {
  it('app.ts가 실행·대조 워커를 부른다', () => {
    const app = readFileSync(path.join(__dirname, '../app.ts'), 'utf8');
    expect(app).toContain("from './utils/planner-executor'");
    expect(app).toContain("from './utils/planner-reconcile'");
    expect(app).toMatch(/startPlannerExecutor\(\);/);
    expect(app).toMatch(/startPlannerReconcileWorker\(\);/);
  });

  it('exec_meta 컬럼이 없으면 워커가 통째로 쉰다 — 부분 실행 금지', () => {
    const src = readFileSync(path.join(__dirname, 'planner-executor.ts'), 'utf8');
    expect(src).toContain('guardExecMetaOrSkip');
    const rec = readFileSync(path.join(__dirname, 'planner-reconcile.ts'), 'utf8');
    expect(rec).toContain('guardExecMetaOrSkip');
  });

  it('발송 시도 표식을 커밋 전에 남기고, 표식 있는 행은 재발송 후보로 되돌리지 않는다', () => {
    const exec = readFileSync(path.join(__dirname, 'planner-executor.ts'), 'utf8');
    // 표식 → 커밋 순서(표식이 커밋 뒤로 가면 기록 실패 창에서 이중 발송이 된다)
    const stampIdx = exec.indexOf('await stampSendAttempt(tp, stagingId)');
    const commitIdx = exec.indexOf('await createDirectSendCampaign(');
    expect(stampIdx).toBeGreaterThan(0);
    expect(stampIdx).toBeLessThan(commitIdx);
    // 취소와의 직렬화 — 실행·제작 선점이 같은 잠금 문(claimTouchpointUnderPlanLock)을 쓴다
    expect(exec).toContain('claimTouchpointUnderPlanLock(tp, from)');
    expect(readFileSync(path.join(__dirname, 'planner-production.ts'), 'utf8'))
      .toContain("claimTouchpointUnderPlanLock(tp, ['planned'])");
    // 그 문은 승인 원장 행을 FOR UPDATE로 잠근 뒤 선점한다(조회 게이트는 장벽이 아니다)
    const ledgerSrc = readFileSync(path.join(__dirname, 'planner-touchpoint.ts'), 'utf8');
    const claimFn = ledgerSrc.slice(ledgerSrc.indexOf('export async function claimTouchpointUnderPlanLock'));
    expect(claimFn.indexOf('FOR UPDATE')).toBeGreaterThan(0);
    expect(claimFn.indexOf('FOR UPDATE')).toBeLessThan(claimFn.indexOf('UPDATE planner_touchpoints'));
    // 대조 워커는 표식 있는 행을 잠그고 사람을 부른다(회수 금지)
    const rec = readFileSync(path.join(__dirname, 'planner-reconcile.ts'), 'utf8');
    expect(rec).toContain("execMeta?.send_started_at && !tp.execRef");
    // 취소 환불 실적 판정도 그 표식을 실행으로 센다
    const ledger = readFileSync(path.join(__dirname, 'planner-touchpoint.ts'), 'utf8');
    expect(ledger).toContain("exec_meta ? 'send_started_at'");
  });

  it('취소·실적 집계·환불이 한 트랜잭션·한 잠금 안에서 순서대로 일어난다', () => {
    const src = readFileSync(path.join(__dirname, 'planner-approval.ts'), 'utf8');
    const fn = src.slice(src.indexOf('export async function cancelMonthlyApproval'));
    const lockIdx = fn.indexOf('FOR UPDATE');
    const transitionIdx = fn.indexOf("SET status = 'cancelled'");
    const countIdx = fn.indexOf('FILTER (WHERE t.asset_ref IS NOT NULL)');
    const refundIdx = fn.indexOf('refundCreditWithClient(');
    const commitIdx = fn.indexOf("client.query('COMMIT')");
    // 잠금 → 전이 → 집계 → 환불 → 커밋
    expect(lockIdx).toBeGreaterThan(0);
    expect(lockIdx).toBeLessThan(transitionIdx);
    expect(transitionIdx).toBeLessThan(countIdx);
    expect(countIdx).toBeLessThan(refundIdx);
    expect(refundIdx).toBeLessThan(commitIdx);
    // 환불은 호출부 트랜잭션에 얹힌다(취소만 커밋되고 환불이 유실되는 창 제거)
    expect(fn).toContain('manageTx: false');
    // 진행 중(producing) 행은 취소가 건드리지 않는다 — 나간 발송을 상태로 덮지 않는다
    expect(fn).toContain("t.status IN ('planned', 'ready', 'hold_credit', 'locked')");
    // 그 행은 실적에서 실행으로 세어 환불을 막는다
    expect(fn).toContain("'sent', 'scheduled', 'producing'");
  });

  it('알림톡 재사용 폴백은 없다 — 행사별 문안이라 재사용본은 다른 행사 정보를 보낸다', () => {
    const src = readFileSync(path.join(__dirname, 'planner-alimtalk.ts'), 'utf8');
    expect(src).not.toContain('findReusableApprovedTemplate(');
    expect(src).not.toContain('alimtalk_reused');
  });

  it('알림톡은 원격 등록 전에 단계를 선점하고, 검수 상태를 실행 상태와 분리한다', () => {
    const src = readFileSync(path.join(__dirname, 'planner-alimtalk.ts'), 'utf8');
    const fn = src.slice(src.indexOf('async function submitForInspection'));
    const claimIdx = fn.indexOf('claimAlimtalkStage(');
    const remoteIdx = fn.indexOf('imc.createAlimtalkTemplate(');
    expect(claimIdx).toBeGreaterThan(0);
    expect(claimIdx).toBeLessThan(remoteIdx);
    // 검수 중에는 터치포인트 상태를 producing으로 쓰지 않는다(실행 선점과 겹치면 두 번 발송된다)
    expect(fn).not.toContain("status: 'producing'");
    // 승인은 planned → ready 전이
    expect(src).toContain("status: 'ready', fromStatuses: ['planned']");
    // kakao_templates 쓰기에도 회사 조건
    expect(src).toContain('AND company_id = $2::uuid');
  });

  it('고아 회수는 소유권 값 CAS로만 한다 — 살아 있는 선점을 되돌리지 않는다', () => {
    const ledgerSrc = readFileSync(path.join(__dirname, 'planner-touchpoint.ts'), 'utf8');
    const fn = ledgerSrc.slice(ledgerSrc.indexOf('export async function releaseStaleClaim'));
    expect(fn).toContain("exec_meta->>'claimed_at' = $4");
    expect(ledgerSrc).toContain('export async function touchClaim');
    // 대조 워커는 그 문으로만 회수한다
    const rec = readFileSync(path.join(__dirname, 'planner-reconcile.ts'), 'utf8');
    expect(rec).toContain('releaseStaleClaim({');
    expect(rec).not.toContain("status: back, fromStatuses: ['producing']");
    // 실행부는 긴 단계 앞에서 heartbeat를 찍는다
    const exec = readFileSync(path.join(__dirname, 'planner-executor.ts'), 'utf8');
    expect((exec.match(/touchClaim\(/g) || []).length).toBeGreaterThanOrEqual(3);
  });

  it('알림톡 단계는 exhaustive하게 재개된다 — 어느 단계에서도 영구 정지가 없다', () => {
    const src = readFileSync(path.join(__dirname, 'planner-alimtalk.ts'), 'utf8');
    // 후보 조회와 선점 허용 단계가 같은 집합이다(하나를 빼먹으면 그 단계가 멈춘다)
    expect(src).toContain("['', 'registered', 'rejected', 'submitting'].includes(stageOf(tp))");
    expect(src).toContain("const fromStages = ['', 'registered', 'rejected', 'submitting']");
    // 저장된 attempt를 쓴다(항상 0을 넘기면 재제출이 성립하지 않는다)
    expect(src).toContain('alimtalk_attempt');
    expect(src).toContain('savedAttempt');
    // 반려·보류 전이도 CAS(무조건 stamp가 남의 선점을 되돌리지 않는다)
    expect(src).toContain("claimAlimtalkStage(tp.companyId, tp.id, ['inspecting'], 'rejected')");
    expect(src).toContain("claimAlimtalkStage(tp.companyId, tp.id, ['inspecting'], 'blocked')");
  });

  it('회수는 자동 재시도가 아니라 사람 판정이다 — 되돌린 행이 다시 발송 후보가 되지 않는다', () => {
    const rec = readFileSync(path.join(__dirname, 'planner-reconcile.ts'), 'utf8');
    const fn = rec.slice(rec.indexOf('async function recoverStale'), rec.indexOf('async function reportCancelledLeftovers'));
    expect(fn).toContain("toStatus: 'locked'");
    expect(fn).not.toContain("toStatus: back");
    expect(fn).not.toContain("'ready'");
  });

  it('환불은 전액만 지원하고 같은 차감에 누적 상한이 걸린다', () => {
    const tx = readFileSync(path.join(__dirname, 'ai-credit-tx.ts'), 'utf8');
    expect(tx).toContain("skipReason: 'partial_not_supported'");
    expect(tx).toContain("skipReason: 'already_refunded'");
    expect(tx).toContain('ORIG_TAG_PREFIX');
  });

  it('승인 차감 키는 선점이 돌려준 회차로 확정한다 — ABA 무료 승인 차단', () => {
    const src = readFileSync(path.join(__dirname, 'planner-approval.ts'), 'utf8');
    const claim = src.slice(src.indexOf('async function claimApproval'), src.indexOf('/** 선점 해제'));
    expect(claim).toContain('AS cycle');
    expect(src).toContain('buildApprovalIdempotencyKey(companyId, planMonth, claimed.cycle)');
    // 취소도 잠금 안에서 회차를 계산한다
    const cancel = src.slice(src.indexOf('export async function cancelMonthlyApproval'));
    const lockIdx = cancel.indexOf('FOR UPDATE');
    const cycleIdx = cancel.indexOf('const cycle = Number(cycleRes');
    expect(lockIdx).toBeLessThan(cycleIdx);
  });

  it('참여 투영은 대조 워커 한 경로뿐이다 — 겹치면 중복 적재가 된다', () => {
    const exec = readFileSync(path.join(__dirname, 'planner-executor.ts'), 'utf8');
    expect(exec).not.toContain('ingestJoinClicksForCampaign');
    const rec = readFileSync(path.join(__dirname, 'planner-reconcile.ts'), 'utf8');
    expect(rec).toContain('ingestJoinClicksForCampaign');
    expect(rec).toContain('reconcileRunning');
  });

  it('환불은 결제 회차 키를 쓴다 — 환불 뒤 재승인이 무료가 되지 않는다', () => {
    const src = readFileSync(path.join(__dirname, 'planner-approval.ts'), 'utf8');
    expect(src).toContain('loadChargeCycle');
    expect(src).toContain('loadAgencyPaymentState');
    const tx = readFileSync(path.join(__dirname, 'ai-credit-tx.ts'), 'utf8');
    // 환불은 월 리셋을 먼저 적용하고, 원 차감액을 넘지 않는다
    expect(tx).toContain('applyResetIfNeeded(client, opts.companyId, locked, now)');
    expect(tx).toContain('amount > originalAmount');
  });

  it('발송 커밋·스팸 게이트·080 가드를 직접 만들지 않고 기존 CT를 부른다', () => {
    const src = readFileSync(path.join(__dirname, 'planner-executor.ts'), 'utf8');
    expect(src).toContain("from './direct-send-core'");
    expect(src).toContain("from './spam-test-queue'");
    expect(src).toContain("from './messageUtils'");
    expect(src).toContain("from './planner-audience'");
    // 알림톡은 message_type이 아니라 send_channel 축이다(0727 교훈)
    expect(src).toContain("sendChannel: 'alimtalk'");
    expect(src).not.toMatch(/msgType:\s*'KAKAO'/);
  });
});
