import { Filter, RotateCcw, Search, Users, Sparkles, RefreshCw, AlertCircle, AlertTriangle, Info, Check, Eye, X, ChevronDown, ClipboardList, ShoppingBag, Store, Tag, Smartphone, Wrench, Pin, Loader2, type LucideIcon } from 'lucide-react';
import {
  CUI_MODAL_SCRIM, CUI_MODAL, CUI_MODAL_HEAD, CUI_MODAL_TITLE, CUI_MODAL_DESC, CUI_MODAL_BODY, CUI_MODAL_CLOSE,
  CUI_BTN_PRIMARY, CUI_BTN_OUTLINE, CUI_BTN_GHOST, CUI_BTN_DANGER, CUI_LABEL, CUI_HINT, CUI_TEXTAREA,
  CUI_INFO, CUI_INFO_ICON, CUI_INFO_TEXT, CUI_DANGER_BOX, CUI_DANGER_ICON, CUI_DANGER_TEXT, CUI_NOTICE, CUI_NOTICE_ICON, CUI_NOTICE_TEXT,
  CUI_PANEL, CUI_SCROLL_X, CUI_THEAD, CUI_TH, CUI_TH_RIGHT, CUI_TR, CUI_TD, CUI_CELL_DATA, CUI_CELL_META, CUI_CELL_CODE,
  CUI_PILL_BASE, CUI_FIELDSET_TITLE, CUI_PICK_ON, CUI_PICK_OFF, CUI_LOADING, CUI_SPINNER, CUI_EMPTY, CUI_EMPTY_BADGE, CUI_EMPTY_TITLE, CUI_EMPTY_DESC,
} from '../utils/console-ui';
import { useEffect, useState } from 'react';
import { FRONT_FIELD_DISPLAY_MAP, reverseDisplayValueFront } from '../utils/formatDate';

// ★ D43-3c: 필드 메타 인터페이스 (TargetSendModal에서도 사용)
export interface FieldMeta {
  field_key: string;
  display_name: string;
  variable: string;       // '%고객명%' 등
  data_type: string;
  category: string;
}

interface DirectTargetFilterModalProps {
  show: boolean;
  onClose: () => void;
  // ★ D43-3c: fieldsMeta 추가
  onExtracted: (recipients: any[], count: number, fieldsMeta: FieldMeta[], selectedCallbackPhone?: string, phoneFields?: string[]) => void;
}

