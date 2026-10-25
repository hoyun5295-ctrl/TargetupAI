/**
 * 자동 마케팅 한 줄 · 질문 · 결함 닫기 (★ 2026-10-24 · 설계서 docs/2026-10-24-automarketing-oneline-design.md)
 *
 * Harold 1024 「한 줄로 더 쉽게 · 부족한 건 AI 가 질문을 통해 완벽하게 채우기」 + 구조체크 결함 16 + 회의론자 최종 검증 16.
 * 못 박는 것:
 *   - 질문 갈래 = 닫힌 목록 ①~⑥(순수 · AI 0) · 답은 서버 질문표로만 · 미리 고른 답 0
 *   - 나가는 문안 = 한 함수(혜택 치환 · LMS 승격 · 080) · 지문 = 회신번호 · 080 · 채널 · 제목 · 본문 · 관문 = 통과 지문 또는 사람 승인 지문
 *   - 보낼 안 = 사람이 고른 안 → 통과 안 → 저장된 추천 안 → 0(무작위 표집 0)
 *   - 등록 = 차감 먼저 → INSERT(id = 요청 키 · 승인 기간 같은 문장) → 확정일 때만 COMMIT
 *   - 회차 발송 크레딧 = 보내기 직전 엄격 차감 · 마이너스 0 · 보내지 못한 시도는 되돌림
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { buildOperatorQuestions, decideOperatorAnswers, datedTerms, objectiveForRounds, type OperatorQuestionFacts } from '../automarketing-interview';
import { operatorFinalCopy, operatorFinalCopyAt, proposalSendIndex, finalCopyCleared, copyFingerprint } from '../operator-final-copy';
import { pickAnswer } from '../one-line-ct/questions';
import { listenLine } from '../one-line-ct/listen';
import { lineBenefitPrefill, lineBenefitFragments } from '../one-line-facts';
import { clampToSendableTime, parseTimeFromText } from '../autosend-policy';
import { creditOverageAllowance } from '../ai-credit-tx';

const SRC = (...p: string[]) => readFileSync(join(__dirname, '..', '..', ...p), 'utf8').replace(/\r\n/g, '\n');

const AXES = [
  { key: 'vip', label: '상위 등급 고객', available: true, reason: '' },
  { key: 'birthday', label: '생일 고객', available: false, reason: '고객 생일 정보가 아직 없어요.' },
];
const base = (over: Partial<OperatorQuestionFacts> = {}): OperatorQuestionFacts => ({
  translation: { kind: 'axis', segmentKey: 'vip', segmentParams: {}, label: '상위 등급 고객', description: '', mapped: true } as any,
  axes: AXES, everyoneCount: 1200, schedule: 'monthly',
  benefitAsk: null, callbackCandidates: null, adminPhoneMissing: false, ...over,
});

describe('질문표 = 닫힌 목록 ①~⑥(순수)', () => {
  it('다 정해지면 질문 0', () => {
    expect(buildOperatorQuestions(base())).toEqual([]);
  });
  it('① 칸을 못 정한 말 = 값 있는 칸만 · 빈 칸은 자물쇠 + 사유 · 미리 고른 답 0', () => {
    const qs = buildOperatorQuestions(base({
      translation: { kind: 'needs_choice', conditions: [], unresolved: [{ term: '단골' }], options: [
        { field: 'purchase_count', label: '구매 횟수', kind: 'standard', dataType: 'number', fillCount: 900, samples: ['1', '12'] },
        { field: 'points', label: '포인트', kind: 'standard', dataType: 'number', fillCount: 0, samples: [], disabled: true },
      ] } as any,
    }));
    expect(qs).toHaveLength(1);
    expect(qs[0]).toMatchObject({ id: 'field:단골', kind: 'choice', required: true });
    expect(qs[0].recommended).toBeUndefined();
    expect(qs[0].options![1]).toMatchObject({ disabled: true, reason: '값 있는 고객이 없어 고를 수 없어요.' });
  });
  it('② 조건 없음 · 번역 실패 · AI 가 고른 「전체 고객」 = 묻는다(전체는 맨 끝 · 짝에 막히면 「매월로」 보기)', () => {
    for (const translation of [
      { kind: 'blocked', code: 'NO_CONDITION', reason: '' },
      { kind: 'blocked', code: 'TRANSLATE_FAILED', reason: '' },
      { kind: 'axis', segmentKey: 'all', segmentParams: {}, label: '전체 고객', description: '', mapped: true },
    ]) {
      const q = buildOperatorQuestions(base({ translation: translation as any }));
      expect(q.map((x) => x.id)).toEqual(['audience']);
      expect(q[0].options!.map((o) => o.value)).toEqual(['axis:vip', 'axis:birthday', 'axis:all']);
      expect(q[0].options![2].label).toBe('수신 동의한 전체 고객 · 1,200명');
    }
    // 사람이 고른 전체(mapped false) = 묻지 않는다
    expect(buildOperatorQuestions(base({ translation: { kind: 'axis', segmentKey: 'all', segmentParams: {}, label: '전체 고객', description: '', mapped: false } as any }))).toEqual([]);
    // 매주면 전체 · VIP(반복 축)는 잠그지 않고 「매월로 보내요」 보기(답할 수 없는 질문 0 · Codex 1R) · 데이터 없는 축만 자물쇠
    const weekly = buildOperatorQuestions(base({ schedule: 'weekly', translation: { kind: 'blocked', code: 'NO_CONDITION', reason: '' } as any }));
    expect(weekly[0].options!.map((o) => [o.value, !!o.disabled])).toEqual([['axis:vip|monthly', false], ['axis:birthday', true], ['axis:all|monthly', false]]);
    expect(weekly[0].options![0].label).toBe('상위 등급 고객 · 매월로 보내요');
    expect(decideOperatorAnswers(weekly, { audience: 'axis:vip|monthly' })).toEqual({ ok: true, patch: { fields: {}, segmentKey: 'vip', schedule: 'monthly' } });
  });
  it('③ 매주 + 반복 축 = 묻는다(사람이 쓴 주기든 추천 주기든 · 질문 표시와 안전 검증이 같은 판정)', () => {
    const q = buildOperatorQuestions(base({ schedule: 'weekly' }));
    expect(q[0]).toMatchObject({ id: 'schedule' });
    expect(q[0].options!.map((o) => [o.value, !!o.disabled])).toEqual([['monthly', false], ['axis:grade_up', false], ['keep', true]]);
  });
  it('④ 혜택 · ⑤ 회신번호(후보 둘 이상만) · ⑥ 알림 번호', () => {
    const q = buildOperatorQuestions(base({
      benefitAsk: { reason: 'mixed', prefill: '20% 할인' }, callbackCandidates: ['0212345678', '0311234567'], adminPhoneMissing: true,
    }));
    expect(q.map((x) => x.id)).toEqual(['benefit', 'callback', 'admin_phone']);
    expect(q[0]).toMatchObject({ kind: 'text', recommended: '20% 할인', noneLabel: '혜택 없이 보내기' });
    expect(q[1].options!.map((o) => o.label)).toEqual(['02-1234-5678', '031-123-4567']);
    expect(buildOperatorQuestions(base({ callbackCandidates: ['0212345678'] }))).toEqual([]);
  });
});

describe('답 = 서버 질문표로만 검증', () => {
  const qs = buildOperatorQuestions(base({
    translation: { kind: 'blocked', code: 'NO_CONDITION', reason: '' } as any,
    benefitAsk: { reason: 'missing', prefill: null }, adminPhoneMissing: true,
  }));
  it('보기 밖 · 잠긴 값 · 빈 필수 = 거절', () => {
    expect(decideOperatorAnswers(qs, { audience: 'axis:nope', benefit: '', admin_phone: '01012345678' })).toMatchObject({ ok: false });
    expect(decideOperatorAnswers(qs, { audience: 'axis:birthday', benefit: '', admin_phone: '01012345678' })).toMatchObject({ ok: false, error: '고객 생일 정보가 아직 없어요.' });
    expect(decideOperatorAnswers(qs, { benefit: '', admin_phone: '01012345678' })).toMatchObject({ ok: false });
  });
  it('혜택 없이 = 빈 답(채워 둔 글로 되돌리지 않는다) · 혜택 글의 날짜 = 거절 · 휴대폰 형식', () => {
    expect(decideOperatorAnswers(qs, { audience: 'axis:vip', benefit: '', admin_phone: '010-1234-5678' })).toEqual({ ok: true, patch: { fields: {}, segmentKey: 'vip', benefit: null, adminPhone: '01012345678' } });
    expect(decideOperatorAnswers(qs, { audience: 'axis:vip', benefit: '2026.10.25 까지 30% 할인', admin_phone: '01012345678' })).toMatchObject({ ok: false });
    expect(decideOperatorAnswers(qs, { audience: 'axis:vip', benefit: '30% 할인', admin_phone: '1588' })).toMatchObject({ ok: false });
  });
  it('pickAnswer — 채워 둔 답 · 「없이」 단추', () => {
    const q = { id: 'b', kind: 'text' as const, label: '혜택?', recommended: '30% 쿠폰', required: true, noneLabel: '없이' };
    expect(pickAnswer(q, {})).toEqual({ ok: true, value: '30% 쿠폰' });
    expect(pickAnswer(q, { b: '' })).toEqual({ ok: true, value: '' });
  });
});

describe('한 줄 표본(혜택 갈래 · 사람 글만)', () => {
  it('「생일 고객에게 30% 할인 쿠폰」 = 채움(질문 0) · 「30% 쿠폰」도 허용 꼴', () => {
    expect(listenLine('생일 고객에게 30% 할인 쿠폰').benefit).toBe('30% 할인 쿠폰');
    expect(lineBenefitPrefill('30% 쿠폰 보내줘')).toBe('30% 쿠폰');
  });
  it('「주말 세일 안내 보내줘」 = 행사 말 · 값 없음(④ 묻기)', () => {
    expect(listenLine('주말 세일 안내 보내줘').gaps.benefit).toBe(true);
  });
  it('「VIP만 20% 할인」 = 조건이 섞여 채우지 않는다 · 사람 글 조각(원문의 부분 문자열)', () => {
    const line = 'VIP만 20% 할인';
    expect(lineBenefitPrefill(line)).toBeNull();
    expect(lineBenefitFragments(line)).toBe('20% 할인');
  });
  it('「매주 VIP에게 신상품 소식」 = 혜택 질문 0(행사 말 아님)', () => {
    const i = listenLine('매주 VIP에게 신상품 소식');
    expect(i.gaps.benefit).toBe(false);
    expect(i.concreteBenefit).toBe(false);
  });
  it('AI 가 쓴 목표(오늘의 추천 · 캘린더) = 읽은 조각 취급 — 숫자 혜택을 채우지 않는다', () => {
    const line = '가을 시즌 20% 할인 이벤트 안내';
    const i = listenLine(line, { reads: [line] });
    expect(i.benefit).toBeNull();
    expect(i.typed).toBe('');
  });
});

describe('날짜 말 · 시각', () => {
  it('날짜를 가리키는 말만 뺀다(상대 말은 남긴다 · 연 1회는 월일 유지)', () => {
    expect(datedTerms('10월 25일까지 신상 30% 할인 · 이번 주 한정')).toEqual(['10월 25일']);
    expect(datedTerms('2026.12.25 크리스마스 12월 25일 쿠폰', 'yearly')).toEqual(['2026.12.25']);
    expect(objectiveForRounds('10월 25일까지 신상 30% 할인', 'monthly')).toBe('까지 신상 30% 할인');
    expect(objectiveForRounds('12월 25일 크리스마스 쿠폰', 'yearly')).toBe('12월 25일 크리스마스 쿠폰');
  });
  it('시각 = 주기 말이 없어도 읽는다 · 발송 가능 시간 밖이면 옮긴다', () => {
    expect(parseTimeFromText('VIP에게 오후 3시 30분 소식')).toBe('15:30');
    expect(parseTimeFromText('3시간 특가')).toBeNull();
    expect(clampToSendableTime('22:00', 8, 21)).toEqual({ time: '20:00', moved: true });
    expect(clampToSendableTime('06:30', 8, 21)).toEqual({ time: '08:00', moved: true });
    expect(clampToSendableTime('09:30', 8, 21)).toEqual({ time: '09:30', moved: false });
  });
});

describe('나가는 문안 한 함수 · 지문 · 관문', () => {
  const ctx = { benefit: '30% 쿠폰', opt080: '0801234567', callback: '0212345678' };
  const pj = { channel: { recommended: 'SMS' }, messages: [{ body: '생일 축하드려요 [혜택 내용]' }, { body: 'B안' }, { body: 'C안' }] };
  it('혜택 치환 · (광고) · 080 · 자리 없음', () => {
    const f = operatorFinalCopyAt(pj, 0, ctx)!;
    expect(f.body).toBe('생일 축하드려요 30% 쿠폰');
    expect(f.sent).toContain('(광고)');
    expect(f.sent).toContain('0801234567');
    expect(f.placeholderLeft).toBe(false);
    expect(operatorFinalCopyAt(pj, 0, { ...ctx, benefit: null })!.placeholderLeft).toBe(true);
  });
  it('90바이트 넘으면 LMS(혜택이 늘린 글도) · 지문 = 혜택 · 080 · 회신번호마다 다르다', () => {
    const long = { ...pj, messages: [{ body: '가'.repeat(40) + '[혜택]' }] };
    expect(operatorFinalCopyAt(long, 0, { ...ctx, benefit: '나'.repeat(10) })!.msgType).toBe('LMS');
    const a = operatorFinalCopyAt(pj, 0, ctx)!.fingerprint;
    expect(operatorFinalCopyAt(pj, 0, { ...ctx, benefit: '40% 쿠폰' })!.fingerprint).not.toBe(a);
    expect(operatorFinalCopyAt(pj, 0, { ...ctx, opt080: '0809999999' })!.fingerprint).not.toBe(a);
    expect(operatorFinalCopyAt(pj, 0, { ...ctx, callback: '0311111111' })!.fingerprint).not.toBe(a);
  });
  it('보낼 안 = 고른 안 → 통과 안 → 저장된 추천 → 0', () => {
    expect(proposalSendIndex(pj)).toBe(0);
    expect(proposalSendIndex({ ...pj, recommendedIndex: 2 })).toBe(2);
    expect(proposalSendIndex({ ...pj, recommendedIndex: 2, spamCheck: { passedIndex: 1 } })).toBe(1);
    expect(proposalSendIndex({ ...pj, recommendedIndex: 2, spamCheck: { passedIndex: 1 }, userSelection: { variantIndex: 0 } })).toBe(0);
    expect(proposalSendIndex({ ...pj, userSelection: { variantIndex: 9 } })).toBe(0);
  });
  it('사람 편집은 그 안을 고른 편집일 때만 · 편집 글에도 혜택 치환', () => {
    const f = operatorFinalCopy({ ...pj, userSelection: { variantIndex: 1, body: '고친 글 [혜택]' } }, ctx)!;
    expect(f).toMatchObject({ variantIndex: 1, body: '고친 글 30% 쿠폰' });
  });
  it('관문 = 통과 지문 또는 사람 승인 지문 = 지금 지문 · 옛 행(지문 없음)은 혜택 자리 없을 때만', () => {
    const f = operatorFinalCopyAt(pj, 0, ctx)!;
    expect(finalCopyCleared({ ...pj, spamCheck: { fp: f.fingerprint } }, f)).toEqual({ ok: true });
    expect(finalCopyCleared({ ...pj, approvedFp: f.fingerprint }, f)).toEqual({ ok: true });
    expect(finalCopyCleared({ ...pj, spamCheck: { fp: 'old' } }, f)).toMatchObject({ ok: false });
    expect(finalCopyCleared(pj, f)).toMatchObject({ ok: false });   // 옛 행인데 검사한 안에 혜택 자리가 있었다
    const plain = operatorFinalCopyAt({ ...pj, messages: [{ body: '자리 없는 글' }] }, 0, ctx)!;
    expect(finalCopyCleared({ ...pj, messages: [{ body: '자리 없는 글' }] }, plain)).toEqual({ ok: true });
  });
});

describe('원문 계약 — 등록 · 발송 돈 · 닫기 · 승인', () => {
  const co = SRC('utils', 'continuous-operator.ts');
  const reg = co.slice(co.indexOf('export async function registerOperator('), co.indexOf('/**\n * ★ 2026-10-24 결함 5 — 운영자 예산 사용액 한 곳'));
  it('등록 = 시연 판정 → BEGIN → 차감(첫 문장) → INSERT ON CONFLICT (id) → 확정일 때만 COMMIT · 등록 기록 같은 트랜잭션', () => {
    const order = ['const demo = await isDemoCompany(input.companyId);', "await client.query('BEGIN');", 'await _deductWithClient(client, {', 'const ins = await client.query(insertSql, insertParams);', "await client.query('COMMIT');"]
      .map((x) => reg.indexOf(x));
    expect(order.every((x) => x > 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(reg).toContain('ON CONFLICT (id) DO NOTHING RETURNING *');
    expect(reg).toContain("charged = d.deducted || d.skipReason === 'duplicate' || d.skipReason === 'not_applicable';");
    expect(reg).toContain('await markCalendarRegistrationWith(client, input.companyId, opts.calendarMonth, opts.id);');
    expect(reg).toContain("winCols = ', approved_until, approval_meta';");
    expect(co).not.toContain('export async function createOperator(');
    expect(co).not.toMatch(/checkCredit\(input\.companyId/);
  });
  it('회차 발송 크레딧 = 표식 뒤 · 캠페인 생성 앞 엄격 차감 · 키 = 제안 · 적재 묶음 · 발송 뒤 차감 · 정산 표식 0', () => {
    const disp = co.slice(co.indexOf('async function dispatchProposalSend('), co.indexOf('export async function hasOperatorV2Columns('));
    const mark = disp.indexOf("'{meta,sendStagingId}'");
    const charge = disp.indexOf('const sendCharge = await deductCreditOutcome({');
    const create = disp.indexOf('const res = await createDirectSendCampaign(');
    expect(mark).toBeGreaterThan(0);
    expect(charge).toBeGreaterThan(mark);
    expect(create).toBeGreaterThan(charge);
    expect(disp).toContain('idempotencyKey: `continuous-operator-send:${proposalId}:${stagingId}`, throwOnInsufficient: true,');
    expect(disp).not.toContain('deductCreditSafe(');
    expect(disp).not.toContain('clearChargePendingMarker(');
    expect(co.slice(co.indexOf('function buildProposalSendMarkerSql('), co.indexOf('function buildProposalSendMarkerSql(') + 600)).not.toContain("'{meta,chargePending}'");
    expect(creditOverageAllowance({ plan_credits: 100, billing_type: 'prepaid' }, 'continuous-operator-send')).toBe(0);
    expect(creditOverageAllowance({ plan_credits: 100, billing_type: 'postpaid', overage_limit: 500 }, 'continuous-operator-send')).toBe(0);
  });
  it('되돌림 = 캠페인 없음 · 그 묶음으로 발송 중 아님 · 30분 · release: 키 — 거르는 조건은 모두 LIMIT 앞(Codex 1R)', () => {
    const rel = co.slice(co.indexOf('async function releaseUnsentSendCharges('), co.indexOf("/** 'sending'에 정지된 제안 복구"));
    expect(rel).toContain("AND t.created_at < NOW() - INTERVAL '30 minutes'");
    const camp = rel.indexOf("AND NOT EXISTS (SELECT 1 FROM campaigns c WHERE c.company_id = t.company_id AND c.staging_id::text = split_part(t.idempotency_key, ':', 3))");
    const live = rel.indexOf("AND op.status = 'sending' AND op.proposal_json->'meta'->>'sendStagingId' = split_part(t.idempotency_key, ':', 3))");
    expect(camp).toBeGreaterThan(0);
    expect(live).toBeGreaterThan(camp);
    expect(live).toBeLessThan(rel.indexOf('LIMIT 20'));
    expect(rel).not.toContain('const camp = await query(');   // 고른 뒤 JS 에서 다시 거르지 않는다(자리 차지의 뿌리)
    expect(rel).toContain('idempotencyKey: `release:${key}`, originalIdempotencyKey: key,');
  });
  it('통과 지문 = 검사한 모양(검사 채널 · 검사 본문) · 재생성 글이 다른 채널이면 통과 0 · 지문 번호 = 발송 번호(Codex 1R)', () => {
    const base = { callback: '0212345678', opt080: '0801234567', msgType: 'SMS', subject: '', body: '안녕하세요' };
    expect(copyFingerprint(base)).toBe(copyFingerprint({ ...base, callback: '02-1234-5678', subject: '무시' }));   // SMS 제목 · 번호 꼴 무관
    expect(copyFingerprint(base)).not.toBe(copyFingerprint({ ...base, msgType: 'LMS' }));
    expect(copyFingerprint(base)).not.toBe(copyFingerprint({ ...base, callback: '' }));
    const round = co.slice(co.indexOf('const copyCtx = { benefit: operator.benefitContent'), co.indexOf('const saved = await query('));
    expect(round).toContain('if (!shown?.body || shown.msgType !== testType) return null;');
    expect(round).toContain('fp: passedFinal && passedTested');
    expect(round).toContain('copyFingerprint({ callback: copyCtx.callback, opt080: copyCtx.opt080, msgType: testType,');
    expect(round).not.toContain('?.fingerprint ?? null');
  });
  it('짝 = 등록 직전 마지막 문(질문 표시와 별개 · 400) · 추천 주기는 대상이 바뀔 때마다 다시 정한다 · 같은 화면 키라도 본문이 다르면 새 보관본(Codex 1R)', () => {
    const regAt = co.indexOf('export async function registerOperator(');
    const reg = co.slice(regAt, co.indexOf('\nexport ', regAt + 10));
    expect(reg).toContain('const pair = checkSchedulePairing(schedule, segKey ? { segmentKey: segKey } : { hasConditions: true });');
    expect(reg).toContain('if (!pair.ok) throw new OperatorPairingError(pair.reason);');
    expect(reg.indexOf('throw new OperatorPairingError')).toBeLessThan(reg.indexOf('BEGIN'));
    // 편집 · 승인 저장 = 행을 잠그는 같은 함수 · 저장과 같은 트랜잭션(Codex 2R · 잠그지 않은 조회 0)
    const lock = co.slice(co.indexOf('async function lockAndCheckPairing('), co.indexOf('export async function registerOperator('));
    expect(lock).toContain('FOR UPDATE');
    expect(lock).toContain('const changed = schedule !== now.schedule || key !== nowKey;');
    const upAt = co.indexOf('export async function updateOperator(');
    const up = co.slice(upAt, co.indexOf('\nexport ', upAt + 10));
    expect(up).toContain("await withTransaction(async (run) => (");
    expect(up).toContain("(await lockAndCheckPairing(run, companyId, operatorId, { schedule: patch.schedule, segmentKey: withSegmentSet ? segFinalKey : undefined }, 'changed'))");
    expect(up).toContain('? runUpdate(withSegmentSet && segColumnsReady, run) : null))');
    expect(up).not.toContain('checkSchedulePairing(');
    const apAt = co.indexOf('export async function approveOperatorWindow(');
    const ap = co.slice(apAt, co.indexOf('\n}\n', apAt));
    expect(ap).toContain("}, 'always', input.seenSchedule);");
    // 일정 비교 = 잠근 직후 · 짝 판정 앞(Codex 4R)
    expect(lock.indexOf('throw new OperatorScheduleChangedError()')).toBeGreaterThan(lock.indexOf('FOR UPDATE'));
    expect(lock.indexOf('throw new OperatorScheduleChangedError()')).toBeLessThan(lock.indexOf('checkSchedulePairing('));
    expect(ap).not.toMatch(/await query\(\s*`UPDATE continuous_operators/);
    const pv = SRC('utils', 'automarketing-preview.ts');
    expect(pv).toContain('schedule: e.scheduleAnswered ? { schedule: e.input.schedule as any, scheduleDayOfWeek: e.input.scheduleDayOfWeek ?? null, scheduleDayOfMonth: e.input.scheduleDayOfMonth ?? null } : null,');
    expect(pv.slice(pv.indexOf('async function applyAnswers('), pv.indexOf('export async function updateOperatorPreview('))).toContain('e.scheduleAnswered = true;');
    expect(pv).toContain("if (err instanceof OperatorPairingError) return { status: 400,");
    const bd = pv.slice(pv.indexOf('function birthdayDefault('), pv.indexOf('function readLineBenefit('));
    expect(bd).toContain('if (e.scheduleWritten) return;');
    expect(bd).toContain("} else if (e.input.schedule !== 'monthly') {");
    expect(pv).toContain('if (hitId && hit && !hit.operatorId && hit.bodyPrint === bodyPrint) return shown(');
  });
  it('발송 관문 = 최종 문안 → 혜택 자리 → 지문 · 문구 「발송을 시작했어요」', () => {
    const disp = co.slice(co.indexOf('async function dispatchProposalSend('), co.indexOf('export async function hasOperatorV2Columns('));
    expect(disp).toContain("const final = operatorFinalCopy(pj, { benefit: op.benefit_content, opt080: opt080Now, callback: callback || '' });");
    expect(disp).toContain('const clear = finalCopyCleared(pj, final);');
    expect(disp.indexOf('const clear = finalCopyCleared(pj, final);')).toBeLessThan(disp.indexOf('stagingId = randomUUID();'));
    expect(disp).toContain('발송을 시작했어요(');
    expect(disp).not.toContain('발송을 완료했습니다');
  });
  it('중지 · 보관 = 열린 제안 전부 닫기 · 승인 선점 = 보관된 운영자 0 · 승인 = 안 번호 + 지문 · 사람 승인 지문', () => {
    expect(co).toContain("WHERE operator_id = $1::uuid AND status IN ('scheduled', 'pending', 'admin_review') RETURNING id`,");
    // ★ 1025 #23 — 중지 · 보관 두 자리 = 닫기 + 실패 시 재시도 · 통지(한 함수)
    expect((co.match(/await closeOpenProposalsOrNotify\(\{/g) || []).length).toBe(2);
    expect(co).toContain('try { await closeOpenProposals(op.id, reason); return; }');
    expect(co).not.toContain('cancelScheduledProposalsForOperator(');
    const ap = co.slice(co.indexOf('export async function approveProposal('), co.indexOf('export async function recheckOpenProposals('));
    expect(ap).toContain("AND EXISTS (SELECT 1 FROM continuous_operators o WHERE o.id = operator_proposals.operator_id AND o.status <> 'archived')");
    expect(ap).toContain("if (fingerprint !== shownFinal.fingerprint) {");
    expect(ap).toContain("'{approvedFp}', to_jsonb($5::text), true)");
  });
  it('혜택 · 회신번호 · 승인 기간 세 곳 = 열린 제안 재검사(통과 지문 CAS)', () => {
    expect((co.match(/void recheckOpenProposals\(/g) || []).length).toBe(2);
    const rc = co.slice(co.indexOf('export async function recheckOpenProposals('), co.indexOf('export async function rejectProposal('));
    expect(rc).toContain("WHERE id = $1::uuid AND proposal_json->'systemRecheck'->>'token' = $2");
    expect(rc).toContain('maxRetries: 0,');
  });
  it('예산 합계 = 한 함수', () => {
    expect(co).not.toMatch(/SUM\(cost_estimate\)/);
    expect((co.match(/operatorSpendSql\('o', /g) || []).length).toBe(10);
  });
  it('회차 문안의 혜택 근거 = 사람 칸 · 목표의 날짜 말은 생성 입력에서만 뺀다', () => {
    expect(co).toContain("benefitLicense: buildLineEventText('', { benefit: op.benefitContent || null }),");
    expect(co).toContain('objective: objectiveForRounds(op.objective, op.schedule),');
  });
  it('공용 문안 프롬프트 모순 0(080 끝줄 좋은 예 · 「특별한 날 · 특별한 기회」)', () => {
    const ai = SRC('services', 'ai.ts');
    const prompt = ai.slice(ai.indexOf('const BRAND_SYSTEM_PROMPT = `'), ai.indexOf('카카오만: 이모지 사용 가능'));
    expect(prompt).not.toMatch(/080-\d/);
    expect(ai).not.toContain('특별한 기회');
    expect(ai).not.toContain('특별한 날이에요');
  });
  it('여정과 같은 주인 판정 한 함수(owner-scope)', () => {
    expect(SRC('utils', 'journey-access.ts')).toContain('ownOnly: resolveOwnerScope(req) !== null');
    expect(SRC('utils', 'operator-route.ts')).toContain("import { journeyViewerOf, type JourneyViewer } from './journey-access';");
  });
  it('브리핑 = 오늘 · 어제 것만', () => {
    // ★ 1025 — 날짜 조건 한 곳(daily-brief-policy) · 브리핑 주소와 한 줄 물어보기가 같은 값
    expect(SRC('utils', 'daily-brief-policy.ts')).toContain("export const CURRENT_BRIEF_DATE_SQL = `brief_date >= (NOW() AT TIME ZONE 'Asia/Seoul')::date - 1`;");
    expect(SRC('routes', 'ai.ts')).toContain('WHERE company_id = $1::uuid AND ${CURRENT_BRIEF_DATE_SQL}');
  });
});

describe('화면 계약 — 한 창 · 질문 부품 · 돈 한 곳 · 흉내 0', () => {
  const FE = (...p: string[]) => readFileSync(join(__dirname, '..', '..', '..', '..', 'frontend', 'src', ...p), 'utf8').replace(/\r\n/g, '\n');
  const modal = FE('components', 'automarketing', 'OperatorPreviewModal.tsx');
  const page = FE('pages', 'ContinuousOperatorPage.tsx');
  const card = FE('components', 'automarketing', 'ProposalDecisionCard.tsx');
  it('창 = 공용 껍데기 · 이 창만 배경 · Esc 닫힘 0(껍데기는 그대로 · N7 = BUGS 등재) · 창 자체 키 처리 0', () => {
    expect(modal).toContain('<JourneyModalShell open={open} onClose={onClose} labelledBy="am-preview-title"');
    expect(modal).toContain('disableDismiss>');
    expect(modal).not.toContain("addEventListener('keydown'");
    expect(FE('components', 'journey', 'JourneyModalShell.tsx')).toContain('if (e.target === e.currentTarget && !disableDismiss) onClose();');
  });
  it('질문 한 줄 = 공용 부품(두 창이 같이 쓴다)', () => {
    expect(modal).toContain("import ZoneQuestion, { type ZoneQuestionModel } from '../zone/ZoneQuestion';");
    expect(FE('components', 'journey', 'map', 'InterviewModal.tsx')).toContain("import ZoneQuestion from '../../zone/ZoneQuestion';");
  });
  it('금액 = 서버 값(화면 상수 import 0) · 유료 버튼 = 앰버 한 상수 · 크레딧 확인 창 0', () => {
    expect(modal).not.toContain('constants/credit');
    expect(modal).toContain('const startCost = d?.costs.start ?? 0;');
    expect(modal).toContain('MK_BTN_PAY');
    expect(page).not.toContain('CreditConfirmModal');
  });
  it('화면에서 바로 등록하는 길 0(POST /operator/continuous = 캘린더 전용 · 요청 키)', () => {
    expect(page).not.toMatch(/fetch\('\/api\/ai\/operator\/continuous', \{\s*method: 'POST'/);
    const cal = FE('pages', 'MarketingCalendarPage.tsx');
    expect(cal).toContain('request_key: monthKeys.current.keyFor(`month:${e.month}`),');
    expect(cal).toContain('monthKeys.current.settled(`month:${e.month}`);');
  });
  it('카드 = 서버 나가는 글만 · 승인 = 늘 안 번호 + 지문 · 인자 없는 승인 0 · 배경 닫힘 0 · 출처 이탤릭 0', () => {
    expect(card).not.toContain('buildAdMessageFront');
    expect(card).not.toContain('onApprove();');
    expect(card).toContain('fingerprint: effectiveFinal.fingerprint,');
    expect(card).not.toContain('onMouseDown={(e) => { if (e.target === e.currentTarget) onToggleExpand(); }}');
    expect(card).not.toMatch(/italic/);
    expect(card).not.toContain('tone="dark"');
  });
  it('사용자에게 보이는 「세부 설정에서」 0(창 · 서버 미리보기 · 대상 번역 문구)', () => {
    expect(modal).not.toMatch(/세부 설정에서 (대상|발송|「)/);
    expect(SRC('utils', 'audience-translate.ts')).not.toContain('세부 설정에서');
    expect(SRC('utils', 'automarketing-preview.ts')).not.toMatch(/'[^']*세부 설정에서[^']*'/);
  });
  it('자연어 시작 = 「타겟 · AI가 자동으로 잡습니다」 칩 줄 0 · 영문 토스트 0', () => {
    const nl = FE('components', 'automarketing', 'NaturalLanguageStart.tsx');
    expect(nl).not.toContain('AUTO_ITEMS');
    expect(page).not.toContain('Predictive에서');
  });
});
