/**
 * 알림톡 발송 전용 풀 화면 모달 (D162-4 신규)
 *
 * Harold님 명시 의도 — 직접발송 모달에서 알림톡 채널을 squeeze하던 사고 영구 종결.
 * 알림톡 전용 큰 모달로 분리해 좌측 채널 패널 + 우측 수신자/변수 매칭/발송 영역이 충분한 공간에서 동작.
 * ALIMTALK-DESIGN.md §6-3-D 매뉴얼 정합 (발신프로필 + 템플릿 + 변수 매핑 + 부달 + 단가).
 *
 * 진입 경로:
 *  1) Dashboard 메뉴 "알림톡 발송" 클릭 → 본 모달 직접 진입
 *  2) Dashboard.tsx의 showAlimtalkSend state로 노출 관리
 *
 * 수신자 영역은 단순 직접입력(textarea) + 파일 업로드. DirectSendPanel의 복잡한 컬럼 매핑은 차후 통합.
 * 발송 흐름은 기존 DirectSendPanel의 handleAlimtalkSend와 동일 — onSendConfirm callback으로 위임.
 */

import { useState, useMemo, useEffect } from 'react';
import { Bell, X, Contact } from 'lucide-react';
import AlimtalkChannelPanel, {
  type AlimtalkChannelState,
  type AlimtalkSenderProfile,
  type AlimtalkTemplate,
} from './alimtalk/AlimtalkChannelPanel';
import AlimtalkVariableMappingPanel from './alimtalk/AlimtalkVariableMappingPanel';
import AddressBookModal from './AddressBookModal';
import { normalizePhoneKr } from '../utils/formatDate';
import { validateAlimtalkVariables } from '../utils/alimtalkVars';

// 주소록/엑셀 표준 필드 → 사용자 표시 라벨. 미리보기 컬럼 + 변수 매칭 드롭다운 공용.
const FIELD_LABEL_MAP: Record<string, string> = { name: '이름', extra1: '기타1', extra2: '기타2', extra3: '기타3' };
// 변수명 → 자동 매핑 대상 필드 별칭 (의미 일치 시 자동 선택)
const FIELD_NAME_ALIASES: Record<string, string[]> = {
  name: ['이름', '성함', '성명', '고객명', '고객', '수신자', '수신자명', '회원명'],
};

export interface AlimtalkSendModalProps {
  show: boolean;
  onClose: () => void;

  // 데이터
  alimtalkSenders: AlimtalkSenderProfile[];
  alimtalkTemplates: AlimtalkTemplate[];
  customerFieldOptions: { key: string; label: string }[];

  // 알림톡 채널 state (Dashboard에서 관리)
  alimtalkProfileId: string;
  setAlimtalkProfileId: (id: string) => void;
  kakaoSelectedTemplate: any;
  setKakaoSelectedTemplate: (t: any) => void;
  kakaoTemplateVars: Record<string, string>;
  setKakaoTemplateVars: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  alimtalkFallback: 'N' | 'S' | 'L' | 'A' | 'B';
  setAlimtalkFallback: (f: 'N' | 'S' | 'L' | 'A' | 'B') => void;
  alimtalkNextContents: string;
  setAlimtalkNextContents: (v: string) => void;
  /** ★ D188 (2026-05-21) 영업팀장 신고 #7-(2): LMS 대체 제목 (L/B 시 필수). Dashboard 전역 state 관리. */
  alimtalkNextSubject?: string;
  setAlimtalkNextSubject?: (v: string) => void;

  // 발송 핸들러 — Dashboard에서 위임받아 SendConfirm 모달 진입
  onSendConfirm: (data: {
    show: boolean;
    type: 'immediate';
    count: number;
    unsubscribeCount: number;
    duplicateCount: number;
    from: 'alimtalk';
    msgType: '알림톡';
    recipients: any[];
    selectedTemplate: any;
    variableMap: Record<string, string>;
    fallback: 'N' | 'S' | 'L' | 'A' | 'B';
    nextContents: string;
    /** ★ D188 (2026-05-21) 영업팀장 신고 #7-(2): LMS 대체 제목 — L/B 시 필수 (Dashboard 발송 fetch에 전달). */
    nextSubject?: string;
    profileId: string;
  }) => void;

  setToast: (t: { show: boolean; type: 'success' | 'error' | 'warning'; message: string }) => void;

  /** ★ D162-4 (2026-05-15) 4차: 직접타겟발송에서 추출된 수신자 그대로 인계받기 (Harold님 명시 정합).
   *   show=true 진입 + initialRecipients 길이 > 0이면 자동 setRecipients. 사용자 별도 입력 X. */
  initialRecipients?: any[];

  /** ★ #2 (2026-06-01): 발송 성공 시 증가하는 신호 — 수신자 리스트만 초기화(모달은 열린 채 유지). */
  resetSignal?: number;
}

