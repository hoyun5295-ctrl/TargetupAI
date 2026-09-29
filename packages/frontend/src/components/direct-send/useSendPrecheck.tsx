/**
 * useSendPrecheck — 발송 창 "보내기 전 점검"(스팸 검사 · 맞춤법 검사) 공용 훅
 * (★2026-09-29 한줄로 V2 R112 · 직접발송 창 코드를 원본 그대로 옮김 · 설계 docs/2026-09-28-v2-round4-send-redesign.md §2-1)
 *
 * 원 설계 = docs/2026-09-25-direct-send-precheck-design.md §2(직접발송 · 목업 3 B안 승인).
 *   스팸 검사 = 검사 원장(최근 24시간 · 같은 발신번호 · 같은 문안)으로 판정한다(화면 기억이 아니다).
 *   맞춤법 = 미가입 월 5회 · 요금제 무제한(서버가 센다). 글이 바뀌는 것은 [고치기]를 누를 때뿐이다.
 * 창마다 다른 것만 호출부가 준다: 스팸 검사에 싣는 글(변수 치환 방식) · 단문 바이트 계산(명단 최장 값) · 경고 창 [그냥 보내기].
 * 쓰는 곳 = 직접발송 창(DirectSendPanel) · 직접 타겟 발송 창(TargetSendModal).
 */
import { useState, useRef, useEffect, useCallback, useMemo, type ReactNode } from 'react';
import DirectCheckTiles, { type SpamTileState, type SpellTileState } from './DirectCheckTiles';
import DirectSpellModal from './DirectSpellModal';
import SendSpamWarnModal, { type SendWarnVariant } from './SendSpamWarnModal';
import TrialUpsellModal from './TrialUpsellModal';
import AiRefineModal from '../AiRefineModal';
import {
  applySpellIssue, carrierLabel, dismissSendWarn, fetchRecentSpamCheck, fetchSendCheckStatus, isSendWarnDismissed,
  markSpellRowFixed, markSpellRowsByteBlocked, runDirectSpellCheck,
  type RecentSpamCheck, type SendCheckStatus, type SpellIssue, type SpellQuota, type SpellRow,
} from '../../utils/send-checks';
import { useAuthStore } from '../../stores/authStore';

type ToastFn = (t: { show: boolean; type: 'success' | 'error' | 'warning'; message: string }) => void;

export interface SendPrecheckInput {
  /** 본문(치환 전) */
  message: string;
  setMessage: (m: string) => void;
  subject: string;
  msgType: 'SMS' | 'LMS' | 'MMS';
  /** 고른 발신번호(수신자별이면 비어 있다) */
  callback: string;
  useIndividualCallback: boolean;
  adTextEnabled: boolean;
  optOutNumber: string;
  /** 명단 표지 — 바뀌면 검사 원장을 다시 본다(직접발송 = 명단 배열 · 타겟 = 보관본 id·건수) */
  recipientsKey: unknown;
  hasRecipients: boolean;
  /** 스팸 검사에 싣는 글 — 검사 창과 최근 검사 조회가 같은 계산을 쓴다(두 벌이면 "검사했는데 안 했다"가 된다) */
  buildSpamTestContent: () => { smsMsg: string; lmsMsg: string; firstR: any };
  /** 단문 바이트(명단 최장 값 · (광고) · 수신거부 줄 포함) — 맞춤법 고치기 잠금 판정용 */
  measureSmsBytes: (text: string) => number;
  /** 스팸 검사 창이 열려 있는가 — 닫히면 점검 칸이 검사 원장을 다시 본다 */
  spamModalOpen: boolean;
  isSpamFilterLocked: boolean;
  isAiMessagingLocked?: boolean;
  onLockedFeature: (featureId: string) => void;
  setSpamFilterData: (d: any) => void;
  setShowSpamFilter: (b: boolean) => void;
  setToast: ToastFn;
  /** 경고 창 [그냥 보내기] — 창의 발송 흐름을 이어 간다 */
  onSendAnyway: () => void;
}

export interface SendPrecheck {
  /** 점검 두 칸(스팸 검사 · 맞춤법 검사) */
  tiles: ReactNode;
  /** 맞춤법 결과 · 발송 전 경고 · 요금제 안내 · AI 다듬기 창 */
  modals: ReactNode;
  /** [전송하기] 직전 판정 — 경고가 필요하면 그 내용 */
  decideSendWarn: () => Promise<{ variant: SendWarnVariant; carriersText: string } | null>;
  showSendWarn: (w: { variant: SendWarnVariant; carriersText: string } | null) => void;
}

