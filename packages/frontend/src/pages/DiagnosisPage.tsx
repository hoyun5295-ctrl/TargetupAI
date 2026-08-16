/**
 * DiagnosisPage — AI 마케팅 진단 공개 페이지(퍼널 B · 미인증 잠재고객) (2026-08-16 신설 · 설계서 §5-6)
 *
 * 흐름 = 0번 게이트(기존 고객사이십니까? — 예: 로그인 안내·행 생성 없음) → 문진(위저드 1소스)
 *      → preview(서버가 추천을 가린 부분 결과) → 신청 폼(회사명·담당자·이메일·전화·동의 1체크)
 *      → 접수 완료(전체 리포트 공개).
 * 원칙: 금액 표기 0(§2-8·서버 result가 이미 그렇다) · 허니팟 · 동의 사전 체크 금지 · native dialog 0.
 * ?src= 영업 링크 식별 → submit의 source_utm(§4-4).
 */
import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowRight, CheckCircle2, Loader2, Stethoscope } from 'lucide-react';
import DiagnosisWizard from '../components/marketing-diagnosis/DiagnosisWizard';
import DiagnosisReportView from '../components/marketing-diagnosis/DiagnosisReportView';
import {
  diagnosisPublicApi,
  type DiagnosisQuestionDto,
  type DiagnosisResultDto,
} from '../components/marketing-diagnosis/diagnosisApi';

type Phase = 'loading' | 'gate' | 'wizard' | 'preview' | 'done' | 'unavailable';

