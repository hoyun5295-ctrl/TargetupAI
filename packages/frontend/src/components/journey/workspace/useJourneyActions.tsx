/**
 * useJourneyActions — 여정 멈추기 · 다시 켜기 · 켜기 한 벌(★ 2026-10-20 여정 V.3 §6-7)
 *
 * 목록 · 지도 · 작업 화면이 같은 훅을 쓴다(옛: 멈추기 경로 두 벌 · 확인 창 모양도 달랐다).
 *   [멈추기]  = 1클릭 · 확인 창 0 · 같은 자리 버튼이 [다시 켜기]로 바뀐다(서버가 계보 전체를 멈춘다).
 *   [다시 켜기] = 한 단계 한 줄(크레딧 · 멈춘 동안 생긴 사건은 받지 않음) → 켜기 주소.
 *     겹침이 새로 생겼으면 같은 창에서 고른다 · 점검이 다시 필요하면(사전검사 표식이 비었음) 켜기 확인 창으로 넘긴다.
 *   [켜기](초안) = 켜기 확인 창(점검 · 처음 켜기 크레딧 확인)으로.
 * ⛔ 네이티브 확인 창 0 · 크레딧 숫자는 서버 응답(activationCost · costs.operation)만.
 */
import { useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertTriangle, Loader2, Play } from 'lucide-react';
import JourneyModalShell from '../JourneyModalShell';
import JourneyActivationConfirmModal from '../JourneyActivationConfirmModal';
import { useToast } from '../../ToastProvider';
import { resumeLine, RESUME_CREDIT_SHORT } from '../../../utils/journey-credit-copy';
import type { PauseReasonView } from '../../../utils/journey-map';

export interface ActionJourney {
  id: string;
  name: string;
  status: string;
  goalExitEnabled?: boolean;
  thresholdRecipients?: number | null;
  activationCost?: number;
  pause?: PauseReasonView | null;
}

