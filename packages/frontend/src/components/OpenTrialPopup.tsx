import { useCallback, useEffect, useRef, useState } from "react";

/* ------------------------------------------------------------------ *
 *  OpenTrialPopup — AI Operator BETA 오픈 기념 BASIC 1개월 무료체험 팝업
 *  로그인 직후 뜨는 메인 팝업 (Dashboard에서 FREE/미가입에만 마운트).
 *
 *  - "지금 신청하면 1개월 무료 체험" → POST /api/companies/trial-request (BASIC)
 *  - 신청 성공 시 카드 내용을 "신청되었습니다" 성공 뷰로 스왑 (다크 톤 유지, native dialog X)
 *  - 셀프 게이팅: shouldShowOpenTrial() (24h dismiss). 부모는 요금제 게이팅만.
 *  - Modal wrapper + 우상단 close(X) + ESC + backdrop 닫기 / "오늘 하루 보지 않기" 24h
 * ------------------------------------------------------------------ */

const DISMISS_KEY = "targetup_trialpromo_dismiss";
const DISMISS_MS = 24 * 60 * 60 * 1000;

/**
 * ★ 무료체험 신청 마감 (Harold 확정 2026-06-11): 2026-06-30 23:59:59 KST까지만 신청 접수.
 *   UTC 표기 = 2026-06-30T14:59:59.999Z (사용자 기기 TZ와 무관하게 동일 epoch 비교).
 *   backend 대응 상수 = packages/backend/src/utils/basic-trial.ts TRIAL_APPLY_DEADLINE
 *   (마감 변경 시 양쪽 동시 수정 의무). 서버 trial-request에도 동일 가드가 있어 화면은 안내용.
 */
export const TRIAL_APPLY_DEADLINE_MS = Date.parse("2026-06-30T14:59:59.999Z");

/** 무료체험 신청 가능 기간 여부 (마감 시각 포함) — 헤더 버튼 노출 게이팅과 공용 */
export function isTrialApplyOpen(): boolean {
  return Date.now() <= TRIAL_APPLY_DEADLINE_MS;
}

const GRAD =
  "bg-gradient-to-r from-violet-300 via-fuchsia-300 to-fuchsia-400 bg-clip-text text-transparent";

/** 자동 노출 여부 = 신청 기간 내 + 24h dismiss 아님. */
export function shouldShowOpenTrial(): boolean {
  if (typeof window === "undefined") return false;
  if (!isTrialApplyOpen()) return false;
  try {
    const until = Number(localStorage.getItem(DISMISS_KEY) || 0);
    return !(until && Date.now() < until);
  } catch {
    return true;
  }
}

type CloseReason = "x" | "esc" | "backdrop" | "later" | "done";

type Props = {
  onClose?: (reason: CloseReason) => void;
  /** 헤더 "30일 무료체험" 버튼 진입 — 24h dismiss를 무시하고 즉시 연다 (마감 후에는 열지 않음). */
  forceOpen?: boolean;
};

