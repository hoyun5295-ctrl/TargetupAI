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

import { useState, useMemo, useEffect, useRef } from 'react';
import {
  Bell, CalendarClock, ChevronDown, ChevronRight, CircleX, Contact, FolderOpen, MessageSquareReply,
  PencilLine, Search, Send, Timer, Trash2, Upload, X,
} from 'lucide-react';
import {
  AlimtalkFallbackEditor,
  NEXT_TYPE_OPTIONS,
  buildAlimtalkPreviewProps,
  extractVariables,
  useAlimtalkChannel,
  validateAlimtalkChannelState,
  type AlimtalkChannelState,
  type AlimtalkSenderProfile,
  type AlimtalkTemplate,
} from './alimtalk/AlimtalkChannelPanel';
import AlimtalkPreview from './alimtalk/AlimtalkPreview';
import AlimtalkTemplatePickerModal from './alimtalk/AlimtalkTemplatePickerModal';
import KakaoSendHeader from './kakao-send/KakaoSendHeader';
import SplitSendPopover from './direct-send/SplitSendPopover';
import '../styles/direct-send.css';
import AlimtalkVariableMappingPanel from './alimtalk/AlimtalkVariableMappingPanel';
import AddressBookModal from './AddressBookModal';
import ScheduleTimeModal from './ScheduleTimeModal';
import { normalizePhoneKr } from '../utils/formatDate';
import { validateAlimtalkVariables, extractAlimtalkVariables } from '../utils/alimtalkVars';
import RecipientDirectInputModal, { type PastePreview, type RowAddResult } from './direct-send/RecipientDirectInputModal';
import { checkAlimtalkPaste, planAppend } from '../utils/recipient-paste';

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
    type: 'immediate' | 'scheduled';
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
    /** ★ 2026-06-05: stage 적재로 생성된 stagingId — Dashboard commit이 이 값으로 발송(staging 기반). */
    stagingId?: string;
    /** ★ 2026-09-14 알림톡 예약·분할(박성용 접수): 예약 시각(ScheduleTimeModal의 로컬 시각 문자열). 즉시 발송이면 없음. */
    dateTime?: string;
    /** 분할전송 여부·분당 건수. Dashboard 전역(직접발송 패널) 값이 아니라 이 창의 값이다. */
    splitEnabled: boolean;
    splitCount: number;
  }) => void;

  setToast: (t: { show: boolean; type: 'success' | 'error' | 'warning'; message: string }) => void;

  /** ★ D162-4 (2026-05-15) 4차: 직접타겟발송에서 추출된 수신자 그대로 인계받기 (Harold님 명시 정합).
   *   show=true 진입 + initialRecipients 길이 > 0이면 자동 setRecipients. 사용자 별도 입력 X. */
  initialRecipients?: any[];

  /** ★ #2 (2026-06-01): 발송 성공 시 증가하는 신호 — 수신자 리스트만 초기화(모달은 열린 채 유지). */
  resetSignal?: number;

  /**
   * ★ 2026-09-25 머리의 채널 전환(문자 발송 · 브랜드메시지) — 주면 버튼이 보인다.
   *   phones = 지금 명단의 번호 · rows = 지금 명단의 줄 그대로(문자 쪽은 줄의 정체로 되돌린다 · Codex 9R).
   */
  onSwitchChannel?: (to: 'sms' | 'brand', phones: string[], rows: any[]) => void;
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
  onSwitchChannel,
}: AlimtalkSendModalProps) {
  // 수신자 영역 — 알림톡 전용 state (직접발송 directRecipients와 격리)
  const [inputMode, setInputMode] = useState<'direct' | 'file' | 'address'>('direct');
  // ★ 2026-09-25 직접입력 = 공용 창(입력칸은 수신자 열에서 걷었다 · Harold 목업 v2)
  const [directInputOpen, setDirectInputOpen] = useState(false);
  const [recipients, setRecipients] = useState<any[]>([]);
  const [fileLoading, setFileLoading] = useState(false);
  const [dedupEnabled, setDedupEnabled] = useState(true);
  const [unsubFilterEnabled, setUnsubFilterEnabled] = useState(true);
  const [sending, setSending] = useState(false);
  // ★ D162-4 (2026-05-15) 2차: 주소록 진입 — Harold님 명시 정합. AddressBookModal 재사용 (recipients/setRecipients 위임).
  const [showAddressBook, setShowAddressBook] = useState(false);
  // ★ 2026-09-14 박성용 접수(알림톡 예약·분할): 예약·분할 값은 이 창이 직접 들고 있다.
  //   Dashboard의 reserveEnabled·splitEnabled는 직접발송 패널 값이라, 그걸 쓰면 패널에서 켜 둔 예약이 알림톡에 섞인다.
  const [reserveEnabled, setReserveEnabled] = useState(false);
  const [reserveDateTime, setReserveDateTime] = useState('');
  const [showReservePicker, setShowReservePicker] = useState(false);
  const [splitEnabled, setSplitEnabled] = useState(false);
  const [splitCount, setSplitCount] = useState(1000);

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
      setDirectInputOpen(false);
      setInputMode('direct');
      // 예약·분할도 창을 열 때마다 끈 상태로 시작한다(지난 창의 예약이 다음 발송에 남지 않게)
      setReserveEnabled(false);
      setReserveDateTime('');
      setShowReservePicker(false);
      setSplitEnabled(false);
      setSplitCount(1000);
      // ★ 2026-06-05: 직접발송 알림톡은 사용자가 올린 데이터(recipients keys)만 변수 매칭 옵션으로 사용.
      //   기존 고객 DB 표준 필드 fetch는 수신자 0건에도 DB 필드가 노출돼
      //   #{고객명}→name 자동 매핑·고정 발송을 유발해 제거(직원 신고).
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

  // ★ 2026-09-25 명단 전체 칸(phone 외 · 처음 나온 순서). 예전엔 첫 줄 칸만 봤다 — 번호만 붙여넣은 줄 뒤에
  //   [변수와 함께 한 건씩]으로 넣은 값(이름·주문번호 칸)이 칸 목록·자동 연결·목록 표시에서 빠져, 보내기 전 검사에 막혔다.
  //   파일·주소록처럼 모든 줄의 칸이 같으면 결과는 첫 줄과 같다.
  const recipientFieldKeys = useMemo(() => {
    const seen = new Set<string>();
    for (const r of recipients) {
      for (const k of Object.keys(r || {})) if (k !== 'phone') seen.add(k);
    }
    return Array.from(seen);
  }, [recipients]);

  // ★ 2026-06-05: 변수 매칭 옵션 — 사용자가 올린 데이터(명단 칸)만 사용.
  //   직접발송 알림톡에 고객 DB 표준 필드를 노출하지 않음(수신자 0건에 DB 필드 노출·고정 발송 문제 차단, 직원 신고).
  const dynamicFieldOptions = useMemo(() => {
    if (recipientFieldKeys.length > 0) {
      return recipientFieldKeys.map((k) => ({ key: k, label: FIELD_LABEL_MAP[k] || k }));
    }
    // 업로드 데이터가 없으면 옵션 없음(직접 입력만).
    return customerFieldOptions;
  }, [recipientFieldKeys, customerFieldOptions]);

  // ★ 2026-06-05: 수신자 미리보기 컬럼 — 변수 매칭 여부와 무관하게 recipients의 실제 필드(phone 외)를 항상 표시.
  //   기존 방식(매핑된 변수 컬럼만 표시)은 주소록/엑셀을 불러와도 수신번호만 노출시켜 직원 신고 발생.
  const previewColumns = recipientFieldKeys;

  // ★ 2026-06-05: 주소록/엑셀 불러오면 변수↔필드 자동 매핑 (변수명 = 필드명/라벨/별칭 일치 시).
  //   사용자가 비워 둔 변수만 채움 — 직접 입력·선택한 매핑은 보존.
  useEffect(() => {
    if (recipients.length === 0 || !kakaoSelectedTemplate?.content) return;
    const fields = recipientFieldKeys;
    if (fields.length === 0) return;
    const vars = Array.from(new Set(kakaoSelectedTemplate.content.match(/#\{[^}]+\}/g) || [])) as string[];
    const autoMap: Record<string, string> = {};
    vars.forEach((v) => {
      const inner = v.replace(/^#\{|\}$/g, '').trim();
      // ★ 2026-09-25 정확히 같은 이름을 먼저 찾는다(Codex 1R). 한 번에 찾으면 칸 순서에 따라 별칭이 이겨
      //   #{name}·#{이름} 이 둘 다 name 칸(라벨 "이름")으로 이어져 한 사람의 두 값 중 하나가 다른 값으로 나갔다.
      const matched = fields.find((f) => f === inner)
        || fields.find((f) => FIELD_LABEL_MAP[f] === inner || (FIELD_NAME_ALIASES[f] || []).includes(inner));
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
  }, [recipients, recipientFieldKeys, kakaoSelectedTemplate]);

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

  // ★ 2026-09-25 직접입력(공용 창) — 붙여넣기는 지금 명단에 **더한다**(예전 = 명단 통째 교체 · 버튼 이름 "추가"와 달랐다 · Harold 승인).
  //   [중복제거] 켜짐 = 이번 입력 안의 중복과 지금 명단에 이미 있는 번호를 뺀다 · 꺼짐 = 전부 더한다.
  //   검수(창에 보이는 수)와 더하기가 같은 함수(checkAlimtalkPaste · planAppend)라 보인 수 = 더해진 수.
  //   섞인 명단(파일 줄 + 번호만 줄)은 보내기 직전 validateAlimtalkVariables 가 빈 변수 수신자를 막는다.
  const planPaste = (text: string) => {
    const check = checkAlimtalkPaste(text);
    return { check, plan: planAppend(check.phones, recipients.map((r) => r?.phone), dedupEnabled) };
  };
  const previewDirectPaste = (text: string): PastePreview => {
    const { check, plan } = planPaste(text);
    return {
      add: plan.add.length,
      notes: plan.dup > 0
        ? [dedupEnabled
          ? { text: `중복 ${plan.dup.toLocaleString()} 제외`, tone: 'neutral' as const }
          : { text: `같은 번호 ${plan.dup.toLocaleString()} · 중복제거가 꺼져 있어 여러 번 나가요`, tone: 'warn' as const }]
        : [],
      invalid: check.invalid,
    };
  };
  const submitDirectPaste = (text: string) => {
    const { plan } = planPaste(text);
    if (plan.add.length === 0) return;
    setRecipients([...recipients, ...plan.add.map((phone) => ({ phone }))]);
    setToast({
      show: true,
      type: 'success',
      message: `${plan.add.length.toLocaleString()}건 추가${dedupEnabled && plan.dup > 0 ? ` · 중복 ${plan.dup.toLocaleString()}건 제외` : ''}`,
    });
  };
  // 한 건씩 — 칸 = 템플릿 변수. 값은 변수 이름 칸(#{이름} → '이름')에 담는다 → 위 자동 연결이 @@이름@@ 으로 잇고,
  //   보낼 때는 파일 줄과 같은 적재 슬롯 매핑을 탄다. 칸을 비우면 보내기 전 검사에 막히므로 여기서 먼저 채우게 한다.
  //   ★ Codex 1R — 칸은 **지금 연결 기준**이다. 변수가 @@칸@@ 에 이어져 있으면 그 칸에 담고(파일 줄과 같은 모양),
  //   비어 있으면 변수 이름 칸에 담아 자동 연결이 잇게 한다. 모두에게 같은 값으로 정한 변수는 칸이 없다(넣어도 안 쓰인다).
  //   같은 칸을 쓰는 변수는 칸 하나로 모은다. 예전엔 늘 변수 이름 칸에 담아 파일 줄(name 칸)과 섞이면 어느 한쪽이 빈 값으로 막혔다.
  const directRowFields = useMemo(() => {
    const out: Array<{ key: string; label: string; tag: string }> = [];
    for (const v of extractAlimtalkVariables(kakaoSelectedTemplate?.content)) {
      const inner = v.replace(/^#\{|\}$/g, '').trim();
      const mapped = String(kakaoTemplateVars?.[v] ?? '');
      let key: string;
      if (mapped.startsWith('@@') && mapped.endsWith('@@')) key = mapped.slice(2, -2);
      else if (mapped.trim() === '') key = inner;
      else continue;
      if (!key || key === 'phone') continue;
      const same = out.find((f) => f.key === key);
      if (same) { same.tag = `${same.tag} ${v}`; continue; }
      out.push({ key, label: inner, tag: v });
    }
    return out;
  }, [kakaoSelectedTemplate?.content, kakaoTemplateVars]);
  const templateVarCount = extractAlimtalkVariables(kakaoSelectedTemplate?.content).length;
  const addDirectRow = (values: Record<string, string>): RowAddResult => {
    const phone = normalizePhoneKr(values.phone);
    if (!phone || phone.length < 10) return { ok: false, error: '수신번호를 확인해 주세요(10자리 이상 숫자)' };
    const empty = directRowFields.find((f) => !String(values[f.key] ?? '').trim());
    if (empty) return { ok: false, error: `${empty.label} 칸을 채워 주세요(${empty.tag})` };
    if (dedupEnabled && planAppend([phone], recipients.map((r) => r?.phone), true).add.length === 0) {
      return { ok: false, error: '이미 명단에 있는 번호예요(중복제거 켜짐)' };
    }
    const entry: Record<string, string> = { phone };
    directRowFields.forEach((f) => { entry[f.key] = String(values[f.key]).trim(); });
    setRecipients((prev) => [...prev, entry]);
    return { ok: true, phone };
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
      // 발송이 접수되면 예약·분할도 끈다(같은 창에서 이어 보내는 다음 건이 지난 예약 시각을 물려받지 않게)
      setReserveEnabled(false);
      setReserveDateTime('');
      setSplitEnabled(false);
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
    // ★ 2026-09-14 알림톡 예약: 시각 없는 예약·이미 지난 시각은 수신자 적재 전에 막는다(서버 validateScheduledAt이 최종 판정).
    if (reserveEnabled) {
      if (!reserveDateTime) {
        setToast({ show: true, type: 'error', message: '예약 시각을 선택해주세요.' });
        setShowReservePicker(true);
        return;
      }
      if (new Date(reserveDateTime) <= new Date()) {
        setToast({ show: true, type: 'error', message: '예약 시각이 이미 지났습니다. 다시 선택해주세요.' });
        setShowReservePicker(true);
        return;
      }
    }
    // ★ D188 (2026-05-21) 영업팀장 신고 #7-(2): L(LMS 대체) + B(LMS+문구) 시 LMS 제목 필수.
    // ★ 2026-07-27: 전환재발송 검증을 공용 CT(validateAlimtalkChannelState)로 통일 — 백엔드 규칙과 동일.
    const fallbackViolation = validateAlimtalkChannelState({
      profileId: '', templateCode: '', templateId: '', variableMap: {},
      nextType: alimtalkFallback as any,
      nextContents: alimtalkNextContents,
      nextSubject: alimtalkNextSubject,
    });
    if (fallbackViolation) {
      setToast({ show: true, type: 'error', message: fallbackViolation });
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

      // ★ 2026-06-05: 변수 매칭에 쓰인 컬럼 → stage 고정 슬롯(name/extra1~3) 매핑.
      //   campaign_send_staging이 고정 컬럼이라, 엑셀 임의 컬럼(이름/매장명 등)을 슬롯에 옮겨 담아야
      //   worker가 @@슬롯@@으로 변수 치환 가능. 주소록(name/extra1~3)은 그대로 유지됨.
      const SLOTS = ['name', 'extra1', 'extra2', 'extra3'];
      const usedCols = Array.from(new Set(
        Object.values(kakaoTemplateVars)
          .filter((v): v is string => typeof v === 'string' && v.startsWith('@@') && v.endsWith('@@'))
          .map((v) => v.slice(2, -2)),
      ));
      const colToSlot: Record<string, string> = {};
      const usedSlots = new Set<string>();
      usedCols.forEach((c) => { if (SLOTS.includes(c)) { colToSlot[c] = c; usedSlots.add(c); } });
      usedCols.forEach((c) => {
        if (colToSlot[c]) return;
        const free = SLOTS.find((s) => !usedSlots.has(s));
        if (free) { colToSlot[c] = free; usedSlots.add(free); }
      });
      const overflow = usedCols.filter((c) => !colToSlot[c]);
      if (overflow.length > 0) {
        setToast({ show: true, type: 'error', message: `변수 매칭 컬럼은 최대 4개까지만 발송됩니다. 초과: ${overflow.join(', ')}` });
        setSending(false);
        return;
      }
      const stageRecipients = recipients.map((r) => {
        const out: Record<string, any> = { phone: r.phone };
        for (const [col, slot] of Object.entries(colToSlot)) out[slot] = r[col] ?? null;
        return out;
      });
      const stagedVariableMap: Record<string, string> = {};
      for (const [varKey, val] of Object.entries(kakaoTemplateVars)) {
        if (typeof val === 'string' && val.startsWith('@@') && val.endsWith('@@')) {
          const col = val.slice(2, -2);
          stagedVariableMap[varKey] = colToSlot[col] ? `@@${colToSlot[col]}@@` : val;
        } else {
          stagedVariableMap[varKey] = val;
        }
      }

      // ★ 2026-06-05: stage 청크 적재 → stagingId (DirectSendPanel과 동일 파이프라인).
      //   기존엔 이 단계가 없어 commit이 stagingId 없이 "발송 준비 정보가 없습니다"로 차단됐음.
      const CHUNK = 50000;
      let stagingId: string | undefined;
      for (let i = 0; i < stageRecipients.length; i += CHUNK) {
        const slice = stageRecipients.slice(i, i + CHUNK);
        const stageRes = await fetch('/api/campaigns/direct-send/stage', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ stagingId, recipients: slice }),
        });
        const stageData = await stageRes.json();
        if (!stageData.success) {
          setToast({ show: true, type: 'error', message: stageData.error || '수신자 적재에 실패했습니다.' });
          setSending(false);
          return;
        }
        stagingId = stageData.stagingId;
      }

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
        type: reserveEnabled ? 'scheduled' : 'immediate',
        dateTime: reserveEnabled ? reserveDateTime : undefined,
        splitEnabled,
        splitCount,
        count: recipients.length - unsubCount - dupCount,
        unsubscribeCount: unsubCount,
        duplicateCount: dupCount,
        from: 'alimtalk',
        msgType: '알림톡',
        stagingId,
        recipients,
        selectedTemplate: kakaoSelectedTemplate,
        variableMap: stagedVariableMap,
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
  //   외부 다른 모달(ModalBase 등)이 hidden 설정 후 cleanup 누락한 경우도 cover.
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

  // ★ 2026-09-25 알림톡 발송 창 개편(Harold 목업 v2 승인) — 화면용 상태만 여기 둔다. 발송 값·검증은 위 handleSend 그대로다.
  //   채널 로직(발신프로필·템플릿·대체발송)은 공용 패널과 같은 한 벌(useAlimtalkChannel)을 쓴다 — 기존 패널과 같은 props.
  //   ⛔ 창이 닫혀 있으면 발신프로필을 빈 목록으로 준다 — 옛 패널은 닫힌 창에서 그려지지 않아 '하나뿐이면 자동 선택'이
  //     돌지 않았다. 훅은 창 맨 위에 있어 닫혀도 돈다. 그대로 두면 닫힌 창이 대시보드 공유 상태(발신프로필)를 바꾼다.
  const ch = useAlimtalkChannel({
    senders: show ? alimtalkSenders : [],
    templates: alimtalkTemplates,
    customerFieldOptions: dynamicFieldOptions,
    value: channelState,
    onChange: handleChannelChange,
    sampleRecipient: recipients[0] || null,
  });
  const [pickerOpen, setPickerOpen] = useState(false);
  const [splitOpen, setSplitOpen] = useState(false);
  const [fallbackOpen, setFallbackOpen] = useState(false);
  const fallbackAnchorRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [dragActive, setDragActive] = useState(false);
  const [listQuery, setListQuery] = useState('');
  const [listPage, setListPage] = useState(0);
  const [listSelected, setListSelected] = useState<Set<number>>(new Set());
  useEffect(() => {
    if (!show) return;
    setPickerOpen(false);
    setSplitOpen(false);
    setFallbackOpen(false);
    setListQuery('');
  }, [show]);
  // 명단이 바뀌면(추가·삭제·발송 뒤 비움) 선택을 풀고 첫 장으로
  useEffect(() => {
    setListSelected(new Set());
    setListPage(0);
  }, [recipients]);
  // 실패 시 문자 풍선 — 칸 바깥을 누르면 닫는다
  useEffect(() => {
    if (!fallbackOpen) return;
    const onDown = (e: MouseEvent) => {
      if (fallbackAnchorRef.current && !fallbackAnchorRef.current.contains(e.target as Node)) setFallbackOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [fallbackOpen]);
  const selectedVarCount = ch.selectedTemplate ? extractVariables(ch.selectedTemplate.content).length : 0;
  const currentSender = ch.approvedSenders.find((s) => s.id === alimtalkProfileId) || null;
  const fallbackLabel = NEXT_TYPE_OPTIONS.find((o) => o.value === alimtalkFallback)?.label || '대체 문자';
  // 표시용 — 보내기 직전 판정은 handleSend의 validateAlimtalkChannelState가 한다(같은 조건 · 같은 순서: 대체문안 → 제목)
  const fallbackIssue = !ch.selectedTemplate
    ? null
    : ch.requiresNextContents && !String(alimtalkNextContents || '').trim()
      ? '대체문안을 넣어 주세요'
      : ch.requiresNextSubject && !String(alimtalkNextSubject || '').trim()
        ? 'LMS 제목을 넣어 주세요'
        : null;
  const LIST_PAGE_SIZE = 10;
  const listFiltered = recipients
    .map((r, idx) => ({ ...r, originalIdx: idx }))
    .filter((r) => !listQuery || String(r.phone || '').includes(listQuery));
  const listTotalPages = Math.max(1, Math.ceil(listFiltered.length / LIST_PAGE_SIZE));
  const listCurrentPage = Math.min(listPage, listTotalPages - 1);
  const listPageItems = listFiltered.slice(listCurrentPage * LIST_PAGE_SIZE, (listCurrentPage + 1) * LIST_PAGE_SIZE);
  // ★Codex 3R — 선택 범위 = 지금 보이는 목록(검색 결과). 머리 체크박스가 숨은 줄까지 고르면 선택삭제가 안 보이는 번호를 지운다
  const listVisibleIdx = listFiltered.map((r) => r.originalIdx);
  const listAllVisibleChecked = listVisibleIdx.length > 0 && listVisibleIdx.every((i) => listSelected.has(i));

  if (!show) return null;

  return (
    <div
      className="ds-scope ds-backdrop"
      onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }}
      onDrop={(e) => { e.preventDefault(); e.stopPropagation(); }}
    >
      <div className="ds-modal">
        <KakaoSendHeader
          channel="alimtalk"
          title="알림톡 발송"
          subtitle="승인된 템플릿으로 보내요 · 원하는 시각에 예약도 돼요"
          onSwitch={onSwitchChannel ? (to) => onSwitchChannel(to === 'brand' ? 'brand' : 'sms', recipients.map((r) => r.phone), recipients) : undefined}
          onClose={handleClose}
        />

        {/* ★ 2026-09-25 3열 — 작성(발신프로필 · 템플릿 · 변수) / 받는 화면 / 수신자. 틀 = direct-send.css "카카오 발송 창" 절 */}
        <div className="ds-modal__body ks-body">
          {/* ====== 작성 ====== */}
          <section className="ks-compose">
            <div>
              <p className="ks-label">발신프로필</p>
              {ch.approvedSenders.length === 0 ? (
                <p className="ks-warn">승인된 발신프로필이 없어요. 슈퍼관리자 승인이 끝나면 쓸 수 있어요.</p>
              ) : ch.approvedSenders.length === 1 ? (
                <div className="ks-static">
                  <span className="ks-avatar">{ch.approvedSenders[0].profile_name.slice(0, 1)}</span>
                  <span className="truncate">{ch.approvedSenders[0].profile_name}</span>
                  {ch.approvedSenders[0].yellow_id && <small>{ch.approvedSenders[0].yellow_id}</small>}
                </div>
              ) : (
                <select
                  className="ks-select"
                  value={alimtalkProfileId}
                  onChange={(e) => ch.setProfileId(e.target.value)}
                  aria-label="발신프로필"
                >
                  <option value="">발신프로필을 고르세요</option>
                  {ch.approvedSenders.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.profile_name}
                      {s.yellow_id ? ` (${s.yellow_id})` : ''}
                    </option>
                  ))}
                </select>
              )}
            </div>

            <div>
              <p className="ks-label">템플릿<small>누르면 템플릿을 받는 화면 예시로 보여 줘요</small></p>
              <button
                type="button"
                className={`ks-pick ${!ch.selectedTemplate ? 'ks-pick--empty' : ''}`}
                disabled={!alimtalkProfileId}
                onClick={() => setPickerOpen(true)}
              >
                <span className="ks-pick__thumb ks-pick__thumb--kakao"><Bell size={18} strokeWidth={2} /></span>
                <span className="ks-pick__tx">
                  <b>{ch.selectedTemplate ? ch.selectedTemplate.template_name : '템플릿을 골라 주세요'}</b>
                  <small>
                    {ch.selectedTemplate
                      ? `승인 · 변수 ${selectedVarCount}개 · 버튼 ${Array.isArray(ch.selectedTemplate.buttons) ? ch.selectedTemplate.buttons.length : 0}개`
                      : alimtalkProfileId
                        ? `승인된 템플릿 ${ch.visibleTemplates.length}개`
                        : '먼저 발신프로필을 골라 주세요'}
                  </small>
                </span>
                <span className="ks-pick__go ks-pick__go--amber">
                  {ch.selectedTemplate ? '바꾸기' : '고르기'}
                  <ChevronRight size={14} strokeWidth={2.2} />
                </span>
              </button>
            </div>

            {ch.selectedTemplate && (
              <div>
                <p className="ks-label">변수 채우기<small>수신자 명단 칸과 연결해요</small></p>
                {selectedVarCount > 0 ? (
                  <AlimtalkVariableMappingPanel
                    layout="rows"
                    selectedTemplate={kakaoSelectedTemplate}
                    variableMap={kakaoTemplateVars}
                    onVariableMapChange={(next) => setKakaoTemplateVars(next)}
                    customerFieldOptions={dynamicFieldOptions}
                    sampleRecipient={recipients[0] || null}
                    recipientCount={recipients.length}
                  />
                ) : (
                  <p className="ks-note">이 템플릿은 채울 변수가 없어요.</p>
                )}
              </div>
            )}
          </section>

          {/* ====== 받는 화면 ====== */}
          <section className="ks-preview">
            <div className="ks-preview__head">
              <b>받는 화면</b>
              {ch.selectedTemplate && (
                <span className="ks-seg" role="group" aria-label="미리보기 방식">
                  <button type="button" className={ch.previewMode === 'template' ? 'on' : ''} onClick={() => ch.setPreviewMode('template')}>원본</button>
                  <button type="button" className={ch.previewMode === 'filled' ? 'on' : ''} onClick={() => ch.setPreviewMode('filled')}>치환</button>
                </span>
              )}
            </div>
            {ch.selectedTemplate ? (
              <AlimtalkPreview
                {...buildAlimtalkPreviewProps(ch.selectedTemplate, ch.previewMode === 'filled' ? ch.renderPreview : undefined)}
              />
            ) : (
              <div className="ks-preview__empty">템플릿을 고르면 받는 사람 화면이 여기에 그대로 보여요</div>
            )}
            <p className="ks-preview__cap">Data source: 카카오톡 실수신 화면 기준 · 치환은 첫 번째 받는 사람 값</p>
          </section>

          {/* ====== 수신자 ====== */}
          <section className="ds-recipients ks-recipients">
            <div className="flex items-center justify-between gap-4 flex-wrap">
              <div className="ds-rtab-group">
                <button
                  type="button"
                  className={`ds-rtab ${inputMode === 'direct' ? 'ds-rtab--on' : ''}`}
                  onClick={() => { setInputMode('direct'); setDirectInputOpen(true); }}
                >
                  <PencilLine size={17} strokeWidth={1.75} />
                  <span>직접입력</span>
                </button>
                <label className={`ds-rtab ds-rtab--label ${inputMode === 'file' ? 'ds-rtab--on' : ''} ${fileLoading ? 'ds-rtab--loading' : ''}`}>
                  <FolderOpen size={17} strokeWidth={1.75} />
                  <span>{fileLoading ? '파일 분석중...' : '파일등록'}</span>
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
                  className={`ds-rtab ${inputMode === 'address' ? 'ds-rtab--on' : ''}`}
                  onClick={() => {
                    setInputMode('address');
                    setShowAddressBook(true);
                  }}
                >
                  <Contact size={17} strokeWidth={1.75} />
                  <span>주소록</span>
                </button>
              </div>
              <div className="ds-filter-row">
                <label>
                  <input type="checkbox" className="ds-chk ds-chk--amber" checked={dedupEnabled} onChange={(e) => setDedupEnabled(e.target.checked)} />
                  <span>중복제거</span>
                </label>
                <label>
                  <input type="checkbox" className="ds-chk ds-chk--amber" checked={unsubFilterEnabled} onChange={(e) => setUnsubFilterEnabled(e.target.checked)} />
                  <span>수신거부제거</span>
                </label>
              </div>
            </div>

            <div className="flex items-center justify-between">
              <div className="ds-count-wrap">
                <span className="ds-count-label">총</span>
                <span className="ds-count-num">{recipients.length.toLocaleString()}</span>
                <span className="ds-count-label">건</span>
              </div>
              <div className="ds-search-wrap">
                <Search size={15} strokeWidth={1.75} />
                <input
                  type="text"
                  className="ds-search-in"
                  placeholder="수신번호 검색"
                  value={listQuery}
                  onChange={(e) => { setListQuery(e.target.value); setListPage(0); setListSelected(new Set()); }}
                />
              </div>
            </div>

            <div className="ds-list-frame">
              <div className="ds-list-head">
                <label className="flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    className="ds-chk ds-chk--lg ds-chk--amber"
                    checked={listAllVisibleChecked}
                    disabled={listVisibleIdx.length === 0}
                    onChange={(e) => setListSelected(e.target.checked
                      ? new Set([...listSelected, ...listVisibleIdx])
                      : new Set([...listSelected].filter((i) => !listVisibleIdx.includes(i))))}
                    aria-label="전체 선택"
                  />
                </label>
                <span>수신번호</span>
                {previewColumns.length > 0 ? (
                  <div className="ds-head-extra">
                    {previewColumns.map((col) => (
                      <span key={col} className="flex-1 min-w-0 truncate">{FIELD_LABEL_MAP[col] || col}</span>
                    ))}
                  </div>
                ) : <span />}
              </div>

              {recipients.length === 0 ? (
                <div className="ds-list-empty">
                  <div
                    className={`ds-dropzone ds-t w-full ${dragActive ? 'ds-dropzone--active' : ''}`}
                    onClick={() => fileInputRef.current?.click()}
                    onDragEnter={(e) => { e.preventDefault(); e.stopPropagation(); setDragActive(true); }}
                    onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); setDragActive(true); }}
                    onDragLeave={(e) => { e.preventDefault(); e.stopPropagation(); setDragActive(false); }}
                    onDrop={(e) => {
                      e.preventDefault(); e.stopPropagation();
                      setDragActive(false);
                      const f = e.dataTransfer?.files?.[0];
                      if (f) { setInputMode('file'); handleFileUpload(f); }
                    }}
                  >
                    <div>
                      <div className="text-[14px] font-semibold text-stone-800">파일을 올리거나 직접 입력해 주세요</div>
                      <div className="text-[12.5px] text-stone-500 mt-1">CSV · XLSX · XLS · 명단 칸은 변수와 바로 연결돼요</div>
                    </div>
                    <div className="flex items-center justify-center flex-wrap gap-x-2 gap-y-1 mt-1">
                      <span className="ds-btn-sec px-4 pointer-events-none whitespace-nowrap border border-amber-200 bg-amber-50 text-amber-700">
                        <Upload size={14} strokeWidth={1.75} />
                        <span>파일 선택</span>
                      </span>
                      <span className="text-[12px] text-stone-400 whitespace-nowrap">또는 여기로 드래그</span>
                    </div>
                  </div>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".xlsx,.xls,.csv"
                    className="hidden"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) { setInputMode('file'); handleFileUpload(f); }
                      e.target.value = '';
                    }}
                  />
                </div>
              ) : (
                <>
                  <div className="ds-list-body">
                    {listPageItems.length === 0 ? (
                      <div className="py-12 text-center text-stone-400 text-[13px]">
                        {listQuery ? `"${listQuery}" 검색 결과가 없어요` : '데이터가 없어요'}
                      </div>
                    ) : (
                      listPageItems.map((r) => (
                        <div key={`${r.phone}-${r.originalIdx}`} className="ds-list-row">
                          <label className="flex items-center cursor-pointer">
                            <input
                              type="checkbox"
                              className="ds-chk ds-chk--amber"
                              checked={listSelected.has(r.originalIdx)}
                              onChange={(e) => {
                                const next = new Set(listSelected);
                                if (e.target.checked) next.add(r.originalIdx);
                                else next.delete(r.originalIdx);
                                setListSelected(next);
                              }}
                              aria-label={`${r.phone} 선택`}
                            />
                          </label>
                          <span className="ds-num text-stone-800 font-medium">{r.phone}</span>
                          <span className="ds-cell-extra">
                            {previewColumns.map((col) => {
                              const v = r[col] != null && String(r[col]).trim() !== '' ? String(r[col]) : '-';
                              return (
                                <span key={col}>
                                  <span className="val" title={v}>{v}</span>
                                </span>
                              );
                            })}
                          </span>
                        </div>
                      ))
                    )}
                  </div>
                  {listTotalPages > 1 && (
                    <div className="ds-page">
                      <button type="button" onClick={() => setListPage((p) => Math.max(0, p - 1))} disabled={listCurrentPage === 0}>이전</button>
                      <span className="ds-page-num">{listCurrentPage + 1} / {listTotalPages}</span>
                      <button type="button" onClick={() => setListPage((p) => Math.min(listTotalPages - 1, p + 1))} disabled={listCurrentPage >= listTotalPages - 1}>다음</button>
                    </div>
                  )}
                </>
              )}
            </div>

            <div className="ds-bottom-actions">
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  className="ds-ter ds-ter--danger ds-t"
                  onClick={() => {
                    if (listSelected.size === 0) { setToast({ show: true, type: 'error', message: '선택된 항목이 없습니다' }); return; }
                    setRecipients((prev) => prev.filter((_, idx) => !listSelected.has(idx)));
                    setListSelected(new Set());
                  }}
                >
                  <Trash2 size={13} strokeWidth={1.75} />
                  <span>선택삭제</span>
                </button>
                <button
                  type="button"
                  className="ds-ter ds-ter--danger ds-t"
                  onClick={() => { setRecipients([]); setListSelected(new Set()); }}
                >
                  <CircleX size={13} strokeWidth={1.75} />
                  <span>전체삭제</span>
                </button>
              </div>
            </div>
          </section>
        </div>

        {/* ====== 발송 바 — 예약 · 분할 · 실패 시 문자 / 발신프로필 · 보내기 ====== */}
        <footer className="ds-modal__foot ks-foot">
          <div className="ds-foot-opts">
            <div className="ds-opt-anchor">
              <button
                type="button"
                className={`ds-tile ds-tile--opt ${reserveEnabled ? 'ds-tile--opt-blue' : ''}`}
                onClick={() => { if (!reserveEnabled) setReserveEnabled(true); setShowReservePicker(true); }}
              >
                <span className="ds-tile__ic"><CalendarClock size={17} strokeWidth={2} /></span>
                <span className="ds-tile__tx">
                  <span className="ds-tile__t1">예약</span>
                  <span className="ds-tile__t2">
                    {reserveEnabled
                      ? (reserveDateTime
                        ? new Date(reserveDateTime).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
                        : '시각을 골라 주세요')
                      : '지금 보내기'}
                  </span>
                </span>
                {!reserveEnabled && <ChevronDown size={14} strokeWidth={2} className="ds-tile__caret" />}
              </button>
              {reserveEnabled && (
                <button type="button" className="ds-tile__clear" onClick={() => { setReserveEnabled(false); setReserveDateTime(''); }} aria-label="예약 풀기" title="예약 풀기">
                  <X size={12} strokeWidth={2.4} />
                </button>
              )}
            </div>
            <div className="ds-opt-anchor">
              <button
                type="button"
                data-split-anchor
                className={`ds-tile ds-tile--opt ${splitEnabled ? 'ds-tile--opt-violet' : ''}`}
                onClick={() => setSplitOpen((o) => !o)}
                aria-haspopup="dialog"
                aria-expanded={splitOpen}
              >
                <span className="ds-tile__ic"><Timer size={17} strokeWidth={2} /></span>
                <span className="ds-tile__tx">
                  <span className="ds-tile__t1">분할</span>
                  <span className="ds-tile__t2">{splitEnabled ? `1분에 ${splitCount.toLocaleString()}건` : '안 함'}</span>
                </span>
                <ChevronDown size={14} strokeWidth={2} className="ds-tile__caret" />
              </button>
              <SplitSendPopover
                open={splitOpen}
                enabled={splitEnabled}
                value={splitCount}
                recipientCount={recipients.length}
                startAt={reserveEnabled && reserveDateTime ? reserveDateTime : null}
                onApply={(n) => { setSplitCount(n); setSplitEnabled(true); }}
                onOff={() => setSplitEnabled(false)}
                onClose={() => setSplitOpen(false)}
              />
            </div>
            <div className="ds-opt-anchor" ref={fallbackAnchorRef}>
              <button
                type="button"
                className={`ds-tile ds-tile--opt ${fallbackIssue ? 'ds-tile--opt-amber' : ''}`}
                onClick={() => setFallbackOpen((o) => !o)}
                aria-haspopup="dialog"
                aria-expanded={fallbackOpen}
              >
                <span className="ds-tile__ic"><MessageSquareReply size={17} strokeWidth={2} /></span>
                <span className="ds-tile__tx">
                  <span className="ds-tile__t1">실패 시 문자</span>
                  <span className="ds-tile__t2">{fallbackIssue || fallbackLabel}</span>
                </span>
                <ChevronDown size={14} strokeWidth={2} className="ds-tile__caret" />
              </button>
              {fallbackOpen && (
                <div className="ks-pop" role="dialog" aria-label="알림톡이 실패하면">
                  <div className="ks-pop__head">
                    <b>알림톡이 실패하면</b>
                    <button type="button" className="ks-pop__x" onClick={() => setFallbackOpen(false)} aria-label="닫기"><X size={15} strokeWidth={2} /></button>
                  </div>
                  {ch.selectedTemplate ? (
                    <AlimtalkFallbackEditor
                      value={channelState}
                      selectedTemplate={ch.selectedTemplate}
                      setNextType={ch.setNextType}
                      setNextSubject={ch.setNextSubject}
                      setNextContents={ch.setNextContents}
                      requiresNextSubject={ch.requiresNextSubject}
                      requiresNextContents={ch.requiresNextContents}
                      renderPreview={ch.renderPreview}
                    />
                  ) : (
                    <p className="ks-note">템플릿을 먼저 고르면 실패했을 때 보낼 문자를 정할 수 있어요.</p>
                  )}
                </div>
              )}
            </div>
          </div>
          <div className="ds-modal__vdiv" />
          <div className="ds-foot-send">
            <div className={`ks-sender ${!currentSender ? 'ks-sender--empty' : ''}`}>
              <span className="ks-sender__lab">발신프로필</span>
              <span className="ks-sender__val">{currentSender ? currentSender.profile_name : '고르기 전'}</span>
            </div>
            <button
              type="button"
              className="ds-send-btn ks-send--amber"
              onClick={handleSend}
              disabled={
                sending ||
                recipients.length === 0 ||
                !kakaoSelectedTemplate ||
                !['approved', 'APPROVED', 'APR', 'A'].includes(kakaoSelectedTemplate?.status)
              }
            >
              <Send size={17} strokeWidth={2} />
              <span>
                {sending
                  ? '발송 준비중...'
                  : recipients.length === 0
                    ? '수신자를 추가해주세요'
                    : !kakaoSelectedTemplate
                      ? '템플릿을 선택해주세요'
                      : reserveEnabled
                        ? `${recipients.length.toLocaleString()}명에게 알림톡 예약 발송하기`
                        : `${recipients.length.toLocaleString()}명에게 알림톡 발송하기`}
              </span>
            </button>
          </div>
        </footer>
      </div>

      <AlimtalkTemplatePickerModal
        open={pickerOpen}
        templates={alimtalkTemplates}
        profileId={alimtalkProfileId}
        selectedId={kakaoSelectedTemplate?.id || ''}
        onPick={(t) => ch.handleSelectTemplate(t)}
        onClose={() => setPickerOpen(false)}
      />

      <style>{`
        @keyframes zoomIn {
          from { opacity: 0; transform: scale(0.96); }
          to { opacity: 1; transform: scale(1); }
        }
      `}</style>
      {/* ★ D162-4 (2026-05-15) 2차: 주소록 모달 — Harold님 명시 정합. recipients/setRecipients position에 위임 → 그룹 선택 시 자동 적용. */}
      <RecipientDirectInputModal
        open={directInputOpen}
        onClose={() => setDirectInputOpen(false)}
        tone="amber"
        unit="건"
        currentCount={recipients.length}
        pasteHint="메모장·엑셀에서 복사해 붙여넣기 · 줄바꿈·쉼표·세미콜론"
        pastePlaceholder={'01012345678\n01087654321\n01011112222'}
        previewPaste={previewDirectPaste}
        onSubmitPaste={submitDirectPaste}
        rows={{
          fields: directRowFields,
          disabledReason: !kakaoSelectedTemplate
            ? '템플릿을 고르면 변수와 함께 한 건씩 넣을 수 있어요'
            : directRowFields.length > 0 ? null
              : templateVarCount === 0 ? '이 템플릿은 변수가 없어서 번호만 넣으면 돼요'
                : '변수가 모두 같은 값으로 정해져 있어서 번호만 넣으면 돼요',
          onAdd: addDirectRow,
        }}
      />
      <AddressBookModal
        show={showAddressBook}
        onClose={() => setShowAddressBook(false)}
        directRecipients={recipients}
        setDirectRecipients={setRecipients}
        setToast={setToast}
      />

      {/* ★ 2026-09-14 알림톡 예약 시각 선택: 직접발송과 같은 창(z-[2150]이라 이 창 위에 뜬다). 값은 이 창의 상태에만 쓴다. */}
      <ScheduleTimeModal
        show={showReservePicker}
        reserveDateTime={reserveDateTime}
        setReserveDateTime={setReserveDateTime}
        setReserveEnabled={setReserveEnabled}
        onClose={() => setShowReservePicker(false)}
      />

      {/* ★ D162-4 (2026-05-15) 3차: 파일 컬럼 매핑 모달 — Harold님 명시 정합 "직접발송과 똑같이 필드선택 가능".
          핸드폰 컬럼 + 템플릿 변수별 컬럼 매핑 + 미리보기. 적용 시 recipients 적용 + 변수 placeholder 자동 적용. */}
      {showMapping && (
        <div
          className="fixed inset-0 bg-black/50 backdrop-blur-sm z-[60] flex items-center justify-center p-4"
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
