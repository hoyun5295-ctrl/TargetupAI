/**
 * LineTrialBanner — 대시보드 한 줄 배너(7일 무료체험) (★ 2026-11-17 C140 · 설계서 docs/2026-11-17-line-trial-banner-design.md §4-1 · §4-3 · §4-6)
 *
 * 옛 진단 띠(DiagnosisHeroCard · 설문 14 ~ 22문항 뒤 체험)를 대신한다. 한 줄을 적고 누르면 서버가 설문 없이 7일 체험을 켜고
 * (POST /api/marketing-diagnosis/trial/start), 대시보드가 직접발송 창의 AI 다듬기로 그 한 줄을 넘긴다.
 *   - 그릴지 말지 = 부모가 서버 state 의 banner 칸으로 정한다(이 부품은 요금제 · 역할 · 지급 이력을 따지지 않는다).
 *   - variant 'offer' = 체험 제안 · 'trial' = 체험 중(같은 입력칸 · 남은 날).
 *   - 실패해도 적은 한 줄은 그대로 둔다(다시 입력 금지). 끊긴 요청이 체험을 켰을 수 있으므로 부모가 상태를 다시 읽는다(짐작하지 않는다).
 *   - 뜸 · 누름 기록 = reportPlanFeature(슈퍼관리자 「기능 관심 업체」 · 등록부 constants/login-popups.ts).
 * 모양 = 흰 판 + 검정 + 주황 하나(로그인 안내 창과 같은 값) · 그림 없음 · 목업 docs/mockups/2026-11-17-diagnosis-banner-line-mockup.html.
 * ⛔ 줄표 0 · 가운뎃점 0(고객에게 보이는 글) · 모델명 0 · 혜택은 지금 있는 것(7일 무료체험 · 회사당 1번)만 말한다.
 */
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ArrowRight, Loader2 } from 'lucide-react';
import { diagnosisApi } from '../marketing-diagnosis/diagnosisApi';
import { reportPlanFeature } from '../../utils/plan-feature-report';
import { LINE_TRIAL_BANNER_ID } from '../../constants/login-popups';
import { LINE_TRIAL_MAX, normalizeLine, trialLeftLabel } from '../../utils/line-trial';

/** 입력칸 예시(번갈아 · 달 이름 · 날짜 없음) */
const EXAMPLES = ['주말 이틀간 전 메뉴 20% 할인', '신상 니트 입고, 단골 먼저 안내', '다음 주 휴진일 미리 안내'] as const;

export type LineTrialOutcome = 'granted' | 'already_granted';

interface Props {
  variant: 'offer' | 'trial';
  /** 체험 중일 때 남은 날 수(서버가 센 값 · 0 = 오늘이 마지막 날) */
  daysLeft?: number | null;
  /** 체험 시작 답을 받았다 — 대시보드가 그 한 줄을 직접발송 창으로 넘긴다 */
  onStarted: (line: string, outcome: LineTrialOutcome) => void;
  /** 체험을 이미 쓴 회사(409 TRIAL_USED) */
  onUsed: () => void;
  /** 그 밖 실패(연결 끊김 포함) */
  onFailed: () => void;
}

