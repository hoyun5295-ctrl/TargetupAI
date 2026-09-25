/**
 * SendSpamWarnModal — 직접발송 [전송하기] 직전 경고 창 (2026-09-25 Harold 지시)
 * 설계 SoT = docs/2026-09-25-direct-send-precheck-design.md §3
 *
 * 스팸 검사를 안 했거나(검사 원장 기준 24시간 안에 같은 발신번호·같은 문안 검사 없음) 막혔거나 끝나지 않았으면 뜬다.
 * 맞춤법 고칠 곳이 남아 있으면 한 줄을 함께 싣는다.
 * "24시간 다시 보지 않기"는 **검사를 안 한 경우의 안내에만** 있다. 막힘·미완료는 매번 보인다(알고 있는 실패라서).
 * ⛔ 막지 않는다 — [그냥 보내기]는 언제나 누를 수 있다.
 * ★0925 Harold A안: 안내는 문단이 아니라 그림 세 칸(스팸 차단에 걸림 → 고객 스팸함으로 → 비용은 청구) + 한 줄씩.
 */
import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, Ban, ChevronRight, CircleCheck, Filter, Loader2, MailX, Receipt, ShieldCheck, X } from 'lucide-react';

export type SendWarnVariant = 'none' | 'blocked' | 'running' | 'warn' | 'spell';

interface Props {
  open: boolean;
  variant: SendWarnVariant;
  carriersText: string;
  spellOpenCount: number;
  /** 미가입 회사의 스팸 체험 남은 횟수. 유료면 null */
  trialRemaining: number | null;
  onCheckSpam: () => void;
  onOpenSpell: () => void;
  onSendAnyway: (dismiss24h: boolean) => void;
  onClose: () => void;
}

