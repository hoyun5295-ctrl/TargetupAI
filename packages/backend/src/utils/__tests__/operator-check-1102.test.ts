/**
 * 엔진 재설계 E6-1 · E7 — 충전 승인 되묻기 · 자동마케팅 점검 판 · 설정 비용 제어(★ 2026-11-02 · 설계서 docs/2026-11-01-journey-automarketing-engine-design.md)
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { buildOperatorCheck, type OperatorCheckFacts } from '../operator-check';

const FE = join(__dirname, '..', '..', '..', '..', 'frontend', 'src');
const fe = (f: string) => readFileSync(join(FE, f), 'utf8');
const be = (f: string) => readFileSync(join(__dirname, '..', f), 'utf8');

const base: OperatorCheckFacts = {
  lastRound: { outcome: 'scheduled', count: 120 },
  callback: { ok: true, text: '0212345678로 보내요.' },
  copyMode: 'ai', fixedBody: null, fixedSpam: null,
  budgetMonthly: null, budgetDaily: null, spentMonth: 0, spentToday: 0,
  creditOk: true, companyAuto: false,
  approvedUntil: new Date('2026-11-09T00:00:00Z'), windowStart: '2026-11-01T00:00:00Z', now: new Date('2026-11-02T00:00:00Z'),
  scheduleTime: '10:00',
};
const level = (c: ReturnType<typeof buildOperatorCheck>, key: string) => c.items.find((i) => i.key === key)?.level;

describe('E7-1 자동마케팅 점검(순수)', () => {
  it('모두 정상 = 돌려도 됨 · 항목 = 받는 분 · 번호 · 스팸 · 예산 · 크레딧 · 자동 발송 · 시각', () => {
    const c = buildOperatorCheck(base);
    expect(c.verdict).toMatchObject({ canActivate: true, fix: 0 });
    expect(c.items.map((i) => i.key)).toEqual(['audience', 'callback', 'spam', 'budget', 'credit', 'approval', 'hours']);
    expect(c.items.find((i) => i.key === 'budget')!.detail).toContain('정해 둔 예산이 없어요');
  });
  it('고칠 것 = 번호 없음 · 직접 쓴 문안 혜택 자리 · 스팸 걸림 · 예산 소진 · 크레딧 부족 · 야간 시각 · 지난 회차 멈춤', () => {
    const c = buildOperatorCheck({
      ...base, lastRound: { outcome: 'blocked', reason: '대상 조건 확인이 필요해요' },
      callback: { ok: false, text: '보내는 번호가 없어요.' },
      copyMode: 'fixed', fixedBody: '[혜택]을 드려요', fixedSpam: 'blocked',
      budgetMonthly: 100000, spentMonth: 100000, creditOk: false, scheduleTime: '22:00',
    });
    for (const k of ['audience', 'callback', 'benefit', 'spam', 'budget', 'credit', 'hours']) expect(level(c, k), k).toBe('fix');
    expect(c.verdict).toMatchObject({ canActivate: false, fix: 7, sentence: '고칠 것 7개가 있어요.' });
  });
  it('승인 기간 밖 · 회사 자율 아님 = 검사 전(회차마다 승인) · 회사 자율 = 통과', () => {
    expect(level(buildOperatorCheck({ ...base, approvedUntil: null, windowStart: null }), 'approval')).toBe('before');
    expect(level(buildOperatorCheck({ ...base, approvedUntil: null, windowStart: null, companyAuto: true }), 'approval')).toBe('pass');
  });
});

describe('배선(소스 계약)', () => {
  it('점검 응답 경로 = GET 하나 · 범위(담당자 = 자기 것) · 기존 판정 함수만', () => {
    const r = be('../routes/ai.ts');
    expect(r).toContain("router.get('/operator/continuous/:id/check'");
    expect(r).toContain('operatorCheck(gate.companyId, String(req.params.id), gate.ownOnly ? gate.userId : null)');
    const c = be('operator-check.ts');
    for (const fn of ['checkOperatorCallback(', 'hasUneditedBenefitPlaceholder(', 'isWithinApprovalWindow(', 'validateScheduleTimeSendable(', 'checkCredit(']) expect(c).toContain(fn);
  });
  it('공용 점검 부품 = 여정 · 자동마케팅이 같이 쓴다 · 설정 창 수정 = 점검 판 · 비용 제어 = 선택 · 콤마 · 위험 한 줄', () => {
    expect(fe('components/journey/workspace/JourneyCheckPanel.tsx')).toContain("from '../../check/CheckPanel'");
    expect(fe('components/automarketing/OperatorCheckPanel.tsx')).toContain("from '../check/CheckPanel'");
    const m = fe('components/automarketing/OperatorSetupModal.tsx');
    expect(m).toContain('<OperatorCheckPanel operatorId={String(editing.id)} />');
    expect(m).toContain('placeholder="비우면 제한 없음"');
    expect(m).toContain('예산을 비우면 발송비에 상한이 없어요. 회차마다 받는 분 수만큼 나가요.');
    expect(m).not.toContain('type="number" min="0" step="10000"');
  });
  it('충전 승인 = 누르면 확인 창 → 확정해야 실행', () => {
    const p = fe('pages/ChargeApprovePage.tsx');
    expect(p).toContain('onClick={() => setAsking(true)}');
    expect(p).toContain('onConfirm={async () => { await approve(); setAsking(false); }}');
    expect(p).not.toMatch(/onClick=\{approve\}/);
  });
});
