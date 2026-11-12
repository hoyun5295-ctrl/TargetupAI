/**
 * agency-send-optout.ts — 대행발송 「수신거부 줄 겹침」 안내 (★ 2026-11-13 C130 · 설계서 docs/2026-11-13-c130-agency-optout-notice-reply-body-design.md §2 · §4①)
 *
 * 접수 = 서수란 cmwd36hnr1corjnscq7xlnim1(금강제화 11-12) — 광고 문안 끝 「※ 수신거부 : 080-…」(「무료」 없음)는 법정 문구가 아니라
 *   buildAdMessage 가 「무료수신거부 080-…」를 한 줄 더 붙인다(규칙 = 의도 · 법정 표기). 받는 사람에게는 수신거부 줄이 둘 보인다.
 * 처방 = 발송 글은 그대로 두고(고객 문안을 몰래 고치지 않는다) **접수 · 승인 전 확인 자리마다 알린다**.
 *   판정 = messageUtils.findNonLegalOptOutLines 한 곳 · 꼬리 글 = messageUtils.adRejectFooterText(발송과 같은 식).
 * ⛔ 바깥 문장 = 줄표 · 가운뎃점 · 모델명 0(계약 시험 C130 T1-5).
 */
import { adRejectFooterText, findNonLegalOptOutLines, getOpt080Number } from './messageUtils';

/** 고치는 길이 확인 자리마다 다르다 — mail = 메일 접수 회신 · upload = 화면 원스텝 확인 창(접수 전) · edit = 화면(접수 뒤 문안 고치기) · staff = 슈퍼관리자 */
export type AgencyOptOutHow = 'mail' | 'upload' | 'edit' | 'staff';

const LINE_MAX = 80;
const LINES_MAX = 3;

const HOW_LINE: Record<AgencyOptOutHow, string> = {
  mail: "한 번만 나가게 하려면 진행 상황 주소에서 그 줄을 '무료수신거부'로 고치거나 지워 주세요.",
  upload: "한 번만 나가게 하려면 요청서의 그 줄을 '무료수신거부'로 고친 뒤 다시 올려 주세요.",
  edit: "한 번만 나가게 하려면 문안 고치기에서 그 줄을 '무료수신거부'로 고치거나 지워 주세요.",
  staff: "고객에게 그 줄을 '무료수신거부'로 고치거나 지우도록 안내해 주세요.",
};

/** 담당자 문자 한 줄(회사 비용 · 짧게 · 70자 이하 · 계약 시험 C130 T1-5) */
export const AGENCY_OPT_OUT_SMS_LINE = "문안의 수신거부 줄에 '무료'가 없어 끝에 무료수신거부 줄이 한 번 더 붙습니다. 한 줄로 하려면 문안을 고쳐 주세요.";

/**
 * 확인 자리 공통 안내 줄(0 또는 3줄). 비광고 · 겹침 없음 = [].
 * opt080 = 그 접수에 붙을 080(getOpt080Number · 없거나 못 읽었으면 '' = 낱말만 붙는 꼬리와 같은 글).
 */
export function agencyOptOutNotice(input: {
  content: string | null | undefined;
  isAd: boolean | null | undefined;
  messageType: string | null | undefined;
  opt080: string | null | undefined;
  how: AgencyOptOutHow;
}): string[] {
  if (!input.isAd) return [];
  const lines = findNonLegalOptOutLines(input.content);
  if (lines.length === 0) return [];
  const shown = lines.slice(0, LINES_MAX).map((l) => `「${l.length > LINE_MAX ? `${l.slice(0, LINE_MAX)}…` : l}」`).join(', ');
  const more = lines.length > LINES_MAX ? ` 외 ${lines.length - LINES_MAX}줄` : '';
  const footer = adRejectFooterText(String(input.messageType || ''), String(input.opt080 || ''));
  return [
    `수신거부 줄 안내: 문안의 ${shown}${more}에는 '무료'가 없어 법에서 정한 수신거부 문구로 보지 않습니다.`,
    `그래서 보낼 때 맨 끝에 「${footer}」 줄이 자동으로 한 번 더 붙어, 받는 분께 수신거부 줄이 두 번 보입니다.`,
    HOW_LINE[input.how],
  ];
}

/** 담당자 승인 요청 · 재승인 문자에 싣는 한 줄(없으면 '') */
export function agencyOptOutSmsLine(input: { content: string | null | undefined; isAd: boolean | null | undefined }): string {
  if (!input.isAd) return '';
  return findNonLegalOptOutLines(input.content).length > 0 ? AGENCY_OPT_OUT_SMS_LINE : '';
}

/**
 * 안내에 쓸 080 — 발송 · 미리보기와 같은 함수(getOpt080Number · 사용자 칸 → 회사 칸).
 * ⛔ 실패해도 던지지 않는다('' = 번호 없는 꼬리 글로 알린다) · 안내가 접수 · 승인 · 회신을 막으면 안 된다.
 * ⛔ 바깥 트랜잭션 안에서 부르지 않는다(풀을 다시 기다린다) — 트랜잭션을 열기 전에 읽어 넘긴다.
 */
export async function loadAgencyOpt080(userId: string | null | undefined, companyId: string): Promise<string> {
  try {
    return (await getOpt080Number(userId || null, companyId)) || '';
  } catch {
    return '';
  }
}
