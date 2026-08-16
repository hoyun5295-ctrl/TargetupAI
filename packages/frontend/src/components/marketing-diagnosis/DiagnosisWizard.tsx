/**
 * DiagnosisWizard — AI 마케팅 진단 문진 (2026-08-16 신설 · 설계서 §5-3)
 *
 * 1소스: 퍼널 A(대시보드 모달 셸)·퍼널 B(공개 페이지 셸)가 같은 위저드를 쓴다.
 * 문항 정의는 서버 단일(GET /api/public/marketing-diagnosis/questions) — 여기엔 문항 상수가 없다.
 *
 * UX 계약(§5-3 · 1클릭 원칙)
 *   - 한 화면 1문항 · 선택 즉시 220ms 후 자동 전환([다음] 버튼 없음)
 *   - 지난 답은 칩 줄로 — 칩 클릭 = 그 문항으로 복귀해 수정
 *   - 진행바 + "남은 질문 N개" · 업종만 8칩 그리드, 나머지는 세로 선택지
 *   - aria-live로 문항 전환 안내 · 모바일 탭 타깃 56px · prefers-reduced-motion 존중
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Activity, Check } from 'lucide-react';
import type { DiagnosisQuestionDto } from './diagnosisApi';

interface Props {
  questions: DiagnosisQuestionDto[];
  /** 전 문항 응답 완료 — answers = { 문항 key: 선택지 key } */
  onFinished: (answers: Record<string, string>) => void;
  /** 제출 중 — 마지막 문항 이후 입력을 잠근다(5초+ 작업 차단 원칙은 셸의 오버레이가 담당) */
  busy?: boolean;
}

export default function DiagnosisWizard({ questions, onFinished, busy = false }: Props) {
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [index, setIndex] = useState(0);
  const [leaving, setLeaving] = useState(false);
  const timerRef = useRef<number | null>(null);
  const reduceMotion = useMemo(
    () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches,
    [],
  );

  useEffect(() => () => { if (timerRef.current) window.clearTimeout(timerRef.current); }, []);

  const current = questions[index];
  const remaining = questions.length - index - 1;
  const progress = Math.round((index / Math.max(1, questions.length)) * 100);

  const pick = (optionKey: string) => {
    if (busy || leaving || !current) return;
    const next = { ...answers, [current.key]: optionKey };
    setAnswers(next);

    const advance = () => {
      setLeaving(false);
      if (index + 1 >= questions.length) {
        onFinished(next);
      } else {
        setIndex(index + 1);
      }
    };
    if (reduceMotion) {
      advance();
    } else {
      setLeaving(true);
      timerRef.current = window.setTimeout(advance, 220);
    }
  };

  const jumpTo = (qIndex: number) => {
    if (busy || qIndex >= index) return;
    setIndex(qIndex);
  };

  if (!current) return null;
  const isGrid = current.type === 'industry_grid';

  return (
    <div className="flex flex-col gap-5 break-keep">
      {/* 진행바 + 남은 문항 */}
      <div>
        <div className="flex items-center justify-between text-xs text-white/50">
          <span className="inline-flex items-center gap-1.5">
            <Activity className="h-3.5 w-3.5 text-sky-400" aria-hidden />
            AI 마케팅 진단
          </span>
          <span>{remaining > 0 ? `남은 질문 ${remaining}개` : '마지막 질문이에요'}</span>
        </div>
        <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-white/10" aria-hidden>
          <div
            className="h-full rounded-full bg-gradient-to-r from-sky-400 to-indigo-500 transition-all duration-300"
            style={{ width: `${Math.max(6, progress)}%` }}
          />
        </div>
      </div>

      {/* 지난 답 칩 줄 — 클릭 = 그 문항으로 복귀 */}
      {index > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {questions.slice(0, index).map((q, i) => {
            const opt = q.options.find((o) => o.key === answers[q.key]);
            if (!opt) return null;
            return (
              <button
                key={q.key}
                type="button"
                onClick={() => jumpTo(i)}
                className="inline-flex items-center gap-1 rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[11px] text-white/60 transition-colors hover:border-sky-400/40 hover:text-white"
                title={q.text}
              >
                <Check className="h-3 w-3 text-sky-400" aria-hidden />
                {opt.label}
              </button>
            );
          })}
        </div>
      )}

      {/* 문항 — 220ms 슬라이드+페이드 */}
      <div
        key={current.key}
        aria-live="polite"
        className={`transition-all duration-200 ${leaving ? 'translate-x-3 opacity-0' : 'translate-x-0 opacity-100'} ${reduceMotion ? 'transition-none' : ''}`}
      >
        <h3 className="text-lg font-bold tracking-tight text-white md:text-xl">{current.text}</h3>

        <div className={`mt-4 ${isGrid ? 'grid grid-cols-2 gap-2 sm:grid-cols-4' : 'flex flex-col gap-2'}`}>
          {current.options.map((o) => {
            const selected = answers[current.key] === o.key;
            return (
              <button
                key={o.key}
                type="button"
                disabled={busy}
                onClick={() => pick(o.key)}
                className={`min-h-[56px] rounded-xl border px-4 text-left transition-all active:scale-[0.99] disabled:opacity-60 ${
                  isGrid ? 'text-center text-sm font-semibold' : 'text-[15px] font-medium'
                } ${
                  selected
                    ? 'border-sky-400/60 bg-sky-500/15 text-white shadow-[0_0_0_1px_rgba(56,189,248,0.35)]'
                    : 'border-white/10 bg-white/5 text-white/85 hover:border-sky-400/40 hover:bg-white/10'
                }`}
              >
                {o.label}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
