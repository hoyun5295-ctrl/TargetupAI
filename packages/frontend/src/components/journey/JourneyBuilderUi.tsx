/**
 * 여정 빌더 공용 UI 프리미티브 (2026-06-30 여정 일반화)
 *
 * AI Operator 디자인 표준(feedback_design_modal_first_simplicity): 컴팩트 메인 + 버튼→모달.
 * 날짜축/정보알림 빌더가 공유 — 중복 정의 금지(no_inline_duplication).
 */

import { useEffect, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X, Plus, Users, ChevronRight } from 'lucide-react';

export interface AudienceCondition { field: string; op: string; value: string; }

/**
 * applyCustomerConditions 허용 필드 = 서버 CUSTOMER_CONDITION_FIELDS 와 **같은 키 집합**(짝 시험 journey-v3-cond-fields-1020 이 고정).
 * ★ 2026-10-20 V.3 §7-1 — 수신 동의 · 마지막 구매 N일 을 더했다(옛 8칸 · 서버는 10칸이라 저장된 조건이 화면에서 키 그대로 보였다).
 *   kind = 값 입력 모양(목록 = 회사 실제 값에서 고름 · 숫자 · 예/아니오). 연산자는 모양마다 허용한 것만 보인다.
 * ★ 2026-10-23 여정 결함 0 — 성별(여성 · 남성) · 생일 달(1~12)을 더했다(서버 journey-condition-fields 표와 같은 12칸).
 */
export type CondKind = 'list' | 'text' | 'number' | 'bool' | 'days' | 'gender' | 'month';
export const COND_FIELDS: Array<{ key: string; label: string; kind: CondKind; unit?: string }> = [
  { key: 'grade', label: '등급', kind: 'list' }, { key: 'region', label: '지역', kind: 'list' },
  { key: 'store_name', label: '매장명', kind: 'text' }, { key: 'store_code', label: '매장코드', kind: 'list' },
  { key: 'age', label: '나이', kind: 'number', unit: '세' }, { key: 'gender', label: '성별', kind: 'gender' }, { key: 'birth_month', label: '생일 달', kind: 'month', unit: '월' },
  { key: 'purchase_count', label: '구매횟수', kind: 'number', unit: '번' },
  { key: 'total_purchase_amount', label: '누적구매액', kind: 'number', unit: '원' }, { key: 'points', label: '포인트', kind: 'number', unit: 'P' },
  { key: 'sms_opt_in', label: '문자 수신 동의', kind: 'bool' },
  { key: 'days_since_purchase', label: '마지막 구매 뒤 지난 날', kind: 'days', unit: '일' },
];
export const condLabel = (k: string) => COND_FIELDS.find((f) => f.key === k)?.label || '알 수 없는 조건';
/** 조건 값 사람 말 — 성별 코드(F · M) = 여성 · 남성 · 생일 달 = N월. */
export const condValueText = (field: string, v: unknown) => (field === 'gender' ? (v === 'M' ? '남성' : v === 'F' ? '여성' : String(v ?? '')) : field === 'birth_month' ? `${v}월` : String(v ?? ''));
export const COND_OPS = [
  { key: '==', label: '같음' }, { key: '!=', label: '다름' }, { key: '>=', label: '이상' }, { key: '<=', label: '이하' }, { key: '>', label: '초과' }, { key: '<', label: '미만' },
];
const OPS_BY_KIND: Record<CondKind, string[]> = {
  list: ['==', '!='], text: ['==', '!='], bool: ['=='], number: ['>=', '<=', '>', '<', '==', '!='], days: ['>=', '<=', '>', '<'],
  gender: ['==', '!='], month: ['==', '!=', '>=', '<='],
};
export const condOpsFor = (field: string) => {
  const kind = COND_FIELDS.find((f) => f.key === field)?.kind || 'text';
  return COND_OPS.filter((o) => OPS_BY_KIND[kind].includes(o.key));
};

/** 회사 실제 값 목록(등급 · 지역 · 매장코드) — /api/customers/filter-options(서버 DISTINCT · 보는 사람 범위). 실패 = 빈 목록(직접 고를 값이 없을 뿐 저장은 서버가 검사). */
export function useConditionValueOptions(): Record<string, string[]> {
  const [opts, setOpts] = useState<Record<string, string[]>>({});
  useEffect(() => {
    let alive = true;
    fetch('/api/customers/filter-options', { headers: { Authorization: `Bearer ${localStorage.getItem('token')}` } })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (alive && d) setOpts({ grade: d.grades || [], region: d.regions || [], store_code: d.store_codes || [] }); })
      .catch(() => undefined);
    return () => { alive = false; };
  }, []);
  return opts;
}

