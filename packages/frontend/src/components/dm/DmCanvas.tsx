/**
 * DmCanvas — 중앙 캔버스 영역 (모바일 프레임 + 섹션 나열)
 *
 * D127 V3: 3모드 렌더링
 *  - scroll      : 전체 길이 세로 나열 (기존)
 *  - scroll_snap : 프레임 높이 고정 + 세로 CSS scroll-snap (1섹션=1페이지)
 *  - slides      : 프레임 높이 고정 + 가로 CSS scroll-snap (좌우 스와이프)
 */
import { useDmBuilderStore, type LayoutMode } from '../../stores/dmBuilderStore';
import MobileFrame from './MobileFrame';
import { SectionRenderer } from './canvas';

export type DmCanvasProps = {
  onPromptClick?: () => void;
};

const FRAME_HEIGHT = 680;

export default function DmCanvas({ onPromptClick }: DmCanvasProps) {
  const sections = useDmBuilderStore((s) => s.sections);
  const storeName = useDmBuilderStore((s) => s.storeName);
  const selectedSectionId = useDmBuilderStore((s) => s.selectedSectionId);
  const hoveredSectionId = useDmBuilderStore((s) => s.hoveredSectionId);
  const selectSection = useDmBuilderStore((s) => s.selectSection);
  const hoverSection = useDmBuilderStore((s) => s.hoverSection);
  const brandKit = useDmBuilderStore((s) => s.brandKit);
  const updateSectionProps = useDmBuilderStore((s) => s.updateSectionProps);
  const layoutMode = useDmBuilderStore((s) => s.layoutMode);
  const setOpenModal = useDmBuilderStore((s) => s.setOpenModal);
  const handlePromptClick = onPromptClick || (() => setOpenModal('ai-prompt'));

  const brandKitStyle: React.CSSProperties = {
    ...(brandKit.primary_color ? { ['--dm-primary' as any]: brandKit.primary_color } : {}),
    ...(brandKit.secondary_color ? { ['--dm-secondary' as any]: brandKit.secondary_color } : {}),
    ...(brandKit.accent_color ? { ['--dm-accent' as any]: brandKit.accent_color } : {}),
    ...(brandKit.background_color ? { ['--dm-bg' as any]: brandKit.background_color } : {}),
  };

  const sortedSections = sections.slice().sort((a, b) => a.order - b.order);

  return (
    <div
      style={{
        flex: 1,
        overflow: 'auto',
        background: 'var(--dm-neutral-100)',
        padding: '32px 16px',
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'flex-start',
      }}
      onClick={() => selectSection(null)}
    >
      <div className="dm-builder" style={brandKitStyle}>
        <MobileFrame>
          {sortedSections.length === 0 ? (
            <EmptyCanvas onPromptClick={handlePromptClick} />
          ) : (
            <SectionsStage mode={layoutMode}>
              {sortedSections.map((section) => (
                <SectionStageItem key={section.id} mode={layoutMode}>
                  <SectionRenderer
                    section={section}
                    storeName={storeName}
                    selected={selectedSectionId === section.id}
                    hovered={hoveredSectionId === section.id}
                    onSelect={selectSection}
                    onHover={hoverSection}
                    onEditSection={updateSectionProps}
                  />
                </SectionStageItem>
              ))}
              {layoutMode !== 'scroll' && (
                <ModeBadge mode={layoutMode} total={sortedSections.length} />
              )}
            </SectionsStage>
          )}
        </MobileFrame>
      </div>
    </div>
  );
}

// ────────────── Stage (3모드 컨테이너) ──────────────

function SectionsStage({ mode, children }: { mode: LayoutMode; children: React.ReactNode }) {
  if (mode === 'scroll_snap') {
    return (
      <div
        style={{
          height: FRAME_HEIGHT,
          overflowY: 'auto',
          overflowX: 'hidden',
          scrollSnapType: 'y mandatory',
          position: 'relative',
        }}
      >
        {children}
      </div>
    );
  }
  if (mode === 'slides') {
    return (
      <div
        style={{
          height: FRAME_HEIGHT,
          overflowX: 'auto',
          overflowY: 'hidden',
          scrollSnapType: 'x mandatory',
          display: 'flex',
          flexDirection: 'row',
          position: 'relative',
        }}
      >
        {children}
      </div>
    );
  }
  // scroll (기본)
  return <div>{children}</div>;
}

function SectionStageItem({ mode, children }: { mode: LayoutMode; children: React.ReactNode }) {
  if (mode === 'scroll_snap') {
    return (
      <div
        style={{
          minHeight: FRAME_HEIGHT,
          scrollSnapAlign: 'start',
          scrollSnapStop: 'always',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
        }}
      >
        {children}
      </div>
    );
  }
  if (mode === 'slides') {
    return (
      <div
        style={{
          flex: '0 0 100%',
          width: '100%',
          height: FRAME_HEIGHT,
          overflowY: 'auto',
          scrollSnapAlign: 'start',
          scrollSnapStop: 'always',
        }}
      >
        {children}
      </div>
    );
  }
  return <>{children}</>;
}

function ModeBadge({ mode, total }: { mode: LayoutMode; total: number }) {
  const label =
    mode === 'scroll_snap' ? `세로 스냅 · ${total}페이지`
    : mode === 'slides' ? `좌우 슬라이드 · ${total}페이지`
    : '';
  if (!label) return null;
  return (
    <div
      style={{
        position: 'sticky',
        bottom: 8,
        left: 0,
        right: 0,
        textAlign: 'center',
        pointerEvents: 'none',
        zIndex: 20,
      }}
    >
      <span
        style={{
          display: 'inline-block',
          padding: '4px 10px',
          fontSize: 10,
          fontWeight: 700,
          color: '#fff',
          background: 'rgba(17,24,39,0.7)',
          borderRadius: 999,
          backdropFilter: 'blur(4px)',
        }}
      >
        {label}
      </span>
    </div>
  );
}

// ────────────── Empty ──────────────

function EmptyCanvas({ onPromptClick }: { onPromptClick?: () => void }) {
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
        빈 캔버스예요
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
