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

  // 필터 값 (다중선택: string[], 단일: string, 연령: {mode, presets?, min?, max?})
  const [filterValues, setFilterValues] = useState<Record<string, any>>({});

  // 카운트
  const [targetCount, setTargetCount] = useState(0);
  const [countLoading, setCountLoading] = useState(false);
  const [extracting, setExtracting] = useState(false);

  // 아코디언
  const [expandedCats, setExpandedCats] = useState<Record<string, boolean>>({ basic: true });

  // 에러 알림 모달
  const [alertModal, setAlertModal] = useState<{ show: boolean; title: string; message: string; type: 'error' | 'warning' | 'info' }>({ show: false, title: '', message: '', type: 'error' });
  const showAlert = (title: string, message: string, type: 'error' | 'warning' | 'info' = 'error') => {
    setAlertModal({ show: true, title, message, type });
  };

  // 카테고리 아이콘
  const CAT_ICONS: Record<string, string> = {
    basic: '📋', purchase: '💰', store: '🏪',
    membership: '🏷️', marketing: '📱', custom: '🔧',
  };

  // 프리셋
  const AGE_PRESETS = [
    { label: '10대', value: '10' }, { label: '20대', value: '20' },
    { label: '30대', value: '30' }, { label: '40대', value: '40' },
    { label: '50대', value: '50' }, { label: '60+', value: '60' },
  ];
  const AMOUNT_PRESETS = [
    { label: '5만↑', value: '50000' }, { label: '10만↑', value: '100000' },
    { label: '50만↑', value: '500000' }, { label: '100만↑', value: '1000000' },
    { label: '500만↑', value: '5000000' },
  ];
  const DAYS_PRESETS = [
    { label: '7일', value: '7' }, { label: '30일', value: '30' },
    { label: '90일', value: '90' }, { label: '180일', value: '180' },
    { label: '1년', value: '365' },
  ];
  const POINTS_PRESETS = [
    { label: '100↑', value: '100' }, { label: '1천↑', value: '1000' },
    { label: '5천↑', value: '5000' }, { label: '1만↑', value: '10000' },
    { label: '5만↑', value: '50000' },
  ];

  // 금액 필드 판별
  const isAmountField = (key: string) => ['total_purchase_amount', 'recent_purchase_amount', 'avg_order_value'].includes(key);

  // show 시 필드 로드
  useEffect(() => {
    if (show && !fieldsLoaded) loadEnabledFields();
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

        // sms_opt_in 기본 선택 (수신동의 고객만)
        const smsField = (data.fields || []).find((f: any) =>
          f.field_key === 'sms_opt_in' || f.field_key === 'opt_in_sms'
        );
        if (smsField) {
          setSelectedFields(new Set([smsField.field_key]));
          setFilterValues({ [smsField.field_key]: 'true' });
        }
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
        setFilterValues(fv => { const u = { ...fv }; delete u[fieldKey]; return u; });
      } else {
        next.add(fieldKey);
      }
      return next;
    });
  };

  // 다중선택 토글
  const toggleMultiOption = (fieldKey: string, option: string) => {
    setFilterValues(prev => {
      const current = Array.isArray(prev[fieldKey]) ? [...prev[fieldKey]] : [];
      const idx = current.indexOf(option);
      if (idx >= 0) current.splice(idx, 1);
      else current.push(option);
      return { ...prev, [fieldKey]: current };
    });
  };

  // 연령 프리셋 토글
  const toggleAgePreset = (decade: string) => {
    setFilterValues(prev => {
      const age = prev.age || { mode: 'preset', presets: [] };
      const presets = [...(age.presets || [])];
      const idx = presets.indexOf(decade);
      if (idx >= 0) presets.splice(idx, 1);
      else presets.push(decade);
      return { ...prev, age: { ...age, mode: 'preset', presets } };
    });
  };

  // 연령 모드 전환
  const setAgeMode = (mode: 'preset' | 'range') => {
    setFilterValues(prev => ({
      ...prev,
      age: { mode, presets: [], min: '', max: '' }
    }));
  };

  // 연령 범위 값 설정
  const setAgeRange = (key: 'min' | 'max', val: string) => {
    setFilterValues(prev => {
      const age = prev.age || { mode: 'range', min: '', max: '' };
      return { ...prev, age: { ...age, [key]: val } };
    });
  };

  // 연령 유효 범위 텍스트
  const getAgeRangeText = () => {
    const age = filterValues.age;
    if (!age) return '';
    if (age.mode === 'preset' && age.presets?.length > 0) {
      const decades = age.presets.map(Number).sort((a: number, b: number) => a - b);
      const min = decades[0];
      const maxD = decades[decades.length - 1];
      if (maxD >= 60) return min >= 60 ? '60세 이상' : `${min}~∞세`;
      return `${min}~${maxD + 9}세`;
    }
    if (age.mode === 'range') {
      if (age.min && age.max) return `${age.min}~${age.max}세`;
      if (age.min) return `${age.min}세 이상`;
      if (age.max) return `${age.max}세 이하`;
    }
    return '';
  };

  // 동적 필터 → API 포맷
  const buildDynamicFiltersForAPI = () => {
    const filters: Record<string, any> = {};
    let smsOptIn = false;

    for (const [fieldKey, value] of Object.entries(filterValues)) {
      if (!selectedFields.has(fieldKey)) continue;
      const field = enabledFields.find((f: any) => f.field_key === fieldKey);
      if (!field) continue;

      // sms_opt_in 별도 처리
      if (fieldKey === 'sms_opt_in' || fieldKey === 'opt_in_sms') {
        smsOptIn = value === 'true';
        continue;
      }

      // 연령 특수 처리
      if (fieldKey === 'age') {
        if (value.mode === 'preset' && value.presets?.length > 0) {
          const decades = value.presets.map(Number).sort((a: number, b: number) => a - b);
          const min = decades[0];
          const maxD = decades[decades.length - 1];
          if (maxD >= 60) {
            filters['age'] = min >= 60
              ? { operator: 'gte', value: 60 }
              : { operator: 'gte', value: min };
          } else {
            filters['age'] = { operator: 'between', value: [min, maxD + 9] };
          }
        } else if (value.mode === 'range') {
          if (value.min && value.max) {
            filters['age'] = { operator: 'between', value: [Number(value.min), Number(value.max)] };
          } else if (value.min) {
            filters['age'] = { operator: 'gte', value: Number(value.min) };
          } else if (value.max) {
            filters['age'] = { operator: 'lte', value: Number(value.max) };
          }
        }
        continue;
      }

      // 날짜 필드
      if (field.data_type === 'date') {
        if (!value) continue;
        const dbColMap: Record<string, string> = { 'last_purchase_date': 'recent_purchase_date' };
        const dbCol = dbColMap[fieldKey] || fieldKey;
        filters[dbCol] = { operator: 'days_within', value: parseInt(value) };
        continue;
      }

      // 다중선택 (배열)
      if (Array.isArray(value)) {
        if (value.length === 0) continue;
        if (value.length === 1) {
          filters[fieldKey] = { operator: 'eq', value: value[0] };
        } else {
          filters[fieldKey] = { operator: 'in', value };
        }
        continue;
      }

      if (!value && value !== false) continue;

      // 숫자
      if (field.data_type === 'number') {
        filters[fieldKey] = { operator: 'gte', value: Number(value) };
        continue;
      }

      // 불린
      if (field.data_type === 'boolean') {
        filters[fieldKey] = { operator: 'eq', value: value === 'true' };
        continue;
      }

      // 문자열 (옵션 없는 텍스트 → contains)
      if (field.data_type === 'string' && typeof value === 'string' && value.trim()) {
        filters[fieldKey] = { operator: 'contains', value: value.trim() };
        continue;
      }
    }

    return { dynamicFilters: filters, smsOptIn };
  };

  // 대상 인원 조회
  const loadTargetCount = async () => {
    setCountLoading(true);
    try {
      const token = localStorage.getItem('token');
      const { dynamicFilters, smsOptIn } = buildDynamicFiltersForAPI();
      const res = await fetch('/api/customers/filter-count', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ dynamicFilters, smsOptIn })
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        showAlert('조회 실패', errData.error || `서버 오류가 발생했습니다 (${res.status})`, 'error');
        return;
      }
      const data = await res.json();
      setTargetCount(data.count || 0);
    } catch (error) {
      console.error('카운트 조회 실패:', error);
      showAlert('네트워크 오류', '서버에 연결할 수 없습니다. 잠시 후 다시 시도해주세요.', 'error');
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
      const { dynamicFilters, smsOptIn } = buildDynamicFiltersForAPI();
      const res = await fetch('/api/customers/extract', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ dynamicFilters, smsOptIn, phoneField: 'phone' })
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        showAlert('타겟 추출 실패', errData.error || `서버 오류가 발생했습니다 (${res.status})`, 'error');
        return;
      }
      const data = await res.json();
      if (data.success && data.recipients) {
        onExtracted(data.recipients, data.count);
      } else {
        showAlert('타겟 추출 실패', data.error || '데이터를 추출하지 못했습니다. 조건을 확인해주세요.', 'warning');
      }
    } catch (error) {
      console.error('타겟 추출 실패:', error);
      showAlert('네트워크 오류', '서버에 연결할 수 없습니다. 잠시 후 다시 시도해주세요.', 'error');
    } finally {
      setExtracting(false);
    }
  };

  // 초기화
  const resetAll = () => {
    setSelectedFields(new Set());
    setFilterValues({});
    setTargetCount(0);
    // sms_opt_in 다시 기본 선택
    const smsField = enabledFields.find((f: any) =>
      f.field_key === 'sms_opt_in' || f.field_key === 'opt_in_sms'
    );
    if (smsField) {
      setSelectedFields(new Set([smsField.field_key]));
      setFilterValues({ [smsField.field_key]: 'true' });
    }
  };

  const handleClose = () => {
    resetAll();
    onClose();
  };

  // ============ 조건 입력 UI ============

  const renderCondition = (field: any) => {
    const fk = field.field_key;

    // 연령 특수 UI
    if (fk === 'age') {
      const age = filterValues.age || { mode: 'preset', presets: [] };
      const rangeText = getAgeRangeText();
      return (
        <div className="mt-1.5 space-y-2">
          <div className="flex items-center gap-1">
            <button onClick={() => setAgeMode('preset')}
              className={`px-2.5 py-1 text-xs rounded-md font-medium transition-all ${age.mode === 'preset' ? 'bg-green-600 text-white' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'}`}
            >연령대</button>
            <button onClick={() => setAgeMode('range')}
              className={`px-2.5 py-1 text-xs rounded-md font-medium transition-all ${age.mode === 'range' ? 'bg-green-600 text-white' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'}`}
            >직접입력</button>
            {rangeText && <span className="text-xs text-green-600 font-medium ml-1">→ {rangeText}</span>}
          </div>
          {age.mode === 'preset' && (
            <div className="flex flex-wrap gap-1.5">
              {AGE_PRESETS.map(p => {
                const sel = (age.presets || []).includes(p.value);
                return (
                  <button key={p.value} onClick={() => toggleAgePreset(p.value)}
                    className={`px-2.5 py-1 text-xs rounded-md font-medium transition-all ${sel ? 'bg-green-600 text-white shadow-sm' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
                  >{p.label}</button>
                );
              })}
            </div>
          )}
          {age.mode === 'range' && (
            <div className="flex items-center gap-1.5">
              <input type="number" value={age.min || ''} onChange={e => setAgeRange('min', e.target.value)}
                placeholder="최소" className="w-16 px-2 py-1 border border-gray-200 rounded-md text-sm text-center focus:ring-1 focus:ring-green-500 focus:border-green-500" />
              <span className="text-xs text-gray-400">~</span>
              <input type="number" value={age.max || ''} onChange={e => setAgeRange('max', e.target.value)}
                placeholder="최대" className="w-16 px-2 py-1 border border-gray-200 rounded-md text-sm text-center focus:ring-1 focus:ring-green-500 focus:border-green-500" />
              <span className="text-xs text-gray-400">세</span>
            </div>
          )}
        </div>
      );
    }

    // 불린 (토글)
    if (field.data_type === 'boolean') {
      const val = filterValues[fk] || 'true';
      return (
        <div className="flex gap-1 mt-1.5">
          <button onClick={() => setFilterValues(prev => ({ ...prev, [fk]: 'true' }))}
            className={`px-3 py-1 text-xs rounded-md font-medium transition-all ${val === 'true' ? 'bg-green-600 text-white' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'}`}
          >예</button>
          <button onClick={() => setFilterValues(prev => ({ ...prev, [fk]: 'false' }))}
            className={`px-3 py-1 text-xs rounded-md font-medium transition-all ${val === 'false' ? 'bg-green-600 text-white' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'}`}
          >아니오</button>
        </div>
      );
    }

    // 문자열 + 옵션 → 다중 태그
    if (field.data_type === 'string' && filterOptions[fk]?.length > 0) {
      const selected: string[] = Array.isArray(filterValues[fk]) ? filterValues[fk] : [];
      return (
        <div className="flex flex-wrap gap-1.5 mt-1.5">
          {filterOptions[fk].map((opt: string) => {
            const sel = selected.includes(opt);
            return (
              <button key={opt} onClick={() => toggleMultiOption(fk, opt)}
                className={`px-2.5 py-1 text-xs rounded-md font-medium transition-all ${sel ? 'bg-green-600 text-white shadow-sm' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
              >{opt}</button>
            );
          })}
        </div>
      );
    }

    // 금액 필드 → 프리셋 태그
    if (field.data_type === 'number' && isAmountField(fk)) {
      const val = filterValues[fk] || '';
      return (
        <div className="flex flex-wrap gap-1.5 mt-1.5">
          {AMOUNT_PRESETS.map(p => (
            <button key={p.value} onClick={() => setFilterValues(prev => ({ ...prev, [fk]: prev[fk] === p.value ? '' : p.value }))}
              className={`px-2.5 py-1 text-xs rounded-md font-medium transition-all ${val === p.value ? 'bg-green-600 text-white shadow-sm' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
            >{p.label}</button>
          ))}
        </div>
      );
    }

    // 포인트 → 프리셋 태그
    if (field.data_type === 'number' && fk === 'points') {
      const val = filterValues[fk] || '';
      return (
        <div className="flex flex-wrap gap-1.5 mt-1.5">
          {POINTS_PRESETS.map(p => (
            <button key={p.value} onClick={() => setFilterValues(prev => ({ ...prev, [fk]: prev[fk] === p.value ? '' : p.value }))}
              className={`px-2.5 py-1 text-xs rounded-md font-medium transition-all ${val === p.value ? 'bg-green-600 text-white shadow-sm' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
            >{p.label}</button>
          ))}
        </div>
      );
    }

    // 숫자 → 직접 입력
    if (field.data_type === 'number') {
      return (
        <input type="number" value={filterValues[fk] || ''} onChange={e => setFilterValues(prev => ({ ...prev, [fk]: e.target.value }))}
          placeholder="이상" className="mt-1.5 w-full px-2.5 py-1.5 border border-gray-200 rounded-md text-sm focus:ring-1 focus:ring-green-500 focus:border-green-500" />
      );
    }

    // 날짜 → 기간 프리셋 태그
    if (field.data_type === 'date') {
      const val = filterValues[fk] || '';
      return (
        <div className="flex flex-wrap gap-1.5 mt-1.5">
          {DAYS_PRESETS.map(p => (
            <button key={p.value} onClick={() => setFilterValues(prev => ({ ...prev, [fk]: prev[fk] === p.value ? '' : p.value }))}
              className={`px-2.5 py-1 text-xs rounded-md font-medium transition-all ${val === p.value ? 'bg-green-600 text-white shadow-sm' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
            >{p.label}</button>
          ))}
        </div>
      );
    }

    // 문자열 (옵션 없음) → 포함 검색
    return (
      <input type="text" value={filterValues[fk] || ''} onChange={e => setFilterValues(prev => ({ ...prev, [fk]: e.target.value }))}
        placeholder="포함하는 값 입력" className="mt-1.5 w-full px-2.5 py-1.5 border border-gray-200 rounded-md text-sm focus:ring-1 focus:ring-green-500 focus:border-green-500" />
    );
  };

  // ============ 필터 값 유무 ============

  const hasFilterValue = (fk: string) => {
    if (!selectedFields.has(fk)) return false;
    const val = filterValues[fk];
    if (val === undefined || val === null || val === '') return false;
    if (Array.isArray(val)) return val.length > 0;
    if (fk === 'age') {
      if (val.mode === 'preset') return (val.presets || []).length > 0;
      if (val.mode === 'range') return !!(val.min || val.max);
    }
    return true;
  };

  // ============ 렌더링 ============

  if (!show) return null;

  // 모든 필드 표시 (SKIP 없음 — Harold님 확정)
  const allFields = enabledFields;
  const activeFilterCount = allFields.filter((f: any) => hasFilterValue(f.field_key)).length;

  const categoryOrder = ['basic', 'purchase', 'store', 'membership', 'marketing', 'custom'];
  const usedCategories = [...new Set(allFields.map((f: any) => f.category))];
  const orderedCategories = categoryOrder.filter(c => usedCategories.includes(c));
  const extraCategories = usedCategories.filter(c => !categoryOrder.includes(c));
  const allCategories = [...orderedCategories, ...extraCategories];

  return (
    <>
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 animate-in fade-in duration-200">
      <div className="bg-white rounded-2xl shadow-2xl w-[720px] max-h-[95vh] overflow-hidden animate-in zoom-in-95 duration-200">
        {/* 헤더 */}
        <div className="px-5 py-3 border-b border-gray-100 flex justify-between items-center bg-gradient-to-r from-green-50 to-emerald-50">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 bg-green-100 rounded-xl flex items-center justify-center">
              <Filter className="w-5 h-5 text-green-600" />
            </div>
            <div>
              <h3 className="text-base font-bold text-gray-800">직접 타겟 설정</h3>
              <p className="text-xs text-gray-500">필터할 항목을 선택하고 조건을 설정하세요</p>
            </div>
          </div>
          <button onClick={handleClose}
            className="w-7 h-7 flex items-center justify-center rounded-full hover:bg-white/80 transition-colors text-gray-400 hover:text-gray-600">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* 필터 영역 */}
        <div className="p-4 space-y-3 overflow-y-auto max-h-[68vh]">
          {/* 헤더 바 */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold text-gray-700">필터 조건</span>
              {activeFilterCount > 0 && (
                <span className="px-2 py-0.5 bg-green-100 text-green-700 text-xs rounded-full font-bold">
                  {activeFilterCount}개 설정
                </span>
              )}
            </div>
            <button onClick={resetAll} className="flex items-center gap-1 text-xs text-green-600 hover:text-green-700 font-medium transition-colors">
              <RotateCcw className="w-3 h-3" />
              초기화
            </button>
          </div>

          {/* 로딩/빈 */}
          {!fieldsLoaded ? (
            <div className="text-center py-6 text-gray-400 text-sm">
              <div className="inline-block w-5 h-5 border-2 border-gray-300 border-t-green-500 rounded-full animate-spin mb-2" />
              <div>필드 로딩 중...</div>
            </div>
          ) : allFields.length === 0 ? (
            <div className="text-center py-6 text-gray-400 text-sm">
              고객 데이터를 먼저 업로드해주세요
            </div>
          ) : (
            /* 카테고리 아코디언 */
            <div className="space-y-2">
              {allCategories.map(cat => {
                const catFields = allFields.filter((f: any) => f.category === cat);
                if (catFields.length === 0) return null;

                const label = `${CAT_ICONS[cat] || '📌'} ${categoryLabels[cat] || cat}`;
                const selectedInCat = catFields.filter((f: any) => hasFilterValue(f.field_key)).length;
                const isExpanded = expandedCats[cat] ?? false;

                return (
                  <div key={cat} className="border border-gray-200 rounded-xl overflow-hidden">
                    <button type="button"
                      onClick={() => setExpandedCats(prev => ({ ...prev, [cat]: !prev[cat] }))}
                      className="w-full px-3.5 py-2.5 flex items-center justify-between bg-gray-50 hover:bg-gray-100 transition-colors">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-gray-700">{label}</span>
                        <span className="text-xs text-gray-400">({catFields.length})</span>
                        {selectedInCat > 0 && (
                          <span className="px-1.5 py-0.5 bg-green-600 text-white text-xs rounded-full font-bold min-w-[18px] text-center">{selectedInCat}</span>
                        )}
                      </div>
                      <svg className={`w-4 h-4 text-gray-400 transition-transform duration-200 ${isExpanded ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                      </svg>
                    </button>

                    {/* 2열 그리드 */}
                    {isExpanded && (
                      <div className="p-3 bg-white border-t border-gray-100 grid grid-cols-2 gap-2">
                        {catFields.map((field: any) => {
                          const fk = field.field_key;
                          const isSelected = selectedFields.has(fk);
                          const hasValue = hasFilterValue(fk);

                          return (
                            <div key={fk}
                              className={`rounded-lg transition-all duration-150 ${isSelected ? 'bg-green-50/80 border border-green-200 p-2.5' : 'border border-transparent p-2.5 hover:bg-gray-50'}`}>
                              <label className="flex items-center gap-2 cursor-pointer">
                                <input type="checkbox" checked={isSelected} onChange={() => toggleField(fk)}
                                  className="w-3.5 h-3.5 text-green-600 rounded focus:ring-green-500 border-gray-300 cursor-pointer" />
                                <span className={`text-xs font-medium ${isSelected ? 'text-green-700' : 'text-gray-600'}`}>
                                  {field.display_name}
                                </span>
                                {hasValue && (
                                  <span className="ml-auto text-[10px] bg-green-600 text-white px-1.5 py-0.5 rounded font-medium">설정</span>
                                )}
                              </label>
                              {isSelected && renderCondition(field)}
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

          {/* 조회 버튼 */}
          <button onClick={loadTargetCount} disabled={countLoading}
            className="w-full py-2.5 border-2 border-green-600 text-green-700 rounded-xl hover:bg-green-50 transition-all font-semibold disabled:opacity-50 flex items-center justify-center gap-2 text-sm">
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

        {/* 푸터 */}
        <div className="px-5 py-3 border-t border-gray-100 bg-gradient-to-r from-gray-50 to-green-50/30">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 bg-green-100 rounded-full flex items-center justify-center">
                <Users className="w-4 h-4 text-green-600" />
              </div>
              <div>
                <div className="text-xs text-gray-500">대상 인원</div>
                <div className="text-xl font-bold text-green-700">
                  {countLoading ? '...' : targetCount.toLocaleString()}
                  <span className="text-sm font-normal text-gray-500 ml-1">명</span>
                </div>
              </div>
            </div>
            <div className="flex gap-2">
              <button onClick={handleClose}
                className="px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-100 transition-colors font-medium text-sm">
                취소
              </button>
              <button onClick={handleExtract} disabled={targetCount === 0 || extracting}
                className="px-5 py-2 bg-green-700 text-white rounded-lg hover:bg-green-800 transition-colors font-medium flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed text-sm">
                {extracting ? (
                  <>
                    <div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    추출 중...
                  </>
                ) : (
                  <>
                    <Users className="w-3.5 h-3.5" />
                    타겟 추출
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>

    {/* 커스텀 알림 모달 */}
    {alertModal.show && (
      <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-[60] animate-in fade-in duration-150">
        <div className="bg-white rounded-2xl shadow-2xl max-w-sm w-full mx-4 animate-in zoom-in-95 duration-200 overflow-hidden">
          <div className="p-6 text-center">
            <div className={`w-12 h-12 mx-auto mb-3 rounded-full flex items-center justify-center ${
              alertModal.type === 'error' ? 'bg-red-100' : alertModal.type === 'warning' ? 'bg-amber-100' : 'bg-blue-100'
            }`}>
              {alertModal.type === 'error' ? (
                <svg className="w-6 h-6 text-red-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              ) : alertModal.type === 'warning' ? (
                <svg className="w-6 h-6 text-amber-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.732 16.5c-.77.833.192 2.5 1.732 2.5z" />
                </svg>
              ) : (
                <svg className="w-6 h-6 text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              )}
            </div>
            <h4 className="text-base font-bold text-gray-800 mb-1.5">{alertModal.title}</h4>
            <p className="text-sm text-gray-500 leading-relaxed">{alertModal.message}</p>
          </div>
          <div className="px-6 pb-5">
            <button
              onClick={() => setAlertModal(prev => ({ ...prev, show: false }))}
              className={`w-full py-2.5 rounded-xl font-semibold text-sm transition-colors ${
                alertModal.type === 'error' ? 'bg-red-600 hover:bg-red-700 text-white'
                : alertModal.type === 'warning' ? 'bg-amber-500 hover:bg-amber-600 text-white'
                : 'bg-blue-600 hover:bg-blue-700 text-white'
              }`}
            >확인</button>
          </div>
        </div>
      </div>
    )}
    </>
  );
}
