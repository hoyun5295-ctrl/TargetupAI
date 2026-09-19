/**
 * DmBlockBuilder — 블록 조립 화면 (★ 2026-09-16 Harold 승인 설계서 §6)
 *
 * 왼쪽 블록을 누르면 그 블록에 필요한 것만 묻는 창이 뜨고, 저장하면 가운데 DM 에 쌓인다.
 * 캔버스는 **편집기와 같은 DmCanvas**(스토어 구동)라 조립 화면에서 보는 모습이 곧 발행물이다.
 * 저장 축도 편집기와 같다 — 조립 결과는 지금의 sections·pages 그대로다(신규 저장 축 0).
 */
import { useMemo, useState } from 'react';
import { useDmBuilderStore } from '../../../stores/dmBuilderStore';
import { DM_BLOCKS, DM_BLOCK_GROUPS, DM_BLOCK_SETS, blockByKey, blockOfSection, isSectionReady } from '../../../utils/dm-blocks';
import DmCanvas from '../DmCanvas';
import BlockEditModal from './BlockEditModal';
import CatalogPageModal, { CATALOG_BLOCKS, type CatalogTemplateKey } from './CatalogPageModal';
import type { Section } from '../../../utils/dm-section-defaults';
import { useMediaQuery } from '../../../hooks/useMediaQuery';

const EFFECTS: Array<{ k: 'slide' | 'flip' | 'fade'; n: string; d: string }> = [
  { k: 'slide', n: '밀어내기', d: '손가락을 따라 밀림 (기본)' },
  { k: 'flip', n: '책장 넘김', d: '종이가 넘어가듯' },
  { k: 'fade', n: '페이드', d: '앞 장이 사라지며 다음 장' },
];