export function useSendPrecheck(input: SendPrecheckInput): SendPrecheck {
  const {
    message, setMessage, subject, msgType, callback, useIndividualCallback, adTextEnabled, optOutNumber,
    recipientsKey, hasRecipients, buildSpamTestContent, measureSmsBytes,
    spamModalOpen, isSpamFilterLocked, isAiMessagingLocked, onLockedFeature,
    setSpamFilterData, setShowSpamFilter, setToast, onSendAnyway,
  } = input;
  // 단문 바이트 계산은 최신 함수를 읽는다(맞춤법 창이 열린 동안만 · 의존 목록은 원본과 같다)
  const measureSmsBytesRef = useRef(measureSmsBytes);
  measureSmsBytesRef.current = measureSmsBytes;
  const [showAiRefineModal, setShowAiRefineModal] = useState(false);

  const authUserId = useAuthStore((st) => st.user?.id || '');
  const [checkStatus, setCheckStatus] = useState<SendCheckStatus | null>(null);
  const refreshCheckStatus = useCallback(async () => {
    const st = await fetchSendCheckStatus();
    if (st) setCheckStatus(st);
    return st;
  }, []);
  useEffect(() => { void refreshCheckStatus(); }, [refreshCheckStatus]);

  const [spamCheck, setSpamCheck] = useState<RecentSpamCheck | null>(null);
  const [spamEverChecked, setSpamEverChecked] = useState(false);
  const spamSeqRef = useRef(0);
  const refreshSpamCheck = async (): Promise<RecentSpamCheck | null> => {
    const seq = ++spamSeqRef.current;
    // 수신자별 회신번호는 지금 스팸 검사가 쓸 발신번호가 없다 — 판정하지 않는다
    if (useIndividualCallback || !callback || !message.trim()) {
      setSpamCheck(null);
      return null;
    }
    const { smsMsg, lmsMsg } = buildSpamTestContent();
    const r = await fetchRecentSpamCheck({
      callbackNumber: callback, messageType: msgType, messageContentSms: smsMsg, messageContentLms: lmsMsg,
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
  }, [message, callback, msgType, adTextEnabled, optOutNumber, useIndividualCallback, recipientsKey]);
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
  const messageRef = useRef(message);
  messageRef.current = message;
  const spellStale = spellText !== null && spellText !== message;
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
    const measure = msgType === 'SMS' ? (t: string) => measureSmsBytesRef.current(t) : null;
    return markSpellRowsByteBlocked(message, spellRows, measure);
  }, [spellModalOpen, spellStale, spellRows, msgType, message, recipientsKey, adTextEnabled, optOutNumber]);

  const runSpell = async () => {
    const text = message;
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
    else if (messageRef.current === text) setSpellModalOpen(true);
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
    const cur = messageRef.current;
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
    setMessage(next);
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
    const cur = messageRef.current;
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
    setMessage(text);
    setSpellText(text);
    setSpellRows(rows);
    setToast({ show: true, type: 'success', message: '고칠 곳을 고쳤어요.' });
    closeSpellIfDone(rows);
  };
  const openAiRefineFromSpell = () => {
    if (isAiMessagingLocked) { onLockedFeature('ai-refine'); return; }
    if (!message.trim()) { setToast({ show: true, type: 'error', message: '다듬을 메시지를 입력해주세요' }); return; }
    setSpellModalOpen(false);
    setShowAiRefineModal(true);
  };
  const spellQuotaText = spellUnlimited
    ? '맞춤법 검사는 크레딧이 들지 않아요'
    : `이번 달 무료 ${spellFreeRemaining ?? 0}/${checkStatus?.spell?.limit ?? 5}회 남음 · 요금제는 무제한`;

  const [sendWarn, setSendWarn] = useState<{ variant: SendWarnVariant; carriersText: string } | null>(null);
  /** [전송하기] 직전 — 스팸 검사를 안 했거나(24시간 안 · 같은 문안) 막혔거나 끝나지 않았으면, 맞춤법 고칠 곳이 남았으면 묻는다 */
  const decideSendWarn = async (): Promise<{ variant: SendWarnVariant; carriersText: string } | null> => {
    let variant: SendWarnVariant | null = null;
    let carriersText = '';
    if (!useIndividualCallback && callback) {
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

  const onWarnCheckSpam = () => { setSendWarn(null); void handleSpamFilter(); };
  const onWarnSendAnyway = (dismiss24h: boolean) => {
    if (dismiss24h && sendWarn?.variant === 'none') dismissSendWarn(authUserId);
    setSendWarn(null);
    onSendAnyway();
  };
  const onWarnOpenSpell = () => {
    setSendWarn(null);
    if (spellRows.length > 0 && !spellStale) setSpellModalOpen(true);
    else void runSpell();
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
    if (!hasRecipients) {
      setToast({ show: true, type: 'error', message: '발송리스트를 먼저 업로드해주세요.' });
      return;
    }
    const cb = callback || '';
    const { smsMsg, lmsMsg, firstR } = buildSpamTestContent();
    setSpamFilterData({ sms: smsMsg, lms: lmsMsg, callback: cb, msgType: msgType, subject: subject || '', isAd: adTextEnabled, firstRecipient: firstR || undefined });
    setShowSpamFilter(true);
  };
  const onSpamTile = () => {
    if (spamTileState === 'running') return;
    void handleSpamFilter();
  };

  const tiles = (
    <DirectCheckTiles
      spam={{ state: spamTileState, trialRemaining: spamTrialRemaining, carriersText: spamCarriersText }}
      spell={{ state: spellTileState, openCount: spellOpenCount, freeRemaining: spellFreeRemaining, freeLimit: checkStatus?.spell.limit ?? null }}
      onSpam={onSpamTile}
      onSpell={onSpellTile}
    />
  );

  const modals = (
    <>
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
        originalMessage={message}
        onClose={() => setShowAiRefineModal(false)}
        onApply={(text) => {
          setMessage(text);
          setToast({ show: true, type: 'success', message: 'AI 안 적용됨 · 발송 전 미리보기 확인 권장' });
        }}
      />
    </>
  );

  return { tiles, modals, decideSendWarn, showSendWarn: setSendWarn };
}
