/**
 * autosend-stop-link.ts — 자동마케팅 발송 예고 문자의 멈춤 링크(★2026-10-18 · 설계서 docs/2026-10-18-planner-v2-design.md §3-8)
 *
 * 예고 문자(「…자동 발송됩니다」)에 주소를 싣는다. 버튼 = [이번 회차 건너뛰기] · [자동마케팅 일시정지].
 *   둘 다 **멈추는 쪽**이라 인증번호 없이(1016 승인 설계 「멈추는 쪽 = 인증번호 없이 · 전원 통보」) · 확인 창 · 담당자 전원 통보 · 기록.
 *   효과 = 로그인 화면과 같은 CT(건너뛰기 = `adminStopProposal` · 일시정지 = `updateOperator({status:'paused'})` = 예약 발송 동반 취소).
 * 토큰 = 대행 승인 링크와 같은 형식(JWT · JWT_SECRET 도메인 분리 키 · 폴백 키 없음 = 미설정이면 발급 중단 · 검증 null) ·
 *   주소 # 뒤 · API 운반 = 헤더(접근 로그 · Referer 로 새지 않는다) · 만료 = 예정 발송 시각 + 1시간(최소 1시간).
 * ⛔ 링크로 하는 일은 멈추는 일뿐이다(승인 · 재개 · 고치기 없음 · 그건 로그인 화면).
 */
import jwt from 'jsonwebtoken';
import { query } from '../config/database';
import { createShortUrl } from './short-url';

export const AUTOSEND_STOP_TOKEN_HEADER = 'x-autosend-stop-token';
const SCOPE = 'autosend_stop';
const AFTER_SEND_SECONDS = 3600;
const MIN_TTL_SECONDS = 3600;

function key(): string {
  const s = process.env.JWT_SECRET;
  if (!s) throw new Error('JWT_SECRET 미설정: 자동마케팅 멈춤 링크를 서명 · 검증할 수 없습니다.');
  return `autosend-stop:${s}`;
}

export interface AutosendStopPayload { proposalId: string; operatorId: string; companyId: string }

/** 만료 초 = 예정 발송 시각 + 1시간(최소 1시간) */
export function autosendStopTtlSeconds(sendAt: Date, now: Date = new Date()): number {
  return Math.max(MIN_TTL_SECONDS, Math.ceil((sendAt.getTime() - now.getTime()) / 1000) + AFTER_SEND_SECONDS);
}

export function signAutosendStopToken(p: AutosendStopPayload & { sendAt: Date; now?: Date }): string {
  return jwt.sign({ scope: SCOPE, pr: p.proposalId, op: p.operatorId, co: p.companyId }, key(), {
    algorithm: 'HS256', expiresIn: autosendStopTtlSeconds(p.sendAt, p.now ?? new Date()),
  });
}

export function verifyAutosendStopToken(token: string): AutosendStopPayload | null {
  if (!token) return null;
  try {
    const d = jwt.verify(token, key(), { algorithms: ['HS256'] }) as any;
    if (!d || d.scope !== SCOPE || !d.pr || !d.op || !d.co) return null;
    return { proposalId: String(d.pr), operatorId: String(d.op), companyId: String(d.co) };
  } catch {
    return null;
  }
}

/** 예고 문자에 실을 주소(단축 · 실패 = 원본) — 서명 실패(키 없음)면 null(호출부가 링크 없이 옛 문장으로 보낸다) */
export async function buildAutosendStopUrl(p: AutosendStopPayload & { sendAt: Date }): Promise<string | null> {
  let full: string;
  try {
    const base = String(process.env.HANJUL_BASE_URL || 'https://hanjul.ai').replace(/\/+$/, '');
    full = `${base}/autosend-stop#t=${encodeURIComponent(signAutosendStopToken(p))}`;
  } catch (err: any) {
    console.warn('[autosend-stop-link] 링크 서명 실패(링크 없이 안내):', err?.message);
    return null;
  }
  try {
    const now = new Date();
    const { shortUrl } = await createShortUrl({ companyId: p.companyId, fullUrl: full, expiresAt: new Date(now.getTime() + autosendStopTtlSeconds(p.sendAt, now) * 1000) });
    return shortUrl;
  } catch (err: any) {
    console.warn('[autosend-stop-link] 링크 단축 실패(원본 주소로 안내):', err?.message);
    return full;
  }
}

export interface AutosendStopView {
  operatorName: string;
  operatorStatus: string;
  proposalStatus: string;
  sendAt: string | null;
  recipientCount: number;
  body: string;
  /** 이번 회차를 아직 멈출 수 있는가(예약 대기 · 검토 대기 · 승인 대기만) */
  canSkip: boolean;
  /** 자동마케팅이 켜져 있는가(켜져 있어야 일시정지) */
  canPause: boolean;
}

/** 링크 화면 재료(이 회사 · 이 자동마케팅 · 이 회차만) — 없음 = null(같은 404) */
export async function loadAutosendStopView(p: AutosendStopPayload): Promise<AutosendStopView | null> {
  const r = await query(
    `SELECT pr.status AS proposal_status, pr.scheduled_send_at, pr.recipient_count, pr.proposal_json,
            op.name AS operator_name, op.status AS operator_status
       FROM operator_proposals pr
       JOIN continuous_operators op ON op.id = pr.operator_id AND op.company_id = pr.company_id
      WHERE pr.id = $1::uuid AND pr.operator_id = $2::uuid AND pr.company_id = $3::uuid`,
    [p.proposalId, p.operatorId, p.companyId],
  );
  const row = r.rows[0];
  if (!row) return null;
  const msg = row.proposal_json?.messages?.[0] || {};
  return {
    operatorName: String(row.operator_name || ''),
    operatorStatus: String(row.operator_status || ''),
    proposalStatus: String(row.proposal_status || ''),
    sendAt: row.scheduled_send_at ? new Date(row.scheduled_send_at).toISOString() : null,
    recipientCount: Number(row.recipient_count || 0),
    body: String(msg.body || msg.message || '').slice(0, 2000),
    canSkip: ['scheduled', 'admin_review', 'pending'].includes(String(row.proposal_status || '')),
    canPause: String(row.operator_status || '') === 'active',
  };
}
