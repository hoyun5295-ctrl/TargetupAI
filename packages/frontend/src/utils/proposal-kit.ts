/**
 * proposal-kit.ts — 제안 페이지(/proposal)의 서버 호출 · 완성본을 직접발송 작성 화면에 넘기는 값
 *   (★ 2026-11-16 C136 배포 나 · 설계서 docs/2026-11-16-c136-proposal-kit-trial-design.md §3 · §4 · §6)
 *
 * 화면에는 소개 글이 없다 — 서버가 로그인한 요청에만 준다(GET /api/plans/proposal).
 * 넘김 값(「명단만 올려 보내기」) = **고른 번호만**(포스터 · 문안 · DM 여부 + 누른 계정 · 회사 · 시각). 문안 · 주소 같은 내용은 싣지 않는다.
 *   대시보드는 지금 로그인한 계정 · 회사와 같고 10분 안일 때만 쓰고, 내용은 서버가 권한과 전달 상태를 다시 본 뒤 준다(Codex 설계 1R —
 *   계정을 바꿔 로그인해도 앞 회사의 문안이 작성 칸에 들어가지 않는다).
 */
import { fetchJson } from './dashboard-live';

export type ProposalSpam = 'none' | 'pass' | 'blocked' | 'checking' | 'rejected' | 'unknown';
export type ProposalChannel = 'LMS' | 'MMS';
export type ProposalView =
  | { state: 'none' }
  | { state: 'other' }
  | { state: 'working'; brief: string; channel: ProposalChannel; photos: string[]; notifyPhone: string }
  | { state: 'ready'; brief: string; channel: ProposalChannel; posters: Array<{ url: string }>; copies: Array<{ subject: string; text: string; spam: ProposalSpam }>; dmUrl: string | null };
export interface ProposalPayload { view: ProposalView; content: { css: string; html: string }; phone: string }

const STATES = ['none', 'other', 'working', 'ready'];

/** 링크의 src — 영문 · 숫자 · - _ . 40자(서버 cleanProposalSrc 와 같은 꼴) */
export function cleanProposalSrc(v: unknown): string | null {
  const s = typeof v === 'string' ? v.trim() : '';
  return /^[A-Za-z0-9._-]{1,40}$/.test(s) ? s : null;
}

/** 로그인 전 열람 기록(결과를 보지 않는다 · 실패해도 화면은 그대로) */
export function reportProposalView(src: string | null): void {
  try {
    void fetch('/api/plans/proposal/view', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ src: src || '' }), keepalive: true }).catch(() => undefined);
  } catch { /* 기록 실패 = 화면 영향 0 */ }
}

/** 제안 페이지가 그릴 것 — 꼴이 맞는 답만 받는다 · 403 = 이 계정에서는 볼 수 없는 화면 */
export async function fetchProposal(src: string | null): Promise<{ ok: true; data: ProposalPayload } | { ok: false; status: number }> {
  const r = await fetchJson(`/api/plans/proposal${src ? `?src=${encodeURIComponent(src)}` : ''}`, 15_000);
  const d: any = r.body;
  if (!r.ok || d?.success !== true || !d.view || !STATES.includes(d.view.state) || typeof d.content?.css !== 'string' || typeof d.content?.html !== 'string') {
    return { ok: false, status: r.status };
  }
  return { ok: true, data: { view: d.view, content: { css: d.content.css, html: d.content.html }, phone: typeof d.phone === 'string' ? d.phone : '' } };
}

