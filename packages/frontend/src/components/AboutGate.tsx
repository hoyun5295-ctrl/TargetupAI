/**
 * AboutGate — 소개 페이지(/about) 숨김 문 (★2026-10-07 Harold: 허용 계정(기본 hoyun)만 · 대표 미팅 시연용)
 * 판정 = 서버 GET /api/ai/about-page/access 하나. 허용이 확인되기 전에는 소개 페이지 코드(지연 로드 청크)도 받지 않는다.
 * 허용이 아니면 페이지가 있다는 것도 드러내지 않고 첫 화면으로 보낸다.
 */
import { useEffect, useState, type ReactNode } from 'react';
import { Navigate } from 'react-router-dom';

export default function AboutGate({ children }: { children: ReactNode }) {
  const [allowed, setAllowed] = useState<boolean | null>(null);
  useEffect(() => {
    let alive = true;
    fetch('/api/ai/about-page/access', { headers: { Authorization: `Bearer ${localStorage.getItem('token')}` } })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (alive) setAllowed(d?.allowed === true); })
      .catch(() => { if (alive) setAllowed(false); });
    return () => { alive = false; };
  }, []);
  if (allowed === null) return null;
  return allowed ? <>{children}</> : <Navigate to="/" replace />;
}
