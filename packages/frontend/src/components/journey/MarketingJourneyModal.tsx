/**
 * MarketingJourneyModal — 마케팅 여정 진입 (2026-08-02)
 *
 * 메인에 흩어져 있던 자연어 입력과 빠른 시작을 **이 모달 안으로** 모았다.
 * 메인은 "무엇을 만들지 고르는 자리"만 남기고, 고른 뒤의 입력은 전부 모달에서 끝낸다
 * (정보 알림·날짜축이 이미 모달이라 셋의 진입 방식이 같아진다).
 *
 * 1클릭 원칙(CLAUDE.md marketing_user_ux_priority)
 *   빠른 시작 카드는 누르는 즉시 AI 생성으로 간다 — 중간에 무엇을 더 묻지 않는다.
 *   자유 입력은 그 옆에 따로 둔다.
 */
import { X, Megaphone, Send, Loader2, Lock } from 'lucide-react';
import JourneyDataScopeNote from './JourneyDataScopeNote';
import JourneyModalShell from './JourneyModalShell';

export interface QuickStartItem {
  code: string;
  label: string;
  hint: string;
  /** lucide 아이콘 컴포넌트. */
  icon: React.ComponentType<{ className?: string }>;
  gradient: string;
  /** 데이터가 없어 잠긴 경우의 사유(그대로 노출). null = 사용 가능. */
  lockedReason: string | null;
  /**
   * 잠금을 그 자리에서 풀 수 있으면 그 행동. 없으면 안내만 한다.
   * ⛔ 판단은 페이지가 한다 — 모달이 사유 문자열을 보고 추측하지 않는다.
   */
  lockedAction?: { label: string; onClick: () => void };
}

interface Props {
  open: boolean;
  onClose: () => void;
  objective: string;
  onObjectiveChange: (v: string) => void;
  /**
   * ★ 2026-08-08 혜택 입력(선택) — 혜택은 AI가 못 지어내는 유일한 값이라 여기서만 받는다.
   *   입력하면 AI가 placeholder 대신 처음부터 문안에 녹인다. 비워도 지금처럼 동작(1클릭 유지).
   *   자연어·빠른 시작 두 경로가 같은 값을 쓴다.
   */
  benefit: string;
  onBenefitChange: (v: string) => void;
  /** templateCode를 주면 빠른 시작, 없으면 자연어 생성. */
  onGenerate: (templateCode?: string) => void;
  generating: boolean;
  quickStarts: QuickStartItem[];
  availableCount: number;
  lockedCount: number;
  lockedHints: string[];
}

