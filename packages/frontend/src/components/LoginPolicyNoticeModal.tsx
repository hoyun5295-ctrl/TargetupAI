/**
 * LoginPolicyNoticeModal — 로그인 화면 사전 고지 창 (★2026-10-02 전송자격인증 · Harold 지시)
 *
 * 무엇을 알리나
 *   시행일부터 로그인 인증번호 · 계정 담당자 본인인증 · 발신번호 인증이 붙는다는 것과,
 *   이것이 한줄로만의 정책이 아니라 고시에 따라 모든 대량문자 발송 사업자에게 적용된다는 것.
 *
 * 노출 규칙
 *   - 고객사 로그인 화면에 들어올 때마다 뜬다(확인했다고 영구히 숨기지 않는다).
 *   - 「오늘 하루 보지 않기」를 누르면 그날(한국 날짜)만 숨는다.
 *   - 시행일이 지나면 문구가 「시행 중」으로 바뀐다. 끄는 시점은 따로 정한다.
 *   - 판정은 `shouldShowLoginPolicyNotice`가 한다. 호출부가 날짜·저장값을 다시 계산하지 않는다.
 *
 * 무엇을 보여 주나 (★2026-10-03 저녁 Harold — 가이드라인 발췌 · 원문 링크를 뺐다)
 *   「전송자격인증제 신청서류 작성 가이드라인」은 인증을 신청하는 사업자(우리)가 서류를 쓰는 기준이라 고객사가 읽을 문서가 아니다.
 *   그래서 항목마다 **고객사에 바뀌는 것**(`detail`)을 우리 말로 적고, 근거는 맨 아래 한 줄(링크 없음)로만 둔다.
 *   ⛔ `detail` 은 지금 구현된 동작만 적는다(인증번호 6자리 · 매 로그인 · 담당자 휴대폰 · 발신 인증 유지 시간 = `SENDER_AUTH_TRUST_HOURS`).
 *      동작이 바뀌면 이 문구를 같이 고친다(계약 테스트가 유지 시간을 코드 값과 대조한다).
 */
import { useEffect, useRef } from 'react';
import { X } from 'lucide-react';
import { POLICY_ENFORCE_DATE_TEXT, isPolicyEnforced } from '../constants/sendAuthPolicy';

/** 시행일 — 설정 화면 카드와 같은 날짜를 본다(`constants/sendAuthPolicy.ts`) */
const ENFORCE_DATE_TEXT = POLICY_ENFORCE_DATE_TEXT;

const HIDE_KEY = 'loginPolicyNoticeHiddenOn';

/** 한국 날짜(YYYY-MM-DD) — 「오늘 하루」의 기준 */
function todayInSeoul(): string {
  return new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' });
}

/** 지금 이 창을 띄울지 — 「오늘 하루 보지 않기」를 누른 날에만 숨긴다 */
export function shouldShowLoginPolicyNotice(): boolean {
  try {
    return localStorage.getItem(HIDE_KEY) !== todayInSeoul();
  } catch {
    return true;
  }
}

function hideLoginPolicyNoticeToday(): void {
  try {
    localStorage.setItem(HIDE_KEY, todayInSeoul());
  } catch {
    /* 저장이 막힌 브라우저에서는 다음 방문에 다시 뜬다 */
  }
}

/** 바뀌는 것 세 가지 — 제목과 `detail` 모두 고객사에 바뀌는 것을 우리 말로(지금 구현된 동작만) */
const CHANGES: Array<{ label: string; title: string; detail: string }> = [
  {
    label: '로그인',
    title: '로그인할 때마다 휴대폰 인증번호 입력',
    detail: '아이디 · 비밀번호를 넣은 뒤, 계정 담당자 휴대폰으로 온 6자리 인증번호를 넣어야 로그인됩니다. 로그인할 때마다 묻습니다.',
  },
  {
    label: '계정 담당자',
    title: '계정마다 담당자 한 명, 본인인증 1회',
    detail: '계정마다 담당자 한 명이 처음 한 번 본인인증을 합니다. 인증번호는 그 담당자 휴대폰으로 갑니다. 담당자가 바뀌면 설정에서 새 담당자가 다시 인증합니다.',
  },
  {
    label: '문자 발송',
    title: '보내기 전에 발신번호 인증, 8시간 유지',
    detail: '문자를 보내기 전에 그 발신번호로 담당자 휴대폰 인증을 한 번 합니다. 인증하면 같은 접속 환경에서는 8시간 동안 다시 묻지 않습니다.',
  },
];

