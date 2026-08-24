/**
 * HelpPanel — 도움말 봇 패널 (★ 2026-08-22). App.tsx에서 lazy로 불린다(import 리터럴은 App.tsx 안).
 *
 * 모드는 서버가 정한다(발송 이력 없음 = 온보딩, 있음 = 도움말). 사용자에게 묻지 않는다.
 *   온보딩: 시작 5단계 카드(순서 번호) + 마법사 대상이면 "안내에 따라 진행" 버튼
 *   도움말: 지금 이 화면에서 할 수 있는 작업 카드 + 막히는 지점이 먼저 보인다(0타이핑)
 * 질문: 입력 + Enter/버튼 1번. 답이 없으면 "이 안내에 없는 내용" + 가까운 작업 + "문의 남기기".
 * 스크림·포커스 트랩·본문 스크롤 잠금 없음 — 봇이 "여기를 누르세요"라고 하면 그대로 눌러야 한다.
 */
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { X, Send, Loader2, LifeBuoy, Sparkles, ArrowRight } from 'lucide-react';
import HelpJobCard from './HelpJobCard';
import { askHelp, leaveHelpQuestion, type HelpAskResult, type HelpContext, type HelpJob, type HelpTurn } from './help-api';
import {
  HELP_ANSWER, HELP_ANSWER_Q, HELP_BODY, HELP_BTN_GHOST, HELP_BTN_PRIMARY, HELP_FOOT, HELP_HEAD, HELP_HEAD_BADGE, HELP_HEAD_CLOSE,
  HELP_HEAD_TITLE, HELP_INPUT, HELP_INPUT_WRAP, HELP_INTRO, HELP_INTRO_DESC, HELP_INTRO_TITLE, HELP_MISS, HELP_PANEL, HELP_SECTION_TITLE, HELP_SEND, HELP_SOURCE,
} from './help-ui';

interface Props {
  ctx: HelpContext;
  path: string;
  onClose: () => void;
}

const MAX_Q = 240;

