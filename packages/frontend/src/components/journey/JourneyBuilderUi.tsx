/**
 * 여정 빌더 공용 UI 프리미티브 (2026-06-30 여정 일반화)
 *
 * AI Operator 디자인 표준(feedback_design_modal_first_simplicity): 컴팩트 메인 + 버튼→모달.
 * 날짜축/정보알림 빌더가 공유 — 중복 정의 금지(no_inline_duplication).
 */

import { useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X, Plus, Users, ChevronRight } from 'lucide-react';

export interface AudienceCondition { field: string; op: string; value: string; }

// applyCustomerConditions 허용 필드(백엔드 정합). 포인트는 한 옵션일 뿐 — 한정 아님.
export const COND_FIELDS = [
  { key: 'grade', label: '등급' }, { key: 'region', label: '지역' },
  { key: 'store_name', label: '매장명' }, { key: 'store_code', label: '매장코드' },
  { key: 'age', label: '나이' }, { key: 'purchase_count', label: '구매횟수' },
  { key: 'total_purchase_amount', label: '누적구매액' }, { key: 'points', label: '포인트' },
];
export const condLabel = (k: string) => COND_FIELDS.find((f) => f.key === k)?.label || k;
export const COND_OPS = [
  { key: '==', label: '같음' }, { key: '!=', label: '다름' }, { key: '>=', label: '이상' }, { key: '<=', label: '이하' }, { key: '>', label: '초과' }, { key: '<', label: '미만' },
];

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

// 대상 조건 모달 — 두 빌더 공용.
export function AudienceModal({ initial, onSave, onClose }: { initial: AudienceCondition[]; onSave: (c: AudienceCondition[]) => void; onClose: () => void }) {
  const [conditions, setConditions] = useState<AudienceCondition[]>(initial);
  const add = () => setConditions((c) => [...c, { field: 'grade', op: '==', value: '' }]);
  const upd = (i: number, patch: Partial<AudienceCondition>) => setConditions((c) => c.map((x, idx) => (idx === i ? { ...x, ...patch } : x)));
  const rm = (i: number) => setConditions((c) => c.filter((_, idx) => idx !== i));
  return (
    <ModalShell title="대상" subtitle="조건을 만족하는 고객 · 없으면 전체 활성 고객" icon={<Users className="w-4 h-4 text-slate-900" />} onClose={onClose}
      footer={<>
        <button onClick={onClose} className="px-4 py-2 rounded-lg bg-white hover:bg-slate-100 border border-slate-200 text-sm text-slate-600">닫기</button>
        <button onClick={() => onSave(conditions)} className="text-white px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-sm font-medium">저장</button>
      </>}>
      <p className="text-[11px] text-slate-500">등급·지역·매장·포인트 등 자유롭게 조합합니다. 조건이 없으면 전체 활성 고객이 대상입니다.</p>
      {conditions.map((c, i) => (
        <div key={i} className="flex items-center gap-1.5">
          <select value={c.field} onChange={(e) => upd(i, { field: e.target.value })} className="bg-white border border-slate-300 rounded px-2 py-1.5 text-xs text-slate-900">
            {COND_FIELDS.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
          </select>
          <select value={c.op} onChange={(e) => upd(i, { op: e.target.value })} className="bg-white border border-slate-300 rounded px-2 py-1.5 text-xs text-slate-900">
            {COND_OPS.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
          </select>
          <input value={c.value} onChange={(e) => upd(i, { value: e.target.value })} placeholder="값" className="flex-1 min-w-0 bg-white border border-slate-300 rounded px-2 py-1.5 text-xs text-slate-900" />
          <button onClick={() => rm(i)} className="p-1.5 rounded bg-white hover:bg-rose-100 border border-slate-200" aria-label="조건 삭제"><X className="w-3.5 h-3.5 text-slate-500" /></button>
        </div>
      ))}
      <button onClick={add} className="inline-flex items-center gap-1 text-xs text-indigo-700 hover:text-indigo-800"><Plus className="w-3.5 h-3.5" /> 조건 추가</button>
    </ModalShell>
  );
}
