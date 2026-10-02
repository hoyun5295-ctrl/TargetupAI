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
 * ⛔ 원문 주소는 방송미디어통신위원회 누리집의 첨부 파일 주소다. 가이드라인이 개정되면 첨부가 바뀌므로
 *    `GUIDELINE_VIEWER_URL`을 새 주소로 고친다(게시물 주소 `GUIDELINE_POST_URL`은 그대로다).
 */
import { useEffect, useRef } from 'react';
import { ArrowUpRight, FileText, X } from 'lucide-react';

/** 시행일(한국 시각) — 10월 1일 회의 결정. 서버의 시행 스위치와는 별개인 「안내 문구」의 기준일이다 */
const ENFORCE_AT_MS = new Date('2026-10-26T00:00:00+09:00').getTime();
const ENFORCE_DATE_TEXT = '10월 26일';

/** 가이드라인 원문(3차 개정 · 2026-10-01) — 방송미디어통신위원회 누리집 문서 뷰어 */
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

const CHANGES: Array<{ label: string; title: string; note: string }> = [
  { label: '로그인', title: '로그인할 때마다 휴대폰 인증번호 입력', note: '담당자 휴대폰으로 6자리 번호가 갑니다' },
  { label: '계정 담당자', title: '계정마다 담당자 한 명, 본인인증 1회', note: '담당자가 바뀌면 설정에서 변경합니다' },
  { label: '문자 발송', title: '보내기 전에 발신번호 인증', note: '인증하면 8시간 유지됩니다' },
];

export default function LoginPolicyNoticeModal({ onClose }: { onClose: () => void }) {
  const confirmRef = useRef<HTMLButtonElement>(null);
  const enforced = Date.now() >= ENFORCE_AT_MS;

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

        {/* 바뀌는 것 세 가지 */}
        <div className="min-h-0 flex-1 overflow-y-auto px-6 pt-2 sm:px-9">
          <dl>
            {CHANGES.map((c) => (
              <div
                key={c.label}
                className="grid gap-x-6 gap-y-1 border-b border-slate-100 py-[18px] sm:grid-cols-[108px_1fr] sm:items-baseline"
              >
                <dt className="text-[13.5px] font-semibold text-emerald-700">{c.label}</dt>
                <dd>
                  <p className="text-[17px] font-semibold leading-snug tracking-[-0.01em] text-slate-900 sm:text-[18px]">{c.title}</p>
                  <p className="mt-1 text-[14px] leading-relaxed text-slate-500">{c.note}</p>
                </dd>
              </div>
            ))}
          </dl>

          {/* 근거 문서 */}
          <div className="my-5 flex flex-col gap-3 rounded-2xl bg-slate-50 px-4 py-4 sm:flex-row sm:items-center sm:px-5">
            <div className="flex min-w-0 flex-1 items-center gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white text-emerald-700 shadow-[0_1px_2px_rgba(15,23,42,0.08)]">
                <FileText className="h-5 w-5" strokeWidth={2} />
              </div>
              <div className="min-w-0">
                <p className="text-[14.5px] font-semibold leading-snug text-slate-900">전송자격인증제 가이드라인</p>
                <p className="mt-0.5 text-[12.5px] text-slate-500">
                  방송미디어통신위원회 ·{' '}
                  <a
                    href={GUIDELINE_POST_URL}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="underline decoration-slate-300 underline-offset-[3px] transition hover:text-slate-800 hover:decoration-slate-500 focus:outline-none focus-visible:rounded focus-visible:ring-2 focus-visible:ring-emerald-500"
                  >
                    게시물 보기
                  </a>
                </p>
              </div>
            </div>
            <a
              href={GUIDELINE_VIEWER_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex shrink-0 items-center justify-center gap-1.5 rounded-xl border border-emerald-600 bg-white px-4 py-2.5 text-[14px] font-semibold text-emerald-700 transition hover:bg-emerald-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2"
            >
              원문 PDF 보기
              <ArrowUpRight className="h-4 w-4" strokeWidth={2.4} />
            </a>
          </div>
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
