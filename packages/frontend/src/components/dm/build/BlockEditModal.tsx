/**
 * BlockEditModal — 블록 창 (★ 2026-09-16 Harold 승인 설계서 §2·§4)
 *
 * 블록을 누르면 "그 블록에 필요한 것만" 묻는다. 입력 폼은 **기존 섹션 편집기**(SectionPropsEditor)를 그대로 쓴다.
 * 여기서 폼을 다시 만들지 않는다 — 만들면 편집기와 두 벌이 되어 한쪽만 고쳐진다.
 *
 * 사진 자리가 있는 블록(헤드라인·설명)은 위에 **이미지 스튜디오에서 제작 후 삽입** 줄이 붙는다.
 */
import { useState } from 'react';
import ModalBase, { ModalButton } from '../modals/ModalBase';
import SectionPropsEditor from '../panels/SectionPropsEditor';
import StudioInsertModal from './StudioInsertModal';
import type { Section } from '../../../utils/dm-section-defaults';
import { blockOfSection } from '../../../utils/dm-blocks';

export default function BlockEditModal({
  section, open, onClose, onUpdate,
}: {
  section: Section | null;
  open: boolean;
  onClose: () => void;
  onUpdate: (patch: Record<string, any>) => void;
}) {
  const [studioOpen, setStudioOpen] = useState(false);
  if (!section) return null;
  const def = blockOfSection(section);
  const ready = def ? def.ready(section.props) : true;

  return (
    <>
      <ModalBase
        open={open}
        onClose={onClose}
        title={`${def?.icon || '🧩'} ${def?.label || '블록'}`}
        subtitle={def?.desc}
        size="md"
        badge={ready
          ? <span className="text-[11px] font-bold px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-200 border border-emerald-400/30">내용 채움</span>
          : <span className="text-[11px] font-bold px-2 py-0.5 rounded bg-amber-500/20 text-amber-200 border border-amber-400/30">{def?.need} 필요</span>}
        footer={<ModalButton variant="primary" onClick={onClose}>저장하고 닫기</ModalButton>}
      >
        {def?.photo && (
          <div className="mb-3 rounded-xl border border-violet-400/35 bg-violet-500/10 p-3">
            <div className="text-[11px] text-white/55 mb-2">사진이 없으면 여기서 바로 만들 수 있어요</div>
            <button
              type="button"
              onClick={() => setStudioOpen(true)}
              className="w-full h-10 rounded-[10px] border border-violet-400/45 bg-gradient-to-r from-violet-500/25 to-fuchsia-500/15 text-[12.5px] font-bold hover:from-violet-500/35 transition-colors"
            >
              ✨ 이미지 스튜디오에서 제작 후 삽입
            </button>
          </div>
        )}
        <SectionPropsEditor section={section} onUpdate={onUpdate} />
      </ModalBase>

      {/* 스튜디오는 블록 창 위에 겹쳐 뜬다 — 만든 그림이 이 블록의 사진 자리에 바로 들어간다 */}
      <StudioInsertModal
        open={studioOpen}
        onClose={() => setStudioOpen(false)}
        defaultTitle={(section.props as any)?.headline || ''}
        defaultSubtitle={(section.props as any)?.sub_copy || ''}
        onInserted={(url) => { onUpdate({ image_url: url }); setStudioOpen(false); }}
      />
    </>
  );
}
