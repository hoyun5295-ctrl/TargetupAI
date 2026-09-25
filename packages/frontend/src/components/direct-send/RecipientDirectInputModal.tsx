/**
 * ★ 2026-09-25 직접입력 창 — 문자 발송 · 알림톡 · 브랜드메시지 공용(Harold 목업 v2 승인 · "메모장에서 번호만 쭉 붙여넣는 사람도 있다").
 *
 * 두 방식(토글):
 *   [번호 붙여넣기]       메모장·엑셀에서 번호만 복사해 넣는다. 입력하는 동안 검수(추가될 수 · 중복 · 형식 오류)를 바로 보여 준다.
 *   [변수와 함께 한 건씩] 이름·주문번호처럼 사람마다 다른 값을 같이 넣는다. 칸은 부르는 창이 정한다(문구 변수 · 템플릿 변수).
 *   rows 를 안 주면(브랜드) 토글 없이 붙여넣기만.
 *
 * ⛔ 이 창은 번호를 읽거나 명단을 바꾸지 않는다 — 검수(previewPaste)와 더하기(onSubmitPaste · rows.onAdd)는 부르는 창이 소유한다.
 *    같은 읽기 함수(utils/recipient-paste.ts)로 검수와 더하기를 해야 "보인 수 = 더해진 수"가 된다.
 * ESC = 이 창만 닫는다(캡처 단계에서 먼저 잡아 뒤의 발송 창이 같이 닫히지 않게 · 고르기 창과 같은 방식).
 */
import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { PencilLine, ClipboardPaste, TableProperties, X } from 'lucide-react';
import '../../styles/direct-send.css';

export type DirectInputTone = 'emerald' | 'amber' | 'violet';

export interface DirectInputField {
  key: string;
  label: string;
  /** 칸 옆에 붙는 변수 표시(%이름% · #{이름}) */
  tag?: string;
}

export interface PastePreview {
  /** 더해질 수 */
  add: number;
  /** 알림 칩(중복 제외 · 여러 번 나감 등) */
  notes: Array<{ text: string; tone: 'neutral' | 'warn' }>;
  /** 번호로 읽지 못한 줄·토막 */
  invalid: string[];
}

export type RowAddResult = { ok: true; phone: string } | { ok: false; error: string };

interface Props {
  open: boolean;
  onClose: () => void;
  tone: DirectInputTone;
  unit: '건' | '명';
  currentCount: number;
  pasteHint: string;
  pastePlaceholder: string;
  previewPaste: (text: string) => PastePreview;
  /** 더한 뒤 창은 이 컴포넌트가 닫는다 */
  onSubmitPaste: (text: string) => void;
  /** 붙여넣기 방식에서 한 줄 경고(문구에 변수가 있는데 번호만 넣는 경우 등) */
  pasteWarning?: string | null;
  rows?: {
    fields: DirectInputField[];
    /** 처음 열 때 한 건씩 방식으로 */
    initial?: boolean;
    /** 값이 있으면 두 번째 방식을 잠그고 이유를 보여 준다 */
    disabledReason?: string | null;
    onAdd: (values: Record<string, string>) => RowAddResult;
  };
}

type Mode = 'paste' | 'rows';

