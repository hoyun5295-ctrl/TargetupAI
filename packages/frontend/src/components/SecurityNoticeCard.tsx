/**
 * SecurityNoticeCard — 고객 보안 점검 공지 카드(B) (★2026-10-29 Harold · 설계 docs/2026-10-29-customer-security-notice-ack-design.md §2-3)
 *
 * 자리 = App 전역 하나(HelpDock 옆 · 세션 가드 안) → 대시보드 · 카카오&RCS(에이전트 전용 회사) 어느 첫 화면이든 뜬다.
 * 띄울지 = 서버(GET /api/companies/notice/current) · 모르면 띄우지 않는다. 「확인했습니다」 = 서버가 204 를 준 뒤에만 사라진다(실패 = 카드 유지 + 알림).
 * ✕ = 이번 로그인 동안 닫힘(다음 로그인에 다시). 떠 있는 동안 data-interrupt-open 으로 같은 자리의 도움말 버튼을 숨긴다.
 * 로그인 단위 격리(Codex 설계 1R): 바깥이 로그인 표식(계정 id + 토큰 끝부분)을 key 로 안쪽을 새로 그린다 · 안쪽 요청은 그 세대에 묶여 늦은 응답을 버린다.
 * 겹침 순서 z-[60] = 로그인 직후 자동 창(z-[70])보다 아래(R27 · 창이 닫히면 보인다).
 */
import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { ArrowRight, X } from 'lucide-react';
import { useAuthStore } from '../stores/authStore';
import { isHelpHiddenPath } from './help/help-api';
import { useBodyFlag } from '../lib/surface-flags';
import { useToast } from './ToastProvider';
import { SECURITY_ITEMS } from '../constants/security-report';

const CLOSED_KEY = 'security-notice-closed';
const SHOWN_KEY = 'security-notice-shown';
const ACKED_KEY = 'security-notice-acked';
const ACKED_EVENT = 'security-notice-acked';
export const SECURITY_REPORT_PATH = '/security-report';

/** 로그인 표식 = 계정 id + 토큰 끝부분(토큰은 로그인할 때만 바뀐다 · authStore.login) */
function loginMarkOf(userId: string | undefined, token: string | null | undefined): string | null {
  return userId && token ? `${userId}:${token.slice(-24)}` : null;
}

/** 지금 로그인의 표식 — 확인을 「누르는 순간」에 잡아 둔다(응답 순간에 잡으면 그사이 바뀐 다른 계정 카드를 내린다) */
export function currentLoginMark(): string | null {
  const { user, token } = useAuthStore.getState();
  return loginMarkOf(user?.id, token);
}

/**
 * 확인 성공을 그 로그인 세대에 알린다(Codex 구현 1R) — 응답을 받은 카드 · 화면이 이미 내려갔어도
 * 같은 로그인에서 새로 그려진 카드가 이 표식 · 알림으로 사라진다. 다른 로그인의 카드는 표식이 달라 무시한다.
 */
export function markNoticeAcked(loginMark: string | null, noticeId: string): void {
  if (!loginMark) return;
  writeMark(ACKED_KEY, `${loginMark}|${noticeId}`);
  window.dispatchEvent(new CustomEvent(ACKED_EVENT, { detail: `${loginMark}|${noticeId}` }));
}

