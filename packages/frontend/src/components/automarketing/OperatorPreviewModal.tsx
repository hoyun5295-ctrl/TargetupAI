// 자동 마케팅 승인 창 (★ 2026-10-05 · 설계서 docs/2026-10-05-automarketing-trust-design.md §5 · Harold 승인 목업 그대로)
//   새로 시작(첫 주 승인 · 200) · 실행 중의 다음 승인 · 조건 확인(0)을 같은 창이 맡는다.
//   첫 줄 = 승인으로 무엇이 일어나는지 날짜로 · 누구에게(조건에 쓰는 칸 · 기준 · 날짜별 대상) · 문안은 어떻게(AI / 직접 쓴 문안) · 얼마나 · 멈추는 법.
//   흰 판 · 모바일 아래로 쌓임 · 백드롭 닫힘 없음 · 만드는 중에도 닫을 수 있다(닫기 = 결과 버림 · 부모가 세대로 무시).
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Loader2, Sparkles, X, Users, Info, AlertTriangle, PenLine, Check } from 'lucide-react';
import { MK_MODAL, MK_MODAL_BACKDROP, MK_BTN_AI, MK_BTN_OUTLINE, MK_BTN_GHOST, MK_BTN_SOFT_AI } from '../../utils/make-ui';
import { CONFIRM_CREDIT_COSTS, AI_GENERATE_COSTS } from '../../constants/credit';
import { calculateSmsBytes } from '../../utils/formatDate';
import ZoneSegmented from '../zone/ZoneSegmented';
import { ProposalJson, won } from './types';

export interface AudienceConditionView {
  term: string; field: string; label: string; operator: string; value: any;
  fillCount?: number; samples?: string[]; source: 'ai' | 'user';
}
export interface AudienceFieldOptionView {
  field: string; label: string; kind: 'standard' | 'custom'; dataType: 'string' | 'number' | 'date';
  fillCount: number; samples: string[]; disabled?: boolean;
}
export interface ConditionInput { term: string; field: string; operator: string; value: any }

/** 서버 미리보기 · 승인 창 응답(automarketing-preview.ts PreviewOutcome · ApprovalPreview) */
export interface OperatorPreviewData {
  kind: 'proposal' | 'baseline' | 'zero' | 'needs_choice' | 'blocked';
  previewId?: string | null;
  /** 서버 보관본 판 번호 — 편집 · 시작 · 승인 때 그대로 돌려보낸다 */
  revision?: number;
  proposal: ProposalJson | null;
  reason: string | null;
  ready: boolean;
  audience: {
    mode: 'axis' | 'filters' | 'none';
    label: string | null;
    description: string | null;
    conditions: AudienceConditionView[];
    unresolved: Array<{ term: string; operator?: string; value?: any }>;
    options: AudienceFieldOptionView[];
    mapped: boolean;
    suggestKey: string | null;
  };
  count: number | null;
  forecast: Array<{ date: string; count: number }> | null;
  window: { startAt: string; until: string; rounds: string[]; schedule: string; scheduleTime: string };
  copy: { mode: 'ai' | 'fixed'; subject: string; body: string; benefit: string | null; variables: string[] };
  limits: { maxRecipients: number; maxCost: number; unitCost: number; channel: string };
  appliedSegment: { key: string; label: string } | null;
  segment: { key: string | null; params: Record<string, number> | null };
  /** 다음 승인 창 전용 */
  lastWindow?: { since: string; sentRounds: number; people: number; emptyDays: number; held: number } | null;
  needsContract?: boolean;
}

const WEEK = ['일', '월', '화', '수', '목', '금', '토'];
const SCHEDULE_ONCE: Record<string, string> = { weekly: '매주 1회', monthly: '매월 1회', yearly: '매년 1회' };
const OP_TEXT: Record<string, string> = { gte: '이상', lte: '이하', eq: '', contains: '포함', days_within: '일 안', date_gte: '이후', date_lte: '이전', in: '중 하나', between: '사이', birth_month: '월' };
const SUGGEST_LABEL: Record<string, string> = { went_quiet: '발길이 끊긴 고객', grade_up: '등급이 오른 고객' };

