/**
 * journey-pause-reason.ts — 멈춘 이유를 사람 말로(★ 2026-10-20 여정 V.3 묶음 3 · 설계서 §6-6)
 *
 * journeys.pause_reason 에는 실행기 · 감시 · 사전검사 스캐너 · 사람 멈춤이 남긴 원문이 그대로 있다
 * (「step 3 알림톡 템플릿(코드) 미존재 또는 회사 격리 위반」 · 「status=…」 · 「SMS 발송 테이블 미할당」 같은 내부 문자열).
 * 지도 카드 · 작업 화면 · 다시 켜기 창은 원문을 내보내지 않고 이 함수의 문장과 고치기 행동만 그린다. 모르는 문자열은 「확인해 주세요」로 닫는다.
 * ⛔ 실행기 멈춤 문자열이 늘면 시험(journey-v3-pause-reason-1020)이 깨진다 — 여기에 갈래를 더한다(문자열이 계속 늘면 pause_code 칸으로 옮긴다).
 */

export type PauseKind =
  | 'credit' | 'balance' | 'plan' | 'line' | 'callback' | 'template' | 'subject' | 'cost' | 'budget'
  | 'carrier' | 'condition' | 'cap' | 'identity' | 'pretest' | 'dispatch' | 'manual' | 'completed' | 'unknown';

export type PauseFixAction = 'plan_upgrade' | 'charge' | 'edit_callback' | 'edit_step' | 'edit_options' | 'resume' | 'contact';

export interface PauseReasonView {
  kind: PauseKind;
  /** 화면 한 줄(고객 언어 · 원문 노출 0) */
  text: string;
  /** stepOrder = 고칠 칸(★ 2026-11-05 C103 R56 · 원문이 「step N」을 남긴 칸 고치기 = 그 칸 · 없으면 화면이 첫 문자 칸) */
  fix: { action: PauseFixAction; label: string; stepOrder?: number } | null;
}

