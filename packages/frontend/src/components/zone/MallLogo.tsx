/**
 * MallLogo.tsx — 쇼핑몰 로고 타일(★ 2026-09-30 AI 존 대개편 · 설계서 §4-10 · D10)
 *
 * Harold "자사몰연동도 마찬가지 임팩트 있게 해당채널 로고를 박아서 보이게".
 * 저장소에 몰 공식 로고 파일이 없다. 공식 파일을 받으면 `public/brand/malls/`에 넣고 아래 `MALL_LOGO_FILE`에 한 줄을 더한다.
 * 목록에 없으면 글자 타일을 그린다(없는 파일을 매번 요청하지 않는다).
 * ⛔ 글자 타일의 색·글자는 자리 표시다(각 사 브랜드 가이드 확인 전). 공식 파일을 받으면 그 파일이 이긴다.
 */
import { Code2 } from 'lucide-react';

const TEXT_TILE: Record<string, { text: string; bg: string; fs: number }> = {
  cafe24: { text: 'cafe24', bg: '#1D4ED8', fs: 0.25 },
  naver: { text: 'N', bg: '#03C75A', fs: 0.46 },
  godo: { text: 'godo', bg: '#EA580C', fs: 0.28 },
  makeshop: { text: 'M', bg: '#DC2626', fs: 0.46 },
  imweb: { text: 'imweb', bg: '#111827', fs: 0.24 },
  woocommerce: { text: 'Woo', bg: '#7F54B3', fs: 0.3 },
};

/** 공식 로고 파일(받은 것만) — 예: cafe24: '/brand/malls/cafe24.svg' */
const MALL_LOGO_FILE: Record<string, string> = {};

export default function MallLogo({ provider, name, size = 44 }: { provider: string; name: string; size?: number }) {
  const src = MALL_LOGO_FILE[provider] || null;
  const radius = Math.round(size * 0.27);
  if (src) {
    return (
      <span className="inline-flex items-center justify-center shrink-0 bg-white border border-slate-200 overflow-hidden" style={{ width: size, height: size, borderRadius: radius }}>
        <img
          src={src}
          alt={`${name} 로고`}
          className="w-[78%] h-[78%] object-contain"
          draggable={false}
        />
      </span>
    );
  }
  const t = TEXT_TILE[provider];
  if (!t) {
    // 자체 호스팅(custom) 등 = 코드 모양 타일
    return (
      <span className="inline-flex items-center justify-center shrink-0 text-white" style={{ width: size, height: size, borderRadius: radius, background: '#475569' }} aria-hidden="true">
        <Code2 style={{ width: size * 0.48, height: size * 0.48 }} />
      </span>
    );
  }
  return (
    <span className="inline-flex items-center justify-center shrink-0 text-white font-extrabold tracking-[-0.02em] select-none" style={{ width: size, height: size, borderRadius: radius, background: t.bg, fontSize: Math.round(size * t.fs) }} aria-label={`${name} 로고`}>
      {t.text}
    </span>
  );
}
