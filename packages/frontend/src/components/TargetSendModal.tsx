import { Sparkles, Users, Eye, Type, Archive, Save, ImagePlus, Bell, Search, RotateCcw, Trash2, Wand2, Loader2, Megaphone, Clock, Server, RefreshCw, X, Plus, ChevronDown, Link2 } from 'lucide-react';
import SendWorkspaceShell, { FIELD_CLASS_INDIGO, WorkspaceNotice } from './shared/SendWorkspaceShell';
import { CUI_PILL_BASE, CUI_PANEL, CUI_SCROLL_X, CUI_THEAD, CUI_TH, CUI_TR, CUI_TD, CUI_CELL_DATA, CUI_BTN_GHOST, CUI_BTN_OUTLINE } from '../utils/console-ui';
import { useEffect, useRef, useState } from 'react';
import type { FieldMeta } from './DirectTargetFilterModal';
import { formatByType, buildAdMessageFront, replaceVarsByFieldMeta, getMaxByteMessage, cellToString } from '../utils/formatDate';
import { insertAtCursor } from '../utils/textInsert';
import BrandLinkChips from './BrandLinkChips';
import MmsImagePreview from './shared/MmsImagePreview';
import SmsCharsetNotice from './SmsCharsetNotice';
import { hasUnsupportedSmsChars, SMS_CHARSET_BLOCK_MESSAGE } from '../utils/smsSafeChars';
import AlimtalkChannelPanel, {
  validateAlimtalkChannelState,
  type AlimtalkChannelState,
  type AlimtalkSenderProfile,
  type AlimtalkTemplate,
} from './alimtalk/AlimtalkChannelPanel';
import AlimtalkVariableMappingPanel from './alimtalk/AlimtalkVariableMappingPanel';
import '../styles/direct-send.css';
// ★ 2026-09-29 한줄로 V2 R112 — 점검 두 칸 · 본문 칸 · 발송 바 = 직접발송 창과 같은 공용 코드(목업 승인 0929)
import { useSendPrecheck } from './direct-send/useSendPrecheck';
import { useEditorFill } from './direct-send/useEditorFill';
import SendBar from './direct-send/SendBar';
import {
  searchTargetExtraction, removeFromTargetExtraction, longestRowOf, formatExtractionDeadline,
  type TargetExtraction,
} from '../utils/target-extraction';

/**
 * 직접 타겟 발송 창 (★2026-09-29 한줄로 V2 R112 · 설계 docs/2026-09-28-v2-round4-send-redesign.md §2-1 · 목업 승인 0929)
 *
 * 추출 명단 전체는 서버 보관본(발송 준비 표)에 있다. 이 창은 건수 · 앞 15명 · 가장 긴 값만 든다.
 *   - 수신자 표 = 앞 15명 + 「외 N명도 함께 발송됩니다」 · 번호 검색은 서버 보관본 전체에서 · 선택삭제 = 서버 보관본에서 뺀다
 *   - 보관본은 추출 + 23시간까지 발송할 수 있다(지나면 안내 띠 + [같은 조건으로 다시 추출])
 *   - 왼쪽 열 560(직접발송과 같다) · 본문 칸이 남는 높이를 채운다 · 점검 두 칸(스팸 검사 · 맞춤법 검사) · 창 맨 아래 발송 바
 *   - 담당자테스트는 뺐다(Harold 0929)
 * 발송 = 확인 창 전에 서버 집계(/direct-send/count) → 확정(/direct-send/commit) — 직접발송과 같은 길(대시보드 onRequestSend).
 */

interface TargetSendModalProps {
  show: boolean;
  onClose: () => void;
  fieldsMeta: FieldMeta[];

  // 수신자 = 서버 보관본
  extraction: TargetExtraction | null;
  /** 23시간이 지났거나(서버 410) 확정이 만료로 거절됐다 */
  extractionExpired: boolean;
  /** 빼기 뒤 건수·표본을 바꾼다 */
  onExtractionChange: (next: TargetExtraction) => void;
  onExtractionExpired: () => void;
  /** 같은 조건으로 다시 추출 */
  onReextract: () => void;
  reextracting: boolean;
  /** 수신자별 회신번호 칸을 골랐을 때(서버 보관본 회신번호 채우기) */
  onIndividualColumnPicked: (key: string) => void;
  /** 수신자별 회신번호 칸이 빈 인원(서버) — null = 아직 모름(채우는 중) */
  callbackMissing: number | null;

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
  /** ★ 0928 분할 간격(분) — 직접발송 패널과 같은 Dashboard 값이라 이 창에도 칸이 있어야 숨은 값이 안 생긴다 */
  splitInterval: number;
  setSplitInterval: (n: number) => void;

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

  // 스팸 검사 · 맞춤법 검사(보내기 전 점검 · 직접발송과 같은 요금제 판정)
  setSpamFilterData: (d: any) => void;
  setShowSpamFilter: (b: boolean) => void;
  isSpamFilterLocked: boolean;
  /** 스팸 검사 창이 열려 있는가 — 닫히면 점검 칸이 검사 원장을 다시 본다 */
  spamModalOpen: boolean;
  onLockedFeature: (featureId: string) => void;
  isAiMessagingLocked?: boolean;

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

  /** 서버 집계 → (회신번호 제외 확인) → 발송 확인 창 — 대시보드가 소유(직접발송과 같은 길) */
  onRequestSend: () => Promise<void> | void;

  // 발송 중
  targetSending: boolean;

  // 타겟 재설정
  onResetTarget: () => void;

  // ★ D162-4 (2026-05-15) 2차: 직접타겟발송 → 알림톡 발송 풀 화면 진입 callback. ★2026-08-21 헤더 카드로 이동(headerActions).
  onAlimtalkOpen?: () => void;
  /** ★ 2026-08-21 직접 타겟 발송 → 브랜드메시지 발송. 추출된 수신자 목록을 그대로 들고 간다(알림톡과 같은 축). */
  onBrandOpen?: () => void;
}

/** 번호 비교 키(숫자만) — 서버 보관본 번호와 같은 규칙 */
const phoneKey = (v: unknown) => String(v ?? '').replace(/\D/g, '');

