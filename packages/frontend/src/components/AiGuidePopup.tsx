import { useEffect, useState } from 'react';

const ACCENT = '#10b981'; // emerald — 한줄로 브랜드
const STORAGE_KEY = 'hanjul_ai_popup_dismiss_until';
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
    output: ['[브랜드] {{이름}}님, VVIP 봄 시즌 프리뷰에 모십니다.', '4/19(토) 14:00 본점 5F.', '회신 부탁드립니다.'],
  },
  {
    industry: '뷰티/패션',
    input: '최근 3개월 미방문 회원 신규 컬렉션 안내',
    output: ['{{이름}}님, 오랜만에 인사드립니다.', '신규 컬렉션을 가장 먼저 보여드릴게요.', '온라인 단독 혜택 포함.'],
  },
  {
    industry: 'F&B',
    input: '광주점 반경 5km 신규 가입 첫 구매 쿠폰',
    output: ['{{이름}}님, 광주점 첫 방문을 환영합니다.', '첫 구매 5,000원 쿠폰이 도착했어요.', '5월 31일까지.'],
  },
  {
    industry: '리테일',
    input: '주말 한정 신메뉴 출시 안내',
    output: ['이번 주말, 신메뉴가 도착합니다.', '{{이름}}님께만 먼저 알려드려요.', '토·일 한정.'],
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
    <div className="rounded-2xl border border-neutral-200/80 bg-neutral-50/60 p-4">
      {/* tabs */}
      <div className="flex items-center gap-1 mb-3">
        {SAMPLE_PROMPTS.map((s, i) => (
          <button
            key={s.industry}
            onClick={() => setIdx(i)}
            className={`px-2.5 py-1 text-[11px] rounded-full transition ${
              i === idx ? 'bg-neutral-900 text-white' : 'text-neutral-500 hover:text-neutral-900'
            }`}
          >{s.industry}</button>
        ))}
      </div>

      {/* input row */}
      <div className="flex items-start gap-3 px-3.5 py-3 rounded-xl bg-white border border-neutral-200/80">
        <span className="mt-0.5 text-[11px] font-mono text-neutral-400 select-none">in</span>
        <div className="flex-1 font-mono text-[13px] leading-relaxed text-neutral-800">
          {typedInput}{!inputDone && <span className="ai-popup-caret" />}
        </div>
      </div>

      {/* arrow */}
      <div className="flex items-center justify-center my-2.5 text-neutral-300">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M12 4v16m0 0l6-6m-6 6l-6-6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
      </div>

      {/* output */}
      <div className="px-3.5 py-3 rounded-xl bg-white border" style={{ borderColor: ACCENT + '40' }}>
        <div className="flex items-center gap-2 mb-2">
          <span className="text-[11px] font-mono select-none" style={{ color: ACCENT }}>out</span>
          <span className="inline-flex items-center gap-1 text-[10px] text-violet-600">
            <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l1.8 5.6L19 9l-5.2 1.4L12 16l-1.8-5.6L5 9l5.2-1.4L12 2z"/></svg>
            AI
          </span>
          {stage === 1 && (
            <span className="text-[11px] text-neutral-400 ml-1 inline-flex items-center gap-1">
              <span className="h-1.5 w-1.5 rounded-full bg-neutral-300 animate-pulse"></span>
              생성 중
            </span>
          )}
        </div>
        <div className="space-y-1.5 text-[13px] leading-relaxed text-neutral-800 min-h-[72px]">
          {sample.output.map((line, i) => (
            <div
              key={i}
              className={`transition-all duration-500 ${stage >= i + 2 ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-1'}`}
            >
              {line.split(/(\{\{[^}]+\}\})/g).map((seg, j) =>
                seg.startsWith('{{')
                  ? <span key={j} className="px-1 py-0.5 rounded font-mono text-[12px]" style={{ background: ACCENT + '15', color: ACCENT }}>{seg}</span>
                  : <span key={j}>{seg}</span>
              )}
            </div>
          ))}
        </div>
        <div className="mt-3 flex items-center justify-between text-[11px] text-neutral-400">
          <span>가나다 78자 · LMS</span>
          <span style={{ color: ACCENT }}>30초 · 발송 준비 완료</span>
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
      `}</style>

      <div className="fixed inset-0 z-[9998]">
        {/* backdrop */}
        <div className="absolute inset-0 bg-neutral-900/40 ai-popup-fade" onClick={close} />

        {/* modal */}
        <div className="absolute inset-0 flex items-center justify-center p-4 sm:p-6">
          <div
            className="ai-popup-in relative w-full max-w-[620px] bg-white rounded-2xl shadow-2xl ring-1 ring-neutral-900/5 overflow-hidden"
            role="dialog" aria-modal="true" aria-labelledby="ai-popup-title"
          >
            {/* close */}
            <button
              onClick={close}
              aria-label="닫기"
              className="absolute right-4 top-4 h-8 w-8 grid place-items-center rounded-full text-neutral-400 hover:text-neutral-900 hover:bg-neutral-100 transition"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/></svg>
            </button>

            <div className="px-7 sm:px-9 pt-9 pb-7">
              {/* eyebrow */}
              <div className="flex items-center gap-2 text-[11px] font-mono text-neutral-400 uppercase tracking-wider">
                <span>§ AI 활용 안내</span>
                <span className="inline-flex items-center gap-1 text-violet-600">
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l1.8 5.6L19 9l-5.2 1.4L12 16l-1.8-5.6L5 9l5.2-1.4L12 2z"/></svg>
                </span>
              </div>

              {/* headline — 단언형 */}
              <h2 id="ai-popup-title" className="mt-4 text-[28px] sm:text-[32px] leading-[1.18] font-semibold tracking-tight text-neutral-900" style={{ textWrap: 'balance' } as React.CSSProperties}>
                한 문장으로<br />
                마케팅 캠페인이 완성됩니다.
              </h2>

              {/* body — Live Demo */}
              <div className="mt-6">
                <LiveDemo />
              </div>

              {/* CTAs */}
              <div className="mt-7 flex flex-col gap-2.5">
                <a
                  href="/manual/ai-guide.html"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="group inline-flex items-center justify-between px-5 h-12 rounded-xl text-white text-[15px] font-medium transition shadow-[0_1px_0_rgba(255,255,255,0.15)_inset,0_4px_14px_rgba(16,185,129,0.25)] hover:shadow-[0_1px_0_rgba(255,255,255,0.15)_inset,0_8px_22px_rgba(16,185,129,0.32)]"
                  style={{ background: ACCENT }}
                >
                  <span>AI 활용 가이드 자세히 보기</span>
                  <span className="inline-block transition-transform group-hover:translate-x-0.5">→</span>
                </a>
                <a
                  href="https://hanjul.ai/manual/manual.html#ch1"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="group inline-flex items-center justify-between px-5 h-12 rounded-xl border border-neutral-200 text-[15px] font-medium text-neutral-700 hover:text-neutral-900 hover:border-neutral-300 transition bg-white"
                >
                  <span>사용자 매뉴얼 바로가기</span>
                  <span className="inline-block transition-transform group-hover:translate-x-0.5">→</span>
                </a>
              </div>

              {/* footer row */}
              <div className="mt-5 flex items-center justify-between">
                <label className="inline-flex items-center gap-2 text-[13px] text-neutral-500 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    className="h-4 w-4 rounded border-neutral-300 text-emerald-500 focus:ring-emerald-500"
                    checked={dontShow}
                    onChange={(e) => setDontShow(e.target.checked)}
                  />
                  오늘 하루 보지 않기
                </label>
                <button onClick={close} className="text-[13px] text-neutral-400 hover:text-neutral-700 transition">
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
