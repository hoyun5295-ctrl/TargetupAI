/**
 * FileUploadMappingModal — 고객 DB 업로드 (파일 → 컬럼 맞추기 → 저장)
 *
 * ★ 2026-08-21 표면 재작성(콘솔 톤 인디고). Harold "디자인이 올드하고 폰트 크기부터 전체적으로 개선 필요".
 *   기능·state·핸들러·API 호출은 100% 그대로다(1~404줄 무변경). 바뀐 것은 렌더뿐:
 *     · 이모지 14곳(업로드·미리보기·카테고리 5종·저장 등) → lucide 아이콘
 *     · violet→purple 그라데이션 + `border-gray` 옛 규격 → `console-ui.ts` CUI_* 토큰(인디고 · 링 · 헤어라인)
 *     · 본문 16px·제목 18px → 콘솔 톤 규격(제목 16 · 섹션 15 · 본문 13.5 · 보조 12.5)
 *     · 고정폭 `w-[900px]`(모바일 넘침) → `max-w-[960px]` + 스크림 패딩 · 매핑 2열은 sm 이하 1열
 *     · 화면 문구를 고객 언어로("감지된 컬럼"→"찾은 컬럼", "표준 필드 매핑"→"기본 항목")
 *
 * 층 구조(바꾸지 않는다): 모달 z-50 · 컬럼 선택 팝업 z-[60]/z-[70] · 충돌 모달 z-[80].
 */
import { useEffect, useMemo, useState } from 'react';
import type { LucideIcon } from 'lucide-react';
import {
  Upload, Wand2, X, ChevronRight, ChevronLeft, FileSpreadsheet, Info, AlertTriangle,
  Plus, Trash2, Save, Loader2, Sparkles, ArrowLeft,
  User, ShoppingCart, Store, Award, Megaphone, Folder,
} from 'lucide-react';
import UploadMappingConflictModal, { type MappingConflict, type ConflictResolution } from './UploadMappingConflictModal';
import { formatPreviewValue } from '../utils/formatDate';
import { useToast } from './ToastProvider';
import {
  CUI_MODAL_SCRIM, CUI_MODAL, CUI_MODAL_HEAD, CUI_MODAL_TITLE, CUI_MODAL_DESC,
  CUI_MODAL_BODY, CUI_MODAL_FOOT, CUI_MODAL_CLOSE,
  CUI_BTN_PRIMARY, CUI_BTN_GHOST,
  CUI_PANEL, CUI_SCROLL_X, CUI_THEAD, CUI_TH, CUI_TR, CUI_TD, CUI_CELL_DATA,
  CUI_INFO, CUI_INFO_ICON, CUI_INFO_TEXT,
  CUI_NOTICE, CUI_NOTICE_ICON, CUI_NOTICE_TEXT,
  CUI_DANGER_BOX, CUI_DANGER_ICON, CUI_DANGER_TEXT,
  CUI_SEC_TITLE, CUI_PILL_BASE,
} from '../utils/console-ui';

// ─── 타입 ───

interface StandardFieldInfo {
  fieldKey: string;
  displayName: string;
  category: string;
  dataType: string;
  sortOrder: number;
}

interface CustomSlot {
  fieldKey: string;       // custom_1 ~ custom_15
  label: string;          // 사용자 지정 라벨 (예: "마일리지")
  excelColumn: string | null; // 매핑된 엑셀 컬럼
}

interface FileUploadMappingModalProps {
  show: boolean;
  onClose: () => void;
  onSaveStart: (fileId: string, totalRows: number) => void;
  onPlanLimitExceeded: (data: any) => void;
}

// ─── 카테고리 아이콘 (UI 표시 전용) ───
// ★ 2026-08-21 이모지 → lucide. 이모지는 OS·글꼴마다 다르게 그려져 줄 높이가 흔들린다(콘솔 톤 §4-2와 같은 이유).

const CATEGORY_ICONS: Record<string, LucideIcon> = {
  basic: User,
  purchase: ShoppingCart,
  store: Store,
  membership: Award,
  marketing: Megaphone,
};

const CATEGORY_ORDER = ['basic', 'purchase', 'store', 'membership', 'marketing'];

// ─── 컴포넌트 ───