function authJson(): Record<string, string> {
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('token')}` };
}

export function useJourneyActions({ onChanged, operationCost }: { onChanged: () => void; operationCost: number }): {
  pause: (j: ActionJourney) => Promise<void>;
  activate: (j: ActionJourney) => void;
  busyId: string | null;
  node: ReactNode;
} {
  const toast = useToast();
  const navigate = useNavigate();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [resumeFor, setResumeFor] = useState<ActionJourney | null>(null);
  const [overlapPairs, setOverlapPairs] = useState<string[] | null>(null);
  const [resuming, setResuming] = useState(false);
  const [activationFor, setActivationFor] = useState<ActionJourney | null>(null);

  const pause = async (j: ActionJourney) => {
    if (busyId) return;
    setBusyId(j.id);
    try {
      const r = await fetch(`/api/ai/operator/journeys/${j.id}/pause`, { method: 'POST', headers: authJson(), body: JSON.stringify({ reason: '담당자가 일시정지' }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok || !d?.success) throw new Error(d?.error || '멈추지 못했어요.');
      toast.success('멈췄어요. 같은 자리에서 다시 켤 수 있어요.');
      onChanged();
    } catch (e: any) {
      toast.error(e?.message || '멈추지 못했어요.');
    } finally {
      setBusyId(null);
    }
  };

  const activate = (j: ActionJourney) => {
    if (j.status === 'paused') { setOverlapPairs(null); setResumeFor(j); return; }
    setActivationFor(j);
  };

  const closeResume = () => { if (!resuming) { setResumeFor(null); setOverlapPairs(null); } };

  const runResume = async (acks: string[]) => {
    if (!resumeFor) return;
    const j = resumeFor;
    setResuming(true);
    try {
      const r = await fetch(`/api/ai/operator/journeys/${j.id}/activate`, { method: 'POST', headers: authJson(), body: JSON.stringify({ acknowledgedOverlaps: acks }) });
      const d = await r.json().catch(() => ({}));
      if (r.ok && d?.success) {
        toast.success(Number(d.olderResumed) > 0 ? '다시 켰어요. 옛 모양으로 마무리하던 고객도 이어서 받아요.' : '다시 켰어요.');
        setResumeFor(null);
        setOverlapPairs(null);
        onChanged();
        return;
      }
      if (d?.code === 'OVERLAP_UNRESOLVED' && Array.isArray(d.pairs)) { setOverlapPairs(d.pairs.map(String)); return; }
      // 점검이 다시 필요하거나(설정을 바꿔 사전검사 표식이 비었다) 매장번호 확인이 필요하면 켜기 확인 창이 맡는다.
      if (d?.code === 'PRETEST_REQUIRED' || d?.callbackConfirmRequired) {
        setResumeFor(null);
        setOverlapPairs(null);
        setActivationFor(j);
        return;
      }
      throw new Error(d?.error || '다시 켜지 못했어요.');
    } catch (e: any) {
      toast.error(e?.message || '다시 켜지 못했어요.');
    } finally {
      setResuming(false);
    }
  };

  const creditShort = resumeFor?.pause?.kind === 'credit';
  const node = (
    <>
      <JourneyModalShell open={!!resumeFor} onClose={closeResume} labelledBy="jresume-title" panelClassName="w-full max-w-md" zIndexClassName="z-[80]">
        {resumeFor && (
          <div className="flex flex-col text-slate-900">
            <div className="px-5 pt-5">
              <h2 id="jresume-title" className="text-[16px] font-semibold">{resumeFor.name} 다시 켜기</h2>
              <p className="mt-2 text-[14px] leading-relaxed text-slate-600">{resumeLine(operationCost)}</p>
              {resumeFor.pause && resumeFor.pause.kind !== 'manual' && (
                <p className="mt-2 text-[13px] leading-relaxed text-slate-500">멈춘 이유: {resumeFor.pause.text}</p>
              )}
              {creditShort && (
                <div className="mt-3 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-[13px] leading-relaxed text-amber-900">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                  <span>{RESUME_CREDIT_SHORT} <button type="button" onClick={() => { setResumeFor(null); navigate('/pricing'); }} className="font-semibold underline underline-offset-2">요금제 올리기 신청</button></span>
                </div>
              )}
              {overlapPairs && (
                <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-[13px] leading-relaxed text-amber-900">
                  같은 구매로 함께 시작되는 여정이 {overlapPairs.length}쌍 있어요. 그대로 켜면 같은 구매에 문자가 두 통 갈 수 있어요.
                  한 통만 보내려면 작업 화면 시작 카드에서 「첫 구매 고객 빼기」나 「돌아온 고객은 환영만」을 켜 주세요.
                </div>
              )}
            </div>
            <div className="mt-5 flex items-center justify-end gap-2 border-t border-slate-200 px-5 py-3">
              <button type="button" onClick={closeResume} disabled={resuming} className="h-10 rounded-lg border border-slate-200 px-4 text-[13px] text-slate-600 hover:bg-slate-50 disabled:opacity-40">닫기</button>
              <button type="button" onClick={() => void runResume(overlapPairs || [])} disabled={resuming}
                className="inline-flex h-10 items-center gap-1.5 rounded-lg bg-slate-900 px-4 text-[13px] font-semibold text-white hover:bg-slate-800 disabled:opacity-50">
                {resuming ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Play className="h-4 w-4" aria-hidden />}
                {overlapPairs ? '그래도 다시 켜기' : '다시 켜기'}
              </button>
            </div>
          </div>
        )}
      </JourneyModalShell>
      {activationFor && (
        <JourneyActivationConfirmModal
          journeyId={activationFor.id}
          journeyName={activationFor.name}
          journeyStatus={activationFor.status}
          goalExitEnabled={activationFor.goalExitEnabled}
          thresholdRecipients={activationFor.thresholdRecipients ?? null}
          activationCost={activationFor.activationCost}
          token={localStorage.getItem('token') || ''}
          onClose={() => setActivationFor(null)}
          onActivated={onChanged}
        />
      )}
    </>
  );
  return { pause, activate, busyId, node };
}
