/**
 * journey-check.ts — 여정 점검 응답 CT(★ 2026-11-01 여정 재발 방지 배포 2 C5 · docs/2026-11-01-journey-recurrence-prevention-design.md §3 C5)
 *
 * 화면 셋(오른쪽 점검 판 · 레일 점 · 켜기 칩)이 그리는 판정은 여기 하나다. 판정 자체는 새로 적지 않는다:
 *   - 정의 검사 = journey-builder `activationBlockReason`(켜기와 같은 함수 · 상태 검사만 건너뜀)
 *   - 칸 판 검사(자리 · 제목 · 알림톡 변수 · 스팸) = journey-pretest-validator `validateJourneyForActivation`(켜기 검증과 같은 함수 · 스팸만 엿보기)
 * 5어 = 검사 전(before) · 검사 중(running) · 확인 중(confirming) · 통과(pass) · 고칠 것(fix).
 *
 * 칸 저장 뒤 통신사 검사 자동(D1 · D2) = startJourneyStepSpamChecks(같은 날 같은 글 = 이어 보기 · 새 글 = 단가표 차감 · 기다리지 않는다).
 */
import { query } from '../config/database';
import { activationBlockReason } from './journey-builder';
import { validateJourneyForActivation, peekStepSpam, startStepSpamCheck, type FailedStep, type StepSpamState } from './journey-pretest-validator';
import { stepSendVersions, loadStepVariantRows } from './journey-step-versions';

export type JourneyCheckLevel = 'before' | 'running' | 'confirming' | 'pass' | 'fix';
export type JourneyCheckTarget = 'body' | 'subject' | 'alimtalk' | 'spam' | 'journey';

export interface JourneyCheckItem {
  key: string;
  level: JourneyCheckLevel;
  title: string;
  detail: string;
  fixTarget: JourneyCheckTarget | null;
  variantId: string | null;
}

export interface JourneyCheck {
  verdict: { canActivate: boolean; sentence: string; fix: number; hold: number; before: number };
  steps: Record<string, JourneyCheckItem[]>;
  journey: JourneyCheckItem[];
}

/** 켜기 검증의 실패 한 줄 → 점검 항목(사람 말 · 고칠 곳) */
export function itemOfFailure(f: FailedStep, states: readonly StepSpamState[]): JourneyCheckItem {
  const base = { key: `${f.reason}:${f.variantId ?? 'main'}`, variantId: f.variantId };
  const ab = f.variantId ? ' (A/B 판)' : '';
  switch (f.reason) {
    case 'placeholder_unedited':
      return { ...base, level: 'fix', title: `채울 자리가 남았어요${ab}`, detail: '[...] 자리를 직접 채우거나 그 줄을 지워 주세요.', fixTarget: 'body' };
    case 'subject_missing':
      return { ...base, level: 'fix', title: `제목이 비어 있어요${ab}`, detail: 'LMS · MMS 는 제목이 있어야 보낼 수 있어요.', fixTarget: 'subject' };
    case 'variable_mapping_invalid':
      return { ...base, level: 'fix', title: '알림톡 변수 연결이 빠졌어요', detail: '본문 #{...} 변수마다 넣을 고객 정보를 골라 주세요.', fixTarget: 'alimtalk' };
    case 'spam_filter_failed':
      return { ...base, level: 'fix', title: `스팸 검사에서 막혔어요${ab}`, detail: f.details, fixTarget: 'spam' };
    case 'spam_check_pending': {
      const st = states.find((s) => s.stepId === f.stepId && s.variantId === f.variantId)?.state;
      return st === 'unconfirmed'
        ? { ...base, level: 'confirming', title: `스팸 검사 확인 중${ab}`, detail: '통신사는 보냈는데 시험 폰 확인이 늦어요. 길어도 20분 안에 정해져요.', fixTarget: null }
        : { ...base, level: 'running', title: `스팸 검사 중${ab}`, detail: '같은 글 검사가 진행 중이에요. 끝나면 여기 결과가 바뀌어요.', fixTarget: null };
    }
    case 'spam_check_unavailable':
      return { ...base, level: 'before', title: `스팸 검사 전${ab}`, detail: '지난 검사를 마치지 못했어요. 켤 때 다시 검사해요.', fixTarget: null };
  }
}

/** 판정 문장(켜기 칩 · 점검 판 맨 위 · 레일 점이 같은 값을 쓴다) */
export function checkVerdictOf(items: readonly JourneyCheckItem[]): JourneyCheck['verdict'] {
  const fix = items.filter((i) => i.level === 'fix').length;
  const hold = items.filter((i) => i.level === 'running' || i.level === 'confirming').length;
  const before = items.filter((i) => i.level === 'before').length;
  const canActivate = fix === 0 && hold === 0;
  const sentence = canActivate
    ? (before > 0 ? `켤 수 있어요 · 켤 때 스팸 검사 ${before}개` : '켤 수 있어요')
    : ['아직 못 켜요', fix > 0 ? `고칠 것 ${fix}` : '', hold > 0 ? `확인 중 ${hold}` : ''].filter(Boolean).join(' · ');
  return { canActivate, sentence, fix, hold, before };
}

