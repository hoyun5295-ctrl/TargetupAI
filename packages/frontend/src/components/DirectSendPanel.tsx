/**
 * ★ D96: 직접발송 패널 — Dashboard.tsx에서 분리
 * ★ D137 (2026-04-24): 디자인 전면 리프트 (Claude Design 시안 기반)
 *
 *   - 좌측 520px: 메시지 에디터 (문자/알림톡 채널)
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

import { useState, useRef, useEffect, useLayoutEffect, useCallback, useMemo } from 'react';
import {
  MessageSquare, Smartphone, Bell,
  SendHorizontal, Send,
  X, Search, Upload,
  PencilLine, FolderOpen, Contact,
  Asterisk, Archive, Save,
  Eye, ShieldCheck, Lock,
  CalendarClock, ChevronDown, Image as ImageIcon,
  Trash2, XCircle, RotateCcw, ChevronRight,
  Plus, Sparkles, Megaphone, Timer,
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
  cellToString,
  resolveRecipientCallback,
} from '../utils/formatDate';
import { insertAtCursorPos } from '../utils/textInsert';
import MmsImagePreview from './shared/MmsImagePreview';
import AiRefineModal from './AiRefineModal';
import SmsCharsetNotice from './SmsCharsetNotice';
import { hasUnsupportedSmsChars, SMS_CHARSET_BLOCK_MESSAGE } from '../utils/smsSafeChars';
import { findLinkDefectInText } from '../utils/link-check';
import AlimtalkChannelPanel, {
  validateAlimtalkChannelState,
  type AlimtalkChannelState,
  type AlimtalkSenderProfile,
  type AlimtalkTemplate,
} from './alimtalk/AlimtalkChannelPanel';
import AlimtalkVariableMappingPanel from './alimtalk/AlimtalkVariableMappingPanel';
import '../styles/direct-send.css';
// ★ 2026-09-25 보내기 전 점검(스팸 검사 · 맞춤법 검사) · 발송 바 · 발송 전 경고 · 요금제 안내
import DirectCheckTiles, { type SpamTileState, type SpellTileState } from './direct-send/DirectCheckTiles';
import DirectSpellModal from './direct-send/DirectSpellModal';
import SendSpamWarnModal, { type SendWarnVariant } from './direct-send/SendSpamWarnModal';
import SplitSendPopover from './direct-send/SplitSendPopover';
import TrialUpsellModal from './direct-send/TrialUpsellModal';
import {
  applySpellIssue, carrierLabel, dismissSendWarn, fetchRecentSpamCheck, fetchSendCheckStatus, isSendWarnDismissed,
  markSpellRowFixed, markSpellRowsByteBlocked, runDirectSpellCheck,
  type RecentSpamCheck, type SendCheckStatus, type SpellIssue, type SpellQuota, type SpellRow,
} from '../utils/send-checks';
import { useAuthStore } from '../stores/authStore';

// ============================================================
// Props 인터페이스
// ============================================================

export interface DirectSendPanelProps {
  // 메시지 state
  directSendChannel: 'sms' | 'kakao_alimtalk';
  setDirectSendChannel: (ch: 'sms' | 'kakao_alimtalk') => void;
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
  setSpamFilterData: (d: any) => void;
  setShowSpamFilter: (b: boolean) => void;
  /** ★ 2026-09-25 스팸 검사 창이 열려 있는가 — 닫히면 점검 칸이 검사 원장을 다시 본다 */
  spamModalOpen?: boolean;

  // ★ D152+ AI 다듬기 요금제 잠금 (BASIC 이상 + TRIAL만 활성, FREE/STARTER 잠금)
  isAiMessagingLocked?: boolean;

  // ★ 2026-07-04 미가입 보조기능 잠금 통일 — 스팸필터/AI 다듬기 클릭 시 요금제 업그레이드 모달(PlanUpgradeModal)
  /** 요금제가 필요한 기능을 눌렀을 때 — 공통 안내 창(PlanFeatureModal)의 기능 id(constants/plan-feature-intros.ts) */
  onLockedFeature: (featureId: string) => void;

  // 카카오 (알림톡 전용 — 문자는 건드리지 않음)
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
  // ★ D188 (2026-05-21) 영업팀장 신고 #7-(2): LMS 대체 제목 (L/B 시 필수).
  alimtalkNextSubject?: string;
  setAlimtalkNextSubject?: (v: string) => void;
  customerFieldOptions?: { key: string; label: string }[];

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

  // ★ D162-4 (2026-05-15) 2차: 직접발송 모달 헤더에서 알림톡 발송 풀 화면 모달 진입 callback.
  //   Harold님 명시 정합 — DashboardHeader 메뉴 대신 모달 내부에서 진입해 사용자 혼란 차단.
  onAlimtalkOpen?: () => void;
  /** ★ 2026-07-29 브랜드메시지 발송 풀 화면 진입. 알림톡과 같은 패턴이되 성격이 다르다 —
   *  알림톡은 검수된 템플릿을 고르러 가는 진입이고, 브랜드는 발신프로필만 있으면
   *  이 수신자에게 바로 쓰는 진입이다(자유형은 템플릿 코드를 요구하지 않는다). */
  onBrandOpen?: () => void;
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
    isSpamFilterLocked, setSpamFilterData, setShowSpamFilter, spamModalOpen = false,
    isAiMessagingLocked, onLockedFeature,
    kakaoTemplates, kakaoSelectedTemplate, setKakaoSelectedTemplate,
    kakaoTemplateVars, setKakaoTemplateVars,
    alimtalkFallback, setAlimtalkFallback,
    setKakaoMessage,
    alimtalkSenders = [],
    alimtalkProfileId = '',
    setAlimtalkProfileId,
    alimtalkNextContents = '',
    setAlimtalkNextContents,
    alimtalkNextSubject = '',
    setAlimtalkNextSubject,
    customerFieldOptions = [],
    setShowDirectPreview, setShowSpecialChars, setShowTemplateBox,
    setShowTemplateSave, setTemplateSaveName, loadTemplates,
    setShowAddressBook, setAddressGroups,
    onSendConfirm, setToast,
    lmsKeepAccepted, smsOverrideAccepted,
    setPendingBytes, setShowLmsConfirm, setShowSmsConvert,
    getFullMessage, getMaxByteMessage, formatPhoneNumber, formatRejectNumber,
    onClose,
    onAlimtalkOpen,
    onBrandOpen,
  } = props;

  // ★ D120: 커서 위치 기반 변수 삽입용 ref
  const directTextareaRef = useRef<HTMLTextAreaElement>(null);
  const directCursorPosRef = useRef<number>(0);

  // ★ D152+ (PDF 0511 funnel fix): AI 인라인 다듬기 모달 토글.
  //   STARTER 이상 + TRIAL 자동. CT-17 ai_messaging_enabled 게이팅은 백엔드에서.
  const [showAiRefineModal, setShowAiRefineModal] = useState(false);

  // ★ 2026-08-16 옛 진입 안내 팝업의 glow 리스너 쌍 제거(설계서 §5-1 B) — dispatch 측(Dashboard)과 함께 폐기.

  // ★ D224+ (2026-05-27) 영업팀장 박성용 신고 #2 fix: DirectSendPanel unmount 시 body.style.overflow='' reset 영구 안전망.
  //   옛 D218+ = AlimtalkSendModal:427~438 useEffect 안전망만 추가됨 + DirectSendPanel 대칭 안전망 누락 사고.
  //   외부 다른 모달이 body.overflow='hidden' 적용 후 cleanup 누락 시 DirectSendPanel 안 스크롤 영구 차단 사고 영구 차단.
  //   (AlimtalkSendModal:427~438 패턴 정확 미러)
  useEffect(() => {
    return () => {
      if (typeof document !== 'undefined' && document.body) {
        document.body.style.overflow = '';
      }
    };
  }, []);

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

  // ★ D137 UI: 회신번호 커스텀 드롭다운 (native select 대체 — 5개 이상 스크롤 + 검색)
  const [callbackMenuOpen, setCallbackMenuOpen] = useState(false);
  const [callbackSearch, setCallbackSearch] = useState('');
  const callbackMenuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!callbackMenuOpen) return;
    const handler = (e: MouseEvent) => {
      if (callbackMenuRef.current && !callbackMenuRef.current.contains(e.target as Node)) {
        setCallbackMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [callbackMenuOpen]);
  useEffect(() => {
    if (!callbackMenuOpen) setCallbackSearch('');
  }, [callbackMenuOpen]);

  // ============================================================
  // 내부 state
  // ============================================================
  // ★ D137 UI: 초기엔 아무것도 선택되지 않은 상태 (파일등록이 디폴트처럼 보이는 현상 제거)
  const [directInputMode, setDirectInputMode] = useState<'file' | 'direct' | 'address' | null>(null);
  const [directDragActive, setDirectDragActive] = useState(false);
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
  // ★ 2026-09-25 보내기 전 점검 (설계 docs/2026-09-25-direct-send-precheck-design.md)
  //   스팸 검사 = 검사 원장(최근 24시간 · 같은 발신번호 · 같은 문안)으로 판정한다(화면 기억이 아니다).
  //   맞춤법 = 미가입 월 5회 · 요금제 무제한(서버가 센다). 글이 바뀌는 것은 [고치기]를 누를 때뿐이다.
  // ============================================================
  const authUserId = useAuthStore((st) => st.user?.id || '');
  const [checkStatus, setCheckStatus] = useState<SendCheckStatus | null>(null);
  const refreshCheckStatus = useCallback(async () => {
    const st = await fetchSendCheckStatus();
    if (st) setCheckStatus(st);
    return st;
  }, []);
  useEffect(() => { void refreshCheckStatus(); }, [refreshCheckStatus]);

  /** 스팸 검사에 싣는 글 — 검사 창과 최근 검사 조회가 같은 계산을 쓴다(두 벌이면 "검사했는데 안 했다"가 된다) */
  const buildSpamTestContent = () => {
    const msg = directMessage || '';
    const firstR = directRecipients[0];
    const replaceVars = (text: string) => {
      if (!text || !firstR) return text;
      return replaceDirectVars(text, firstR, selectedCallback);
    };
    const smsRaw = buildAdMessageFront(msg, 'SMS', adTextEnabled, optOutNumber);
    const lmsRaw = buildAdMessageFront(msg, 'LMS', adTextEnabled, optOutNumber);
    const smsMsg = replaceVars(smsRaw);
    const lmsMsg = replaceVars(lmsRaw);
    return { smsMsg, lmsMsg, firstR };
  };

  const [spamCheck, setSpamCheck] = useState<RecentSpamCheck | null>(null);
  const [spamEverChecked, setSpamEverChecked] = useState(false);
  const spamSeqRef = useRef(0);
  const refreshSpamCheck = async (): Promise<RecentSpamCheck | null> => {
    const seq = ++spamSeqRef.current;
    // 수신자별 회신번호는 지금 스팸 검사가 쓸 발신번호가 없다 — 판정하지 않는다
    if (useIndividualCallback || !selectedCallback || !directMessage.trim()) {
      setSpamCheck(null);
      return null;
    }
    const { smsMsg, lmsMsg } = buildSpamTestContent();
    const r = await fetchRecentSpamCheck({
      callbackNumber: selectedCallback, messageType: directMsgType, messageContentSms: smsMsg, messageContentLms: lmsMsg,
    });
    if (seq !== spamSeqRef.current) return r; // 그 사이 더 새 조회가 시작됐다
    setSpamCheck(r);
    if (r.checked) setSpamEverChecked(true);
    return r;
  };
  const refreshSpamCheckRef = useRef(refreshSpamCheck);
  refreshSpamCheckRef.current = refreshSpamCheck;
  // 글·발신번호·종류가 바뀌면 0.7초 뒤 원장을 다시 본다
  useEffect(() => {
    const t = setTimeout(() => { void refreshSpamCheckRef.current(); }, 700);
    return () => clearTimeout(t);
  }, [directMessage, selectedCallback, directMsgType, adTextEnabled, optOutNumber, useIndividualCallback, directRecipients]);
  // 검사 창이 닫히면(끝났든 창만 닫았든) 원장과 체험 횟수를 다시 본다
  const prevSpamModalOpenRef = useRef(spamModalOpen);
  useEffect(() => {
    if (prevSpamModalOpenRef.current && !spamModalOpen) {
      void refreshSpamCheckRef.current();
      void refreshCheckStatus();
    }
    prevSpamModalOpenRef.current = spamModalOpen;
  }, [spamModalOpen, refreshCheckStatus]);
  // 검사가 진행 중이면(창을 닫고 계속 쓰는 동안) 5초마다 결과를 따라간다
  useEffect(() => {
    if (spamCheck?.verdict !== 'running' || spamModalOpen) return;
    const t = setInterval(() => { void refreshSpamCheckRef.current(); }, 5000);
    return () => clearInterval(t);
  }, [spamCheck?.verdict, spamModalOpen]);

  const spamTrialEligible = !!checkStatus?.spamTrial?.eligible;
  const spamTrialRemaining = spamTrialEligible ? Math.max(0, Number(checkStatus?.spamTrial?.remaining ?? 0)) : null;
  const carriersOf = (r: RecentSpamCheck | null) =>
    ((r?.verdict === 'warn' ? r?.missingCarriers : r?.blockedCarriers) || []).map(carrierLabel).join(' · ') || '통신사';
  const spamCarriersText = carriersOf(spamCheck);
  const spamTileState: SpamTileState = (() => {
    if (spamCheck?.checked && spamCheck.verdict) return spamCheck.verdict;
    if (isSpamFilterLocked && checkStatus && !(spamTrialEligible && (spamTrialRemaining ?? 0) > 0)) return 'locked';
    return spamEverChecked ? 'stale' : 'todo';
  })();

  // ── 맞춤법 ──
  const [spellRows, setSpellRows] = useState<SpellRow[]>([]);
  const [spellText, setSpellText] = useState<string | null>(null);
  const [spellRunning, setSpellRunning] = useState(false);
  const [spellModalOpen, setSpellModalOpen] = useState(false);
  const [upsell, setUpsell] = useState<'spam' | 'spell' | null>(null);
  const directMessageRef = useRef(directMessage);
  directMessageRef.current = directMessage;
  const spellStale = spellText !== null && spellText !== directMessage;
  const spellOpenCount = spellStale ? 0 : spellRows.filter((r) => r.status === 'open').length;
  const spellUnlimited = !!checkStatus?.spell?.unlimited;
  const spellFreeRemaining = checkStatus && !spellUnlimited ? Math.max(0, Number(checkStatus.spell?.remaining ?? 0)) : null;
  const spellTileState: SpellTileState = spellRunning ? 'running'
    : spellText === null ? (spellFreeRemaining === 0 ? 'locked' : 'todo')
    : spellStale ? (spellFreeRemaining === 0 ? 'locked' : 'stale')
    : spellOpenCount > 0 ? 'issues' : 'clean';
  // 단문 바이트 잠금 — 화면 바이트 표시와 같은 계산(명단 최장 값 · (광고) · 수신거부 줄 포함). 창이 열려 있을 때만 센다(명단이 크면 무겁다).
  const spellRowsView = useMemo(() => {
    if (!spellModalOpen || spellStale) return spellRows;
    const measure = directMsgType === 'SMS'
      ? (t: string) => calculateSmsBytes(getFullMessage(getMaxByteMessage(t, directRecipients, DIRECT_VAR_TO_FIELD)))
      : null;
    return markSpellRowsByteBlocked(directMessage, spellRows, measure);
  }, [spellModalOpen, spellStale, spellRows, directMsgType, directMessage, directRecipients, adTextEnabled, optOutNumber]);

  const runSpell = async () => {
    const text = directMessage;
    if (!text.trim()) { setToast({ show: true, type: 'error', message: '맞춤법을 볼 글을 먼저 적어 주세요.' }); return; }
    if (spellFreeRemaining === 0) { setUpsell('spell'); return; }
    setSpellRunning(true);
    const r = await runDirectSpellCheck(text);
    setSpellRunning(false);
    if (!r.ok) {
      if (r.code === 'SPELL_FREE_EXHAUSTED') { void refreshCheckStatus(); setUpsell('spell'); return; }
      setToast({ show: true, type: 'error', message: r.error });
      return;
    }
    if (r.spell) setCheckStatus((prev) => (prev ? { ...prev, spell: r.spell as SpellQuota } : prev));
    if (r.failed) {
      setToast({ show: true, type: 'error', message: '맞춤법 검사를 하지 못했어요. 잠시 뒤 다시 눌러 주세요. 이번 검사는 횟수에서 빠져요.' });
      return;
    }
    setSpellText(text);
    setSpellRows(r.issues.map((issue) => ({ issue, status: 'open' as const })));
    if (r.issues.length === 0) setToast({ show: true, type: 'success', message: '고칠 곳이 없어요.' });
    else if (directMessageRef.current === text) setSpellModalOpen(true);
  };
  const onSpellTile = () => {
    if (spellTileState === 'running') return;
    if (spellTileState === 'locked') { setUpsell('spell'); return; }
    if (spellTileState === 'issues') { setSpellModalOpen(true); return; }
    if (spellTileState === 'clean') { setToast({ show: true, type: 'success', message: '고칠 곳이 없어요. 글을 고치면 다시 검사할 수 있어요.' }); return; }
    void runSpell();
  };
  const closeSpellIfDone = (rows: SpellRow[]) => {
    if (!rows.some((r) => r.status === 'open')) setTimeout(() => setSpellModalOpen(false), 300);
  };
  const fixSpellIssue = (issue: SpellIssue) => {
    const cur = directMessageRef.current;
    if (spellText !== cur) {
      setSpellModalOpen(false);
      setToast({ show: true, type: 'warning', message: '글이 바뀌었어요. 맞춤법을 다시 검사해 주세요.' });
      return;
    }
    if (spellRowsView.find((r) => r.issue.id === issue.id)?.issue.blocked) return;
    const next = applySpellIssue(cur, issue);
    if (next === cur) {
      const rows = spellRows.map((r) => (r.issue.id === issue.id ? { ...r, status: 'kept' as const } : r));
      setSpellRows(rows); closeSpellIfDone(rows);
      return;
    }
    const rows = markSpellRowFixed(spellRows, issue);
    setDirectMessage(next);
    setSpellText(next);
    setSpellRows(rows);
    closeSpellIfDone(rows);
  };
  const keepSpellIssue = (issue: SpellIssue) => {
    const rows = spellRows.map((r) => (r.issue.id === issue.id ? { ...r, status: 'kept' as const } : r));
    setSpellRows(rows);
    closeSpellIfDone(rows);
  };
  const fixAllSpell = () => {
    const cur = directMessageRef.current;
    if (spellText !== cur) { setSpellModalOpen(false); return; }
    const targets = spellRowsView.filter((r) => r.status === 'open' && !r.issue.blocked).map((r) => r.issue.id);
    let text = cur;
    let rows = spellRows;
    for (const id of targets) {
      const row = rows.find((r) => r.issue.id === id);
      if (!row || row.status !== 'open') continue;
      const next = applySpellIssue(text, row.issue);
      if (next === text) continue;
      rows = markSpellRowFixed(rows, row.issue);
      text = next;
    }
    setDirectMessage(text);
    setSpellText(text);
    setSpellRows(rows);
    setToast({ show: true, type: 'success', message: '고칠 곳을 고쳤어요.' });
    closeSpellIfDone(rows);
  };
  const openAiRefineFromSpell = () => {
    if (isAiMessagingLocked) { onLockedFeature('ai-refine'); return; }
    if (!directMessage.trim()) { setToast({ show: true, type: 'error', message: '다듬을 메시지를 입력해주세요' }); return; }
    setSpellModalOpen(false);
    setShowAiRefineModal(true);
  };
  const spellQuotaText = spellUnlimited
    ? '맞춤법 검사는 크레딧이 들지 않아요'
    : `이번 달 무료 ${spellFreeRemaining ?? 0}/${checkStatus?.spell?.limit ?? 5}회 남음 · 요금제는 무제한`;

  // ── 본문 칸: 창(전체 화면) 높이를 채우고 넘치면 칸 안 스크롤 + 미리보기 안내 ──
  const editorScrollRef = useRef<HTMLDivElement>(null);
  const [editorOverflow, setEditorOverflow] = useState(false);
  const syncEditorOverflow = useCallback(() => {
    const box = editorScrollRef.current;
    setEditorOverflow(!!box && box.scrollHeight - box.clientHeight > 2);
  }, []);
  const syncEditorHeight = useCallback(() => {
    const ta = directTextareaRef.current;
    const box = editorScrollRef.current;
    if (ta) {
      const keep = box ? box.scrollTop : 0;
      ta.style.height = '0px';
      ta.style.height = `${ta.scrollHeight}px`;
      if (box) box.scrollTop = keep;
    }
    syncEditorOverflow();
  }, [syncEditorOverflow]);
  useLayoutEffect(() => { syncEditorHeight(); }, [directMessage, directMsgType, adTextEnabled, mmsUploadedImages.length, directSendChannel, syncEditorHeight]);
  useEffect(() => {
    window.addEventListener('resize', syncEditorHeight);
    return () => window.removeEventListener('resize', syncEditorHeight);
  }, [syncEditorHeight]);
  /** 글 아래 빈 곳을 눌러도 글 끝에서 이어 쓴다 */
  const focusEditorFromBlank = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget) return;
    e.preventDefault();
    const ta = directTextareaRef.current;
    if (!ta) return;
    ta.focus();
    const n = ta.value.length;
    ta.setSelectionRange(n, n);
    directCursorPosRef.current = n;
  };
  const openDirectPreview = () => {
    if (!directMessage.trim()) { setToast({ show: true, type: 'error', message: '메시지를 입력해주세요' }); return; }
    setShowDirectPreview(true);
  };

  // ── 분할 풍선 · 발송 전 경고 ──
  const [splitOpen, setSplitOpen] = useState(false);
  const [sendWarn, setSendWarn] = useState<{ variant: SendWarnVariant; carriersText: string } | null>(null);
  const [sendBusy, setSendBusy] = useState(false);
  /** [전송하기] 직전 — 스팸 검사를 안 했거나(24시간 안 · 같은 문안) 막혔거나 끝나지 않았으면, 맞춤법 고칠 곳이 남았으면 묻는다 */
  const decideSendWarn = async (): Promise<{ variant: SendWarnVariant; carriersText: string } | null> => {
    let variant: SendWarnVariant | null = null;
    let carriersText = '';
    if (!useIndividualCallback && selectedCallback) {
      const pre = await refreshSpamCheck();
      if (pre?.checked && pre.verdict && pre.verdict !== 'pass') {
        variant = pre.verdict;
        carriersText = carriersOf(pre);
      } else if (!pre?.checked && !isSendWarnDismissed(authUserId)) {
        variant = 'none';
      }
    }
    if (!variant && spellOpenCount > 0) variant = 'spell';
    return variant ? { variant, carriersText } : null;
  };

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
    // ★ 2026-09-10 문자로 보낼 수 없는 글자가 남아 있으면 발송하지 않는다(설계 D2 · 본문 아래 안내에서 바꾼다)
    if (hasUnsupportedSmsChars(directMessage, directMsgType === 'SMS' ? '' : directSubject)) {
      setToast({ show: true, type: 'error', message: SMS_CHARSET_BLOCK_MESSAGE });
      return;
    }
    // ★2026-09-22 본문에 실존하지 않는 도메인이 있으면 보내지 않는다 — 받는 사람이 눌러도 안 열린다.
    //   서버도 같은 판정으로 막지만(차감 앞) 여기서 먼저 알려 주면 왕복이 없다. 판정은 공용 CT가 소유한다.
    //   단문은 제목을 싣지 않으므로(위 글자 검사와 같은 축) 숨은 제목의 링크로 막지 않는다.
    const linkDefect = findLinkDefectInText(directMessage) || findLinkDefectInText(directMsgType === 'SMS' ? '' : directSubject, '제목의 링크는');
    if (linkDefect) {
      setToast({ show: true, type: 'error', message: linkDefect });
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

    // ★ 2026-09-25 보내기 전 경고 — 스팸 검사 안 함·막힘·미완료 · 맞춤법 고칠 곳 남음이면 먼저 묻는다(막지는 않는다)
    setSendBusy(true);
    try {
      const warn = await decideSendWarn();
      if (warn) { setSendWarn(warn); return; }
    } finally {
      setSendBusy(false);
    }
    await stageAndConfirm();
  };

  /** 수신자 적재 → 서버 집계 → 전송 확인 창(★ 2026-09-25 경고 창의 [그냥 보내기]도 여기로 온다) */
  const stageAndConfirm = async () => {
    const token = localStorage.getItem('token') || '';
    // ★ 2026-06-04 재배치: 모달 전에 staging 적재 → 서버 count(중복/수신거부)로 모달 카운트.
    //   옛 phones 통째 POST(/unsubscribes/check) + 프론트 중복 계산 폐기 — 대량(50만+)에서도 안 죽고
    //   commit/worker와 숫자가 정확히 일치. 청크(5만) 적재라 body 한도·timeout 무관.
    const CHUNK = 50000;
    let stagingId: string | undefined;
    for (let i = 0; i < directRecipients.length; i += CHUNK) {
      const slice = directRecipients.slice(i, i + CHUNK).map((r: any) => ({
        phone: r.phone,
        name: cellToString(r.name),
        extra1: cellToString(r.extra1),
        extra2: cellToString(r.extra2),
        extra3: cellToString(r.extra3),
        callback: resolveRecipientCallback(r, useIndividualCallback, individualCallbackColumn) || r.callback || null,
      }));
      const stageRes = await fetch('/api/campaigns/direct-send/stage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ stagingId, recipients: slice }),
      });
      const stageData = await stageRes.json();
      if (!stageData.success) {
        setToast({ show: true, type: 'error', message: `수신자 업로드 실패: ${stageData.error || ''}` });
        return;
      }
      stagingId = stageData.stagingId;
    }
    const countRes = await fetch('/api/campaigns/direct-send/count', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ stagingId, dedupEnabled, unsubFilterEnabled }),
    });
    const countData = await countRes.json();
    if (!countData.success) {
      setToast({ show: true, type: 'error', message: countData.error || '발송 대상 집계에 실패했습니다.' });
      return;
    }

    onSendConfirm({
      show: true,
      type: reserveEnabled ? 'scheduled' : 'immediate',
      count: countData.sendCount,
      unsubscribeCount: countData.unsubscribeCount,
      duplicateCount: countData.duplicateCount,
      dateTime: reserveEnabled && reserveDateTime ? reserveDateTime : undefined,
      from: 'direct',
      msgType: directMsgType,
      dedupEnabled,
      unsubFilterEnabled,
      stagingId,
    });
  };

  const onWarnCheckSpam = () => { setSendWarn(null); void handleSpamFilter(); };
  const onWarnSendAnyway = (dismiss24h: boolean) => {
    if (dismiss24h && sendWarn?.variant === 'none') dismissSendWarn(authUserId);
    setSendWarn(null);
    void stageAndConfirm();
  };
  const onWarnOpenSpell = () => {
    setSendWarn(null);
    if (spellRows.length > 0 && !spellStale) setSpellModalOpen(true);
    else void runSpell();
  };

  // 알림톡 전송
  const handleAlimtalkSend = async () => {
    if (directRecipients.length === 0) { setToast({ show: true, type: 'error', message: '수신자를 추가해주세요' }); return; }
    if (!kakaoSelectedTemplate) { setToast({ show: true, type: 'error', message: '템플릿을 선택해주세요' }); return; }
    if (!['approved', 'APPROVED', 'APR', 'A'].includes(kakaoSelectedTemplate.status)) { setToast({ show: true, type: 'error', message: '승인된 템플릿만 발송 가능합니다' }); return; }
    // ★ D224+ (2026-05-27) 영업팀장 박성용 신고 fix: frontend self-fail-safe 검증 분기 추가 (AlimtalkSendModal:371~384 패턴 미러).
    //   옛 사고 = 본 함수 검증 누락 → backend 진입 후 catch → toast 발생 + 사용자 혼란.
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
  const handleSpamFilter = async () => {
    // ★ 2026-09-25 요금제에 스팸 검사가 없는 회사 = 무료 체험 3회(서버가 센다) · 다 쓰면 요금제 안내 창
    if (isSpamFilterLocked) {
      const st = checkStatus || await refreshCheckStatus();
      if (st?.spamTrial?.eligible) {
        if ((st.spamTrial.remaining ?? 0) <= 0) { setUpsell('spam'); return; }
      } else {
        onLockedFeature('check-spam');
        return;
      }
    }
    if (!directRecipients || directRecipients.length === 0) {
      setToast({ show: true, type: 'error', message: '발송리스트를 먼저 업로드해주세요.' });
      return;
    }
    const cb = selectedCallback || '';
    const { smsMsg, lmsMsg, firstR } = buildSpamTestContent();
    setSpamFilterData({ sms: smsMsg, lms: lmsMsg, callback: cb, msgType: directMsgType, subject: directSubject || '', isAd: adTextEnabled, firstRecipient: firstR || undefined });
    setShowSpamFilter(true);
  };
  const onSpamTile = () => {
    if (spamTileState === 'running') return;
    void handleSpamFilter();
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
          // ★ D137 (0424): 원본 파일 헤더 키 보존 — 개별회신번호 매핑 (r[individualCallbackColumn])이
          // 미리보기/CT-08 resolveRecipientCallback에서 원본 헤더로 값 접근하기 때문.
          // D99 원칙: "축소된 객체에서 resolveRecipientCallback 호출 금지" 준수.
          ...row,
          phone,
          // ★ D150-3 (2026-05-09) PDF #5: 0/'0' 값 보존 (cellToString — null/undefined만 빈문자열)
          name: directColumnMapping.name ? cellToString(row[directColumnMapping.name]) : '',
          extra1: directColumnMapping.extra1 ? cellToString(row[directColumnMapping.extra1]) : '',
          extra2: directColumnMapping.extra2 ? cellToString(row[directColumnMapping.extra2]) : '',
          extra3: directColumnMapping.extra3 ? cellToString(row[directColumnMapping.extra3]) : '',
          callback: directColumnMapping.callback ? normalizePhoneKr(row[directColumnMapping.callback]) : '',
        };
        if (directSendChannel === 'kakao_alimtalk' && kakaoSelectedTemplate) {
          const vars = kakaoSelectedTemplate.content?.match(/#{[^}]+}/g) || [];
          const varValues: Record<string, string> = {};
          vars.forEach((varName: string, vi: number) => {
            const mappedCol = (directColumnMapping as any)[`tplvar_${vi}`];
            if (mappedCol) varValues[varName] = cellToString(row[mappedCol]);
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
    <div
      className="ds-scope ds-backdrop"
      onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }}
      onDrop={(e) => { e.preventDefault(); e.stopPropagation(); }}
    >
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

          <div className="flex items-center gap-2">
            {/* ★ 2026-07-31 채널 전환 버튼 재작성 — 옅은 outline 칩이라 창닫기와 구분이 안 됐다.
                발송 채널을 바꾸는 동작이라 화면에서 가장 무거운 축이어야 한다.
                아이콘을 그라데이션 타일로 세우고 라벨 아래 한 줄 설명을 붙여 눌러야 할 것으로 읽히게 한다.
                (0515에 카카오 노란색이 튄다고 톤다운한 이력이 있어, 색은 면이 아니라 아이콘에만 쓴다) */}
            {onAlimtalkOpen && (
              <button
                type="button"
                onClick={onAlimtalkOpen}
                className="group inline-flex items-center gap-2.5 pl-2 pr-3.5 py-1.5 rounded-xl bg-white ring-1 ring-slate-200 shadow-sm hover:ring-amber-300 hover:shadow-md transition text-left"
                title="알림톡 발송 화면으로 전환"
              >
                <span className="w-7 h-7 rounded-lg bg-gradient-to-br from-amber-400 to-orange-500 flex items-center justify-center shadow-sm shadow-amber-500/30 shrink-0">
                  <Bell size={14} strokeWidth={2} className="text-white" />
                </span>
                <span className="leading-tight">
                  <span className="block text-[13px] font-semibold text-slate-800">알림톡 발송</span>
                  <span className="hidden lg:block text-[10px] text-slate-400">검수 템플릿으로 보내기</span>
                </span>
              </button>
            )}
            {/* ★ 2026-07-29 브랜드메시지 — 요금제 제한 없이 전체 개방. 채널 연동(발신프로필)만 전제다. */}
            {onBrandOpen && (
              <button
                type="button"
                onClick={onBrandOpen}
                className="group inline-flex items-center gap-2.5 pl-2 pr-3.5 py-1.5 rounded-xl bg-white ring-1 ring-slate-200 shadow-sm hover:ring-violet-300 hover:shadow-md transition text-left"
                title="브랜드메시지 발송 화면으로 전환"
              >
                <span className="w-7 h-7 rounded-lg bg-gradient-to-br from-violet-500 to-fuchsia-500 flex items-center justify-center shadow-sm shadow-violet-500/30 shrink-0">
                  <Megaphone size={14} strokeWidth={2} className="text-white" />
                </span>
                <span className="leading-tight">
                  <span className="block text-[13px] font-semibold text-slate-800">브랜드메시지</span>
                  <span className="hidden lg:block text-[10px] text-slate-400">검수 없이 바로 보내기</span>
                </span>
              </button>
            )}
            <button className="ds-close-btn ds-t" onClick={onClose}>
              <X size={14} strokeWidth={1.75} />
              <span>창닫기</span>
            </button>
          </div>
        </header>

        {/* ============ 2컬럼 body ============ */}
        <div className="ds-modal__body">

          {/* ====== 좌측: 메시지 에디터 ====== */}
          <section className="ds-section">

            {/* ★ D162-4 (2026-05-15) 2차: Harold님 명시 — 채널 탭 자체 제거.
                직접발송 = 문자(SMS/LMS/MMS) 단일 모드.
                알림톡은 헤더의 카카오 노란색 '알림톡 발송' 버튼으로 진입 → AlimtalkSendModal 풀 화면.
                directSendChannel state는 'sms' 고정 (mount 시 Dashboard.onDirectSend가 강제 reset).
                ★ 2026-08-17 죽어 있던 RCS 분기 제거 — 남겨 두면 그 state를 재사용하는 순간
                  차감만 되고 적재는 0건인 경로가 살아난다(백엔드 화이트리스트로도 함께 막았다). */}

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
                      <span className="ds-ad-prefix ds-ad-prefix--subject absolute left-[12px] top-1/2 -translate-y-1/2">(광고)</span>
                    )}
                    <input
                      type="text"
                      value={directSubject}
                      onChange={(e) => setDirectSubject(e.target.value)}
                      placeholder="제목을 입력해주세요 (필수)"
                      className="ds-subject-in"
                      style={adTextEnabled ? { paddingLeft: 54 } : undefined}
                    />
                  </div>
                )}

                {/* 본문 에디터 — ★ 2026-09-25 (광고) · 본문 · 수신거부 줄이 한 흐름(Harold "자동부착은 메세지창 안에 고정").
                    본문 칸은 창(전체 화면) 높이를 채우고, 넘치면 칸 안에서 스크롤 + 미리보기 안내. */}
                <div className="ds-editor-wrap ds-t">
                  <div
                    ref={editorScrollRef}
                    className="ds-editor-body ds-editor-flow"
                    onMouseDown={focusEditorFromBlank}
                    onScroll={syncEditorOverflow}
                  >
                    {adTextEnabled && (
                      <span className="ds-ad-prefix absolute left-0 top-0 z-10">(광고)</span>
                    )}
                    <textarea
                      ref={directTextareaRef}
                      rows={1}
                      data-char-target="direct"
                      value={directMessage}
                      onChange={(e) => { setDirectMessage(e.target.value); directCursorPosRef.current = e.target.selectionStart; }}
                      onSelect={(e) => { directCursorPosRef.current = (e.target as HTMLTextAreaElement).selectionStart; }}
                      placeholder="전송하실 내용을 입력하세요."
                      spellCheck={false}
                      style={adTextEnabled ? { textIndent: 52 } : undefined}
                    />
                    {adTextEnabled && (
                      <div className="ds-optout-line" title="광고 문자에 자동으로 붙는 문구라 고칠 수 없어요">
                        <Lock size={12} strokeWidth={2} />
                        <span className="ds-num">{getAdSuffix()}</span>
                        <small>자동으로 붙어요</small>
                      </div>
                    )}
                  </div>
                  {editorOverflow && (
                    <div className="ds-editor-more">
                      글이 길어 아래가 가려져 있어요
                      <button type="button" onClick={openDirectPreview}>미리보기로 한 번에 보기</button>
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

                  {/* 편집 칸 안 도구 줄 — 줄바꿈 금지(버튼은 줄지 않는다) */}
                  <div className="ds-editor-tools">
                    <div className="ds-editor-tools__l">
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
                        <div className="ds-var-wrap" ref={varMenuRef}>
                          <button
                            type="button"
                            className={`ds-util ds-util--line ds-t ${varMenuOpen ? 'ds-var-trigger--on' : ''}`}
                            onClick={() => setVarMenuOpen(o => !o)}
                          >
                            <Plus size={13} strokeWidth={2} />
                            <span>변수</span>
                            <ChevronDown size={12} strokeWidth={2} className={`ds-var-chev ${varMenuOpen ? 'ds-var-chev--open' : ''}`} />
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
                    <div className="ds-editor-tools__r">
                      <span className={`ds-bytes ${messageBytes > maxBytes ? 'ds-bytes--over' : messageBytes >= maxBytes * 0.8 ? 'ds-bytes--warn' : ''}`}>
                        <b>{messageBytes.toLocaleString()}</b> / {maxBytes.toLocaleString()} <small>byte</small>
                      </span>
                      <button type="button" className="ds-util ds-util--preview ds-t" onClick={openDirectPreview}>
                        <Eye size={13} strokeWidth={1.9} />
                        <span>미리보기</span>
                      </button>
                    </div>
                  </div>
                </div>

                {/* ★ 2026-09-10 문자로 보낼 수 없는 글자 — 누르면 본문·제목을 대체표로 바꾼다 */}
                <SmsCharsetNotice
                  texts={[directMessage, directMsgType === 'SMS' ? '' : directSubject]}
                  onApply={(fix) => {
                    setDirectMessage((prev) => fix(prev));
                    if (directMsgType !== 'SMS' && fix(directSubject) !== directSubject) setDirectSubject(fix(directSubject));
                  }}
                />

                {/* ★ 2026-09-25 보내기 전 점검 — 스팸 검사 · 맞춤법 검사(설계 docs/2026-09-25-direct-send-precheck-design.md §2) */}
                <DirectCheckTiles
                  spam={{ state: spamTileState, trialRemaining: spamTrialRemaining, carriersText: spamCarriersText }}
                  spell={{ state: spellTileState, openCount: spellOpenCount, freeRemaining: spellFreeRemaining, freeLimit: checkStatus?.spell.limit ?? null }}
                  onSpam={onSpamTile}
                  onSpell={onSpellTile}
                />
              </>
            )}

            {/* ★ 2026-08-17 RCS 채널 블록 제거 — 진입 동선이 없는 죽은 분기였고, 그 안의
                "미지원 단말은 SMS/LMS로 자동 폴백" 안내는 실제로 그렇게 동작한 적이 없다(중계 규격에
                대체문자 필드 자체가 없다). 채널·개통·대체발송을 함께 여는 설계 =
                docs/2026-08-17-rcs-integration-design.md */}

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
                    // ★ D224+ (2026-05-27) 영업팀장 박성용 신고 fix: LMS 대체 제목 매핑 누락 정정.
                    //   옛 사고 = AlimtalkChannelPanel 안 사용자 입력 nextSubject 값이 DirectSendPanel state에 반영 X → backend payload alimtalkNextSubject = '' 영구 사고.
                    nextSubject: alimtalkNextSubject,
                  }}
                  onChange={(v: AlimtalkChannelState) => {
                    if (setAlimtalkProfileId) setAlimtalkProfileId(v.profileId);
                    const nextTpl = kakaoTemplates.find((t: any) => t.id === v.templateId) || null;
                    setKakaoSelectedTemplate(nextTpl);
                    setKakaoTemplateVars(v.variableMap);
                    setAlimtalkFallback(v.nextType);
                    if (setAlimtalkNextContents) setAlimtalkNextContents(v.nextContents);
                    // ★ D224+ (2026-05-27) 영업팀장 박성용 신고 fix: nextSubject 변경 시 state 반영 (옛 D188 setter 호출 누락 정정).
                    if (setAlimtalkNextSubject) setAlimtalkNextSubject(v.nextSubject || '');
                  }}
                />
                <button
                  type="button"
                  className="ds-btn-primary ds-btn-primary--blue ds-t"
                  onClick={handleAlimtalkSend}
                  disabled={!kakaoSelectedTemplate || !['approved', 'APPROVED', 'APR', 'A'].includes(kakaoSelectedTemplate?.status)}
                >
                  <Bell size={17} strokeWidth={2} />
                  <span>{!kakaoSelectedTemplate ? '템플릿을 선택해주세요' : (directRecipients.length > 0 ? `${directRecipients.length.toLocaleString()}명에게 알림톡 발송` : '알림톡 발송하기')}</span>
                </button>
              </>
            )}
          </section>

          {/* 구분선 */}
          <div className="ds-modal__vdiv" />

          {/* ====== 우측: 수신자 관리 ====== */}
          <section className="ds-recipients flex flex-col gap-4 min-w-0">

            {/* ★ D162-4 (2026-05-15) PDF 0515 알림톡 #1: 알림톡 채널일 때만 변수 매칭 박스 노출.
                Harold님 명시 "우측에 고객데이터 올렸을때 매칭되는 화면" + ALIMTALK-DESIGN.md §6-3-D 정합.
                문자는 영향 0 — 분기 조건으로 알림톡만 표시. */}
            {directSendChannel === 'kakao_alimtalk' && (
              <AlimtalkVariableMappingPanel
                selectedTemplate={kakaoSelectedTemplate}
                variableMap={kakaoTemplateVars}
                onVariableMapChange={(next) => setKakaoTemplateVars(next)}
                customerFieldOptions={customerFieldOptions}
                sampleRecipient={directRecipients[0] || null}
                recipientCount={directRecipients.length}
              />
            )}

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
                  // ★ D150-3 (2026-05-09) PDF #5: 0/'0' 값 컬럼도 헤더 표시되도록 falsy → null/undefined 체크
                  ? (['name', 'callback', 'extra1', 'extra2', 'extra3'] as const).filter(f => directRecipients.some(r => r[f] != null && String(r[f]).trim() !== ''))
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
                      {activeFields.length > 0 ? (
                        <div className="ds-head-extra">
                          {activeFields.map(f => (
                            <span key={f} className="flex-1 min-w-0">{DIRECT_FIELD_LABELS[f] || f}</span>
                          ))}
                        </div>
                      ) : <span />}
                    </div>

                    {/* 바디 */}
                    {directRecipients.length === 0 ? (
                      <div className="ds-list-empty">
                        <div
                          className={`ds-dropzone ds-t w-full ${directDragActive ? 'ds-dropzone--active' : ''}`}
                          onClick={() => {
                            const input = document.querySelector<HTMLInputElement>('.ds-rtab--label input[type="file"]');
                            input?.click();
                          }}
                          onDragEnter={(e) => { e.preventDefault(); e.stopPropagation(); setDirectDragActive(true); }}
                          onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); setDirectDragActive(true); }}
                          onDragLeave={(e) => { e.preventDefault(); e.stopPropagation(); setDirectDragActive(false); }}
                          onDrop={(e) => {
                            e.preventDefault(); e.stopPropagation();
                            setDirectDragActive(false);
                            const file = e.dataTransfer?.files?.[0];
                            if (file) handleFileUpload(file);
                          }}
                        >
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
                            <span className="ds-btn-sec px-4 pointer-events-none border border-emerald-200 bg-emerald-50 text-emerald-700">
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
                                    const raw = r[f];
                                    const v = raw ? (f === 'callback' ? formatPhoneNumber(raw) : String(raw)) : '-';
                                    return (
                                      <span key={f} className={f === 'callback' ? 'ds-cell-callback' : ''}>
                                        <span className="val" title={v}>{v}</span>
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

            {/* 하단 액션 — 우측 섹션 하단 (원래 자리) */}
            <div className="ds-bottom-actions">
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

        {/* ============ ★ 2026-09-25 발송 바 — 왼쪽 열에 맞춘 옵션 3칸(예약·분할·광고) + 발신번호 · 전송 ============
            발신번호 고르기는 옛 본문 아래 줄에서 옮겨 왔다(원본 그대로 · 위로 열린다). 두 곳에 두지 않는다. */}
        {directSendChannel === 'sms' && (() => {
                  const phoneHeaders = directFileHeaders.length > 0
                    ? detectPhoneHeaders(directFileHeaders, directFileData).filter(h => h !== directColumnMapping.phone)
                    : [];
                  const selectedLabel = useIndividualCallback && individualCallbackColumn
                    ? `${individualCallbackColumn} (수신자별)`
                    : selectedCallback
                      ? (() => {
                          const cb = callbackNumbers.find(c => c.phone === selectedCallback);
                          return cb
                            ? `${formatPhoneNumber(cb.phone)}${cb.label ? ` (${cb.label})` : ''}`
                            : formatPhoneNumber(selectedCallback);
                        })()
                      : '';
                  const selectedIsDefault = !!(selectedCallback && callbackNumbers.find(c => c.phone === selectedCallback)?.is_default);
                  const q = callbackSearch.trim().toLowerCase();
                  const filteredPhoneHeaders = q
                    ? phoneHeaders.filter(h => h.toLowerCase().includes(q))
                    : phoneHeaders;
                  const filteredCallbacks = q
                    ? callbackNumbers.filter(cb =>
                        cb.phone.replace(/-/g, '').includes(q.replace(/-/g, '')) ||
                        (cb.label || '').toLowerCase().includes(q)
                      )
                    : callbackNumbers;
          return (
            <footer className="ds-modal__foot">
              <div className="ds-foot-opts">
                {/* 예약 */}
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
                    <button type="button" className="ds-tile__clear" onClick={() => setReserveEnabled(false)} aria-label="예약 풀기" title="예약 풀기">
                      <X size={12} strokeWidth={2.4} />
                    </button>
                  )}
                </div>
                {/* 분할 — 누르면 몇 건씩 나눌지 묻는다 */}
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
                    recipientCount={directRecipients.length}
                    startAt={reserveEnabled && reserveDateTime ? reserveDateTime : null}
                    onApply={(n) => { setSplitCount(n); setSplitEnabled(true); }}
                    onOff={() => setSplitEnabled(false)}
                    onClose={() => setSplitOpen(false)}
                  />
                </div>
                {/* 광고 표기 */}
                <div className="ds-opt-anchor">
                  <button
                    type="button"
                    role="switch"
                    aria-checked={adTextEnabled}
                    className={`ds-tile ds-tile--opt ${adTextEnabled ? 'ds-tile--opt-amber' : ''}`}
                    onClick={() => handleAdToggle(!adTextEnabled)}
                  >
                    <span className="ds-tile__ic"><Megaphone size={17} strokeWidth={2} /></span>
                    <span className="ds-tile__tx">
                      <span className="ds-tile__t1">광고 표기</span>
                      <span className="ds-tile__t2">{adTextEnabled ? '(광고) · 080 붙음' : '안 붙음'}</span>
                    </span>
                    <span className="ds-switch" aria-hidden />
                  </button>
                </div>
              </div>
              <div className="ds-modal__vdiv" />
              <div className="ds-foot-send">
                <div className="ds-sender" ref={callbackMenuRef}>
                  <button
                    type="button"
                    className={`ds-sender__btn ${!selectedLabel ? 'ds-sender__btn--empty' : ''}`}
                    onClick={() => setCallbackMenuOpen(o => !o)}
                    aria-haspopup="menu"
                    aria-expanded={callbackMenuOpen}
                    title={selectedLabel || '회신번호 선택'}
                  >
                    <span className="min-w-0">
                      <span className="ds-sender__lab">발신번호</span>
                          <span className="ds-sender__val">
                            {useIndividualCallback && individualCallbackColumn ? (
                              <>
                                <span className="ds-sender__eq">= {individualCallbackColumn}</span>
                                <span className="ds-sender__tag ds-sender__tag--col">수신자별</span>
                              </>
                            ) : selectedCallback ? (
                              <>
                                <span className="ds-num">{formatPhoneNumber(selectedCallback)}</span>
                                {selectedIsDefault && <span className="ds-sender__tag ds-sender__tag--rep">대표</span>}
                              </>
                            ) : (
                              <span className="text-stone-400">회신번호 선택</span>
                            )}
                          </span>
                    </span>
                    <ChevronDown size={15} strokeWidth={2} className="ds-sender__chev" />
                  </button>
                          {callbackMenuOpen && (
                            <div className="ds-callback-menu" role="menu">
                              {callbackNumbers.length + phoneHeaders.length > 5 && (
                                <div className="ds-callback-menu__search">
                                  <Search size={13} strokeWidth={1.75} />
                                  <input
                                    type="text"
                                    autoFocus
                                    placeholder="번호·라벨 검색"
                                    value={callbackSearch}
                                    onChange={(e) => setCallbackSearch(e.target.value)}
                                  />
                                </div>
                              )}
                              <div className="ds-callback-menu__scroll">
                                {filteredPhoneHeaders.length > 0 && (
                                  <>
                                    <div className="ds-callback-menu__group">수신자별 회신번호 컬럼</div>
                                    {filteredPhoneHeaders.map(h => {
                                      // ★ D150-3 (2026-05-09) PDF #5: 0/'0' 보존
                                      const sample = cellToString(directFileData[0]?.[h]);
                                      const isActive = useIndividualCallback && individualCallbackColumn === h;
                                      return (
                                        <button
                                          key={h}
                                          type="button"
                                          role="menuitem"
                                          className={`ds-callback-item ${isActive ? 'ds-callback-item--on' : ''}`}
                                          onClick={() => {
                                            setUseIndividualCallback(true);
                                            setSelectedCallback('');
                                            setIndividualCallbackColumn(h);
                                            setCallbackMenuOpen(false);
                                          }}
                                        >
                                          <span className="ds-callback-item__label">{h} <span className="ds-callback-item__hint">(수신자별)</span></span>
                                          {sample !== '' && <span className="ds-callback-item__sample">예: {sample.slice(0, 15)}</span>}
                                        </button>
                                      );
                                    })}
                                  </>
                                )}
                                <div className="ds-callback-menu__group">등록된 회신번호{callbackSearch && ` · ${filteredCallbacks.length}건`}</div>
                                {callbackNumbers.length === 0 ? (
                                  <div className="ds-callback-menu__empty">등록된 회신번호가 없습니다</div>
                                ) : filteredCallbacks.length === 0 ? (
                                  <div className="ds-callback-menu__empty">검색 결과가 없습니다</div>
                                ) : (
                                  filteredCallbacks.map((cb) => {
                                    const isActive = !useIndividualCallback && selectedCallback === cb.phone;
                                    return (
                                      <button
                                        key={cb.id}
                                        type="button"
                                        role="menuitem"
                                        className={`ds-callback-item ${isActive ? 'ds-callback-item--on' : ''}`}
                                        onClick={() => {
                                          setUseIndividualCallback(false);
                                          setSelectedCallback(cb.phone);
                                          setIndividualCallbackColumn('');
                                          setCallbackMenuOpen(false);
                                        }}
                                      >
                                        <span className="ds-callback-item__label">
                                          {formatPhoneNumber(cb.phone)}
                                          {cb.label && <span className="ds-callback-item__hint"> ({cb.label})</span>}
                                        </span>
                                        {cb.is_default && <span className="ds-callback-item__star">⭐</span>}
                                      </button>
                                    );
                                  })
                                )}
                              </div>
                            </div>
                          )}
                </div>
                <button type="button" className="ds-send-btn" onClick={handleSendClick} disabled={sendBusy}>
                  <Send size={17} strokeWidth={2} />
                  <span>{directRecipients.length > 0 ? `${directRecipients.length.toLocaleString()}명에게 전송하기` : '전송하기'}</span>
                </button>
              </div>
            </footer>
          );
        })()}

        {/* ============ 파일 매핑 모달 ============ */}
        {directShowMapping && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[60] p-4">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-[650px] max-h-[90vh] overflow-y-auto">
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
                      // ★ D150-3 (2026-05-09) PDF #5: 0/'0' 보존
                      const sample = cellToString(directFileData[0]?.[h]);
                      return <option key={i} value={h}>{h}{sample !== '' ? ` (예: ${sample.slice(0, 15)})` : ''}</option>;
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
                            // ★ D150-3 (2026-05-09) PDF #5: 0/'0' 보존
                            const sample = cellToString(directFileData[0]?.[h]);
                            return <option key={i} value={h}>{h}{sample !== '' ? ` (예: ${sample.slice(0, 15)})` : ''}</option>;
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
                                // ★ D150-3 (2026-05-09) PDF #5: 0/'0' 보존
                                const sample = cellToString(directFileData[0]?.[h]);
                                return <option key={hi} value={h}>{h}{sample !== '' ? ` (예: ${sample.slice(0, 15)})` : ''}</option>;
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
            <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[60] p-4">
              <div className="bg-white rounded-2xl shadow-2xl w-full max-w-[550px] max-h-[90vh] overflow-hidden">
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

        {/* ★ 2026-09-25 맞춤법 결과 · 발송 전 경고 · 요금제 안내 */}
        <DirectSpellModal
          open={spellModalOpen && !spellStale}
          rows={spellRowsView}
          quotaText={spellQuotaText}
          onFix={fixSpellIssue}
          onKeep={keepSpellIssue}
          onFixAll={fixAllSpell}
          onAiRefine={openAiRefineFromSpell}
          onClose={() => setSpellModalOpen(false)}
        />
        <SendSpamWarnModal
          open={!!sendWarn}
          variant={sendWarn?.variant || 'none'}
          carriersText={sendWarn?.carriersText || ''}
          spellOpenCount={spellOpenCount}
          trialRemaining={spamTrialRemaining}
          onCheckSpam={onWarnCheckSpam}
          onOpenSpell={onWarnOpenSpell}
          onSendAnyway={onWarnSendAnyway}
          onClose={() => setSendWarn(null)}
        />
        <TrialUpsellModal kind={upsell} status={checkStatus} onClose={() => setUpsell(null)} />

        {/* ★ D152+ (PDF 0511 funnel fix): AI 인라인 다듬기 모달.
            BASIC(35만원/월)+ TRIAL 게이팅은 백엔드 requirePlanFeature('ai_messaging') 미들웨어에서 처리.
            요금제 미달 시 모달 안에서 403 응답 안내. */}
        <AiRefineModal
          isOpen={showAiRefineModal}
          originalMessage={directMessage}
          onClose={() => setShowAiRefineModal(false)}
          onApply={(text) => {
            setDirectMessage(text);
            setToast({ show: true, type: 'success', message: 'AI 안 적용됨 · 발송 전 미리보기 확인 권장' });
          }}
        />

      </div>
    </div>
  );
}
