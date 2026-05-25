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

interface Sample {
  industry: string;
  input: string;
  output: string[];
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
  },
  {
    industry: '뷰티/패션',
    input: '최근 3개월 미방문 회원 신규 컬렉션 안내',
    output: [
      '{{이름}}님, 오랜만에 인사드립니다.',
      '신규 컬렉션을 가장 먼저 보여드릴게요.',
      '온라인 단독 혜택 포함.',
    ],
  },
  {
    industry: 'F&B',
    input: '광주점 반경 5km 신규 가입 첫 구매 쿠폰',
    output: [
      '{{이름}}님, 광주점 첫 방문을 환영합니다.',
      '첫 구매 5,000원 쿠폰이 도착했어요.',
      '5월 31일까지.',
    ],
  },
  {
    industry: '리테일',
    input: '주말 한정 신메뉴 출시 안내',
    output: [
      '이번 주말, 신메뉴가 도착합니다.',
      '{{이름}}님께만 먼저 알려드려요.',
      '토·일 한정.',
    ],
  },
];

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

  const [stage, setStage] = useState(0);
  useEffect(() => { setStage(0); }, [idx]);
  useEffect(() => {
    if (!inputDone) return;
    const timers: ReturnType<typeof setTimeout>[] = [];
    timers.push(setTimeout(() => setStage(1), 300));
    timers.push(setTimeout(() => setStage(2), 1100));
    timers.push(setTimeout(() => setStage(3), 1700));
    timers.push(setTimeout(() => setStage(4), 2300));
    timers.push(setTimeout(() => {
      setIdx((i) => (i + 1) % SAMPLE_PROMPTS.length);
    }, 5400));
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

      {/* arrow */}
      <div className="flex items-center justify-center my-2.5 text-white/30">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
          <path d="M12 4v16m0 0l6-6m-6 6l-6-6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>

      {/* output */}
      <div className="px-3.5 py-3 rounded-xl bg-white/5 border border-violet-400/30">
        <div className="flex items-center gap-2 mb-2">
          <span className="text-[11px] font-mono text-violet-300 select-none">out</span>
          <span className="inline-flex items-center gap-1 text-[10px] text-fuchsia-300">
            <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 2l1.8 5.6L19 9l-5.2 1.4L12 16l-1.8-5.6L5 9l5.2-1.4L12 2z" />
            </svg>
            AI
          </span>
          {stage === 1 && (
            <span className="text-[11px] text-white/40 ml-1 inline-flex items-center gap-1">
              <span className="h-1.5 w-1.5 rounded-full bg-violet-300 animate-pulse"></span>
              생성 중
            </span>
          )}
        </div>
        <div className="space-y-1.5 text-[13px] leading-relaxed text-white/90 min-h-[72px]">
          {sample.output.map((line, i) => (
            <div
              key={i}
              className={`transition-all duration-500 ${stage >= i + 2 ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-1'}`}
            >
              {line.split(/(\{\{[^}]+\}\})/g).map((seg, j) =>
                seg.startsWith('{{')
                  ? <span key={j} className="px-1 py-0.5 rounded font-mono text-[12px] bg-violet-500/20 text-violet-200">{seg}</span>
                  : <span key={j}>{seg}</span>
              )}
            </div>
          ))}
        </div>
        <div className="mt-3 flex items-center justify-between text-[11px] text-white/40">
          <span>가나다 78자 · LMS</span>
          <span className="text-emerald-300">30초 · 발송 준비 완료</span>
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
            className="ai-popup-in relative w-full max-w-[680px] bg-gradient-to-br from-slate-900 via-slate-900 to-slate-950 border border-white/10 rounded-2xl shadow-2xl overflow-hidden my-auto"
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
