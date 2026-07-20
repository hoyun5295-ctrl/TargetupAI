/**
 * MobileFrame — 모바일 프레임 (320~430px)
 * 캔버스 중앙에 배치되는 "가짜 폰" 컨테이너.
 */
import type { ReactNode } from 'react';

export type MobileFrameProps = {
  width?: number;             // 기본 375
  children: ReactNode;
};

// ★ 2026-07-20 남지현 재오픈("맨 처음 로고 시작 부분") — 로고 위 가짜 노치(검정 24px 바 + 흰 알약)를 제거.
//   단말기에는 없는 편집기 장식이라 "편집 화면 = 출력 화면" 대조 때마다 상단이 어긋나 보였다.
//   폰 형태 인지는 프레임 라운드·그림자가 이미 담당한다.
export default function MobileFrame({ width = 375, children }: MobileFrameProps) {
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
      <div style={{ background: 'var(--dm-bg)', minHeight: 600 }}>
        {children}
      </div>
    </div>
  );
}
