/**
 * UploadMappingConflictModal — 업로드 매핑 충돌 해결 모달 (D111)
 *
 * 호출부: FileUploadMappingModal.tsx handleSave() — /validate-mapping 응답 conflicts.length > 0 일 때 표시
 *
 * 충돌 종류:
 *   slot_label_conflict:     같은 custom_N 슬롯, 기존 라벨 ≠ 신규 라벨
 *   slot_type_conflict:      같은 custom_N 슬롯, 기존 타입 ≠ 신규 타입
 *   label_moved:             같은 라벨인데 기존과 다른 슬롯에 배정
 *   label_duplicate_in_file: 같은 파일 내 다른 컬럼이 같은 기존 라벨 사용
 *
 * 사용자 해결 옵션 (각 충돌별 resolveOptions로 백엔드에서 지정):
 *   keep_existing: 해당 헤더를 업로드에서 제외 (mapping[header] = null)
 *   overwrite:     기존 라벨/타입 덮어쓰기
 *   move_slot:     다른 비어있는 custom_N 슬롯으로 이동
 *   cancel:        전체 업로드 중단
 */

import { useMemo, useState } from 'react';

export type ConflictType =
  | 'slot_label_conflict'
  | 'slot_type_conflict'
  | 'label_moved'
  | 'label_duplicate_in_file';

export type ResolveAction = 'keep_existing' | 'overwrite' | 'move_slot' | 'cancel';

export interface MappingConflict {
  type: ConflictType;
  customKey: string;
  header: string;
  proposed: { label: string; fieldType: string };
  existing?: { customKey: string; label: string; fieldType: string };
  severity: 'error' | 'warning';
  message: string;
  resolveOptions: ResolveAction[];
}

export interface ConflictResolution {
  header: string;
  action: Exclude<ResolveAction, 'cancel'>;
  /** move_slot일 때 이동할 새 슬롯 */
  newSlot?: string;
}

interface UploadMappingConflictModalProps {
  show: boolean;
  conflicts: MappingConflict[];
  availableSlots: string[];
  onCancel: () => void;
  onResolve: (resolutions: ConflictResolution[]) => void;
}

const TYPE_LABELS: Record<ConflictType, string> = {
  slot_label_conflict: '슬롯 라벨 충돌',
  slot_type_conflict: '슬롯 타입 충돌',
  label_moved: '같은 라벨 다른 슬롯',
  label_duplicate_in_file: '파일 내 라벨 중복',
};

const ACTION_LABELS: Record<Exclude<ResolveAction, 'cancel'>, string> = {
  keep_existing: '기존 유지 (이 컬럼 업로드 제외)',
  overwrite: '덮어쓰기 (기존 라벨/타입 변경)',
  move_slot: '다른 슬롯으로 이동',
};

