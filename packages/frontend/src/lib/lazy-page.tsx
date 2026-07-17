/**
 * ★ 2026-07-17 축 A — 페이지 lazy 로딩 공용 헬퍼 (M1 번들 스플리팅).
 *
 * 배경: App.tsx가 페이지 41개를 전부 정적 import → 단일 번들 10.1MB(로그인 화면도 전체 로드).
 * 페이지별 청크로 나누면 첫 진입은 로그인+공용 코드만 받는다.
 *
 * 청크 로드 실패 1회 자동 새로고침 가드:
 *   atomic 배포(safe-build)는 dist를 통째로 교체하므로 옛 청크 파일이 사라진다. 배포 직전부터
 *   화면을 열어두던 사용자가 페이지를 전환하면 옛 해시 청크 요청이 404 → 이때 세션당 1회
 *   자동 새로고침으로 새 index.html(새 해시)을 받게 한다. 성공 로드 시 플래그를 풀어
 *   다음 배포에서도 다시 1회 동작. 새로고침 후에도 실패하면(진짜 네트워크 장애) 그대로 throw —
 *   무한 새로고침 없이 에러가 드러난다.
 */
import { Component, lazy } from 'react';
import type { ComponentType, LazyExoticComponent, ReactNode } from 'react';

const CHUNK_RELOAD_FLAG = 'hj-chunk-reload-once';

export function lazyPage<T extends ComponentType<any>>(
  importer: () => Promise<{ default: T }>,
): LazyExoticComponent<T> {
  return lazy(() =>
    importer()
      .then((mod) => {
        sessionStorage.removeItem(CHUNK_RELOAD_FLAG);
        return mod;
      })
      .catch((err) => {
        if (!sessionStorage.getItem(CHUNK_RELOAD_FLAG)) {
          sessionStorage.setItem(CHUNK_RELOAD_FLAG, '1');
          window.location.reload();
          // 새로고침 진행 중 — 렌더를 영구 보류해 에러 화면 깜빡임 방지
          return new Promise<{ default: T }>(() => {});
        }
        throw err;
      }),
  );
}

/** 청크 선로딩 — 로그인 직후 대시보드 등 다음 동선의 청크를 백그라운드로 미리 받는다. 실패 무시(실사용 시 가드가 처리). */
export function prefetchPage(importer: () => Promise<unknown>): void {
  importer().catch(() => { /* 선로딩 실패 무시 */ });
}

/**
 * ★ Codex 확인 라운드 — 청크 로드가 자동 새로고침 후에도 실패하면(지속 404/5xx·손상 배포)
 * React가 앱 전체를 unmount해 백지가 된다. 에러 경계로 잡아 복구 가능한 화면(다시 시도)을 보여준다.
 */
export class PageErrorBoundary extends Component<{ fallback: ReactNode; children: ReactNode }, { hasError: boolean }> {
  state = { hasError: false };
  static getDerivedStateFromError() {
    return { hasError: true };
  }
  render() {
    return this.state.hasError ? this.props.fallback : this.props.children;
  }
}
