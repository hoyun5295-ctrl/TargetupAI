import { Sparkles, Users, Eye, ShieldCheck, Smartphone, Type, Archive, Save, ImagePlus, Bell, Search, ChevronLeft, ChevronRight, RotateCcw, Trash2, Send, Wand2, Loader2, Megaphone } from 'lucide-react';
import SendWorkspaceShell, { FIELD_CLASS_INDIGO } from './shared/SendWorkspaceShell';
import { CUI_PILL_BASE, CUI_PANEL, CUI_SCROLL_X, CUI_THEAD, CUI_TH, CUI_TR, CUI_TD, CUI_CELL_DATA, CUI_BTN_GHOST, CUI_BTN_OUTLINE } from '../utils/console-ui';
import { useRef, useState } from 'react';
import type { FieldMeta } from './DirectTargetFilterModal';
import { formatPreviewValue, formatByType, buildAdMessageFront, replaceVarsByFieldMeta, FRONT_FIELD_DISPLAY_MAP, reverseDisplayValueFront } from '../utils/formatDate';
import { insertAtCursor } from '../utils/textInsert';
import BrandLinkChips from './BrandLinkChips';
import MmsImagePreview from './shared/MmsImagePreview';
import AlimtalkChannelPanel, {
  validateAlimtalkChannelState,
  type AlimtalkChannelState,
  type AlimtalkSenderProfile,
  type AlimtalkTemplate,
} from './alimtalk/AlimtalkChannelPanel';
import AlimtalkVariableMappingPanel from './alimtalk/AlimtalkVariableMappingPanel';

// ★ D43-3c: 정규식 특수문자 이스케이프
const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

interface TargetSendModalProps {
  show: boolean;
  onClose: () => void;
  fieldsMeta: FieldMeta[];

  // 수신자
  targetRecipients: any[];
  setTargetRecipients: (r: any[]) => void;

  // 채널/메시지 타입
  targetSendChannel: 'sms' | 'kakao_alimtalk';
  setTargetSendChannel: (ch: 'sms' | 'kakao_alimtalk') => void;
  targetMsgType: 'SMS' | 'LMS' | 'MMS';
  setTargetMsgType: (t: 'SMS' | 'LMS' | 'MMS') => void;

  // 메시지
  targetSubject: string;
  setTargetSubject: (s: string) => void;
  targetMessage: string;
  setTargetMessage: (m: string) => void;

  // 카카오 (알림톡 전용 — 문자 무관)
  kakaoMessage: string;
  setKakaoMessage: (m: string) => void;
  kakaoEnabled: boolean;
  kakaoTemplates: any[];
  kakaoSelectedTemplate: any;
  setKakaoSelectedTemplate: (t: any) => void;
  kakaoTemplateVars: Record<string, string>;
  setKakaoTemplateVars: (v: any) => void;
  // ★ D130 신규 알림톡 필드 (설계서 §6-3-D)
  alimtalkFallback?: 'N' | 'S' | 'L' | 'A' | 'B';
  setAlimtalkFallback?: (f: 'N' | 'S' | 'L' | 'A' | 'B') => void;
  alimtalkSenders?: AlimtalkSenderProfile[];
  alimtalkProfileId?: string;
  setAlimtalkProfileId?: (id: string) => void;
  alimtalkNextContents?: string;
  setAlimtalkNextContents?: (v: string) => void;
  // ★ D188 (2026-05-21) 영업팀장 신고 #7-(2): LMS 대체 제목 (L/B 시 필수).
  alimtalkNextSubject?: string;
  setAlimtalkNextSubject?: (v: string) => void;
  customerFieldOptions?: { key: string; label: string }[];

  // 회신번호
  selectedCallback: string;
  setSelectedCallback: (cb: string) => void;
  useIndividualCallback: boolean;
  setUseIndividualCallback: (b: boolean) => void;
  individualCallbackColumn: string;
  setIndividualCallbackColumn: (col: string) => void;
  callbackNumbers: any[];
  phoneFields?: string[];  // ★ D103: 전화번호 형태 필드 키 목록 (개별회신번호 드롭다운 동적 필터)

  // 광고
  adTextEnabled: boolean;
  handleAdToggle: (checked: boolean) => void;
  optOutNumber: string;

  // 예약
  reserveEnabled: boolean;
  setReserveEnabled: (b: boolean) => void;
  reserveDateTime: string;
  setShowReservePicker: (b: boolean) => void;

  // 분할
  splitEnabled: boolean;
  setSplitEnabled: (b: boolean) => void;
  splitCount: number;
  setSplitCount: (n: number) => void;

  // MMS
  mmsUploadedImages: any[];
  setMmsUploadedImages: (imgs: any[]) => void;
  setShowMmsUploadModal: (b: boolean) => void;

  // 유틸
  formatPhoneNumber: (p: string) => string;
  formatRejectNumber: (n: string) => string;
  calculateBytes: (text: string) => number;

  // 토스트
  setToast: (t: any) => void;

  // 미리보기
  setShowDirectPreview: (b: boolean) => void;
  setDirectMessage: (m: string) => void;
  setDirectMsgType: (t: 'SMS' | 'LMS' | 'MMS') => void;
  setDirectSubject: (s: string) => void;

  // 스팸필터
  setSpamFilterData: (d: any) => void;
  setShowSpamFilter: (b: boolean) => void;

  // AI 추천
  handleAiMsgHelper: () => void;
  /**
   * ★ 2026-08-21 AI 꾸미기 — 본문에 이미 들어 있는 %변수%만 자연스럽게 녹인다(3크레딧).
   *   게이트·호출은 대시보드가 소유(AI 추천과 같은 자리). 꾸민 문안을 돌려주고, 막혔거나 실패하면 null.
   */
  onAiDecorate?: (message: string, tokens: string[]) => Promise<string | null>;

  // 특수문자/보관함/저장
  setShowSpecialChars: (s: 'target' | 'direct' | null) => void;
  loadTemplates: () => void;
  setShowTemplateBox: (s: 'target' | 'direct' | null) => void;
  setShowTemplateSave: (s: 'target' | 'direct' | null) => void;
  setTemplateSaveName: (n: string) => void;

  // LMS/SMS 전환
  smsOverrideAccepted: boolean;
  setSmsOverrideAccepted: (b: boolean) => void;
  setPendingBytes: (n: number) => void;
  setShowLmsConfirm: (b: boolean) => void;
  setShowSmsConvert: (s: any) => void;
  lmsKeepAccepted: boolean;
  setLmsKeepAccepted: (b: boolean) => void;

  // 발송 확인
  setSendConfirm: (s: any) => void;