export default function HelpPanel({ ctx, path, onClose }: Props) {
  const navigate = useNavigate();
  const [open, setOpen] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [asking, setAsking] = useState(false);
  const [result, setResult] = useState<{ q: string; r: HelpAskResult } | null>(null);
  const [askError, setAskError] = useState<string | null>(null);
  const [left, setLeft] = useState<'idle' | 'sending' | 'done' | 'error'>('idle');
  const inputRef = useRef<HTMLInputElement>(null);
  // 직전 문답(최대 3쌍). 서버가 후속 질문("그게 안 되는데요")을 문맥으로 이해하는 재료다(★2026-08-24).
  // 화면 표시는 기존 그대로 최신 답 하나다 — 이 값은 요청에만 실린다.
  const historyRef = useRef<HelpTurn[]>([]);

  // 화면이 바뀌면 펼침·답변·문맥을 정리한다(다른 화면의 답이 남아 있으면 헷갈린다)
  useEffect(() => { setOpen(null); setResult(null); setAskError(null); setLeft('idle'); historyRef.current = []; }, [path]);

  const mode = ctx.mode || 'help';
  const here = ctx.here || [];
  const starter = ctx.starter || [];

  const submit = async () => {
    const question = q.trim();
    if (!question || asking) return;
    setAsking(true); setAskError(null); setLeft('idle');
    try {
      const r = await askHelp(question, path, historyRef.current);
      setResult({ q: question, r });
      setOpen(r.jobs[0]?.id || null);
      // 답이 성립한 문답만 문맥이 된다. direct는 답 문장이 비어 있으므로 카드 제목으로 요약한다
      if (r.answered) {
        const a = r.answer || (r.jobs[0] ? `"${r.jobs[0].title}" 안내를 보여드렸습니다.` : '');
        if (a) historyRef.current = [...historyRef.current, { q: question, a }].slice(-3);
      }
    } catch (e: any) {
      setAskError(e?.message || '답변을 만들지 못했습니다.');
    } finally {
      setAsking(false);
    }
  };

  const leave = async () => {
    if (!result || left === 'sending') return;
    setLeft('sending');
    try { await leaveHelpQuestion(result.q, path); setLeft('done'); } catch { setLeft('error'); }
  };

  const renderJobs = (jobs: HelpJob[], numbered = false) => jobs.map((j, i) => (
    <HelpJobCard key={j.id} job={j} index={numbered ? i + 1 : undefined} open={open === j.id} onToggle={() => setOpen(open === j.id ? null : j.id)} onNavigate={onClose} />
  ));

  return (
    <div className={HELP_PANEL} role="dialog" aria-label="도움말">
      <div className={HELP_HEAD}>
        <div className={HELP_HEAD_TITLE}>
          <LifeBuoy className="w-4 h-4 text-indigo-600" strokeWidth={2} aria-hidden="true" />
          도움말
          <span className={HELP_HEAD_BADGE}>{mode === 'onboarding' ? '시작 안내' : '사용법'}</span>
        </div>
        <button type="button" onClick={onClose} aria-label="닫기" className={HELP_HEAD_CLOSE}><X className="w-4 h-4" strokeWidth={2} /></button>
      </div>

      <div className={HELP_BODY}>
        {result ? (
          <>
            <p className={HELP_ANSWER_Q}>질문: {result.q}</p>
            {/* direct = 정의를 그대로 낸 답. 산문 없이 첫 카드가 펼쳐진 채로 순서·막히는 지점을 보여준다 */}
            {result.r.answered ? (
              result.r.direct ? null : <div className={HELP_ANSWER}>{result.r.answer}</div>
            ) : (
              <div className={HELP_MISS}>
                이 안내에는 없는 내용입니다. 가까운 기능을 아래에 두었습니다.
                <div className="mt-2 flex items-center gap-2 flex-wrap">
                  {left === 'done' ? (
                    <span className="text-[12px] text-emerald-700">남겼습니다. 확인해서 이 안내를 채우겠습니다.</span>
                  ) : (
                    <button type="button" onClick={leave} disabled={left === 'sending'} className={HELP_BTN_PRIMARY}>
                      {left === 'sending' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}문의 남기기
                    </button>
                  )}
                  {left === 'error' && <span className="text-[12px] text-rose-700">남기지 못했습니다. 잠시 후 다시 시도해 주세요.</span>}
                </div>
              </div>
            )}
            {result.r.jobs.length > 0 && (
              <div className="space-y-2">
                <p className={HELP_SECTION_TITLE}>{result.r.direct ? '이 안내를 보세요' : '관련 기능'}</p>
                {renderJobs(result.r.jobs)}
              </div>
            )}
            <button type="button" onClick={() => { setResult(null); setOpen(null); historyRef.current = []; }} className={HELP_BTN_GHOST}>처음으로</button>
          </>
        ) : mode === 'onboarding' ? (
          <>
            <div className={HELP_INTRO}>
              <p className={HELP_INTRO_TITLE}>
                <Sparkles className="w-3.5 h-3.5 text-indigo-600" strokeWidth={2} aria-hidden="true" />첫 문자까지 다섯 단계입니다
              </p>
              <p className={HELP_INTRO_DESC}>순서대로 누르면 각 단계의 시작 위치로 바로 갑니다. 막히면 아래에 물어보세요.</p>
              {ctx.wizard?.available && !ctx.wizard.completed && (
                <button type="button" onClick={() => { navigate(`/onboarding?step=${ctx.wizard?.step || 1}`); onClose(); }} className={`${HELP_BTN_PRIMARY} mt-2.5`}>
                  안내에 따라 진행<ArrowRight className="w-3.5 h-3.5" strokeWidth={2.2} />
                </button>
              )}
            </div>
            <div className="space-y-2">{renderJobs(starter, true)}</div>
          </>
        ) : (
          <>
            {here.length > 0 ? (
              <div className="space-y-2">
                <p className={HELP_SECTION_TITLE}>지금 이 화면에서</p>
                {renderJobs(here)}
              </div>
            ) : (
              <div className="space-y-2">
                <p className={HELP_SECTION_TITLE}>자주 찾는 기능</p>
                {renderJobs(starter)}
              </div>
            )}
          </>
        )}
        {askError && <p className="text-[12px] text-rose-700">{askError}</p>}
        <p className={HELP_SOURCE}>Data source: 기능 안내 원장</p>
      </div>

      <div className={HELP_FOOT}>
        <form
          className={HELP_INPUT_WRAP}
          onSubmit={(e) => { e.preventDefault(); submit(); }}
        >
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value.slice(0, MAX_Q))}
            placeholder="무엇이 막히나요? 예: 예약 발송은 어디서 해요"
            aria-label="도움말 질문"
            maxLength={MAX_Q}
            className={HELP_INPUT}
          />
          <button type="submit" aria-label="물어보기" disabled={!q.trim() || asking} className={HELP_SEND}>
            {asking ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" strokeWidth={2} />}
          </button>
        </form>
      </div>
    </div>
  );
}