export default function AlimtalkSendModal({
  show,
  onClose,
  alimtalkSenders,
  alimtalkTemplates,
  customerFieldOptions,
  alimtalkProfileId,
  setAlimtalkProfileId,
  kakaoSelectedTemplate,
  setKakaoSelectedTemplate,
  kakaoTemplateVars,
  setKakaoTemplateVars,
  alimtalkFallback,
  setAlimtalkFallback,
  alimtalkNextContents,
  setAlimtalkNextContents,
  alimtalkNextSubject,
  setAlimtalkNextSubject,
  onSendConfirm,
  setToast,
  initialRecipients,
  resetSignal,
}: AlimtalkSendModalProps) {
  // 수신자 영역 — 알림톡 전용 state (직접발송 directRecipients와 격리)
  const [inputMode, setInputMode] = useState<'direct' | 'file' | 'address'>('direct');
  const [directInput, setDirectInput] = useState('');
  const [recipients, setRecipients] = useState<any[]>([]);
  const [fileLoading, setFileLoading] = useState(false);
  const [dedupEnabled, setDedupEnabled] = useState(true);
  const [unsubFilterEnabled, setUnsubFilterEnabled] = useState(true);
  const [sending, setSending] = useState(false);
  // ★ D162-4 (2026-05-15) 2차: 주소록 진입 — Harold님 명시 정합. AddressBookModal 재사용 (recipients/setRecipients 위임).
  const [showAddressBook, setShowAddressBook] = useState(false);

  // ★ D162-4 (2026-05-15) 5차: Harold님 명시 정합 — 알림톡 모달 진입 시 매핑/state 전체 reset.
  //   기존엔 Dashboard 전역 state(kakaoTemplateVars/kakaoSelectedTemplate/등)가 직접발송 ↔ 직접타겟발송 간 유출되어
  //   옛 매핑값이 새 모달에 그대로 노출되는 치명 사고 발생. show=true 진입 시 모든 알림톡 state 초기화 +
  //   initialRecipients 있으면 그 값으로 recipients 적용.
  useEffect(() => {
    if (show) {
      // 알림톡 채널/매핑 state 초기화 — 직접발송 ↔ 타겟발송 간 매핑 유출 차단
      setKakaoSelectedTemplate(null);
      setKakaoTemplateVars({});
      setAlimtalkProfileId('');
      setAlimtalkFallback('L');
      setAlimtalkNextContents('');
      // ★ D188 (2026-05-21) 영업팀장 신고 #7-(2): LMS 대체 제목 state reset.
      if (setAlimtalkNextSubject) setAlimtalkNextSubject('');
      // 파일 매핑/입력 state 초기화
      setFileHeaders([]);
      setFileAllData([]);
      setPhoneColumn('');
      setShowMapping(false);
      setDirectInput('');
      setInputMode('direct');
      // ★ D162-4 (2026-05-15) 7차: 직접발송 진입 시 고객 DB 표준 필드 fetch — 변수 매칭 옵션 제공.
      //   Harold님 명시 정합. 직접타겟발송도 recipients[0] keys 우선이지만 fallback으로 활용.
      const token = localStorage.getItem('token');
      fetch('/api/customers/enabled-fields', { headers: { Authorization: `Bearer ${token}` } })
        .then((r) => r.json())
        .then((data) => {
          if (data && Array.isArray(data.fields)) {
            setEnabledFields(data.fields);
          }
        })
        .catch(() => {
          /* 권한/네트워크 실패 시 빈 배열 유지 — recipients[0] 또는 props fallback */
        });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [show]);

  // ★ D162-4 (2026-05-15) 8차: initialRecipients 변경 감지 — Harold님 명시 정합.
  //   직접타겟발송에서 추출된 수신자가 인계될 때 useEffect deps에 initialRecipients 누락되어 빈 배열로 남던 문제 차단.
  //   show=true 시 initialRecipients가 있으면 그대로 적용, 없으면 빈 배열(직접발송 자체 입력).
  //   매핑/state reset은 show=true 진입 시 1회만(위 useEffect) — 사용자 매핑 변경이 reset되는 사고 방지.
  useEffect(() => {
    if (!show) return;
    setRecipients(initialRecipients && initialRecipients.length > 0 ? initialRecipients : []);
  }, [show, initialRecipients]);

  // ★ D162-4 (2026-05-15) 3차: 파일 컬럼 매핑 모달 — Harold님 명시 정합 "직접발송과 똑같이 필드선택 가능".
  //   파일 업로드 직후 매핑 모달 진입 → 핸드폰 컬럼 + 템플릿 변수별 컬럼 매핑 → 적용 시 recipients + variableMap 자동 적용.
  const [showMapping, setShowMapping] = useState(false);
  const [fileHeaders, setFileHeaders] = useState<string[]>([]);
  const [fileAllData, setFileAllData] = useState<any[]>([]);
  const [phoneColumn, setPhoneColumn] = useState('');
  // ★ D162-4 (2026-05-15) 7차: 직접발송 진입 시 고객 DB 표준 필드(/api/customers/enabled-fields)를 변수 매칭 옵션으로 활용.
  //   Harold님 명시 정합 "직접발송은 싱크에이전트나 이미 업로드된 고객DB를 가지고 보내는거잖아".
  //   발송 시 backend가 phone으로 고객 조회 + 자동 치환(기존 SMS 발송 패턴 동일).
  const [enabledFields, setEnabledFields] = useState<Array<{
    field_key: string;
    display_name?: string;
    field_label?: string;
  }>>([]);

  // ★ D162-4 (2026-05-15) 7차: 동적 컬럼 옵션 — Harold님 명시 정합 (직접발송 vs 직접타겟발송 차이 반영).
  //   우선순위:
  //   (1) 직접타겟발송 — recipients[0] keys(phone 외): 추출된 row의 실제 컬럼이 그대로 매칭 옵션
  //   (2) 직접발송 — enabledFields(/api/customers/enabled-fields): 고객 DB 표준 필드(name/gender/birth_date 등)
  //                  backend가 발송 시점에 phone으로 customers 조회 + 자동 치환 (기존 SMS 발송 패턴 동일)
  //   (3) Fallback — props customerFieldOptions
  const dynamicFieldOptions = useMemo(() => {
    // (1) 추출된 row가 있으면 그 keys 우선
    const sample = recipients[0];
    if (sample) {
      const keys = Object.keys(sample).filter((k) => k !== 'phone');
      if (keys.length > 0) {
        return keys.map((k) => ({ key: k, label: FIELD_LABEL_MAP[k] || k }));
      }
    }
    // (2) 고객 DB 표준 필드
    if (enabledFields.length > 0) {
      return enabledFields.map((f) => ({
        key: f.field_key,
        label: f.display_name || f.field_label || f.field_key,
      }));
    }
    // (3) props fallback
    return customerFieldOptions;
  }, [recipients, enabledFields, customerFieldOptions]);

  // ★ 2026-06-05: 수신자 미리보기 컬럼 — 변수 매칭 여부와 무관하게 recipients의 실제 필드(phone 외)를 항상 표시.
  //   기존 방식(매핑된 변수 컬럼만 표시)은 주소록/엑셀을 불러와도 수신번호만 노출시켜 직원 신고 발생.
  const previewColumns = useMemo(() => {
    const sample = recipients[0];
    if (!sample) return [] as string[];
    return Object.keys(sample).filter((k) => k !== 'phone');
  }, [recipients]);

  // ★ 2026-06-05: 주소록/엑셀 불러오면 변수↔필드 자동 매핑 (변수명 = 필드명/라벨/별칭 일치 시).
  //   사용자가 비워 둔 변수만 채움 — 직접 입력·선택한 매핑은 보존.
  useEffect(() => {
    if (recipients.length === 0 || !kakaoSelectedTemplate?.content) return;
    const fields = Object.keys(recipients[0]).filter((k) => k !== 'phone');
    if (fields.length === 0) return;
    const vars = Array.from(new Set(kakaoSelectedTemplate.content.match(/#\{[^}]+\}/g) || [])) as string[];
    const autoMap: Record<string, string> = {};
    vars.forEach((v) => {
      const inner = v.replace(/^#\{|\}$/g, '').trim();
      const matched = fields.find(
        (f) => f === inner || FIELD_LABEL_MAP[f] === inner || (FIELD_NAME_ALIASES[f] || []).includes(inner),
      );
      if (matched) autoMap[v] = `@@${matched}@@`;
    });
    if (Object.keys(autoMap).length === 0) return;
    setKakaoTemplateVars((prev) => {
      const next = { ...prev };
      for (const [k, val] of Object.entries(autoMap)) {
        if (!next[k]) next[k] = val;
      }
      return next;
    });
  }, [recipients, kakaoSelectedTemplate]);

  // AlimtalkChannelPanel 통합 state
  const channelState: AlimtalkChannelState = useMemo(
    () => ({
      profileId: alimtalkProfileId,
      templateCode: kakaoSelectedTemplate?.template_code || '',
      templateId: kakaoSelectedTemplate?.id || '',
      variableMap: kakaoTemplateVars,
      nextType: alimtalkFallback,
      nextContents: alimtalkNextContents,
      // ★ D188 (2026-05-21) 영업팀장 신고 #7-(2): LMS 대체 제목 동기화.
      nextSubject: alimtalkNextSubject || '',
    }),
    [
      alimtalkProfileId,
      kakaoSelectedTemplate,
      kakaoTemplateVars,
      alimtalkFallback,
      alimtalkNextContents,
      alimtalkNextSubject,
    ],
  );

  const handleChannelChange = (v: AlimtalkChannelState) => {
    setAlimtalkProfileId(v.profileId);
    const nextTpl = alimtalkTemplates.find((t) => t.id === v.templateId) || null;
    setKakaoSelectedTemplate(nextTpl);
    setKakaoTemplateVars(v.variableMap);
    setAlimtalkFallback(v.nextType);
    setAlimtalkNextContents(v.nextContents);
    // ★ D188 (2026-05-21) 영업팀장 신고 #7-(2): LMS 대체 제목 동기화 setter.
    if (setAlimtalkNextSubject) setAlimtalkNextSubject(v.nextSubject || '');
  };

  // 직접입력 파싱 — 한 줄에 하나씩, 콤마/탭/공백 무시
  const parseDirectInput = () => {
    const lines = directInput
      .split(/[\n\r,;]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    const parsed = lines
      .map((raw) => {
        const phone = normalizePhoneKr(raw);
        return phone ? { phone } : null;
      })
      .filter(Boolean) as any[];
    if (parsed.length === 0) {
      setToast({ show: true, type: 'error', message: '유효한 수신번호를 입력해주세요.' });
      return;
    }
    // 중복 제거
    const dedup = dedupEnabled
      ? Array.from(new Map(parsed.map((r) => [r.phone, r])).values())
      : parsed;
    setRecipients(dedup);
    setToast({
      show: true,
      type: 'success',
      message: `${dedup.length}건 ${dedupEnabled && dedup.length !== parsed.length ? `(중복 ${parsed.length - dedup.length}건 제거)` : ''} 추가됨`,
    });
  };

  // ★ D162-4 (2026-05-15) 3차: 파일 업로드 — Harold님 명시 정합 "직접발송과 똑같이 필드선택 가능".
  //   파싱 후 자동 인식만 하지 X. 컬럼 매핑 모달 진입 → 핸드폰 + 템플릿 변수별 컬럼 사용자 선택 → 적용.
  const handleFileUpload = async (file: File) => {
    setFileLoading(true);
    const formData = new FormData();
    formData.append('file', file);
    try {
      const token = localStorage.getItem('token');
      const res = await fetch('/api/upload/parse?includeData=true', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
      });
      const data = await res.json();
      if (!data.success) {
        setToast({ show: true, type: 'error', message: data.error || '파일 파싱 실패' });
        return;
      }
      const allData: any[] = data.allData || data.preview || [];
      const headers: string[] = data.headers || [];
      if (headers.length === 0 || allData.length === 0) {
        setToast({ show: true, type: 'error', message: '파일에서 데이터를 읽을 수 없습니다.' });
        return;
      }
      setFileHeaders(headers);
      setFileAllData(allData);
      // 핸드폰 컬럼 자동 인식 (사용자 변경 가능)
      const autoPhone =
        headers.find((h) => /휴대폰|전화|핸드폰|연락처|phone|mobile|hp/i.test(h)) || headers[0] || '';
      setPhoneColumn(autoPhone);
      // 템플릿 변수 자동 매칭 — 변수명이 컬럼명과 일치하면 `@@컬럼@@` placeholder 적용
      if (kakaoSelectedTemplate?.content) {
        const vars = (kakaoSelectedTemplate.content.match(/#\{[^}]+\}/g) || []) as string[];
        const uniqueVars = Array.from(new Set(vars));
        const autoMap: Record<string, string> = {};
        uniqueVars.forEach((v) => {
          const inner = v.replace(/^#\{|\}$/g, '').trim();
          const matchedHeader = headers.find((h) => h.trim() === inner);
          if (matchedHeader && matchedHeader !== autoPhone) {
            autoMap[v] = `@@${matchedHeader}@@`;
          }
        });
        if (Object.keys(autoMap).length > 0) {
          setKakaoTemplateVars((prev) => ({ ...prev, ...autoMap }));
        }
      }
      setShowMapping(true);
    } catch {
      setToast({ show: true, type: 'error', message: '파일 업로드 중 오류가 발생했습니다.' });
    } finally {
      setFileLoading(false);
    }
  };

  // ★ D162-4 (2026-05-15) 3차: 매핑 적용 — 핸드폰 컬럼 + (변수 매칭은 variableMap에 적용) → recipients 적용.
  //   각 row는 파일 헤더 그대로 보존하여 발송 시 row[헤더명]으로 자동 치환 (AlimtalkVariableMappingPanel의 sampleRecipient 자동 치환과 정합).
  const applyMapping = () => {
    if (!phoneColumn) {
      setToast({ show: true, type: 'error', message: '핸드폰 번호 컬럼을 선택해주세요.' });
      return;
    }
    const parsed = fileAllData
      .map((row) => {
        const phone = normalizePhoneKr(row[phoneColumn]);
        if (!phone) return null;
        return { ...row, phone };
      })
      .filter(Boolean) as any[];
    if (parsed.length === 0) {
      setToast({ show: true, type: 'error', message: '유효한 수신번호가 없습니다.' });
      return;
    }
    const dedup = dedupEnabled
      ? Array.from(new Map(parsed.map((r) => [r.phone, r])).values())
      : parsed;
    setRecipients(dedup);
    setShowMapping(false);
    setToast({
      show: true,
      type: 'success',
      message: `${dedup.length}건 적용 완료${dedupEnabled && dedup.length !== parsed.length ? ` (중복 ${parsed.length - dedup.length}건 제거)` : ''}`,
    });
  };

  // ★ #2 (2026-06-01): 발송 성공 신호 수신 시 수신자 리스트만 초기화 (모달은 열린 채 — D225+ 흐름 유지).
  useEffect(() => {
    if (resetSignal && resetSignal > 0) {
      setRecipients([]);
      setDirectInput('');
    }
  }, [resetSignal]);

  // 발송 — 직접발송과 동일 검증 + onSendConfirm 위임
  const handleSend = async () => {
    if (sending) return;
    if (recipients.length === 0) {
      setToast({ show: true, type: 'error', message: '수신자를 먼저 추가해주세요.' });
      return;
    }
    if (!kakaoSelectedTemplate) {
      setToast({ show: true, type: 'error', message: '템플릿을 선택해주세요.' });
      return;
    }
    if (!['approved', 'APPROVED', 'APR', 'A'].includes(kakaoSelectedTemplate.status)) {
      setToast({ show: true, type: 'error', message: '승인된 템플릿만 발송 가능합니다.' });
      return;
    }
    if (
      ['A', 'B'].includes(alimtalkFallback) &&
      !alimtalkNextContents.trim()
    ) {
      setToast({ show: true, type: 'error', message: '대체 문구를 입력해주세요.' });
      return;
    }
    // ★ D188 (2026-05-21) 영업팀장 신고 #7-(2): L(LMS 대체) + B(LMS+문구) 시 LMS 제목 필수.
    if (
      ['L', 'B'].includes(alimtalkFallback) &&
      !(alimtalkNextSubject || '').trim()
    ) {
      setToast({ show: true, type: 'error', message: 'LMS 대체 발송 시 제목을 입력해주세요.' });
      return;
    }
    // ★ #3-2 (2026-06-01): 발송 전 변수 검증 — 빈 변수 / 데이터 없는 @@필드@@ 차단 (깨진 알림톡·미수신 방지)
    const varCheck = validateAlimtalkVariables(kakaoSelectedTemplate?.content, kakaoTemplateVars, recipients);
    if (!varCheck.ok) {
      const unfilled = varCheck.issues.filter((i) => i.kind === 'unfilled').map((i) => i.variable);
      const noData = varCheck.issues.find((i) => i.kind === 'no_data');
      const msg = unfilled.length > 0
        ? `값을 지정하지 않은 변수가 있습니다: ${unfilled.join(', ')}`
        : noData
          ? `${noData.missingCount}명의 수신자에게 '${noData.variable}' 변수 데이터가 없습니다. 데이터를 추가하거나 변수에 직접 값을 입력해주세요.`
          : '변수 설정을 확인해주세요.';
      setToast({ show: true, type: 'error', message: msg });
      return;
    }
    setSending(true);
    try {
      const token = localStorage.getItem('token');
      const phones = recipients.map((r) => r.phone);
      let unsubCount = 0;
      let dupCount = 0;
      if (unsubFilterEnabled) {
        const checkRes = await fetch('/api/unsubscribes/check', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ phones }),
        });
        const checkData = await checkRes.json();
        unsubCount = checkData.unsubscribeCount || 0;
        dupCount = checkData.duplicateCount || 0;
      }
      onSendConfirm({
        show: true,
        type: 'immediate',
        count: recipients.length - unsubCount - dupCount,
        unsubscribeCount: unsubCount,
        duplicateCount: dupCount,
        from: 'alimtalk',
        msgType: '알림톡',
        recipients,
        selectedTemplate: kakaoSelectedTemplate,
        variableMap: kakaoTemplateVars,
        fallback: alimtalkFallback,
        nextContents: alimtalkNextContents,
        // ★ D188 (2026-05-21) 영업팀장 신고 #7-(2): LMS 대체 제목 payload 전달.
        nextSubject: alimtalkNextSubject || '',
        profileId: alimtalkProfileId,
      });
    } finally {
      setSending(false);
    }
  };

  // ★ D218+ (2026-05-26) PDF 신고 #5 사고 정정: show prop 변경 + unmount path body overflow 강제 복원 안전망.
  //   옛 D188 handleClose 구현 = 외부 onClose 버튼 클릭 path만 cover. show=false prop 직접 변경 또는
  //   부모 unmount 흐름에서 body.style.overflow = 'hidden' 잔존 시 직접발송 패널 스크롤 X 사고 영구 차단.
  //   외부 다른 모달(BetaFeatureModal / ModalBase 등)이 hidden 설정 후 cleanup 누락한 경우도 cover.
  useEffect(() => {
    if (!show) {
      if (typeof document !== 'undefined' && document.body) {
        document.body.style.overflow = '';
      }
    }
    return () => {
      if (typeof document !== 'undefined' && document.body) {
        document.body.style.overflow = '';
      }
    };
  }, [show]);

  // ★ D188 (2026-05-21) 영업팀장 신고 #6-(2): close 시 sending state + body overflow 명시 reset 안전망.
  //   모달 close 후 직접 발송 패널 복귀 시 스크롤 차단 잔존 사고 영구 차단.
  //   document.body.style.overflow 적용된 영역 자체는 본 모달에서 변경 X 확인됨 — 영구 안전망으로 reset 명시.
  const handleClose = () => {
    setSending(false);
    try {
      if (typeof document !== 'undefined' && document.body) {
        document.body.style.overflow = '';
      }
    } catch {
      /* ignore */
    }
    onClose();
  };

  if (!show) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
      <div
        className="bg-white rounded-2xl shadow-2xl w-full max-w-[1400px] h-[92vh] flex flex-col overflow-hidden"
        style={{ animation: 'zoomIn 0.2s ease-out' }}
      >
        {/* 헤더 */}
        <div className="px-6 py-4 border-b border-gray-200 bg-gradient-to-r from-blue-50 to-white flex justify-between items-center shrink-0">
          <div className="flex items-center gap-3">
            <span className="w-10 h-10 rounded-xl bg-blue-100 flex items-center justify-center">
              <Bell size={20} className="text-blue-600" strokeWidth={1.75} />
            </span>
            <div>
              <h2 className="text-lg font-bold text-gray-900">알림톡 발송</h2>
              <p className="text-xs text-gray-500 mt-0.5">
                승인된 템플릿으로 즉시 발송합니다. 카카오톡 알림톡 전용 화면입니다.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={handleClose}
            className="p-2 text-gray-400 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition"
          >
            <X size={20} strokeWidth={1.75} />
          </button>
        </div>

        {/* 본문 — 2-col grid */}
        <div className="flex-1 grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] overflow-hidden">
          {/* 좌측: 알림톡 채널 */}
          <div className="p-5 overflow-y-auto border-r border-gray-100">
            <AlimtalkChannelPanel
              senders={alimtalkSenders}
              templates={alimtalkTemplates}
              customerFieldOptions={dynamicFieldOptions}
              value={channelState}
              onChange={handleChannelChange}
              sampleRecipient={recipients[0] || null}
            />
          </div>

          {/* 우측: 수신자 + 변수 매칭 */}
          <div className="p-5 overflow-y-auto bg-gray-50/40 space-y-4">
            {/* 변수 매칭 */}
            <AlimtalkVariableMappingPanel
              selectedTemplate={kakaoSelectedTemplate}
              variableMap={kakaoTemplateVars}
              onVariableMapChange={(next) => setKakaoTemplateVars(next)}
              customerFieldOptions={dynamicFieldOptions}
              sampleRecipient={recipients[0] || null}
              recipientCount={recipients.length}
            />

            {/* 수신자 영역 */}
            <div className="bg-white rounded-2xl border-2 border-gray-200 p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-lg">👥</span>
                  <span className="text-sm font-semibold text-gray-800">수신자</span>
                  <span className="ml-1 px-2 py-0.5 bg-emerald-50 text-emerald-700 rounded-full text-[11px] font-medium">
                    총 {recipients.length.toLocaleString()}건
                  </span>
                </div>
                <div className="flex items-center gap-2 text-[11px]">
                  <label className="inline-flex items-center gap-1 cursor-pointer">
                    <input
                      type="checkbox"
                      className="w-3.5 h-3.5"
                      checked={dedupEnabled}
                      onChange={(e) => setDedupEnabled(e.target.checked)}
                    />
                    <span className="text-gray-600">중복제거</span>
                  </label>
                  <label className="inline-flex items-center gap-1 cursor-pointer">
                    <input
                      type="checkbox"
                      className="w-3.5 h-3.5"
                      checked={unsubFilterEnabled}
                      onChange={(e) => setUnsubFilterEnabled(e.target.checked)}
                    />
                    <span className="text-gray-600">수신거부제거</span>
                  </label>
                </div>
              </div>

              {/* ★ D162-4 (2026-05-15) 2차: 입력 방식 탭 — 직접입력 / 파일등록 / 주소록 3개로 확장.
                  Harold님 명시 "주소록에서 가져와서 보내는것도 추가" 정합. AddressBookModal 재사용으로 동작 일관성. */}
              <div className="flex gap-1 bg-gray-100 rounded-lg p-1">
                <button
                  type="button"
                  onClick={() => setInputMode('direct')}
                  className={`flex-1 py-1.5 text-xs font-medium rounded-md transition ${
                    inputMode === 'direct'
                      ? 'bg-white shadow text-blue-600'
                      : 'text-gray-500 hover:text-gray-700'
                  }`}
                >
                  직접입력
                </button>
                <label
                  className={`flex-1 py-1.5 text-xs font-medium rounded-md text-center cursor-pointer transition ${
                    inputMode === 'file'
                      ? 'bg-white shadow text-blue-600'
                      : 'text-gray-500 hover:text-gray-700'
                  }`}
                >
                  {fileLoading ? '파일 분석중...' : '파일등록'}
                  <input
                    type="file"
                    accept=".xlsx,.xls,.csv"
                    className="hidden"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) {
                        setInputMode('file');
                        handleFileUpload(f);
                      }
                      e.target.value = '';
                    }}
                  />
                </label>
                <button
                  type="button"
                  onClick={() => {
                    setInputMode('address');
                    setShowAddressBook(true);
                  }}
                  className={`flex-1 py-1.5 text-xs font-medium rounded-md transition inline-flex items-center justify-center gap-1 ${
                    inputMode === 'address'
                      ? 'bg-white shadow text-blue-600'
                      : 'text-gray-500 hover:text-gray-700'
                  }`}
                >
                  <Contact size={13} strokeWidth={1.75} />
                  <span>주소록</span>
                </button>
              </div>

              {/* 직접입력 영역 */}
              {inputMode === 'direct' && (
                <div className="space-y-2">
                  <textarea
                    value={directInput}
                    onChange={(e) => setDirectInput(e.target.value)}
                    rows={8}
                    placeholder={
                      '수신번호를 한 줄에 하나씩 입력 (또는 콤마/세미콜론 구분)\n예시:\n01012345678\n010-2345-6789'
                    }
                    className="w-full border border-gray-200 rounded-lg p-2 text-xs font-mono resize-y focus:ring-2 focus:ring-blue-200 outline-none"
                  />
                  <button
                    type="button"
                    onClick={parseDirectInput}
                    className="w-full py-2 bg-blue-50 hover:bg-blue-100 text-blue-700 rounded-lg text-xs font-medium transition"
                  >
                    수신자로 추가
                  </button>
                </div>
              )}

              {/* ★ D162-4 (2026-05-15) 4차: 수신자 목록 — 매핑된 변수 컬럼도 함께 표시. Harold님 명시 정합. */}
              {recipients.length > 0 && (
                <div className="border border-gray-200 rounded-lg overflow-hidden">
                  <div className="bg-gray-50 px-3 py-1.5 border-b border-gray-200 flex items-center justify-between">
                    <span className="text-[11px] text-gray-500">
                      수신번호 (최근 {Math.min(recipients.length, 50)}건 표시)
                    </span>
                    <button
                      type="button"
                      onClick={() => setRecipients([])}
                      className="text-[11px] text-red-500 hover:text-red-600"
                    >
                      전체삭제
                    </button>
                  </div>
                  <div className="max-h-48 overflow-y-auto overflow-x-auto">
                    <table className="w-full text-xs">
                      {previewColumns.length > 0 && (
                        <thead className="bg-gray-50/70 sticky top-0">
                          <tr>
                            <th className="px-3 py-1 text-left text-[10px] font-medium text-gray-500 whitespace-nowrap">
                              수신번호
                            </th>
                            {previewColumns.map((col) => (
                              <th
                                key={col}
                                className="px-3 py-1 text-left text-[10px] font-medium text-gray-500 whitespace-nowrap"
                              >
                                {FIELD_LABEL_MAP[col] || col}
                              </th>
                            ))}
                            <th className="px-3 py-1 text-right"></th>
                          </tr>
                        </thead>
                      )}
                      <tbody>
                        {recipients.slice(0, 50).map((r, idx) => (
                          <tr
                            key={`${r.phone}-${idx}`}
                            className="border-b border-gray-100 last:border-0"
                          >
                            <td className="px-3 py-1 font-mono text-gray-700 whitespace-nowrap">{r.phone}</td>
                            {previewColumns.map((col) => (
                              <td
                                key={col}
                                className="px-3 py-1 text-gray-700 truncate max-w-[140px] whitespace-nowrap"
                              >
                                {r[col] != null && String(r[col]).trim() !== '' ? String(r[col]) : '-'}
                              </td>
                            ))}
                            <td className="px-3 py-1 text-right whitespace-nowrap">
                              <button
                                type="button"
                                onClick={() =>
                                  setRecipients((prev) => prev.filter((_, i) => i !== idx))
                                }
                                className="text-[11px] text-gray-400 hover:text-red-500"
                              >
                                삭제
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* 푸터 — 발송 버튼 */}
        <div className="px-6 py-4 border-t border-gray-200 bg-white shrink-0">
          <button
            type="button"
            onClick={handleSend}
            disabled={
              sending ||
              recipients.length === 0 ||
              !kakaoSelectedTemplate ||
              !['approved', 'APPROVED', 'APR', 'A'].includes(kakaoSelectedTemplate?.status)
            }
            className="w-full py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-bold text-base transition disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            <Bell size={18} strokeWidth={2} />
            <span>
              {sending
                ? '발송 준비중...'
                : recipients.length === 0
                  ? '수신자를 추가해주세요'
                  : !kakaoSelectedTemplate
                    ? '템플릿을 선택해주세요'
                    : `${recipients.length.toLocaleString()}명에게 알림톡 발송하기`}
            </span>
          </button>
        </div>

        <style>{`
          @keyframes zoomIn {
            from { opacity: 0; transform: scale(0.96); }
            to { opacity: 1; transform: scale(1); }
          }
        `}</style>
      </div>

      {/* ★ D162-4 (2026-05-15) 2차: 주소록 모달 — Harold님 명시 정합. recipients/setRecipients position에 위임 → 그룹 선택 시 자동 적용. */}
      <AddressBookModal
        show={showAddressBook}
        onClose={() => setShowAddressBook(false)}
        directRecipients={recipients}
        setDirectRecipients={setRecipients}
        setToast={setToast}
      />

      {/* ★ D162-4 (2026-05-15) 3차: 파일 컬럼 매핑 모달 — Harold님 명시 정합 "직접발송과 똑같이 필드선택 가능".
          핸드폰 컬럼 + 템플릿 변수별 컬럼 매핑 + 미리보기. 적용 시 recipients 적용 + 변수 placeholder 자동 적용. */}
      {showMapping && (
        <div
          className="fixed inset-0 bg-black/50 backdrop-blur-sm z-[60] flex items-center justify-center p-4"
          onClick={(e) => {
            if (e.target === e.currentTarget) setShowMapping(false);
          }}
        >
          <div
            className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[85vh] flex flex-col overflow-hidden"
            style={{ animation: 'zoomIn 0.2s ease-out' }}
          >
            {/* 헤더 */}
            <div className="px-6 py-4 border-b border-gray-200 bg-gradient-to-r from-blue-50 to-white flex justify-between items-center shrink-0">
              <div>
                <h3 className="text-lg font-bold text-gray-900">컬럼 매핑</h3>
                <p className="text-xs text-gray-500 mt-0.5">
                  핸드폰 컬럼 + 템플릿 변수별 컬럼을 선택하면 발송 대상자별로 자동 치환됩니다.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowMapping(false)}
                className="text-gray-400 hover:text-gray-600 text-2xl shrink-0 ml-2"
                aria-label="닫기"
              >
                &times;
              </button>
            </div>

            {/* 본문 — 스크롤 */}
            <div className="px-6 py-5 overflow-y-auto flex-1 space-y-4">
              {/* 핸드폰 컬럼 */}
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">
                  핸드폰 번호 컬럼 <span className="text-red-500">*</span>
                </label>
                <select
                  value={phoneColumn}
                  onChange={(e) => setPhoneColumn(e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-200 outline-none"
                >
                  <option value="">선택</option>
                  {fileHeaders.map((h) => (
                    <option key={h} value={h}>
                      {h}
                    </option>
                  ))}
                </select>
              </div>

              {/* 템플릿 변수 매칭 */}
              {kakaoSelectedTemplate?.content && (() => {
                const vars = Array.from(
                  new Set((kakaoSelectedTemplate.content.match(/#\{[^}]+\}/g) || []) as string[]),
                );
                if (vars.length === 0) {
                  return (
                    <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-3 text-xs text-emerald-700">
                      선택한 템플릿에 치환 변수가 없습니다. 핸드폰 컬럼만 매핑하면 됩니다.
                    </div>
                  );
                }
                return (
                  <div>
                    <p className="text-xs font-medium text-gray-600 mb-1">
                      템플릿 변수 매핑 <span className="text-gray-400">({vars.length}개)</span>
                    </p>
                    <p className="text-[11px] text-gray-400 mb-2 leading-relaxed">
                      파일 컬럼 선택 시 발송 대상자별 자동 치환. 직접 입력 시 모든 수신자에게 같은 값으로 발송.
                    </p>
                    <div className="space-y-2">
                      {vars.map((v) => {
                        const current = kakaoTemplateVars[v] || '';
                        const isFieldRef = current.startsWith('@@') && current.endsWith('@@');
                        const fieldKey = isFieldRef ? current.slice(2, -2) : '';
                        return (
                          <div key={v} className="grid grid-cols-[100px_1fr] md:grid-cols-[120px_1fr] gap-2 items-center">
                            <span className="text-[11px] font-mono text-amber-700 bg-amber-50 rounded px-2 py-1 truncate">
                              {v}
                            </span>
                            <div className="flex items-center gap-2">
                              <select
                                value={isFieldRef ? fieldKey : '__manual__'}
                                onChange={(e) => {
                                  const val = e.target.value;
                                  if (val === '__manual__') {
                                    setKakaoTemplateVars((prev) => ({ ...prev, [v]: '' }));
                                  } else {
                                    setKakaoTemplateVars((prev) => ({ ...prev, [v]: `@@${val}@@` }));
                                  }
                                }}
                                className="border border-gray-200 rounded px-2 py-1 text-xs max-w-[170px]"
                              >
                                <option value="__manual__">직접 입력 (모든 수신자 동일)</option>
                                {fileHeaders
                                  .filter((h) => h !== phoneColumn)
                                  .map((h) => (
                                    <option key={h} value={h}>
                                      {h}
                                    </option>
                                  ))}
                              </select>
                              {!isFieldRef && (
                                <input
                                  type="text"
                                  value={current}
                                  onChange={(e) =>
                                    setKakaoTemplateVars((prev) => ({ ...prev, [v]: e.target.value }))
                                  }
                                  placeholder="값 입력"
                                  className="flex-1 border border-gray-200 rounded px-2 py-1 text-xs"
                                />
                              )}
                              {isFieldRef && (
                                <span className="flex-1 text-[11px] text-emerald-700 bg-emerald-50 rounded px-2 py-1 truncate">
                                  컬럼: {fieldKey}
                                </span>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })()}

              {/* 파일 미리보기 */}
              {fileAllData.length > 0 && (
                <div>
                  <p className="text-xs font-medium text-gray-600 mb-1">
                    파일 미리보기 <span className="text-gray-400">(최대 5건 / 총 {fileAllData.length.toLocaleString()}건)</span>
                  </p>
                  <div className="border border-gray-200 rounded-lg overflow-x-auto">
                    <table className="w-full text-[11px]">
                      <thead className="bg-gray-50">
                        <tr>
                          {fileHeaders.map((h) => (
                            <th
                              key={h}
                              className={`px-2 py-1 text-left font-medium whitespace-nowrap ${
                                h === phoneColumn ? 'text-blue-700 bg-blue-50' : 'text-gray-500'
                              }`}
                            >
                              {h}
                              {h === phoneColumn && <span className="ml-1 text-[10px]">📱</span>}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {fileAllData.slice(0, 5).map((row, i) => (
                          <tr key={i} className="border-t border-gray-100">
                            {fileHeaders.map((h) => (
                              <td
                                key={h}
                                className="px-2 py-1 text-gray-700 truncate max-w-[140px] whitespace-nowrap"
                              >
                                {row[h] != null ? String(row[h]) : ''}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>

            {/* 푸터 */}
            <div className="px-6 py-3 border-t border-gray-200 bg-gray-50 flex justify-end gap-2 shrink-0">
              <button
                type="button"
                onClick={() => setShowMapping(false)}
                className="px-5 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg text-sm"
              >
                취소
              </button>
              <button
                type="button"
                onClick={applyMapping}
                disabled={!phoneColumn}
                className="px-5 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed"
              >
                매핑 적용
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
