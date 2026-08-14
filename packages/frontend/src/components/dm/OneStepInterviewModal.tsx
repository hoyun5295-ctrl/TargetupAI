/**
 * OneStepInterviewModal — 원스텝 AI 컨텐츠 생성 (★ 2026-08-13 Phase 4)
 *
 * 설계서 = docs/2026-08-13-one-step-content-interview-design.md §3
 *
 * **마케터는 질문에 답하고, 마스터프롬프트는 시스템이 조립한다.**
 * 답은 저장 즉시 서버에 남아 언제든 이어할 수 있고, 아무것도 답하지 않아도 [이대로 만들기] 한 번으로 완주된다.
 *
 * ⛔ 화면 규약
 *   - **백드롭 클릭으로 닫지 않는다** — 오조작 한 번에 답이 사라지는 자리를 만들지 않는다.
 *   - **미래 질문을 잠그지 않는다** — 접어 두되 이미 채워진 답은 요약으로 보여준다(잠그면 확인조차 못 한다).
 *   - **진행률을 "3/7"로 그리지 않는다** — 분기로 문항 수가 변하고 대부분은 이미 채워져 있다.
 *     세는 것은 **사용자만 아는 축이 몇 개 남았는가**뿐이다.
 *   - **금액은 서버 견적을 그대로 쓴다**(`costOverride`) — 정적 상수로 그리면 표시와 차감이 갈린다.
 *   - z 티어는 인터럽트(z-[2000]) **아래**다 — 이 안에서 상품 선택기·크레딧 확인이 위로 떠야 한다.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  Check, ChevronDown, Loader2, PencilLine, Sparkles, Wand2, X,
} from 'lucide-react';
import CreditConfirmModal from '../credit/CreditConfirmModal';
import MallProductPickerModal, { type PickedMallProduct } from './MallProductPickerModal';

type QKey = 'objective' | 'products' | 'benefit' | 'urgency' | 'proof' | 'imageSource' | 'storeInfo';

interface Question { key: QKey; title: string; hint?: string; userOnly?: boolean }
interface Product { name: string; price?: string; url?: string; origin: 'mall' | 'manual' }
interface Answers {
  objective?: string;
  products?: Product[];
  benefit?: string | null;
  urgency?: { kind: 'deadline' | 'quantity' | 'none'; endsAt?: string; quantity?: number };
  proof?: { kind: 'review' | 'video' | 'instagram' | 'none'; text?: string; url?: string };
  imageSource?: 'studio' | 'upload' | 'product';
  storeInfo?: boolean;
}
interface Quote { total: number; charges: Array<{ label: string; cost: number }>; publishNotice: string }

interface GeneratedPayload {
  sections: unknown[];
  pages?: unknown[];
  layout_mode?: string;
  brand_kit?: unknown;
  brief?: unknown;
  coverage?: { missing?: Array<{ kind: string; value?: string }> } | null;
}

const OBJECTIVE_CHOICES: Array<{ value: string; label: string; desc: string }> = [
  { value: 'new_product', label: '신상품 알리기', desc: '새로 나온 상품을 소개합니다' },
  { value: 'promotion', label: '할인·프로모션', desc: '기간 혜택을 앞세워 구매를 당깁니다' },
  { value: 'bestseller', label: '베스트 추천', desc: '많이 찾는 상품을 모아 보여줍니다' },
  { value: 'brand_story', label: '브랜드 이야기', desc: '영상·사진으로 브랜드를 전합니다' },
  { value: 'store_visit', label: '매장 방문 유도', desc: '오시는 길과 매장 정보를 함께 넣습니다' },
];

const IMAGE_CHOICES: Array<{ value: string; label: string; desc: string }> = [
  { value: 'product', label: '상품 이미지 사용', desc: '연동몰에서 가져온 상품 사진을 씁니다' },
  { value: 'studio', label: '새로 만들기', desc: '이미지를 따로 배치할 자리를 넣습니다' },
  { value: 'upload', label: '가진 이미지 사용', desc: '보유한 이미지를 넣을 자리를 만듭니다' },
];

/** 접힌 질문에 한 줄로 뜨는 답 요약 — 개수가 아니라 값을 보여준다. */
function summarize(key: QKey, a: Answers): string {
  switch (key) {
    case 'objective':
      return OBJECTIVE_CHOICES.find((c) => c.value === a.objective)?.label || '';
    case 'products': {
      const list = a.products || [];
      if (list.length === 0) return '';
      return list.length <= 2 ? list.map((p) => p.name).join(', ') : `${list[0].name} 외 ${list.length - 1}개`;
    }
    case 'benefit':
      return a.benefit === null ? '혜택 없음' : (a.benefit || '');
    case 'urgency':
      if (!a.urgency) return '';
      if (a.urgency.kind === 'deadline') return `${String(a.urgency.endsAt || '').replace('T', ' ')} 마감`;
      if (a.urgency.kind === 'quantity') return `${Number(a.urgency.quantity || 0).toLocaleString()}개 한정`;
      return '기한 없음';
    case 'proof':
      if (!a.proof) return '';
      if (a.proof.kind === 'review') return '고객 후기';
      if (a.proof.kind === 'video') return '영상';
      if (a.proof.kind === 'instagram') return '인스타그램';
      return '없음';
    case 'imageSource':
      return IMAGE_CHOICES.find((c) => c.value === a.imageSource)?.label || '';
    case 'storeInfo':
      return a.storeInfo ? '매장·문의 안내 넣기' : '넣지 않기';
  }
}

