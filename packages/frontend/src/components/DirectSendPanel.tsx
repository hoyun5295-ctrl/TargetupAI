/**
 * ★ D96: 직접발송 패널 — Dashboard.tsx에서 분리
 *
 * 좌측: 메시지 작성 (SMS/RCS/알림톡 채널 선택)
 * 우측: 수신자 목록 (직접입력/파일등록/주소록)
 * 하위모달: 파일매핑, 직접입력
 *
 * 컨트롤타워: formatDate.ts의 DIRECT_VAR_MAP, DIRECT_FIELD_LABELS, DIRECT_MAPPING_FIELDS, replaceDirectVars
 */

import { useState } from 'react';
import {
  calculateSmsBytes,
  formatPreviewValue,
  DIRECT_VAR_MAP,
  DIRECT_VAR_TO_FIELD,
  DIRECT_FIELD_LABELS,
  DIRECT_MAPPING_FIELDS,
  replaceDirectVars,
  buildAdMessageFront,
  detectPhoneHeaders,
} from '../utils/formatDate';

// ============================================================
// Props 인터페이스
// ============================================================

export interface DirectSendPanelProps {
  // 메시지 state
  directSendChannel: 'sms' | 'rcs' | 'kakao_alimtalk';
  setDirectSendChannel: (ch: 'sms' | 'rcs' | 'kakao_alimtalk') => void;
  directMsgType: 'SMS' | 'LMS' | 'MMS';
  setDirectMsgType: (t: 'SMS' | 'LMS' | 'MMS') => void;
  directSubject: string;
  setDirectSubject: (s: string) => void;
  directMessage: string;
  setDirectMessage: React.Dispatch<React.SetStateAction<string>>;
  directRecipients: any[];
  setDirectRecipients: React.Dispatch<React.SetStateAction<any[]>>;

  // 바이트 계산
  messageBytes: number;
  maxBytes: number;

  // 발신번호
  callbackNumbers: { id: string; phone: string; label: string; is_default: boolean }[];
  selectedCallback: string;
  setSelectedCallback: (s: string) => void;
  useIndividualCallback: boolean;
  setUseIndividualCallback: (b: boolean) => void;
  individualCallbackColumn: string;
  setIndividualCallbackColumn: (col: string) => void;

  // 옵션
  adTextEnabled: boolean;
  handleAdToggle: (enabled: boolean) => void;
  reserveEnabled: boolean;
  setReserveEnabled: (b: boolean) => void;
  reserveDateTime: string;
  setShowReservePicker: (b: boolean) => void;
  splitEnabled: boolean;
  setSplitEnabled: (b: boolean) => void;
  splitCount: number;
  setSplitCount: (n: number) => void;
  optOutNumber: string;

  // MMS
  mmsUploadedImages: { url: string; serverPath?: string; file?: File }[];
  setMmsUploadedImages: React.Dispatch<React.SetStateAction<any[]>>;
  setShowMmsUploadModal: (b: boolean) => void;

  // 스팸필터
  isSpamFilterLocked: boolean;
  setShowSpamFilterLock: (b: boolean) => void;
  setSpamFilterData: (d: any) => void;
  setShowSpamFilter: (b: boolean) => void;

  // 카카오
  kakaoTemplates: any[];
  kakaoSelectedTemplate: any;
  setKakaoSelectedTemplate: (t: any) => void;
  kakaoTemplateVars: Record<string, string>;
  setKakaoTemplateVars: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  alimtalkFallback: 'N' | 'S' | 'L';
  setAlimtalkFallback: (f: 'N' | 'S' | 'L') => void;
  kakaoMessage: string;
  setKakaoMessage: (m: string) => void;

  // RCS
  rcsTemplates: any[];
  rcsSelectedTemplate: any;
  setRcsSelectedTemplate: (t: any) => void;

  // 미리보기/특수문자/보관함
  setShowDirectPreview: (b: boolean) => void;
  setShowSpecialChars: (s: 'direct' | 'target' | null) => void;
  setShowTemplateBox: (s: 'direct' | 'target' | null) => void;
  setShowTemplateSave: (s: 'direct' | 'target' | null) => void;
  setTemplateSaveName: (s: string) => void;
  loadTemplates: () => void;

  // 주소록
  setShowAddressBook: (b: boolean) => void;
  setAddressGroups: (g: any[]) => void;

  // 전송 확인
  onSendConfirm: (data: any) => void;
  setToast: (t: { show: boolean; type: 'success' | 'error' | 'warning'; message: string }) => void;

  // LMS/SMS 전환 모달
  lmsKeepAccepted: boolean;
  smsOverrideAccepted: boolean;
  setPendingBytes: (n: number) => void;
  setShowLmsConfirm: (b: boolean) => void;
  setShowSmsConvert: (d: any) => void;

  // 유틸 함수
  getFullMessage: (msg: string) => string;
  getMaxByteMessage: (msg: string, recipients: any[], varMap: Record<string, string>) => string;
  formatPhoneNumber: (phone: string) => string;
  formatRejectNumber: (num: string) => string;

  // 닫기
  onClose: () => void;
}

// ============================================================
// 컴포넌트
// ============================================================

