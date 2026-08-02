/**
 * JourneyBriefingModal — 저장 직전 브리핑 (2026-08-02, 설계서 §13-4 / §6-5)
 *
 * 저장을 누르면 스텝 전체를 일목요연하게 보여주고, 스텝을 클릭하면 그 스텝의 상세 문안을 펼친다.
 * 마지막으로 무엇이 언제 누구에게 나가는지 사람이 한 화면에서 확인하고 확정하는 자리다.
 */
import { useState } from 'react';
import { X, ChevronDown, ChevronUp, Save, Loader2, MessageSquare, Clock } from 'lucide-react';
import JourneyModalShell from './JourneyModalShell';
import { highlightVars } from '../../utils/highlightVars';

export interface BriefingStep {
  stepOrder: number;
  timingLabel: string;
  channel: string;
  subject?: string;
  messageTemplate: string;
  isAd?: boolean;
}

export interface BriefingIssue {
  stepOrder: number;
  message: string;
}

interface Props {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  saving?: boolean;
  name: string;
  triggerLabel: string;
  steps: BriefingStep[];
  /**
   * 저장을 막는 문제 — **판정은 페이지가 소유한다**(저장 검증과 같은 함수를 쓴다).
   * 여기서 규칙을 다시 쓰면 저장은 되는데 브리핑은 통과시키거나 그 반대가 된다.
   */
  issues?: BriefingIssue[];
  /** 저장 시 안내할 것(활성화 크레딧 등). 없으면 표시하지 않는다. */
  footnote?: string;
}

export default function JourneyBriefingModal({
  open, onClose, onConfirm, saving = false, name, triggerLabel, steps, issues = [], footnote,
}: Props) {
  const [openIdx, setOpenIdx] = useState<number | null>(0);
  if (!open) return null;

  const issueByStep = new Map(issues.map((i) => [i.stepOrder, i.message]));

  return (
    <JourneyModalShell open={open} onClose={onClose} labelledBy="journey-briefing-modal-title" zIndexClassName="z-[70]">
      <>
        <div className="flex items-start gap-3 border-b border-white/10 px-5 py-4">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-violet-500 to-fuchsia-500">
            <MessageSquare className="h-5 w-5 text-white" />
          </div>
          <div className="min-w-0 flex-1">
            <h3 id="journey-briefing-modal-title" className="truncate text-base font-bold text-white">{name || '여정'}</h3>
            <p className="text-[11px] text-white/45">
              <span className="text-violet-200">{triggerLabel}</span> 일 때 이 순서로 나갑니다 · 스텝 {steps.length}개
            </p>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg p-1.5 text-white/40 transition-colors hover:bg-white/5 hover:text-white/70" aria-label="닫기">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 space-y-2 overflow-y-auto px-5 py-4">
          {steps.map((s, i) => {
            const expanded = openIdx === i;
            const blank = !String(s.messageTemplate || '').trim();
            const issue = issueByStep.get(s.stepOrder);
            return (
              <div key={s.stepOrder} className="overflow-hidden rounded-xl border border-white/10 bg-slate-950/50">
                <button
                  type="button"
                  onClick={() => setOpenIdx(expanded ? null : i)}
                  className="flex w-full items-center gap-2.5 px-3.5 py-3 text-left transition-colors hover:bg-white/[0.03]"
                >
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-white/10 text-[11px] font-bold text-white/75">
                    {s.stepOrder}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <Clock className="h-3 w-3 text-white/30" />
                      <span className="text-[12px] font-medium text-white/85">{s.timingLabel}</span>
                      <span className="rounded bg-white/5 px-1.5 py-0.5 text-[10px] uppercase text-white/40">{s.channel}</span>
                      {s.isAd !== false && <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] text-amber-200">광고</span>}
                      {issue && <span className="rounded bg-rose-500/15 px-1.5 py-0.5 text-[10px] text-rose-200">{issue}</span>}
                    </div>
                    {!expanded && !blank && (
                      <p className="mt-0.5 truncate text-[11.5px] text-white/45">{s.messageTemplate}</p>
                    )}
                  </div>
                  {expanded ? <ChevronUp className="h-4 w-4 shrink-0 text-white/35" /> : <ChevronDown className="h-4 w-4 shrink-0 text-white/35" />}
                </button>

                {expanded && (
                  <div className="border-t border-white/10 px-3.5 py-3">
                    {s.subject && (
                      <div className="mb-2">
                        <div className="text-[10px] font-medium text-white/35">제목</div>
                        <div className="text-[12.5px] text-white/80">{s.subject}</div>
                      </div>
                    )}
                    <div className="text-[10px] font-medium text-white/35">본문</div>
                    <div className="mt-0.5 whitespace-pre-wrap break-words text-[12.5px] leading-relaxed text-white/80">
                      {blank ? <span className="text-rose-200/70">아직 비어 있습니다. 이 스텝 화면에서 [AI 문안생성]을 누르면 바로 채워집니다.</span> : highlightVars(s.messageTemplate)}
                    </div>
                    <p className="mt-2 text-[10px] italic text-white/30">Data source — 이 스텝에 저장될 본문. (광고) 표기와 무료수신거부는 발송할 때 자동으로 붙습니다.</p>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <div className="space-y-2 border-t border-white/10 bg-slate-900/95 px-5 py-3.5">
          {issues.length > 0 && (
            <p className="text-[11px] text-rose-200/85">
              고쳐야 저장됩니다 — {issues.map((i) => `스텝 ${i.stepOrder} ${i.message}`).join(' · ')}
            </p>
          )}
          {footnote && <p className="text-[11px] text-white/40">{footnote}</p>}
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-xl border border-white/10 px-3 py-2 text-xs font-medium text-white/60 transition-colors hover:bg-white/5"
            >
              더 고칠게요
            </button>
            <button
              type="button"
              onClick={onConfirm}
              disabled={saving || issues.length > 0}
              className="ml-auto inline-flex items-center gap-1.5 rounded-xl bg-white px-4 py-2.5 text-xs font-bold text-slate-900 transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              이대로 저장
            </button>
          </div>
        </div>
      </>
    </JourneyModalShell>
  );
}