/** 여정 점검 응답(차감 0 · 검사 등록 0) */
export async function checkJourney(companyId: string, journeyId: string, userId: string): Promise<JourneyCheck> {
  const stepRows = await query(
    `SELECT s.id, s.step_order FROM journey_steps s JOIN journeys j ON j.id = s.journey_id
      WHERE s.journey_id = $1::uuid AND j.company_id = $2::uuid ORDER BY s.step_order`,
    [journeyId, companyId],
  );
  const steps: Record<string, JourneyCheckItem[]> = {};
  const idByOrder = new Map<number, string>();
  for (const r of stepRows.rows) { steps[String(r.id)] = []; idByOrder.set(Number(r.step_order), String(r.id)); }
  const journey: JourneyCheckItem[] = [];

  const states: StepSpamState[] = [];
  const v = await validateJourneyForActivation(companyId, journeyId, userId, { spam: peekStepSpam, spamStates: states });
  for (const f of v.failedSteps) (steps[f.stepId] ??= []).push(itemOfFailure(f, states));
  for (const s of states) {
    if (s.state !== 'pass' && s.state !== 'before') continue;   // 검사 중 · 확인 중 = 위 실패 줄이 이미 항목으로 만들었다
    const ab = s.variantId ? ' (A/B 판)' : '';
    (steps[s.stepId] ??= []).push(s.state === 'pass'
      ? { key: `spam:${s.variantId ?? 'main'}`, level: 'pass', title: `스팸 검사 통과${ab}`, detail: '오늘 같은 글 검사를 통과했어요.', fixTarget: null, variantId: s.variantId }
      : { key: `spam:${s.variantId ?? 'main'}`, level: 'before', title: `스팸 검사 전${ab}`, detail: '칸을 저장하면 스팸 검사를 자동으로 해요(켤 때도 해요).', fixTarget: null, variantId: s.variantId });
  }

  // 정의 검사(켜기와 같은 함수) — 막는 이유가 칸 번호로 시작하면 그 칸 · 칸 판 검사가 이미 같은 고칠 것을 들고 있으면 겹쳐 적지 않는다
  const reason = await activationBlockReason(companyId, journeyId, { forCheck: true });
  if (reason) {
    const m = /^(\d+)번째 칸/.exec(reason);
    const stepId = m ? idByOrder.get(Number(m[1])) : undefined;
    const target: JourneyCheckTarget = /채울 자리/.test(reason) ? 'body' : /제목이 비어/.test(reason) ? 'subject' : stepId ? 'body' : 'journey';
    const item: JourneyCheckItem = { key: 'definition', level: 'fix', title: reason, detail: '', fixTarget: target, variantId: null };
    if (stepId) {
      const dup = (steps[stepId] ?? []).some((i) => i.level === 'fix' && i.fixTarget === target && !i.variantId);
      if (!dup) (steps[stepId] ??= []).push(item);
    } else {
      journey.push(item);
    }
  }

  const all = [...journey, ...Object.values(steps).flat()];
  return { verdict: checkVerdictOf(all), steps, journey };
}

/**
 * 칸 저장 뒤 그 칸 판마다 통신사 검사를 건다(기다리지 않는다 · 실패 = 로그 · ★ 2026-11-01 배포 2 C5 · D1).
 *   문자 칸(SMS · LMS · MMS)만 · 회신번호가 없으면 걸지 않는다(켜기 관문이 먼저 막는다) · 보관 · 끝난 여정 = 0.
 *   판마다 등록 직전에 여정 상태를 다시 읽는다 — 남는 틈 = 그 읽기와 등록 사이 끝내기(판 하나 · 남은 위험 기록).
 */
export async function startJourneyStepSpamChecks(companyId: string, journeyId: string, stepId: string, userId: string | null): Promise<void> {
  if (!userId) return;
  try {
    const r = await query(
      `SELECT s.id, s.channel, s.message_template, s.subject, s.is_ad, j.callback_number
         FROM journey_steps s JOIN journeys j ON j.id = s.journey_id
        WHERE s.id = $1::uuid AND s.journey_id = $2::uuid AND j.company_id = $3::uuid
          AND COALESCE(s.step_type, 'message') = 'message' AND j.archived_at IS NULL
          AND j.status IN ('draft', 'paused', 'active')`,   // ★ Codex 구현 1R #2 — 끝난 여정 = 보낼 일이 없다 = 유료 검사 0
      [stepId, journeyId, companyId],
    );
    const step = r.rows[0];
    if (!step || !['sms', 'lms', 'mms'].includes(String(step.channel)) || !String(step.callback_number || '').trim()) return;
    const versions = stepSendVersions({ message_template: step.message_template ?? null, subject: step.subject ?? null }, null, await loadStepVariantRows(stepId));
    for (const msg of versions) {
      if (!String(msg.body || '').trim()) continue;
      // 판마다 등록 직전 여정 상태를 다시 본다(앞 판 검사 중에 끝내기 · 보관했으면 그 뒤 판은 걸지 않는다 · Codex 구현 1R #2)
      const alive = await query(
        `SELECT 1 FROM journeys WHERE id = $1::uuid AND company_id = $2::uuid AND archived_at IS NULL AND status IN ('draft', 'paused', 'active')`,
        [journeyId, companyId],
      );
      if (alive.rows.length === 0) return;
      await startStepSpamCheck({
        companyId, userId, body: msg.body, subject: msg.subject, channel: step.channel, isAd: step.is_ad !== false,
        callbackNumber: String(step.callback_number), journeyId, variantId: msg.variantId || undefined,
      });
    }
  } catch (err: any) {
    console.warn(`[journey-auto-spam] 칸 저장 뒤 검사 준비 실패 journey=${journeyId} step=${stepId} — ${err?.message || err}`);
  }
}
