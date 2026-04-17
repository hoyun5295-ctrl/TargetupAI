/**
 * DmLeftPanel — 좌측 패널 (260px, D128 V4)
 *
 * 상단: 페이지 목록 (PageList)
 * 중단: 현재 페이지의 섹션 목록 (SectionList) + 섹션 추가 (SectionAddMenu)
 * 하단: 브랜드킷 요약
 */
import { useDmBuilderStore, selectCurrentPage } from '../../stores/dmBuilderStore';
import PageList from './panels/PageList';
import SectionList from './panels/SectionList';
import SectionAddMenu from './panels/SectionAddMenu';

export default function DmLeftPanel() {
  const brandKit = useDmBuilderStore((s) => s.brandKit);
  const currentPage = useDmBuilderStore(selectCurrentPage);
  const pages = useDmBuilderStore((s) => s.pages);
  const currentPageIndex = useDmBuilderStore((s) => s.currentPageIndex);

  const sectionCount = currentPage?.sections.length ?? 0;
  const pageLabel = currentPage?.name || `페이지 ${currentPageIndex + 1}`;

  return (
    <div
      style={{
        width: 260,
        flexShrink: 0,
        borderRight: '1px solid var(--dm-neutral-200)',
        background: 'var(--dm-bg)',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}
    >
      {/* 페이지 섹션 헤더 */}
      <div style={{ padding: '10px 12px', borderBottom: '1px solid var(--dm-neutral-200)' }}>
        <div style={{ fontSize: 11, color: 'var(--dm-neutral-500)', fontWeight: 700, letterSpacing: 0.5, textTransform: 'uppercase' }}>
          페이지 ({pages.length})
        </div>
      </div>

      {/* 페이지 목록 */}
      <div style={{ maxHeight: '35vh', overflow: 'auto', borderBottom: '1px solid var(--dm-neutral-200)' }}>
        <PageList />
      </div>

      {/* 현재 페이지의 섹션 헤더 */}
      <div style={{ padding: '10px 12px', borderBottom: '1px solid var(--dm-neutral-200)', background: 'var(--dm-neutral-50)' }}>
        <div style={{ fontSize: 10, color: 'var(--dm-neutral-500)', fontWeight: 600, marginBottom: 2 }}>
          현재 페이지
        </div>
        <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--dm-neutral-900)', display: 'flex', alignItems: 'center', gap: 4 }}>
          <span
            style={{
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              flex: 1,
            }}
            title={pageLabel}
          >
            {pageLabel}
          </span>
          <span style={{ fontSize: 10, padding: '1px 6px', background: 'var(--dm-primary-light)', color: 'var(--dm-primary)', borderRadius: 3, fontWeight: 700 }}>
            섹션 {sectionCount}
          </span>
        </div>
      </div>

      {/* 섹션 목록 */}
      <div style={{ flex: 1, overflow: 'auto' }}>
        <SectionList />
      </div>

      {/* 섹션 추가 메뉴 */}
      <SectionAddMenu />

      {/* 브랜드킷 요약 */}
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
