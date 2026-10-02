/**
 * LoginPolicyNoticeModal — 로그인 화면 사전 고지 창 (★2026-10-02 전송자격인증 · Harold 지시)
 *
 * 무엇을 알리나
 *   시행일부터 로그인 인증번호 · 계정 담당자 본인인증 · 발신번호 인증이 붙는다는 것과,
 *   이것이 한줄로만의 정책이 아니라 고시에 따라 모든 대량문자 발송 사업자에게 적용된다는 것.
 *   직원이 고객에게 안내할 때 이 창과 가이드라인 원문을 함께 보여 줄 수 있어야 한다.
 *
 * 노출 규칙
 *   - 고객사 로그인 화면에 들어올 때마다 뜬다(확인했다고 영구히 숨기지 않는다).
 *   - 「오늘 하루 보지 않기」를 누르면 그날(한국 날짜)만 숨는다.
 *   - 시행일이 지나면 문구가 「시행 중」으로 바뀐다. 끄는 시점은 따로 정한다.
 *   - 판정은 `shouldShowLoginPolicyNotice`가 한다. 호출부가 날짜·저장값을 다시 계산하지 않는다.
 *
 * 근거 표시 (★2026-10-03 Harold)
 *   원문 전체로 보내지 않고 **해당 항목의 문장만 발췌**해서 바뀌는 것 옆에 붙인다. 정확한 원문 주소는 맨 아래에 둔다.
 *   발췌는 가이드라인 문장을 **글자 그대로** 옮긴 것이다(3차 개정판 8 · 14 · 15쪽을 누리집 뷰어에서 대조).
 *   ⛔ 고쳐 쓰거나 줄이지 않는다. 규제기관 문서를 인용이라고 내걸면서 문장을 바꾸면 인용이 아니다.
 *   공공누리 1유형(출처 표시 조건 자유 이용) · 출처는 맨 아래 원문 줄이 표시한다.
 *
 * ⛔ 가이드라인이 개정되면 ①발췌 문장과 쪽수를 새 판과 다시 대조하고 ②`GUIDELINE_VIEWER_URL`(첨부 파일 주소)과
 *    `GUIDELINE_REVISION_TEXT`를 고친다. 게시물 주소 `GUIDELINE_POST_URL`은 그대로다.
 */
import { useEffect, useRef } from 'react';
import { ArrowUpRight, X } from 'lucide-react';
import { POLICY_ENFORCE_DATE_TEXT, isPolicyEnforced } from '../constants/sendAuthPolicy';

/** 시행일 — 설정 화면 카드와 같은 날짜를 본다(`constants/sendAuthPolicy.ts`) */
const ENFORCE_DATE_TEXT = POLICY_ENFORCE_DATE_TEXT;

/** 가이드라인 원문(3차 개정 · 2026-10-01) — 방송미디어통신위원회 누리집 문서 뷰어 */
const GUIDELINE_REVISION_TEXT = '2026. 10. 1. 3차 개정';
const GUIDELINE_VIEWER_URL =
  'https://www.kmcc.go.kr/synap/viewer.jsp?file=%2Fapp%2Fhomepage%2Fupload%2Fdata%2FHMP_1099%2Ffile928901960647183783.pdf';
/** 가이드라인 게시물(개정되어도 주소가 같다) */
const GUIDELINE_POST_URL =
  'https://www.kmcc.go.kr/user.do?mode=view&page=A02030700&dc=K02030700&boardId=1099&cp=1&nop=10&boardSeq=68538';

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

