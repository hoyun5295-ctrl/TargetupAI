/**
 * DmQuickBar — ★ 2026-07-16 M4 전역 퀵바 (설계서 §1-3)
 *
 * 캔버스 위 얇은 바 — 실효 1클릭 컨트롤만:
 *   [서체] 12종 그리드 팝오버 — 누르면 전 섹션(헤드라인+본문) 일괄 적용 (Harold "Pretendard 누르면 전부 적용")
 *   [브랜드 킷] 색·로고·연락처 관리 모달
 *   [테마] 디자인 테마(비파괴 — 색·서체만 패치) 모달
 * 원칙: 실소비 검증된 속성만 노출(죽은 컨트롤 금지) — 모션 등은 소비 축 확정 후에만 추가.
 */
import { useEffect, useRef, useState } from 'react';
import { useDmBuilderStore } from '../../stores/dmBuilderStore';
import { DM_FONT_CATALOG } from '../../utils/dm-tokens';

export default function DmQuickBar() {
  const brandKit = useDmBuilderStore((s) => s.brandKit);
  const updateBrandKit = useDmBuilderStore((s) => s.updateBrandKit);
  const setOpenModal = useDmBuilderStore((s) => s.setOpenModal);
  const setToast = useDmBuilderStore((s) => s.setToast);

  const [fontOpen, setFontOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!fontOpen) return;
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setFontOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [fontOpen]);

  const currentFont = DM_FONT_CATALOG.find((c) => (brandKit.font_family || '').includes(c.css.split(',')[0].replace(/"/g, '').trim()));

  const applyFont = (css: string, label: string) => {
    // 헤드라인+본문 일괄 — "누르면 전부 그 서체" (개별 조정은 브랜드 킷 모달의 페어링에서)
    updateBrandKit({ font_family: css, font_display: css });
    setFontOpen(false);
    setToast({ type: 'success', message: `전체 서체를 "${label}"(으)로 적용했어요.` });
  };

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        padding: '6px 12px',
        borderBottom: '1px solid var(--dm-neutral-200)',
        background: 'var(--dm-neutral-50)',
        flexShrink: 0,
        overflowX: 'auto',
      }}
    >
      <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--dm-neutral-500)', flexShrink: 0 }}>빠른 스타일</span>

      {/* 서체 일괄 */}
      <div ref={wrapRef} style={{ position: 'relative', flexShrink: 0 }}>
        <button onClick={() => setFontOpen((v) => !v)} style={chipStyle} title="전 섹션 서체 일괄 적용">
          🔤 서체{currentFont ? ` — ${currentFont.label.replace(/\s*\(.*\)$/, '')}` : ''}
        </button>
        {fontOpen && (
          <div
            style={{
              position: 'absolute', top: 34, left: 0, zIndex: 1300, width: 260,
              background: 'var(--dm-bg)', border: '1px solid var(--dm-neutral-200)', borderRadius: 10,
              boxShadow: '0 8px 24px rgba(15,23,42,0.14)', padding: 6, maxHeight: 320, overflowY: 'auto',
            }}
          >
            {DM_FONT_CATALOG.map((c) => (
              <button
                key={c.id}
                onClick={() => applyFont(c.css, c.label)}
                style={{
                  width: '100%', textAlign: 'left', border: 'none', background: 'transparent',
                  padding: '8px 10px', borderRadius: 6, cursor: 'pointer',
                  fontFamily: c.css, fontSize: 14, color: 'var(--dm-neutral-900)',
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8,
                }}
                onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--dm-neutral-50)')}
                onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
              >
                <span>{c.label}</span>
                {currentFont?.id === c.id && <span style={{ fontSize: 11, color: 'var(--dm-primary)', fontWeight: 700 }}>적용 중</span>}
              </button>
            ))}
          </div>
        )}
      </div>

      <button onClick={() => setOpenModal('brand-kit')} style={chipStyle} title="브랜드 색·로고·연락처 관리">
        🎨 브랜드 킷
      </button>
      <button onClick={() => setOpenModal('design-theme')} style={chipStyle} title="디자인 테마 — 색·서체만 바꿔 입혀요 (내용은 그대로)">
        🪄 테마
      </button>
    </div>
  );
}

const chipStyle: React.CSSProperties = {
  height: 28,
  padding: '0 10px',
  border: '1px solid var(--dm-neutral-200)',
  background: 'var(--dm-bg)',
  color: 'var(--dm-neutral-700)',
  fontSize: 12,
  fontWeight: 600,
  borderRadius: 8,
  cursor: 'pointer',
  whiteSpace: 'nowrap',
  flexShrink: 0,
};
