/**
 * operator-check.ts — 자동마케팅 점검 판(★ 2026-11-02 엔진 재설계 E7-1 · 설계서 docs/2026-11-01-journey-automarketing-engine-design.md)
 *
 * 여정 점검 응답과 같은 꼴(판정 문장 · 항목 = 단계 · 제목 · 할 일). 항목은 이미 있는 판정 함수만 부른다(새 판정 0):
 *   받는 분(지난 회차 기록) · 회신번호(checkOperatorCallback · 기본 번호) · 혜택 자리표시(hasUneditedBenefitPlaceholder) ·
 *   직접 쓴 문안 스팸 검사(fixedCopy.spam) · 예산(월 · 하루 · 쓴 값) · 크레딧(checkCredit) · 자동 발송 승인 기간(isWithinApprovalWindow + 회사 자율) ·
 *   야간 광고 시각(validateScheduleTimeSendable).
 * ⛔ 모델명 0 · 줄표 0(고객 화면 문장).
 */
import { SEND_HOURS } from '../config/defaults';
import { listOperators, checkOperatorCallback, OperatorCallbackError, listOperatorCallbackChoices, loadOperatorCompanyContext, type ContinuousOperator } from './continuous-operator';
import { hasUneditedBenefitPlaceholder } from './send-placeholder-gate';
import { isWithinApprovalWindow, validateScheduleTimeSendable } from './autosend-policy';
import { checkCredit, InsufficientCreditError } from './ai-credit';
import { getCreditCost } from './ai-credit-calc';

export type OperatorCheckLevel = 'before' | 'pass' | 'fix';
export interface OperatorCheckItem { key: string; level: OperatorCheckLevel; title: string; detail: string }
export interface OperatorCheck {
  verdict: { canActivate: boolean; sentence: string; fix: number; hold: number; before: number };
  items: OperatorCheckItem[];
}

export interface OperatorCheckFacts {
  lastRound: { outcome: string; count?: number; reason?: string } | null;
  callback: { ok: boolean; text: string };
  copyMode: 'ai' | 'fixed';
  fixedBody: string | null;
  fixedSpam: string | null;
  budgetMonthly: number | null; budgetDaily: number | null; spentMonth: number; spentToday: number;
  creditOk: boolean | null;
  companyAuto: boolean;
  approvedUntil: Date | null; windowStart: string | null; now: Date;
  scheduleTime: string;
}

const won = (n: number) => `${Math.round(n).toLocaleString('ko-KR')}원`;

/** (순수) 사실 → 항목 · 판정 문장 */
export function buildOperatorCheck(f: OperatorCheckFacts): OperatorCheck {
  const items: OperatorCheckItem[] = [];
  const add = (key: string, level: OperatorCheckLevel, title: string, detail: string) => items.push({ key, level, title, detail });

  const r = f.lastRound;
  if (!r) add('audience', 'before', '받는 분', '아직 회차가 돌지 않았어요. 첫 회차에서 조건에 맞는 고객 수를 세요.');
  else if (r.outcome === 'blocked') add('audience', 'fix', '받는 분', `지난 회차를 멈췄어요. ${r.reason || '대상 조건을 확인해 주세요.'}`);
  else if (r.outcome === 'empty' || Number(r.count || 0) === 0) add('audience', 'before', '받는 분', '지난 회차에 조건에 맞는 고객이 없어 보내지 않았어요.');
  else add('audience', 'pass', '받는 분', `지난 회차 ${Number(r.count).toLocaleString('ko-KR')}명`);

  add('callback', f.callback.ok ? 'pass' : 'fix', '보내는 번호', f.callback.text);

  if (f.copyMode === 'fixed') {
    if (f.fixedBody && hasUneditedBenefitPlaceholder(f.fixedBody)) add('benefit', 'fix', '혜택 자리', '문안에 혜택 자리가 그대로 있어요. 혜택을 적어 주세요.');
    else add('benefit', 'pass', '혜택 자리', '채울 자리가 없어요.');
    if (f.fixedSpam === 'pass') add('spam', 'pass', '스팸 검사', '직접 쓴 문안이 스팸 검사를 통과했어요.');
    else if (f.fixedSpam === 'blocked') add('spam', 'fix', '스팸 검사', '직접 쓴 문안이 스팸 검사에 걸렸어요. 문안을 고쳐 주세요.');
    else add('spam', 'before', '스팸 검사', '직접 쓴 문안은 첫 회차 전에 검사해요.');
  } else {
    add('spam', 'pass', '스팸 검사', '회차마다 새 문안을 만들고 검사를 통과한 문안만 보내요.');
  }

  const over = (b: number | null, s: number) => b != null && b > 0 && s >= b;
  if (over(f.budgetMonthly, f.spentMonth)) add('budget', 'fix', '예산', `이번 달 예산 ${won(f.budgetMonthly!)}을 다 써 새 제안을 만들지 않아요.`);
  else if (over(f.budgetDaily, f.spentToday)) add('budget', 'fix', '예산', `오늘 한도 ${won(f.budgetDaily!)}을 다 써 오늘은 보내지 않아요.`);
  else if (f.budgetMonthly == null && f.budgetDaily == null) add('budget', 'pass', '예산', '정해 둔 예산이 없어요. 회차마다 받는 분 수만큼 발송비가 나가요.');
  else add('budget', 'pass', '예산', `이번 달 ${won(f.spentMonth)}${f.budgetMonthly != null ? ` / ${won(f.budgetMonthly)}` : ''} 썼어요.`);

  if (f.creditOk === false) add('credit', 'fix', '크레딧', '크레딧이 모자라 다음 회차 제안을 만들 수 없어요. 크레딧을 채워 주세요.');
  else if (f.creditOk === true) add('credit', 'pass', '크레딧', '다음 회차 제안을 만들 크레딧이 있어요.');

  if (f.companyAuto) add('approval', 'pass', '자동 발송', '회사 설정으로 조건을 지키는 회차는 자동으로 보내요.');
  else if (isWithinApprovalWindow(f.approvedUntil, f.windowStart, f.now)) add('approval', 'pass', '자동 발송', `승인한 기간(${f.approvedUntil!.toLocaleDateString('ko-KR', { timeZone: 'Asia/Seoul', month: 'long', day: 'numeric' })}까지) 동안 자동으로 보내요.`);
  else add('approval', 'before', '자동 발송', '회차마다 담당자가 승인해야 보내요. 기간을 정해 미리 승인할 수 있어요.');

  const night = validateScheduleTimeSendable(f.scheduleTime, SEND_HOURS.start, SEND_HOURS.end);
  add('hours', night.ok ? 'pass' : 'fix', '보내는 시각', night.ok ? `${f.scheduleTime}에 보내요.` : night.reason);

  const fix = items.filter((i) => i.level === 'fix').length;
  const before = items.filter((i) => i.level === 'before').length;
  return {
    verdict: {
      canActivate: fix === 0,
      sentence: fix > 0 ? `고칠 것 ${fix}개가 있어요.` : before > 0 ? '돌려도 돼요. 확인할 것이 조금 남았어요.' : '모두 확인했어요. 그대로 돌려도 돼요.',
      fix, hold: 0, before,
    },
    items,
  };
}

