/**
 * planner-execution.test.ts — 플래너 실행 축 계약 (★ 2026-08-13 Phase 3·4)
 *
 * 고정하는 계약(어기면 돈·발송이 어긋난다):
 *  ① **예정일 당일만 실행한다.** 지난 날짜를 뒤늦게 보내면 끝난 행사 안내가 나간다.
 *  ② 멱등키는 터치포인트·회사·월로 **고정**이다 — 재시도·워커 그물·재개가 한 키로 수렴한다.
 *  ③ 알림톡은 언제나 참여자 축이다(정보성 안내). 그 밖 채널은 기입값을 따른다.
 *  ④ 알림톡 문안에는 광고 표현이 없다 — 검수 통과 조건이라 품질 문제가 아니다.
 *  ⑤ 혜택은 지시문에 **원문 그대로** 들어간다(AI가 수치를 만들지 못하게).
 *  ⑥ 취소 환불은 그 달 발송 시도가 0건일 때만 전액이다(일할 없음 · ★ 2026-10-04 §6-9).
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
  addDays,
  appendDmLink,
  buildAlimtalkNoticeBody,
  buildAlimtalkTemplateName,
  buildParticipationCtaSection,
  buildPlannerCopyObjective,
  buildPlannerEventText,
  businessDaysUntil,
  canMeetInspectionLeadTime,
  carrierKey,
  classifyExecutionWindow,
  decideMessagingDispatch,
  describeDmResidue,
  describeTiming,
  dmStageOf,
  evaluateCancelRefund,
  findDmDataResidue,
  findDmPlaceholderResidue,
  hasAdToneForAlimtalk,
  insertParticipationSection,
  isMaterialChannel,
  kstDateString,
  mergeDmResidue,
  plannerProduceGenKey,
  plannerRefundKey,
  plannerSendKey,
  resolveAudienceMode,
  timingKey,
} from './planner-execution';
import { parsePlannerEventInput } from './marketing-planner';
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

  it('승인 때 걷는 제작물 과금 키는 편집기 입구와 같은 코어 CT가 소유한다 — 같은 제작물 이중 과금 차단(★ 2026-10-04 C3)', () => {
    const dmCore = readFileSync(path.join(__dirname, 'dm/dm-publish-core.ts'), 'utf8');
    const emailCore = readFileSync(path.join(__dirname, 'email/email-complete-core.ts'), 'utf8');
    expect(dmCore).toContain('idempotencyKey: `dm-publish:${dmId}`');
    expect(emailCore).toContain('idempotencyKey: `email-campaign-complete:${campaign.id}`');
    // 두 입구(편집기 라우트 · 플래너 승인)가 같은 코어를 부른다 — 한쪽만 고쳐지는 일이 없다
    expect(readFileSync(path.join(__dirname, '../routes/dm.ts'), 'utf8')).toContain('await publishDmCore(');
    expect(readFileSync(path.join(__dirname, '../routes/email.ts'), 'utf8')).toContain('await completeEmailCampaignCore(');
    const approve = readFileSync(path.join(__dirname, 'planner-approve.ts'), 'utf8');
    expect(approve).toContain('await publishDmCore(');
    expect(approve).toContain('await completeEmailCampaignCore(');
    // 옛 제작 파일(플래너 전용 과금 축)은 남아 있지 않다
    expect(() => readFileSync(path.join(__dirname, 'planner-production.ts'), 'utf8')).toThrow();
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

describe('취소 환불 — 발송 시도 0건일 때만 전액(★ 2026-10-04 §6-9)', () => {
  it('아무것도 안 나갔으면 전액', () => {
    const v = evaluateCancelRefund({ agencyPaid: true, agencyCredits: 1000, executedCount: 0 });
    expect(v).toMatchObject({ refundable: true, amount: 1000 });
  });

  it('발송 시도가 1건이라도 있으면 환불 없다 — 일할 계산도 없다', () => {
    expect(evaluateCancelRefund({ agencyPaid: true, agencyCredits: 1000, executedCount: 1 }).refundable).toBe(false);
    expect(evaluateCancelRefund({ agencyPaid: true, agencyCredits: 1000, executedCount: 1 }).amount).toBe(0);
  });

  it('차감 이력이 없으면 돌려줄 것도 없다', () => {
    expect(evaluateCancelRefund({ agencyPaid: false, agencyCredits: 1000, executedCount: 0 }).refundable).toBe(false);
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
    const stampIdx = exec.indexOf('await stampSendAttempt(tp, claim, { staging_id: stagingId }, link.dm)');
    const commitIdx = exec.indexOf('await createDirectSendCampaign(');
    expect(stampIdx).toBeGreaterThan(0);
    expect(stampIdx).toBeLessThan(commitIdx);
    // 취소와의 직렬화 — 실행 선점은 월 원장 잠금 문(claimTouchpointUnderPlanLock)을 쓴다 · 승인 각인이 있는 ready만
    expect(exec).toContain("claimTouchpointUnderPlanLock(tp, ['ready'], 'claimed_at', companions, token)");
    // 그 문은 승인 원장 행을 FOR UPDATE로 잠근 뒤 선점한다(조회 게이트는 장벽이 아니다)
    const ledgerSrc = readFileSync(path.join(__dirname, 'planner-touchpoint.ts'), 'utf8');
    const claimFn = ledgerSrc.slice(ledgerSrc.indexOf('export async function claimTouchpointUnderPlanLock'));
    expect(claimFn.indexOf('FOR UPDATE')).toBeGreaterThan(0);
    expect(claimFn.indexOf('FOR UPDATE')).toBeLessThan(claimFn.indexOf('UPDATE planner_touchpoints'));
    // 대조 워커는 표식 있는 행을 잠그고 사람을 부른다(회수 금지)
    const rec = readFileSync(path.join(__dirname, 'planner-reconcile.ts'), 'utf8');
    expect(rec).toContain("execMeta?.send_started_at && !tp.execRef");
    // 취소 환불 실적 판정도 그 표식을 실행으로 센다
    expect(ledgerSrc).toContain("exec_meta ? 'send_started_at'");
  });

  it('취소·실적 집계·환불이 한 트랜잭션·한 잠금 안에서 순서대로 일어난다', () => {
    const src = readFileSync(path.join(__dirname, 'planner-approval.ts'), 'utf8');
    const fn = src.slice(src.indexOf('export async function cancelMonthlyApproval'));
    const lockIdx = fn.indexOf('FOR UPDATE');
    const transitionIdx = fn.indexOf("SET status = 'cancelled'");
    const countIdx = fn.indexOf('countMonthWork(companyId, planMonth, client)');
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
    // 그 행은 실적(한 벌)에서 실행으로 세어 환불을 막는다
    const ledger = readFileSync(path.join(__dirname, 'planner-touchpoint.ts'), 'utf8');
    const work = ledger.slice(ledger.indexOf('export async function countMonthWork'));
    expect(work).toContain("'sent', 'scheduled', 'producing'");
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
    // ★ 2026-09-02 예외 하나 = 문자 1통에 실린 **동반 DM**은 캐리어의 결과로 확정 복구한다(carried_by). 그 행은 스스로 발송 후보가
    //   되지 않는다(캐리어가 살아 있으면 실행 판정이 'carried'로 넘긴다). 그 분기 **밖**(일반 선점 회수)에는 ready 복원이 없어야 한다.
    const generic = fn.slice(fn.indexOf('⛔ **발송 시도 표식이 있는데'));
    expect(generic).not.toContain("'ready'");
    const companion = fn.slice(fn.indexOf("const carriedBy = String(tp.execMeta?.carried_by || '')"), fn.indexOf('⛔ **발송 시도 표식이 있는데'));
    expect(companion).toContain("['hold_credit', 'locked', 'skipped'].includes(carrier.status)");
    expect(companion).toContain("if (carrier && carrier.status === 'producing') continue;");
  });

  it('환불은 전액만 지원하고 같은 차감에 누적 상한이 걸린다', () => {
    const tx = readFileSync(path.join(__dirname, 'ai-credit-tx.ts'), 'utf8');
    expect(tx).toContain("skipReason: 'partial_not_supported'");
    expect(tx).toContain("skipReason: 'already_refunded'");
    expect(tx).toContain('ORIG_TAG_PREFIX');
  });

  it('승인 대행료는 월 원장 잠금 안에서 낸 견적의 회차 키로 · 승인 트랜잭션 안에서 차감한다 — ABA 무료 승인 · 차감만 남은 달 차단', () => {
    const src = readFileSync(path.join(__dirname, 'planner-approve.ts'), 'utf8');
    const fn = src.slice(src.indexOf('export async function approvePlannerEvent'), src.indexOf('export async function unapprovePlannerEvent'));
    const lockIdx = fn.indexOf('FOR UPDATE');
    const quoteIdx = fn.indexOf('const lockedQuote = await quoteEventApproval(ev, pending);');
    const deductIdx = fn.indexOf('await _deductWithClient(client, {');
    const commitIdx = fn.indexOf("await client.query('COMMIT')");
    expect(lockIdx).toBeGreaterThan(0);
    expect(lockIdx).toBeLessThan(quoteIdx);
    expect(quoteIdx).toBeLessThan(deductIdx);
    expect(deductIdx).toBeLessThan(commitIdx);
    expect(fn).toContain('idempotencyKey: lockedQuote.agency.key');
    // 견적의 회차는 잠금 안 원장 조회(planner-approval loadAgencyPaymentState)
    const confirm = readFileSync(path.join(__dirname, 'planner-confirm.ts'), 'utf8');
    expect(confirm).toContain('const pay = await loadAgencyPaymentState(ev.companyId, ev.planMonth);');
    // 월 상태로 선점하지 않는다(C1)
    expect(fn).not.toContain("status = 'approving'");
    // 취소도 잠금 안에서 회차를 계산한다
    const approval = readFileSync(path.join(__dirname, 'planner-approval.ts'), 'utf8');
    const cancel = approval.slice(approval.indexOf('export async function cancelMonthlyApproval'));
    expect(cancel.indexOf('FOR UPDATE')).toBeLessThan(cancel.indexOf('const cycle = Number(cycleRes'));
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
    expect(src).toContain("from './planner-copy'");
    expect(src).toContain("from './messageUtils'");
    expect(src).toContain("from './planner-audience'");
    expect(src).toContain("from './planner-channel-gate'");
    // 스팸 검사 CT는 문안 CT가 소유한다(CT-09) — 실행부는 재생성 없이(regenerate false) 부른다
    expect(readFileSync(path.join(__dirname, 'planner-copy.ts'), 'utf8')).toContain("from './spam-test-queue'");
    expect(src).toContain('regenerate: false');
    expect(src).not.toMatch(/msgType:\s*'KAKAO'/);
  });

  it('대조 워커는 생성 엔진을 부르지 않는다 — 문안·링크·승인 직후 스팸 패스는 놓친 실행 정리 뒤에 돈다(★ 2026-10-04)', () => {
    const rec = readFileSync(path.join(__dirname, 'planner-reconcile.ts'), 'utf8');
    expect(rec).not.toContain('runPlannerProductionPass');
    expect(rec).not.toContain('runPlannerDmReminderPass');
    expect(rec).not.toContain('generateFromBuildMaterials');
    const missedIdx = rec.indexOf('const missed = await closeMissed(');
    const copyIdx = rec.indexOf('await runPlannerCopyPass()');
    const linkIdx = rec.indexOf('await runPlannerReviewLinkPass()');
    const spamIdx = rec.indexOf('await runPostApprovalSpamPass()');
    expect(missedIdx).toBeGreaterThan(0);
    expect(missedIdx).toBeLessThan(copyIdx);
    expect(copyIdx).toBeLessThan(linkIdx);
    expect(linkIdx).toBeLessThan(spamIdx);
    // 전환 패스가 놓친 실행 정리보다 먼저(옛 승인 행사가 새 실행 조건에 걸려 조용히 미발송되지 않게)
    expect(rec.indexOf('await transitionLegacyEvents(today)')).toBeLessThan(missedIdx);
  });

  it('[다시 시작]은 상태 복원이다 — 승인 각인이 있는 보류·잠금만 되살리고, 효과가 없으면 성공으로 답하지 않는다', () => {
    const src = readFileSync(path.join(__dirname, 'planner-executor.ts'), 'utf8');
    const fn = src.slice(src.indexOf('export async function resumePlannerTouchpoint'));
    expect(fn).toContain("if (tp.status !== 'hold_credit' && tp.status !== 'locked') return 'unresumable';");
    expect(fn).toContain("if (!tp.execMeta?.approved) return 'unresumable';");
    expect(fn).toContain("['hold_credit', 'locked'],");
    expect(fn).toContain("return updated.includes(tp.id) ? 'ready' : 'unresumable';");
    const route = readFileSync(path.join(__dirname, '../routes/marketing-planner.ts'), 'utf8');
    expect(route).toContain("code: 'NOT_RESUMABLE'");
  });

  it('참여 토큰 서명 키에 기본값 폴백이 없다 — 코드에 적힌 문자열이 도장이면 위조가 성립한다', () => {
    const src = readFileSync(path.join(__dirname, 'planner-participation.ts'), 'utf8');
    expect(src).not.toContain('planner_join_default_secret');
    expect(src).toContain('function requireTokenSecret()');
    // 착지 검증은 던지지 않고 무효로 답한다 — 고객이 브라우저로 도착하는 자리다
    const verify = src.slice(src.indexOf('export function verifyJoinToken'));
    expect(verify).toContain('secret = requireTokenSecret();');
    expect(verify).toContain('return null;');
  });

  it('두 워커가 부팅 직후 한 번 돈다 — 재기동 공백이 곧 미발송이다', () => {
    for (const file of ['planner-executor.ts', 'planner-reconcile.ts']) {
      const src = readFileSync(path.join(__dirname, file), 'utf8');
      const fn = src.slice(src.indexOf('export function startPlanner'));
      const bootIdx = fn.indexOf('setTimeout(');
      const intervalIdx = fn.indexOf('setInterval(');
      expect(bootIdx).toBeGreaterThan(0);
      expect(bootIdx).toBeLessThan(intervalIdx);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════
// ★ 2026-09-02 문자 1통 + 모바일 DM 완성 게이트 (접수 cmtibk3d50694jnottwllnrbg · 임은지)
//   고정하는 계약:
//    ⑨ 같은 행사·같은 시점의 문자와 DM은 1통이다 — 문자가 캐리어, DM은 스스로 보내지 않는다.
//    ⑩ DM 초안은 자동 발행하지 않는다 — 담당자 완성·발행 뒤 빈 자리 0을 확인해야 문자에 실린다(fail-closed).
//    ⑪ 스팸 게이트는 링크가 붙은 최종 문안을 검사한다.
//    ⑫ 초안 대기 접점은 어떤 워커도 producing으로 옮기지 않는다 · 발행비는 플래너가 걷지 않는다.
// ═══════════════════════════════════════════════════════════════════
describe('문자 1통 — 시점 키와 발송 판정', () => {
  it('시점 키는 채널을 빼고 앵커·오프셋·대상만 본다(기입 중복 키와 같은 구성)', () => {
    expect(timingKey({ anchor: 'start' })).toBe('start:0:all');
    expect(timingKey({ anchor: 'start', offsetDays: 3 } as any)).toBe('start:0:all');
    expect(timingKey({ anchor: 'before_start', offsetDays: 5 })).toBe('before_start:5:all');
    expect(timingKey({ anchor: 'end', audience: 'participants' })).toBe('end:0:participants');
    expect(timingKey({ anchor: 'start' })).toBe(timingKey({ anchor: 'start', audience: 'all' }));
  });

  it('문자: DM 형제가 ready면 함께 싣고, 초안 대기면 기다리고, 보류·잠금·완료면 링크 없이 보낸다', () => {
    const sms = { channel: 'sms' as const, status: 'planned', stage: '' as const };
    expect(decideMessagingDispatch(sms, [])).toEqual({ action: 'send', attach: null });
    const ready = { id: 'dm1', channel: 'dm' as const, status: 'ready', stage: 'published' as const };
    expect(decideMessagingDispatch(sms, [ready])).toEqual({ action: 'send', attach: ready });
    for (const status of ['planned', 'producing']) {
      const d = decideMessagingDispatch(sms, [{ id: 'dm1', channel: 'dm', status, stage: 'drafted' }]);
      expect(d.action).toBe('wait');
    }
    for (const status of ['locked', 'hold_credit', 'skipped', 'sent']) {
      expect(decideMessagingDispatch(sms, [{ id: 'dm1', channel: 'dm', status, stage: 'drafted' }])).toEqual({ action: 'send', attach: null });
    }
  });

  it('DM: 문자 형제가 살아 있으면 실려 가고, 문자가 끝났으면 생략, 형제가 없으면 ready일 때만 스스로 보낸다', () => {
    const dmReady = { channel: 'dm' as const, status: 'ready', stage: 'published' as const };
    for (const status of ['planned', 'ready', 'producing', 'hold_credit', 'locked']) {
      expect(decideMessagingDispatch(dmReady, [{ id: 's1', channel: 'sms', status, stage: '' }]).action).toBe('carried');
    }
    expect(decideMessagingDispatch(dmReady, [{ id: 's1', channel: 'sms', status: 'sent', stage: '' }]).action).toBe('skip');
    expect(decideMessagingDispatch(dmReady, [{ id: 's1', channel: 'sms', status: 'skipped', stage: '' }]).action).toBe('skip');
    expect(decideMessagingDispatch(dmReady, [])).toEqual({ action: 'send', attach: null });
    expect(decideMessagingDispatch({ channel: 'dm', status: 'planned', stage: 'drafted' }, []).action).toBe('wait');
  });

  it('링크는 문자 끝에 한 번만 붙는다(재생성 콜백이 같은 문안을 다시 지나도 두 번 붙지 않는다)', () => {
    expect(appendDmLink('안내 문구\n\n', 'https://hlj.kr/abc')).toBe('안내 문구\nhttps://hlj.kr/abc');
    expect(appendDmLink('안내 문구\nhttps://hlj.kr/abc', 'https://hlj.kr/abc')).toBe('안내 문구\nhttps://hlj.kr/abc');
    expect(appendDmLink('안내 문구', '')).toBe('안내 문구');
  });

  it('링크가 붙는 발송은 지시문이 그 사실을 말하되 URL을 AI가 쓰지 못하게 한다', () => {
    const withLink = buildPlannerCopyObjective(EVENT, '메시징(문자)', '행사 시작일', { withDmLink: true });
    expect(withLink).toContain('모바일 페이지 주소가 자동으로 붙는다');
    expect(withLink).toContain('주소(URL)를 직접 쓰지 않는다');
    expect(buildPlannerCopyObjective(EVENT, '메시징(문자)', '행사 시작일')).not.toContain('자동으로 붙는다');
  });

  it('날짜 더하기는 KST 문자열 축이다', () => {
    expect(addDays('2026-08-31', 1)).toBe('2026-09-01');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
  });
});

describe('DM 완성 게이트 — 고객 화면의 빈 자리', () => {
  it('렌더된 화면에 남은 빈 자리 문구를 세고 요약한다', () => {
    const html = '<div class="dm-mood-slot">이미지를 추가해주세요</div><p>[직접 작성해주세요]</p><span>[직접 작성해주세요]</span><div>[리뷰를 추가해주세요]</div>';
    const residue = findDmPlaceholderResidue(html);
    expect(residue).toEqual(expect.arrayContaining([
      { label: '이미지', count: 1 }, { label: '직접 작성 문구', count: 2 }, { label: '리뷰', count: 1 },
    ]));
    expect(describeDmResidue(residue)).toContain('직접 작성 문구 2곳');
  });

  it('완성된 화면은 빈 자리 0 — 설문 답변칸 안내(placeholder 속성)는 빈 자리가 아니다', () => {
    expect(findDmPlaceholderResidue('<input placeholder="답변을 입력해주세요"><p>9월 생일 20% 추가 할인</p>')).toEqual([]);
    expect(findDmPlaceholderResidue('<script>showMsg("전화번호를 입력해주세요.")</script><p>완성</p>')).toEqual([]);
  });

  it('DM 단계는 exec_meta.dm_stage가 갖고 알 수 없는 값은 빈 단계다(옛 데이터 해석 · 전환 패스가 표식을 지운다)', () => {
    expect(dmStageOf({ dm_stage: 'drafted' })).toBe('drafted');
    expect(dmStageOf({ dm_stage: 'published' })).toBe('published');
    expect(dmStageOf({ dm_stage: 'weird' })).toBe('');
    expect(dmStageOf(null)).toBe('');
  });
});

describe('소스 계약 — 초안은 발행하지 않고, 검사 문안 = 발송 문안', () => {
  it('워커는 DM을 발행하지 않는다 — 발행은 사람이 누른 승인(planner-approve → dm-publish-core)뿐이다', () => {
    for (const f of ['planner-executor.ts', 'planner-reconcile.ts', 'planner-review.ts', 'planner-copy.ts']) {
      const src = readFileSync(path.join(__dirname, f), 'utf8');
      expect(src, f).not.toMatch(/\bpublishDm(Core)?\(/);
      expect(src, f).not.toContain('generateFromBuildMaterials');
    }
    expect(readFileSync(path.join(__dirname, 'planner-approve.ts'), 'utf8')).toContain('await publishDmCore(');
  });

  it('완성 판정은 렌더 문구와 섹션 데이터 두 축이다 — 렌더러가 문구를 안 찍는 빈 이미지 자리도 잡는다', () => {
    const sections = [
      { type: 'hero', treatment: 'split', props: { image_url: '' } },
      { type: 'hero', treatment: 'typographic', props: { image_url: '' } },
      { type: 'hero', props: { image_url: '' } },
      { type: 'gallery', props: { images: [{ url: '' }, { url: 'https://x/a.jpg' }] } },
      { type: 'slideshow', props: { slides: [{ image_url: '' }] } },
      { type: 'product_carousel', props: { products: [{ image_url: '' }, { image_url: 'https://x/p.jpg' }] } },
    ];
    const residue = findDmDataResidue(sections);
    expect(residue).toEqual(expect.arrayContaining([{ label: '이미지', count: 3 }, { label: '상품 이미지', count: 1 }]));
    expect(mergeDmResidue([{ label: '이미지', count: 1 }], [{ label: '이미지', count: 2 }, { label: '리뷰', count: 1 }]))
      .toEqual(expect.arrayContaining([{ label: '이미지', count: 3 }, { label: '리뷰', count: 1 }]));
    const prod = readFileSync(path.join(__dirname, 'planner-dm-check.ts'), 'utf8');
    const inspect = prod.slice(prod.indexOf('export async function inspectDmForCarry('));
    expect(inspect).toContain('findDmDataResidue(sections)');
    expect(inspect).toContain('DM_RESIDUE_NO_CONTENT');
  });

  it('캐리어 키는 발송 예정일 + 대상이다 — 1일 행사의 시작일 문자와 종료일 DM은 같은 날이다', () => {
    expect(carrierKey('2026-09-01', { anchor: 'start' })).toBe('2026-09-01:all');
    expect(carrierKey('2026-09-01', { anchor: 'end' })).toBe(carrierKey('2026-09-01', { anchor: 'start' }));
    expect(carrierKey('2026-09-01', { anchor: 'start', audience: 'participants' })).toBe('2026-09-01:participants');
    const exec = readFileSync(path.join(__dirname, 'planner-executor.ts'), 'utf8');
    expect(exec).toContain('carrierKey(s.scheduledOn, s.timing) === key');
  });

  it('같은 날의 문자와 DM은 같은 대상이다 — 1차는 참여자 축 입력을 전체로 확정한다(두 통 불가)', () => {
    const base = { title: '9월 생일', startsOn: '2026-09-01', endsOn: '2026-09-04', benefitText: '20% 추가 할인', products: [] };
    // ★ 2026-10-04 보강(설계서 Q6) — 참여 체인은 2차라 참여자 축 값이 와도 전체로 저장된다(대상이 갈릴 수 없다).
    const coerced = parsePlannerEventInput({
      ...base,
      touchpoints: [
        { channel: 'email', timing: { anchor: 'before_start', offsetDays: 5 } },
        { channel: 'sms', timing: { anchor: 'start' } },
        { channel: 'dm', timing: { anchor: 'start', audience: 'participants' } },
      ],
    });
    expect(coerced.ok).toBe(true);
    if (coerced.ok) expect(coerced.value.touchpoints.every((t) => !t.timing.audience)).toBe(true);
    const good = parsePlannerEventInput({
      ...base,
      touchpoints: [{ channel: 'sms', timing: { anchor: 'start' } }, { channel: 'dm', timing: { anchor: 'start' } }],
    });
    expect(good.ok).toBe(true);
    // 1일 행사: 시작일·종료일이 같은 날이라 같은 채널이 두 번이면 거부(실행부는 하루에 채널당 한 건만 싣는다)
    const oneDay = parsePlannerEventInput({
      ...base, startsOn: '2026-09-01', endsOn: '2026-09-01',
      touchpoints: [{ channel: 'sms', timing: { anchor: 'start' } }, { channel: 'dm', timing: { anchor: 'start' } }, { channel: 'dm', timing: { anchor: 'end' } }],
    });
    expect(oneDay.ok).toBe(false);
    if (!oneDay.ok) expect(oneDay.error).toContain('같은 날');
  });

  it('발송 직전 실물 확인의 축은 DM 존재다 — 승인 때 정해진 주소가 지금도 열리는지 두 번 본다(선점 직후 · 커밋 직전)', () => {
    const exec = readFileSync(path.join(__dirname, 'planner-executor.ts'), 'utf8');
    const check = exec.slice(exec.indexOf('async function dmStillOpen('), exec.indexOf('// ── 채널 실행'));
    expect(check).toContain("const dmTp = link.dm || (tp.channel === 'dm' ? tp : null)");
    expect(check).toContain('if (!dmTp.assetRef || !link.url) return false;');
    const core = exec.slice(exec.indexOf('async function executeMessagingCore('), exec.indexOf('/** 메일 — 승인 때'));
    expect((core.match(/await dmStillOpen\(tp, link\)/g) || []).length).toBe(2);
    expect((core.match(/await fingerprintsMatch\(tp, link, claim\)/g) || []).length).toBe(2);
  });

  it('문자·DM 쌍의 마감은 한 문장이다 — 보류·생략·잠금·발송 완료 · 되돌림 모두 한 문장', () => {
    const exec = readFileSync(path.join(__dirname, 'planner-executor.ts'), 'utf8');
    const endPair = exec.slice(exec.indexOf('async function endPair('), exec.indexOf('async function backToReview('));
    expect(endPair).toContain("await setTouchpointStates(tp.companyId, rows, ['producing'], claimToken)");
    const mark = exec.slice(exec.indexOf('async function markSent('), exec.indexOf('// ── 문자·DM 쌍 마감'));
    expect(mark).toContain('setTouchpointStates(tp.companyId, rows.filter');
    // 표식도 한 문장(동반 행 포함 · 이 실행이 주인일 때만)
    expect(exec).toContain('await stampSendAttemptOwned(tp.companyId, [tp.id, companion.id], claim.token,');
    // 되돌림(지문 어긋남 · 스팸 실패)은 쌍 전체를 한 트랜잭션으로(planner-review)
    const back = exec.slice(exec.indexOf('async function backToReview('), exec.indexOf('/** 예외(throw) 뒤 동반 DM 정리'));
    expect(back).toContain('const ids = [tp.id, ...(link.dm ? [link.dm.id] : [])];');
    expect(back).toContain('claimedIds: ids, failedIds: ids');
    // 대조 워커는 동반 행을 캐리어 결과로 확정 복구한다
    const rec = readFileSync(path.join(__dirname, 'planner-reconcile.ts'), 'utf8');
    expect(rec).toContain("const carriedBy = String(tp.execMeta?.carried_by || '')");
    expect(rec).toContain('recovered_from_carrier: true');
  });

  it('실행부는 각인된 문안에 실주소를 붙인 최종형을 재생성 없이 검사하고, 동반 DM은 같은 잠금에서 선점하며, 확정 실패는 표식을 걷는다', () => {
    const exec = readFileSync(path.join(__dirname, 'planner-executor.ts'), 'utf8');
    const composeIdx = exec.indexOf('const finalBody = appendDmLink(String(copy.text), link.url);');
    const gateIdx = exec.indexOf('const passed = await spamCheckPlannerCopy({');
    const commitIdx = exec.indexOf('await createDirectSendCampaign(');
    expect(composeIdx).toBeGreaterThan(0);
    expect(composeIdx).toBeLessThan(gateIdx);
    expect(gateIdx).toBeLessThan(commitIdx);
    // 검사한 문안 = 나가는 문안(같은 변수)
    expect(exec).toContain('message: finalBody,');
    // 당일 생성 · 재생성 콜백이 없다(§6-7)
    expect(exec).not.toContain('orchestrate(');
    expect(exec).not.toContain('generateMessages(');
    expect(exec).not.toContain('regenerateCallback');
    // 동반 선점 + heartbeat 동반
    expect(exec).toContain("companions = link.dm ? [{ id: link.dm.id, fromStatuses: ['ready'] }] : []");
    expect(exec).toContain('touchClaim(tp.companyId, claimIds)');
    // 확정 실패(잔액 부족 등)는 표식을 걷고, 그 밖은 표식을 유지한 채 잠근다
    expect(exec).toContain("DEFINITE_NO_COMMIT = new Set(['INSUFFICIENT_BALANCE'");
    expect(exec).toContain('await clearSendAttempt(tp, link.dm, String(e.code))');
    // 실행 대상 = 승인 각인 있는 ready만
    expect(exec).toContain("if (!fresh || fresh.status !== 'ready' || !fresh.execMeta?.approved) return 'not_due';");
    expect(exec).toContain("requireApproved: true");
  });

  it('"보냈는지 모르는" 행은 [다시 시작]이 되살리지 않는다 · 동반 형제 heartbeat · 결과 합계는 캠페인 단위로 한 번', () => {
    const exec = readFileSync(path.join(__dirname, 'planner-executor.ts'), 'utf8');
    const resume = exec.slice(exec.indexOf('export async function resumePlannerTouchpoint'));
    expect(resume).toContain("if (tp.execMeta?.send_started_at && !tp.execRef && tp.channel !== 'email') return 'unresumable';");
    const ledger = readFileSync(path.join(__dirname, 'planner-touchpoint.ts'), 'utf8');
    expect(ledger).toContain("WHERE id = ANY($1::uuid[]) AND company_id = $2::uuid AND status = 'producing'");
    const report = readFileSync(path.join(__dirname, 'planner-report.ts'), 'utf8');
    expect(report).toContain('countedCampaigns');
    // 미승인 행사의 접점도 놓친 실행으로 닫는다(★ 2026-10-04 §6-8 · 옛: 승인된 행사만 봐서 조용히 남았다)
    const rec = readFileSync(path.join(__dirname, 'planner-reconcile.ts'), 'utf8');
    expect(rec).toContain("const MISSED_EVENT_STATUS = ['approved', 'producing', 'scheduled', 'done', 'briefed', 'draft', 're_brief'];");
    expect(rec).toContain("missed_reason: approved ? 'missed' : 'not_approved'");
  });
});
