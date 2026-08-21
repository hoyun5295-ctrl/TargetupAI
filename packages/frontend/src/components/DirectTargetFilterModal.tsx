import { Filter, RotateCcw, Search, Users, Sparkles, RefreshCw, AlertCircle, Check, Eye } from 'lucide-react';
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
              className="w-full px-2.5 py-1.5 text-xs border rounded-md mb-1.5 focus:outline-none focus:ring-1 focus:ring-green-400"
            />
            {selected.length > 0 && (
              <div className="text-[10px] text-green-600 mb-1">{selected.length}개 선택됨</div>
            )}
            <div className="flex flex-wrap gap-1.5 max-h-[120px] overflow-y-auto pr-1">
              {filtered.map((opt: string) => {
                const sel = selected.includes(opt);
                return (
                  <button key={opt} onClick={() => toggleMultiOption(fk, opt)}
                    className={`px-2.5 py-1 text-xs rounded-md font-medium transition-all ${sel ? 'bg-green-600 text-white shadow-sm' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
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
                className={`px-2.5 py-1 text-xs rounded-md font-medium transition-all ${sel ? 'bg-green-600 text-white shadow-sm' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
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
                className={`px-2.5 py-1 text-xs rounded-md font-medium transition-all ${filterValues[minKey] === p.value && !filterValues[maxKey] ? 'bg-green-600 text-white shadow-sm' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
              >{p.label}</button>
            ))}
          </div>
          <div className="flex items-center gap-1.5">
            <input type="text" inputMode="numeric" value={filterValues[minKey] ? Number(filterValues[minKey]).toLocaleString() : ''}
              onChange={e => { const num = e.target.value.replace(/[^0-9]/g, ''); setFilterValues(prev => ({ ...prev, [minKey]: num })); }}
              placeholder="최소" className="flex-1 px-2.5 py-1.5 border border-gray-200 rounded-md text-sm focus:ring-1 focus:ring-green-500 focus:border-green-500" />
            <span className="text-gray-400 text-sm font-medium">~</span>
            <input type="text" inputMode="numeric" value={filterValues[maxKey] ? Number(filterValues[maxKey]).toLocaleString() : ''}
              onChange={e => { const num = e.target.value.replace(/[^0-9]/g, ''); setFilterValues(prev => ({ ...prev, [maxKey]: num })); }}
              placeholder="최대" className="flex-1 px-2.5 py-1.5 border border-gray-200 rounded-md text-sm focus:ring-1 focus:ring-green-500 focus:border-green-500" />
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
                className="w-full px-2.5 py-1.5 border border-gray-200 rounded-md text-sm focus:ring-1 focus:ring-green-500 focus:border-green-500 pr-8" />
              {unit && <span className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-gray-400">{unit}</span>}
            </div>
            <span className="text-gray-400 text-sm font-medium">~</span>
            <div className="flex-1 relative">
              <input type="text" inputMode="numeric" value={filterValues[maxKey] ? Number(filterValues[maxKey]).toLocaleString() : ''}
                onChange={e => { const num = e.target.value.replace(/[^0-9]/g, ''); setFilterValues(prev => ({ ...prev, [maxKey]: num })); }}
                placeholder={maxPlaceholder}
                className="w-full px-2.5 py-1.5 border border-gray-200 rounded-md text-sm focus:ring-1 focus:ring-green-500 focus:border-green-500 pr-8" />
              {unit && <span className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-gray-400">{unit}</span>}
            </div>
          </div>
          {isAmount && (
            <div className="flex gap-1 mt-1.5">
              {[{l:'10만',v:100000},{l:'50만',v:500000},{l:'100만',v:1000000},{l:'500만',v:5000000}].map(p => (
                <button key={p.v} type="button" onClick={() => setFilterValues(prev => ({ ...prev, [minKey]: String(p.v) }))}
                  className={`px-2 py-0.5 text-[10px] rounded font-medium transition-all ${filterValues[minKey] === String(p.v) ? 'bg-green-100 text-green-700 border border-green-300' : 'bg-gray-50 text-gray-500 border border-gray-200 hover:bg-gray-100'}`}
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

        {/* ★ D219+ Part 2 후속 (2026-05-27): AI 자연어 모드 토글 */}
        <div className="px-5 py-2.5 border-b border-violet-100 bg-gradient-to-r from-violet-50 to-fuchsia-50 flex items-center gap-2">
          <button
            onClick={() => setAiNlMode(false)}
            className={`flex-1 px-3 py-1.5 text-xs rounded-lg font-semibold transition-all ${!aiNlMode ? 'bg-white text-green-700 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
          >
            <Filter className="w-3.5 h-3.5 inline mr-1" />
            필터 조건 직접 설정
          </button>
          <button
            onClick={() => setAiNlMode(true)}
            className={`flex-1 px-3 py-1.5 text-xs rounded-lg font-semibold transition-all ${aiNlMode ? 'bg-gradient-to-r from-violet-500 to-fuchsia-500 text-white shadow-md' : 'text-violet-600 hover:text-violet-800'}`}
          >
            <Sparkles className="w-3.5 h-3.5 inline mr-1" />
            AI 자연어 모드
            <span className="ml-1 text-[9px] px-1 py-0.5 rounded bg-white/30 text-white font-bold">NEW</span>
          </button>
        </div>

        {/* ★ D219+ Part 2 후속: AI 자연어 모드 영역 */}
        {aiNlMode ? (
          <div className="p-4 space-y-3 overflow-y-auto max-h-[68vh]">
            {/* AI 안내 카드 */}
            <div className="rounded-xl border border-violet-200 bg-gradient-to-br from-violet-50 to-fuchsia-50 p-4">
              <div className="flex items-start gap-2.5">
                <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-violet-500 to-fuchsia-500 flex items-center justify-center flex-shrink-0">
                  <Sparkles className="w-5 h-5 text-white" />
                </div>
                <div className="flex-1">
                  <p className="text-sm font-semibold text-violet-900 mb-0.5">자연어로 고객 추출</p>
                  <p className="text-[11px] text-violet-700 leading-relaxed">
                    조건을 자연어로 입력하면 AI가 정확한 필터로 변환합니다. 매칭 수 + 샘플 5건이 즉시 표시되어 신뢰할 수 있어요.
                  </p>
                </div>
              </div>
            </div>

            {/* 예시 prompt */}
            <div>
              <p className="text-[10px] text-gray-500 mb-1.5">💡 빠른 시작 예시</p>
              <div className="flex flex-wrap gap-1.5">
                {AI_NL_EXAMPLES.map((p) => (
                  <button
                    key={p}
                    onClick={() => setAiNlInput(p)}
                    className="text-[11px] px-2.5 py-1 rounded-lg bg-gray-100 hover:bg-gray-200 text-gray-700"
                  >
                    {p}
                  </button>
                ))}
              </div>
            </div>

            {/* 자연어 입력 */}
            <div className="rounded-xl border border-gray-200 bg-white p-3">
              <label className="text-[10px] text-gray-500 mb-1 block">조건 자연어 입력</label>
              <textarea
                value={aiNlInput}
                onChange={(e) => setAiNlInput(e.target.value)}
                placeholder="예: 30일 안 구매하지 않은 30대 여성"
                className="w-full bg-gray-50 border border-gray-200 rounded-lg px-2.5 py-2 text-sm text-gray-800 placeholder:text-gray-400 focus:outline-none focus:border-violet-400 focus:ring-1 focus:ring-violet-400"
                rows={3}
                disabled={aiNlGenerating || aiNlExtracting}
              />
              <div className="mt-2 flex items-center justify-between gap-2">
                <p className="text-[9px] text-gray-400">검증된 필터만 사용: 단 1의 오차 없는 추출</p>
                <button
                  onClick={handleAiNlGenerate}
                  disabled={!aiNlInput.trim() || aiNlGenerating || aiNlExtracting}
                  className="flex items-center gap-1 px-3 py-1.5 bg-gradient-to-r from-violet-500 to-fuchsia-500 hover:from-violet-600 hover:to-fuchsia-600 disabled:opacity-30 disabled:cursor-not-allowed text-white rounded-lg text-xs font-semibold"
                >
                  {aiNlGenerating ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
                  {aiNlGenerating ? 'AI 변환 중...' : 'AI 변환'}
                </button>
              </div>
            </div>

            {/* 오류 */}
            {aiNlError && (
              <div className="rounded-xl border border-rose-200 bg-rose-50 p-3">
                <div className="flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 text-rose-500 flex-shrink-0 mt-0.5" />
                  <p className="text-xs text-rose-700">{aiNlError}</p>
                </div>
              </div>
            )}

            {/* 결과 카드 */}
            {aiNlResult && (
              <div className="space-y-3">
                {/* 매칭 수 + AI 해석 */}
                <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4">
                  <div className="flex items-start gap-3">
                    <Users className="w-6 h-6 text-emerald-600 flex-shrink-0" />
                    <div className="flex-1">
                      <p className="text-[10px] text-emerald-700/70 mb-0.5">매칭 결과</p>
                      <p className="text-2xl font-bold text-emerald-700">{aiNlResult.matchCount.toLocaleString()}명</p>
                      <p className="text-[11px] text-emerald-800/80 mt-1.5 leading-relaxed">
                        <span className="font-semibold">AI 해석:</span> {aiNlResult.explanation}
                      </p>
                    </div>
                  </div>
                </div>

                {/* 샘플 5건 — ★ 2026-08-08 조건 필드(sampleFields) 열을 함께 보여 조건이 맞았는지 눈으로 검증한다 */}
                {aiNlResult.samples.length > 0 && (
                  <div className="rounded-xl border border-gray-200 bg-white p-3">
                    <div className="flex items-center gap-1.5 mb-2">
                      <Eye className="w-3.5 h-3.5 text-gray-500" />
                      <p className="text-[11px] text-gray-600 font-medium">샘플 5건 미리보기</p>
                    </div>
                    <div className="overflow-x-auto">
                      <div className="space-y-1 min-w-max">
                        {aiNlResult.sampleFields.length > 0 && (
                          <div className="flex items-center gap-2 text-[9px] text-gray-400 pb-0.5">
                            <span className="w-28">전화번호</span>
                            <span className="w-16">이름</span>
                            <span className="w-10">성별</span>
                            <span className="w-16">지역</span>
                            {aiNlResult.sampleFields.map((f) => (
                              <span key={f.field_key} className="w-20 truncate font-medium text-emerald-600">{aiNlFieldLabel(f)}</span>
                            ))}
                            <span className="ml-auto pl-2">누적구매</span>
                          </div>
                        )}
                        {aiNlResult.samples.map((s) => (
                          <div key={s.id} className="flex items-center gap-2 text-[10px] py-1 border-b border-gray-100">
                            <span className="text-gray-800 font-mono w-28">{s.phone}</span>
                            <span className="text-gray-600 w-16 truncate">{s.name || '-'}</span>
                            <span className="text-gray-400 w-10">{s.gender || '-'}</span>
                            <span className="text-gray-400 w-16 truncate">{s.region || '-'}</span>
                            {aiNlResult.sampleFields.map((f) => (
                              <span key={f.field_key} className="text-gray-700 w-20 truncate">
                                {s[f.field_key] != null && s[f.field_key] !== '' ? String(s[f.field_key]) : '-'}
                              </span>
                            ))}
                            <span className="text-gray-400 ml-auto pl-2 truncate">{s.total_purchase_amount?.toLocaleString() || '-'}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                )}

                {/* 0건 안내 (자동 완화 X — D171 영구 룰) */}
                {aiNlResult.matchCount === 0 && (
                  <div className="rounded-xl border border-amber-200 bg-amber-50 p-3">
                    <p className="text-xs text-amber-800">
                      매칭되는 고객이 0명입니다. 조건을 더 넓혀주세요. (자동 완화는 마케팅 의도 보호를 위해 차단됩니다)
                    </p>
                  </div>
                )}

                {/* 액션 */}
                <div className="flex gap-2 pt-1">
                  <button
                    onClick={resetAiNlMode}
                    disabled={aiNlExtracting}
                    className="px-3 py-2 text-xs text-gray-600 hover:text-gray-800 hover:bg-gray-100 rounded-lg disabled:opacity-40"
                  >
                    다시 입력
                  </button>
                  <button
                    onClick={handleAiNlApply}
                    disabled={aiNlResult.matchCount === 0 || aiNlExtracting}
                    className="flex-1 flex items-center justify-center gap-1.5 px-4 py-2 bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-600 hover:to-teal-600 disabled:opacity-30 disabled:cursor-not-allowed text-white rounded-lg text-sm font-semibold shadow-md"
                  >
                    {aiNlExtracting ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                    {aiNlExtracting ? '추출 중...' : `이대로 ${aiNlResult.matchCount.toLocaleString()}명 추출`}
                  </button>
                </div>

                {/* Source caption */}
                <p className="text-[9px] text-gray-400 italic text-center mt-2">
                  Data source: AI 자연어 변환 + 검증된 SQL 필터 빌더 통과 (단 1의 오차 X 본질)
                </p>
              </div>
            )}
          </div>
        ) : (
        <>

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

                          // 범위 입력이 필요한 숫자 필드는 2열 차지
                          const needsWide = isSelected && field.data_type === 'number' && fk !== 'age';
                          return (
                            <div key={fk}
                              className={`rounded-lg transition-all duration-150 ${needsWide ? 'col-span-2' : ''} ${isSelected ? 'bg-green-50/80 border border-green-200 p-2.5' : 'border border-transparent p-2.5 hover:bg-gray-50'}`}>
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
        </>
        )}
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