/** 그 회사 · 그 운영자의 점검(범위 밖 = null) */
export async function operatorCheck(companyId: string, operatorId: string, scopeUserId: string | null): Promise<OperatorCheck | null> {
  const op = (await listOperators(companyId, scopeUserId)).find((o: ContinuousOperator) => o.id === operatorId);
  if (!op) return null;
  let callback: { ok: boolean; text: string };
  try {
    const c = await checkOperatorCallback(companyId, op.createdBy, { callbackNumber: op.callbackNumber, useIndividualCallback: op.useIndividualCallback });
    if (c.useIndividualCallback) callback = { ok: true, text: '고객마다 등록 매장 번호로 보내요.' };
    else if (c.callbackNumber) callback = { ok: true, text: `${c.callbackNumber}로 보내요.` };
    else {
      const def = (await listOperatorCallbackChoices(companyId, op.createdBy)).defaultNumber;
      callback = def ? { ok: true, text: `기본 번호 ${def}로 보내요.` } : { ok: false, text: '보내는 번호가 없어요. 발신번호 관리에서 등록한 뒤 골라 주세요.' };
    }
  } catch (e) {
    if (!(e instanceof OperatorCallbackError)) throw e;
    callback = { ok: false, text: e.message };
  }
  let creditOk: boolean | null = null;
  try {
    await checkCredit(companyId, getCreditCost('continuous-operator'));
    creditOk = true;
  } catch (e) {
    creditOk = e instanceof InsufficientCreditError ? false : null;
  }
  const ctx = await loadOperatorCompanyContext(companyId);
  const log = Array.isArray(op.roundLog) ? op.roundLog : [];
  return buildOperatorCheck({
    lastRound: log.length > 0 ? log[log.length - 1] : null,
    callback,
    copyMode: op.copyMode,
    fixedBody: op.fixedCopy?.body ?? null,
    fixedSpam: op.fixedCopy?.spam?.status ?? null,
    budgetMonthly: op.budgetMonthly, budgetDaily: op.budgetDaily, spentMonth: Number(op.budgetSpentMonth || 0), spentToday: Number(op.budgetSpentToday || 0),
    creditOk,
    companyAuto: !!(ctx?.ctx.cdp_auto_execute_enabled && ctx?.ctx.advanced_access_enabled),
    approvedUntil: op.approvedUntil ? new Date(op.approvedUntil) : null,
    windowStart: op.approvalMeta?.windowStart ?? null,
    now: new Date(),
    scheduleTime: op.scheduleTime,
  });
}
