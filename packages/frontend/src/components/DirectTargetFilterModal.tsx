import { Filter, RotateCcw, Search, Users } from 'lucide-react';
import { useEffect, useState } from 'react';

interface DirectTargetFilterModalProps {
  show: boolean;
  onClose: () => void;
  onExtracted: (recipients: any[], count: number) => void;
}

export default function DirectTargetFilterModal({ show, onClose, onExtracted }: DirectTargetFilterModalProps) {
  // 필드 데이터
  const [enabledFields, setEnabledFields] = useState<any[]>([]);
  const [filterOptions, setFilterOptions] = useState<Record<string, string[]>>({});
  const [categoryLabels, setCategoryLabels] = useState<Record<string, string>>({});
  const [fieldsLoaded, setFieldsLoaded] = useState(false);

  // 필드 선택 (체크박스)
  const [selectedFields, setSelectedFields] = useState<Set<string>>(new Set());

  // 필터 값
  const [filterValues, setFilterValues] = useState<Record<string, string>>({});

  // 수신동의 & 카운트
  const [smsOptIn, setSmsOptIn] = useState(true);
  const [targetCount, setTargetCount] = useState(0);
  const [countLoading, setCountLoading] = useState(false);
  const [extracting, setExtracting] = useState(false);

  // 아코디언 펼침 상태
  const [expandedCats, setExpandedCats] = useState<Record<string, boolean>>({ basic: true });

  // 카테고리 아이콘 (UI 표시용, 영문 키 기준)
  const CAT_ICONS: Record<string, string> = {
    basic: '📋', purchase: '💰', store: '🏪',
    membership: '🏷️', marketing: '📱', custom: '🔧',
  };

  // 필터 대상에서 제외할 필드 (식별용/수신동의는 별도 처리)
  const SKIP_FIELDS = ['name', 'phone', 'email', 'address', 'sms_opt_in'];

  // 연령대 프리셋
  const AGE_OPTIONS = [
    { label: '20대', value: '20' }, { label: '30대', value: '30' },
    { label: '40대', value: '40' }, { label: '50대', value: '50' },
    { label: '60대 이상', value: '60' },
  ];
  // 금액 프리셋
  const AMOUNT_OPTIONS = [
    { label: '5만원 이상', value: '50000' }, { label: '10만원 이상', value: '100000' },
    { label: '50만원 이상', value: '500000' }, { label: '100만원 이상', value: '1000000' },
    { label: '500만원 이상', value: '5000000' },
  ];
  // 일수 프리셋
  const DAYS_OPTIONS = [
    { label: '7일 이내', value: '7' }, { label: '30일 이내', value: '30' },
    { label: '90일 이내', value: '90' }, { label: '180일 이내', value: '180' },
    { label: '1년 이내', value: '365' },
  ];
  // 포인트 프리셋
  const POINTS_OPTIONS = [
    { label: '100 이상', value: '100' }, { label: '1,000 이상', value: '1000' },
    { label: '5,000 이상', value: '5000' }, { label: '10,000 이상', value: '10000' },
    { label: '50,000 이상', value: '50000' },
  ];

  // show 변경 시 enabled-fields 로드
  useEffect(() => {
    if (show && !fieldsLoaded) {
      loadEnabledFields();
    }
  }, [show]);

  // 활성 필드 로드
  const loadEnabledFields = async () => {
    try {
      const token = localStorage.getItem('token');
      const res = await fetch('/api/customers/enabled-fields', {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.ok) {
        const data = await res.json();
        setEnabledFields(data.fields || []);
        setFilterOptions(data.options || {});
        if (data.categories) setCategoryLabels(data.categories);
        setFieldsLoaded(true);
      }
    } catch (error) {
      console.error('필드 로드 실패:', error);
    }
  };

  // 필드 체크 토글
  const toggleField = (fieldKey: string) => {
    setSelectedFields(prev => {
      const next = new Set(prev);
      if (next.has(fieldKey)) {
        next.delete(fieldKey);
        // 체크 해제 시 필터값도 제거
        setFilterValues(fv => {
          const updated = { ...fv };
          delete updated[fieldKey];
          return updated;
        });
      } else {
        next.add(fieldKey);
      }
      return next;
    });
  };

  // 필터값 설정
  const setFilterValue = (fieldKey: string, value: string) => {
    setFilterValues(prev => {
      if (!value) {
        const next = { ...prev };
        delete next[fieldKey];
        return next;
      }
      return { ...prev, [fieldKey]: value };
    });
  };

  // 동적 필터 → API 포맷 변환
  const buildDynamicFiltersForAPI = () => {
    const filters: Record<string, any> = {};
    for (const [fieldKey, value] of Object.entries(filterValues)) {
      if (!value || !selectedFields.has(fieldKey)) continue;
      const field = enabledFields.find((f: any) => f.field_key === fieldKey);
      if (!field) continue;

      // 연령대 특수 처리
      if (fieldKey === 'age_group') {
        const ageVal = parseInt(value);
        if (ageVal >= 60) { filters['age'] = { operator: 'gte', value: 60 }; }
        else { filters['age'] = { operator: 'between', value: [ageVal, ageVal + 9] }; }
        continue;
      }
      // 날짜 필드 → 일수 이내
      if (field.data_type === 'date') {
        const dbColMap: Record<string, string> = { 'last_purchase_date': 'recent_purchase_date' };
        const dbCol = dbColMap[fieldKey] || fieldKey;
        filters[dbCol] = { operator: 'days_within', value: parseInt(value) };
        continue;
      }

      const dbFieldMap: Record<string, string> = { 'opt_in_sms': 'sms_opt_in' };
      const dbField = dbFieldMap[fieldKey] || fieldKey;

      if (field.data_type === 'string') {
        filters[dbField] = { operator: 'eq', value };
      } else if (field.data_type === 'number') {
        filters[dbField] = { operator: 'gte', value: Number(value) };
      } else if (field.data_type === 'boolean') {
        filters[dbField] = { operator: 'eq', value: value === 'true' };
      }
    }
    return filters;
  };

  // 대상 인원 조회
  const loadTargetCount = async () => {
    setCountLoading(true);
    try {
      const token = localStorage.getItem('token');
      const dynamicFilters = buildDynamicFiltersForAPI();
      const res = await fetch('/api/customers/filter-count', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ dynamicFilters, smsOptIn: smsOptIn })
      });
      const data = await res.json();
      setTargetCount(data.count || 0);
    } catch (error) {
      console.error('카운트 조회 실패:', error);
    } finally {
      setCountLoading(false);
    }
  };

  // 타겟 추출
  const handleExtract = async () => {
    if (targetCount === 0) return;
    setExtracting(true);
    try {
      const token = localStorage.getItem('token');
      const dynamicFilters = buildDynamicFiltersForAPI();
      const res = await fetch('/api/customers/extract', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          dynamicFilters,
          smsOptIn: smsOptIn,
          phoneField: 'phone'
        })
      });
      const data = await res.json();
      if (data.success && data.recipients) {
        onExtracted(data.recipients, data.count);
      }
    } catch (error) {
      console.error('타겟 추출 실패:', error);
    } finally {
      setExtracting(false);
    }
  };

  // 초기화
  const resetAll = () => {
    setSelectedFields(new Set());
    setFilterValues({});
    setSmsOptIn(true);
    setTargetCount(0);
  };

  // 닫기
  const handleClose = () => {
    resetAll();
    onClose();
  };

  // 조건 입력 UI 렌더링
  const renderConditionInput = (field: any) => {
    const val = filterValues[field.field_key] || '';
    const inputClass = 'w-full px-3 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent text-sm bg-white transition-all';

    // 연령대 특수 처리
    if (field.field_key === 'age_group') {
      return (
        <select value={val} onChange={e => setFilterValue(field.field_key, e.target.value)} className={inputClass}>
          <option value="">전체</option>
          {AGE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      );
    }

    // 문자열 + DB 옵션 → 드롭다운
    if (field.data_type === 'string' && filterOptions[field.field_key]?.length) {
      return (
        <select value={val} onChange={e => setFilterValue(field.field_key, e.target.value)} className={inputClass}>
          <option value="">전체</option>
          {filterOptions[field.field_key].map((opt: string) => (
            <option key={opt} value={opt}>{opt}</option>
          ))}
        </select>
      );
    }

    // 금액 필드 → 프리셋 드롭다운
    if (field.data_type === 'number' && ['total_purchase_amount', 'recent_purchase_amount', 'avg_order_value'].includes(field.field_key)) {
      return (
        <select value={val} onChange={e => setFilterValue(field.field_key, e.target.value)} className={inputClass}>
          <option value="">전체</option>
          {AMOUNT_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      );
    }

    // 포인트 필드 → 프리셋 드롭다운
    if (field.data_type === 'number' && field.field_key === 'points') {
      return (
        <select value={val} onChange={e => setFilterValue(field.field_key, e.target.value)} className={inputClass}>
          <option value="">전체</option>
          {POINTS_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      );
    }

    // 숫자 필드 → 직접 입력
    if (field.data_type === 'number') {
      return (
        <input type="number" value={val} onChange={e => setFilterValue(field.field_key, e.target.value)}
          placeholder="이상" className={inputClass} />
      );
    }

    // 날짜 필드 → 일수 드롭다운
    if (field.data_type === 'date') {
      return (
        <select value={val} onChange={e => setFilterValue(field.field_key, e.target.value)} className={inputClass}>
          <option value="">전체</option>
          {DAYS_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      );
    }

    // 불리언
    if (field.data_type === 'boolean') {
      return (
        <select value={val} onChange={e => setFilterValue(field.field_key, e.target.value)} className={inputClass}>
          <option value="">전체</option>
          <option value="true">예</option>
          <option value="false">아니오</option>
        </select>
      );
    }

    // 기본: 텍스트 입력 (포함 검색)
    return (
      <input type="text" value={val} onChange={e => setFilterValue(field.field_key, e.target.value)}
        placeholder="포함하는 값 입력" className={inputClass} />
    );
  };

  if (!show) return null;

  const filterableFields = enabledFields.filter((f: any) => !SKIP_FIELDS.includes(f.field_key));
  const activeFilterCount = Object.keys(filterValues).filter(k => filterValues[k] && selectedFields.has(k)).length;

  // 카테고리 순서
  const categoryOrder = ['basic', 'purchase', 'store', 'membership', 'marketing', 'custom'];
  const usedCategories = [...new Set(filterableFields.map((f: any) => f.category))];
  const orderedCategories = categoryOrder.filter(c => usedCategories.includes(c));
  const extraCategories = usedCategories.filter(c => !categoryOrder.includes(c));
  const allCategories = [...orderedCategories, ...extraCategories];

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 animate-in fade-in duration-200">
      <div className="bg-white rounded-2xl shadow-2xl w-[700px] max-h-[95vh] overflow-hidden animate-in zoom-in-95 duration-200">
        {/* 헤더 */}
        <div className="px-6 py-4 border-b border-gray-100 flex justify-between items-center bg-gradient-to-r from-green-50 to-emerald-50">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-green-100 rounded-xl flex items-center justify-center">
              <Filter className="w-5 h-5 text-green-600" />
            </div>
            <div>
              <h3 className="text-lg font-bold text-gray-800">직접 타겟 설정</h3>
              <p className="text-sm text-gray-500 mt-0.5">필터할 항목을 선택하고 조건을 설정하세요</p>
            </div>
          </div>
          <button
            onClick={handleClose}
            className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-white/80 transition-colors text-gray-400 hover:text-gray-600"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* 필터 영역 */}
        <div className="p-6 space-y-4 overflow-y-auto max-h-[65vh]">
          {/* 수신번호 필드 (고정) */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">수신번호 필드</label>
            <div className="w-full px-4 py-2.5 border border-gray-200 rounded-lg bg-gray-50 text-gray-700 text-sm">
              📱 phone (전화번호)
            </div>
          </div>

          <div className="border-t border-gray-100" />

          {/* 필터 조건 헤더 */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold text-gray-700">필터 조건 선택</span>
              {activeFilterCount > 0 && (
                <span className="px-2 py-0.5 bg-green-100 text-green-700 text-xs rounded-full font-bold">
                  {activeFilterCount}개 적용
                </span>
              )}
              {selectedFields.size > 0 && activeFilterCount === 0 && (
                <span className="px-2 py-0.5 bg-amber-100 text-amber-700 text-xs rounded-full font-medium">
                  {selectedFields.size}개 선택 · 조건 미설정
                </span>
              )}
            </div>
            <button onClick={resetAll} className="flex items-center gap-1 text-xs text-green-600 hover:text-green-700 font-medium transition-colors">
              <RotateCcw className="w-3 h-3" />
              초기화
            </button>
          </div>

          {/* 아코디언 필터 */}
          {!fieldsLoaded ? (
            <div className="text-center py-8 text-gray-400 text-sm">
              <div className="inline-block w-5 h-5 border-2 border-gray-300 border-t-green-500 rounded-full animate-spin mb-2" />
              <div>필터 항목을 로딩 중...</div>
            </div>
          ) : filterableFields.length === 0 ? (
            <div className="text-center py-8 text-gray-400 text-sm">
              고객 데이터를 먼저 업로드해주세요
            </div>
          ) : (
            <div className="space-y-2">
              {allCategories.map(cat => {
                const catFields = filterableFields.filter((f: any) => f.category === cat);
                if (catFields.length === 0) return null;

                const label = `${CAT_ICONS[cat] || '📌'} ${categoryLabels[cat] || cat}`;
                const selectedInCat = catFields.filter((f: any) => selectedFields.has(f.field_key)).length;
                const isExpanded = expandedCats[cat] ?? false;

                return (
                  <div key={cat} className="border border-gray-200 rounded-xl overflow-hidden">
                    {/* 카테고리 헤더 */}
                    <button
                      type="button"
                      onClick={() => setExpandedCats(prev => ({ ...prev, [cat]: !prev[cat] }))}
                      className="w-full px-4 py-3 flex items-center justify-between bg-gray-50 hover:bg-gray-100 transition-colors"
                    >
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-gray-700">{label}</span>
                        <span className="text-xs text-gray-400">({catFields.length})</span>
                        {selectedInCat > 0 && (
                          <span className="px-2 py-0.5 bg-green-100 text-green-700 text-xs rounded-full font-bold">{selectedInCat}</span>
                        )}
                      </div>
                      <svg className={`w-4 h-4 text-gray-400 transition-transform duration-200 ${isExpanded ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                      </svg>
                    </button>

                    {/* 필드 목록 */}
                    {isExpanded && (
                      <div className="p-4 bg-white border-t border-gray-100 space-y-3">
                        {catFields.map((field: any) => {
                          const isSelected = selectedFields.has(field.field_key);
                          const hasValue = !!filterValues[field.field_key];

                          return (
                            <div key={field.field_key} className={`rounded-lg transition-all duration-200 ${isSelected ? 'bg-green-50 border border-green-200 p-3' : 'p-0'}`}>
                              {/* 체크박스 + 라벨 */}
                              <label className={`flex items-center gap-3 cursor-pointer ${!isSelected ? 'p-3 rounded-lg hover:bg-gray-50 transition-colors' : ''}`}>
                                <input
                                  type="checkbox"
                                  checked={isSelected}
                                  onChange={() => toggleField(field.field_key)}
                                  className="w-4 h-4 text-green-600 rounded focus:ring-green-500 border-gray-300 cursor-pointer"
                                />
                                <span className={`text-sm font-medium ${isSelected ? 'text-green-700' : 'text-gray-600'}`}>
                                  {field.display_name}
                                </span>
                                {isSelected && hasValue && (
                                  <span className="ml-auto text-xs bg-green-200 text-green-800 px-2 py-0.5 rounded-full font-medium">설정됨</span>
                                )}
                              </label>

                              {/* 조건 입력 (체크 시만 표시) */}
                              {isSelected && (
                                <div className="mt-2 pl-7">
                                  {renderConditionInput(field)}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* 수신동의 */}
          <div className="flex items-center gap-2 p-3 bg-gray-50 rounded-lg">
            <input
              type="checkbox"
              id="targetSmsOptIn"
              checked={smsOptIn}
              onChange={(e) => setSmsOptIn(e.target.checked)}
              className="w-4 h-4 text-green-600 rounded focus:ring-green-500 border-gray-300"
            />
            <label htmlFor="targetSmsOptIn" className="text-sm text-gray-700 font-medium">수신동의 고객만 포함</label>
          </div>

          {/* 조회 버튼 */}
          <button
            onClick={loadTargetCount}
            disabled={countLoading}
            className="w-full py-3 border-2 border-green-600 text-green-700 rounded-xl hover:bg-green-50 transition-all font-semibold disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {countLoading ? (
              <>
                <div className="w-4 h-4 border-2 border-green-300 border-t-green-600 rounded-full animate-spin" />
                조회 중...
              </>
            ) : (
              <>
                <Search className="w-4 h-4" />
                대상 인원 조회
              </>
            )}
          </button>
        </div>

        {/* 푸터 - 대상 인원 + 버튼 */}
        <div className="px-6 py-4 border-t border-gray-100 bg-gradient-to-r from-gray-50 to-green-50/30">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-green-100 rounded-full flex items-center justify-center">
                <Users className="w-5 h-5 text-green-600" />
              </div>
              <div>
                <div className="text-sm text-gray-500">대상 인원</div>
                <div className="text-2xl font-bold text-green-700">
                  {countLoading ? '...' : targetCount.toLocaleString()}
                  <span className="text-base font-normal text-gray-500 ml-1">명</span>
                </div>
              </div>
            </div>
            <div className="flex gap-3">
              <button
                onClick={handleClose}
                className="px-5 py-2.5 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-100 transition-colors font-medium"
              >
                취소
              </button>
              <button
                onClick={handleExtract}
                disabled={targetCount === 0 || extracting}
                className="px-6 py-2.5 bg-green-700 text-white rounded-lg hover:bg-green-800 transition-colors font-medium flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {extracting ? (
                  <>
                    <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    추출 중...
                  </>
                ) : (
                  <>
                    <Users className="w-4 h-4" />
                    타겟 추출
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