/** 방패 인장 — B 카드 · C 점검 기록 공용 */
export function SecuritySeal({ size = 44, tone = 'emerald' }: { size?: number; tone?: 'emerald' | 'mint' }) {
  const fill = tone === 'mint' ? '#34d399' : '#059669';
  const check = tone === 'mint' ? '#0c1a33' : '#ffffff';
  return (
    <svg width={size} height={size} viewBox="0 0 56 56" aria-hidden="true" className="shrink-0">
      <circle cx="28" cy="28" r="26" fill="none" stroke={fill} strokeOpacity=".28" strokeWidth="1" strokeDasharray="1.5 3.2" />
      <circle cx="28" cy="28" r="21" fill={fill} fillOpacity=".14" />
      <path d="M28 14.5l10 3.6v8.1c0 6.7-4.2 11.7-10 13.9-5.8-2.2-10-7.2-10-13.9v-8.1z" fill={fill} />
      <path d="M23.6 27.6l3.1 3.1 6-6.3" fill="none" stroke={check} strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** 공지 사건 기록 — 응답 코드를 그대로 돌려준다(ack 는 204 만 성공) */
export async function postNoticeEvent(noticeId: string, event: 'shown' | 'report' | 'ack', signal?: AbortSignal): Promise<number> {
  const r = await fetch('/api/companies/notice/event', {
    method: 'POST',
    headers: { Authorization: `Bearer ${localStorage.getItem('token')}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ noticeId, event }),
    signal,
  });
  return r.status;
}

function readMark(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return null; }
}
function writeMark(key: string, v: string): void {
  try { localStorage.setItem(key, v); } catch { /* 막힌 저장소 = 다음 로그인 판정은 서버가 한다 */ }
}

export default function SecurityNoticeCard() {
  const { isAuthenticated, user, token } = useAuthStore();
  const { pathname } = useLocation();
  if (!isAuthenticated || !user || user.userType === 'super_admin' || !token) return null;
  if (isHelpHiddenPath(pathname) || pathname === SECURITY_REPORT_PATH) return null;
  const loginMark = loginMarkOf(user.id, token);
  if (!loginMark) return null;
  return <NoticeCardForLogin key={loginMark} loginMark={loginMark} />;
}

function NoticeCardForLogin({ loginMark }: { loginMark: string }) {
  const navigate = useNavigate();
  const toast = useToast();
  const [noticeId, setNoticeId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    const ctl = new AbortController();
    (async () => {
      try {
        const r = await fetch('/api/companies/notice/current', {
          headers: { Authorization: `Bearer ${localStorage.getItem('token')}` },
          signal: ctl.signal,
        });
        const d = await r.json();
        const id: string | null = r.ok && d?.notice?.id ? String(d.notice.id) : null;
        if (!id || ctl.signal.aborted) return;
        if (readMark(CLOSED_KEY) === `${loginMark}|${id}` || readMark(ACKED_KEY) === `${loginMark}|${id}`) return;
        setNoticeId(id);
        // 「떴다」 = 한 로그인에 한 번(서버도 처음 한 번만 남긴다) · 화면을 떠나도 끊지 않는다 · 남겨진 것이 확인되면 표식
        if (readMark(SHOWN_KEY) !== `${loginMark}|${id}`) {
          void postNoticeEvent(id, 'shown').then((s) => { if (s === 204) writeMark(SHOWN_KEY, `${loginMark}|${id}`); }).catch(() => {});
        }
      } catch { /* 모르면 띄우지 않는다 */ }
    })();
    return () => { alive.current = false; ctl.abort(); };
  }, [loginMark]);

  // 같은 로그인의 다른 카드 · 점검 기록 화면이 받은 확인 성공 = 이 카드도 내린다
  useEffect(() => {
    if (!noticeId) return;
    const on = (e: Event) => { if ((e as CustomEvent).detail === `${loginMark}|${noticeId}`) setNoticeId(null); };
    window.addEventListener(ACKED_EVENT, on);
    return () => window.removeEventListener(ACKED_EVENT, on);
  }, [loginMark, noticeId]);

  useBodyFlag('data-interrupt-open', !!noticeId);
  if (!noticeId) return null;

  const close = () => {
    writeMark(CLOSED_KEY, `${loginMark}|${noticeId}`);
    setNoticeId(null);
  };
  const ack = async () => {
    if (saving) return;
    setSaving(true);
    try {
      const status = await postNoticeEvent(noticeId, 'ack');
      // 성공은 이 카드가 내려갔어도 로그인 세대에 알린다(이 카드도 그 알림으로 내려간다)
      if (status === 204) { markNoticeAcked(loginMark, noticeId); return; }
      if (!alive.current) return;
      toast.error('확인을 저장하지 못했습니다. 다시 눌러 주세요.');
    } catch {
      if (alive.current) toast.error('확인을 저장하지 못했습니다. 다시 눌러 주세요.');
    } finally {
      if (alive.current) setSaving(false);
    }
  };

  return (
    <div
      role="status"
      aria-labelledby="security-notice-title"
      className="fixed z-[60] bottom-3 left-3 right-3 sm:left-auto sm:right-6 sm:bottom-6 sm:w-[384px] overflow-hidden rounded-[18px] bg-white shadow-[0_24px_48px_-16px_rgba(15,23,42,0.28),0_2px_6px_rgba(15,23,42,0.06),0_0_0_1px_rgba(15,23,42,0.06)] animate-[securityCardIn_.42s_cubic-bezier(0.16,1,0.3,1)_both] motion-reduce:animate-none"
    >
      <style>{'@keyframes securityCardIn{from{opacity:0;transform:translateY(14px)}to{opacity:1;transform:none}}'}</style>
      <button
        type="button"
        onClick={close}
        aria-label="닫기"
        className="absolute right-2.5 top-2.5 flex h-8 w-8 items-center justify-center rounded-full text-slate-400 transition hover:bg-slate-100 hover:text-slate-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
      >
        <X className="h-4 w-4" strokeWidth={2.2} />
      </button>
      <div className="flex gap-3.5 px-[18px] pb-3.5 pt-[18px] pr-11">
        <SecuritySeal size={44} />
        <div className="min-w-0">
          <h4 id="security-notice-title" className="mt-0.5 text-[15.5px] font-bold leading-snug tracking-[-0.02em] text-slate-900">보안 취약점 점검을 마쳤습니다</h4>
          <p className="mt-1.5 break-keep text-[13px] leading-[1.6] text-slate-600">보호나라가 알린 PHP와 Node.js 취약점, 한줄로 서버는 조치를 끝냈습니다. 하실 일은 없습니다.</p>
        </div>
      </div>
      <div className="mx-[18px] border-t border-slate-100">
        {SECURITY_ITEMS.map((it) => (
          <div key={it.title} className="flex items-center justify-between gap-3 py-2.5 text-[13px] font-medium text-slate-800">
            <span>{it.title}</span>
            <span className={`inline-flex h-6 shrink-0 items-center gap-1.5 rounded-full px-2.5 text-xs font-semibold ring-1 ring-inset ${it.state === 'applied' ? 'bg-emerald-50 text-emerald-800 ring-emerald-200' : 'bg-slate-100 text-slate-700 ring-slate-200'}`}>
              <i className="h-1.5 w-1.5 rounded-full bg-current opacity-80" />{it.chip}
            </span>
          </div>
        ))}
      </div>
      <div className="mt-1.5 flex items-center justify-between gap-3 border-t border-slate-100 bg-slate-50/60 px-[18px] py-3">
        <button
          type="button"
          onClick={() => navigate(SECURITY_REPORT_PATH)}
          className="inline-flex items-center gap-1 text-[13.5px] font-semibold text-emerald-700 transition hover:text-emerald-800 focus:outline-none focus-visible:underline"
        >
          점검 기록 보기 <ArrowRight className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          onClick={() => void ack()}
          disabled={saving}
          className="h-[38px] rounded-[10px] bg-slate-900 px-4 text-[13.5px] font-semibold text-white transition hover:bg-slate-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2 disabled:opacity-60"
        >
          {saving ? '저장 중' : '확인했습니다'}
        </button>
      </div>
    </div>
  );
}
