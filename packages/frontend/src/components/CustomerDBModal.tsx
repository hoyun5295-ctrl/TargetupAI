import { useEffect, useState } from 'react';
import { formatDate } from '../utils/formatDate';

interface CustomerDBModalProps {
  onClose: () => void;
  token: string | null;
  userType?: 'super_admin' | 'company_admin' | 'company_user';
}

export default function CustomerDBModal({ onClose, token, userType }: CustomerDBModalProps) {
  const [customers, setCustomers] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const limit = 20;

  // ★ 동적 필터 (필드 드롭다운 + 값/범위)
  const [dynFilterField, setDynFilterField] = useState('');
  const [dynFilterOp, setDynFilterOp] = useState('contains');
  const [dynFilterValue, setDynFilterValue] = useState('');
  const [dynFilterValueMax, setDynFilterValueMax] = useState('');
  const [activeFilters, setActiveFilters] = useState<{ field: string; label: string; op: string; value: string; valueMax?: string }[]>([]);
  const [filterSmsOptIn, setFilterSmsOptIn] = useState('all');
  const [filterStoreCode, setFilterStoreCode] = useState('all');

  // 필터 옵션 (API에서 가져옴)
  const [storeCodeOptions, setStoreCodeOptions] = useState<string[]>([]);
  const [filterOptions, setFilterOptions] = useState<Record<string, string[]>>({});

  // 상세보기
  const [selectedCustomer, setSelectedCustomer] = useState<any>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  // 동적 컬럼 (field_definitions 기반)
  const [fieldColumns, setFieldColumns] = useState<any[]>([]);

  useEffect(() => {
    fetchEnabledFieldsAndOptions();
    fetchCustomers(1);
  }, []);

  // ★ D88: enabled-fields 하나로 통합 — 필드 정의 + 필터 옵션 + 브랜드 코드를 한 번에 가져옴
  // 기존 fetchFieldDefinitions + fetchFilterOptions 2개 API 호출 → 1개로 통합
  const fetchEnabledFieldsAndOptions = async () => {
    try {
      // 1. enabled-fields API — 필드 + 옵션 + 카테고리 전부 반환
      const res = await fetch('/api/customers/enabled-fields', { headers: { Authorization: `Bearer ${token}` } });
      const data = await res.json();
      setFieldColumns(data.fields || []);

      // ★ D88: enabled-fields가 반환하는 options를 filterOptions에 직접 병합
      // 커스텀 필드(VIP행사참석 등)의 DISTINCT 값도 여기서 자동으로 가져옴
      const opts: Record<string, string[]> = {};
      if (data.options) {
        for (const [key, values] of Object.entries(data.options)) {
          if (Array.isArray(values) && values.length > 0) {
            opts[key] = values as string[];
          }
        }
      }

      // ★ D88: boolean 필드(sms_opt_in 등)는 자동으로 동의/거부 옵션 생성
      for (const f of (data.fields || [])) {
        if (f.data_type === 'boolean' && !opts[f.field_key]) {
          opts[f.field_key] = ['동의', '거부'];
        }
      }

      setFilterOptions(opts);

      // 2. 브랜드 코드는 filter-options에서 가져옴 (enabled-fields에는 미포함)
      try {
        const foRes = await fetch('/api/customers/filter-options', { headers: { Authorization: `Bearer ${token}` } });
        const foData = await foRes.json();
        setStoreCodeOptions(foData.store_codes || []);
      } catch (e) {
        console.error('브랜드 코드 조회 에러:', e);
      }
    } catch (error) {
      console.error('필드/옵션 조회 에러:', error);
    }
  };

  const fetchCustomers = async (p: number, overrides?: { smsOptIn?: string; storeCode?: string; filtersOverride?: typeof activeFilters }) => {
    setLoading(true);
    setSelectedCustomer(null);
    try {
      const currentSmsOptIn = overrides?.smsOptIn ?? filterSmsOptIn;
      const currentStoreCode = overrides?.storeCode ?? filterStoreCode;
      const currentFilters = overrides?.filtersOverride ?? activeFilters;

      const params = new URLSearchParams({ page: String(p), limit: String(limit) });
      if (currentSmsOptIn === 'true') params.set('smsOptIn', 'true');
      if (currentSmsOptIn === 'false') params.set('smsOptIn', 'false');
      // ★ 브랜드 필터 (고객사관리자/슈퍼관리자만)
      if (currentStoreCode !== 'all') params.set('filterStoreCode', currentStoreCode);

      // ★ D79: activeFilters → filters JSON 변환 (buildDynamicFilterCompat structured 형식)
      if (currentFilters.length > 0) {
        const filtersObj: Record<string, any> = {};
        for (const af of currentFilters) {
          if (af.op === 'between' && af.valueMax) {
            filtersObj[af.field] = { operator: 'between', value: [af.value, af.valueMax] };
          } else {
            filtersObj[af.field] = { operator: af.op, value: af.value };
          }
        }
        params.set('filters', JSON.stringify(filtersObj));
      }

      const res = await fetch(`/api/customers?${params}`, { headers: { Authorization: `Bearer ${token}` } });
      const data = await res.json();
      setCustomers(data.customers || []);
      setTotal(data.pagination?.total || 0);
      setPage(p);
    } catch (error) {
      console.error('고객 조회 에러:', error);
    } finally {
      setLoading(false);
    }
  };

  const fetchDetail = async (customerId: number) => {
    setDetailLoading(true);
    try {
      const res = await fetch(`/api/customers/${customerId}`, { headers: { Authorization: `Bearer ${token}` } });
      const data = await res.json();
      setSelectedCustomer(data.customer || null);
    } catch (error) {
      console.error('고객 상세 조회 에러:', error);
    } finally {
      setDetailLoading(false);
    }
  };

  // ★ 동적 필터 추가 — 드롭다운 선택은 eq, 문자열은 contains, 숫자/날짜는 연산자 선택
  const handleAddFilter = () => {
    if (!dynFilterField || !dynFilterValue) return;
    const fieldDef = fieldColumns.find((f: any) => f.field_key === dynFilterField);
    const label = fieldDef?.field_label || fieldDef?.display_name || dynFilterField;
    const dataType = getFieldDataType(dynFilterField);

    // ★ D88: boolean 필드(sms_opt_in) — "동의"/"거부"를 실제 DB 값으로 변환
    let effectiveValue = dynFilterValue;
    if (dataType === 'boolean') {
      effectiveValue = dynFilterValue === '동의' ? 'true' : dynFilterValue === '거부' ? 'false' : dynFilterValue;
    }

    // 드롭다운 옵션에서 선택한 경우(등급, 지역, 커스텀 필드 등)는 eq, 그 외 문자열은 contains
    const effectiveOp = hasDropdownOptions(dynFilterField) ? 'eq' : dynFilterOp;
    const newFilter = { field: dynFilterField, label, op: effectiveOp, value: effectiveValue, valueMax: effectiveOp === 'between' ? dynFilterValueMax : undefined };
    const updated = [...activeFilters.filter(f => f.field !== dynFilterField), newFilter];
    setActiveFilters(updated);
    setDynFilterField('');
    setDynFilterOp('contains');
    setDynFilterValue('');
    setDynFilterValueMax('');
    setPage(1);
    fetchCustomers(1, { filtersOverride: updated });
  };

  // ★ D79: 활성 필터 제거
  const handleRemoveFilter = (field: string) => {
    const updated = activeFilters.filter(f => f.field !== field);
    setActiveFilters(updated);
    setPage(1);
    fetchCustomers(1, { filtersOverride: updated });
  };

  // ★ D79: 수신동의 / 브랜드 필터 변경
  const handleSpecialFilterChange = (key: string, value: string) => {
    const overrides: any = {};
    if (key === 'smsOptIn') { setFilterSmsOptIn(value); overrides.smsOptIn = value; }
    if (key === 'storeCode') { setFilterStoreCode(value); overrides.storeCode = value; }
    setPage(1);
    fetchCustomers(1, overrides);
  };

  const handleReset = () => {
    setActiveFilters([]);
    setFilterSmsOptIn('all');
    setFilterStoreCode('all');
    setDynFilterField('');
    setDynFilterOp('contains');
    setDynFilterValue('');
    setDynFilterValueMax('');
    setPage(1);
    fetchCustomers(1, { smsOptIn: 'all', storeCode: 'all', filtersOverride: [] });
  };

  // ★ 필드 데이터 타입 판별
  const getFieldDataType = (fieldKey: string): string => {
    const fieldDef = fieldColumns.find((f: any) => f.field_key === fieldKey);
    return (fieldDef?.data_type || fieldDef?.field_type || 'text').toLowerCase();
  };

  // 숫자/날짜 필드에만 연산자 드롭다운 표시 (문자열은 자동 포함검색)
  const getOperatorsForField = (fieldKey: string) => {
    const dataType = getFieldDataType(fieldKey);
    if (['number', 'integer', 'float', 'numeric'].includes(dataType)) {
      return [
        { v: 'gte', l: '이상' }, { v: 'lte', l: '이하' }, { v: 'eq', l: '일치' }, { v: 'between', l: '범위' },
      ];
    }
    if (['date', 'datetime', 'timestamp'].includes(dataType)) {
      return [
        { v: 'gte', l: '이후' }, { v: 'lte', l: '이전' }, { v: 'between', l: '범위' },
      ];
    }
    return []; // 문자열 → 연산자 드롭다운 없음 (자동 contains)
  };

  // 숫자/날짜 필드인지 확인
  const isNumericOrDateField = (fieldKey: string): boolean => {
    const dataType = getFieldDataType(fieldKey);
    return ['number', 'integer', 'float', 'numeric', 'date', 'datetime', 'timestamp'].includes(dataType);
  };

  // ★ D83: 날짜 필드인지 확인 (date picker 적용용)
  const isDateField = (fieldKey: string): boolean => {
    const dataType = getFieldDataType(fieldKey);
    return ['date', 'datetime', 'timestamp'].includes(dataType);
  };

  // ★ D79+D92: 필드에 대한 드롭다운 옵션 존재 여부 (등급, 지역 등 distinct values)
  // ★ D92: 숫자/날짜 타입 필드는 이상/이하/범위 연산자 우선 → 드롭다운 표시하지 않음
  const hasDropdownOptions = (fieldKey: string) => {
    if (!filterOptions[fieldKey] || filterOptions[fieldKey].length === 0) return false;
    const dataType = getFieldDataType(fieldKey);
    if (['number', 'integer', 'float', 'numeric', 'date', 'datetime', 'timestamp'].includes(dataType)) return false;
    return true;
  };

  const formatPhone = (phone: string) => {
    if (!phone) return '-';
    const cleaned = phone.replace(/\D/g, '');
    if (cleaned.length === 11) return `${cleaned.slice(0, 3)}-${cleaned.slice(3, 7)}-${cleaned.slice(7)}`;
    if (cleaned.length === 10) return `${cleaned.slice(0, 3)}-${cleaned.slice(3, 6)}-${cleaned.slice(6)}`;
    return phone;
  };

  const totalPages = Math.ceil(total / limit);

  // 상세보기 필드 (기본 + field_definitions 동적 확장)
  const baseDetailFields: { key: string; label: string; format?: (v: any) => string }[] = [
    { key: 'name', label: '이름' },
    { key: 'phone', label: '전화번호', format: formatPhone },
    { key: 'gender', label: '성별', format: (v) => v === 'M' || v === '남' ? '남성' : v === 'F' || v === '여' ? '여성' : v || '-' },
    { key: 'age', label: '나이 (생년월일 기준 자동계산)', format: (v) => v ? `${v}세` : '-' },
    { key: 'birth_date', label: '생년월일', format: (v) => formatDate(v) },
    { key: 'email', label: '이메일' },
    { key: 'address', label: '주소' },
    { key: 'grade', label: '등급' },
    { key: 'region', label: '지역' },
    { key: 'store_name', label: '매장명' },
    { key: 'store_code', label: '매장코드' },
    { key: 'registered_store', label: '등록매장' },
    { key: 'recent_purchase_store', label: '최근구매매장' },
    { key: 'store_phone', label: '매장전화번호', format: formatPhone },
    { key: 'registration_type', label: '등록구분' },
    { key: 'points', label: '포인트', format: (v) => v != null ? Number(v).toLocaleString() : '-' },
    { key: 'recent_purchase_amount', label: '최근구매금액', format: (v) => v != null ? `${Number(v).toLocaleString()}원` : '-' },
    { key: 'total_purchase_amount', label: '총구매금액', format: (v) => v != null ? `${Number(v).toLocaleString()}원` : '-' },
    { key: 'purchase_count', label: '구매횟수', format: (v) => v != null ? `${Number(v).toLocaleString()}회` : '-' },
    { key: 'recent_purchase_date', label: '최근구매일', format: (v) => formatDate(v) },
    { key: 'sms_opt_in', label: '수신동의', format: (v) => v === true || v === 'Y' ? '동의' : '거부' },
    { key: 'created_at', label: '등록일', format: (v) => formatDate(v) },
  ];
  // field_definitions에 있지만 baseDetailFields에 없는 커스텀 필드 추가
  const baseKeys = new Set(baseDetailFields.map(f => f.key));
  const extraDetailFields = fieldColumns
    .filter(f => f.is_custom && !baseKeys.has(f.field_key))
    .map(f => ({ key: f.field_key, label: f.field_label || f.display_name || f.field_key, format: undefined as ((v: any) => string) | undefined }));
  const detailFields = [...baseDetailFields, ...extraDetailFields];

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[50]">
      <div className="bg-white rounded-xl shadow-2xl w-[1100px] max-h-[88vh] overflow-hidden flex flex-col">

        {/* 헤더 */}
        <div className="flex justify-between items-center px-6 py-4 border-b bg-gray-50">
          <div>
            <h3 className="text-lg font-bold text-gray-800">고객 DB 조회</h3>
            <span className="text-sm text-gray-500">총 {total.toLocaleString()}명</span>
          </div>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-gray-200 text-gray-400 hover:text-gray-600 transition-colors text-lg">&times;</button>
        </div>

        {/* 필터 (한 줄 통합) */}
        <div className="px-6 py-3 border-b space-y-2">
          <div className="flex items-center gap-2 text-sm flex-wrap">
            {/* 필드 선택 */}
            <select value={dynFilterField} onChange={(e) => {
              const newField = e.target.value;
              setDynFilterField(newField);
              setDynFilterValue('');
              setDynFilterValueMax('');
              // 숫자/날짜 필드면 첫 번째 연산자, 문자열이면 contains
              if (newField) {
                const ops = getOperatorsForField(newField);
                setDynFilterOp(ops.length > 0 ? ops[0].v : 'contains');
              } else {
                setDynFilterOp('contains');
              }
            }}
              className="border border-gray-300 rounded-lg px-2 py-1.5 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-emerald-200 min-w-[120px]">
              <option value="">필터 필드 선택</option>
              {/* ★ D88: sms_opt_in은 전용 필터 버튼이 있으므로 중복 제외 */}
              {fieldColumns.filter((f: any) => f.field_key !== 'sms_opt_in').map((f: any) => (
                <option key={f.field_key} value={f.field_key}>{f.field_label || f.display_name || f.field_key}</option>
              ))}
            </select>

            {/* 연산자 드롭다운 — 숫자/날짜 필드만 표시 (문자열은 자동 포함검색) */}
            {dynFilterField && isNumericOrDateField(dynFilterField) && (
              <select value={dynFilterOp} onChange={(e) => setDynFilterOp(e.target.value)}
                className="border border-gray-300 rounded-lg px-2 py-1.5 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-emerald-200">
                {getOperatorsForField(dynFilterField).map(op => (
                  <option key={op.v} value={op.v}>{op.l}</option>
                ))}
              </select>
            )}

            {/* 값 입력 */}
            {dynFilterField && (
              hasDropdownOptions(dynFilterField) ? (
                <select value={dynFilterValue} onChange={(e) => setDynFilterValue(e.target.value)}
                  className="border border-gray-300 rounded-lg px-2 py-1.5 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-emerald-200 min-w-[100px]">
                  <option value="">선택</option>
                  {filterOptions[dynFilterField].map(v => <option key={v} value={v}>{v}</option>)}
                </select>
              ) : (
                <input type={isDateField(dynFilterField) ? 'date' : 'text'}
                  value={dynFilterValue} onChange={(e) => setDynFilterValue(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') handleAddFilter(); }}
                  placeholder={isDateField(dynFilterField) ? '' : isNumericOrDateField(dynFilterField) ? '값 입력' : '검색어 입력'}
                  className="border border-gray-300 rounded-lg px-2 py-1.5 text-xs w-36 focus:outline-none focus:ring-2 focus:ring-emerald-200" />
              )
            )}

            {/* 범위(between) 최대값 */}
            {dynFilterField && dynFilterOp === 'between' && (
              <>
                <span className="text-gray-400 text-xs">~</span>
                <input type={isDateField(dynFilterField) ? 'date' : 'text'}
                  value={dynFilterValueMax} onChange={(e) => setDynFilterValueMax(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') handleAddFilter(); }}
                  placeholder={isDateField(dynFilterField) ? '' : '최대값'}
                  className="border border-gray-300 rounded-lg px-2 py-1.5 text-xs w-28 focus:outline-none focus:ring-2 focus:ring-emerald-200" />
              </>
            )}

            {/* 검색 버튼 */}
            {dynFilterField && dynFilterValue && (
              <button onClick={handleAddFilter}
                className="px-4 py-1.5 bg-emerald-500 text-white rounded-lg text-xs font-medium hover:bg-emerald-600 transition-colors">
                검색
              </button>
            )}

            <div className="w-px h-5 bg-gray-200" />

            {/* 수신동의 */}
            <span className="text-gray-500 font-medium text-xs">수신</span>
            {[{ v: 'all', l: '전체' }, { v: 'true', l: '동의' }, { v: 'false', l: '거부' }].map(opt => (
              <button key={opt.v} onClick={() => handleSpecialFilterChange('smsOptIn', opt.v)}
                className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${filterSmsOptIn === opt.v ? 'bg-emerald-100 text-emerald-700 border border-emerald-300' : 'bg-white border border-gray-200 text-gray-500 hover:bg-gray-50'}`}>
                {opt.l}
              </button>
            ))}

            {/* 브랜드 */}
            {(userType === 'company_admin' || userType === 'super_admin') && storeCodeOptions.length > 0 && (
              <>
                <div className="w-px h-5 bg-gray-200" />
                <span className="text-gray-500 font-medium text-xs">브랜드</span>
                <select value={filterStoreCode} onChange={(e) => handleSpecialFilterChange('storeCode', e.target.value)}
                  className="border border-gray-300 rounded-lg px-2 py-1 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-emerald-200">
                  <option value="all">전체</option>
                  {storeCodeOptions.map(sc => <option key={sc} value={sc}>{sc}</option>)}
                </select>
              </>
            )}

            {/* 초기화 */}
            {(activeFilters.length > 0 || filterSmsOptIn !== 'all' || filterStoreCode !== 'all') && (
              <>
                <div className="w-px h-5 bg-gray-200" />
                <button onClick={handleReset} className="px-3 py-1 bg-white border border-gray-300 rounded-lg text-xs text-gray-500 hover:bg-gray-50 transition-colors">초기화</button>
              </>
            )}
          </div>

          {/* ★ D79: 활성 필터 태그 표시 */}
          {activeFilters.length > 0 && (
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="text-xs text-gray-400">적용 필터:</span>
              {activeFilters.map(af => {
                const opLabel = af.op === 'contains' ? '포함' : af.op === 'eq' ? '=' : af.op === 'gte' ? '이상' : af.op === 'lte' ? '이하' : af.op === 'between' ? '~' : af.op;
                const valueDisplay = af.op === 'between' && af.valueMax ? `${af.value} ~ ${af.valueMax}` : af.value;
                return (
                  <span key={af.field} className="inline-flex items-center gap-1 px-2 py-0.5 bg-emerald-50 text-emerald-700 rounded-full text-xs border border-emerald-200">
                    {af.label} {opLabel} {valueDisplay}
                    <button onClick={() => handleRemoveFilter(af.field)} className="ml-0.5 text-emerald-400 hover:text-emerald-600">&times;</button>
                  </span>
                );
              })}
            </div>
          )}
        </div>

        {/* 테이블 + 상세 패널 */}
        <div className="flex-1 overflow-hidden flex">
          {/* 테이블 영역 */}
          <div className={`overflow-auto transition-all ${selectedCustomer ? 'flex-[65]' : 'flex-1'}`}>
            <table className="w-full text-sm" style={{ minWidth: `${Math.max(700, 100 + fieldColumns.length * 120)}px` }}>
              <thead className="bg-gray-50 sticky top-0 z-10">
                <tr>
                  <th className="px-3 py-2.5 text-center text-xs font-semibold text-gray-500 w-12 whitespace-nowrap">#</th>
                  <th className="px-3 py-2.5 text-left text-xs font-semibold text-gray-500 whitespace-nowrap">이름</th>
                  <th className="px-3 py-2.5 text-left text-xs font-semibold text-gray-500 whitespace-nowrap">전화번호</th>
                  {fieldColumns.filter(f => !['name', 'phone'].includes(f.field_key)).map(f => (
                    <th key={f.field_key} className="px-3 py-2.5 text-center text-xs font-semibold text-gray-500 whitespace-nowrap">
                      {f.field_label || f.display_name || f.field_key}
                    </th>
                  ))}
                  <th className="px-3 py-2.5 text-center text-xs font-semibold text-gray-500 whitespace-nowrap">수신</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={3 + fieldColumns.filter(f => !['name', 'phone'].includes(f.field_key)).length + 1} className="py-16 text-center text-gray-400">조회 중...</td></tr>
                ) : customers.length === 0 ? (
                  <tr><td colSpan={3 + fieldColumns.filter(f => !['name', 'phone'].includes(f.field_key)).length + 1} className="py-16 text-center text-gray-400">
                    {activeFilters.length > 0 ? '검색 결과가 없습니다.' : '고객 데이터가 없습니다.'}
                  </td></tr>
                ) : (
                  customers.map((c: any, idx: number) => (
                    <tr key={c.id}
                      onClick={() => fetchDetail(c.id)}
                      className={`border-t cursor-pointer transition-colors ${selectedCustomer?.id === c.id ? 'bg-emerald-50' : 'hover:bg-gray-50'}`}>
                      <td className="px-3 py-2.5 text-center text-xs text-gray-400">{(page - 1) * limit + idx + 1}</td>
                      <td className="px-3 py-2.5 text-sm font-medium text-gray-800 whitespace-nowrap">{c.name || '-'}</td>
                      <td className="px-3 py-2.5 font-mono text-xs text-gray-600 whitespace-nowrap">{formatPhone(c.phone)}</td>
                      {fieldColumns.filter(f => !['name', 'phone'].includes(f.field_key)).map(f => {
                        const val = f.is_custom ? c.custom_fields?.[f.field_key] : c[f.field_key];
                        let display: string;
                        if (f.field_key === 'gender') {
                          display = val === 'M' || val === '남' || val === '남성' ? '남' : val === 'F' || val === '여' || val === '여성' ? '여' : val || '-';
                        } else if (f.field_key === 'birth_date' || f.field_key === 'recent_purchase_date' || f.field_key === 'created_at' || f.field_key === 'wedding_anniversary' || (f.field_type && f.field_type.toUpperCase() === 'DATE')) {
                          // ★ D89: field_type 대소문자 무관 + formatDate 개선으로 하루 밀림 방지
                          display = val ? formatDate(String(val)) : '-';
                        } else if (f.field_key === 'total_purchase_amount' || f.field_key === 'recent_purchase_amount' || f.field_key === 'avg_order_value' || f.field_key === 'points' || f.field_key === 'purchase_count') {
                          // ★ D89: points/purchase_count 등 숫자 직접 컬럼 쉼표 포맷팅
                          display = val != null ? `${Number(val).toLocaleString()}` : '-';
                        } else if (f.field_type === 'NUMBER' && val != null) {
                          // ★ D89: 커스텀 숫자 필드도 자동 쉼표 포맷팅
                          display = `${Number(val).toLocaleString()}`;
                        } else if (f.field_key === 'grade') {
                          return (
                            <td key={f.field_key} className="px-3 py-2.5 text-center whitespace-nowrap">
                              {val ? (
                                <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${
                                  String(val).toUpperCase() === 'VIP' ? 'bg-amber-50 text-amber-700' :
                                  String(val).toUpperCase() === 'VVIP' ? 'bg-purple-50 text-purple-700' :
                                  'bg-gray-100 text-gray-600'
                                }`}>{val}</span>
                              ) : '-'}
                            </td>
                          );
                        } else {
                          display = val != null ? String(val) : '-';
                        }
                        return <td key={f.field_key} className="px-3 py-2.5 text-center text-xs text-gray-600 whitespace-nowrap">{display}</td>;
                      })}
                      <td className="px-3 py-2.5 text-center whitespace-nowrap">
                        <span className={`inline-block w-2 h-2 rounded-full ${c.sms_opt_in ? 'bg-green-400' : 'bg-gray-300'}`} />
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {/* 상세 패널 (우측 슬라이드) */}
          {selectedCustomer && (
            <div className="flex-[35] border-l bg-gray-50 overflow-y-auto p-5">
              <div className="flex justify-between items-start mb-4">
                <div>
                  <div className="text-lg font-bold text-gray-800">{selectedCustomer.name || '-'}</div>
                  {selectedCustomer.grade && (
                    <span className={`inline-block mt-1 px-2.5 py-0.5 rounded-full text-xs font-medium ${
                      selectedCustomer.grade === 'VIP' ? 'bg-amber-100 text-amber-700' :
                      selectedCustomer.grade === 'VVIP' ? 'bg-purple-100 text-purple-700' :
                      'bg-gray-200 text-gray-600'
                    }`}>{selectedCustomer.grade}</span>
                  )}
                </div>
                <button onClick={() => setSelectedCustomer(null)} className="w-7 h-7 flex items-center justify-center rounded-full hover:bg-gray-200 text-gray-400 hover:text-gray-600 text-sm">&times;</button>
              </div>

              {detailLoading ? (
                <div className="text-center text-gray-400 py-10">불러오는 중...</div>
              ) : (
                <div className="space-y-0">
                  {detailFields.map(field => {
                    const value = selectedCustomer[field.key];
                    if (value == null && field.key !== 'sms_opt_in') return null;
                    const display = field.format ? field.format(value) : (value || '-');
                    if (display === '-' && field.key !== 'sms_opt_in' && field.key !== 'name') return null;
                    return (
                      <div key={field.key} className="flex items-center py-2.5 border-b border-gray-100">
                        <span className="w-24 flex-shrink-0 text-xs text-gray-400">{field.label}</span>
                        <span className="text-sm text-gray-800 font-medium">{display}</span>
                      </div>
                    );
                  })}

                  {/* custom_fields 표시 */}
                  {selectedCustomer.custom_fields && Object.keys(selectedCustomer.custom_fields).length > 0 && (
                    <>
                      <div className="text-xs text-gray-400 font-medium mt-4 mb-2">추가 정보</div>
                      {Object.entries(selectedCustomer.custom_fields).map(([key, value]) => {
                        // fieldColumns에서 커스텀 필드 라벨 조회 (custom_1 → 사용자 정의 라벨)
                        const fieldDef = fieldColumns && fieldColumns.length > 0
                          ? fieldColumns.find((f: any) => f.field_key === key)
                          : null;
                        const displayLabel = fieldDef?.field_label || fieldDef?.display_name || key;
                        // ★ D89: 커스텀 숫자 필드 쉼표 포맷팅
                        const isNumericField = fieldDef?.field_type === 'NUMBER';
                        const displayValue = value != null
                          ? (isNumericField && !isNaN(Number(value)) ? Number(value).toLocaleString() : String(value))
                          : '-';
                        return (
                          <div key={key} className="flex items-center py-2.5 border-b border-gray-100">
                            <span className="w-24 flex-shrink-0 text-xs text-gray-400">{displayLabel}</span>
                            <span className="text-sm text-gray-800 font-medium">{displayValue}</span>
                          </div>
                        );
                      })}
                    </>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {/* 페이지네이션 */}
        {totalPages > 0 && (
          <div className="flex items-center justify-center gap-1.5 py-3 border-t bg-gray-50">
            <button
              onClick={() => { const p = Math.max(1, page - 1); setPage(p); fetchCustomers(p); }}
              disabled={page <= 1}
              className="px-3 py-1 text-sm rounded-md border bg-white hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
              이전
            </button>
            {Array.from({ length: Math.min(totalPages, 10) }, (_, i) => {
              let start = Math.max(1, page - 4);
              if (start + 9 > totalPages) start = Math.max(1, totalPages - 9);
              return start + i;
            }).filter(p => p <= totalPages).map(p => (
              <button key={p} onClick={() => { setPage(p); fetchCustomers(p); }}
                className={`w-8 h-8 text-sm rounded-md border transition-colors ${page === p ? 'bg-emerald-500 text-white border-emerald-500' : 'bg-white hover:bg-gray-50'}`}>
                {p}
              </button>
            ))}
            <button
              onClick={() => { const p = Math.min(totalPages, page + 1); setPage(p); fetchCustomers(p); }}
              disabled={page >= totalPages}
              className="px-3 py-1 text-sm rounded-md border bg-white hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
              다음
            </button>
            <span className="text-xs text-gray-400 ml-2">{page} / {totalPages} 페이지</span>
          </div>
        )}
      </div>
    </div>
  );
}
