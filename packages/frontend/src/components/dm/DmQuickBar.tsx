/**
 * DmQuickBar — ★ 2026-07-16 M4 전역 퀵바 (설계서 §1-3)
 *
 * 캔버스 위 얇은 바 — 실효 1클릭 컨트롤만:
 *   [서체] 서체 모달(FontApplyModal) — 각 서체 실제 글꼴 미리보기 + 누르면 전 섹션(제목+본문) 일괄 적용
 *   [브랜드 킷] 색·로고·연락처 관리 모달
 *   [테마] 디자인 테마(비파괴 — 색·서체만 패치) 모달
 * 원칙: 실소비 검증된 속성만 노출(죽은 컨트롤 금지).
 *   ★ 서체는 팝오버였으나 부모 overflowX:auto에 잘려("저딴식") 모달로 교체(LESSONS_FRONTEND 클리핑 함정).
 */
import { useDmBuilderStore } from '../../stores/dmBuilderStore';
import { DM_FONT_CATALOG } from '../../utils/dm-tokens';

export default function DmQuickBar() {
  const brandKit = useDmBuilderStore((s) => s.brandKit);
  const setOpenModal = useDmBuilderStore((s) => s.setOpenModal);

  const currentFont = DM_FONT_CATALOG.find(
    (c) => (brandKit.font_family || '').includes(c.css.split(',')[0].replace(/"/g, '').trim()),
  );

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

      {/* 서체 일괄 — 모달(미리보기)로 진입. 팝오버는 바 overflow에 잘려 폐기. */}
      <button onClick={() => setOpenModal('font')} style={chipStyle} title="전 섹션 서체 일괄 적용 (미리보기)">
        🔤 서체{currentFont ? ` — ${currentFont.label.replace(/\s*\(.*\)$/, '')}` : ''}
      </button>

      {/* ★ 2026-07-21 브랜드 킷 편집 제거 — 브랜드 편집은 AI메모리 "브랜드 학습" 단일 창구로 일원화. DM은 회사 브랜드 상속(기존 DM별 override 렌더는 유지). */}
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
