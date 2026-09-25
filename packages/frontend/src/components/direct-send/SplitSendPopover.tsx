/**
 * SplitSendPopover — 분할 전송 "몇 건씩 나눠 보낼까요?" 풍선 (2026-09-25 Harold 지시)
 *
 * 규칙은 서버 그대로(`backend/src/utils/send-time-util.ts calcSplitSendTime`): **1분마다** 정한 건수씩,
 * 발송 가능 시간을 넘기면 다음 날 아침에 이어서. 범위 1~9999(D142 정책 그대로).
 * 여기 계산은 안내용 추정이다(예상 끝나는 시각). 실제 시각은 서버가 정한다.
 */
import { useEffect, useRef, useState } from 'react';

const PRESETS = [100, 500, 1000, 3000];
const clampSplit = (n: number) => Math.max(1, Math.min(9999, Math.floor(n) || 1));

interface Props {
  open: boolean;
  enabled: boolean;
  value: number;
  recipientCount: number;
  /** 예약 시각(있으면 그 시각부터 계산) */
  startAt: string | null;
  onApply: (n: number) => void;
  onOff: () => void;
  onClose: () => void;
}

export default function SplitSendPopover({ open, enabled, value, recipientCount, startAt, onApply, onOff, onClose }: Props) {
  const [pick, setPick] = useState(value || 1000);
  const ref = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (open) setPick(enabled && value ? value : 1000);
  }, [open, enabled, value]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const el = ref.current;
      if (el && !el.contains(e.target as Node) && !(e.target as HTMLElement)?.closest?.('[data-split-anchor]')) onCloseRef.current();
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !e.isComposing) { e.stopPropagation(); onCloseRef.current(); } };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey, true);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey, true); };
  }, [open]);

  if (!open) return null;

  const k = clampSplit(pick);
  const n = Math.max(0, recipientCount);
  const rounds = n > 0 ? Math.ceil(n / k) : 0;
  const base = startAt ? new Date(startAt) : new Date();
  const end = new Date(base.getTime() + Math.max(0, rounds - 1) * 60000);
  const endText = `${end.getHours()}:${String(end.getMinutes()).padStart(2, '0')}`;

  return (
    <div ref={ref} className="ds-split-pop" role="dialog" aria-label="분할 전송">
      <div className="ds-split-pop__head">
        <b>몇 건씩 나눠 보낼까요?</b>
        <small>1분마다 정한 건수만큼 보내요.</small>
      </div>
      <div className="ds-split-pop__body">
        <div className="ds-split-presets">
          {PRESETS.map((p) => (
            <button key={p} type="button" className={k === p ? 'is-on' : ''} onClick={() => setPick(p)}>{p.toLocaleString()}</button>
          ))}
        </div>
        <label className="ds-split-own">
          직접 입력
          <input
            type="text"
            inputMode="numeric"
            className="ds-num"
            value={String(pick)}
            onChange={(e) => setPick(clampSplit(Number(e.target.value.replace(/[^0-9]/g, ''))))}
          />
          건씩
        </label>
        <div className="ds-split-calc">
          {n === 0 ? (
            <>받는 사람을 넣으면 몇 번에 나눠 나가는지 보여 드려요.</>
          ) : rounds <= 1 ? (
            <><b className="ds-num">{n.toLocaleString()}명</b>을 한 번에 보내요. 나눌 필요가 없어요.</>
          ) : (
            <>
              <b className="ds-num">{n.toLocaleString()}명</b> → 1분에 <b className="ds-num">{k.toLocaleString()}건</b>씩 <b className="ds-num">{rounds.toLocaleString()}번</b>에 나눠 보내요.
              <br />{startAt ? '예약 시각부터' : '지금 보내면'} <b className="ds-num">{endText}</b>쯤 다 나가요.
            </>
          )}
        </div>
        <span className="ds-split-fine">발송 가능 시간을 넘기면 다음 날 아침에 이어서 보내요.</span>
      </div>
      <div className="ds-split-pop__foot">
        <button type="button" className="ds-dlg__ghost" onClick={() => { onOff(); onClose(); }}>나누지 않기</button>
        <button type="button" className="ds-split-apply" onClick={() => { onApply(k); onClose(); }}>이대로 나눠 보내기</button>
      </div>
    </div>
  );
}