export default function TargetSendModal({
  show, onClose, fieldsMeta,
  extraction, extractionExpired, onExtractionChange, onExtractionExpired, onReextract, reextracting,
  onIndividualColumnPicked, callbackMissing,
  targetSendChannel,
  targetMsgType, setTargetMsgType,
  targetSubject, setTargetSubject,
  targetMessage, setTargetMessage,
  kakaoTemplates, kakaoSelectedTemplate, setKakaoSelectedTemplate,
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
  splitInterval, setSplitInterval,
  mmsUploadedImages, setMmsUploadedImages, setShowMmsUploadModal,
  formatPhoneNumber, formatRejectNumber, calculateBytes,
  setToast,
  setShowDirectPreview, setDirectMessage, setDirectMsgType, setDirectSubject,
  setSpamFilterData, setShowSpamFilter, isSpamFilterLocked, spamModalOpen, onLockedFeature, isAiMessagingLocked,
  handleAiMsgHelper,
  onAiDecorate,
  setShowSpecialChars, loadTemplates, setShowTemplateBox,
  setShowTemplateSave, setTemplateSaveName,
  smsOverrideAccepted,
  setPendingBytes, setShowLmsConfirm, setShowSmsConvert, lmsKeepAccepted, setLmsKeepAccepted,
  onRequestSend,
  targetSending,
  onResetTarget,
  onAlimtalkOpen,
  onBrandOpen,
}: TargetSendModalProps) {

  // ====== 내부 state ======
  // ★ D101: 수신자 선택삭제 — 키 = 번호(숫자만) · ★0929 R112 빼기는 서버 보관본에서 한다
  const [selectedPhones, setSelectedPhones] = useState<Set<string>>(new Set());
  const smsTextareaRef = useRef<HTMLTextAreaElement>(null);
  // ★ 2026-08-21 AI 꾸미기 — 처리 중 잠금 + 적용 직전 원문(되돌리기 1회). 사용자가 본문을 고치면 되돌리기는 사라진다.
  const [decorating, setDecorating] = useState(false);
  const [decorateUndo, setDecorateUndo] = useState<string | null>(null);
  // ★ 2026-09-29 R112 보관본 번호 검색(서버 · 전체에서) · 빼기
  const [searchQ, setSearchQ] = useState('');
  const [searchResult, setSearchResult] = useState<{ q: string; matched: number; rows: any[] } | null>(null);
  const [searching, setSearching] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [sendBusy, setSendBusy] = useState(false);
  const searchSeqRef = useRef(0);
  // ★ 2026-09-29 R112 Harold — 자동입력 변수 · 브랜드 링크 = 도구 줄 펼침 버튼(직접발송 「변수 ▾」와 같은 방식 · 메시지 칸을 넓힌다)
  const [varMenuOpen, setVarMenuOpen] = useState(false);
  const [linkMenuOpen, setLinkMenuOpen] = useState(false);
  const varMenuRef = useRef<HTMLDivElement>(null);
  const linkMenuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!varMenuOpen && !linkMenuOpen) return;
    const handler = (e: MouseEvent) => {
      const t = e.target as Node;
      if (varMenuOpen && varMenuRef.current && !varMenuRef.current.contains(t)) setVarMenuOpen(false);
      if (linkMenuOpen && linkMenuRef.current && !linkMenuRef.current.contains(t)) setLinkMenuOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [varMenuOpen, linkMenuOpen]);

  const count = extraction?.count ?? 0;
  const sample = extraction?.sample ?? [];
  const searchDigits = phoneKey(searchQ);
  const searchMode = searchDigits.length > 0;

  // 창이 다른 보관본을 받으면(새 추출·다시 추출) 검색·선택을 비운다
  useEffect(() => {
    setSelectedPhones(new Set());
    setSearchQ('');
    setSearchResult(null);
  }, [extraction?.extractionId]);

  // 번호 검색 — 3자리 이상이면 0.35초 뒤 서버 보관본 전체에서 찾는다(늦게 온 응답은 버린다)
  useEffect(() => {
    if (!extraction || extractionExpired || searchDigits.length < 3) { setSearchResult(null); setSearching(false); return; }
    const seq = ++searchSeqRef.current;
    setSearching(true);
    const t = setTimeout(async () => {
      const r = await searchTargetExtraction(extraction, searchDigits);
      if (seq !== searchSeqRef.current) return;
      setSearching(false);
      if (!r.ok) {
        if (r.expired) onExtractionExpired();
        else setToast({ show: true, type: 'error', message: r.error });
        return;
      }
      setSearchResult({ q: searchDigits, matched: r.data.matched, rows: r.data.rows });
    }, 350);
    return () => clearTimeout(t);
    // 보관본·검색어가 바뀔 때만 다시 찾는다(콜백은 대시보드가 매번 새로 만든다)
  }, [searchDigits, extraction?.extractionId, extractionExpired]);

  // ====== ★ 동적 필드 파생 (하드코딩 제거 핵심) ======

  // 변수로 사용할 필드 목록 (phone, sms_opt_in 제외)
  const variableFields = fieldsMeta.filter(fm =>
    fm.field_key !== 'phone' && fm.field_key !== 'sms_opt_in'
  );
  // 최장 바이트 계산용 변수맵(대시보드 바이트 체크와 같은 축)
  const targetVarMap: Record<string, string> = {};
  variableFields.forEach(fm => { targetVarMap[fm.variable] = fm.field_key; });

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

  // ====== ★ 커서 위치에 변수 삽입 — D124 컨트롤타워(insertAtCursor) ======
  //   setter는 props로 내려받은 (msg: string) => void 형태라 updater 패턴 불가 → currentValue 직접 사용
  const insertVariable = (variable: string) => {
    const ok = insertAtCursor(smsTextareaRef.current, variable, setTargetMessage);
    if (!ok) setTargetMessage(targetMessage + variable); // fallback: 현재 값 + 끝에 붙임
  };

  // ====== ★ B+0407-1: 인라인 replaceVars 제거 — replaceVarsByFieldMeta 컨트롤타워 사용 ======
  //   기존 인라인 함수는 enum 역변환 누락으로 성별 F/M이 그대로 노출되는 버그 발생
  const replaceVars = (text: string, recipient: any) =>
    replaceVarsByFieldMeta(text, recipient, variableFields as any);

  // ====== 셀 값 포맷 ======
  // ★ D111 E1 · D142: FRONT_FIELD_DISPLAY_MAP 컨트롤타워 · fieldKey 전달(custom_* 원본 보존)
  const formatCellValue = (value: any, dataType: string, fieldKey?: string): string => {
    if (value == null || value === '') return '-';
    if (dataType === 'boolean') return value === true || value === 'true' ? '예' : '아니오';
    return formatByType(value, dataType, fieldKey);
  };

  // ====== ★ 2026-09-29 R112 본문 칸 = 직접발송과 같은 공용 훅(창 높이를 채우고 넘치면 칸 안 스크롤) ======
  const { editorScrollRef, editorOverflow, syncEditorOverflow, focusEditorFromBlank } = useEditorFill(
    smsTextareaRef, null,
    [targetMessage, targetMsgType, adTextEnabled, mmsUploadedImages.length, targetSendChannel, show],
  );

  // ====== ★ 2026-09-29 R112 보내기 전 점검 = 직접발송과 같은 공용 훅(스팸 검사 · 맞춤법 검사 · 발송 전 경고) ======
  const precheck = useSendPrecheck({
    message: targetMessage, setMessage: setTargetMessage, subject: targetSubject, msgType: targetMsgType,
    callback: selectedCallback, useIndividualCallback, adTextEnabled, optOutNumber,
    recipientsKey: `${extraction?.extractionId || ''}:${count}`,
    hasRecipients: count > 0 && !extractionExpired,
    // 스팸 검사에 싣는 글 = 첫 수신자 값으로 치환(옛 스팸필터 버튼과 같은 계산)
    buildSpamTestContent: () => {
      const msg = targetMessage || '';
      const firstR = sample[0];
      const smsRaw = buildAdMessageFront(msg, 'SMS', adTextEnabled, optOutNumber);
      const lmsRaw = buildAdMessageFront(msg, 'LMS', adTextEnabled, optOutNumber);
      return { smsMsg: replaceVars(smsRaw, firstR), lmsMsg: replaceVars(lmsRaw, firstR), firstR };
    },
    // 단문 바이트 = 명단 최장 값(서버가 준 가장 긴 값 한 행) · (광고) · 수신거부 줄
    measureSmsBytes: (t: string) => calculateBytes(buildAdMessageFront(getMaxByteMessage(t, longestRowOf(extraction), targetVarMap), 'SMS', adTextEnabled, optOutNumber)),
    spamModalOpen, isSpamFilterLocked, isAiMessagingLocked, onLockedFeature,
    setSpamFilterData, setShowSpamFilter, setToast,
    onSendAnyway: () => { void onRequestSend(); },
  });

  // ====== SMS 전송하기 핸들러 ======
  const handleSmsSend = async () => {
    if (!extraction || extractionExpired) {
      setToast({ show: true, type: 'error', message: '발송 명단이 만료됐습니다. 같은 조건으로 다시 추출해 주세요.' });
      return;
    }
    if (count === 0) {
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
      // ★ D99: 선택된 컬럼(individualCallbackColumn) 값이 빈 고객 수 — ★0929 R112 서버 보관본에서 센 값
      if (callbackMissing == null) {
        setToast({ show: true, type: 'error', message: '수신자별 회신번호를 확인하는 중입니다. 잠시 뒤 다시 눌러 주세요.' });
        return;
      }
      if (callbackMissing > 0) {
        const colName = fieldsMeta.find(f => f.field_key === individualCallbackColumn)?.display_name || individualCallbackColumn;
        setToast({ show: true, type: 'error', message: `${colName} 값이 없는 고객이 ${callbackMissing}명 있습니다. 일반 회신번호를 선택하거나 고객 데이터를 확인해주세요.` });
        return;
      }
    }
    if ((targetMsgType === 'LMS' || targetMsgType === 'MMS') && !targetSubject.trim()) {
      setToast({ show: true, type: 'error', message: '제목을 입력해주세요' });
      return;
    }
    // ★ 2026-09-10 문자로 보낼 수 없는 글자가 남아 있으면 발송하지 않는다(설계 D2 · 본문 아래 안내에서 바꾼다)
    if (hasUnsupportedSmsChars(targetMessage, targetMsgType === 'SMS' ? '' : targetSubject)) {
      setToast({ show: true, type: 'error', message: SMS_CHARSET_BLOCK_MESSAGE });
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
        setShowSmsConvert({ show: true, from: 'target', currentBytes: msgBytes, smsBytes, count });
        return;
      }
    }

    // ★ 2026-09-29 R112 보내기 전 경고 — 스팸 검사 안 함·막힘·미완료 · 맞춤법 고칠 곳 남음이면 먼저 묻는다(막지는 않는다 · 직접발송과 같다)
    setSendBusy(true);
    try {
      const warn = await precheck.decideSendWarn();
      if (warn) { precheck.showSendWarn(warn); return; }
      await onRequestSend();
    } finally {
      setSendBusy(false);
    }
  };

  const handleAlimtalkSend = async () => {
    if (count === 0) { setToast({ show: true, type: 'error', message: '수신자가 없습니다' }); return; }
    if (!kakaoSelectedTemplate) { setToast({ show: true, type: 'error', message: '템플릿을 선택해주세요' }); return; }
    // ★ 2026-07-27: 전환재발송 검증 공용 CT — 백엔드(400)와 같은 규칙을 확인 모달 전에 먼저 건다.
    const fallbackViolation = validateAlimtalkChannelState({
      profileId: '', templateCode: '', templateId: '', variableMap: {},
      nextType: alimtalkFallback,
      nextContents: alimtalkNextContents,
      nextSubject: alimtalkNextSubject,
    });
    if (fallbackViolation) { setToast({ show: true, type: 'error', message: fallbackViolation }); return; }
    await onRequestSend();
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

  // ====== ★ 2026-09-29 R112 선택삭제 = 서버 보관본에서 뺀다 ======
  const handleRemoveSelected = async () => {
    if (!extraction || selectedPhones.size === 0 || removing) return;
    setRemoving(true);
    try {
      const phones = [...selectedPhones];
      const r = await removeFromTargetExtraction(extraction, phones);
      if (!r.ok) {
        if (r.expired) onExtractionExpired();
        else setToast({ show: true, type: 'error', message: r.error });
        return;
      }
      const gone = new Set(phones);
      onExtractionChange({
        ...extraction,
        count: r.data.count,
        sample: extraction.sample.filter((row) => !gone.has(phoneKey(row.phone))),
      });
      setSearchResult((prev) => (prev ? { ...prev, matched: Math.max(0, prev.matched - r.data.removed), rows: prev.rows.filter((row) => !gone.has(phoneKey(row.phone))) } : prev));
      setSelectedPhones(new Set());
      setToast({ show: true, type: 'success', message: `${r.data.removed.toLocaleString()}명을 발송 대상에서 뺐습니다` });
    } finally {
      setRemoving(false);
    }
  };

  // ====== 렌더링 ======
  if (!show) return null;

  // ★ 2026-08-21 표면 리프트(인디고): 발송 공용 셸(SendWorkspaceShell).
  //   ★ 2026-09-29 R112: 왼쪽(aside) = 작성기 560(직접발송 왼쪽 열과 같다) · 오른쪽 = 수신자 목록 · 맨 아래 = 발송 바. md 이하 1컬럼.
  const fullMsgBytes = calculateBytes(buildAdMessageFront(targetMessage, targetMsgType, adTextEnabled, optOutNumber));
  const maxBytes = targetMsgType === 'SMS' ? 90 : 2000;
  const bytesOver = fullMsgBytes > maxBytes;
  const rows = searchMode ? (searchResult?.rows ?? []) : sample;
  const restCount = Math.max(0, count - sample.length);
  const approvedTpl = ['approved', 'APPROVED', 'APR', 'A'].includes(kakaoSelectedTemplate?.status);
  const deadline = extraction?.expiresAt ? formatExtractionDeadline(extraction.expiresAt) : '';

  const SEG_ON = 'flex-1 h-9 rounded-lg text-[13px] font-semibold text-indigo-700 bg-white shadow-sm transition';
  const SEG_OFF = 'flex-1 h-9 rounded-lg text-[13px] font-medium text-slate-500 hover:text-slate-900 transition';
  // ★ 2026-08-21 Harold 지적: 도구 버튼이 ghost라 AI 추천 옆에서 경계가 안 보였다 → 흰 칩 + 링으로 버튼임을 드러낸다.
  const TOOL_BTN = 'h-8 px-2.5 rounded-lg bg-white ring-1 ring-slate-200 text-[12px] font-medium text-slate-700 hover:ring-indigo-400 hover:text-indigo-700 inline-flex items-center gap-1 transition disabled:opacity-40 disabled:pointer-events-none';
  // ★ 2026-09-29 R112 미리보기 = 직접발송 도구 줄 오른쪽 초록 칩과 같은 자리·색
  const PREVIEW_BTN = 'h-8 px-2.5 rounded-lg bg-emerald-50 ring-1 ring-emerald-200 text-[12px] font-semibold text-emerald-700 hover:bg-emerald-100 inline-flex items-center gap-1 transition';
  const AI_BTN_PRIMARY = 'h-8 px-2.5 rounded-lg text-[12px] font-semibold bg-indigo-600 text-white hover:bg-indigo-700 inline-flex items-center gap-1 transition shadow-sm';
  const AI_BTN_OUTLINE = 'h-8 px-2.5 rounded-lg text-[12px] font-semibold text-indigo-700 bg-indigo-50 ring-1 ring-indigo-200 hover:bg-indigo-100 hover:ring-indigo-300 inline-flex items-center gap-1 transition disabled:opacity-40 disabled:pointer-events-none';

  const composer = (
    <div className="flex-1 min-h-0 overflow-y-auto p-4 sm:p-5 flex flex-col gap-3">
      {/* ★ D162-4 (2026-05-15) 2차: Harold님 명시. 채널 탭 자체 제거.
          직접타겟발송 = 문자(SMS/LMS/MMS) 단일 모드. 알림톡·브랜드메시지는 헤더 카드(headerActions)로 진입 → 각 풀 화면.
          targetSendChannel state는 'sms' 고정. ★ 2026-08-17 죽어 있던 RCS 분기 제거(직접발송과 같은 축). */}
      {targetSendChannel === 'sms' && (<>
        {/* SMS/LMS/MMS 세그먼트 */}
        <div className="shrink-0 flex p-1 rounded-xl bg-slate-200/60">
          <button type="button" onClick={() => { setTargetMsgType('SMS'); setMmsUploadedImages([]); setLmsKeepAccepted(false); }} className={targetMsgType === 'SMS' ? SEG_ON : SEG_OFF}>SMS</button>
          <button type="button" onClick={() => { setTargetMsgType('LMS'); setMmsUploadedImages([]); setLmsKeepAccepted(false); }} className={targetMsgType === 'LMS' ? SEG_ON : SEG_OFF}>LMS</button>
          <button type="button" onClick={() => { setTargetMsgType('MMS'); setLmsKeepAccepted(false); }} className={targetMsgType === 'MMS' ? SEG_ON : SEG_OFF}>MMS</button>
        </div>

        {/* 작성 카드 — ★0929 R112 남는 높이를 채운다(본문 칸이 늘어난다)
            ★ 2026-09-29 차수 5 — PC 폭 최소 320(낮은 화면 1366×768 에서 420 이면 점검 두 칸이 발송 바에 잘려 겹쳐 보였다 · 높은 화면은 남는 높이를 채워 그대로) */}
        <div className="flex-1 min-h-[420px] md:min-h-[320px] flex flex-col rounded-2xl bg-white ring-1 ring-slate-900/5 shadow-sm overflow-hidden">
          {(targetMsgType === 'LMS' || targetMsgType === 'MMS') && (
            <div className="shrink-0 px-4 pt-4">
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

          {/* 본문 칸 — (광고) · 본문 · 수신거부 줄이 한 흐름 · 창 높이를 채우고 넘치면 칸 안 스크롤(직접발송과 같다) */}
          <div
            ref={editorScrollRef}
            onMouseDown={focusEditorFromBlank}
            onScroll={syncEditorOverflow}
            className="flex-1 min-h-[120px] overflow-y-auto px-4 pt-4 pb-3 cursor-text"
          >
            <div className="relative">
              {adTextEnabled && (
                <span className="absolute left-0 top-0 text-sm text-indigo-600 font-semibold pointer-events-none select-none">(광고)</span>
              )}
              <textarea
                ref={smsTextareaRef}
                rows={1}
                data-char-target="target"
                value={targetMessage}
                onChange={(e) => { setTargetMessage(e.target.value); if (decorateUndo != null) setDecorateUndo(null); }}
                placeholder="전송할 내용을 입력하세요."
                spellCheck={false}
                style={adTextEnabled ? { textIndent: '42px' } : {}}
                className="block w-full min-h-[44px] resize-none overflow-hidden border-0 p-0 bg-transparent focus:outline-none focus:ring-0 text-sm leading-relaxed text-slate-800 placeholder:text-slate-300"
              />
            </div>
            {adTextEnabled && (
              <div className="text-[12.5px] text-slate-500 mt-1 select-none">
                {targetMsgType === 'SMS'
                  ? `무료거부${optOutNumber.replace(/-/g, '')}`
                  : `무료수신거부 ${formatRejectNumber(optOutNumber)}`}
              </div>
            )}
          </div>
          {editorOverflow && (
            <div className="shrink-0 mx-4 mb-2 flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-slate-50 ring-1 ring-slate-200 text-[12px] text-slate-600">
              글이 길어 아래가 가려져 있어요
              <button type="button" onClick={handlePreview} className="ml-auto font-bold text-emerald-700 hover:text-emerald-800">미리보기로 한 번에 보기</button>
            </div>
          )}
          {/* ★ 2026-09-10 문자로 보낼 수 없는 글자 — 누르면 본문·제목을 대체표로 바꾼다 */}
          <SmsCharsetNotice
            className="shrink-0 mx-4 mb-3"
            texts={[targetMessage, targetMsgType === 'SMS' ? '' : targetSubject]}
            onApply={(fix) => {
              const nextMessage = fix(targetMessage);
              if (nextMessage !== targetMessage) { setTargetMessage(nextMessage); if (decorateUndo != null) setDecorateUndo(null); }
              if (targetMsgType !== 'SMS' && fix(targetSubject) !== targetSubject) setTargetSubject(fix(targetSubject));
            }}
          />

          {/* 도구줄 — 윗줄 = AI(추천·꾸미기) + byte · 미리보기(직접발송 자리) / 아랫줄 = 작성 도구(특수문자·보관함·문자 저장) + 변수 ▾ · 브랜드 링크 ▾.
              ★ 2026-09-29 R112 Harold: 변수 칩·브랜드 링크 칸을 펼침 버튼으로 옮겨 메시지 칸을 넓혔다(1440×900 실측 본문 칸 168px에서 넓힘). */}
          <div className="shrink-0 px-3 py-2.5 border-t border-slate-100 bg-slate-50/70 space-y-2">
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
              <div className="flex items-center gap-2 shrink-0">
                <span className="text-[12px] text-slate-500 tabular-nums whitespace-nowrap">
                  <span className={`font-bold ${bytesOver ? 'text-rose-600' : 'text-indigo-600'}`}>{fullMsgBytes}</span>/{maxBytes}byte
                </span>
                <button type="button" onClick={handlePreview} className={PREVIEW_BTN}><Eye className="w-3.5 h-3.5" />미리보기</button>
              </div>
            </div>
            <div className="flex items-center gap-1.5 flex-wrap">
              <button type="button" onClick={() => setShowSpecialChars('target')} className={TOOL_BTN}><Type className="w-3.5 h-3.5" />특수문자</button>
              <button type="button" onClick={() => { loadTemplates(); setShowTemplateBox('target'); }} className={TOOL_BTN}><Archive className="w-3.5 h-3.5" />보관함</button>
              <button type="button" onClick={() => { if (!targetMessage.trim()) { setToast({show: true, type: 'error', message: '저장할 메시지를 먼저 입력해주세요.'}); setTimeout(() => setToast({show: false, type: 'error', message: ''}), 3000); return; } setTemplateSaveName(''); setShowTemplateSave('target'); }} className={TOOL_BTN}><Save className="w-3.5 h-3.5" />문자 저장</button>

              {/* ★ 자동입력 변수 — fieldsMeta 기반 동적 변수(클릭 = 커서 위치 삽입) · 위로 펼친다(직접발송 변수 메뉴와 같은 모양) */}
              <div className="relative ds-scope" ref={varMenuRef}>
                <button
                  type="button"
                  onClick={() => { setVarMenuOpen((o) => !o); setLinkMenuOpen(false); }}
                  className={`${TOOL_BTN} ${varMenuOpen ? 'ring-indigo-400 text-indigo-700' : ''}`}
                  aria-haspopup="menu"
                  aria-expanded={varMenuOpen}
                >
                  <Plus className="w-3.5 h-3.5" />변수
                  <ChevronDown className={`w-3 h-3 transition-transform ${varMenuOpen ? 'rotate-180' : ''}`} />
                </button>
                {varMenuOpen && (
                  <div className="ds-var-menu" role="menu" style={{ left: 0, right: 'auto' }}>
                    <div className="ds-var-menu__head">누르면 커서 위치에 들어갑니다</div>
                    {variableFields.length === 0 ? (
                      <div className="px-2.5 py-2 text-[12px] text-slate-400">추출 조건에 넣은 항목이 변수로 나타납니다</div>
                    ) : variableFields.map(fm => (
                      <button
                        key={fm.field_key}
                        type="button"
                        role="menuitem"
                        className="ds-var-item"
                        onClick={() => { insertVariable(fm.variable); setVarMenuOpen(false); }}
                      >
                        <span>{fm.display_name}</span>
                        <span className="ds-var-item__code">{fm.variable}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* ★ 2026-07-02 브랜드 링크: 칩 클릭 = 커서 위치 URL 삽입 (insertAtCursor CT 재사용) · ★0929 R112 위로 펼치는 창 안으로 */}
              <div className="relative" ref={linkMenuRef}>
                <button
                  type="button"
                  onClick={() => { setLinkMenuOpen((o) => !o); setVarMenuOpen(false); }}
                  className={`${TOOL_BTN} ${linkMenuOpen ? 'ring-indigo-400 text-indigo-700' : ''}`}
                  aria-haspopup="dialog"
                  aria-expanded={linkMenuOpen}
                >
                  <Link2 className="w-3.5 h-3.5" />브랜드 링크
                  <ChevronDown className={`w-3 h-3 transition-transform ${linkMenuOpen ? 'rotate-180' : ''}`} />
                </button>
                {linkMenuOpen && (
                  <div className="absolute bottom-[calc(100%+6px)] left-0 z-50 w-[380px] max-w-[calc(100vw-48px)] max-h-[320px] overflow-y-auto rounded-xl bg-white ring-1 ring-slate-200 shadow-[0_-8px_32px_rgba(0,0,0,0.12)] p-3">
                    <BrandLinkChips
                      tone="light"
                      onToast={(message, type) => setToast({ show: true, type: type === 'error' ? 'error' : 'success', message })}
                      onInsert={(u) => {
                        const ok = insertAtCursor(smsTextareaRef.current, u, setTargetMessage);
                        if (!ok) setTargetMessage(targetMessage + u);
                        setLinkMenuOpen(false);
                      }}
                    />
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* MMS 이미지 (B16-05: MMS 탭에서만) */}
          {targetMsgType === 'MMS' && (
            <button type="button" onClick={() => setShowMmsUploadModal(true)}
              className="shrink-0 w-full px-4 py-3 border-t border-slate-100 bg-indigo-50/40 hover:bg-indigo-50 transition flex items-center gap-2.5 text-left">
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
        </div>

        {/* ★ 2026-09-29 R112 보내기 전 점검 — 스팸 검사 · 맞춤법 검사(직접발송과 같은 칸 · 같은 판정) · 담당자테스트는 뺐다(Harold 0929) */}
        <div className="ds-scope shrink-0">{precheck.tiles}</div>
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
              void handleAlimtalkSend();
            }}
            disabled={!kakaoSelectedTemplate || !approvedTpl || targetSending || extractionExpired}
            className={`w-full h-12 rounded-xl text-[15px] font-bold transition inline-flex items-center justify-center gap-2 disabled:opacity-50 ${approvedTpl ? 'bg-amber-500 hover:bg-amber-600 text-white shadow-lg shadow-amber-500/20' : 'bg-slate-200 text-slate-500 cursor-not-allowed'}`}
          >
            <Bell className="w-4 h-4" />
            {targetSending ? '발송 중' : !kakaoSelectedTemplate ? '템플릿을 선택해주세요' : '알림톡 발송하기'}
          </button>
        </div>
      )}
    </div>
  );

  // ★ 2026-09-29 R112 발송 바 — 직접발송과 같은 부품(예약·분할·광고 · 발신번호 · 전송) · 발신번호는 여기 한 곳(작성 카드에서 옮김)
  const individualColumns = fieldsMeta
    .filter(f => phoneFields?.includes(f.field_key))
    // ★ D150-3: 0/'0' 보존
    .map(f => ({ key: f.field_key, label: f.display_name, sample: cellToString(sample[0]?.[f.field_key]) }));
  const footer = targetSendChannel === 'sms' ? (
    <div className="ds-scope">
      <SendBar
        reserveEnabled={reserveEnabled} setReserveEnabled={setReserveEnabled}
        reserveDateTime={reserveDateTime} setShowReservePicker={setShowReservePicker}
        splitEnabled={splitEnabled} setSplitEnabled={setSplitEnabled}
        splitCount={splitCount} setSplitCount={setSplitCount}
        splitInterval={splitInterval} setSplitInterval={setSplitInterval}
        recipientCount={count}
        adTextEnabled={adTextEnabled} handleAdToggle={handleAdToggle}
        callbackNumbers={callbackNumbers} selectedCallback={selectedCallback} setSelectedCallback={setSelectedCallback}
        useIndividualCallback={useIndividualCallback} setUseIndividualCallback={setUseIndividualCallback}
        individualCallbackColumn={individualCallbackColumn} setIndividualCallbackColumn={setIndividualCallbackColumn}
        individualColumns={individualColumns}
        onIndividualColumnPicked={onIndividualColumnPicked}
        formatPhoneNumber={formatPhoneNumber}
        sendLabel={targetSending ? '발송 중' : extractionExpired ? '다시 추출하면 보낼 수 있습니다' : `${count.toLocaleString()}명에게 전송하기`}
        onSend={() => { void handleSmsSend(); }}
        sendDisabled={targetSending || sendBusy || extractionExpired || count === 0}
        sendClassName="ks-send--indigo"
      />
    </div>
  ) : undefined;

  const expiredNotice = extractionExpired ? (
    <WorkspaceNotice>
      <div className="flex items-center gap-3 flex-wrap">
        <span className="flex-1 min-w-[240px]">추출한 지 23시간이 지나 발송 명단이 만료됐습니다. 작성한 문자는 그대로 있습니다. 같은 조건으로 다시 추출하면 바로 이어서 보낼 수 있습니다.</span>
        <button
          type="button"
          onClick={onReextract}
          disabled={reextracting}
          className="h-9 px-3.5 inline-flex items-center gap-1.5 rounded-lg text-[13.5px] font-semibold bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50 transition"
        >
          {reextracting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
          {reextracting ? '다시 추출하는 중' : '같은 조건으로 다시 추출'}
        </button>
      </div>
    </WorkspaceNotice>
  ) : undefined;

  return (
    <SendWorkspaceShell
      show={show}
      onClose={onClose}
      title="직접 타겟 발송"
      subtitle={`추출된 ${count.toLocaleString()}명에게 메시지를 발송합니다`}
      icon={<Users className="w-5 h-5 text-white" />}
      accent="indigo"
      zClass="z-50"
      aside={composer}
      asideWidth="min(560px, max(500px, 55%))"
      maxW="max-w-[1400px]"
      notice={expiredNotice}
      footer={footer}
      headerActions={(onAlimtalkOpen || onBrandOpen) ? (
        <>
          {/* ★ 2026-08-21 Harold 지적 — 수신자 표 머리에 끼어 있던 채널 버튼을 직접발송과 같은 헤더 카드로.
              채널 전환은 "이 화면을 벗어나는 행동"이라 헤더가 제자리다. 색은 면이 아니라 아이콘 타일에만:
              알림톡 = amber(채널 정체성), 브랜드메시지 = indigo(넘어가는 모달이 인디고 전용 진입). */}
          {onAlimtalkOpen && (
            <button
              type="button"
              onClick={onAlimtalkOpen}
              className="group inline-flex items-center gap-2.5 pl-2 pr-2 sm:pr-3.5 py-1.5 rounded-xl bg-white ring-1 ring-slate-200 shadow-sm hover:ring-amber-300 hover:shadow-md transition text-left"
              title="추출된 수신자에게 알림톡 발송"
            >
              <span className="w-7 h-7 rounded-lg bg-gradient-to-br from-amber-400 to-orange-500 flex items-center justify-center shadow-sm shadow-amber-500/30 shrink-0">
                <Bell size={14} strokeWidth={2} className="text-white" />
              </span>
              <span className="leading-tight hidden sm:block">
                <span className="block text-[13px] font-semibold text-slate-800">알림톡 발송</span>
                <span className="hidden lg:block text-[10px] text-slate-400">검수 템플릿으로 보내기</span>
              </span>
            </button>
          )}
          {onBrandOpen && (
            <button
              type="button"
              onClick={onBrandOpen}
              className="group inline-flex items-center gap-2.5 pl-2 pr-2 sm:pr-3.5 py-1.5 rounded-xl bg-white ring-1 ring-slate-200 shadow-sm hover:ring-indigo-300 hover:shadow-md transition text-left"
              title="추출된 수신자에게 브랜드메시지 발송"
            >
              <span className="w-7 h-7 rounded-lg bg-gradient-to-br from-indigo-500 to-violet-500 flex items-center justify-center shadow-sm shadow-indigo-500/30 shrink-0">
                <Megaphone size={14} strokeWidth={2} className="text-white" />
              </span>
              <span className="leading-tight hidden sm:block">
                <span className="block text-[13px] font-semibold text-slate-800">브랜드메시지</span>
                <span className="hidden lg:block text-[10px] text-slate-400">검수 없이 바로 보내기</span>
              </span>
            </button>
          )}
        </>
      ) : undefined}
    >
      {/* ★ 2026-09-29 한줄로 V2 차수 5(Harold 「고객 리스트가 겹치는 것처럼 보인다」) — PC 폭(768+)은 오른쪽 칸 높이에 맞추고 표만 카드 안에서
          스크롤한다(머리 줄 고정 · 선택삭제 줄은 늘 보이고 발송 바와 24px 띄움). 옛: 칸 전체가 한 덩어리로 스크롤돼 표가 발송 바에 바로 잘려 보였다.
          휴대폰 폭은 창 전체 스크롤(자유 높이) 그대로. */}
      <div className="p-4 sm:p-6 flex flex-col min-h-full md:h-full">
        {/* ★ D162-4 (2026-05-15) PDF 0515 알림톡 #1: 알림톡 채널일 때만 변수 매칭 박스 노출. 문자 채널 영향 0. */}
        {targetSendChannel === 'kakao_alimtalk' && (
          <div className="mb-4">
            <AlimtalkVariableMappingPanel
              selectedTemplate={kakaoSelectedTemplate}
              variableMap={kakaoTemplateVars}
              onVariableMapChange={(next) => setKakaoTemplateVars(next)}
              customerFieldOptions={customerFieldOptions}
              sampleRecipient={sample[0] || null}
              recipientCount={count}
            />
          </div>
        )}

        {/* 수신자 목록 헤더 — ★0929 R112 발송 가능 시각 · 번호 검색 = 서버 보관본 전체 */}
        <div className="shrink-0 flex items-center justify-between gap-3 flex-wrap mb-3">
          <div className="flex items-center gap-2.5 flex-wrap">
            <span className="text-[15px] font-semibold text-slate-900">수신자 목록</span>
            <span className={`${CUI_PILL_BASE} bg-indigo-100 text-indigo-700 tabular-nums`}>총 {count.toLocaleString()}건</span>
            {extractionExpired ? (
              <span className={`${CUI_PILL_BASE} bg-slate-100 text-slate-600`}>만료됨</span>
            ) : deadline ? (
              <span className={`${CUI_PILL_BASE} bg-white text-slate-600 font-medium ring-1 ring-slate-200`} title="추출한 명단은 23시간 동안 보관돼 그 안에 보낼 수 있습니다">
                <Clock className="w-3.5 h-3.5 text-slate-400" />{deadline}까지 발송 가능
              </span>
            ) : null}
            {selectedPhones.size > 0 && <span className={`${CUI_PILL_BASE} bg-slate-100 text-slate-600`}>{selectedPhones.size}건 선택</span>}
          </div>
          {!extractionExpired && (
            <div className="flex items-center gap-2 w-full sm:w-auto">
              <div className="h-9 w-full sm:w-64 flex items-center gap-2 px-3 rounded-lg bg-slate-50 ring-1 ring-slate-200 focus-within:bg-white focus-within:ring-2 focus-within:ring-indigo-500/50 transition">
                {searching ? <Loader2 className="w-3.5 h-3.5 text-indigo-500 shrink-0 animate-spin" /> : <Search className="w-3.5 h-3.5 text-slate-400 shrink-0" />}
                <input
                  type="text"
                  inputMode="numeric"
                  placeholder="수신번호로 전체에서 찾기"
                  value={searchQ}
                  onChange={(e) => { setSearchQ(e.target.value); setSelectedPhones(new Set()); }}
                  className="w-full min-w-0 bg-transparent border-0 p-0 text-[13px] text-slate-800 outline-none placeholder:text-slate-400 focus:ring-0"
                />
                {searchQ && (
                  <button type="button" onClick={() => { setSearchQ(''); setSelectedPhones(new Set()); }} className="text-slate-400 hover:text-slate-700 shrink-0" aria-label="검색 지우기">
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
        {!extractionExpired && (
          <p className="shrink-0 -mt-1 mb-3 text-[12.5px] text-slate-500">
            {searchMode
              ? (searchDigits.length < 3
                ? '번호를 3자리 이상 넣으면 전체에서 찾습니다.'
                : searchResult
                  ? <>전체 <span className="tabular-nums">{count.toLocaleString()}명</span>에서 ‘{searchResult.q}’가 들어간 번호 <b className="font-semibold text-indigo-700 tabular-nums">{searchResult.matched.toLocaleString()}명</b>{searchResult.matched > searchResult.rows.length ? ` · 앞 ${searchResult.rows.length}명만 보여 드립니다` : ''}</>
                  : '찾는 중입니다.')
              : restCount > 0
                ? <>앞 {sample.length}명만 보여 드립니다. 번호로 찾으면 <b className="font-semibold text-indigo-700 tabular-nums">{count.toLocaleString()}명</b> 전체에서 찾습니다.</>
                : null}
          </p>
        )}

        {/* ★ 표: fieldsMeta 기반 동적 컬럼 (하드코딩 제거) · ★0929 R112 앞 15명(또는 찾은 번호) + 외 N명 */}
        <div className={`${CUI_PANEL} flex-1 md:min-h-[220px] flex flex-col`}>
          {extractionExpired ? (
            <div className="px-4 py-14 text-center">
              <div className="text-[13.5px] font-semibold text-slate-700">명단 보관 시간이 지났습니다</div>
              <div className="mt-1 text-[12.5px] text-slate-500">위 버튼을 누르면 같은 조건으로 다시 뽑습니다. 그사이 바뀐 고객이 반영됩니다.</div>
            </div>
          ) : (
            <div className={`${CUI_SCROLL_X} md:flex-1 md:min-h-0 md:overflow-y-auto`}>
              <table className="w-full">
                <thead className={`${CUI_THEAD} md:sticky md:top-0 md:z-[1]`}>
                  <tr>
                    <th className={`${CUI_TH} w-10 text-center`}>
                      <input
                        type="checkbox"
                        className="h-4 w-4 rounded accent-indigo-600"
                        aria-label="보이는 수신자 모두 고르기"
                        checked={rows.length > 0 && rows.every((r) => selectedPhones.has(phoneKey(r.phone)))}
                        onChange={(e) => {
                          setSelectedPhones(e.target.checked ? new Set(rows.map((r) => phoneKey(r.phone))) : new Set());
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
                  {rows.length === 0 && (
                    <tr>
                      <td colSpan={2 + tableFields.length} className="px-4 py-14 text-center text-[13px] text-slate-400">
                        {searchMode
                          ? (searchDigits.length < 3 ? '번호를 3자리 이상 넣어 주세요' : searching ? '찾는 중입니다' : '검색과 일치하는 수신번호가 없습니다')
                          : '수신자가 없습니다. 타겟을 다시 설정해 주세요'}
                      </td>
                    </tr>
                  )}
                  {rows.map((r, idx) => {
                    const key = phoneKey(r.phone);
                    const checked = selectedPhones.has(key);
                    return (
                      <tr key={`${key}_${idx}`} className={`${CUI_TR} ${checked ? 'bg-indigo-50/60' : ''}`}>
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
                  {!searchMode && restCount > 0 && (
                    <tr>
                      <td colSpan={2 + tableFields.length} className="p-0 bg-gradient-to-b from-neutral-50/60 to-white">
                        {/* 휴대폰 폭 = 가로로 넘기는 표 안에서도 왼쪽에 붙어 보인다(0929 390 폭 실측) · 넓은 폭 = 가운데 */}
                        <div className="sticky left-0 inline-flex sm:static sm:flex items-center sm:justify-center gap-2.5 px-4 py-4">
                          <span className="w-[30px] h-[30px] rounded-[9px] bg-indigo-50 text-indigo-600 grid place-items-center shrink-0">
                            <Server className="w-4 h-4" />
                          </span>
                          <span className="leading-tight">
                            <span className="block text-[13.5px] font-semibold text-slate-900 tabular-nums">외 {restCount.toLocaleString()}명도 함께 발송됩니다</span>
                            <span className="block mt-0.5 text-[12px] text-slate-500">명단 전체는 서버에 있고, 보낼 때 서버가 바로 보냅니다</span>
                          </span>
                        </div>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* 하단 액션 — ★0929 R112 선택삭제 = 서버 보관본에서 뺀다 · 전체삭제·쪽 넘김은 없앴다(= 타겟 재설정) */}
        <div className="mt-3 shrink-0 flex justify-between items-center gap-2 flex-wrap">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => { void handleRemoveSelected(); }}
              disabled={selectedPhones.size === 0 || removing || extractionExpired}
              className={`${CUI_BTN_OUTLINE} ${selectedPhones.size > 0 ? 'text-rose-600 border-rose-200 hover:bg-rose-50 hover:border-rose-300' : ''}`}
            >
              {removing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
              선택삭제{selectedPhones.size > 0 && ` (${selectedPhones.size})`}
            </button>
          </div>
          <button type="button" onClick={onResetTarget} className={CUI_BTN_GHOST}>
            <RotateCcw className="w-3.5 h-3.5" />
            타겟 재설정
          </button>
        </div>
      </div>

      {/* ★ 2026-09-29 R112 맞춤법 결과 · 발송 전 경고 · 요금제 안내 · AI 다듬기(공용 훅) */}
      <div className="ds-scope">{precheck.modals}</div>
    </SendWorkspaceShell>
  );
}
