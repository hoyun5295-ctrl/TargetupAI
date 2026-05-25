/**
 * AiGuidePopup.tsx — 새로운 한줄로 AI Operator 미리보기 팝업 (D217+ 2026-05-25)
 *
 * 옛 영역 = 라이트 톤 + "AI 활용 안내" → 정정 = 다크 톤 + violet 액센트 + "곧 출시될 AI Operator 미리보기".
 * 상세보기 CTA → 새 탭 안 /about-ai-operator.html 전체 화면 진입.
 * 영업 문의 → HTML 안 CTA → /pricing?openContactModal=true 자동 모달 열기.
 *
 * 영구 룰 정합:
 * - 다크 톤 + violet 액센트 (Journey Builder 동급)
 * - 모델명 노출 0건 (Opus/Sonnet/GPT/Claude/Anthropic 단어 X)
 * - native dialog 0건 (alert/confirm/prompt X — 모달 영역만)
 * - 박-단어 0건
 * - localStorage dismiss 24h (옛 키 영역 새 영역 = 모든 사용자 1회 노출 정합)
 */

import { useEffect, useState } from 'react';

const STORAGE_KEY = 'hanjul_ai_operator_preview_popup_dismiss_until';
const DISMISS_DURATION_MS = 24 * 60 * 60 * 1000; // 24시간

interface PackageResult {
  targetLabel: string;
  targetCount: string;
  channel: string;
  channelNote: string;
  schedule: string;
  scheduleNote: string;
  cost: string;
  costNote: string;
  compliance: string[];
}

interface Sample {
  industry: string;
  input: string;
  output: string[];
  pkg: PackageResult;
}

const SAMPLE_PROMPTS: Sample[] = [
  {
    industry: '백화점',
    input: 'VVIP 등급 고객 대상 봄 시즌 프리뷰 초대',
    output: [
      '[브랜드] {{이름}}님, VVIP 봄 시즌 프리뷰에 모십니다.',
      '4/19(토) 14:00 본점 5F.',
      '회신 부탁드립니다.',
    ],
    pkg: {
      targetLabel: 'VVIP 등급 + 옛 90일 구매',
      targetCount: '1,247명',
      channel: '알림톡',
      channelNote: 'SMS 자동 폴백',
      schedule: '화요일 11:00',
      scheduleNote: '회사 누적 학습 기반',
      cost: '24,940원',
      costNote: '평균 클릭률 18% 예상',
      compliance: ['정보통신망법 통과', '카카오 검수 통과', '발송 시간대 정합'],
    },
  },
  {
    industry: '뷰티/패션',
    input: '최근 3개월 미방문 회원 신규 컬렉션 안내',
    output: [
      '{{이름}}님, 오랜만에 인사드립니다.',
      '신규 컬렉션을 가장 먼저 보여드릴게요.',
      '온라인 단독 혜택 포함.',
    ],
    pkg: {
      targetLabel: '90일+ 미방문 + 직전 구매 5만원+',
      targetCount: '3,420명',
      channel: 'LMS',
      channelNote: '광고 prefix 자동',
      schedule: '목요일 19:00',
      scheduleNote: '휴면 회수 최적 시점',
      cost: '102,600원',
      costNote: '평균 클릭률 12% 예상',
      compliance: ['정보통신망법 통과', '광고 prefix 자동', '080 무료거부 자동'],
    },
  },
  {
    industry: 'F&B',
    input: '광주점 반경 5km 신규 가입 첫 구매 쿠폰',
    output: [
      '{{이름}}님, 광주점 첫 방문을 환영합니다.',
      '첫 구매 5,000원 쿠폰이 도착했어요.',
      '5월 31일까지.',
    ],
    pkg: {
      targetLabel: '광주점 반경 5km + 옛 7일 가입',
      targetCount: '482명',
      channel: 'SMS',
      channelNote: '단문 영역 최적',
      schedule: '금요일 17:00',
      scheduleNote: '주말 매장 방문 유도',
      cost: '9,640원',
      costNote: '평균 클릭률 22% 예상',
      compliance: ['정보통신망법 통과', '발신번호 검증', '발송 시간대 정합'],
    },
  },
  {
    industry: '리테일',
    input: '주말 한정 신메뉴 출시 안내',
    output: [
      '이번 주말, 신메뉴가 도착합니다.',
      '{{이름}}님께만 먼저 알려드려요.',
      '토·일 한정.',
    ],
    pkg: {
      targetLabel: '신메뉴 카테고리 옛 30일 구매',
      targetCount: '2,180명',
      channel: '알림톡',
      channelNote: 'MMS 폴백 (이미지)',
      schedule: '금요일 18:00',
      scheduleNote: '주말 방문 유도 최적',
      cost: '43,600원',
      costNote: '평균 클릭률 15% 예상',
      compliance: ['정보통신망법 통과', '카카오 검수 통과', '이미지 검증 통과'],
    },
  },
];

