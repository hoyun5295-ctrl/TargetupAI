/**
 * planner-reasons.ts — 플래너 고객 문장 사전 (★ 2026-10-04 보강 · 설계서 §9 F4)
 *
 * 화면·통지 문자에 나가는 보류·잠금·생략 사유는 **이 사전의 문장만** 쓴다.
 * 옛 코드는 내부 오류 원문을 그대로 붙였다(`소재 제작 불가: fromEmail 필수 ... 진입 의무` · `발송 접수가 거부됐습니다: <예외 문구>`).
 * 원문은 로그에만 남긴다 — 고객에게는 "무엇이 막혔고 무엇을 하면 풀리는가"만 말한다.
 *
 * ⛔ 내부 코드명·테이블명·영문 예외 문구·모델명·줄표 금지(사용자 노출 문구). 순수 모듈(DB·AI import 0).
 */

/** 채널 준비 판정 코드 → 고객 문장 · 설정으로 가는 길 */
export const READINESS_REASON = {
  NO_DEFAULT_CALLBACK: { text: '기본 발신번호가 없습니다. 발신번호를 등록하고 기본으로 지정해 주세요.', path: '/manage?tab=callbacks' },
  NO_080: { text: '광고 문자에 필요한 무료거부 번호(080)가 없습니다. 080 번호를 등록해 주세요.', path: '/settings' },
  DM_PLAN: { text: '모바일 DM은 지금 요금제에서 제공되지 않습니다.', path: null },
  EMAIL_PLAN: { text: '메일은 유료 요금제에서 열립니다.', path: null },
  NO_EMAIL_CUSTOMERS: { text: '이메일이 등록된 고객이 없습니다. 고객 데이터에 이메일이 있어야 보낼 수 있습니다.', path: null },
  SMTP_NOT_CONFIGURED: { text: '회사 메일이 연결되지 않아 메일은 고를 수 없어요.', path: '/email-campaigns' },
  AUTO_BUILD_OFF: { text: '재료로 완성본을 만드는 기능이 아직 열리지 않았습니다.', path: null },
  NOT_IN_PHASE1: { text: '이 채널은 아직 플래너에서 고를 수 없습니다.', path: null },
  CHECK_FAILED: { text: '채널 상태를 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.', path: null },
} as const;

export type ReadinessCode = keyof typeof READINESS_REASON;

/**
 * 발송 접수 거부 코드(direct-send 계열) → 고객 문장. 사전에 없는 코드는 일반 문장으로 접는다(원문 노출 0).
 * 코드 원천 = direct-send-spec·spam-block(값이 바뀌면 일반 문장으로 떨어질 뿐 원문이 새지 않는다).
 */
const SEND_REJECT_REASON: Record<string, string> = {
  INSUFFICIENT_BALANCE: '발송 잔액이 부족합니다. 충전 후 [다시 시작]을 눌러 주세요.',
  NIGHT_AD_RESTRICTED: '광고 문자는 밤 9시부터 아침 8시까지 보낼 수 없습니다.',
  LINK_PLACEHOLDER_UNEDITED: '문안에 채워지지 않은 링크 자리가 있습니다.',
  BENEFIT_PLACEHOLDER_UNEDITED: '문안에 채워지지 않은 혜택 자리가 있습니다.',
  SPAM_BLOCKED: '문안에 발송이 제한된 표현이 있어 접수되지 않았습니다.',
};

export function sendRejectReason(code: string | null | undefined): string {
  const c = String(code || '');
  return SEND_REJECT_REASON[c] || '발송 접수가 거부되었습니다. 발송 설정을 확인한 뒤 [다시 시작]을 눌러 주세요.';
}

/** 실행 · 대조 · 승인에서 쓰는 고정 문장 */
export const PLANNER_REASON = {
  sendUnknown: '발송 여부를 확인하지 못했습니다. 발송 내역 확인이 필요합니다.',
  sendFailed: '발송 접수에 실패했습니다. 발송 내역을 확인한 뒤 [다시 시작]을 눌러 주세요.',
  cancelledMonth: '월간 대행이 취소돼 발송하지 않았습니다.',
  cancelledEvent: '행사가 취소돼 발송하지 않았습니다.',
  notApproved: '예정일까지 승인되지 않아 보내지 않았습니다.',
  missed: '예정일이 지나 보내지 않았습니다.',
  materialsMissing: '모바일 DM·메일 재료가 없어 완성본을 만들지 못했습니다.',
  copyFailed: '문자 문안을 준비하지 못했습니다. 잠시 후 다시 준비합니다.',
  spamFailed: '문자 문안이 스팸 검사를 통과하지 못했습니다. 새 문안을 확인해 주세요.',
  changedAfterApproval: '승인한 뒤 내용이 바뀌어 보내지 않았습니다. 바뀐 내용을 다시 확인해 주세요.',
  pairHeld: '같은 날 함께 나갈 문자와 모바일 DM 중 하나가 확인되지 않아 둘 다 보내지 않았습니다.',
  scopeBlocked: '행사를 만든 계정의 담당 매장 범위가 정해지지 않아 대상을 정할 수 없습니다. 관리자에게 매장 범위 지정을 요청해 주세요.',
  audienceZero: '발송 대상이 0명이라 이번 발송을 건너뛰었습니다.',
  emailZero: '메일을 받을 수 있는 고객이 0명이라 이번 발송을 건너뛰었습니다.',
  dmUnavailable: '모바일 DM 주소가 열리지 않는 상태라 보내지 않았습니다. 발행 상태를 확인해 주세요.',
  stalled: '진행이 오래 멈춰 자동 진행을 중단했습니다. 확인 후 [다시 시작]을 눌러 주세요.',
  creditShort: '크레딧이 부족해 보류했습니다. 충전 후 [다시 시작]을 눌러 주세요.',
  companyInfo: '회사 정보를 확인하지 못해 보류했습니다.',
  notInPhase1: '인앱 메시지·알림톡은 지금 플래너에서 보내지 않아 생략했습니다.',
  emailPartial: '메일 발송이 중간에 멈췄습니다. [다시 시작]을 누르면 아직 받지 못한 고객에게만 보냅니다.',
} as const;
