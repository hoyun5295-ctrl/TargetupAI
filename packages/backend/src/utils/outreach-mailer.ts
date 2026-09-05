/**
 * ★ 2026-08-24 AI 영업 아웃리치 — 자사 발신 CT (영업 전용 계정)
 * 설계 = docs/2026-07-31-ai-sales-outreach-design.md §15-6 · ★2026-09-05 B-11·B-15 = docs/2026-09-05-ai-sales-outreach-refinement-design.md
 *
 * - 발신 계정 = 영업 전용(hanjul@invitocorp.com · Harold 0824 확정). 정산·세금계산서 계정(SMTP_USER)과
 *   분리된 별도 ENV 축(OUTREACH_SMTP_USER/PASS) — 영업 메일 평판이 거래 메일에 얹히지 않게(회의 R6).
 * - 결과는 3값 sent|rejected|unknown. "모른다"를 성공으로 세지 않는다(H16 · 두 값으로 세 상태 금지).
 * - 수신처: 제안 발송은 인자로 받지 않는다(코드·ENV 고정 · 오발송 구조적 0). ★0905 검수 테스트 발송만 **허용 도메인 안에서**
 *   인자를 받는다(`OUTREACH_TEST_MAIL_DOMAINS` · 기본 invitocorp.com · 외부 주소는 구조적으로 막힌다 · 불변 개정).
 * - ★0905 B-11: 타임아웃 3종(connection·greeting·socket) + 총 상한 30초 + transporter.close() (agency-mailer 선례) ·
 *   수신자 판정은 꺾쇠 정규화·정확 일치(matchAddress · 공용 isRecipientRejected의 includes 대조는 포함 관계 주소에서 뒤집힌다).
 */
import nodemailer from 'nodemailer';
import { INVITO_INFO } from '../config/defaults';

export type OutreachMailOutcome = 'sent' | 'rejected' | 'unknown';

const TOTAL_TIMEOUT_MS = 30_000;

/** 발신 준비 여부 — 영업 전용 계정 ENV가 없으면 발송 축 전체를 정직하게 잠근다(폴백·차용 금지). */
export function isOutreachMailerReady(): boolean {
  return !!((process.env.OUTREACH_SMTP_USER || '').trim() && (process.env.OUTREACH_SMTP_PASS || '').trim());
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * ★ 2026-09-03 수신함 목록 파싱(순수) — 쉼표·세미콜론·공백 구분, 형식 불량 제거, 대소문자 무시 중복 제거, 순서 보존.
 * 전부 비면 기본값 1명(INVITO_INFO.email). 외부 주소를 막는 축은 여기가 아니라 "수신처는 인자로 받지 않는다"(ENV 고정)다.
 */
export function parseOutreachMailTo(raw: string | null | undefined, fallback: string = INVITO_INFO.email): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of String(raw || '').split(/[,;\s]+/)) {
    const v = part.trim();
    if (!v || !EMAIL_RE.test(v)) continue;
    const key = v.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(v);
  }
  return out.length ? out : [String(fallback || '').trim()].filter(Boolean);
}

/** 자사 수신함 주소 목록(전달용 완성본 1통의 수신처들) — OUTREACH_MAIL_TO 쉼표 목록 · 기본 = INVITO_INFO.email. */
export function outreachMailToList(): string[] {
  return parseOutreachMailTo(process.env.OUTREACH_MAIL_TO);
}

/** 표시·로그용 한 줄(", " 결합). 발송은 outreachMailToList()를 쓴다. */
export function outreachMailTo(): string {
  return outreachMailToList().join(', ');
}

// ===== 검수 테스트 수신 허용 도메인 (★ B-15) =====

/** 허용 도메인 목록(순수 파싱) — 소문자 · 앞 @ 제거 · 빈 값 제거. 전부 비면 기본 invitocorp.com. */
export function parseTestMailDomains(raw: string | null | undefined, fallback = 'invitocorp.com'): string[] {
  const out = Array.from(new Set(
    String(raw || '').split(/[,;\s]+/).map((d) => d.trim().toLowerCase().replace(/^@/, '')).filter((d) => d && /^[a-z0-9.-]+\.[a-z]{2,}$/.test(d)),
  ));
  return out.length ? out : [fallback];
}

export function outreachTestMailDomains(): string[] {
  return parseTestMailDomains(process.env.OUTREACH_TEST_MAIL_DOMAINS);
}

/** 수신 주소가 허용 도메인에 속하는가(순수) — 형식 유효 · 도메인 정확 일치(서브도메인 불허 · 대소문자 무시). */
export function isAllowedTestRecipient(to: string, domains: string[]): boolean {
  const v = String(to || '').trim();
  if (!v || !EMAIL_RE.test(v)) return false;
  const domain = v.slice(v.lastIndexOf('@') + 1).toLowerCase();
  return domains.map((d) => d.toLowerCase()).includes(domain);
}

// ===== 수신자 판정 (★ B-11 순수) =====

/** "이름 <a@b.co>" · 대소문자 · 공백을 정규화해 주소만 */
function normalizeAddress(s: unknown): string {
  const raw = String(s || '').trim();
  const m = raw.match(/<([^<>]+)>\s*$/);
  return (m ? m[1] : raw).trim().toLowerCase();
}