export default function RecipientDirectInputModal({
  open, onClose, tone, unit, currentCount, pasteHint, pastePlaceholder, previewPaste, onSubmitPaste, pasteWarning, rows,
}: Props) {
  const rowsUsable = !!rows && !rows.disabledReason;
  const [mode, setMode] = useState<Mode>('paste');
  const [text, setText] = useState('');
  const [values, setValues] = useState<Record<string, string>>({});
  const [added, setAdded] = useState<Array<Record<string, string>>>([]);
  const [rowError, setRowError] = useState('');
  const phoneRef = useRef<HTMLInputElement | null>(null);
  const textRef = useRef<HTMLTextAreaElement | null>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  // 열 때마다 새로 시작한다(지난번에 넣다 만 글이 다음 창에 남지 않게)
  useEffect(() => {
    if (!open) return;
    setMode(rows && rowsUsable && rows.initial ? 'rows' : 'paste');
    setText('');
    setValues({});
    setAdded([]);
    setRowError('');
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!open) return;
    const t = window.setTimeout(() => { (mode === 'rows' ? phoneRef.current : textRef.current)?.focus(); }, 0);
    return () => window.clearTimeout(t);
  }, [open, mode]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !e.isComposing) { e.stopPropagation(); onCloseRef.current(); }
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [open]);

  if (!open) return null;

  const preview = text.trim() ? previewPaste(text) : { add: 0, notes: [], invalid: [] } as PastePreview;
  const submitPaste = () => {
    if (preview.add === 0) return;
    onSubmitPaste(text);
    onClose();
  };

  const fields = rows?.fields || [];
  const addRow = () => {
    if (!rows) return;
    const res = rows.onAdd(values);
    if (!res.ok) { setRowError(res.error); return; }
    setAdded((prev) => [{ ...values, phone: res.phone }, ...prev]);
    setValues({});
    setRowError('');
    phoneRef.current?.focus();
  };
  const onRowKey = (e: ReactKeyboardEvent) => {
    if (e.key === 'Enter' && !(e.nativeEvent as KeyboardEvent).isComposing) { e.preventDefault(); addRow(); }
  };

  const invalidText = preview.invalid.length > 0
    ? `형식 오류 ${preview.invalid.length}줄 · ${preview.invalid[0].slice(0, 20)}${preview.invalid.length > 1 ? ` 외 ${preview.invalid.length - 1}` : ''}`
    : '';

  return createPortal(
    <div className={`rdi-back rdi--${tone}`} role="dialog" aria-modal="true" aria-label="직접입력">
      <div className="rdi">
        <div className="rdi-head">
          <div className="rdi-ic"><PencilLine size={17} strokeWidth={1.9} /></div>
          <div className="min-w-0">
            <div className="rdi-t">직접입력</div>
            <div className="rdi-s">받는 번호를 넣으면 지금 명단에 더해져요</div>
          </div>
          <button type="button" className="rdi-x" onClick={onClose} aria-label="닫기"><X size={16} strokeWidth={1.9} /></button>
        </div>

        {rows && (
          <div className="rdi-seg" role="tablist">
            <button type="button" role="tab" aria-selected={mode === 'paste'} className={mode === 'paste' ? 'on' : ''} onClick={() => setMode('paste')}>
              <ClipboardPaste size={14} strokeWidth={1.9} />번호 붙여넣기
            </button>
            <button type="button" role="tab" aria-selected={mode === 'rows'} className={mode === 'rows' ? 'on' : ''}
              disabled={!rowsUsable} title={rows.disabledReason || undefined} onClick={() => setMode('rows')}>
              <TableProperties size={14} strokeWidth={1.9} />변수와 함께 한 건씩
            </button>
          </div>
        )}

        {mode === 'paste' ? (
          <>
            <div className="rdi-body">
              <div className="rdi-lab">받는 번호 <span>{pasteHint}</span></div>
              <textarea
                ref={textRef}
                className="rdi-ta"
                value={text}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); submitPaste(); } }}
                placeholder={pastePlaceholder}
                aria-label="받는 번호"
                spellCheck={false}
              />
              {text.trim() && (
                <div className="rdi-sum" aria-live="polite">
                  <span className="rdi-chip rdi-chip--a">추가 {preview.add.toLocaleString()}{unit}</span>
                  {preview.notes.map((n) => (
                    <span key={n.text} className={`rdi-chip ${n.tone === 'warn' ? 'rdi-chip--w' : ''}`}>{n.text}</span>
                  ))}
                  {invalidText && <span className="rdi-chip rdi-chip--w">{invalidText}</span>}
                </div>
              )}
              {rows?.disabledReason && <p className="rdi-hint">{rows.disabledReason}</p>}
              {pasteWarning && <p className="rdi-warn">{pasteWarning}</p>}
            </div>
            <div className="rdi-foot">
              <div className="rdi-note">
                지금 명단 <b>{currentCount.toLocaleString()}{unit}</b>
                {preview.add > 0 && <> → 추가하면 <b>{(currentCount + preview.add).toLocaleString()}{unit}</b></>}
              </div>
              <button type="button" className="rdi-btn-g" onClick={onClose}>취소</button>
              <button type="button" className="rdi-btn-p" onClick={submitPaste} disabled={preview.add === 0}>
                {preview.add > 0 ? `${preview.add.toLocaleString()}${unit} 추가` : '추가'}
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="rdi-body">
              <div className={`rdi-fields ${fields.length + 1 > 3 ? 'rdi-fields--wrap' : ''}`} style={{ ['--rdi-cols' as any]: String(fields.length + 1) }}>
                <div className="rdi-f">
                  <label htmlFor="rdi-phone">수신번호 <em>*</em></label>
                  <input id="rdi-phone" ref={phoneRef} className="rdi-in" inputMode="tel" placeholder="01012345678"
                    value={values.phone || ''} onChange={(e) => { setValues((v) => ({ ...v, phone: e.target.value })); if (rowError) setRowError(''); }}
                    onKeyDown={onRowKey} />
                </div>
                {fields.map((f) => (
                  <div className="rdi-f" key={f.key}>
                    <label htmlFor={`rdi-${f.key}`}>{f.label}{f.tag && <span className="rdi-var">{f.tag}</span>}</label>
                    <input id={`rdi-${f.key}`} className="rdi-in" placeholder={f.label}
                      value={values[f.key] || ''} onChange={(e) => { setValues((v) => ({ ...v, [f.key]: e.target.value })); if (rowError) setRowError(''); }}
                      onKeyDown={onRowKey} />
                  </div>
                ))}
                <button type="button" className="rdi-add" onClick={addRow}>추가</button>
              </div>
              {rowError
                ? <p className="rdi-err" role="alert">{rowError}</p>
                : <p className="rdi-hint">Enter 로도 추가돼요 · 추가하면 수신번호 칸으로 돌아가요</p>}
              {added.length > 0 && (
                <div className="rdi-added">
                  <div className="rdi-added-h"><span>이번에 넣은 번호</span><b>{added.length.toLocaleString()}{unit}</b></div>
                  <div className="rdi-added-list">
                    {added.map((a, i) => (
                      <div className="rdi-ar" key={`${a.phone}-${added.length - i}`}
                        style={{ gridTemplateColumns: `minmax(104px, 1.3fr) repeat(${Math.max(fields.length, 1)}, minmax(0, 1fr))` }}>
                        <span>{a.phone}</span>
                        {fields.map((f) => <span key={f.key} className={a[f.key] ? '' : 'dim'}>{a[f.key] || '-'}</span>)}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
            <div className="rdi-foot">
              <div className="rdi-note">명단 합계 <b>{currentCount.toLocaleString()}{unit}</b></div>
              <button type="button" className="rdi-btn-p" onClick={onClose}>다 넣었어요</button>
            </div>
          </>
        )}
      </div>
    </div>,
    document.body,
  );
}
