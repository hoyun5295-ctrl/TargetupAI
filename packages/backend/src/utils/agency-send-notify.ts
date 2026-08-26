/**
 * agency-send-notify.ts — 대행발송 담당자 안내 문구 (★ 2026-08-22 신설)
 *
 * 설계 = docs/2026-08-22-agency-send-design.md §4-5. 다섯 가지 시점의 문구를 여기 한 곳이 소유한다.
 *
 * 왜 분리했나: 이 문장들은 **고객사 담당자가 받는 실제 문자**다. 워커 코드 사이에 흩어 두면
 *   다음에 고칠 때 한쪽만 바뀌고, 문구 검수(줄표·이모지·내부 용어)도 파일을 훑어야 한다.
 *
 * ⛔ 줄표 0 · 이모지 0 · 내부 용어 0(상태명·테이블명·코드값을 쓰지 않는다).
 * ⛔ 담당자 문자도 회사 비용으로 나간다(설계서 불변 5). 길어지면 그만큼 요금이 붙으니 짧게 쓴다.
 */
import { sanitizeSmsText } from './auto-notify-message';

export interface AgencyNotifyContext {
  /** 접수 구분용. 파일명이 없으면 문안 앞부분을 쓴다 */
  label: string;
  /** 요청 시각(KST 문자열, 예: "8월 24일 14:00") */
  whenText?: string;
  /**
   * 링크 승인 주소(★2026-08-25 · 담당자 번호별로 다르다 = agency-send-link CT가 만든다).
   * 있으면 로그인 안내 대신 이 주소로 바로 승인하게 안내한다.
   * ★2026-08-26(4) 단축 주소가 온다(buildShortAgencyApproveUrl · 실패 시 원본).
   */
  approveUrl?: string;
  /** ★2026-08-26(4) 전송 요청 건수(Harold "문자에 XX건 넣자"). 승인·재승인 안내에 실린다 */
  count?: number;
}

/** 문자 앞머리. 담당자가 받은 문자가 무엇인지 한눈에 알게 한다 */
const HEAD = '[대행발송]';

function compose(lines: string[]): string {
  return sanitizeSmsText(lines.filter(Boolean).join('\n')).trim();
}

/** 접수 구분 이름. 너무 길면 자른다(문자 길이는 곧 요금이다) */
export function shortLabel(input: string, max = 20): string {
  const t = sanitizeSmsText(String(input || '').replace(/\s+/g, ' ')).trim();
  if (!t) return '접수 건';
  return t.length > max ? `${t.slice(0, max)}...` : t;
}

/** ① 1차 검사 통과. 담당자가 테스트 문자를 함께 받는다 */
export function buildPassedNotify(ctx: AgencyNotifyContext): string {
  return compose([
    `${HEAD} 스팸 검사를 통과했습니다.`,
    `건: ${shortLabel(ctx.label)}`,
    ctx.count ? `요청 건수: ${Number(ctx.count).toLocaleString()}건` : '',
    ctx.whenText ? `보낼 시각: ${ctx.whenText}` : '',
    ctx.approveUrl
      ? '방금 보내 드린 문자를 확인하시고, 아래 주소에서 바로 승인해 주세요.'
      : '방금 보내 드린 문자를 확인하시고, 로그인하여 승인해 주세요.',
    ctx.approveUrl || '',
    '승인하지 않으면 발송되지 않습니다.',
  ]);
}

/**
 * ② 당일 재검사에서 걸렸다. **Harold 원문 그대로**(2026-08-22 지시).
 *   이 문장은 고객이 이미 승인한 발송이 취소됐다는 통지라 톤을 바꾸지 않는다.
 */
export function buildFinalBlockedNotify(ctx: AgencyNotifyContext): string {
  return compose([
    `${HEAD} 기존에 예약된 대행발송이 스팸필터테스트에 걸려서 예약취소 되었습니다.`,
    '곧, 다시 문안 안내 드릴테니 로그인 하시어 승인 바랍니다.',
    `건: ${shortLabel(ctx.label)}`,
  ]);
}

