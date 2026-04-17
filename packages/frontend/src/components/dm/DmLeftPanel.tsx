/**
 * DmLeftPanel — 좌측 패널 (240px)
 * 섹션 목록 + 섹션 추가 메뉴 + 브랜드킷 요약 (V2 확장).
 */
import { useDmBuilderStore } from '../../stores/dmBuilderStore';
import SectionList from './panels/SectionList';
import SectionAddMenu from './panels/SectionAddMenu';

export default function DmLeftPanel() {
  const sectionCount = useDmBuilderStore((s) => s.sections.length);
  const brandKit = useDmBuilderStore((s) => s.brandKit);

  return (
    <div
      style={{
        width: 240,
        flexShrink: 0,
        borderRight: '1px solid var(--dm-neutral-200)',
        background: 'var(--dm-bg)',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}
    >
      <div style={{ padding: '10px 12px', borderBottom: '1px solid var(--dm-neutral-200)' }}>
        <div style={{ fontSize: 11, color: 'var(--dm-neutral-500)', fontWeight: 700, letterSpacing: 0.5, textTransform: 'uppercase' }}>
          섹션 ({sectionCount})
        </div>
      </div>

      <div style={{ flex: 1, overflow: 'auto' }}>
        <SectionList />
      </div>

      <SectionAddMenu />

      <div style={{ borderTop: '1px solid var(--dm-neutral-200)', padding: '10px 12px', fontSize: 11 }}>
        <div style={{ color: 'var(--dm-neutral-500)', fontWeight: 700, letterSpacing: 0.5, textTransform: 'uppercase', marginBottom: 6 }}>
          브랜드 킷
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <div
            style={{
              width: 16,
              height: 16,
              borderRadius: 4,
              background: brandKit.primary_color || '#4f46e5',
              border: '1px solid var(--dm-neutral-200)',
            }}
          />
          <span style={{ color: 'var(--dm-neutral-700)' }}>
            {brandKit.primary_color || '#4f46e5'}
          </span>
        </div>
        <div style={{ marginTop: 4, color: 'var(--dm-neutral-500)' }}>
          톤: {brandKit.tone || '(미설정)'}
        </div>
      </div>
    </div>
  );
}
