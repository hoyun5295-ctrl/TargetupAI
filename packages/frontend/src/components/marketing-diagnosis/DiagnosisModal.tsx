/**
 * DiagnosisModal — 퍼널 A(기존 FREE 고객사) 진단 셸 (2026-08-16 신설 · 설계서 §5-3·§5-4)
 *
 * JourneyModalShell 재사용 + 문진 중에는 백드롭·Esc 2축 opt-out(disableDismiss — 답 소실 차단).
 * 제출 = POST /api/marketing-diagnosis/submit 한 번(§4-1이 저장+지급을 한 트랜잭션으로 소유).
 * 제출 중에는 닫기 차단 오버레이(5초+ 작업 차단 원칙).
 */
import { useEffect, useState } from 'react';
import { Loader2, X } from 'lucide-react';
import JourneyModalShell from '../journey/JourneyModalShell';
import DiagnosisWizard from './DiagnosisWizard';
import DiagnosisReportView from './DiagnosisReportView';
import { diagnosisApi, diagnosisPublicApi, type DiagnosisQuestionDto, type DiagnosisResultDto } from './diagnosisApi';

type Phase = 'loading' | 'wizard' | 'submitting' | 'report' | 'error';

interface Props {
  open: boolean;
  onClose: () => void;
  /** 제출 완료(지급 포함) — 부모가 state를 재조회해 히어로를 D-N으로 전환한다 */
  onCompleted: () => void;
  /** 히어로 「첫 발송 해보기」 — 대시보드 직접발송 진입 */
  onFirstSend: () => void;
  /** 「다른 요금제 보기」 */
  onSeePlans: () => void;
  toast: (msg: string, type?: 'success' | 'error') => void;
}

export default function DiagnosisModal({ open, onClose, onCompleted, onFirstSend, onSeePlans, toast }: Props) {
  const [phase, setPhase] = useState<Phase>('loading');
  const [questions, setQuestions] = useState<DiagnosisQuestionDto[]>([]);
  const [result, setResult] = useState<DiagnosisResultDto | null>(null);
  const [outcome, setOutcome] = useState<DiagnosisResultDto['grant_outcome']>(null);
  const [trialExpiresAt, setTrialExpiresAt] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState('');

  useEffect(() => {
    if (!open) return;
    setPhase('loading');
    setResult(null);
    setOutcome(null);
    (async () => {
      try {
        const q = await diagnosisPublicApi.questions();
        if (q.ok && q.data?.success && Array.isArray(q.data.questions) && q.data.questions.length > 0) {
          setQuestions(q.data.questions);
          setPhase('wizard');
        } else {
          setErrorMsg('진단 준비 중입니다. 잠시 후 다시 시도해 주세요.');
          setPhase('error');
        }
      } catch {
        setErrorMsg('진단 준비 중입니다. 잠시 후 다시 시도해 주세요.');
        setPhase('error');
      }
    })();
  }, [open]);

  const loadReport = async () => {
    const r = await diagnosisApi.report();
    if (r.ok && r.data?.result) {
      setResult(r.data.result);
      setOutcome(r.data.result.grant_outcome ?? 'already_granted');
      setPhase('report');
      return true;
    }
    return false;
  };

  const submit = async (answers: Record<string, string>) => {
    setPhase('submitting');
    try {
      const r = await diagnosisApi.submit(answers);
      if (r.ok && r.data?.success) {
        if (r.data.result) {
          setResult(r.data.result);
          setOutcome(r.data.outcome ?? r.data.result.grant_outcome ?? null);
          setTrialExpiresAt(r.data.trialExpiresAt ?? null);
          setPhase('report');
        } else if (!(await loadReport())) {
          // already_granted인데 저장 리포트가 없다(수동 지급 직후 경쟁 등) — 사실만 안내
          setErrorMsg('이미 체험이 지급된 계정이에요. 대시보드에서 이용 현황을 확인해 주세요.');
          setPhase('error');
        }
        onCompleted();
        return;
      }
      if (r.status === 409 && (await loadReport())) { onCompleted(); return; }
      setErrorMsg(r.data?.error || '제출 처리에 실패했습니다. 잠시 후 다시 시도해 주세요.');
      setPhase('error');
    } catch {
      setErrorMsg('제출 처리에 실패했습니다. 잠시 후 다시 시도해 주세요.');
      setPhase('error');
    }
  };

  const consult = async () => {
    const r = await diagnosisApi.consult();
    if (r.ok) toast('상담 신청이 접수되었습니다. 담당자가 곧 연락드릴게요.', 'success');
    else toast(r.data?.error || '상담 신청에 실패했습니다.', 'error');
  };

  return (
    <JourneyModalShell
      open={open}
      onClose={onClose}
      labelledBy="marketing-diagnosis-modal-title"
      zIndexClassName="z-[2000]"
      panelClassName="w-full max-w-2xl"
      disableDismiss={phase === 'wizard' || phase === 'submitting'}
    >
      <div className="flex items-center justify-between border-b border-white/10 px-5 py-3.5">
        <h2 id="marketing-diagnosis-modal-title" className="text-base font-bold text-white">
          AI 마케팅 진단
        </h2>
        <button
          type="button"
          onClick={onClose}
          disabled={phase === 'submitting'}
          aria-label="닫기"
          className="grid h-9 w-9 place-items-center rounded-lg text-white/60 transition-colors hover:bg-white/10 hover:text-white disabled:opacity-40"
        >
          <X className="h-4 w-4" aria-hidden />
        </button>
      </div>

      <div className="overflow-y-auto px-5 py-5 break-keep">
        {phase === 'loading' && (
          <div className="flex items-center justify-center gap-2 py-16 text-sm text-white/60">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> 진단을 준비하고 있어요
          </div>
        )}

        {phase === 'wizard' && <DiagnosisWizard questions={questions} onFinished={submit} />}

        {phase === 'submitting' && (
          <div className="flex flex-col items-center justify-center gap-3 py-16">
            <Loader2 className="h-6 w-6 animate-spin text-sky-400" aria-hidden />
            <p className="text-sm text-white/70">답변을 분석해 리포트를 만들고 있어요</p>
          </div>
        )}

        {phase === 'report' && result && (
          <DiagnosisReportView
            result={result}
            outcome={outcome}
            trialExpiresAt={trialExpiresAt}
            onFirstSend={() => { onClose(); onFirstSend(); }}
            onConsult={consult}
            onSeePlans={() => { onClose(); onSeePlans(); }}
            onLater={onClose}
          />
        )}

        {phase === 'error' && (
          <div className="flex flex-col items-center gap-4 py-12 text-center">
            <p className="text-sm text-white/70">{errorMsg}</p>
            <button
              type="button"
              onClick={onClose}
              className="min-h-[44px] rounded-xl border border-white/15 bg-white/5 px-4 py-2 text-sm font-semibold text-white/85 hover:bg-white/10"
            >
              닫기
            </button>
          </div>
        )}
      </div>
    </JourneyModalShell>
  );
}