export default function MarketingJourneyModal({
  open, onClose, objective, onObjectiveChange, benefit, onBenefitChange, onGenerate, generating,
  quickStarts, availableCount, lockedCount, lockedHints,
}: Props) {
  return (
    <JourneyModalShell open={open} onClose={onClose} labelledBy="marketing-journey-modal-title">
      <>
        <div className="flex items-start gap-3 border-b border-white/10 bg-gradient-to-r from-fuchsia-500/10 via-purple-500/10 to-indigo-500/10 px-5 py-4">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-fuchsia-400 to-purple-500">
            <Megaphone className="h-5 w-5 text-white" />
          </div>
          <div className="min-w-0 flex-1">
            <h3 id="marketing-journey-modal-title" className="text-base font-bold text-white">마케팅 여정 만들기</h3>
            <p className="text-[11px] text-white/50">광고성 문자·LMS: 하고 싶은 것을 한 줄로 쓰면 AI가 흐름을 설계합니다</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg p-1.5 text-white/40 transition-colors hover:bg-white/5 hover:text-white/70" aria-label="닫기">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4">
          <JourneyDataScopeNote availableCount={availableCount} lockedCount={lockedCount} lockedHints={lockedHints} />

          {/* 자연어 한 줄 */}
          <section>
            <label htmlFor="marketing-journey-objective" className="mb-1.5 block text-xs font-semibold text-white/80">
              무엇을 하고 싶으신가요
            </label>
            <textarea
              id="marketing-journey-objective"
              value={objective}
              onChange={(e) => onObjectiveChange(e.target.value)}
              placeholder="예: 신규 가입자 환영 7일 시리즈 / VIP 고객 분기 감사 / 휴면 30일 회수 / 신상품 출시 3단계 안내"
              rows={3}
              disabled={generating}
              onKeyDown={(e) => {
                if ((e.metaKey || e.ctrlKey) && e.key === 'Enter' && !generating && objective.trim().length >= 3) {
                  e.preventDefault();
                  onGenerate();
                }
              }}
              className="w-full resize-none rounded-xl border border-white/10 bg-slate-950/60 px-3.5 py-3 text-sm leading-relaxed text-white placeholder:text-white/25 focus:border-fuchsia-400/60 focus:outline-none disabled:opacity-60"
            />
            {/* ★ 2026-08-08 — 혜택은 값으로 받는다. 문안 속 placeholder를 손으로 고치게 하지 않는다. */}
            <div className="mt-2.5">
              <label htmlFor="marketing-journey-benefit" className="mb-1.5 block text-xs font-semibold text-white/80">
                고객에게 줄 혜택 <span className="font-normal text-white/40">(선택)</span>
              </label>
              <input
                id="marketing-journey-benefit"
                value={benefit}
                onChange={(e) => onBenefitChange(e.target.value.slice(0, 200))}
                placeholder="예: 신규 가입 10% 쿠폰 · 5,000원 적립"
                disabled={generating}
                className="w-full rounded-xl border border-white/10 bg-slate-950/60 px-3.5 py-2.5 text-sm text-white placeholder:text-white/25 focus:border-fuchsia-400/60 focus:outline-none disabled:opacity-60"
              />
              <p className="mt-1 text-[11px] leading-relaxed text-white/35">
                적어 주시면 문안에 바로 녹여 드려요. 비워 두면 문안에 혜택 자리만 표시됩니다.
              </p>
            </div>
            <div className="mt-2 flex items-center justify-between gap-2">
              <span className="text-[11px] text-white/35">Ctrl(⌘) + Enter로도 만들 수 있어요</span>
              <button
                type="button"
                onClick={() => onGenerate()}
                disabled={generating || objective.trim().length < 3}
                className="inline-flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-fuchsia-500 to-purple-500 px-5 py-2.5 text-sm font-semibold text-white shadow-lg shadow-fuchsia-500/20 transition-opacity hover:opacity-90 disabled:opacity-40"
              >
                {generating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                AI 생성
              </button>
            </div>
          </section>

          {/* 빠른 시작 — 누르면 바로 생성 */}
          <section>
            <div className="mb-2 flex items-center gap-2">
              <span className="text-xs font-semibold text-white/80">자주 쓰는 여정</span>
              <span className="text-[11px] text-white/35">누르면 바로 만들어 드려요</span>
            </div>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {quickStarts.map((q) => {
                const Icon = q.icon;
                const locked = !!q.lockedReason;
                return (
                  <button
                    key={q.code}
                    type="button"
                    onClick={() => { if (!locked && !generating) onGenerate(q.code); }}
                    disabled={locked || generating}
                    title={q.lockedReason || undefined}
                    className={`flex items-start gap-2.5 rounded-xl border p-3 text-left transition-colors ${
                      locked
                        ? 'cursor-not-allowed border-white/5 bg-white/[0.02] opacity-60'
                        : 'border-white/10 bg-white/5 hover:border-fuchsia-400/40 hover:bg-white/10'
                    }`}
                  >
                    <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br ${q.gradient} ${locked ? 'grayscale' : ''}`}>
                      <Icon className="h-4 w-4 text-white" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <span className="truncate text-[12.5px] font-semibold text-white/90">{q.label}</span>
                        {locked && <Lock className="h-3 w-3 shrink-0 text-white/35" />}
                      </div>
                      <p className="mt-0.5 text-[11px] leading-relaxed text-white/45">
                        {q.lockedReason || q.hint}
                      </p>
                      {locked && q.lockedAction && (
                        <span
                          role="button"
                          tabIndex={0}
                          onClick={(e) => { e.stopPropagation(); q.lockedAction!.onClick(); }}
                          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); q.lockedAction!.onClick(); } }}
                          className="mt-1.5 inline-block cursor-pointer rounded-lg border border-amber-400/40 bg-amber-500/15 px-2 py-1 text-[11px] font-semibold text-amber-100 hover:bg-amber-500/25"
                        >
                          {q.lockedAction.label}
                        </span>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          </section>
        </div>
      </>
    </JourneyModalShell>
  );
}
