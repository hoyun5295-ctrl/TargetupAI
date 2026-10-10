/**
 * LineFacts.tsx — 한줄로 시그니처 칸 묶음 · 묻는 창 · 보강 시트 (★ 2026-10-05 · 설계서 docs/2026-10-05-hanjul-signature-design.md §3 · §4)
 *
 * "저희가 지어낼 수 없는 사실만 한 번 여쭙니다." 1차 칸 = 혜택(생성 전) · 기간(이메일 채우기).
 *   - 프리필 0(AI 임의 혜택 금지) · [없음] = null(다시 묻지 않는다) · 칸 안 Enter 는 제출이 아니다.
 *   - 묻는 창(허브 문자) = 생성 전 · 판정이 걸렸을 때만 · 백드롭 닫힘 없음 · 닫기 = 취소.
 *   - 보강 시트 = 생성 뒤 · 완성본이 보인 채(데스크톱 오른쪽 · 모바일 아래) · 포털(편집기 transform 에 갇히지 않게).
 * ⛔ 모델명 0 · 줄표 0 · native dialog 0.
 */
import { useEffect, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X, Sparkles, Check, Loader2, ShoppingBag } from 'lucide-react';
import { MK_INPUT, MK_BTN_OUTLINE, MK_BTN_AI, MK_BTN_PRIMARY, MK_MODAL } from '../../utils/make-ui';
import { fetchLineMallCandidates, type LineMallCandidate } from '../../utils/one-line';

export type LineFactsField = 'benefit' | 'period';
export interface LineFactsValues {
  /** undefined = 아직 안 건드림 · null = [없음] · 문자열 = 사용자가 적은 값 */
  benefit?: string | null;
  period?: string | null;
}

export const LINE_FACTS_REASON = '혜택 숫자는 AI가 지어내지 않아요. 적어 주시면 그대로 쓰고, 비워도 만들어요';

const FIELD_META: Record<LineFactsField, { label: string; placeholder: string; gain: string }> = {
  benefit: { label: '혜택', placeholder: '예: 전 상품 20% · 첫 구매 5천원 쿠폰', gain: '주시면 첫 줄이 혜택으로 시작해요' },
  period: { label: '기간', placeholder: '예: 10월 11일(토)까지', gain: '주시면 마감이 함께 실려요' },
};

const stopEnter = (e: React.KeyboardEvent) => { if (e.key === 'Enter') e.preventDefault(); };

