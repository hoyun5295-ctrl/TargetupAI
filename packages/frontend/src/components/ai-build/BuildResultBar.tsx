/**
 * BuildResultBar — AI 자동제작 결과 바(편집기 캔버스 위 sticky 1개 · 2026-09-14 T5 · 설계서 §4-4)
 *
 * 좌 = 판정 3항(재료 N건 · 이미지 N/N장 배치 · 구획 N개 · emerald/amber) · 중 = [미반영 N건] 칩(누르면 목록 · 8건 초과도 은닉 0) ·
 * 우 = [다시 만들기](ConfirmModal 1회 · "다시 만들면 생성비 N크레딧") → 호출부가 새 attemptToken 으로 페이지를 다시 연다.
 * 편집을 시작하면(collapsed) 칩 1개로 접힌다. violet/amber · rose 0 · 반짝임·그라데이션 글자 0(이 바 자체가 AI 티).
 * 아래 1줄: "룰렛·설문은 편집기에서 추가할 수 있어요". 값은 서버 계측(materialsMeta)만 · 문구 생성 0.
 */
import { useMemo, useState } from 'react';
import { ChevronDown, ChevronUp, RotateCcw, X } from 'lucide-react';
import ConfirmModal, { type ConfirmState } from '../ConfirmModal';
import { unappliedItemsOf, type BuildResultHandoff } from '../../utils/ai-build';

export default function BuildResultBar({ handoff, collapsed, onRegenerate, onDismiss }: {
  handoff: BuildResultHandoff;
  /** 편집을 시작하면 true(칩 1개로 접힘) */
  collapsed: boolean;
  onRegenerate: () => void;
  onDismiss: () => void;
}) {
  const [listOpen, setListOpen] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);
  const m = handoff.materials || {};
  const items = useMemo(() => unappliedItemsOf(handoff), [handoff]);
  const cards = Number(m.eventCards) || 0;
  const images = Number(m.images) || 0;
  const imagesUsed = Number(m.imagesUsed) || 0;
  const sections = Number(m.sections) || 0;
  const verdicts = [
    { label: '재료', value: `${cards}건`, ok: cards > 0 },
    { label: '이미지', value: `${imagesUsed}/${images}장 배치`, ok: images === 0 || imagesUsed > 0 },
    { label: '구획', value: `${sections}개`, ok: sections >= 6 },
  ];
  const showFull = !collapsed || expanded;

  const askRegenerate = () => setConfirm({
    mode: 'info',
    title: '다시 만들까요?',
    description: `다시 만들면 생성비 ${handoff.quoteTotal}크레딧이 다시 나가요. 지금 초안은 그대로 남고, 새 초안이 하나 더 만들어져요.`,
    confirmLabel: '다시 만들기',
    onConfirm: () => { setConfirm(null); onRegenerate(); },
  });

  return (
    <div className="sticky top-0 z-20 border-b border-violet-400/25 bg-slate-950/90 backdrop-blur">
      <div className="px-3 md:px-4 py-2 flex items-center gap-2 flex-wrap">
        <span className="text-[11px] font-semibold text-violet-200 shrink-0">AI 자동제작 결과</span>
        {showFull ? (
          <>
            <ul className="flex items-center gap-3 flex-wrap">
              {verdicts.map((v) => (
                <li key={v.label} className="inline-flex items-center gap-1.5 text-[12px]">
                  <span className={`w-1.5 h-1.5 rounded-full ${v.ok ? 'bg-emerald-400' : 'bg-amber-400'}`} />
                  <span className="text-white/50">{v.label}</span>
                  <span className="text-white/85">{v.value}</span>
                </li>
              ))}
            </ul>
            <button type="button" onClick={() => setListOpen((v) => !v)} aria-expanded={listOpen}
              className={`inline-flex items-center gap-1 h-7 px-2.5 rounded-full text-[11px] border ${items.length ? 'border-amber-400/40 text-amber-100 bg-amber-500/10 hover:bg-amber-500/20' : 'border-emerald-400/30 text-emerald-100 bg-emerald-500/10'}`}>
              미반영 {items.length}건 {items.length ? (listOpen ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />) : null}
            </button>
            <div className="ml-auto flex items-center gap-1">
              <button type="button" onClick={askRegenerate}
                className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-lg text-[11px] font-semibold text-violet-100 border border-violet-400/30 hover:bg-violet-500/15 transition-colors">
                <RotateCcw className="w-3.5 h-3.5" /> 다시 만들기
              </button>
              {collapsed && (
                <button type="button" onClick={() => setExpanded(false)} aria-label="접기" className="h-7 w-7 rounded-lg text-white/50 hover:text-white hover:bg-white/10 inline-flex items-center justify-center"><ChevronUp className="w-3.5 h-3.5" /></button>
              )}
              <button type="button" onClick={onDismiss} aria-label="결과 바 닫기" className="h-7 w-7 rounded-lg text-white/50 hover:text-white hover:bg-white/10 inline-flex items-center justify-center"><X className="w-3.5 h-3.5" /></button>
            </div>
          </>
        ) : (
          <>
            <button type="button" onClick={() => setExpanded(true)}
              className={`inline-flex items-center gap-1 h-7 px-2.5 rounded-full text-[11px] border ${items.length ? 'border-amber-400/40 text-amber-100 bg-amber-500/10' : 'border-emerald-400/30 text-emerald-100 bg-emerald-500/10'}`}>
              미반영 {items.length}건 <ChevronDown className="w-3 h-3" />
            </button>
            <button type="button" onClick={onDismiss} aria-label="결과 바 닫기" className="ml-auto h-7 w-7 rounded-lg text-white/50 hover:text-white hover:bg-white/10 inline-flex items-center justify-center"><X className="w-3.5 h-3.5" /></button>
          </>
        )}
      </div>
      {showFull && listOpen && items.length > 0 && (
        <ul className="px-3 md:px-4 pb-2 space-y-1">
          {items.map((t, i) => (
            <li key={i} className="flex items-start gap-2 text-[12px] text-white/80"><span className="mt-1.5 w-1 h-1 rounded-full bg-amber-400 shrink-0" />{t}</li>
          ))}
        </ul>
      )}
      {showFull && (
        <p className="px-3 md:px-4 pb-2 text-[11px] text-white/40">룰렛·설문은 편집기에서 추가할 수 있어요.</p>
      )}
      <ConfirmModal state={confirm} onClose={() => setConfirm(null)} />
    </div>
  );
}