const RULES: Array<{ test: RegExp; view: PauseReasonView }> = [
  { test: /이번 달 크레딧이 모자라/, view: { kind: 'credit', text: '이번 달 크레딧이 모자라 여정을 멈췄어요. 요금제를 올리거나 크레딧을 채우면 다시 켤 수 있어요.', fix: { action: 'plan_upgrade', label: '요금제 올리기 신청' } } },
  { test: /잔액 부족/, view: { kind: 'balance', text: '발송 잔액이 모자라 멈췄어요. 충전한 뒤 다시 켜 주세요.', fix: { action: 'charge', label: '충전하기' } } },
  { test: /요금제가 잠겨/, view: { kind: 'plan', text: '요금제 이용 기간이 끝나 멈췄어요. 요금제를 다시 쓰시면 켤 수 있어요.', fix: { action: 'plan_upgrade', label: '요금제 보기' } } },
  { test: /라인그룹|발송 테이블/, view: { kind: 'line', text: '발송 설정이 아직 끝나지 않아 멈췄어요. 담당 매니저에게 문의해 주세요.', fix: { action: 'contact', label: '문의하기' } } },
  { test: /회신번호/, view: { kind: 'callback', text: '보내는 번호(회신번호)가 비어 있어 멈췄어요. 회신번호를 정해 주세요.', fix: { action: 'edit_callback', label: '회신번호 정하기' } } },
  { test: /알림톡 템플릿|카카오 템플릿/, view: { kind: 'template', text: '알림톡 템플릿을 쓸 수 없어 멈췄어요. 템플릿을 확인한 뒤 다시 켜 주세요.', fix: { action: 'edit_step', label: '템플릿 확인하기' } } },
  { test: /제목이 비어/, view: { kind: 'subject', text: 'LMS 제목이 비어 있어 멈췄어요. 제목을 넣어 주세요.', fix: { action: 'edit_step', label: '제목 넣기' } } },
  { test: /월 예산/, view: { kind: 'budget', text: '이번 달 예산을 넘어 멈췄어요. 예산을 늘리거나 다음 달에 다시 켜 주세요.', fix: { action: 'edit_options', label: '예산 바꾸기' } } },
  { test: /임계값|step 비용/, view: { kind: 'cost', text: '한 번에 나가는 발송비가 정해 둔 한도를 넘어 멈췄어요. 한도를 확인해 주세요.', fix: { action: 'edit_options', label: '한도 바꾸기' } } },
  { test: /통신사 일시 발송 실패/, view: { kind: 'carrier', text: '통신사 쪽 일시 오류로 멈췄어요. 잠시 뒤 다시 켜 주세요.', fix: { action: 'resume', label: '다시 켜기' } } },
  { test: /조건 평가/, view: { kind: 'condition', text: '조건을 확인하다 오류가 나 멈췄어요. 잠시 뒤 다시 켜 주세요.', fix: { action: 'resume', label: '다시 켜기' } } },
  // ★ 2026-11-02 묶음 발송 이상치 관문(설계서 3-2 ⑤) — 명단이 맞으면 다시 켜면 그대로 나간다(승인 = 다시 켜기)
  { test: /평소보다 크게 많아/, view: { kind: 'cap', text: '하루 동안 들어온 고객이 평소보다 크게 많아 보내기 전에 멈췄어요. 고객 명단이 맞으면 다시 켜 주세요. 그대로 나갑니다.', fix: { action: 'resume', label: '확인하고 다시 켜기' } } },
  { test: /대량 진입 감지/, view: { kind: 'cap', text: '한 번에 들어온 고객이 최대 인원보다 많아 멈췄어요. 최대 인원을 늘리거나 조건을 좁힌 뒤 다시 켜 주세요.', fix: { action: 'edit_options', label: '최대 인원 바꾸기' } } },
  // ★ 2026-11-02 한 번 보내기 넣기 실패(journey-activation ONE_SHOT_DISPATCH_FAILED_REASON · 옛: 「이유를 확인해 주세요」로 읽혀 안내 문구가 비었다)
  { test: /받는 분을 넣지 못해/, view: { kind: 'dispatch', text: '받는 분을 넣지 못해 멈췄어요. 잠시 뒤 다시 켜 주세요. 크레딧은 다시 받지 않아요.', fix: { action: 'resume', label: '다시 켜기' } } },
  { test: /신규 고객 판정 불가/, view: { kind: 'identity', text: '새 고객을 가려낼 정보가 없어 멈췄어요. 고객 데이터 연동을 확인해 주세요.', fix: { action: 'contact', label: '문의하기' } } },
  // ★ 2026-10-25 #14 — 검사 장애로 멈춤은 문안 탓이 아니다(스팸필터 줄보다 먼저 · 다시 켜기)
  { test: /검사 장애/, view: { kind: 'pretest', text: '보내기 전 스팸 검사를 마치지 못해 멈췄어요. 문안 문제는 아니니 잠시 뒤 다시 켜 주세요.', fix: { action: 'resume', label: '다시 켜기' } } },
  { test: /스팸필터/, view: { kind: 'pretest', text: '보내기 전 검사에서 문안이 걸려 멈췄어요. 문안을 고친 뒤 다시 켜 주세요.', fix: { action: 'edit_step', label: '문안 고치기' } } },
  { test: /일시정지|담당자가/, view: { kind: 'manual', text: '멈춰 둔 여정이에요.', fix: { action: 'resume', label: '다시 켜기' } } },
];

const MANUAL: PauseReasonView = { kind: 'manual', text: '멈춰 둔 여정이에요.', fix: { action: 'resume', label: '다시 켜기' } };
/** ★ 2026-11-02 날짜 기준 여정이 정한 날 보내기를 마친 멈춤(시스템 고장이 아니다 · 담당자 안내 0 · 설계서 3-5) */
const COMPLETED: PauseReasonView = { kind: 'completed', text: '정한 날 보내기를 마쳤어요. 다음 기준 날짜를 정하면 다시 켤 수 있어요.', fix: { action: 'edit_options', label: '기준 날짜 정하기' } };