export default function OpenTrialPopup({ onClose, forceOpen }: Props) {
  const [open, setOpen] = useState(() => (forceOpen ? isTrialApplyOpen() : shouldShowOpenTrial()));
  const [dontShow, setDontShow] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);

  const close = useCallback(
    (reason: CloseReason) => {
      if (dontShow) {
        try {
          localStorage.setItem(DISMISS_KEY, String(Date.now() + DISMISS_MS));
        } catch {
          /* noop */
        }
      }
      setOpen(false);
      onClose?.(reason);
    },
    [dontShow, onClose]
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close("esc");
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [close]);

  const handleCta = async () => {
    if (submitting) return;
    setSubmitting(true);
    setErrorMsg(null);
    try {
      const token = localStorage.getItem("token");
      const res = await fetch("/api/companies/trial-request", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data?.success) {
        setSubmitted(true);
      } else {
        setErrorMsg(data?.error || "무료체험 신청에 실패했습니다. 잠시 후 다시 시도해주세요.");
      }
    } catch {
      setErrorMsg("네트워크 오류로 신청에 실패했습니다. 잠시 후 다시 시도해주세요.");
    } finally {
      setSubmitting(false);
    }
  };

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[9998] flex items-center justify-center overflow-y-auto p-4 sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-labelledby="trial-title"
    >
      <style>{KEYFRAMES}</style>

      <div
        data-anim="backdrop"
        onClick={() => close("backdrop")}
        className="absolute inset-0 bg-black/70 backdrop-blur-sm"
      />

      <div
        ref={cardRef}
        data-anim="card"
        className="relative w-full max-w-[500px] overflow-hidden rounded-2xl border border-white/10 bg-gradient-to-br from-slate-900 via-slate-900 to-slate-950 shadow-2xl"
      >
        <div
          data-anim="glow"
          style={{ animationDelay: ".1s", background: "radial-gradient(circle at 70% 30%, rgba(167,139,250,0.28), transparent 60%)" }}
          className="pointer-events-none absolute -right-24 -top-24 h-64 w-64 blur-3xl"
          aria-hidden
        />
        <div
          data-anim="glow"
          style={{ animationDelay: ".18s", background: "radial-gradient(circle at 30% 75%, rgba(217,70,239,0.22), transparent 60%)" }}
          className="pointer-events-none absolute -bottom-28 -left-24 h-72 w-72 blur-3xl"
          aria-hidden
        />
        <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/25 to-transparent" />

        <button
          type="button"
          onClick={() => close("x")}
          aria-label="닫기"
          className="absolute right-3.5 top-3.5 z-10 grid h-9 w-9 place-items-center rounded-full text-white/45 transition hover:bg-white/10 hover:text-white"
        >
          <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5" aria-hidden>
            <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
        </button>

        {submitted ? (
          /* ── 성공 뷰 ── */
          <div className="relative flex flex-col items-center gap-5 px-7 pb-8 pt-12 text-center sm:px-9">
            <div data-anim="rise" className="grid h-16 w-16 place-items-center rounded-full bg-gradient-to-br from-violet-500 to-fuchsia-500 shadow-lg shadow-fuchsia-500/30">
              <svg viewBox="0 0 24 24" fill="none" className="h-8 w-8 text-white" aria-hidden>
                <path d="M5 12.5l4.2 4.2L19 7" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </div>
            <div data-anim="rise" style={{ animationDelay: ".1s" }}>
              <h2 className="text-2xl font-extrabold tracking-[-0.02em] text-white">신청되었습니다</h2>
              <p className="mt-2 max-w-[380px] text-[15px] leading-relaxed text-white/65">
                무료체험 신청이 접수되었습니다.
                <br />승인되면 <span className="font-semibold text-white/90">베이직 기능이 1개월간</span> 열립니다.
              </p>
            </div>
            <button
              type="button"
              data-anim="rise"
              style={{ animationDelay: ".18s" }}
              onClick={() => close("done")}
              className="mt-1 inline-flex w-full max-w-[280px] items-center justify-center rounded-xl bg-gradient-to-r from-violet-500 to-fuchsia-500 px-6 py-3 text-[15px] font-semibold text-white transition hover:from-violet-400 hover:to-fuchsia-400"
            >
              확인
            </button>
          </div>
        ) : (
          /* ── 신청 뷰 ── */
          <>
            <div className="relative flex flex-col items-center gap-6 px-7 pb-6 pt-9 sm:px-9 sm:pt-10">
              <div data-anim="rise" style={{ animationDelay: ".12s" }} className="flex flex-wrap items-center justify-center gap-2">
                <span className="inline-flex items-center gap-1.5 rounded-full border border-violet-400/40 bg-violet-500/15 px-3 py-1 text-xs font-semibold text-violet-200">
                  <svg viewBox="0 0 24 24" fill="none" className="h-3.5 w-3.5 text-violet-300" aria-hidden>
                    <path d="M12 2.5l1.7 4.9 4.9 1.7-4.9 1.7L12 15.7l-1.7-4.9L5.4 9.1l4.9-1.7L12 2.5z" fill="currentColor" />
                  </svg>
                  AI Operator · 오픈 기념
                </span>
                {/* ★ 2026-06-11 Harold 확정: 신청 마감 표기 — 6월 30일까지만 접수 */}
                <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-400/40 bg-amber-500/15 px-3 py-1 text-xs font-semibold text-amber-200">
                  <svg viewBox="0 0 24 24" fill="none" className="h-3.5 w-3.5 text-amber-300" aria-hidden>
                    <circle cx="12" cy="12" r="8.5" stroke="currentColor" strokeWidth="1.8" />
                    <path d="M12 7.5V12l3 2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                  6월 30일 신청 마감
                </span>
              </div>

              <div id="trial-title" data-anim="rise" style={{ animationDelay: ".22s" }} className="text-center">
                <h2 className="text-[22px] font-semibold leading-[1.3] tracking-[-0.02em] text-white sm:text-2xl">
                  지금 신청하면
                </h2>
                <p className="mt-1.5 text-[44px] font-extrabold leading-[1.04] tracking-[-0.03em] sm:text-[52px]">
                  <span className={GRAD}>1개월 무료</span>
                  <span className="text-white"> 체험</span>
                </p>
              </div>

              <p data-anim="rise" style={{ animationDelay: ".32s" }} className="max-w-[400px] text-center text-[15px] leading-relaxed text-white/60">
                약정 없이 한 달간 <span className="font-medium text-white/85">AI Operator</span> 기능을 베이직으로 그대로.
                <br className="hidden sm:block" /> 마음에 들 때, 정식 구독은 그다음에.
              </p>

              <div data-anim="rise" style={{ animationDelay: ".4s" }} className="w-full max-w-[420px]">
                <div className="flex w-full items-stretch gap-1.5">
                  <JourneyStep label="오늘 신청" />
                  <JourneyArrow />
                  <JourneyStep label="승인 후 1개월 무료" highlight />
                  <JourneyArrow />
                  <JourneyStep label="구독은 나중에" />
                </div>
              </div>

              {errorMsg && (
                <p data-anim="rise" className="w-full max-w-[420px] rounded-lg border border-rose-400/30 bg-rose-500/10 px-3 py-2 text-center text-[13px] text-rose-200">
                  {errorMsg}
                </p>
              )}

              <button
                type="button"
                data-anim="rise"
                style={{ animationDelay: ".52s" }}
                onClick={handleCta}
                disabled={submitting}
                className="cta-pulse group mt-1 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-violet-500 to-fuchsia-500 px-6 py-3.5 text-[15px] font-semibold text-white transition hover:from-violet-400 hover:to-fuchsia-400 disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {submitting ? "신청 중..." : "지금 무료체험 신청하기"}
                {!submitting && (
                  <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5 transition-transform group-hover:translate-x-0.5" aria-hidden>
                    <path d="M5 12h13M13 6l6 6-6 6" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                )}
              </button>
              <p data-anim="rise" style={{ animationDelay: ".6s" }} className="-mt-2 text-[12px] text-white/35">
                신청 기간 <span className="font-semibold text-amber-200/80">2026년 6월 30일까지</span> · 신청은 1분, 약정·위약금 없이 시작합니다.
              </p>
            </div>

            <div data-anim="rise" style={{ animationDelay: ".66s" }} className="flex items-center justify-between gap-3 border-t border-white/10 px-7 py-3.5 sm:px-9">
              <label className="inline-flex cursor-pointer items-center gap-2 text-[13px] text-white/45 transition hover:text-white/70">
                <span className={"grid h-4 w-4 place-items-center rounded-[5px] border transition " + (dontShow ? "border-violet-400 bg-violet-500 text-white" : "border-white/25 bg-white/5 text-transparent")}>
                  <svg viewBox="0 0 24 24" fill="none" className="h-3 w-3" aria-hidden>
                    <path d="M5 12.5l4.2 4.2L19 7" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </span>
                <input type="checkbox" className="sr-only" checked={dontShow} onChange={(e) => setDontShow(e.target.checked)} />
                오늘 하루 보지 않기
              </label>
              <button type="button" onClick={() => close("later")} className="text-[13px] font-medium text-white/45 transition hover:text-white/80">
                나중에 보기
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function JourneyStep({ label, highlight = false }: { label: string; highlight?: boolean }) {
  return (
    <div
      data-anim="step"
      className={
        "flex-1 rounded-xl border px-2.5 py-2.5 text-center " +
        (highlight
          ? "border-violet-400/50 bg-gradient-to-b from-violet-500/20 to-fuchsia-500/15 shadow-[0_0_22px_-6px_rgba(217,70,239,.5)]"
          : "border-white/10 bg-white/[0.04]")
      }
    >
      <p className={"text-[12px] font-semibold leading-tight " + (highlight ? GRAD : "text-white/85")}>{label}</p>
    </div>
  );
}

function JourneyArrow() {
  return (
    <div data-anim="step" className="flex items-center text-white/25" aria-hidden>
      <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4">
        <path d="M9 6l6 6-6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </div>
  );
}

/* 등장 모션 — prefers-reduced-motion 시 즉시 표시. */
const KEYFRAMES = `
@keyframes opp-backdrop { from { opacity: 0 } to { opacity: 1 } }
@keyframes opp-card { from { opacity: 0; transform: translateY(10px) scale(.965) } to { opacity: 1; transform: none } }
@keyframes opp-glow { from { opacity: 0; transform: scale(.85) } to { opacity: 1; transform: none } }
@keyframes opp-rise { from { opacity: 0; transform: translateY(12px) } to { opacity: 1; transform: none } }
@keyframes opp-step { from { opacity: 0; transform: translateY(8px) scale(.9) } to { opacity: 1; transform: none } }
@keyframes opp-cta { 0%,100% { box-shadow: 0 10px 30px -8px rgba(139,92,246,.5) } 50% { box-shadow: 0 14px 38px -8px rgba(139,92,246,.7), 0 0 36px 2px rgba(217,70,239,.25) } }
[data-anim="backdrop"] { animation: opp-backdrop .28s ease both }
[data-anim="card"] { animation: opp-card .5s cubic-bezier(.16,1,.3,1) both }
[data-anim="glow"] { animation: opp-glow .9s ease both }
[data-anim="rise"] { animation: opp-rise .55s cubic-bezier(.16,1,.3,1) both }
[data-anim="step"] { animation: opp-step .5s cubic-bezier(.16,1,.3,1) both }
.cta-pulse { animation: opp-cta 3.4s ease-in-out infinite }
.cta-pulse:hover { animation: none }
@media (prefers-reduced-motion: reduce) {
  [data-anim], .cta-pulse { animation: none !important }
}
`;
