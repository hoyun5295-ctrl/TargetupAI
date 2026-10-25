/**
 * MaterialQuickPanel — 편집기 입구용 "재료로 만들기" (★ 2026-09-06 S6 · 설계서 §8)
 *
 * ★ 2026-10-25 원장 #104 — 재료로 만들기 = 만들기 화면(AI 자동제작 v1) 한 길. 편집기 안 옛 v0 패널(영업용 채우기 · 견적 결박 0 · 다른 돈 규칙)은 지웠다.
 *   열린 회사 = 만들기 화면으로 가는 링크 1줄 · 안 열린 회사 · 아직 모름 = 그리지 않는다.
 */
import { useNavigate } from 'react-router-dom';
import { Sparkles, ArrowRight } from 'lucide-react';
import { useAiAutoBuildEnabled } from '../utils/ai-build';

/**
 * onNavigate = 편집기의 이탈 처리(저장 · 확인 창)를 거쳐 이동한다(★ 1026 Codex 1R — 옛: 바로 이동해 자동 저장 대기 중인 수정이 사라졌다).
 */
export default function MaterialQuickPanel({ channel, disabled, onNavigate }: { channel: 'dm' | 'email'; disabled?: boolean; onNavigate: (go: () => void) => void }) {
  const navigate = useNavigate();
  const autoBuild = useAiAutoBuildEnabled();
  if (autoBuild !== true) return null;
  return (
    <button type="button" disabled={disabled} onClick={() => onNavigate(() => navigate(`/quick-campaign?channel=${channel}`))}
      className="w-full flex items-center gap-2 px-3 py-2.5 rounded-[10px] border border-violet-200 bg-violet-50 text-sm font-medium text-violet-900 hover:bg-violet-50 disabled:opacity-40 transition-colors">
      <Sparkles className="w-4 h-4 text-fuchsia-700" /> AI 자동제작으로 만들기
      <span className="ml-auto inline-flex items-center gap-1 text-[11px] text-slate-400">재료만 넣으면 완성본까지 <ArrowRight className="w-3 h-3" /></span>
    </button>
  );
}
