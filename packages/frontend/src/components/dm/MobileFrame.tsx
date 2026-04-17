/**
 * MobileFrame — 모바일 프레임 (320~430px)
 * 캔버스 중앙에 배치되는 "가짜 폰" 컨테이너.
 */
import type { ReactNode } from 'react';

export type MobileFrameProps = {
  width?: number;             // 기본 375
  children: ReactNode;
  showNotch?: boolean;        // 상단 노치
};

export default function MobileFrame({ width = 375, children, showNotch = true }: MobileFrameProps) {
  return (
    <div
      className="dm-mobile-frame"
      style={{
        width,
        maxWidth: 'min(100%, 430px)',
        minWidth: 320,
        margin: '0 auto',
        background: 'var(--dm-bg)',
        borderRadius: 'var(--dm-radius-2xl)',
        overflow: 'hidden',
        boxShadow: 'var(--dm-shadow-xl)',
        position: 'relative',
      }}
    >
      {showNotch && (
        <div
          aria-hidden
          style={{
            height: 24,
            background: 'var(--dm-neutral-900)',
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'flex-end',
            paddingBottom: 4,
          }}
        >
          <div style={{ width: 88, height: 16, background: 'var(--dm-neutral-1000)', borderRadius: 'var(--dm-radius-full)' }} />
        </div>
      )}
      <div style={{ background: 'var(--dm-bg)', minHeight: 600 }}>
        {children}
      </div>
    </div>
  );
}