/** 목록 안에 정확히 그 주소가 있는가(포함 관계 `a@b.co` / `xa@b.co`를 구분한다) */
export function matchAddress(list: unknown, addr: string): boolean {
  if (!Array.isArray(list)) return false;
  const target = normalizeAddress(addr);
  if (!target) return false;
  return list.some((x) => normalizeAddress(x) === target);
}

/** nodemailer info → 3값 판정 + 수신자 분해. 전원 거부 = rejected · 1명 이상 도착 = sent · 확인 불가 = unknown. */
export function decideMailOutcome(info: any, to: string[]): { outcome: OutreachMailOutcome; accepted: string[]; rejected: string[] } {
  const rejected = to.filter((addr) => matchAddress(info?.rejected, addr));
  const accepted = to.filter((addr) => matchAddress(info?.accepted, addr));
  if (to.length > 0 && rejected.length === to.length) return { outcome: 'rejected', accepted, rejected };
  if (accepted.length > 0) return { outcome: 'sent', accepted, rejected };
  return { outcome: 'unknown', accepted, rejected };
}

// ===== 발송 (공용 하위 함수는 export 하지 않는다 — 진입점 2개만) =====

async function sendViaOutreachAccount(input: { to: string[]; subject: string; html: string; text?: string }): Promise<{ outcome: OutreachMailOutcome; detail: string; rejected: string[] }> {
  if (!isOutreachMailerReady()) {
    return { outcome: 'unknown', detail: '영업 발신 계정(OUTREACH_SMTP_USER/PASS)이 설정되지 않았습니다.', rejected: [] };
  }
  const user = (process.env.OUTREACH_SMTP_USER || '').trim();
  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp.hiworks.com',
    port: Number(process.env.SMTP_PORT) || 465,
    secure: true,
    auth: { user, pass: (process.env.OUTREACH_SMTP_PASS || '').trim() },
    // socketTimeout은 비활동 상한이라 총 소요를 못 막는다 — 아래 Promise.race가 총 상한(agency-mailer 선례)
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
  });
  try {
    const send = transporter.sendMail({
      from: `"한줄로 제안" <${user}>`,
      to: input.to,
      subject: input.subject,
      html: input.html,
      ...(input.text ? { text: input.text } : {}),
    });
    const info: any = await Promise.race([
      send,
      new Promise((_, reject) => setTimeout(() => reject(new Error('발송 총 시간 초과')), TOTAL_TIMEOUT_MS)),
    ]);
    // nodemailer는 일부 수신자 거부여도 resolve한다 — rejected 배열을 반드시 본다(회의 R7).
    const decided = decideMailOutcome(info, input.to);
    if (decided.outcome === 'rejected') {
      return { outcome: 'rejected', detail: `수신 주소가 거부되었습니다: ${decided.rejected.join(', ')}`, rejected: decided.rejected };
    }
    if (decided.outcome === 'sent') {
      const partial = decided.rejected.length ? ` (거부: ${decided.rejected.join(', ')})` : '';
      return { outcome: 'sent', detail: `${decided.accepted.join(', ')}${partial}`, rejected: decided.rejected };
    }
    // accepted에도 rejected에도 없음 = 서버는 받았는데 수신자 확인 불가 — 성공으로 접지 않는다.
    return { outcome: 'unknown', detail: '발송 결과를 확인하지 못했습니다(수신함 도착을 직접 확인해주세요).', rejected: decided.rejected };
  } catch (err: any) {
    console.error('[sales-outreach] 메일 발송 실패:', err?.message);
    return { outcome: 'unknown', detail: '발송 요청이 실패했습니다. 잠시 후 다시 시도해주세요.', rejected: [] };
  } finally {
    try { transporter.close(); } catch { /* noop */ }
  }
}

/** 제안 메일(자사 수신함 · 수신처 = ENV 고정) */
export async function sendOutreachProposalMail(input: {
  subject: string;
  html: string;
  text?: string;
}): Promise<{ outcome: OutreachMailOutcome; detail: string; rejected: string[] }> {
  return sendViaOutreachAccount({ to: outreachMailToList(), subject: input.subject, html: input.html, text: input.text });
}

/**
 * ★ B-15 검수 테스트 메일(수신처 = 허용 도메인 안의 주소 1명). 도메인 밖이면 발송하지 않고 rejected 계약으로 답한다(호출부는 그 전에 VALIDATION으로 거절한다 · 이중 방어).
 */
export async function sendOutreachTestMail(input: {
  to: string;
  subject: string;
  html: string;
  text?: string;
}): Promise<{ outcome: OutreachMailOutcome; detail: string; rejected: string[] }> {
  if (!isAllowedTestRecipient(input.to, outreachTestMailDomains())) {
    return { outcome: 'rejected', detail: '허용된 도메인의 주소가 아닙니다.', rejected: [input.to] };
  }
  return sendViaOutreachAccount({ to: [input.to.trim()], subject: input.subject, html: input.html, text: input.text });
}