const isAnswered = (key: QKey, a: Answers): boolean => {
  const v = (a as Record<string, unknown>)[key];
  if (v === undefined) return false;
  if (key === 'products') return Array.isArray(v) && v.length > 0;
  return true;
};

export default function OneStepInterviewModal({ open, onClose, onGenerated }: {
  open: boolean;
  onClose: () => void;
  /** `sessionDetached` = 결과물은 정상이지만 세션에 저장되지 않았다(이 세션을 다시 열어도 안 나온다). */
  onGenerated: (payload: GeneratedPayload, sessionId: string, sessionDetached: boolean) => void;
}) {
  const auth = () => ({ Authorization: `Bearer ${localStorage.getItem('token')}` });

  const [sessionId, setSessionId] = useState<string | null>(null);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [answers, setAnswers] = useState<Answers>({});
  const [sources, setSources] = useState<Record<string, string>>({});
  const [remaining, setRemaining] = useState(0);
  const [openKey, setOpenKey] = useState<QKey | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState<QKey | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [pickerOpen, setPickerOpen] = useState(false);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [generating, setGenerating] = useState(false);
  const [genStep, setGenStep] = useState(0);
  const [resumed, setResumed] = useState(false);

  // 임시 입력값(저장 전) — 텍스트 계열은 타이핑마다 서버에 쓰지 않는다.
  const [draftBenefit, setDraftBenefit] = useState('');
  const [draftProducts, setDraftProducts] = useState('');
  const [draftDeadline, setDraftDeadline] = useState('');
  const [draftQuantity, setDraftQuantity] = useState('');
  const [draftProofText, setDraftProofText] = useState('');
  const [draftProofUrl, setDraftProofUrl] = useState('');

  const applyProgress = useCallback((d: any) => {
    if (Array.isArray(d?.questions)) setQuestions(d.questions);
    if (d?.answers && typeof d.answers === 'object') setAnswers(d.answers);
    if (typeof d?.remainingUserInputs === 'number') setRemaining(d.remainingUserInputs);
    if (d?.next?.key) setOpenKey(d.next.key as QKey);
    else if (d && 'next' in d) setOpenKey(null);
  }, []);

  // 세션 열기 — 진행 중인 내 세션이 있으면 서버가 그것을 돌려준다(답 그대로 이어하기).
  //   답을 버리고 새로 열면 대행비를 다시 내게 되므로, 응답의 answers를 반드시 그대로 싣는다.
  //   `fresh` = 사용자가 [새로 시작]을 눌렀다 — 지난 행사의 답을 물려받지 않는 유일한 경로다.
  const openSession = useCallback(async (fresh: boolean) => {
    setLoading(true);
    setError(null);
    setResumed(false);   // 앞선 회차의 안내가 새로 열린 화면에 잠깐 남지 않게 먼저 내린다
    try {
      const r = await fetch('/api/one-step/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...auth() },
        body: JSON.stringify(fresh ? { fresh: true } : {}),
      });
      const d = await r.json().catch(() => ({}));
      if (r.status === 503) { setError('준비 중입니다. 잠시 후 다시 시도해 주세요.'); return; }
      if (!r.ok) { setError(d.error || '시작하지 못했습니다.'); return; }
      setSessionId(d.id);
      setSources(d.prefill?.sources || {});
      setResumed(!!d.resumed);
      applyProgress(d);
    } catch {
      setError('네트워크 오류 — 다시 시도해 주세요.');
    } finally {
      setLoading(false);
    }
  }, [applyProgress]);

  useEffect(() => {
    if (!open) return;
    void openSession(false);
  }, [open, openSession]);

  // 생성 중 단계 표시 — 실제 파이프라인 이름만 쓴다(빌려온 라벨은 죽은 표시가 된다).
  const GEN_STEPS = useMemo(() => ['답변 정리', '구성 설계', '문안 작성', '상품·이미지 연결', '미리보기 조립'], []);
  useEffect(() => {
    if (!generating) { setGenStep(0); return; }
    const t = setInterval(() => setGenStep((s) => Math.min(s + 1, GEN_STEPS.length - 1)), 700);
    return () => clearInterval(t);
  }, [generating, GEN_STEPS.length]);

  const saveAnswer = useCallback(async (key: QKey, value: unknown) => {
    if (!sessionId) return;
    setSaving(key);
    setError(null);
    try {
      const r = await fetch(`/api/one-step/sessions/${sessionId}/answers`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...auth() },
        body: JSON.stringify({ key, value }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { setError(d.error || '저장하지 못했습니다.'); return; }
      applyProgress(d);
    } catch {
      setError('네트워크 오류 — 다시 시도해 주세요.');
    } finally {
      setSaving(null);
    }
  }, [sessionId, applyProgress]);

  const askQuote = useCallback(async () => {
    if (!sessionId) return;
    try {
      const r = await fetch(`/api/one-step/sessions/${sessionId}/estimate`, { headers: auth() });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { setError(d.error || '견적을 내지 못했습니다.'); return; }
      setQuote(d);
    } catch {
      setError('네트워크 오류 — 다시 시도해 주세요.');
    }
  }, [sessionId]);

  const runGenerate = useCallback(async () => {
    if (!sessionId) return;
    // 확인 모달에 띄운 총액을 그대로 보낸다 — 서버가 지금 금액과 다르면 걷지 않고 되돌린다.
    //   총액이 없으면 승인 근거가 없다는 뜻이라 **보내지 않고 다시 견적을 받는다**(서버도 400으로 막는다).
    const approvedTotal = quote?.total;
    if (typeof approvedTotal !== 'number') {
      setError('요금을 확인하지 못했습니다. 금액을 다시 확인해 주세요.');
      void askQuote();
      return;
    }
    setQuote(null);
    setGenerating(true);
    setError(null);
    try {
      const r = await fetch(`/api/one-step/sessions/${sessionId}/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...auth() },
        body: JSON.stringify({ expectedTotal: approvedTotal }),
      });
      const d = await r.json().catch(() => ({}));
      // 요금이 바뀌었으면 걷지 않고 되돌아온다 — 새 금액으로 다시 확인받는다(임의로 진행하지 않는다).
      if (d?.code === 'QUOTE_CHANGED' || d?.code === 'QUOTE_REQUIRED') {
        setError(d.error || '요금이 변경되었습니다. 금액을 다시 확인해 주세요.');
        void askQuote();
        return;
      }
      if (!r.ok) { setError(d.error || '생성에 실패했습니다.'); return; }
      // 서버가 "이 결과는 세션에 저장되지 않았다"고 알리면 그대로 전달한다 —
      //   결과물은 정상이지만 이 세션을 다시 열어도 이 결과가 나오지 않는다(편집기에서 이어서 쓰면 된다).
      onGenerated(d.data as GeneratedPayload, sessionId, !!d.sessionDetached);
    } catch {
      setError('네트워크 오류 — 다시 시도해 주세요.');
    } finally {
      setGenerating(false);
    }
  }, [sessionId, onGenerated, quote, askQuote]);

  const onPickProducts = useCallback((picked: PickedMallProduct[]) => {
    setPickerOpen(false);
    if (picked.length === 0) return;
    const merged: Product[] = [
      ...(answers.products || []),
      ...picked.map((p) => ({ name: p.name, price: String(p.salePrice || p.price || ''), url: p.productUrl || undefined, origin: 'mall' as const })),
    ];
    void saveAnswer('products', merged);
  }, [answers.products, saveAnswer]);

  // ⛔ 훅을 전부 부른 뒤에 그린다 — 조기 return 뒤에 훅을 두면 훅 개수가 갈려 화면이 통째로 죽는다.
  if (!open) return null;

  const body = (
    <div className="fixed inset-0 z-[1200] flex items-end sm:items-center justify-center bg-black/70 backdrop-blur-sm p-0 sm:p-4">
      <div className="w-full sm:max-w-2xl max-h-[92vh] sm:max-h-[88vh] bg-slate-900 border border-white/10 rounded-t-2xl sm:rounded-2xl shadow-2xl flex flex-col overflow-hidden">
        {/* 헤더 */}
        <div className="px-5 py-4 border-b border-white/10 flex items-start gap-3 flex-shrink-0">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-violet-500 to-fuchsia-500 flex items-center justify-center flex-shrink-0 shadow-lg shadow-violet-500/20">
            <Wand2 className="w-5 h-5 text-white" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[11px] font-semibold tracking-[0.24em] uppercase text-white/35">One Step</p>
            <h3 className="text-base font-semibold text-white mt-0.5">몇 가지만 알려주시면 만들어 드릴게요</h3>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg text-white/40 hover:bg-white/10 transition-colors flex-shrink-0" aria-label="닫기">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* 본문 */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-2">
          {loading ? (
            <div className="py-20 flex items-center justify-center text-white/40 text-sm">
              <Loader2 className="w-4 h-4 animate-spin mr-2" /> 준비하는 중...
            </div>
          ) : (
            <>
              {error && (
                <div className="rounded-xl border border-rose-400/30 bg-rose-500/10 px-4 py-2.5 text-[12px] text-rose-200">{error}</div>
              )}

              {questions.map((q) => {
                const answered = isAnswered(q.key, answers);
                const expanded = openKey === q.key;
                const summary = summarize(q.key, answers);
                return (
                  <div
                    key={q.key}
                    className={`rounded-xl border transition-colors ${
                      expanded ? 'border-violet-400/40 bg-violet-500/[0.07]' : 'border-white/10 bg-white/[0.03]'
                    }`}
                  >
                    <button
                      onClick={() => setOpenKey(expanded ? null : q.key)}
                      className="w-full flex items-center gap-2.5 px-4 py-3 text-left"
                      aria-expanded={expanded}
                    >
                      <span className={`w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0 ${
                        answered ? 'bg-emerald-500/20 text-emerald-300' : 'bg-white/10 text-white/35'
                      }`}>
                        {answered ? <Check className="w-3 h-3" /> : <span className="w-1.5 h-1.5 rounded-full bg-current" />}
                      </span>
                      <span className="flex-1 min-w-0">
                        <span className="block text-[13px] font-medium text-white">{q.title}</span>
                        {!expanded && summary && (
                          <span className="block text-[11px] text-white/50 truncate mt-0.5">{summary}</span>
                        )}
                      </span>
                      {saving === q.key
                        ? <Loader2 className="w-3.5 h-3.5 animate-spin text-white/40 flex-shrink-0" />
                        : !expanded && answered
                          ? <PencilLine className="w-3.5 h-3.5 text-white/30 flex-shrink-0" />
                          : <ChevronDown className={`w-4 h-4 text-white/30 flex-shrink-0 transition-transform ${expanded ? 'rotate-180' : ''}`} />}
                    </button>

                    {expanded && (
                      <div className="px-4 pb-4 space-y-2.5">
                        {q.hint && <p className="text-[11px] text-white/45 leading-relaxed break-keep">{q.hint}</p>}
                        {sources[q.key === 'storeInfo' ? 'storeInfo' : 'event'] && q.key === 'storeInfo' && (
                          <p className="text-[11px] text-emerald-300/70">{sources.storeInfo}</p>
                        )}

                        {q.key === 'objective' && (
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                            {OBJECTIVE_CHOICES.map((c) => (
                              <button
                                key={c.value}
                                onClick={() => saveAnswer('objective', c.value)}
                                className={`text-left px-3 py-2.5 rounded-xl border transition-colors ${
                                  answers.objective === c.value
                                    ? 'border-violet-400/60 bg-violet-500/20'
                                    : 'border-white/10 bg-white/[0.03] hover:bg-white/[0.06]'
                                }`}
                              >
                                <span className="block text-[12px] font-semibold text-white">{c.label}</span>
                                <span className="block text-[10px] text-white/55 mt-0.5 break-keep">{c.desc}</span>
                              </button>
                            ))}
                          </div>
                        )}

                        {q.key === 'products' && (
                          <div className="space-y-2">
                            <button
                              onClick={() => setPickerOpen(true)}
                              className="w-full py-2.5 rounded-xl border border-violet-400/40 bg-violet-500/10 text-violet-100 text-[12px] font-medium hover:bg-violet-500/20 transition-colors"
                            >
                              연동몰에서 상품 고르기
                            </button>
                            <textarea
                              value={draftProducts}
                              onChange={(e) => setDraftProducts(e.target.value)}
                              rows={3}
                              placeholder={'직접 적을 수도 있어요 (한 줄에 하나)\n니트 가디건\n울 머플러'}
                              className="w-full px-3 py-2.5 bg-black/30 border border-white/10 rounded-xl text-[12px] text-white outline-none focus:ring-2 focus:ring-violet-500 resize-none"
                            />
                            <button
                              onClick={() => {
                                const list = draftProducts.split('\n').map((s) => s.trim()).filter(Boolean)
                                  .map((name) => ({ name, origin: 'manual' as const }));
                                if (list.length === 0) return;
                                void saveAnswer('products', [...(answers.products || []), ...list]);
                                setDraftProducts('');
                              }}
                              disabled={!draftProducts.trim()}
                              className="w-full py-2 rounded-xl bg-white/5 border border-white/10 text-[12px] text-white/70 disabled:opacity-30 hover:bg-white/10 transition-colors"
                            >
                              적은 상품 추가
                            </button>
                            {(answers.products || []).length > 0 && (
                              <div className="flex flex-wrap gap-1.5 pt-1">
                                {(answers.products || []).map((p, i) => (
                                  <span key={`${p.name}-${i}`} className="text-[11px] px-2 py-1 rounded-lg bg-white/5 border border-white/10 text-white/70">
                                    {p.name}
                                    {p.origin === 'mall' && <span className="text-emerald-300/70 ml-1">연동몰</span>}
                                  </span>
                                ))}
                                <button
                                  onClick={() => void saveAnswer('products', [])}
                                  className="text-[11px] px-2 py-1 rounded-lg text-white/40 hover:text-rose-300 transition-colors"
                                >
                                  비우기
                                </button>
                              </div>
                            )}
                          </div>
                        )}

                        {q.key === 'benefit' && (
                          <div className="space-y-2">
                            <input
                              type="text"
                              value={draftBenefit}
                              onChange={(e) => setDraftBenefit(e.target.value.slice(0, 300))}
                              placeholder="예: 전 품목 2+2, 첫 구매 사은품"
                              className="w-full px-3 py-2.5 bg-black/30 border border-white/10 rounded-xl text-[12px] text-white outline-none focus:ring-2 focus:ring-violet-500"
                            />
                            <div className="flex gap-2">
                              <button
                                onClick={() => void saveAnswer('benefit', draftBenefit.trim())}
                                disabled={!draftBenefit.trim()}
                                className="flex-1 py-2 rounded-xl bg-violet-500/20 border border-violet-400/40 text-[12px] text-violet-100 disabled:opacity-30 hover:bg-violet-500/30 transition-colors"
                              >
                                이 문구로 저장
                              </button>
                              <button
                                onClick={() => void saveAnswer('benefit', null)}
                                className="flex-1 py-2 rounded-xl bg-white/5 border border-white/10 text-[12px] text-white/70 hover:bg-white/10 transition-colors"
                              >
                                혜택 없음
                              </button>
                            </div>
                          </div>
                        )}

                        {q.key === 'urgency' && (
                          <div className="space-y-2">
                            <div className="flex flex-col sm:flex-row gap-2">
                              <input
                                type="datetime-local"
                                value={draftDeadline}
                                onChange={(e) => setDraftDeadline(e.target.value)}
                                className="flex-1 px-3 py-2.5 bg-black/30 border border-white/10 rounded-xl text-[12px] text-white outline-none focus:ring-2 focus:ring-violet-500 [color-scheme:dark]"
                              />
                              <button
                                onClick={() => void saveAnswer('urgency', { kind: 'deadline', endsAt: draftDeadline })}
                                disabled={!draftDeadline}
                                className="px-4 py-2.5 rounded-xl bg-violet-500/20 border border-violet-400/40 text-[12px] text-violet-100 disabled:opacity-30 hover:bg-violet-500/30 transition-colors"
                              >
                                마감 지정
                              </button>
                            </div>
                            <div className="flex flex-col sm:flex-row gap-2">
                              <input
                                type="number"
                                min={1}
                                value={draftQuantity}
                                onChange={(e) => setDraftQuantity(e.target.value)}
                                placeholder="한정 수량"
                                className="flex-1 px-3 py-2.5 bg-black/30 border border-white/10 rounded-xl text-[12px] text-white outline-none focus:ring-2 focus:ring-violet-500"
                              />
                              <button
                                onClick={() => void saveAnswer('urgency', { kind: 'quantity', quantity: Number(draftQuantity) })}
                                disabled={!(Number(draftQuantity) > 0)}
                                className="px-4 py-2.5 rounded-xl bg-violet-500/20 border border-violet-400/40 text-[12px] text-violet-100 disabled:opacity-30 hover:bg-violet-500/30 transition-colors"
                              >
                                수량 한정
                              </button>
                            </div>
                            <button
                              onClick={() => void saveAnswer('urgency', { kind: 'none' })}
                              className="w-full py-2 rounded-xl bg-white/5 border border-white/10 text-[12px] text-white/70 hover:bg-white/10 transition-colors"
                            >
                              기한 없음
                            </button>
                          </div>
                        )}

                        {q.key === 'proof' && (
                          <div className="space-y-2">
                            <textarea
                              value={draftProofText}
                              onChange={(e) => setDraftProofText(e.target.value)}
                              rows={2}
                              placeholder="실제 받은 후기를 붙여넣어 주세요"
                              className="w-full px-3 py-2.5 bg-black/30 border border-white/10 rounded-xl text-[12px] text-white outline-none focus:ring-2 focus:ring-violet-500 resize-none"
                            />
                            <button
                              onClick={() => void saveAnswer('proof', { kind: 'review', text: draftProofText.trim() })}
                              disabled={!draftProofText.trim()}
                              className="w-full py-2 rounded-xl bg-violet-500/20 border border-violet-400/40 text-[12px] text-violet-100 disabled:opacity-30 hover:bg-violet-500/30 transition-colors"
                            >
                              이 후기 사용
                            </button>
                            <div className="flex flex-col sm:flex-row gap-2">
                              <input
                                type="url"
                                value={draftProofUrl}
                                onChange={(e) => setDraftProofUrl(e.target.value)}
                                placeholder="https://youtube.com/... 또는 https://instagram.com/..."
                                className="flex-1 px-3 py-2.5 bg-black/30 border border-white/10 rounded-xl text-[12px] text-white outline-none focus:ring-2 focus:ring-violet-500"
                              />
                              <button
                                onClick={() => {
                                  const kind = /instagram\.com/.test(draftProofUrl) ? 'instagram' : 'video';
                                  void saveAnswer('proof', { kind, url: draftProofUrl.trim() });
                                }}
                                disabled={!draftProofUrl.trim()}
                                className="px-4 py-2.5 rounded-xl bg-violet-500/20 border border-violet-400/40 text-[12px] text-violet-100 disabled:opacity-30 hover:bg-violet-500/30 transition-colors"
                              >
                                주소 사용
                              </button>
                            </div>
                            <button
                              onClick={() => void saveAnswer('proof', { kind: 'none' })}
                              className="w-full py-2 rounded-xl bg-white/5 border border-white/10 text-[12px] text-white/70 hover:bg-white/10 transition-colors"
                            >
                              없음
                            </button>
                          </div>
                        )}

                        {q.key === 'imageSource' && (
                          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                            {IMAGE_CHOICES.map((c) => (
                              <button
                                key={c.value}
                                onClick={() => saveAnswer('imageSource', c.value)}
                                className={`text-left px-3 py-2.5 rounded-xl border transition-colors ${
                                  answers.imageSource === c.value
                                    ? 'border-violet-400/60 bg-violet-500/20'
                                    : 'border-white/10 bg-white/[0.03] hover:bg-white/[0.06]'
                                }`}
                              >
                                <span className="block text-[12px] font-semibold text-white">{c.label}</span>
                                <span className="block text-[10px] text-white/55 mt-0.5 break-keep">{c.desc}</span>
                              </button>
                            ))}
                          </div>
                        )}

                        {q.key === 'storeInfo' && (
                          <div className="flex gap-2">
                            <button
                              onClick={() => saveAnswer('storeInfo', true)}
                              className={`flex-1 py-2.5 rounded-xl border text-[12px] transition-colors ${
                                answers.storeInfo === true ? 'border-violet-400/60 bg-violet-500/20 text-violet-100' : 'border-white/10 bg-white/[0.03] text-white/70 hover:bg-white/[0.06]'
                              }`}
                            >
                              넣기
                            </button>
                            <button
                              onClick={() => saveAnswer('storeInfo', false)}
                              className={`flex-1 py-2.5 rounded-xl border text-[12px] transition-colors ${
                                answers.storeInfo === false ? 'border-violet-400/60 bg-violet-500/20 text-violet-100' : 'border-white/10 bg-white/[0.03] text-white/70 hover:bg-white/[0.06]'
                              }`}
                            >
                              넣지 않기
                            </button>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}

              <p className="text-[10px] text-white/30 italic pt-1">
                Data source — 답변은 저장 즉시 서버에 남아 창을 닫아도 이어할 수 있습니다. 상품·매장 정보는 연동몰과 브랜드 설정에서 가져오며, 혜택과 후기는 적어주신 내용만 그대로 사용합니다.
              </p>
            </>
          )}
        </div>

        {/* 하단 — 언제든 만들 수 있다 */}
        <div className="px-5 py-4 border-t border-white/10 flex items-center gap-3 flex-shrink-0 bg-slate-900">
          <div className="min-w-0">
            <p className="text-[12px] text-white/70">
              {remaining > 0 ? <>직접 확인할 것 <b className="text-white">{remaining}개</b></> : '모두 확인했어요'}
            </p>
            <p className="text-[10px] text-white/35 mt-0.5">
              {resumed ? (
                <>
                  앞서 답한 내용을 이어서 불러왔어요 ·{' '}
                  <button
                    onClick={() => { void openSession(true); }}
                    disabled={loading || generating}
                    className="underline underline-offset-2 text-violet-300 hover:text-violet-200 disabled:opacity-40"
                  >
                    새로 시작
                  </button>
                </>
              ) : '답하지 않은 항목은 알아서 채워 만듭니다'}
            </p>
          </div>
          <button
            onClick={askQuote}
            disabled={!sessionId || generating || loading}
            className="ml-auto px-5 py-2.5 rounded-xl bg-gradient-to-r from-violet-500 to-fuchsia-500 text-[13px] font-semibold text-white hover:opacity-90 disabled:opacity-40 transition-opacity flex-shrink-0"
          >
            이대로 만들기
          </button>
        </div>
      </div>

      {/* 생성 중 — 닫기 차단 */}
      {generating && (
        <div className="absolute inset-0 z-[1210] bg-black/85 backdrop-blur-sm flex items-center justify-center px-6">
          <div className="w-full max-w-md text-center">
            <p className="text-[11px] font-semibold tracking-[0.28em] uppercase text-white/40 mb-4">Generating</p>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {GEN_STEPS.map((label, i) => (
                <div
                  key={label}
                  className={`relative px-3 py-3 rounded-xl border text-[11px] ${
                    i < genStep ? 'border-emerald-400/30 bg-emerald-500/10 text-emerald-200'
                      : i === genStep ? 'border-violet-400/50 bg-violet-500/15 text-violet-100'
                        : 'border-white/10 bg-white/[0.03] text-white/35'
                  }`}
                >
                  {i === genStep && <span className="absolute top-2 right-2 w-1.5 h-1.5 rounded-full bg-violet-300 animate-ping" />}
                  {label}
                </div>
              ))}
            </div>
            <p className="text-[12px] text-white/50 mt-5 flex items-center justify-center gap-2">
              <Loader2 className="w-3.5 h-3.5 animate-spin" /> 마지막까지 다듬는 중이에요
            </p>
          </div>
        </div>
      )}
    </div>
  );

  return (
    <>
      {createPortal(body, document.body)}
      <MallProductPickerModal open={pickerOpen} onClose={() => setPickerOpen(false)} onPick={onPickProducts} />
      <CreditConfirmModal
        open={!!quote}
        source="one-step-interview"
        costOverride={quote?.total}
        description={quote
          ? `${quote.charges.map((c) => `${c.label} ${c.cost.toLocaleString()}`).join(' + ')} · ${quote.publishNotice}`
          : undefined}
        onConfirm={() => { void runGenerate(); }}
        onCancel={() => setQuote(null)}
      />
    </>
  );
}
