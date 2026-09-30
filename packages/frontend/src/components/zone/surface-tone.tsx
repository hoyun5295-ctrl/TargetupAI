/**
 * surface-tone.tsx — 지금 그리는 표면이 밝은 작업대인가(★ 2026-09-30 AI 존 대개편 · 설계서 §3-1 · §5)
 *
 * 왜 있는가: AI 존 밖(대시보드·대행 발송 등)에서도 함께 쓰는 공용 창(ConfirmModal · 발송 대상 확인 · 이미지 고르기 등)은
 *   파일 하나가 두 화면을 섬긴다. AI 존은 밝은 작업대로 바뀌었고 다른 화면은 그대로다. 창의 톤은 **그 창을 여는 부모**를
 *   따라야 한다(LESSONS_FRONTEND 0822 "자식 창 톤은 부모를 따른다"). 그래서 부모(ZoneFrame · EditShell)가 문맥으로
 *   'light'를 내려 주고, 공용 창은 이 값을 읽어 밝은 짝을 고른다. **문맥이 없으면 'dark' = 지금 그대로**(AI 존 밖 회귀 0).
 *
 * 창은 포털로 document.body 에 그려져도 React 문맥은 포털을 따라 전달된다.
 */
import { createContext, useContext, type ReactNode } from 'react';

export type SurfaceTone = 'light' | 'dark';

const SurfaceToneContext = createContext<SurfaceTone>('dark');

export function SurfaceToneProvider({ tone, children }: { tone: SurfaceTone; children: ReactNode }) {
  return <SurfaceToneContext.Provider value={tone}>{children}</SurfaceToneContext.Provider>;
}

/** 공용 창이 부른다: true = 밝은 작업대 위(AI 존) */
export function useLightSurface(): boolean {
  return useContext(SurfaceToneContext) === 'light';
}
