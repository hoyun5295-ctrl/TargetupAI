import { Filter, RotateCcw, Search, Users, Sparkles, AlertCircle, AlertTriangle, Info, Check, Eye, X, ClipboardList, ShoppingBag, Store, Tag, Smartphone, Wrench, Pin, Loader2, Target, ArrowRight, type LucideIcon } from 'lucide-react';
import {
  CUI_MODAL, CUI_MODAL_TITLE, CUI_BTN_PRIMARY, CUI_BTN_DANGER,
  CUI_PANEL, CUI_SCROLL_X, CUI_THEAD, CUI_TH, CUI_TH_RIGHT, CUI_TR, CUI_TD, CUI_CELL_DATA, CUI_CELL_META, CUI_CELL_CODE,
} from '../utils/console-ui';
import { useEffect, useMemo, useRef, useState } from 'react';
import { FRONT_FIELD_DISPLAY_MAP, reverseDisplayValueFront } from '../utils/formatDate';
import {
  buildDynamicFiltersFromSelection, chosenFilterFields, conditionChipLabel, extractionFieldsMeta, fieldHasFilterValue,
} from '../utils/customerFilterBuild';
import { requestKeptExtraction, type TargetExtraction } from '../utils/target-extraction';

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
  // ★ 2026-09-29 R112 — 명단 전체 대신 서버 보관본(건수·앞 15명·가장 긴 값)을 넘긴다
  onExtracted: (extraction: TargetExtraction, fieldsMeta: FieldMeta[], selectedCallbackPhone?: string, phoneFields?: string[]) => void;
  /**
   * ★ 2026-10-19 고르기 모드(AI 한줄로 확인 창의 「직접 타겟 선택」) — 추출하지 않고 고른 조건만 돌려준다.
   * 이때는 말로 고르기(AI) 줄을 숨기고(한 줄 자체가 AI 입력) 확인 창 위에 뜬다.
   */
  onPick?: (r: { dynamicFilters: Record<string, any>; enabledFields: any[] }) => void;
  /** ★ 2026-10-20 AI 숨김 사용자(users.hidden_features 'ai_recommend') — 말로 고르기 줄을 숨긴다 */
  hideAi?: boolean;
}

/**
 * 직접 타겟 추출 창 (★ 2026-10-20 전면 개편 · Harold 목업 승인 docs/mockups/2026-10-20-direct-send-target-extract-mockup.html)
 *
 *   - 체크하고 펼치는 단계가 없다. 항목마다 고르는 칩이 바로 보이고 「전체」 = 조건 없음(값이 있는 칸만 조건 · CT customerFilterBuild).
 *   - 「대상 인원 조회」 버튼 대신 고를 때마다 인원을 센다(400ms 모아서 · 늦게 온 응답은 버린다).
 *   - 위 한 줄 = 말로 고르기(AI). 결과는 조건 칸을 채우지 않고 결과 카드로 보여 준다 —
 *     AI 조건은 날짜를 절대 날짜 범위로 내서 칩(7일 · 30일 …)으로 옮길 수 없고, 일부만 옮기면 조건이 빠져 대상이 넓어진다.
 *   - 담기 뒤 넘기는 항목 = 활성 항목 전체(조건 고른 칸이 앞 · CT extractionFieldsMeta) — 직접발송은 이 항목들 중 이름 · 기타1~3에 넣을 것을 칸 맞추기에서 고른다.
 *   - 담기 · 말로 고르기는 오래 걸릴 수 있다 → 버튼만 잠그고 닫기는 잠그지 않는다(닫기 = 취소 · 세대로 늦은 결과를 버린다).
 */
