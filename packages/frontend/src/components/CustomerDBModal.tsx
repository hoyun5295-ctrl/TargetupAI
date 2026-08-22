/**
 * CustomerDBModal — 고객 목록 + 고객 360 타임라인
 *
 * ★ 2026-08-22 풀스크린 작업면으로 확장(Harold 확정: 페이지 신설 대신 이 모달을 키운다).
 *   좌 = 목록·필터(조회 로직 무변경) · 우 = `Customer360Panel`. 진입 = 대시보드 "상세보기" · 헤더 "고객" 메뉴 · `?customer=<id>`.
 *   표면은 콘솔 톤(`CUI_*`)으로 올렸고, 옛 규격에서 함께 고친 것 셋:
 *     ①boolean 컬럼이 `true`/`false` 원문으로 보이던 것 → 동의·거부 칩
 *     ②"전체 삭제"가 다운로드 옆 주 동선에 있던 것 → 관리자 전용 `⋯` 메뉴 뒤 + 공용 확인 셸
 *     ③에메랄드 옛 톤 → 인디고
 *   설계·불변 원칙 = docs/2026-08-22-customer-360-timeline-design.md
 */
import { useEffect, useRef, useState } from 'react';
import { Users, Download, MoreHorizontal, X, Search, RotateCcw, ChevronLeft, ChevronRight, Loader2, AlertTriangle } from 'lucide-react';
import { formatDate, formatPreviewValue, formatPhoneNumber, compactTimestamp, formatIfIsoDate } from '../utils/formatDate';
import { useToast } from './ToastProvider';
import Customer360Panel from './customer360/Customer360Panel';
import ConfirmDialogShell from './shared/ConfirmDialogShell';
import {
  CUI_MODAL_SCRIM, CUI_MODAL, CUI_MODAL_HEAD, CUI_MODAL_TITLE, CUI_MODAL_DESC, CUI_MODAL_CLOSE,
  CUI_BTN_PRIMARY, CUI_BTN_OUTLINE, CUI_BTN_GHOST, CUI_ICON_BTN, CUI_MENU, CUI_MENU_ITEM_DANGER,
  CUI_SELECT, CUI_INPUT, CUI_CHIP_ON, CUI_CHIP_OFF,
  CUI_THEAD, CUI_TH, CUI_TR, CUI_TD, CUI_CELL_NAME, CUI_CELL_DATA, CUI_CELL_META, CUI_CELL_OFF,
  CUI_PILL_BASE,
} from '../utils/console-ui';

interface CustomerDBModalProps {
  onClose: () => void;
  token: string | null;
  userType?: 'super_admin' | 'company_admin' | 'company_user';
  /** ★ 2026-08-22 `?customer=<id>` 진입 — 열자마자 그 고객의 360을 편다 */
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

