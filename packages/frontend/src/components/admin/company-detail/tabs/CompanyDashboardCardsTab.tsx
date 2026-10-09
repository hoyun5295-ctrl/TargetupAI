/**
 * CompanyDashboardCardsTab — 슈퍼관리자 CompanyDetailModal 에서 옮긴 화면(★ 2026-10-09 파일 분리 E · 설계서 docs/2026-10-03-admin-dashboard-split-design.md §5)
 * 옮긴 방법 = 스크립트(원문 그대로 · 글자 대조). 상태(use*)는 본체에 남고 props 로 받는다 — 탭을 옮겨 다녀도 값이 그대로다(동작 변경 0).
 */
import type { Dispatch, SetStateAction } from 'react';

export interface CompanyDashboardCardsTabProps {
  dashboardCardIds: string[];
  dashboardCardPool: { cardId: string; label: string; emoji: string; description: string; }[];
  draggedCardIdx: number | null;
  setDashboardCardIds: Dispatch<SetStateAction<string[]>>;
  setDraggedCardIdx: Dispatch<SetStateAction<number | null>>;
}

export default function CompanyDashboardCardsTab(props: CompanyDashboardCardsTabProps) {
  const { dashboardCardIds, dashboardCardPool, draggedCardIdx, setDashboardCardIds, setDraggedCardIdx } = props;

  return (
    <>
    {(() => {
                const selectedCards = dashboardCardIds
                  .map(id => dashboardCardPool.find(c => c.cardId === id))
                  .filter((c): c is { cardId: string; label: string; emoji: string; description: string } => !!c);
                const unselectedCards = dashboardCardPool.filter(c => !dashboardCardIds.includes(c.cardId));

                const moveUp = (idx: number) => {
                  if (idx === 0) return;
                  const newIds = [...dashboardCardIds];
                  [newIds[idx - 1], newIds[idx]] = [newIds[idx], newIds[idx - 1]];
                  setDashboardCardIds(newIds);
                };
                const moveDown = (idx: number) => {
                  if (idx >= dashboardCardIds.length - 1) return;
                  const newIds = [...dashboardCardIds];
                  [newIds[idx + 1], newIds[idx]] = [newIds[idx], newIds[idx + 1]];
                  setDashboardCardIds(newIds);
                };
                const removeCard = (cardId: string) => {
                  setDashboardCardIds(dashboardCardIds.filter(id => id !== cardId));
                };
                const addCard = (cardId: string) => {
                  if (dashboardCardIds.includes(cardId)) return;
                  setDashboardCardIds([...dashboardCardIds, cardId]);
                };
                const handleDrop = (targetIdx: number) => {
                  if (draggedCardIdx === null || draggedCardIdx === targetIdx) {
                    setDraggedCardIdx(null);
                    return;
                  }
                  const newIds = [...dashboardCardIds];
                  const [moved] = newIds.splice(draggedCardIdx, 1);
                  newIds.splice(targetIdx, 0, moved);
                  setDashboardCardIds(newIds);
                  setDraggedCardIdx(null);
                };

                return (
                  <div className="space-y-4">
                    <p className="text-sm text-gray-600">이 고객사의 대시보드에 표시할 카드와 순서를 설정하세요.</p>

                    {/* 안내 박스 */}
                    <div className="flex items-center gap-3 p-3 bg-blue-50 rounded-lg border border-blue-200">
                      <span className="text-sm text-gray-600">
                        선택된 카드는 <strong>드래그</strong>하거나 <strong>↑↓ 버튼</strong>으로 순서를 변경할 수 있습니다. 대시보드에서 <strong>6개씩 페이징</strong>으로 표시됩니다.
                      </span>
                      <span className="text-xs text-gray-400 ml-auto whitespace-nowrap">
                        선택: <span className="font-bold text-blue-600">{dashboardCardIds.length}</span>개
                        {dashboardCardIds.length > 6 && <span className="text-gray-400 ml-1">({Math.ceil(dashboardCardIds.length / 6)}페이지)</span>}
                      </span>
                    </div>

                    {/* ===== 선택된 카드 영역 ===== */}
                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <h4 className="text-sm font-semibold text-gray-800">선택된 카드 ({selectedCards.length}개)</h4>
                        <span className="text-xs text-gray-400">위에서 아래 순서로 표시됩니다</span>
                      </div>
                      {selectedCards.length === 0 ? (
                        <div className="p-6 bg-gray-50 border-2 border-dashed border-gray-300 rounded-lg text-center">
                          <p className="text-sm text-gray-500">선택된 카드가 없습니다.</p>
                          <p className="text-xs text-amber-600 mt-1">⚠️ 카드를 선택하지 않으면 고객사 대시보드에 DB현황이 표시되지 않습니다.</p>
                        </div>
                      ) : (
                        <div className="space-y-1.5 p-3 bg-blue-50/40 border border-blue-200 rounded-lg">
                          {selectedCards.map((card, idx) => {
                            const isFirst = idx === 0;
                            const isLast = idx === selectedCards.length - 1;
                            const isDragging = draggedCardIdx === idx;
                            const isPageBreak = (idx + 1) % 6 === 0 && idx !== selectedCards.length - 1;
                            return (
                              <div key={card.cardId}>
                                <div
                                  draggable
                                  onDragStart={() => setDraggedCardIdx(idx)}
                                  onDragOver={(e) => e.preventDefault()}
                                  onDrop={() => handleDrop(idx)}
                                  onDragEnd={() => setDraggedCardIdx(null)}
                                  className={`flex items-center gap-2 p-2.5 bg-white border rounded-lg transition-all cursor-move select-none ${
                                    isDragging ? 'opacity-40 border-blue-400 shadow-lg' : 'border-gray-200 hover:border-blue-300 hover:shadow-sm'
                                  }`}
                                >
                                  {/* 드래그 핸들 */}
                                  <span className="text-gray-400 text-lg leading-none flex-shrink-0" title="드래그하여 순서 변경">⋮⋮</span>
                                  {/* 순번 */}
                                  <span className="text-xs font-bold text-blue-600 w-6 text-center flex-shrink-0">{idx + 1}</span>
                                  {/* 카드 정보 */}
                                  <span className="text-base flex-shrink-0">{card.emoji}</span>
                                  <div className="flex-1 min-w-0">
                                    <span className="text-sm font-medium text-gray-800">{card.label}</span>
                                    <span className="text-xs text-gray-400 ml-2 hidden xl:inline">{card.description}</span>
                                  </div>
                                  {/* ↑ 위로 */}
                                  <button
                                    type="button"
                                    onClick={() => moveUp(idx)}
                                    disabled={isFirst}
                                    title="위로 이동"
                                    className={`whitespace-nowrap w-7 h-7 flex items-center justify-center rounded transition-colors flex-shrink-0 ${
                                      isFirst ? 'text-gray-300 cursor-not-allowed' : 'text-gray-600 hover:bg-emerald-100 hover:text-emerald-800'
                                    }`}
                                  >
                                    ↑
                                  </button>
                                  {/* ↓ 아래로 */}
                                  <button
                                    type="button"
                                    onClick={() => moveDown(idx)}
                                    disabled={isLast}
                                    title="아래로 이동"
                                    className={`whitespace-nowrap w-7 h-7 flex items-center justify-center rounded transition-colors flex-shrink-0 ${
                                      isLast ? 'text-gray-300 cursor-not-allowed' : 'text-gray-600 hover:bg-emerald-100 hover:text-emerald-800'
                                    }`}
                                  >
                                    ↓
                                  </button>
                                  {/* × 제거 */}
                                  <button
                                    type="button"
                                    onClick={() => removeCard(card.cardId)}
                                    title="제거"
                                    className="whitespace-nowrap w-7 h-7 flex items-center justify-center rounded text-gray-400 hover:bg-red-50 hover:text-red-600 transition-colors flex-shrink-0"
                                  >
                                    ×
                                  </button>
                                </div>
                                {/* 페이지 구분선 (6개 단위) */}
                                {isPageBreak && (
                                  <div className="flex items-center gap-2 my-2">
                                    <div className="flex-1 h-px bg-gray-300" />
                                    <span className="text-[10px] text-gray-400 font-medium px-2">▼ {Math.floor(idx / 6) + 2}페이지 ▼</span>
                                    <div className="flex-1 h-px bg-gray-300" />
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>

                    {/* ===== 추가 가능 카드 영역 ===== */}
                    {unselectedCards.length > 0 && (
                      <div>
                        <h4 className="text-sm font-semibold text-gray-800 mb-2">추가 가능한 카드 ({unselectedCards.length}개)</h4>
                        <div className="grid grid-cols-2 gap-1.5">
                          {unselectedCards.map((card) => (
                            <button
                              type="button"
                              key={card.cardId}
                              onClick={() => addCard(card.cardId)}
                              className="flex items-center gap-2 p-2 rounded-lg border bg-white border-gray-200 hover:bg-emerald-50 hover:border-blue-300 transition-all text-left"
                              title="클릭하여 추가"
                            >
                              <span className="text-blue-500 text-base font-bold flex-shrink-0">+</span>
                              <span className="text-base flex-shrink-0">{card.emoji}</span>
                              <div className="flex-1 min-w-0">
                                <span className="text-sm font-medium text-gray-800">{card.label}</span>
                                <span className="text-xs text-gray-400 ml-1 hidden xl:inline">{card.description}</span>
                              </div>
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })()}
    </>
  );
}
