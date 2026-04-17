/**
 * DmRightPanel — 우측 패널 (320px)
 * 선택된 섹션의 공통 속성 + 타입별 필드 에디터 (8단계 SectionPropsEditor 연결).
 */
import { useMemo } from 'react';
import { useDmBuilderStore } from '../../stores/dmBuilderStore';
import { SECTION_META } from '../../utils/dm-section-defaults';
import SectionPropsEditor from './panels/SectionPropsEditor';

export default function DmRightPanel() {
  const sections = useDmBuilderStore((s) => s.sections);
  const selectedSectionId = useDmBuilderStore((s) => s.selectedSectionId);
  const updateSectionProps = useDmBuilderStore((s) => s.updateSectionProps);
  const setSectionVariant = useDmBuilderStore((s) => s.setSectionVariant);
  const setSectionVisible = useDmBuilderStore((s) => s.setSectionVisible);
  const toggleSectionLock = useDmBuilderStore((s) => s.toggleSectionLock);

  const selected = useMemo(
    () => sections.find((s) => s.id === selectedSectionId) || null,
    [sections, selectedSectionId]
  );

  return (
    <div
      style={{
        width: 320,
        flexShrink: 0,
        borderLeft: '1px solid var(--dm-neutral-200)',
        background: 'var(--dm-bg)',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}
    >
      {!selected ? (
        <div style={{ padding: '40px 20px', textAlign: 'center', color: 'var(--dm-neutral-500)', fontSize: 13, lineHeight: 1.6 }}>
          <div style={{ fontSize: 36, marginBottom: 12 }}>👈</div>
          <div>좌측 섹션 또는 캔버스에서<br />편집할 섹션을 선택하세요.</div>
        </div>
      ) : (() => {
        const meta = SECTION_META[selected.type];
        return (
          <>
            <div style={{ padding: '12px 14px', borderBottom: '1px solid var(--dm-neutral-200)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                <span style={{ fontSize: 18 }}>{meta.icon}</span>
                <span style={{ fontSize: 13, fontWeight: 700 }}>{meta.label}</span>
              </div>
              <div style={{ fontSize: 11, color: 'var(--dm-neutral-500)' }}>{meta.description}</div>
            </div>

            <div style={{ flex: 1, overflow: 'auto', padding: '14px' }}>
              {/* 공통 속성 */}
              <section style={{ marginBottom: 16 }}>
                <SectionTitle>공통 속성</SectionTitle>
                <LabelRow label="표시">
                  <ToggleButton
                    active={selected.visible}
                    onClick={() => setSectionVisible(selected.id, !selected.visible)}
                    labelOn="표시"
                    labelOff="숨김"
                  />
                </LabelRow>
                <LabelRow label="AI 재생성 제외">
                  <ToggleButton
                    active={!!selected.ai_locked}
                    onClick={() => toggleSectionLock(selected.id)}
                    labelOn="잠금"
                    labelOff="허용"
                  />
                </LabelRow>
                <LabelRow label="스타일 변형">
                  <select
                    value={selected.style_variant || 'default'}
                    onChange={(e) => setSectionVariant(selected.id, e.target.value)}
                    style={selectStyle}
                  >
                    {meta.supportsStyleVariants.map((v) => (
                      <option key={v} value={v}>{v}</option>
                    ))}
                  </select>
                </LabelRow>
              </section>

              {/* 타입별 필드 에디터 */}
              <section>
                <SectionTitle>{meta.label} 속성</SectionTitle>
                <SectionPropsEditor
                  key={selected.id}
                  section={selected}
                  onUpdate={(patch) => updateSectionProps(selected.id, patch)}
                />
              </section>
            </div>
          </>
        );
      })()}
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--dm-neutral-500)', letterSpacing: 0.5, textTransform: 'uppercase', marginBottom: 10 }}>
      {children}
    </div>
  );
}

function LabelRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
      <div style={{ fontSize: 12, color: 'var(--dm-neutral-700)' }}>{label}</div>
      <div>{children}</div>
    </div>
  );
}

function ToggleButton({ active, onClick, labelOn, labelOff }: { active: boolean; onClick: () => void; labelOn: string; labelOff: string }) {
  return (
    <button
      onClick={onClick}
      style={{
        height: 24,
        padding: '0 10px',
        borderRadius: 12,
        border: 'none',
        background: active ? 'var(--dm-primary)' : 'var(--dm-neutral-200)',
        color: active ? '#fff' : 'var(--dm-neutral-700)',
        fontSize: 11,
        fontWeight: 600,
        cursor: 'pointer',
      }}
    >
      {active ? labelOn : labelOff}
    </button>
  );
}

const selectStyle: React.CSSProperties = {
  height: 28,
  padding: '0 8px',
  border: '1px solid var(--dm-neutral-200)',
  borderRadius: 6,
  background: 'var(--dm-bg)',
  fontSize: 12,
  color: 'var(--dm-neutral-900)',
  outline: 'none',
  cursor: 'pointer',
};
