import { Sparkles } from 'lucide-react';
import { useRef, useState } from 'react';
import type { FieldMeta } from './DirectTargetFilterModal';

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
  targetSendChannel: 'sms' | 'kakao_brand' | 'kakao_alimtalk';
  setTargetSendChannel: (ch: 'sms' | 'kakao_brand' | 'kakao_alimtalk') => void;
  targetMsgType: 'SMS' | 'LMS' | 'MMS';
  setTargetMsgType: (t: 'SMS' | 'LMS' | 'MMS') => void;

  // 메시지
  targetSubject: string;
  setTargetSubject: (s: string) => void;
  targetMessage: string;
  setTargetMessage: (m: string) => void;

  // 카카오
  kakaoMessage: string;
  setKakaoMessage: (m: string) => void;
  kakaoEnabled: boolean;
  kakaoTemplates: any[];
  kakaoSelectedTemplate: any;
  setKakaoSelectedTemplate: (t: any) => void;
  kakaoTemplateVars: Record<string, string>;
  setKakaoTemplateVars: (v: any) => void;

  // 회신번호
  selectedCallback: string;
  setSelectedCallback: (cb: string) => void;
  useIndividualCallback: boolean;
  setUseIndividualCallback: (b: boolean) => void;
  callbackNumbers: any[];

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
  setShowSpecialChars: (s: string) => void;
  loadTemplates: () => void;
  setShowTemplateBox: (s: string) => void;
  setShowTemplateSave: (s: string) => void;
  setTemplateSaveName: (n: string) => void;

  // LMS/SMS 전환
  smsOverrideAccepted: boolean;
  setSmsOverrideAccepted: (b: boolean) => void;
  setPendingBytes: (n: number) => void;
  setShowLmsConfirm: (b: boolean) => void;
  setShowSmsConvert: (s: any) => void;

  // 발송 확인
  setSendConfirm: (s: any) => void;

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
  selectedCallback, setSelectedCallback,
  useIndividualCallback, setUseIndividualCallback,
  callbackNumbers,
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
  setPendingBytes, setShowLmsConfirm, setShowSmsConvert,
  setSendConfirm,
  targetSending,
  onResetTarget,
}: TargetSendModalProps) {

  // ====== 내부 state ======
  const [targetListPage, setTargetListPage] = useState(0);
  const [targetListSearch, setTargetListSearch] = useState('');
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

  // ====== ★ 커서 위치에 변수 삽입 (버그 수정) ======
  const insertVariable = (variable: string, target: 'sms' | 'kakao') => {
    const ref = target === 'sms' ? smsTextareaRef : kakaoTextareaRef;
    const currentValue = target === 'sms' ? targetMessage : kakaoMessage;
    const setter = target === 'sms' ? setTargetMessage : setKakaoMessage;

    const ta = ref.current;
    if (!ta) {
      setter(currentValue + variable);
      return;
    }
    const start = ta.selectionStart;
    const end = ta.selectionEnd;
    const before = currentValue.substring(0, start);
    const after = currentValue.substring(end);
    const newValue = before + variable + after;
    setter(newValue);
    requestAnimationFrame(() => {
      const newPos = start + variable.length;
      ta.selectionStart = newPos;
      ta.selectionEnd = newPos;
      ta.focus();
    });
  };

  // ====== ★ 동적 변수 치환 (스팸필터용) ======
  const replaceVars = (text: string, recipient: any) => {
    if (!text || !recipient) return text;
    let result = text;
    variableFields.forEach(fm => {
      const pattern = new RegExp(escapeRegExp(fm.variable), 'g');
      result = result.replace(pattern, String(recipient[fm.field_key] ?? ''));
    });
    return result;
  };

  // ====== 셀 값 포맷 ======
  const formatCellValue = (value: any, dataType: string): string => {
    if (value == null || value === '') return '-';
    if (dataType === 'number') {
      const num = Number(value);
      if (isNaN(num)) return String(value);
      return num.toLocaleString();
    }
    if (dataType === 'boolean') return value === true || value === 'true' ? '예' : '아니오';
    return String(value);
  };

  // ====== SMS 전송하기 핸들러 ======
  const handleSmsSend = async () => {
    if (targetRecipients.length === 0) {
      alert('수신자가 없습니다');
      return;
    }
    if (!targetMessage.trim()) {
      alert('메시지를 입력해주세요');
      return;
    }
    if (!selectedCallback && !useIndividualCallback) {
      alert('회신번호를 선택해주세요');
      return;
    }
    if (useIndividualCallback && targetRecipients.some((r: any) => !r.callback)) {
      alert('개별회신번호가 없는 고객이 있습니다.\n일반 회신번호를 선택하거나 고객 데이터를 확인해주세요.');
      return;
    }
    if ((targetMsgType === 'LMS' || targetMsgType === 'MMS') && !targetSubject.trim()) {
      alert('제목을 입력해주세요');
      return;
    }

    // 바이트 계산
    const optOutText = targetMsgType === 'SMS'
      ? `무료거부${optOutNumber.replace(/-/g, '')}`
      : `무료수신거부 ${formatRejectNumber(optOutNumber)}`;
    const fullMsg = adTextEnabled ? `${targetMsgType === 'SMS' ? '(광고)' : '(광고) '}${targetMessage}\n${optOutText}` : targetMessage;
    const msgBytes = calculateBytes(fullMsg);

    // SMS인데 90바이트 초과 시 전환 안내
    if (targetMsgType === 'SMS' && msgBytes > 90 && !smsOverrideAccepted) {
      setPendingBytes(msgBytes);
      setShowLmsConfirm(true);
      return;
    }

    // LMS/MMS인데 SMS로 보내도 되는 경우 비용 절감 안내
    if (targetMsgType !== 'SMS') {
      const smsOptOut = `무료거부${optOutNumber.replace(/-/g, '')}`;
      const smsFullMsg = adTextEnabled ? `(광고)${targetMessage}\n${smsOptOut}` : targetMessage;
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
      count: targetRecipients.length - unsubCount,
      unsubscribeCount: unsubCount,
      dateTime: reserveEnabled && reserveDateTime ? reserveDateTime : undefined,
      from: 'target',
      msgType: targetMsgType
    });
  };

  // ====== 카카오 전송하기 핸들러 ======
  const handleKakaoSend = async () => {
    if (targetRecipients.length === 0) { alert('수신자가 없습니다'); return; }
    if (!kakaoMessage.trim()) { alert('메시지를 입력해주세요'); return; }
    if (kakaoMessage.length > 4000) { alert('카카오 메시지는 4,000자 이내로 입력해주세요'); return; }
    if (!kakaoEnabled) { alert('카카오 발송이 활성화되지 않았습니다. 관리자에게 문의해주세요.'); return; }
    const token = localStorage.getItem('token');
    const phones = targetRecipients.map((r: any) => r.phone);
    const checkRes = await fetch('/api/unsubscribes/check', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ phones }) });
    const checkData = await checkRes.json();
    const unsubCount = checkData.unsubscribeCount || 0;
    setSendConfirm({ show: true, type: reserveEnabled ? 'scheduled' : 'immediate', count: targetRecipients.length - unsubCount, unsubscribeCount: unsubCount, dateTime: reserveEnabled && reserveDateTime ? reserveDateTime : undefined, from: 'target', msgType: '카카오' });
  };

  // ====== 미리보기 핸들러 ======
  const handlePreview = () => {
    if (!targetMessage.trim()) {
      alert('메시지를 입력해주세요');
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
    const smsRaw = adTextEnabled ? `(광고)${msg}\n무료거부${optOutNumber.replace(/-/g, '')}` : msg;
    const lmsRaw = adTextEnabled ? `(광고) ${msg}\n무료수신거부 ${optOutNumber}` : msg;
    const smsMsg = replaceVars(smsRaw, firstR);
    const lmsMsg = replaceVars(lmsRaw, firstR);
    setSpamFilterData({ sms: smsMsg, lms: lmsMsg, callback: cb, msgType: targetMsgType, firstRecipient: firstR || undefined });
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
                { key: 'sms' as const, label: '📱 문자' },
                { key: 'kakao_brand' as const, label: '💬 브랜드MSG' },
                { key: 'kakao_alimtalk' as const, label: '🔔 알림톡' },
              ] as const).map(ch => (
                <button key={ch.key}
                  onClick={() => { setTargetSendChannel(ch.key); if (ch.key === 'sms') setMmsUploadedImages([]); }}
                  className={`flex-1 py-2 text-xs font-medium rounded-md transition-all ${
                    targetSendChannel === ch.key
                      ? ch.key === 'sms' ? 'bg-white shadow text-emerald-600'
                        : ch.key === 'kakao_brand' ? 'bg-white shadow text-yellow-700'
                        : 'bg-white shadow text-blue-600'
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
                onClick={() => { setTargetMsgType('SMS'); setMmsUploadedImages([]); }}
                className={`flex-1 py-1.5 text-xs font-medium rounded-md transition-colors ${targetMsgType === 'SMS' ? 'bg-white shadow text-emerald-600' : 'text-gray-500 hover:text-gray-700'}`}
              >SMS</button>
              <button
                onClick={() => { setTargetMsgType('LMS'); setMmsUploadedImages([]); }}
                className={`flex-1 py-1.5 text-xs font-medium rounded-md transition-colors ${targetMsgType === 'LMS' ? 'bg-white shadow text-emerald-600' : 'text-gray-500 hover:text-gray-700'}`}
              >LMS</button>
              <button
                onClick={() => setTargetMsgType('MMS')}
                className={`flex-1 py-1.5 text-xs font-medium rounded-md transition-colors ${targetMsgType === 'MMS' ? 'bg-white shadow text-emerald-600' : 'text-gray-500 hover:text-gray-700'}`}
              >MMS</button>
            </div>

            {/* SMS 메시지 작성 영역 */}
            <div className="border-2 border-gray-200 rounded-2xl overflow-hidden bg-white shadow-sm">
              {/* LMS/MMS 제목 */}
              {(targetMsgType === 'LMS' || targetMsgType === 'MMS') && (
                <div className="px-4 pt-3">
                  <input
                    type="text"
                    value={targetSubject}
                    onChange={(e) => setTargetSubject(e.target.value)}
                    placeholder="제목 (필수)"
                    className="w-full px-3 py-2 border border-orange-300 bg-orange-50 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-orange-500 placeholder-orange-400"
                  />
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
                    value={targetMessage}
                    onChange={(e) => setTargetMessage(e.target.value)}
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
                {/* 특수문자/이모지 안내 */}
                <div className="text-xs text-gray-400 mt-2">
                  ⚠️ 이모지(😀)·특수문자는 LMS 전환 또는 발송 실패 원인이 될 수 있습니다
                </div>
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
                    const optOutText = targetMsgType === 'SMS'
                      ? `무료거부${optOutNumber.replace(/-/g, '')}`
                      : `무료수신거부 ${formatRejectNumber(optOutNumber)}`;
                    const fullMsg = adTextEnabled ? `${targetMsgType === 'SMS' ? '(광고)' : '(광고) '}${targetMessage}\n${optOutText}` : targetMessage;
                    const bytes = calculateBytes(fullMsg);
                    const max = targetMsgType === 'SMS' ? 90 : 2000;
                    return bytes > max ? 'text-red-500' : 'text-emerald-600';
                  })()}`}>
                    {(() => {
                      const optOutText = targetMsgType === 'SMS'
                        ? `무료거부${optOutNumber.replace(/-/g, '')}`
                        : `무료수신거부 ${formatRejectNumber(optOutNumber)}`;
                      const fullMsg = adTextEnabled ? `${targetMsgType === 'SMS' ? '(광고)' : '(광고) '}${targetMessage}\n${optOutText}` : targetMessage;
                      return calculateBytes(fullMsg);
                    })()}
                  </span>/{targetMsgType === 'SMS' ? 90 : 2000}byte
                </span>
              </div>

              {/* 회신번호 선택 */}
              <div className="px-3 py-1.5 border-t">
                <select
                  value={useIndividualCallback ? '__individual__' : selectedCallback}
                  onChange={(e) => {
                    if (e.target.value === '__individual__') {
                      setUseIndividualCallback(true);
                      setSelectedCallback('');
                    } else {
                      setUseIndividualCallback(false);
                      setSelectedCallback(e.target.value);
                    }
                  }}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                >
                  <option value="">회신번호 선택</option>
                  <option value="__individual__">📱 개별회신번호 (고객별 매장번호)</option>
                  {callbackNumbers.map((cb) => (
                    <option key={cb.id} value={cb.phone}>
                      {formatPhoneNumber(cb.phone)} {cb.label ? `(${cb.label})` : ''} {cb.is_default ? '⭐' : ''}
                    </option>
                  ))}
                </select>
                {useIndividualCallback && (
                  <p className="text-xs text-blue-600 mt-1">💡 각 고객의 주이용매장 회신번호로 발송됩니다</p>
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

              {/* MMS 이미지 업로드 영역 */}
              {(targetMsgType === 'MMS' || mmsUploadedImages.length > 0) && (
                <div className="px-3 py-2 border-t bg-amber-50/50 cursor-pointer hover:bg-amber-100/50 transition-colors" onClick={() => setShowMmsUploadModal(true)}>
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold text-gray-600">🖼️ MMS 이미지</span>
                    {mmsUploadedImages.length > 0 ? (
                      <div className="flex items-center gap-1">
                        {mmsUploadedImages.map((img, idx) => (
                          <img key={idx} src={img.url} alt="" className="w-10 h-10 object-cover rounded border" />
                        ))}
                        <span className="text-xs text-purple-600 ml-1">✏️ 수정</span>
                      </div>
                    ) : (
                      <span className="text-xs text-amber-600">클릭하여 이미지 첨부 →</span>
                    )}
                  </div>
                </div>
              )}

              {/* 미리보기 + 스팸필터 버튼 */}
              <div className="px-3 py-1.5 border-t">
                <div className="grid grid-cols-2 gap-2">
                  <button
                    onClick={handlePreview}
                    className="py-2.5 bg-emerald-500 hover:bg-emerald-600 text-white rounded-lg text-sm font-medium transition-colors"
                  >📄 미리보기</button>
                  <button
                    onClick={handleSpamFilter}
                    className="py-2.5 bg-gray-200 hover:bg-gray-300 text-gray-700 rounded-lg text-sm font-medium transition-colors"
                  >🛡️ 스팸필터테스트</button>
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

            {/* === 카카오 브랜드메시지 채널 === */}
            {targetSendChannel === 'kakao_brand' && (
              <div className="border-2 border-yellow-200 rounded-2xl overflow-hidden bg-white shadow-sm">
                {/* 카카오 메시지 입력 */}
                <div className="p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-lg">💬</span>
                    <span className="text-sm font-semibold text-yellow-800">브랜드메시지 (자유형)</span>
                  </div>
                  <textarea
                    ref={kakaoTextareaRef}
                    value={kakaoMessage}
                    onChange={(e) => setKakaoMessage(e.target.value)}
                    placeholder={"카카오 브랜드메시지 내용을 입력하세요.\n\n이모지 사용 가능 😊\n최대 4,000자"}
                    className="w-full h-[200px] resize-none border border-yellow-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-yellow-400 text-sm leading-relaxed p-3 bg-yellow-50/30"
                  />
                  <div className="text-xs text-gray-400 mt-1">
                    💡 이모지·특수문자 사용 가능 | 광고표기는 백엔드에서 자동 처리됩니다
                  </div>
                </div>
                {/* 바이트/글자수 표시 */}
                <div className="px-3 py-1.5 bg-yellow-50 border-t flex items-center justify-between">
                  <div className="flex items-center gap-0.5">
                    <button onClick={() => setShowSpecialChars('target')} className="px-2 py-1 text-xs bg-white border rounded hover:bg-gray-100">특수문자</button>
                    <button onClick={() => { loadTemplates(); setShowTemplateBox('target'); }} className="px-2 py-1 text-xs bg-white border rounded hover:bg-gray-100">보관함</button>
                  </div>
                  <span className="text-xs text-gray-500">
                    <span className={`font-bold ${kakaoMessage.length > 4000 ? 'text-red-500' : 'text-yellow-600'}`}>{kakaoMessage.length}</span>/4,000자
                  </span>
                </div>
                {/* 회신번호 (카카오는 발신프로필 기반이므로 참조용) */}
                <div className="px-3 py-1.5 border-t">
                  <div className="flex items-center gap-2 text-xs text-gray-500">
                    <span>💬</span>
                    <span>카카오 발신프로필로 발송됩니다 (설정에서 관리)</span>
                  </div>
                </div>
                {/* ★ 자동입력 변수 — fieldsMeta 기반 동적 (하드코딩 제거) */}
                <div className="px-3 py-1.5 border-t bg-yellow-50/50">
                  <div className="flex items-center gap-3">
                    <span className="text-sm font-bold text-gray-700 whitespace-nowrap">자동입력</span>
                    <select
                      value=""
                      onChange={(e) => { if (e.target.value) insertVariable(e.target.value, 'kakao'); }}
                      className="flex-1 border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-yellow-400"
                    >
                      <option value="">변수 선택</option>
                      {variableFields.map(fm => (
                        <option key={fm.field_key} value={fm.variable}>{fm.display_name}</option>
                      ))}
                    </select>
                  </div>
                </div>
                {/* 예약/분할 옵션 */}
                <div className="px-3 py-2 border-t">
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div className={`rounded-lg p-3 text-center ${reserveEnabled ? 'bg-blue-50' : 'bg-gray-50'}`}>
                      <label className="flex items-center justify-center gap-1.5 cursor-pointer">
                        <input type="checkbox" checked={reserveEnabled} onChange={(e) => { setReserveEnabled(e.target.checked); if (e.target.checked) setShowReservePicker(true); }} className="rounded w-4 h-4" />
                        <span className={`font-medium ${reserveEnabled ? 'text-blue-700' : ''}`}>예약전송</span>
                      </label>
                      <div className={`mt-1.5 text-xs cursor-pointer ${reserveEnabled ? 'text-blue-600 font-medium' : 'text-gray-400'}`} onClick={() => reserveEnabled && setShowReservePicker(true)}>
                        {reserveDateTime ? new Date(reserveDateTime).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '예약시간 선택'}
                      </div>
                    </div>
                    <div className={`rounded-lg p-3 text-center ${splitEnabled ? 'bg-purple-50' : 'bg-gray-50'}`}>
                      <label className="flex items-center justify-center gap-1.5 cursor-pointer">
                        <input type="checkbox" className="rounded w-4 h-4" checked={splitEnabled} onChange={(e) => setSplitEnabled(e.target.checked)} />
                        <span className={`font-medium ${splitEnabled ? 'text-purple-700' : ''}`}>분할전송</span>
                      </label>
                      <div className="mt-1.5 flex items-center justify-center gap-1">
                        <input type="number" className="w-14 border rounded px-1.5 py-1 text-xs text-center" placeholder="1000" value={splitCount} onChange={(e) => setSplitCount(Number(e.target.value) || 1000)} disabled={!splitEnabled} />
                        <span className="text-xs text-gray-500">건/분</span>
                      </div>
                    </div>
                  </div>
                </div>
                {/* 전송하기 버튼 */}
                <div className="px-3 py-2 border-t">
                  <button
                    onClick={handleKakaoSend}
                    disabled={targetSending || (!kakaoEnabled)}
                    className={`w-full py-2.5 rounded-xl font-bold text-base transition-colors disabled:opacity-50 ${
                      kakaoEnabled ? 'bg-yellow-500 hover:bg-yellow-600 text-white' : 'bg-gray-300 text-gray-500 cursor-not-allowed'
                    }`}
                  >
                    {targetSending ? '발송 중...' : !kakaoEnabled ? '🔒 카카오 발송 준비중' : '💬 전송하기'}
                  </button>
                  {!kakaoEnabled && (
                    <p className="text-xs text-center text-gray-400 mt-1.5">카카오 발송 활성화는 관리자에게 문의해주세요</p>
                  )}
                </div>
              </div>
            )}

            {/* === 카카오 알림톡 채널 === */}
            {targetSendChannel === 'kakao_alimtalk' && (
              <div className="border-2 border-blue-200 rounded-2xl overflow-hidden bg-white shadow-sm">
                <div className="p-4">
                  <div className="flex items-center gap-2 mb-3">
                    <span className="text-lg">🔔</span>
                    <span className="text-sm font-semibold text-blue-800">알림톡 (템플릿 기반)</span>
                  </div>
                  {/* 템플릿 목록 */}
                  {kakaoTemplates.length === 0 ? (
                    <div className="text-center py-12">
                      <div className="text-4xl mb-3">📋</div>
                      <p className="text-sm text-gray-500 font-medium">등록된 알림톡 템플릿이 없습니다</p>
                      <p className="text-xs text-gray-400 mt-1">설정 → 카카오 프로필 관리에서 템플릿을 등록해주세요</p>
                    </div>
                  ) : (
                    <div className="space-y-2 max-h-[300px] overflow-y-auto">
                      {kakaoTemplates.map((t: any) => (
                        <div key={t.id}
                          onClick={() => {
                            setKakaoSelectedTemplate(t);
                            const vars: Record<string, string> = {};
                            (t.content?.match(/#{[^}]+}/g) || []).forEach((v: string) => { vars[v] = ''; });
                            setKakaoTemplateVars(vars);
                          }}
                          className={`p-3 border rounded-lg cursor-pointer transition-colors ${
                            kakaoSelectedTemplate?.id === t.id ? 'border-blue-500 bg-blue-50' : 'border-gray-200 hover:border-blue-300'
                          }`}
                        >
                          <div className="flex items-center justify-between">
                            <span className="text-sm font-medium">{t.template_name}</span>
                            <span className={`text-xs px-2 py-0.5 rounded-full ${t.status === 'approved' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                              {t.status === 'approved' ? '승인' : t.status}
                            </span>
                          </div>
                          <p className="text-xs text-gray-500 mt-1 line-clamp-2">{t.content}</p>
                        </div>
                      ))}
                    </div>
                  )}
                  {/* 선택된 템플릿 변수 매핑 */}
                  {kakaoSelectedTemplate && Object.keys(kakaoTemplateVars).length > 0 && (
                    <div className="mt-3 pt-3 border-t">
                      <p className="text-xs font-semibold text-gray-600 mb-2">변수 매핑</p>
                      {Object.keys(kakaoTemplateVars).map(varKey => (
                        <div key={varKey} className="flex items-center gap-2 mb-1.5">
                          <span className="text-xs text-blue-600 font-mono w-24 shrink-0">{varKey}</span>
                          <input
                            type="text"
                            value={kakaoTemplateVars[varKey]}
                            onChange={(e) => setKakaoTemplateVars((prev: any) => ({...prev, [varKey]: e.target.value}))}
                            placeholder="값 입력"
                            className="flex-1 border rounded px-2 py-1 text-xs"
                          />
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                {/* 전송하기 버튼 */}
                <div className="px-3 py-2 border-t">
                  <button
                    disabled={true}
                    className="w-full py-2.5 bg-gray-300 text-gray-500 rounded-xl font-bold text-base cursor-not-allowed"
                  >🔒 알림톡 발송 준비중</button>
                  <p className="text-xs text-center text-gray-400 mt-1.5">알림톡 발송 기능은 준비 중입니다</p>
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
                <label className="flex items-center gap-1 text-sm text-gray-600">
                  <input type="checkbox" defaultChecked className="rounded" />
                  중복제거
                </label>
                <label className="flex items-center gap-1 text-sm text-gray-600">
                  <input type="checkbox" defaultChecked className="rounded" />
                  수신거부제거
                </label>
              </div>
            </div>

            {/* ★ 테이블 — fieldsMeta 기반 동적 컬럼 (하드코딩 제거) */}
            <div className="flex-1 border rounded-xl overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50">
                    <tr>
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
                        <tr key={idx} className="border-t hover:bg-gray-50">
                          <td className="px-4 py-2 font-mono whitespace-nowrap">{r.phone}</td>
                          {tableFields.map(fm => (
                            <td key={fm.field_key} className="px-4 py-2 whitespace-nowrap">
                              {formatCellValue(r[fm.field_key], fm.data_type)}
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
            <div className="mt-3 flex justify-between items-center">
              <div className="flex gap-2">
                <button className="px-3 py-1.5 text-sm border rounded-lg hover:bg-gray-50">중복제거</button>
                <button className="px-3 py-1.5 text-sm border rounded-lg hover:bg-gray-50">선택삭제</button>
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