export default function SendSpamWarnModal({
  open, variant, carriersText, spellOpenCount, trialRemaining, onCheckSpam, onOpenSpell, onSendAnyway, onClose,
}: Props) {
  const [dismiss, setDismiss] = useState(false);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useEffect(() => {
    if (!open) return;
    setDismiss(false);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !e.isComposing) { e.stopPropagation(); onCloseRef.current(); }
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [open]);

  if (!open) return null;

  const spamCta = trialRemaining != null && trialRemaining > 0
    ? `스팸 검사하고 보내기 · 무료 체험 ${trialRemaining}회 남음`
    : '스팸 검사하고 보내기';

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center p-4 bg-stone-900/55" role="dialog" aria-modal="true" aria-labelledby="ds-warn-title">
      <div className="ds-dlg w-full max-w-[480px]">
        <div className="ds-dlg__head">
          {variant === 'blocked' ? (
            <span className="ds-dlg__ic ds-dlg__ic--rose"><Ban size={17} strokeWidth={2.2} /></span>
          ) : variant === 'running' ? (
            <span className="ds-dlg__ic ds-dlg__ic--stone"><Loader2 size={17} strokeWidth={2} className="animate-spin" /></span>
          ) : variant === 'spell' ? (
            <span className="ds-dlg__ic ds-dlg__ic--emerald">가</span>
          ) : (
            <span className="ds-dlg__ic ds-dlg__ic--amber"><ShieldCheck size={17} strokeWidth={2.2} /></span>
          )}
          <div className="min-w-0">
            <b id="ds-warn-title">
              {variant === 'none' && '발송 전에 스팸 검사를 하셨나요?'}
              {variant === 'blocked' && `이 문자는 ${carriersText}에서 막혔어요`}
              {variant === 'running' && '스팸 검사가 아직 끝나지 않았어요'}
              {variant === 'warn' && '결과를 받지 못한 통신사가 있어요'}
              {variant === 'spell' && '맞춤법 고칠 곳이 남아 있어요'}
            </b>
            <small>
              {variant === 'none' && '정상 문자도 고객 스팸함으로 갈 수 있어요'}
              {variant === 'blocked' && '글을 고친 뒤 다시 검사해 보세요'}
              {variant === 'running' && '결과가 나온 뒤 보내면 막히는지 확인할 수 있어요. 1분 안에 끝나요.'}
              {variant === 'warn' && `${carriersText}의 결과가 오지 않았어요. 다시 검사해 보세요.`}
              {variant === 'spell' && '고친 뒤 보내면 받는 사람이 보는 글이 깔끔해져요.'}
            </small>
          </div>
          <button type="button" className="ds-dlg__x" onClick={onClose} aria-label="닫기"><X size={16} strokeWidth={2} /></button>
        </div>

        <div className="ds-dlg__body">
          {(variant === 'none' || variant === 'blocked') && (
            <div className="ds-warn-flow" role="list" aria-label="스팸 차단에 걸리면 생기는 일">
              <div role="listitem" className={`ds-warn-step ${variant === 'blocked' ? 'ds-warn-step--blocked' : 'ds-warn-step--hit'}`}>
                <Filter size={19} strokeWidth={2} aria-hidden />
                <b>{variant === 'blocked' ? `${carriersText}에서 막힘` : '스팸 차단에 걸림'}</b>
                <small>{variant === 'blocked' ? '이번 검사 결과' : '통신사 3사'}</small>
              </div>
              <ChevronRight className="ds-warn-arrow" size={14} strokeWidth={2.2} aria-hidden />
              <div role="listitem" className="ds-warn-step">
                <MailX size={19} strokeWidth={2} aria-hidden />
                <b>고객 스팸함으로</b>
                <small>고객은 못 봐요</small>
              </div>
              <ChevronRight className="ds-warn-arrow" size={14} strokeWidth={2.2} aria-hidden />
              <div role="listitem" className="ds-warn-step ds-warn-step--cost">
                <Receipt size={19} strokeWidth={2} aria-hidden />
                <b>비용은 청구</b>
                <small>효과 없이 지출</small>
              </div>
            </div>
          )}
          {variant === 'none' && (
            <>
              <div className="ds-warn-chips">
                <em>걸리는 곳</em><span>SKT T스팸필터링</span><span>KT 스팸차단</span><span>LG U+ 스팸차단</span>
              </div>
              <p className="ds-warn-good">
                <CircleCheck size={15} strokeWidth={2.2} aria-hidden />
                스팸 검사 1분이면 미리 막을 수 있어요
              </p>
            </>
          )}
          {variant === 'warn' && (
            <div className="ds-warn-card ds-warn-card--amber">
              <p><AlertTriangle size={14} strokeWidth={2.2} className="inline -mt-0.5 mr-1" />통신사 사정으로 결과가 늦게 오는 때가 있어요. 막힌 것으로 확인된 것은 아니에요.</p>
            </div>
          )}
          {spellOpenCount > 0 && (
            <div className="ds-warn-spell">
              맞춤법 고칠 곳 {spellOpenCount}곳이 그대로 있어요
              <button type="button" onClick={onOpenSpell}>보기</button>
            </div>
          )}
          {variant === 'none' && (
            <label className="ds-warn-dismiss">
              <input type="checkbox" className="ds-chk" checked={dismiss} onChange={(e) => setDismiss(e.target.checked)} />
              <span>24시간 다시 보지 않기</span>
            </label>
          )}
        </div>

        <div className="ds-dlg__foot ds-dlg__foot--end">
          <button type="button" className="ds-dlg__ghost" onClick={() => onSendAnyway(dismiss)}>그냥 보내기</button>
          {(variant === 'none' || variant === 'warn') && (
            <button type="button" className="ds-dlg__primary ds-dlg__primary--amber" onClick={onCheckSpam}>
              <ShieldCheck size={15} strokeWidth={2.2} />{variant === 'warn' ? '다시 검사하기' : spamCta}
            </button>
          )}
          {variant === 'blocked' && (
            <button type="button" className="ds-dlg__primary ds-dlg__primary--dark" onClick={onClose}>글 고치러 가기</button>
          )}
          {variant === 'running' && (
            <button type="button" className="ds-dlg__primary ds-dlg__primary--dark" onClick={onClose}>결과 기다리기</button>
          )}
          {variant === 'spell' && (
            <button type="button" className="ds-dlg__primary" onClick={onOpenSpell}>고칠 곳 보기</button>
          )}
        </div>
      </div>
    </div>
  );
}
