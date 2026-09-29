/**
 * SendBar — 발송 창 맨 아래 발송 바: 왼쪽 = 예약·분할·광고 표기 3칸 · 오른쪽 = 발신번호(위로 열림) + 전송
 * (★2026-09-29 한줄로 V2 R112 · 직접발송 창 코드를 원본 그대로 옮김 · 원 설계 docs/2026-09-25-direct-send-precheck-design.md §2 발송 바)
 *
 * 쓰는 곳 = 직접발송 창(DirectSendPanel) · 직접 타겟 발송 창(TargetSendModal).
 * 창마다 다른 것만 props: 수신자별 회신번호 칸 목록(직접발송 = 파일 머리 · 타겟 = 번호 칸) · 전송 문구·색 · 수신자 수(분할 안내).
 * 스타일 = styles/direct-send.css(.ds-scope 안에서 쓴다).
 */
import { useState, useRef, useEffect } from 'react';
import { Send, X, Search, CalendarClock, ChevronDown, Megaphone, Timer } from 'lucide-react';
import SplitSendPopover from './SplitSendPopover';
import { splitTileLabel } from '../../utils/split-send';

export interface SendBarColumn {
  /** 고른 값(individualCallbackColumn) */
  key: string;
  /** 메뉴·발신번호 칸에 보이는 이름 */
  label: string;
  /** 첫 행 예시 값(없으면 '') */
  sample: string;
}

export interface SendBarProps {
  reserveEnabled: boolean;
  setReserveEnabled: (b: boolean) => void;
  reserveDateTime: string;
  setShowReservePicker: (b: boolean) => void;
  splitEnabled: boolean;
  setSplitEnabled: (b: boolean) => void;
  splitCount: number;
  setSplitCount: (n: number) => void;
  splitInterval: number;
  setSplitInterval: (n: number) => void;
  /** 분할 풍선의 회차 안내용 */
  recipientCount: number;
  adTextEnabled: boolean;
  handleAdToggle: (enabled: boolean) => void;
  callbackNumbers: { id: string; phone: string; label?: string; is_default?: boolean }[];
  selectedCallback: string;
  setSelectedCallback: (s: string) => void;
  useIndividualCallback: boolean;
  setUseIndividualCallback: (b: boolean) => void;
  individualCallbackColumn: string;
  setIndividualCallbackColumn: (col: string) => void;
  individualColumns: SendBarColumn[];
  /** 수신자별 칸을 골랐을 때(타겟 = 서버 보관본 회신번호 채우기) */
  onIndividualColumnPicked?: (key: string) => void;
  formatPhoneNumber: (phone: string) => string;
  sendLabel: string;
  onSend: () => void;
  sendDisabled: boolean;
  /** 전송 버튼 색(.ks-send--indigo 등) — 없으면 직접발송 초록 */
  sendClassName?: string;
  /** 발송 바에 덧붙일 클래스 */
  className?: string;
}