/** 칸 묶음 — 받은 키만 그린다 */
export function LineFacts({ fields, values, onChange, allowNone = true }: {
  fields: readonly LineFactsField[];
  values: LineFactsValues;
  onChange: (next: LineFactsValues) => void;
  /** [없음] 칩(생성 전 묻기에서만 · 채우기 시트에서는 비우면 그대로라 필요 없다) */
  allowNone?: boolean;
}) {
  return (
    <div className="space-y-3 [&_input]:text-slate-900 [&_input]:bg-white">
      {fields.map((f) => {
        const meta = FIELD_META[f];
        const v = values[f];
        const none = v === null;
        return (
          <div key={f}>
            <div className="flex items-center justify-between gap-2 mb-1.5">
              <label className="text-[13px] font-bold text-slate-900" htmlFor={`line-facts-${f}`}>{meta.label}</label>
              <span className="text-[12px] text-slate-500">{meta.gain}</span>
            </div>
            <div className="flex items-center gap-2">
              <input
                id={`line-facts-${f}`}
                className={`${MK_INPUT} !h-11 min-w-0 flex-1`}
                value={typeof v === 'string' ? v : ''}
                placeholder={none ? '없음으로 만들어요' : meta.placeholder}
                maxLength={300}
                disabled={none}
                onKeyDown={stopEnter}
                onChange={(e) => onChange({ ...values, [f]: e.target.value })}
              />
              {allowNone && (
                <button
                  type="button"
                  aria-pressed={none}
                  onClick={() => onChange({ ...values, [f]: none ? undefined : null })}
                  className={`shrink-0 h-11 px-3.5 rounded-xl border text-[13px] font-semibold transition-colors ${none ? 'border-indigo-300 bg-indigo-50 text-indigo-800' : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'}`}
                >
                  없음
                </button>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** 사용자가 적은 혜택(공백뿐이면 없음) */
export function typedBenefit(values: LineFactsValues): string | null {
  const b = typeof values.benefit === 'string' ? values.benefit.trim() : '';
  return b ? b : null;
}

// ─────────────── 몰 상품 고르기(★ 2026-10-10 · 설계서 docs/2026-10-10-oneline-dm-email-design.md §5) ───────────────

/** 한 줄 확인 창의 몰 상품 칸 — 무엇을 찾을지 · 무엇을 골랐는지 · 후보가 실제로 보였는지(보였을 때만 서버에 상품 칸을 보낸다) */
export interface LineMallState {
  terms: string[];
  /** 한 줄에 적은 혜택 % (담은 상품 아래 안내 한 줄) */
  percents: number[];
  picked: LineMallCandidate[];
  onPicked: (next: LineMallCandidate[]) => void;
  /** 후보가 1개 이상 보였는가(0건 · 실패 · 시간 초과 · 몰 미연동 = false → 지금처럼 이름 첨부) */
  onShown: (shown: boolean) => void;
}

const won = (n: number) => `${Math.round(Number(n) || 0).toLocaleString()}원`;
const LINE_MALL_GRID_MIN_H = 'min-h-[148px]';

/**
 * 몰 상품 3칸 격자 — 기본 체크 0(Harold 결정 H1). 정확 일치는 테두리 + 「상품명이 같아요」 표식만. 누른 것만 담는다.
 * 자리를 먼저 잡고(창이 튀지 않게) 후보가 오면 채운다. 몰 미연동 = 그리지 않는다 · 0건 = 한 줄로 접는다.
 */
export function LineMallPick({ mall }: { mall: LineMallState }) {
  const [state, setState] = useState<{ phase: 'loading' | 'done' | 'off'; list: LineMallCandidate[] }>({ phase: 'loading', list: [] });
  const termsKey = mall.terms.join('|');
  useEffect(() => {
    const ctrl = new AbortController();
    setState({ phase: 'loading', list: [] });
    mall.onShown(false);
    void fetchLineMallCandidates(mall.terms, ctrl.signal).then((r) => {
      if (ctrl.signal.aborted) return;
      setState({ phase: r.mallReady ? 'done' : 'off', list: r.candidates });
      mall.onShown(r.mallReady && r.candidates.length > 0);
    });
    return () => ctrl.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [termsKey]);
  if (state.phase === 'off') return null;
  const key = (c: LineMallCandidate) => `${c.provider}:${c.no}`;
  const pickedKeys = new Set(mall.picked.map(key));
  const toggle = (c: LineMallCandidate) => mall.onPicked(pickedKeys.has(key(c)) ? mall.picked.filter((p) => key(p) !== key(c)) : [...mall.picked, c]);
  return (
    <div data-line="mall-pick">
      <div className="flex items-center gap-1.5 text-[13px] font-bold text-slate-900 mb-1.5"><ShoppingBag className="w-3.5 h-3.5 text-emerald-700" />몰에서 찾은 상품이에요</div>
      {state.phase === 'loading' ? (
        <div className={`${LINE_MALL_GRID_MIN_H} rounded-xl bg-slate-50 flex items-center justify-center text-slate-400`}><Loader2 className="w-5 h-5 animate-spin" /></div>
      ) : state.list.length === 0 ? (
        <div className="rounded-xl bg-slate-50 px-3 py-2.5 text-[12.5px] text-slate-500">몰에서 찾은 상품이 없어요. 상품 없이 만들어요</div>
      ) : (
        <div className="grid grid-cols-3 gap-2">
          {state.list.map((c) => {
            const on = pickedKeys.has(key(c));
            return (
              <button key={key(c)} type="button" onClick={() => toggle(c)} aria-pressed={on}
                className={`text-left rounded-xl p-1.5 border transition-colors ${on ? 'border-violet-400 bg-violet-50' : c.exact ? 'border-emerald-300 bg-white' : 'border-slate-200 bg-white hover:bg-slate-50'}`}>
                <span className="relative block w-full aspect-square rounded-lg overflow-hidden bg-slate-100">
                  {c.imageUrl ? <img src={c.imageUrl} alt="" className="w-full h-full object-cover" /> : null}
                  {on && <em className="absolute right-1 top-1 w-5 h-5 rounded-full bg-violet-600 text-white flex items-center justify-center"><Check className="w-3 h-3" /></em>}
                </span>
                <span className="block text-[11.5px] text-slate-700 mt-1.5 leading-tight line-clamp-2 min-h-[28px]">{c.name}</span>
                <span className="block text-[12px] font-bold text-slate-900 mt-0.5">{won(c.salePrice || c.price)}</span>
                {c.exact && <span className="block text-[10.5px] font-semibold text-emerald-700 mt-0.5">상품명이 같아요</span>}
              </button>
            );
          })}
        </div>
      )}
      <p className="text-[12px] text-slate-500 mt-2"><b className="text-slate-900">담은 상품 {mall.picked.length}개</b> · 누르면 담기고, 사진 · 가격 · 링크는 만들 때 몰에서 다시 확인해요</p>
      {mall.picked.length > 0 && mall.percents.length > 0 && (
        <p className="text-[12px] text-slate-500 mt-1">상품 가격은 몰 판매가 그대로 실어요. 적어 주신 {mall.percents.map((p) => `${p}%`).join('·')}는 혜택 문구로 들어가요</p>
      )}
    </div>
  );
}

/** 칸 수에 맞춘 머리 문구 */
function lineAskTitle(askBenefit: boolean, mall: boolean, read = false): string {
  if ((askBenefit ? 1 : 0) + (mall ? 1 : 0) + (read ? 1 : 0) > 1) return '만들기 전에 확인할게요';
  if (mall) return '몰에서 찾은 상품이 맞나요?';
  if (read) return '사진에서 읽은 글을 확인해 주세요';
  return '만들기 전에 하나만 여쭐게요';
}

/** ★ 2026-10-10 Harold 결정 H3 — 사진에서 읽은 글의 숫자는 기본으로 쓰지 않는다(판독 오독 방지) · 켜면 그대로 쓴다 */
export interface LineReadCheck { checked: boolean; onChange: (v: boolean) => void }
function LineReadToggle({ read }: { read: LineReadCheck }) {
  return (
    <label className="flex items-start gap-2.5 rounded-xl border border-slate-200 bg-white px-3 py-2.5 cursor-pointer select-none" data-line="read-check">
      <input type="checkbox" className="mt-0.5 accent-violet-600" checked={read.checked} onChange={(e) => read.onChange(e.target.checked)} />
      <span className="min-w-0">
        <span className="block text-[13px] font-semibold text-slate-900">사진에서 읽은 숫자도 그대로 쓰기</span>
        <span className="block text-[12px] text-slate-500 mt-0.5 leading-relaxed">사진 글자는 잘못 읽힐 수 있어 기본은 꺼 둬요. 끄면 사진 속 할인 · 가격 숫자는 싣지 않아요</span>
      </span>
    </label>
  );
}

/**
 * 생성 전 확인 창 안에 넣는 블록(크레딧 확인 창 extraContent).
 * ★ 2026-10-10 mall(몰 상품 칸) · askBenefit(혜택 칸 · 기본 true) 선택 prop — 미지정 = 지금 그대로(혜택 칸만).
 */
export function LineFactsInline({ values, onChange, askBenefit = true, mall, readCheck }: { values: LineFactsValues; onChange: (v: LineFactsValues) => void; askBenefit?: boolean; mall?: LineMallState; readCheck?: LineReadCheck }) {
  return (
    <div className="rounded-xl border border-violet-200 bg-violet-50/40 px-3.5 py-3">
      <div className="flex items-center gap-1.5 text-[13px] font-bold text-slate-900 mb-1"><Sparkles className="w-3.5 h-3.5 text-violet-700" />{lineAskTitle(askBenefit, !!mall, !!readCheck)}</div>
      {askBenefit && <p className="text-[12px] text-slate-500 mb-3 leading-relaxed">{LINE_FACTS_REASON}</p>}
      {askBenefit && <LineFacts fields={['benefit']} values={values} onChange={onChange} />}
      {mall && <div className={askBenefit ? 'mt-4' : 'mt-2'}><LineMallPick mall={mall} /></div>}
      {readCheck && <div className={askBenefit || mall ? 'mt-4' : 'mt-2'}><LineReadToggle read={readCheck} /></div>}
      {(mall || readCheck) && <p className="text-[11.5px] text-slate-400 mt-3">비워 두셔도 만들어요</p>}
    </div>
  );
}

/** 허브 문자처럼 확인 창이 없는 입구의 생성 전 묻는 창(판정이 걸렸을 때만 연다) */
export function LineFactsAskModal({ open, line, onCancel, onSubmit, askBenefit = true, mall, onSubmitAll, readCheck }: {
  open: boolean;
  line: string;
  onCancel: () => void;
  onSubmit: (benefit: string | null) => void;
  /** ★ 2026-10-10 혜택 칸을 그릴지(기본 true · 허브 문자 = 지금 그대로) */
  askBenefit?: boolean;
  /** ★ 2026-10-10 몰 상품 칸(한 줄 이메일) */
  mall?: LineMallState;
  /** ★ 2026-10-10 지정하면 버튼이 [만들기] 하나(비워도 만든다) · 혜택 답(물은 경우만)을 함께 넘긴다 */
  onSubmitAll?: (benefit: string | null | undefined) => void;
  /** ★ 2026-10-10 H3 — 한 줄에 사진 글이 붙어 있을 때 「사진에서 읽은 숫자도 그대로 쓰기」(기본 꺼짐) */
  readCheck?: LineReadCheck;
}) {
  const [values, setValues] = useState<LineFactsValues>({});
  useEffect(() => { if (open) setValues({}); }, [open]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onCancel(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onCancel]);
  if (!open) return null;
  const typed = typedBenefit(values);
  const title = onSubmitAll ? lineAskTitle(askBenefit, !!mall, !!readCheck) : '만들기 전에 하나만 여쭐게요';
  return createPortal(
    <div className="fixed inset-0 z-[2000] flex items-center justify-center bg-black/50 backdrop-blur-sm px-4" role="dialog" aria-modal="true" aria-label={title}>
      <div className={`${MK_MODAL} w-full max-w-md p-6 ${onSubmitAll ? 'max-h-[calc(100dvh-2rem)] flex flex-col' : ''}`}>
        <div className="flex items-start gap-3 mb-3">
          <div className="min-w-0">
            <div className="text-[15px] font-bold text-slate-900">{title}</div>
            {askBenefit && <p className="text-[12.5px] text-slate-500 mt-1 leading-relaxed">{LINE_FACTS_REASON}</p>}
          </div>
          <button type="button" onClick={onCancel} aria-label="닫기" className="ml-auto p-1 rounded-lg hover:bg-slate-100 shrink-0"><X className="w-4 h-4 text-slate-400" /></button>
        </div>
        <div className={onSubmitAll ? 'min-h-0 overflow-y-auto mk-scroll -mx-1 px-1' : ''}>
          <div className="rounded-xl bg-slate-50 border border-slate-200 px-3 py-2 text-[12.5px] text-slate-700 mb-4 break-words">{line}</div>
          {askBenefit && <LineFacts fields={['benefit']} values={values} onChange={setValues} allowNone={!!onSubmitAll} />}
          {mall && <div className={askBenefit ? 'mt-4' : ''}><LineMallPick mall={mall} /></div>}
          {readCheck && <div className={askBenefit || mall ? 'mt-4' : ''}><LineReadToggle read={readCheck} /></div>}
        </div>
        {onSubmitAll ? (
          <div className="flex flex-col-reverse sm:flex-row gap-2 mt-5 shrink-0">
            <button type="button" className={`${MK_BTN_OUTLINE} !h-10 flex-1`} onClick={onCancel}>취소</button>
            <button type="button" className={`${MK_BTN_AI} flex-1`} onClick={() => onSubmitAll(askBenefit ? (values.benefit === null ? null : typed) : undefined)}>만들기</button>
          </div>
        ) : (
          <div className="flex flex-col-reverse sm:flex-row gap-2 mt-5">
            <button type="button" className={`${MK_BTN_OUTLINE} !h-10 flex-1`} onClick={() => onSubmit(null)}>혜택 없이 만들기</button>
            <button type="button" className={`${MK_BTN_AI} flex-1`} disabled={!typed} onClick={() => onSubmit(typed)}>이 혜택으로 만들기</button>
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}

/** 생성 뒤 보강 시트 — 완성본이 보인 채 오른쪽(모바일 아래)에서 연다 */
export function LineFactsSheet({ open, onClose, title, reason, line, children, primary }: {
  open: boolean;
  onClose: () => void;
  title: string;
  reason: string;
  /** 처음 넣은 한 줄(읽기 전용 · 다시 입력 요구 0) */
  line?: string | null;
  children: ReactNode;
  primary: { label: string; tone: 'amber' | 'indigo'; disabled?: boolean; onClick: () => void; note?: string };
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open) return null;
  return createPortal(
    <div
      role="dialog"
      aria-modal="false"
      aria-label={title}
      className="fixed z-[1250] bg-white border-slate-200 shadow-2xl flex flex-col inset-x-0 bottom-0 max-h-[85vh] rounded-t-2xl border-t md:inset-x-auto md:right-0 md:top-0 md:bottom-0 md:max-h-none md:w-[400px] md:rounded-none md:border-t-0 md:border-l"
    >
      <div className="flex items-start gap-3 px-5 pt-5 pb-3 border-b border-slate-100">
        <div className="min-w-0">
          <div className="text-[15px] font-bold text-slate-900">{title}</div>
          <p className="text-[12.5px] text-slate-500 mt-1 leading-relaxed">{reason}</p>
        </div>
        <button type="button" onClick={onClose} aria-label="닫기" className="ml-auto p-1 rounded-lg hover:bg-slate-100 shrink-0"><X className="w-4 h-4 text-slate-400" /></button>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto px-5 py-4 space-y-4">
        {line && <div className="rounded-xl bg-slate-50 border border-slate-200 px-3 py-2 text-[12.5px] text-slate-700 break-words"><span className="text-slate-400 mr-1.5">처음 적은 한 줄</span>{line}</div>}
        {children}
      </div>
      <div className="px-5 py-4 border-t border-slate-100 flex items-center gap-2">
        <button type="button" className={`${MK_BTN_OUTLINE} !h-10`} onClick={onClose}>이대로 쓰기</button>
        <div className="ml-auto flex flex-col items-end">
          <button type="button" disabled={primary.disabled} onClick={primary.onClick} className={primary.tone === 'amber' ? MK_BTN_AI : MK_BTN_PRIMARY}>{primary.label}</button>
          {primary.note && <span className="text-[11.5px] text-slate-400 mt-1">{primary.note}</span>}
        </div>
      </div>
    </div>,
    document.body,
  );
}
