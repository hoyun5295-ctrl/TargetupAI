/**
 * AiHubBand.tsx — AI 한줄로 · AI 오퍼레이터 공용 남색 머리 띠 (★ 2026-10-18 · 설계서 docs/2026-10-18-ai-line-design.md §4-1)
 *
 * 옛 허브(AiOperatorPage) 머리 띠(뒤로 · 로고 · 크레딧 칩 · 크레딧 이력 창)를 원형 이동하고, 제목 줄 오른쪽에 탭 2칸을 붙였다.
 * 탭 = 누르는 타일(고른 것 = 흰 판) · AI 한줄로(`/ai-line` · 한 줄로 발송) / AI 오퍼레이터(`/ai-operator` · 기능 12개).
 * ⛔ 모델명 0 · 바깥 눌러 닫힘 없음 · 줄표 0.
 */
import { useEffect, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, LayoutGrid, Send, Sparkles } from 'lucide-react';
import CreditHistoryModal from '../credit/CreditHistoryModal';

export type AiHubTab = 'line' | 'hub';

export interface AiCreditSummary {
  creditEnabled?: boolean;
  planCredits?: number;
  purchased?: number;
  total?: number;
  monthlyUsed?: number;
}

const TABS: Array<{ id: AiHubTab; to: string; title: string; sub: string; icon: typeof Send }> = [
  { id: 'line', to: '/ai-line', title: 'AI 한줄로', sub: '한 줄로 발송', icon: Send },
  { id: 'hub', to: '/ai-operator', title: 'AI 오퍼레이터', sub: '기능 12개', icon: LayoutGrid },
];

export default function AiHubBand({
  active, heading, below, compact = false, overlap = true, refreshKey = 0, onCredit,
}: {
  active: AiHubTab;
  /** 제목 묶음(왼쪽) */
  heading?: ReactNode;
  /** 제목 줄 아래(추천 띠 등) */
  below?: ReactNode;
  /** 결과 모드 — 제목 없이 띠만 */
  compact?: boolean;
  /** 아래 명령 카드가 띠 경계에 걸치면 true(아래 여백을 넓게) */
  overlap?: boolean;
  /** 바뀌면 크레딧을 다시 읽는다(차감 뒤) */
  refreshKey?: number;
  /** 읽은 크레딧을 화면에도 준다(확인 판 잔액 전 → 후) */
  onCredit?: (c: AiCreditSummary | null) => void;
}) {
  const navigate = useNavigate();
  const [credit, setCredit] = useState<AiCreditSummary | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch('/api/companies/my-credit', { headers: { Authorization: `Bearer ${localStorage.getItem('token')}` } });
        const d = res.ok ? await res.json() : null;
        const c = d && d.success !== false ? (d as AiCreditSummary) : null;
        if (alive) { setCredit(c); onCredit?.(c); }
      } catch { /* 조회 실패 = 칩 숨김 */ }
    })();
    return () => { alive = false; };
    // 크레딧은 진입 · 차감 뒤(refreshKey)만 다시 읽는다(onCredit 참조가 렌더마다 바뀌어도 다시 읽지 않는다)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey]);

  return (
    <section className="bg-slate-900 text-white" data-zone="hub-band">
      <header className="max-w-[1240px] mx-auto px-4 md:px-6 h-14 md:h-16 flex items-center gap-3" data-zone="head">
        <button
          type="button"
          onClick={() => navigate('/dashboard')}
          className="inline-flex items-center gap-1.5 h-9 px-2.5 -ml-2.5 rounded-lg text-[13px] text-slate-300 hover:text-white hover:bg-white/10 transition-colors"
          aria-label="대시보드로 돌아가기"
          data-zone="back"
        >
          <ArrowLeft className="w-4 h-4" />
          <span className="hidden sm:inline">대시보드</span>
        </button>
        <span className="w-px h-4 bg-white/15" aria-hidden="true" />
        <img src="/brand/wordmark.png" alt="한줄로" className="h-[18px] md:h-5 brightness-0 invert select-none" draggable={false} />
        <span className="text-[13px] text-slate-400">{active === 'line' ? 'AI 한줄로' : 'AI 오퍼레이터'}</span>
        <span className="ml-auto flex items-center gap-2">
          {credit?.creditEnabled && ((credit.planCredits || 0) > 0 || (credit.purchased || 0) > 0) && (
            <button
              type="button"
              onClick={() => setShowHistory(true)}
              className="inline-flex items-center gap-1.5 h-8 px-3 rounded-full bg-white/10 hover:bg-white/15 text-[12.5px] transition-colors"
              title="AI 크레딧 사용 이력"
            >
              <Sparkles className="w-3.5 h-3.5 text-amber-300" />
              <span className="hidden sm:inline text-slate-300">크레딧</span>
              <b className="font-semibold tabular-nums">{Number(credit.total).toLocaleString()}</b>
              {Number(credit.monthlyUsed) > 0 && (
                <span className="hidden md:inline text-slate-400">· 이번달 {Number(credit.monthlyUsed).toLocaleString()}</span>
              )}
            </button>
          )}
        </span>
      </header>
      {compact ? (
        <div className="h-12" aria-hidden="true" />
      ) : (
        <div className={`max-w-[1240px] mx-auto px-4 md:px-6 pt-7 md:pt-9 ${overlap ? 'pb-14' : 'pb-8'}`}>
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div className="min-w-0">{heading}</div>
            <nav className="flex gap-2 w-full sm:w-auto" aria-label="AI 화면 바꾸기">
              {TABS.map((t) => {
                const on = t.id === active;
                const Icon = t.icon;
                return (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => { if (!on) navigate(t.to); }}
                    aria-current={on ? 'page' : undefined}
                    className={`flex-1 sm:flex-none sm:w-[168px] h-14 rounded-xl px-3 flex items-center gap-2.5 text-left transition-colors ${
                      on ? 'bg-white text-slate-900' : 'bg-white/[0.06] border border-white/10 text-white hover:bg-white/[0.12]'
                    }`}
                    data-zone="hub-tab"
                  >
                    <Icon className={`w-4 h-4 shrink-0 ${on ? 'text-indigo-600' : 'text-slate-300'}`} />
                    <span className="min-w-0 leading-tight">
                      <span className={`block text-[12px] ${on ? 'text-slate-500' : 'text-slate-300'}`}>{t.title}</span>
                      <span className="block text-[13.5px] font-semibold">{t.sub}</span>
                    </span>
                  </button>
                );
              })}
            </nav>
          </div>
          {below}
        </div>
      )}
      {showHistory && (
        <CreditHistoryModal
          onClose={() => setShowHistory(false)}
          onGoPricing={() => { setShowHistory(false); navigate('/pricing'); }}
        />
      )}
    </section>
  );
}