/** ③ 다듬은 문안이 재검사를 통과했다. 재승인을 받는다 */
export function buildReapprovalNotify(ctx: AgencyNotifyContext): string {
  return compose([
    `${HEAD} 수정한 문안이 스팸 검사를 통과했습니다.`,
    `건: ${shortLabel(ctx.label)}`,
    ctx.count ? `요청 건수: ${Number(ctx.count).toLocaleString()}건` : '',
    ctx.whenText ? `보낼 시각: ${ctx.whenText}` : '',
    ctx.approveUrl
      ? '방금 보내 드린 문자를 확인하시고, 아래 주소에서 다시 승인해 주세요.'
      : '방금 보내 드린 문자를 확인하시고, 로그인하여 다시 승인해 주세요.',
    ctx.approveUrl || '',
  ]);
}

/** ④ 세 차례 모두 차단. 사람이 문안을 고쳐야 한다 */
export function buildTestFailedNotify(ctx: AgencyNotifyContext): string {
  return compose([
    `${HEAD} 문안이 세 차례 스팸 검사에 걸렸습니다.`,
    `건: ${shortLabel(ctx.label)}`,
    '로그인하여 문안을 고쳐 주세요. 고치면 검사를 다시 시작합니다.',
  ]);
}

/** ⑤ 승인이 없어 발송하지 않았다 */
export function buildExpiredNotify(ctx: AgencyNotifyContext): string {
  return compose([
    `${HEAD} 승인이 없어 요청한 시각에 발송되지 않았습니다.`,
    `건: ${shortLabel(ctx.label)}`,
    '로그인하여 보낼 시각을 다시 정해 주세요.',
  ]);
}

/**
 * ⑥ 승인은 받았는데 발송 직전 검사·예약을 넣을 시간이 지났다 (★ 2026-08-23 신설)
 *
 * ⑤와 나눈 이유: ⑤는 "승인이 없어서"다. 승인한 담당자에게 그 문장을 보내면 사실과 다르다.
 */
export function buildApprovedExpiredNotify(ctx: AgencyNotifyContext): string {
  return compose([
    `${HEAD} 요청한 시각에 발송하지 못했습니다.`,
    `건: ${shortLabel(ctx.label)}`,
    '발송 직전 검사에 필요한 시간이 지났습니다. 로그인하여 시각을 다시 정해 주세요.',
  ]);
}

/** ⑦ 예약을 만들지 못했다 (★ 2026-08-23 신설). 사유는 화면 상세에 남는다 */
export function buildQueueFailedNotify(ctx: AgencyNotifyContext): string {
  return compose([
    `${HEAD} 예약을 넣지 못해 발송하지 않았습니다.`,
    `건: ${shortLabel(ctx.label)}`,
    '로그인하여 상세를 확인해 주세요.',
  ]);
}

/**
 * ⑧ 운영(슈퍼관리자)이 고객 요청으로 취소를 대신 처리했다 (★2026-08-26(3) 신설)
 *
 * 전화로 취소를 요청한 사람이 담당자 여러 명 중 하나여도, 전원이 같은 문자를 받아야
 * "취소된 줄 모르고 기다리는 담당자"가 안 생긴다.
 */
export function buildStaffCancelledNotify(ctx: AgencyNotifyContext): string {
  return compose([
    `${HEAD} 예약된 발송이 취소되었습니다.`,
    `건: ${shortLabel(ctx.label)}`,
    ctx.whenText ? `보낼 시각: ${ctx.whenText}` : '',
    '요청에 따라 취소 처리했습니다. 로그인하여 확인하실 수 있습니다.',
  ]);
}

/** 요청 시각을 담당자가 읽는 형태로 (KST) */
export function formatWhen(at: Date): string {
  const kst = new Date(at.getTime() + 9 * 60 * 60 * 1000);
  const mm = kst.getUTCMonth() + 1;
  const dd = kst.getUTCDate();
  const hh = String(kst.getUTCHours()).padStart(2, '0');
  const mi = String(kst.getUTCMinutes()).padStart(2, '0');
  return `${mm}월 ${dd}일 ${hh}:${mi}`;
}