  // 담당자 테스트
  handleTargetTestSend?: () => void;
  testSending?: boolean;
  testCooldown?: boolean;
  testSentResult?: string | null;

  // 발송 중
  targetSending: boolean;

  // 타겟 재설정
  onResetTarget: () => void;

  // ★ D162-4 (2026-05-15) 2차: 직접타겟발송 → 알림톡 발송 풀 화면 진입 callback. 수신번호 검색 옆 카카오 노란색 버튼.
  onAlimtalkOpen?: () => void;
  /** ★ 2026-08-21 직접 타겟 발송 → 브랜드메시지 발송. 추출된 수신자 목록을 그대로 들고 간다(알림톡과 같은 축). */
  onBrandOpen?: () => void;
}

export default function TargetSendModal({
  show, onClose, fieldsMeta,
  targetRecipients, setTargetRecipients,
  targetSendChannel, setTargetSendChannel,
  targetMsgType, setTargetMsgType,
  targetSubject, setTargetSubject,
  targetMessage, setTargetMessage,
  kakaoMessage, setKakaoMessage,
  kakaoEnabled, kakaoTemplates, kakaoSelectedTemplate, setKakaoSelectedTemplate,
  kakaoTemplateVars, setKakaoTemplateVars,
  // ★ D130 신규
  alimtalkFallback = 'L',
  setAlimtalkFallback,
  alimtalkSenders = [],
  alimtalkProfileId = '',
  setAlimtalkProfileId,
  alimtalkNextContents = '',
  setAlimtalkNextContents,
  alimtalkNextSubject = '',
  setAlimtalkNextSubject,
  customerFieldOptions = [],
  selectedCallback, setSelectedCallback,
  useIndividualCallback, setUseIndividualCallback,
  individualCallbackColumn, setIndividualCallbackColumn,
  callbackNumbers,
  phoneFields,
  adTextEnabled, handleAdToggle, optOutNumber,
  reserveEnabled, setReserveEnabled,
  reserveDateTime, setShowReservePicker,
  splitEnabled, setSplitEnabled,
  splitCount, setSplitCount,
  mmsUploadedImages, setMmsUploadedImages, setShowMmsUploadModal,
  formatPhoneNumber, formatRejectNumber, calculateBytes,
  setToast,
  setShowDirectPreview, setDirectMessage, setDirectMsgType, setDirectSubject,
  setSpamFilterData, setShowSpamFilter,
  handleAiMsgHelper,
  onAiDecorate,
  setShowSpecialChars, loadTemplates, setShowTemplateBox,
  setShowTemplateSave, setTemplateSaveName,
  smsOverrideAccepted, setSmsOverrideAccepted,
  setPendingBytes, setShowLmsConfirm, setShowSmsConvert, lmsKeepAccepted, setLmsKeepAccepted,
  setSendConfirm,
  handleTargetTestSend,
  testSending: testSendingProp,
  testCooldown: testCooldownProp,
  testSentResult: testSentResultProp,
  targetSending,
  onResetTarget,
  onAlimtalkOpen,
  onBrandOpen,
}: TargetSendModalProps) {

  // ====== 내부 state ======
  const [targetListPage, setTargetListPage] = useState(0);
  const [targetListSearch, setTargetListSearch] = useState('');
  // ★ D102: 중복제거/수신거부제거 체크박스 state (기본 true)
  const [dedupEnabled, setDedupEnabled] = useState(true);
  const [unsubFilterEnabled, setUnsubFilterEnabled] = useState(true);
  // ★ D101: 수신자 선택삭제 기능
  const [selectedPhones, setSelectedPhones] = useState<Set<string>>(new Set());
  const smsTextareaRef = useRef<HTMLTextAreaElement>(null);
  const kakaoTextareaRef = useRef<HTMLTextAreaElement>(null);
  // ★ 2026-08-21 AI 꾸미기 — 처리 중 잠금 + 적용 직전 원문(되돌리기 1회). 사용자가 본문을 고치면 되돌리기는 사라진다.
  const [decorating, setDecorating] = useState(false);
  const [decorateUndo, setDecorateUndo] = useState<string | null>(null);

  // ====== ★ 동적 필드 파생 (하드코딩 제거 핵심) ======

  // 변수로 사용할 필드 목록 (phone, sms_opt_in 제외)
  const variableFields = fieldsMeta.filter(fm =>
    fm.field_key !== 'phone' && fm.field_key !== 'sms_opt_in'
  );

  // ★ 2026-08-21 AI 꾸미기가 녹일 변수 = 본문에 이미 들어 있는 것만(0808 규약 "쓰인 컬럼 = 고른 컬럼"). 별도 선택 단계 없음.
  const usedVariableTokens = variableFields
    .filter(fm => fm.variable && targetMessage.includes(fm.variable))
    .map(fm => fm.variable);

  const handleAiDecorate = async () => {
    if (!onAiDecorate || decorating || usedVariableTokens.length === 0 || !targetMessage.trim()) return;
    const before = targetMessage;
    setDecorating(true);
    try {
      const out = await onAiDecorate(before, usedVariableTokens);
      if (out != null && out !== before) {
        setDecorateUndo(before);
        setTargetMessage(out);
      }
    } finally {
      setDecorating(false);
    }
  };
  const undoDecorate = () => {
    if (decorateUndo == null) return;
    setTargetMessage(decorateUndo);
    setDecorateUndo(null);
  };

  // 테이블에 표시할 필드 (phone은 항상 첫 번째 고정, sms_opt_in 제외)
  const tableFields = fieldsMeta.filter(fm =>
    fm.field_key !== 'phone' && fm.field_key !== 'sms_opt_in'
  );

  // B13-06: 이모지 감지 함수
  const hasEmoji = (text: string): boolean => {
    const emojiPattern = /[\uD800-\uDBFF][\uDC00-\uDFFF]|[\u2600-\u27BF]|[\u2300-\u23FF]|[\u2B50-\u2BFF]|[\uFE00-\uFE0F]|[\u200D]|[\u20E3]|[\uE000-\uF8FF]/g;
    return emojiPattern.test(text);
  };

  // ====== ★ 커서 위치에 변수 삽입 — D124 컨트롤타워(insertAtCursor) ======
  //   setter는 props로 내려받은 (msg: string) => void 형태라 updater 패턴 불가 → currentValue 직접 사용
  const insertVariable = (variable: string, target: 'sms' | 'kakao') => {
    const ref = target === 'sms' ? smsTextareaRef : kakaoTextareaRef;
    const currentValue = target === 'sms' ? targetMessage : kakaoMessage;
    const setter = target === 'sms' ? setTargetMessage : setKakaoMessage;
    const ok = insertAtCursor(ref.current, variable, setter);
    if (!ok) setter(currentValue + variable); // fallback: 현재 값 + 끝에 붙임
  };

  // ====== ★ B+0407-1: 인라인 replaceVars 제거 — replaceVarsByFieldMeta 컨트롤타워 사용 ======
  //   기존 인라인 함수는 enum 역변환 누락으로 성별 F/M이 그대로 노출되는 버그 발생
  const replaceVars = (text: string, recipient: any) =>
    replaceVarsByFieldMeta(text, recipient, variableFields as any);

  // ====== 셀 값 포맷 ======
  // ★ D111 E1: 인라인 GENDER_DISPLAY_MAP/isGenderField 하드코딩 제거 →
  //   FRONT_FIELD_DISPLAY_MAP 컨트롤타워 사용 (enum 필드 추가 시 한 곳만 수정).
  //   '0':'여성' 같은 모호한 매핑 제거 — 백엔드 reverseDisplayValue와 동일 기준.
  // ★ D142 (2026-04-28): formatByType 호출 시 fieldKey 전달 누락 수정.
  //   원인: PDF 0428 #5 — 직접타겟발송 담당자테스트에서 custom_* 텍스트가 숫자 콤마로 표시.
  //   해결: fieldKey 전달 → formatByType이 displayValue 단일 진입점으로 전환 → custom_*은 자동 원본 보존.
  //   gender enum 역변환은 displayValue 내부가 자동 처리 (분기 통합).
  const formatCellValue = (value: any, dataType: string, fieldKey?: string): string => {
    if (value == null || value === '') return '-';
    if (dataType === 'boolean') return value === true || value === 'true' ? '예' : '아니오';
    return formatByType(value, dataType, fieldKey);
  };

  // ====== SMS 전송하기 핸들러 ======
  const handleSmsSend = async () => {
    if (targetRecipients.length === 0) {
      setToast({ show: true, type: 'error', message: '수신자가 없습니다' });
      return;
    }
    if (!targetMessage.trim()) {
      setToast({ show: true, type: 'error', message: '메시지를 입력해주세요' });
      return;
    }
    if (!selectedCallback && !useIndividualCallback) {
      setToast({ show: true, type: 'error', message: '회신번호를 선택해주세요' });
      return;
    }
    if (useIndividualCallback) {
      // ★ D99: 선택된 컬럼(individualCallbackColumn)에서 값 체크
      const col = individualCallbackColumn || 'callback';
      const missingCount = targetRecipients.filter((r: any) => {
        const val = r[col] || (r.custom_fields && col.startsWith('custom_') ? r.custom_fields[col] : null);
        return !val || !String(val).trim();
      }).length;
      if (missingCount > 0) {
        const colName = fieldsMeta.find(f => f.field_key === col)?.display_name || col;
        setToast({ show: true, type: 'error', message: `${colName} 값이 없는 고객이 ${missingCount}명 있습니다. 일반 회신번호를 선택하거나 고객 데이터를 확인해주세요.` });
        return;
      }
    }
    if ((targetMsgType === 'LMS' || targetMsgType === 'MMS') && !targetSubject.trim()) {
      setToast({ show: true, type: 'error', message: '제목을 입력해주세요' });
      return;
    }

    // 바이트 계산 — ★ D102: buildAdMessageFront 컨트롤타워 사용
    const fullMsg = buildAdMessageFront(targetMessage, targetMsgType, adTextEnabled, optOutNumber);
    const msgBytes = calculateBytes(fullMsg);

    // SMS인데 90바이트 초과 시 전환 안내
    if (targetMsgType === 'SMS' && msgBytes > 90 && !smsOverrideAccepted) {
      setPendingBytes(msgBytes);
      setShowLmsConfirm(true);
      return;
    }

    // LMS/MMS인데 SMS로 보내도 되는 경우 비용 절감 안내
    // ★ MMS 이미지가 업로드되어 있으면 SMS 전환 불가 → 비용절감 안내 스킵
    if (targetMsgType !== 'SMS' && !lmsKeepAccepted && mmsUploadedImages.length === 0) {
      const smsFullMsg = buildAdMessageFront(targetMessage, 'SMS', adTextEnabled, optOutNumber);
      const smsBytes = calculateBytes(smsFullMsg);
      if (smsBytes <= 90) {
        setShowSmsConvert({ show: true, from: 'target', currentBytes: msgBytes, smsBytes, count: targetRecipients.length });
        return;
      }
    }

    // 수신거부 체크
    const token = localStorage.getItem('token');
    const phones = targetRecipients.map((r: any) => r.phone);
    const checkRes = await fetch('/api/unsubscribes/check', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ phones })
    });
    const checkData = await checkRes.json();
    const unsubCount = checkData.unsubscribeCount || 0;

    // 발송 확인 모달
    setSendConfirm({
      show: true,
      type: reserveEnabled ? 'scheduled' : 'immediate',
      count: targetRecipients.length - (unsubFilterEnabled ? unsubCount : 0),
      unsubscribeCount: unsubFilterEnabled ? unsubCount : 0,
      dateTime: reserveEnabled && reserveDateTime ? reserveDateTime : undefined,
      from: 'target',
      msgType: targetMsgType,
      // ★ D102: 중복제거/수신거부제거 플래그 전달
      dedupEnabled,
      unsubFilterEnabled,
    });
  };

  // ====== 카카오 전송하기 핸들러 ======
  const handleKakaoSend = async () => {
    if (targetRecipients.length === 0) { setToast({ show: true, type: 'error', message: '수신자가 없습니다' }); return; }
    if (!kakaoMessage.trim()) { setToast({ show: true, type: 'error', message: '메시지를 입력해주세요' }); return; }
    if (kakaoMessage.length > 4000) { setToast({ show: true, type: 'error', message: '카카오 메시지는 4,000자 이내로 입력해주세요' }); return; }
    if (!kakaoEnabled) { setToast({ show: true, type: 'error', message: '카카오 발송이 활성화되지 않았습니다. 관리자에게 문의해주세요.' }); return; }
    const token = localStorage.getItem('token');
    const phones = targetRecipients.map((r: any) => r.phone);
    const checkRes = await fetch('/api/unsubscribes/check', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ phones }) });
    const checkData = await checkRes.json();
    const unsubCount = checkData.unsubscribeCount || 0;
    const dupCount = checkData.duplicateCount || 0;  // ★ D137 D4 (타겟발송은 이미 dedup → 0)
    setSendConfirm({ show: true, type: reserveEnabled ? 'scheduled' : 'immediate', count: targetRecipients.length - unsubCount - dupCount, unsubscribeCount: unsubCount, duplicateCount: dupCount, dateTime: reserveEnabled && reserveDateTime ? reserveDateTime : undefined, from: 'target', msgType: '카카오' });
  };

  const handleAlimtalkSend = async () => {
    if (targetRecipients.length === 0) { setToast({ show: true, type: 'error', message: '수신자가 없습니다' }); return; }
    if (!kakaoSelectedTemplate) { setToast({ show: true, type: 'error', message: '템플릿을 선택해주세요' }); return; }
    // ★ 2026-07-27: 전환재발송 검증 공용 CT — 백엔드(400)와 같은 규칙을 확인 모달 전에 먼저 건다.
    const fallbackViolation = validateAlimtalkChannelState({
      profileId: '', templateCode: '', templateId: '', variableMap: {},
      nextType: alimtalkFallback,
      nextContents: alimtalkNextContents,
      nextSubject: alimtalkNextSubject,
    });
    if (fallbackViolation) { setToast({ show: true, type: 'error', message: fallbackViolation }); return; }
    const token = localStorage.getItem('token');
    const phones = targetRecipients.map((r: any) => r.phone);
    const checkRes = await fetch('/api/unsubscribes/check', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ phones }) });
    const checkData = await checkRes.json();
    const unsubCount = checkData.unsubscribeCount || 0;
    const dupCount = checkData.duplicateCount || 0;  // ★ D137 D4 (타겟발송은 이미 dedup → 0)
    setSendConfirm({ show: true, type: reserveEnabled ? 'scheduled' : 'immediate', count: targetRecipients.length - unsubCount - dupCount, unsubscribeCount: unsubCount, duplicateCount: dupCount, dateTime: reserveEnabled && reserveDateTime ? reserveDateTime : undefined, from: 'target', msgType: '알림톡' });
  };

  // ====== 미리보기 핸들러 ======
  const handlePreview = () => {
    if (!targetMessage.trim()) {
      setToast({ show: true, type: 'error', message: '메시지를 입력해주세요' });
      return;
    }
    setDirectMessage(targetMessage);
    setDirectMsgType(targetMsgType);
    setDirectSubject(targetSubject);
    setShowDirectPreview(true);
  };

  // ====== ★ 스팸필터 핸들러 (동적 replaceVars) ======
  const handleSpamFilter = () => {
    const msg = targetMessage || '';
    const cb = selectedCallback || '';
    const firstR = targetRecipients[0];
    const smsRaw = buildAdMessageFront(msg, 'SMS', adTextEnabled, optOutNumber);
    const lmsRaw = buildAdMessageFront(msg, 'LMS', adTextEnabled, optOutNumber);
    const smsMsg = replaceVars(smsRaw, firstR);
    const lmsMsg = replaceVars(lmsRaw, firstR);
    setSpamFilterData({ sms: smsMsg, lms: lmsMsg, callback: cb, msgType: targetMsgType, subject: targetSubject || '', isAd: adTextEnabled, firstRecipient: firstR || undefined });
    setShowSpamFilter(true);
  };

  // ====== 렌더링 ======
  if (!show) return null;

  // ★ 2026-08-21 표면 리프트(인디고): 기능·state·props·핸들러 100% 유지, 표면만 발송 공용 셸(SendWorkspaceShell)로.
  //   이모지 버튼 → lucide, 회색 박스 → 링(ring)과 서브 서페이스, 에메랄드 → 인디고 액센트.
  //   좌측(aside) = 작성기 440px, 우측 = 수신자 목록. md 이하 1컬럼.
  const fullMsgBytes = calculateBytes(buildAdMessageFront(targetMessage, targetMsgType, adTextEnabled, optOutNumber));
  const maxBytes = targetMsgType === 'SMS' ? 90 : 2000;
  const bytesOver = fullMsgBytes > maxBytes;
  const filteredRecipients = targetListSearch
    ? targetRecipients.filter(r => r.phone?.includes(targetListSearch))
    : targetRecipients;
  const PAGE_SIZE = 15;
  const pageStart = targetListPage * PAGE_SIZE;
  const totalPages = Math.ceil(filteredRecipients.length / PAGE_SIZE);
  const pageRows = filteredRecipients.slice(pageStart, pageStart + PAGE_SIZE);
  const approvedTpl = ['approved', 'APPROVED', 'APR', 'A'].includes(kakaoSelectedTemplate?.status);

  const SEG_ON = 'flex-1 h-9 rounded-lg text-[13px] font-semibold text-indigo-700 bg-white shadow-sm transition';
  const SEG_OFF = 'flex-1 h-9 rounded-lg text-[13px] font-medium text-slate-500 hover:text-slate-900 transition';
  // ★ 2026-08-21 Harold 지적: 도구 버튼이 ghost라 AI 추천 옆에서 경계가 안 보였다 → 흰 칩 + 링으로 버튼임을 드러낸다.
  const TOOL_BTN = 'h-8 px-2.5 rounded-lg bg-white ring-1 ring-slate-200 text-[12px] font-medium text-slate-700 hover:ring-indigo-400 hover:text-indigo-700 inline-flex items-center gap-1 transition disabled:opacity-40 disabled:pointer-events-none';
  const AI_BTN_PRIMARY = 'h-8 px-2.5 rounded-lg text-[12px] font-semibold bg-indigo-600 text-white hover:bg-indigo-700 inline-flex items-center gap-1 transition shadow-sm';
  const AI_BTN_OUTLINE = 'h-8 px-2.5 rounded-lg text-[12px] font-semibold text-indigo-700 bg-indigo-50 ring-1 ring-indigo-200 hover:bg-indigo-100 hover:ring-indigo-300 inline-flex items-center gap-1 transition disabled:opacity-40 disabled:pointer-events-none';
  const ACTION_BTN = 'h-10 rounded-xl bg-white ring-1 ring-slate-200 text-[13px] font-semibold text-slate-700 hover:ring-indigo-400 hover:text-indigo-700 inline-flex items-center justify-center gap-1.5 transition disabled:opacity-40 disabled:pointer-events-none';
  const OPT_ON = 'rounded-xl ring-1 ring-indigo-300 bg-indigo-50/60 p-3 text-center';
  const OPT_OFF = 'rounded-xl ring-1 ring-slate-200 bg-white p-3 text-center';

  const composer = (
    <div className="flex-1 min-h-0 overflow-y-auto p-4 sm:p-5 space-y-3">
      {/* ★ D162-4 (2026-05-15) 2차: Harold님 명시. 채널 탭 자체 제거.
          직접타겟발송 = 문자(SMS/LMS/MMS) 단일 모드. 알림톡은 수신자 목록 위 '알림톡 발송' 버튼으로 진입 → AlimtalkSendModal 풀 화면.
          targetSendChannel state는 'sms' 고정. ★ 2026-08-17 죽어 있던 RCS 분기 제거(직접발송과 같은 축). */}
      {targetSendChannel === 'sms' && (<>
        {/* SMS/LMS/MMS 세그먼트 */}
        <div className="flex p-1 rounded-xl bg-slate-200/60">
          <button type="button" onClick={() => { setTargetMsgType('SMS'); setMmsUploadedImages([]); setLmsKeepAccepted(false); }} className={targetMsgType === 'SMS' ? SEG_ON : SEG_OFF}>SMS</button>
          <button type="button" onClick={() => { setTargetMsgType('LMS'); setMmsUploadedImages([]); setLmsKeepAccepted(false); }} className={targetMsgType === 'LMS' ? SEG_ON : SEG_OFF}>LMS</button>
          <button type="button" onClick={() => { setTargetMsgType('MMS'); setLmsKeepAccepted(false); }} className={targetMsgType === 'MMS' ? SEG_ON : SEG_OFF}>MMS</button>
        </div>

        {/* 작성 카드 */}
        <div className="rounded-2xl bg-white ring-1 ring-slate-900/5 shadow-sm overflow-hidden">
          {(targetMsgType === 'LMS' || targetMsgType === 'MMS') && (
            <div className="px-4 pt-4">
              <div className="relative">
                {adTextEnabled && (
                  <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-sm text-indigo-600 font-semibold pointer-events-none select-none">(광고)</span>
                )}
                <input
                  type="text"
                  value={targetSubject}
                  onChange={(e) => setTargetSubject(e.target.value)}
                  placeholder="제목 (필수)"
                  style={adTextEnabled ? { paddingLeft: '58px' } : {}}
                  className={FIELD_CLASS_INDIGO}
                />
              </div>
            </div>
          )}

          <div className="p-4">
            <div className="relative">
              {adTextEnabled && (
                <span className="absolute left-0 top-0 text-sm text-indigo-600 font-semibold pointer-events-none select-none">(광고)</span>
              )}
              <textarea
                ref={smsTextareaRef}
                data-char-target="target"
                value={targetMessage}
                onChange={(e) => { setTargetMessage(e.target.value); if (decorateUndo != null) setDecorateUndo(null); }}
                placeholder="전송할 내용을 입력하세요."
                style={adTextEnabled ? { textIndent: '42px' } : {}}
                className={`w-full resize-none border-0 p-0 focus:outline-none focus:ring-0 text-sm leading-relaxed text-slate-800 placeholder:text-slate-300 ${targetMsgType === 'SMS' ? 'h-[180px]' : 'h-[140px]'}`}
              />
            </div>
            {adTextEnabled && (
              <div className="text-[12.5px] text-slate-500 mt-1">
                {targetMsgType === 'SMS'
                  ? `무료거부${optOutNumber.replace(/-/g, '')}`
                  : `무료수신거부 ${formatRejectNumber(optOutNumber)}`}
              </div>
            )}
          </div>

          {/* 도구줄 — 윗줄 = AI(추천·꾸미기) + 바이트 / 아랫줄 = 작성 도구(특수문자·보관함·문자 저장).
              ★ 2026-08-21: 한 줄에 다섯을 두면 440px에서 접혀 위계가 깨진다. AI 행동과 작성 도구를 줄로 나눈다. */}
          <div className="px-3 py-2.5 border-t border-slate-100 bg-slate-50/70 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-1.5 flex-wrap">
                <button type="button" onClick={handleAiMsgHelper} className={AI_BTN_PRIMARY}>
                  <Sparkles className="w-3.5 h-3.5" />AI 추천
                </button>
                {onAiDecorate && (
                  <button
                    type="button"
                    onClick={handleAiDecorate}
                    disabled={decorating || usedVariableTokens.length === 0 || !targetMessage.trim()}
                    title={usedVariableTokens.length === 0 ? '자동입력 변수를 먼저 넣어주세요' : `본문의 변수 ${usedVariableTokens.length}개를 자연스럽게 녹입니다 (3크레딧)`}
                    className={AI_BTN_OUTLINE}
                  >
                    {decorating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Wand2 className="w-3.5 h-3.5" />}
                    {decorating ? '꾸미는 중' : 'AI 꾸미기'}
                    {!decorating && usedVariableTokens.length > 0 && (
                      <span className="ml-0.5 h-4 min-w-4 px-1 rounded-full bg-indigo-600 text-white text-[10px] font-bold grid place-items-center tabular-nums">{usedVariableTokens.length}</span>
                    )}
                  </button>
                )}
                {decorateUndo != null && !decorating && (
                  <button type="button" onClick={undoDecorate} className="h-8 px-2 rounded-lg text-[12px] font-medium text-slate-500 hover:text-slate-900 hover:bg-white inline-flex items-center gap-1 transition">
                    <RotateCcw className="w-3.5 h-3.5" />되돌리기
                  </button>
                )}
              </div>
              <span className="text-[12px] text-slate-500 tabular-nums whitespace-nowrap">
                <span className={`font-bold ${bytesOver ? 'text-rose-600' : 'text-indigo-600'}`}>{fullMsgBytes}</span>/{maxBytes}byte
              </span>
            </div>
            <div className="flex items-center gap-1.5 flex-wrap">
              <button type="button" onClick={() => setShowSpecialChars('target')} className={TOOL_BTN}><Type className="w-3.5 h-3.5" />특수문자</button>
              <button type="button" onClick={() => { loadTemplates(); setShowTemplateBox('target'); }} className={TOOL_BTN}><Archive className="w-3.5 h-3.5" />보관함</button>
              <button type="button" onClick={() => { if (!targetMessage.trim()) { setToast({show: true, type: 'error', message: '저장할 메시지를 먼저 입력해주세요.'}); setTimeout(() => setToast({show: false, type: 'error', message: ''}), 3000); return; } setTemplateSaveName(''); setShowTemplateSave('target'); }} className={TOOL_BTN}><Save className="w-3.5 h-3.5" />문자 저장</button>
            </div>
          </div>

          {/* 발신번호 */}
          <div className="px-4 py-3 border-t border-slate-100">
            <label className="block text-[12px] font-medium text-slate-500 mb-1.5">발신번호</label>
            <select
              value={useIndividualCallback ? `__col__${individualCallbackColumn}` : selectedCallback}
              onChange={(e) => {
                const val = e.target.value;
                if (val.startsWith('__col__')) {
                  setUseIndividualCallback(true);
                  setSelectedCallback('');
                  setIndividualCallbackColumn(val.replace('__col__', ''));
                } else {
                  setUseIndividualCallback(false);
                  setSelectedCallback(val);
                  setIndividualCallbackColumn('');
                }
              }}
              className={FIELD_CLASS_INDIGO}
            >
              <option value="">회신번호 선택</option>
              <optgroup label="수신자별 회신번호 컬럼">
                {/* ★ D103: phoneFields 기반 동적 필터 (displayName 하드코딩 제거) */}
                {fieldsMeta
                  .filter(f => phoneFields?.includes(f.field_key))
                  .map(f => (
                    <option key={f.field_key} value={`__col__${f.field_key}`}>
                      {f.display_name} (수신자별)
                    </option>
                  ))
                }
              </optgroup>
              <optgroup label="등록된 회신번호">
                {callbackNumbers.map((cb) => (
                  <option key={cb.id} value={cb.phone}>
                    {formatPhoneNumber(cb.phone)} {cb.label ? `(${cb.label})` : ''} {cb.is_default ? '(기본)' : ''}
                  </option>
                ))}
              </optgroup>
            </select>
            {useIndividualCallback && (
              <p className="text-[12px] text-indigo-700 mt-1.5">
                각 수신자의 <strong>{fieldsMeta.find(f => f.field_key === individualCallbackColumn)?.display_name || individualCallbackColumn}</strong> 값으로 발송됩니다
              </p>
            )}
          </div>

          {/* ★ 자동입력: fieldsMeta 기반 동적 변수 칩 (클릭 = 커서 위치 삽입) */}
          <div className="px-4 py-3 border-t border-slate-100">
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-[12px] font-medium text-slate-500">자동입력 변수</span>
              <span className="text-[11px] text-slate-400">누르면 커서 위치에 들어갑니다</span>
            </div>
            {variableFields.length === 0 ? (
              <p className="text-[12px] text-slate-400">추출 조건에 넣은 항목이 변수로 나타납니다</p>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {variableFields.map(fm => (
                  <button key={fm.field_key} type="button" onClick={() => insertVariable(fm.variable, 'sms')}
                    className="h-7 px-2.5 rounded-lg bg-white ring-1 ring-slate-200 text-[12px] text-slate-700 hover:ring-indigo-400 hover:text-indigo-700 transition">
                    {fm.display_name}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* ★ 2026-07-02 브랜드 링크: 칩 클릭 = 커서 위치 URL 삽입 (insertAtCursor CT 재사용) */}
          <div className="px-4 py-3 border-t border-slate-100">
            <BrandLinkChips
              tone="light"
              onToast={(message, type) => setToast({ show: true, type: type === 'error' ? 'error' : 'success', message })}
              onInsert={(u) => {
                const ok = insertAtCursor(smsTextareaRef.current, u, setTargetMessage);
                if (!ok) setTargetMessage(targetMessage + u);
              }}
            />
          </div>

          {/* MMS 이미지 (B16-05: MMS 탭에서만) */}
          {targetMsgType === 'MMS' && (
            <button type="button" onClick={() => setShowMmsUploadModal(true)}
              className="w-full px-4 py-3 border-t border-slate-100 bg-indigo-50/40 hover:bg-indigo-50 transition flex items-center gap-2.5 text-left">
              <ImagePlus className="w-4 h-4 text-indigo-600 shrink-0" />
              <span className="text-[12.5px] font-semibold text-slate-700">MMS 이미지</span>
              {mmsUploadedImages.length > 0 ? (
                <span className="flex items-center gap-1.5">
                  {/* ★ B3: 공용 컴포넌트 MmsImagePreview 사용 */}
                  <MmsImagePreview images={mmsUploadedImages} size="xs" compact />
                  <span className="text-[12px] text-indigo-700">수정</span>
                </span>
              ) : (
                <span className="text-[12px] text-indigo-700 ml-auto">눌러서 이미지 첨부</span>
              )}
            </button>
          )}

          {/* 담당자 테스트 결과 */}
          {testSentResultProp && (
            <div className={`mx-4 mt-3 px-3 py-2.5 rounded-xl text-[12.5px] whitespace-pre-wrap ring-1 ${testSentResultProp.startsWith('✅') ? 'bg-emerald-50 text-emerald-800 ring-emerald-200' : 'bg-rose-50 text-rose-800 ring-rose-200'}`}>
              {testSentResultProp}
            </div>
          )}

          {/* 미리보기 · 스팸필터 · 담당자테스트 */}
          <div className="px-4 py-3 border-t border-slate-100 grid grid-cols-3 gap-2">
            <button type="button" onClick={handlePreview} className={ACTION_BTN}><Eye className="w-4 h-4" />미리보기</button>
            <button type="button" onClick={handleSpamFilter} className={ACTION_BTN}><ShieldCheck className="w-4 h-4" />스팸필터</button>
            <button type="button" onClick={handleTargetTestSend} disabled={testSendingProp || testCooldownProp || !targetMessage.trim()} className={ACTION_BTN}>
              <Smartphone className="w-4 h-4" />
              {testSendingProp ? '발송 중' : testCooldownProp ? '10초 대기' : '담당자테스트'}
            </button>
          </div>

          {/* 예약 · 분할 · 광고표기 */}
          <div className="px-4 py-3 border-t border-slate-100 grid grid-cols-3 gap-2 text-[12px]">
            <div className={reserveEnabled ? OPT_ON : OPT_OFF}>
              <label className="flex items-center justify-center gap-1.5 cursor-pointer">
                <input type="checkbox" checked={reserveEnabled} onChange={(e) => { setReserveEnabled(e.target.checked); if (e.target.checked) setShowReservePicker(true); }} className="h-4 w-4 rounded accent-indigo-600" />
                <span className={`font-semibold ${reserveEnabled ? 'text-indigo-700' : 'text-slate-700'}`}>예약전송</span>
              </label>
              <div className={`mt-1.5 cursor-pointer ${reserveEnabled ? 'text-indigo-600 font-medium' : 'text-slate-400'}`} onClick={() => reserveEnabled && setShowReservePicker(true)}>
                {reserveDateTime
                  ? new Date(reserveDateTime).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
                  : '예약시간 선택'}
              </div>
            </div>
            <div className={splitEnabled ? OPT_ON : OPT_OFF}>
              <label className="flex items-center justify-center gap-1.5 cursor-pointer">
                <input type="checkbox" className="h-4 w-4 rounded accent-indigo-600" checked={splitEnabled} onChange={(e) => setSplitEnabled(e.target.checked)} />
                <span className={`font-semibold ${splitEnabled ? 'text-indigo-700' : 'text-slate-700'}`}>분할전송</span>
              </label>
              <div className="mt-1.5 flex items-center justify-center gap-1">
                <input type="number" className="w-16 h-7 rounded-lg ring-1 ring-slate-200 px-1.5 text-[12px] text-center focus:outline-none focus:ring-2 focus:ring-indigo-500/50 disabled:opacity-50" placeholder="1000" value={splitCount} onChange={(e) => setSplitCount(Number(e.target.value) || 1000)} disabled={!splitEnabled} />
                <span className="text-slate-500">건/분</span>
              </div>
            </div>
            <div className={adTextEnabled ? OPT_ON : OPT_OFF}>
              <label className="flex items-center justify-center gap-1.5 cursor-pointer">
                <input type="checkbox" checked={adTextEnabled} onChange={(e) => handleAdToggle(e.target.checked)} className="h-4 w-4 rounded accent-indigo-600" />
                <span className={`font-semibold ${adTextEnabled ? 'text-indigo-700' : 'text-slate-700'}`}>광고표기</span>
              </label>
              <div className={`mt-1.5 ${adTextEnabled ? 'text-indigo-600' : 'text-slate-400'}`}>080 수신거부</div>
            </div>
          </div>

          {/* 전송 */}
          <div className="px-4 py-3 border-t border-slate-100">
            <button type="button" onClick={handleSmsSend} disabled={targetSending}
              className="w-full h-12 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-[15px] font-bold shadow-lg shadow-indigo-600/20 transition inline-flex items-center justify-center gap-2 disabled:opacity-50">
              <Send className="w-4 h-4" />
              {targetSending ? '발송 중' : `${targetRecipients.length.toLocaleString()}명에게 전송`}
            </button>
          </div>
        </div>
      </>)}

      {/* === 카카오 알림톡 채널 (D130: AlimtalkChannelPanel 공용) === */}
      {targetSendChannel === 'kakao_alimtalk' && (
        <div className="space-y-3">
          <AlimtalkChannelPanel
            senders={alimtalkSenders}
            templates={kakaoTemplates as AlimtalkTemplate[]}
            customerFieldOptions={customerFieldOptions}
            value={{
              profileId: alimtalkProfileId,
              templateCode: kakaoSelectedTemplate?.template_code || '',
              templateId: kakaoSelectedTemplate?.id || '',
              variableMap: kakaoTemplateVars,
              nextType: alimtalkFallback,
              nextContents: alimtalkNextContents,
              // ★ 2026-07-27: nextSubject 배선 누락 정정. 값을 안 내려주고 안 받아올려 LMS 대체 제목이 발송 payload엔 항상 빈 값이었다.
              nextSubject: alimtalkNextSubject,
            }}
            onChange={(v: AlimtalkChannelState) => {
              if (setAlimtalkProfileId) setAlimtalkProfileId(v.profileId);
              const nextTpl =
                kakaoTemplates.find((t: any) => t.id === v.templateId) || null;
              setKakaoSelectedTemplate(nextTpl);
              setKakaoTemplateVars(v.variableMap);
              if (setAlimtalkFallback) setAlimtalkFallback(v.nextType);
              if (setAlimtalkNextContents) setAlimtalkNextContents(v.nextContents);
              if (setAlimtalkNextSubject) setAlimtalkNextSubject(v.nextSubject || '');
            }}
          />
          <button
            type="button"
            onClick={() => {
              if (!kakaoSelectedTemplate) { setToast({ show: true, type: 'error', message: '템플릿을 선택해주세요' }); return; }
              if (!approvedTpl) { setToast({ show: true, type: 'error', message: '승인된 템플릿만 발송 가능합니다' }); return; }
              handleAlimtalkSend();
            }}
            disabled={!kakaoSelectedTemplate || !approvedTpl || targetSending}
            className={`w-full h-12 rounded-xl text-[15px] font-bold transition inline-flex items-center justify-center gap-2 disabled:opacity-50 ${approvedTpl ? 'bg-amber-500 hover:bg-amber-600 text-white shadow-lg shadow-amber-500/20' : 'bg-slate-200 text-slate-500 cursor-not-allowed'}`}
          >
            <Bell className="w-4 h-4" />
            {targetSending ? '발송 중' : !kakaoSelectedTemplate ? '템플릿을 선택해주세요' : '알림톡 발송하기'}
          </button>
        </div>
      )}
    </div>
  );

  return (
    <SendWorkspaceShell
      show={show}
      onClose={onClose}
      title="직접 타겟 발송"
      subtitle={`추출된 ${targetRecipients.length.toLocaleString()}명에게 메시지를 발송합니다`}
      icon={<Users className="w-5 h-5 text-white" />}
      accent="indigo"
      zClass="z-50"
      aside={composer}
      asideWidth="440px"
      maxW="max-w-[1400px]"
    >
      <div className="p-4 sm:p-6 flex flex-col min-h-full">
        {/* ★ D162-4 (2026-05-15) PDF 0515 알림톡 #1: 알림톡 채널일 때만 변수 매칭 박스 노출. 문자 채널 영향 0. */}
        {targetSendChannel === 'kakao_alimtalk' && (
          <div className="mb-4">
            <AlimtalkVariableMappingPanel
              selectedTemplate={kakaoSelectedTemplate}
              variableMap={kakaoTemplateVars}
              onVariableMapChange={(next) => setKakaoTemplateVars(next)}
              customerFieldOptions={customerFieldOptions}
              sampleRecipient={targetRecipients[0] || null}
              recipientCount={targetRecipients.length}
            />
          </div>
        )}

        {/* 수신자 목록 헤더 */}
        <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
          <div className="flex items-center gap-2.5">
            <span className="text-[15px] font-semibold text-slate-900">수신자 목록</span>
            <span className={`${CUI_PILL_BASE} bg-indigo-100 text-indigo-700`}>총 {targetRecipients.length.toLocaleString()}건</span>
            {selectedPhones.size > 0 && <span className={`${CUI_PILL_BASE} bg-slate-100 text-slate-600`}>{selectedPhones.size}건 선택</span>}
          </div>
          <div className="flex items-center gap-2">
            {/* ★ D162-4 4차: 알림톡 버튼은 채널 정체성(amber) 유지. 추출된 수신자 그대로 알림톡 모달로 인계. */}
            {onAlimtalkOpen && (
              <button type="button" onClick={onAlimtalkOpen}
                className="h-9 px-3 rounded-lg text-[13px] font-semibold text-amber-800 bg-amber-50 ring-1 ring-amber-200 hover:bg-amber-100 inline-flex items-center gap-1.5 transition"
                title="추출된 수신자에게 알림톡 발송">
                <Bell className="w-3.5 h-3.5" />
                알림톡 발송
              </button>
            )}
            {/* ★ 2026-08-21 브랜드메시지: 넘어가는 모달이 인디고(콘솔 톤)라 버튼도 인디고. 수신자 목록 그대로 인계. */}
            {onBrandOpen && (
              <button type="button" onClick={onBrandOpen}
                className="h-9 px-3 rounded-lg text-[13px] font-semibold text-indigo-800 bg-indigo-50 ring-1 ring-indigo-200 hover:bg-indigo-100 inline-flex items-center gap-1.5 transition"
                title="추출된 수신자에게 브랜드메시지 발송">
                <Megaphone className="w-3.5 h-3.5" />
                브랜드메시지 발송
              </button>
            )}
            <div className="h-9 w-52 flex items-center gap-2 px-3 rounded-lg bg-slate-50 ring-1 ring-slate-200 focus-within:bg-white focus-within:ring-2 focus-within:ring-indigo-500/50 transition">
              <Search className="w-3.5 h-3.5 text-slate-400 shrink-0" />
              <input
                type="text"
                placeholder="수신번호 검색"
                value={targetListSearch}
                onChange={(e) => { setTargetListSearch(e.target.value); setTargetListPage(0); }}
                className="w-full min-w-0 bg-transparent border-0 p-0 text-[13px] text-slate-800 outline-none placeholder:text-slate-400 focus:ring-0"
              />
            </div>
            {/* ★ D123: 중복제거/수신거부제거 체크박스 제거. 직접타겟발송은 앞 단에서 이미 처리된 데이터 */}
          </div>
        </div>

        {/* ★ 표: fieldsMeta 기반 동적 컬럼 (하드코딩 제거) */}
        <div className={`${CUI_PANEL} flex-1`}>
          <div className={CUI_SCROLL_X}>
            <table className="w-full">
              <thead className={CUI_THEAD}>
                <tr>
                  <th className={`${CUI_TH} w-10 text-center`}>
                    <input
                      type="checkbox"
                      className="h-4 w-4 rounded accent-indigo-600"
                      checked={targetRecipients.length > 0 && selectedPhones.size === targetRecipients.length}
                      onChange={(e) => {
                        if (e.target.checked) {
                          setSelectedPhones(new Set(targetRecipients.map((r, i) => `${r.phone}_${i}`)));
                        } else {
                          setSelectedPhones(new Set());
                        }
                      }}
                    />
                  </th>
                  <th className={CUI_TH}>수신번호</th>
                  {tableFields.map(fm => (
                    <th key={fm.field_key} className={CUI_TH}>{fm.display_name}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {pageRows.length === 0 && (
                  <tr>
                    <td colSpan={2 + tableFields.length} className="px-4 py-14 text-center text-[13px] text-slate-400">
                      {targetListSearch ? '검색과 일치하는 수신번호가 없습니다' : '수신자가 없습니다. 타겟을 다시 설정해 주세요'}
                    </td>
                  </tr>
                )}
                {pageRows.map((r, idx) => {
                  const key = `${r.phone}_${pageStart + idx}`;
                  const checked = selectedPhones.has(key);
                  return (
                    <tr key={idx} className={`${CUI_TR} ${checked ? 'bg-indigo-50/60' : ''}`}>
                      <td className={`${CUI_TD} text-center`}>
                        <input
                          type="checkbox"
                          className="h-4 w-4 rounded accent-indigo-600"
                          checked={checked}
                          onChange={(e) => {
                            const next = new Set(selectedPhones);
                            if (e.target.checked) next.add(key); else next.delete(key);
                            setSelectedPhones(next);
                          }}
                        />
                      </td>
                      <td className={`${CUI_TD} font-mono text-[13px] text-slate-800`}>{r.phone}</td>
                      {tableFields.map(fm => (
                        <td key={fm.field_key} className={`${CUI_TD} ${CUI_CELL_DATA}`}>
                          {formatCellValue(r[fm.field_key], fm.data_type, fm.field_key)}
                        </td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        {/* 페이징 */}
        {totalPages > 1 && (
          <div className="mt-3 flex justify-center items-center gap-2">
            <button type="button" onClick={() => setTargetListPage(p => Math.max(0, p - 1))} disabled={targetListPage === 0} className={`${CUI_BTN_GHOST} h-8`}>
              <ChevronLeft className="w-4 h-4" />이전
            </button>
            <span className="text-[12.5px] text-slate-500 tabular-nums">{targetListPage + 1} / {totalPages} 페이지</span>
            <button type="button" onClick={() => setTargetListPage(p => Math.min(totalPages - 1, p + 1))} disabled={targetListPage >= totalPages - 1} className={`${CUI_BTN_GHOST} h-8`}>
              다음<ChevronRight className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* 하단 액션 */}
        {/* ★ D124 N1: 중복제거 버튼 제거. 직접타겟발송은 앞 단에서 이미 중복 제거된 데이터 */}
        <div className="mt-3 flex justify-between items-center gap-2 flex-wrap">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                if (selectedPhones.size === 0) return;
                const selectedIndices = new Set<number>();
                for (const k of selectedPhones) {
                  const idx = parseInt(k.split('_').pop() || '-1');
                  if (idx >= 0) selectedIndices.add(idx);
                }
                const remaining = targetRecipients.filter((_, i) => !selectedIndices.has(i));
                setTargetRecipients(remaining);
                setSelectedPhones(new Set());
              }}
              disabled={selectedPhones.size === 0}
              className={`${CUI_BTN_OUTLINE} ${selectedPhones.size > 0 ? 'text-rose-600 border-rose-200 hover:bg-rose-50 hover:border-rose-300' : ''}`}
            >
              <Trash2 className="w-3.5 h-3.5" />
              선택삭제{selectedPhones.size > 0 && ` (${selectedPhones.size})`}
            </button>
            <button type="button" onClick={() => setTargetRecipients([])} className={CUI_BTN_OUTLINE}>전체삭제</button>
          </div>
          <button type="button" onClick={onResetTarget} className={CUI_BTN_GHOST}>
            <RotateCcw className="w-3.5 h-3.5" />
            타겟 재설정
          </button>
        </div>
      </div>
    </SendWorkspaceShell>
  );
}