/** 자유 조건(field/op/value)에서 백엔드 customer_conditions 형태로. 빈 값 제외. */
export function buildCustomerConditions(conditions: AudienceCondition[]): { customer_conditions: { field: string; op: string; value: string }[]; logic: 'AND' } | null {
  const valid = conditions.filter((c) => c.field && c.op && String(c.value).trim() !== '');
  if (valid.length === 0) return null;
  return { customer_conditions: valid.map((c) => ({ field: c.field, op: c.op, value: c.value })), logic: 'AND' };
}

/** 대상 요약 라벨 — "전체 활성 고객" 또는 "N개 조건 (등급·지역)". */
export function audienceSummary(conditions: AudienceCondition[]): string {
  const valid = conditions.filter((c) => String(c.value).trim() !== '');
  if (valid.length === 0) return '전체 활성 고객';
  return `${valid.length}개 조건 (${valid.map((c) => condLabel(c.field)).join('·')})`;
}

// 공용 모달 셸 — 다크 톤, createPortal, 중첩 z-[2000].
export function ModalShell({ title, subtitle, icon, onClose, children, footer, maxW = 'max-w-xl' }: {
  title: string; subtitle?: string; icon: ReactNode; onClose: () => void; children: ReactNode; footer?: ReactNode; maxW?: string;
}) {
  return createPortal(
    <div className="fixed inset-0 bg-black/75 backdrop-blur-sm flex items-center justify-center z-[2000] p-4">
      <div className={`bg-white border border-slate-200 rounded-2xl shadow-2xl ${maxW} w-full max-h-[92vh] overflow-hidden flex flex-col text-slate-900`} onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <div className="flex items-center justify-between p-4 border-b border-slate-200 bg-gradient-to-r from-indigo-50 to-violet-50">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-indigo-400 to-violet-500 flex items-center justify-center shrink-0">{icon}</div>
            <div><h3 className="text-sm font-semibold">{title}</h3>{subtitle && <p className="text-[11px] text-slate-400">{subtitle}</p>}</div>
          </div>
          <button onClick={onClose} className="p-1.5 hover:bg-slate-100 rounded-lg" aria-label="닫기"><X className="w-4 h-4 text-slate-500" /></button>
        </div>
        <div className="flex-1 overflow-y-auto p-4 space-y-3">{children}</div>
        {footer && <div className="flex items-center justify-end gap-2 p-4 border-t border-slate-200">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}

// 메인의 요약 버튼 — 누르면 모달. (아이콘 + 라벨 + 현재 값 + chevron)
export function SummaryButton({ icon, label, value, onClick, accent = 'indigo' }: { icon: ReactNode; label: string; value: string; onClick: () => void; accent?: 'indigo' | 'teal' }) {
  const grad = accent === 'teal' ? 'from-teal-50 to-emerald-50' : 'from-indigo-50 to-violet-50';
  return (
    <button onClick={onClick} className="w-full flex items-center gap-3 p-3.5 rounded-2xl bg-white border border-slate-200 hover:bg-slate-100 transition-colors text-left">
      <div className={`w-9 h-9 rounded-xl bg-gradient-to-br ${grad} flex items-center justify-center shrink-0`}>{icon}</div>
      <div className="flex-1 min-w-0">
        <div className="text-[11px] text-slate-400">{label}</div>
        <div className="text-sm font-medium text-slate-800 truncate">{value}</div>
      </div>
      <ChevronRight className="w-4 h-4 text-slate-400 shrink-0" />
    </button>
  );
}

/** 조건 한 줄 편집(칸 · 연산자 · 값) — 값 입력은 칸 모양을 따른다(목록 = 회사 실제 값 · 숫자 · 예/아니오). AudienceModal · 작업 화면 시작 카드 공용. */
export function ConditionRow({ c, onChange, onRemove, valueOptions }: {
  c: AudienceCondition; onChange: (patch: Partial<AudienceCondition>) => void; onRemove: () => void; valueOptions: Record<string, string[]>;
}) {
  const meta = COND_FIELDS.find((f) => f.key === c.field);
  const ops = condOpsFor(c.field);
  const list = valueOptions[c.field] || [];
  const cls = 'h-9 bg-white border border-slate-300 rounded-lg px-2 text-[13px] text-slate-900';
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <select value={c.field} aria-label="조건 칸" onChange={(e) => {
        const next = e.target.value;
        const nextOps = condOpsFor(next).map((o) => o.key);
        const nextKind = COND_FIELDS.find((f) => f.key === next)?.kind;
        onChange({ field: next, op: nextOps.includes(c.op) ? c.op : nextOps[0], value: nextKind === 'bool' ? 'true' : nextKind === 'gender' ? 'F' : nextKind === 'month' ? String(new Date().getMonth() + 1) : '' });
      }} className={cls}>
        {!meta && <option value={c.field}>알 수 없는 조건</option>}
        {COND_FIELDS.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
      </select>
      {meta?.kind !== 'bool' && (
        <select value={c.op} aria-label="비교" onChange={(e) => onChange({ op: e.target.value })} className={cls}>
          {ops.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
        </select>
      )}
      {meta?.kind === 'bool' ? (
        <select value={String(c.value) === 'false' ? 'false' : 'true'} aria-label="값" onChange={(e) => onChange({ op: '==', value: e.target.value })} className={`${cls} flex-1 min-w-[120px]`}>
          <option value="true">동의한 고객</option>
          <option value="false">동의하지 않은 고객</option>
        </select>
      ) : meta?.kind === 'gender' ? (
        <select value={c.value === 'M' ? 'M' : 'F'} aria-label="값" onChange={(e) => onChange({ value: e.target.value })} className={`${cls} flex-1 min-w-[120px]`}>
          <option value="F">여성</option>
          <option value="M">남성</option>
        </select>
      ) : meta?.kind === 'month' ? (
        <select value={c.value} aria-label="값" onChange={(e) => onChange({ value: e.target.value })} className={`${cls} flex-1 min-w-[120px]`}>
          {Array.from({ length: 12 }, (_, i) => String(i + 1)).map((m) => <option key={m} value={m}>{m}월</option>)}
        </select>
      ) : meta?.kind === 'list' && list.length > 0 ? (
        <select value={c.value} aria-label="값" onChange={(e) => onChange({ value: e.target.value })} className={`${cls} flex-1 min-w-[120px]`}>
          <option value="">고르기</option>
          {!list.includes(c.value) && c.value && <option value={c.value}>{c.value}</option>}
          {list.map((v) => <option key={v} value={v}>{v}</option>)}
        </select>
      ) : (
        <span className="flex flex-1 min-w-[120px] items-center gap-1">
          <input value={c.value} aria-label="값" inputMode={meta?.kind === 'number' || meta?.kind === 'days' ? 'numeric' : undefined}
            onChange={(e) => onChange({ value: meta?.kind === 'number' || meta?.kind === 'days' ? e.target.value.replace(/[^0-9]/g, '') : e.target.value })}
            placeholder={meta?.kind === 'days' ? '예: 90' : '값'} className={`${cls} min-w-0 flex-1`} />
          {meta?.unit && <span className="shrink-0 text-[12px] text-slate-500">{meta.unit}</span>}
        </span>
      )}
      <button type="button" onClick={onRemove} className="h-9 w-9 shrink-0 rounded-lg bg-white hover:bg-rose-50 border border-slate-200 flex items-center justify-center" aria-label="조건 삭제"><X className="w-3.5 h-3.5 text-slate-500" /></button>
    </div>
  );
}

// 대상 조건 모달 — 두 빌더 공용.
export function AudienceModal({ initial, onSave, onClose }: { initial: AudienceCondition[]; onSave: (c: AudienceCondition[]) => void; onClose: () => void }) {
  const [conditions, setConditions] = useState<AudienceCondition[]>(initial);
  const valueOptions = useConditionValueOptions();
  const add = () => setConditions((c) => [...c, { field: 'grade', op: '==', value: '' }]);
  const upd = (i: number, patch: Partial<AudienceCondition>) => setConditions((c) => c.map((x, idx) => (idx === i ? { ...x, ...patch } : x)));
  const rm = (i: number) => setConditions((c) => c.filter((_, idx) => idx !== i));
  return (
    <ModalShell title="대상" subtitle="조건을 만족하는 고객 · 없으면 전체 활성 고객" icon={<Users className="w-4 h-4 text-slate-900" />} onClose={onClose}
      footer={<>
        <button onClick={onClose} className="px-4 py-2 rounded-lg bg-white hover:bg-slate-100 border border-slate-200 text-sm text-slate-600">닫기</button>
        <button onClick={() => onSave(conditions)} className="text-white px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-sm font-medium">저장</button>
      </>}>
      <p className="text-[11px] text-slate-500">등급 · 지역 · 매장 · 포인트 · 마지막 구매 같은 조건을 묶어요. 조건이 없으면 전체 활성 고객이 대상입니다.</p>
      {conditions.map((c, i) => (
        <ConditionRow key={i} c={c} valueOptions={valueOptions} onChange={(p) => upd(i, p)} onRemove={() => rm(i)} />
      ))}
      <button onClick={add} className="inline-flex items-center gap-1 text-xs text-indigo-700 hover:text-indigo-800"><Plus className="w-3.5 h-3.5" /> 조건 추가</button>
    </ModalShell>
  );
}