export default function FileUploadMappingModal({ show, onClose, onSaveStart, onPlanLimitExceeded }: FileUploadMappingModalProps) {
  const toast = useToast();
  // Step
  const [step, setStep] = useState<'upload' | 'mapping'>('upload');

  // 파일 정보
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);
  const [fileHeaders, setFileHeaders] = useState<string[]>([]);
  const [filePreview, setFilePreview] = useState<any[]>([]);
  const [fileTotalRows, setFileTotalRows] = useState(0);
  const [fileId, setFileId] = useState('');
  const [loading, setLoading] = useState(false);
  // ★ D131: 드래그/드롭 UX (전단AI ExcelUploadModal 스타일 이식)
  const [dragActive, setDragActive] = useState(false);

  // 매핑 데이터
  const [mapping, setMapping] = useState<Record<string, string | null>>({});
  const [standardFields, setStandardFields] = useState<StandardFieldInfo[]>([]);
  const [catLabels, setCatLabels] = useState<Record<string, string>>({});

  // 커스텀 슬롯
  const [customSlots, setCustomSlots] = useState<CustomSlot[]>([]);

  // 팝업 (어떤 필드의 선택 팝업이 열려 있는지 + 위치)
  const [activePopup, setActivePopup] = useState<string | null>(null);
  const [popupPos, setPopupPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 });

  // ★ D111: 매핑 충돌 검증 상태
  const [conflictModal, setConflictModal] = useState<{
    show: boolean;
    conflicts: MappingConflict[];
    availableSlots: string[];
  }>({ show: false, conflicts: [], availableSlots: [] });

  // 팝업 열기 (클릭 위치 기반)
  const openPopup = (key: string, e: React.MouseEvent) => {
    if (activePopup === key) {
      setActivePopup(null);
      return;
    }
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const spaceBelow = window.innerHeight - rect.bottom;
    const top = spaceBelow < 200 ? rect.top - 200 : rect.bottom + 4;
    setPopupPos({ top, left: Math.min(rect.left, window.innerWidth - 320) });
    setActivePopup(key);
  };

  // ── 모달 닫힐 때 상태 초기화 ──
  useEffect(() => {
    if (!show) {
      setStep('upload');
      setUploadedFile(null);
      setFileHeaders([]);
      setFilePreview([]);
      setFileTotalRows(0);
      setFileId('');
      setMapping({});
      setStandardFields([]);
      setCatLabels({});
      setCustomSlots([]);
      setActivePopup(null);
      setLoading(false);
    }
  }, [show]);

  // ── 파생 데이터 (useMemo) ──

  // fieldKey → excelHeader 역매핑
  const fieldKeyToHeader = useMemo(() => {
    const map: Record<string, string> = {};
    for (const [header, fk] of Object.entries(mapping)) {
      if (fk) map[fk] = header;
    }
    return map;
  }, [mapping]);

  // 미배정 엑셀 컬럼
  const unassignedHeaders = useMemo(() => {
    const assigned = new Set(
      Object.entries(mapping)
        .filter(([_, v]) => v !== null)
        .map(([h]) => h)
    );
    return fileHeaders.filter(h => !assigned.has(h));
  }, [mapping, fileHeaders]);

  // phone 매핑 여부
  const hasPhone = useMemo(() => Object.values(mapping).includes('phone'), [mapping]);

  // 카테고리별 필드 그룹
  const fieldsByCategory = useMemo(() => {
    const groups: Record<string, StandardFieldInfo[]> = {};
    for (const f of standardFields) {
      if (!groups[f.category]) groups[f.category] = [];
      groups[f.category].push(f);
    }
    return groups;
  }, [standardFields]);

  // ── 핸들러 ──

  const handleFileSelect = async (file: File) => {
    setUploadedFile(file);
    setLoading(true);
    const formData = new FormData();
    formData.append('file', file);
    try {
      const res = await fetch('/api/upload/parse', {
        method: 'POST',
        headers: { Authorization: `Bearer ${localStorage.getItem('token')}` },
        body: formData
      });
      const data = await res.json();
      if (data.success) {
        setFileHeaders(data.headers);
        setFilePreview(data.preview);
        setFileTotalRows(data.totalRows);
        setFileId(data.fileId);
      } else {
        toast.error(data.error || '파일 처리 실패');
      }
    } catch {
      toast.error('파일 업로드 중 오류가 발생했습니다.');
    } finally {
      setLoading(false);
    }
  };

  const handleAiMapping = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/upload/mapping', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${localStorage.getItem('token')}`
        },
        body: JSON.stringify({ headers: fileHeaders })
      });
      const data = await res.json();
      if (data.success) {
        setMapping(data.mapping);
        setStandardFields(data.standardFields || []);
        setCatLabels(data.categoryLabels || {});

        // AI가 배정한 커스텀 슬롯 초기화
        const slots: CustomSlot[] = [];
        for (const [header, fieldKey] of Object.entries(data.mapping)) {
          if (fieldKey && typeof fieldKey === 'string' && fieldKey.startsWith('custom_')) {
            slots.push({ fieldKey, label: header, excelColumn: header });
          }
        }
        slots.sort((a, b) => parseInt(a.fieldKey.replace('custom_', '')) - parseInt(b.fieldKey.replace('custom_', '')));
        setCustomSlots(slots);
        setStep('mapping');
      } else {
        toast.error(data.error || '매핑 실패');
      }
    } catch {
      toast.error('매핑 중 오류가 발생했습니다.');
    } finally {
      setLoading(false);
    }
  };

  // 표준 필드에 엑셀 컬럼 매핑
  const assignStandardField = (fieldKey: string, excelHeader: string) => {
    const newMapping = { ...mapping };
    // 기존 매핑 해제
    for (const [h, fk] of Object.entries(newMapping)) {
      if (fk === fieldKey) newMapping[h] = null;
    }
    newMapping[excelHeader] = fieldKey;
    setMapping(newMapping);
    setActivePopup(null);
  };

  // 표준 필드 매핑 해제
  const unassignStandardField = (fieldKey: string) => {
    const newMapping = { ...mapping };
    for (const [h, fk] of Object.entries(newMapping)) {
      if (fk === fieldKey) newMapping[h] = null;
    }
    setMapping(newMapping);
  };

  // 커스텀 슬롯 추가
  const addCustomSlot = () => {
    const usedNums = new Set(customSlots.map(s => parseInt(s.fieldKey.replace('custom_', ''))));
    let next = 1;
    while (usedNums.has(next) && next <= 15) next++;
    if (next > 15) return;
    setCustomSlots([...customSlots, { fieldKey: `custom_${next}`, label: '', excelColumn: null }]);
  };

  // 커스텀 슬롯 삭제
  const removeCustomSlot = (index: number) => {
    const slot = customSlots[index];
    if (slot.excelColumn) {
      const newMapping = { ...mapping };
      newMapping[slot.excelColumn] = null;
      setMapping(newMapping);
    }
    setCustomSlots(customSlots.filter((_, i) => i !== index));
  };

  // 커스텀 슬롯에 엑셀 컬럼 매핑
  const assignCustomSlot = (index: number, excelHeader: string) => {
    const slot = customSlots[index];
    const newMapping = { ...mapping };
    // 기존 매핑 해제
    if (slot.excelColumn) newMapping[slot.excelColumn] = null;
    for (const [h, fk] of Object.entries(newMapping)) {
      if (fk === slot.fieldKey) newMapping[h] = null;
    }
    newMapping[excelHeader] = slot.fieldKey;
    setMapping(newMapping);

    const newSlots = [...customSlots];
    newSlots[index] = { ...slot, excelColumn: excelHeader, label: slot.label || excelHeader };
    setCustomSlots(newSlots);
    setActivePopup(null);
  };

  // 커스텀 슬롯 매핑 해제
  const unassignCustomSlot = (index: number) => {
    const slot = customSlots[index];
    if (slot.excelColumn) {
      const newMapping = { ...mapping };
      newMapping[slot.excelColumn] = null;
      setMapping(newMapping);
    }
    const newSlots = [...customSlots];
    newSlots[index] = { ...slot, excelColumn: null };
    setCustomSlots(newSlots);
  };

  // 커스텀 슬롯 라벨 변경
  const updateCustomLabel = (index: number, label: string) => {
    const newSlots = [...customSlots];
    newSlots[index] = { ...newSlots[index], label };
    setCustomSlots(newSlots);
  };

  // ★ D111: 매핑 충돌 검증 → 충돌 없으면 저장 / 있으면 모달 표시
  const handleSave = async () => {
    setLoading(true);
    try {
      const customLabels: Record<string, string> = {};
      for (const slot of customSlots) {
        if (slot.label) customLabels[slot.fieldKey] = slot.label;
      }

      // 1단계: 충돌 검증 (컨트롤타워 /validate-mapping)
      const validateRes = await fetch('/api/upload/validate-mapping', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${localStorage.getItem('token')}`,
        },
        body: JSON.stringify({ fileId, mapping, customLabels }),
      });
      const validateData = await validateRes.json();
      if (!validateRes.ok || !validateData.success) {
        toast.error(validateData.error || '매핑 검증 실패');
        setLoading(false);
        return;
      }

      const conflicts: MappingConflict[] = validateData.conflicts || [];
      const errorConflicts = conflicts.filter((c: MappingConflict) => c.severity === 'error');

      if (errorConflicts.length > 0) {
        // 에러 충돌 있음 → 모달로 사용자 해결 유도
        setConflictModal({
          show: true,
          conflicts,
          availableSlots: validateData.availableSlots || [],
        });
        setLoading(false);
        return;
      }

      // 충돌 없음 → 저장
      await handleSaveCore(mapping, customLabels);
    } catch {
      toast.error('저장 요청 중 오류가 발생했습니다.');
      setLoading(false);
    }
  };

  // 실제 /save 호출 — 해결된 매핑 사용
  const handleSaveCore = async (
    finalMapping: Record<string, string | null>,
    finalLabels: Record<string, string>
  ) => {
    try {
      const res = await fetch('/api/upload/save', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${localStorage.getItem('token')}`,
        },
        body: JSON.stringify({ fileId, mapping: finalMapping, customLabels: finalLabels }),
      });
      const data = await res.json();

      if (data.code === 'PLAN_LIMIT_EXCEEDED') {
        onPlanLimitExceeded(data);
        onClose();
        return;
      }
      if (!data.success) {
        toast.error(data.error || '저장 실패');
        setLoading(false);
        return;
      }

      onSaveStart(fileId, data.totalRows || fileTotalRows);
      onClose();
    } catch {
      toast.error('저장 요청 중 오류가 발생했습니다.');
    } finally {
      setLoading(false);
    }
  };

  // ★ D111: 충돌 모달에서 해결책 받아서 매핑 재구성 후 저장 진행
  const handleConflictResolve = async (resolutions: ConflictResolution[]) => {
    setConflictModal({ show: false, conflicts: [], availableSlots: [] });
    setLoading(true);

    // 기존 매핑/라벨 복사 후 resolution 반영
    const newMapping: Record<string, string | null> = { ...mapping };
    const newLabels: Record<string, string> = {};
    for (const slot of customSlots) {
      if (slot.label) newLabels[slot.fieldKey] = slot.label;
    }

    for (const r of resolutions) {
      if (r.action === 'keep_existing') {
        // 해당 컬럼을 업로드에서 제외
        newMapping[r.header] = null;
      } else if (r.action === 'overwrite') {
        // 매핑 그대로 유지 — 백엔드가 기존 라벨/타입 덮어씀
        // (no-op)
      } else if (r.action === 'move_slot' && r.newSlot) {
        // 사용자가 선택한 다른 슬롯으로 이동
        const oldLabel = newLabels[newMapping[r.header] as string];
        newMapping[r.header] = r.newSlot;
        if (oldLabel) newLabels[r.newSlot] = oldLabel;
      }
    }

    await handleSaveCore(newMapping, newLabels);
  };

  // 전체 닫기
  const handleClose = () => {
    onClose();
  };

  // ── 미배정 컬럼 선택 팝업 (fixed — 부모 overflow에 안 가린다) ──
  const renderColumnPopup = (
    targetKey: string,
    onSelect: (header: string) => void,
    onClear?: () => void
  ) => {
    if (activePopup !== targetKey) return null;
    return (
      <>
        {/* 바깥 클릭 캐처 */}
        <div className="fixed inset-0 z-[60]" onClick={() => setActivePopup(null)} />
        <div
          className="fixed z-[70] min-w-[248px] max-w-[360px] p-3 rounded-xl border border-neutral-200 bg-white shadow-lg shadow-neutral-900/[.08]"
          style={{ top: popupPos.top, left: popupPos.left }}
        >
          {unassignedHeaders.length > 0 ? (
            <>
              <p className="text-[11.5px] font-medium text-neutral-500 mb-2">아직 배정하지 않은 컬럼</p>
              <div className="flex flex-wrap gap-1.5 max-h-[180px] overflow-y-auto">
                {unassignedHeaders.map(h => (
                  <button
                    key={h}
                    type="button"
                    onClick={() => onSelect(h)}
                    className="h-7 px-2.5 rounded-lg bg-neutral-50 ring-1 ring-neutral-200 text-[12.5px] text-neutral-700 transition hover:bg-indigo-50 hover:ring-indigo-300 hover:text-indigo-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-600/25"
                  >
                    {h}
                  </button>
                ))}
              </div>
            </>
          ) : (
            <p className="text-[12.5px] text-neutral-400">모든 컬럼이 배정되었습니다</p>
          )}
          {onClear && (
            <button
              type="button"
              onClick={() => { onClear(); setActivePopup(null); }}
              className="mt-2.5 pt-2.5 w-full text-left border-t border-neutral-100 text-[12px] text-neutral-500 transition hover:text-rose-600"
            >
              이 필드 매핑 해제
            </button>
          )}
        </div>
      </>
    );
  };

  if (!show) return null;

  // ── 매핑된 필드 개수 ──
  const mappedStandardCount = standardFields.filter(f => fieldKeyToHeader[f.fieldKey]).length;
  const mappedCustomCount = customSlots.filter(s => s.excelColumn).length;

  /** 매핑 칩 — 배정됨(인디고) / 미배정(점선). 표준·커스텀이 같은 모양을 쓴다 */
  const mappingChip = (
    value: string | null,
    onOpen: (e: React.MouseEvent) => void,
    onRemove: () => void,
    removeLabel: string,
  ) => (
    value ? (
      <span className="inline-flex items-center gap-1 min-w-0">
        <button
          type="button"
          onClick={onOpen}
          className="h-7 max-w-[150px] px-2.5 rounded-lg bg-indigo-50 text-indigo-700 ring-1 ring-indigo-200 text-[12.5px] font-medium truncate transition hover:bg-indigo-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-600/25"
        >
          {value}
        </button>
        <button
          type="button"
          onClick={onRemove}
          aria-label={removeLabel}
          title={removeLabel}
          className="h-6 w-6 grid place-items-center rounded-md text-neutral-400 shrink-0 transition hover:bg-rose-50 hover:text-rose-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-rose-600/25"
        >
          <X className="w-3.5 h-3.5" strokeWidth={2} />
        </button>
      </span>
    ) : (
      <button
        type="button"
        onClick={onOpen}
        className="h-7 px-2.5 rounded-lg border border-dashed border-neutral-300 text-[12.5px] text-neutral-400 transition hover:border-indigo-400 hover:bg-indigo-50 hover:text-indigo-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-600/25"
      >
        컬럼 선택
      </button>
    )
  );

  return (
    <div
      className={CUI_MODAL_SCRIM}
      onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }}
      onDrop={(e) => { e.preventDefault(); e.stopPropagation(); }}
    >
      <div className={`${CUI_MODAL} max-w-[960px]`} role="dialog" aria-modal="true" aria-label="고객 DB 업로드">

        {/* ===== 헤더 (두 단계 공용) ===== */}
        <div className={CUI_MODAL_HEAD}>
          <div className="flex items-center gap-3 min-w-0">
            <div className="h-9 w-9 shrink-0 rounded-xl bg-indigo-600 text-white grid place-items-center">
              {step === 'upload'
                ? <Upload className="w-4 h-4" strokeWidth={1.9} />
                : <Wand2 className="w-4 h-4" strokeWidth={1.9} />}
            </div>
            <div className="min-w-0">
              <h3 className={CUI_MODAL_TITLE}>고객 DB 업로드</h3>
              <p className={CUI_MODAL_DESC}>
                {step === 'upload'
                  ? '엑셀·CSV 파일을 올리면 AI가 컬럼을 맞춰 줍니다'
                  : 'AI가 맞춘 결과입니다. 다르면 눌러서 바꾸세요'}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3 shrink-0">
            {/* 단계 표시 — 지금 어디인지, 다음이 무엇인지 */}
            <div className="hidden sm:flex items-center gap-1.5 text-[12px]">
              <span className={step === 'upload' ? 'font-semibold text-indigo-600' : 'text-neutral-400'}>파일</span>
              <ChevronRight className="w-3.5 h-3.5 text-neutral-300" />
              <span className={step === 'mapping' ? 'font-semibold text-indigo-600' : 'text-neutral-400'}>컬럼 맞추기</span>
            </div>
            <button type="button" onClick={handleClose} className={CUI_MODAL_CLOSE} aria-label="닫기">
              <X className="w-4 h-4" strokeWidth={1.75} />
            </button>
          </div>
        </div>

        {/* ===== Step 1: 파일 ===== */}
        {step === 'upload' && (
          <>
            <div className={CUI_MODAL_BODY}>
              {!fileHeaders.length ? (
                <>
                  <input
                    type="file"
                    accept=".xlsx,.xls,.csv"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) handleFileSelect(file);
                    }}
                    className="hidden"
                    id="file-upload-modal"
                    disabled={loading}
                  />
                  <label
                    htmlFor="file-upload-modal"
                    onDragEnter={(e) => { e.preventDefault(); e.stopPropagation(); setDragActive(true); }}
                    onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); setDragActive(true); }}
                    onDragLeave={(e) => { e.preventDefault(); e.stopPropagation(); setDragActive(false); }}
                    onDrop={(e) => {
                      e.preventDefault(); e.stopPropagation(); setDragActive(false);
                      const file = e.dataTransfer?.files?.[0];
                      if (file) handleFileSelect(file);
                    }}
                    className={`relative flex items-center justify-center rounded-2xl border-2 border-dashed text-center transition min-h-[260px] ${
                      dragActive ? 'border-indigo-600 bg-indigo-50' : 'border-neutral-300 hover:border-indigo-400 hover:bg-indigo-50/40'
                    } ${loading ? 'cursor-wait' : 'cursor-pointer'}`}
                  >
                    {loading ? (
                      <div className="w-full px-8 py-12 flex flex-col items-center gap-5">
                        <div className="relative w-16 h-16" aria-label="분석 중">
                          <svg className="absolute inset-0 w-full h-full" viewBox="0 0 50 50">
                            <defs>
                              <linearGradient id="fumMappingSpin" x1="0%" y1="0%" x2="100%" y2="100%">
                                <stop offset="0%" stopColor="#818cf8" />
                                <stop offset="100%" stopColor="#4f46e5" />
                              </linearGradient>
                            </defs>
                            <circle cx="25" cy="25" r="20" fill="none" stroke="#eef2ff" strokeWidth="3" />
                            <circle
                              cx="25" cy="25" r="20"
                              fill="none" stroke="url(#fumMappingSpin)" strokeWidth="3" strokeLinecap="round"
                              strokeDasharray="60 126"
                              style={{ transformOrigin: '50% 50%', animation: 'fum-spin 1s linear infinite' }}
                            />
                          </svg>
                          <div className="absolute inset-0 grid place-items-center">
                            <span className="text-[11px] font-bold text-indigo-600 tracking-wider">AI</span>
                          </div>
                        </div>
                        <div className="space-y-1">
                          <p className="text-[13.5px] font-semibold text-neutral-900">파일을 읽고 있습니다</p>
                          <p className="text-[12px] text-neutral-500">컬럼을 자동으로 맞추는 중입니다. 잠시만 기다려 주세요.</p>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="inline-flex items-center gap-1.5 text-[11.5px] font-semibold text-indigo-600">
                            <span className="w-1.5 h-1.5 rounded-full bg-indigo-600" style={{ animation: 'fum-dot 1.4s ease-in-out infinite' }} />
                            파일 분석
                          </span>
                          <span className="text-neutral-300">·</span>
                          <span className="inline-flex items-center gap-1.5 text-[11.5px] text-neutral-500">
                            <span className="w-1.5 h-1.5 rounded-full bg-neutral-300" style={{ animation: 'fum-dot 1.4s ease-in-out infinite', animationDelay: '0.2s' }} />
                            컬럼 맞추기
                          </span>
                          <span className="text-neutral-300">·</span>
                          <span className="inline-flex items-center gap-1.5 text-[11.5px] text-neutral-500">
                            <span className="w-1.5 h-1.5 rounded-full bg-neutral-300" style={{ animation: 'fum-dot 1.4s ease-in-out infinite', animationDelay: '0.4s' }} />
                            미리보기
                          </span>
                        </div>
                        <div className="w-3/4 h-1 bg-indigo-100 rounded-full overflow-hidden">
                          <div
                            className="h-full w-1/3 rounded-full bg-indigo-600"
                            style={{ animation: 'fum-bar 1.6s ease-in-out infinite' }}
                          />
                        </div>
                      </div>
                    ) : (
                      <div className="px-8 py-14 flex flex-col items-center">
                        <div className="h-14 w-14 mb-4 rounded-2xl bg-white ring-1 ring-indigo-600/15 shadow-sm grid place-items-center text-indigo-600">
                          <Upload className="w-6 h-6" strokeWidth={1.6} />
                        </div>
                        <p className="text-[15px] font-semibold tracking-[-0.02em] text-neutral-900">파일을 여기에 놓거나 눌러서 고르세요</p>
                        <p className="mt-1.5 text-[12.5px] text-neutral-500">xlsx · xls · csv · 최대 10MB</p>
                      </div>
                    )}
                    <style>{`
                      @keyframes fum-spin { to { transform: rotate(360deg); } }
                      @keyframes fum-dot { 0%, 100% { opacity: 0.35; transform: scale(0.85); } 50% { opacity: 1; transform: scale(1.15); } }
                      @keyframes fum-bar {
                        0% { transform: translateX(-100%); }
                        100% { transform: translateX(300%); }
                      }
                    `}</style>
                  </label>

                  {/* 안내 — 드래그 영역 밖(★D131: 중첩하면 세로가 눌린다) */}
                  <div className={CUI_INFO}>
                    <Info className={CUI_INFO_ICON} size={15} strokeWidth={1.9} />
                    <div className={CUI_INFO_TEXT}>
                      <p className="font-semibold">올리기 전에 확인해 주세요</p>
                      <ul className="mt-1 space-y-0.5">
                        <li>첫 번째 줄은 컬럼 이름으로 읽습니다</li>
                        <li>전화번호 컬럼은 반드시 있어야 합니다</li>
                        <li>나머지 컬럼은 AI가 알아서 맞춰 줍니다</li>
                      </ul>
                    </div>
                  </div>
                </>
              ) : (
                <>
                  {/* 고른 파일 */}
                  <div className="rounded-xl bg-white ring-1 ring-neutral-200 px-4 py-3 flex items-center justify-between gap-3">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="h-9 w-9 shrink-0 rounded-xl bg-indigo-50 text-indigo-600 grid place-items-center">
                        <FileSpreadsheet className="w-4 h-4" strokeWidth={1.9} />
                      </div>
                      <div className="min-w-0">
                        <p className="text-[13.5px] font-semibold text-neutral-900 truncate">{uploadedFile?.name}</p>
                        <p className="text-[12px] text-neutral-500 mt-0.5 tabular-nums">
                          총 {fileTotalRows.toLocaleString()}건 · 컬럼 {fileHeaders.length}개
                        </p>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => { setUploadedFile(null); setFileHeaders([]); setFilePreview([]); setFileTotalRows(0); setFileId(''); }}
                      className={`${CUI_BTN_GHOST} shrink-0`}
                    >
                      다시 고르기
                    </button>
                  </div>

                  {/* 감지된 컬럼 */}
                  <div>
                    <div className="flex items-baseline gap-2 mb-2.5">
                      <h4 className={CUI_SEC_TITLE}>찾은 컬럼</h4>
                      <span className="text-[12.5px] text-neutral-500 tabular-nums">{fileHeaders.length}개</span>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {fileHeaders.map((h, i) => (
                        <span key={i} className="h-7 px-2.5 inline-flex items-center rounded-lg bg-neutral-50 ring-1 ring-neutral-200 text-[12.5px] text-neutral-700">
                          {h}
                        </span>
                      ))}
                    </div>
                  </div>

                  {/* 미리보기 */}
                  <div>
                    <div className="flex items-baseline gap-2 mb-2.5">
                      <h4 className={CUI_SEC_TITLE}>미리보기</h4>
                      <span className="text-[12.5px] text-neutral-500">파일 상위 {filePreview.length}건</span>
                    </div>
                    <div className={CUI_PANEL}>
                      <div className={CUI_SCROLL_X}>
                        <table className="w-full">
                          <thead className={CUI_THEAD}>
                            <tr>
                              {fileHeaders.map((h, i) => (
                                <th key={i} className={CUI_TH}>{h}</th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {filePreview.map((row: any, rowIdx: number) => (
                              <tr key={rowIdx} className={CUI_TR}>
                                {fileHeaders.map((h, colIdx) => (
                                  <td key={colIdx} className={`${CUI_TD} ${CUI_CELL_DATA}`}>
                                    {row[h] != null ? formatPreviewValue(row[h]) : '-'}
                                  </td>
                                ))}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </div>
                </>
              )}
            </div>

            {/* 푸터 — 파일을 고른 뒤에만 다음 단계가 열린다 */}
            {fileHeaders.length > 0 && (
              <div className={CUI_MODAL_FOOT}>
                <span className="mr-auto text-[12.5px] text-neutral-500 tabular-nums">
                  {fileTotalRows.toLocaleString()}건 · 컬럼 {fileHeaders.length}개
                </span>
                <button type="button" onClick={handleAiMapping} disabled={loading} className={CUI_BTN_PRIMARY}>
                  {loading
                    ? <><Loader2 className="w-[15px] h-[15px] animate-spin" />컬럼을 맞추는 중</>
                    : <><Sparkles className="w-[15px] h-[15px]" />AI로 컬럼 맞추기</>}
                </button>
              </div>
            )}
          </>
        )}

        {/* ===== Step 2: 컬럼 맞추기 ===== */}
        {step === 'mapping' && (
          <>
            <div className={CUI_MODAL_BODY}>

              {/* 파일 요약 */}
              <div className="flex items-center gap-2.5 flex-wrap">
                <FileSpreadsheet className="w-4 h-4 text-neutral-400 shrink-0" strokeWidth={1.9} />
                <span className="text-[13px] font-semibold text-neutral-900 truncate max-w-[280px]">{uploadedFile?.name}</span>
                <span className="text-[12.5px] text-neutral-500 tabular-nums">{fileTotalRows.toLocaleString()}건</span>
                <span className={`${CUI_PILL_BASE} bg-indigo-50 text-indigo-700 tabular-nums`}>
                  맞춘 항목 {mappedStandardCount + mappedCustomCount}개
                </span>
              </div>

              {/* ── 표준 필드 ── */}
              <div>
                <div className="flex items-baseline gap-2 mb-2.5 flex-wrap">
                  <h4 className={CUI_SEC_TITLE}>기본 항목</h4>
                  <span className="text-[12.5px] text-neutral-500">칸을 눌러 엑셀 컬럼을 고르세요</span>
                </div>

                <div className="space-y-3">
                  {CATEGORY_ORDER.map(cat => {
                    const fields = fieldsByCategory[cat];
                    if (!fields || fields.length === 0) return null;
                    const CatIcon = CATEGORY_ICONS[cat] || Folder;
                    const catMapped = fields.filter(f => fieldKeyToHeader[f.fieldKey]).length;
                    return (
                      <div key={cat} className={CUI_PANEL}>
                        <div className="px-4 py-2.5 bg-neutral-50 border-b border-neutral-200 flex items-center gap-2">
                          <CatIcon className="w-[15px] h-[15px] text-neutral-500 shrink-0" strokeWidth={1.9} />
                          <span className="text-[13px] font-semibold text-neutral-900">{catLabels[cat] || cat}</span>
                          <span className="text-[12px] text-neutral-400 tabular-nums">{catMapped}/{fields.length}</span>
                        </div>
                        {/* 셀 사이 1px 선은 gap으로 만든다(1열·2열 어디서나 같은 모양) */}
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-px bg-neutral-100">
                          {fields.map(field => (
                            <div key={field.fieldKey} className="bg-white flex items-center gap-2.5 px-4 py-2.5">
                              <span className="text-[13px] font-medium text-neutral-700 w-[88px] shrink-0 truncate">{field.displayName}</span>
                              <ArrowLeft className="w-3.5 h-3.5 text-neutral-300 shrink-0" strokeWidth={2} />
                              <div className="relative flex-1 min-w-0">
                                {mappingChip(
                                  fieldKeyToHeader[field.fieldKey] || null,
                                  (e) => openPopup(field.fieldKey, e),
                                  () => unassignStandardField(field.fieldKey),
                                  `${field.displayName} 매핑 해제`,
                                )}
                                {renderColumnPopup(
                                  field.fieldKey,
                                  (h) => assignStandardField(field.fieldKey, h),
                                  fieldKeyToHeader[field.fieldKey] ? () => unassignStandardField(field.fieldKey) : undefined
                                )}
                              </div>
                            </div>
                          ))}
                          {fields.length % 2 === 1 && <div className="hidden sm:block bg-white" />}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* ── 커스텀 필드 ── */}
              <div>
                <div className="flex items-baseline gap-2 mb-2.5 flex-wrap">
                  <h4 className={CUI_SEC_TITLE}>직접 만든 항목</h4>
                  <span className="text-[12.5px] text-neutral-500">기본 항목에 없는 컬럼을 이름 붙여 저장합니다 (최대 15개)</span>
                </div>

                {customSlots.length > 0 && (
                  <div className="space-y-1.5 mb-2">
                    {customSlots.map((slot, index) => (
                      <div key={slot.fieldKey} className="flex items-center gap-2.5 px-3 py-2 rounded-xl bg-white ring-1 ring-neutral-200">
                        <span className="text-[11.5px] text-neutral-400 w-6 shrink-0 text-center tabular-nums">{slot.fieldKey.replace('custom_', '#')}</span>
                        <input
                          type="text"
                          value={slot.label}
                          onChange={(e) => updateCustomLabel(index, e.target.value)}
                          placeholder="항목 이름"
                          className="h-8 w-[136px] shrink-0 px-2.5 rounded-lg bg-white border border-neutral-200 text-[12.5px] text-neutral-900 transition placeholder:text-neutral-400 hover:border-neutral-300 focus:outline-none focus:border-indigo-600 focus:ring-4 focus:ring-indigo-600/15"
                        />
                        <ArrowLeft className="w-3.5 h-3.5 text-neutral-300 shrink-0" strokeWidth={2} />
                        <div className="relative flex-1 min-w-0">
                          {mappingChip(
                            slot.excelColumn,
                            (e) => openPopup(`custom_slot_${index}`, e),
                            () => unassignCustomSlot(index),
                            `${slot.label || slot.fieldKey} 매핑 해제`,
                          )}
                          {renderColumnPopup(
                            `custom_slot_${index}`,
                            (h) => assignCustomSlot(index, h),
                            slot.excelColumn ? () => unassignCustomSlot(index) : undefined
                          )}
                        </div>
                        <button
                          type="button"
                          onClick={() => removeCustomSlot(index)}
                          aria-label="이 항목 삭제"
                          title="이 항목 삭제"
                          className="h-7 w-7 grid place-items-center rounded-md text-neutral-400 shrink-0 transition hover:bg-rose-50 hover:text-rose-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-rose-600/25"
                        >
                          <Trash2 className="w-[15px] h-[15px]" strokeWidth={1.9} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                {customSlots.length < 15 && (
                  <button
                    type="button"
                    onClick={addCustomSlot}
                    className="w-full h-10 rounded-xl border border-dashed border-neutral-300 text-[12.5px] font-medium text-neutral-500 transition hover:border-indigo-400 hover:bg-indigo-50 hover:text-indigo-600 inline-flex items-center justify-center gap-1.5 focus:outline-none focus-visible:ring-4 focus-visible:ring-indigo-600/15"
                  >
                    <Plus className="w-4 h-4" strokeWidth={2} />
                    항목 추가
                  </button>
                )}
              </div>

              {/* 저장되지 않는 컬럼 */}
              {unassignedHeaders.length > 0 && (
                <div className={CUI_NOTICE}>
                  <AlertTriangle className={CUI_NOTICE_ICON} size={15} strokeWidth={1.9} />
                  <div className={CUI_NOTICE_TEXT}>
                    <p className="font-semibold">배정하지 않은 컬럼 {unassignedHeaders.length}개는 저장되지 않습니다</p>
                    <div className="mt-1.5 flex flex-wrap gap-1.5">
                      {unassignedHeaders.map(h => (
                        <span key={h} className="h-6 px-2 inline-flex items-center rounded-md bg-amber-100 text-amber-800 text-[11.5px]">{h}</span>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {/* 전화번호 필수 */}
              {!hasPhone && (
                <div className={CUI_DANGER_BOX}>
                  <AlertTriangle className={CUI_DANGER_ICON} size={15} strokeWidth={1.9} />
                  <p className={CUI_DANGER_TEXT}>전화번호 컬럼을 맞춰야 저장할 수 있습니다.</p>
                </div>
              )}
            </div>

            {/* 푸터 */}
            <div className={CUI_MODAL_FOOT}>
              <button type="button" onClick={() => setStep('upload')} className={`${CUI_BTN_GHOST} mr-auto`}>
                <ChevronLeft className="w-[15px] h-[15px]" />
                파일 다시 고르기
              </button>
              <button type="button" onClick={handleSave} disabled={!hasPhone || loading} className={CUI_BTN_PRIMARY}>
                {loading
                  ? <><Loader2 className="w-[15px] h-[15px] animate-spin" />요청 중</>
                  : <><Save className="w-[15px] h-[15px]" />{fileTotalRows.toLocaleString()}건 저장</>}
              </button>
            </div>
          </>
        )}

      </div>

      {/* ★ D111: 매핑 충돌 해결 모달 */}
      <UploadMappingConflictModal
        show={conflictModal.show}
        conflicts={conflictModal.conflicts}
        availableSlots={conflictModal.availableSlots}
        onCancel={() => {
          setConflictModal({ show: false, conflicts: [], availableSlots: [] });
          setLoading(false);
        }}
        onResolve={handleConflictResolve}
      />
    </div>
  );
}