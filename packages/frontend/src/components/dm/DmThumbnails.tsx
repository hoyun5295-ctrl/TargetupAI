/**
 * DM 빌더 폰목업 썸네일 컴포넌트 (2026-06-13)
 *
 * - DmMiniCover: 목록 리스트형 대표 이미지(없으면 섹션 색 블록)
 * ★ 2026-09-16 빠른 시작 시나리오 썸네일·옛 폰목업 썸네일은 소비처 0 이 되어 제거(블록 조립·리스트형 전환)
 */
import { useState } from 'react';

// ── 실제 DM 카드 썸네일 (섹션 타입 → 블록) ────────────────────────
const SECTION_THUMB: Record<string, { color: string; h: number }> = {
  header: { color: '#c4b5fd', h: 8 }, hero: { color: '#a855f7', h: 26 },
  product_carousel: { color: '#60a5fa', h: 22 }, gallery: { color: '#60a5fa', h: 22 }, slideshow: { color: '#60a5fa', h: 22 },
  video: { color: '#6366f1', h: 20 }, text_card: { color: '#cbd5e1', h: 16 },
  coupon: { color: '#f59e0b', h: 12 }, promo_code: { color: '#f59e0b', h: 12 }, countdown: { color: '#f43f5e', h: 10 },
  cta: { color: '#8b5cf6', h: 11 }, poll: { color: '#10b981', h: 18 }, survey: { color: '#10b981', h: 18 },
  email_capture: { color: '#10b981', h: 16 }, lucky_draw: { color: '#22c55e', h: 20 }, roulette: { color: '#22c55e', h: 22 },
  store_info: { color: '#14b8a6', h: 14 }, sns: { color: '#ec4899', h: 8 }, footer: { color: '#94a3b8', h: 6 },
};

// ── 목록 리스트형 대표 이미지 (★ 2026-09-16 Harold A안) ─────────────
/** DM 안 첫 이미지(서버 section_summary.cover)를 작은 썸네일로. 없거나 못 불러오면 섹션 색 블록(SECTION_THUMB 공용 색)으로 대체 */
export function DmMiniCover({ cover, types, accent, pageCount, width = 44, height = 56 }: {
  cover?: string | null; types?: string[]; accent?: string | null; pageCount?: number; width?: number; height?: number;
}) {
  const [broken, setBroken] = useState(false);
  const box = { width, height, borderRadius: 8, overflow: 'hidden', flexShrink: 0, background: '#1e1b4b', border: '1px solid rgba(255,255,255,0.08)' } as const;
  if (cover && !broken) {
    return (
      <div style={box}>
        <img src={cover} alt="" loading="lazy" onError={() => setBroken(true)} style={{ width: '100%', height: '100%', objectFit: 'cover', objectPosition: 'top', display: 'block' }} />
      </div>
    );
  }
  const keys = types && types.length > 0
    ? types.slice(0, 4)
    : Array.from({ length: Math.min(Math.max(pageCount || 1, 1), 3) }, (_, i) => (i === 0 ? 'hero' : 'text_card'));
  return (
    <div style={{ ...box, display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 3, padding: '0 8px' }}>
      {keys.map((t, i) => {
        const v = SECTION_THUMB[t] || { color: '#cbd5e1', h: 12 };
        const color = (t === 'hero' || t === 'cta') && accent ? accent : v.color;
        return <div key={i} style={{ height: Math.max(4, Math.round(v.h / 3)), borderRadius: 2, background: color, opacity: 0.85, flexShrink: 0 }} />;
      })}
    </div>
  );
}
