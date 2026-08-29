/**
 * charge-approve-link.ts — 충전 승인 문자·링크 CT (★2026-08-28(3) 신설 · Harold 지시)
 *
 * 승인 대기(웹 무통장입금 `deposit_requests` · 에이전트 충전 요청 `agent_charge_orders`)가 올라오면
 * 지정 번호(ENV)로 안내 문자를 보내고, 문자 속 주소에서 **승인 한 번**으로 처리한다.
 * 토큰·주소 규격 = 대행발송 링크 승인(agency-send-link.ts) 미러:
 *   - 서명 키 = 전역 JWT_SECRET에서 이 용도로 파생한 전용 키(HS256 고정 · exp 없는 토큰 거절)
 *   - payload = 종류(deposit|agent_order) + 대상 id + 수신 번호
 *   - 랜딩 주소의 토큰은 fragment(#t=) — 서버로 전송되지 않아 접근 로그 어디에도 안 남는다
 *   - API 운반은 헤더(X-Charge-Approve-Token)로만 — URL에 실으면 요청 로그에 승인권이 남는다
 *
 * 수신 번호 = ENV `CHARGE_APPROVAL_NOTIFY_PHONES`(쉼표 구분). **권한 판정도 이 목록이다** —
 * ENV에서 번호를 빼면 이미 나간 문자의 링크도 그 자리에서 죽는다(대행발송 담당자 목록 판정 미러).
 * 미설정 = 문자 발송 생략 + 링크 승인 전면 잠금(수신자 0 = 입구 0).
 *
 * 발송 수단 = system-alert와 같은 인증 라인 LMS(bulkInsertSmsQueue). 운영자 대상이라 야간에도
 * 발송한다(광고 아님). 발송 실패가 충전 요청 접수를 막지 않는다(호출부는 fire-and-forget).
 *
 * ⛔ 이 토큰은 승인 한 가지에만 쓴다. 거절·보류 해소·소명 확인은 관리 화면 소유.
 * ⛔ 토큰 소지 = 그 번호의 폰 소지로 간주(대행발송과 같은 수용 위험 · 감사는 승인 기록의 via·번호가 진다).
 */
import jwt from 'jsonwebtoken';
import { getAuthSmsTable, bulkInsertSmsQueue, getPlatformNoticeCallback } from './sms-queue';
import { createShortUrl } from './short-url';
import { sanitizeSmsText } from './auto-notify-message';

const RAW_SECRET = process.env.JWT_SECRET || 'targetup-jwt-secret-fallback';
const JWT_KEY = `charge-approve:${RAW_SECRET}`;
const SCOPE = 'charge_approve';
/** 만료 7일 — 충전 요청은 발송 시각 개념이 없어 고정 창이면 충분하다(그 안에 처리되거나 화면에서 처리된다) */
export const CHARGE_APPROVE_TTL_SECONDS = 7 * 24 * 3600;

export const CHARGE_APPROVE_TOKEN_HEADER = 'x-charge-approve-token';

export type ChargeApproveKind = 'deposit' | 'agent_order';

export interface ChargeApproveTokenPayload {
  kind: ChargeApproveKind;
  targetId: string;
  phone: string;
}

/** ENV 수신 번호 파싱(system-alert의 SYSTEM_ALERT_PHONES 파서 미러 · 축은 따로 = 역할이 다르다) */
export function getChargeApprovalPhones(): string[] {
  const raw = String(process.env.CHARGE_APPROVAL_NOTIFY_PHONES || '').trim();
  if (!raw) return [];
  const phones: string[] = [];
  for (const part of raw.split(',')) {
    const clean = part.replace(/\D/g, '');
    if (/^01\d{8,9}$/.test(clean) && !phones.includes(clean)) phones.push(clean);
  }
  return phones;
}

export function signChargeApproveToken(p: { kind: ChargeApproveKind; targetId: string; phone: string }): string {
  return jwt.sign(
    { scope: SCOPE, k: p.kind, t: p.targetId, p: p.phone },
    JWT_KEY,
    { algorithm: 'HS256', expiresIn: CHARGE_APPROVE_TTL_SECONDS },
  );
}

