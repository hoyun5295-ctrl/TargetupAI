import { Sparkles, Zap } from 'lucide-react';
import { CREDIT_TASK_COSTS, dailyDbAnalysisCredits } from '../../constants/credit';

/**
 * CreditSummaryBar — 요금제 페이지 상단 요약 카드 (반반 구성).
 * 좌: 현재 요금제 + 고객 DB 사용량 게이지 / 우: AI 크레딧 잔여 + 작업당 6칩(3열 그리드).
 * 군더더기 어필 문구(성공만 차감·스팸 무관·종량제 띠) 제거 — 차감 내역은 이력 모달, 차등은 비교표가 보여줌.
 * 흰 바탕 + 검정 + 주황 하나(★2026-11-09 Harold 요금제 화면 색 맞춤 · 옛 violet 걷음), 모바일 세로 접힘. 데이터: GET /api/companies/my-credit.
 */
export interface CreditSummaryBarProps {
  // 좌 — 요금제 + DB
  planName: string;
  currentCustomers: number;
  maxCustomers: number;
  usagePercent: number;
  // 우 — 크레딧
  total: number;
  baseRemaining: number;
  purchased: number;
  planCredits: number;
  monthlyUsed: number;
  billingType?: string;
  overageLimit?: number;
  onRecharge?: () => void;
  /**
   * ★ 2026-08-05 요금제 포함 무료 메시지 — 좌측 카드 하단에 사용량·잔여량을 좌우로 보여준다.
   * **선택 prop이다.** 넘기지 않는 호출부는 이 블록이 아예 렌더되지 않아 종전과 한 화소도 다르지 않다.
   */
  freeMessaging?: {
    available: boolean;
    lines: Array<{ type: string; label: string; granted: number; used: number; remaining: number }>;
  } | null;
  /** 무료 메시지 블록 하단 안내 문구(소멸·차감 시점). 문구 소유는 호출부다. */
  freeMessagingNote?: string;
}

const fmt = (n: number) => Number(n || 0).toLocaleString();

