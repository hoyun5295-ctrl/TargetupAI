// 오늘의 추천 — 의사결정 카드 (2026-06-27)
// 버리는 데이터 0: proposal_json(orchestrate 결과 전체)을 위계로 렌더한다.
//   히어로(기대 매출·ROI) → 근거(왜 지금·등급별 전환·안전·채널) → 보조(변형·인사이트·전략·리스크·비용·통합 분석).
import { ReactNode, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { MK_MODAL, MK_MODAL_BACKDROP } from '../../utils/make-ui';
import {
  X, ChevronDown, ChevronUp, Target, ShieldCheck,
  Send, GitMerge, MessageSquare, AlertCircle, Check, Pencil, Users, Loader2,
} from 'lucide-react';
import { OperatorProposal, ProposalVariant, BanditRecommendation, ProposalApproveSelection, ProposalSpamRetest, won } from './types';
import StatusBadge from './StatusBadge';
// ★ 2026-07-10 [타겟확인] — 발송 대상 명단 모달 (SoT: docs/superpowers/specs/2026-07-10-send-target-list-three-phase-design.md §3-2①)
import TargetRecipientsModal, { arrayPager, TargetRecipient } from '../TargetRecipientsModal';
import SmsCharsetNotice from '../SmsCharsetNotice';
import { hasUnsupportedSmsChars, SMS_CHARSET_BLOCK_MESSAGE } from '../../utils/smsSafeChars';

// [타겟확인] 응답 — 1회 로드(LIMIT 100) 후 클라 페이징(서버 재호출 0)
interface TargetListInfo {
  recipients: TargetRecipient[];
  displayTotal: number;
  criteria: string | null;
  segmentName: string | null;
  basisLabel: string | null;
  conditionColumns: { key: string; label: string }[];
}

interface Props {
  proposal: OperatorProposal;
  featured?: boolean;
  expanded: boolean;
  variantData?: { variants: ProposalVariant[]; recommendation: BanditRecommendation | null };
  busy?: boolean;
  onToggleExpand: () => void;
  // ★ 2026-10-24 승인 = 늘 안 번호 + 그 안의 지문(옛: 안 고르면 발송 순간 무작위 표집)
  onApprove: (selection: ProposalApproveSelection) => void;
  onReject: () => void;
  onStop: () => void;
  onPromoteToJourney?: () => void;
}

const CONFIDENCE_LABEL: Record<string, string> = { high: '높음', medium: '보통', low: '낮음' };
const RISK_LABEL: Record<string, string> = { low: '낮음', medium: '보통', high: '높음' };
const variantLetter = (i: number) => String.fromCharCode(65 + i);
/** ★ 2026-10-03 안별 스팸 검사 결과 표기(서버 판정값 → 고객 말 · 정책 사유와 같은 말) */
const SPAM_RESULT_CHIP: Record<string, { text: string; cls: string }> = {
  pass: { text: '스팸 검사 통과', cls: 'bg-emerald-50 text-emerald-700' },
  blocked: { text: '스팸 차단', cls: 'bg-rose-50 text-rose-700' },
  timeout: { text: '검사 결과 없음', cls: 'bg-slate-100 text-slate-500' },
  failed: { text: '검사 실패', cls: 'bg-slate-100 text-slate-500' },
};
/** ★ 2026-10-06 화면 스팸 검사 횟수(서버 PROPOSAL_SPAM_RETEST_LIMIT 와 같은 값 · 서버가 막는다) */
const SPAM_RETEST_LIMIT = 5;
/** ★ 2026-10-24 지금 나갈 글의 검사 상태(서버 copyCheck) */
const COPY_CHECK_CHIP: Record<string, { text: string; cls: string }> = {
  passed: { text: '스팸 검사 통과', cls: 'bg-emerald-50 text-emerald-700' },
  rechecking: { text: '혜택이 바뀌어 다시 검사하는 중', cls: 'bg-slate-100 text-slate-600' },
  blocked: { text: '바뀐 문안이 스팸 검사에 걸렸어요', cls: 'bg-rose-50 text-rose-700' },
  stale: { text: '검사한 뒤 혜택이 바뀌어 다시 검사가 필요해요', cls: 'bg-amber-50 text-amber-800' },
};
const authHeader = () => ({ Authorization: `Bearer ${localStorage.getItem('token')}` });

export default function ProposalDecisionCard({
  proposal, featured = false, expanded, variantData, busy,
  onToggleExpand, onApprove, onReject, onStop, onPromoteToJourney,
}: Props) {
  // ★ 2026-07-09 문안 3안 선택 + 편집 — selectedIdx 미선택 시 Bandit 추천을 따르고, 편집 본문은 선택된 변형 기준.
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null);
  const [editing, setEditing] = useState(false);
  const [editedBody, setEditedBody] = useState<string | null>(null);
  // ★ 2026-07-10 (임은지 리포트): LMS/MMS 제목 확인·수정 — 발송 전 제목 확인 불가 문제 해소. 백엔드 userSelection.subject 통로 기존 존재.
  const [editedSubject, setEditedSubject] = useState<string | null>(null);
  const pj = proposal.proposalJson || {};
  const perf = pj.performance || {};
  const basis = perf.basis || {};
  const insight = perf.insight;
  const grades = basis.gradeBreakdown || [];
  const compliance = pj.compliance;
  const channelName = (pj.channel?.recommended || 'SMS').toUpperCase();
  // LMS/MMS = 제목이 발송되는 채널 — 제목 표시·편집 UI 노출 기준
  const isLongType = channelName === 'LMS' || channelName === 'MMS';
  const channelReason = pj.channel?.reason;
  const messages = pj.messages || [];
  const revenue = perf.expectedRevenue;
  const cost = proposal.costEstimate || pj.cost?.estimated || 0;
  const roi = typeof perf.roi === 'number' && perf.roi > 0
    ? perf.roi
    : (cost > 0 && revenue ? revenue / cost : undefined);
  const recommendedIdx = variantData?.recommendation?.variantIndex;
  const insufficient = basis.level === 'insufficient_data';
  const confidenceText = insufficient ? '데이터 부족' : (basis.confidence ? (CONFIDENCE_LABEL[basis.confidence] || basis.confidence) : null);
  const sourceLabel = basis.label;
  const maxGradeRev = Math.max(1, ...grades.map((g) => g.expectedRevenue || 0));
  const diagnosis = insight?.generated && insight.diagnosis ? insight.diagnosis : null;

  const canApprove = proposal.status === 'pending' || proposal.status === 'admin_review';
  const canStop = proposal.status === 'scheduled';
  const canPromote = !!onPromoteToJourney && ['approved', 'auto_executed', 'sent'].includes(proposal.status);

  // ★ 2026-07-10 [타겟확인] — 발송 전 상태에서 발송 대상 명단 열람. 발송 완료면 발송결과 상세 안내(문구만).
  const canViewTargets = ['pending', 'admin_review', 'approved', 'scheduled'].includes(proposal.status);
  const sentLike = proposal.status === 'sent' || proposal.status === 'auto_executed';
  const [showTargets, setShowTargets] = useState(false);
  const [targetInfo, setTargetInfo] = useState<TargetListInfo | null>(null);
  const targetsPromise = useRef<Promise<TargetListInfo> | null>(null);
  const fetchTargets = async (): Promise<TargetListInfo> => {
    const res = await fetch(`/api/ai/operator/proposals/${proposal.id}/recipients`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('token')}` },
      body: '{}',
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.error || '발송 대상 조회에 실패했습니다.');
    const info: TargetListInfo = {
      recipients: Array.isArray(data.recipients) ? data.recipients : [],
      displayTotal: Number(data.displayTotal) || 0,
      criteria: data.criteria || null,
      segmentName: data.segmentName || null,
      basisLabel: data.basisLabel || null,
      conditionColumns: Array.isArray(data.conditionColumns) ? data.conditionColumns : [],
    };
    setTargetInfo(info);
    return info;
  };
  // 1회 로드 캐시 — 실패 시 캐시 비워 재시도 가능(모달이 에러 표시).
  const ensureTargets = () => {
    if (!targetsPromise.current) {
      targetsPromise.current = fetchTargets().catch((e) => { targetsPromise.current = null; throw e; });
    }
    return targetsPromise.current;
  };
  const targetPage = async (page: number, pageSize: number) => {
    const info = await ensureTargets();
    return arrayPager(info.recipients)(page, pageSize);
  };

  // ★ 2026-10-03 스팸 검사를 통과한 안이 있으면 그 안이 기본(서버 발송과 같은 순서 = 통과 안 → 추천 안 · 임은지 접수).
  const spamCheck = pj.spamCheck;
  const spamPassedIdx = Number.isInteger(spamCheck?.passedIndex) && messages[spamCheck!.passedIndex as number] ? (spamCheck!.passedIndex as number) : null;
  const spamResultAt = (i: number) => (spamCheck?.results || []).find((r) => r.index === i);
  // ★ 2026-10-06 화면 스팸 검사(임은지 재오픈) — 고른 안 · 고친 문안을 자동 검사와 같은 검사로(무료 · 제안마다 5회).
  //   결과는 검사한 글자와 함께 저장된다 → 지금 문안과 글자까지 같을 때만 붙인다(고치면 지난 결과는 안 보인다).
  //   혜택 자리가 남은 문안은 서버가 검사하지 않는다(Codex 3R) → 검사한 글자 = 화면 글자 = 나가는 글자라 글자 비교만으로 충분하다.
  const [retest, setRetest] = useState<ProposalSpamRetest | null>(pj.spamRetest || null);
  const [retestStarting, setRetestStarting] = useState(false);
  const [retestError, setRetestError] = useState<string | null>(null);
  const retestRunning = !!retest?.running && Date.now() - Date.parse(retest.running.startedAt) < 10 * 60 * 1000;
  const retestLeft = Math.max(0, SPAM_RETEST_LIMIT - (retest?.count || 0));
  const retestFor = (i: number, body: string, subject: string) =>
    [...(retest?.results || [])].reverse().find((r) => r.variantIndex === i && r.body === body && (r.subject || '') === subject);
  const loadRetest = async () => {
    try {
      const res = await fetch(`/api/ai/operator/proposals/${proposal.id}/spam-test`, { headers: authHeader() });
      const data = await res.json();
      if (data.success) setRetest(data.spamRetest || null);
    } catch { /* 다음에 다시 읽는다 */ }
  };
  useEffect(() => {
    if (!retestRunning) return;
    const t = setInterval(() => { void loadRetest(); }, 4000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [retestRunning, proposal.id]);
  // ★ 2026-10-24 보낼 안 = 서버가 정한 번호(사람이 고른 안 → 통과 안 → 저장된 추천 안 → 0 · 발송과 같은 함수) · 화면은 계산하지 않는다
  const finals = proposal.finalCopies || [];
  const serverIdx = Number.isInteger(proposal.finalIndex) && messages[proposal.finalIndex as number] ? (proposal.finalIndex as number) : 0;
  const effectiveIdx = selectedIdx != null && messages[selectedIdx] ? selectedIdx : serverIdx;
  const effectiveMsg = messages[effectiveIdx];
  const effectiveFinal = finals[effectiveIdx] || null;
  // 편집은 나가는 글(혜택을 넣은 글)에서 시작한다 — 고치지 않았으면 서버 글 그대로
  const effectiveBody = editedBody != null ? editedBody : (effectiveFinal?.body ?? (effectiveMsg?.body || effectiveMsg?.message || ''));
  const effectiveSubject = editedSubject != null ? editedSubject : (effectiveFinal?.subject ?? (effectiveMsg?.subject || ''));
  const edited = (editedBody != null && editedBody !== (effectiveFinal?.body ?? '')) || (editedSubject != null && editedSubject !== (effectiveFinal?.subject ?? ''));
  const finalMissing = canApprove && !effectiveFinal;
  // 실발송 제목이 비면 승인 차단(여정 LMS/MMS 필수 규칙과 동일) — Codex 지적: 편집값만 검사하면 AI 제목 부재 제안이 빈 제목으로 발송됨.
  const subjectInvalid = isLongType && canApprove && !effectiveSubject.trim();
  // ★ 2026-09-10 발송할 문안에 문자로 보낼 수 없는 글자가 남아 있으면 승인 차단(설계 D2 · 문안 아래 안내에서 바꾼다)
  const charsetInvalid = canApprove && ['SMS', 'LMS', 'MMS'].includes(channelName)
    && hasUnsupportedSmsChars(effectiveBody, isLongType ? effectiveSubject : '');
  const selectVariant = (i: number) => { setSelectedIdx(i); setEditedBody(null); setEditedSubject(null); setEditing(false); };
  const startRetest = async () => {
    // ★ Codex 4R high — 검사한 안 = 승인할 안. 아무것도 안 고른 채 기본 안을 검사하고 승인하면 선택 없이 승인되어
    //   서버가 추천을 다시 뽑아 다른 안이 나갈 수 있었다 → 검사를 시작하면 그 안을 발송 선택으로 고정한다(submitApprove 가 selection 을 싣는다).
    if (selectedIdx == null) setSelectedIdx(effectiveIdx);
    setRetestError(null);
    setRetestStarting(true);
    try {
      const res = await fetch(`/api/ai/operator/proposals/${proposal.id}/spam-test`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeader() },
        body: JSON.stringify({ variantIndex: effectiveIdx, body: effectiveBody, subject: effectiveSubject }),
      });
      const data = await res.json();
      if (data.success) setRetest(data.spamRetest || null);
      else setRetestError(data.error || '스팸 검사를 시작하지 못했습니다.');
    } catch {
      setRetestError('스팸 검사를 시작하지 못했습니다. 잠시 뒤 다시 눌러 주세요.');
    } finally {
      setRetestStarting(false);
    }
  };
  // ★ 2026-10-24 승인 = 늘 {안 번호 · 그 안의 지문}(본 뒤 혜택 · 080 · 회신번호가 바뀌면 서버가 409) · 고친 글만 함께 보낸다
  const submitApprove = () => {
    if (subjectInvalid || charsetInvalid || !effectiveFinal) return;
    onApprove({
      variantIndex: effectiveIdx,
      fingerprint: effectiveFinal.fingerprint,
      ...(edited ? { body: effectiveBody, subject: effectiveSubject } : {}),
    });
  };

  // ★ 2026-09-30 AI 존 보정: 대상·발송비를 오른쪽 끝에 떼어 두면 가운데가 빈다 → 기대 매출·ROI 옆 같은 칸(모바일 2×2)
  const hero = (
    <div className="grid grid-cols-2 gap-y-3 sm:flex sm:items-end sm:gap-5">
      <div>
        <div className="text-[11px] text-slate-500 mb-1">기대 매출</div>
        <div className="text-[22px] md:text-[24px] font-bold text-slate-900 tabular-nums leading-none">{revenue != null ? won(revenue) : '—'}</div>
      </div>
      {roi != null && (
        <div className="pl-4 sm:pl-5 border-l border-slate-200">
          <div className="text-[11px] text-slate-500 mb-1">ROI</div>
          <div className="text-[20px] md:text-[22px] font-bold text-emerald-700 tabular-nums leading-none">{roi.toFixed(1)}×</div>
        </div>
      )}
      <div className={`${roi != null ? 'sm:pl-5 sm:border-l' : 'pl-4 sm:pl-5 border-l'} border-slate-200`}>
        <div className="text-[11px] text-slate-500 mb-1">대상</div>
        <div className="text-[17px] md:text-[18px] font-bold text-slate-900 tabular-nums leading-none">{proposal.recipientCount.toLocaleString()}명</div>
      </div>
      <div className={`${roi != null ? 'pl-4 sm:pl-5 border-l' : 'sm:pl-5 sm:border-l'} border-slate-200`}>
        <div className="text-[11px] text-slate-500 mb-1">발송비 · {channelName}</div>
        <div className="text-[17px] md:text-[18px] font-bold text-slate-900 tabular-nums leading-none">{won(cost)}</div>
      </div>
    </div>
  );

  const diagnosisBlock = (diagnosis || insufficient) && (
    <div className="mt-4 rounded-r-lg border-l-2 border-indigo-400 bg-slate-100 px-3 py-2.5">
      <div className="flex items-center gap-2 mb-1">
        <span className="text-[11px] text-indigo-700 font-medium">왜 지금인가: AI 진단</span>
        {confidenceText && <span className="text-[10px] text-slate-400">신뢰도 {confidenceText}</span>}
      </div>
      <div className="text-[13px] text-slate-600 leading-relaxed">
        {diagnosis || '고객 데이터가 더 쌓이면 추정이 정확해집니다. 지금은 보수적으로 안내합니다.'}
      </div>
    </div>
  );

  const gradeBlock = grades.length > 0 && (
    <div className="mt-4">
      <div className="text-[11px] text-slate-500 mb-2">등급별 기대 전환</div>
      <div className="space-y-1.5">
        {grades.map((g, i) => (
          <div key={i} className="flex items-center gap-2.5">
            <span className="text-[11px] text-slate-600 w-12 shrink-0">{g.grade}</span>
            <div className="flex-1 h-2 bg-white rounded-full overflow-hidden">
              <div className="h-full bg-indigo-200 rounded-full" style={{ width: `${Math.min(100, ((g.expectedRevenue || 0) / maxGradeRev) * 100)}%` }} />
            </div>
            <span className="text-[11px] text-slate-500 tabular-nums shrink-0">{Math.round(g.expectedConversions || 0)}건 · {won(g.expectedRevenue)}</span>
          </div>
        ))}
      </div>
    </div>
  );

  const chips = (
    <div className="mt-4 flex flex-wrap gap-1.5">
      {compliance && (
        <span className={`inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded-full ${compliance.passed ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}`}>
          <ShieldCheck className="w-3 h-3" />
          {compliance.passed ? '발송 안전' : '검토 필요'} · 위험도 {RISK_LABEL[compliance.riskLevel || 'low'] || compliance.riskLevel}
        </span>
      )}
      {channelReason && (
        <span className="inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded-full bg-white text-slate-500">
          <MessageSquare className="w-3 h-3" />{channelName}: {channelReason}
        </span>
      )}
      {messages.length > 0 && (
        <span className="inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded-full bg-indigo-100 text-indigo-800">
          <Target className="w-3 h-3" />보낼 문안 {variantLetter(serverIdx)}
        </span>
      )}
      {/* ★ 2026-10-24 지금 나갈 글의 검사 상태(서버 판정 · 통과 지문 · 재검사) */}
      {proposal.copyCheck && COPY_CHECK_CHIP[proposal.copyCheck] && (
        <span className={`inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded-full ${COPY_CHECK_CHIP[proposal.copyCheck].cls}`}>
          <ShieldCheck className="w-3 h-3" />{COPY_CHECK_CHIP[proposal.copyCheck].text}
        </span>
      )}
    </div>
  );

  const messagePreview = effectiveMsg && (
    <div className="mt-3 rounded-lg border border-slate-200 bg-slate-100 px-3 py-2.5">
      <div className="text-[11px] text-slate-500 mb-1">
        발송 문안 · 변형 {variantLetter(effectiveIdx)}{edited ? ' · 편집됨' : ''}
      </div>
      {/* ★ 2026-10-08 (남지현 접수) 고객이 받는 모양 그대로 · ★ 2026-10-24 서버가 만든 나가는 글(혜택 · (광고) · 080)을 그대로 — 화면 흉내 0 */}
      {(effectiveFinal?.msgType === 'LMS' || effectiveFinal?.msgType === 'MMS' || isLongType) && (
        <div className="text-[12px] text-slate-700 mb-1.5 pb-1.5 border-b border-slate-200">
          <span className="text-slate-500 mr-1.5">제목</span>{effectiveSubject ? (!edited && effectiveFinal?.sentSubject ? effectiveFinal.sentSubject : effectiveSubject) : <span className="text-rose-700">제목 없음. 상세에서 입력해주세요</span>}
        </div>
      )}
      <div className="text-[13px] text-slate-700 leading-relaxed whitespace-pre-wrap">{edited || !effectiveFinal ? effectiveBody : effectiveFinal.sent}</div>
      {edited && <div className="mt-1.5 text-[11px] text-slate-500">(광고) 표기와 무료거부 번호는 보낼 때 붙어요.</div>}
      {finalMissing && <div className="mt-1.5 text-[11px] text-rose-700">문안을 다시 불러와야 승인할 수 있어요. 목록을 새로 고쳐 주세요.</div>}
    </div>
  );

  const actions = (showToggle: boolean) => (
    <div className="mt-4 flex items-center gap-2 flex-wrap">
      {canViewTargets && (
        <button onClick={() => setShowTargets(true)} disabled={busy} className="inline-flex items-center gap-1.5 border border-slate-300 hover:bg-slate-100 disabled:opacity-40 text-slate-700 text-sm px-3 py-2 rounded-lg transition-colors">
          <Users className="w-3.5 h-3.5" />타겟확인
        </button>
      )}
      {sentLike && (
        <span className="text-[11px] text-slate-400">발송 명단은 발송결과 화면의 수신자 상세에서 확인할 수 있습니다.</span>
      )}
      {canApprove && (
        <>
          <button onClick={submitApprove} disabled={busy || subjectInvalid || charsetInvalid || finalMissing} title={charsetInvalid ? SMS_CHARSET_BLOCK_MESSAGE : undefined} className="inline-flex items-center gap-1.5 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 text-white text-sm font-semibold px-4 py-2 rounded-lg transition-colors">
            <Send className="w-4 h-4" />이 문안으로 승인
          </button>
          <button onClick={onReject} disabled={busy} className="inline-flex items-center gap-1.5 border border-rose-200 hover:bg-rose-100 disabled:opacity-40 text-rose-700 text-sm px-3 py-2 rounded-lg transition-colors">
            <X className="w-3.5 h-3.5" />거부
          </button>
        </>
      )}
      {canStop && (
        <button onClick={onStop} disabled={busy} className="inline-flex items-center gap-1.5 border border-rose-200 hover:bg-rose-100 disabled:opacity-40 text-rose-700 text-sm px-3 py-2 rounded-lg transition-colors">
          <X className="w-3.5 h-3.5" />자동 발송 정지
        </button>
      )}
      {canPromote && (
        <button onClick={onPromoteToJourney} className="inline-flex items-center gap-1.5 border border-emerald-200 hover:bg-emerald-100 text-emerald-700 text-sm px-3 py-2 rounded-lg transition-colors">
          <GitMerge className="w-3.5 h-3.5" />여정으로 굳히기
        </button>
      )}
      {showToggle && (
        <button onClick={onToggleExpand} aria-expanded={expanded} className="inline-flex items-center gap-1 border border-slate-200 hover:bg-slate-100 text-slate-600 text-sm px-3 py-2 rounded-lg transition-colors">
          {expanded ? '상세 접기' : '상세 보기'} {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
        </button>
      )}
    </div>
  );

  const detail = (
    <div className="mt-4 pt-4 border-t border-slate-200 space-y-3 text-xs">
      {pj.target?.criteria && (
        <DetailRow label="타겟 근거">
          {pj.target.criteria}
          {pj.target.count != null && (
            <span className="text-slate-400 ml-1">(매칭 {pj.target.count?.toLocaleString()} / 전체 {pj.target.totalCount?.toLocaleString()})</span>
          )}
        </DetailRow>
      )}
      {messages.length > 0 && (
        <div>
          <div className="font-medium text-slate-600 mb-1.5">
            메시지 {messages.length}안{canApprove ? ' · 눌러서 발송할 문안 선택' : ''}
          </div>
          <div className="space-y-1.5">
            {messages.map((m, i) => {
              const v = variantData?.variants?.[i];
              const rec = recommendedIdx === i;
              const isSel = canApprove && effectiveIdx === i;
              // 화면 검사 결과(같은 글자일 때만) → 없으면 자동 검사 결과(고친 문안에는 붙이지 않는다)
              const reHit = retestFor(i, isSel ? effectiveBody : (finals[i]?.body ?? (m.body || m.message || '')), isSel ? effectiveSubject : (finals[i]?.subject ?? (m.subject || '')));
              const autoHit = isSel && edited ? undefined : spamResultAt(i);
              const testingThis = retestRunning && retest?.running?.variantIndex === i;
              return (
                <div
                  key={i}
                  onClick={() => canApprove && selectVariant(i)}
                  className={`rounded-lg border px-2.5 py-2 transition-colors ${canApprove ? 'cursor-pointer' : ''} ${isSel ? 'bg-indigo-100 border-indigo-300 ring-1 ring-indigo-300' : `bg-white border-slate-200${canApprove ? ' hover:border-slate-300' : ''}`}`}
                >
                  <div className="flex items-center gap-2 flex-wrap mb-1">
                    {isSel && <Check className="w-3.5 h-3.5 text-indigo-700 shrink-0" />}
                    <span className="text-slate-700 font-medium">{m.variantName || `변형 ${variantLetter(i)}`}</span>
                    {(m.byteCount || m.byte_count) ? <span className="text-[10px] text-slate-400">{m.byteCount || m.byte_count}byte</span> : null}
                    {rec && <span className="text-[10px] bg-indigo-600 text-white px-1.5 py-0.5 rounded-full">추천</span>}
                    {testingThis ? (
                      <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-600">스팸 검사 중</span>
                    ) : reHit && SPAM_RESULT_CHIP[reHit.result] ? (
                      <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${SPAM_RESULT_CHIP[reHit.result].cls}`}>{SPAM_RESULT_CHIP[reHit.result].text}</span>
                    ) : autoHit && SPAM_RESULT_CHIP[autoHit.result] && (
                      <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${SPAM_RESULT_CHIP[autoHit.result].cls}`}>
                        {SPAM_RESULT_CHIP[autoHit.result].text}{autoHit.regenerated ? ' · AI가 다시 씀' : ''}
                      </span>
                    )}
                    {isSel && <span className="text-[10px] bg-indigo-100 text-indigo-900 px-1.5 py-0.5 rounded-full">발송 선택됨</span>}
                    {v && <span className="text-[10px] text-slate-400">발송 {v.sentCount} · 클릭 {v.clickCount} · 전환 {v.conversionCount}</span>}
                  </div>
                  {/* ★ 2026-07-10: LMS/MMS 제목 — 변형별 표시 + 선택 변형 편집(비우면 승인 차단). "(광고)"는 발송 시점 자동 부착 */}
                  {isLongType && (
                    isSel && editing ? (
                      <div className="mt-1 mb-1.5" onClick={(e) => e.stopPropagation()}>
                        <label className="block text-[10px] text-slate-400 mb-0.5">제목 (문자 상단에 표시) · 광고 발송 시 "(광고)" 자동 부착</label>
                        <input
                          type="text"
                          value={effectiveSubject}
                          onChange={(e) => setEditedSubject(e.target.value)}
                          maxLength={50}
                          placeholder="발송 제목 입력"
                          className="w-full rounded-lg bg-slate-100 border border-indigo-300 text-slate-800 text-[12px] px-2.5 py-1.5 focus:outline-none focus:border-indigo-300"
                        />
                        {subjectInvalid && <div className="text-[10px] text-rose-700 mt-0.5">제목을 입력해주세요. 비워두면 승인·발송할 수 없습니다.</div>}
                      </div>
                    ) : (
                      <div className="text-[11px] text-slate-500 mb-1">
                        <span className="text-slate-400 mr-1.5">제목</span>{isSel ? (effectiveSubject || '—') : (finals[i]?.subject || m.subject || '—')}
                      </div>
                    )
                  )}
                  {isSel && editing ? (
                    <textarea
                      value={effectiveBody}
                      onChange={(e) => setEditedBody(e.target.value)}
                      onClick={(e) => e.stopPropagation()}
                      rows={6}
                      className="w-full mt-1 rounded-lg bg-slate-100 border border-indigo-300 text-slate-800 text-[13px] leading-relaxed p-2.5 resize-y focus:outline-none focus:border-indigo-300"
                      placeholder="발송할 문안을 자유롭게 편집하세요"
                    />
                  ) : (
                    <div className="text-slate-600 whitespace-pre-wrap leading-relaxed">{isSel ? effectiveBody : (finals[i]?.body ?? (m.body || m.message || ''))}</div>
                  )}
                  {/* ★ 2026-09-10 발송할 문안에 문자로 보낼 수 없는 글자 — 누르면 본문·제목을 대체표로 바꾼다(편집값으로 승인) */}
                  {isSel && ['SMS', 'LMS', 'MMS'].includes(channelName) && (
                    <SmsCharsetNotice
                      className="mt-1.5"
                      texts={[effectiveBody, isLongType ? effectiveSubject : '']}
                      onApply={(fix) => {
                        const nextBody = fix(effectiveBody);
                        if (nextBody !== effectiveBody) setEditedBody(nextBody);
                        const nextSubject = fix(effectiveSubject);
                        if (isLongType && nextSubject !== effectiveSubject) setEditedSubject(nextSubject);
                      }}
                    />
                  )}
                  {isSel && (
                    <div className="mt-1.5 flex items-center gap-2">
                      <button
                        onClick={(e) => { e.stopPropagation(); setEditing((prev) => !prev); }}
                        className="inline-flex items-center gap-1 text-[11px] text-indigo-800 hover:text-indigo-900 border border-indigo-200 hover:bg-indigo-100 px-2 py-1 rounded-lg transition-colors"
                      >
                        <Pencil className="w-3 h-3" />{editing ? '편집 완료' : '문안 편집'}
                      </button>
                      {edited && !editing && (
                        <button
                          onClick={(e) => { e.stopPropagation(); setEditedBody(null); setEditedSubject(null); }}
                          className="text-[11px] text-slate-500 hover:text-slate-700 px-1.5 py-1"
                        >원래대로</button>
                      )}
                      {['SMS', 'LMS', 'MMS'].includes(channelName) && (
                        <button
                          onClick={(e) => { e.stopPropagation(); void startRetest(); }}
                          disabled={busy || retestStarting || retestRunning || retestLeft === 0 || charsetInvalid || subjectInvalid || !effectiveBody.trim()}
                          className="inline-flex items-center gap-1 text-[11px] text-emerald-800 border border-emerald-200 hover:bg-emerald-50 disabled:opacity-40 px-2 py-1 rounded-lg transition-colors"
                        >
                          {retestRunning || retestStarting ? <Loader2 className="w-3 h-3 animate-spin" /> : <ShieldCheck className="w-3 h-3" />}
                          {retestRunning ? '스팸 검사 중(1~2분)' : '이 문안 스팸 검사'}
                        </button>
                      )}
                    </div>
                  )}
                  {isSel && ['SMS', 'LMS', 'MMS'].includes(channelName) && (
                    <div className="mt-1 text-[10px] text-slate-500">
                      통신사 3곳 테스트폰으로 실제 수신을 확인합니다 · 무료 · {retestLeft > 0 ? `이 제안에서 ${retestLeft}회 남음` : '이 제안의 검사 횟수를 모두 썼습니다'}
                      {retestError && <div className="text-rose-700 mt-0.5">{retestError}</div>}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          {variantData?.recommendation && (
            <div className="mt-2 rounded-lg bg-indigo-50 border border-indigo-200 px-2.5 py-2 text-indigo-800 text-[11px]">
              <span className="font-medium">자동 최적화 추천:</span> {variantData.recommendation.reasoning}
              <div className="text-indigo-800 mt-0.5">AI 추천은 참고이며, 발송은 위에서 고른 변형(편집분 포함)으로 진행됩니다.</div>
            </div>
          )}
        </div>
      )}
      {insight?.insights && insight.insights.length > 0 && (
        <DetailRow label="핵심 인사이트"><DetailList items={insight.insights} /></DetailRow>
      )}
      {insight?.strategy && insight.strategy.length > 0 && (
        <DetailRow label="추천 전략"><DetailList items={insight.strategy} /></DetailRow>
      )}
      {insight?.risks && insight.risks.length > 0 && (
        <DetailRow label="리스크"><DetailList items={insight.risks} tone="amber" /></DetailRow>
      )}
      {compliance?.warnings && compliance.warnings.length > 0 && (
        <DetailRow label="컴플라이언스 경고"><DetailList items={compliance.warnings} tone="amber" /></DetailRow>
      )}
      {pj.cost?.breakdown && <DetailRow label="비용 산출">{pj.cost.breakdown}</DetailRow>}
      {pj.meta?.aiSynthesis && <DetailRow label="AI 통합 분석">{pj.meta.aiSynthesis}</DetailRow>}
      {proposal.autoExecuteReason && <DetailRow label="자동 실행 판정">{proposal.autoExecuteReason}</DetailRow>}
    </div>
  );

  const reviewNotice = proposal.status === 'admin_review' && (
    <div className="mt-3 flex items-start gap-1.5 text-[11px] text-amber-900 bg-amber-50 border border-amber-200 rounded-lg p-2">
      <AlertCircle className="w-3 h-3 mt-0.5 shrink-0" />
      <span>{proposal.autoExecuteReason || '스팸 필터를 끝내 통과하지 못했습니다.'}. 문안을 확인하고 발송 여부를 직접 판단해주세요. 상세의 메시지 목록에서 다른 추천 문안을 고르거나 고친 뒤 스팸 검사를 할 수 있습니다.</span>
    </div>
  );

  const header = (
    <div className="flex items-start gap-2">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-semibold text-slate-900">{proposal.operatorName || '제안'}</span>
          <StatusBadge status={proposal.status} />
        </div>
        {proposal.operatorObjective && <div className="text-[11px] text-slate-500 mt-0.5">목표: {proposal.operatorObjective}</div>}
      </div>
    </div>
  );

  // ★ [타겟확인] 모달 — createPortal(z-2000)이라 카드 어디서 렌더해도 안전. totalCount=카드 "대상 N명"과 동일 값(별도 COUNT 없음).
  const displayTotal = targetInfo?.displayTotal ?? proposal.recipientCount;
  const targetModal = (
    <TargetRecipientsModal
      show={showTargets}
      onClose={() => setShowTargets(false)}
      title={`발송 대상 확인${targetInfo?.segmentName ? `: ${targetInfo.segmentName}` : ''}`}
      objective={proposal.operatorObjective || null}
      criteria={targetInfo?.criteria ?? pj.target?.criteria ?? null}
      channelLabel={channelName}
      totalCount={displayTotal}
      fetchPage={targetPage}
      extraColumns={targetInfo?.conditionColumns || null}
      note={[targetInfo?.basisLabel, `전체 ${displayTotal.toLocaleString()}명 중 최대 100명 표시`].filter(Boolean).join(' · ')}
    />
  );

  if (featured) {
    return (
      <div className="bg-white border border-indigo-200 rounded-2xl p-5">
        {header}
        {reviewNotice}
        <div className="mt-4">{hero}</div>
        {diagnosisBlock}
        {gradeBlock}
        {chips}
        {messagePreview}
        {actions(true)}
        {expanded && detail}
        {targetModal}
      </div>
    );
  }

  // ★ 2026-10-11 Harold: 「한 줄 꽉 찬 카드 = 공간 낭비 · 3열 · 누르면 모달」 — 접힌 카드 = 이름 · 목표 · 숫자 세 칸 / 펼친 내용(옛 아래 펼침) = 상세 창
  return (
    <>
      <button
        type="button"
        onClick={onToggleExpand}
        aria-haspopup="dialog"
        className="w-full h-full min-w-0 flex flex-col text-left bg-white border border-slate-200 rounded-2xl p-4 shadow-[0_1px_2px_rgba(15,23,42,0.05)] hover:border-indigo-200 hover:shadow-[0_2px_4px_rgba(15,23,42,0.06),0_12px_28px_-14px_rgba(15,23,42,0.22)] transition-[border-color,box-shadow]"
      >
        <div className="min-w-0 w-full">
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-sm font-semibold text-slate-900 truncate">{proposal.operatorName || '제안'}</span>
            <StatusBadge status={proposal.status} />
          </div>
          {proposal.operatorObjective && <div className="text-[12px] leading-relaxed text-slate-500 mt-1 line-clamp-2 break-keep">{proposal.operatorObjective}</div>}
        </div>
        <dl className="mt-auto pt-3 flex flex-wrap w-full gap-2">
          <div className="flex-1 min-w-fit rounded-lg bg-slate-50 px-2.5 py-2">
            <dt className="text-[11px] text-slate-500">기대 매출</dt>
            <dd className="text-[14px] font-semibold text-slate-900 tabular-nums whitespace-nowrap">{revenue != null ? won(revenue) : '—'}</dd>
          </div>
          <div className="flex-1 min-w-fit rounded-lg bg-slate-50 px-2.5 py-2">
            <dt className="text-[11px] text-slate-500">ROI</dt>
            <dd className="text-[14px] font-semibold text-emerald-700 tabular-nums whitespace-nowrap">{roi != null ? `${roi.toFixed(1)}×` : '—'}</dd>
          </div>
          <div className="flex-1 min-w-fit rounded-lg bg-slate-50 px-2.5 py-2">
            <dt className="text-[11px] text-slate-500">대상</dt>
            <dd className="text-[14px] font-semibold text-slate-900 tabular-nums whitespace-nowrap">{proposal.recipientCount.toLocaleString()}명</dd>
          </div>
        </dl>
      </button>
      {/* ★ 2026-10-24 배경을 눌러 닫지 않는다(0704 · 고친 문안이 사라지지 않게 · 닫기 = X) */}
      {expanded && createPortal(
        <div className={MK_MODAL_BACKDROP}>
          <div className={`${MK_MODAL} w-full max-w-[860px] max-h-[92vh] flex flex-col overflow-hidden`} role="dialog" aria-modal="true" aria-label={`${proposal.operatorName || '제안'} 상세`}>
            <div className="flex items-start gap-3 px-5 py-4 border-b border-slate-200">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-[15px] font-semibold text-slate-900">{proposal.operatorName || '제안'}</span>
                  <StatusBadge status={proposal.status} />
                </div>
                {proposal.operatorObjective && <div className="text-[12px] text-slate-500 mt-0.5 break-keep">목표: {proposal.operatorObjective}</div>}
              </div>
              <button type="button" onClick={onToggleExpand} aria-label="상세 닫기" className="shrink-0 h-9 w-9 rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700 flex items-center justify-center">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="flex-1 min-h-0 overflow-y-auto mk-scroll px-5 pb-5">
              {reviewNotice}
              <div className="mt-4">{hero}</div>
              {diagnosisBlock}
              {gradeBlock}
              {chips}
              {messagePreview}
              {actions(false)}
              {detail}
            </div>
          </div>
        </div>,
        document.body,
      )}
      {targetModal}
    </>
  );
}

function DetailRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <div className="font-medium text-slate-600 mb-0.5">{label}</div>
      <div className="text-slate-500 leading-relaxed whitespace-pre-wrap">{children}</div>
    </div>
  );
}

function DetailList({ items, tone }: { items: string[]; tone?: 'amber' }) {
  return (
    <ul className={`list-disc pl-4 space-y-0.5 ${tone === 'amber' ? 'text-amber-800' : 'text-slate-500'}`}>
      {items.map((s, i) => <li key={i}>{s}</li>)}
    </ul>
  );
}