export function verifyChargeApproveToken(token: string): ChargeApproveTokenPayload | null {
  if (!token) return null;
  try {
    const decoded = jwt.verify(token, JWT_KEY, { algorithms: ['HS256'] }) as any;
    if (!decoded || decoded.scope !== SCOPE || !decoded.t || !decoded.p) return null;
    if (decoded.k !== 'deposit' && decoded.k !== 'agent_order') return null;
    if (!Number.isFinite(Number(decoded.exp))) return null;
    return { kind: decoded.k, targetId: String(decoded.t), phone: String(decoded.p) };
  } catch {
    return null;
  }
}

/** 랜딩 주소(fragment 토큰). 도메인 규약 = HANJUL_BASE_URL 폴백(agency-send-link와 동일) */
export function buildChargeApproveUrl(kind: ChargeApproveKind, targetId: string, phone: string): string {
  const base = String(process.env.HANJUL_BASE_URL || 'https://hanjul.ai').replace(/\/+$/, '');
  const token = signChargeApproveToken({ kind, targetId, phone });
  return `${base}/charge-approve#t=${encodeURIComponent(token)}`;
}

/**
 * 문자용 단축 승인 주소 (★2026-08-29 Harold "단축 URL로" 재도입).
 *
 * ⛔ **전제 = 클릭 비추적 가드.** 1R critical의 유출 경로는 단축 자체가 아니라 클릭 라우트가
 *   full_url(토큰 포함)을 그 회사 cdp_events에 기록해 고객사가 자기 이벤트 조회로 읽는 것이었다.
 *   `routes/short-url.ts`가 승인류 링크(`/charge-approve`·`/agency-approve`)의 cdp 기록을
 *   건너뛰도록 고친 뒤에만 이 함수가 성립한다(계약 = charge-approve.test.ts가 가드와 짝으로 잠근다).
 * ⛔ 단축 만료 = 토큰 만료와 같은 값(토큰이 죽은 뒤 리다이렉트만 사는 반쪽 링크 금지 · 대행발송 규약 미러).
 * ⛔ 단축 실패 = 원본 주소 그대로(승인 안내가 단축 때문에 멈추면 안 된다).
 */
export async function buildShortChargeApproveUrl(
  companyId: string, kind: ChargeApproveKind, targetId: string, phone: string,
): Promise<string> {
  const fullUrl = buildChargeApproveUrl(kind, targetId, phone);
  try {
    const expiresAt = new Date(Date.now() + CHARGE_APPROVE_TTL_SECONDS * 1000);
    const { shortUrl } = await createShortUrl({ companyId, fullUrl, expiresAt });
    return shortUrl;
  } catch (err: any) {
    console.warn('[charge-approve-link] 승인 링크 단축 실패(원본 주소로 발송):', err?.message);
    return fullUrl;
  }
}

/**
 * 문자에 싣는 동적 필드 정규화 (★Codex 1R high 신설 · 2R 순서 정정 · **3R 화이트리스트 전환**).
 *
 * 입금자명·회사명은 고객이 제어한다. 그대로 실으면 플랫폼 발신 문자 안에 고객이 쓴 줄이 우리 문장처럼
 * 보이고(개행), 진짜 승인 주소 앞에 가짜 주소를 세울 수 있다(URL).
 *
 * ⛔ **막을 것을 나열하지 않는다. 허용할 것만 남긴다.**
 *   1R·2R·3R에서 같은 부류(주소 형태 우회)가 세 번 나왔다: 도메인 목록 밖 TLD → `http★://` 재조립 →
 *   IDN(`악성.com`). 스킴·IPv4·도메인 정규식을 계속 늘리는 방식은 다음 우회를 또 부른다.
 *   그래서 **이름에 실제로 필요한 문자만 통과**시킨다 — 점·콜론·슬래시·@가 통째로 사라지므로
 *   호스트 형태 자체가 성립하지 않는다(IDN·유니코드 점 변형도 NFKC 뒤 같은 점이라 함께 걸린다).
 *   정규식 셋이 한 줄로 줄었다.
 */
const NAME_ALLOWED = /[^가-힣ㄱ-ㅎㅏ-ㅣa-zA-Z0-9()\-&, ]+/g;