/**
 * ★ 2026-11-02 사람 멈춤 사유 = 서버 상수 하나(설계서 docs/2026-11-02-journey-automarketing-core-fix-design.md 3-5 · 3-0 CT-J2).
 *   화면 · 안내 문자 링크 두 입구가 이 상수만 쓴다(옛: 화면이 보낸 글자 · 「관리자 일시정지」 · 링크 문장 셋으로 갈렸다) → 「사람 멈춤인가」 = 글자 맞추기가 아니라 상수 비교.
 */
export const MANUAL_PAUSE_REASON = '담당자가 여정을 일시정지했어요.';
/** 날짜 기준 여정이 정한 날 보내기를 마친 멈춤 사유(상수 비교 · 담당자 안내 0) */
export const ANCHOR_COMPLETED_PAUSE_REASON = '지정일 D-0 발송 완료. 다음 기준 날짜 지정 시 재가동';

/**
 * ★ 2026-11-02 여정 멈춤 쓰기의 SET 조각 한 곳(설계서 3-0 CT-J2 · Codex 설계 4R #2 = 쓰기 함수가 아니라 조각).
 *   각 자리의 UPDATE 문장 · WHERE(세대 비교 · 승인 토큰 · 회사 일치) · 함께 쓰는 칸 · 영향 행 반환은 그 자리 그대로 두고 멈춤 칸만 이 조각으로 쓴다.
 *   사유는 매개변수로만 더한다(params 에 넣고 그 번호를 쓴다) · 500자.
 */
export function pausedSetSql(params: any[], reason: string): string {
  params.push(String(reason || '').slice(0, 500));
  return `status = 'paused', paused_at = NOW(), pause_reason = $${params.length}`;
}

/** 상태를 매개변수로 받는 문장(초안으로 · 멈춤으로 되돌리기)의 멈춤 칸 조각 — 상태 식이 'paused' 일 때만 멈춤 칸을 쓴다 */
export function pausedCaseSetSql(statusExpr: string, reasonRef: string): string {
  return `paused_at = CASE WHEN ${statusExpr} = 'paused' THEN NOW() ELSE paused_at END, `
    + `pause_reason = CASE WHEN ${statusExpr} = 'paused' THEN ${reasonRef} ELSE pause_reason END`;
}
const UNKNOWN: PauseReasonView = { kind: 'unknown', text: '멈춰 있어요. 이유를 확인해 주세요.', fix: { action: 'contact', label: '문의하기' } };

/** ★ 2026-11-02 사람이 멈춘 여정인가(설계서 3-5 ② · 다시 켤 때 기준선 다시 심기 · 사건 커서 옮기기 = 사람 멈춤만 · 시스템 멈춤 = 그동안 생긴 일을 받는다) */
export function isHumanPause(raw: string | null | undefined): boolean {
  return pauseReasonView(raw).kind === 'manual';
}

export function pauseReasonView(raw: string | null | undefined): PauseReasonView {
  const s = String(raw || '').trim();
  if (!s) return MANUAL;
  if (s === MANUAL_PAUSE_REASON) return MANUAL;              // ★ 2026-11-02 상수 비교가 먼저(아래 글자 규칙 = 옛 행)
  if (s === ANCHOR_COMPLETED_PAUSE_REASON) return COMPLETED;
  for (const r of RULES) {
    if (!r.test.test(s)) continue;
    // ★ 2026-11-05 C103 R56 — 칸 고치기는 원문이 가리킨 칸으로(옛: 알림톡 템플릿 멈춤도 첫 문자 칸으로 갔다)
    const m = r.view.fix?.action === 'edit_step' ? /\bstep (\d+)\b/.exec(s) : null;
    return m && r.view.fix ? { ...r.view, fix: { ...r.view.fix, stepOrder: Number(m[1]) } } : r.view;
  }
  return UNKNOWN;
}
