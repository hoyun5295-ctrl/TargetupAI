/**
 * DmCanvas — 중앙 캔버스 영역 (모바일 프레임 + 섹션 나열)
 * 빈 상태일 때는 CTA 안내.
 */
import { useDmBuilderStore } from '../../stores/dmBuilderStore';
import MobileFrame from './MobileFrame';
import { SectionRenderer } from './canvas';

export type DmCanvasProps = {
  onPromptClick?: () => void;
};

export default function DmCanvas({ onPromptClick }: DmCanvasProps) {
  const sections = useDmBuilderStore((s) => s.sections);
  const storeName = useDmBuilderStore((s) => s.storeName);
  const selectedSectionId = useDmBuilderStore((s) => s.selectedSectionId);
  const hoveredSectionId = useDmBuilderStore((s) => s.hoveredSectionId);
  const selectSection = useDmBuilderStore((s) => s.selectSection);
  const hoverSection = useDmBuilderStore((s) => s.hoverSection);
  const brandKit = useDmBuilderStore((s) => s.brandKit);

  const brandKitStyle: React.CSSProperties = {
    ...(brandKit.primary_color ? { ['--dm-primary' as any]: brandKit.primary_color } : {}),
    ...(brandKit.secondary_color ? { ['--dm-secondary' as any]: brandKit.secondary_color } : {}),
    ...(brandKit.accent_color ? { ['--dm-accent' as any]: brandKit.accent_color } : {}),
    ...(brandKit.background_color ? { ['--dm-bg' as any]: brandKit.background_color } : {}),
  };

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
          {sections.length === 0 ? (
            <EmptyCanvas onPromptClick={onPromptClick} />
          ) : (
            <div>
              {sections
                .slice()
                .sort((a, b) => a.order - b.order)
                .map((section) => (
                  <SectionRenderer
                    key={section.id}
                    section={section}
                    storeName={storeName}
                    selected={selectedSectionId === section.id}
                    hovered={hoveredSectionId === section.id}
                    onSelect={selectSection}
                    onHover={hoverSection}
                  />
                ))}
            </div>
          )}
        </MobileFrame>
      </div>
    </div>
  );
}

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
