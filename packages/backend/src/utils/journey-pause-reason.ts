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
  | 'carrier' | 'condition' | 'cap' | 'identity' | 'pretest' | 'manual' | 'unknown';

export type PauseFixAction = 'plan_upgrade' | 'charge' | 'edit_callback' | 'edit_step' | 'edit_options' | 'resume' | 'contact';

export interface PauseReasonView {
  kind: PauseKind;
  /** 화면 한 줄(고객 언어 · 원문 노출 0) */
  text: string;
  fix: { action: PauseFixAction; label: string } | null;
}

const RULES: Array<{ test: RegExp; view: PauseReasonView }> = [
  { test: /이번 달 크레딧이 모자라/, view: { kind: 'credit', text: '이번 달 크레딧이 모자라 여정을 멈췄어요. 요금제를 올리거나 크레딧을 채우면 다시 켤 수 있어요.', fix: { action: 'plan_upgrade', label: '요금제 올리기 신청' } } },
  { test: /잔액 부족/, view: { kind: 'balance', text: '발송 잔액이 모자라 멈췄어요. 충전한 뒤 다시 켜 주세요.', fix: { action: 'charge', label: '충전하기' } } },
  { test: /요금제가 잠겨/, view: { kind: 'plan', text: '요금제 이용 기간이 끝나 멈췄어요. 요금제를 다시 쓰시면 켤 수 있어요.', fix: { action: 'plan_upgrade', label: '요금제 보기' } } },
  { test: /라인그룹|발송 테이블/, view: { kind: 'line', text: '발송 설정이 아직 끝나지 않아 멈췄어요. 담당 매니저에게 문의해 주세요.', fix: { action: 'contact', label: '문의하기' } } },
  { test: /회신번호/, view: { kind: 'callback', text: '보내는 번호(회신번호)가 비어 있어 멈췄어요. 회신번호를 정해 주세요.', fix: { action: 'edit_callback', label: '회신번호 정하기' } } },
  { test: /알림톡 템플릿|카카오 템플릿/, view: { kind: 'template', text: '알림톡 템플릿을 쓸 수 없어 멈췄어요. 템플릿을 확인한 뒤 다시 켜 주세요.', fix: { action: 'edit_step', label: '템플릿 확인하기' } } },
  { test: /제목이 비어/, view: { kind: 'subject', text: '장문 문자의 제목이 비어 있어 멈췄어요. 제목을 넣어 주세요.', fix: { action: 'edit_step', label: '제목 넣기' } } },
  { test: /월 예산/, view: { kind: 'budget', text: '이번 달 예산을 넘어 멈췄어요. 예산을 늘리거나 다음 달에 다시 켜 주세요.', fix: { action: 'edit_options', label: '예산 바꾸기' } } },
  { test: /임계값|step 비용/, view: { kind: 'cost', text: '한 번에 나가는 발송비가 정해 둔 한도를 넘어 멈췄어요. 한도를 확인해 주세요.', fix: { action: 'edit_options', label: '한도 바꾸기' } } },
  { test: /통신사 일시 발송 실패/, view: { kind: 'carrier', text: '통신사 쪽 일시 오류로 멈췄어요. 잠시 뒤 다시 켜 주세요.', fix: { action: 'resume', label: '다시 켜기' } } },
  { test: /조건 평가/, view: { kind: 'condition', text: '조건을 확인하다 오류가 나 멈췄어요. 잠시 뒤 다시 켜 주세요.', fix: { action: 'resume', label: '다시 켜기' } } },
  { test: /대량 진입 감지/, view: { kind: 'cap', text: '한 번에 들어온 고객이 최대 인원보다 많아 멈췄어요. 최대 인원을 늘리거나 조건을 좁힌 뒤 다시 켜 주세요.', fix: { action: 'edit_options', label: '최대 인원 바꾸기' } } },
  { test: /신규 고객 판정 불가/, view: { kind: 'identity', text: '새 고객을 가려낼 정보가 없어 멈췄어요. 고객 데이터 연동을 확인해 주세요.', fix: { action: 'contact', label: '문의하기' } } },
  { test: /스팸필터/, view: { kind: 'pretest', text: '보내기 전 검사에서 문안이 걸려 멈췄어요. 문안을 고친 뒤 다시 켜 주세요.', fix: { action: 'edit_step', label: '문안 고치기' } } },
  { test: /일시정지|담당자가/, view: { kind: 'manual', text: '멈춰 둔 여정이에요.', fix: { action: 'resume', label: '다시 켜기' } } },
];

const MANUAL: PauseReasonView = { kind: 'manual', text: '멈춰 둔 여정이에요.', fix: { action: 'resume', label: '다시 켜기' } };
const UNKNOWN: PauseReasonView = { kind: 'unknown', text: '멈춰 있어요. 이유를 확인해 주세요.', fix: { action: 'contact', label: '문의하기' } };

export function pauseReasonView(raw: string | null | undefined): PauseReasonView {
  const s = String(raw || '').trim();
  if (!s) return MANUAL;
  for (const r of RULES) if (r.test.test(s)) return r.view;
  return UNKNOWN;
}
