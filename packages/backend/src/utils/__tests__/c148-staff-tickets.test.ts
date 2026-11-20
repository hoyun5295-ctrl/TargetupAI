// replaces: none
/**
 * C148 그룹웨어 접수 세 건 — 계약 시험(★ 2026-11-20 · 설계서 docs/2026-11-20-c148-staff-tickets-three-design.md §4)
 *   T1 자동마케팅 시간 초과 = 보류(최종 판정 순서 · 회복 후보 · 기다림)
 *   T2 맞춤법 자리 잡기 지시(문자 · SNS 한 벌) · 판정 ① 그대로 · 고치기 뒤 다시 검사 0
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { decideSpamOutcome, operatorFinalSpamResult } from '../continuous-operator-policy';
import { judgeSpellCandidates, SPELL_LOCATION_RULES } from '../spell-check';
import { judgeSnsSpellCandidates } from '../sns-spell-check';

const src = (rel: string) => readFileSync(join(__dirname, '..', rel), 'utf8').replace(/\r\n/g, '\n');
const v = (spamResult: string, carriers: string[] = []) => ({ spamResult, carrierResults: carriers.map((result) => ({ result })) });

describe('T1 회차 최종 판정 순서(통과 > 확인 중 · 검사 중 > 시간 초과 하나라도 > 차단 > 반려 > 1안 원값)', () => {
  it('접수 그대로(세 안 모두 timeout) = timeout', () => {
    expect(operatorFinalSpamResult([v('timeout'), v('timeout'), v('timeout')], null, 3)).toBe('timeout');
  });
  it('★ 설계 Codex 1R #2 — 시간 초과가 차단 · 반려와 섞여도 보류(어느 순서든)', () => {
    expect(operatorFinalSpamResult([v('timeout'), v('blocked'), v('timeout')], null, 3)).toBe('timeout');
    expect(operatorFinalSpamResult([v('blocked'), v('timeout')], null, 2)).toBe('timeout');
    expect(operatorFinalSpamResult([v('rejected'), v('timeout')], null, 1)).toBe('timeout');
    expect(operatorFinalSpamResult([v('failed'), v('timeout')], null, 2)).toBe('timeout');
  });
  it('시간 초과가 없으면 옛 판정 그대로', () => {
    expect(operatorFinalSpamResult([v('blocked'), v('blocked')], null, 2)).toBe('blocked');
    expect(operatorFinalSpamResult([v('failed'), v('blocked')], null, 2)).toBe('blocked');
    expect(operatorFinalSpamResult([v('rejected'), v('failed')], null, 1)).toBe('rejected');
    expect(operatorFinalSpamResult([v('failed'), v('failed')], null, 2)).toBe('failed');
    expect(operatorFinalSpamResult([], null, 0)).toBe('failed');
  });
  it('확인 중 · 검사 중이 시간 초과보다 먼저 · 통과 안이 있으면 통과', () => {
    expect(operatorFinalSpamResult([v('timeout'), v('unconfirmed')], null, 2)).toBe('unconfirmed');
    expect(operatorFinalSpamResult([v('pending'), v('timeout')], null, 2)).toBe('pending');
    expect(operatorFinalSpamResult([v('timeout'), v('pass', ['pass'])], 1, 2)).toBe('pass');
  });
  it('decideSpamOutcome(timeout) = 보류(담당자 검토 · 자동 발송 막음 · 「통과하지 못해」 아님)', () => {
    const o = decideSpamOutcome('timeout', 0);
    expect(o).toMatchObject({ status: 'admin_review', autoExecuteBlocked: true, hold: true });
    expect(o.reason).not.toContain('미통과');
    expect(decideSpamOutcome('blocked', 0).hold).toBeUndefined();
  });
  it('배선 — 회차가 순수 함수를 부르고 · 회복 후보 = 시간 초과는 heldSendAt 있는 회차만 · 기다림 = 늦은 보고 창 안 장애 · 막힘', () => {
    const op = src('continuous-operator.ts');
    expect(op).toContain('const finalResult = operatorFinalSpamResult(tested, passedIndex, Number(spamResult.totalTestCount ?? 1));');
    expect(op).toContain("OR (p.spam_test_status = 'timeout' AND p.proposal_json->'spamCheck' ? 'heldSendAt'))");
    expect(op).toContain("const waiting = read.some((x) => isSpamHold(x.outcome) || ((x.outcome === 'error' || x.outcome === 'blocked') && x.lateOpen));");
    expect(op).toContain('이번 회차 스팸 검사 결과를 받지 못해 담당자 검토로 두었어요');
    const q = src('spam-test-queue.ts');
    expect(q).toContain("(status = 'completed' AND completed_at >= NOW() - INTERVAL '${SPAM_LATE_REPORT_MINUTES} minutes') AS late_open");
  });
});

describe('T2 맞춤법 자리 잡기(AI 지시 · 판정 ① 그대로 · 서버 넓히기 0)', () => {
  it('문자 · SNS 지시문이 같은 규칙 한 벌을 싣는다(자리마다 따로 · 끝까지 · 한 번만 나올 때까지 앞뒤 더)', () => {
    expect(SPELL_LOCATION_RULES.join('\n')).toMatch(/자리마다 따로/);
    expect(SPELL_LOCATION_RULES.join('\n')).toMatch(/처음부터 끝까지 빠짐없이/);
    expect(SPELL_LOCATION_RULES.join('\n')).toMatch(/원문에 한 번만 나올 때까지 앞뒤 낱말을 더 넣는다/);
    expect(SPELL_LOCATION_RULES.join('\n')).toMatch(/그 틀린 곳만/);
    for (const f of ['sms-spell-check.ts', 'sns-spell-check.ts']) {
      const s = src(f);
      expect(s).toContain('...SPELL_LOCATION_RULES,');
      expect(s).not.toContain('원문에 한 번만 나오는 구간으로 잡는다');
    }
  });
  it('AI 가 자리마다 따로 낸 두 후보 = 두 항목(접수 원문 「혜택안내」 두 자리)', () => {
    const text = '출시기념 더블포인트 적립 및 혜택안내 드립니다.\n\n[혜택안내]\n① 신제품 전체 10% 할인';
    const r = judgeSpellCandidates(text, [
      { before: '및 혜택안내 드립니다', after: '및 혜택 안내 드립니다' },
      { before: '[혜택안내]', after: '[혜택 안내]' },
    ], []);
    expect(r).toHaveLength(2);
    expect(r.map((i) => text.slice(i.start, i.end))).toEqual(['혜택안내', '[혜택안내]']);
  });
  it('★ 설계 Codex 3R — 앞뒤 두 낱말까지 같은 반복 줄 = 지점명까지 넓힌 두 후보가 두 항목 · 고치는 자리 = 각 줄', () => {
    const line = (b: string) => `${b} 오늘 방문 고객께 혜택안내 자세히 보내 드립니다`;
    const text = `${line('서울점')}\n${line('부산점')}`;
    const r = judgeSpellCandidates(text, [
      { before: '서울점 오늘 방문 고객께 혜택안내 자세히 보내', after: '서울점 오늘 방문 고객께 혜택 안내 자세히 보내' },
      { before: '부산점 오늘 방문 고객께 혜택안내 자세히 보내', after: '부산점 오늘 방문 고객께 혜택 안내 자세히 보내' },
    ], []);
    expect(r).toHaveLength(2);
    expect(r.every((i) => i.before === '혜택안내' && i.after === '혜택 안내')).toBe(true);
    expect(r[0].start).toBeLessThan(text.indexOf('\n'));
    expect(r[1].start).toBeGreaterThan(text.indexOf('\n'));
    // 앞뒤 두 낱말뿐인 후보 = 원문에 두 번 = 버림(판정 ① 그대로)
    expect(judgeSpellCandidates(text, [{ before: '고객께 혜택안내 자세히', after: '고객께 혜택 안내 자세히' }], [])).toHaveLength(0);
  });
  it('★ 설계 Codex 1R #4 · 2R #1 — 서버가 다른 자리로 넓히지 않는다(결재/결제 · 잘못했다/잘 못했다)', () => {
    const a = '카드 결재 가능합니다. 내부 결재 후 처리합니다.';
    expect(judgeSpellCandidates(a, [{ before: '카드 결재', after: '카드 결제' }], [])).toHaveLength(1);
    const b = '영어를 거의 배운 적이 없어서 영어를 잘못했다. 죄 없는 친구를 비난했으니 나는 친구에게 잘못했다.';
    const r = judgeSpellCandidates(b, [{ before: '영어를 잘못했다', after: '영어를 잘 못했다' }], []);
    expect(r).toHaveLength(1);
    expect(r[0].start).toBeLessThan(b.indexOf('친구에게'));
    expect(judgeSnsSpellCandidates('가 가 가', [{ before: '가', after: '까' }])).toHaveLength(0);   // 옛 계약
  });
});

describe('T3 명의자 본인인증 = 로그인 본인인증과 격리(★ 설계 Codex 1R #1)', () => {
  it('전용 CT 는 로그인 본인인증 표 · 계정 담당자 번호를 읽지도 쓰지도 않는다 · 로그인 완료 함수를 부르지 않는다', () => {
    const s = src('sender-owner-verify.ts').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    expect(s).not.toContain('identity_verifications');
    expect(s).not.toMatch(/UPDATE\s+users/i);
    expect(s).not.toContain('mfa_trusted_devices');
    expect(s).not.toContain('completeIdentityVerification');
    expect(s).not.toContain('startIdentityVerification');
  });
  it('신청 · 승인 = 기타명의 무선 + 인증이면 같은 잠금 · 같은 트랜잭션 셈(자기 제외는 승인만)', () => {
    const r = src('sender-registration.ts');
    expect(r).toContain('const v = await lockOwnerVerificationForApply(run, {');
    expect(r).toContain('await lockOwnerLine(run, data.companyId, v.dupHash);');
    expect(r).toContain('const verdict = await checkOwnerMobileLimit(run, data.companyId, v.dupHash, null);');
    expect(r).toContain('await lockOwnerLine(run, reg.company_id, ownerHash);');
    expect(r).toContain('const ownerVerdict = await checkOwnerMobileLimit(run, reg.company_id, ownerHash, reg.id);');
  });
});

describe('T2 맞춤법 고치기 뒤 다시 검사 0', () => {
  it('고치기 UPDATE = 새 판 「고친 뒤」 저장값 · 글자 직접 수정 = 지움', () => {
    const ct = src('agency-send-change.ts');
    expect(ct).toContain("? (spellOnly ? `spell_check = ${AGENCY_SPELL_AFTER_FIX_SQL}, ` : 'spell_check = NULL, ')");
    // ★ 구현 Codex 1R — 로그인 화면 [고치기](text 저장) = 넣은 제안 id 를 서버가 다시 적용해 같을 때 · 제목 그대로일 때만
    expect(ct).toContain("let spellOnly = input.change.kind === 'spell';");
    expect(ct).toContain('const replayed = applyAgencySpellFixes(String(row.current_content || \'\'), readAgencySpell(row), input.change.spellIssueIds);');
    expect(ct).toContain('spellOnly = replayed.ok && replayed.content.trim() === body;');
    expect(ct).toContain('&& (input.change.subject == null || input.change.subject === row.subject)) {');
    expect(readFileSync(join(__dirname, '..', '..', 'routes', 'agency-send.ts'), 'utf8')).toContain('spellIssueIds: Array.isArray(req.body?.spellIssueIds) ? req.body.spellIssueIds.map(String).slice(0, 50) : undefined,');
    const sp = src('agency-send-spell.ts');
    expect(sp).toContain("`jsonb_build_object('version', content_version + 1, 'checkedAt', NOW(), 'issues', '[]'::jsonb, 'failed', false, 'afterFix', true)`");
  });
  it('워커 훅 = 이 판의 실패 아닌 결과가 있으면 AI 검사 앞에서 끝난다', () => {
    const sp = src('agency-send-spell.ts');
    const hook = sp.slice(sp.indexOf('export async function runAgencySpellAfterTest('));
    const skip = hook.indexOf("if (have && typeof have === 'object' && have.failed !== true && Number(have.version) === Number(input.version)) return;");
    expect(skip).toBeGreaterThan(0);
    expect(skip).toBeLessThan(hook.indexOf('await checkAgencySpelling('));
  });
});