export default function DiagnosisPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const src = searchParams.get('src') || undefined;

  const [phase, setPhase] = useState<Phase>('loading');
  const [questions, setQuestions] = useState<DiagnosisQuestionDto[]>([]);
  const [answers, setAnswers] = useState<Record<string, string> | null>(null);
  const [preview, setPreview] = useState<Partial<DiagnosisResultDto> | null>(null);
  const [result, setResult] = useState<DiagnosisResultDto | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  // 신청 폼
  const [companyName, setCompanyName] = useState('');
  const [contactName, setContactName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [consent, setConsent] = useState(false);   // 사전 체크 금지
  const [honeypot, setHoneypot] = useState('');    // 사람은 못 보는 필드
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState('');

  useEffect(() => {
    (async () => {
      try {
        const q = await diagnosisPublicApi.questions();
        if (q.ok && q.data?.success && Array.isArray(q.data.questions) && q.data.questions.length > 0) {
          setQuestions(q.data.questions);
          setPhase('gate');
        } else {
          setPhase('unavailable');
        }
      } catch {
        setPhase('unavailable');
      }
    })();
  }, []);

  const finishWizard = async (a: Record<string, string>) => {
    setAnswers(a);
    setPreviewLoading(true);
    try {
      const r = await diagnosisPublicApi.preview(a);
      if (r.ok && r.data?.success) {
        setPreview(r.data.preview);
        setPhase('preview');
      } else {
        setFormError(r.data?.error || '진단 계산에 실패했습니다. 잠시 후 다시 시도해 주세요.');
        setPhase('preview');
      }
    } catch {
      setFormError('진단 계산에 실패했습니다. 잠시 후 다시 시도해 주세요.');
      setPhase('preview');
    } finally {
      setPreviewLoading(false);
    }
  };

  const submitLead = async () => {
    if (!answers || submitting) return;
    setFormError('');
    if (!companyName.trim()) { setFormError('회사명을 입력해 주세요.'); return; }
    if (!contactName.trim()) { setFormError('담당자명을 입력해 주세요.'); return; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.trim())) { setFormError('이메일 주소를 확인해 주세요.'); return; }
    if (phone.replace(/[^\d]/g, '').length < 9) { setFormError('연락처를 확인해 주세요.'); return; }
    if (!consent) { setFormError('개인정보 수집·이용 동의가 필요해요.'); return; }

    setSubmitting(true);
    try {
      const r = await diagnosisPublicApi.submit({
        answers,
        company_name: companyName.trim(),
        contact_name: contactName.trim(),
        email: email.trim(),
        phone: phone.trim(),
        consent: true,
        website: honeypot,
        src,
      });
      if (r.ok && r.data?.success) {
        if (r.data.result) setResult(r.data.result);
        setPhase('done');
      } else {
        setFormError(r.data?.error || '신청 처리에 실패했습니다. 잠시 후 다시 시도해 주세요.');
      }
    } catch {
      setFormError('신청 처리에 실패했습니다. 잠시 후 다시 시도해 주세요.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-white break-keep">
      {/* 배경 세계관 — 미인증 랜딩 전례(다크 + violet 보조광), 진단 정체성은 sky→indigo */}
      <div className="pointer-events-none fixed inset-0 overflow-hidden" aria-hidden>
        <div className="absolute -top-32 left-1/4 h-96 w-96 rounded-full bg-violet-600/10 blur-3xl" />
        <div className="absolute right-0 top-1/3 h-80 w-80 rounded-full bg-sky-500/10 blur-3xl" />
      </div>

      <header className="sticky top-0 z-20 border-b border-white/10 bg-slate-950/80 backdrop-blur">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-4 py-3">
          <div className="flex items-center gap-2.5">
            <span className="grid h-10 w-10 place-items-center rounded-xl bg-gradient-to-br from-sky-400 to-indigo-500 shadow-lg shadow-sky-500/25">
              <Stethoscope className="h-5 w-5 text-white" aria-hidden />
            </span>
            <div>
              <p className="text-sm font-bold tracking-tight">AI 마케팅 진단</p>
              <p className="text-[11px] text-white/50">한줄로 · 8문항 약 2분</p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => navigate('/login')}
            className="min-h-[40px] rounded-xl border border-white/15 px-3.5 py-1.5 text-[13px] font-semibold text-white/80 transition-colors hover:bg-white/10"
          >
            로그인
          </button>
        </div>
      </header>

      <main className="relative mx-auto max-w-3xl px-4 py-8 md:py-12">
        {phase === 'loading' && (
          <div className="flex items-center justify-center gap-2 py-24 text-sm text-white/60">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> 진단을 준비하고 있어요
          </div>
        )}

        {phase === 'unavailable' && (
          <div className="py-24 text-center text-sm text-white/60">
            진단 준비 중입니다. 잠시 후 다시 방문해 주세요.
          </div>
        )}

        {phase === 'gate' && (
          <div className="mx-auto max-w-xl">
            <h1 className="text-2xl font-bold tracking-tight md:text-3xl">
              우리 브랜드 마케팅,
              <br />
              <span className="bg-gradient-to-r from-sky-400 to-indigo-400 bg-clip-text text-transparent">
                지금 어느 단계일까요?
              </span>
            </h1>
            <p className="mt-3 text-sm leading-relaxed text-white/65">
              8개 질문에 답하면 AI가 답변 기준으로 진단 리포트를 만들어 드려요. 분야별 실물 예시까지 함께 보여드립니다.
            </p>
            <div className="mt-3 inline-flex items-center gap-1.5 rounded-full border border-sky-400/30 bg-sky-500/15 px-3.5 py-1.5 text-[13px] font-semibold text-sky-200">
              진단을 완료하고 가입하시면 7일 무료체험을 드려요
            </div>
            <div className="mt-8 rounded-2xl border border-white/10 bg-white/5 p-5">
              <p className="text-base font-bold leading-relaxed">
                먼저 하나만 여쭤볼게요.
                <br />
                기존 한줄로 고객사이신가요?
              </p>
              <div className="mt-4 flex flex-col gap-2 sm:flex-row">
                <button
                  type="button"
                  onClick={() => navigate('/login')}
                  className="min-h-[60px] flex-1 rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-center transition-all hover:border-sky-400/40 hover:bg-white/10"
                >
                  <span className="block text-[15px] font-semibold text-white/90">네, 이용 중이에요</span>
                  <span className="mt-0.5 block text-[12px] text-white/50">로그인해서 진단받기</span>
                </button>
                <button
                  type="button"
                  onClick={() => setPhase('wizard')}
                  className="min-h-[60px] flex-1 rounded-xl bg-gradient-to-r from-sky-500 to-indigo-500 px-4 py-2.5 text-center shadow-lg shadow-sky-500/25 transition-all hover:shadow-xl"
                >
                  <span className="block text-[15px] font-bold text-white">아니요, 처음이에요</span>
                  <span className="mt-0.5 block text-[12px] text-white/80">바로 시작하기</span>
                </button>
              </div>
            </div>
          </div>
        )}

        {phase === 'wizard' && (
          <div className="mx-auto max-w-xl rounded-2xl border border-white/10 bg-white/5 p-5 md:p-6">
            {previewLoading ? (
              <div className="flex flex-col items-center justify-center gap-3 py-16">
                <Loader2 className="h-6 w-6 animate-spin text-sky-400" aria-hidden />
                <p className="text-sm text-white/70">답변을 분석하고 있어요</p>
              </div>
            ) : (
              <DiagnosisWizard questions={questions} onFinished={finishWizard} />
            )}
          </div>
        )}

        {(phase === 'preview' || phase === 'done') && (
          <div className="flex flex-col gap-6">
            {phase === 'done' && (
              <div className="flex items-center gap-2.5 rounded-2xl border border-emerald-400/30 bg-emerald-500/10 px-4 py-3">
                <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-400" aria-hidden />
                <p className="text-sm font-semibold text-emerald-200">
                  신청이 접수되었습니다. 담당자가 리포트와 함께 곧 연락드릴게요.
                </p>
              </div>
            )}

            {(phase === 'done' ? result : preview) && (
              <DiagnosisReportView result={(phase === 'done' ? result : preview) as DiagnosisResultDto} />
            )}

            {phase === 'preview' && (
              <div className="rounded-2xl border border-sky-400/25 bg-gradient-to-br from-sky-500/10 to-indigo-500/10 p-5">
                <p className="text-base font-bold">요금제 추천은 담당자가 함께 확인드립니다</p>
                <p className="mt-1 text-[13px] text-white/60">
                  연락처를 남겨 주시면 전체 리포트가 바로 열리고, 담당자가 우리 회사에 맞춰 안내드려요.
                </p>
                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  <input
                    value={companyName}
                    onChange={(e) => setCompanyName(e.target.value)}
                    maxLength={200}
                    placeholder="회사명"
                    className="min-h-[48px] rounded-xl border border-white/15 bg-slate-900/80 px-3.5 text-sm text-white placeholder:text-white/35 outline-none transition-colors focus:border-sky-400/60"
                  />
                  <input
                    value={contactName}
                    onChange={(e) => setContactName(e.target.value)}
                    maxLength={100}
                    placeholder="담당자명"
                    className="min-h-[48px] rounded-xl border border-white/15 bg-slate-900/80 px-3.5 text-sm text-white placeholder:text-white/35 outline-none transition-colors focus:border-sky-400/60"
                  />
                  <input
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    maxLength={200}
                    type="email"
                    placeholder="이메일"
                    className="min-h-[48px] rounded-xl border border-white/15 bg-slate-900/80 px-3.5 text-sm text-white placeholder:text-white/35 outline-none transition-colors focus:border-sky-400/60"
                  />
                  <input
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    maxLength={30}
                    type="tel"
                    placeholder="연락처"
                    className="min-h-[48px] rounded-xl border border-white/15 bg-slate-900/80 px-3.5 text-sm text-white placeholder:text-white/35 outline-none transition-colors focus:border-sky-400/60"
                  />
                </div>
                {/* 허니팟 — 화면·스크린리더 밖(봇만 채운다) */}
                <input
                  value={honeypot}
                  onChange={(e) => setHoneypot(e.target.value)}
                  tabIndex={-1}
                  autoComplete="off"
                  aria-hidden="true"
                  name="website"
                  className="absolute -left-[9999px] top-0 h-0 w-0 opacity-0"
                />
                <label className="mt-3 flex cursor-pointer items-start gap-2.5 text-[13px] text-white/70">
                  <input
                    type="checkbox"
                    checked={consent}
                    onChange={(e) => setConsent(e.target.checked)}
                    className="mt-0.5 h-4 w-4 accent-sky-500"
                  />
                  <span>
                    개인정보 수집·이용에 동의합니다. 상담 안내 목적으로만 사용해요.{' '}
                    <a href="/privacy" target="_blank" rel="noreferrer" className="underline decoration-white/30 underline-offset-2 hover:text-white">
                      자세히 보기
                    </a>
                  </span>
                </label>
                {formError && <p className="mt-3 text-[13px] font-semibold text-rose-300">{formError}</p>}
                <button
                  type="button"
                  onClick={submitLead}
                  disabled={!consent || submitting}
                  className="mt-4 inline-flex min-h-[52px] w-full items-center justify-center gap-1.5 rounded-xl bg-gradient-to-r from-sky-500 to-indigo-500 px-4 text-[15px] font-bold text-white shadow-lg shadow-sky-500/25 transition-all hover:shadow-xl disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {submitting ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
                  전체 리포트 열어보기 <ArrowRight className="h-4 w-4" aria-hidden />
                </button>
              </div>
            )}

            {phase === 'done' && (
              <div className="flex justify-center pb-4">
                <button
                  type="button"
                  onClick={() => navigate('/login')}
                  className="min-h-[44px] rounded-xl border border-white/15 bg-white/5 px-4 py-2 text-sm font-semibold text-white/85 transition-colors hover:bg-white/10"
                >
                  한줄로 시작하러 가기
                </button>
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
