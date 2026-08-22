/**
 * HelpJobCard — 기능 정의 1건 = 카드 1장 (★ 2026-08-22). 봇 패널과 안내 화면이 같은 부품을 쓴다.
 *
 * 잠금·준비 중 표시는 서버가 준 값으로만 그린다. 요금제 이름은 이 파일에도 없다.
 */
import { useNavigate } from 'react-router-dom';
import { ChevronDown, ArrowRight, Lock, BookOpen } from 'lucide-react';
import type { HelpJob } from './help-api';
import {
  HELP_BLOCKER, HELP_BLOCKER_FIX, HELP_BLOCKER_SYMPTOM, HELP_BTN_GHOST, HELP_BTN_PRIMARY, HELP_CARD, HELP_CARD_ACTIONS,
  HELP_CARD_BODY, HELP_CARD_GOAL, HELP_CARD_HEAD, HELP_CARD_NUM, HELP_CARD_TITLE, HELP_LOCK, HELP_SECTION_TITLE, HELP_STEP,
  HELP_STEP_NUM, HELP_STUB,
} from './help-ui';

interface Props {
  job: HelpJob;
  index?: number;
  open: boolean;
  onToggle: () => void;
  /** "이 화면 열기" 뒤에 패널을 닫는 등 */
  onNavigate?: () => void;
  /** 안내 화면 안에서는 "자세히"를 숨긴다 */
  showGuideLink?: boolean;
}

export default function HelpJobCard({ job, index, open, onToggle, onNavigate, showGuideLink = true }: Props) {
  const navigate = useNavigate();
  const go = (to: string) => { navigate(to); onNavigate?.(); };

  return (
    <div className={HELP_CARD}>
      <button type="button" onClick={onToggle} aria-expanded={open} className={HELP_CARD_HEAD}>
        {index != null && <span className={HELP_CARD_NUM}>{index}</span>}
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5 flex-wrap">
            <span className={HELP_CARD_TITLE}>{job.title}</span>
            {job.locked && <span className={HELP_LOCK}><Lock className="w-3 h-3" strokeWidth={2.2} />지금 요금제에서는 잠김</span>}
            {job.status === 'stub' && <span className={HELP_STUB}>안내 준비 중</span>}
          </span>
          <span className={HELP_CARD_GOAL}>{job.goal}</span>
        </span>
        <ChevronDown className={`w-4 h-4 shrink-0 text-neutral-300 mt-1 transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden="true" />
      </button>

      {open && (
        <div className={HELP_CARD_BODY}>
          <div>
            <p className={HELP_SECTION_TITLE}>어디서 시작하나</p>
            <p className="mt-1 text-[12.5px] text-neutral-800">{job.entry.via}</p>
          </div>

          {job.steps.length > 0 && (
            <div>
              <p className={HELP_SECTION_TITLE}>순서</p>
              <ol className="mt-1 space-y-1.5">
                {job.steps.map((s, i) => (
                  <li key={i} className={HELP_STEP}><span className={HELP_STEP_NUM}>{i + 1}</span><span>{s}</span></li>
                ))}
              </ol>
            </div>
          )}

          {job.blockers.length > 0 && (
            <div>
              <p className={HELP_SECTION_TITLE}>막히면</p>
              <div className="mt-1 space-y-1.5">
                {job.blockers.map((b, i) => (
                  <div key={i} className={HELP_BLOCKER}>
                    <p className={HELP_BLOCKER_SYMPTOM}>{b.symptom}</p>
                    <p className={HELP_BLOCKER_FIX}>{b.fix}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {job.status === 'stub' && job.steps.length === 0 && (
            <p className="text-[12px] text-neutral-500">자세한 순서는 준비 중입니다. 시작 위치로 바로 갈 수 있습니다.</p>
          )}

          <div className={HELP_CARD_ACTIONS}>
            <button type="button" onClick={() => go(job.entry.path)} className={HELP_BTN_PRIMARY}>
              이 화면 열기<ArrowRight className="w-3.5 h-3.5" strokeWidth={2.2} />
            </button>
            {showGuideLink && (
              <button type="button" onClick={() => go(`/guide/${job.id}`)} className={HELP_BTN_GHOST}>
                <BookOpen className="w-3.5 h-3.5" strokeWidth={2} />자세히
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
