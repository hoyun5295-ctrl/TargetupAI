/**
 * ★ D96: 직접발송 패널 — Dashboard.tsx에서 분리
 * ★ D137 (2026-04-24): 디자인 전면 리프트 (Claude Design 시안 기반)
 *
 *   - 좌측 520px: 메시지 에디터 (SMS/RCS/알림톡 채널 선택)
 *   - 우측: 수신자 목록 (직접입력/파일등록/주소록)
 *   - 기능/state/props/유틸 호출은 100% 기존 유지
 *   - 디자인 토큰: packages/frontend/src/styles/direct-send.css (ds-* 클래스)
 *
 * 컨트롤타워:
 *   - formatDate.ts: DIRECT_VAR_MAP, DIRECT_FIELD_LABELS, DIRECT_MAPPING_FIELDS,
 *                    replaceDirectVars, buildAdMessageFront, detectPhoneHeaders,
 *                    normalizePhoneKr, calculateSmsBytes, formatPreviewValue
 *   - textInsert.ts: insertAtCursorPos
 */

import { useState, useRef, useEffect } from 'react';
import {
  MessageSquare, Smartphone, Bell,
  SendHorizontal, Send,
  X, Search, Upload,
  PencilLine, FolderOpen, Contact,
  Asterisk, Archive, Save,
  Eye, ShieldCheck, Lock,
  CalendarClock, ChevronDown, Image as ImageIcon,
  Trash2, XCircle, RotateCcw, ChevronRight,
  Plus,
} from 'lucide-react';
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
  normalizePhoneKr,
} from '../utils/formatDate';
import { insertAtCursorPos } from '../utils/textInsert';
import MmsImagePreview from './shared/MmsImagePreview';
import AlimtalkChannelPanel, {
  type AlimtalkChannelState,
  type AlimtalkSenderProfile,
  type AlimtalkTemplate,
} from './alimtalk/AlimtalkChannelPanel';
import '../styles/direct-send.css';

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

  // 카카오 (알림톡 전용 — SMS/RCS는 건드리지 않음)
  kakaoTemplates: any[];
  kakaoSelectedTemplate: any;
  setKakaoSelectedTemplate: (t: any) => void;
  kakaoTemplateVars: Record<string, string>;
  setKakaoTemplateVars: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  alimtalkFallback: 'N' | 'S' | 'L' | 'A' | 'B';
  setAlimtalkFallback: (f: 'N' | 'S' | 'L' | 'A' | 'B') => void;
  kakaoMessage: string;
  setKakaoMessage: (m: string) => void;
  alimtalkSenders?: AlimtalkSenderProfile[];
  alimtalkProfileId?: string;
  setAlimtalkProfileId?: (id: string) => void;
  alimtalkNextContents?: string;
  setAlimtalkNextContents?: (v: string) => void;
  customerFieldOptions?: { key: string; label: string }[];

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
    setKakaoMessage,
    alimtalkSenders = [],
    alimtalkProfileId = '',
    setAlimtalkProfileId,
    alimtalkNextContents = '',
    setAlimtalkNextContents,
    customerFieldOptions = [],
    rcsTemplates, rcsSelectedTemplate, setRcsSelectedTemplate,
    setShowDirectPreview, setShowSpecialChars, setShowTemplateBox,
    setShowTemplateSave, setTemplateSaveName, loadTemplates,
    setShowAddressBook, setAddressGroups,
    onSendConfirm, setToast,
    lmsKeepAccepted, smsOverrideAccepted,
    setPendingBytes, setShowLmsConfirm, setShowSmsConvert,
    getMaxByteMessage, formatPhoneNumber, formatRejectNumber,
    onClose,
  } = props;

  // ★ D120: 커서 위치 기반 변수 삽입용 ref
  const directTextareaRef = useRef<HTMLTextAreaElement>(null);
  const directCursorPosRef = useRef<number>(0);

  // ★ D137 UI: 변수 삽입 드롭다운 (발신번호 옆 병치)
  const [varMenuOpen, setVarMenuOpen] = useState(false);
  const varMenuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!varMenuOpen) return;
    const handler = (e: MouseEvent) => {
      if (varMenuRef.current && !varMenuRef.current.contains(e.target as Node)) {
        setVarMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [varMenuOpen]);

  // ============================================================
  // 내부 state
  // ============================================================
  // ★ D137 UI: 초기엔 아무것도 선택되지 않은 상태 (파일등록이 디폴트처럼 보이는 현상 제거)
  const [directInputMode, setDirectInputMode] = useState<'file' | 'direct' | 'address' | null>(null);
  const [directFileHeaders, setDirectFileHeaders] = useState<string[]>([]);
  const [directFilePreview, setDirectFilePreview] = useState<any[]>([]);
  const [directFileData, setDirectFileData] = useState<any[]>([]);
  const [directColumnMapping, setDirectColumnMapping] = useState<{ [key: string]: string }>({});
  const [directFileLoading, setDirectFileLoading] = useState(false);
  const [directMappingLoading, setDirectMappingLoading] = useState(false);
  const [directLoadingProgress, setDirectLoadingProgress] = useState(0);
  const [directShowMapping, setDirectShowMapping] = useState(false);
  const [showDirectInput, setShowDirectInput] = useState(false);
  const [dedupEnabled, setDedupEnabled] = useState(true);
  const [unsubFilterEnabled, setUnsubFilterEnabled] = useState(true);
  const [directInputText, setDirectInputText] = useState('');
  const [directSearchQuery, setDirectSearchQuery] = useState('');
  const [selectedRecipients, setSelectedRecipients] = useState<Set<number>>(new Set());
  // ★ D137 (0423 D3): 페이지네이션
  const [directPage, setDirectPage] = useState(0);

  // ============================================================
  // 헬퍼
  // ============================================================
  const calculateBytes = calculateSmsBytes;
  const getAdSuffix = () => {
    return directMsgType === 'SMS'
      ? `무료거부${optOutNumber.replace(/-/g, '')}`
      : `무료수신거부 ${formatRejectNumber(optOutNumber)}`;
  };

  // 바이트 진행도 — 0~1
  const byteRatio = Math.min(messageBytes / Math.max(1, maxBytes), 1);
  const byteState: 'ok' | 'warn' | 'danger' =
    byteRatio >= 1 ? 'danger' : byteRatio >= 0.8 ? 'warn' : byteRatio >= 0.5 ? 'warn' : 'ok';

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

    if (directMsgType === 'SMS' && messageBytes > 90 && !smsOverrideAccepted) {
      setPendingBytes(messageBytes);
      setShowLmsConfirm(true);
      return;
    }

    if (directMsgType !== 'SMS' && !lmsKeepAccepted && mmsUploadedImages.length === 0) {
      const smsMaxMsg = getMaxByteMessage(directMessage, directRecipients, DIRECT_VAR_TO_FIELD);
      const smsFullMsg = buildAdMessageFront(smsMaxMsg, 'SMS', adTextEnabled, optOutNumber);
      const smsBytes = calculateBytes(smsFullMsg);
      if (smsBytes <= 90) {
        setShowSmsConvert({ show: true, from: 'direct', currentBytes: messageBytes, smsBytes, count: directRecipients.length });
        return;
      }
    }

    const token = localStorage.getItem('token');
    const phones = directRecipients.map((r: any) => r.phone);
    const checkRes = await fetch('/api/unsubscribes/check', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ phones })
    });
    const checkData = await checkRes.json();
    const unsubCount = checkData.unsubscribeCount || 0;
    const dupCount = checkData.duplicateCount || 0;

    onSendConfirm({
      show: true,
      type: reserveEnabled ? 'scheduled' : 'immediate',
      count: directRecipients.length - (unsubFilterEnabled ? unsubCount : 0) - (dedupEnabled ? dupCount : 0),
      unsubscribeCount: unsubFilterEnabled ? unsubCount : 0,
      duplicateCount: dedupEnabled ? dupCount : 0,
      dateTime: reserveEnabled && reserveDateTime ? reserveDateTime : undefined,
      from: 'direct',
      msgType: directMsgType,
      dedupEnabled,
      unsubFilterEnabled,
    });
  };

  // 알림톡 전송
  const handleAlimtalkSend = async () => {
    if (directRecipients.length === 0) { setToast({ show: true, type: 'error', message: '수신자를 추가해주세요' }); return; }
    if (!kakaoSelectedTemplate) { setToast({ show: true, type: 'error', message: '템플릿을 선택해주세요' }); return; }
    if (!['approved', 'APPROVED', 'APR', 'A'].includes(kakaoSelectedTemplate.status)) { setToast({ show: true, type: 'error', message: '승인된 템플릿만 발송 가능합니다' }); return; }
    let finalContent = kakaoSelectedTemplate.content;
    Object.entries(kakaoTemplateVars).forEach(([k, v]) => { finalContent = finalContent.replace(new RegExp(k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), v); });
    setKakaoMessage(finalContent);
    const token = localStorage.getItem('token');
    const phones = directRecipients.map((r: any) => r.phone);
    const checkRes = await fetch('/api/unsubscribes/check', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ phones }) });
    const checkData = await checkRes.json();
    const unsubCount = checkData.unsubscribeCount || 0;
    const dupCount = checkData.duplicateCount || 0;
    onSendConfirm({ show: true, type: 'immediate', count: directRecipients.length - unsubCount - dupCount, unsubscribeCount: unsubCount, duplicateCount: dupCount, from: 'direct', msgType: '알림톡' });
  };

  // 스팸필터
  const handleSpamFilter = () => {
    if (isSpamFilterLocked) { setShowSpamFilterLock(true); return; }
    if (!directRecipients || directRecipients.length === 0) {
      setToast({ show: true, type: 'error', message: '발송리스트를 먼저 업로드해주세요.' });
      return;
    }
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
    setSpamFilterData({ sms: smsMsg, lms: lmsMsg, callback: cb, msgType: directMsgType, subject: directSubject || '', isAd: adTextEnabled, firstRecipient: firstR || undefined });
    setShowSpamFilter(true);
  };

  // 파일 업로드
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
        const phone = normalizePhoneKr(row[directColumnMapping.phone]);
        const entry: any = {
          phone,
          name: directColumnMapping.name ? (row[directColumnMapping.name] || '') : '',
          extra1: directColumnMapping.extra1 ? (row[directColumnMapping.extra1] || '') : '',
          extra2: directColumnMapping.extra2 ? (row[directColumnMapping.extra2] || '') : '',
          extra3: directColumnMapping.extra3 ? (row[directColumnMapping.extra3] || '') : '',
          callback: directColumnMapping.callback ? normalizePhoneKr(row[directColumnMapping.callback]) : '',
        };
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
  // 파생값
  // ============================================================
  const selectedCallbackValue = useIndividualCallback
    ? `__col__${individualCallbackColumn}`
    : selectedCallback;

  // ============================================================
  // JSX
  // ============================================================

  return (
    <div className="ds-scope ds-backdrop">
      <div className="ds-modal">

        {/* ============ 모달 헤더 ============ */}
        <header className="ds-modal__header">
          <div className="flex items-center gap-3">
            <div className="ds-head-icon">
              <SendHorizontal size={18} strokeWidth={1.75} />
            </div>
            <div>
              <div className="ds-head-title">직접발송</div>
              <div className="ds-head-sub">메시지를 작성하고 수신자에게 바로 전송합니다</div>
            </div>
          </div>

          <button className="ds-close-btn ds-t" onClick={onClose}>
            <X size={14} strokeWidth={1.75} />
            <span>창닫기</span>
          </button>
        </header>

        {/* ============ 2컬럼 body ============ */}
        <div className="ds-modal__body">

          {/* ====== 좌측: 메시지 에디터 ====== */}
          <section className="ds-section">

            {/* 채널 탭 */}
            <div className="ds-channel-group">
              {([
                { key: 'sms' as const, label: '문자', Icon: MessageSquare, on: 'ds-pill--on' },
                { key: 'rcs' as const, label: 'RCS', Icon: Smartphone, on: 'ds-pill--on-purple' },
                { key: 'kakao_alimtalk' as const, label: '알림톡', Icon: Bell, on: 'ds-pill--on-blue' },
              ]).map(({ key, label, Icon, on }) => (
                <button
                  key={key}
                  type="button"
                  className={`ds-pill ${directSendChannel === key ? on : ''}`}
                  onClick={() => {
                    setDirectSendChannel(key);
                    if (key === 'sms') setMmsUploadedImages([]);
                  }}
                >
                  <Icon size={15} strokeWidth={1.75} />
                  <span>{label}</span>
                </button>
              ))}
            </div>

            {/* === SMS 채널 === */}
            {directSendChannel === 'sms' && (
              <>
                {/* SMS/LMS/MMS 세그먼트 */}
                <div className="ds-seg">
                  {(['SMS', 'LMS', 'MMS'] as const).map(t => (
                    <button
                      key={t}
                      type="button"
                      className={directMsgType === t ? 'ds-seg--on' : ''}
                      onClick={() => {
                        setDirectMsgType(t);
                        if (t !== 'MMS') setMmsUploadedImages([]);
                      }}
                    >
                      {t}
                    </button>
                  ))}
                </div>

                {/* 제목 (LMS/MMS 전용) */}
                {(directMsgType === 'LMS' || directMsgType === 'MMS') && (
                  <div className="relative flex-shrink-0">
                    {adTextEnabled && (
                      <span className="ds-ad-tag absolute left-[10px] top-1/2 -translate-y-1/2 pointer-events-none">광고</span>
                    )}
                    <input
                      type="text"
                      value={directSubject}
                      onChange={(e) => setDirectSubject(e.target.value)}
                      placeholder="제목을 입력해주세요 (필수)"
                      className="ds-subject-in"
                      style={adTextEnabled ? { paddingLeft: 52 } : undefined}
                    />
                  </div>
                )}

                {/* 본문 에디터 */}
                <div className="ds-editor-wrap ds-t">
                  <div className="ds-editor-body">
                    {adTextEnabled && (
                      <span className="ds-ad-tag absolute left-0 top-0 z-10">광고</span>
                    )}
                    <textarea
                      ref={directTextareaRef}
                      data-char-target="direct"
                      value={directMessage}
                      onChange={(e) => { setDirectMessage(e.target.value); directCursorPosRef.current = e.target.selectionStart; }}
                      onSelect={(e) => { directCursorPosRef.current = (e.target as HTMLTextAreaElement).selectionStart; }}
                      placeholder="전송하실 내용을 입력하세요."
                      spellCheck={false}
                      style={adTextEnabled ? { textIndent: 42 } : undefined}
                    />
                  </div>

                  {/* 하단 고정 문구 (자동 부착) */}
                  {adTextEnabled && (
                    <div className="ds-editor-foot">
                      <span className="ds-lock-tag">
                        <Lock size={12} strokeWidth={1.75} />
                        자동 부착
                      </span>
                      <span className="ds-opt-out-num">{getAdSuffix()}</span>
                    </div>
                  )}

                  {/* MMS 이미지 박스 */}
                  {directMsgType === 'MMS' && (
                    <div className="ds-mms-box ds-t" onClick={() => setShowMmsUploadModal(true)}>
                      <span className="ds-mms-box__title">
                        <ImageIcon size={13} strokeWidth={1.75} />
                        MMS 이미지
                      </span>
                      {mmsUploadedImages.length > 0 ? (
                        <div className="flex items-center gap-2">
                          <MmsImagePreview images={mmsUploadedImages} size="xs" compact />
                          <span className="text-[11.5px] text-amber-700 font-medium">수정</span>
                        </div>
                      ) : (
                        <span className="ds-mms-box__hint">클릭하여 이미지 첨부 →</span>
                      )}
                    </div>
                  )}
                </div>

                {/* 에디터 툴바 (유틸 + 바이트) */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5">
                    <button type="button" className="ds-util ds-t" onClick={() => setShowSpecialChars('direct')}>
                      <Asterisk size={13} strokeWidth={1.75} />
                      <span>특수문자</span>
                    </button>
                    <button type="button" className="ds-util ds-t" onClick={() => { loadTemplates(); setShowTemplateBox('direct'); }}>
                      <Archive size={13} strokeWidth={1.75} />
                      <span>보관함</span>
                    </button>
                    <button type="button" className="ds-util ds-t" onClick={() => {
                      if (!directMessage.trim()) { setToast({ show: true, type: 'error', message: '저장할 메시지를 먼저 입력해주세요.' }); return; }
                      setTemplateSaveName(''); setShowTemplateSave('direct');
                    }}>
                      <Save size={13} strokeWidth={1.75} />
                      <span>문자저장</span>
                    </button>
                  </div>

                  <div className="flex items-center gap-2">
                    <div className={`ds-bytebar ${byteState === 'warn' ? 'ds-bytebar--warn' : byteState === 'danger' ? 'ds-bytebar--danger' : ''}`}>
                      <div style={{ width: `${byteRatio * 100}%` }} />
                    </div>
                    <span className={`ds-byte-text ${byteState === 'danger' ? 'ds-byte-text--danger' : ''}`}>
                      <span className="ds-byte-cur">{messageBytes}</span>
                      <span className="ds-byte-slash">/</span>
                      <span className="ds-byte-max">{maxBytes}</span>
                      <span className="ds-byte-unit">byte</span>
                    </span>
                  </div>
                </div>

                {/* 발신번호 — 라벨 인라인 */}
                <div className="ds-callback-row">
                  <span className="ds-callback-label">발신번호</span>
                  <select
                    className="ds-sel ds-num"
                    value={selectedCallbackValue}
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
                  >
                    <option value="">회신번호 선택</option>
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

                  {/* ★ D137 UI A안: 변수 삽입 드롭다운 (발신번호 옆 병치) */}
                  <div className="ds-var-wrap" ref={varMenuRef}>
                    <button
                      type="button"
                      className={`ds-var-trigger ds-t ${varMenuOpen ? 'ds-var-trigger--on' : ''}`}
                      onClick={() => setVarMenuOpen(o => !o)}
                    >
                      <Plus size={14} strokeWidth={2} />
                      <span>변수 삽입</span>
                      <ChevronDown size={13} strokeWidth={2} className={`ds-var-chev ${varMenuOpen ? 'ds-var-chev--open' : ''}`} />
                    </button>
                    {varMenuOpen && (
                      <div className="ds-var-menu" role="menu">
                        <div className="ds-var-menu__head">본문에 변수를 삽입합니다</div>
                        {DIRECT_VAR_MAP.map(v => (
                          <button
                            key={v.fieldKey}
                            type="button"
                            role="menuitem"
                            className={`ds-var-item ds-t ${v.fieldKey === 'callback' ? 'ds-var-item--callback' : ''}`}
                            onClick={() => {
                              insertAtCursorPos(
                                directCursorPosRef.current,
                                v.variable,
                                setDirectMessage,
                                directTextareaRef.current,
                                directCursorPosRef,
                              );
                              setVarMenuOpen(false);
                            }}
                          >
                            <span className="ds-var-item__label">{v.label}</span>
                            <span className="ds-var-item__code">{v.variable}</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
                {useIndividualCallback && individualCallbackColumn && (
                  <div className="ds-ind-callback-hint flex-shrink-0">
                    각 수신자의 <strong>{individualCallbackColumn}</strong> 값으로 발송됩니다
                  </div>
                )}

                {/* 보조 액션 (미리보기 / 스팸필터) */}
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    className="ds-btn-sec ds-btn-sec--primary ds-t"
                    onClick={() => {
                      if (!directMessage.trim()) { setToast({ show: true, type: 'error', message: '메시지를 입력해주세요' }); return; }
                      setShowDirectPreview(true);
                    }}
                  >
                    <Eye size={14} strokeWidth={1.75} />
                    <span>미리보기</span>
                  </button>
                  <button
                    type="button"
                    className={`ds-btn-sec ds-btn-sec--ghost ds-t ${isSpamFilterLocked ? 'opacity-60' : ''}`}
                    onClick={handleSpamFilter}
                  >
                    {isSpamFilterLocked ? <Lock size={14} strokeWidth={1.75} /> : <ShieldCheck size={14} strokeWidth={1.75} />}
                    <span>스팸필터테스트</span>
                  </button>
                </div>

                {/* 옵션 카드 3종 */}
                <div className="grid grid-cols-3 gap-2">
                  {/* 예약전송 */}
                  <label className={`ds-optcard ds-t ${reserveEnabled ? 'ds-optcard--on-blue' : ''}`}>
                    <div className="ds-optcard-top">
                      <input
                        type="checkbox"
                        className="ds-chk ds-chk--blue"
                        checked={reserveEnabled}
                        onChange={(e) => { setReserveEnabled(e.target.checked); if (e.target.checked) setShowReservePicker(true); }}
                      />
                      <span className="ds-optcard-title">예약전송</span>
                    </div>
                    <div
                      className="ds-optcard-sub"
                      style={reserveEnabled ? { color: '#1D4ED8', fontWeight: 500 } : undefined}
                      onClick={(e) => { e.preventDefault(); if (reserveEnabled) setShowReservePicker(true); }}
                    >
                      <CalendarClock size={12} strokeWidth={1.75} />
                      <span>
                        {reserveDateTime
                          ? new Date(reserveDateTime).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
                          : '예약시간 선택'}
                      </span>
                    </div>
                  </label>

                  {/* 분할전송 */}
                  <label className={`ds-optcard ds-t ${splitEnabled ? 'ds-optcard--on-purple' : ''}`}>
                    <div className="ds-optcard-top">
                      <input
                        type="checkbox"
                        className="ds-chk ds-chk--purple"
                        checked={splitEnabled}
                        onChange={(e) => setSplitEnabled(e.target.checked)}
                      />
                      <span className="ds-optcard-title">분할전송</span>
                    </div>
                    <div className="ds-optcard-sub" style={{ gap: 6 }}>
                      <input
                        type="number"
                        className="ds-num-in"
                        value={splitCount}
                        onChange={(e) => setSplitCount(Number(e.target.value) || 1000)}
                        disabled={!splitEnabled}
                      />
                      <span>건/분</span>
                    </div>
                  </label>

                  {/* 광고표기 */}
                  <label className={`ds-optcard ds-t ${adTextEnabled ? 'ds-optcard--on-amber' : ''}`}>
                    <div className="ds-optcard-top">
                      <input
                        type="checkbox"
                        className="ds-chk ds-chk--amber"
                        checked={adTextEnabled}
                        onChange={(e) => handleAdToggle(e.target.checked)}
                      />
                      <span className="ds-optcard-title">광고표기</span>
                    </div>
                    <div className="ds-optcard-sub">
                      {adTextEnabled && <span className="ds-ad-tag" style={{ height: 16, fontSize: 10, padding: '0 5px' }}>광고</span>}
                      <span style={adTextEnabled ? { color: 'var(--ds-amber-700)' } : undefined}>080 수신거부</span>
                    </div>
                  </label>
                </div>

                {/* 전송하기 */}
                <button type="button" className="ds-btn-primary ds-t" onClick={handleSendClick}>
                  <Send size={17} strokeWidth={2} />
                  <span>전송하기</span>
                </button>
              </>
            )}

            {/* === RCS 채널 === */}
            {directSendChannel === 'rcs' && (
              <>
                <div className="ds-channel-card ds-channel-card--purple">
                  <div className="flex items-center gap-2 mb-4">
                    <Smartphone size={16} strokeWidth={1.75} className="text-purple-700" />
                    <span className="text-[14px] font-semibold text-purple-900">RCS (템플릿 기반)</span>
                  </div>
                  {rcsTemplates.length === 0 ? (
                    <div className="text-center py-14">
                      <div className="inline-flex w-12 h-12 rounded-full bg-purple-100 items-center justify-center mb-3">
                        <Smartphone size={20} strokeWidth={1.75} className="text-purple-500" />
                      </div>
                      <p className="text-[13.5px] text-stone-600 font-medium">등록된 RCS 템플릿이 없습니다</p>
                      <p className="text-[12px] text-stone-400 mt-1">카카오&RCS → RCS 템플릿에서 등록해주세요</p>
                    </div>
                  ) : (
                    <div className="space-y-2 max-h-[320px] overflow-y-auto">
                      {rcsTemplates.map((t: any) => (
                        <div
                          key={t.id}
                          onClick={() => setRcsSelectedTemplate(t)}
                          className={`p-3 border rounded-[10px] cursor-pointer transition-colors ${rcsSelectedTemplate?.id === t.id ? 'border-purple-500 bg-purple-50' : 'border-stone-200 hover:border-purple-300 bg-white'}`}
                        >
                          <div className="flex items-center justify-between">
                            <span className="text-[13.5px] font-medium text-stone-800">{t.template_name}</span>
                            <span className="text-[11px] px-2 py-0.5 rounded-full bg-purple-100 text-purple-700 font-medium">{t.message_type}</span>
                          </div>
                          <p className="text-[12px] text-stone-500 mt-1 line-clamp-2">{t.content}</p>
                        </div>
                      ))}
                    </div>
                  )}
                  <div className="text-[11.5px] text-stone-400 mt-3">RCS 미지원 단말은 SMS/LMS로 자동 폴백됩니다</div>
                </div>

                <button
                  type="button"
                  className="ds-btn-primary ds-btn-primary--purple ds-t"
                  onClick={() => setToast({ show: true, type: 'error', message: 'RCS 발송 기능은 곧 오픈 예정입니다' })}
                  disabled={!rcsSelectedTemplate}
                >
                  <Send size={17} strokeWidth={2} />
                  <span>{!rcsSelectedTemplate ? '템플릿을 선택해주세요' : 'RCS 전송하기'}</span>
                </button>
                <p className="text-[11.5px] text-center text-purple-400 -mt-2">RCS 발송 기능은 곧 오픈 예정입니다</p>
              </>
            )}

            {/* === 알림톡 채널 === */}
            {directSendChannel === 'kakao_alimtalk' && (
              <>
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
                    const nextTpl = kakaoTemplates.find((t: any) => t.id === v.templateId) || null;
                    setKakaoSelectedTemplate(nextTpl);
                    setKakaoTemplateVars(v.variableMap);
                    setAlimtalkFallback(v.nextType);
                    if (setAlimtalkNextContents) setAlimtalkNextContents(v.nextContents);
                  }}
                />
                <button
                  type="button"
                  className="ds-btn-primary ds-btn-primary--blue ds-t"
                  onClick={handleAlimtalkSend}
                  disabled={!kakaoSelectedTemplate || !['approved', 'APPROVED', 'APR', 'A'].includes(kakaoSelectedTemplate?.status)}
                >
                  <Bell size={17} strokeWidth={2} />
                  <span>{!kakaoSelectedTemplate ? '템플릿을 선택해주세요' : '알림톡 발송하기'}</span>
                </button>
              </>
            )}
          </section>

          {/* 구분선 */}
          <div className="ds-modal__vdiv" />

          {/* ====== 우측: 수신자 관리 ====== */}
          <section className="flex flex-col gap-4 min-w-0">

            {/* 입력 방식 탭 + 필터 */}
            <div className="flex items-center justify-between gap-4 flex-wrap">
              <div className="ds-rtab-group">
                <button
                  type="button"
                  className={`ds-rtab ${directInputMode === 'direct' ? 'ds-rtab--on' : ''}`}
                  onClick={() => { setDirectInputMode('direct'); setShowDirectInput(true); }}
                >
                  <PencilLine size={17} strokeWidth={1.75} />
                  <span>직접입력</span>
                </button>

                <label className={`ds-rtab ds-rtab--label ${directInputMode === 'file' ? 'ds-rtab--on' : ''} ${directFileLoading ? 'ds-rtab--loading' : ''}`}>
                  <FolderOpen size={17} strokeWidth={1.75} />
                  <span>{directFileLoading ? '파일 분석중...' : '파일등록'}</span>
                  <input
                    type="file"
                    accept=".xlsx,.xls,.csv"
                    className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) handleFileUpload(file);
                      e.target.value = '';
                    }}
                  />
                </label>

                <button
                  type="button"
                  className={`ds-rtab ${directInputMode === 'address' ? 'ds-rtab--on' : ''}`}
                  onClick={async () => {
                    setDirectInputMode('address');
                    const token = localStorage.getItem('token');
                    const res = await fetch('/api/address-books/groups', { headers: { Authorization: `Bearer ${token}` } });
                    const data = await res.json();
                    if (data.success) setAddressGroups(data.groups || []);
                    setShowAddressBook(true);
                  }}
                >
                  <Contact size={17} strokeWidth={1.75} />
                  <span>주소록</span>
                </button>
              </div>

              <div className="ds-filter-row">
                <label>
                  <input
                    type="checkbox"
                    className="ds-chk"
                    checked={dedupEnabled}
                    onChange={e => setDedupEnabled(e.target.checked)}
                  />
                  <span>중복제거</span>
                </label>
                <label>
                  <input
                    type="checkbox"
                    className="ds-chk"
                    checked={unsubFilterEnabled}
                    onChange={e => setUnsubFilterEnabled(e.target.checked)}
                  />
                  <span>수신거부제거</span>
                </label>
              </div>
            </div>

            {/* 카운트 + 검색 */}
            <div className="flex items-center justify-between">
              <div className="ds-count-wrap">
                <span className="ds-count-label">총</span>
                <span className="ds-count-num">{directRecipients.length.toLocaleString()}</span>
                <span className="ds-count-label">건</span>
              </div>
              <div className="ds-search-wrap">
                <Search size={15} strokeWidth={1.75} />
                <input
                  type="text"
                  className="ds-search-in"
                  placeholder="수신번호 검색"
                  value={directSearchQuery}
                  onChange={(e) => { setDirectSearchQuery(e.target.value); setDirectPage(0); }}
                />
              </div>
            </div>

            {/* 리스트 프레임 */}
            <div className="ds-list-frame">
              {(() => {
                const activeFields = directRecipients.length > 0
                  ? (['name', 'callback', 'extra1', 'extra2', 'extra3'] as const).filter(f => directRecipients.some(r => r[f] && String(r[f]).trim()))
                  : (directSendChannel === 'sms'
                    ? (['name', 'callback', 'extra1', 'extra2', 'extra3'] as const).filter(f => directColumnMapping[f])
                    : []);

                const DIRECT_PAGE_SIZE = 10;
                const filtered = directRecipients
                  .map((r, idx) => ({ ...r, originalIdx: idx }))
                  .filter(r => !directSearchQuery || String(r.phone || '').includes(directSearchQuery));
                const totalPages = Math.max(1, Math.ceil(filtered.length / DIRECT_PAGE_SIZE));
                const currentPage = Math.min(directPage, Math.max(0, totalPages - 1));
                const pageItems = filtered.slice(currentPage * DIRECT_PAGE_SIZE, (currentPage + 1) * DIRECT_PAGE_SIZE);

                return (
                  <>
                    {/* 헤더 */}
                    <div className="ds-list-head">
                      <label className="flex items-center cursor-pointer">
                        <input
                          type="checkbox"
                          className="ds-chk ds-chk--lg"
                          checked={directRecipients.length > 0 && selectedRecipients.size === directRecipients.length}
                          onChange={(e) => {
                            if (e.target.checked) setSelectedRecipients(new Set(directRecipients.map((_, i) => i)));
                            else setSelectedRecipients(new Set());
                          }}
                        />
                      </label>
                      <span>수신번호</span>
                      {activeFields.length > 0 && (
                        <span className="text-stone-500 text-[11.5px] font-medium">
                          {activeFields.map(f => DIRECT_FIELD_LABELS[f] || f).join(' · ')}
                        </span>
                      )}
                    </div>

                    {/* 바디 */}
                    {directRecipients.length === 0 ? (
                      <div className="ds-list-empty">
                        <div className="ds-dropzone ds-t w-full" onClick={() => {
                          const input = document.querySelector<HTMLInputElement>('.ds-rtab--label input[type="file"]');
                          input?.click();
                        }}>
                          <svg width="76" height="76" viewBox="0 0 76 76" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                            <rect x="20" y="14" width="40" height="50" rx="6" fill="#FFFFFF" stroke="#D6D3D1" strokeWidth="1.5" />
                            <rect x="30" y="8" width="20" height="10" rx="3" fill="#ECFDF5" stroke="#10B981" strokeWidth="1.5" />
                            <rect x="28" y="28" width="24" height="2.5" rx="1.25" fill="#E7E5E4" />
                            <rect x="28" y="36" width="18" height="2.5" rx="1.25" fill="#E7E5E4" />
                            <rect x="28" y="44" width="22" height="2.5" rx="1.25" fill="#E7E5E4" />
                            <circle cx="52" cy="54" r="8" fill="#10B981" />
                            <path d="M48.5 54 L51 56.5 L55.5 51.5" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" fill="none" />
                          </svg>
                          <div>
                            <div className="text-[14px] font-semibold text-stone-800">파일을 업로드하거나 직접 입력해주세요</div>
                            <div className="text-[12.5px] text-stone-500 mt-1">CSV · XLSX · XLS 형식을 지원합니다</div>
                          </div>
                          <div className="flex items-center gap-2 mt-1">
                            <span className="ds-btn-sec ds-btn-sec--primary px-4 pointer-events-none">
                              <Upload size={14} strokeWidth={1.75} />
                              <span>파일 선택</span>
                            </span>
                            <span className="text-[12px] text-stone-400">또는 여기로 드래그</span>
                          </div>
                        </div>
                      </div>
                    ) : (
                      <>
                        <div className="ds-list-body">
                          {pageItems.length === 0 ? (
                            <div className="py-12 text-center text-stone-400 text-[13px]">
                              {directSearchQuery ? `"${directSearchQuery}" 검색 결과가 없습니다` : '데이터가 없습니다'}
                            </div>
                          ) : (
                            pageItems.map((r) => (
                              <div key={r.originalIdx} className="ds-list-row">
                                <label className="flex items-center cursor-pointer">
                                  <input
                                    type="checkbox"
                                    className="ds-chk"
                                    checked={selectedRecipients.has(r.originalIdx)}
                                    onChange={(e) => {
                                      const s = new Set(selectedRecipients);
                                      if (e.target.checked) s.add(r.originalIdx);
                                      else s.delete(r.originalIdx);
                                      setSelectedRecipients(s);
                                    }}
                                  />
                                </label>
                                <span className="ds-num text-stone-800 font-medium">{formatPhoneNumber(r.phone)}</span>
                                <span className="ds-cell-extra">
                                  {activeFields.map(f => {
                                    if (!r[f]) return null;
                                    const v = f === 'callback' ? formatPhoneNumber(r[f]) : String(r[f]);
                                    return (
                                      <span key={f} className={f === 'callback' ? 'ds-cell-callback' : ''}>
                                        <span className="text-stone-400 text-[11px] mr-1">{DIRECT_FIELD_LABELS[f] || f}</span>
                                        <span className="val">{v}</span>
                                      </span>
                                    );
                                  })}
                                </span>
                              </div>
                            ))
                          )}
                        </div>

                        {/* 페이지네이션 */}
                        {totalPages > 1 && (
                          <div className="ds-page">
                            <button
                              onClick={() => setDirectPage((p) => Math.max(0, p - 1))}
                              disabled={currentPage === 0}
                            >
                              이전
                            </button>
                            <span className="ds-page-num">{currentPage + 1} / {totalPages}</span>
                            <button
                              onClick={() => setDirectPage((p) => Math.min(totalPages - 1, p + 1))}
                              disabled={currentPage >= totalPages - 1}
                            >
                              다음
                            </button>
                          </div>
                        )}
                      </>
                    )}
                  </>
                );
              })()}
            </div>

            {/* 하단 액션 */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1">
                <button type="button" className="ds-ter ds-ter--danger ds-t" onClick={() => {
                  if (selectedRecipients.size === 0) { setToast({ show: true, type: 'error', message: '선택된 항목이 없습니다' }); return; }
                  setDirectRecipients(prev => prev.filter((_, idx) => !selectedRecipients.has(idx)));
                  setSelectedRecipients(new Set());
                }}>
                  <Trash2 size={13} strokeWidth={1.75} />
                  <span>선택삭제</span>
                </button>
                <button type="button" className="ds-ter ds-ter--danger ds-t" onClick={() => {
                  if (directRecipients.length === 0) return;
                  setDirectRecipients([]);
                  setSelectedRecipients(new Set());
                }}>
                  <XCircle size={13} strokeWidth={1.75} />
                  <span>전체삭제</span>
                </button>
              </div>
              <button type="button" className="ds-ter ds-t" onClick={() => {
                setDirectRecipients([]);
                setDirectMessage('');
                setDirectSubject('');
                setMmsUploadedImages([]);
                setSelectedRecipients(new Set());
                setSelectedCallback('');
              }}>
                <RotateCcw size={13} strokeWidth={1.75} />
                <span>초기화</span>
              </button>
            </div>
          </section>
        </div>

        {/* ============ 파일 매핑 모달 ============ */}
        {directShowMapping && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[60]">
            <div className="bg-white rounded-2xl shadow-2xl w-[650px] max-h-[80vh] overflow-y-auto">
              <div className="px-5 py-3 border-b bg-emerald-50 flex justify-between items-center">
                <div>
                  <h3 className="font-semibold text-[14px] text-emerald-900 flex items-center gap-2">
                    <FolderOpen size={14} strokeWidth={1.75} />
                    컬럼 매핑
                  </h3>
                  <p className="text-[11.5px] text-emerald-700/80 mt-0.5">수신번호 필수, 나머지는 사용할 항목만 선택</p>
                </div>
                <button onClick={() => setDirectShowMapping(false)} className="text-stone-500 hover:text-stone-700">
                  <X size={16} strokeWidth={1.75} />
                </button>
              </div>
              <div className="px-5 py-4">
                {/* 수신번호 필수 */}
                <div className="flex items-center gap-3 p-3 bg-red-50 rounded-lg border border-red-200 mb-3">
                  <span className="text-xs font-bold text-red-700 w-20 shrink-0">수신번호 *</span>
                  <ChevronRight size={14} strokeWidth={1.75} className="text-stone-400" />
                  <select className="flex-1 border border-red-300 rounded px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-red-400 min-w-0"
                    value={directColumnMapping.phone || ''} onChange={(e) => setDirectColumnMapping({ ...directColumnMapping, phone: e.target.value })}>
                    <option value="">-- 선택 --</option>
                    {directFileHeaders.map((h, i) => {
                      const sample = directFileData[0]?.[h];
                      return <option key={i} value={h}>{h}{sample ? ` (예: ${String(sample).slice(0, 15)})` : ''}</option>;
                    })}
                  </select>
                </div>
                {directSendChannel === 'sms' && (
                  <div className="grid grid-cols-2 gap-2">
                    {DIRECT_MAPPING_FIELDS.map(field => (
                      <div key={field.key} className="flex items-center gap-2 p-2 bg-stone-50 rounded-lg min-w-0">
                        <span className="text-xs font-medium text-stone-600 w-14 shrink-0">{field.label}</span>
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
                {directSendChannel === 'kakao_alimtalk' && kakaoSelectedTemplate && (
                  <div>
                    <p className="text-xs font-medium text-blue-700 mb-2">템플릿 변수 매핑</p>
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
                      <p className="text-xs text-stone-400 py-2">템플릿에 변수가 없습니다 (수신번호만 매핑)</p>
                    )}
                  </div>
                )}
                {directSendChannel === 'kakao_alimtalk' && !kakaoSelectedTemplate && (
                  <div className="p-3 bg-amber-50 rounded-lg border border-amber-200">
                    <p className="text-xs text-amber-700">먼저 알림톡 템플릿을 선택해주세요.</p>
                  </div>
                )}
                {directSendChannel === 'rcs' && (
                  <p className="text-xs text-stone-400 py-2">RCS는 수신번호만 매핑하면 됩니다.</p>
                )}
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
              <div className="px-5 py-3 border-t bg-stone-50 flex justify-between items-center">
                <span className="text-xs text-stone-600">총 <strong>{directFileData.length.toLocaleString()}</strong>건</span>
                <div className="flex gap-2">
                  <button onClick={() => setDirectShowMapping(false)} className="px-4 py-2 border rounded-lg text-xs font-medium hover:bg-stone-100">취소</button>
                  <button onClick={handleMappingApply} disabled={!directColumnMapping.phone || directMappingLoading}
                    className="px-6 py-2 bg-emerald-500 hover:bg-emerald-600 text-white rounded-lg text-xs font-bold disabled:opacity-50"
                  >{directMappingLoading ? `처리중... ${directLoadingProgress}%` : '등록하기'}</button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ============ 직접입력 모달 ============ */}
        {showDirectInput && (() => {
          const usedVars = directSendChannel === 'sms'
            ? DIRECT_VAR_MAP.filter(v => directMessage.includes(v.variable)).map(v => v.fieldKey)
            : [];
          return (
            <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[60]">
              <div className="bg-white rounded-2xl shadow-2xl w-[550px] overflow-hidden">
                <div className="px-5 py-3 border-b bg-emerald-50 flex justify-between items-center">
                  <div>
                    <h3 className="font-semibold text-[14px] text-emerald-900 flex items-center gap-2">
                      <PencilLine size={14} strokeWidth={1.75} />
                      직접입력
                    </h3>
                    <p className="text-[11.5px] text-emerald-700/80 mt-0.5">
                      {usedVars.length > 0
                        ? `메시지에 사용된 변수: ${usedVars.map(f => DIRECT_FIELD_LABELS[f] || f).join(', ')}`
                        : '수신번호를 입력해주세요 (한 줄에 하나씩 또는 한 건씩 추가)'}
                    </p>
                  </div>
                  <button onClick={() => setShowDirectInput(false)} className="text-stone-500 hover:text-stone-700">
                    <X size={16} strokeWidth={1.75} />
                  </button>
                </div>
                <div className="p-5">
                  {usedVars.length === 0 ? (
                    <>
                      <div className="mb-2 text-xs text-stone-500">전화번호를 한 줄에 하나씩 입력</div>
                      <textarea value={directInputText} onChange={(e) => setDirectInputText(e.target.value)}
                        placeholder={'01012345678\n01087654321\n01011112222'}
                        className="w-full h-[200px] border rounded-lg p-3 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-emerald-500"
                      />
                    </>
                  ) : (
                    <>
                      <div className="flex gap-2 items-end mb-3">
                        <div className="flex-1">
                          <label className="block text-xs font-medium text-stone-600 mb-1">수신번호 *</label>
                          <input id="directInputPhone" type="text" placeholder="01012345678"
                            className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500" />
                        </div>
                        {usedVars.map(f => (
                          <div key={f} className="flex-1">
                            <label className="block text-xs font-medium text-stone-600 mb-1">{DIRECT_FIELD_LABELS[f]}</label>
                            <input id={`directInput_${f}`} type="text" placeholder={DIRECT_FIELD_LABELS[f]}
                              className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500" />
                          </div>
                        ))}
                        <button onClick={() => {
                          const phoneEl = document.getElementById('directInputPhone') as HTMLInputElement;
                          const phone = normalizePhoneKr(phoneEl?.value);
                          if (!phone || phone.length < 10) { setToast({ show: true, type: 'error', message: '유효한 수신번호를 입력해주세요' }); return; }
                          const entry: any = { phone, name: '', extra1: '', extra2: '', extra3: '', callback: '' };
                          usedVars.forEach(f => {
                            const el = document.getElementById(`directInput_${f}`) as HTMLInputElement;
                            const val = el?.value || '';
                            entry[f] = f === 'callback' ? normalizePhoneKr(val) : val;
                          });
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
                <div className="px-5 py-3 border-t bg-stone-50 flex justify-end gap-2">
                  <button onClick={() => setShowDirectInput(false)} className="px-4 py-2 border rounded-lg text-xs font-medium hover:bg-stone-100">닫기</button>
                  {usedVars.length === 0 && (
                    <button onClick={() => {
                      const lines = directInputText.split('\n').map(l => l.trim()).filter(l => l);
                      const newRecipients = lines
                        .map(line => ({ phone: normalizePhoneKr(line), name: '', extra1: '', extra2: '', extra3: '', callback: '' }))
                        .filter(r => r.phone && r.phone.length >= 10);
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
