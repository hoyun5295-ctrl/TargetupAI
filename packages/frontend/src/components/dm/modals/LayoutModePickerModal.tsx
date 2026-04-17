/**
 * LayoutModePickerModal — 신규 DM 생성 시 레이아웃 모드 3종 선택 (D127 V3)
 *
 * 3모드:
 *  - scroll      (긴 세로 스크롤, 기본)
 *  - scroll_snap (세로 스와이프, 1섹션=1페이지)
 *  - slides      (좌우 스와이프, 1섹션=1페이지)
 *
 * 사용:
 *   <LayoutModePickerModal
 *     open={open}
 *     onClose={() => ...}
 *     onSelect={(mode) => createNew({ layoutMode: mode })}
 *   />
 */
import { useState } from 'react';
import type { LayoutMode } from '../../../stores/dmBuilderStore';
import ModalBase, { ModalButton } from './ModalBase';

type Option = {
  mode: LayoutMode;
  icon: string;
  title: string;
  subtitle: string;
  description: string;
  preview: 'vertical-long' | 'vertical-pages' | 'horizontal-pages';
};

const OPTIONS: Option[] = [
  {
    mode: 'scroll',
    icon: '📜',
    title: '긴 세로 스크롤',
    subtitle: '전통적인 웹페이지 방식',
    description: '섹션을 위에서 아래로 자연스럽게 스크롤. 정보가 많고 한눈에 훑고 싶을 때 적합해요.',
    preview: 'vertical-long',
  },
  {
    mode: 'scroll_snap',
    icon: '📍',
    title: '세로 페이지 스냅',
    subtitle: '위/아래 스와이프, 1섹션=1페이지',
    description: '섹션마다 화면 가득 차고 스와이프로 넘어가요. 몰입도 높은 스토리텔링에 어울려요.',
    preview: 'vertical-pages',
  },
  {
    mode: 'slides',
    icon: '🎴',
    title: '좌우 슬라이드',
    subtitle: '인스타 스토리 방식',
    description: '섹션을 좌우로 넘기며 읽어요. 가장 집중도가 높고 페이지별 이탈 지점 측정에 유리해요.',
    preview: 'horizontal-pages',
  },
];

export default function LayoutModePickerModal({
  open,
  onClose,
  onSelect,
}: {
  open: boolean;
  onClose: () => void;
  onSelect: (mode: LayoutMode) => void;
}) {
  const [selected, setSelected] = useState<LayoutMode>('scroll');

  const handleConfirm = () => {
    onSelect(selected);
    onClose();
  };

  const footer = (
    <>
      <ModalButton variant="ghost" onClick={onClose}>취소</ModalButton>
      <ModalButton variant="primary" onClick={handleConfirm}>
        이 방식으로 시작
      </ModalButton>
    </>
  );

  return (
    <ModalBase
      open={open}
      onClose={onClose}
      size="lg"
      title="어떤 방식으로 보여줄까요?"
      subtitle="편집 중에도 언제든 다른 방식으로 바꿀 수 있어요."
      footer={footer}
    >
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
        {OPTIONS.map((opt) => (
          <button
            key={opt.mode}
            onClick={() => setSelected(opt.mode)}
            type="button"
            style={{
              textAlign: 'left',
              padding: 16,
              border: selected === opt.mode ? '2px solid #4f46e5' : '1px solid #e5e7eb',
              background: selected === opt.mode ? '#eef2ff' : '#fff',
              borderRadius: 12,
              cursor: 'pointer',
              transition: 'all 120ms',
              display: 'flex',
              flexDirection: 'column',
              gap: 10,
              minHeight: 260,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 22 }}>{opt.icon}</span>
              {selected === opt.mode && (
                <span style={{ marginLeft: 'auto', fontSize: 10, padding: '2px 8px', background: '#4f46e5', color: '#fff', borderRadius: 10, fontWeight: 700 }}>
                  선택됨
                </span>
              )}
            </div>

            <PreviewIllustration kind={opt.preview} active={selected === opt.mode} />

            <div>
              <div style={{ fontSize: 14, fontWeight: 700, color: '#111827', marginBottom: 2 }}>
                {opt.title}
              </div>
              <div style={{ fontSize: 11, color: '#6b7280', fontWeight: 500, marginBottom: 6 }}>
                {opt.subtitle}
              </div>
              <div style={{ fontSize: 12, color: '#4b5563', lineHeight: 1.5 }}>
                {opt.description}
              </div>
            </div>
          </button>
        ))}
      </div>
    </ModalBase>
  );
}

function PreviewIllustration({ kind, active }: { kind: Option['preview']; active: boolean }) {
  const bar = active ? '#4f46e5' : '#cbd5e1';
  const bg = active ? '#e0e7ff' : '#f3f4f6';

  if (kind === 'vertical-long') {
    return (
      <div
        style={{
          height: 120,
          width: '100%',
          background: bg,
          borderRadius: 8,
          padding: 10,
          display: 'flex',
          flexDirection: 'column',
          gap: 6,
          overflow: 'hidden',
        }}
      >
        {[0.7, 1, 0.5, 0.9, 0.4, 0.8, 0.6].map((w, i) => (
          <div
            key={i}
            style={{ height: 8, background: bar, borderRadius: 3, width: `${w * 100}%`, opacity: active ? 1 : 0.4 }}
          />
        ))}
      </div>
    );
  }

  if (kind === 'vertical-pages') {
    return (
      <div style={{ position: 'relative', height: 120, width: '100%' }}>
        <div
          style={{
            position: 'absolute',
            inset: 0,
            background: bg,
            borderRadius: 8,
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'center',
            alignItems: 'center',
            gap: 14,
            padding: 10,
          }}
        >
          <div style={{ width: 60, height: 30, background: bar, borderRadius: 4, opacity: active ? 1 : 0.5 }} />
          <div style={{ fontSize: 14, color: bar, opacity: active ? 1 : 0.5 }}>▼</div>
        </div>
      </div>
    );
  }

  // horizontal-pages
  return (
    <div
      style={{
        height: 120,
        width: '100%',
        background: bg,
        borderRadius: 8,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
        padding: 10,
      }}
    >
      <div style={{ fontSize: 14, color: bar, opacity: active ? 1 : 0.5 }}>◀</div>
      <div style={{ flex: 1, maxWidth: 60, height: 80, background: bar, borderRadius: 6, opacity: active ? 1 : 0.5 }} />
      <div style={{ fontSize: 14, color: bar, opacity: active ? 1 : 0.5 }}>▶</div>
    </div>
  );
}
