/**
 * DirectCheckTiles — 직접발송 "보내기 전 점검" 두 칸(스팸 검사 · 맞춤법 검사) (2026-09-25 Harold 지시 · 목업 3 승인)
 * 설계 SoT = docs/2026-09-25-direct-send-precheck-design.md §2
 *
 * 칸은 상태를 보여 주고 누르면 다음 할 일을 연다. 판정은 호출부(DirectSendPanel)가 서버 값으로 한다.
 * 아직 안 했으면 스팸 = 노란 면 · 맞춤법 = 초록 테두리 면(왼쪽에서 가장 먼저 눈에 걸리게).
 */
import { AlertTriangle, Ban, Check, ChevronRight, Loader2, Lock, RotateCcw, ShieldCheck } from 'lucide-react';

export type SpamTileState = 'todo' | 'running' | 'pass' | 'blocked' | 'warn' | 'stale' | 'locked';
export type SpellTileState = 'todo' | 'running' | 'issues' | 'clean' | 'stale' | 'locked';

interface Props {
  spam: { state: SpamTileState; trialRemaining: number | null; carriersText: string };
  spell: { state: SpellTileState; openCount: number; freeRemaining: number | null; freeLimit: number | null };
  onSpam: () => void;
  onSpell: () => void;
}

function SpellGlyph() {
  return <span className="ds-tile__glyph" aria-hidden>가</span>;
}

export default function DirectCheckTiles({ spam, spell, onSpam, onSpell }: Props) {
  // ── 스팸 칸 ──
  let spamCls = 'ds-tile--spam-todo';
  let spamIcon = <ShieldCheck size={18} strokeWidth={2.1} />;
  let spamTitle = '스팸 검사';
  let spamSub = spam.trialRemaining != null ? `무료 체험 ${spam.trialRemaining}회 남음` : '통신사 3사 막힘 확인';
  let spamGo = '검사';
  if (spam.state === 'running') {
    spamCls = 'ds-tile--run'; spamIcon = <Loader2 size={18} strokeWidth={2} className="animate-spin" />;
    spamTitle = '스팸 검사 중'; spamSub = '통신사 3사 결과 확인 중'; spamGo = '';
  } else if (spam.state === 'pass') {
    spamCls = 'ds-tile--pass'; spamIcon = <Check size={18} strokeWidth={2.6} />;
    spamTitle = '스팸 검사 통과'; spamSub = '3사 모두 통과했어요'; spamGo = '다시';
  } else if (spam.state === 'blocked') {
    spamCls = 'ds-tile--issue'; spamIcon = <Ban size={18} strokeWidth={2.2} />;
    spamTitle = `${spam.carriersText}에서 막힘`; spamSub = '글을 고친 뒤 다시 검사해 주세요'; spamGo = '보기';
  } else if (spam.state === 'warn') {
    spamCls = 'ds-tile--stale'; spamIcon = <AlertTriangle size={18} strokeWidth={2.2} />;
    spamTitle = '결과 없는 통신사'; spamSub = `${spam.carriersText} 결과가 오지 않았어요`; spamGo = '다시';
  } else if (spam.state === 'stale') {
    spamCls = 'ds-tile--stale'; spamIcon = <RotateCcw size={18} strokeWidth={2.2} />;
    spamTitle = '글이 바뀌었어요'; spamSub = '바뀐 글로 다시 검사'; spamGo = '검사';
  } else if (spam.state === 'locked') {
    spamCls = 'ds-tile--lock'; spamIcon = <Lock size={17} strokeWidth={2} />;
    spamTitle = '스팸 검사'; spamSub = '무료 체험 3회를 다 썼어요'; spamGo = '요금제';
  }

  // ── 맞춤법 칸 ──
  let spellCls = 'ds-tile--spell-todo';
  let spellIcon = <SpellGlyph />;
  let spellTitle: React.ReactNode = <>맞춤법 검사 <span className="ds-tile__new">NEW</span></>;
  let spellSub = spell.freeRemaining != null ? `이번 달 무료 ${spell.freeRemaining}/${spell.freeLimit ?? 5}회` : '틀린 글자 · 띄어쓰기';
  let spellGo = '검사';
  if (spell.state === 'running') {
    spellCls = 'ds-tile--run'; spellIcon = <Loader2 size={18} strokeWidth={2} className="animate-spin" />;
    spellTitle = '맞춤법 보는 중'; spellSub = '잠시만요'; spellGo = '';
  } else if (spell.state === 'issues') {
    spellCls = 'ds-tile--issue'; spellIcon = <SpellGlyph />;
    spellTitle = `고칠 곳 ${spell.openCount}곳`; spellSub = '눌러서 한 번에 고쳐요'; spellGo = '보기';
  } else if (spell.state === 'clean') {
    spellCls = 'ds-tile--pass'; spellIcon = <Check size={18} strokeWidth={2.6} />;
    spellTitle = '맞춤법 확인 끝'; spellSub = '고칠 곳이 없어요'; spellGo = '';
  } else if (spell.state === 'stale') {
    spellCls = 'ds-tile--stale'; spellIcon = <RotateCcw size={18} strokeWidth={2.2} />;
    spellTitle = '글이 바뀌었어요'; spellSub = '바뀐 글로 다시 검사'; spellGo = '검사';
  } else if (spell.state === 'locked') {
    spellCls = 'ds-tile--lock'; spellIcon = <Lock size={17} strokeWidth={2} />;
    spellTitle = '맞춤법 검사'; spellSub = `이번 달 무료 ${spell.freeLimit ?? 5}회를 다 썼어요`; spellGo = '요금제';
  }

  return (
    <div className="ds-check-row">
      <button type="button" className={`ds-tile ${spamCls}`} onClick={onSpam} disabled={spam.state === 'running'}>
        <span className="ds-tile__ic">{spamIcon}</span>
        <span className="ds-tile__tx">
          <span className="ds-tile__t1">{spamTitle}</span>
          <span className="ds-tile__t2">{spamSub}</span>
        </span>
        {spamGo && <span className="ds-tile__go">{spamGo}<ChevronRight size={13} strokeWidth={2.4} /></span>}
      </button>
      <button type="button" className={`ds-tile ${spellCls}`} onClick={onSpell} disabled={spell.state === 'running'}>
        <span className="ds-tile__ic">{spellIcon}</span>
        <span className="ds-tile__tx">
          <span className="ds-tile__t1">{spellTitle}</span>
          <span className="ds-tile__t2">{spellSub}</span>
        </span>
        {spellGo && <span className="ds-tile__go">{spellGo}<ChevronRight size={13} strokeWidth={2.4} /></span>}
      </button>
    </div>
  );
}