export default function DirectSendPanel(props: DirectSendPanelProps) {
  const {
    directSendChannel, setDirectSendChannel,
    directMsgType, setDirectMsgType,
    directSubject, setDirectSubject,
    directMessage, setDirectMessage,
    directRecipients, setDirectRecipients,
    messageBytes, maxBytes,
    callbackNumbers, selectedCallback, setSelectedCallback,
    useIndividualCallback, setUseIndividualCallback,
    individualCallbackColumn, setIndividualCallbackColumn,
    adTextEnabled, handleAdToggle,
    reserveEnabled, setReserveEnabled, reserveDateTime, setShowReservePicker,
    splitEnabled, setSplitEnabled, splitCount, setSplitCount,
    optOutNumber,
    mmsUploadedImages, setMmsUploadedImages, setShowMmsUploadModal,
    isSpamFilterLocked, setShowSpamFilterLock, setSpamFilterData, setShowSpamFilter,
    kakaoTemplates, kakaoSelectedTemplate, setKakaoSelectedTemplate,
    kakaoTemplateVars, setKakaoTemplateVars,
    alimtalkFallback, setAlimtalkFallback,
    kakaoMessage, setKakaoMessage,
    rcsTemplates, rcsSelectedTemplate, setRcsSelectedTemplate,
    setShowDirectPreview, setShowSpecialChars, setShowTemplateBox,
    setShowTemplateSave, setTemplateSaveName, loadTemplates,
    setShowAddressBook, setAddressGroups,
    onSendConfirm, setToast,
    lmsKeepAccepted, smsOverrideAccepted,
    setPendingBytes, setShowLmsConfirm, setShowSmsConvert,
    getFullMessage, getMaxByteMessage, formatPhoneNumber, formatRejectNumber,
    onClose,
  } = props;

  // ============================================================
  // 내부 state (직접발송 전용 — Dashboard에서 이동)
  // ============================================================
  const [directInputMode, setDirectInputMode] = useState<'file' | 'direct' | 'address'>('file');
  const [directFileHeaders, setDirectFileHeaders] = useState<string[]>([]);
  const [directFilePreview, setDirectFilePreview] = useState<any[]>([]);
  const [directFileData, setDirectFileData] = useState<any[]>([]);
  const [directColumnMapping, setDirectColumnMapping] = useState<{ [key: string]: string }>({});
  const [directFileLoading, setDirectFileLoading] = useState(false);
  const [directMappingLoading, setDirectMappingLoading] = useState(false);
  const [directLoadingProgress, setDirectLoadingProgress] = useState(0);
  const [directShowMapping, setDirectShowMapping] = useState(false);
  const [showDirectInput, setShowDirectInput] = useState(false);
  // ★ D102: 중복제거/수신거부제거 체크박스 state (기본 true)
  const [dedupEnabled, setDedupEnabled] = useState(true);
  const [unsubFilterEnabled, setUnsubFilterEnabled] = useState(true);
  const [directInputText, setDirectInputText] = useState('');
  const [directSearchQuery, setDirectSearchQuery] = useState('');
  const [selectedRecipients, setSelectedRecipients] = useState<Set<number>>(new Set());

  // ============================================================
  // 헬퍼
  // ============================================================
  const calculateBytes = calculateSmsBytes;

  // ★ D102: getAdSuffix UI 표시용으로만 유지 (메시지 조합은 buildAdMessageFront 사용)
  const getAdSuffix = () => {
    return directMsgType === 'SMS'
      ? `무료거부${optOutNumber.replace(/-/g, '')}`
      : `무료수신거부 ${formatRejectNumber(optOutNumber)}`;
  };

  // ============================================================
  // 전송 유효성 검사 + 확인 모달
  // ============================================================
  const handleSendClick = async () => {
    if (directRecipients.length === 0) {
      setToast({ show: true, type: 'error', message: '수신자를 추가해주세요' });
      return;
    }
    if (!directMessage.trim()) {
      setToast({ show: true, type: 'error', message: '메시지를 입력해주세요' });
      return;
    }
    if (!selectedCallback && !useIndividualCallback) {
      setToast({ show: true, type: 'error', message: '회신번호를 선택해주세요' });
      return;
    }
    if (useIndividualCallback && directRecipients.some((r: any) => !r.callback)) {
      setToast({ show: true, type: 'error', message: '개별회신번호가 없는 수신자가 있습니다. 일반 회신번호를 선택해주세요.' });
      return;
    }
    if ((directMsgType === 'LMS' || directMsgType === 'MMS') && !directSubject.trim()) {
      setToast({ show: true, type: 'error', message: '제목을 입력해주세요' });
      return;
    }

    // SMS 바이트 초과 시 LMS 전환 모달
    if (directMsgType === 'SMS' && messageBytes > 90 && !smsOverrideAccepted) {
      setPendingBytes(messageBytes);
      setShowLmsConfirm(true);
      return;
    }

    // LMS/MMS인데 SMS로 보내도 되는 경우 비용 절감 안내
    if (directMsgType !== 'SMS' && !lmsKeepAccepted && mmsUploadedImages.length === 0) {
      const smsMaxMsg = getMaxByteMessage(directMessage, directRecipients, DIRECT_VAR_TO_FIELD);
      const smsFullMsg = buildAdMessageFront(smsMaxMsg, 'SMS', adTextEnabled, optOutNumber);
      const smsBytes = calculateBytes(smsFullMsg);
      if (smsBytes <= 90) {
        setShowSmsConvert({ show: true, from: 'direct', currentBytes: messageBytes, smsBytes, count: directRecipients.length });
        return;
      }
    }

    // 수신거부 체크
    const token = localStorage.getItem('token');
    const phones = directRecipients.map((r: any) => r.phone);
    const checkRes = await fetch('/api/unsubscribes/check', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ phones })
    });
    const checkData = await checkRes.json();
    const unsubCount = checkData.unsubscribeCount || 0;

    onSendConfirm({
      show: true,
      type: reserveEnabled ? 'scheduled' : 'immediate',
      count: directRecipients.length - (unsubFilterEnabled ? unsubCount : 0),
      unsubscribeCount: unsubFilterEnabled ? unsubCount : 0,
      dateTime: reserveEnabled && reserveDateTime ? reserveDateTime : undefined,
      from: 'direct',
      msgType: directMsgType,
      // ★ D102: 중복제거/수신거부제거 플래그 전달
      dedupEnabled,
      unsubFilterEnabled,
    });
  };

  // 알림톡 전송
  const handleAlimtalkSend = async () => {
    if (directRecipients.length === 0) { setToast({ show: true, type: 'error', message: '수신자를 추가해주세요' }); return; }
    if (!kakaoSelectedTemplate) { setToast({ show: true, type: 'error', message: '템플릿을 선택해주세요' }); return; }
    if (kakaoSelectedTemplate.status !== 'approved') { setToast({ show: true, type: 'error', message: '승인된 템플릿만 발송 가능합니다' }); return; }
    let finalContent = kakaoSelectedTemplate.content;
    Object.entries(kakaoTemplateVars).forEach(([k, v]) => { finalContent = finalContent.replace(new RegExp(k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), v); });
    setKakaoMessage(finalContent);
    const token = localStorage.getItem('token');
    const phones = directRecipients.map((r: any) => r.phone);
    const checkRes = await fetch('/api/unsubscribes/check', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ phones }) });
    const checkData = await checkRes.json();
    const unsubCount = checkData.unsubscribeCount || 0;
    onSendConfirm({ show: true, type: 'immediate', count: directRecipients.length - unsubCount, unsubscribeCount: unsubCount, from: 'direct', msgType: '알림톡' });
  };

  // 스팸필터 열기
  const handleSpamFilter = () => {
    if (isSpamFilterLocked) { setShowSpamFilterLock(true); return; }
    const msg = directMessage || '';
    const cb = selectedCallback || '';
    const firstR = directRecipients[0];
    const replaceVars = (text: string) => {
      if (!text || !firstR) return text;
      return replaceDirectVars(text, firstR, selectedCallback);
    };
    const smsRaw = buildAdMessageFront(msg, 'SMS', adTextEnabled, optOutNumber);
    const lmsRaw = buildAdMessageFront(msg, 'LMS', adTextEnabled, optOutNumber);
    const smsMsg = replaceVars(smsRaw);
    const lmsMsg = replaceVars(lmsRaw);
    setSpamFilterData({ sms: smsMsg, lms: lmsMsg, callback: cb, msgType: directMsgType, subject: directSubject || '', firstRecipient: firstR || undefined });
    setShowSpamFilter(true);
  };

  // 파일 업로드 처리
  const handleFileUpload = async (file: File) => {
    setDirectFileLoading(true);
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
      if (data.success) {
        setDirectFileHeaders(data.headers);
        setDirectFilePreview(data.preview);
        setDirectFileData(data.allData || data.preview);
        setDirectInputMode('file');
        setDirectShowMapping(true);
        setDirectColumnMapping({});
      } else {
        setToast({ show: true, type: 'error', message: data.error || '파일 파싱 실패' });
      }
    } catch {
      setToast({ show: true, type: 'error', message: '파일 업로드 중 오류가 발생했습니다.' });
    } finally {
      setDirectFileLoading(false);
    }
  };

  // 파일 매핑 적용
  const handleMappingApply = async () => {
    if (!directColumnMapping.phone) {
      setToast({ show: true, type: 'error', message: '수신번호는 필수입니다.' });
      return;
    }
    setDirectMappingLoading(true);
    setDirectLoadingProgress(0);
    await new Promise(resolve => setTimeout(resolve, 10));

    const total = directFileData.length;
    const chunkSize = 5000;
    const mapped: any[] = [];

    for (let i = 0; i < total; i += chunkSize) {
      const chunk = directFileData.slice(i, i + chunkSize);
      const processed = chunk.map(row => {
        let phone = String(row[directColumnMapping.phone] || '').trim();
        const entry: any = {
          phone,
          name: directColumnMapping.name ? (row[directColumnMapping.name] || '') : '',
          extra1: directColumnMapping.extra1 ? (row[directColumnMapping.extra1] || '') : '',
          extra2: directColumnMapping.extra2 ? (row[directColumnMapping.extra2] || '') : '',
          extra3: directColumnMapping.extra3 ? (row[directColumnMapping.extra3] || '') : '',
          callback: directColumnMapping.callback ? String(row[directColumnMapping.callback] || '').trim() : '',
        };
        // 알림톡 템플릿 변수 매핑
        if (directSendChannel === 'kakao_alimtalk' && kakaoSelectedTemplate) {
          const vars = kakaoSelectedTemplate.content?.match(/#{[^}]+}/g) || [];
          const varValues: Record<string, string> = {};
          vars.forEach((varName: string, vi: number) => {
            const mappedCol = (directColumnMapping as any)[`tplvar_${vi}`];
            if (mappedCol) varValues[varName] = String(row[mappedCol] || '');
          });
          entry._templateVars = varValues;
        }
        return entry;
      }).filter(r => r.phone && r.phone.length >= 10);

      mapped.push(...processed);
      setDirectLoadingProgress(Math.min(100, Math.round((i + chunkSize) / total * 100)));
      await new Promise(resolve => setTimeout(resolve, 10));
    }

    setDirectRecipients(mapped);
    setDirectMappingLoading(false);
    setDirectShowMapping(false);
  };

  // ============================================================
  // JSX
  // ============================================================

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white rounded-2xl shadow-2xl w-[1400px] max-h-[95vh] overflow-y-auto">
        {/* 본문 */}
        <div className="px-6 py-5 flex gap-5">
          {/* 좌측: 메시지 작성 */}
          <div className="w-[400px]">
            {/* 채널 선택 탭 */}
            <div className="flex mb-2 bg-gray-100 rounded-lg p-1 gap-0.5">
              {([
                { key: 'sms' as const, label: '📱 문자', activeColor: 'text-emerald-600' },
                { key: 'rcs' as const, label: '📱 RCS', activeColor: 'text-purple-600' },
                { key: 'kakao_alimtalk' as const, label: '🔔 알림톡', activeColor: 'text-blue-600' },
              ] as const).map(ch => (
                <button key={ch.key}
                  onClick={() => { setDirectSendChannel(ch.key); if (ch.key === 'sms') setMmsUploadedImages([]); }}
                  className={`flex-1 py-2 text-xs font-medium rounded-md transition-all ${
                    directSendChannel === ch.key
                      ? `bg-white shadow ${ch.activeColor}`
                      : 'text-gray-400 hover:text-gray-600'
                  }`}
                >{ch.label}</button>
              ))}
            </div>

            {/* === SMS 채널 === */}
            {directSendChannel === 'sms' && (<>
            {/* SMS/LMS/MMS 서브탭 */}
            <div className="flex mb-2 bg-gray-50 rounded-lg p-0.5">
              <button
                onClick={() => { setDirectMsgType('SMS'); setMmsUploadedImages([]); }}
                className={`flex-1 py-1.5 text-xs font-medium rounded-md transition-colors ${directMsgType === 'SMS' ? 'bg-white shadow text-emerald-600' : 'text-gray-500 hover:text-gray-700'}`}
              >SMS</button>
              <button
                onClick={() => { setDirectMsgType('LMS'); setMmsUploadedImages([]); }}
                className={`flex-1 py-1.5 text-xs font-medium rounded-md transition-colors ${directMsgType === 'LMS' ? 'bg-white shadow text-emerald-600' : 'text-gray-500 hover:text-gray-700'}`}
              >LMS</button>
              <button
                onClick={() => { setDirectMsgType('MMS'); }}
                className={`flex-1 py-1.5 text-xs font-medium rounded-md transition-colors ${directMsgType === 'MMS' ? 'bg-white shadow text-emerald-600' : 'text-gray-500 hover:text-gray-700'}`}
              >MMS</button>
            </div>

            {/* SMS 메시지 작성 영역 */}
            <div className="border-2 border-gray-200 rounded-2xl overflow-hidden bg-white shadow-sm">
              {/* LMS/MMS 제목 */}
              {(directMsgType === 'LMS' || directMsgType === 'MMS') && (
                <div className="px-4 pt-3">
                  <input
                    type="text"
                    value={directSubject}
                    onChange={(e) => setDirectSubject(e.target.value)}
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
                    value={directMessage}
                    onChange={(e) => setDirectMessage(e.target.value)}
                    placeholder="전송하실 내용을 입력하세요."
                    style={adTextEnabled ? { textIndent: '42px' } : {}}
                    className={`w-full resize-none border-0 focus:outline-none text-sm leading-relaxed ${directMsgType === 'SMS' ? 'h-[180px]' : 'h-[140px]'}`}
                  />
                </div>
                {/* 무료거부 표기 */}
                {adTextEnabled && (
                  <div className="text-sm text-orange-600 mt-1">
                    {getAdSuffix()}
                  </div>
                )}

                {/* MMS 이미지 미리보기 */}
                {directMsgType === 'MMS' && (
                  <div className="mt-2 pt-2 border-t cursor-pointer hover:bg-amber-50/50 transition-colors rounded-lg p-2" onClick={() => setShowMmsUploadModal(true)}>
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
              </div>

              {/* 버튼들 + 바이트 표시 */}
              <div className="px-3 py-1.5 bg-gray-50 border-t flex items-center justify-between">
                <div className="flex items-center gap-0.5">
                  <button onClick={() => setShowSpecialChars('direct')} className="px-2 py-1 text-xs bg-white border rounded hover:bg-gray-100">특수문자</button>
                  <button onClick={() => { loadTemplates(); setShowTemplateBox('direct'); }} className="px-2 py-1 text-xs bg-white border rounded hover:bg-gray-100">보관함</button>
                  <button onClick={() => { if (!directMessage.trim()) { setToast({ show: true, type: 'error', message: '저장할 메시지를 먼저 입력해주세요.' }); return; } setTemplateSaveName(''); setShowTemplateSave('direct'); }} className="px-2 py-1 text-xs bg-white border rounded hover:bg-gray-100">문자저장</button>
                </div>
                <span className="text-xs text-gray-500 whitespace-nowrap">
                  <span className={`font-bold ${messageBytes > maxBytes ? 'text-red-500' : 'text-emerald-600'}`}>{messageBytes}</span>/{maxBytes}byte
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
                  {/* ★ D103: 파일 업로드 시 전화번호 형태 컬럼만 동적 표시 */}
                  {/* ★ D106: 수신번호 컬럼은 회신번호로 사용 불가 → 제외 */}
                  {directFileHeaders.length > 0 && (() => {
                    const phoneHeaders = detectPhoneHeaders(directFileHeaders, directFileData)
                      .filter(h => h !== directColumnMapping.phone);
                    return phoneHeaders.length > 0 ? (
                      <optgroup label="수신자별 회신번호 컬럼">
                        {phoneHeaders.map(h => {
                          const sample = directFileData[0]?.[h];
                          return (
                            <option key={h} value={`__col__${h}`}>
                              {h}{sample ? ` (예: ${String(sample).slice(0, 15)})` : ''} (수신자별)
                            </option>
                          );
                        })}
                      </optgroup>
                    ) : null;
                  })()}
                  <optgroup label="등록된 회신번호">
                    {callbackNumbers.map((cb) => (
                      <option key={cb.id} value={cb.phone}>
                        {formatPhoneNumber(cb.phone)} {cb.label ? `(${cb.label})` : ''} {cb.is_default ? '⭐' : ''}
                      </option>
                    ))}
                  </optgroup>
                </select>
                {useIndividualCallback && individualCallbackColumn && (
                  <p className="text-xs text-blue-600 mt-1">각 수신자의 <strong>{individualCallbackColumn}</strong> 값으로 발송됩니다</p>
                )}
              </div>

              {/* 자동입력 버튼 — 컨트롤타워(DIRECT_VAR_MAP) 기반 */}
              <div className="px-3 py-1.5 border-t bg-gray-50">
                <div className="flex items-center gap-3">
                  <span className="text-sm font-bold text-gray-700 whitespace-nowrap">자동입력</span>
                  <div className="flex gap-2 flex-1">
                    {DIRECT_VAR_MAP.map(v => (
                      <button
                        key={v.fieldKey}
                        onClick={() => setDirectMessage(prev => prev + v.variable)}
                        className={`flex-1 py-2 text-sm bg-white border rounded-lg font-medium ${v.fieldKey === 'callback' ? 'hover:bg-blue-50 text-blue-700' : 'hover:bg-gray-100'}`}
                      >{v.label}</button>
                    ))}
                  </div>
                </div>
              </div>

              {/* 미리보기 + 스팸필터 버튼 */}
              <div className="px-3 py-1.5 border-t">
                <div className="grid grid-cols-2 gap-2">
                  <button
                    onClick={() => {
                      if (!directMessage.trim()) {
                        setToast({ show: true, type: 'error', message: '메시지를 입력해주세요' });
                        return;
                      }
                      setShowDirectPreview(true);
                    }}
                    className="py-2.5 bg-emerald-500 hover:bg-emerald-600 text-white rounded-lg text-sm font-medium transition-colors"
                  >
                    📄 미리보기
                  </button>
                  <button
                    onClick={handleSpamFilter}
                    className={`py-2.5 bg-gray-200 hover:bg-gray-300 text-gray-700 rounded-lg text-sm font-medium transition-colors ${isSpamFilterLocked ? 'opacity-60' : ''}`}
                  >
                    {isSpamFilterLocked ? '🔒' : '🛡️'} 스팸필터테스트
                  </button>
                </div>
              </div>

              {/* 예약/분할/광고 옵션 */}
              <div className="px-3 py-2 border-t">
                <div className="grid grid-cols-3 gap-2 text-xs">
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
                  <div className={`rounded-lg p-3 text-center ${adTextEnabled ? 'bg-orange-50' : 'bg-gray-50'}`}>
                    <label className="flex items-center justify-center gap-1.5 cursor-pointer">
                      <input type="checkbox" checked={adTextEnabled} onChange={(e) => handleAdToggle(e.target.checked)} className="rounded w-4 h-4" />
                      <span className={`font-medium ${adTextEnabled ? 'text-orange-700' : ''}`}>광고표기</span>
                    </label>
                    <div className={`mt-1.5 text-xs ${adTextEnabled ? 'text-orange-500' : 'text-gray-400'}`}>080 수신거부</div>
                  </div>
                </div>
              </div>

              {/* 전송하기 버튼 */}
              <div className="px-3 py-2 border-t">
                <button
                  onClick={handleSendClick}
                  className="w-full py-3 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-bold text-base transition-colors"
                >
                  전송하기
                </button>
              </div>
            </div>
            </>)}

            {/* === RCS 채널 === */}
            {directSendChannel === 'rcs' && (
              <div className="border-2 border-purple-200 rounded-2xl overflow-hidden bg-white shadow-sm">
                <div className="p-4">
                  <div className="flex items-center gap-2 mb-3">
                    <span className="text-lg">📱</span>
                    <span className="text-sm font-semibold text-purple-800">RCS (템플릿 기반)</span>
                  </div>
                  {rcsTemplates.length === 0 ? (
                    <div className="text-center py-12">
                      <div className="text-4xl mb-3">📱</div>
                      <p className="text-sm text-gray-500 font-medium">등록된 RCS 템플릿이 없습니다</p>
                      <p className="text-xs text-gray-400 mt-1">카카오&RCS → RCS 템플릿에서 등록해주세요</p>
                    </div>
                  ) : (
                    <div className="space-y-2 max-h-[300px] overflow-y-auto">
                      {rcsTemplates.map((t: any) => (
                        <div key={t.id} onClick={() => setRcsSelectedTemplate(t)}
                          className={`p-3 border rounded-lg cursor-pointer transition-colors ${rcsSelectedTemplate?.id === t.id ? 'border-purple-500 bg-purple-50' : 'border-gray-200 hover:border-purple-300'}`}
                        >
                          <div className="flex items-center justify-between">
                            <span className="text-sm font-medium">{t.template_name}</span>
                            <span className="text-xs px-2 py-0.5 rounded-full bg-purple-100 text-purple-700">{t.message_type}</span>
                          </div>
                          <p className="text-xs text-gray-500 mt-1 line-clamp-2">{t.content}</p>
                        </div>
                      ))}
                    </div>
                  )}
                  <div className="text-xs text-gray-400 mt-2">RCS 미지원 단말은 SMS/LMS로 자동 폴백됩니다</div>
                </div>
                <div className="px-3 py-2 border-t">
                  <button
                    onClick={() => setToast({ show: true, type: 'error', message: 'RCS 발송 기능은 곧 오픈 예정입니다' })}
                    disabled={!rcsSelectedTemplate}
                    className={`w-full py-3 rounded-xl font-bold text-base transition-colors ${rcsSelectedTemplate ? 'bg-purple-500 hover:bg-purple-600 text-white' : 'bg-gray-300 text-gray-500 cursor-not-allowed'}`}
                  >
                    {!rcsSelectedTemplate ? '템플릿을 선택해주세요' : '📱 RCS 전송하기'}
                  </button>
                  <p className="text-xs text-center text-purple-400 mt-1.5">RCS 발송 기능은 곧 오픈 예정입니다</p>
                </div>
              </div>
            )}

            {/* === 카카오 알림톡 채널 === */}
            {directSendChannel === 'kakao_alimtalk' && (
              <div className="border-2 border-blue-200 rounded-2xl overflow-hidden bg-white shadow-sm">
                <div className="p-4">
                  <div className="flex items-center gap-2 mb-3">
                    <span className="text-lg">🔔</span>
                    <span className="text-sm font-semibold text-blue-800">알림톡 (템플릿 기반)</span>
                  </div>
                  {kakaoTemplates.length === 0 ? (
                    <div className="text-center py-12">
                      <div className="text-4xl mb-3">📋</div>
                      <p className="text-sm text-gray-500 font-medium">등록된 알림톡 템플릿이 없습니다</p>
                      <p className="text-xs text-gray-400 mt-1">카카오&RCS → 알림톡 템플릿에서 등록해주세요</p>
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
                          className={`p-3 border rounded-lg cursor-pointer transition-colors ${kakaoSelectedTemplate?.id === t.id ? 'border-blue-500 bg-blue-50' : 'border-gray-200 hover:border-blue-300'}`}
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
                  {kakaoSelectedTemplate && Object.keys(kakaoTemplateVars).length > 0 && (
                    <div className="mt-3 pt-3 border-t">
                      <p className="text-xs font-semibold text-gray-600 mb-2">변수 매핑</p>
                      {Object.keys(kakaoTemplateVars).map(varKey => (
                        <div key={varKey} className="flex items-center gap-2 mb-1.5">
                          <span className="text-xs text-blue-600 font-mono w-24 shrink-0">{varKey}</span>
                          <input type="text" value={kakaoTemplateVars[varKey]} onChange={(e) => setKakaoTemplateVars(prev => ({ ...prev, [varKey]: e.target.value }))} placeholder="값 입력" className="flex-1 border rounded px-2 py-1 text-xs" />
                        </div>
                      ))}
                    </div>
                  )}
                  {/* 대체발송 설정 */}
                  <div className="mt-3 pt-3 border-t">
                    <p className="text-xs font-semibold text-gray-600 mb-2">대체발송 설정</p>
                    <p className="text-xs text-gray-400 mb-2">알림톡 발송 실패 시 문자로 대체 발송합니다</p>
                    <div className="flex gap-1.5">
                      {([
                        { value: 'L' as const, label: 'LMS 대체', desc: '실패 시 LMS로 발송' },
                        { value: 'S' as const, label: 'SMS 대체', desc: '실패 시 SMS로 발송' },
                        { value: 'N' as const, label: '대체 안함', desc: '실패 시 발송하지 않음' },
                      ]).map(opt => (
                        <button key={opt.value} onClick={() => setAlimtalkFallback(opt.value)}
                          className={`flex-1 py-2 text-xs font-medium rounded-lg border transition-colors ${alimtalkFallback === opt.value ? 'bg-blue-50 border-blue-400 text-blue-700' : 'bg-white border-gray-200 text-gray-500 hover:border-blue-300'}`}
                        >{opt.label}</button>
                      ))}
                    </div>
                  </div>
                  {/* 미리보기 */}
                  {kakaoSelectedTemplate && (
                    <div className="mt-3 pt-3 border-t">
                      <p className="text-xs font-semibold text-gray-600 mb-2">미리보기</p>
                      <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-3 text-xs">
                        {kakaoSelectedTemplate.emphasize_type === 'TEXT' && kakaoSelectedTemplate.emphasize_title && (
                          <div className="font-bold text-sm text-gray-900 mb-2 pb-2 border-b border-yellow-200">
                            {(() => {
                              let title = kakaoSelectedTemplate.emphasize_title;
                              Object.entries(kakaoTemplateVars).forEach(([k, v]) => { title = title.replace(new RegExp(k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), v || k); });
                              return title;
                            })()}
                          </div>
                        )}
                        <div className="whitespace-pre-wrap text-gray-700 leading-relaxed">
                          {(() => {
                            let content = kakaoSelectedTemplate.content;
                            Object.entries(kakaoTemplateVars).forEach(([k, v]) => { content = content.replace(new RegExp(k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), v || k); });
                            return content;
                          })()}
                        </div>
                        {kakaoSelectedTemplate.buttons && kakaoSelectedTemplate.buttons.length > 0 && (
                          <div className="mt-3 pt-2 border-t border-yellow-200 space-y-1.5">
                            {kakaoSelectedTemplate.buttons.map((btn: any, i: number) => (
                              <div key={i} className="text-center py-1.5 bg-yellow-100 rounded-lg text-xs font-medium text-yellow-800">
                                {btn.name || btn.linkType}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
                <div className="px-3 py-2 border-t">
                  <button
                    onClick={handleAlimtalkSend}
                    disabled={!kakaoSelectedTemplate || kakaoSelectedTemplate?.status !== 'approved'}
                    className={`w-full py-3 rounded-xl font-bold text-base transition-colors ${kakaoSelectedTemplate?.status === 'approved' ? 'bg-blue-500 hover:bg-blue-600 text-white' : 'bg-gray-300 text-gray-500 cursor-not-allowed'}`}
                  >
                    {!kakaoSelectedTemplate ? '템플릿을 선택해주세요' : '🔔 알림톡 발송하기'}
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* 우측: 수신자 목록 */}
          <div className="flex-1 flex flex-col">
            {/* 입력 방식 탭 */}
            <div className="flex items-center gap-3 mb-4">
              <button onClick={() => setShowDirectInput(true)}
                className={`px-5 py-2.5 border-2 rounded-lg text-sm font-medium hover:bg-gray-50 ${directInputMode === 'direct' ? 'bg-emerald-50 border-emerald-400 text-emerald-700' : ''}`}
              >✏️ 직접입력</button>
              <label className={`px-5 py-2.5 border-2 rounded-lg text-sm font-medium cursor-pointer hover:bg-gray-50 ${directInputMode === 'file' ? 'bg-amber-50 border-amber-400 text-amber-700' : ''} ${directFileLoading ? 'opacity-50 cursor-wait' : ''}`}>
                {directFileLoading ? '⏳ 파일 분석중...' : '📁 파일등록'}
                <input type="file" accept=".xlsx,.xls,.csv" className="hidden"
                  onChange={(e) => { const file = e.target.files?.[0]; if (file) handleFileUpload(file); e.target.value = ''; }}
                />
              </label>
              <button
                onClick={async () => {
                  const token = localStorage.getItem('token');
                  const res = await fetch('/api/address-books/groups', { headers: { Authorization: `Bearer ${token}` } });
                  const data = await res.json();
                  if (data.success) setAddressGroups(data.groups || []);
                  setShowAddressBook(true);
                }}
                className={`px-5 py-2.5 border-2 rounded-lg text-sm font-medium hover:bg-gray-50 ${directInputMode === 'address' ? 'bg-emerald-50 border-emerald-400 text-emerald-700' : ''}`}
              >📒 주소록</button>
              <label className="flex items-center gap-2 text-sm cursor-pointer ml-2">
                <input type="checkbox" checked={dedupEnabled} onChange={e => setDedupEnabled(e.target.checked)} className="rounded w-4 h-4 accent-emerald-600" />
                <span className="font-medium">중복제거</span>
              </label>
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <input type="checkbox" checked={unsubFilterEnabled} onChange={e => setUnsubFilterEnabled(e.target.checked)} className="rounded w-4 h-4 accent-emerald-600" />
                <span className="font-medium">수신거부제거</span>
              </label>
              <div className="flex-1"></div>
              <button onClick={onClose}
                className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-sm font-medium flex items-center gap-1"
              >
                <span>✕</span> 창닫기
              </button>
            </div>

            {/* 수신자 테이블 */}
            <div className="border-2 rounded-xl overflow-hidden flex-1 flex flex-col">
              <div className="bg-gray-50 px-4 py-3 flex justify-between items-center border-b">
                <span className="text-sm font-medium">
                  총 <span className="text-emerald-600 font-bold text-lg">{directRecipients.length.toLocaleString()}</span> 건
                  {directRecipients.length > 10 && !directSearchQuery && (
                    <span className="text-gray-400 text-xs ml-2">(상위 10개 표시)</span>
                  )}
                </span>
                <input type="text" placeholder="🔍 수신번호 검색" value={directSearchQuery} onChange={(e) => setDirectSearchQuery(e.target.value)} className="border rounded-lg px-3 py-2 text-sm w-52" />
              </div>
              <div className="flex-1 overflow-y-auto">
                <table className="w-full">
                  {(() => {
                    const activeFields = directRecipients.length > 0
                      ? (['name', 'callback', 'extra1', 'extra2', 'extra3'] as const).filter(f => directRecipients.some(r => r[f] && String(r[f]).trim()))
                      : (directSendChannel === 'sms'
                        ? (['name', 'callback', 'extra1', 'extra2', 'extra3'] as const).filter(f => directColumnMapping[f])
                        : []);
                    const colCount = 2 + activeFields.length;
                    return (<>
                      <thead className="bg-gray-50 border-b sticky top-0">
                        <tr>
                          <th className="px-4 py-3 text-left text-xs font-bold text-gray-600 w-10">
                            <input type="checkbox" className="rounded w-4 h-4"
                              checked={directRecipients.length > 0 && selectedRecipients.size === directRecipients.length}
                              onChange={(e) => { if (e.target.checked) setSelectedRecipients(new Set(directRecipients.map((_, i) => i))); else setSelectedRecipients(new Set()); }}
                            />
                          </th>
                          <th className="px-4 py-3 text-left text-xs font-bold text-gray-600">수신번호</th>
                          {activeFields.map(f => (
                            <th key={f} className="px-4 py-3 text-left text-xs font-bold text-gray-600">{DIRECT_FIELD_LABELS[f] || f}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y">
                        {directRecipients.length === 0 ? (
                          <tr><td colSpan={colCount} className="px-4 py-24 text-center text-gray-400">
                            <div className="text-4xl mb-2">📋</div>
                            <div className="text-sm">파일을 업로드하거나 직접 입력해주세요</div>
                          </td></tr>
                        ) : (
                          directRecipients
                            .map((r, idx) => ({ ...r, originalIdx: idx }))
                            .filter(r => !directSearchQuery || String(r.phone || '').includes(directSearchQuery))
                            .slice(0, directSearchQuery ? 100 : 10)
                            .map((r) => (
                              <tr key={r.originalIdx} className="hover:bg-gray-50">
                                <td className="px-4 py-3">
                                  <input type="checkbox" className="rounded w-4 h-4"
                                    checked={selectedRecipients.has(r.originalIdx)}
                                    onChange={(e) => { const s = new Set(selectedRecipients); if (e.target.checked) s.add(r.originalIdx); else s.delete(r.originalIdx); setSelectedRecipients(s); }}
                                  />
                                </td>
                                <td className="px-4 py-3 text-sm">{formatPhoneNumber(r.phone)}</td>
                                {activeFields.map(f => (
                                  <td key={f} className={`px-4 py-3 text-sm ${f === 'callback' ? 'font-mono text-xs text-gray-600' : ''}`}>{f === 'callback' && r[f] ? formatPhoneNumber(r[f]) : (r[f] || '-')}</td>
                                ))}
                              </tr>
                            ))
                        )}
                      </tbody>
                    </>);
                  })()}
                </table>
              </div>
            </div>

            {/* 하단 버튼 */}
            <div className="flex gap-3 mt-4">
              <button onClick={() => {
                if (selectedRecipients.size === 0) { setToast({ show: true, type: 'error', message: '선택된 항목이 없습니다' }); return; }
                setDirectRecipients(prev => prev.filter((_, idx) => !selectedRecipients.has(idx)));
                setSelectedRecipients(new Set());
              }} className="px-5 py-3 border-2 rounded-xl text-sm font-medium hover:bg-gray-50">선택삭제</button>
              <button onClick={() => {
                if (directRecipients.length === 0) return;
                setDirectRecipients([]);
                setSelectedRecipients(new Set());
              }} className="px-5 py-3 border-2 rounded-xl text-sm font-medium hover:bg-gray-50">전체삭제</button>
              <div className="flex-1"></div>
              <button onClick={() => {
                setDirectRecipients([]);
                setDirectMessage('');
                setDirectSubject('');
                setMmsUploadedImages([]);
                setSelectedRecipients(new Set());
                setSelectedCallback('');
              }} className="px-5 py-3 border-2 rounded-xl text-sm font-medium hover:bg-gray-50">🔄 초기화</button>
            </div>
          </div>
        </div>

        {/* 파일 매핑 모달 */}
        {directShowMapping && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[60]">
            <div className="bg-white rounded-2xl shadow-2xl w-[650px] max-h-[80vh] overflow-y-auto">
              <div className="px-5 py-3 border-b bg-blue-50 flex justify-between items-center">
                <div>
                  <h3 className="font-bold text-sm">📁 컬럼 매핑</h3>
                  <p className="text-xs text-gray-500 mt-0.5">수신번호 필수, 나머지는 사용할 항목만 선택</p>
                </div>
                <button onClick={() => setDirectShowMapping(false)} className="text-gray-500 hover:text-gray-700">✕</button>
              </div>
              <div className="px-5 py-4">
                {/* 수신번호 필수 */}
                <div className="flex items-center gap-3 p-3 bg-red-50 rounded-lg border border-red-200 mb-3">
                  <span className="text-xs font-bold text-red-700 w-20 shrink-0">📱 수신번호 *</span>
                  <span className="text-gray-400 text-xs">→</span>
                  <select className="flex-1 border border-red-300 rounded px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-red-400 min-w-0"
                    value={directColumnMapping.phone || ''} onChange={(e) => setDirectColumnMapping({ ...directColumnMapping, phone: e.target.value })}>
                    <option value="">-- 선택 --</option>
                    {directFileHeaders.map((h, i) => {
                      const sample = directFileData[0]?.[h];
                      return <option key={i} value={h}>{h}{sample ? ` (예: ${String(sample).slice(0, 15)})` : ''}</option>;
                    })}
                  </select>
                </div>
                {/* SMS 필드 매핑 — 컨트롤타워(DIRECT_MAPPING_FIELDS) 기반 */}
                {directSendChannel === 'sms' && (
                  <div className="grid grid-cols-2 gap-2">
                    {DIRECT_MAPPING_FIELDS.map(field => (
                      <div key={field.key} className="flex items-center gap-2 p-2 bg-gray-50 rounded-lg min-w-0">
                        <span className="text-xs font-medium text-gray-600 w-14 shrink-0">{field.label}</span>
                        <select className="flex-1 border rounded px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-emerald-400 min-w-0"
                          value={(directColumnMapping as any)[field.key] || ''} onChange={(e) => setDirectColumnMapping({ ...directColumnMapping, [field.key]: e.target.value })}>
                          <option value="">-- 선택 --</option>
                          {directFileHeaders.map((h, i) => {
                            const sample = directFileData[0]?.[h];
                            return <option key={i} value={h}>{h}{sample ? ` (예: ${String(sample).slice(0, 15)})` : ''}</option>;
                          })}
                        </select>
                      </div>
                    ))}
                  </div>
                )}
                {/* 알림톡 템플릿 변수 매핑 */}
                {directSendChannel === 'kakao_alimtalk' && kakaoSelectedTemplate && (
                  <div>
                    <p className="text-xs font-medium text-blue-700 mb-2">🔔 템플릿 변수 매핑</p>
                    <div className="grid grid-cols-2 gap-2">
                      {(kakaoSelectedTemplate.content?.match(/#{[^}]+}/g) || []).map((varName: string, i: number) => {
                        const varKey = `tplvar_${i}`;
                        return (
                          <div key={varKey} className="flex items-center gap-2 p-2 bg-blue-50 rounded-lg min-w-0">
                            <span className="text-xs font-medium text-blue-700 w-20 shrink-0 truncate">{varName}</span>
                            <select className="flex-1 border border-blue-200 rounded px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-blue-400 min-w-0"
                              value={(directColumnMapping as any)[varKey] || ''} onChange={(e) => setDirectColumnMapping({ ...directColumnMapping, [varKey]: e.target.value })}>
                              <option value="">-- 선택 --</option>
                              {directFileHeaders.map((h, hi) => {
                                const sample = directFileData[0]?.[h];
                                return <option key={hi} value={h}>{h}{sample ? ` (예: ${String(sample).slice(0, 15)})` : ''}</option>;
                              })}
                            </select>
                          </div>
                        );
                      })}
                    </div>
                    {!kakaoSelectedTemplate.content?.match(/#{[^}]+}/g) && (
                      <p className="text-xs text-gray-400 py-2">템플릿에 변수가 없습니다 (수신번호만 매핑)</p>
                    )}
                  </div>
                )}
                {directSendChannel === 'kakao_alimtalk' && !kakaoSelectedTemplate && (
                  <div className="p-3 bg-yellow-50 rounded-lg border border-yellow-200">
                    <p className="text-xs text-yellow-700">⚠️ 먼저 알림톡 템플릿을 선택해주세요.</p>
                  </div>
                )}
                {directSendChannel === 'rcs' && (
                  <p className="text-xs text-gray-400 py-2">RCS는 수신번호만 매핑하면 됩니다.</p>
                )}
                {/* 매핑 요약 */}
                {Object.values(directColumnMapping).some(v => v) && (
                  <div className="mt-3 flex flex-wrap gap-1">
                    {Object.entries(directColumnMapping).filter(([, v]) => v).map(([k, v]) => {
                      const labels: Record<string, string> = { phone: '수신번호', ...DIRECT_FIELD_LABELS };
                      let label = labels[k] || k;
                      if (k.startsWith('tplvar_') && kakaoSelectedTemplate) {
                        const vars = kakaoSelectedTemplate.content?.match(/#{[^}]+}/g) || [];
                        const idx = parseInt(k.replace('tplvar_', ''));
                        label = vars[idx] || k;
                      }
                      return (
                        <span key={k} className="text-xs bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded-full">{label} → {v}</span>
                      );
                    })}
                  </div>
                )}
              </div>
              <div className="px-5 py-3 border-t bg-gray-50 flex justify-between items-center">
                <span className="text-xs text-gray-600">총 <strong>{directFileData.length.toLocaleString()}</strong>건</span>
                <div className="flex gap-2">
                  <button onClick={() => setDirectShowMapping(false)} className="px-4 py-2 border rounded-lg text-xs font-medium hover:bg-gray-100">취소</button>
                  <button onClick={handleMappingApply} disabled={!directColumnMapping.phone || directMappingLoading}
                    className="px-6 py-2 bg-emerald-500 hover:bg-emerald-600 text-white rounded-lg text-xs font-bold disabled:opacity-50"
                  >{directMappingLoading ? `처리중... ${directLoadingProgress}%` : '등록하기'}</button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* 직접입력 모달 — 메시지 변수 기반 동적 입력폼 */}
        {showDirectInput && (() => {
          const usedVars = directSendChannel === 'sms'
            ? DIRECT_VAR_MAP.filter(v => directMessage.includes(v.variable)).map(v => v.fieldKey)
            : [];
          return (
            <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[60]">
              <div className="bg-white rounded-2xl shadow-2xl w-[550px] overflow-hidden">
                <div className="px-5 py-3 border-b bg-blue-50 flex justify-between items-center">
                  <div>
                    <h3 className="font-bold text-sm">✏️ 직접입력</h3>
                    <p className="text-xs text-gray-500 mt-0.5">
                      {usedVars.length > 0
                        ? `메시지에 사용된 변수: ${usedVars.map(f => DIRECT_FIELD_LABELS[f] || f).join(', ')}`
                        : '수신번호를 입력해주세요 (한 줄에 하나씩 또는 한 건씩 추가)'}
                    </p>
                  </div>
                  <button onClick={() => setShowDirectInput(false)} className="text-gray-500 hover:text-gray-700">✕</button>
                </div>
                <div className="p-5">
                  {usedVars.length === 0 ? (
                    <>
                      <div className="mb-2 text-xs text-gray-500">전화번호를 한 줄에 하나씩 입력</div>
                      <textarea value={directInputText} onChange={(e) => setDirectInputText(e.target.value)}
                        placeholder={'01012345678\n01087654321\n01011112222'}
                        className="w-full h-[200px] border rounded-lg p-3 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-emerald-500"
                      />
                    </>
                  ) : (
                    <>
                      <div className="flex gap-2 items-end mb-3">
                        <div className="flex-1">
                          <label className="block text-xs font-medium text-gray-600 mb-1">수신번호 *</label>
                          <input id="directInputPhone" type="text" placeholder="01012345678"
                            className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500" />
                        </div>
                        {usedVars.map(f => (
                          <div key={f} className="flex-1">
                            <label className="block text-xs font-medium text-gray-600 mb-1">{DIRECT_FIELD_LABELS[f]}</label>
                            <input id={`directInput_${f}`} type="text" placeholder={DIRECT_FIELD_LABELS[f]}
                              className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500" />
                          </div>
                        ))}
                        <button onClick={() => {
                          const phoneEl = document.getElementById('directInputPhone') as HTMLInputElement;
                          const phone = phoneEl?.value?.replace(/-/g, '').trim();
                          if (!phone || phone.length < 10) { setToast({ show: true, type: 'error', message: '유효한 수신번호를 입력해주세요' }); return; }
                          const entry: any = { phone, name: '', extra1: '', extra2: '', extra3: '', callback: '' };
                          usedVars.forEach(f => { const el = document.getElementById(`directInput_${f}`) as HTMLInputElement; entry[f] = el?.value || ''; });
                          setDirectRecipients(prev => [...prev, entry]);
                          phoneEl.value = '';
                          usedVars.forEach(f => { const el = document.getElementById(`directInput_${f}`) as HTMLInputElement; if (el) el.value = ''; });
                          phoneEl.focus();
                          setDirectInputMode('direct');
                        }} className="px-4 py-2 bg-emerald-500 hover:bg-emerald-600 text-white rounded-lg text-sm font-medium shrink-0">추가</button>
                      </div>
                      {directRecipients.length > 0 && (
                        <div className="text-xs text-emerald-600 font-medium">✅ {directRecipients.length}건 추가됨</div>
                      )}
                    </>
                  )}
                </div>
                <div className="px-5 py-3 border-t bg-gray-50 flex justify-end gap-2">
                  <button onClick={() => setShowDirectInput(false)} className="px-4 py-2 border rounded-lg text-xs font-medium hover:bg-gray-100">닫기</button>
                  {usedVars.length === 0 && (
                    <button onClick={() => {
                      const lines = directInputText.split('\n').map(l => l.trim()).filter(l => l);
                      const newRecipients = lines.map(phone => ({ phone: phone.replace(/-/g, ''), name: '', extra1: '', extra2: '', extra3: '', callback: '' }));
                      setDirectRecipients(prev => [...prev, ...newRecipients]);
                      setDirectInputText('');
                      setShowDirectInput(false);
                      setDirectInputMode('direct');
                    }} className="px-6 py-2 bg-emerald-500 hover:bg-emerald-600 text-white rounded-lg text-xs font-medium">등록</button>
                  )}
                </div>
              </div>
            </div>
          );
        })()}

      </div>
    </div>
  );
}
