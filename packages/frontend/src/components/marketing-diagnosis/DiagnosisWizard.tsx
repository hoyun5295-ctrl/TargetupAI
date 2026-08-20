/**
 * DiagnosisWizard — AI 마케팅 진단 문진 (2026-08-16 신설 · v3 분기형 전면 개편)
 *
 * 1소스: 퍼널 A(대시보드 모달 셸)·퍼널 B(공개 페이지 셸)가 같은 위저드를 쓴다.
 * 문항·분기·섹션·카피는 서버 questions 응답(seed)이 소유 — 여기엔 문항 상수가 없다.
 *
 * v3 계약 (브레인스토밍 수렴)
 *   - 분기: show_when(같은 섹션 · 앞 게이트 1개 참조)을 위저드가 해석. 커서는 index가 아니라 문항 key.
 *   - 게이트 답을 바꾸면 닫힌 분기의 답은 즉시 제거(pruneAnswers 고정점) — 고아 답 제출 = 서버 400.
 *     지운 답은 stash에 보관해 같은 게이트 답으로 돌아오면 복원한다(다시 안 묻는다).
 *   - 진행 = 섹션 도트(개수 고정 — 분기는 섹션 안에서만) + 섹션 내 얇은 바(래칫 — 역주행 금지).
 *     "남은 질문 N개" 폐기(분기형에서 거짓말이 된다).
 *   - 섹션 경계 = 되읽기 + 다음 예고 통합 1화면([계속] 탭 전용 · 첫 경계는 생략 — 전면 개입 총 2~3회 상한).
 *   - 선택지 = 라벨 + 보조설명(hint) 2단. hint는 안심 카피 — 리포트에 인용되지 않는다.
 *   - 실측 선치환(prefilled): 그 문항은 묻지 않고 분기 판정에만 쓴다. 제출 payload에서도 제외(서버가 재계산).
 *   - 드래프트: sessionStorage(버전 키) 저장 + 재진입 시 이어하기 배너. 서버 저장 없음(동의 전 개인정보 0).
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Activity, ArrowRight, Check, RotateCcw, Sparkles } from 'lucide-react';
import type { DiagnosisEchoesDto, DiagnosisQuestionDto, DiagnosisSectionDto } from './diagnosisApi';
// 분기 판정 CT — 서버 visibleQuestions와 같은 규칙. 계약 테스트가 실 seed로 두 판정을 대조한다.
import { visiblePath, pruneAnswers } from '../../utils/diagnosis-branch';

interface Props {
  questions: DiagnosisQuestionDto[];
  sections?: DiagnosisSectionDto[] | null;
  /** 서버 실측 선치환 — {문항 key: 선택지 key}. 화면 안내용 · 제출 시 서버가 재계산. */
  prefilled?: Record<string, string>;
  /** sessionStorage 드래프트 키(버전 포함). null/미지정 = 드래프트 비활성. */
  draftKey?: string | null;
  /**
   * v10 — 섹션 경계 즉석 소견(서버 questions 응답 동봉). 화면은 tone을 고르기만 한다 —
   * 판정은 서버 원장이 소유(리포트와 같은 문장이라 최종 결과와 어긋나지 않는다).
   */
  echoes?: DiagnosisEchoesDto | null;
  /** 완주 — answers = 사용자가 실제 답한 것만(선치환 제외) */
  onFinished: (answers: Record<string, string>) => void;
  busy?: boolean;
}

type View =
  | { kind: 'question' }
  | { kind: 'interstitial'; doneSectionKey: string; nextKey: string };

