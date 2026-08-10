/**
 * components/cdp/CdpIntegrationStepper.tsx — 자사몰 연동 3단계 진행 패널 (★2026-08-10 Phase 3)
 *
 * 설계서 = docs/2026-08-09-cdp-integration-redesign-design.md §5-2
 *   ① 연결 ─── ② 설치 ─── ③ 첫 데이터 확인
 *
 * 스텝 바이 스텝 규칙 5(설계서 §5-2) — 이 컴포넌트가 강제한다:
 *   1. 한 화면에 펼쳐진 단계는 하나. 완료는 접고, 미래는 잠근다.
 *   2. 각 단계의 주 액션은 하나.
 *   3. **완료 판정은 시스템이 한다.** "다음" 버튼으로 사용자가 자기 진도를 신고하지 않는다.
 *   4. ③은 기다림을 보여준다 — 수신되면 신호가 하나씩 켜진다.
 *   5. 막히면 빠져나갈 길을 준다(오래 기다리면 안내 노출).
 *
 * 매핑 보류 몰(네이버·메이크샵)은 ②·③ 대신 안내 한 장만 보여준다 — 거짓 진행바를 돌리지 않는다.
 */

import { useMemo, type ReactNode } from 'react';
import { Check, Loader2, Lock, HelpCircle, Send } from 'lucide-react';
import type { CdpProviderStatus } from '../../hooks/useCdpIntegrationStatus';

export interface CdpStepSignals {
  pageview: boolean;
  identify: boolean;
  consent: boolean;
  click: boolean;
}

export interface CdpIntegrationStepperProps {
  providerName: string;
  status: CdpProviderStatus;
  /** ① 단계 본문 — 몰별 기존 연결 폼을 그대로 담는다(새로 만들지 않는다). */
  connectSlot: ReactNode;
  /** ② 단계 본문 — 스크립트·웹훅 안내. OAuth·폴링 몰은 생략 가능(우리가 자동으로 가져온다). */
  installSlot?: ReactNode;
  /** ③ 신호 4종 — install-status 응답. 없으면 미수신으로 본다. */
  signals?: CdpStepSignals | null;
  /** 오래 기다리는 중인지(규칙 5 탈출구). 화면이 판단해 넘긴다. */
  stalled?: boolean;
  onDeveloperSend?: () => void;
  onRetryCheck?: () => void;
}

type StepState = 'done' | 'active' | 'locked';

function StepHead({ n, title, state }: { n: number; title: string; state: StepState }) {
  const tone =
    state === 'done' ? 'bg-emerald-500/15 text-emerald-300 border-emerald-400/25'
      : state === 'active' ? 'bg-violet-500/20 text-violet-100 border-violet-400/40'
        : 'bg-white/[0.04] text-white/35 border-white/10';
  return (
    <div className="flex items-center gap-2.5">
      <span className={`w-6 h-6 rounded-full border inline-flex items-center justify-center text-[11px] font-bold ${tone}`}>
        {state === 'done' ? <Check className="w-3.5 h-3.5" /> : state === 'locked' ? <Lock className="w-3 h-3" /> : n}
      </span>
      <span className={`text-sm font-semibold ${state === 'locked' ? 'text-white/35' : 'text-white'}`}>{title}</span>
    </div>
  );
}

const SIGNAL_LABEL: Array<{ key: keyof CdpStepSignals; label: string }> = [
  { key: 'pageview', label: '페이지 방문' },
  { key: 'identify', label: '회원 식별' },
  { key: 'consent', label: '마케팅 동의' },
  { key: 'click', label: '클릭' },
];

