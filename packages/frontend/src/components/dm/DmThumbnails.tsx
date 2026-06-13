/**
 * DM 빌더 폰목업 썸네일 컴포넌트 (2026-06-13)
 *
 * - PhoneFrame: 공용 미니 폰 프레임(흰 화면 + 노치)
 * - DmThumbnail: 실제 DM 카드용 — 섹션 타입을 색 블록 스택으로 도식화
 * - QuickStartThumbnail: 빠른 시작 7 시나리오용 — 시나리오마다 고유 미니 화면 일러스트(SVG)
 *   (룰렛=회전판 / 매장안내=지도+핀 / 시즌세일=카운트다운+할인뱃지 등 — 시나리오가 한눈에 와닿게)
 */
import type { ReactNode } from 'react';

// ── 공용 폰 프레임 ───────────────────────────────────────────────
function PhoneFrame({ children }: { children: ReactNode }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'center' }}>
      <div style={{ width: 92, borderRadius: 14, border: '1px solid rgba(255,255,255,0.14)', background: '#f5f3ff', padding: 7, boxShadow: '0 4px 12px rgba(0,0,0,0.25)' }}>
        <div style={{ width: 26, height: 4, borderRadius: 3, background: '#cbd5e1', margin: '0 auto 6px' }} />
        <div style={{ width: 78, height: 150, overflow: 'hidden', borderRadius: 6, background: '#ffffff' }}>{children}</div>
      </div>
    </div>
  );
}

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

export function DmThumbnail({ types, accent, pageCount }: { types?: string[]; accent?: string | null; pageCount?: number }) {
  let blocks: Array<{ color: string; h: number }>;
  if (types && types.length > 0) {
    blocks = types.map((t) => {
      const v = SECTION_THUMB[t] || { color: '#cbd5e1', h: 12 };
      return (t === 'hero' || t === 'cta') && accent ? { color: accent, h: v.h } : v;
    });
  } else {
    const n = Math.min(Math.max(pageCount || 1, 1), 4);
    blocks = Array.from({ length: n }, (_, i) => ({ color: i === 0 ? (accent || '#a855f7') : '#cbd5e1', h: i === 0 ? 24 : 12 }));
  }
  return (
    <PhoneFrame>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 3, padding: 6 }}>
        {blocks.map((b, i) => (
          <div key={i} style={{ height: b.h, borderRadius: 3, background: b.color, opacity: 0.92, flexShrink: 0 }} />
        ))}
      </div>
    </PhoneFrame>
  );
}

// ── 빠른 시작 시나리오별 고유 미니 화면 (SVG) ─────────────────────
type QuickStartKey = 'cart' | 'sale' | 'draw' | 'store' | 'survey' | 'welcome' | 'roulette' | 'lookbook' | 'reviews' | 'flashsale' | 'poll' | 'vip';