// 6 sub-agent 매트릭스 (Journey Builder 정합 — 700ms 간격 시각 효과)
const SUB_AGENTS = [
  { label: 'Trigger', color: 'rose',     hint: '의도 분석' },
  { label: 'Target',  color: 'amber',    hint: '타겟 매칭' },
  { label: 'Memory',  color: 'emerald',  hint: '회사 학습' },
  { label: 'Flow',    color: 'cyan',     hint: '흐름 설계' },
  { label: 'Message', color: 'violet',   hint: '본문 작성' },
  { label: 'Review',  color: 'fuchsia',  hint: '검토 준비' },
] as const;

const SUB_AGENT_DOT: Record<string, string> = {
  rose:    'bg-rose-400',
  amber:   'bg-amber-400',
  emerald: 'bg-emerald-400',
  cyan:    'bg-cyan-400',
  violet:  'bg-violet-400',
  fuchsia: 'bg-fuchsia-400',
};

const SUB_AGENT_BORDER: Record<string, string> = {
  rose:    'border-rose-400/50',
  amber:   'border-amber-400/50',
  emerald: 'border-emerald-400/50',
  cyan:    'border-cyan-400/50',
  violet:  'border-violet-400/50',
  fuchsia: 'border-fuchsia-400/50',
};

function useTypewriter(text: string, speed = 18, startDelay = 0): [string, boolean] {
  const [out, setOut] = useState('');
  const [done, setDone] = useState(false);
  useEffect(() => {
    setOut(''); setDone(false);
    let i = 0;
    let timer: ReturnType<typeof setInterval> | null = null;
    const start = setTimeout(() => {
      timer = setInterval(() => {
        i += 1;
        setOut(text.slice(0, i));
        if (i >= text.length) { if (timer) clearInterval(timer); setDone(true); }
      }, speed);
    }, startDelay);
    return () => { clearTimeout(start); if (timer) clearInterval(timer); };
  }, [text, speed, startDelay]);
  return [out, done];
}