export function oneLineField(v: any, maxLen: number = 40): string {
  // 최종 문자 형태를 먼저 만든다(NFKC + EUC-KR 정제) — 이 뒤로 문자가 더 사라지지 않는다 = 재조립 창 0
  return sanitizeSmsText(String(v ?? '').normalize('NFKC'))
    .replace(NAME_ALLOWED, ' ')
    .replace(/ {2,}/g, ' ')
    .trim()
    .slice(0, maxLen);
}

export const CHARGE_KIND_LABEL: Record<ChargeApproveKind, string> = {
  deposit: '한줄로 웹 충전(무통장입금)',
  agent_order: '에이전트 지갑 충전',
};

/**
 * 승인 대기 안내 문자 발송 — 번호마다 자기 링크를 실어 개별 조립한다.
 * @returns 발송 시도한 수신자 수(0 = ENV 미설정)
 */
export async function notifyChargeApprovers(input: {
  kind: ChargeApproveKind;
  targetId: string;
  companyId: string;
  companyName: string;
  amount: number;
  depositorName: string;
  /** 에이전트 축 부가 정보(발송ID 등) 한 줄 */
  extraLine?: string | null;
}): Promise<number> {
  try {
    const phones = getChargeApprovalPhones();
    if (phones.length === 0) {
      console.log('[charge-approve-link] 수신자 미설정(CHARGE_APPROVAL_NOTIFY_PHONES) — 안내 문자 생략');
      return 0;
    }
    const authTable = await getAuthSmsTable();
    // ★Codex 1R high 수용 — phones[0] 발신은 발신자=수신자가 되어 번호도용 차단에 걸린다(미수신).
    //   플랫폼 대표번호 CT를 쓴다(campaign-sync-worker·continuous-operator와 같은 규약).
    //   같은 결함이 system-alert.ts에도 있다 = 범위 밖 기록(BUGS).
    const callback = getPlatformNoticeCallback();
    const rows: any[][] = [];
    for (const phone of phones) {
      // 단축 = 비추적 가드(short-url.ts 승인류 cdp 기록 생략)와 짝(★0829 재도입 · 함수 주석 참조)
      const url = await buildShortChargeApproveUrl(input.companyId, input.kind, input.targetId, phone);
      const body = sanitizeSmsText([
        '[한줄로] 충전 승인 요청',
        '',
        `구분: ${CHARGE_KIND_LABEL[input.kind]}`,
        `고객사: ${oneLineField(input.companyName, 30)}`,
        `금액: ${Number(input.amount).toLocaleString()}원`,
        `입금자: ${oneLineField(input.depositorName, 20)}`,
        ...(input.extraLine ? [oneLineField(input.extraLine, 40)] : []),
        '',
        '입금을 확인하셨다면 아래 주소에서 승인해 주세요.',
        url,
      ].join('\n'));
      rows.push([
        phone,                    // dest_no
        callback,                 // call_back
        body,                     // msg_contents
        'L',                      // msg_type (LMS)
        '[한줄로] 충전 승인 요청', // title_str
        null,                     // sendreq_time (useNow=true)
        '',                       // app_etc1
        'charge-approve',         // app_etc2
        '', '', '',               // file_name1~3
      ]);
    }
    // ★Codex 1R high 수용 — 적재 실패를 삼키면 아무도 문자를 못 받았는데 로그는 정상이 된다
    const inserted = await bulkInsertSmsQueue([authTable], rows, true);
    if (inserted < rows.length) {
      console.error(`[charge-approve-link] 승인 안내 일부 미적재: ${inserted}/${rows.length} — 대기 건은 관리 화면에서 처리 필요`);
    }
    console.log(`[charge-approve-link] 승인 안내 ${inserted}/${rows.length}명 적재 — ${CHARGE_KIND_LABEL[input.kind]} ${input.companyName} ${Number(input.amount).toLocaleString()}원`);
    return rows.length;
  } catch (err: any) {
    // 알림 실패가 충전 요청 접수를 죽이면 안 된다
    console.error('[charge-approve-link] 안내 문자 발송 오류:', err?.message || err);
    return 0;
  }
}