function ScenarioScreen({ scenarioKey }: { scenarioKey: QuickStartKey }) {
  const common = { width: 78, height: 150, viewBox: '0 0 78 150' } as const;

  switch (scenarioKey) {
    case 'cart': // 신상품 출시 — 상품 사진 + 가격 + 구매 버튼 + 캐러셀 점
      return (
        <svg {...common} xmlns="http://www.w3.org/2000/svg">
          <rect x="10" y="12" width="58" height="52" rx="7" fill="#ede9fe" />
          <circle cx="24" cy="28" r="4.5" fill="#c4b5fd" />
          <path d="M12 60 L26 40 L36 50 L48 33 L66 60 Z" fill="#a78bfa" />
          <rect x="10" y="72" width="26" height="10" rx="5" fill="#a855f7" />
          <rect x="15" y="75.5" width="16" height="3" rx="1.5" fill="#fff" />
          <rect x="40" y="73" width="26" height="4" rx="2" fill="#cbd5e1" />
          <rect x="40" y="80" width="18" height="4" rx="2" fill="#e2e8f0" />
          <rect x="10" y="92" width="58" height="16" rx="8" fill="#a855f7" />
          <rect x="28" y="98" width="22" height="4" rx="2" fill="#fff" />
          <circle cx="33" cy="120" r="2.6" fill="#a855f7" />
          <circle cx="41" cy="120" r="2" fill="#ddd6fe" />
          <circle cx="49" cy="120" r="2" fill="#ddd6fe" />
        </svg>
      );
    case 'sale': // 시즌 세일 — 할인 뱃지 + 카운트다운 + CTA
      return (
        <svg {...common} xmlns="http://www.w3.org/2000/svg">
          <circle cx="39" cy="30" r="17" fill="#f43f5e" />
          <circle cx="33" cy="25" r="2.6" fill="#fff" />
          <circle cx="45" cy="35" r="2.6" fill="#fff" />
          <line x1="46" y1="22" x2="32" y2="38" stroke="#fff" strokeWidth="3" strokeLinecap="round" />
          <rect x="9" y="58" width="16" height="16" rx="3" fill="#1f2937" />
          <rect x="31" y="58" width="16" height="16" rx="3" fill="#1f2937" />
          <rect x="53" y="58" width="16" height="16" rx="3" fill="#1f2937" />
          <rect x="12.5" y="62" width="9" height="8" rx="1.5" fill="#f87171" />
          <rect x="34.5" y="62" width="9" height="8" rx="1.5" fill="#f87171" />
          <rect x="56.5" y="62" width="9" height="8" rx="1.5" fill="#f87171" />
          <circle cx="28" cy="63" r="1.2" fill="#94a3b8" />
          <circle cx="28" cy="69" r="1.2" fill="#94a3b8" />
          <circle cx="50" cy="63" r="1.2" fill="#94a3b8" />
          <circle cx="50" cy="69" r="1.2" fill="#94a3b8" />
          <rect x="10" y="88" width="58" height="16" rx="8" fill="#f43f5e" />
          <rect x="26" y="94" width="26" height="4" rx="2" fill="#fff" />
          <rect x="10" y="116" width="42" height="4" rx="2" fill="#e2e8f0" />
          <rect x="10" y="124" width="52" height="4" rx="2" fill="#f1f5f9" />
        </svg>
      );
    case 'draw': // 추첨 이벤트 — 선물상자 + 응모 버튼
      return (
        <svg {...common} xmlns="http://www.w3.org/2000/svg">
          <path d="M30 16 q-7 -4 -9 2 q-2 6 9 6" fill="none" stroke="#f59e0b" strokeWidth="3" strokeLinecap="round" />
          <path d="M48 16 q7 -4 9 2 q2 6 -9 6" fill="none" stroke="#f59e0b" strokeWidth="3" strokeLinecap="round" />
          <rect x="20" y="40" width="38" height="36" rx="3" fill="#fbbf24" />
          <rect x="17" y="32" width="44" height="11" rx="2.5" fill="#f59e0b" />
          <rect x="35" y="32" width="8" height="44" fill="#d97706" />
          <path d="M16 24 l4 4 M62 24 l-4 4 M39 22 v4" stroke="#fcd34d" strokeWidth="2.2" strokeLinecap="round" />
          <rect x="14" y="92" width="50" height="16" rx="8" fill="#f59e0b" />
          <rect x="30" y="98" width="18" height="4" rx="2" fill="#fff" />
          <rect x="18" y="120" width="42" height="4" rx="2" fill="#fde68a" />
        </svg>
      );
    case 'store': // 매장 안내 — 지도 + 위치 핀
      return (
        <svg {...common} xmlns="http://www.w3.org/2000/svg">
          <rect x="8" y="12" width="62" height="96" rx="6" fill="#ecfdf5" />
          <line x1="8" y1="52" x2="70" y2="52" stroke="#a7f3d0" strokeWidth="3" />
          <line x1="30" y1="12" x2="30" y2="108" stroke="#a7f3d0" strokeWidth="3" />
          <path d="M8 86 L40 58 L70 78" stroke="#6ee7b7" strokeWidth="2.5" fill="none" />
          <path d="M44 40 C37 40 33 45.5 33 52 C33 60 44 74 44 74 C44 74 55 60 55 52 C55 45.5 51 40 44 40 Z" fill="#10b981" />
          <circle cx="44" cy="51" r="4" fill="#fff" />
          <rect x="12" y="118" width="44" height="4" rx="2" fill="#cbd5e1" />
          <rect x="12" y="126" width="30" height="4" rx="2" fill="#e2e8f0" />
        </svg>
      );
    case 'survey': // 설문 + 보상 — 체크리스트 + 쿠폰
      return (
        <svg {...common} xmlns="http://www.w3.org/2000/svg">
          <circle cx="16" cy="22" r="5.5" fill="#0ea5e9" />
          <path d="M13.2 22 L15.4 24.4 L19 20" stroke="#fff" strokeWidth="1.8" fill="none" strokeLinecap="round" strokeLinejoin="round" />
          <rect x="27" y="18.5" width="40" height="7" rx="3.5" fill="#e0f2fe" />
          <circle cx="16" cy="42" r="5.5" fill="none" stroke="#bae6fd" strokeWidth="2" />
          <rect x="27" y="38.5" width="34" height="7" rx="3.5" fill="#f1f5f9" />
          <circle cx="16" cy="62" r="5.5" fill="none" stroke="#bae6fd" strokeWidth="2" />
          <rect x="27" y="58.5" width="40" height="7" rx="3.5" fill="#f1f5f9" />
          <rect x="10" y="84" width="58" height="34" rx="5" fill="#0ea5e9" />
          <circle cx="48" cy="84" r="3.5" fill="#fff" />
          <circle cx="48" cy="118" r="3.5" fill="#fff" />
          <line x1="48" y1="88" x2="48" y2="114" stroke="#fff" strokeWidth="1.4" strokeDasharray="3 3" />
          <rect x="16" y="94" width="22" height="5" rx="2.5" fill="#fff" />
          <rect x="16" y="103" width="14" height="4" rx="2" fill="#bae6fd" />
          <text x="56" y="105" fill="#fff" fontSize="13" fontWeight="700" textAnchor="middle">%</text>
        </svg>
      );
    case 'welcome': // 신규 환영 — 편지 봉투 + 쿠폰
      return (
        <svg {...common} xmlns="http://www.w3.org/2000/svg">
          <rect x="13" y="24" width="52" height="36" rx="4" fill="#fae8ff" stroke="#d946ef" strokeWidth="1.6" />
          <path d="M13.5 26 L39 45 L64.5 26" fill="none" stroke="#d946ef" strokeWidth="1.6" strokeLinejoin="round" />
          <path d="M39 36 c-1.6 -2.6 -6 -1.6 -6 1.6 c0 2.6 6 6 6 6 c0 0 6 -3.4 6 -6 c0 -3.2 -4.4 -4.2 -6 -1.6 Z" fill="#d946ef" />
          <rect x="14" y="72" width="50" height="20" rx="5" fill="#d946ef" />
          <rect x="22" y="79" width="26" height="4" rx="2" fill="#fff" />
          <rect x="51" y="78" width="8" height="7" rx="2" fill="#f5d0fe" />
          <rect x="14" y="102" width="40" height="4" rx="2" fill="#f5d0fe" />
          <rect x="14" y="110" width="50" height="4" rx="2" fill="#fae8ff" />
        </svg>
      );
    case 'roulette': // 룰렛 이벤트 — 8칸 회전판
      return (
        <svg {...common} xmlns="http://www.w3.org/2000/svg">
          <path d="M39 62 L39 36 A26 26 0 0 1 57.4 43.6 Z" fill="#6366f1" />
          <path d="M39 62 L57.4 43.6 A26 26 0 0 1 65 62 Z" fill="#c7d2fe" />
          <path d="M39 62 L65 62 A26 26 0 0 1 57.4 80.4 Z" fill="#6366f1" />
          <path d="M39 62 L57.4 80.4 A26 26 0 0 1 39 88 Z" fill="#c7d2fe" />
          <path d="M39 62 L39 88 A26 26 0 0 1 20.6 80.4 Z" fill="#6366f1" />
          <path d="M39 62 L20.6 80.4 A26 26 0 0 1 13 62 Z" fill="#c7d2fe" />
          <path d="M39 62 L13 62 A26 26 0 0 1 20.6 43.6 Z" fill="#6366f1" />
          <path d="M39 62 L20.6 43.6 A26 26 0 0 1 39 36 Z" fill="#c7d2fe" />
          <circle cx="39" cy="62" r="5" fill="#fff" stroke="#6366f1" strokeWidth="1.6" />
          <circle cx="39" cy="62" r="2" fill="#6366f1" />
          <path d="M39 31 L34.5 39 L43.5 39 Z" fill="#312e81" />
          <rect x="14" y="110" width="50" height="15" rx="7.5" fill="#6366f1" />
          <rect x="30" y="115" width="18" height="4" rx="2" fill="#fff" />
        </svg>
      );
    default: // 신규 시나리오 — 섹션 색블록 스택(헤더 + 비주얼 + 본문 + 버튼)
      return (
        <svg {...common} xmlns="http://www.w3.org/2000/svg">
          <rect x="10" y="14" width="58" height="12" rx="3" fill="#a78bfa" />
          <rect x="10" y="32" width="58" height="34" rx="4" fill="#ddd6fe" />
          <rect x="10" y="72" width="40" height="5" rx="2.5" fill="#cbd5e1" />
          <rect x="10" y="82" width="52" height="5" rx="2.5" fill="#e2e8f0" />
          <rect x="10" y="92" width="46" height="5" rx="2.5" fill="#e2e8f0" />
          <rect x="14" y="110" width="50" height="15" rx="7.5" fill="#8b5cf6" />
          <rect x="30" y="115" width="18" height="4" rx="2" fill="#fff" />
        </svg>
      );
  }
}

export function QuickStartThumbnail({ scenarioKey }: { scenarioKey: QuickStartKey }) {
  return (
    <PhoneFrame>
      <ScenarioScreen scenarioKey={scenarioKey} />
    </PhoneFrame>
  );
}
