/**
 * BlockEditModal — 블록 창 (★ 2026-09-16 Harold 승인 설계서 §2·§4)
 *
 * 블록을 누르면 "그 블록에 필요한 것만" 묻는다. 입력 폼은 **기존 섹션 편집기**(SectionPropsEditor)를 그대로 쓴다.
 * 여기서 폼을 다시 만들지 않는다 — 만들면 편집기와 두 벌이 되어 한쪽만 고쳐진다.
 *
 * ★ 2026-09-19 (임은지 접수 cmu51q01u05tujnluc32zp8ej) 창이 가운데 떠 미리보기를 가렸다. 입력은 원래 섹션에 바로
 *   반영돼 캔버스가 실시간으로 바뀌고 있었는데 모달과 배경막이 그걸 덮었다. 그래서 `docked`(넓은 화면)면
 *   조립 화면 오른쪽 열에 **배경막 없이** 붙는다. 좁은 화면은 열이 세로로 쌓이므로 종전 모달 그대로다.
 *   ⛔ 공용 ModalBase 는 건드리지 않는다(이 창 하나 때문에 공용 컴포넌트를 바꾸지 않는다).
 *
 * ⚠ 색: 두 형태 모두 **흰 표면(#fff)**이다. 다크 전제 색(text-white/·bg-white/[…]·slate-950)을 쓰면 글씨가 묻힌다.
 *    이 규약은 `dm-build-light-surface.test.ts` 가 기계로 지킨다.
 */
import { useEffect, useState } from 'react';
import ModalBase, { ModalButton } from '../modals/ModalBase';
import SectionPropsEditor from '../panels/SectionPropsEditor';
import StudioInsertModal from './StudioInsertModal';
import type { Section } from '../../../utils/dm-section-defaults';
import { blockOfSection } from '../../../utils/dm-blocks';

export default function BlockEditModal({
  section, open, onClose, onUpdate, docked,
}: {
  section: Section | null;
  open: boolean;
  onClose: () => void;
  onUpdate: (patch: Record<string, any>) => void;
  /** 넓은 화면 = 조립 화면 오른쪽 열에 붙는다(배경막 없음 · 미리보기를 가리지 않는다) */
  docked?: boolean;
}) {
  const [studioOpen, setStudioOpen] = useState(false);

  // 붙은 창도 모달처럼 Esc 로 닫는다(스튜디오 창이 떠 있으면 그 창이 먼저 닫힌다)
  useEffect(() => {
    if (!docked || !open || studioOpen) return;
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [docked, open, studioOpen, onClose]);

  if (!section) return null;
  const def = blockOfSection(section);
  const ready = def ? def.ready(section.props) : true;
  const title = `${def?.icon || '🧩'} ${def?.label || '블록'}`;
  const badge = ready
    ? <span className="text-[11px] font-bold px-2 py-0.5 rounded border border-emerald-200 bg-emerald-50 text-emerald-700">내용 채움</span>
    : <span className="text-[11px] font-bold px-2 py-0.5 rounded border border-amber-200 bg-amber-50 text-amber-700">{def?.need} 필요</span>;
  const footer = <ModalButton variant="primary" onClick={onClose}>저장하고 닫기</ModalButton>;

  const body = (
    <>
      {def?.photo && (
        <div className="mb-3 rounded-xl border border-violet-200 bg-violet-50 p-3">
          <div className="text-[11.5px] text-slate-600 mb-2">사진이 없으면 여기서 바로 만들 수 있어요</div>
          <button
            type="button"
            onClick={() => setStudioOpen(true)}
            className="w-full h-10 rounded-[10px] border border-violet-300 bg-violet-100 text-violet-700 text-[12.5px] font-bold hover:bg-violet-200 transition-colors"
          >
            ✨ 이미지 스튜디오에서 제작 후 삽입
          </button>
        </div>
      )}
      <SectionPropsEditor section={section} onUpdate={onUpdate} />
    </>
  );

  return (
    <>
      {docked ? (
        open && (
          <aside
            aria-label={`${def?.label || '블록'} 편집`}
            // 글자색은 지정하지 않는다 — 본문(SectionPropsEditor)이 모달 형태와 똑같이 그려지게(같은 상속)
            className="lg:sticky lg:top-[72px] flex flex-col max-h-[calc(100vh-88px)] rounded-2xl bg-white border border-slate-200 shadow-2xl overflow-hidden"
          >
            <header className="flex items-start gap-3 px-5 pt-4 pb-3 border-b border-slate-200">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <h2 className="m-0 text-[16px] font-bold text-slate-900">{title}</h2>
                  {badge}
                </div>
                {def?.desc && <p className="mt-1 mb-0 text-[12.5px] leading-relaxed text-slate-500">{def.desc}</p>}
              </div>
              <button
                type="button"
                onClick={onClose}
                aria-label="닫기"
                className="shrink-0 w-8 h-8 rounded-lg text-[18px] text-slate-500 hover:bg-slate-100 flex items-center justify-center"
              >
                ✕
              </button>
            </header>
            <div className="flex-1 overflow-y-auto p-5">{body}</div>
            <footer className="flex justify-end gap-2 px-5 py-3 border-t border-slate-200 bg-slate-50">{footer}</footer>
          </aside>
        )
      ) : (
        <ModalBase
          open={open}
          onClose={onClose}
          title={title}
          subtitle={def?.desc}
          size="md"
          badge={badge}
          footer={footer}
        >
          {body}
        </ModalBase>
      )}

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