  // 상세보기 — selectedCustomer = 기본 정보(상세 API 결과)
  const [selectedCustomer, setSelectedCustomer] = useState<any>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  // ★ 2026-08-22 고객 360 — 패널은 id로 스스로 조회한다. selectedRow는 응답 전 헤더용 폴백
  const [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(null);
  const [selectedRow, setSelectedRow] = useState<any>(null);
  const [showMoreMenu, setShowMoreMenu] = useState(false);

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
  }, []);

  /**
   * ★ 2026-08-22 진입 파라미터로 온 고객을 바로 편다.
   * `fetchCustomers`가 선택을 지우므로 **첫 목록 로딩이 끝난 뒤**에 세우고, 한 번만 적용한다.
   * (한 번만이 아니면 필터를 바꿀 때마다 loading이 토글되어 그 고객이 다시 열린다)
   */
  const initialAppliedRef = useRef(false);
  useEffect(() => {
    if (!initialCustomerId || initialAppliedRef.current || loading) return;
    initialAppliedRef.current = true;
    setSelectedCustomerId(initialCustomerId);
    setSelectedRow(null);
    fetchDetail(initialCustomerId as any);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialCustomerId, loading]);

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
    setSelectedCustomerId(null);
    setSelectedRow(null);
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

  /** 행을 누르면 360 패널을 연다. 기본 정보는 기존 상세 API가 그대로 채운다 */
  const openCustomer = (row: any) => {
    setSelectedRow(row);
    setSelectedCustomerId(String(row.id));
    fetchDetail(row.id);
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

  // ── 기본 정보 표 — 360 패널의 접이식 "기본 정보"로 들어간다(기존 필드 나열을 없애지 않는다) ──
  const basicInfoBlock = selectedCustomer ? (
    <div>
      {detailLoading ? (
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
                // ★ D89→D120: formatPreviewValue + fieldLabel 전달로 숫자/날짜 판정
                // ★ D136 재발방지 (2026-04-22 P1): custom_fields JSONB 키는 자체가 fieldKey — 그대로 전달하여 커스텀 가드 작동
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
      )}
    </div>
  ) : null;

  const listColumns = fieldColumns.filter(f => !['name', 'phone'].includes(f.field_key));
  const canManage = userType === 'company_admin' || userType === 'super_admin';

  return (
    <div className={CUI_MODAL_SCRIM}>
      {/* ★ 2026-08-22 풀스크린 작업면 — 직접 타겟 발송과 같은 규격(92vh). 좌 목록 · 우 고객 360 */}
      <div className={`${CUI_MODAL} max-w-[1600px] h-[92vh]`} role="dialog" aria-modal="true" aria-label="고객">

        {/* ===== 헤더 ===== */}
        <div className={CUI_MODAL_HEAD}>
          <div className="flex items-center gap-3 min-w-0">
            <div className="h-9 w-9 shrink-0 rounded-xl bg-indigo-600 text-white grid place-items-center">
              <Users className="w-4 h-4" strokeWidth={1.9} />
            </div>
            <div className="min-w-0">
              <h3 className={CUI_MODAL_TITLE}>고객</h3>
              <p className={`${CUI_MODAL_DESC} tabular-nums`}>총 {total.toLocaleString()}명</p>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={handleDownload}
              disabled={downloading || total === 0}
              title={total === 0 ? '다운로드할 고객이 없습니다' : '지금 조건의 고객 목록을 엑셀로 받습니다'}
              className={CUI_BTN_OUTLINE}
            >
              {downloading
                ? <><Loader2 className="w-[15px] h-[15px] animate-spin" />내려받는 중</>
                : <><Download className="w-[15px] h-[15px]" />엑셀 받기</>}
            </button>

            {/* ★ 2026-08-22 전체 삭제를 주 동선에서 뗐다 — 되돌릴 수 없는 행동이 다운로드 옆에 있으면 오클릭이 사고가 된다 */}
            {canManage && (
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setShowMoreMenu(v => !v)}
                  aria-label="더 보기"
                  className={CUI_ICON_BTN}
                >
                  <MoreHorizontal className="w-4 h-4" strokeWidth={1.9} />
                </button>
                {showMoreMenu && (
                  <>
                    <div className="fixed inset-0 z-30" onClick={() => setShowMoreMenu(false)} />
                    <div className={CUI_MENU}>
                      <button
                        type="button"
                        onClick={() => {
                          setShowMoreMenu(false);
                          if (total === 0) return;
                          setShowDeleteAllConfirm(true); setDeleteConfirmInput(''); setDeleteResult(null);
                        }}
                        disabled={total === 0}
                        className={`${CUI_MENU_ITEM_DANGER} disabled:opacity-40`}
                      >
                        고객 DB 전체 삭제
                      </button>
                    </div>
                  </>
                )}
              </div>
            )}

            <button type="button" onClick={onClose} className={CUI_MODAL_CLOSE} aria-label="닫기">
              <X className="w-4 h-4" strokeWidth={1.75} />
            </button>
          </div>
        </div>

        {/* ===== 필터 ===== */}
        <div className="shrink-0 px-6 py-3 border-b border-neutral-200 space-y-2">
          <div className="flex items-center gap-1.5 flex-wrap">
            <select value={dynFilterField} onChange={(e) => {
              const newField = e.target.value;
              setDynFilterField(newField);
              setDynFilterValue('');
              setDynFilterValueMax('');
              if (newField) {
                const ops = getOperatorsForField(newField);
                setDynFilterOp(ops.length > 0 ? ops[0].v : 'contains');
              } else {
                setDynFilterOp('contains');
              }
            }} className={`${CUI_SELECT} w-auto min-w-[140px]`}>
              <option value="">항목 고르기</option>
              {/* ★ D88: sms_opt_in은 전용 필터 버튼이 있으므로 중복 제외 */}
              {fieldColumns.filter((f: any) => f.field_key !== 'sms_opt_in').map((f: any) => (
                <option key={f.field_key} value={f.field_key}>{f.field_label || f.display_name || f.field_key}</option>
              ))}
            </select>

            {/* 연산자 — 숫자·날짜 항목만(문자열은 자동 포함검색) */}
            {dynFilterField && isNumericOrDateField(dynFilterField) && (
              <select value={dynFilterOp} onChange={(e) => setDynFilterOp(e.target.value)} className={`${CUI_SELECT} w-auto min-w-[92px]`}>
                {getOperatorsForField(dynFilterField).map(op => (
                  <option key={op.v} value={op.v}>{op.l}</option>
                ))}
              </select>
            )}

            {dynFilterField && (
              hasDropdownOptions(dynFilterField) ? (
                <select value={dynFilterValue} onChange={(e) => setDynFilterValue(e.target.value)} className={`${CUI_SELECT} w-auto min-w-[120px]`}>
                  <option value="">값 고르기</option>
                  {filterOptions[dynFilterField].map(v => <option key={v} value={v}>{v}</option>)}
                </select>
              ) : (
                <input type={isDateField(dynFilterField) ? 'date' : 'text'}
                  value={dynFilterValue} onChange={(e) => setDynFilterValue(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') handleAddFilter(); }}
                  placeholder={isDateField(dynFilterField) ? '' : isNumericOrDateField(dynFilterField) ? '값' : '검색어'}
                  className={`${CUI_INPUT} w-40`} />
              )
            )}

            {dynFilterField && dynFilterOp === 'between' && (
              <>
                <span className="text-[12px] text-neutral-400">~</span>
                <input type={isDateField(dynFilterField) ? 'date' : 'text'}
                  value={dynFilterValueMax} onChange={(e) => setDynFilterValueMax(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') handleAddFilter(); }}
                  placeholder={isDateField(dynFilterField) ? '' : '최대'}
                  className={`${CUI_INPUT} w-32`} />
              </>
            )}

            {dynFilterField && dynFilterValue && (
              <button type="button" onClick={handleAddFilter} className={CUI_BTN_PRIMARY}>
                <Search className="w-[15px] h-[15px]" />찾기
              </button>
            )}

            <span className="w-px h-5 bg-neutral-200 mx-0.5" />

            <span className="text-[12px] font-medium text-neutral-500">수신</span>
            {[{ v: 'all', l: '전체' }, { v: 'true', l: '동의' }, { v: 'false', l: '거부' }].map(opt => (
              <button key={opt.v} type="button" onClick={() => handleSpecialFilterChange('smsOptIn', opt.v)}
                className={filterSmsOptIn === opt.v ? CUI_CHIP_ON : CUI_CHIP_OFF}>
                {opt.l}
              </button>
            ))}

            {canManage && storeCodeOptions.length > 0 && (
              <>
                <span className="w-px h-5 bg-neutral-200 mx-0.5" />
                <span className="text-[12px] font-medium text-neutral-500">브랜드</span>
                <select value={filterStoreCode} onChange={(e) => handleSpecialFilterChange('storeCode', e.target.value)}
                  className={`${CUI_SELECT} w-auto min-w-[110px]`}>
                  <option value="all">전체</option>
                  {storeCodeOptions.map(sc => <option key={sc} value={sc}>{sc}</option>)}
                </select>
              </>
            )}

            {(activeFilters.length > 0 || filterSmsOptIn !== 'all' || filterStoreCode !== 'all') && (
              <>
                <span className="w-px h-5 bg-neutral-200 mx-0.5" />
                <button type="button" onClick={handleReset} className={CUI_BTN_GHOST}>
                  <RotateCcw className="w-[15px] h-[15px]" />초기화
                </button>
              </>
            )}
          </div>

          {/* ★ D79: 적용된 필터 */}
          {activeFilters.length > 0 && (
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="text-[11.5px] text-neutral-400">적용:</span>
              {activeFilters.map(af => {
                const opLabel = af.op === 'contains' ? '포함' : af.op === 'eq' ? '=' : af.op === 'gte' ? '이상' : af.op === 'lte' ? '이하' : af.op === 'between' ? '~' : af.op;
                const valueDisplay = af.op === 'between' && af.valueMax ? `${af.value} ~ ${af.valueMax}` : af.value;
                return (
                  <span key={af.field} className="h-[26px] pl-2.5 pr-1 inline-flex items-center gap-1 rounded-lg bg-indigo-50 text-indigo-700 text-[12px] font-medium ring-1 ring-indigo-600/15">
                    {af.label} {opLabel} {valueDisplay}
                    <button type="button" onClick={() => handleRemoveFilter(af.field)} aria-label={`${af.label} 조건 빼기`}
                      className="h-5 w-5 grid place-items-center rounded text-indigo-400 transition hover:bg-white hover:text-indigo-700">
                      <X className="w-3 h-3" strokeWidth={2.4} />
                    </button>
                  </span>
                );
              })}
            </div>
          )}
        </div>

        {/* ===== 목록 + 360 패널 ===== */}
        <div className="flex-1 min-h-0 flex">
          {/* 목록 */}
          <div className={`min-w-0 flex flex-col ${selectedCustomerId ? 'hidden md:flex md:flex-1' : 'flex-1'}`}>
            <div className="flex-1 min-h-0 overflow-auto">
              <table className="w-full" style={{ minWidth: `${Math.max(700, 220 + listColumns.length * 120)}px` }}>
                <thead className={`${CUI_THEAD} sticky top-0 z-10`}>
                  <tr>
                    <th className={`${CUI_TH} w-12 text-center`}>#</th>
                    <th className={CUI_TH}>{fieldColumns.find(f => f.field_key === 'name')?.field_label || '고객명'}</th>
                    <th className={CUI_TH}>{fieldColumns.find(f => f.field_key === 'phone')?.field_label || '전화번호'}</th>
                    {listColumns.map(f => (
                      <th key={f.field_key} className={CUI_TH}>{f.field_label || f.display_name || f.field_key}</th>
                    ))}
                    <th className={`${CUI_TH} text-center`}>수신</th>
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <tr><td colSpan={4 + listColumns.length} className="py-16 text-center text-[13px] text-neutral-400">조회 중</td></tr>
                  ) : customers.length === 0 ? (
                    <tr><td colSpan={4 + listColumns.length} className="py-16 text-center text-[13px] text-neutral-400">
                      {activeFilters.length > 0 ? '조건에 맞는 고객이 없습니다' : '고객 데이터가 없습니다'}
                    </td></tr>
                  ) : (
                    customers.map((c: any, idx: number) => (
                      <tr key={c.id}
                        onClick={() => openCustomer(c)}
                        className={`${CUI_TR} cursor-pointer ${selectedCustomerId === c.id ? 'bg-indigo-50/60' : ''}`}>
                        <td className={`${CUI_TD} text-center ${CUI_CELL_META}`}>{(page - 1) * limit + idx + 1}</td>
                        <td className={`${CUI_TD} ${CUI_CELL_NAME}`}>{c.name || '-'}</td>
                        <td className={`${CUI_TD} font-mono text-[12.5px] text-neutral-600`}>{formatPhone(c.phone)}</td>
                        {listColumns.map(f => {
                          const val = f.is_custom ? c.custom_fields?.[f.field_key] : c[f.field_key];
                          let display: string;
                          if (f.field_key === 'gender') {
                            display = val === 'M' || val === '남' || val === '남성' ? '남' : val === 'F' || val === '여' || val === '여성' ? '여' : val || '-';
                          } else if (f.field_key === 'birth_date' || f.field_key === 'recent_purchase_date' || f.field_key === 'created_at' || f.field_key === 'wedding_anniversary' || f.field_key === 'registration_date' || f.field_key === 'first_purchase_date' || (f.field_type && ['DATE', 'DATETIME', 'TIMESTAMP'].includes(f.field_type.toUpperCase()))) {
                            // ★ D93: DATE/DATETIME/TIMESTAMP 타입 + 날짜 직접 컬럼 전부 formatDate 적용
                            display = val ? formatDate(String(val)) : '-';
                          } else if (f.field_key === 'total_purchase_amount' || f.field_key === 'recent_purchase_amount' || f.field_key === 'points' || f.field_key === 'purchase_count') {
                            // ★ D89→D120 + D136: fieldKey 전달로 커스텀필드 가드 작동
                            display = val != null ? formatPreviewValue(val, { fieldLabel: f.field_label || f.display_name || f.field_key, fieldKey: f.field_key }) : '-';
                          } else if ((f.field_type === 'NUMBER' || f.data_type === 'number') && val != null) {
                            display = formatPreviewValue(val, { fieldLabel: f.field_label || f.display_name || f.field_key, fieldKey: f.field_key });
                          } else if (f.field_key === 'grade') {
                            return (
                              <td key={f.field_key} className={CUI_TD}>
                                {val ? <span className={`${CUI_PILL_BASE} bg-indigo-50 text-indigo-700`}>{val}</span> : <span className={CUI_CELL_OFF}>-</span>}
                              </td>
                            );
                          } else if (f.data_type === 'boolean' || typeof val === 'boolean') {
                            // ★ 2026-08-22: true/false 원문이 그대로 보이던 것을 사람 말로. 값 판정은 그대로다.
                            return (
                              <td key={f.field_key} className={CUI_TD}>
                                {val == null || val === ''
                                  ? <span className={CUI_CELL_OFF}>-</span>
                                  : <span className={`${CUI_PILL_BASE} ${val === true || val === 'true' ? 'bg-emerald-100 text-emerald-800' : 'bg-neutral-100 text-neutral-600'}`}>
                                      {val === true || val === 'true' ? '동의' : '거부'}
                                    </span>}
                              </td>
                            );
                          } else {
                            // ★ 2026-07-03: 명백한 ISO 타임스탬프만 날짜 표시 — 그 외 원본 유지(D142)
                            display = val != null ? (formatIfIsoDate(val) ?? String(val)) : '-';
                          }
                          return <td key={f.field_key} className={`${CUI_TD} ${CUI_CELL_DATA}`}>{display}</td>;
                        })}
                        <td className={`${CUI_TD} text-center`}>
                          <span className={`inline-block w-2 h-2 rounded-full ${c.sms_opt_in ? 'bg-emerald-500' : 'bg-neutral-300'}`}
                            title={c.sms_opt_in ? '수신 동의' : '수신 거부'} />
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            {/* 페이지 */}
            {totalPages > 0 && (
              <div className="shrink-0 px-6 py-3 border-t border-neutral-200 bg-neutral-50 flex items-center justify-center gap-1.5">
                <button type="button" onClick={() => { const p = Math.max(1, page - 1); setPage(p); fetchCustomers(p); }}
                  disabled={page <= 1} className={`${CUI_BTN_GHOST} h-8`}>
                  <ChevronLeft className="w-4 h-4" />이전
                </button>
                {Array.from({ length: Math.min(totalPages, 10) }, (_, i) => {
                  let start = Math.max(1, page - 4);
                  if (start + 9 > totalPages) start = Math.max(1, totalPages - 9);
                  return start + i;
                }).filter(p => p <= totalPages).map(p => (
                  <button key={p} type="button" onClick={() => { setPage(p); fetchCustomers(p); }}
                    className={`h-8 w-8 rounded-lg text-[13px] font-medium transition ${page === p ? 'bg-indigo-600 text-white font-semibold' : 'text-neutral-600 hover:bg-neutral-100'}`}>
                    {p}
                  </button>
                ))}
                <button type="button" onClick={() => { const p = Math.min(totalPages, page + 1); setPage(p); fetchCustomers(p); }}
                  disabled={page >= totalPages} className={`${CUI_BTN_GHOST} h-8`}>
                  다음<ChevronRight className="w-4 h-4" />
                </button>
                <span className="ml-2 text-[12px] text-neutral-400 tabular-nums">{page} / {totalPages}</span>
              </div>
            )}
          </div>

          {/* 고객 360 — 데스크톱은 우측 고정, 모바일은 목록을 덮는다 */}
          {selectedCustomerId && (
            <div className="w-full md:w-[440px] shrink-0 md:border-l border-neutral-200 min-h-0">
              <Customer360Panel
                customerId={selectedCustomerId}
                fallbackName={selectedRow?.name || null}
                fallbackPhone={selectedRow?.phone || null}
                basicInfo={basicInfoBlock}
                onClose={() => { setSelectedCustomerId(null); setSelectedCustomer(null); setSelectedRow(null); }}
              />
            </div>
          )}
        </div>
      </div>

      {/* ★ D144 P5: 고객 DB 전체 삭제 — 회사명 일치 확인. 셸은 발송 계열 공용(포털·ESC·처리 중 잠금) */}
      <ConfirmDialogShell
        show={showDeleteAllConfirm}
        tone="rose"
        icon={<AlertTriangle size={18} strokeWidth={1.9} className="text-white" />}
        title="고객 DB를 전부 지웁니다"
        subtitle="지운 뒤에는 되돌릴 수 없습니다."
        cancelLabel="취소"
        onCancel={() => { setShowDeleteAllConfirm(false); setDeleteConfirmInput(''); setDeleteResult(null); }}
        confirmLabel="영구 삭제"
        onConfirm={handleDeleteAll}
        busy={deletingAll}
        busyLabel="삭제 중..."
        confirmDisabled={!deleteConfirmInput.trim() || deleteResult?.ok === true}
      >
        <p className="text-[13px] text-neutral-700 leading-relaxed">
          등록된 모든 고객 데이터와 구매내역, 수신거부, 항목 정의가 함께 사라집니다.
        </p>
        <div className="mt-3">
          <label htmlFor="delete-all-confirm" className="block text-[12.5px] font-medium text-neutral-600 mb-1.5">
            확인을 위해 회사명을 그대로 입력해 주세요
          </label>
          <input
            id="delete-all-confirm"
            type="text"
            value={deleteConfirmInput}
            onChange={(e) => { setDeleteConfirmInput(e.target.value); setDeleteResult(null); }}
            onKeyDown={(e) => { if (e.key === 'Enter' && !deletingAll && deleteConfirmInput.trim()) handleDeleteAll(); }}
            placeholder="회사명"
            disabled={deletingAll}
            className="w-full h-9 px-3 rounded-lg bg-white border border-neutral-200 text-[13.5px] text-neutral-900 transition placeholder:text-neutral-400 focus:outline-none focus:border-rose-500 focus:ring-4 focus:ring-rose-500/15 disabled:bg-neutral-50"
          />
        </div>
        {deleteResult && (
          <div className={`mt-3 px-3.5 py-3 rounded-lg text-[13px] ${deleteResult.ok ? 'bg-emerald-50 text-emerald-900 border border-emerald-200' : 'bg-rose-50 text-rose-900 border border-rose-200'}`}>
            {deleteResult.message}
          </div>
        )}
      </ConfirmDialogShell>
    </div>
  );
}