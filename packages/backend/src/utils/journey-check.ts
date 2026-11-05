/**
 * journey-check.ts — 여정 점검 응답 CT(★ 2026-11-01 여정 재발 방지 배포 2 C5 · docs/2026-11-01-journey-recurrence-prevention-design.md §3 C5)
 *
 * 화면 셋(오른쪽 점검 판 · 레일 점 · 켜기 칩)이 그리는 판정은 여기 하나다. 판정 자체는 새로 적지 않는다:
 *   - 정의 검사 = journey-builder `activationBlockReason`(켜기와 같은 함수 · 상태 검사만 건너뜀)
 *   - 칸 판 검사(자리 · 제목 · 알림톡 변수 · 스팸) = journey-pretest-validator `validateJourneyForActivation`(켜기 검증과 같은 함수 · 스팸만 엿보기)
 * 5어 = 검사 전(before) · 검사 중(running) · 확인 중(confirming) · 통과(pass) · 고칠 것(fix).
 *
 * ★ 2026-11-05 C103 F2 — 칸 저장 뒤 자동 검사(옛 D1 · D2 startJourneyStepSpamChecks)는 없앴다(1104 접수 2 · 확정 전 유료 검사 0).
 *   검사 = 작업 화면 「지금 스팸 검사」(여정 칸 검사 주소) · 켜기 검증 · 보내기 전 검사 · 주간 검사.
 */
import { query } from '../config/database';
import { activationBlockIssue } from './journey-builder';
import { resolveJourneyAdFlag } from './journey-ad-policy';   // ★ 2026-11-02 광고 판정 CT(설계서 3-0 CT-J8)
import { validateJourneyForActivation, peekStepSpam, type FailedStep, type StepSpamState } from './journey-pretest-validator';
import { stepSendVersions, loadStepVariantRows, loadVariantRowsByStep } from './journey-step-versions';

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
export function itemOfFailure(f: FailedStep, states: readonly StepSpamState[], abLabelOf?: (variantId: string) => string | null): JourneyCheckItem {
  const base = { key: `${f.reason}:${f.variantId ?? 'main'}`, variantId: f.variantId };
  // ★ 2026-11-05 C105 H5 — 어느 판인지(「(B안)」 · 행 id → variant_id) · 이름을 모르면 옛 글
  const ab = f.variantId ? ` (${abLabelOf?.(f.variantId) ?? 'A/B 판'})` : '';
  switch (f.reason) {
    case 'placeholder_unedited':
      return { ...base, level: 'fix', title: `채울 자리가 남았어요${ab}`, detail: '[...] 자리를 직접 채우거나 그 줄을 지워 주세요.', fixTarget: 'body' };
    case 'subject_missing':
      return { ...base, level: 'fix', title: `제목이 비어 있어요${ab}`, detail: 'LMS · MMS 는 제목이 있어야 보낼 수 있어요.', fixTarget: 'subject' };
    case 'variable_mapping_invalid':
      return { ...base, level: 'fix', title: '알림톡 변수 연결이 빠졌어요', detail: '본문 #{...} 변수마다 넣을 고객 정보를 골라 주세요.', fixTarget: 'alimtalk' };
    case 'copy_issue':
      return { ...base, level: 'fix', title: `보낼 글에 고칠 곳이 있어요${ab}`, detail: f.details, fixTarget: 'body' };
    case 'alimtalk_template_unusable':
      return { ...base, level: 'fix', title: '알림톡 템플릿을 지금 보낼 수 없어요', detail: f.details, fixTarget: 'alimtalk' };
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
  // ★ 2026-11-05 C105 H5 — 판 이름(행 id → 「A안」) = 상세 · 켜기 관문과 같은 판 행
  const abRows = await loadVariantRowsByStep(Object.keys(steps));
  const abName = new Map<string, string>();
  for (const rows of abRows.values()) for (const r of rows) abName.set(r.id, `${r.variant_id}안`);
  const abLabelOf = (id: string) => abName.get(id) ?? null;
  for (const f of v.failedSteps) (steps[f.stepId] ??= []).push(itemOfFailure(f, states, abLabelOf));
  for (const s of states) {
    if (s.state !== 'pass' && s.state !== 'before') continue;   // 검사 중 · 확인 중 = 위 실패 줄이 이미 항목으로 만들었다
    const ab = s.variantId ? ` (${abLabelOf(s.variantId) ?? 'A/B 판'})` : '';
    (steps[s.stepId] ??= []).push(s.state === 'pass'
      ? { key: `spam:${s.variantId ?? 'main'}`, level: 'pass', title: `스팸 검사 통과${ab}`, detail: '오늘 같은 글 검사를 통과했어요.', fixTarget: null, variantId: s.variantId }
      : { key: `spam:${s.variantId ?? 'main'}`, level: 'before', title: `스팸 검사 전${ab}`, detail: '「지금 스팸 검사」를 누르거나 켤 때 검사해요.', fixTarget: null, variantId: s.variantId });
  }

  // 정의 검사(켜기와 같은 함수) — 막는 이유가 칸 번호를 들고 있으면 그 칸
  // ★ 2026-11-05 C104 G7 — 겹침 = 같은 칸 · 같은 판 · 같은 원인(켜기 검증 실패 key = 원인:판)일 때만 뺀다 · 다른 판 · 다른 원인은 둘 다 남는다
  const issue = await activationBlockIssue(companyId, journeyId, { forCheck: true });
  if (issue) {
    const stepId = issue.stepOrder != null ? idByOrder.get(issue.stepOrder) : undefined;
    const target: JourneyCheckTarget = issue.cause === 'subject_missing' ? 'subject'
      : ['placeholder_unedited', 'copy_issue', 'too_short', 'liquid'].includes(issue.cause) ? 'body'
      : stepId ? 'body' : 'journey';
    const item: JourneyCheckItem = { key: 'definition', level: 'fix', title: issue.message, detail: '', fixTarget: target, variantId: issue.variantId };
    if (stepId) {
      const dupKey = `${issue.cause}:${issue.variantId ?? 'main'}`;
      const dup = (steps[stepId] ?? []).some((i) => i.level === 'fix' && i.key === dupKey);
      if (!dup) (steps[stepId] ??= []).push(item);
    } else {
      journey.push(item);
    }
  }

  const all = [...journey, ...Object.values(steps).flat()];
  return { verdict: checkVerdictOf(all), steps, journey };
}

