/**
 * DirectSpellModal — 직접발송 맞춤법 검사 결과 창 (2026-09-25 Harold 지시 · 목업 승인)
 *
 * 줄마다 [그대로 두기] [고치기] · 아래에 [모두 고치기]와 "문장까지 AI로 다듬기 · 1크레딧"(옛 AI 다듬기 자리).
 * ⛔ 이 창은 글을 스스로 바꾸지 않는다. [고치기]를 누르면 호출부가 그 자리만 바꾼다.
 * ⛔ 단문 90바이트를 넘게 되는 고치기는 잠근다(판정은 호출부 · 발송 바이트 계산과 같은 함수).
 */
import { useEffect, useRef } from 'react';
import { Check, Sparkles, X } from 'lucide-react';
import type { SpellIssue, SpellRow } from '../../utils/send-checks';

interface Props {
  open: boolean;
  rows: SpellRow[];
  quotaText: string;
  onFix: (issue: SpellIssue) => void;
  onKeep: (issue: SpellIssue) => void;
  onFixAll: () => void;
  onAiRefine: () => void;
  onClose: () => void;
}

export default function DirectSpellModal({ open, rows, quotaText, onFix, onKeep, onFixAll, onAiRefine, onClose }: Props) {
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !e.isComposing) { e.stopPropagation(); onCloseRef.current(); }
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [open]);

  if (!open) return null;
  const openRows = rows.filter((r) => r.status === 'open');
  const fixable = openRows.filter((r) => !r.issue.blocked);

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center p-4 bg-stone-900/50" role="dialog" aria-modal="true" aria-labelledby="ds-spell-title">
      <div className="ds-dlg w-full max-w-[520px]">
        <div className="ds-dlg__head">
          <span className="ds-dlg__ic ds-dlg__ic--emerald">가</span>
          <div className="min-w-0">
            <b id="ds-spell-title">맞춤법 검사</b>
            <small>{openRows.length > 0 ? `고칠 곳 ${openRows.length}곳. 누르면 글에 바로 들어가요.` : '다 확인했어요.'}</small>
          </div>
          <button type="button" className="ds-dlg__x" onClick={onClose} aria-label="닫기"><X size={16} strokeWidth={2} /></button>
        </div>

        <div className="ds-dlg__body">
          {rows.length === 0 && <div className="ds-spell-empty">고칠 곳을 찾지 못했어요.</div>}
          {rows.map(({ issue, status }) => (
            <div key={issue.id} className={`ds-spell-row ${status !== 'open' ? 'ds-spell-row--done' : ''}`}>
              <div className="min-w-0 flex-1">
                <div className="ds-spell-pair">
                  <del>{issue.before}</del>
                  <span aria-hidden>→</span>
                  <ins>{issue.after}</ins>
                </div>
                <div className="ds-spell-why">
                  {issue.reason || (issue.kind === 'spacing' ? '띄어쓰기' : '맞춤법')}
                  {issue.blocked === 'sms_bytes' && status === 'open' && <span className="ds-spell-lock"> · 고치면 단문 길이(90byte)를 넘어요</span>}
                </div>
              </div>
              {status === 'fixed' && <span className="ds-spell-state">고쳤어요</span>}
              {status === 'kept' && <span className="ds-spell-state">그대로 둠</span>}
              {status === 'open' && (
                <>
                  <button type="button" className="ds-spell-keep" onClick={() => onKeep(issue)}>그대로 두기</button>
                  <button
                    type="button"
                    className="ds-spell-fix"
                    onClick={() => onFix(issue)}
                    disabled={!!issue.blocked}
                    title={issue.blocked ? '고치면 단문 길이를 넘어요' : undefined}
                  >
                    <Check size={13} strokeWidth={2.6} />고치기
                  </button>
                </>
              )}
            </div>
          ))}
          <div className="ds-spell-protect">
            %이름% 같은 변수 · (광고) · 080 수신거부 · 링크 · 전화번호 · 기호는 건드리지 않아요. 단문이 90byte를 넘게 되는 고치기는 잠겨요.
          </div>
        </div>

        <div className="ds-dlg__foot">
          <div className="flex-1 min-w-0 flex flex-col items-start gap-1">
            <button type="button" className="ds-spell-ai" onClick={onAiRefine}>
              <Sparkles size={13} strokeWidth={2} />문장까지 AI로 다듬기 · 1크레딧
            </button>
            <span className="ds-dlg__fine">{quotaText}</span>
          </div>
          <button type="button" className="ds-dlg__primary" onClick={onFixAll} disabled={fixable.length === 0}>
            <Check size={14} strokeWidth={2.6} />모두 고치기
          </button>
        </div>
      </div>
    </div>
  );
}
