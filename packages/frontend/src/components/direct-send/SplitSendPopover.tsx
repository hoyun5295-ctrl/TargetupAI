/**
 * SplitSendPopover — 분할 전송 "나눠 보내기" 풍선 (2026-09-25 Harold 지시 · ★ 2026-09-28 개편 · 목업 승인)
 *
 * ★ 0928: 의미 없던 예시 숫자(100·500·1,000·3,000)를 빼고 **한 번에 보낼 건수**와 **보내는 간격(분)**을 직접 정한다.
 *   시각표(언제 몇 건씩 · 언제 끝나는가)는 서버 CT가 계산한다(`/api/campaigns/split-preview` = send-time-util planSplitSchedule).
 *   전에는 여기서 「시작 + 회차×1분」으로 따로 세서 밤 9시~아침 8시 건너뜀이 빠졌다.
 * 끝나는 날 한도(12일)를 넘으면 적용을 막는다 — 서버도 보낼 때 같은 함수로 다시 막는다.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  SPLIT_COUNT_RANGE, SPLIT_INTERVAL_RANGE, SPLIT_MAX_SPAN_DAYS, fetchSplitPreview, kstDayLabel, kstHourMinute,
  type SplitPreview,
} from '../../utils/split-send';

const COUNT_STEP = 100;
const inRange = (n: number, r: { min: number; max: number }) => Number.isInteger(n) && n >= r.min && n <= r.max;
const clamp = (n: number, r: { min: number; max: number }) => Math.max(r.min, Math.min(r.max, n));
const digits = (v: string) => v.replace(/[^0-9]/g, '').slice(0, 5);

interface Props {
  open: boolean;
  enabled: boolean;
  /** 한 번에 보낼 건수 */
  value: number;
  /** 보내는 간격(분) */
  interval: number;
  recipientCount: number;
  /** 예약 시각(있으면 그 시각부터 계산) */
  startAt: string | null;
  onApply: (count: number, intervalMinutes: number) => void;
  onOff: () => void;
  onClose: () => void;
}

