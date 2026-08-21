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
 *
 * ★ 2026-08-21 표면만 콘솔 톤(인디고)으로 교체 — 판정·해결 로직 무변경.
 *   red→orange 그라데이션 헤더 + 경고·완료 이모지 → lucide + rose 배지, 이 앱에 없던 blue 버튼 → 인디고.
 *   ⛔ 충돌 문구(TYPE_LABELS·ACTION_LABELS·conflict.message·customKey)는 백엔드 응답과 짝이라 손대지 않았다.
 *     "슬롯" 같은 내부 용어를 고객 언어로 바꾸려면 백엔드 메시지까지 함께 봐야 한다(별건).
 */

import { useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2 } from 'lucide-react';
import {
  CUI_MODAL, CUI_MODAL_HEAD, CUI_MODAL_TITLE, CUI_MODAL_DESC, CUI_MODAL_BODY, CUI_MODAL_FOOT,
  CUI_BTN_PRIMARY, CUI_BTN_GHOST, CUI_SELECT,
} from '../utils/console-ui';

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

  const unresolvedCount = conflicts.filter(c => c.severity === 'error' && !decisions[c.header]).length;

  return (
    <div className="fixed inset-0 z-[80] bg-neutral-900/45 flex items-center justify-center p-4">
      <div className={`${CUI_MODAL} max-w-[720px]`} role="dialog" aria-modal="true" aria-label="업로드 매핑 충돌">

        {/* 헤더 */}
        <div className={CUI_MODAL_HEAD}>
          <div className="flex items-center gap-3 min-w-0">
            <div className="h-9 w-9 shrink-0 rounded-xl bg-rose-600 text-white grid place-items-center">
              <AlertTriangle className="w-4 h-4" strokeWidth={1.9} />
            </div>
            <div className="min-w-0">
              <h3 className={CUI_MODAL_TITLE}>이미 등록된 항목과 부딪힙니다</h3>
              <p className={CUI_MODAL_DESC}>
                {conflicts.length}건 중
                {errorCount > 0 && <span className="ml-1 font-semibold text-rose-600">해결 필요 {errorCount}건</span>}
                {warningCount > 0 && <span className="ml-1 font-semibold text-amber-700">확인 권장 {warningCount}건</span>}
              </p>
            </div>
          </div>
        </div>

        {/* 충돌 목록 */}
        <div className={CUI_MODAL_BODY}>
          {conflicts.map((c, idx) => {
            const decision = decisions[c.header];
            const isError = c.severity === 'error';
            return (
              <div
                key={`${c.header}-${idx}`}
                className={`rounded-xl border bg-white p-4 ${isError ? 'border-rose-200' : 'border-amber-200'}`}
              >
                <div className="flex items-center gap-2 flex-wrap mb-1.5">
                  <span className={`h-[22px] px-2 inline-flex items-center rounded-md text-[11.5px] font-semibold ${isError ? 'bg-rose-50 text-rose-700' : 'bg-amber-50 text-amber-800'}`}>
                    {TYPE_LABELS[c.type]}
                  </span>
                  <span className="font-mono text-[12px] font-semibold text-neutral-700">{c.customKey}</span>
                  <span className="text-[12px] text-neutral-500">{c.header}</span>
                </div>
                <p className="text-[13px] text-neutral-800 leading-relaxed">{c.message}</p>

                {/* 기존 · 신규 비교 */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-3">
                  {c.existing && (
                    <div className="rounded-lg bg-neutral-50 ring-1 ring-neutral-200 px-3 py-2">
                      <p className="text-[11.5px] text-neutral-500">지금 등록된 것</p>
                      <p className="text-[13px] font-semibold text-neutral-900 mt-0.5">{c.existing.label}</p>
                      <p className="text-[11.5px] text-neutral-500 mt-0.5 font-mono">{c.existing.customKey} · {c.existing.fieldType}</p>
                    </div>
                  )}
                  <div className="rounded-lg bg-indigo-50 ring-1 ring-indigo-600/15 px-3 py-2">
                    <p className="text-[11.5px] text-indigo-700">이번에 올린 것</p>
                    <p className="text-[13px] font-semibold text-neutral-900 mt-0.5">{c.proposed.label}</p>
                    <p className="text-[11.5px] text-indigo-700/70 mt-0.5 font-mono">{c.customKey} · {c.proposed.fieldType}</p>
                  </div>
                </div>

                {/* 해결 옵션 */}
                <div className="flex flex-wrap gap-1.5 mt-3">
                  {c.resolveOptions
                    .filter(a => a !== 'cancel')
                    .map(action => {
                      const selected = decision?.action === action;
                      return (
                        <button
                          key={action}
                          type="button"
                          onClick={() => setDecision(c.header, action)}
                          className={`h-8 px-3 rounded-lg text-[12.5px] transition focus:outline-none focus-visible:ring-4 focus-visible:ring-indigo-600/15 ${
                            selected
                              ? 'bg-indigo-600 text-white font-semibold'
                              : 'bg-white text-neutral-700 ring-1 ring-neutral-200 font-medium hover:ring-indigo-300 hover:text-indigo-700'
                          }`}
                        >
                          {ACTION_LABELS[action]}
                        </button>
                      );
                    })}
                </div>

                {/* move_slot 선택 시 슬롯 고르기 */}
                {decision?.action === 'move_slot' && (
                  <div className="mt-2.5">
                    {availableSlots.length > 0 ? (
                      <select
                        value={decision.newSlot || ''}
                        onChange={e => setDecision(c.header, 'move_slot', e.target.value)}
                        className={`${CUI_SELECT} max-w-[240px]`}
                      >
                        <option value="">이동할 슬롯 선택</option>
                        {availableSlots.map(s => (
                          <option key={s} value={s}>{s}</option>
                        ))}
                      </select>
                    ) : (
                      <p className="text-[12.5px] text-rose-600">비어 있는 슬롯이 없습니다. 다른 방법을 골라 주세요.</p>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* 푸터 */}
        <div className={CUI_MODAL_FOOT}>
          <span className="mr-auto inline-flex items-center gap-1.5 text-[12.5px]">
            {allResolved ? (
              <>
                <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" strokeWidth={1.9} />
                <span className="text-neutral-600">모두 정했습니다</span>
              </>
            ) : (
              <>
                <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" strokeWidth={1.9} />
                <span className="text-neutral-600 tabular-nums">{unresolvedCount}건을 아직 정하지 않았습니다</span>
              </>
            )}
          </span>
          <button type="button" onClick={onCancel} className={CUI_BTN_GHOST}>돌아가서 고치기</button>
          <button type="button" onClick={handleConfirm} disabled={!allResolved} className={CUI_BTN_PRIMARY}>
            이대로 업로드
          </button>
        </div>
      </div>
    </div>
  );
}