export default function DiagnosisWizard({
  questions, sections = null, prefilled = {}, draftKey = null, echoes = null, onFinished, busy = false,
}: Props) {
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [cursorKey, setCursorKey] = useState<string | null>(null);
  const [view, setView] = useState<View>({ kind: 'question' });
  const [leaving, setLeaving] = useState(false);
  const [showAllChips, setShowAllChips] = useState(false);
  const [resumeDraft, setResumeDraft] = useState<Record<string, string> | null>(null);
  const stashRef = useRef<Record<string, string>>({});
  const timerRef = useRef<number | null>(null);
  const maxSectionIdxRef = useRef(0);
  const sectionRatioRef = useRef<Record<string, number>>({});
  const reduceMotion = useMemo(
    () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches,
    [],
  );

  const sectionList = sections && sections.length > 0 ? sections : null;

  // 선치환 병합 답(분기 판정·표시용) — 제출 payload에는 answers만 나간다
  const effAnswers = useMemo(() => ({ ...prefilled, ...answers }), [prefilled, answers]);
  const path = useMemo(() => visiblePath(questions, effAnswers), [questions, effAnswers]);
  /** 실제로 묻는 문항(선치환 제외) */
  const askable = useMemo(() => path.filter((q) => prefilled[q.key] === undefined), [path, prefilled]);

  const firstUnanswered = askable.find((q) => answers[q.key] === undefined) ?? null;
  const current =
    (cursorKey ? askable.find((q) => q.key === cursorKey) : null) ?? firstUnanswered;

  // 드래프트 — 저장
  useEffect(() => {
    if (!draftKey) return;
    try {
      if (Object.keys(answers).length > 0) {
        sessionStorage.setItem(draftKey, JSON.stringify({ answers }));
      }
    } catch { /* 저장 실패는 무해 — 드래프트는 편의 기능 */ }
  }, [answers, draftKey]);

  // 드래프트 — 재진입 배너(답이 하나도 없을 때만)
  useEffect(() => {
    if (!draftKey) return;
    try {
      const raw = sessionStorage.getItem(draftKey);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (parsed && parsed.answers && typeof parsed.answers === 'object' && Object.keys(parsed.answers).length > 0) {
        setResumeDraft(parsed.answers as Record<string, string>);
      }
    } catch { /* 손상 드래프트 무시 */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftKey]);

  useEffect(() => () => { if (timerRef.current) window.clearTimeout(timerRef.current); }, []);

  const sectionIdxOf = (q: DiagnosisQuestionDto | null): number => {
    if (!sectionList || !q?.section) return 0;
    const i = sectionList.findIndex((s) => s.key === q.section);
    return i < 0 ? 0 : i;
  };
  const curSectionIdx = sectionIdxOf(current);
  if (curSectionIdx > maxSectionIdxRef.current) maxSectionIdxRef.current = curSectionIdx;

  const finish = (finalAnswers: Record<string, string>) => {
    if (draftKey) { try { sessionStorage.removeItem(draftKey); } catch { /* 무해 */ } }
    // 선치환 키는 payload에서 제외(서버가 재계산) — 사용자가 실제 답한 것만
    const payload: Record<string, string> = {};
    for (const [k, v] of Object.entries(finalAnswers)) {
      if (prefilled[k] === undefined) payload[k] = v;
    }
    onFinished(payload);
  };

  const advanceFrom = (nextAnswers: Record<string, string>, fromKey: string) => {
    const eff = { ...prefilled, ...nextAnswers };
    const nextPath = visiblePath(questions, eff).filter((q) => prefilled[q.key] === undefined);
    const nextQ = nextPath.find((q) => nextAnswers[q.key] === undefined) ?? null;
    if (!nextQ) { finish(nextAnswers); return; }
    const fromQ = questions.find((q) => q.key === fromKey) ?? null;
    const fromIdx = sectionIdxOf(fromQ);
    const nextIdx = sectionIdxOf(nextQ);
    // 섹션 경계 화면 — 첫 경계(기본 정보 → 다음)는 생략해 전면 개입을 2~3회로 묶는다
    if (sectionList && nextIdx > fromIdx && fromIdx > 0 && fromQ?.section) {
      setView({ kind: 'interstitial', doneSectionKey: fromQ.section, nextKey: nextQ.key });
    } else {
      setCursorKey(nextQ.key);
      setView({ kind: 'question' });
    }
  };

  const pick = (optionKey: string) => {
    if (busy || leaving || !current) return;
    const merged = { ...answers, [current.key]: optionKey };
    // prefilled를 함께 넘긴다 — 빠뜨리면 선치환 게이트가 연 분기의 답이 고아로 지워져 커서가 제자리를 돈다
    const pruned = pruneAnswers(questions, { ...merged }, stashRef.current, prefilled);
    setAnswers(pruned);

    const go = () => { setLeaving(false); advanceFrom(pruned, current.key); };
    if (reduceMotion) {
      go();
    } else {
      setLeaving(true);
      timerRef.current = window.setTimeout(go, 220);
    }
  };

  const jumpTo = (qKey: string) => {
    if (busy) return;
    setCursorKey(qKey);
    setView({ kind: 'question' });
  };

  const undoLast = () => {
    if (busy) return;
    const answered = askable.filter((q) => answers[q.key] !== undefined);
    const last = answered[answered.length - 1];
    if (last) jumpTo(last.key);
  };

  // ── 드래프트 이어하기 배너 ──
  if (resumeDraft) {
    return (
      <div className="rounded-2xl border border-white/10 bg-white/5 p-5 text-center break-keep">
        <p className="text-base font-bold text-white">하시던 진단이 있어요</p>
        <p className="mt-1.5 text-sm text-white/60">이어서 하시면 답했던 곳 다음부터 시작해요.</p>
        <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:justify-center">
          <button
            type="button"
            onClick={() => {
              const pruned = pruneAnswers(questions, { ...resumeDraft }, stashRef.current);
              setAnswers(pruned);
              setResumeDraft(null);
            }}
            className="min-h-[48px] rounded-xl bg-gradient-to-r from-sky-500 to-indigo-500 px-5 py-2.5 text-sm font-bold text-white shadow-lg shadow-sky-500/25 transition-all hover:shadow-xl"
          >
            이어서 하기
          </button>
          <button
            type="button"
            onClick={() => {
              if (draftKey) { try { sessionStorage.removeItem(draftKey); } catch { /* 무해 */ } }
              setResumeDraft(null);
            }}
            className="min-h-[48px] rounded-xl border border-white/15 bg-white/5 px-5 py-2.5 text-sm font-semibold text-white/80 transition-colors hover:bg-white/10"
          >
            처음부터 할게요
          </button>
        </div>
      </div>
    );
  }

  // ── 섹션 경계 화면(되읽기 + 예고 통합 · 탭 전용) ──
  if (view.kind === 'interstitial' && sectionList) {
    const doneSection = sectionList.find((s) => s.key === view.doneSectionKey);
    const nextQ = questions.find((q) => q.key === view.nextKey);
    const nextSection = nextQ?.section ? sectionList.find((s) => s.key === nextQ.section) : null;
    const doneAnswers = path
      .filter((q) => q.section === view.doneSectionKey && effAnswers[q.key] !== undefined)
      .map((q) => q.options.find((o) => o.key === effAnswers[q.key])?.label)
      .filter(Boolean) as string[];
    // v10 즉석 소견 — 방금 끝난 섹션의 게이트 답에 걸린 echo 중 gap 우선, 없으면 마지막 good.
    // tone·문장 전부 서버 원장(리포트와 같은 문장)이다 — 여기서는 고르기만 한다.
    const doneEchoes = path
      .filter((q) => q.section === view.doneSectionKey && effAnswers[q.key] !== undefined)
      .map((q) => echoes?.[q.key]?.[effAnswers[q.key]])
      .filter(Boolean) as Array<{ tone: 'gap' | 'good'; text: string }>;
    const echo = doneEchoes.find((e) => e.tone === 'gap') ?? doneEchoes[doneEchoes.length - 1] ?? null;
    const echoLead = echo ? (/^(.+?[.!?])\s+[\s\S]+$/.exec(echo.text.trim())?.[1] ?? echo.text.trim()) : '';
    return (
      <div className="flex flex-col gap-5 break-keep">
        <SectionDots sections={sectionList} currentIdx={sectionIdxOf(nextQ ?? null)} maxIdx={maxSectionIdxRef.current} />
        <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
          <p className="text-xs font-semibold uppercase tracking-wider text-sky-300/80">
            {doneSection ? `${doneSection.label} · 들은 것` : '들은 것'}
          </p>
          <ul className="mt-2.5 flex flex-col gap-1.5">
            {doneAnswers.slice(0, 4).map((label, i) => (
              <li key={i} className="flex items-start gap-2 text-sm text-white/80">
                <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-sky-400" aria-hidden />
                {label}
              </li>
            ))}
          </ul>
          {echo && (
            <div
              className={`mt-3.5 rounded-xl border p-3 ${
                echo.tone === 'gap'
                  ? 'border-amber-400/25 bg-amber-500/[0.07]'
                  : 'border-emerald-400/25 bg-emerald-500/[0.07]'
              }`}
            >
              <p className={`flex items-center gap-1.5 text-[11px] font-bold tracking-wide ${
                echo.tone === 'gap' ? 'text-amber-300' : 'text-emerald-300'
              }`}>
                <Sparkles className="h-3 w-3" aria-hidden />
                {echo.tone === 'gap' ? '여기까지에서 벌써 보이는 것' : '좋은 신호예요'}
              </p>
              <p className="mt-1.5 text-[13.5px] leading-[1.65] text-white/80">{echoLead}</p>
            </div>
          )}
          <div className="mt-4 border-t border-white/10 pt-4">
            <p className="text-sm text-white/70">{nextSection?.intro || '이어서 여쭤볼게요.'}</p>
          </div>
          <button
            type="button"
            disabled={busy}
            onClick={() => { setCursorKey(view.nextKey); setView({ kind: 'question' }); }}
            className="mt-4 inline-flex min-h-[48px] w-full items-center justify-center gap-1.5 rounded-xl bg-gradient-to-r from-sky-500 to-indigo-500 px-4 text-sm font-bold text-white shadow-lg shadow-sky-500/25 transition-all hover:shadow-xl sm:w-auto sm:px-6"
          >
            계속하기 <ArrowRight className="h-4 w-4" aria-hidden />
          </button>
        </div>
      </div>
    );
  }

  if (!current) return null;
  const isGrid = current.type === 'industry_grid';

  // 섹션 내 진행(래칫 — 분기가 열려도 역주행 금지)
  const secKey = current.section ?? '__all__';
  const secQs = askable.filter((q) => (q.section ?? '__all__') === secKey);
  const secAnswered = secQs.filter((q) => answers[q.key] !== undefined).length;
  const rawRatio = secQs.length > 0 ? secAnswered / secQs.length : 0;
  const ratio = Math.max(sectionRatioRef.current[secKey] ?? 0, rawRatio);
  sectionRatioRef.current[secKey] = ratio;

  const currentSectionChips = askable.filter(
    (q) => (q.section ?? '__all__') === secKey && answers[q.key] !== undefined && q.key !== current.key,
  );
  const prevAnswered = askable.filter(
    (q) => (q.section ?? '__all__') !== secKey && answers[q.key] !== undefined,
  );
  const answeredCount = askable.filter((q) => answers[q.key] !== undefined).length;

  return (
    <div className="flex flex-col gap-5 break-keep">
      {/* 진행 — 섹션 도트(고정) + 섹션 내 얇은 바 */}
      <div>
        <div className="flex items-center justify-between text-xs text-white/50">
          <span className="inline-flex items-center gap-1.5">
            <Activity className="h-3.5 w-3.5 text-sky-400" aria-hidden />
            AI 마케팅 진단
          </span>
          {sectionList ? (
            <span>
              {sectionList[curSectionIdx]?.label}
              {answeredCount > 0 ? ` · ${answeredCount}개 답하셨어요` : ''}
            </span>
          ) : (
            <span>{answeredCount > 0 ? `${answeredCount}개 답하셨어요` : ''}</span>
          )}
        </div>
        {sectionList && (
          <div className="mt-2">
            <SectionDots sections={sectionList} currentIdx={curSectionIdx} maxIdx={maxSectionIdxRef.current} />
          </div>
        )}
        <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-white/10" aria-hidden>
          <div
            className="h-full rounded-full bg-gradient-to-r from-sky-400 to-indigo-500 transition-all duration-300"
            style={{ width: `${Math.max(6, Math.round(ratio * 100))}%` }}
          />
        </div>
      </div>

      {/* 지난 답 칩 — 현재 섹션만 · 이전 섹션은 접힘(20문항 칩 폭발 차단) */}
      {(currentSectionChips.length > 0 || prevAnswered.length > 0) && (
        <div className="flex flex-wrap items-center gap-1.5">
          {prevAnswered.length > 0 && (
            <button
              type="button"
              onClick={() => setShowAllChips((v) => !v)}
              className="inline-flex items-center gap-1 rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[11px] text-white/50 transition-colors hover:border-sky-400/40 hover:text-white"
            >
              이전 답 {prevAnswered.length}개 {showAllChips ? '접기' : '보기'}
            </button>
          )}
          {(showAllChips ? [...prevAnswered, ...currentSectionChips] : currentSectionChips).map((q) => {
            const opt = q.options.find((o) => o.key === answers[q.key]);
            if (!opt) return null;
            return (
              <button
                key={q.key}
                type="button"
                onClick={() => jumpTo(q.key)}
                className="inline-flex items-center gap-1 rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[11px] text-white/60 transition-colors hover:border-sky-400/40 hover:text-white"
                title={q.text}
              >
                <Check className="h-3 w-3 text-sky-400" aria-hidden />
                {opt.label}
              </button>
            );
          })}
          {answeredCount > 0 && (
            <button
              type="button"
              onClick={undoLast}
              aria-label="직전 답 다시 고르기"
              className="inline-flex items-center gap-1 rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[11px] text-white/50 transition-colors hover:border-sky-400/40 hover:text-white"
            >
              <RotateCcw className="h-3 w-3" aria-hidden />
              이전
            </button>
          )}
        </div>
      )}

      {/* 문항 — 220ms 슬라이드+페이드 · 분기 심화는 직전 답 인용 리본으로 대화감 */}
      <div
        key={current.key}
        aria-live="polite"
        className={`transition-all duration-200 ${leaving ? 'translate-x-3 opacity-0' : 'translate-x-0 opacity-100'} ${reduceMotion ? 'transition-none' : ''}`}
      >
        {current.show_when && (() => {
          const gate = questions.find((q) => q.key === current.show_when?.q);
          const gateOpt = gate?.options.find((o) => o.key === effAnswers[gate.key]);
          if (!gateOpt) return null;
          return (
            <p className="mb-2 text-[13px] text-white/50">
              「{gateOpt.label}」라고 하셔서, 조금 더 여쭤볼게요.
            </p>
          );
        })()}
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
                className={`min-h-[56px] rounded-xl border px-4 py-2.5 text-left transition-all active:scale-[0.99] disabled:opacity-60 ${
                  isGrid ? 'text-center text-sm font-semibold' : ''
                } ${
                  selected
                    ? 'border-sky-400/60 bg-sky-500/15 text-white shadow-[0_0_0_1px_rgba(56,189,248,0.35)]'
                    : 'border-white/10 bg-white/5 text-white/85 hover:border-sky-400/40 hover:bg-white/10'
                }`}
              >
                <span className={isGrid ? '' : 'block text-[15px] font-medium'}>{o.label}</span>
                {!isGrid && o.hint && (
                  <span className="mt-0.5 block text-[12px] text-white/45">{o.hint}</span>
                )}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/** 섹션 도트 — 개수 고정(분기는 섹션 안에서만) · 래칫(최고 도달점 유지) · 현재 = 링 */
function SectionDots({
  sections, currentIdx, maxIdx,
}: { sections: DiagnosisSectionDto[]; currentIdx: number; maxIdx: number }) {
  return (
    <div className="flex items-center gap-1.5" aria-hidden>
      {sections.map((s, i) => {
        const reached = i <= Math.max(currentIdx, maxIdx);
        const isCurrent = i === currentIdx;
        return (
          <span
            key={s.key}
            className={`h-1.5 rounded-full transition-all duration-300 ${
              isCurrent
                ? 'w-6 bg-gradient-to-r from-sky-400 to-indigo-500'
                : reached
                  ? 'w-3 bg-sky-400/60'
                  : 'w-3 bg-white/10'
            }`}
            title={s.label}
          />
        );
      })}
    </div>
  );
}
