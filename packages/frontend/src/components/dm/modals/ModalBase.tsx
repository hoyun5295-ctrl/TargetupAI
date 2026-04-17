/**
 * ModalBase — DM Builder 모달 공용 레이아웃 (D126 V2)
 *
 * 특징:
 *  - fixed overlay + center align
 *  - ESC 키로 닫기
 *  - 백드롭 클릭으로 닫기 (옵션)
 *  - 접근성: role=dialog, aria-modal
 *  - 크기 variants: sm/md/lg/xl
 */
import { useEffect } from 'react';
import type { ReactNode } from 'react';

export type ModalBaseProps = {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  children: ReactNode;
  footer?: ReactNode;
  closeOnBackdrop?: boolean;
  closeOnEsc?: boolean;
  /** 제목 옆 배지 (옵션) */
  badge?: ReactNode;
};

const WIDTHS: Record<string, number> = {
  sm: 420,
  md: 560,
  lg: 780,
  xl: 1040,
};

export default function ModalBase({
  open,
  onClose,
  title,
  subtitle,
  size = 'md',
  children,
  footer,
  closeOnBackdrop = true,
  closeOnEsc = true,
  badge,
}: ModalBaseProps) {
  useEffect(() => {
    if (!open || !closeOnEsc) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, closeOnEsc, onClose]);

  // body scroll lock
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  if (!open) return null;

  const width = WIDTHS[size] ?? WIDTHS.md;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(15,23,42,0.55)',
        zIndex: 1000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 16,
        animation: 'dmModalFadeIn 150ms ease-out',
      }}
      onClick={(e) => {
        if (!closeOnBackdrop) return;
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        style={{
          background: '#fff',
          borderRadius: 16,
          width: '100%',
          maxWidth: width,
          maxHeight: 'calc(100vh - 32px)',
          display: 'flex',
          flexDirection: 'column',
          boxShadow: '0 24px 64px rgba(0,0,0,0.35)',
          animation: 'dmModalZoomIn 180ms ease-out',
          overflow: 'hidden',
        }}
      >
        <header
          style={{
            padding: '18px 22px 14px',
            borderBottom: '1px solid #e5e7eb',
            display: 'flex',
            alignItems: 'flex-start',
            justifyContent: 'space-between',
            gap: 12,
          }}
        >
          <div style={{ flex: 1 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <h2 style={{ margin: 0, fontSize: 17, fontWeight: 700, color: '#111827' }}>
                {title}
              </h2>
              {badge}
            </div>
            {subtitle && (
              <p style={{ margin: '4px 0 0', fontSize: 13, color: '#6b7280', lineHeight: 1.5 }}>
                {subtitle}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="닫기"
            style={{
              flex: '0 0 auto',
              width: 32,
              height: 32,
              border: 'none',
              background: 'transparent',
              borderRadius: 8,
              cursor: 'pointer',
              fontSize: 18,
              color: '#6b7280',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            ✕
          </button>
        </header>

        <div style={{ padding: 22, overflow: 'auto', flex: 1 }}>{children}</div>

        {footer && (
          <footer
            style={{
              padding: '14px 22px',
              borderTop: '1px solid #e5e7eb',
              background: '#f9fafb',
              display: 'flex',
              gap: 8,
              justifyContent: 'flex-end',
              alignItems: 'center',
            }}
          >
            {footer}
          </footer>
        )}
      </div>

      <style>{`
        @keyframes dmModalFadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        @keyframes dmModalZoomIn {
          from { opacity: 0; transform: scale(0.96) translateY(8px); }
          to { opacity: 1; transform: scale(1) translateY(0); }
        }
      `}</style>
    </div>
  );
}

// ────────────── 공용 버튼 (footer용) ──────────────

export function ModalButton({
  variant = 'secondary',
  children,
  disabled,
  loading,
  onClick,
  type = 'button',
}: {
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
  children: ReactNode;
  disabled?: boolean;
  loading?: boolean;
  onClick?: () => void;
  type?: 'button' | 'submit';
}) {
  const base: React.CSSProperties = {
    height: 38,
    padding: '0 16px',
    fontSize: 13,
    fontWeight: 600,
    borderRadius: 8,
    cursor: disabled || loading ? 'not-allowed' : 'pointer',
    border: 'none',
    transition: 'all 120ms',
    opacity: disabled || loading ? 0.55 : 1,
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
  };
  const variants: Record<string, React.CSSProperties> = {
    primary: { background: '#4f46e5', color: '#fff' },
    secondary: { background: '#fff', color: '#374151', border: '1px solid #d1d5db' },
    danger: { background: '#dc2626', color: '#fff' },
    ghost: { background: 'transparent', color: '#6b7280' },
  };
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled || loading}
      style={{ ...base, ...variants[variant] }}
    >
      {loading && <span style={{ display: 'inline-block', width: 12, height: 12, border: '2px solid currentColor', borderRightColor: 'transparent', borderRadius: '50%', animation: 'dmSpin 0.8s linear infinite' }} />}
      {children}
      <style>{`@keyframes dmSpin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
    </button>
  );
}
