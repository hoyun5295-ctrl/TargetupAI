/**
 * 전단AI 디자인 시스템 — 공통 UI 컴포넌트
 */
import type { ReactNode, ButtonHTMLAttributes, InputHTMLAttributes, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react';

// ════════════════════════════════════════
// Section Card — 콘텐츠 섹션 래퍼
// ════════════════════════════════════════
export function SectionCard({ title, action, children, className = '' }: {
  title?: string; action?: ReactNode; children: ReactNode; className?: string;
}) {
  return (
    <div className={`bg-surface border border-border rounded-xl shadow-card overflow-hidden ${className}`}>
      {title && (
        <div className="px-5 py-3 border-b border-border flex items-center justify-between">
          <h3 className="text-sm font-semibold text-text">{title}</h3>
          {action}
        </div>
      )}
      <div className="p-5">{children}</div>
    </div>
  );
}

// ════════════════════════════════════════
// Button
// ════════════════════════════════════════
type BtnVariant = 'primary' | 'secondary' | 'danger' | 'ghost';
type BtnSize = 'sm' | 'md' | 'lg';

const btnStyles: Record<BtnVariant, string> = {
  primary: 'bg-primary-600 hover:bg-primary-700 text-white shadow-sm',
  secondary: 'bg-surface border border-border hover:bg-bg text-text',
  danger: 'bg-error-500 hover:bg-error-600 text-white',
  ghost: 'text-text-secondary hover:text-text hover:bg-bg',
};
const btnSizes: Record<BtnSize, string> = {
  sm: 'px-3 py-1.5 text-xs rounded-lg',
  md: 'px-4 py-2 text-sm rounded-xl',
  lg: 'px-6 py-3 text-sm rounded-xl',
};

export function Button({ variant = 'primary', size = 'md', className = '', children, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: BtnVariant; size?: BtnSize }) {
  return (
    <button className={`font-semibold transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${btnStyles[variant]} ${btnSizes[size]} ${className}`} {...props}>
      {children}
    </button>
  );
}

// ════════════════════════════════════════
// Input
// ════════════════════════════════════════
export function Input({ label, className = '', ...props }: InputHTMLAttributes<HTMLInputElement> & { label?: string }) {
  return (
    <div>
      {label && <label className="block text-xs font-medium text-text-secondary mb-1.5">{label}</label>}
      <input className={`w-full px-3 py-2.5 border border-border rounded-lg text-sm text-text bg-surface focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500 transition-shadow placeholder:text-text-muted ${className}`} {...props} />
    </div>
  );
}

// ════════════════════════════════════════
// Select
// ════════════════════════════════════════
export function Select({ label, children, className = '', ...props }: SelectHTMLAttributes<HTMLSelectElement> & { label?: string }) {
  return (
    <div>
      {label && <label className="block text-xs font-medium text-text-secondary mb-1.5">{label}</label>}
      <select className={`w-full px-3 py-2.5 border border-border rounded-lg text-sm text-text bg-surface focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500 transition-shadow ${className}`} {...props}>
        {children}
      </select>
    </div>
  );
}

// ════════════════════════════════════════
// Textarea
// ════════════════════════════════════════
export function Textarea({ label, className = '', ...props }: TextareaHTMLAttributes<HTMLTextAreaElement> & { label?: string }) {
  return (
    <div>
      {label && <label className="block text-xs font-medium text-text-secondary mb-1.5">{label}</label>}
      <textarea className={`w-full px-3 py-2.5 border border-border rounded-lg text-sm text-text bg-surface focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500 transition-shadow resize-none placeholder:text-text-muted ${className}`} {...props} />
    </div>
  );
}

// ════════════════════════════════════════
// Tab Bar
// ════════════════════════════════════════
export function TabBar<T extends string>({ tabs, value, onChange, className = '' }: {
  tabs: { key: T; label: string }[]; value: T; onChange: (key: T) => void; className?: string;
}) {
  return (
    <div className={`flex bg-bg rounded-lg p-1 gap-0.5 ${className}`}>
      {tabs.map(t => (
        <button key={t.key} onClick={() => onChange(t.key)}
          className={`flex-1 py-2 text-xs font-semibold rounded-md transition-all ${
            value === t.key ? 'bg-surface shadow-sm text-primary-600' : 'text-text-muted hover:text-text-secondary'
          }`}
        >{t.label}</button>
      ))}
    </div>
  );
}

// ════════════════════════════════════════
// Badge
// ════════════════════════════════════════
type BadgeVariant = 'success' | 'error' | 'warn' | 'neutral' | 'brand';
const badgeStyles: Record<BadgeVariant, string> = {
  success: 'bg-success-50 text-success-600',
  error: 'bg-error-50 text-error-600',
  warn: 'bg-warn-50 text-warn-500',
  neutral: 'bg-bg text-text-secondary',
  brand: 'bg-brand-50 text-brand-600',
};

export function Badge({ variant = 'neutral', children }: { variant?: BadgeVariant; children: ReactNode }) {
  return <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${badgeStyles[variant]}`}>{children}</span>;
}

// ════════════════════════════════════════
// Empty State
// ════════════════════════════════════════
export function EmptyState({ icon, title, description, action }: {
  icon: ReactNode; title: string; description?: string; action?: ReactNode;
}) {
  return (
    <div className="text-center py-16">
      <div className="w-16 h-16 bg-bg rounded-2xl flex items-center justify-center mx-auto mb-4 text-3xl">{icon}</div>
      <h3 className="text-base font-bold text-text mb-1">{title}</h3>
      {description && <p className="text-sm text-text-secondary mb-5 max-w-sm mx-auto leading-relaxed">{description}</p>}
      {action}
    </div>
  );
}

// ════════════════════════════════════════
// Confirm Modal
// ════════════════════════════════════════
export function ConfirmModal({ show, icon, title, message, confirmLabel, cancelLabel, onConfirm, onCancel, danger }: {
  show: boolean; icon?: ReactNode; title: string; message: string;
  confirmLabel?: string; cancelLabel?: string;
  onConfirm: () => void; onCancel: () => void; danger?: boolean;
}) {
  if (!show) return null;
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 backdrop-blur-[2px]">
      <div className="bg-surface rounded-2xl shadow-modal max-w-sm w-full mx-4 p-6">
        <div className="text-center mb-5">
          {icon && <div className="w-12 h-12 rounded-full bg-bg flex items-center justify-center text-2xl mx-auto mb-3">{icon}</div>}
          <h3 className="text-base font-bold text-text">{title}</h3>
          <p className="text-sm text-text-secondary mt-1.5 leading-relaxed">{message}</p>
        </div>
        <div className="flex gap-3">
          <Button variant="secondary" className="flex-1" onClick={onCancel}>{cancelLabel || '취소'}</Button>
          <Button variant={danger ? 'danger' : 'primary'} className="flex-1" onClick={onConfirm}>{confirmLabel || '확인'}</Button>
        </div>
      </div>
    </div>
  );
}

// ════════════════════════════════════════
// Toast
// ════════════════════════════════════════
export function Toast({ show, message }: { show: boolean; message: string }) {
  if (!show) return null;
  return (
    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 bg-text text-white px-5 py-2.5 rounded-xl text-sm shadow-elevated z-50 font-medium">
      {message}
    </div>
  );
}

// ════════════════════════════════════════
// Stat Card
// ════════════════════════════════════════
export function StatCard({ label, value, sub, className = '' }: {
  label: string; value: string | number; sub?: string; className?: string;
}) {
  return (
    <div className={`bg-surface border border-border rounded-xl p-5 shadow-card ${className}`}>
      <p className="text-xs font-medium text-text-secondary mb-1">{label}</p>
      <p className="text-2xl font-bold text-text">{value}</p>
      {sub && <p className="text-xs text-text-muted mt-1">{sub}</p>}
    </div>
  );
}

// ════════════════════════════════════════
// Data Table
// ════════════════════════════════════════
export function DataTable({ columns, rows, emptyMessage = '데이터가 없습니다' }: {
  columns: { key: string; label: string; align?: 'left' | 'center' | 'right'; render?: (val: any, row: any) => ReactNode }[];
  rows: any[];
  emptyMessage?: string;
}) {
  if (rows.length === 0) return <EmptyState icon="📋" title={emptyMessage} />;

  const alignClass = (a?: string) => a === 'center' ? 'text-center' : a === 'right' ? 'text-right' : 'text-left';

  return (
    <div className="bg-surface border border-border rounded-xl overflow-hidden shadow-card">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border bg-bg">
            {columns.map(c => <th key={c.key} className={`px-4 py-3 font-semibold text-text-secondary text-xs uppercase tracking-wider ${alignClass(c.align)}`}>{c.label}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={row.id || i} className="border-b border-border/50 hover:bg-bg/50 transition-colors">
              {columns.map(c => <td key={c.key} className={`px-4 py-3 ${alignClass(c.align)}`}>{c.render ? c.render(row[c.key], row) : row[c.key]}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
