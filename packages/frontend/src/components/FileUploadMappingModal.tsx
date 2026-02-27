import { useEffect, useMemo, useState } from 'react';

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

  // 매핑 데이터
  const [mapping, setMapping] = useState<Record<string, string | null>>({});
  const [standardFields, setStandardFields] = useState<StandardFieldInfo[]>([]);
  const [catLabels, setCatLabels] = useState<Record<string, string>>({});

  // 커스텀 슬롯
  const [customSlots, setCustomSlots] = useState<CustomSlot[]>([]);

  // 팝업 (어떤 필드의 선택 팝업이 열려 있는지)
  const [activePopup, setActivePopup] = useState<string | null>(null);

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

  // 저장
  const handleSave = async () => {
    setLoading(true);
    try {
      const customLabels: Record<string, string> = {};
      for (const slot of customSlots) {
        if (slot.label) customLabels[slot.fieldKey] = slot.label;
      }

      const res = await fetch('/api/upload/save', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${localStorage.getItem('token')}`
        },
        body: JSON.stringify({ fileId, mapping, customLabels })
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

  // 전체 닫기
  const handleClose = () => {
    onClose();
  };

  // ── 미배정 컬럼 선택 팝업 렌더링 ──
  const renderColumnPopup = (
    targetKey: string,
    onSelect: (header: string) => void,
    onClear?: () => void
  ) => {
    if (activePopup !== targetKey) return null;
    return (
      <>
        {/* 클릭 외부 오버레이 */}
        <div className="fixed inset-0 z-40" onClick={() => setActivePopup(null)} />
        {/* 팝업 */}
        <div className="absolute top-full left-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-xl p-3 z-50 min-w-[220px] max-w-[400px]">
          {unassignedHeaders.length > 0 ? (
            <>
              <p className="text-xs text-gray-500 mb-2 font-medium">미배정 엑셀 컬럼</p>
              <div className="flex flex-wrap gap-1.5 max-h-[160px] overflow-y-auto">
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
            <div className="p-4 border-b bg-gradient-to-r from-green-50 to-emerald-50 flex justify-between items-center shrink-0">
              <h3 className="font-bold text-lg flex items-center gap-2">
                <span>📤</span> 고객 DB 업로드
              </h3>
              <button onClick={handleClose} className="text-gray-500 hover:text-gray-700 text-xl leading-none">✕</button>
            </div>
            <div className="p-6 space-y-6 overflow-y-auto">
              {!fileHeaders.length ? (
                <div className="border-2 border-dashed border-gray-300 rounded-xl p-8 text-center hover:border-green-400 transition-colors relative">
                  {loading && (
                    <div className="absolute inset-0 bg-white bg-opacity-90 flex flex-col items-center justify-center rounded-xl z-10">
                      <div className="text-4xl mb-4 animate-bounce">📊</div>
                      <div className="text-lg font-semibold text-green-600">파일 분석 중...</div>
                      <div className="text-sm text-gray-500 mt-2">잠시만 기다려주세요</div>
                    </div>
                  )}
                  <div className="text-4xl mb-4">📁</div>
                  <p className="text-gray-600 mb-2">엑셀 또는 CSV 파일을 드래그하거나 클릭하여 업로드</p>
                  <p className="text-sm text-gray-400 mb-4">지원 형식: .xlsx, .xls, .csv</p>
                  <input
                    type="file"
                    accept=".xlsx,.xls,.csv"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) handleFileSelect(file);
                    }}
                    className="hidden"
                    id="file-upload-modal"
                  />
                  <label
                    htmlFor="file-upload-modal"
                    className={`inline-block px-6 py-3 text-white rounded-lg transition-colors ${loading ? 'bg-gray-400 cursor-wait' : 'bg-green-600 cursor-pointer hover:bg-green-700'}`}
                  >
                    {loading ? '⏳ 파일 분석 중...' : '파일 선택'}
                  </label>
                  <div className="mt-6 bg-gray-50 rounded-lg p-4 text-left">
                    <h4 className="font-semibold text-gray-700 mb-2">📋 업로드 안내</h4>
                    <ul className="text-sm text-gray-600 space-y-1">
                      <li>• 첫 번째 행은 컬럼명으로 인식됩니다</li>
                      <li>• 전화번호 컬럼은 필수입니다</li>
                      <li>• AI가 자동으로 컬럼을 매핑합니다</li>
                    </ul>
                  </div>
                </div>
              ) : (
                <>
                  <div className="bg-green-50 border border-green-200 rounded-lg p-4 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <span className="text-2xl">📄</span>
                      <div>
                        <div className="font-semibold text-gray-800">{uploadedFile?.name}</div>
                        <div className="text-sm text-gray-500">총 {fileTotalRows.toLocaleString()}건의 데이터</div>
                      </div>
                    </div>
                    <button onClick={() => { setUploadedFile(null); setFileHeaders([]); setFilePreview([]); setFileTotalRows(0); setFileId(''); }} className="text-gray-400 hover:text-red-500">✕ 다시 선택</button>
                  </div>
                  <div>
                    <h4 className="font-semibold text-gray-700 mb-3">📋 감지된 컬럼 ({fileHeaders.length}개)</h4>
                    <div className="flex flex-wrap gap-2">
                      {fileHeaders.map((h, i) => (
                        <span key={i} className="px-3 py-1 bg-blue-100 text-blue-700 rounded-full text-sm">{h}</span>
                      ))}
                    </div>
                  </div>
                  <div>
                    <h4 className="font-semibold text-gray-700 mb-3">👀 데이터 미리보기 (상위 5건)</h4>
                    <div className="overflow-x-auto border rounded-lg">
                      <table className="w-full text-sm">
                        <thead className="bg-gray-50">
                          <tr>
                            {fileHeaders.map((h, i) => (
                              <th key={i} className="px-3 py-2 text-left font-medium text-gray-600 border-b whitespace-nowrap">{h}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {filePreview.map((row: any, rowIdx: number) => (
                            <tr key={rowIdx} className="hover:bg-gray-50">
                              {fileHeaders.map((h, colIdx) => (
                                <td key={colIdx} className="px-3 py-2 border-b text-gray-700 whitespace-nowrap">{row[h] ?? '-'}</td>
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
                    className="w-full py-4 bg-gradient-to-r from-green-600 to-emerald-600 text-white rounded-lg font-medium hover:from-green-700 hover:to-emerald-700 flex items-center justify-center gap-2 text-lg disabled:opacity-50"
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
            <div className="p-4 border-b bg-green-50 flex justify-between items-center shrink-0">
              <h3 className="font-bold text-lg flex items-center gap-2">
                <span>🤖</span> AI 매핑 결과
              </h3>
              <button onClick={handleClose} className="text-gray-500 hover:text-gray-700 text-xl leading-none">✕</button>
            </div>

            {/* 스크롤 영역 */}
            <div className="p-6 space-y-5 overflow-y-auto flex-1">

              {/* 파일 정보 */}
              <div className="bg-green-50 border border-green-200 rounded-lg p-3 flex items-center justify-center gap-3">
                <span className="text-xl">📄</span>
                <div className="text-center">
                  <span className="font-semibold text-gray-800">{uploadedFile?.name}</span>
                  <span className="text-sm text-gray-500 ml-2">총 {fileTotalRows.toLocaleString()}건</span>
                </div>
                <span className="ml-3 text-xs px-2 py-0.5 bg-emerald-100 text-emerald-700 rounded-full">
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
                                        onClick={() => setActivePopup(activePopup === field.fieldKey ? null : field.fieldKey)}
                                        className="px-2 py-0.5 bg-emerald-50 text-emerald-700 border border-emerald-200 rounded text-xs hover:bg-emerald-100 transition-colors truncate max-w-[120px]"
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
                                      onClick={() => setActivePopup(activePopup === field.fieldKey ? null : field.fieldKey)}
                                      className="px-2 py-0.5 bg-gray-50 text-gray-400 border border-dashed border-gray-300 rounded text-xs hover:border-blue-400 hover:text-blue-500 hover:bg-blue-50 transition-colors"
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
                          className="px-2 py-1 border border-gray-300 rounded text-xs w-[130px] focus:outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-200"
                        />
                        {/* 화살표 */}
                        <span className="text-gray-300 text-xs">←</span>
                        {/* 엑셀 컬럼 매핑 */}
                        <div className="relative flex-1">
                          {slot.excelColumn ? (
                            <div className="inline-flex items-center gap-1">
                              <button
                                onClick={() => setActivePopup(activePopup === `custom_slot_${index}` ? null : `custom_slot_${index}`)}
                                className="px-2 py-0.5 bg-emerald-50 text-emerald-700 border border-emerald-200 rounded text-xs hover:bg-emerald-100 transition-colors truncate max-w-[120px]"
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
                              onClick={() => setActivePopup(activePopup === `custom_slot_${index}` ? null : `custom_slot_${index}`)}
                              className="px-2 py-0.5 bg-gray-50 text-gray-400 border border-dashed border-gray-300 rounded text-xs hover:border-blue-400 hover:text-blue-500 hover:bg-blue-50 transition-colors"
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
                    className="w-full py-2 border-2 border-dashed border-gray-300 rounded-lg text-xs text-gray-500 hover:border-blue-400 hover:text-blue-600 hover:bg-blue-50 transition-colors flex items-center justify-center gap-1"
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
                className="flex-1 py-3 bg-green-700 text-white rounded-lg font-medium hover:bg-green-800 flex items-center justify-center gap-2 text-lg disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
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
    </div>
  );
}