export default function SendBar(props: SendBarProps) {
  const {
    reserveEnabled, setReserveEnabled, reserveDateTime, setShowReservePicker,
    splitEnabled, setSplitEnabled, splitCount, setSplitCount, splitInterval, setSplitInterval,
    recipientCount, adTextEnabled, handleAdToggle,
    callbackNumbers, selectedCallback, setSelectedCallback,
    useIndividualCallback, setUseIndividualCallback, individualCallbackColumn, setIndividualCallbackColumn,
    individualColumns, onIndividualColumnPicked, formatPhoneNumber,
    sendLabel, onSend, sendDisabled, sendClassName, className,
  } = props;

  // ★ D137 UI: 회신번호 커스텀 드롭다운 (native select 대체 — 5개 이상 스크롤 + 검색)
  const [callbackMenuOpen, setCallbackMenuOpen] = useState(false);
  const [callbackSearch, setCallbackSearch] = useState('');
  const callbackMenuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!callbackMenuOpen) return;
    const handler = (e: MouseEvent) => {
      if (callbackMenuRef.current && !callbackMenuRef.current.contains(e.target as Node)) {
        setCallbackMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [callbackMenuOpen]);
  useEffect(() => {
    if (!callbackMenuOpen) setCallbackSearch('');
  }, [callbackMenuOpen]);

  // ── 분할 풍선 ──
  const [splitOpen, setSplitOpen] = useState(false);

  // ★ 2026-09-29 R112 옮김 — 원본 = 직접발송 창 발송 바 앞 계산(수신자별 칸 목록만 호출부가 준다)
  const individualLabel = individualColumns.find(c => c.key === individualCallbackColumn)?.label || individualCallbackColumn;
  const selectedLabel = useIndividualCallback && individualCallbackColumn
    ? `${individualLabel} (수신자별)`
    : selectedCallback
      ? (() => {
          const cb = callbackNumbers.find(c => c.phone === selectedCallback);
          return cb
            ? `${formatPhoneNumber(cb.phone)}${cb.label ? ` (${cb.label})` : ''}`
            : formatPhoneNumber(selectedCallback);
        })()
      : '';
  const selectedIsDefault = !!(selectedCallback && callbackNumbers.find(c => c.phone === selectedCallback)?.is_default);
  const q = callbackSearch.trim().toLowerCase();
  const filteredColumns = q
    ? individualColumns.filter(c => c.label.toLowerCase().includes(q))
    : individualColumns;
  const filteredCallbacks = q
    ? callbackNumbers.filter(cb =>
        cb.phone.replace(/-/g, '').includes(q.replace(/-/g, '')) ||
        (cb.label || '').toLowerCase().includes(q)
      )
    : callbackNumbers;

  return (
    <footer className={`ds-modal__foot ds-modal__foot--send${className ? ` ${className}` : ''}`}>
      <div className="ds-foot-opts ds-foot-opts--reserve">
        {/* 예약 */}
        <div className="ds-opt-anchor ds-opt-anchor--reserve">
          <button
            type="button"
            className={`ds-tile ds-tile--opt ${reserveEnabled ? 'ds-tile--opt-blue' : ''}`}
            onClick={() => { if (!reserveEnabled) setReserveEnabled(true); setShowReservePicker(true); }}
          >
            <span className="ds-tile__ic"><CalendarClock size={17} strokeWidth={2} /></span>
            <span className="ds-tile__tx">
              <span className="ds-tile__t1">예약</span>
              <span className="ds-tile__t2">
                {reserveEnabled
                  ? (reserveDateTime
                    ? new Date(reserveDateTime).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
                    : '시각을 골라 주세요')
                  : '지금 보내기'}
              </span>
            </span>
            {!reserveEnabled && <ChevronDown size={14} strokeWidth={2} className="ds-tile__caret" />}
          </button>
          {reserveEnabled && (
            <button type="button" className="ds-tile__clear" onClick={() => setReserveEnabled(false)} aria-label="예약 풀기" title="예약 풀기">
              <X size={12} strokeWidth={2.4} />
            </button>
          )}
        </div>
        {/* 분할 — 누르면 몇 건씩·몇 분마다 나눌지 묻는다(★0928) */}
        <div className="ds-opt-anchor">
          <button
            type="button"
            data-split-anchor
            className={`ds-tile ds-tile--opt ${splitEnabled ? 'ds-tile--opt-violet' : ''}`}
            onClick={() => setSplitOpen((o) => !o)}
            aria-haspopup="dialog"
            aria-expanded={splitOpen}
          >
            <span className="ds-tile__ic"><Timer size={17} strokeWidth={2} /></span>
            <span className="ds-tile__tx">
              <span className="ds-tile__t1">분할</span>
              <span className="ds-tile__t2">{splitEnabled ? splitTileLabel(splitCount, splitInterval) : '안 함'}</span>
            </span>
            <ChevronDown size={14} strokeWidth={2} className="ds-tile__caret" />
          </button>
          <SplitSendPopover
            open={splitOpen}
            enabled={splitEnabled}
            value={splitCount}
            interval={splitInterval}
            recipientCount={recipientCount}
            startAt={reserveEnabled && reserveDateTime ? reserveDateTime : null}
            onApply={(n, g) => { setSplitCount(n); setSplitInterval(g); setSplitEnabled(true); }}
            onOff={() => setSplitEnabled(false)}
            onClose={() => setSplitOpen(false)}
          />
        </div>
        {/* 광고 표기 */}
        <div className="ds-opt-anchor">
          <button
            type="button"
            role="switch"
            aria-checked={adTextEnabled}
            className={`ds-tile ds-tile--opt ${adTextEnabled ? 'ds-tile--opt-amber' : ''}`}
            onClick={() => handleAdToggle(!adTextEnabled)}
          >
            <span className="ds-tile__ic"><Megaphone size={17} strokeWidth={2} /></span>
            <span className="ds-tile__tx">
              <span className="ds-tile__t1">광고 표기</span>
              <span className="ds-tile__t2">{adTextEnabled ? '(광고) · 080 붙음' : '안 붙음'}</span>
            </span>
            <span className="ds-switch" aria-hidden />
          </button>
        </div>
      </div>
      <div className="ds-modal__vdiv" />
      <div className="ds-foot-send">
        <div className="ds-sender" ref={callbackMenuRef}>
          <button
            type="button"
            className={`ds-sender__btn ${!selectedLabel ? 'ds-sender__btn--empty' : ''}`}
            onClick={() => setCallbackMenuOpen(o => !o)}
            aria-haspopup="menu"
            aria-expanded={callbackMenuOpen}
            title={selectedLabel || '회신번호 선택'}
          >
            <span className="min-w-0">
              <span className="ds-sender__lab">발신번호</span>
                  <span className="ds-sender__val">
                    {useIndividualCallback && individualCallbackColumn ? (
                      <>
                        <span className="ds-sender__eq">= {individualLabel}</span>
                        <span className="ds-sender__tag ds-sender__tag--col">수신자별</span>
                      </>
                    ) : selectedCallback ? (
                      <>
                        <span className="ds-num">{formatPhoneNumber(selectedCallback)}</span>
                        {selectedIsDefault && <span className="ds-sender__tag ds-sender__tag--rep">대표</span>}
                      </>
                    ) : (
                      <span className="text-stone-400">회신번호 선택</span>
                    )}
                  </span>
            </span>
            <ChevronDown size={15} strokeWidth={2} className="ds-sender__chev" />
          </button>
                  {callbackMenuOpen && (
                    <div className="ds-callback-menu" role="menu">
                      {callbackNumbers.length + individualColumns.length > 5 && (
                        <div className="ds-callback-menu__search">
                          <Search size={13} strokeWidth={1.75} />
                          <input
                            type="text"
                            autoFocus
                            placeholder="번호·라벨 검색"
                            value={callbackSearch}
                            onChange={(e) => setCallbackSearch(e.target.value)}
                          />
                        </div>
                      )}
                      <div className="ds-callback-menu__scroll">
                        {filteredColumns.length > 0 && (
                          <>
                            <div className="ds-callback-menu__group">수신자별 회신번호 컬럼</div>
                            {filteredColumns.map(col => {
                              // ★ D150-3 (2026-05-09) PDF #5: 0/'0' 보존 — 예시 값은 호출부가 보존해 만든다
                              const sample = col.sample;
                              const isActive = useIndividualCallback && individualCallbackColumn === col.key;
                              return (
                                <button
                                  key={col.key}
                                  type="button"
                                  role="menuitem"
                                  className={`ds-callback-item ${isActive ? 'ds-callback-item--on' : ''}`}
                                  onClick={() => {
                                    setUseIndividualCallback(true);
                                    setSelectedCallback('');
                                    setIndividualCallbackColumn(col.key);
                                    setCallbackMenuOpen(false);
                                    onIndividualColumnPicked?.(col.key);
                                  }}
                                >
                                  <span className="ds-callback-item__label">{col.label} <span className="ds-callback-item__hint">(수신자별)</span></span>
                                  {sample !== '' && <span className="ds-callback-item__sample">예: {sample.slice(0, 15)}</span>}
                                </button>
                              );
                            })}
                          </>
                        )}
                        <div className="ds-callback-menu__group">등록된 회신번호{callbackSearch && ` · ${filteredCallbacks.length}건`}</div>
                        {callbackNumbers.length === 0 ? (
                          <div className="ds-callback-menu__empty">등록된 회신번호가 없습니다</div>
                        ) : filteredCallbacks.length === 0 ? (
                          <div className="ds-callback-menu__empty">검색 결과가 없습니다</div>
                        ) : (
                          filteredCallbacks.map((cb) => {
                            const isActive = !useIndividualCallback && selectedCallback === cb.phone;
                            return (
                              <button
                                key={cb.id}
                                type="button"
                                role="menuitem"
                                className={`ds-callback-item ${isActive ? 'ds-callback-item--on' : ''}`}
                                onClick={() => {
                                  setUseIndividualCallback(false);
                                  setSelectedCallback(cb.phone);
                                  setIndividualCallbackColumn('');
                                  setCallbackMenuOpen(false);
                                }}
                              >
                                <span className="ds-callback-item__label">
                                  {formatPhoneNumber(cb.phone)}
                                  {cb.label && <span className="ds-callback-item__hint"> ({cb.label})</span>}
                                </span>
                                {cb.is_default && <span className="ds-callback-item__star">⭐</span>}
                              </button>
                            );
                          })
                        )}
                      </div>
                    </div>
                  )}
        </div>
        <button type="button" className={`ds-send-btn${sendClassName ? ` ${sendClassName}` : ''}`} onClick={onSend} disabled={sendDisabled}>
          <Send size={17} strokeWidth={2} />
          <span>{sendLabel}</span>
        </button>
      </div>
    </footer>
  );
}