export default function CreditSummaryBar({
  planName, currentCustomers, maxCustomers, usagePercent,
  total, baseRemaining, purchased, planCredits, monthlyUsed,
  billingType, overageLimit = 0, onRecharge,
  freeMessaging = null, freeMessagingNote,
}: CreditSummaryBarProps) {
  // 제공량이 0인 유형은 줄에서 뺀다 — 안 주는 유형을 0으로 늘어놓으면 표가 거짓말을 한다.
  const freeLines = (freeMessaging?.available ? freeMessaging.lines : []).filter((l) => l.granted > 0);
  const isLow = total <= 5;
  const isPostpaid = billingType === 'postpaid';
  const gaugeMax = Math.max(planCredits, total, 1);
  const basePct = Math.max(0, Math.min(100, (Math.max(0, baseRemaining) / gaugeMax) * 100));
  const purchasedPct = Math.max(0, Math.min(100 - basePct, (purchased / gaugeMax) * 100));
  const dailyAnalysis = dailyDbAnalysisCredits(currentCustomers);

  return (
    <div className="relative overflow-hidden rounded-2xl border border-[#ECEAE7] bg-white shadow-sm">
      <div className="absolute inset-y-0 left-0 w-1 bg-[#FF5A1F]" />
      <div className="flex flex-col gap-6 p-6 lg:flex-row lg:items-stretch lg:gap-8">
        {/* 좌: 현재 요금제 + 고객 DB 사용량 */}
        <div className="lg:w-1/2 lg:flex-shrink-0 lg:border-r lg:border-[#ECEAE7] lg:pr-8">
          <div className="text-base font-medium text-[#66605B]">현재 이용 중인 플랜</div>
          <div className="mt-1 text-2xl font-extrabold text-[#1A1A1A]">{planName}</div>
          <div className="mt-5 flex items-end justify-between gap-2">
            <span className="text-base font-medium text-[#66605B]">고객 DB</span>
            <span className="text-base font-semibold tabular-nums text-[#1A1A1A]">{fmt(currentCustomers)}명</span>
          </div>
          <div className="mt-3 rounded-xl border border-[#FFE3D4] bg-[#FFF8F4] px-3.5 py-2.5">
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm text-[#44403C]">AI 자율 분석 (이탈위험·기회 고객)</span>
              <b className="text-sm font-bold tabular-nums text-[#C8410C]">매일 {dailyAnalysis}크레딧</b>
            </div>
            {/* ★ 2026-11-09 옛 「싱크에이전트·SDK 연동 시 차감 · 미연동은 0」은 워커와 달랐다 — 차감 대상 = 요금제 가입 + 고객 DB 보유(연동 무관 · predictive-worker.ts) */}
            <div className="mt-1 text-[11px] leading-snug text-[#8A847E]">고객 DB가 있으면 매일 오전 9시에 고객 수 기준으로 자동 차감됩니다</div>
          </div>

          {/* ★ 2026-08-05 요금제 포함 무료 메시지 — 좌 사용량 / 가운데 구분선 / 우 잔여량.
              제공이 없는 요금제·DDL 미실행이면 통째로 숨는다(freeLines 0). */}
          {freeLines.length > 0 && (
            <div className="mt-5">
              <div className="flex items-end justify-between gap-2">
                <span className="text-base font-medium text-[#66605B]">요금제 포함 무료 메시지</span>
                <span className="text-[11px] text-[#8A847E]">이번 달</span>
              </div>
              <div className="mt-3 rounded-xl border border-[#ECEAE7] bg-[#F7F6F4]">
                <div className="grid grid-cols-[1fr_auto_1fr] items-stretch">
                  {/* 좌 — 사용량 */}
                  <div className="px-3.5 py-3">
                    <div className="text-[11px] font-medium text-[#8A847E]">사용</div>
                    <ul className="mt-2 space-y-1.5">
                      {freeLines.map((l) => (
                        <li key={`u-${l.type}`} className="flex items-baseline justify-between gap-2">
                          <span className="text-xs text-[#66605B]">{l.label}</span>
                          <span className="text-sm font-semibold tabular-nums text-[#44403C]">{fmt(l.used)}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                  {/* 가운데 구분선 */}
                  <div className="w-px bg-[#ECEAE7]" aria-hidden="true" />
                  {/* 우 — 잔여량 */}
                  <div className="px-3.5 py-3">
                    <div className="text-[11px] font-medium text-[#C8410C]">잔여</div>
                    <ul className="mt-2 space-y-1.5">
                      {freeLines.map((l) => (
                        <li key={`r-${l.type}`} className="flex items-baseline justify-between gap-2">
                          <span className="text-xs text-[#66605B]">{l.label}</span>
                          <span className="text-sm font-bold tabular-nums text-[#C8410C]">
                            {fmt(l.remaining)}
                            <span className="ml-0.5 text-[11px] font-medium text-[#8A847E]">/ {fmt(l.granted)}</span>
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
                {freeMessagingNote && (
                  <div className="border-t border-[#ECEAE7] px-3.5 py-2 text-[11px] leading-snug text-[#8A847E]">
                    {freeMessagingNote}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* 우: AI 크레딧 잔여 + 작업당 6칩 */}
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <div className="flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#FF5A1F]">
                <Sparkles className="h-4 w-4 text-white" />
              </div>
              <span className="text-base font-medium text-[#66605B]">AI 크레딧 잔여</span>
              {isLow && (
                <span className="rounded-full bg-rose-50 px-2 py-0.5 text-xs font-medium text-rose-500">잔여 부족</span>
              )}
            </div>
            {onRecharge && (
              <button
                onClick={onRecharge}
                className="flex-shrink-0 rounded-lg bg-[#1A1A1A] px-3.5 py-1.5 text-sm font-semibold text-white transition hover:bg-black"
              >
                충전 문의
              </button>
            )}
          </div>
          <div className="mt-1 flex items-end gap-2">
            <span className="text-3xl font-extrabold tabular-nums text-[#1A1A1A]">{fmt(total)}</span>
            <span className="mb-1 text-sm text-[#8A847E]">크레딧</span>
          </div>
          <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-[#FFF3EC]">
            <div className="flex h-full">
              <div className="h-full bg-[#FF5A1F]" style={{ width: `${basePct}%` }} />
              <div className="h-full bg-[#FFB089]" style={{ width: `${purchasedPct}%` }} />
            </div>
          </div>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[#8A847E]">
            <span className="inline-flex items-center gap-1"><i className="inline-block h-2 w-2 rounded-full bg-[#FF5A1F]" /> 기본 {fmt(Math.max(0, baseRemaining))}</span>
            <span className="inline-flex items-center gap-1"><i className="inline-block h-2 w-2 rounded-full bg-[#FFB089]" /> 구매 {fmt(purchased)}</span>
            <span className="inline-flex items-center gap-1"><Zap className="h-3 w-3" /> 이번달 {fmt(monthlyUsed)}</span>
            {isPostpaid && overageLimit > 0 && <span>· 후불 한도 {fmt(overageLimit)}</span>}
          </div>

          {/* 작업당 크레딧 — 3열 그리드 정렬(라벨 좌 · 숫자 우, 세로 줄맞춤) */}
          <div className="mt-4 border-t border-[#ECEAE7] pt-3">
            <div className="text-base font-medium text-[#66605B]">작업당 크레딧</div>
            <div className="mt-2.5 grid grid-cols-2 gap-x-6 gap-y-2.5 sm:grid-cols-3">
              {CREDIT_TASK_COSTS.map(({ key, label, cost, icon: Icon }) => (
                <div key={key} className="flex items-center justify-between gap-2">
                  <span className="inline-flex items-center gap-1.5 text-sm text-[#44403C]">
                    <Icon className="h-4 w-4 flex-shrink-0 text-[#FF5A1F]" />
                    {label}
                  </span>
                  <b className="text-sm font-bold tabular-nums text-[#C8410C]">{cost}</b>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