export default function DmBlockBuilder({ onDone, onBack, onBlankCanvas }: {
  onDone: () => void;
  onBack: () => void;
  /** 빈 캔버스에서 직접 섹션을 추가하고 싶을 때(옛 "직접 제작" 경로) — 편집기로 바로 간다 */
  onBlankCanvas?: () => void;
}) {
  const pages = useDmBuilderStore((s) => s.pages);
  const currentPageIndex = useDmBuilderStore((s) => s.currentPageIndex);
  const addSection = useDmBuilderStore((s) => s.addSection);
  const removeSection = useDmBuilderStore((s) => s.removeSection);
  const moveSection = useDmBuilderStore((s) => s.moveSection);
  const updateSectionProps = useDmBuilderStore((s) => s.updateSectionProps);
  const selectSection = useDmBuilderStore((s) => s.selectSection);
  const selectedSectionId = useDmBuilderStore((s) => s.selectedSectionId);
  const layoutMode = useDmBuilderStore((s) => s.layoutMode);
  const pageEffect = useDmBuilderStore((s) => s.pageEffect);
  const setPageEffect = useDmBuilderStore((s) => s.setPageEffect);
  const save = useDmBuilderStore((s) => s.save);
  const isSaving = useDmBuilderStore((s) => s.isSaving);

  const [editing, setEditing] = useState<string | null>(null);
  const [catalogAt, setCatalogAt] = useState<CatalogTemplateKey | null>(null);
  const addPage = useDmBuilderStore((s) => s.addPage);
  const setLayoutMode = useDmBuilderStore((s) => s.setLayoutMode);
  const setCatalogView = useDmBuilderStore((s) => s.setCatalogView);
  const brandKit = useDmBuilderStore((s) => s.brandKit);

  const sections: Section[] = useMemo(
    () => (pages[currentPageIndex]?.sections || []).slice().sort((a, b) => a.order - b.order),
    [pages, currentPageIndex],
  );
  const editingSection = sections.find((s) => s.id === editing) || null;
  const todo = sections.filter((s) => !isSectionReady(s)).length;
  // ★ 2026-09-19 (임은지 접수 cmu51q01u05tujnluc32zp8ej) 블록 창이 가운데 떠 미리보기를 가렸다.
  //   3단이 보이는 넓은 화면(lg = 1024px · 아래 grid 분기와 같은 기준)이면 창을 오른쪽 열에 붙인다 — 입력이 바로
  //   캔버스에 반영되는 것을 보면서 고친다. 좁은 화면은 열이 세로로 쌓여 창이 미리보기 아래로 가므로 종전 모달.
  const wide = useMediaQuery('(min-width: 1024px)');
  const dockedEditing = wide && !!editingSection;

  /** 블록 얹기 = 섹션 추가 + 블록 기본값 덮기 + 창 열기 (클릭 1회) */
  const addBlock = (key: string) => {
    const def = blockByKey(key);
    if (!def) return;
    addSection(def.section);
    const after = useDmBuilderStore.getState();
    const list = after.pages[after.currentPageIndex]?.sections || [];
    const created = list[list.length - 1];
    if (!created) return;
    if (def.defaults) updateSectionProps(created.id, def.defaults as any);
    selectSection(created.id);
    setEditing(created.id);
  };

  /** ★ 합성된 쪽 = 장 1개(갤러리 1장 · full_bleed). 카탈로그 책 자격(뷰어)이 요구하는 모양 그대로 */
  const addCatalogPage = (url: string, chips: Array<{ label: string; price?: string; url?: string }>) => {
    const st = useDmBuilderStore.getState();
    if (st.layoutMode !== 'slides') setLayoutMode('slides');
    setCatalogView(true);
    const cur = useDmBuilderStore.getState();
    const curSections = cur.pages[cur.currentPageIndex]?.sections || [];
    if (curSections.length > 0) addPage();
    addSection('gallery');
    const after = useDmBuilderStore.getState();
    const list = after.pages[after.currentPageIndex]?.sections || [];
    const created = list[list.length - 1];
    if (created) {
      updateSectionProps(created.id, {
        images: [{ url }], layout: 'list_1xN', full_bleed: true,
        // ★ 상품 정보는 이미지 밖 칩(가격은 이미지에 새기지 않는다 · 계약 = DM_GALLERY_CHIP_MARKER)
        ...(chips.length > 0 ? { chips } : {}),
      } as any);
      selectSection(created.id);
    }
  };

  const addSet = (blocks: string[]) => {
    blocks.forEach((k) => {
      const def = blockByKey(k);
      if (!def) return;
      addSection(def.section);
      const st = useDmBuilderStore.getState();
      const list = st.pages[st.currentPageIndex]?.sections || [];
      const created = list[list.length - 1];
      if (created && def.defaults) updateSectionProps(created.id, def.defaults as any);
    });
    const st = useDmBuilderStore.getState();
    const first = (st.pages[st.currentPageIndex]?.sections || [])[0];
    if (first) { selectSection(first.id); setEditing(first.id); }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 text-white">
      <header className="sticky top-0 z-30 flex items-center gap-3 px-6 py-3 bg-slate-950/85 backdrop-blur border-b border-white/10">
        <button onClick={onBack} className="w-9 h-9 rounded-lg border border-white/10 bg-white/5 hover:bg-white/10" aria-label="뒤로">←</button>
        <div className="min-w-0">
          <div className="text-[15px] font-extrabold">블록으로 만들기</div>
          <div className="text-[11px] text-white/45">블록을 누르면 필요한 것만 물어봐요. 저장하면 바로 쌓입니다</div>
        </div>
        <div className="ml-auto flex items-center gap-2">
          {onBlankCanvas && (
            <button
              onClick={onBlankCanvas}
              className="h-9 px-3 rounded-[10px] border border-white/12 bg-transparent text-[12.5px] font-bold text-white/60 hover:text-white hover:bg-white/10"
              title="블록 대신 빈 캔버스에서 섹션을 직접 추가해요"
            >
              빈 캔버스로
            </button>
          )}
          <button
            onClick={() => void save({ silent: false })}
            disabled={isSaving}
            className="h-9 px-3 rounded-[10px] border border-white/14 bg-white/5 text-[12.5px] font-bold hover:bg-white/10 disabled:opacity-40"
          >
            {isSaving ? '저장 중...' : '임시저장'}
          </button>
          <button
            onClick={onDone}
            disabled={sections.length === 0}
            className="h-9 px-4 rounded-[10px] bg-gradient-to-r from-violet-500 to-fuchsia-500 text-[13px] font-extrabold disabled:opacity-40"
          >
            완성하고 편집기로
          </button>
        </div>
      </header>

      <div className={`max-w-[1320px] mx-auto px-6 py-5 grid grid-cols-1 ${dockedEditing ? 'lg:grid-cols-[250px_minmax(0,1fr)_400px]' : 'lg:grid-cols-[250px_minmax(0,1fr)_300px]'} gap-4 items-start`}>
        {/* 왼쪽 — 블록 팔레트 */}
        <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-3">
          <div className="text-[12px] text-white/70 mb-2 font-bold">블록 고르기</div>
          {DM_BLOCK_GROUPS.map((g) => (
            <div key={g}>
              <div className="text-[10.5px] text-white/35 font-bold mt-3 mb-1.5">{g}</div>
              {DM_BLOCKS.filter((b) => b.group === g).map((b) => (
                <button
                  key={b.key}
                  onClick={() => addBlock(b.key)}
                  className="w-full flex items-center gap-2.5 px-2.5 py-2 mb-1.5 rounded-[10px] border border-white/[0.09] bg-white/[0.03] text-left hover:border-violet-400/60 hover:bg-violet-500/10 transition-colors"
                >
                  <span className="w-7 h-7 rounded-lg bg-violet-500/20 flex items-center justify-center text-[14px] shrink-0">{b.icon}</span>
                  <span className="min-w-0">
                    <span className="block text-[12.5px] font-bold">{b.label}</span>
                    <span className="block text-[10.5px] text-white/45">{b.desc}</span>
                  </span>
                </button>
              ))}
            </div>
          ))}
          <div className="text-[10.5px] text-white/35 font-bold mt-3 mb-1.5">카탈로그 쪽</div>
          {CATALOG_BLOCKS.map((b) => (
            <button
              key={b.key}
              onClick={() => setCatalogAt(b.key)}
              className="w-full flex items-center gap-2.5 px-2.5 py-2 mb-1.5 rounded-[10px] border border-white/[0.09] bg-white/[0.03] text-left hover:border-violet-400/60 hover:bg-violet-500/10 transition-colors"
            >
              <span className="w-7 h-7 rounded-lg bg-fuchsia-500/20 flex items-center justify-center text-[14px] shrink-0">{b.icon}</span>
              <span className="min-w-0">
                <span className="block text-[12.5px] font-bold">{b.label}</span>
                <span className="block text-[10.5px] text-white/45">{b.desc}</span>
              </span>
            </button>
          ))}
        </div>

        {/* 가운데 — 편집기와 같은 캔버스 */}
        <div className="min-w-0">
          {sections.length === 0 && (
            <div className="mb-3 flex flex-wrap gap-2">
              {DM_BLOCK_SETS.map((s) => (
                <button
                  key={s.key}
                  onClick={() => addSet(s.blocks)}
                  className="h-10 px-3.5 rounded-[11px] border border-violet-400/35 bg-violet-500/12 text-[12.5px] font-bold hover:bg-violet-500/20"
                >
                  ⚡ {s.label} <span className="text-[10.5px] font-medium text-white/50 ml-1">{s.desc}</span>
                </button>
              ))}
            </div>
          )}
          <DmCanvas />
        </div>

        {/* 오른쪽 — 편집 중(넓은 화면) = 붙은 블록 창 · 아니면 쌓인 블록 · 상태 · 넘김 효과 */}
        {dockedEditing ? (
          <BlockEditModal
            docked
            section={editingSection}
            open
            onClose={() => setEditing(null)}
            onUpdate={(patch) => { if (editingSection) updateSectionProps(editingSection.id, patch as any); }}
          />
        ) : (
        <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-3">
          <div className="text-[12px] text-white/70 mb-2 font-bold">쌓인 블록 {sections.length}개</div>
          {sections.length === 0 ? (
            <div className="text-[11.5px] text-white/40 leading-relaxed py-3">
              왼쪽에서 블록을 눌러 쌓아보세요. 위의 시작 세트를 누르면 서너 개가 한 번에 올라갑니다.
            </div>
          ) : (
            <div className="flex flex-col gap-1.5 mb-3">
              {sections.map((s, i) => {
                const def = blockOfSection(s);
                const ready = isSectionReady(s);
                return (
                  <div
                    key={s.id}
                    onClick={() => selectSection(s.id)}
                    className={`flex items-center gap-2 px-2.5 py-2 rounded-[10px] border text-[12px] cursor-pointer ${selectedSectionId === s.id ? 'border-violet-400/70 bg-violet-500/12' : 'border-white/[0.09] bg-white/[0.03]'}`}
                  >
                    <span className="text-[13px]">{def?.icon || '🧩'}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block font-bold truncate">{def?.label || s.type}</span>
                      {!ready && <span className="block text-[10.5px] text-amber-200/90">{def?.need} 필요</span>}
                    </span>
                    <button onClick={(e) => { e.stopPropagation(); moveSection(s.id, 'up'); }} disabled={i === 0} className="w-6 h-6 rounded border border-white/12 bg-white/5 disabled:opacity-30" aria-label="위로">↑</button>
                    <button onClick={(e) => { e.stopPropagation(); moveSection(s.id, 'down'); }} disabled={i === sections.length - 1} className="w-6 h-6 rounded border border-white/12 bg-white/5 disabled:opacity-30" aria-label="아래로">↓</button>
                    <button onClick={(e) => { e.stopPropagation(); setEditing(s.id); }} className="w-6 h-6 rounded border border-white/12 bg-white/5" aria-label="수정">✎</button>
                    <button onClick={(e) => { e.stopPropagation(); removeSection(s.id); }} className="w-6 h-6 rounded border border-rose-400/30 bg-rose-500/10 text-rose-200" aria-label="삭제">✕</button>
                  </div>
                );
              })}
            </div>
          )}

          <div className="flex items-center gap-2 px-2.5 py-2 rounded-[10px] border border-white/[0.09] bg-white/[0.03] text-[12px] mb-3">
            내용 채울 블록
            <span className={`ml-auto font-bold ${todo ? 'text-amber-200' : 'text-emerald-300'}`}>{todo ? `${todo}개` : '없음'}</span>
          </div>

          {layoutMode === 'slides' && (
            <>
              <div className="text-[12px] text-white/70 mb-2 font-bold">넘김 효과</div>
              <div className="flex flex-col gap-1.5">
                {EFFECTS.map((e) => (
                  <button
                    key={e.k}
                    onClick={() => setPageEffect(e.k)}
                    className={`px-2.5 py-2 rounded-[10px] border text-left text-[12px] font-bold ${pageEffect === e.k ? 'border-violet-400/70 bg-violet-500/15' : 'border-white/[0.09] bg-white/[0.03]'}`}
                  >
                    {e.n}
                    <span className="block text-[10.5px] font-medium text-white/45 mt-0.5">{e.d}</span>
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
        )}
      </div>

      <CatalogPageModal
        templateKey={catalogAt}
        open={!!catalogAt}
        onClose={() => setCatalogAt(null)}
        brandColor={brandKit?.primary_color || null}
        onMade={(url, chips) => { addCatalogPage(url, chips); setCatalogAt(null); }}
      />

      {/* 좁은 화면 전용 — 넓은 화면은 위 오른쪽 열에 붙는다(두 형태가 동시에 뜨지 않는다) */}
      <BlockEditModal
        section={editingSection}
        open={!!editingSection && !wide}
        onClose={() => setEditing(null)}
        onUpdate={(patch) => { if (editingSection) updateSectionProps(editingSection.id, patch as any); }}
      />
    </div>
  );
}