export default function CdpIntegrationStepper({
  providerName, status, connectSlot, installSlot, signals, stalled, onDeveloperSend, onRetryCheck,
}: CdpIntegrationStepperProps) {
  // 완료 판정은 실측값으로만 한다(규칙 3). 사용자가 넘기는 단계가 없다.
  const steps = useMemo(() => {
    const connected = status.connected;
    const anyEvent = status.total > 0;
    const s1: StepState = connected ? 'done' : 'active';
    const s2: StepState = !connected ? 'locked' : anyEvent ? 'done' : 'active';
    const s3: StepState = !anyEvent ? (connected ? 'locked' : 'locked') : 'active';
    return { s1, s2, s3 };
  }, [status.connected, status.total]);

  // 매핑 보류 몰 — 진행바 대신 사실을 말한다.
  if (status.eventsUnavailable && status.connected) {
    return (
      <div className="space-y-4">
        <StepHead n={1} title="연결" state="done" />
        <div className="rounded-2xl border border-violet-400/25 bg-violet-500/[0.07] p-5">
          <div className="flex items-start gap-3">
            <Loader2 className="w-5 h-5 text-violet-300 animate-spin flex-shrink-0 mt-0.5" />
            <div className="space-y-1.5">
              <div className="text-sm font-semibold text-violet-100">연결이 끝났습니다 · 데이터 연동을 준비 중이에요</div>
              <p className="text-[12px] text-white/55 leading-relaxed">
                {providerName}의 회원·주문을 한줄로 형식에 맞추는 작업이 남아 있습니다. 영업일 1일 안에 끝나며,
                준비가 되면 이 화면이 자동으로 <span className="text-emerald-300">데이터 수신 중</span>으로 바뀝니다.
                지금 하실 일은 없습니다.
              </p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* ① 연결 */}
      <section aria-current={steps.s1 === 'active' ? 'step' : undefined} className="space-y-3">
        <StepHead n={1} title="연결" state={steps.s1} />
        {steps.s1 === 'active'
          ? <div className="pl-[2.15rem]">{connectSlot}</div>
          : <div className="pl-[2.15rem] text-[12px] text-emerald-300/80">연결 완료</div>}
      </section>

      {/* ② 설치 */}
      <section aria-current={steps.s2 === 'active' ? 'step' : undefined} className="space-y-3">
        <StepHead n={2} title="설치" state={steps.s2} />
        {steps.s2 === 'active' && (
          <div className="pl-[2.15rem] space-y-3">
            {installSlot ?? (
              <p className="text-[12px] text-white/55 leading-relaxed">
                따로 설치할 것은 없습니다. 한줄로가 {providerName}에서 데이터를 가져옵니다 — 첫 데이터가 들어오면 다음 단계가 켜집니다.
              </p>
            )}
            {onDeveloperSend && (
              <button
                type="button"
                onClick={onDeveloperSend}
                className="inline-flex items-center gap-1.5 text-[12px] text-white/55 hover:text-white/85 transition-colors"
              >
                <Send className="w-3.5 h-3.5" /> 개발자에게 설치 안내 보내기
              </button>
            )}
          </div>
        )}
        {steps.s2 === 'done' && <div className="pl-[2.15rem] text-[12px] text-emerald-300/80">설치 확인됨</div>}
      </section>

      {/* ③ 첫 데이터 확인 — 이 재설계의 심장. 옛 검증 탭이 여기로 흡수된다. */}
      <section aria-current={steps.s3 === 'active' ? 'step' : undefined} className="space-y-3">
        <StepHead n={3} title="첫 데이터 확인" state={steps.s3} />
        <div className="pl-[2.15rem]" aria-live="polite">
          {status.total > 0 ? (
            <div className="space-y-3">
              <div className="inline-flex items-center gap-1.5 text-[12px] text-emerald-300">
                <Check className="w-3.5 h-3.5" /> {status.label}
              </div>
              <div className="flex flex-wrap gap-1.5">
                {SIGNAL_LABEL.map(({ key, label }) => {
                  const on = !!signals?.[key];
                  return (
                    <span
                      key={key}
                      className={`inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded-full border ${on
                        ? 'bg-emerald-500/12 text-emerald-300 border-emerald-400/25'
                        : 'bg-white/[0.04] text-white/35 border-white/10'}`}
                    >
                      {on ? <Check className="w-3 h-3" /> : <Loader2 className="w-3 h-3" />} {label}
                    </span>
                  );
                })}
              </div>
            </div>
          ) : steps.s3 === 'locked' ? (
            <p className="text-[12px] text-white/35">앞 단계가 끝나면 자동으로 확인합니다.</p>
          ) : (
            <div className="space-y-3">
              <div className="inline-flex items-center gap-2 text-[12px] text-white/60">
                <Loader2 className="w-3.5 h-3.5 animate-spin text-violet-300" /> 첫 데이터를 기다리는 중입니다
              </div>
              {stalled && (
                <div className="rounded-xl border border-amber-400/25 bg-amber-500/[0.07] p-3.5 space-y-2">
                  <div className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-amber-200">
                    <HelpCircle className="w-3.5 h-3.5" /> 데이터가 안 들어오나요?
                  </div>
                  <ul className="text-[11.5px] text-white/55 leading-relaxed list-disc pl-4 space-y-0.5">
                    <li>설치한 페이지를 한 번 열어보셨나요 — 방문이 있어야 첫 데이터가 만들어집니다.</li>
                    <li>설치 코드가 모든 페이지에 들어갔는지 개발자에게 확인해 주세요.</li>
                    <li>쇼핑몰 도메인이 수집 허용 목록에 등록됐는지 확인해 주세요.</li>
                  </ul>
                  <div className="flex flex-wrap gap-3 pt-0.5">
                    {onRetryCheck && (
                      <button type="button" onClick={onRetryCheck} className="text-[12px] text-violet-200 hover:text-violet-100">
                        다시 확인하기
                      </button>
                    )}
                    {onDeveloperSend && (
                      <button type="button" onClick={onDeveloperSend} className="text-[12px] text-white/55 hover:text-white/85">
                        개발자에게 다시 보내기
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
