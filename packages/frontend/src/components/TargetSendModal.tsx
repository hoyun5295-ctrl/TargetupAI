import { Sparkles } from 'lucide-react';
import { useRef, useState } from 'react';
import type { FieldMeta } from './DirectTargetFilterModal';
import { formatPreviewValue, formatByType, buildAdMessageFront, replaceVarsByFieldMeta, FRONT_FIELD_DISPLAY_MAP, reverseDisplayValueFront } from '../utils/formatDate';
import { insertAtCursor } from '../utils/textInsert';
import { getMmsImageDisplayName } from '../utils/mmsImage';
import AlimtalkChannelPanel, {
  type AlimtalkChannelState,
  type AlimtalkSenderProfile,
  type AlimtalkTemplate,
} from './alimtalk/AlimtalkChannelPanel';

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
  targetSendChannel: 'sms' | 'rcs' | 'kakao_alimtalk';
  setTargetSendChannel: (ch: 'sms' | 'rcs' | 'kakao_alimtalk') => void;
  targetMsgType: 'SMS' | 'LMS' | 'MMS';
  setTargetMsgType: (t: 'SMS' | 'LMS' | 'MMS') => void;

  // 메시지
  targetSubject: string;
  setTargetSubject: (s: string) => void;
  targetMessage: string;
  setTargetMessage: (m: string) => void;

  // 카카오 (알림톡 전용 — SMS/RCS 무관)
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

  // ====== ★ 동적 필드 파생 (하드코딩 제거 핵심) ======

  // 변수로 사용할 필드 목록 (phone, sms_opt_in 제외)
  const variableFields = fieldsMeta.filter(fm =>
    fm.field_key !== 'phone' && fm.field_key !== 'sms_opt_in'
  );

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
  const formatCellValue = (value: any, dataType: string, fieldKey?: string): string => {
    if (value == null || value === '') return '-';
    // enum 필드 (gender 등) → 한글 역변환 컨트롤타워
    if (fieldKey && FRONT_FIELD_DISPLAY_MAP[fieldKey]) {
      return reverseDisplayValueFront(fieldKey, value);
    }
    if (dataType === 'boolean') return value === true || value === 'true' ? '예' : '아니오';
    return formatByType(value, dataType);
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
    setSendConfirm({ show: true, type: reserveEnabled ? 'scheduled' : 'immediate', count: targetRecipients.length - unsubCount, unsubscribeCount: unsubCount, dateTime: reserveEnabled && reserveDateTime ? reserveDateTime : undefined, from: 'target', msgType: '카카오' });
  };

  const handleAlimtalkSend = async () => {
    if (targetRecipients.length === 0) { setToast({ show: true, type: 'error', message: '수신자가 없습니다' }); return; }
    if (!kakaoSelectedTemplate) { setToast({ show: true, type: 'error', message: '템플릿을 선택해주세요' }); return; }
    const token = localStorage.getItem('token');
    const phones = targetRecipients.map((r: any) => r.phone);
    const checkRes = await fetch('/api/unsubscribes/check', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ phones }) });
    const checkData = await checkRes.json();
    const unsubCount = checkData.unsubscribeCount || 0;
    setSendConfirm({ show: true, type: reserveEnabled ? 'scheduled' : 'immediate', count: targetRecipients.length - unsubCount, unsubscribeCount: unsubCount, dateTime: reserveEnabled && reserveDateTime ? reserveDateTime : undefined, from: 'target', msgType: '알림톡' });
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

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white rounded-2xl shadow-2xl w-[1400px] max-h-[95vh] overflow-y-auto">
        {/* 헤더 */}
        <div className="px-6 py-4 border-b flex justify-between items-center bg-green-50">
          <div>
            <h3 className="text-xl font-bold text-gray-800">직접 타겟 발송</h3>
            <p className="text-base text-gray-500 mt-1">추출된 <span className="font-bold text-emerald-600">{targetRecipients.length.toLocaleString()}명</span>에게 메시지를 발송합니다</p>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-gray-100 transition-colors text-gray-400 hover:text-gray-600"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* 본문 */}
        <div className="px-6 py-5 flex gap-5">
          {/* ========== 좌측: 메시지 작성 ========== */}
          <div className="w-[400px]">
            {/* 채널 선택 탭 */}
            <div className="flex mb-2 bg-gray-100 rounded-lg p-1 gap-0.5">
              {([
                { key: 'sms' as const, label: '📱 문자', activeColor: 'text-emerald-600' },
                { key: 'rcs' as const, label: '📱 RCS', activeColor: 'text-purple-600' },
                { key: 'kakao_alimtalk' as const, label: '🔔 알림톡', activeColor: 'text-blue-600' },
              ] as const).map(ch => (
                <button key={ch.key}
                  onClick={() => { setTargetSendChannel(ch.key); if (ch.key === 'sms') setMmsUploadedImages([]); }}
                  className={`flex-1 py-2 text-xs font-medium rounded-md transition-all ${
                    targetSendChannel === ch.key
                      ? `bg-white shadow ${ch.activeColor}`
                      : 'text-gray-400 hover:text-gray-600'
                  }`}
                >{ch.label}</button>
              ))}
            </div>

            {/* === SMS 채널 === */}
            {targetSendChannel === 'sms' && (<>
            {/* SMS/LMS/MMS 서브탭 */}
            <div className="flex mb-2 bg-gray-50 rounded-lg p-0.5">
              <button
                onClick={() => { setTargetMsgType('SMS'); setMmsUploadedImages([]); setLmsKeepAccepted(false); }}
                className={`flex-1 py-1.5 text-xs font-medium rounded-md transition-colors ${targetMsgType === 'SMS' ? 'bg-white shadow text-emerald-600' : 'text-gray-500 hover:text-gray-700'}`}
              >SMS</button>
              <button
                onClick={() => { setTargetMsgType('LMS'); setMmsUploadedImages([]); setLmsKeepAccepted(false); }}
                className={`flex-1 py-1.5 text-xs font-medium rounded-md transition-colors ${targetMsgType === 'LMS' ? 'bg-white shadow text-emerald-600' : 'text-gray-500 hover:text-gray-700'}`}
              >LMS</button>
              <button
                onClick={() => { setTargetMsgType('MMS'); setLmsKeepAccepted(false); }}
                className={`flex-1 py-1.5 text-xs font-medium rounded-md transition-colors ${targetMsgType === 'MMS' ? 'bg-white shadow text-emerald-600' : 'text-gray-500 hover:text-gray-700'}`}
              >MMS</button>
            </div>

            {/* SMS 메시지 작성 영역 */}
            <div className="border-2 border-gray-200 rounded-2xl overflow-hidden bg-white shadow-sm">
              {/* LMS/MMS 제목 */}
              {(targetMsgType === 'LMS' || targetMsgType === 'MMS') && (
                <div className="px-4 pt-3">
                  <div className="relative">
                    {adTextEnabled && (
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-orange-600 font-medium pointer-events-none select-none">(광고) </span>
                    )}
                    <input
                      type="text"
                      value={targetSubject}
                      onChange={(e) => setTargetSubject(e.target.value)}
                      placeholder={adTextEnabled ? "제목 입력 (필수)" : "제목 (필수)"}
                      style={adTextEnabled ? { paddingLeft: '52px' } : {}}
                      className="w-full px-3 py-2 border border-orange-300 bg-orange-50 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-orange-500 placeholder-orange-400"
                    />
                  </div>
                </div>
              )}

              {/* 메시지 입력 */}
              <div className="p-4">
                <div className="relative">
                  {adTextEnabled && (
                    <span className="absolute left-0 top-0 text-sm text-orange-600 font-medium pointer-events-none select-none">(광고) </span>
                  )}
                  <textarea
                    ref={smsTextareaRef}
                    data-char-target="target"
                    value={targetMessage}
                    onChange={(e) => {
                      const text = e.target.value;
                      setTargetMessage(text);
                    }}
                    placeholder="전송하실 내용을 입력하세요."
                    style={adTextEnabled ? { textIndent: '42px' } : {}}
                    className={`w-full resize-none border-0 focus:outline-none text-sm leading-relaxed ${targetMsgType === 'SMS' ? 'h-[180px]' : 'h-[140px]'}`}
                  />
                </div>
                {/* 무료거부 표기 */}
                {adTextEnabled && (
                  <div className="text-sm text-orange-600 mt-1">
                    {targetMsgType === 'SMS'
                      ? `무료거부${optOutNumber.replace(/-/g, '')}`
                      : `무료수신거부 ${formatRejectNumber(optOutNumber)}`}
                  </div>
                )}
              </div>

              {/* 버튼들 + 바이트 표시 */}
              <div className="px-3 py-1.5 bg-gray-50 border-t flex items-center justify-between">
                <div className="flex items-center gap-0.5">
                  <button onClick={handleAiMsgHelper} className="px-2 py-1 text-xs bg-gradient-to-r from-violet-500 to-blue-500 text-white rounded hover:from-violet-600 hover:to-blue-600 flex items-center gap-0.5 shadow-sm"><Sparkles className="w-3 h-3" />AI추천</button>
                  <button onClick={() => setShowSpecialChars('target')} className="px-2 py-1 text-xs bg-white border rounded hover:bg-gray-100">특수문자</button>
                  <button onClick={() => { loadTemplates(); setShowTemplateBox('target'); }} className="px-2 py-1 text-xs bg-white border rounded hover:bg-gray-100">보관함</button>
                  <button onClick={() => { if (!targetMessage.trim()) { setToast({show: true, type: 'error', message: '저장할 메시지를 먼저 입력해주세요.'}); setTimeout(() => setToast({show: false, type: 'error', message: ''}), 3000); return; } setTemplateSaveName(''); setShowTemplateSave('target'); }} className="px-2 py-1 text-xs bg-white border rounded hover:bg-gray-100">문자저장</button>
                </div>
                <span className="text-xs text-gray-500 whitespace-nowrap">
                  <span className={`font-bold ${(() => {
                    const fullMsg = buildAdMessageFront(targetMessage, targetMsgType, adTextEnabled, optOutNumber);
                    const bytes = calculateBytes(fullMsg);
                    const max = targetMsgType === 'SMS' ? 90 : 2000;
                    return bytes > max ? 'text-red-500' : 'text-emerald-600';
                  })()}`}>
                    {(() => {
                      const fullMsg = buildAdMessageFront(targetMessage, targetMsgType, adTextEnabled, optOutNumber);
                      return calculateBytes(fullMsg);
                    })()}
                  </span>/{targetMsgType === 'SMS' ? 90 : 2000}byte
                </span>
              </div>

              {/* 회신번호 선택 */}
              <div className="px-3 py-1.5 border-t">
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
                  className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
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
                        {formatPhoneNumber(cb.phone)} {cb.label ? `(${cb.label})` : ''} {cb.is_default ? '⭐' : ''}
                      </option>
                    ))}
                  </optgroup>
                </select>
                {useIndividualCallback && (
                  <p className="text-xs text-blue-600 mt-1">
                    각 수신자의 <strong>{fieldsMeta.find(f => f.field_key === individualCallbackColumn)?.display_name || individualCallbackColumn}</strong> 값으로 발송됩니다
                  </p>
                )}
              </div>

              {/* ★ 자동입력 드롭다운 — fieldsMeta 기반 동적 (하드코딩 제거) */}
              <div className="px-3 py-1.5 border-t bg-gray-50">
                <div className="flex items-center gap-3">
                  <span className="text-sm font-bold text-gray-700 whitespace-nowrap">자동입력</span>
                  <select
                    value=""
                    onChange={(e) => {
                      if (e.target.value) {
                        insertVariable(e.target.value, 'sms');
                      }
                    }}
                    className="flex-1 border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  >
                    <option value="">변수 선택</option>
                    {variableFields.map(fm => (
                      <option key={fm.field_key} value={fm.variable}>{fm.display_name}</option>
                    ))}
                  </select>
                </div>
              </div>

              {/* MMS 이미지 업로드 영역 — B16-05: MMS 탭에서만 표시 (SMS/LMS 전환 시 잔존 방지) */}
              {targetMsgType === 'MMS' && (
                <div className="px-3 py-2 border-t bg-amber-50/50 cursor-pointer hover:bg-amber-100/50 transition-colors" onClick={() => setShowMmsUploadModal(true)}>
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold text-gray-600">🖼️ MMS 이미지</span>
                    {mmsUploadedImages.length > 0 ? (
                      <div className="flex items-center gap-1">
                        {/* ★ B3(0417 PDF #3): 파일명 hover 툴팁 */}
                        {mmsUploadedImages.map((img: any, idx: number) => {
                          const fname = getMmsImageDisplayName(img, `이미지${idx + 1}`);
                          return (
                            <img
                              key={idx}
                              src={img.url}
                              alt={fname}
                              title={fname}
                              className="w-10 h-10 object-cover rounded border"
                            />
                          );
                        })}
                        <span className="text-xs text-purple-600 ml-1">✏️ 수정</span>
                      </div>
                    ) : (
                      <span className="text-xs text-amber-600">클릭하여 이미지 첨부 →</span>
                    )}
                  </div>
                </div>
              )}

              {/* 테스트 결과 표시 */}
              {testSentResultProp && (
                <div className={`mx-3 mt-1.5 p-2.5 rounded-lg text-xs whitespace-pre-wrap ${testSentResultProp.startsWith('✅') ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>
                  {testSentResultProp}
                </div>
              )}

              {/* 미리보기 + 스팸필터 + 담당자테스트 버튼 */}
              <div className="px-3 py-1.5 border-t">
                <div className="grid grid-cols-3 gap-2">
                  <button
                    onClick={handlePreview}
                    className="py-2.5 bg-emerald-500 hover:bg-emerald-600 text-white rounded-lg text-sm font-medium transition-colors"
                  >📄 미리보기</button>
                  <button
                    onClick={handleSpamFilter}
                    className="py-2.5 bg-gray-200 hover:bg-gray-300 text-gray-700 rounded-lg text-sm font-medium transition-colors"
                  >🛡️ 스팸필터</button>
                  <button
                    onClick={handleTargetTestSend}
                    disabled={testSendingProp || testCooldownProp || !targetMessage.trim()}
                    className="py-2.5 bg-orange-500 hover:bg-orange-600 text-white rounded-lg text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >{testSendingProp ? '📱 발송중...' : testCooldownProp ? '⏳ 10초 대기' : '📱 담당자테스트'}</button>
                </div>
              </div>

              {/* 예약/분할/광고 옵션 - 3분할 */}
              <div className="px-3 py-2 border-t">
                <div className="grid grid-cols-3 gap-2 text-xs">
                  {/* 예약전송 */}
                  <div className={`rounded-lg p-3 text-center ${reserveEnabled ? 'bg-blue-50' : 'bg-gray-50'}`}>
                    <label className="flex items-center justify-center gap-1.5 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={reserveEnabled}
                        onChange={(e) => {
                          setReserveEnabled(e.target.checked);
                          if (e.target.checked) setShowReservePicker(true);
                        }}
                        className="rounded w-4 h-4"
                      />
                      <span className={`font-medium ${reserveEnabled ? 'text-blue-700' : ''}`}>예약전송</span>
                    </label>
                    <div
                      className={`mt-1.5 text-xs cursor-pointer ${reserveEnabled ? 'text-blue-600 font-medium' : 'text-gray-400'}`}
                      onClick={() => reserveEnabled && setShowReservePicker(true)}
                    >
                      {reserveDateTime
                        ? new Date(reserveDateTime).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
                        : '예약시간 선택'}
                    </div>
                  </div>
                  {/* 분할전송 */}
                  <div className={`rounded-lg p-3 text-center ${splitEnabled ? 'bg-purple-50' : 'bg-gray-50'}`}>
                    <label className="flex items-center justify-center gap-1.5 cursor-pointer">
                      <input
                        type="checkbox"
                        className="rounded w-4 h-4"
                        checked={splitEnabled}
                        onChange={(e) => setSplitEnabled(e.target.checked)}
                      />
                      <span className={`font-medium ${splitEnabled ? 'text-purple-700' : ''}`}>분할전송</span>
                    </label>
                    <div className="mt-1.5 flex items-center justify-center gap-1">
                      <input
                        type="number"
                        className="w-14 border rounded px-1.5 py-1 text-xs text-center"
                        placeholder="1000"
                        value={splitCount}
                        onChange={(e) => setSplitCount(Number(e.target.value) || 1000)}
                        disabled={!splitEnabled}
                      />
                      <span className="text-xs text-gray-500">건/분</span>
                    </div>
                  </div>
                  {/* 광고/080 */}
                  <div className={`rounded-lg p-3 text-center ${adTextEnabled ? 'bg-orange-50' : 'bg-gray-50'}`}>
                    <label className="flex items-center justify-center gap-1.5 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={adTextEnabled}
                        onChange={(e) => handleAdToggle(e.target.checked)}
                        className="rounded w-4 h-4"
                      />
                      <span className={`font-medium ${adTextEnabled ? 'text-orange-700' : ''}`}>광고표기</span>
                    </label>
                    <div className={`mt-1.5 text-xs ${adTextEnabled ? 'text-orange-500' : 'text-gray-400'}`}>080 수신거부</div>
                  </div>
                </div>
              </div>

              {/* 전송하기 버튼 */}
              <div className="px-3 py-2 border-t">
                <button
                  onClick={handleSmsSend}
                  disabled={targetSending}
                  className="w-full py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-bold text-base transition-colors disabled:opacity-50"
                >
                  {targetSending ? '발송 중...' : '전송하기'}
                </button>
              </div>
            </div>
            </>)}

            {/* === RCS 채널 (템플릿 기반) === */}
            {targetSendChannel === 'rcs' && (
              <div className="border-2 border-purple-200 rounded-2xl overflow-hidden bg-white shadow-sm">
                <div className="p-4">
                  <div className="flex items-center gap-2 mb-3">
                    <span className="text-lg">📱</span>
                    <span className="text-sm font-semibold text-purple-800">RCS (템플릿 기반)</span>
                  </div>
                  <div className="text-center py-12">
                    <div className="text-4xl mb-3">📱</div>
                    <p className="text-sm text-gray-500 font-medium">등록된 RCS 템플릿이 없습니다</p>
                    <p className="text-xs text-gray-400 mt-1">카카오&RCS → RCS 템플릿에서 등록해주세요</p>
                  </div>
                  <div className="text-xs text-gray-400 mt-2">
                    RCS 미지원 단말은 SMS/LMS로 자동 폴백됩니다
                  </div>
                </div>
                <div className="px-3 py-2 border-t">
                  <button disabled className="w-full py-2.5 rounded-xl font-bold text-base bg-gray-300 text-gray-500 cursor-not-allowed">
                    템플릿을 선택해주세요
                  </button>
                  <p className="text-xs text-center text-purple-400 mt-1.5">RCS 발송 기능은 곧 오픈 예정입니다</p>
                </div>
              </div>
            )}

            {/* === 카카오 알림톡 채널 (D130: AlimtalkChannelPanel 공용) === */}
            {targetSendChannel === 'kakao_alimtalk' && (
              <div className="space-y-2">
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
                  }}
                  onChange={(v: AlimtalkChannelState) => {
                    if (setAlimtalkProfileId) setAlimtalkProfileId(v.profileId);
                    const nextTpl =
                      kakaoTemplates.find((t: any) => t.id === v.templateId) || null;
                    setKakaoSelectedTemplate(nextTpl);
                    setKakaoTemplateVars(v.variableMap);
                    if (setAlimtalkFallback) setAlimtalkFallback(v.nextType);
                    if (setAlimtalkNextContents) setAlimtalkNextContents(v.nextContents);
                  }}
                />
                <div className="bg-white rounded-2xl border-2 border-blue-200 px-3 py-2">
                  <button
                    onClick={() => {
                      if (!kakaoSelectedTemplate) { setToast({ show: true, type: 'error', message: '템플릿을 선택해주세요' }); return; }
                      if (!['approved', 'APPROVED', 'APR', 'A'].includes(kakaoSelectedTemplate.status)) { setToast({ show: true, type: 'error', message: '승인된 템플릿만 발송 가능합니다' }); return; }
                      handleAlimtalkSend();
                    }}
                    disabled={
                      !kakaoSelectedTemplate ||
                      !['approved', 'APPROVED', 'APR', 'A'].includes(kakaoSelectedTemplate?.status) ||
                      targetSending
                    }
                    className={`w-full py-3 rounded-xl font-bold text-base transition-colors disabled:opacity-50 ${
                      ['approved', 'APPROVED', 'APR', 'A'].includes(kakaoSelectedTemplate?.status)
                        ? 'bg-blue-500 hover:bg-blue-600 text-white'
                        : 'bg-gray-300 text-gray-500 cursor-not-allowed'
                    }`}
                  >
                    {targetSending ? '발송 중...' : !kakaoSelectedTemplate ? '템플릿을 선택해주세요' : '🔔 알림톡 발송하기'}
                  </button>
                </div>
              </div>
            )}
          </div>


          {/* ========== 우측: 수신자 목록 ========== */}
          <div className="flex-1 flex flex-col">
            {/* 헤더 */}
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-3">
                <span className="text-lg font-bold text-gray-800">수신자 목록</span>
                <span className="px-3 py-1 bg-emerald-100 text-emerald-700 rounded-full text-sm font-medium">
                  총 {targetRecipients.length.toLocaleString()}건
                </span>
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  placeholder="🔍 수신번호 검색"
                  value={targetListSearch}
                  onChange={(e) => { setTargetListSearch(e.target.value); setTargetListPage(0); }}
                  className="border rounded-lg px-3 py-1.5 text-sm w-48"
                />
                {/* ★ D123: 중복제거/수신거부제거 체크박스 제거 — 직접타겟발송은 앞 단에서 이미 처리된 데이터 */}
              </div>
            </div>

            {/* ★ 테이블 — fieldsMeta 기반 동적 컬럼 (하드코딩 제거) */}
            <div className="flex-1 border rounded-xl overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-2 py-2.5 text-center w-10">
                        <input
                          type="checkbox"
                          className="rounded"
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
                      <th className="px-4 py-2.5 text-left font-medium text-gray-600 whitespace-nowrap">수신번호</th>
                      {tableFields.map(fm => (
                        <th key={fm.field_key} className="px-4 py-2.5 text-left font-medium text-gray-600 whitespace-nowrap">
                          {fm.display_name}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {(() => {
                      const filtered = targetListSearch
                        ? targetRecipients.filter(r => r.phone?.includes(targetListSearch))
                        : targetRecipients;
                      const pageSize = 15;
                      const start = targetListPage * pageSize;
                      return filtered.slice(start, start + pageSize).map((r, idx) => (
                        <tr key={idx} className={`border-t hover:bg-gray-50 ${selectedPhones.has(`${r.phone}_${start + idx}`) ? 'bg-blue-50' : ''}`}>
                          <td className="px-2 py-2 text-center">
                            <input
                              type="checkbox"
                              className="rounded"
                              checked={selectedPhones.has(`${r.phone}_${start + idx}`)}
                              onChange={(e) => {
                                const key = `${r.phone}_${start + idx}`;
                                const next = new Set(selectedPhones);
                                if (e.target.checked) next.add(key); else next.delete(key);
                                setSelectedPhones(next);
                              }}
                            />
                          </td>
                          <td className="px-4 py-2 font-mono whitespace-nowrap">{r.phone}</td>
                          {tableFields.map(fm => (
                            <td key={fm.field_key} className="px-4 py-2 whitespace-nowrap">
                              {formatCellValue(r[fm.field_key], fm.data_type, fm.field_key)}
                            </td>
                          ))}
                        </tr>
                      ));
                    })()}
                  </tbody>
                </table>
              </div>
            </div>

            {/* 페이징 */}
            <div className="mt-3 flex justify-center items-center gap-2">
              {(() => {
                const filtered = targetListSearch
                  ? targetRecipients.filter(r => r.phone?.includes(targetListSearch))
                  : targetRecipients;
                const totalPages = Math.ceil(filtered.length / 15);
                if (totalPages <= 1) return null;

                return (
                  <>
                    <button
                      onClick={() => setTargetListPage(p => Math.max(0, p - 1))}
                      disabled={targetListPage === 0}
                      className="px-3 py-1.5 border rounded-lg text-sm disabled:opacity-50"
                    >이전</button>
                    <span className="text-sm text-gray-600">
                      {targetListPage + 1} / {totalPages} 페이지
                    </span>
                    <button
                      onClick={() => setTargetListPage(p => Math.min(totalPages - 1, p + 1))}
                      disabled={targetListPage >= totalPages - 1}
                      className="px-3 py-1.5 border rounded-lg text-sm disabled:opacity-50"
                    >다음</button>
                  </>
                );
              })()}
            </div>

            {/* 하단 버튼 */}
            {/* ★ D124 N1: 중복제거 버튼 제거 — 직접타겟발송은 앞 단에서 이미 중복 제거된 데이터. 상단 체크박스(D123)와 함께 버튼도 제거 */}
            <div className="mt-3 flex justify-between items-center">
              <div className="flex gap-2">
                <button
                  onClick={() => {
                    if (selectedPhones.size === 0) return;
                    const selectedIndices = new Set<number>();
                    for (const key of selectedPhones) {
                      const idx = parseInt(key.split('_').pop() || '-1');
                      if (idx >= 0) selectedIndices.add(idx);
                    }
                    const remaining = targetRecipients.filter((_, i) => !selectedIndices.has(i));
                    setTargetRecipients(remaining);
                    setSelectedPhones(new Set());
                  }}
                  disabled={selectedPhones.size === 0}
                  className={`px-3 py-1.5 text-sm border rounded-lg ${selectedPhones.size > 0 ? 'hover:bg-red-50 text-red-600 border-red-300' : 'text-gray-400'}`}
                >선택삭제 {selectedPhones.size > 0 && `(${selectedPhones.size})`}</button>
                <button
                  onClick={() => setTargetRecipients([])}
                  className="px-3 py-1.5 text-sm border rounded-lg hover:bg-gray-50"
                >전체삭제</button>
              </div>
              <button
                onClick={onResetTarget}
                className="px-3 py-1.5 text-sm bg-gray-100 rounded-lg hover:bg-gray-200"
              >🔄 타겟 재설정</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
