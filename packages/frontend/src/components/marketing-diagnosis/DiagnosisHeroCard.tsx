/**
 * DiagnosisHeroCard — 대시보드 상시 진입 카드 (2026-08-16 신설 · 설계서 §5-2)
 *
 * 노출은 부모(Dashboard)가 서버 state로 판정한다 — 이 카드는 표시 전용(dismiss 없음·실물 크기).
 *
 * ⚠ 이 카드가 놓이는 **대시보드는 라이트 톤**이다(앱 모달은 다크 — 톤이 다른 두 곳을 오간다).
 *   그래서 배경은 **불투명 색**으로만 칠한다. 알파(`/30` 같은 반투명)는 흰 배경에서 연해져
 *   흰 글씨가 사라진다 — 2026-08-17 Harold 지적("저게 보이냐")의 원인이 정확히 그것이었다
 *   (`from-sky-600/30 via-indigo-600/25 to-slate-900`: 앞 두 정거장만 반투명이라 왼쪽은 글씨가
 *   안 보이고, 불투명한 끝 정거장만 검은 덩어리로 남았다).
 *   variant 'invite' = eligible && !completedAt — 진단 유도(회사명 1인칭 · NEW 뱃지.
 *     문항 수 표기 금지 — v3 분기형은 경로마다 문항 수가 달라 숫자 카피가 거짓이 된다)
 *     ★ 2026-10-21 Harold(목업 B안) — 지급 가능 회사에는 혜택이 주인공: 제목 「3분 진단하면 베이직 7일이 무료예요」 ·
 *     부제 「설문을 완료하시면 자동으로 7일 무료체험이 부여됩니다」 · 오른쪽 쿠폰(0원 · 지운 월 금액 · 진단 시작).
 *     옛 「가격 단어 0」 규칙은 이 결정으로 바뀌었다. 요금제 이름 · 월 금액 = plans 원장(CT plans-public) · 못 읽으면 금액 줄만 뺀다.
 *     지급 불가 회사(showTrialReward false)는 옛 띠 그대로(거짓 약속 차단 · 기능 문서 §6-2).
 *   variant 'trial'  = completedAt && trialExpiresAt > now — 「체험 D-N · 첫 발송 해보기」(D-N = state.trialExpiresAt)
 */
import { useEffect, useState } from 'react';
import { ArrowRight, Gift, Stethoscope, Zap } from 'lucide-react';
import { fetchPublicPlan, type PublicPlan } from '../../utils/plans-public';

interface Props {
  variant: 'invite' | 'trial';
  companyName?: string | null;
  trialExpiresAt?: string | null;
  onStart?: () => void;
  onFirstSend?: () => void;
  /** ★2026-08-16 Harold 지시 — 지급 자격 회사에만 7일 보상 문구(거짓 약속 차단) */
  showTrialReward?: boolean;
  /** ★2026-10-10 초대 점을 두 번 퍼뜨릴지 — 대시보드를 새로 열 때만(다른 화면 갔다 오면 정지 점) */
  attention?: boolean;
}

function dDay(trialExpiresAt?: string | null): number | null {
  if (!trialExpiresAt) return null;
  const diff = new Date(trialExpiresAt).getTime() - Date.now();
  if (Number.isNaN(diff) || diff <= 0) return null;
  return Math.ceil(diff / (24 * 60 * 60 * 1000));
}

