// 자연어로 시작 — 목표 한 줄 입력 → AI 자동 초안 (2026-06-27)
// 마케팅 담당자 UX: 입력 한 칸 + 예시 한 클릭 + 버튼 하나. 추가 입력 없음.
// AI 초안 생성은 5초+ 소요 → 제출 중 로딩 오버레이 + 닫기 차단(D185).
import { useState } from 'react';
import { Sparkles, Check, Lock, Loader2 } from 'lucide-react';
import CopyStylePicker, { CopyStyleKey } from './CopyStylePicker';

const EXAMPLES: Array<{ label: string; goal: string }> = [
  { label: 'VIP 재구매', goal: 'VIP 등급 고객 중 최근 30일 구매가 없는 고객에게 재구매를 유도' },
  { label: '휴면 회복', goal: '최근 60일 이상 구매가 없는 휴면 고객을 복귀 유도' },
  { label: '신규 첫구매', goal: '가입 후 아직 구매하지 않은 신규 고객의 첫 구매 유도' },
  { label: '등급 상승', goal: 'VIP 승급에 근접한 일반 고객의 추가 구매 유도' },
  { label: '계절 프로모션', goal: '이번 시즌에 맞춰 전체 활성 고객에게 시즌 프로모션 안내' },
];

const AUTO_ITEMS = ['타겟', '채널', '발송 시각', '문안 초안', '예상 성과'];

export default function NaturalLanguageStart({ submitting, onSubmit }: { submitting: boolean; onSubmit: (goal: string, copyStyle: CopyStyleKey | null) => void }) {
  const [goal, setGoal] = useState('');
  const [copyStyle, setCopyStyle] = useState<CopyStyleKey | null>(null);
  const canSubmit = goal.trim().length > 0 && !submitting;

  return (
    <div className="relative">
      <h2 className="text-lg md:text-xl font-semibold text-white">어떤 마케팅을 할까요?</h2>
      <p className="text-[13px] text-white/60 mt-1.5">목표를 한 줄로 적으면 타겟·채널·발송 시각·문안 초안은 AI가 잡습니다.</p>

      <textarea
        value={goal}
        onChange={(e) => setGoal(e.target.value)}
        disabled={submitting}
        maxLength={500}
        placeholder="예: VIP 등급 중 최근 30일 구매 없는 고객에게 재구매를 유도하고 싶어요"
        className="mt-4 w-full h-24 px-4 py-3 bg-white/5 border border-indigo-400/30 rounded-xl text-sm text-white placeholder-white/30 resize-none focus:outline-none focus:border-indigo-400/60 transition-colors leading-relaxed"
      />

      <div className="mt-3">
        <div className="text-xs text-white/40 mb-2">예시를 눌러 바로 채우기</div>
        <div className="flex flex-wrap gap-2">
          {EXAMPLES.map((ex) => (
            <button
              key={ex.label}
              onClick={() => setGoal(ex.goal)}
              disabled={submitting}
              className="text-xs px-3 py-1.5 rounded-full bg-white/5 hover:bg-white/10 border border-white/10 text-white/70 transition-colors"
            >
              {ex.label}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-4">
        <div className="text-xs text-white/40 mb-2">문안 느낌 고르기 (선택)</div>
        <CopyStylePicker compact value={copyStyle} onChange={setCopyStyle} disabled={submitting} />
      </div>

      <div className="mt-5 rounded-xl border border-white/10 bg-white/5 px-4 py-3">
        <div className="text-xs text-white/40 mb-2.5">이 항목은 AI가 자동으로 잡습니다. 필요하면 다음 단계에서 조정</div>
        <div className="flex flex-wrap gap-2">
          {AUTO_ITEMS.map((it) => (
            <span key={it} className="inline-flex items-center gap-1 text-[11px] px-2.5 py-1 rounded-full bg-emerald-500/10 text-emerald-300">
              <Check className="w-3 h-3" />{it}
            </span>
          ))}
        </div>
      </div>

      <button
        onClick={() => onSubmit(goal.trim(), copyStyle)}
        disabled={!canSubmit}
        className="mt-5 w-full inline-flex items-center justify-center gap-2 bg-indigo-500/40 hover:bg-indigo-500/60 disabled:opacity-30 disabled:cursor-not-allowed text-indigo-50 text-sm font-semibold py-3.5 rounded-xl transition-colors"
      >
        {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
        AI가 초안 만들기
      </button>

      <div className="mt-3 flex items-center justify-center gap-1.5 text-xs text-white/40">
        <Lock className="w-3 h-3" />발송은 초안을 확인하고 승인한 뒤에만 진행됩니다
      </div>

      {submitting && (
        <div className="absolute inset-0 -m-2 bg-slate-950/85 backdrop-blur-sm rounded-2xl flex flex-col items-center justify-center gap-3 z-10">
          <Loader2 className="w-7 h-7 text-indigo-300 animate-spin" />
          <div className="text-sm text-white/80">AI가 초안을 만들고 있습니다</div>
          <div className="text-xs text-white/40">창을 닫지 마세요</div>
        </div>
      )}
    </div>
  );
}