export default function UploadMappingConflictModal({
  show,
  conflicts,
  availableSlots,
  onCancel,
  onResolve,
}: UploadMappingConflictModalProps) {
  // 충돌별 사용자 선택 저장
  const [decisions, setDecisions] = useState<Record<string, ConflictResolution | null>>({});

  const errorCount = useMemo(() => conflicts.filter(c => c.severity === 'error').length, [conflicts]);
  const warningCount = conflicts.length - errorCount;

  if (!show) return null;

  // 모든 에러 충돌에 해결책이 지정됐는지 확인
  const allResolved = conflicts.every(c => {
    if (c.severity !== 'error') return true;
    const d = decisions[c.header];
    if (!d) return false;
    if (d.action === 'move_slot' && !d.newSlot) return false;
    return true;
  });

  const setDecision = (header: string, action: Exclude<ResolveAction, 'cancel'>, newSlot?: string) => {
    setDecisions(prev => ({ ...prev, [header]: { header, action, newSlot } }));
  };

  const handleConfirm = () => {
    const resolutions: ConflictResolution[] = [];
    for (const c of conflicts) {
      const d = decisions[c.header];
      if (d) resolutions.push(d);
    }
    onResolve(resolutions);
  };

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-[80] p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl max-h-[90vh] flex flex-col">
        {/* 헤더 */}
        <div className="p-5 border-b bg-gradient-to-r from-red-50 to-orange-50 flex items-center gap-3">
          <div className="w-10 h-10 bg-red-100 rounded-full flex items-center justify-center">
            <span className="text-2xl">⚠️</span>
          </div>
          <div className="flex-1">
            <h3 className="font-bold text-gray-800 text-lg">업로드 매핑 충돌 감지</h3>
            <p className="text-xs text-gray-600 mt-0.5">
              기존 등록된 필드와 {conflicts.length}건의 충돌이 있습니다.
              {errorCount > 0 && <span className="ml-1 text-red-600 font-semibold">(에러 {errorCount}건)</span>}
              {warningCount > 0 && <span className="ml-1 text-amber-600 font-semibold">(경고 {warningCount}건)</span>}
            </p>
          </div>
        </div>

        {/* 충돌 리스트 */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {conflicts.map((c, idx) => {
            const decision = decisions[c.header];
            const isError = c.severity === 'error';
            return (
              <div
                key={`${c.header}-${idx}`}
                className={`border-2 rounded-xl p-4 ${isError ? 'border-red-200 bg-red-50/30' : 'border-amber-200 bg-amber-50/30'}`}
              >
                <div className="flex items-start justify-between gap-3 mb-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span
                        className={`text-[10px] font-bold px-2 py-0.5 rounded ${isError ? 'bg-red-200 text-red-800' : 'bg-amber-200 text-amber-800'}`}
                      >
                        {TYPE_LABELS[c.type]}
                      </span>
                      <span className="text-sm font-mono font-bold text-gray-700">{c.customKey}</span>
                      <span className="text-xs text-gray-500">· {c.header}</span>
                    </div>
                    <p className="text-sm text-gray-800 leading-relaxed">{c.message}</p>
                  </div>
                </div>

                {/* 비교 카드 */}
                <div className="grid grid-cols-2 gap-2 mb-3 text-xs">
                  {c.existing && (
                    <div className="bg-white border border-gray-200 rounded p-2">
                      <div className="text-gray-400 mb-0.5">기존</div>
                      <div className="font-semibold text-gray-800">{c.existing.label}</div>
                      <div className="text-gray-500 mt-0.5">
                        {c.existing.customKey} · {c.existing.fieldType}
                      </div>
                    </div>
                  )}
                  <div className="bg-white border border-blue-200 rounded p-2">
                    <div className="text-blue-500 mb-0.5">신규</div>
                    <div className="font-semibold text-gray-800">{c.proposed.label}</div>
                    <div className="text-gray-500 mt-0.5">
                      {c.customKey} · {c.proposed.fieldType}
                    </div>
                  </div>
                </div>

                {/* 해결 옵션 */}
                <div className="flex flex-wrap gap-2">
                  {c.resolveOptions
                    .filter(a => a !== 'cancel')
                    .map(action => {
                      const selected = decision?.action === action;
                      return (
                        <button
                          key={action}
                          onClick={() => setDecision(c.header, action)}
                          className={`text-xs px-3 py-1.5 rounded border transition-colors ${
                            selected
                              ? 'bg-blue-600 text-white border-blue-600'
                              : 'bg-white text-gray-700 border-gray-300 hover:border-blue-400'
                          }`}
                        >
                          {ACTION_LABELS[action]}
                        </button>
                      );
                    })}
                </div>

                {/* move_slot 선택 시 드롭다운 */}
                {decision?.action === 'move_slot' && (
                  <div className="mt-2">
                    {availableSlots.length > 0 ? (
                      <select
                        value={decision.newSlot || ''}
                        onChange={e => setDecision(c.header, 'move_slot', e.target.value)}
                        className="text-xs border rounded px-2 py-1"
                      >
                        <option value="">이동할 슬롯 선택</option>
                        {availableSlots.map(s => (
                          <option key={s} value={s}>
                            {s}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <p className="text-xs text-red-600">비어있는 custom 슬롯이 없습니다. 다른 옵션을 선택하세요.</p>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* 푸터 */}
        <div className="p-4 border-t bg-gray-50 flex items-center justify-between">
          <div className="text-xs text-gray-500">
            {allResolved
              ? '✅ 모든 충돌이 해결되었습니다.'
              : `⚠️ ${conflicts.filter(c => c.severity === 'error' && !decisions[c.header]).length}건 미해결`}
          </div>
          <div className="flex items-center gap-3">
            <button onClick={onCancel} className="px-5 py-2.5 text-gray-600 hover:bg-gray-200 rounded-lg">
              취소하고 수정
            </button>
            <button
              onClick={handleConfirm}
              disabled={!allResolved}
              className="px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium disabled:opacity-40 disabled:cursor-not-allowed"
            >
              해결 후 업로드 진행
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
