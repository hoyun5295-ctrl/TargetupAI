import { useEffect } from "react";
import { Sparkles, X, BookOpen, CheckCircle2, AlertTriangle } from "lucide-react";

/* ------------------------------------------------------------------ *
 *  PlanChangeModal — 요금제 변경(무료체험 활성/종료 포함) 최초 1회 알림.
 *  Dashboard가 localStorage(targetup_last_seen_plan) 비교로 1회만 렌더.
 *
 *  - 상향/활성화: 활성화된 기능 + "사용법이 어려우시면 클릭" → 헤더 매뉴얼.
 *  - 하향/종료: 제한되는 기능 목록.
 *  - 다크 톤 bg-slate-900 + violet, ESC/backdrop 닫기.
 * ------------------------------------------------------------------ */

const PLAN_RANK: Record<string, number> = {
  FREE: 0, STARTER: 1, BASIC: 2, TRIAL: 2, PRO: 3, BUSINESS: 4, ENTERPRISE: 5,
};

const PLAN_NAME: Record<string, string> = {
  FREE: "미가입", STARTER: "스타터", BASIC: "베이직", TRIAL: "무료체험",
  PRO: "프로", BUSINESS: "비즈니스", ENTERPRISE: "엔터프라이즈",
};

// 정적 기능 카피 (단일 정의). 활성화=새 플랜 목록, 종료=옛 플랜 − 새 플랜 차집합.
const PLAN_FEATURES: Record<string, string[]> = {
  FREE: ["문자 직접 발송", "고객 관리"],
  STARTER: ["문자 직접 발송", "고객 관리", "AI 문안 다듬기", "고객 세그먼트"],
  BASIC: [
    "AI Operator (자동 마케팅·성과 리포트)",
    "AI 자동 문안 · 고객 세그먼트",
    "여정 자동화",
    "스팸 필터 검수",
    "월 750 AI 크레딧",
  ],
  TRIAL: [
    "AI Operator (자동 마케팅·성과 리포트)",
    "AI 자동 문안 · 고객 세그먼트",
    "여정 자동화",
    "스팸 필터 검수",
    "월 750 AI 크레딧",
  ],
  PRO: ["베이직 전 기능", "자사몰 CDP 연동", "모바일 DM 빌더", "월 2,400 AI 크레딧"],
  BUSINESS: ["프로 전 기능", "대량 발송 한도 상향", "월 7,800 AI 크레딧"],
  ENTERPRISE: ["비즈니스 전 기능", "전담 지원", "월 16,500 AI 크레딧"],
};

const featuresOf = (code: string): string[] => PLAN_FEATURES[code] || [];

export default function PlanChangeModal({
  fromPlan, toPlan, toStatus, onClose,
}: {
  fromPlan: string;
  toPlan: string;
  toStatus?: string;
  onClose: () => void;
}) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", h);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { window.removeEventListener("keydown", h); document.body.style.overflow = prev; };
  }, [onClose]);

  const up = (PLAN_RANK[toPlan] ?? 0) >= (PLAN_RANK[fromPlan] ?? 0);
  const isTrialActivation = up && toStatus === "trial";
  const isTrialExpiry = !up && toStatus === "trial_expired";

  const title = up
    ? (isTrialActivation ? "무료체험이 활성화되었습니다" : `${PLAN_NAME[toPlan] || toPlan} 요금제로 변경되었습니다`)
    : (isTrialExpiry ? "무료체험이 종료되었습니다" : `${PLAN_NAME[toPlan] || toPlan} 요금제로 변경되었습니다`);

  const subtitle = up
    ? "이제 다음 기능을 이용하실 수 있습니다."
    : "다음 기능 이용이 제한됩니다.";

  const features = up
    ? featuresOf(toPlan)
    : featuresOf(fromPlan).filter((f) => !featuresOf(toPlan).includes(f));

  const openManual = () => window.open("/manual/manual.html", "_blank", "noopener");

  return (
    <div
      className="fixed inset-0 z-[9997] flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
    >
      <div className="relative w-full max-w-[460px] overflow-hidden rounded-2xl border border-white/10 bg-slate-900 shadow-2xl">
        <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/25 to-transparent" />
        <button
          type="button"
          onClick={onClose}
          aria-label="닫기"
          className="absolute right-3 top-3 grid h-8 w-8 place-items-center rounded-full text-white/45 transition hover:bg-white/10 hover:text-white"
        >
          <X className="h-4 w-4" />
        </button>

        <div className="flex flex-col items-center gap-4 px-7 pb-6 pt-9 text-center">
          <div className={`grid h-14 w-14 place-items-center rounded-2xl ${up ? "bg-gradient-to-br from-violet-500 to-fuchsia-500 shadow-lg shadow-fuchsia-500/25" : "bg-white/10"}`}>
            {up ? <Sparkles className="h-7 w-7 text-white" /> : <AlertTriangle className="h-7 w-7 text-amber-300" />}
          </div>
          <div>
            <h2 className="text-xl font-bold tracking-[-0.02em] text-white">{title}</h2>
            <p className="mt-1.5 text-[14px] text-white/55">{subtitle}</p>
          </div>

          {features.length > 0 && (
            <ul className="w-full space-y-1.5 rounded-xl border border-white/10 bg-white/[0.04] p-3 text-left">
              {features.map((f, i) => (
                <li key={i} className="flex items-center gap-2 text-[13px] text-white/80">
                  {up ? (
                    <CheckCircle2 className="h-4 w-4 flex-shrink-0 text-emerald-400" />
                  ) : (
                    <span className="grid h-4 w-4 flex-shrink-0 place-items-center text-white/30">·</span>
                  )}
                  <span className={up ? "" : "line-through decoration-white/30"}>{f}</span>
                </li>
              ))}
            </ul>
          )}

          {up ? (
            <div className="mt-1 flex w-full flex-col gap-2">
              <button
                type="button"
                onClick={onClose}
                className="inline-flex w-full items-center justify-center rounded-xl bg-gradient-to-r from-violet-500 to-fuchsia-500 px-6 py-3 text-[15px] font-semibold text-white transition hover:from-violet-400 hover:to-fuchsia-400"
              >
                바로 사용하기
              </button>
              <button
                type="button"
                onClick={openManual}
                className="inline-flex w-full items-center justify-center gap-1.5 rounded-xl border border-white/15 bg-white/[0.04] px-6 py-2.5 text-[13px] font-medium text-white/70 transition hover:bg-white/10 hover:text-white"
              >
                <BookOpen className="h-4 w-4" />
                사용법이 어려우시면 클릭하세요
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={onClose}
              className="mt-1 inline-flex w-full items-center justify-center rounded-xl border border-white/15 bg-white/[0.04] px-6 py-3 text-[15px] font-semibold text-white/80 transition hover:bg-white/10"
            >
              확인
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
