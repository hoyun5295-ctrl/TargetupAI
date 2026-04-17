/**
 * DmCanvas — 중앙 캔버스 영역 (D128 V4)
 *
 * 페이지 계층 구조:
 *  - 에디터는 "현재 페이지"의 섹션만 렌더 (세로 스크롤)
 *  - 페이지 전환은 좌측 PageList에서 클릭
 *  - 레이아웃 모드(scroll/scroll_snap/slides)는 뷰어에서 페이지 간 전환 방식을 결정
 *  - 에디터 상단에 현재 페이지 배지 + 페이지 네비게이션 힌트
 */
import { useDmBuilderStore } from '../../stores/dmBuilderStore';
import MobileFrame from './MobileFrame';
import { SectionRenderer } from './canvas';

export type DmCanvasProps = {
  onPromptClick?: () => void;
};

export default function DmCanvas({ onPromptClick }: DmCanvasProps) {
  const pages = useDmBuilderStore((s) => s.pages);
  const currentPageIndex = useDmBuilderStore((s) => s.currentPageIndex);
  const storeName = useDmBuilderStore((s) => s.storeName);
  const selectedSectionId = useDmBuilderStore((s) => s.selectedSectionId);
  const hoveredSectionId = useDmBuilderStore((s) => s.hoveredSectionId);
  const selectSection = useDmBuilderStore((s) => s.selectSection);
  const hoverSection = useDmBuilderStore((s) => s.hoverSection);
  const brandKit = useDmBuilderStore((s) => s.brandKit);
  const updateSectionProps = useDmBuilderStore((s) => s.updateSectionProps);
  const layoutMode = useDmBuilderStore((s) => s.layoutMode);
  const setOpenModal = useDmBuilderStore((s) => s.setOpenModal);
  const selectPage = useDmBuilderStore((s) => s.selectPage);
  const handlePromptClick = onPromptClick || (() => setOpenModal('ai-prompt'));

  const brandKitStyle: React.CSSProperties = {
    ...(brandKit.primary_color ? { ['--dm-primary' as any]: brandKit.primary_color } : {}),
    ...(brandKit.secondary_color ? { ['--dm-secondary' as any]: brandKit.secondary_color } : {}),
    ...(brandKit.accent_color ? { ['--dm-accent' as any]: brandKit.accent_color } : {}),
    ...(brandKit.background_color ? { ['--dm-bg' as any]: brandKit.background_color } : {}),
  };

  const currentPage = pages[currentPageIndex];
  const sections = currentPage?.sections || [];
  const sortedSections = sections.slice().sort((a, b) => a.order - b.order);
  const pageLabel = currentPage?.name || `페이지 ${currentPageIndex + 1}`;
  const totalPages = pages.length;

  const modeLabel: Record<string, string> = {
    scroll: '📜 긴 스크롤 (페이지 연결)',
    scroll_snap: '📍 세로 페이지 스냅',
    slides: '🎴 좌우 슬라이드',
  };

  return (
    <div
      style={{
        flex: 1,
        overflow: 'auto',
        background: 'var(--dm-neutral-100)',
        padding: '24px 16px',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
      }}
      onClick={() => selectSection(null)}
    >
      {/* 상단 페이지 네비게이션 바 */}
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          marginBottom: 12,
          padding: '6px 10px',
          background: '#fff',
          border: '1px solid var(--dm-neutral-200)',
          borderRadius: 999,
          fontSize: 12,
          color: 'var(--dm-neutral-700)',
        }}
      >
        <button
          onClick={() => selectPage(currentPageIndex - 1)}
          disabled={currentPageIndex <= 0}
          style={navBtn(currentPageIndex <= 0)}
          title="이전 페이지"
        >
          ‹
        </button>
        <span style={{ fontWeight: 700, color: 'var(--dm-neutral-900)', minWidth: 60, textAlign: 'center' }}>
          {pageLabel}
        </span>
        <span style={{ fontSize: 11, color: 'var(--dm-neutral-500)' }}>
          {currentPageIndex + 1} / {totalPages}
        </span>
        <button
          onClick={() => selectPage(currentPageIndex + 1)}
          disabled={currentPageIndex >= totalPages - 1}
          style={navBtn(currentPageIndex >= totalPages - 1)}
          title="다음 페이지"
        >
          ›
        </button>
        <span
          style={{
            marginLeft: 6,
            fontSize: 10,
            padding: '2px 8px',
            background: 'var(--dm-primary-light)',
            color: 'var(--dm-primary)',
            borderRadius: 10,
            fontWeight: 700,
          }}
          title="발행되면 이 방식으로 페이지가 전환돼요"
        >
          {modeLabel[layoutMode] || layoutMode}
        </span>
      </div>

      <div className="dm-builder" style={brandKitStyle}>
        <MobileFrame>
          {sortedSections.length === 0 ? (
            <EmptyCanvas onPromptClick={handlePromptClick} pageLabel={pageLabel} />
          ) : (
            <div>
              {sortedSections.map((section) => (
                <SectionRenderer
                  key={section.id}
                  section={section}
                  storeName={storeName}
                  selected={selectedSectionId === section.id}
                  hovered={hoveredSectionId === section.id}
                  onSelect={selectSection}
                  onHover={hoverSection}
                  onEditSection={updateSectionProps}
                />
              ))}
            </div>
          )}
        </MobileFrame>
      </div>
    </div>
  );
}

function navBtn(disabled: boolean): React.CSSProperties {
  return {
    width: 26,
    height: 26,
    border: 'none',
    background: disabled ? 'var(--dm-neutral-100)' : 'var(--dm-neutral-50)',
    color: disabled ? 'var(--dm-neutral-300)' : 'var(--dm-neutral-700)',
    borderRadius: '50%',
    cursor: disabled ? 'not-allowed' : 'pointer',
    fontSize: 16,
    lineHeight: 1,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
  };
}

function EmptyCanvas({ onPromptClick, pageLabel }: { onPromptClick?: () => void; pageLabel: string }) {
  return (
    <div
      onClick={(e) => e.stopPropagation()}
      style={{
        padding: '80px 24px',
        textAlign: 'center',
        color: 'var(--dm-neutral-500)',
      }}
    >
      <div style={{ fontSize: 48, marginBottom: 16 }}>📱</div>
      <div style={{ fontSize: 17, fontWeight: 700, color: 'var(--dm-neutral-900)', marginBottom: 8 }}>
        "{pageLabel}"에 섹션이 없어요
      </div>
      <div style={{ fontSize: 13, lineHeight: 1.6, marginBottom: 24 }}>
        한 줄 프롬프트로 AI가 구조·카피까지 만들어줘요.<br />
        또는 좌측에서 섹션을 하나씩 추가해 보세요.
      </div>
      {onPromptClick && (
        <button
          onClick={onPromptClick}
          style={{
            height: 44,
            padding: '0 20px',
            background: 'var(--dm-primary)',
            color: '#fff',
            border: 'none',
            borderRadius: 12,
            fontSize: 14,
            fontWeight: 700,
            cursor: 'pointer',
          }}
        >
          ⚡ 한 줄 프롬프트로 시작하기
        </button>
      )}
    </div>
  );
}