export default function SplitSendPopover({ open, enabled, value, interval, recipientCount, startAt, onApply, onOff, onClose }: Props) {
  const [countText, setCountText] = useState(String(value || 1000));
  const [gapText, setGapText] = useState(String(interval || 1));
  const [preview, setPreview] = useState<SplitPreview | null>(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    setCountText(String(enabled && value ? value : 1000));
    setGapText(String(enabled && interval ? interval : 1));
  }, [open, enabled, value, interval]);

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

  const count = Number(countText);
  const gap = Number(gapText);
  const countOk = inRange(count, SPLIT_COUNT_RANGE);
  const gapOk = inRange(gap, SPLIT_INTERVAL_RANGE);
  const total = Math.max(0, recipientCount);
  const startIso = startAt && !Number.isNaN(new Date(startAt).getTime()) ? new Date(startAt).toISOString() : null;

  // 시각표 = 서버 계산(입력이 멈추면 한 번 · 늦게 온 옛 응답은 버린다)
  useEffect(() => {
    if (!open || !countOk || !gapOk || total === 0) { setPreview(null); setFailed(false); setLoading(false); return; }
    const ctrl = new AbortController();
    setLoading(true);
    const t = setTimeout(async () => {
      const p = await fetchSplitPreview({ total, count, interval: gap, startAt: startIso }, ctrl.signal);
      if (ctrl.signal.aborted) return;
      setPreview(p);
      setFailed(!p);
      setLoading(false);
    }, 250);
    return () => { clearTimeout(t); ctrl.abort(); };
  }, [open, countOk, gapOk, total, count, gap, startIso]);

  if (!open) return null;

  const step = (which: 'count' | 'gap', delta: number) => {
    if (which === 'count') setCountText(String(clamp((countOk ? count : 1000) + delta, SPLIT_COUNT_RANGE)));
    else setGapText(String(clamp((gapOk ? gap : 1) + delta, SPLIT_INTERVAL_RANGE)));
  };

  const overLimit = !!preview && !preview.withinLimit;
  const canApply = countOk && gapOk && !overLimit;
  const lastDay = preview ? kstDayLabel(preview.lastAt) : '';
  const crossesDay = !!preview && preview.rounds > 1 && lastDay !== kstDayLabel(preview.startAt);

  const renderPlan = () => {
    if (!countOk || !gapOk) return <div className="ds-split-plan__empty">건수와 간격을 정하면 언제 몇 건씩 나가는지 보여 드려요.</div>;
    if (total === 0) return <div className="ds-split-plan__empty">받는 사람을 넣으면 몇 번에 나눠 언제 다 나가는지 보여 드려요.</div>;
    if (!preview) {
      return <div className="ds-split-plan__empty">{failed ? '시각표를 불러오지 못했어요. 보낼 때 서버가 다시 확인해요.' : '시각표를 계산하고 있어요.'}</div>;
    }
    if (preview.rounds <= 1) {
      return <div className="ds-split-plan__empty"><b className="ds-num">{total.toLocaleString()}명</b>이 한 번에 다 나가요. 나눌 필요가 없어요.</div>;
    }
    let prevDay = kstDayLabel(preview.startAt);
    const rows: ReactNode[] = [];
    preview.slots.forEach((s, i) => {
      const isLast = s.index === preview.rounds - 1;
      if (isLast && preview.rounds > 5 && i > 0 && preview.slots[i - 1].index !== s.index - 1) {
        rows.push(<div key="gap" className="ds-split-tl__gap">⋮ {(preview.rounds - preview.slots.length).toLocaleString()}번 더</div>);
      }
      const day = kstDayLabel(s.at);
      if (day !== prevDay) {
        rows.push(<div key={`d${s.index}`} className="ds-split-tl__day">{day} 아침부터 이어서</div>);
        prevDay = day;
      }
      rows.push(
        <div key={s.index} className={`ds-split-tl__row${isLast ? ' is-last' : ''}`}>
          <i className="ds-split-tl__dot" />
          <span className="ds-split-tl__time ds-num">{kstHourMinute(s.at)}</span>
          <span className="ds-split-tl__cnt ds-num">{s.count.toLocaleString()}건</span>
          {isLast ? <span className="ds-split-tl__tag">끝</span> : <span />}
        </div>,
      );
    });
    return (
      <>
        <div className="ds-split-plan__top">
          <b className="ds-num">{total.toLocaleString()}명 → {preview.rounds.toLocaleString()}번에 나눠 보내요</b>
          <span className="ds-num">{lastDay} {kstHourMinute(preview.lastAt)} 끝</span>
        </div>
        <div className="ds-split-tl">{rows}</div>
      </>
    );
  };

  return (
    <div ref={ref} className="ds-split-pop" role="dialog" aria-label="나눠 보내기">
      <div className="ds-split-pop__head">
        <b>나눠 보내기</b>
        <small>정한 간격마다 정한 건수씩 차례로 보내요.</small>
      </div>
      <div className="ds-split-pop__body">
        <div className="ds-split-fields">
          <div className="ds-split-field">
            <label htmlFor="ds-split-count">한 번에 보낼 건수</label>
            <div className="ds-split-step">
              <button type="button" onClick={() => step('count', -COUNT_STEP)} aria-label="100건 줄이기">−</button>
              <input id="ds-split-count" type="text" inputMode="numeric" className="ds-num" value={countText}
                onChange={(e) => setCountText(digits(e.target.value))} />
              <span>건</span>
              <button type="button" onClick={() => step('count', COUNT_STEP)} aria-label="100건 늘리기">+</button>
            </div>
            <div className={`ds-split-hint${countOk ? '' : ' is-err'}`}>
              {countOk ? '1~9,999건' : '1~9,999건 사이로 적어 주세요'}
            </div>
          </div>
          <div className="ds-split-field">
            <label htmlFor="ds-split-gap">보내는 간격</label>
            <div className="ds-split-step">
              <button type="button" onClick={() => step('gap', -1)} aria-label="1분 줄이기">−</button>
              <input id="ds-split-gap" type="text" inputMode="numeric" className="ds-num" value={gapText}
                onChange={(e) => setGapText(digits(e.target.value))} />
              <span>분마다</span>
              <button type="button" onClick={() => step('gap', 1)} aria-label="1분 늘리기">+</button>
            </div>
            <div className={`ds-split-hint${gapOk ? '' : ' is-err'}`}>
              {gapOk ? '1~60분' : '1~60분 사이로 적어 주세요'}
            </div>
          </div>
        </div>

        <div className={`ds-split-plan${loading && preview ? ' is-stale' : ''}`}>{renderPlan()}</div>

        {overLimit ? (
          <div className="ds-split-note ds-split-note--rose">
            마지막 회차가 <b>{lastDay}</b>이라 너무 멀어요. {SPLIT_MAX_SPAN_DAYS}일 안에 끝나도록 한 번에 보낼 건수를 늘리거나 간격을 줄여 주세요.
          </div>
        ) : crossesDay ? (
          <div className="ds-split-note ds-split-note--amber">
            밤 9시~아침 8시에는 쉬었다가 <b>{lastDay}</b>까지 이어서 보내요.
          </div>
        ) : null}
        <span className="ds-split-fine">받는 사람 수는 중복·수신거부를 빼기 전 기준이에요. 시각은 실제 발송과 같은 규칙으로 계산해요.</span>
      </div>
      <div className="ds-split-pop__foot">
        <button type="button" className="ds-dlg__ghost" onClick={() => { onOff(); onClose(); }}>나누지 않기</button>
        <button type="button" className="ds-split-apply" disabled={!canApply} onClick={() => { onApply(count, gap); onClose(); }}>이대로 나눠 보내기</button>
      </div>
    </div>
  );
}
