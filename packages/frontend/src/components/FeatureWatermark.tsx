/**
 * FeatureWatermark — 기능 설명 화면(기능 안내 창 · 소개 페이지)에만 로그인 아이디 · 시각을 아주 옅게 깐다
 * (★2026-10-07 Harold 「기능 설명이 있는 부분에만 · 무료 체험까지만 · 정상 유료 고객사는 넣지 마」)
 *
 * 걸지 말지는 서버가 정한다(GET /api/plans/feature-intros 의 watermark). 여기는 그리기만 한다.
 * 부모의 위치 상자를 덮는다(absolute inset-0) · 클릭을 막지 않는다 · 캡처를 보정하면 드러나는 정도.
 */
import { useEffect, useMemo, useState } from 'react';
import { useAuthStore } from '../stores/authStore';

/** 진하기 — 실제 화면으로 보고 정한다(Harold) */
export const WATERMARK_OPACITY = 0.07;

const stamp = () => {
  const d = new Date(Date.now() + 9 * 3600 * 1000); // KST
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`;
};
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

export default function FeatureWatermark({ on }: { on: boolean }) {
  const loginId = useAuthStore((s) => s.user?.loginId || '');
  const [now, setNow] = useState(stamp);
  useEffect(() => {
    if (!on) return;
    const t = window.setInterval(() => setNow(stamp()), 60 * 1000);
    return () => window.clearInterval(t);
  }, [on]);
  const bg = useMemo(() => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="340" height="190"><text x="16" y="112" transform="rotate(-24 170 95)" font-family="sans-serif" font-size="15" fill="#808080">${esc(`${loginId} · ${now}`)}</text></svg>`;
    return `url("data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}")`;
  }, [loginId, now]);
  if (!on || !loginId) return null;
  return (
    <div aria-hidden="true" data-fwm=""
      style={{ position: 'absolute', inset: 0, zIndex: 2147483000, pointerEvents: 'none', backgroundImage: bg, backgroundRepeat: 'repeat', opacity: WATERMARK_OPACITY }} />
  );
}
