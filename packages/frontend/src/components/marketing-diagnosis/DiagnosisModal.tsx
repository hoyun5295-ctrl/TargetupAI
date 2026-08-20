/**
 * DiagnosisModal — 퍼널 A(기존 FREE 고객사) 진단 셸 (2026-08-16 신설 · v3 분기형 개편)
 *
 * JourneyModalShell 재사용 + 문진 중에는 백드롭·Esc 2축 opt-out(disableDismiss — 답 소실 차단).
 * v3: 문항은 인증 questions(실측 선치환 동봉) · 섹션·분기 위저드 · 드래프트(sessionStorage) ·
 *     문진 중 X = 확인 인터럽트(즉시 전소 금지 — 드래프트가 있어 닫아도 이어할 수 있다).
 * 제출 = POST /api/marketing-diagnosis/submit 한 번(§4-1이 저장+지급을 한 트랜잭션으로 소유).
 */
import { useEffect, useState } from 'react';
import { Gift, Loader2, X } from 'lucide-react';
import JourneyModalShell from '../journey/JourneyModalShell';
import DiagnosisWizard from './DiagnosisWizard';
import DiagnosisReportView from './DiagnosisReportView';
import {
  diagnosisApi,
  type DiagnosisQuestionDto,
  type DiagnosisResultDto,
  type DiagnosisSectionDto,
} from './diagnosisApi';

type Phase = 'loading' | 'wizard' | 'submitting' | 'report' | 'error';

interface Props {
  open: boolean;
  onClose: () => void;
  /** 제출 완료(지급 포함) — 부모가 state를 재조회해 히어로를 D-N으로 전환한다 */
  onCompleted: () => void;
  /** 「첫 발송 해보기」 — 대시보드 직접발송 진입 */
  onFirstSend: () => void;
  /** 「다른 요금제 보기」 */
  onSeePlans: () => void;
  toast: (msg: string, type?: 'success' | 'error') => void;
  /** ★2026-08-16 Harold 지시 — 지급 자격 회사에만 문진 상단 7일 보상 문구(거짓 약속 차단) */
  showTrialReward?: boolean;
  /** v2 리포트 표지 1층 — 회사명(대시보드가 안다) */
  companyName?: string | null;
}

export default function DiagnosisModal({
  open, onClose, onCompleted, onFirstSend, onSeePlans, toast, showTrialReward = false, companyName = null,
}: Props) {
  const [phase, setPhase] = useState<Phase>('loading');
  const [questions, setQuestions] = useState<DiagnosisQuestionDto[]>([]);
  const [sections, setSections] = useState<DiagnosisSectionDto[] | null>(null);
  const [prefilled, setPrefilled] = useState<Record<string, string>>({});
  const [echoes, setEchoes] = useState<Record<string, Record<string, { tone: 'gap' | 'good'; text: string }>> | null>(null);
  const [version, setVersion] = useState<string>('');
  const [result, setResult] = useState<DiagnosisResultDto | null>(null);
  const [outcome, setOutcome] = useState<DiagnosisResultDto['grant_outcome']>(null);
  const [trialExpiresAt, setTrialExpiresAt] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState('');
  const [confirmClose, setConfirmClose] = useState(false);

  useEffect(() => {
    if (!open) return;
    setPhase('loading');
    setResult(null);
    setOutcome(null);
    setConfirmClose(false);
    (async () => {
      try {
        const q = await diagnosisApi.questions();
        if (q.ok && q.data?.success && Array.isArray(q.data.questions) && q.data.questions.length > 0) {
          setQuestions(q.data.questions);
          setSections(Array.isArray(q.data.meta?.sections) && q.data.meta.sections.length > 0 ? q.data.meta.sections : null);
          setPrefilled(q.data.prefilled && typeof q.data.prefilled === 'object' ? q.data.prefilled : {});
          setEchoes(q.data.echoes && typeof q.data.echoes === 'object' ? q.data.echoes : null);
          setVersion(String(q.data.version ?? ''));
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
      const r = await diagnosisApi.submit(answers, version || undefined);
      if (r.status === 409 && r.data?.code === 'VERSION_CHANGED') {
        setErrorMsg(r.data.error || '진단 문항이 갱신되었어요. 처음부터 다시 진행해 주세요.');
        setPhase('error');
        return;
      }
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

  const requestClose = () => {
    if (phase === 'submitting') return;
    if (phase === 'wizard') { setConfirmClose(true); return; }
    onClose();
  };

  return (
    <JourneyModalShell
      open={open}
      onClose={requestClose}
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
          onClick={requestClose}
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

        {phase === 'wizard' && (
          <>
            {showTrialReward && (
              <div className="mb-4 flex items-center gap-1.5 rounded-xl border border-sky-400/30 bg-sky-500/15 px-3.5 py-2 text-[13px] font-semibold text-sky-200">
                <Gift className="h-4 w-4 shrink-0" aria-hidden />
                진단을 끝내면 7일 무료체험이 바로 시작돼요
              </div>
            )}
            <DiagnosisWizard
              questions={questions}
              sections={sections}
              prefilled={prefilled}
              echoes={echoes}
              draftKey={version ? `diagnosis-draft-A-${version}` : null}
              onFinished={submit}
            />
          </>
        )}

        {phase === 'submitting' && (
          <div className="flex flex-col items-center justify-center gap-3 py-16">
            <Loader2 className="h-6 w-6 animate-spin text-sky-400" aria-hidden />
            <p className="text-sm text-white/70">답변을 읽고 진단서를 쓰고 있어요</p>
          </div>
        )}

        {phase === 'report' && result && (
          <DiagnosisReportView
            result={result}
            outcome={outcome}
            trialExpiresAt={trialExpiresAt}
            coverTitle={companyName}
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

      {/* 문진 중 닫기 확인 — 즉시 전소 금지(드래프트가 있어 닫아도 이어할 수 있다) */}
      {confirmClose && (
        <div className="fixed inset-0 z-[2100] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
          <div className="w-full max-w-sm rounded-2xl border border-white/10 bg-slate-900 p-5 shadow-2xl break-keep">
            <p className="text-base font-bold text-white">진단을 잠깐 멈출까요?</p>
            <p className="mt-1.5 text-sm text-white/60">지금까지의 답변은 저장돼 있어요. 다음에 이어서 할 수 있어요.</p>
            <div className="mt-4 flex gap-2">
              <button
                type="button"
                onClick={() => setConfirmClose(false)}
                className="min-h-[44px] flex-1 rounded-xl bg-gradient-to-r from-sky-500 to-indigo-500 px-4 py-2 text-sm font-bold text-white shadow-lg shadow-sky-500/25"
              >
                계속할게요
              </button>
              <button
                type="button"
                onClick={() => { setConfirmClose(false); onClose(); }}
                className="min-h-[44px] flex-1 rounded-xl border border-white/15 bg-white/5 px-4 py-2 text-sm font-semibold text-white/80 hover:bg-white/10"
              >
                다음에 할게요
              </button>
            </div>
          </div>
        </div>
      )}
    </JourneyModalShell>
  );
}