export interface ProposalForm { photos: File[]; brief: string; channel: ProposalChannel; extra: string; notifyPhone: string; src: string | null }
/** 신청 — 사진은 multipart 로 올린다. 서버 안내 문구를 그대로 돌려준다 */
export async function submitProposal(form: ProposalForm, timeoutMs = 60_000): Promise<{ ok: true } | { ok: false; error: string; code?: string }> {
  const body = new FormData();
  for (const f of form.photos) body.append('photos', f);
  body.append('brief', form.brief);
  body.append('channel', form.channel);
  body.append('extra', form.extra);
  body.append('notifyPhone', form.notifyPhone);
  if (form.src) body.append('src', form.src);
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const r = await fetch('/api/plans/proposal/request', { method: 'POST', headers: { Authorization: `Bearer ${localStorage.getItem('token')}` }, body, signal: ctl.signal });
    const d: any = await r.json().catch(() => null);
    if (r.ok && d?.success === true) return { ok: true };
    return { ok: false, error: (d && typeof d.error === 'string' && d.error) || '신청하지 못했어요. 잠시 후 다시 눌러 주세요.', code: d?.code };
  } catch {
    return { ok: false, error: '신청하지 못했어요. 연결을 확인하고 다시 눌러 주세요.' };
  } finally {
    clearTimeout(timer);
  }
}

// ─────────────── 넘김 값(번호만) ───────────────

const PICK_KEY = 'hj_proposal_kit_pick';
export const PROPOSAL_PICK_MAX_AGE_MS = 10 * 60_000;
export interface ProposalPick { userId: string; companyId: string; poster: number | null; copy: number; withDm: boolean; at: number }

const idx = (v: unknown): v is number => v === 0 || v === 1 || v === 2;

/** 넘김 — 고른 번호와 누른 계정 · 회사 · 시각만 남긴다(내용 0) */
export function stashProposalPick(p: Omit<ProposalPick, 'at'>, now: number = Date.now()): boolean {
  try {
    sessionStorage.setItem(PICK_KEY, JSON.stringify({ ...p, at: now }));
    return true;
  } catch {
    return false;
  }
}

/**
 * 한 번 꺼내고 지운다 — 지금 로그인한 계정 · 회사와 같고 10분 안이고 꼴이 맞을 때만 돌려준다(그 밖 = null · 값은 지워진다).
 */
export function takeProposalPick(me: { userId?: string | null; companyId?: string | null } | null, now: number = Date.now()): ProposalPick | null {
  let raw: string | null = null;
  try {
    raw = sessionStorage.getItem(PICK_KEY);
    sessionStorage.removeItem(PICK_KEY);
  } catch {
    return null;
  }
  if (!raw) return null;
  let p: any = null;
  try { p = JSON.parse(raw); } catch { return null; }
  if (!p || typeof p !== 'object') return null;
  if (!me?.userId || !me.companyId || p.userId !== me.userId || p.companyId !== me.companyId) return null;
  if (typeof p.at !== 'number' || now - p.at < 0 || now - p.at > PROPOSAL_PICK_MAX_AGE_MS) return null;
  if (!idx(p.copy) || !(p.poster === null || idx(p.poster)) || typeof p.withDm !== 'boolean') return null;
  return { userId: p.userId, companyId: p.companyId, poster: p.poster, copy: p.copy, withDm: p.withDm, at: p.at };
}

export interface ProposalFill { message: string; subject: string; msgType: ProposalChannel; assetId: string | null }
/** 작성 화면에 채울 값 — 서버가 지금 계정의 권한과 전달 상태를 다시 보고 준다(못 받으면 null = 아무것도 채우지 않는다) */
export async function fetchProposalFill(pick: Pick<ProposalPick, 'poster' | 'copy' | 'withDm'>): Promise<ProposalFill | null> {
  const q = new URLSearchParams({ copy: String(pick.copy), dm: pick.withDm ? '1' : '0' });
  if (pick.poster !== null) q.set('poster', String(pick.poster));
  const r = await fetchJson(`/api/plans/proposal/fill?${q.toString()}`);
  const f: any = r.body?.fill;
  if (!r.ok || r.body?.success !== true || !f || typeof f.message !== 'string' || typeof f.subject !== 'string') return null;
  if (f.msgType !== 'LMS' && f.msgType !== 'MMS') return null;
  return { message: f.message, subject: f.subject, msgType: f.msgType, assetId: typeof f.assetId === 'string' ? f.assetId : null };
}