export default function DirectTargetFilterModal({ show, onClose, onExtracted }: DirectTargetFilterModalProps) {
  // 필드 데이터
  const [enabledFields, setEnabledFields] = useState<any[]>([]);
  const [extractedPhoneFields, setExtractedPhoneFields] = useState<string[]>([]);
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

  // ★ D219+ Part 2 후속 (2026-05-27): AI 자연어 모드 — CT-97 ai-segment-generator 활용
  //   기존 form 흐름과 병행 — 사용자가 자연어로 입력 시 즉시 AI 변환 + 매칭 수 + 샘플 5건 표시.
  //   적용 시 = CT-01 호환 filter → /api/customers/extract → onExtracted 직접 호출.
  //   0건 매칭 = "조건을 정정해주세요" 안내만 (자동 완화 X — D171 영구 룰).
  const [aiNlMode, setAiNlMode] = useState(false);
  const [aiNlInput, setAiNlInput] = useState('');
  const [aiNlGenerating, setAiNlGenerating] = useState(false);
  const [aiNlResult, setAiNlResult] = useState<{
    filter: any;
    explanation: string;
    matchCount: number;
    samples: Array<{ id: string; phone: string; name: string | null; gender: string | null; region: string | null; last_purchase_date: string | null; total_purchase_amount: number | null; [extra: string]: unknown }>;
    /** ★ 2026-08-08 (임은지 접수) filter가 참조한 조건 필드 — 샘플 추가 열·추출 meta의 축(서버 FIELD_MAP 파생) */
    sampleFields: Array<{ field_key: string; display_name: string; data_type: string; category: string }>;
  } | null>(null);
  const [aiNlError, setAiNlError] = useState<string | null>(null);
  const [aiNlExtracting, setAiNlExtracting] = useState(false);

  const AI_NL_EXAMPLES = [
    '30일 안 구매하지 않은 30대 여성',
    'VIP 등급 + 누적 구매 100만원 이상',
    '서울 거주 + 최근 3개월 안 1회 이상 구매한 고객',
    '결혼기념일이 이번 달인 고객',
  ];

  const handleAiNlGenerate = async () => {
    if (!aiNlInput.trim()) {
      setAiNlError('조건을 자연어로 입력해주세요.');
      return;
    }
    setAiNlGenerating(true);
    setAiNlError(null);
    setAiNlResult(null);
    try {
      const token = localStorage.getItem('token');
      const res = await fetch('/api/customers/generate-from-text', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ naturalLanguage: aiNlInput.trim() }),
      });
      const data = await res.json();
      if (!res.ok) {
        setAiNlError(data?.error || 'AI 변환 실패');
        return;
      }
      setAiNlResult({
        filter: data.filter,
        explanation: data.explanation,
        matchCount: data.matchCount,
        samples: data.samples || [],
        sampleFields: data.sampleFields || [],
      });
    } catch (e: any) {
      setAiNlError(e?.message || 'AI 변환 실패');
    } finally {
      setAiNlGenerating(false);
    }
  };

  const handleAiNlApply = async () => {
    if (!aiNlResult || aiNlResult.matchCount === 0) return;
    setAiNlExtracting(true);
    try {
      const token = localStorage.getItem('token');
      const res = await fetch('/api/customers/extract', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ dynamicFilters: aiNlResult.filter, smsOptIn: true, phoneField: 'phone' }),
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        showAlert('타겟 추출 실패', errData.error || '서버 오류', 'error');
        return;
      }
      const data = await res.json();
      if (data.success && data.recipients) {
        // ★ 2026-08-08 (임은지 접수 08-05) AI 자연어 모드도 필드 meta를 전달한다 — 축은 filter의 키 하나다
        //   ({ field: { operator, value } } 구조라 그 키가 곧 조건 필드고, extract 응답 행에 같은 키로 값이
        //   실려 온다). 라벨은 회사 스키마(enabledFields — FIELD_MAP displayName 파생) 우선, 없으면
        //   서버가 준 FIELD_MAP 라벨(sampleFields). phone은 항상 포함(수동 모드와 같은 규약).
        const filterKeys = Object.keys(aiNlResult.filter || {}).filter((k) => k !== 'sms_opt_in' && k !== 'phone');
        const meta: FieldMeta[] = ['phone', ...filterKeys].map((key) => {
          const ef = enabledFields.find((f: any) => f.field_key === key);
          const sf = (aiNlResult.sampleFields || []).find((f) => f.field_key === key);
          const displayName = ef?.display_name || sf?.display_name || key;
          return {
            field_key: key,
            display_name: displayName,
            variable: `%${displayName}%`,
            data_type: ef?.data_type || sf?.data_type || 'string',
            category: ef?.category || sf?.category || 'basic',
          };
        });
        onExtracted(data.recipients, data.count, meta, undefined, extractedPhoneFields);
      } else {
        showAlert('타겟 추출 실패', data.error || '데이터 추출 실패', 'warning');
      }
    } catch (err: any) {
      showAlert('네트워크 오류', err?.message || '서버 연결 실패', 'error');
    } finally {
      setAiNlExtracting(false);
    }
  };

  const resetAiNlMode = () => {
    setAiNlInput('');
    setAiNlResult(null);
    setAiNlError(null);
  };

  // ★ 2026-08-08 조건 필드 라벨 — 회사 스키마(enabledFields, FIELD_MAP displayName 파생) 우선,
  //   없으면 서버가 준 FIELD_MAP 라벨. 별도 라벨 표를 두지 않는다(단일소스 규약).
  const aiNlFieldLabel = (f: { field_key: string; display_name: string }) =>
    enabledFields.find((e: any) => e.field_key === f.field_key)?.display_name || f.display_name || f.field_key;

  // 카테고리 아이콘(lucide). 이모지는 화면마다 크기·정렬이 달라져 2026-08-21 표면 리프트에서 걷어냈다.
  const CAT_ICONS: Record<string, LucideIcon> = {
    basic: ClipboardList, purchase: ShoppingBag, store: Store,
    membership: Tag, marketing: Smartphone, custom: Wrench,
  };

  // 프리셋
  const AGE_PRESETS = [
    { label: '10대', value: '10' }, { label: '20대', value: '20' },
    { label: '30대', value: '30' }, { label: '40대', value: '40' },
    { label: '50대', value: '50' }, { label: '60+', value: '60' },
  ];
  const DAYS_PRESETS = [
    { label: '7일', value: '7' }, { label: '30일', value: '30' },
    { label: '90일', value: '90' }, { label: '180일', value: '180' },
    { label: '1년', value: '365' },
  ];
  const BIRTH_MONTH_PRESETS = [
    { label: '1월', value: 'month:1' }, { label: '2월', value: 'month:2' }, { label: '3월', value: 'month:3' },
    { label: '4월', value: 'month:4' }, { label: '5월', value: 'month:5' }, { label: '6월', value: 'month:6' },
    { label: '7월', value: 'month:7' }, { label: '8월', value: 'month:8' }, { label: '9월', value: 'month:9' },
    { label: '10월', value: 'month:10' }, { label: '11월', value: 'month:11' }, { label: '12월', value: 'month:12' },
  ];
  const POINTS_PRESETS = [
    { label: '100↑', value: '100' }, { label: '1천↑', value: '1000' },
    { label: '5천↑', value: '5000' }, { label: '1만↑', value: '10000' },
    { label: '5만↑', value: '50000' },
  ];

  // ★ D111 E1: 인라인 GENDER_DISPLAY_MAP 제거 → FRONT_FIELD_DISPLAY_MAP 컨트롤타워 사용
  //   '0':'여성' 같은 모호한 매핑 제거. 오타 패턴('giender','gneder')도 제거 — FIELD_MAP 표준 field_key 기준.
  const isGenderField = (key: string) => !!FRONT_FIELD_DISPLAY_MAP[key];
  const getGenderLabel = (val: string) => reverseDisplayValueFront('gender', val);


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
        if (data.phoneFields) setExtractedPhoneFields(data.phoneFields);
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
  // ★ D104: selectedFields 순회로 변경 — filterValues에 본 키가 없어도 _min/_max 참조 가능
  const buildDynamicFiltersForAPI = () => {
    const filters: Record<string, any> = {};
    let smsOptIn = false;

    const dbColMap: Record<string, string> = {
      'last_purchase_date': 'recent_purchase_date',
      'last_purchase_amount': 'recent_purchase_amount'
    };

    for (const fieldKey of selectedFields) {
      const field = enabledFields.find((f: any) => f.field_key === fieldKey);
      if (!field) continue;
      const value = filterValues[fieldKey];

      // sms_opt_in 별도 처리
      if (fieldKey === 'sms_opt_in' || fieldKey === 'opt_in_sms') {
        smsOptIn = value === 'true';
        continue;
      }

      // 연령 특수 처리
      if (fieldKey === 'age') {
        if (value?.mode === 'preset' && value.presets?.length > 0) {
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
        } else if (value?.mode === 'range') {
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

      // 숫자 — 범위 (min ~ max) ★ filterValues에 본 키 없어도 _min/_max로 처리
      if (field.data_type === 'number' && fieldKey !== 'age') {
        const dbCol = dbColMap[fieldKey] || fieldKey;
        const minVal = filterValues[`${fieldKey}_min`];
        const maxVal = filterValues[`${fieldKey}_max`];
        if (minVal && maxVal) {
          filters[dbCol] = { operator: 'between', value: [Number(minVal), Number(maxVal)] };
        } else if (minVal) {
          filters[dbCol] = { operator: 'gte', value: Number(minVal) };
        } else if (maxVal) {
          filters[dbCol] = { operator: 'lte', value: Number(maxVal) };
        }
        continue;
      }

      // 날짜 필드
      if (field.data_type === 'date') {
        if (!value) continue;
        const dbCol = dbColMap[fieldKey] || fieldKey;
        if (typeof value === 'string' && value.startsWith('month:')) {
          filters[dbCol] = { operator: 'birth_month', value: parseInt(value.replace('month:', '')) };
        } else {
          filters[dbCol] = { operator: 'days_within', value: parseInt(value) };
        }
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

  // ★ D43-3c: 타겟 추출 — fieldsMeta 구성하여 전달
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
        // ★ 선택된 필드의 메타 정보 구성 (phone은 항상 포함)
        const selectedKeys = new Set(selectedFields);
        selectedKeys.add('phone'); // phone 항상 포함
        const meta: FieldMeta[] = enabledFields
          .filter((f: any) => selectedKeys.has(f.field_key))
          .map((f: any) => ({
            field_key: f.field_key,
            display_name: f.display_name || f.field_key,
            variable: `%${f.display_name || f.field_key}%`,
            data_type: f.data_type || 'string',
            category: f.category || 'basic',
          }));
        onExtracted(data.recipients, data.count, meta, undefined, extractedPhoneFields);
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
              className={`px-2.5 py-1 text-xs rounded-lg font-medium transition-all ${age.mode === 'preset' ? 'bg-indigo-600 text-white' : 'bg-neutral-100 text-neutral-500 hover:bg-neutral-200'}`}
            >연령대</button>
            <button onClick={() => setAgeMode('range')}
              className={`px-2.5 py-1 text-xs rounded-lg font-medium transition-all ${age.mode === 'range' ? 'bg-indigo-600 text-white' : 'bg-neutral-100 text-neutral-500 hover:bg-neutral-200'}`}
            >직접입력</button>
            {rangeText && <span className="text-xs text-indigo-600 font-medium ml-1">→ {rangeText}</span>}
          </div>
          {age.mode === 'preset' && (
            <div className="flex flex-wrap gap-1.5">
              {AGE_PRESETS.map(p => {
                const sel = (age.presets || []).includes(p.value);
                return (
                  <button key={p.value} onClick={() => toggleAgePreset(p.value)}
                    className={`px-2.5 py-1 text-xs rounded-lg font-medium transition-all ${sel ? 'bg-indigo-600 text-white shadow-sm' : 'bg-neutral-100 text-neutral-600 hover:bg-neutral-200'}`}
                  >{p.label}</button>
                );
              })}
            </div>
          )}
          {age.mode === 'range' && (
            <div className="flex items-center gap-1.5">
              <input type="number" value={age.min || ''} onChange={e => setAgeRange('min', e.target.value)}
                placeholder="최소" className="w-16 px-2 py-1 border border-neutral-200 rounded-lg text-sm text-center focus:outline-none focus:ring-2 focus:ring-indigo-600/20 focus:border-indigo-600" />
              <span className="text-xs text-neutral-400">~</span>
              <input type="number" value={age.max || ''} onChange={e => setAgeRange('max', e.target.value)}
                placeholder="최대" className="w-16 px-2 py-1 border border-neutral-200 rounded-lg text-sm text-center focus:outline-none focus:ring-2 focus:ring-indigo-600/20 focus:border-indigo-600" />
              <span className="text-xs text-neutral-400">세</span>
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
            className={`px-3 py-1 text-xs rounded-lg font-medium transition-all ${val === 'true' ? 'bg-indigo-600 text-white' : 'bg-neutral-100 text-neutral-500 hover:bg-neutral-200'}`}
          >예</button>
          <button onClick={() => setFilterValues(prev => ({ ...prev, [fk]: 'false' }))}
            className={`px-3 py-1 text-xs rounded-lg font-medium transition-all ${val === 'false' ? 'bg-indigo-600 text-white' : 'bg-neutral-100 text-neutral-500 hover:bg-neutral-200'}`}
          >아니오</button>
        </div>
      );
    }

    // 문자열 + 옵션 → 다중 태그
    if (field.data_type === 'string' && filterOptions[fk]?.length > 0) {
      const selected: string[] = Array.isArray(filterValues[fk]) ? filterValues[fk] : [];
      // 성별 표시 변환 (DB값 → 한글) — 다양한 변수명 자동 감지
      const getDisplayLabel = (opt: string) => isGenderField(fk) ? getGenderLabel(opt) : opt;
      const allOpts = filterOptions[fk];
      const MAX_INLINE = 15; // ★ B17-14: 15개 초과 시 스크롤 영역 + 검색

      if (allOpts.length > MAX_INLINE) {
        // 대량 옵션: 스크롤 영역 + 검색
        const searchKey = `__search_${fk}`;
        const searchTerm = (filterValues[searchKey] || '').toLowerCase();
        const filtered = searchTerm
          ? allOpts.filter((o: string) => getDisplayLabel(o).toLowerCase().includes(searchTerm))
          : allOpts;
        return (
          <div className="mt-1.5">
            <input
              type="text" placeholder={`검색 (${allOpts.length}개 중)...`}
              value={filterValues[searchKey] || ''}
              onChange={(e) => setFilterValues(prev => ({ ...prev, [searchKey]: e.target.value }))}
              className="w-full px-2.5 py-1.5 text-xs border border-neutral-200 rounded-lg mb-1.5 focus:outline-none focus:ring-2 focus:ring-indigo-600/20"
            />
            {selected.length > 0 && (
              <div className="text-[10px] text-indigo-600 mb-1">{selected.length}개 선택됨</div>
            )}
            <div className="flex flex-wrap gap-1.5 max-h-[120px] overflow-y-auto pr-1">
              {filtered.map((opt: string) => {
                const sel = selected.includes(opt);
                return (
                  <button key={opt} onClick={() => toggleMultiOption(fk, opt)}
                    className={`px-2.5 py-1 text-xs rounded-lg font-medium transition-all ${sel ? 'bg-indigo-600 text-white shadow-sm' : 'bg-neutral-100 text-neutral-600 hover:bg-neutral-200'}`}
                  >{getDisplayLabel(opt)}</button>
                );
              })}
            </div>
          </div>
        );
      }

      return (
        <div className="flex flex-wrap gap-1.5 mt-1.5">
          {allOpts.map((opt: string) => {
            const sel = selected.includes(opt);
            return (
              <button key={opt} onClick={() => toggleMultiOption(fk, opt)}
                className={`px-2.5 py-1 text-xs rounded-lg font-medium transition-all ${sel ? 'bg-indigo-600 text-white shadow-sm' : 'bg-neutral-100 text-neutral-600 hover:bg-neutral-200'}`}
              >{getDisplayLabel(opt)}</button>
            );
          })}
        </div>
      );
    }

    // 포인트 → 프리셋 태그 + 범위 입력 (누적구매금액과 동일 UX)
    if (field.data_type === 'number' && fk === 'points') {
      const minKey = `${fk}_min`;
      const maxKey = `${fk}_max`;
      return (
        <div className="mt-1.5 space-y-2">
          <div className="flex flex-wrap gap-1.5">
            {POINTS_PRESETS.map(p => (
              <button key={p.value} onClick={() => setFilterValues(prev => ({ ...prev, [minKey]: prev[minKey] === p.value ? '' : p.value, [maxKey]: '' }))}
                className={`px-2.5 py-1 text-xs rounded-lg font-medium transition-all ${filterValues[minKey] === p.value && !filterValues[maxKey] ? 'bg-indigo-600 text-white shadow-sm' : 'bg-neutral-100 text-neutral-600 hover:bg-neutral-200'}`}
              >{p.label}</button>
            ))}
          </div>
          <div className="flex items-center gap-1.5">
            <input type="text" inputMode="numeric" value={filterValues[minKey] ? Number(filterValues[minKey]).toLocaleString() : ''}
              onChange={e => { const num = e.target.value.replace(/[^0-9]/g, ''); setFilterValues(prev => ({ ...prev, [minKey]: num })); }}
              placeholder="최소" className="flex-1 px-2.5 py-1.5 border border-neutral-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-600/20 focus:border-indigo-600" />
            <span className="text-neutral-400 text-sm font-medium">~</span>
            <input type="text" inputMode="numeric" value={filterValues[maxKey] ? Number(filterValues[maxKey]).toLocaleString() : ''}
              onChange={e => { const num = e.target.value.replace(/[^0-9]/g, ''); setFilterValues(prev => ({ ...prev, [maxKey]: num })); }}
              placeholder="최대" className="flex-1 px-2.5 py-1.5 border border-neutral-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-600/20 focus:border-indigo-600" />
          </div>
        </div>
      );
    }

    // 숫자 → 범위 입력 (최소 ~ 최대)
    if (field.data_type === 'number') {
      const minKey = `${fk}_min`;
      const maxKey = `${fk}_max`;
      const isAmount = ['total_purchase_amount', 'recent_purchase_amount', 'avg_order_value'].some(k => fk.includes(k) || fk.includes('amount') || fk.includes('금액') || fk.includes('price') || fk.includes('가격'));
      const unit = isAmount ? '원' : '';
      const minPlaceholder = isAmount ? '예) 200,000' : '최소';
      const maxPlaceholder = isAmount ? '예) 500,000' : '최대';
      return (
        <div className="mt-1.5">
          <div className="flex items-center gap-1.5">
            <div className="flex-1 relative">
              <input type="text" inputMode="numeric" value={filterValues[minKey] ? Number(filterValues[minKey]).toLocaleString() : ''}
                onChange={e => { const num = e.target.value.replace(/[^0-9]/g, ''); setFilterValues(prev => ({ ...prev, [minKey]: num })); }}
                placeholder={minPlaceholder}
                className="w-full px-2.5 py-1.5 border border-neutral-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-600/20 focus:border-indigo-600 pr-8" />
              {unit && <span className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-neutral-400">{unit}</span>}
            </div>
            <span className="text-neutral-400 text-sm font-medium">~</span>
            <div className="flex-1 relative">
              <input type="text" inputMode="numeric" value={filterValues[maxKey] ? Number(filterValues[maxKey]).toLocaleString() : ''}
                onChange={e => { const num = e.target.value.replace(/[^0-9]/g, ''); setFilterValues(prev => ({ ...prev, [maxKey]: num })); }}
                placeholder={maxPlaceholder}
                className="w-full px-2.5 py-1.5 border border-neutral-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-600/20 focus:border-indigo-600 pr-8" />
              {unit && <span className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-neutral-400">{unit}</span>}
            </div>
          </div>
          {isAmount && (
            <div className="flex gap-1 mt-1.5">
              {[{l:'10만',v:100000},{l:'50만',v:500000},{l:'100만',v:1000000},{l:'500만',v:5000000}].map(p => (
                <button key={p.v} type="button" onClick={() => setFilterValues(prev => ({ ...prev, [minKey]: String(p.v) }))}
                  className={`px-2 py-0.5 text-[10px] rounded font-medium transition-all ${filterValues[minKey] === String(p.v) ? 'bg-indigo-50 text-indigo-700 border border-indigo-200' : 'bg-white text-neutral-500 border border-neutral-200 hover:bg-neutral-50'}`}
                >{p.l}↑</button>
              ))}
            </div>
          )}
        </div>
      );
    }

    // 날짜 → 생일이면 월 프리셋, 그 외 기간 프리셋
    if (field.data_type === 'date') {
      const val = filterValues[fk] || '';
      const isBirthday = fk === 'birthday' || fk === 'birth_date';
      const presets = isBirthday ? BIRTH_MONTH_PRESETS : DAYS_PRESETS;
      return (
        <div className="flex flex-wrap gap-1.5 mt-1.5">
          {presets.map(p => (
            <button key={p.value} onClick={() => setFilterValues(prev => ({ ...prev, [fk]: prev[fk] === p.value ? '' : p.value }))}
              className={`px-2.5 py-1 text-xs rounded-lg font-medium transition-all ${val === p.value ? 'bg-indigo-600 text-white shadow-sm' : 'bg-neutral-100 text-neutral-600 hover:bg-neutral-200'}`}
            >{p.label}</button>
          ))}
        </div>
      );
    }

    // 문자열 (옵션 없음) → 포함 검색
    return (
      <input type="text" value={filterValues[fk] || ''} onChange={e => setFilterValues(prev => ({ ...prev, [fk]: e.target.value }))}
        placeholder="포함하는 값 입력" className="mt-1.5 w-full px-2.5 py-1.5 border border-neutral-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-600/20 focus:border-indigo-600" />
    );
  };

  // ============ 필터 값 유무 ============

  const hasFilterValue = (fk: string) => {
    if (!selectedFields.has(fk)) return false;
    // 숫자 범위: _min 또는 _max 중 하나라도 있으면 활성
    const field = enabledFields.find((f: any) => f.field_key === fk);
    if (field?.data_type === 'number' && fk !== 'age') {
      return !!(filterValues[`${fk}_min`] || filterValues[`${fk}_max`]);
    }
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

  // ★ 2026-08-21 표면 리프트(인디고): 기능·state·핸들러는 그대로, 표면만 콘솔 톤(CUI_*)으로.
  //   이모지 섹션 아이콘 → lucide, 회색 체크박스 → 카드형 선택(CUI_PICK), 초록 액센트 → 인디고.
  //   스크림·박스에 transform·backdrop-blur를 두지 않는다(console-ui.ts CUI_MODAL 주석의 ⛔).
  const SEG_ON = 'flex-1 h-9 rounded-lg text-[13px] font-semibold text-indigo-700 bg-white shadow-sm inline-flex items-center justify-center gap-1.5 transition';
  const SEG_OFF = 'flex-1 h-9 rounded-lg text-[13px] font-medium text-neutral-500 hover:text-neutral-900 inline-flex items-center justify-center gap-1.5 transition';
  const alertTone = alertModal.type === 'error'
    ? { ring: 'bg-rose-50 text-rose-600', btn: CUI_BTN_DANGER, Icon: AlertCircle }
    : alertModal.type === 'warning'
      ? { ring: 'bg-amber-50 text-amber-600', btn: `${CUI_BTN_PRIMARY} !bg-amber-500 hover:!bg-amber-600`, Icon: AlertTriangle }
      : { ring: 'bg-indigo-50 text-indigo-600', btn: CUI_BTN_PRIMARY, Icon: Info };

  return (
    <>
    <div className={CUI_MODAL_SCRIM}>
      <div className={`${CUI_MODAL} max-w-[760px]`} role="dialog" aria-modal="true" aria-label="직접 타겟 설정">
        {/* 헤더 */}
        <div className={CUI_MODAL_HEAD}>
          <div className="flex items-center gap-3.5 min-w-0">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-500 to-violet-500 flex items-center justify-center shrink-0 shadow-lg shadow-indigo-500/25">
              <Filter className="w-5 h-5 text-white" />
            </div>
            <div className="min-w-0">
              <h3 className={CUI_MODAL_TITLE}>직접 타겟 설정</h3>
              <p className={CUI_MODAL_DESC}>필터할 항목을 고르고 조건을 정하면 대상 인원을 바로 셉니다</p>
            </div>
          </div>
          <button type="button" onClick={handleClose} className={CUI_MODAL_CLOSE} aria-label="닫기">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* 모드 전환: 직접 설정 / AI 자연어 */}
        <div className="shrink-0 px-6 pt-4">
          <div className="flex p-1 rounded-xl bg-neutral-100">
            <button type="button" onClick={() => setAiNlMode(false)} className={!aiNlMode ? SEG_ON : SEG_OFF}>
              <Filter className="w-3.5 h-3.5" />
              필터 조건 직접 설정
            </button>
            <button type="button" onClick={() => setAiNlMode(true)} className={aiNlMode ? SEG_ON : SEG_OFF}>
              <Sparkles className="w-3.5 h-3.5" />
              AI 자연어 모드
              <span className="ml-0.5 text-[10px] font-bold px-1.5 py-px rounded bg-indigo-100 text-indigo-700">NEW</span>
            </button>
          </div>
        </div>

        {aiNlMode ? (
          <div className={CUI_MODAL_BODY}>
            <div className={CUI_INFO}>
              <Sparkles className={`w-4 h-4 ${CUI_INFO_ICON}`} />
              <div className={CUI_INFO_TEXT}>
                <p className="font-semibold">자연어로 고객 추출</p>
                <p className="mt-0.5 text-indigo-900/80">조건을 말로 적으면 AI가 검증된 필터로 바꿉니다. 매칭 수와 샘플 5건을 먼저 보여 드립니다.</p>
              </div>
            </div>

            <div>
              <p className={CUI_LABEL}>빠른 시작 예시</p>
              <div className="flex flex-wrap gap-1.5">
                {AI_NL_EXAMPLES.map((p) => (
                  <button
                    key={p}
                    type="button"
                    onClick={() => setAiNlInput(p)}
                    className="h-8 px-3 rounded-lg bg-neutral-100 text-[12.5px] text-neutral-700 hover:bg-indigo-50 hover:text-indigo-700 transition"
                  >
                    {p}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className={CUI_LABEL}>조건 자연어 입력</label>
              <textarea
                value={aiNlInput}
                onChange={(e) => setAiNlInput(e.target.value)}
                placeholder="예: 30일 안 구매하지 않은 30대 여성"
                className={CUI_TEXTAREA}
                rows={3}
                disabled={aiNlGenerating || aiNlExtracting}
              />
              <div className="mt-2 flex items-center justify-between gap-3">
                <p className={`${CUI_HINT} !mt-0`}>검증된 필터만 씁니다. 조건 밖 고객은 들어오지 않습니다.</p>
                <button
                  type="button"
                  onClick={handleAiNlGenerate}
                  disabled={!aiNlInput.trim() || aiNlGenerating || aiNlExtracting}
                  className={CUI_BTN_PRIMARY}
                >
                  {aiNlGenerating ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
                  {aiNlGenerating ? 'AI 변환 중' : 'AI 변환'}
                </button>
              </div>
            </div>

            {aiNlError && (
              <div className={CUI_DANGER_BOX}>
                <AlertCircle className={`w-4 h-4 ${CUI_DANGER_ICON}`} />
                <p className={CUI_DANGER_TEXT}>{aiNlError}</p>
              </div>
            )}

            {aiNlResult && (
              <div className="space-y-4">
                <div className="rounded-xl border border-indigo-600/15 bg-indigo-50 p-4 flex items-start gap-3.5">
                  <div className="h-10 w-10 rounded-xl bg-white grid place-items-center text-indigo-600 ring-1 ring-indigo-600/15 shrink-0">
                    <Users className="w-5 h-5" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-[12px] text-indigo-700/70">매칭 결과</p>
                    <p className="text-2xl font-bold text-indigo-700 tabular-nums leading-tight">{aiNlResult.matchCount.toLocaleString()}<span className="text-sm font-medium text-indigo-700/70 ml-1">명</span></p>
                    <p className="text-[12.5px] text-indigo-900/80 mt-1.5 leading-relaxed"><span className="font-semibold">AI 해석:</span> {aiNlResult.explanation}</p>
                  </div>
                </div>

                {aiNlResult.samples.length > 0 && (
                  <div>
                    <div className="flex items-center gap-1.5 mb-2">
                      <Eye className="w-3.5 h-3.5 text-neutral-400" />
                      <p className={CUI_FIELDSET_TITLE}>샘플 5건 미리보기</p>
                    </div>
                    <div className={CUI_PANEL}>
                      <div className={CUI_SCROLL_X}>
                        <table className="w-full">
                          <thead className={CUI_THEAD}>
                            <tr>
                              <th className={CUI_TH}>전화번호</th>
                              <th className={CUI_TH}>이름</th>
                              <th className={CUI_TH}>성별</th>
                              <th className={CUI_TH}>지역</th>
                              {aiNlResult.sampleFields.map((f) => (
                                <th key={f.field_key} className={`${CUI_TH} text-indigo-600`}>{aiNlFieldLabel(f)}</th>
                              ))}
                              <th className={CUI_TH_RIGHT}>누적구매</th>
                            </tr>
                          </thead>
                          <tbody>
                            {aiNlResult.samples.map((s) => (
                              <tr key={s.id} className={CUI_TR}>
                                <td className={`${CUI_TD} ${CUI_CELL_CODE}`}>{s.phone}</td>
                                <td className={`${CUI_TD} ${CUI_CELL_DATA}`}>{s.name || '-'}</td>
                                <td className={`${CUI_TD} ${CUI_CELL_META}`}>{s.gender || '-'}</td>
                                <td className={`${CUI_TD} ${CUI_CELL_META}`}>{s.region || '-'}</td>
                                {aiNlResult.sampleFields.map((f) => (
                                  <td key={f.field_key} className={`${CUI_TD} ${CUI_CELL_DATA}`}>
                                    {s[f.field_key] != null && s[f.field_key] !== '' ? String(s[f.field_key]) : '-'}
                                  </td>
                                ))}
                                <td className={`${CUI_TD} ${CUI_CELL_META} text-right`}>{s.total_purchase_amount?.toLocaleString() || '-'}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </div>
                )}

                {aiNlResult.matchCount === 0 && (
                  <div className={`${CUI_NOTICE} !mt-0`}>
                    <AlertTriangle className={`w-4 h-4 ${CUI_NOTICE_ICON}`} />
                    <p className={CUI_NOTICE_TEXT}>매칭되는 고객이 0명입니다. 조건을 더 넓혀 주세요. 자동 완화는 마케팅 의도를 지키기 위해 하지 않습니다.</p>
                  </div>
                )}

                <div className="flex items-center gap-2 pt-1">
                  <button type="button" onClick={resetAiNlMode} disabled={aiNlExtracting} className={CUI_BTN_GHOST}>
                    다시 입력
                  </button>
                  <button
                    type="button"
                    onClick={handleAiNlApply}
                    disabled={aiNlResult.matchCount === 0 || aiNlExtracting}
                    className={`${CUI_BTN_PRIMARY} flex-1 justify-center h-10`}
                  >
                    {aiNlExtracting ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                    {aiNlExtracting ? '추출 중' : `이대로 ${aiNlResult.matchCount.toLocaleString()}명 추출`}
                  </button>
                </div>

                <p className="text-[10px] text-neutral-400 italic text-center">Data source: AI 자연어 변환 + 검증된 필터 빌더 (조건 밖 고객 0)</p>
              </div>
            )}
          </div>
        ) : (
        <>
        <div className={CUI_MODAL_BODY}>
          {/* 필터 헤더 바 */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className={CUI_FIELDSET_TITLE}>필터 조건</span>
              {activeFilterCount > 0 && (
                <span className={`${CUI_PILL_BASE} bg-indigo-100 text-indigo-700`}>{activeFilterCount}개 설정</span>
              )}
            </div>
            <button type="button" onClick={resetAll} className={`${CUI_BTN_GHOST} h-8 px-2.5 text-[12.5px]`}>
              <RotateCcw className="w-3.5 h-3.5" />
              초기화
            </button>
          </div>

          {!fieldsLoaded ? (
            <div className={CUI_LOADING}>
              <div className={CUI_SPINNER} />
              <div>필드를 불러오는 중</div>
            </div>
          ) : allFields.length === 0 ? (
            <div className={CUI_EMPTY}>
              <div className={CUI_EMPTY_BADGE}><Users className="w-5 h-5" /></div>
              <div className={CUI_EMPTY_TITLE}>고객 데이터가 아직 없습니다</div>
              <div className={CUI_EMPTY_DESC}>고객 관리에서 파일을 올리거나 자사몰을 연동하면 필터 항목이 여기에 나타납니다.</div>
            </div>
          ) : (
            <div className="space-y-2.5">
              {allCategories.map(cat => {
                const catFields = allFields.filter((f: any) => f.category === cat);
                if (catFields.length === 0) return null;

                const CatIcon = CAT_ICONS[cat] || Pin;
                const selectedInCat = catFields.filter((f: any) => hasFilterValue(f.field_key)).length;
                const isExpanded = expandedCats[cat] ?? false;

                return (
                  <div key={cat} className="rounded-xl border border-neutral-200 bg-white overflow-hidden">
                    <button type="button"
                      onClick={() => setExpandedCats(prev => ({ ...prev, [cat]: !prev[cat] }))}
                      className="w-full h-12 px-4 flex items-center justify-between hover:bg-neutral-50 transition-colors">
                      <div className="flex items-center gap-2.5">
                        <span className="h-7 w-7 rounded-lg bg-indigo-50 text-indigo-600 grid place-items-center">
                          <CatIcon className="w-4 h-4" />
                        </span>
                        <span className="text-[13.5px] font-semibold text-neutral-900">{categoryLabels[cat] || cat}</span>
                        <span className="text-[12px] text-neutral-400 tabular-nums">{catFields.length}</span>
                        {selectedInCat > 0 && (
                          <span className="h-5 min-w-[20px] px-1.5 rounded-full bg-indigo-600 text-white text-[11px] font-bold grid place-items-center tabular-nums">{selectedInCat}</span>
                        )}
                      </div>
                      <ChevronDown className={`w-4 h-4 text-neutral-400 transition-transform duration-200 ${isExpanded ? 'rotate-180' : ''}`} />
                    </button>

                    {isExpanded && (
                      <div className="p-3 border-t border-neutral-100 grid grid-cols-1 sm:grid-cols-2 gap-2">
                        {catFields.map((field: any) => {
                          const fk = field.field_key;
                          const isSelected = selectedFields.has(fk);
                          const hasValue = hasFilterValue(fk);
                          const needsWide = isSelected && field.data_type === 'number' && fk !== 'age';
                          return (
                            <div key={fk} className={`${isSelected ? CUI_PICK_ON : CUI_PICK_OFF} ${needsWide ? 'sm:col-span-2' : ''}`}>
                              <label className="flex items-center gap-2.5 cursor-pointer select-none">
                                <input type="checkbox" checked={isSelected} onChange={() => toggleField(fk)} className="sr-only" />
                                <span className={`h-4 w-4 rounded border grid place-items-center shrink-0 transition ${isSelected ? 'bg-indigo-600 border-indigo-600 text-white' : 'bg-white border-neutral-300'}`}>
                                  {isSelected && <Check className="w-3 h-3" strokeWidth={3} />}
                                </span>
                                <span className={`text-[13px] ${isSelected ? 'font-semibold text-indigo-900' : 'font-medium text-neutral-700'}`}>{field.display_name}</span>
                                {hasValue && (
                                  <span className="ml-auto text-[10.5px] font-semibold px-1.5 py-px rounded bg-indigo-600 text-white">설정</span>
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

          <button type="button" onClick={loadTargetCount} disabled={countLoading}
            className={`${CUI_BTN_OUTLINE} w-full h-11 justify-center text-[14px] text-indigo-700 border-indigo-200 hover:bg-indigo-50 hover:border-indigo-300`}>
            {countLoading ? <div className={CUI_SPINNER} /> : <Search className="w-4 h-4" />}
            {countLoading ? '조회 중' : '대상 인원 조회'}
          </button>
        </div>

        {/* 푸터 */}
        <div className="shrink-0 px-6 py-4 border-t border-neutral-200 bg-neutral-50 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-white ring-1 ring-indigo-600/15 text-indigo-600 grid place-items-center">
              <Users className="w-4.5 h-4.5" />
            </div>
            <div>
              <div className="text-[12px] text-neutral-500">대상 인원</div>
              <div className="text-xl font-bold text-neutral-900 tabular-nums leading-tight">
                {countLoading ? '...' : targetCount.toLocaleString()}
                <span className="text-[13px] font-medium text-neutral-500 ml-1">명</span>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button type="button" onClick={handleClose} className={CUI_BTN_OUTLINE}>취소</button>
            <button type="button" onClick={handleExtract} disabled={targetCount === 0 || extracting} className={`${CUI_BTN_PRIMARY} px-5`}>
              {extracting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Users className="w-4 h-4" />}
              {extracting ? '추출 중' : '타겟 추출'}
            </button>
          </div>
        </div>
        </>
        )}
      </div>
    </div>

    {/* 알림 모달(커스텀, native dialog 아님) */}
    {alertModal.show && (
      <div className={`${CUI_MODAL_SCRIM} z-[60]`}>
        <div className={`${CUI_MODAL} max-w-sm`} role="alertdialog" aria-modal="true" aria-label={alertModal.title}>
          <div className="px-6 pt-7 pb-5 text-center">
            <div className={`h-12 w-12 mx-auto mb-3 rounded-2xl grid place-items-center ${alertTone.ring}`}>
              <alertTone.Icon className="w-6 h-6" />
            </div>
            <h4 className={CUI_MODAL_TITLE}>{alertModal.title}</h4>
            <p className="mt-1.5 text-[13px] text-neutral-500 leading-relaxed">{alertModal.message}</p>
          </div>
          <div className="px-6 pb-6">
            <button type="button" onClick={() => setAlertModal(prev => ({ ...prev, show: false }))} className={`${alertTone.btn} w-full h-10 justify-center`}>확인</button>
          </div>
        </div>
      </div>
    )}
    </>
  );
}