export default function DirectTargetFilterModal({ show, onClose, onExtracted, onPick, hideAi = false }: DirectTargetFilterModalProps) {
  const pickMode = typeof onPick === 'function';
  const showAiLine = !pickMode && !hideAi;
  // 필드 데이터
  const [enabledFields, setEnabledFields] = useState<any[]>([]);
  const [extractedPhoneFields, setExtractedPhoneFields] = useState<string[]>([]);
  const [filterOptions, setFilterOptions] = useState<Record<string, string[]>>({});
  const [categoryLabels, setCategoryLabels] = useState<Record<string, string>>({});
  const [fieldsLoaded, setFieldsLoaded] = useState(false);

  // 필터 값 (다중선택: string[], 단일: string, 연령: {mode, presets?, min?, max?}) — 값이 있는 칸 = 조건
  const [filterValues, setFilterValues] = useState<Record<string, any>>({});
  const [activeCat, setActiveCat] = useState('basic');

  // 인원(자동 집계) · 전체 고객 수(막대 기준)
  const [targetCount, setTargetCount] = useState(0);
  const [countLoading, setCountLoading] = useState(false);
  const [countError, setCountError] = useState<string | null>(null);
  const [countedKey, setCountedKey] = useState('');
  const [countNonce, setCountNonce] = useState(0);   // [다시 세기]
  const [totalCount, setTotalCount] = useState<number | null>(null);
  const [extracting, setExtracting] = useState(false);
  // 세대 — 닫기(= 취소) · 새 요청이 늦게 온 결과를 버린다. 작업마다 따로 센다(한 세대를 같이 쓰면 다른 작업이 진행 중 작업의 정리까지 버린다 · Codex 1R)
  const countSeqRef = useRef(0);
  const aiSeqRef = useRef(0);       // 말로 고르기 변환
  const extractSeqRef = useRef(0);  // 담기(직접 고른 조건 · 말로 고른 결과)

  // 에러 알림 모달
  const [alertModal, setAlertModal] = useState<{ show: boolean; title: string; message: string; type: 'error' | 'warning' | 'info' }>({ show: false, title: '', message: '', type: 'error' });
  const showAlert = (title: string, message: string, type: 'error' | 'warning' | 'info' = 'error') => {
    setAlertModal({ show: true, title, message, type });
  };

  // ★ D219+ Part 2 후속 (2026-05-27): 말로 고르기 — CT-97 ai-segment-generator 활용
  //   입력 즉시 AI 변환 + 매칭 수 + 샘플 5건 표시. 적용 시 = CT-01 호환 filter → /api/customers/extract → onExtracted.
  //   0건 매칭 = "조건을 정정해주세요" 안내만 (자동 완화 X — D171 영구 룰).
  //   ★ 2026-10-20 탭 대신 창 위 한 줄 · 결과를 보는 동안(view='ai') 담기 버튼이 그 결과를 담는다.
  const [view, setView] = useState<'manual' | 'ai'>('manual');
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

  const AI_NL_EXAMPLES = [
    '30일 안 구매하지 않은 30대 여성',
    'VIP 등급 + 누적 구매 100만원 이상',
    '서울 거주 + 최근 3개월 안 1회 이상 구매한 고객',
    '생일이 이번 달인 고객',
  ];

  const handleAiNlGenerate = async () => {
    if (!aiNlInput.trim()) {
      setAiNlError('조건을 말로 적어 주세요.');
      return;
    }
    const seq = ++aiSeqRef.current;
    setAiNlGenerating(true);
    setAiNlError(null);
    // 새 변환이 실패해도 이전 결과를 담지 않게 먼저 비운다(Codex 1R)
    setAiNlResult(null);
    setView('manual');
    try {
      const token = localStorage.getItem('token');
      const res = await fetch('/api/customers/generate-from-text', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ naturalLanguage: aiNlInput.trim() }),
      });
      const data = await res.json().catch(() => ({}));
      if (seq !== aiSeqRef.current) return;
      if (!res.ok) {
        setAiNlError(data?.error || '조건으로 바꾸지 못했습니다.');
        return;
      }
      setAiNlResult({
        filter: data.filter,
        explanation: data.explanation,
        matchCount: data.matchCount,
        samples: data.samples || [],
        sampleFields: data.sampleFields || [],
      });
      setView('ai');
    } catch (e: any) {
      if (seq === aiSeqRef.current) setAiNlError(e?.message || '조건으로 바꾸지 못했습니다.');
    } finally {
      if (seq === aiSeqRef.current) setAiNlGenerating(false);
    }
  };

  const handleAiNlApply = async () => {
    if (!aiNlResult || aiNlResult.matchCount === 0) return;
    const seq = ++extractSeqRef.current;
    setExtracting(true);
    try {
      // ★ 2026-09-29 R112 — 명단 전체 대신 서버 보관본(건수·앞 15명·가장 긴 값) · 요청 모양은 CT(target-extraction)
      const r = await requestKeptExtraction({ dynamicFilters: aiNlResult.filter, smsOptIn: true, phoneField: 'phone' });
      if (seq !== extractSeqRef.current) return;
      if (!r.ok) {
        showAlert('타겟 추출 실패', r.error || '서버 오류', 'error');
        return;
      }
      if (r.data.count === 0) {
        showAlert('타겟 추출 실패', '보낼 수 있는 휴대폰 번호가 있는 고객이 없습니다. 조건을 확인해주세요.', 'warning');
        return;
      }
      // ★ 2026-08-08 (임은지 접수 08-05) 말로 고르기도 필드 meta를 전달한다 — 축은 filter의 키 하나다
      //   ({ field: { operator, value } } 구조라 그 키가 곧 조건 필드고, extract 응답 행에 같은 키로 값이 실려 온다).
      //   ★ 2026-10-20 meta = 활성 항목 전체(조건 칸이 앞) · 활성 항목에 없는 조건 칸은 서버 FIELD_MAP 라벨로 번호 바로 뒤에 붙인다.
      const filterKeys = Object.keys(aiNlResult.filter || {}).filter((k) => k !== 'sms_opt_in' && k !== 'phone');
      const base = extractionFieldsMeta(enabledFields, filterKeys);
      const missing: FieldMeta[] = filterKeys
        .filter((k) => !base.some((m) => m.field_key === k))
        .map((key) => {
          const sf = (aiNlResult.sampleFields || []).find((f) => f.field_key === key);
          const displayName = sf?.display_name || key;
          return { field_key: key, display_name: displayName, variable: `%${displayName}%`, data_type: sf?.data_type || 'string', category: sf?.category || 'basic' };
        });
      const head = base[0]?.field_key === 'phone' ? 1 : 0;
      onExtracted(r.data, [...base.slice(0, head), ...missing, ...base.slice(head)], undefined, extractedPhoneFields);
    } finally {
      if (seq === extractSeqRef.current) setExtracting(false);
    }
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
  const optionLabel = (fk: string, opt: string) => (isGenderField(fk) ? getGenderLabel(opt) : opt);
  const isSmsOptInKey = (fk: string) => fk === 'sms_opt_in' || fk === 'opt_in_sms';

  // show 시 필드 로드
  useEffect(() => {
    if (show && !fieldsLoaded) loadEnabledFields();
  }, [show]);

  // 수신동의 고객만 = 기본 조건(옛 창과 같다)
  const defaultValues = (fields: any[]) => {
    const smsField = fields.find((f: any) => isSmsOptInKey(f.field_key));
    return smsField ? { [smsField.field_key]: 'true' } : {};
  };

  // 활성 필드 로드
  const loadEnabledFields = async () => {
    try {
      const token = localStorage.getItem('token');
      const res = await fetch('/api/customers/enabled-fields', {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.ok) {
        const data = await res.json();
        const fields = data.fields || [];
        setEnabledFields(fields);
        setFilterOptions(data.options || {});
        if (data.categories) setCategoryLabels(data.categories);
        if (data.phoneFields) setExtractedPhoneFields(data.phoneFields);
        setFilterValues(defaultValues(fields));
        setFieldsLoaded(true);
      }
    } catch (error) {
      console.error('필드 로드 실패:', error);
    }
  };

  const setValue = (fk: string, v: any) => setFilterValues((prev) => {
    const next = { ...prev };
    if (v === undefined) delete next[fk]; else next[fk] = v;
    return next;
  });
  const clearField = (fk: string) => setFilterValues((prev) => {
    const next = { ...prev };
    delete next[fk]; delete next[`${fk}_min`]; delete next[`${fk}_max`]; delete next[`__search_${fk}`];
    return next;
  });

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

  // 값이 있는 칸 = 조건 → API 포맷(규칙 본체 = 프론트 CT `utils/customerFilterBuild` · 모바일DM 직접 선택과 같은 규칙)
  const chosen = useMemo(() => chosenFilterFields(filterValues, enabledFields), [filterValues, enabledFields]);
  const filterReq = useMemo(() => buildDynamicFiltersFromSelection(chosen, filterValues, enabledFields), [chosen, filterValues, enabledFields]);
  const filterKey = JSON.stringify(filterReq);
  const countReady = !countLoading && !countError && countedKey === filterKey;

  // ★ 2026-10-20 고를 때마다 인원을 센다(400ms 모아서 한 번 · 늦게 온 응답은 세대로 버린다)
  useEffect(() => {
    if (!show || !fieldsLoaded) return;
    const seq = ++countSeqRef.current;
    setCountLoading(true);
    setCountError(null);
    const timer = setTimeout(async () => {
      try {
        const res = await fetch('/api/customers/filter-count', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('token') || ''}` },
          body: filterKey,
        });
        const data = await res.json().catch(() => ({}));
        if (seq !== countSeqRef.current) return;
        if (!res.ok) { setCountError(data.error || `인원을 세지 못했습니다 (${res.status})`); return; }
        setTargetCount(Number(data.count) || 0);
        setCountedKey(filterKey);
      } catch {
        if (seq === countSeqRef.current) setCountError('서버에 연결할 수 없습니다.');
      } finally {
        if (seq === countSeqRef.current) setCountLoading(false);
      }
    }, 400);
    return () => clearTimeout(timer);
  }, [show, fieldsLoaded, filterKey, countNonce]);

  // 전체 고객 수(막대 기준 · 조건 없음 · 수신동의 무관) — 열 때마다 한 번
  useEffect(() => {
    if (!show || !fieldsLoaded) return;
    let alive = true;
    fetch('/api/customers/filter-count', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('token') || ''}` },
      body: JSON.stringify({ dynamicFilters: {}, smsOptIn: false }),
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (alive && d) setTotalCount(Number(d.count) || 0); })
      .catch(() => { /* 막대만 안 보인다 */ });
    return () => { alive = false; };
  }, [show, fieldsLoaded]);

  // ★ D43-3c: 타겟 추출 — fieldsMeta 구성하여 전달 · ★ 2026-10-20 활성 항목 전체(조건 칸이 앞)
  const handleExtract = async () => {
    if (!countReady || targetCount === 0) return;
    const seq = ++extractSeqRef.current;
    setExtracting(true);
    try {
      const { dynamicFilters, smsOptIn } = filterReq;
      // ★ 2026-09-29 R112 — 명단 전체 대신 서버 보관본(건수·앞 15명·가장 긴 값) · 요청 모양은 CT(target-extraction)
      const r = await requestKeptExtraction({ dynamicFilters, smsOptIn, phoneField: 'phone' });
      if (seq !== extractSeqRef.current) return;
      if (!r.ok) {
        showAlert('타겟 추출 실패', r.error || '데이터를 추출하지 못했습니다. 조건을 확인해주세요.', 'error');
        return;
      }
      if (r.data.count === 0) {
        showAlert('타겟 추출 실패', '보낼 수 있는 휴대폰 번호가 있는 고객이 없습니다. 조건을 확인해주세요.', 'warning');
        return;
      }
      onExtracted(r.data, extractionFieldsMeta(enabledFields, chosen), undefined, extractedPhoneFields);
    } finally {
      if (seq === extractSeqRef.current) setExtracting(false);
    }
  };

  // 초기화 — 수신동의 고객만(기본 조건)으로
  const resetAll = () => {
    setFilterValues(defaultValues(enabledFields));
    setView('manual');
  };

  // 닫기 = 취소(진행 중인 담기 · 말로 고르기 · 집계의 늦은 결과를 버린다)
  const handleClose = () => {
    aiSeqRef.current++;
    extractSeqRef.current++;
    countSeqRef.current++;
    setExtracting(false);
    setAiNlGenerating(false);
    setCountLoading(false);
    setAiNlInput('');
    setAiNlResult(null);
    setAiNlError(null);
    resetAll();
    onClose();
  };

  // ============ 조건 입력 UI ============
  const CHIP = 'inline-flex items-center justify-center rounded-[10px] border font-medium transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-emerald-500';
  const chip = (on: boolean, small = false, all = false) =>
    `${CHIP} ${small ? 'h-[30px] px-2.5 text-[12.5px]' : 'h-[34px] px-3 text-[13px]'} ${on
      ? (all ? 'bg-stone-800 border-stone-800 text-white font-semibold' : 'bg-emerald-600 border-emerald-600 text-white font-semibold')
      : 'bg-white border-stone-200 text-stone-700 hover:border-stone-400'}`;
  const INPUT_BOX = 'flex-1 min-w-0 max-w-[200px] h-[38px] px-3 rounded-[10px] border border-stone-200 bg-white flex items-center gap-1.5 focus-within:border-emerald-500 focus-within:ring-[3px] focus-within:ring-emerald-100';
  const INPUT = 'w-full min-w-0 bg-transparent border-0 p-0 text-[13.5px] tabular-nums text-stone-800 outline-none focus:ring-0 placeholder:text-stone-400';
  const LINK = 'text-[12.5px] font-semibold text-emerald-700 hover:text-emerald-800';
  const numIn = (key: string, placeholder: string, unit?: string) => (
    <label className={INPUT_BOX}>
      <input type="text" inputMode="numeric" value={filterValues[key] ? Number(filterValues[key]).toLocaleString() : ''}
        onChange={e => { const num = e.target.value.replace(/[^0-9]/g, ''); setValue(key, num || undefined); }}
        placeholder={placeholder} className={INPUT} />
      {unit && <span className="text-[12px] text-stone-500 shrink-0">{unit}</span>}
    </label>
  );

  const renderCondition = (field: any) => {
    const fk = field.field_key;

    // 문자 수신 동의 — 「아니오」는 '동의 안 한 고객만'이 아니라 '조건 없음'이다(빌드 규칙) → 두 칩으로 정확히
    if (isSmsOptInKey(fk)) {
      const on = filterValues[fk] === 'true';
      return (
        <div className="flex flex-wrap gap-1.5">
          <button type="button" onClick={() => setValue(fk, 'true')} className={chip(on)}>수신 동의한 고객만</button>
          <button type="button" onClick={() => setValue(fk, undefined)} className={chip(!on, false, true)}>상관없음</button>
        </div>
      );
    }

    // 연령 특수 UI
    if (fk === 'age') {
      const age = filterValues.age || { mode: 'preset', presets: [] };
      const rangeText = getAgeRangeText();
      return age.mode === 'range' ? (
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <label className={INPUT_BOX}>
              <input type="number" value={age.min || ''} onChange={e => setAgeRange('min', e.target.value)} placeholder="최소" className={INPUT} />
              <span className="text-[12px] text-stone-500">세</span>
            </label>
            <span className="text-stone-400">~</span>
            <label className={INPUT_BOX}>
              <input type="number" value={age.max || ''} onChange={e => setAgeRange('max', e.target.value)} placeholder="최대" className={INPUT} />
              <span className="text-[12px] text-stone-500">세</span>
            </label>
          </div>
          <button type="button" onClick={() => setAgeMode('preset')} className={LINK}>연령대로 고르기</button>
        </div>
      ) : (
        <div className="space-y-2">
          <div className="flex flex-wrap gap-1.5">
            {AGE_PRESETS.map(p => (
              <button key={p.value} type="button" onClick={() => toggleAgePreset(p.value)} className={chip((age.presets || []).includes(p.value))}>{p.label}</button>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => setAgeMode('range')} className={LINK}>나이 직접 입력</button>
            {rangeText && <span className="text-[12px] text-stone-500">{rangeText}</span>}
          </div>
        </div>
      );
    }

    // 불린 — 전체 = 조건 없음
    if (field.data_type === 'boolean') {
      const val = filterValues[fk];
      return (
        <div className="flex flex-wrap gap-1.5">
          <button type="button" onClick={() => setValue(fk, undefined)} className={chip(val !== 'true' && val !== 'false', false, true)}>전체</button>
          <button type="button" onClick={() => setValue(fk, 'true')} className={chip(val === 'true')}>예</button>
          <button type="button" onClick={() => setValue(fk, 'false')} className={chip(val === 'false')}>아니오</button>
        </div>
      );
    }

    // 문자열 + 옵션 → 다중 칩(15개 넘으면 찾기 + 스크롤)
    if (field.data_type === 'string' && filterOptions[fk]?.length > 0) {
      const selected: string[] = Array.isArray(filterValues[fk]) ? filterValues[fk] : [];
      const allOpts = filterOptions[fk];
      const many = allOpts.length > 15; // ★ B17-14: 15개 초과 시 스크롤 영역 + 검색
      const searchKey = `__search_${fk}`;
      const searchTerm = (filterValues[searchKey] || '').toLowerCase();
      const shown = many && searchTerm ? allOpts.filter((o: string) => optionLabel(fk, o).toLowerCase().includes(searchTerm)) : allOpts;
      return (
        <div>
          {many && (
            <div className="mb-2 flex items-center gap-2 flex-wrap">
              <label className="h-9 w-full max-w-[280px] flex items-center gap-2 px-2.5 rounded-[10px] border border-stone-200 bg-white focus-within:border-emerald-500 focus-within:ring-[3px] focus-within:ring-emerald-100">
                <Search className="w-3.5 h-3.5 text-stone-400 shrink-0" />
                <input type="text" placeholder={`${allOpts.length}개 중 찾기`} value={filterValues[searchKey] || ''}
                  onChange={(e) => setFilterValues(prev => ({ ...prev, [searchKey]: e.target.value }))}
                  className="w-full min-w-0 bg-transparent border-0 p-0 text-[13px] outline-none focus:ring-0 placeholder:text-stone-400" />
              </label>
              {selected.length > 0 && <span className="text-[12px] font-semibold text-emerald-700">{selected.length}개 고름</span>}
            </div>
          )}
          <div className={`flex flex-wrap gap-1.5 ${many ? 'max-h-[148px] overflow-y-auto pr-1' : ''}`}>
            {shown.map((opt: string) => (
              <button key={opt} type="button" onClick={() => toggleMultiOption(fk, opt)} className={chip(selected.includes(opt), many)}>{optionLabel(fk, opt)}</button>
            ))}
            {shown.length === 0 && <span className="text-[12.5px] text-stone-500">찾는 값이 없습니다</span>}
          </div>
        </div>
      );
    }

    // 포인트 → 프리셋 칩 + 범위 입력 (누적구매금액과 동일 UX)
    if (field.data_type === 'number' && fk === 'points') {
      const minKey = `${fk}_min`;
      const maxKey = `${fk}_max`;
      return (
        <div className="space-y-2">
          <div className="flex flex-wrap gap-1.5">
            {POINTS_PRESETS.map(p => (
              <button key={p.value} type="button"
                onClick={() => setFilterValues(prev => ({ ...prev, [minKey]: prev[minKey] === p.value && !prev[maxKey] ? '' : p.value, [maxKey]: '' }))}
                className={chip(filterValues[minKey] === p.value && !filterValues[maxKey], true)}>{p.label}</button>
            ))}
          </div>
          <div className="flex items-center gap-2">{numIn(minKey, '최소')}<span className="text-stone-400">~</span>{numIn(maxKey, '최대')}</div>
        </div>
      );
    }

    // 숫자 → 범위 입력 (최소 ~ 최대) · 금액이면 프리셋
    if (field.data_type === 'number') {
      const minKey = `${fk}_min`;
      const maxKey = `${fk}_max`;
      const isAmount = ['total_purchase_amount', 'recent_purchase_amount', 'avg_order_value'].some(k => fk.includes(k) || fk.includes('amount') || fk.includes('금액') || fk.includes('price') || fk.includes('가격'));
      const unit = isAmount ? '원' : undefined;
      return (
        <div className="space-y-2">
          {isAmount && (
            <div className="flex flex-wrap gap-1.5">
              {[{ l: '10만', v: 100000 }, { l: '50만', v: 500000 }, { l: '100만', v: 1000000 }, { l: '500만', v: 5000000 }].map(p => (
                <button key={p.v} type="button"
                  onClick={() => setFilterValues(prev => ({ ...prev, [minKey]: prev[minKey] === String(p.v) && !prev[maxKey] ? '' : String(p.v), [maxKey]: '' }))}
                  className={chip(filterValues[minKey] === String(p.v) && !filterValues[maxKey], true)}>{p.l}↑</button>
              ))}
            </div>
          )}
          <div className="flex items-center gap-2">{numIn(minKey, isAmount ? '예) 200,000' : '최소', unit)}<span className="text-stone-400">~</span>{numIn(maxKey, isAmount ? '예) 500,000' : '최대', unit)}</div>
        </div>
      );
    }

    // 날짜 → 생일이면 월, 그 외 기간(한 번 더 누르면 해제)
    if (field.data_type === 'date') {
      const val = filterValues[fk] || '';
      const isBirthday = fk === 'birthday' || fk === 'birth_date';
      const presets = isBirthday ? BIRTH_MONTH_PRESETS : DAYS_PRESETS;
      return (
        <div className="flex flex-wrap gap-1.5">
          {presets.map(p => (
            <button key={p.value} type="button" onClick={() => setValue(fk, val === p.value ? undefined : p.value)} className={chip(val === p.value, isBirthday)}>{p.label}</button>
          ))}
        </div>
      );
    }

    // 문자열 (옵션 없음) → 포함 검색
    return (
      <input type="text" value={filterValues[fk] || ''} onChange={e => setValue(fk, e.target.value || undefined)}
        placeholder="포함하는 값"
        className="w-full max-w-[340px] h-[38px] px-3 rounded-[10px] border border-stone-200 text-[13.5px] outline-none focus:border-emerald-500 focus:ring-[3px] focus:ring-emerald-100" />
    );
  };

  // ============ 렌더링 ============

  if (!show) return null;

  // 모든 필드 표시 (SKIP 없음 — Harold님 확정)
  const allFields = enabledFields;
  const categoryOrder = ['basic', 'purchase', 'store', 'membership', 'marketing', 'custom'];
  const usedCategories = [...new Set(allFields.map((f: any) => f.category))] as string[];
  const allCategories = [...categoryOrder.filter(c => usedCategories.includes(c)), ...usedCategories.filter(c => !categoryOrder.includes(c))];
  const cat = allCategories.includes(activeCat) ? activeCat : (allCategories[0] || 'basic');
  const catFields = allFields.filter((f: any) => f.category === cat);
  const chips = allFields
    .map((f: any) => ({ key: f.field_key, label: conditionChipLabel(f, filterValues, optionLabel) }))
    .filter((c): c is { key: string; label: string } => !!c.label);

  const inAi = view === 'ai' && !!aiNlResult;
  const shownCount = inAi ? aiNlResult!.matchCount : targetCount;
  const busyCount = !inAi && !countError && (countLoading || countedKey !== filterKey);
  const pct = totalCount && totalCount > 0 ? Math.min(100, (shownCount / totalCount) * 100) : null;
  const noFilters = Object.keys(filterReq.dynamicFilters).length === 0;

  const primaryDisabled = pickMode
    ? noFilters
    : extracting || aiNlGenerating || (inAi ? aiNlResult!.matchCount === 0 : (!countReady || targetCount === 0));
  const primaryLabel = pickMode
    ? '이 조건으로 받는 사람 바꾸기'
    : extracting ? '담는 중'
      : inAi ? (aiNlResult!.matchCount > 0 ? `이대로 ${aiNlResult!.matchCount.toLocaleString()}명 담기` : '대상이 없어요')
        : countError ? '인원을 세지 못했어요' : busyCount ? '세는 중' : targetCount > 0 ? `${targetCount.toLocaleString()}명 담기` : '대상이 없어요';
  const onPrimary = () => {
    if (primaryDisabled) return;
    if (pickMode) { onPick!({ dynamicFilters: filterReq.dynamicFilters, enabledFields }); resetAll(); return; }
    if (inAi) void handleAiNlApply(); else void handleExtract();
  };

  const alertTone = alertModal.type === 'error'
    ? { ring: 'bg-rose-50 text-rose-600', btn: CUI_BTN_DANGER, Icon: AlertCircle }
    : alertModal.type === 'warning'
      ? { ring: 'bg-amber-50 text-amber-600', btn: `${CUI_BTN_PRIMARY} !bg-amber-500 hover:!bg-amber-600`, Icon: AlertTriangle }
      : { ring: 'bg-indigo-50 text-indigo-600', btn: CUI_BTN_PRIMARY, Icon: Info };
  // 직접발송 창(z 50) 위 · 고르기 모드는 AI 한줄로 확인 창(1600) 위
  const baseZ = pickMode ? 1600 : 60;
  const title = pickMode ? '직접 타겟 선택' : '직접 타겟 추출';

  const countBlock = (
    <div>
      <div className="flex items-center gap-1.5 text-[12.5px] text-stone-500">
        {inAi ? '말로 고른 인원' : '대상 인원'}
        {!inAi && <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-700 bg-emerald-50 px-1.5 py-px rounded-full"><Check className="w-3 h-3" />바로 셉니다</span>}
      </div>
      <div className={`mt-1 text-[34px] leading-[1.15] font-extrabold tracking-[-0.02em] tabular-nums text-stone-900 transition-opacity ${busyCount ? 'opacity-40' : ''}`}>
        {shownCount.toLocaleString()}<span className="ml-1 text-[15px] font-semibold text-stone-500">명</span>
      </div>
      {pct != null && (
        <>
          <div className="mt-2.5 h-1.5 rounded-full bg-stone-200/70 overflow-hidden">
            <div className="h-full w-full rounded-full bg-gradient-to-r from-emerald-500 to-teal-500 origin-left transition-transform duration-300" style={{ transform: `scaleX(${Math.max(0.02, pct / 100)})` }} />
          </div>
          <div className="mt-1.5 text-[12px] text-stone-500 tabular-nums">전체 고객 {totalCount!.toLocaleString()}명 중 {pct.toFixed(1)}%</div>
        </>
      )}
      {!inAi && countError && (
        <div className="mt-2 text-[12px] text-rose-600 flex items-center gap-1.5">
          <AlertCircle className="w-3.5 h-3.5 shrink-0" />{countError}
          <button type="button" onClick={() => setCountNonce((n) => n + 1)} className="ml-1 font-semibold underline underline-offset-2">다시 세기</button>
        </div>
      )}
    </div>
  );

  return (
    <>
    <div className="fixed inset-0 bg-neutral-900/45 flex items-end sm:items-center justify-center sm:p-4" style={{ zIndex: baseZ }}>
      <div
        className="w-full sm:max-w-[1100px] h-[100dvh] sm:h-[min(760px,92vh)] bg-white sm:rounded-[20px] shadow-2xl shadow-neutral-900/20 flex flex-col overflow-hidden"
        role="dialog" aria-modal="true" aria-label={title}
      >
        {/* 머리 */}
        <div className="shrink-0 px-4 sm:px-6 pt-4 sm:pt-5 pb-3 flex items-center gap-3.5">
          <div className="w-11 h-11 rounded-[13px] bg-gradient-to-br from-emerald-600 to-teal-600 grid place-items-center shrink-0 shadow-[0_10px_22px_-12px_rgba(28,25,23,0.45)]">
            <Target className="w-[22px] h-[22px] text-white" />
          </div>
          <div className="min-w-0">
            <h3 className="text-[18px] sm:text-[19px] font-bold tracking-[-0.02em] text-stone-900">{title}</h3>
            <p className="mt-0.5 text-[12.5px] sm:text-[13px] text-stone-500 truncate">
              {pickMode
                ? '항목을 고르면 이 조건으로 받는 사람을 바꿉니다'
                : totalCount != null
                  ? <>고객 <b className="font-semibold text-stone-800 tabular-nums">{totalCount.toLocaleString()}</b>명 중에서 받을 사람을 고릅니다</>
                  : '고객 DB에서 받을 사람을 고릅니다'}
            </p>
          </div>
          <button type="button" onClick={handleClose} className="ml-auto w-9 h-9 rounded-[11px] grid place-items-center text-stone-500 hover:bg-stone-100 hover:text-stone-800 shrink-0" aria-label="닫기">
            <X className="w-[18px] h-[18px]" />
          </button>
        </div>

        {/* 말로 고르기(AI) */}
        {showAiLine && (
          <div className="shrink-0 px-4 sm:px-6 pb-3">
            <div className="flex items-center gap-2.5 pl-3.5 pr-1.5 py-1.5 rounded-[14px] border border-stone-200 bg-stone-50 focus-within:bg-white focus-within:border-emerald-500 focus-within:ring-[3px] focus-within:ring-emerald-100 transition">
              <Sparkles className="w-[18px] h-[18px] text-emerald-600 shrink-0" />
              <input
                type="text"
                value={aiNlInput}
                onChange={(e) => setAiNlInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) { e.preventDefault(); void handleAiNlGenerate(); } }}
                placeholder="말로 적어도 돼요 · 예) 서울 사는 30대 여성"
                disabled={aiNlGenerating || extracting}
                className="flex-1 min-w-0 h-[38px] bg-transparent border-0 p-0 text-[14px] text-stone-800 outline-none focus:ring-0 placeholder:text-stone-400"
              />
              <button
                type="button"
                onClick={() => { void handleAiNlGenerate(); }}
                disabled={!aiNlInput.trim() || aiNlGenerating || extracting}
                className="h-[38px] px-3.5 rounded-[10px] bg-stone-900 text-white text-[13px] font-semibold inline-flex items-center gap-1.5 whitespace-nowrap disabled:opacity-40"
              >
                {aiNlGenerating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
                {aiNlGenerating ? '바꾸는 중' : '조건으로 바꾸기'}
                {!aiNlGenerating && <span className="hidden sm:inline text-[11px] font-semibold text-white/60">1크레딧</span>}
              </button>
            </div>
            <div className="mt-2 flex items-center gap-1.5 overflow-x-auto sm:flex-wrap">
              <span className="text-[12px] text-stone-500 shrink-0 mr-0.5">예시</span>
              {AI_NL_EXAMPLES.map((p) => (
                <button key={p} type="button" onClick={() => setAiNlInput(p)}
                  className="h-7 px-2.5 rounded-full border border-stone-200 bg-white text-[12px] text-stone-600 hover:border-emerald-500 hover:text-emerald-700 shrink-0">
                  {p}
                </button>
              ))}
            </div>
            {aiNlError && (
              <p className="mt-2 text-[12.5px] text-rose-600 flex items-center gap-1.5"><AlertCircle className="w-3.5 h-3.5 shrink-0" />{aiNlError}</p>
            )}
          </div>
        )}

        {/* 몸통: 항목 묶음 | 조건 | 요약 */}
        <div className="flex-1 min-h-0 border-t border-stone-200 flex flex-col md:grid md:grid-cols-[184px_minmax(0,1fr)] lg:grid-cols-[196px_minmax(0,1fr)_300px]">
          {/* 항목 묶음 — 휴대폰 = 가로 줄 */}
          <nav className="shrink-0 flex md:flex-col gap-1 md:gap-0.5 px-3 py-2 md:p-2.5 overflow-x-auto md:overflow-y-auto border-b md:border-b-0 md:border-r border-stone-200 bg-stone-50">
            {allCategories.map((c) => {
              const CatIcon = CAT_ICONS[c] || Pin;
              const n = allFields.filter((f: any) => f.category === c && fieldHasFilterValue(f.field_key, filterValues, f)).length;
              const on = !inAi && c === cat;
              return (
                <button key={c} type="button" onClick={() => { setActiveCat(c); setView('manual'); }}
                  className={`shrink-0 h-9 md:h-[42px] px-3 md:px-2.5 rounded-[10px] flex items-center gap-2.5 text-[13.5px] whitespace-nowrap transition ${on ? 'bg-white text-stone-900 font-semibold shadow-sm' : 'text-stone-600 hover:bg-stone-100'}`}>
                  <span className={`hidden md:grid w-7 h-7 rounded-lg place-items-center ${on ? 'bg-emerald-50 text-emerald-700' : 'bg-stone-200/60 text-stone-500'}`}><CatIcon className="w-[15px] h-[15px]" /></span>
                  {categoryLabels[c] || c}
                  {n > 0 && <span className="md:ml-auto min-w-[20px] h-5 px-1.5 rounded-full bg-emerald-600 text-white text-[11px] font-bold grid place-items-center tabular-nums">{n}</span>}
                </button>
              );
            })}
            <button type="button" onClick={resetAll}
              className="hidden md:flex mt-auto h-9 items-center justify-center gap-1.5 rounded-[10px] text-[12.5px] text-stone-500 hover:bg-stone-100 hover:text-stone-800">
              <RotateCcw className="w-3.5 h-3.5" />조건 처음으로
            </button>
          </nav>

          {/* 조건 칸 또는 말로 고른 결과 */}
          <div className="flex-1 min-h-0 overflow-y-auto px-4 sm:px-6 py-2">
            {inAi ? (
              <div className="py-4 space-y-4">
                <div className="rounded-2xl border border-emerald-200 bg-emerald-50/70 p-4 flex items-start gap-3.5">
                  <div className="h-10 w-10 rounded-xl bg-white grid place-items-center text-emerald-600 ring-1 ring-emerald-600/15 shrink-0">
                    <Sparkles className="w-5 h-5" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-[12px] text-emerald-800/80">말로 고른 결과</p>
                    <p className="text-2xl font-bold text-emerald-800 tabular-nums leading-tight">{aiNlResult!.matchCount.toLocaleString()}<span className="text-sm font-medium text-emerald-800/70 ml-1">명</span></p>
                    <p className="text-[12.5px] text-stone-700 mt-1.5 leading-relaxed"><span className="font-semibold">AI 해석</span> · {aiNlResult!.explanation}</p>
                  </div>
                </div>

                {aiNlResult!.samples.length > 0 && (
                  <div>
                    <div className="flex items-center gap-1.5 mb-2">
                      <Eye className="w-3.5 h-3.5 text-stone-400" />
                      <p className="text-[12.5px] font-semibold text-stone-600">앞 5명 미리 보기</p>
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
                              {aiNlResult!.sampleFields.map((f) => (
                                <th key={f.field_key} className={`${CUI_TH} text-emerald-700`}>{aiNlFieldLabel(f)}</th>
                              ))}
                              <th className={CUI_TH_RIGHT}>누적구매</th>
                            </tr>
                          </thead>
                          <tbody>
                            {aiNlResult!.samples.map((s) => (
                              <tr key={s.id} className={CUI_TR}>
                                <td className={`${CUI_TD} ${CUI_CELL_CODE}`}>{s.phone}</td>
                                <td className={`${CUI_TD} ${CUI_CELL_DATA}`}>{s.name || '-'}</td>
                                <td className={`${CUI_TD} ${CUI_CELL_META}`}>{s.gender || '-'}</td>
                                <td className={`${CUI_TD} ${CUI_CELL_META}`}>{s.region || '-'}</td>
                                {aiNlResult!.sampleFields.map((f) => (
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

                {aiNlResult!.matchCount === 0 && (
                  <div className="rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-3 flex items-start gap-2.5">
                    <AlertTriangle className="w-4 h-4 text-amber-600 mt-0.5 shrink-0" />
                    <p className="text-[12.5px] text-amber-900 leading-relaxed">매칭되는 고객이 0명입니다. 조건을 더 넓혀 주세요. 자동 완화는 마케팅 의도를 지키기 위해 하지 않습니다.</p>
                  </div>
                )}

                <button type="button" onClick={() => setView('manual')} className={`${LINK} inline-flex items-center gap-1`}>
                  <Filter className="w-3.5 h-3.5" />항목으로 직접 고르기
                </button>
              </div>
            ) : !fieldsLoaded ? (
              <div className="py-16 flex flex-col items-center gap-3 text-[13px] text-stone-500">
                <Loader2 className="w-5 h-5 animate-spin text-emerald-600" />항목을 불러오는 중
              </div>
            ) : allFields.length === 0 ? (
              <div className="py-16 text-center">
                <div className="mx-auto mb-3 h-11 w-11 rounded-2xl bg-stone-100 text-stone-500 grid place-items-center"><Users className="w-5 h-5" /></div>
                <div className="text-[14px] font-semibold text-stone-800">고객 데이터가 아직 없습니다</div>
                <div className="mt-1 text-[12.5px] text-stone-500">고객 관리에서 파일을 올리거나 자사몰을 연동하면 고를 항목이 여기에 나타납니다.</div>
              </div>
            ) : (
              <>
                {aiNlResult && (
                  <button type="button" onClick={() => setView('ai')} className={`${LINK} mt-3 inline-flex items-center gap-1`}>
                    <Sparkles className="w-3.5 h-3.5" />말로 고른 결과 다시 보기 · {aiNlResult.matchCount.toLocaleString()}명<ArrowRight className="w-3.5 h-3.5" />
                  </button>
                )}
                {catFields.map((field: any) => {
                  const fk = field.field_key;
                  const on = fieldHasFilterValue(fk, filterValues, field);
                  return (
                    <div key={fk} className="py-4 border-b border-stone-100 last:border-b-0 grid sm:grid-cols-[132px_minmax(0,1fr)] gap-2 sm:gap-3.5">
                      <div className="flex sm:block items-center gap-2 sm:pt-1.5 min-w-0">
                        <b className={`text-[14px] font-semibold break-keep ${on ? 'text-emerald-800' : 'text-stone-800'}`}>
                          {field.display_name}
                          {on && <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-500 ml-1.5 align-middle" />}
                        </b>
                        {on && !isSmsOptInKey(fk) && (
                          <button type="button" onClick={() => clearField(fk)} className="ml-auto sm:ml-0 sm:mt-1 block text-[12px] text-stone-500 hover:text-stone-800">지우기</button>
                        )}
                      </div>
                      <div className="min-w-0">{renderCondition(field)}</div>
                    </div>
                  );
                })}
              </>
            )}
          </div>

          {/* 요약(넓은 화면) */}
          <aside className="hidden lg:flex flex-col gap-5 min-h-0 overflow-y-auto border-l border-stone-200 p-5 bg-gradient-to-b from-stone-50 to-white">
            {countBlock}
            {!inAi && (
              <div>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[12px] font-semibold text-stone-500">고른 조건</span>
                  <button type="button" onClick={resetAll} className="text-[12px] text-stone-500 hover:text-stone-800">처음으로</button>
                </div>
                {chips.length > 0 ? (
                  <div className="flex flex-wrap gap-1.5">
                    {chips.map((c) => (
                      <span key={c.key} className="h-7 pl-2.5 pr-1 rounded-full bg-white border border-emerald-200 text-emerald-800 text-[12px] font-semibold inline-flex items-center gap-1 max-w-full">
                        <span className="truncate">{c.label}</span>
                        <button type="button" onClick={() => clearField(c.key)} className="w-[18px] h-[18px] rounded-full grid place-items-center text-emerald-700 hover:bg-emerald-100 shrink-0" aria-label={`${c.label} 지우기`}>
                          <X className="w-3 h-3" />
                        </button>
                      </span>
                    ))}
                  </div>
                ) : (
                  <p className="text-[12.5px] text-stone-500">아직 고른 조건이 없어요. 조건이 없으면 전체 고객입니다.</p>
                )}
              </div>
            )}
            {!pickMode && (
              <p className="mt-auto text-[12px] text-stone-500 leading-relaxed break-keep">담으면 직접발송 명단으로 들어오고, 이름 · 기타1~3에 넣을 고객 항목을 고를 수 있어요.</p>
            )}
          </aside>
        </div>

        {/* 바닥 */}
        <div className="shrink-0 px-4 sm:px-6 py-3 sm:py-3.5 border-t border-stone-200 bg-white flex items-center gap-3">
          <div className="lg:hidden min-w-0">
            <div className="text-[11.5px] text-stone-500">{inAi ? '말로 고른 인원' : '대상 인원'}</div>
            {!inAi && countError
              ? <button type="button" onClick={() => setCountNonce((n) => n + 1)} className="text-[13px] font-semibold text-rose-600 underline underline-offset-2">다시 세기</button>
              : <div className={`text-[20px] font-extrabold tabular-nums text-stone-900 leading-tight ${busyCount ? 'opacity-40' : ''}`}>{shownCount.toLocaleString()}명</div>}
          </div>
          {!pickMode && (
            <p className="hidden lg:flex items-center gap-1.5 text-[12.5px] text-stone-500">
              <Info className="w-[15px] h-[15px] shrink-0" />휴대폰 번호가 없는 고객은 담을 때, 수신거부 번호는 보낼 때 빠집니다
            </p>
          )}
          <div className="ml-auto flex items-center gap-2">
            <button type="button" onClick={handleClose} className="hidden sm:inline-flex h-[46px] px-[18px] items-center rounded-xl border border-stone-200 text-[14px] text-stone-600 hover:bg-stone-50">취소</button>
            <button
              type="button"
              onClick={onPrimary}
              disabled={primaryDisabled}
              className="h-[46px] px-4 sm:px-5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-[14.5px] font-bold inline-flex items-center gap-2 shadow-[0_12px_24px_-14px_rgba(28,25,23,0.5)] disabled:opacity-50 disabled:hover:bg-emerald-600"
            >
              {extracting || busyCount ? <Loader2 className="w-4 h-4 animate-spin" /> : <Users className="w-[17px] h-[17px]" />}
              {primaryLabel}
            </button>
          </div>
        </div>
      </div>
    </div>

    {/* 알림 모달(커스텀, native dialog 아님) — 이 창 위 */}
    {alertModal.show && (
      <div className="fixed inset-0 bg-neutral-900/45 flex items-center justify-center p-4" style={{ zIndex: baseZ + 10 }}>
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