function LiveDemo() {
  const [idx, setIdx] = useState(0);
  const sample = SAMPLE_PROMPTS[idx];

  const [typedInput, inputDone] = useTypewriter(sample.input, 28, 280);

  // ★ D217+ fix (2026-05-25 Harold 격분 정정): 옛 메시지 영역만 노출 사고 정정
  //   stage 0 = 초기 / stage 1~6 = 6 sub-agent 순차 활성 / stage 7 = 통합 패키지 결과 / stage 8 = 메시지 영역
  const [stage, setStage] = useState(0);
  useEffect(() => { setStage(0); }, [idx]);
  useEffect(() => {
    if (!inputDone) return;
    const timers: ReturnType<typeof setTimeout>[] = [];
    // 6 sub-agent 순차 활성 (300ms 간격)
    for (let i = 1; i <= 6; i++) {
      timers.push(setTimeout(() => setStage(i), 200 + i * 280));
    }
    // 통합 패키지 결과 fade-in
    timers.push(setTimeout(() => setStage(7), 2300));
    // 메시지 영역 fade-in
    timers.push(setTimeout(() => setStage(8), 2700));
    // 다음 시나리오 자동 진입
    timers.push(setTimeout(() => {
      setIdx((i) => (i + 1) % SAMPLE_PROMPTS.length);
    }, 8400));
    return () => timers.forEach(clearTimeout);
  }, [inputDone, idx]);

  return (
    <div className="rounded-2xl border border-white/10 bg-slate-950/60 p-4">
      {/* tabs */}
      <div className="flex items-center gap-1 mb-3 flex-wrap">
        {SAMPLE_PROMPTS.map((s, i) => (
          <button
            key={s.industry}
            onClick={() => setIdx(i)}
            className={`px-2.5 py-1 text-[11px] rounded-full transition ${
              i === idx
                ? 'bg-gradient-to-r from-violet-500 to-fuchsia-500 text-white font-medium'
                : 'text-white/50 hover:text-white hover:bg-white/5'
            }`}
          >
            {s.industry}
          </button>
        ))}
      </div>

      {/* input row */}
      <div className="flex items-start gap-3 px-3.5 py-3 rounded-xl bg-white/5 border border-white/10">
        <span className="mt-0.5 text-[11px] font-mono text-white/40 select-none">in</span>
        <div className="flex-1 font-mono text-[13px] leading-relaxed text-white/90">
          {typedInput}{!inputDone && <span className="ai-popup-caret" />}
        </div>
      </div>

      {/* 6 sub-agent 진행 영역 (700ms 간격 시각 효과 — Journey Builder 정합) */}
      <div className="mt-2.5 grid grid-cols-6 gap-1">
        {SUB_AGENTS.map((agent, i) => {
          const active = stage >= i + 1;
          const dotClass = SUB_AGENT_DOT[agent.color];
          const borderClass = active ? SUB_AGENT_BORDER[agent.color] : 'border-white/10';
          return (
            <div
              key={agent.label}
              className={`px-1.5 py-2 rounded-lg border bg-white/[0.03] transition-all duration-300 ${borderClass} ${active ? 'opacity-100' : 'opacity-30'}`}
            >
              <div className="flex items-center gap-1 justify-center">
                <span className={`h-1.5 w-1.5 rounded-full ${dotClass} ${active && stage === i + 1 ? 'animate-pulse' : ''}`}></span>
                <span className="text-[9px] font-mono text-white/70 truncate">{agent.label}</span>
              </div>
              <div className="text-[9px] text-center text-white/40 mt-0.5 truncate">{agent.hint}</div>
            </div>
          );
        })}
      </div>

      {/* arrow */}
      <div className="flex items-center justify-center my-2 text-white/30">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
          <path d="M12 4v16m0 0l6-6m-6 6l-6-6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>

      {/* 통합 패키지 결과 영역 (fade-in) */}
      <div
        className={`rounded-xl bg-gradient-to-br from-violet-500/[0.08] via-fuchsia-500/[0.04] to-violet-500/[0.06] border border-violet-400/30 transition-all duration-500 ${
          stage >= 7 ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-2'
        }`}
      >
        {/* 헤더 */}
        <div className="px-3.5 pt-2.5 pb-2 flex items-center gap-2 border-b border-white/10">
          <span className="text-[10px] font-mono text-violet-300 select-none">out</span>
          <span className="inline-flex items-center gap-1 text-[10px] text-fuchsia-300 font-bold">
            <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 2l1.8 5.6L19 9l-5.2 1.4L12 16l-1.8-5.6L5 9l5.2-1.4L12 2z" />
            </svg>
            통합 마케팅 패키지
          </span>
          <span className="ml-auto text-[10px] text-emerald-300 font-medium">5초 · 완성</span>
        </div>

        {/* 4 카드 그리드 — 타겟 + 채널 + 시점 + 비용 */}
        <div className="px-3 py-2.5 grid grid-cols-2 sm:grid-cols-4 gap-1.5">
          {/* 타겟 */}
          <div className="px-2 py-1.5 rounded-md bg-white/5 border border-amber-400/30">
            <div className="text-[9px] text-amber-300 font-bold mb-0.5 tracking-wide">TARGET</div>
            <div className="text-[13px] text-white font-bold leading-tight">{sample.pkg.targetCount}</div>
            <div className="text-[9px] text-white/50 mt-0.5 truncate" title={sample.pkg.targetLabel}>{sample.pkg.targetLabel}</div>
          </div>
          {/* 채널 */}
          <div className="px-2 py-1.5 rounded-md bg-white/5 border border-sky-400/30">
            <div className="text-[9px] text-sky-300 font-bold mb-0.5 tracking-wide">CHANNEL</div>
            <div className="text-[13px] text-white font-bold leading-tight">{sample.pkg.channel}</div>
            <div className="text-[9px] text-white/50 mt-0.5 truncate" title={sample.pkg.channelNote}>{sample.pkg.channelNote}</div>
          </div>
          {/* 시점 */}
          <div className="px-2 py-1.5 rounded-md bg-white/5 border border-cyan-400/30">
            <div className="text-[9px] text-cyan-300 font-bold mb-0.5 tracking-wide">SCHEDULE</div>
            <div className="text-[13px] text-white font-bold leading-tight">{sample.pkg.schedule}</div>
            <div className="text-[9px] text-white/50 mt-0.5 truncate" title={sample.pkg.scheduleNote}>{sample.pkg.scheduleNote}</div>
          </div>
          {/* 비용 */}
          <div className="px-2 py-1.5 rounded-md bg-white/5 border border-emerald-400/30">
            <div className="text-[9px] text-emerald-300 font-bold mb-0.5 tracking-wide">COST</div>
            <div className="text-[13px] text-white font-bold leading-tight">{sample.pkg.cost}</div>
            <div className="text-[9px] text-white/50 mt-0.5 truncate" title={sample.pkg.costNote}>{sample.pkg.costNote}</div>
          </div>
        </div>

        {/* 메시지 미리보기 — fade-in */}
        <div
          className={`mx-3 mb-2.5 px-3 py-2.5 rounded-md bg-slate-950/40 border border-white/10 transition-all duration-500 ${
            stage >= 8 ? 'opacity-100' : 'opacity-0'
          }`}
        >
          <div className="text-[9px] text-violet-300 font-bold mb-1 tracking-wide">MESSAGE</div>
          <div className="space-y-1 text-[12px] leading-relaxed text-white/90">
            {sample.output.map((line, i) => (
              <div key={i}>
                {line.split(/(\{\{[^}]+\}\})/g).map((seg, j) =>
                  seg.startsWith('{{')
                    ? <span key={j} className="px-1 py-0.5 rounded font-mono text-[11px] bg-violet-500/20 text-violet-200">{seg}</span>
                    : <span key={j}>{seg}</span>
                )}
              </div>
            ))}
          </div>
          <div className="mt-2 pt-1.5 border-t border-white/5 flex items-center justify-between text-[10px] text-white/40">
            <span>가나다 78자 · LMS</span>
            <span className="text-emerald-300">발송 준비 완료</span>
          </div>
        </div>

        {/* 컴플라이언스 chip 영역 */}
        <div
          className={`px-3 pb-2.5 flex items-center gap-1 flex-wrap transition-all duration-500 ${
            stage >= 8 ? 'opacity-100' : 'opacity-0'
          }`}
        >
          {sample.pkg.compliance.map((c) => (
            <span
              key={c}
              className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[9px] bg-emerald-500/10 border border-emerald-400/30 text-emerald-200"
            >
              <svg width="8" height="8" viewBox="0 0 24 24" fill="none">
                <path d="M5 12l5 5L20 7" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              {c}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

interface ModalProps { onClose: () => void }

function Modal({ onClose }: ModalProps) {
  const [dontShow, setDontShow] = useState(false);

  function close() {
    if (dontShow) {
      const until = Date.now() + DISMISS_DURATION_MS;
      try { localStorage.setItem(STORAGE_KEY, String(until)); } catch (_) { /* noop */ }
    }
    onClose();
  }

  // ESC 키로 닫기
  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') close(); }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  return (
    <>
      <style>{`
        @keyframes aiPopupFadeIn { from { opacity: 0 } to { opacity: 1 } }
        @keyframes aiPopupModalIn {
          from { opacity: 0; transform: translateY(16px) scale(0.985); }
          to   { opacity: 1; transform: translateY(0)    scale(1); }
        }
        @keyframes aiPopupBlink { 0%, 49% { opacity: 1 } 50%, 100% { opacity: 0 } }
        .ai-popup-fade  { animation: aiPopupFadeIn 220ms ease-out both; }
        .ai-popup-in    { animation: aiPopupModalIn 320ms cubic-bezier(.2,.7,.2,1) both; }
        .ai-popup-caret { display: inline-block; width: 2px; height: 1em; background: currentColor; vertical-align: -2px; margin-left: 2px; animation: aiPopupBlink 1s step-end infinite; }
        @keyframes aiPopupGlowPulse {
          0%, 100% { box-shadow: 0 0 24px rgba(167, 139, 250, 0.3); }
          50% { box-shadow: 0 0 40px rgba(217, 70, 239, 0.5); }
        }
        .ai-popup-glow { animation: aiPopupGlowPulse 2.4s ease-in-out infinite; }
      `}</style>

      <div className="fixed inset-0 z-[9998]">
        {/* backdrop — 다크 톤 */}
        <div className="absolute inset-0 bg-black/70 backdrop-blur-sm ai-popup-fade" onClick={close} />

        {/* modal */}
        <div className="absolute inset-0 flex items-center justify-center p-4 sm:p-6 overflow-y-auto">
          <div
            className="ai-popup-in relative w-full max-w-[760px] bg-gradient-to-br from-slate-900 via-slate-900 to-slate-950 border border-white/10 rounded-2xl shadow-2xl overflow-hidden my-auto"
            role="dialog" aria-modal="true" aria-labelledby="ai-operator-preview-title"
          >
            {/* 상단 배경 글로우 영역 */}
            <div
              className="absolute -top-32 -right-32 w-64 h-64 rounded-full blur-3xl pointer-events-none"
              style={{ background: 'radial-gradient(circle, rgba(167,139,250,0.25) 0%, transparent 70%)' }}
            />
            <div
              className="absolute -bottom-32 -left-32 w-64 h-64 rounded-full blur-3xl pointer-events-none"
              style={{ background: 'radial-gradient(circle, rgba(217,70,239,0.20) 0%, transparent 70%)' }}
            />

            {/* close */}
            <button
              onClick={close}
              aria-label="닫기"
              className="absolute right-4 top-4 h-8 w-8 grid place-items-center rounded-full text-white/40 hover:text-white hover:bg-white/10 transition z-10"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
              </svg>
            </button>

            <div className="relative px-7 sm:px-9 pt-9 pb-7">
              {/* eyebrow — BETA chip */}
              <div className="flex items-center gap-2 flex-wrap">
                <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-violet-500/15 border border-violet-400/40 text-[11px] font-bold text-violet-200">
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M12 2l1.8 5.6L19 9l-5.2 1.4L12 16l-1.8-5.6L5 9l5.2-1.4L12 2z" />
                  </svg>
                  AI Operator · BETA
                </span>
                <span className="text-[11px] text-white/40">곧 만나실 새로운 한줄로</span>
              </div>

              {/* headline */}
              <h2
                id="ai-operator-preview-title"
                className="mt-5 text-[28px] sm:text-[34px] leading-[1.15] font-bold tracking-tight text-white"
                style={{ textWrap: 'balance' } as React.CSSProperties}
              >
                자연어 한 줄로
                <br />
                <span className="bg-gradient-to-r from-violet-300 to-fuchsia-300 bg-clip-text text-transparent">
                  마케팅 전체를 운영합니다.
                </span>
              </h2>
              <p className="mt-3 text-[14px] leading-relaxed text-white/60">
                지금까지의 한줄로와 완전히 다릅니다.
                <br />
                AI Operator가 타겟·메시지·채널·시점·비용·컴플라이언스를 한 번에 설계합니다.
              </p>

              {/* body — Live Demo */}
              <div className="mt-6">
                <LiveDemo />
              </div>

              {/* CTAs */}
              <div className="mt-7 flex flex-col gap-2.5">
                <a
                  href="/about-ai-operator.html"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="group ai-popup-glow inline-flex items-center justify-between px-5 h-12 rounded-xl text-white text-[15px] font-bold transition bg-gradient-to-r from-violet-500 to-fuchsia-500 hover:from-violet-400 hover:to-fuchsia-400"
                >
                  <span className="inline-flex items-center gap-2">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M12 2l1.8 5.6L19 9l-5.2 1.4L12 16l-1.8-5.6L5 9l5.2-1.4L12 2z" />
                    </svg>
                    전체 화면으로 상세 보기
                  </span>
                  <span className="inline-block transition-transform group-hover:translate-x-1">→</span>
                </a>
              </div>

              {/* 4 핵심 가치 미니 칩 */}
              <div className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-1.5">
                {[
                  { label: '자연어 진입', color: 'violet' },
                  { label: '6 AI 협업', color: 'fuchsia' },
                  { label: '한국 native', color: 'emerald' },
                  { label: '사용자 승인 흐름', color: 'amber' },
                ].map((v) => (
                  <div
                    key={v.label}
                    className="inline-flex items-center justify-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-white/5 border border-white/10 text-[11px] text-white/70"
                  >
                    <span className={`h-1.5 w-1.5 rounded-full bg-${v.color}-400`}></span>
                    {v.label}
                  </div>
                ))}
              </div>

              {/* footer row */}
              <div className="mt-5 flex items-center justify-between">
                <label className="inline-flex items-center gap-2 text-[13px] text-white/50 cursor-pointer select-none hover:text-white/70 transition">
                  <input
                    type="checkbox"
                    className="h-4 w-4 rounded border-white/20 bg-slate-800 text-violet-500 focus:ring-violet-500 focus:ring-offset-slate-900"
                    checked={dontShow}
                    onChange={(e) => setDontShow(e.target.checked)}
                  />
                  오늘 하루 보지 않기
                </label>
                <button onClick={close} className="text-[13px] text-white/40 hover:text-white/80 transition">
                  나중에 보기
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

export default function AiGuidePopup() {
  const [open, setOpen] = useState<boolean>(() => {
    try {
      const v = parseInt(localStorage.getItem(STORAGE_KEY) || '0', 10);
      return !(v && v > Date.now());
    } catch (_) {
      return true;
    }
  });

  if (!open) return null;
  return <Modal onClose={() => setOpen(false)} />;
}
