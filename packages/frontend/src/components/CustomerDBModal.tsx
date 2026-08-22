/**
 * CustomerDBModal — 고객 DB 조회
 *
 * ★ 2026-08-22: 콘솔 톤 풀스크린으로 갈아엎었다가 **원본으로 되돌렸다**(Harold "예전이 낫다, 지금 게 구려 보인다").
 *   되돌린 뒤 얹은 것은 하나뿐이다: **행을 누르면 `Customer360Modal`이 뜬다.**
 *   옛 우측 35% 상세 패널은 360 모달의 "기본 정보"가 그대로 이어받는다(같은 필드 표를 넘긴다 — 사라진 정보 0).
 */
import { useEffect, useState } from 'react';
import { formatDate, formatPreviewValue, formatPhoneNumber, compactTimestamp, formatIfIsoDate } from '../utils/formatDate';
import { useToast } from './ToastProvider';
import Customer360Modal from './customer360/Customer360Modal';

interface CustomerDBModalProps {
  onClose: () => void;
  token: string | null;
  userType?: 'super_admin' | 'company_admin' | 'company_user';
  /** ★ `?customer=<id>` 진입 — 열자마자 그 고객의 360을 편다 */
  initialCustomerId?: string | null;
}

export default function CustomerDBModal({ onClose, token, userType, initialCustomerId }: CustomerDBModalProps) {
  const toast = useToast();
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

  // 상세보기 — selectedCustomer = 360 모달의 "기본 정보"에 넘길 필드 값
  const [selectedCustomer, setSelectedCustomer] = useState<any>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  // ★ 2026-08-22 고객 360 — 패널은 id로 스스로 조회한다. selectedRow는 응답 전 헤더용 폴백
  const [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(null);
  const [selectedRow, setSelectedRow] = useState<any>(null);

  // 동적 컬럼 (field_definitions 기반)
  const [fieldColumns, setFieldColumns] = useState<any[]>([]);

  // ★ D132 Phase A: 다운로드 상태
  const [downloading, setDownloading] = useState(false);

  // ★ D144 P5 (2026-05-06): 고객DB 전체 삭제 (company_admin/super_admin)
  const [showDeleteAllConfirm, setShowDeleteAllConfirm] = useState(false);
  const [deleteConfirmInput, setDeleteConfirmInput] = useState('');
  const [deletingAll, setDeletingAll] = useState(false);
  const [deleteResult, setDeleteResult] = useState<{ ok: boolean; message: string } | null>(null);

  useEffect(() => {
    fetchEnabledFieldsAndOptions();
    fetchCustomers(1);
    // ★ 2026-08-22 `?customer=<id>` 진입이면 목록과 함께 360을 바로 연다(열 때 한 번만)
    if (initialCustomerId) {
      setSelectedCustomerId(initialCustomerId);
      fetchDetail(initialCustomerId as any);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ★ D144 P5: 전체 삭제 실행
  const handleDeleteAll = async () => {
    if (!deleteConfirmInput.trim()) {
      setDeleteResult({ ok: false, message: '회사명을 입력해주세요' });
      return;
    }
    setDeletingAll(true);
    setDeleteResult(null);
    try {
      const res = await fetch('/api/customers/delete-all', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirmCompanyName: deleteConfirmInput.trim() }),
      });
      const data = await res.json();
      if (res.ok) {
        setDeleteResult({ ok: true, message: `${data.deletedCount?.toLocaleString() || 0}명의 고객 데이터가 전체 삭제되었습니다` });
        // 2초 후 모달 닫고 목록 새로고침
        setTimeout(() => {
          setShowDeleteAllConfirm(false);
          setDeleteConfirmInput('');
          setDeleteResult(null);
          fetchCustomers(1);
        }, 2000);
      } else {
        setDeleteResult({ ok: false, message: data.error || '삭제 실패' });
      }
    } catch (e) {
      setDeleteResult({ ok: false, message: '네트워크 오류' });
    } finally {
      setDeletingAll(false);
    }
  };

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

  /** 행을 누르면 360 모달을 연다. 기본 정보는 기존 상세 API가 그대로 채운다 */
  const openCustomer = (row: any) => {
    setSelectedRow(row);
    setSelectedCustomerId(String(row.id));
    fetchDetail(row.id);
  };

  const closeCustomer = () => {
    setSelectedCustomerId(null);
    setSelectedCustomer(null);
    setSelectedRow(null);
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
    if (['number', 'integer', 'int', 'float', 'numeric'].includes(dataType)) {
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
    return ['number', 'integer', 'int', 'float', 'numeric', 'date', 'datetime', 'timestamp'].includes(dataType);
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
    if (['number', 'integer', 'int', 'float', 'numeric', 'date', 'datetime', 'timestamp'].includes(dataType)) return false;
    // ★ 값이 모두 숫자이면 숫자 필드로 취급 (금액, 포인트 등 커스텀 필드)
    const vals = filterOptions[fieldKey];
    const allNumeric = vals.length > 0 && vals.every((v: string) => v !== '' && !isNaN(Number(String(v).replace(/,/g, ''))));
    if (allNumeric) return false;
    return true;
  };

  // ★ D123 P6: 인라인 제거 → formatPhoneNumber 컨트롤타워 사용 (02 지역번호, 대표번호, 050X 전부 정확 처리)
  const formatPhone = (phone: string) => phone ? formatPhoneNumber(phone) : '-';

  const totalPages = Math.ceil(total / limit);

  // ★ D132 Phase A: 현재 필터 조건으로 XLSX 다운로드
  const handleDownload = async () => {
    if (downloading || total === 0) return;
    setDownloading(true);
    try {
      const params = new URLSearchParams();
      if (filterSmsOptIn === 'true') params.set('smsOptIn', 'true');
      if (filterSmsOptIn === 'false') params.set('smsOptIn', 'false');
      if (filterStoreCode !== 'all') params.set('filterStoreCode', filterStoreCode);
      if (activeFilters.length > 0) {
        const filtersObj: Record<string, any> = {};
        for (const af of activeFilters) {
          if (af.op === 'between' && af.valueMax) {
            filtersObj[af.field] = { operator: 'between', value: [af.value, af.valueMax] };
          } else {
            filtersObj[af.field] = { operator: af.op, value: af.value };
          }
        }
        params.set('filters', JSON.stringify(filtersObj));
      }

      const res = await fetch(`/api/customers/download?${params.toString()}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const errMsg = await res.text().catch(() => '');
        throw new Error(errMsg || '다운로드 실패');
      }

      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `customers_${compactTimestamp()}.xlsx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
    } catch (err: any) {
      console.error('고객 DB 다운로드 실패:', err);
      toast.error(`다운로드 실패: ${err?.message || '알 수 없는 오류'}`);
    } finally {
      setDownloading(false);
    }
  };

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
    // ★ 평균주문금액은 커스텀 필드(custom_N) — 직접 컬럼 아님. field_type/data_type 'number' 자동 감지로 처리
    { key: 'recent_purchase_date', label: '최근구매일', format: (v) => formatDate(v) },
    { key: 'sms_opt_in', label: '수신동의', format: (v) => v === true || v === 'Y' ? '동의' : '거부' },
    { key: 'created_at', label: '등록일', format: (v) => formatDate(v) },
  ];
  // field_definitions에 있지만 baseDetailFields에 없는 커스텀 필드 추가
  const baseKeys = new Set(baseDetailFields.map(f => f.key));
  const extraDetailFields = fieldColumns
    .filter(f => f.is_custom && !baseKeys.has(f.field_key))
    // ★ 2026-07-03: 커스텀 값이 명백한 ISO 타임스탬프면 날짜 표시, 아니면 원본 그대로(D142)
    .map(f => ({ key: f.field_key, label: f.field_label || f.display_name || f.field_key, format: ((v: any) => formatIfIsoDate(v) ?? (v != null ? String(v) : '-')) as ((v: any) => string) | undefined }));
  const detailFields = [...baseDetailFields, ...extraDetailFields];

  /**
   * 360 모달의 접이식 "기본 정보" — 옛 우측 패널이 그리던 필드 표를 그대로 옮긴 것이다.
   * 정보가 사라지지 않게 같은 목록·같은 포맷터를 쓴다(`feedback_ui_simplify_not_empty`).
   */
  const basicInfoBlock = selectedCustomer ? (
    detailLoading ? (
      <p className="py-6 text-center text-[13px] text-neutral-400">불러오는 중</p>
    ) : (
      <dl className="divide-y divide-neutral-100">
        {detailFields.map(field => {
          const value = selectedCustomer[field.key];
          if (value == null && field.key !== 'sms_opt_in') return null;
          const display = field.format ? field.format(value) : (value || '-');
          if (display === '-' && field.key !== 'sms_opt_in' && field.key !== 'name') return null;
          return (
            <div key={field.key} className="flex items-start gap-3 py-2">
              <dt className="w-24 shrink-0 text-[11.5px] text-neutral-400">{field.label}</dt>
              <dd className="text-[13px] text-neutral-800 break-words">{display}</dd>
            </div>
          );
        })}
        {selectedCustomer.custom_fields && Object.keys(selectedCustomer.custom_fields).length > 0 && (
          <>
            <div className="pt-3 pb-1 text-[11.5px] font-medium text-neutral-400">추가 정보</div>
            {Object.entries(selectedCustomer.custom_fields).map(([key, value]) => {
              const fieldDef = fieldColumns && fieldColumns.length > 0
                ? fieldColumns.find((f: any) => f.field_key === key)
                : null;
              const displayLabel = fieldDef?.field_label || fieldDef?.display_name || key;
              // ★ D136 재발방지: custom_fields JSONB 키는 그 자체가 fieldKey — 그대로 전달해야 커스텀 가드가 작동한다
              const displayValue = value != null ? formatPreviewValue(value, { fieldLabel: displayLabel, fieldKey: key }) : '-';
              return (
                <div key={key} className="flex items-start gap-3 py-2">
                  <dt className="w-24 shrink-0 text-[11.5px] text-neutral-400">{displayLabel}</dt>
                  <dd className="text-[13px] text-neutral-800 break-words">{displayValue}</dd>
                </div>
              );
            })}
          </>
        )}
      </dl>
    )
  ) : null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[50]">
      <div className="bg-white rounded-xl shadow-2xl w-[1100px] max-h-[88vh] overflow-hidden flex flex-col">

        {/* 헤더 */}
        <div className="flex justify-between items-center px-6 py-4 border-b bg-gray-50">
          <div>
            <h3 className="text-lg font-bold text-gray-800">고객 DB 조회</h3>
            <span className="text-sm text-gray-500">총 {total.toLocaleString()}명</span>
          </div>
          <div className="flex items-center gap-2">
            {/* ★ D132 Phase A: 현재 필터 조건 XLSX 다운로드 */}
            <button
              onClick={handleDownload}
              disabled={downloading || total === 0}
              title={total === 0 ? '다운로드할 고객이 없습니다' : '현재 필터 조건의 고객 리스트를 엑셀로 다운로드합니다'}
              className="px-3 py-1.5 text-xs font-semibold bg-gradient-to-r from-violet-600 to-purple-600 text-white rounded-lg shadow-sm shadow-violet-200/60 hover:from-violet-700 hover:to-purple-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all flex items-center gap-1.5"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
              </svg>
              {downloading ? '다운로드 중...' : '엑셀 다운로드'}
            </button>
            {/* ★ D144 P5: 전체 삭제 (company_admin/super_admin만) */}
            {(userType === 'company_admin' || userType === 'super_admin') && (
              <button
                onClick={() => { setShowDeleteAllConfirm(true); setDeleteConfirmInput(''); setDeleteResult(null); }}
                disabled={total === 0}
                title={total === 0 ? '삭제할 고객이 없습니다' : '고객 DB 전체를 영구 삭제합니다 (회사명 확인 필요)'}
                className="px-3 py-1.5 text-xs font-semibold bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all flex items-center gap-1.5"
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6M1 7h22M9 7V4a1 1 0 011-1h4a1 1 0 011 1v3" />
                </svg>
                전체 삭제
              </button>
            )}
            <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-gray-200 text-gray-400 hover:text-gray-600 transition-colors text-lg">&times;</button>
          </div>
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
                  <th className="px-3 py-2.5 text-left text-xs font-semibold text-gray-500 whitespace-nowrap">{fieldColumns.find(f => f.field_key === 'name')?.field_label || '고객명'}</th>
                  <th className="px-3 py-2.5 text-left text-xs font-semibold text-gray-500 whitespace-nowrap">{fieldColumns.find(f => f.field_key === 'phone')?.field_label || '전화번호'}</th>
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
                      onClick={() => openCustomer(c)}
                      title="누르면 이 고객의 활동 기록이 열립니다"
                      className={`border-t cursor-pointer transition-colors ${selectedCustomerId === c.id ? 'bg-emerald-50' : 'hover:bg-gray-50'}`}>
                      <td className="px-3 py-2.5 text-center text-xs text-gray-400">{(page - 1) * limit + idx + 1}</td>
                      <td className="px-3 py-2.5 text-sm font-medium text-gray-800 whitespace-nowrap">{c.name || '-'}</td>
                      <td className="px-3 py-2.5 font-mono text-xs text-gray-600 whitespace-nowrap">{formatPhone(c.phone)}</td>
                      {fieldColumns.filter(f => !['name', 'phone'].includes(f.field_key)).map(f => {
                        const val = f.is_custom ? c.custom_fields?.[f.field_key] : c[f.field_key];
                        let display: string;
                        if (f.field_key === 'gender') {
                          display = val === 'M' || val === '남' || val === '남성' ? '남' : val === 'F' || val === '여' || val === '여성' ? '여' : val || '-';
                        } else if (f.field_key === 'birth_date' || f.field_key === 'recent_purchase_date' || f.field_key === 'created_at' || f.field_key === 'wedding_anniversary' || f.field_key === 'registration_date' || f.field_key === 'first_purchase_date' || (f.field_type && ['DATE', 'DATETIME', 'TIMESTAMP'].includes(f.field_type.toUpperCase()))) {
                          // ★ D93: DATE/DATETIME/TIMESTAMP 타입 + 날짜 직접 컬럼 전부 formatDate 적용
                          display = val ? formatDate(String(val)) : '-';
                        } else if (f.field_key === 'total_purchase_amount' || f.field_key === 'recent_purchase_amount' || f.field_key === 'points' || f.field_key === 'purchase_count') {
                          // ★ D89→D120: formatPreviewValue + fieldLabel 전달로 숫자/날짜 판정
                          // ★ D136 재발방지 (2026-04-22 P1): fieldKey 전달 — 커스텀필드 가드 작동 보장
                          display = val != null ? formatPreviewValue(val, { fieldLabel: f.field_label || f.display_name || f.field_key, fieldKey: f.field_key }) : '-';
                        } else if ((f.field_type === 'NUMBER' || f.data_type === 'number') && val != null) {
                          // ★ D98→D120: 커스텀 숫자 필드 — fieldLabel 기반 숫자/날짜 판정
                          // ★ D136 재발방지 (2026-04-22 P1): fieldKey 필수 전달 — 커스텀 숫자 필드(custom_2 등)
                          //   data_type='number' 자동 감지된 varchar "20260416150000"가 콤마 포맷되는 버그 차단
                          display = formatPreviewValue(val, { fieldLabel: f.field_label || f.display_name || f.field_key, fieldKey: f.field_key });
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
                          // ★ 2026-07-03: 명백한 ISO 타임스탬프(싱크 custom 날짜)만 날짜 표시 — 그 외 원본 유지(D142)
                          display = val != null ? (formatIfIsoDate(val) ?? String(val)) : '-';
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
          {/* ★ 2026-08-22 옛 우측 상세 패널은 Customer360Modal이 대체한다(기본 정보는 basicInfo로 그대로 넘어간다) */}
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

      {/* ★ D144 P5: 고객 DB 전체 삭제 확인 모달 (안전장치 — 회사명 일치 검증) */}
      {showDeleteAllConfirm && (
        <div className="fixed inset-0 bg-black bg-opacity-60 flex items-center justify-center z-[60] p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-md animate-in fade-in zoom-in">
            <div className="px-6 py-5">
              <div className="flex items-start gap-3 mb-4">
                <div className="w-10 h-10 rounded-full bg-red-100 flex items-center justify-center flex-shrink-0">
                  <svg className="w-5 h-5 text-red-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                  </svg>
                </div>
                <div className="flex-1">
                  <h3 className="text-lg font-bold text-gray-900">고객 DB 전체 삭제</h3>
                  <p className="text-sm text-gray-600 mt-1">
                    등록된 모든 고객 데이터, 구매내역, 수신거부, 필드 정의가 <strong className="text-red-600">영구 삭제</strong>됩니다. 복구 불가능합니다.
                  </p>
                </div>
              </div>
              <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 mb-4 text-xs text-amber-800">
                <strong>안전 확인:</strong> 본인 회사의 정확한 회사명을 아래에 입력해야 삭제됩니다.
              </div>
              <input
                type="text"
                value={deleteConfirmInput}
                onChange={(e) => { setDeleteConfirmInput(e.target.value); setDeleteResult(null); }}
                placeholder="회사명을 정확히 입력하세요"
                disabled={deletingAll}
                className="w-full px-3 py-2 border-2 border-gray-300 rounded-lg text-sm focus:border-red-500 focus:ring-2 focus:ring-red-100 outline-none disabled:bg-gray-50"
                onKeyDown={(e) => { if (e.key === 'Enter' && !deletingAll) handleDeleteAll(); }}
              />
              {deleteResult && (
                <div className={`mt-3 p-3 rounded-lg text-sm ${deleteResult.ok ? 'bg-green-50 text-green-700 border border-green-200' : 'bg-red-50 text-red-700 border border-red-200'}`}>
                  {deleteResult.message}
                </div>
              )}
            </div>
            <div className="px-6 py-4 bg-gray-50 border-t flex justify-end gap-2 rounded-b-xl">
              <button
                onClick={() => { setShowDeleteAllConfirm(false); setDeleteConfirmInput(''); setDeleteResult(null); }}
                disabled={deletingAll}
                className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50"
              >
                취소
              </button>
              <button
                onClick={handleDeleteAll}
                disabled={deletingAll || !deleteConfirmInput.trim() || (deleteResult?.ok === true)}
                className="px-4 py-2 text-sm font-bold text-white bg-red-600 rounded-lg hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
              >
                {deletingAll ? (
                  <>
                    <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" strokeWidth="3" strokeDasharray="60" strokeLinecap="round" /></svg>
                    삭제 중...
                  </>
                ) : '영구 삭제'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ★ 2026-08-22 고객 360 — 목록 위에 자기 모달로 뜬다 */}
      <Customer360Modal
        show={!!selectedCustomerId}
        customerId={selectedCustomerId}
        fallbackName={selectedRow?.name || null}
        fallbackPhone={selectedRow?.phone || null}
        basicInfo={basicInfoBlock}
        onClose={closeCustomer}
      />
    </div>
  );
}