export default function LineTrialBanner({ variant, daysLeft = null, onStarted, onUsed, onFailed }: Props) {
  const offer = variant === 'offer';
  const [line, setLine] = useState('');
  const [busy, setBusy] = useState(false);
  const [needLine, setNeedLine] = useState(false);
  const [example, setExample] = useState(0);
  const [exampleOn, setExampleOn] = useState(true);
  const busyRef = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // 뜸 기록 — 제안 모양이 그려졌을 때 대시보드 진입당 한 번
  const seenRef = useRef(false);
  useEffect(() => {
    if (!offer || seenRef.current) return;
    seenRef.current = true;
    reportPlanFeature(LINE_TRIAL_BANNER_ID, 'open');
  }, [offer]);

  // 예시는 조용히 바뀐다(적기 시작하면 멈춘다 · 움직임 줄이기 설정이면 바꾸지 않는다)
  useEffect(() => {
    if (line || busy) return;
    if (typeof window === 'undefined' || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    let swap: number | undefined;
    const tick = window.setInterval(() => {
      setExampleOn(false);
      swap = window.setTimeout(() => { setExample((i) => (i + 1) % EXAMPLES.length); setExampleOn(true); }, 350);
    }, 3400);
    return () => { window.clearInterval(tick); if (swap) window.clearTimeout(swap); };
  }, [line, busy]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busyRef.current) return;
    const value = normalizeLine(line);
    if (!value) { setNeedLine(true); inputRef.current?.focus(); return; }
    busyRef.current = true;
    setBusy(true);
    if (offer) reportPlanFeature(LINE_TRIAL_BANNER_ID, 'go');
    const r = await diagnosisApi.startTrial().catch(() => null);
    busyRef.current = false;
    setBusy(false);
    const outcome = r?.data?.outcome;
    if (r?.ok && r.data?.success && (outcome === 'granted' || outcome === 'already_granted')) {
      setLine('');
      onStarted(value, outcome);
      return;
    }
    if (r?.status === 409 && r.data?.code === 'TRIAL_USED') { onUsed(); return; }
    onFailed();
  };

  return (
    <section
      aria-label={offer ? '7일 무료체험' : '무료체험 진행 중'}
      data-zone="line-trial-banner"
      className="mb-4 grid grid-cols-1 gap-[18px] break-keep rounded-[20px] bg-white px-[18px] py-5 shadow-[0_1px_2px_rgba(11,11,12,0.06),0_18px_36px_-24px_rgba(11,11,12,0.34)] sm:px-6 sm:py-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)] lg:items-center lg:gap-x-11 lg:px-[33px] lg:py-[27px]"
    >
      <div className="min-w-0">
        <p className="flex items-center gap-[7px] text-[13px] font-bold text-[#5F6368]">
          <span className="h-[7px] w-[7px] shrink-0 rounded-full bg-[#CF4510]" aria-hidden />
          {offer ? '7일 무료체험' : trialLeftLabel(daysLeft)}
        </p>
        <h2 className="mt-2 text-[20px] font-black leading-[1.24] tracking-[-0.04em] text-[#0B0B0C] min-[360px]:text-[21px] sm:text-[23px] lg:text-[25px]">
          <span className="inline-block">이번에 알릴 것,</span>{' '}
          <span className="inline-block">한 줄만 적어 보세요</span>
        </h2>
        <p className="mt-[7px] text-[14.5px] leading-[1.55] text-[#5F6368] [text-wrap:balance]">
          AI가 한 줄을 읽고 문자 초안을 써 드려요.
        </p>
      </div>

      <form onSubmit={submit} noValidate className="min-w-0">
        <div className="flex flex-col gap-2.5 sm:flex-row">
          <div className="relative min-w-0 flex-1">
            <label htmlFor="line-trial-input" className="sr-only">알릴 내용 한 줄</label>
            <input
              id="line-trial-input"
              ref={inputRef}
              type="text"
              value={line}
              maxLength={LINE_TRIAL_MAX}
              autoComplete="off"
              disabled={busy}
              aria-describedby="line-trial-note"
              onChange={(e) => { setLine(e.target.value); if (needLine) setNeedLine(false); }}
              className="block h-14 w-full rounded-[14px] border-[1.5px] border-[#0B0B0C] bg-white px-[18px] text-[16px] font-semibold text-[#0B0B0C] outline-none transition-shadow focus:shadow-[0_0_0_4px_rgba(11,11,12,0.1)]"
            />
            {!line && (
              <span
                aria-hidden
                className={`pointer-events-none absolute inset-y-0 left-[19.5px] right-[19.5px] flex items-center overflow-hidden whitespace-nowrap text-[15px] font-medium text-[#6B6B70] transition-opacity duration-300 motion-reduce:transition-none ${exampleOn ? 'opacity-100' : 'opacity-0'}`}
              >
                {EXAMPLES[example]}
              </span>
            )}
          </div>
          <button
            type="submit"
            disabled={busy}
            className="inline-flex h-14 w-full shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-[14px] bg-[#CF4510] px-[22px] text-[16px] font-extrabold text-white transition hover:-translate-y-px hover:bg-[#B53C0D] focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-[#0B0B0C] disabled:translate-y-0 disabled:cursor-default disabled:bg-[#B53C0D] motion-reduce:transition-none sm:w-auto"
          >
            {busy ? (
              <>여는 중 <Loader2 className="h-4 w-4 animate-spin" aria-hidden /></>
            ) : (
              <>{offer ? '7일 무료로 써 보기' : '문자 초안 받기'} <ArrowRight className="h-[18px] w-[18px]" strokeWidth={2.4} aria-hidden /></>
            )}
          </button>
        </div>
        <p
          id="line-trial-note"
          aria-live="polite"
          className={`mt-2.5 text-[13px] leading-[1.5] ${needLine ? 'font-bold text-[#0B0B0C]' : 'text-[#6B6B70]'}`}
        >
          {needLine ? (
            '한 줄을 먼저 적어 주세요.'
          ) : offer ? (
            <>
              <span className="inline-block">누르면 AI 기능이 7일 동안 무료로 열려요.</span>{' '}
              <span className="inline-block">끝나면 지금 요금제로 돌아와요.</span>
            </>
          ) : (
            '무료체험이 끝나면 지금 요금제로 돌아와요.'
          )}
        </p>
      </form>
    </section>
  );
}