function kstParts(iso: string) {
  const d = new Date(new Date(iso).getTime() + 9 * 60 * 60 * 1000);
  return { m: d.getUTCMonth() + 1, d: d.getUTCDate(), w: WEEK[d.getUTCDay()] };
}
function dayLabel(iso: string) { const p = kstParts(iso); return `${p.m}월 ${p.d}일(${p.w})`; }
function timeLabel(hhmm: string) {
  const [h, m] = String(hhmm || '09:00').split(':').map((v) => parseInt(v, 10) || 0);
  const ampm = h < 12 ? '오전' : '오후';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${ampm} ${h12}시${m ? ` ${m}분` : ''}`;
}
function fmt(v: any) { return typeof v === 'number' ? v.toLocaleString('ko-KR') : Array.isArray(v) ? v.join(' · ') : String(v ?? ''); }

export default function OperatorPreviewModal({
  open, mode, loading, busy, objective, data, starting,
  onClose, onEdit, onStart, onConditions, onAxis, onCopyMode, onFixedCopy, onBenefit,
}: {
  open: boolean;
  /** new = 처음 시작(200) · renewal = 실행 중의 다음 승인 · 조건 확인(0) */
  mode: 'new' | 'renewal';
  loading: boolean;
  /** 편집을 서버가 다시 계산하는 중 */
  busy: boolean;
  objective: string;
  data: OperatorPreviewData | null;
  starting: boolean;
  onClose: () => void;
  onEdit: () => void;
  onStart: () => void;
  onConditions: (conditions: ConditionInput[]) => void;
  onAxis: (segmentKey: string) => void;
  onCopyMode: (mode: 'ai' | 'fixed') => void;
  onFixedCopy: (subject: string, body: string) => void;
  onBenefit: (benefit: string) => void;
}) {
  const messages = data?.proposal?.messages || [];
  const recommendedIdx = useMemo(() => {
    const rec = data?.proposal?.recommendation;
    const i = rec ? messages.findIndex((m) => m.variantId === rec) : -1;
    return i >= 0 ? i : 0;
  }, [data]); // eslint-disable-line react-hooks/exhaustive-deps
  const [tab, setTab] = useState('0');
  const [pickFor, setPickFor] = useState<string | null>(null);     // 칸을 고르는 말(term)
  const [pickField, setPickField] = useState<string | null>(null);
  const [values, setValues] = useState<Record<string, string>>({}); // 칸 조건 기준 숫자 초안(말 → 입력 글자 · 같은 칸 상한 · 하한이 섞이지 않게)
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [benefitDraft, setBenefitDraft] = useState<string | null>(null);
  useEffect(() => { setTab(String(recommendedIdx)); }, [recommendedIdx]);
  useEffect(() => {
    setSubject(data?.copy.subject || '');
    setBody(data?.copy.body || '');
    setValues({});
    setBenefitDraft(null);
    setPickFor(data?.kind === 'needs_choice' ? (data.audience.unresolved[0]?.term ?? null) : null);
    setPickField(null);
  }, [data]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !starting) onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, starting, onClose]);
  if (!open) return null;

  const startCost = CONFIRM_CREDIT_COSTS['continuous-operator'] ?? 0;
  const copyCost = AI_GENERATE_COSTS['ai-operator-propose'] ?? 0;
  const d = data;
  const daily = d?.window.schedule === 'daily';
  const channel = (d?.proposal?.channel?.recommended || d?.limits.channel || 'LMS').toUpperCase();
  const longType = channel === 'LMS' || channel === 'MMS';
  const sel = messages[Number(tab)] || messages[0];
  const conds = d?.audience.conditions || [];
  const rounds = daily ? 7 : 1;
  const expectedPeople = d?.forecast ? d.forecast.reduce((s, x) => s + x.count, 0) : (d?.count ?? 0) * rounds;
  const expectedCost = Math.round(expectedPeople * (d?.limits.unitCost || 0));
  const title = mode === 'renewal'
    ? (d?.needsContract ? '조건 확인' : daily ? '다음 주 승인' : '다음 회차 승인')
    : (daily ? '첫 주 승인' : '다음 회차 승인');

  // 칸 조건 바꾸기 — 지금 조건(기준 초안 반영) + 바꾼 것
  const currentConditions = (): ConditionInput[] => conds.map((c) => ({
    term: c.term, field: c.field, operator: c.operator,
    // 입력 글자 그대로 — 숫자 해석 · 검증은 서버가 한다(「,」 같은 값이 0 으로 바뀌어 넓어지지 않게)
    value: values[c.term] != null && values[c.term] !== '' ? values[c.term] : c.value,
  }));
  const applyPick = () => {
    if (!d || !pickFor || !pickField) return;
    const opt = d.audience.options.find((o) => o.field === pickField);
    if (!opt) return;
    const ur = d.audience.unresolved.find((u) => u.term === pickFor);
    const old = conds.find((c) => c.term === pickFor);
    const numeric = opt.dataType === 'number';
    const operator = ur?.operator || old?.operator || (numeric ? 'gte' : 'eq');
    const value = ur?.value ?? old?.value ?? (numeric ? 1 : opt.samples[0] ?? '');
    onConditions([...currentConditions().filter((c) => c.term !== pickFor), { term: pickFor, field: opt.field, operator, value }]);
  };
  const thresholdDirty = Object.keys(values).length > 0;
  const fixedDirty = d?.copy.mode === 'fixed' && (subject !== (d?.copy.subject || '') || body !== (d?.copy.body || ''));
  const canStart = !!d && d.ready && !busy && !starting && !thresholdDirty && !fixedDirty && benefitDraft == null;

  return createPortal(
    <div className={MK_MODAL_BACKDROP} role="dialog" aria-modal="true" aria-label={title}>
      <div className={`${MK_MODAL} w-full max-w-2xl max-h-[92vh] flex flex-col overflow-hidden`}>
        <div className="flex items-start gap-3 px-5 pt-5 pb-4 border-b border-slate-200 shrink-0">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-500 to-violet-500 text-white flex items-center justify-center shrink-0">
            <Sparkles className="w-5 h-5" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-[15px] font-bold text-slate-900">{title}</div>
            <p className="text-[12.5px] text-slate-500 mt-0.5 line-clamp-2 break-words">{objective}</p>
          </div>
          <button type="button" onClick={onClose} disabled={starting} aria-label="닫기" className="p-1.5 rounded-lg hover:bg-slate-100 shrink-0 disabled:opacity-40">
            <X className="w-4 h-4 text-slate-500" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 relative">
          {busy && d && (
            <div className="absolute inset-0 z-10 bg-white/70 flex items-center justify-center">
              <div className="flex items-center gap-2 text-[13px] text-slate-700"><Loader2 className="w-4 h-4 animate-spin text-indigo-600" />다시 세는 중이에요</div>
            </div>
          )}
          {loading || !d ? (
            <div className="py-12 flex flex-col items-center text-center gap-3">
              <Loader2 className="w-7 h-7 text-indigo-600 animate-spin" />
              <div className="text-[14px] font-semibold text-slate-800">{mode === 'renewal' ? '지난 기간과 다음 회차를 확인하고 있어요' : '대상 고객을 세고 문안을 준비하고 있어요'}</div>
              {mode === 'new' && (
                <>
                  <div className="text-[12.5px] text-slate-500">아직 자동 마케팅은 시작되지 않았어요. 보고 나서 시작할지 정하시면 됩니다.</div>
                  <div className="text-[11.5px] text-slate-400 max-w-sm">지금 닫으면 이 결과는 받지 않아요. 이미 시작한 분석은 끝까지 진행되고, 대상 고객이 있으면 제안 받기 크레딧이 차감돼요.</div>
                </>
              )}
            </div>
          ) : (
            <div className="space-y-5">
              {d.kind !== 'blocked' && (
                <div className="rounded-xl bg-indigo-50 border border-indigo-100 px-4 py-3">
                  {daily ? (
                    <p className="text-[15px] leading-relaxed text-indigo-950">지금 승인하시면 <b>{dayLabel(d.window.startAt)}부터 {dayLabel(d.window.until)}까지 7일 동안</b> 매일 <b>{timeLabel(d.window.scheduleTime)}</b>에 이렇게 나갑니다.</p>
                  ) : (
                    <>
                      <p className="text-[15px] leading-relaxed text-indigo-950">지금 승인하시면 <b>{dayLabel(d.window.startAt)} {timeLabel(d.window.scheduleTime)}</b>에 이렇게 나갑니다.</p>
                      <p className="text-[12px] text-indigo-800 mt-1">{SCHEDULE_ONCE[d.window.schedule] || '1회'}라 이 승인은 다음 회차 1회분이고, 그다음 회차 전에 다시 여쭤요.</p>
                    </>
                  )}
                </div>
              )}

              {mode === 'renewal' && d.lastWindow && (
                <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 flex flex-wrap gap-x-5 gap-y-1 text-[12.5px] text-slate-600">
                  <span className="font-semibold text-slate-800">지난 기간({dayLabel(d.lastWindow.since)}부터)</span>
                  <span>보낸 날 {d.lastWindow.sentRounds}일 · {d.lastWindow.people.toLocaleString()}명</span>
                  <span>대상 없는 날 {d.lastWindow.emptyDays}일</span>
                  <span>멈춘 회차 {d.lastWindow.held}</span>
                </div>
              )}

              {d.appliedSegment && d.kind !== 'blocked' && (
                <div className="rounded-xl border border-indigo-100 bg-indigo-50 px-4 py-3 text-[12.5px] text-indigo-900 leading-relaxed">
                  발송 대상을 <b className="font-semibold">'{d.appliedSegment.label}'</b> 기준으로 고정해요. 매 회차 같은 기준으로 나가고, 세부 설정에서 바꿀 수 있어요.
                </div>
              )}

              {/* 누구에게 */}
              <section>
                <h3 className="text-[13px] font-bold text-slate-900">누구에게</h3>
                {d.kind === 'blocked' ? (
                  <div className="mt-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-4">
                    <div className="flex items-center gap-2 text-[14px] font-bold text-amber-900"><AlertTriangle className="w-4 h-4" />이 목표로는 시작할 수 없어요</div>
                    <p className="text-[13px] text-amber-900 mt-2 break-words leading-relaxed">{d.reason}</p>
                    <p className="text-[12.5px] text-amber-800 mt-2">대상을 임의로 넓혀서 보내지 않아요.</p>
                    {d.audience.suggestKey && (
                      <button type="button" className={`${MK_BTN_OUTLINE} mt-3`} onClick={() => onAxis(d.audience.suggestKey!)}>
                        「{SUGGEST_LABEL[d.audience.suggestKey] || '새로 해당된 고객'}」으로 바꾸기
                      </button>
                    )}
                    {mode === 'new' && <p className="text-[12px] text-amber-700 mt-3">이번 제안 받기는 크레딧이 차감되지 않았어요.</p>}
                  </div>
                ) : (
                  <div className="mt-2 rounded-xl border border-slate-200 divide-y divide-slate-100">
                    {d.audience.mode === 'axis' && (
                      <div className="px-4 py-3 flex flex-wrap items-center gap-x-3 gap-y-1.5">
                        <span className="text-[12px] text-slate-500 w-20 shrink-0">조건</span>
                        <span className="text-[13.5px] font-semibold text-slate-900">{d.audience.label}</span>
                        <span className="text-[12px] text-slate-500 basis-full sm:basis-auto">{d.audience.description}</span>
                      </div>
                    )}
                    {conds.map((c) => {
                      const numeric = ['gte', 'lte', 'eq'].includes(c.operator) && typeof c.value === 'number';
                      return (
                        <div key={c.term} className="px-4 py-3 flex flex-wrap items-center gap-x-3 gap-y-2">
                          <span className="text-[12px] text-slate-500 w-20 shrink-0">조건에 쓰는 칸</span>
                          <span className="text-[13.5px]"><span className="text-slate-500">{c.term} →</span> <b>{c.label}</b></span>
                          {numeric ? (
                            <span className="inline-flex items-center gap-1 text-[13px]">
                              <input
                                value={values[c.term] ?? fmt(c.value)}
                                onChange={(e) => setValues((v) => ({ ...v, [c.term]: e.target.value }))}
                                inputMode="numeric"
                                className="w-24 h-8 px-2 rounded-lg border border-slate-300 text-right tabular-nums"
                                aria-label={`${c.label} 기준`}
                              />
                              {OP_TEXT[c.operator]}
                            </span>
                          ) : (
                            <span className="text-[13px] text-slate-700">{fmt(c.value)} {OP_TEXT[c.operator] || ''}</span>
                          )}
                          <span className="text-[12px] text-slate-500">값 있는 고객 {(c.fillCount ?? 0).toLocaleString()}명{c.samples && c.samples.length > 0 ? ` · 예: ${c.samples.join(' · ')}` : ''}</span>
                          {c.source === 'ai' && <span className="text-[11px] px-1.5 py-0.5 rounded bg-indigo-50 text-indigo-700">AI 추천</span>}
                          <button type="button" className={`${MK_BTN_SOFT_AI} sm:ml-auto`} onClick={() => { setPickFor(c.term); setPickField(c.field); }}>다른 칸 고르기</button>
                        </div>
                      );
                    })}
                    {thresholdDirty && (
                      <div className="px-4 py-2.5 flex justify-end">
                        <button type="button" className={MK_BTN_OUTLINE} onClick={() => onConditions(currentConditions())}>기준 적용하고 다시 세기</button>
                      </div>
                    )}
                    {d.kind === 'needs_choice' && d.audience.unresolved.map((u) => (
                      <div key={u.term} className="px-4 py-3 bg-amber-50/60">
                        <div className="text-[13px] font-semibold text-amber-900">「{u.term}」을(를) 어느 칸으로 판단할까요?</div>
                        <p className="text-[12px] text-amber-800 mt-0.5">맞는 칸이 없으면 이 목표로는 시작하지 않아요(대상을 넓혀서 보내지 않아요).</p>
                        {pickFor !== u.term && <button type="button" className={`${MK_BTN_OUTLINE} mt-2`} onClick={() => { setPickFor(u.term); setPickField(null); }}>칸 고르기</button>}
                      </div>
                    ))}
                    {pickFor && d.audience.options.length > 0 && (
                      <div className="px-3 py-3 bg-slate-50">
                        <p className="px-1 pb-2 text-[12px] text-slate-500">「{pickFor}」을(를) 어느 칸으로 판단할까요? 값이 있는 칸만 고를 수 있어요.</p>
                        <div className="space-y-1.5 max-h-64 overflow-y-auto">
                          {d.audience.options.map((o) => {
                            const on = pickField === o.field;
                            return (
                              <button
                                key={o.field}
                                type="button"
                                disabled={o.disabled}
                                onClick={() => setPickField(o.field)}
                                className={`w-full text-left flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg px-3 py-2.5 ${o.disabled ? 'border border-dashed border-slate-300 text-slate-400 cursor-not-allowed' : on ? 'border-2 border-indigo-500 bg-white' : 'border border-slate-200 bg-white hover:border-slate-300'}`}
                              >
                                <span className={`w-4 h-4 rounded-full shrink-0 ${on ? 'border-[5px] border-indigo-600' : 'border border-slate-300'}`} />
                                <span className="text-[13.5px] font-semibold">{o.label}</span>
                                <span className="text-[11px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-600">{o.kind === 'custom' ? '회사 전용 칸' : '표준 칸'} · {o.dataType === 'number' ? '숫자' : o.dataType === 'date' ? '날짜' : '글자'}</span>
                                <span className="text-[12px] text-slate-500 sm:ml-auto">{o.disabled ? '값 있는 고객 0명 · 고를 수 없어요' : `값 있는 고객 ${o.fillCount.toLocaleString()}명${o.samples.length ? ` · 예: ${o.samples.join(' · ')}` : ''}`}</span>
                              </button>
                            );
                          })}
                        </div>
                        <div className="flex justify-end gap-2 mt-2">
                          <button type="button" className={MK_BTN_GHOST} onClick={() => { setPickFor(null); setPickField(null); }}>취소</button>
                          <button type="button" className={MK_BTN_OUTLINE} disabled={!pickField} onClick={applyPick}>이 칸으로 정하기</button>
                        </div>
                      </div>
                    )}
                    {(d.kind === 'proposal' || d.kind === 'zero') && (
                      <div className="px-4 py-3">
                        {d.forecast ? (
                          <>
                            <div className="flex items-baseline justify-between gap-2">
                              <span className="text-[12px] text-slate-500">날짜별 대상</span>
                              <span className="text-[12px] text-slate-600">7일 합계 <b className="text-slate-900">{expectedPeople.toLocaleString()}명</b> · 대상 없는 날 {d.forecast.filter((x) => x.count === 0).length}일</span>
                            </div>
                            <div className="mt-2 grid grid-cols-4 sm:grid-cols-7 gap-1.5">
                              {d.forecast.map((x) => {
                                const p = kstParts(`${x.date}T00:00:00+09:00`);
                                return x.count > 0 ? (
                                  <div key={x.date} className="rounded-lg border border-slate-200 px-2 py-2 text-center"><div className="text-[11px] text-slate-500">{p.m}/{p.d} {p.w}</div><div className="text-[16px] font-bold tabular-nums">{x.count}<span className="text-[11px] font-semibold text-slate-500">명</span></div></div>
                                ) : (
                                  <div key={x.date} className="rounded-lg border border-dashed border-slate-300 bg-slate-50 px-2 py-2 text-center"><div className="text-[11px] text-slate-400">{p.m}/{p.d} {p.w}</div><div className="text-[13px] font-semibold text-slate-400 leading-[24px]">없음</div></div>
                                );
                              })}
                            </div>
                            <p className="mt-2 text-[12px] text-slate-500">대상 고객이 없는 날은 보내지 않고, 크레딧도 차감되지 않아요.</p>
                          </>
                        ) : (
                          <div className="flex items-center gap-2 text-[13px] text-slate-700">
                            <Users className="w-4 h-4 text-slate-400" />
                            지금 기준 <b className="tabular-nums">{(d.count ?? 0).toLocaleString()}명</b>
                            <span className="text-[12px] text-slate-500">· 회차마다 그때 다시 세요</span>
                          </div>
                        )}
                      </div>
                    )}
                    {d.kind === 'zero' && (
                      <div className="px-4 py-3 bg-amber-50 text-[13px] text-amber-900">{d.reason}</div>
                    )}
                    {d.kind === 'baseline' && (
                      <div className="px-4 py-3 flex gap-3">
                        <Info className="w-4 h-4 text-slate-500 shrink-0 mt-0.5" />
                        <div className="text-[13px] text-slate-700 leading-relaxed">지난번과 달라진 고객을 찾아 보내는 조건이에요. 첫 회차는 비교 기준을 잡고, 다음 회차부터 대상이 잡혀요.</div>
                      </div>
                    )}
                  </div>
                )}
              </section>

              {/* 문안 */}
              {d.kind !== 'blocked' && (
                <section>
                  <h3 className="text-[13px] font-bold text-slate-900">문안은 어떻게 쓰시겠어요?</h3>
                  <div className="mt-2 grid sm:grid-cols-2 gap-2">
                    <CopyCard on={d.copy.mode === 'ai'} title="AI가 회차마다 새로 써요" onClick={() => d.copy.mode !== 'ai' && onCopyMode('ai')}
                      desc={d.copy.mode === 'ai' || mode === 'renewal'
                        ? '매일 · 매주 · 매달 계절과 그날 특성에 맞게 문안이 달라져요. 핵심 혜택은 그대로 유지돼요.'
                        : `고르면 문안 3안을 만들어 보여 드려요 · ${copyCost}크레딧`} />
                    <CopyCard on={d.copy.mode === 'fixed'} title="직접 쓴 문안 그대로" onClick={() => d.copy.mode !== 'fixed' && onCopyMode('fixed')}
                      desc="우리 브랜드 문안을 넣어 두면 대상만 자동으로 뽑아 매 회차 그 문안으로 보내요." />
                  </div>

                  {d.copy.mode === 'ai' ? (
                    <>
                      <div className="mt-3 rounded-xl border border-slate-200 px-4 py-3 flex flex-wrap items-center gap-x-3 gap-y-2">
                        <span className="text-[12px] text-slate-500 w-20 shrink-0">핵심 혜택</span>
                        {benefitDraft == null ? (
                          <>
                            <span className="text-[13.5px] font-semibold">{d.copy.benefit || '적지 않음'}</span>
                            <span className="text-[12px] text-slate-500">회차마다 문안에 그대로 들어가요</span>
                            <button type="button" className={`${MK_BTN_SOFT_AI} sm:ml-auto`} onClick={() => setBenefitDraft(d.copy.benefit || '')}>고치기</button>
                          </>
                        ) : (
                          <>
                            <input value={benefitDraft} onChange={(e) => setBenefitDraft(e.target.value)} className="flex-1 min-w-[180px] h-9 px-3 rounded-lg border border-slate-300 text-[13.5px]" placeholder="예: 생일 고객 30% 할인 쿠폰 · 코드 2026BIRTH" aria-label="핵심 혜택" />
                            <button type="button" className={MK_BTN_GHOST} onClick={() => setBenefitDraft(null)}>취소</button>
                            <button type="button" className={MK_BTN_OUTLINE} onClick={() => { onBenefit(benefitDraft); setBenefitDraft(null); }}>
                              {mode === 'new' ? `고치고 다시 만들기 · ${copyCost}크레딧` : '적용'}
                            </button>
                          </>
                        )}
                      </div>
                      {messages.length > 0 ? (
                        <div className="mt-3">
                          <ZoneSegmented
                            ariaLabel="문안 안 고르기"
                            items={messages.map((m, i) => ({ id: String(i), label: `${String.fromCharCode(65 + i)}${m.variantName ? ` · ${m.variantName}` : ''}`, count: i === recommendedIdx ? '추천' : null }))}
                            value={tab}
                            onChange={setTab}
                          />
                          <div className="mt-2 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 max-h-72 overflow-y-auto">
                            {longType && sel?.subject && <div className="text-[13.5px] font-bold text-slate-900 mb-2 break-words">{sel.subject}</div>}
                            <div className="text-[13.5px] text-slate-800 whitespace-pre-wrap break-words leading-relaxed">{sel?.body || sel?.message || ''}</div>
                          </div>
                          <p className="text-[12px] text-slate-500 mt-2">문안은 회차마다 그날에 맞게 새로 만들고, 스팸 검사를 통과한 안만 나가요. 위는 첫 회차 문안이에요.</p>
                        </div>
                      ) : (
                        <p className="mt-3 text-[12.5px] text-slate-500">{d.kind === 'proposal' && d.reason ? d.reason : mode === 'renewal' ? '문안은 회차마다 그날에 맞게 새로 만들어요. 스팸 검사를 통과한 안만 나가요.' : '칸이 정해지면 문안을 만들어 보여 드려요.'}</p>
                      )}
                    </>
                  ) : (
                    <div className="mt-3 grid md:grid-cols-[1fr_240px] gap-3">
                      <div className="space-y-2">
                        {longType && <input value={subject} onChange={(e) => setSubject(e.target.value)} maxLength={40} className="w-full h-10 px-3 rounded-lg border border-slate-300 text-[13.5px] font-semibold" placeholder="제목(LMS)" aria-label="문안 제목" />}
                        <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={6} className="w-full px-3 py-2 rounded-lg border border-slate-300 text-[13.5px] leading-relaxed" placeholder="보낼 문안을 넣어 주세요. 예: %이름%님, 생일을 축하드려요." aria-label="문안 본문" />
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="text-[12px] text-slate-500 mr-1">넣을 수 있는 칸</span>
                          {d.copy.variables.slice(0, 12).map((v) => (
                            <button key={v} type="button" onClick={() => setBody((b) => `${b}%${v}%`)} className="h-7 px-2.5 rounded-lg border border-slate-200 bg-white text-[12px] font-semibold hover:border-indigo-300">%{v}%</button>
                          ))}
                          <span className="text-[12px] text-slate-500 ml-auto tabular-nums">{calculateSmsBytes(body).toLocaleString()}바이트 · {channel}</span>
                        </div>
                        {d.reason && d.kind === 'proposal' && !fixedDirty && <div className="rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-[12.5px] text-amber-900">{d.reason}</div>}
                        {fixedDirty && (
                          <div className="flex justify-end">
                            <button type="button" className={MK_BTN_OUTLINE} onClick={() => onFixedCopy(subject, body)}><Check className="w-4 h-4" />이 문안으로 확인</button>
                          </div>
                        )}
                        <p className="text-[12px] text-slate-500">스팸 검사는 첫 회차 준비 때 한 번 하고, 같은 문안이면 다시 하지 않아요. 고치면 다시 검사해요.</p>
                      </div>
                      <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
                        <div className="text-[11px] text-slate-500 mb-2 flex items-center gap-1"><PenLine className="w-3 h-3" />받는 사람이 보는 모양</div>
                        <div className="rounded-xl bg-white border border-slate-200 px-3 py-2.5 text-[12.5px] leading-relaxed whitespace-pre-wrap break-words">
                          {longType && subject && <b>{subject}{'\n'}</b>}<span className="text-slate-400">(광고)</span>{body || ' '}{'\n'}<span className="text-slate-400">무료거부 080</span>
                        </div>
                        <p className="mt-2 text-[11.5px] text-slate-500">(광고) 표기와 무료거부 번호는 보낼 때 자동으로 붙어요.</p>
                      </div>
                    </div>
                  )}
                </section>
              )}

              {/* 얼마나 · 멈추는 법 */}
              {d.kind !== 'blocked' && (
                <section>
                  <h3 className="text-[13px] font-bold text-slate-900">얼마나 · 멈추는 법</h3>
                  <div className="mt-2 grid grid-cols-2 md:grid-cols-4 gap-2">
                    <Cell label="채널" value={channel} />
                    <Cell label={daily ? '7일 예상 발송비' : '회차 예상 발송비'} value={won(expectedCost)} />
                    <Cell label="회차당 자동 상한" value={`${(d.limits.maxRecipients || 0).toLocaleString()}명`} />
                    <Cell label="회차당 비용 상한" value={won(d.limits.maxCost)} />
                  </div>
                  <ul className="mt-2 space-y-1 text-[12.5px] text-slate-600">
                    <li>· 상한이나 예산을 넘는 날은 그 회차만 멈추고 다시 여쭤요.</li>
                    <li>· 매 회차 발송 전에 담당자 문자로 그날 문안과 대상 수를 알려 드려요. 실행 중 화면의 [정지]로 그 회차만 멈출 수 있어요.</li>
                    <li>· 승인 기간이 끝나기 하루 전에 지난 회차 요약과 함께 다음 승인을 여쭤요. 승인하지 않으면 그 뒤로는 회차마다 승인 대기로 남아요.</li>
                  </ul>
                </section>
              )}

              <div className="text-[10px] text-slate-400 italic">
                Data source: 고객 DB 실측(대상 수 · 날짜별 대상 · 칸별 값 있는 고객 수 · 값 예시) · 회사 발송 단가 · 회사 자율 발송 상한{d.copy.mode === 'ai' ? ' · 문안 3안은 AI 생성' : ' · 직접 입력 문안'}{mode === 'new' ? ' (등록 전 미리보기 · 발송 0건)' : ''}
              </div>
            </div>
          )}
        </div>

        <div className="border-t border-slate-200 px-5 py-4 shrink-0">
          {d && d.ready && (
            <p className="text-[12px] text-slate-500 mb-3">
              {mode === 'new'
                ? `시작하면 ${startCost}크레딧이 차감되고, 보낸 날만 회차마다 발송 크레딧이 차감돼요.`
                : '승인에는 크레딧이 차감되지 않아요. 보낸 날만 발송 크레딧이 차감돼요.'}
            </p>
          )}
          {d && d.kind !== 'blocked' && (thresholdDirty || fixedDirty || benefitDraft != null) && (
            <p className="text-[12px] text-amber-700 mb-3">고친 내용을 먼저 적용해 주세요.</p>
          )}
          <div className="flex flex-col-reverse sm:flex-row sm:items-center gap-2">
            <button type="button" className={`${MK_BTN_GHOST} !h-10`} onClick={onClose} disabled={starting}>닫기</button>
            <div className="sm:ml-auto flex flex-col-reverse sm:flex-row gap-2">
              <button type="button" className={`${MK_BTN_OUTLINE} !h-10`} onClick={onEdit} disabled={loading || !d || starting}>세부 설정에서 고치기</button>
              {d && d.kind !== 'blocked' && (
                <button type="button" className={MK_BTN_AI} onClick={onStart} disabled={!canStart}>
                  {starting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
                  {mode === 'new' ? (daily ? '이번 주 승인하고 시작' : '승인하고 시작') : (daily ? '다음 주 승인' : '다음 회차 승인')}
                  {mode === 'new' && <span className="font-normal opacity-70 text-[12.5px]">· {startCost}크레딧</span>}
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function CopyCard({ on, title, desc, onClick }: { on: boolean; title: string; desc: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className={`text-left rounded-xl px-4 py-3 ${on ? 'border-2 border-indigo-500 bg-indigo-50/60' : 'border border-slate-200 bg-white hover:border-slate-300'}`}>
      <div className="flex items-center gap-2"><span className={`w-4 h-4 rounded-full shrink-0 ${on ? 'border-[5px] border-indigo-600' : 'border border-slate-300'}`} /><span className="text-[13.5px] font-bold text-slate-900">{title}</span></div>
      <p className="mt-1 ml-6 text-[12px] text-slate-600 leading-relaxed">{desc}</p>
    </button>
  );
}

function Cell({ label, value, icon }: { label: string; value: string; icon?: ReactNode }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white px-3 py-2.5 min-w-0">
      <div className="text-[11.5px] text-slate-500 flex items-center gap-1">{icon}{label}</div>
      <div className="text-[15px] font-bold text-slate-900 mt-0.5 truncate tabular-nums">{value}</div>
    </div>
  );
}
