/**
 * useApprovalWindow — 몰 승인 창 열기 · 닫힘 감지(★ 2026-10-28 자사몰 대비 K14 N4)
 *
 * 창이 닫히면(1초마다 확인) onClosed 를 부른다 · 화면을 떠나면 확인을 멈춘다 ·
 * 팝업이 막히면 이 창에서 승인한다(몰 승인이 돌아오면 자사몰 연동 화면이 확정을 잇는다 · M24).
 * 자사몰 연동 화면 · 카페24 앱 실행 화면이 같은 도우미를 쓴다(「새로고침해주세요」 안내 0).
 */
import { useEffect, useRef } from 'react';

export function useApprovalWindow(onClosed: () => void): (url: string, name: string, w?: number, h?: number) => void {
  const timers = useRef<number[]>([]);
  const latest = useRef(onClosed);
  latest.current = onClosed;
  useEffect(() => () => { timers.current.forEach((id) => window.clearInterval(id)); timers.current = []; }, []);
  return (url, name, w = 720, h = 820) => {
    const win = window.open(url, name, `width=${w},height=${h}`);
    if (!win) { window.location.href = url; return; }
    const id = window.setInterval(() => {
      if (!win.closed) return;
      window.clearInterval(id);
      timers.current = timers.current.filter((x) => x !== id);
      latest.current();
    }, 1000);
    timers.current.push(id);
  };
}