export default function LoginPolicyNoticeModal({ onClose }: { onClose: () => void }) {
  const confirmRef = useRef<HTMLButtonElement>(null);
  const enforced = isPolicyEnforced();

  useEffect(() => {
    confirmRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const hideToday = () => {
    hideLoginPolicyNoticeToday();
    onClose();
  };

  return (
    <div
      className="lpn-backdrop fixed inset-0 z-40 flex items-center justify-center bg-slate-900/55 p-3 backdrop-blur-sm sm:p-6"
      role="presentation"
    >
      <style>{`
        @keyframes lpnBackdrop { from { opacity: 0; } to { opacity: 1; } }
        @keyframes lpnPanel {
          from { opacity: 0; transform: translateY(14px) scale(0.975); }
          to { opacity: 1; transform: translateY(0) scale(1); }
        }
        .lpn-backdrop { animation: lpnBackdrop 0.22s ease-out both; }
        .lpn-panel { animation: lpnPanel 0.42s cubic-bezier(0.16, 1, 0.3, 1) both; }
        .lpn-panel ::selection { background: #a7f3d0; color: #064e3b; }
        @media (prefers-reduced-motion: reduce) {
          .lpn-backdrop, .lpn-panel { animation: none; }
        }
      `}</style>

      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="lpn-title"
        className="lpn-panel flex max-h-[calc(100vh-1.5rem)] w-full max-w-[720px] flex-col overflow-hidden rounded-[22px] bg-white shadow-[0_28px_70px_-18px_rgba(15,23,42,0.55)]"
      >
        {/* 머리 — 로그인 화면 브랜드 패널과 같은 색 */}
        <div className="relative shrink-0 overflow-hidden bg-gradient-to-br from-emerald-600 via-teal-700 to-blue-800 px-6 pb-5 pt-6 sm:px-9 sm:pb-6 sm:pt-7">
          <div className="pointer-events-none absolute -right-16 -top-20 h-56 w-56 rounded-full bg-white/[0.07]" />
          <div className="pointer-events-none absolute -bottom-24 right-24 h-44 w-44 rounded-full bg-white/[0.05]" />

          <button
            type="button"
            onClick={onClose}
            aria-label="닫기"
            className="absolute right-3.5 top-3.5 flex h-9 w-9 items-center justify-center rounded-full text-white/75 transition hover:bg-white/15 hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-white/80"
          >
            <X className="h-5 w-5" strokeWidth={2.2} />
          </button>

          <h3
            id="lpn-title"
            className="relative pr-8 text-[21px] font-bold leading-[1.3] tracking-[-0.02em] text-white [text-wrap:balance] sm:text-[24px]"
          >
            {enforced ? (
              <>로그인·발송 인증이<br />의무 적용되고 있습니다</>
            ) : (
              <>{ENFORCE_DATE_TEXT}부터<br />로그인·발송 인증이 의무화됩니다</>
            )}
          </h3>
          <p className="relative mt-2.5 break-keep text-[14px] leading-[1.6] text-emerald-50 sm:text-[15px]">
            {enforced && <>{ENFORCE_DATE_TEXT}부터 시행 중입니다.<br /></>}
            한줄로만의 정책이 아닙니다.
            <br />
            방송미디어통신위원회 고시에 따라{' '}
            <b className="font-semibold text-white">모든 대량문자 발송 사업자</b>에게 똑같이 적용됩니다.
          </p>
        </div>

        {/* 바뀌는 것 세 가지 — 고객사에 바뀌는 것 */}
        <div className="min-h-0 flex-1 overflow-y-auto px-6 sm:px-9">
          <dl>
            {CHANGES.map((c) => (
              <div
                key={c.label}
                className="grid gap-x-5 gap-y-1 border-b border-slate-100 py-3 sm:grid-cols-[84px_1fr] sm:items-baseline"
              >
                <dt className="text-[13px] font-semibold text-emerald-700">{c.label}</dt>
                <dd>
                  <p className="text-[15.5px] font-semibold leading-snug tracking-[-0.01em] text-slate-900 sm:text-[16px]">{c.title}</p>
                  <p className="mt-1.5 break-keep rounded-lg bg-slate-50 px-3 py-2 text-[13.5px] leading-[1.6] text-slate-700">{c.detail}</p>
                </dd>
              </div>
            ))}
          </dl>

          {/* 근거 — 맨 아래 한 줄(링크 없음) */}
          <p className="py-3 text-[12px] leading-relaxed text-slate-500">
            근거: 방송미디어통신위원회 전송자격인증제(2026년 10월 26일 전 사업자 시행)
          </p>
        </div>

        {/* 버튼 */}
        <div className="flex shrink-0 items-center justify-between gap-3 border-t border-slate-100 px-6 py-3 sm:px-9">
          <button
            type="button"
            onClick={hideToday}
            className="rounded-lg px-2 py-2 text-[13.5px] font-medium text-slate-500 transition hover:text-slate-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
          >
            오늘 하루 보지 않기
          </button>
          <button
            ref={confirmRef}
            type="button"
            onClick={onClose}
            className="rounded-xl bg-emerald-600 px-7 py-2.5 text-[15px] font-semibold text-white transition hover:bg-emerald-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2 active:bg-emerald-800"
          >
            확인했습니다
          </button>
        </div>
      </div>
    </div>
  );
}
