import { useEffect, useMemo, useState } from 'react';
import UploadMappingConflictModal, { type MappingConflict, type ConflictResolution } from './UploadMappingConflictModal';
import { formatPreviewValue } from '../utils/formatDate';

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

const CATEGORY_ICONS: Record<string, string> = {
  basic: '👤',
  purchase: '🛒',
  store: '🏬',
  membership: '⭐',
  marketing: '✅',
};

const CATEGORY_ORDER = ['basic', 'purchase', 'store', 'membership', 'marketing'];

// ─── 컴포넌트 ───

export default function FileUploadMappingModal({ show, onClose, onSaveStart, onPlanLimitExceeded }: FileUploadMappingModalProps) {
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
        alert(data.error || '파일 처리 실패');
      }
    } catch {
      alert('파일 업로드 중 오류가 발생했습니다.');
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
        alert(data.error || '매핑 실패');
      }
    } catch {
      alert('매핑 중 오류가 발생했습니다.');
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
        alert(validateData.error || '매핑 검증 실패');
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
      alert('저장 요청 중 오류가 발생했습니다.');
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
        alert(data.error || '저장 실패');
        setLoading(false);
        return;
      }

      onSaveStart(fileId, data.totalRows || fileTotalRows);
      onClose();
    } catch {
      alert('저장 요청 중 오류가 발생했습니다.');
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

  // ── 미배정 컬럼 선택 팝업 렌더링 (fixed 포지션) ──
  const renderColumnPopup = (
    targetKey: string,
    onSelect: (header: string) => void,
    onClear?: () => void
  ) => {
    if (activePopup !== targetKey) return null;
    return (
      <>
        {/* 클릭 외부 오버레이 */}
        <div className="fixed inset-0 z-[60]" onClick={() => setActivePopup(null)} />
        {/* 팝업 (fixed — overflow에 안 가림) */}
        <div
          className="fixed bg-white border border-gray-200 rounded-lg shadow-xl p-3 z-[70] min-w-[240px] max-w-[360px]"
          style={{ top: popupPos.top, left: popupPos.left }}
        >
          {unassignedHeaders.length > 0 ? (
            <>
              <p className="text-xs text-gray-500 mb-2 font-medium">미배정 엑셀 컬럼</p>
              <div className="flex flex-wrap gap-1.5 max-h-[180px] overflow-y-auto">
                {unassignedHeaders.map(h => (
                  <button
                    key={h}
                    onClick={() => onSelect(h)}
                    className="px-2.5 py-1 bg-blue-50 text-blue-700 border border-blue-200 rounded-md text-sm hover:bg-blue-100 transition-colors"
                  >
                    {h}
                  </button>
                ))}
              </div>
            </>
          ) : (
            <p className="text-xs text-gray-400">모든 컬럼이 배정되었습니다</p>
          )}
          {onClear && (
            <button
              onClick={() => { onClear(); setActivePopup(null); }}
              className="mt-2 pt-2 border-t border-gray-100 text-xs text-gray-400 hover:text-gray-600 w-full text-left"
            >
              매핑 안함
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

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-xl shadow-2xl w-[900px] max-h-[90vh] overflow-hidden flex flex-col">

        {/* ===== Step 1: 파일 업로드 ===== */}
        {step === 'upload' && (
          <>
            <div className="p-5 border-b bg-gradient-to-r from-violet-50 to-purple-50 flex justify-between items-center shrink-0">
              <h3 className="font-bold text-lg flex items-center gap-2.5 text-gray-800">
                <span className="w-8 h-8 rounded-xl bg-violet-100 flex items-center justify-center text-violet-600">📤</span>
                고객 DB 업로드
              </h3>
              <button onClick={handleClose} className="text-gray-400 hover:text-gray-700 text-xl leading-none transition-colors">✕</button>
            </div>
            <div className="p-6 space-y-6 overflow-y-auto">
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
                    className={`relative flex items-center justify-center border-2 border-dashed rounded-2xl text-center transition-colors min-h-[280px] ${
                      dragActive ? 'border-violet-500 bg-violet-50' : 'border-gray-300 hover:border-violet-400 hover:bg-violet-50/30'
                    } ${loading ? 'cursor-wait' : 'cursor-pointer'}`}
                  >
                    {loading ? (
                      <div className="w-full px-8 py-12 flex flex-col items-center gap-5">
                        <div className="relative w-16 h-16" aria-label="분석 중">
                          <svg className="absolute inset-0 w-full h-full" viewBox="0 0 50 50">
                            <defs>
                              <linearGradient id="fumMappingSpin" x1="0%" y1="0%" x2="100%" y2="100%">
                                <stop offset="0%" stopColor="#a78bfa" />
                                <stop offset="100%" stopColor="#7c3aed" />
                              </linearGradient>
                            </defs>
                            <circle cx="25" cy="25" r="20" fill="none" stroke="#ede9fe" strokeWidth="3" />
                            <circle
                              cx="25" cy="25" r="20"
                              fill="none" stroke="url(#fumMappingSpin)" strokeWidth="3" strokeLinecap="round"
                              strokeDasharray="60 126"
                              style={{ transformOrigin: '50% 50%', animation: 'fum-spin 1s linear infinite' }}
                            />
                          </svg>
                          <div className="absolute inset-0 flex items-center justify-center">
                            <div className="text-[11px] font-bold text-violet-600 tracking-wider">AI</div>
                          </div>
                        </div>
                        <div className="space-y-1">
                          <p className="text-sm font-semibold text-gray-800">AI가 엑셀을 분석하고 있습니다</p>
                          <p className="text-xs text-gray-500">컬럼명을 자동으로 매핑하는 중… 잠시만 기다려주세요.</p>
                        </div>
                        <div className="flex items-center gap-2 mt-1">
                          <div className="flex items-center gap-1.5 text-[11px] text-violet-600 font-semibold">
                            <span className="w-1.5 h-1.5 rounded-full bg-violet-500" style={{ animation: 'fum-dot 1.4s ease-in-out infinite' }} />
                            <span>파일 분석</span>
                          </div>
                          <span className="text-gray-300">·</span>
                          <div className="flex items-center gap-1.5 text-[11px] text-gray-500">
                            <span className="w-1.5 h-1.5 rounded-full bg-gray-300" style={{ animation: 'fum-dot 1.4s ease-in-out infinite', animationDelay: '0.2s' }} />
                            <span>AI 매핑</span>
                          </div>
                          <span className="text-gray-300">·</span>
                          <div className="flex items-center gap-1.5 text-[11px] text-gray-500">
                            <span className="w-1.5 h-1.5 rounded-full bg-gray-300" style={{ animation: 'fum-dot 1.4s ease-in-out infinite', animationDelay: '0.4s' }} />
                            <span>미리보기 생성</span>
                          </div>
                        </div>
                        <div className="w-3/4 h-1 bg-violet-100 rounded-full overflow-hidden mt-1">
                          <div
                            className="h-full w-1/3 bg-gradient-to-r from-violet-400 to-violet-600 rounded-full"
                            style={{ animation: 'fum-bar 1.6s ease-in-out infinite' }}
                          />
                        </div>
                      </div>
                    ) : (
                      <div className="px-10 py-14 flex flex-col items-center">
                        <div className="w-16 h-16 mb-5 rounded-2xl bg-violet-50 flex items-center justify-center">
                          <svg viewBox="0 0 24 24" fill="none" className="w-8 h-8 text-violet-500" xmlns="http://www.w3.org/2000/svg">
                            <path d="M12 3v12m0 0l-4-4m4 4l4-4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                            <path d="M4 17v2a2 2 0 002 2h12a2 2 0 002-2v-2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                          </svg>
                        </div>
                        <p className="text-base font-semibold text-gray-800 mb-1.5">파일을 드래그하거나 클릭하세요</p>
                        <p className="text-xs text-gray-500">.xlsx, .xls, .csv 지원 · 최대 10MB · AI가 자동으로 컬럼을 매핑합니다</p>
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
                  {/* ★ D131: 안내 카드는 드래그 영역 밖으로 분리 — 중첩으로 세로 눌림 방지 */}
                  <div className="bg-gray-50 rounded-xl p-4">
                    <h4 className="font-semibold text-gray-700 mb-2 text-sm flex items-center gap-1.5">
                      <span>📋</span> 업로드 안내
                    </h4>
                    <ul className="text-xs text-gray-600 space-y-1">
                      <li>• 첫 번째 행은 컬럼명으로 인식됩니다</li>
                      <li>• 전화번호 컬럼은 필수입니다</li>
                      <li>• AI가 자동으로 컬럼을 매핑합니다</li>
                    </ul>
                  </div>
                </>
              ) : (
                <>
                  <div className="bg-violet-50 border border-violet-200 rounded-xl p-4 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <span className="text-2xl">📄</span>
                      <div>
                        <div className="font-semibold text-gray-800">{uploadedFile?.name}</div>
                        <div className="text-sm text-gray-500">총 {fileTotalRows.toLocaleString()}건의 데이터</div>
                      </div>
                    </div>
                    <button onClick={() => { setUploadedFile(null); setFileHeaders([]); setFilePreview([]); setFileTotalRows(0); setFileId(''); }} className="text-gray-400 hover:text-red-500 transition-colors">✕ 다시 선택</button>
                  </div>
                  <div>
                    <h4 className="font-semibold text-gray-700 mb-3">📋 감지된 컬럼 ({fileHeaders.length}개)</h4>
                    <div className="flex flex-wrap gap-2">
                      {fileHeaders.map((h, i) => (
                        <span key={i} className="px-3 py-1 bg-violet-50 text-violet-700 border border-violet-100 rounded-full text-sm">{h}</span>
                      ))}
                    </div>
                  </div>
                  <div>
                    <h4 className="font-semibold text-gray-700 mb-3">👀 데이터 미리보기 (상위 5건)</h4>
                    <div className="overflow-x-auto border border-gray-200 rounded-xl">
                      <table className="w-full text-sm">
                        <thead className="bg-gray-50">
                          <tr>
                            {fileHeaders.map((h, i) => (
                              <th key={i} className="px-3 py-2.5 text-left font-medium text-gray-600 border-b border-gray-200 whitespace-nowrap">{h}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {filePreview.map((row: any, rowIdx: number) => (
                            <tr key={rowIdx} className="hover:bg-violet-50/40 transition-colors">
                              {fileHeaders.map((h, colIdx) => (
                                <td key={colIdx} className="px-3 py-2 border-b border-gray-100 text-gray-700 whitespace-nowrap">{row[h] != null ? formatPreviewValue(row[h]) : '-'}</td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                  <button
                    onClick={handleAiMapping}
                    disabled={loading}
                    className="w-full py-4 bg-gradient-to-r from-violet-600 to-purple-600 text-white rounded-xl font-semibold hover:from-violet-700 hover:to-purple-700 flex items-center justify-center gap-2 text-base disabled:opacity-50 shadow-sm shadow-violet-200/60 transition-all"
                  >
                    {loading ? (<><span className="animate-spin">⏳</span>AI가 컬럼을 분석하고 있습니다...</>) : (<><span>🤖</span>AI 자동 매핑 시작</>)}
                  </button>
                </>
              )}
            </div>
          </>
        )}

        {/* ===== Step 2: AI 매핑 결과 (태그 클릭 방식) ===== */}
        {step === 'mapping' && (
          <>
            {/* 헤더 */}
            <div className="p-5 border-b bg-gradient-to-r from-violet-50 to-purple-50 flex justify-between items-center shrink-0">
              <h3 className="font-bold text-lg flex items-center gap-2.5 text-gray-800">
                <span className="w-8 h-8 rounded-xl bg-violet-100 flex items-center justify-center text-violet-600">🤖</span>
                AI 매핑 결과
              </h3>
              <button onClick={handleClose} className="text-gray-400 hover:text-gray-700 text-xl leading-none transition-colors">✕</button>
            </div>

            {/* 스크롤 영역 */}
            <div className="p-6 space-y-5 overflow-y-auto flex-1">

              {/* 파일 정보 */}
              <div className="bg-violet-50 border border-violet-200 rounded-xl p-3 flex items-center justify-center gap-3">
                <span className="text-xl">📄</span>
                <div className="text-center">
                  <span className="font-semibold text-gray-800">{uploadedFile?.name}</span>
                  <span className="text-sm text-gray-500 ml-2">총 {fileTotalRows.toLocaleString()}건</span>
                </div>
                <span className="ml-3 text-xs px-2.5 py-0.5 bg-violet-100 text-violet-700 rounded-full font-semibold">
                  매핑 {mappedStandardCount + mappedCustomCount}/{standardFields.length + customSlots.length}
                </span>
              </div>

              {/* ── 표준 필드 매핑 (카테고리별) ── */}
              <div>
                <h4 className="font-semibold text-gray-700 mb-3 flex items-center gap-2">
                  📋 표준 필드 매핑
                  <span className="text-xs font-normal text-gray-400">클릭하여 엑셀 컬럼 선택 · ✕로 해제</span>
                </h4>

                <div className="space-y-4">
                  {CATEGORY_ORDER.map(cat => {
                    const fields = fieldsByCategory[cat];
                    if (!fields || fields.length === 0) return null;
                    return (
                      <div key={cat} className="border border-gray-200 rounded-lg overflow-hidden">
                        {/* 카테고리 헤더 */}
                        <div className="bg-gray-50 px-4 py-2 flex items-center gap-2 border-b border-gray-200">
                          <span>{CATEGORY_ICONS[cat] || '📁'}</span>
                          <span className="font-medium text-gray-700 text-sm">{catLabels[cat] || cat}</span>
                          <span className="text-xs text-gray-400">
                            ({fields.filter(f => fieldKeyToHeader[f.fieldKey]).length}/{fields.length})
                          </span>
                        </div>
                        {/* 필드 목록 — 2열 그리드 */}
                        <div className="grid grid-cols-2 divide-x divide-gray-100">
                          {fields.map((field, idx) => {
                            const mapped = fieldKeyToHeader[field.fieldKey];
                            return (
                              <div key={field.fieldKey} className={`flex items-center gap-2 px-3 py-2 hover:bg-gray-50 transition-colors ${idx >= 2 ? 'border-t border-gray-100' : ''}`}>
                                {/* 표준 필드명 */}
                                <span className="text-sm font-medium text-gray-700 w-[80px] shrink-0 truncate">{field.displayName}</span>
                                {/* 화살표 */}
                                <span className="text-gray-300 text-xs shrink-0">←</span>
                                {/* 매핑 영역 */}
                                <div className="relative flex-1 min-w-0">
                                  {mapped ? (
                                    <div className="inline-flex items-center gap-1">
                                      <button
                                        onClick={(e) => openPopup(field.fieldKey, e)}
                                        className="px-2 py-0.5 bg-violet-50 text-violet-700 border border-violet-200 rounded text-xs hover:bg-violet-100 transition-colors truncate max-w-[120px]"
                                      >
                                        {mapped}
                                      </button>
                                      <button
                                        onClick={() => unassignStandardField(field.fieldKey)}
                                        className="text-gray-400 hover:text-red-500 text-xs transition-colors"
                                      >
                                        ✕
                                      </button>
                                    </div>
                                  ) : (
                                    <button
                                      onClick={(e) => openPopup(field.fieldKey, e)}
                                      className="px-2 py-0.5 bg-gray-50 text-gray-400 border border-dashed border-gray-300 rounded text-xs hover:border-violet-400 hover:text-violet-500 hover:bg-violet-50 transition-colors"
                                    >
                                      클릭하여 선택
                                    </button>
                                  )}
                                  {renderColumnPopup(
                                    field.fieldKey,
                                    (h) => assignStandardField(field.fieldKey, h),
                                    mapped ? () => unassignStandardField(field.fieldKey) : undefined
                                  )}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* ── 커스텀 필드 (+/- 방식) ── */}
              <div>
                <h4 className="font-semibold text-gray-700 mb-3 flex items-center gap-2">
                  📦 커스텀 필드
                  <span className="text-xs font-normal text-gray-400">표준에 없는 필드를 추가 저장 (최대 15개)</span>
                </h4>

                {customSlots.length > 0 && (
                  <div className="space-y-1.5 mb-3">
                    {customSlots.map((slot, index) => (
                      <div key={slot.fieldKey} className="flex items-center gap-2 p-2 bg-white border border-gray-200 rounded-lg">
                        {/* 슬롯 번호 */}
                        <span className="text-xs text-gray-400 w-6 shrink-0 text-center">{slot.fieldKey.replace('custom_', '#')}</span>
                        {/* 라벨 입력 */}
                        <input
                          type="text"
                          value={slot.label}
                          onChange={(e) => updateCustomLabel(index, e.target.value)}
                          placeholder="라벨명 (예: 마일리지)"
                          className="px-2 py-1 border border-gray-300 rounded text-xs w-[130px] focus:outline-none focus:border-violet-400 focus:ring-1 focus:ring-violet-200"
                        />
                        {/* 화살표 */}
                        <span className="text-gray-300 text-xs">←</span>
                        {/* 엑셀 컬럼 매핑 */}
                        <div className="relative flex-1">
                          {slot.excelColumn ? (
                            <div className="inline-flex items-center gap-1">
                              <button
                                onClick={(e) => openPopup(`custom_slot_${index}`, e)}
                                className="px-2 py-0.5 bg-violet-50 text-violet-700 border border-violet-200 rounded text-xs hover:bg-violet-100 transition-colors truncate max-w-[120px]"
                              >
                                {slot.excelColumn}
                              </button>
                              <button
                                onClick={() => unassignCustomSlot(index)}
                                className="text-gray-400 hover:text-red-500 text-xs transition-colors"
                              >
                                ✕
                              </button>
                            </div>
                          ) : (
                            <button
                              onClick={(e) => openPopup(`custom_slot_${index}`, e)}
                              className="px-2 py-0.5 bg-gray-50 text-gray-400 border border-dashed border-gray-300 rounded text-xs hover:border-violet-400 hover:text-violet-500 hover:bg-violet-50 transition-colors"
                            >
                              클릭하여 선택
                            </button>
                          )}
                          {renderColumnPopup(
                            `custom_slot_${index}`,
                            (h) => assignCustomSlot(index, h),
                            slot.excelColumn ? () => unassignCustomSlot(index) : undefined
                          )}
                        </div>
                        {/* 삭제 */}
                        <button
                          onClick={() => removeCustomSlot(index)}
                          className="p-0.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded transition-colors shrink-0 text-xs"
                          title="삭제"
                        >
                          🗑️
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                {customSlots.length < 15 && (
                  <button
                    onClick={addCustomSlot}
                    className="w-full py-2 border-2 border-dashed border-gray-300 rounded-lg text-xs text-gray-500 hover:border-violet-400 hover:text-violet-600 hover:bg-violet-50 transition-colors flex items-center justify-center gap-1"
                  >
                    <span className="text-lg leading-none">+</span> 커스텀 필드 추가
                  </button>
                )}
              </div>

              {/* 미배정 컬럼 안내 */}
              {unassignedHeaders.length > 0 && (
                <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg">
                  <p className="text-xs text-amber-700 font-medium mb-2">💡 미배정 엑셀 컬럼 ({unassignedHeaders.length}개) — 저장되지 않습니다</p>
                  <div className="flex flex-wrap gap-1.5">
                    {unassignedHeaders.map(h => (
                      <span key={h} className="px-2 py-0.5 bg-amber-100 text-amber-600 rounded text-xs">{h}</span>
                    ))}
                  </div>
                </div>
              )}

              {/* phone 필수 경고 */}
              {!hasPhone && (
                <div className="p-4 bg-red-50 border border-red-200 rounded-lg text-red-600 flex items-center gap-2">
                  <span>⚠️</span>
                  <span>전화번호 컬럼을 매핑해주세요 (필수)</span>
                </div>
              )}
            </div>

            {/* 하단 버튼 (고정) */}
            <div className="p-4 border-t bg-gray-50 flex gap-3 shrink-0">
              <button
                onClick={() => setStep('upload')}
                className="flex-1 py-3 border border-gray-300 text-gray-700 rounded-lg font-medium hover:bg-gray-100 transition-colors"
              >
                ← 이전
              </button>
              <button
                onClick={handleSave}
                disabled={!hasPhone || loading}
                className="flex-1 py-3 bg-gradient-to-r from-violet-600 to-purple-600 text-white rounded-xl font-semibold hover:from-violet-700 hover:to-purple-700 flex items-center justify-center gap-2 text-base disabled:opacity-50 disabled:cursor-not-allowed shadow-sm shadow-violet-200/60 transition-all"
              >
                {loading ? (
                  <><span className="animate-spin">⏳</span>요청 중...</>
                ) : (
                  <><span>💾</span>고객 데이터 저장 ({fileTotalRows.toLocaleString()}건)</>
                )}
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