/** 바뀌는 것 세 가지 — 제목은 우리 말, `quote`는 가이드라인 문장 그대로(고치지 않는다) */
const CHANGES: Array<{ label: string; title: string; source: string; quote: string }> = [
  {
    label: '로그인',
    title: '로그인할 때마다 휴대폰 인증번호 입력',
    source: '3.4 다중 인증 · 14쪽',
    quote: '단순 ID/PW만으로는 계정 탈취 위험이 크므로, 이용자 계정 접속 시 다중인증 방식을 적용해야 한다.',
  },
  {
    label: '계정 담당자',
    title: '계정마다 담당자 한 명, 본인인증 1회',
    source: '2.1 계정관리 · 8쪽',
    quote: '회원가입 시 검증된 본인확인기관의 서비스를 통해 이용자 본인확인을 수행하고, 본인확인 결과를 계정과 연계하여 중복가입을 차단하여야 한다.',
  },
  {
    label: '문자 발송',
    title: '보내기 전에 발신번호 인증, 8시간 유지',
    source: '3.5 추가 인증 · 15쪽',
    quote: '추가인증은 문자 발송 시 해당 발신번호와 발송 계정의 정당한 연계성을 확인하여 발신번호 도용과 대량 문자 남용을 방지하기 위한 절차이다.',
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
        className="lpn-panel flex max-h-[calc(100vh-1.5rem)] w-full max-w-[640px] flex-col overflow-hidden rounded-[22px] bg-white shadow-[0_28px_70px_-18px_rgba(15,23,42,0.55)]"
      >
        {/* 머리 — 로그인 화면 브랜드 패널과 같은 색 */}
        <div className="relative shrink-0 overflow-hidden bg-gradient-to-br from-emerald-600 via-teal-700 to-blue-800 px-6 pb-7 pt-7 sm:px-9 sm:pb-8 sm:pt-9">
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
            className="relative pr-8 text-[23px] font-bold leading-[1.32] tracking-[-0.02em] text-white [text-wrap:balance] sm:text-[29px]"
          >
            {enforced ? (
              <>로그인·발송 인증이<br />의무 적용되고 있습니다</>
            ) : (
              <>{ENFORCE_DATE_TEXT}부터<br />로그인·발송 인증이 의무화됩니다</>
            )}
          </h3>
          <p className="relative mt-3.5 max-w-[30em] text-[15px] leading-[1.65] text-emerald-50 sm:text-[16px]">
            {enforced && <>{ENFORCE_DATE_TEXT}부터 시행 중입니다. </>}
            한줄로만의 정책이 아닙니다. 방송미디어통신위원회 고시에 따라{' '}
            <b className="font-semibold text-white">모든 대량문자 발송 사업자</b>에게 똑같이 적용됩니다.
          </p>
        </div>

        {/* 바뀌는 것 세 가지 + 그 근거가 되는 가이드라인 문장 */}
        <div className="min-h-0 flex-1 overflow-y-auto px-6 pt-2 sm:px-9">
          <dl>
            {CHANGES.map((c) => (
              <div
                key={c.label}
                className="grid gap-x-6 gap-y-1.5 border-b border-slate-100 py-[18px] sm:grid-cols-[108px_1fr] sm:items-baseline"
              >
                <dt className="text-[13.5px] font-semibold text-emerald-700">{c.label}</dt>
                <dd>
                  <p className="text-[17px] font-semibold leading-snug tracking-[-0.01em] text-slate-900 sm:text-[18px]">{c.title}</p>
                  <figure className="mt-2.5 rounded-xl bg-slate-50 px-3.5 py-3">
                    <figcaption className="text-[12px] font-semibold text-slate-500">가이드라인 {c.source}</figcaption>
                    <blockquote className="mt-1 text-[14px] leading-[1.65] text-slate-700">{c.quote}</blockquote>
                  </figure>
                </dd>
              </div>
            ))}
          </dl>

          {/* 원문 — 맨 아래 */}
          <p className="py-4 text-[12.5px] leading-relaxed text-slate-500">
            원문: 방송미디어통신위원회 「전송자격인증제 신청서류 작성 가이드라인」 ({GUIDELINE_REVISION_TEXT}){' '}
            <a
              href={GUIDELINE_VIEWER_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="ml-1 inline-flex items-center gap-0.5 whitespace-nowrap font-semibold text-emerald-700 underline decoration-emerald-300 underline-offset-[3px] transition hover:decoration-emerald-600 focus:outline-none focus-visible:rounded focus-visible:ring-2 focus-visible:ring-emerald-500"
            >
              원문 PDF 보기
              <ArrowUpRight className="h-3.5 w-3.5" strokeWidth={2.4} />
            </a>
            <a
              href={GUIDELINE_POST_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="ml-3 inline-flex items-center gap-0.5 whitespace-nowrap font-semibold text-slate-600 underline decoration-slate-300 underline-offset-[3px] transition hover:text-slate-900 hover:decoration-slate-500 focus:outline-none focus-visible:rounded focus-visible:ring-2 focus-visible:ring-emerald-500"
            >
              게시물
              <ArrowUpRight className="h-3.5 w-3.5" strokeWidth={2.4} />
            </a>
          </p>
        </div>

        {/* 버튼 */}
        <div className="flex shrink-0 items-center justify-between gap-3 border-t border-slate-100 px-6 py-4 sm:px-9">
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
            className="rounded-xl bg-emerald-600 px-7 py-3 text-[15px] font-semibold text-white transition hover:bg-emerald-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2 active:bg-emerald-800"
          >
            확인했습니다
          </button>
        </div>
      </div>
    </div>
  );
}