export default function DiagnosisHeroCard({ variant, companyName, trialExpiresAt, onStart, onFirstSend, showTrialReward = false, attention = true }: Props) {
  // 쿠폰의 요금제 이름 · 월 금액(plans 원장) — 지급 가능 회사에 유도 띠를 그릴 때만 읽는다
  const reward = showTrialReward;
  const [basic, setBasic] = useState<PublicPlan | null>(null);
  useEffect(() => {
    if (variant !== 'invite' || !reward) return;
    let alive = true;
    void fetchPublicPlan('BASIC').then((p) => { if (alive) setBasic(p); });
    return () => { alive = false; };
  }, [variant, reward]);
  const planName = basic?.name || '베이직';

  if (variant === 'trial') {
    const d = dDay(trialExpiresAt);
    if (d == null) return null;
    return (
      <button
        type="button"
        onClick={onFirstSend}
        className="group relative mb-4 w-full overflow-hidden rounded-2xl bg-gradient-to-r from-indigo-700 via-indigo-600 to-sky-600 px-5 py-4 text-left shadow-lg shadow-indigo-600/20 transition-all hover:shadow-xl hover:shadow-indigo-600/30 sm:px-6 break-keep"
      >
        <div className="pointer-events-none absolute -right-10 -top-16 h-44 w-44 rounded-full bg-white/10 blur-2xl" aria-hidden />
        <div className="relative flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-white/20">
              <Zap className="h-5 w-5 text-white" aria-hidden />
            </span>
            <span>
              <span className="block text-[15px] font-bold tracking-tight text-white sm:text-base">
                체험이 진행 중이에요 · D-{d}
              </span>
              <span className="mt-0.5 block text-xs text-white/85 sm:text-[13px]">
                진단 리포트에서 추천받은 기능을 지금 바로 써보세요
              </span>
            </span>
          </div>
          <span className="inline-flex shrink-0 items-center gap-1.5 self-start rounded-xl bg-white px-4 py-2 text-[13px] font-bold text-indigo-700 shadow-sm sm:self-auto">
            첫 발송 해보기 <ArrowRight className="h-4 w-4" aria-hidden />
          </span>
        </div>
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={onStart}
      className="group relative mb-4 w-full overflow-hidden rounded-2xl bg-gradient-to-r from-indigo-700 via-indigo-600 to-sky-600 px-5 py-4 text-left shadow-lg shadow-indigo-600/20 transition-all hover:shadow-xl hover:shadow-indigo-600/30 sm:px-6 break-keep"
    >
      <div className="pointer-events-none absolute -right-10 -top-16 h-44 w-44 rounded-full bg-white/10 blur-2xl" aria-hidden />
      <div className="relative flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <span className="relative grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-white/20">
            <Stethoscope className="h-5 w-5 text-white" aria-hidden />
            {/* ★ 2026-10-10 대시보드 모션 I — 초대 점은 두 번 퍼지고 멈춘다(무한 ping 은 「지금 켜져 있다」 점에만) */}
            <span className={`absolute -right-1 -top-1 h-2.5 w-2.5 rounded-full bg-sky-200 ${attention ? 'motion-safe:animate-ping-twice' : ''}`} aria-hidden />
            <span className="absolute -right-1 -top-1 h-2.5 w-2.5 rounded-full bg-sky-200" aria-hidden />
          </span>
          {reward ? (
            <span>
              <span className="flex flex-wrap items-center gap-2 text-[16px] font-extrabold tracking-tight text-white sm:text-[17px]">
                3분 진단하면 {planName} 7일이 무료예요
                <span className="rounded-md bg-white/25 px-1.5 py-0.5 text-[10px] font-bold text-white">NEW</span>
              </span>
              <span className="mt-1 block text-xs text-white/90 sm:text-[13px]">
                설문을 완료하시면 자동으로 7일 무료체험이 부여됩니다 · AI 진단서는 덤이에요
              </span>
            </span>
          ) : (
            <span>
              <span className="flex items-center gap-2 text-[15px] font-bold tracking-tight text-white sm:text-base">
                {companyName ? `${companyName}의 마케팅, 지금 진단받아 보세요` : '우리 마케팅, 지금 진단받아 보세요'}
                <span className="rounded-md bg-white/25 px-1.5 py-0.5 text-[10px] font-bold text-white">NEW</span>
              </span>
              <span className="mt-0.5 block text-xs text-white/85 sm:text-[13px]">
                약 3분이면 AI가 잘하는 것과 아쉬운 것을 짚은 진단서를 드려요
              </span>
            </span>
          )}
        </div>
        {reward ? (
          // 쿠폰 = 카드 버튼 안의 표시(버튼 안 버튼 금지) · 왼쪽 = 요금제 7일 0원 · 지운 월 금액 / 점선 / 오른쪽 = 진단 시작
          <span className="flex w-full shrink-0 items-stretch overflow-hidden rounded-2xl bg-white text-slate-900 shadow-[0_10px_24px_-12px_rgba(15,23,42,0.55)] transition-transform group-hover:-translate-y-0.5 sm:w-auto">
            <span className="flex flex-1 flex-col justify-center gap-0.5 border-r-2 border-dashed border-slate-200 px-4 py-2.5">
              <span className="flex items-center gap-1 text-[11px] font-bold text-violet-700">
                <Gift className="h-3.5 w-3.5" aria-hidden />{planName} 요금제 7일
              </span>
              <span className="text-[19px] font-black leading-tight tracking-tight">0원</span>
              {basic && basic.monthlyPrice > 0 && (
                <span className="text-[12px] text-slate-500">
                  <s>월 {basic.monthlyPrice.toLocaleString('ko-KR')}원</s>
                  <span className="ml-1 font-extrabold text-rose-600">무료</span>
                </span>
              )}
            </span>
            <span className="flex items-center gap-1.5 whitespace-nowrap bg-indigo-700 px-4 text-[14px] font-extrabold text-white">
              진단 시작 <ArrowRight className="h-4 w-4" aria-hidden />
            </span>
          </span>
        ) : (
          <span className="inline-flex shrink-0 items-center gap-1.5 self-start rounded-xl bg-white px-4 py-2 text-[13px] font-bold text-indigo-700 shadow-sm sm:self-auto">
            진단 시작 <ArrowRight className="h-4 w-4" aria-hidden />
          </span>
        )}
      </div>
    </button>
  );
}
