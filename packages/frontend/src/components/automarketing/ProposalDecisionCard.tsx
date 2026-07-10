// 오늘의 추천 — 의사결정 카드 (2026-06-27)
// 버리는 데이터 0: proposal_json(orchestrate 결과 전체)을 위계로 렌더한다.
//   히어로(기대 매출·ROI) → 근거(왜 지금·등급별 전환·안전·채널) → 보조(변형·인사이트·전략·리스크·비용·통합 분석).
import { ReactNode, useRef, useState } from 'react';
import {
  X, ChevronDown, ChevronUp, Target, ShieldCheck,
  Send, GitMerge, MessageSquare, AlertCircle, Check, Pencil, Users,
} from 'lucide-react';
import { OperatorProposal, ProposalVariant, BanditRecommendation, ProposalApproveSelection, won } from './types';
import StatusBadge from './StatusBadge';
// ★ 2026-07-10 [타겟확인] — 발송 대상 명단 모달 (SoT: docs/superpowers/specs/2026-07-10-send-target-list-three-phase-design.md §3-2①)
import TargetRecipientsModal, { arrayPager, TargetRecipient } from '../TargetRecipientsModal';

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
  // selection 없음(undefined) = 사용자가 아무것도 안 고름 → 백엔드 Bandit이 변형 결정(자동 경로 동일).
  onApprove: (selection?: ProposalApproveSelection) => void;
  onReject: () => void;
  onStop: () => void;
  onPromoteToJourney?: () => void;
}

const CONFIDENCE_LABEL: Record<string, string> = { high: '높음', medium: '보통', low: '낮음' };
const RISK_LABEL: Record<string, string> = { low: '낮음', medium: '보통', high: '높음' };
const variantLetter = (i: number) => String.fromCharCode(65 + i);

export default function ProposalDecisionCard({
  proposal, featured = false, expanded, variantData, busy,
  onToggleExpand, onApprove, onReject, onStop, onPromoteToJourney,
}: Props) {
  // ★ 2026-07-09 문안 3안 선택 + 편집 — selectedIdx 미선택 시 Bandit 추천을 따르고, 편집 본문은 선택된 변형 기준.
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null);
  const [editing, setEditing] = useState(false);
  const [editedBody, setEditedBody] = useState<string | null>(null);
  const pj = proposal.proposalJson || {};
  const perf = pj.performance || {};
  const basis = perf.basis || {};
  const insight = perf.insight;
  const grades = basis.gradeBreakdown || [];
  const compliance = pj.compliance;
  const channelName = (pj.channel?.recommended || 'SMS').toUpperCase();
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

  const banditIdx = recommendedIdx != null && messages[recommendedIdx] ? recommendedIdx : 0;
  // 사용자가 고른 변형이 있으면 그것, 없으면 Bandit 추천. 미리보기·발송이 모두 이 index를 따른다.
  const effectiveIdx = selectedIdx != null && messages[selectedIdx] ? selectedIdx : banditIdx;
  const effectiveMsg = messages[effectiveIdx];
  const effectiveBody = editedBody != null ? editedBody : (effectiveMsg?.body || effectiveMsg?.message || '');
  const selectVariant = (i: number) => { setSelectedIdx(i); setEditedBody(null); setEditing(false); };
  // ★ Codex P3 (2026-07-09): 사용자가 명시적으로 선택/편집한 경우에만 selection 전송.
  //   미조작 승인에 selection을 실으면 변형 데이터 로딩 전(recommendedIdx=undefined)엔 변형 A(0)가 강제되어
  //   백엔드 Bandit 추천을 우회한다 — 미조작 = undefined로 보내 백엔드가 Bandit으로 결정(자동 경로 동일).
  const submitApprove = () => {
    if (selectedIdx == null && editedBody == null) { onApprove(); return; }
    onApprove({ variantIndex: effectiveIdx, body: effectiveBody, subject: effectiveMsg?.subject });
  };

  const hero = (
    <div className="flex items-end gap-5 flex-wrap">
      <div>
        <div className="text-[11px] text-white/50 mb-1">기대 매출</div>
        <div className="text-3xl md:text-4xl font-semibold text-white tabular-nums leading-none">{revenue != null ? won(revenue) : '—'}</div>
      </div>
      {roi != null && (
        <div className="pl-5 border-l border-white/10">
          <div className="text-[11px] text-white/50 mb-1">ROI</div>
          <div className="text-2xl md:text-3xl font-semibold text-emerald-300 tabular-nums leading-none">{roi.toFixed(1)}×</div>
        </div>
      )}
      <div className="ml-auto text-right text-[11px] text-white/60 leading-relaxed">
        대상 <span className="text-white font-medium">{proposal.recipientCount.toLocaleString()}명</span><br />
        발송비 <span className="text-white font-medium">{won(cost)}</span> · {channelName}
      </div>
    </div>
  );

  const diagnosisBlock = (diagnosis || insufficient) && (
    <div className="mt-4 rounded-r-lg border-l-2 border-indigo-400 bg-slate-950/40 px-3 py-2.5">
      <div className="flex items-center gap-2 mb-1">
        <span className="text-[11px] text-indigo-300 font-medium">왜 지금인가 — AI 진단</span>
        {confidenceText && <span className="text-[10px] text-white/40">신뢰도 {confidenceText}</span>}
      </div>
      <div className="text-[13px] text-white/75 leading-relaxed">
        {diagnosis || '고객 데이터가 더 쌓이면 추정이 정확해집니다. 지금은 보수적으로 안내합니다.'}
      </div>
    </div>
  );

  const gradeBlock = grades.length > 0 && (
    <div className="mt-4">
      <div className="text-[11px] text-white/50 mb-2">등급별 기대 전환</div>
      <div className="space-y-1.5">
        {grades.map((g, i) => (
          <div key={i} className="flex items-center gap-2.5">
            <span className="text-[11px] text-white/70 w-12 shrink-0">{g.grade}</span>
            <div className="flex-1 h-2 bg-white/5 rounded-full overflow-hidden">
              <div className="h-full bg-indigo-500/70 rounded-full" style={{ width: `${Math.min(100, ((g.expectedRevenue || 0) / maxGradeRev) * 100)}%` }} />
            </div>
            <span className="text-[11px] text-white/60 tabular-nums shrink-0">{Math.round(g.expectedConversions || 0)}건 · {won(g.expectedRevenue)}</span>
          </div>
        ))}
      </div>
      {sourceLabel && <div className="text-[10px] text-white/30 italic mt-1.5">Data source — {sourceLabel}</div>}
    </div>
  );

  const chips = (
    <div className="mt-4 flex flex-wrap gap-1.5">
      {compliance && (
        <span className={`inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded-full ${compliance.passed ? 'bg-emerald-500/10 text-emerald-300' : 'bg-amber-500/10 text-amber-300'}`}>
          <ShieldCheck className="w-3 h-3" />
          {compliance.passed ? '발송 안전' : '검토 필요'} · 위험도 {RISK_LABEL[compliance.riskLevel || 'low'] || compliance.riskLevel}
        </span>
      )}
      {channelReason && (
        <span className="inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded-full bg-white/5 text-white/60">
          <MessageSquare className="w-3 h-3" />{channelName} — {channelReason}
        </span>
      )}
      {recommendedIdx != null && (
        <span className="inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded-full bg-indigo-500/15 text-indigo-200">
          <Target className="w-3 h-3" />Bandit 추천 변형 {variantLetter(recommendedIdx)}
        </span>
      )}
    </div>
  );

  const messagePreview = effectiveMsg && (
    <div className="mt-3 rounded-lg border border-white/10 bg-slate-950/40 px-3 py-2.5">
      <div className="text-[10px] text-white/40 mb-1">
        발송 문안 · 변형 {variantLetter(effectiveIdx)}{editedBody != null ? ' · 편집됨' : ''}
      </div>
      <div className="text-[13px] text-white/80 leading-relaxed whitespace-pre-wrap">{effectiveBody}</div>
    </div>
  );

  const actions = (showToggle: boolean) => (
    <div className="mt-4 flex items-center gap-2 flex-wrap">
      {canViewTargets && (
        <button onClick={() => setShowTargets(true)} disabled={busy} className="inline-flex items-center gap-1.5 border border-white/15 hover:bg-white/10 disabled:opacity-40 text-white/80 text-sm px-3 py-2 rounded-lg transition-colors">
          <Users className="w-3.5 h-3.5" />타겟확인
        </button>
      )}
      {sentLike && (
        <span className="text-[11px] text-white/40">발송 명단은 발송결과 화면의 수신자 상세에서 확인할 수 있습니다.</span>
      )}
      {canApprove && (
        <>
          <button onClick={submitApprove} disabled={busy} className="inline-flex items-center gap-1.5 bg-indigo-500/40 hover:bg-indigo-500/60 disabled:opacity-40 text-indigo-50 text-sm font-semibold px-4 py-2 rounded-lg transition-colors">
            <Send className="w-4 h-4" />승인하고 발송
          </button>
          <button onClick={onReject} disabled={busy} className="inline-flex items-center gap-1.5 border border-rose-400/30 hover:bg-rose-500/20 disabled:opacity-40 text-rose-300 text-sm px-3 py-2 rounded-lg transition-colors">
            <X className="w-3.5 h-3.5" />거부
          </button>
        </>
      )}
      {canStop && (
        <button onClick={onStop} disabled={busy} className="inline-flex items-center gap-1.5 border border-rose-400/30 hover:bg-rose-500/20 disabled:opacity-40 text-rose-300 text-sm px-3 py-2 rounded-lg transition-colors">
          <X className="w-3.5 h-3.5" />자동 발송 정지
        </button>
      )}
      {canPromote && (
        <button onClick={onPromoteToJourney} className="inline-flex items-center gap-1.5 border border-emerald-400/30 hover:bg-emerald-500/20 text-emerald-300 text-sm px-3 py-2 rounded-lg transition-colors">
          <GitMerge className="w-3.5 h-3.5" />여정으로 굳히기
        </button>
      )}
      {showToggle && (
        <button onClick={onToggleExpand} className="ml-auto inline-flex items-center gap-1 text-white/50 hover:text-white/80 text-sm px-2 py-2">
          상세 {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
        </button>
      )}
    </div>
  );

  const detail = (
    <div className="mt-4 pt-4 border-t border-white/10 space-y-3 text-xs">
      {pj.target?.criteria && (
        <DetailRow label="타겟 근거">
          {pj.target.criteria}
          {pj.target.count != null && (
            <span className="text-white/40 ml-1">— 매칭 {pj.target.count?.toLocaleString()} / 전체 {pj.target.totalCount?.toLocaleString()}</span>
          )}
        </DetailRow>
      )}
      {messages.length > 0 && (
        <div>
          <div className="font-medium text-white/70 mb-1.5">
            메시지 {messages.length}안{canApprove ? ' · 눌러서 발송할 문안 선택' : ''}
          </div>
          <div className="space-y-1.5">
            {messages.map((m, i) => {
              const v = variantData?.variants?.[i];
              const rec = recommendedIdx === i;
              const isSel = canApprove && effectiveIdx === i;
              return (
                <div
                  key={i}
                  onClick={() => canApprove && selectVariant(i)}
                  className={`rounded-lg border px-2.5 py-2 transition-colors ${canApprove ? 'cursor-pointer' : ''} ${isSel ? 'bg-indigo-500/20 border-indigo-400/60 ring-1 ring-indigo-400/50' : `bg-white/5 border-white/10${canApprove ? ' hover:border-white/30' : ''}`}`}
                >
                  <div className="flex items-center gap-2 flex-wrap mb-1">
                    {isSel && <Check className="w-3.5 h-3.5 text-indigo-300 shrink-0" />}
                    <span className="text-white/80 font-medium">{m.variantName || `변형 ${variantLetter(i)}`}</span>
                    {(m.byteCount || m.byte_count) ? <span className="text-[10px] text-white/40">{m.byteCount || m.byte_count}byte</span> : null}
                    {rec && <span className="text-[10px] bg-indigo-600 text-white px-1.5 py-0.5 rounded-full">Bandit 추천</span>}
                    {isSel && <span className="text-[10px] bg-indigo-500/30 text-indigo-100 px-1.5 py-0.5 rounded-full">발송 선택됨</span>}
                    {v && <span className="text-[10px] text-white/40">발송 {v.sentCount} · 클릭 {v.clickCount} · 전환 {v.conversionCount}</span>}
                  </div>
                  {isSel && editing ? (
                    <textarea
                      value={effectiveBody}
                      onChange={(e) => setEditedBody(e.target.value)}
                      onClick={(e) => e.stopPropagation()}
                      rows={6}
                      className="w-full mt-1 rounded-lg bg-slate-950/60 border border-indigo-400/40 text-white/90 text-[13px] leading-relaxed p-2.5 resize-y focus:outline-none focus:border-indigo-300"
                      placeholder="발송할 문안을 자유롭게 편집하세요"
                    />
                  ) : (
                    <div className="text-white/70 whitespace-pre-wrap leading-relaxed">{isSel ? effectiveBody : (m.body || m.message || '')}</div>
                  )}
                  {isSel && (
                    <div className="mt-1.5 flex items-center gap-2">
                      <button
                        onClick={(e) => { e.stopPropagation(); setEditing((prev) => !prev); }}
                        className="inline-flex items-center gap-1 text-[11px] text-indigo-200 hover:text-indigo-100 border border-indigo-400/30 hover:bg-indigo-500/20 px-2 py-1 rounded-lg transition-colors"
                      >
                        <Pencil className="w-3 h-3" />{editing ? '편집 완료' : '문안 편집'}
                      </button>
                      {editedBody != null && !editing && (
                        <button
                          onClick={(e) => { e.stopPropagation(); setEditedBody(null); }}
                          className="text-[11px] text-white/50 hover:text-white/80 px-1.5 py-1"
                        >원래대로</button>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          {variantData?.recommendation && (
            <div className="mt-2 rounded-lg bg-indigo-500/10 border border-indigo-400/30 px-2.5 py-2 text-indigo-200 text-[11px]">
              <span className="font-medium">자동 최적화 추천:</span> {variantData.recommendation.reasoning}
              <div className="text-indigo-200/70 mt-0.5">AI 추천은 참고이며, 발송은 위에서 고른 변형(편집분 포함)으로 진행됩니다.</div>
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
    <div className="mt-3 flex items-start gap-1.5 text-[11px] text-amber-100 bg-amber-500/10 border border-amber-400/30 rounded-lg p-2">
      <AlertCircle className="w-3 h-3 mt-0.5 shrink-0" />
      <span>{proposal.autoExecuteReason || '스팸 필터를 끝내 통과하지 못했습니다.'} — 문안을 확인하고 발송 여부를 직접 판단해주세요.</span>
    </div>
  );

  const header = (
    <div className="flex items-start gap-2">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-semibold text-white">{proposal.operatorName || '제안'}</span>
          <StatusBadge status={proposal.status} />
        </div>
        {proposal.operatorObjective && <div className="text-[11px] text-white/50 mt-0.5">목표: {proposal.operatorObjective}</div>}
      </div>
    </div>
  );

  // ★ [타겟확인] 모달 — createPortal(z-2000)이라 카드 어디서 렌더해도 안전. totalCount=카드 "대상 N명"과 동일 값(별도 COUNT 없음).
  const displayTotal = targetInfo?.displayTotal ?? proposal.recipientCount;
  const targetModal = (
    <TargetRecipientsModal
      show={showTargets}
      onClose={() => setShowTargets(false)}
      title={`발송 대상 확인${targetInfo?.segmentName ? ` — ${targetInfo.segmentName}` : ''}`}
      objective={proposal.operatorObjective || null}
      criteria={targetInfo?.criteria ?? pj.target?.criteria ?? null}
      channelLabel={channelName}
      totalCount={displayTotal}
      fetchPage={targetPage}
      extraColumns={targetInfo?.conditionColumns || null}
      sourceLabel={`${targetInfo?.basisLabel || '발송 추출과 동일 기준 실측'} · 전체 ${displayTotal.toLocaleString()}명 중 최대 100명 표시 (발송 추출과 동일 기준·순서)`}
    />
  );

  if (featured) {
    return (
      <div className="bg-white/5 border border-indigo-400/30 rounded-2xl p-5">
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

  return (
    <div className="bg-white/5 border border-white/10 rounded-xl">
      <button onClick={onToggleExpand} className="w-full flex items-center gap-3 px-4 py-3 text-left">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-white truncate">{proposal.operatorName || '제안'}</span>
            <StatusBadge status={proposal.status} />
          </div>
          {proposal.operatorObjective && <div className="text-[11px] text-white/50 mt-0.5 truncate">{proposal.operatorObjective}</div>}
        </div>
        <div className="text-right shrink-0">
          <div className="text-sm font-semibold text-white tabular-nums">{revenue != null ? won(revenue) : '—'}</div>
          {roi != null && <div className="text-[11px] text-emerald-300 tabular-nums">ROI {roi.toFixed(1)}×</div>}
        </div>
        {expanded ? <ChevronUp className="w-4 h-4 text-white/40 shrink-0" /> : <ChevronDown className="w-4 h-4 text-white/40 shrink-0" />}
      </button>
      {expanded && (
        <div className="px-4 pb-4">
          {reviewNotice}
          <div className="mt-1">{hero}</div>
          {diagnosisBlock}
          {gradeBlock}
          {chips}
          {messagePreview}
          {actions(false)}
          {detail}
        </div>
      )}
      {targetModal}
    </div>
  );
}

function DetailRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <div className="font-medium text-white/70 mb-0.5">{label}</div>
      <div className="text-white/60 leading-relaxed whitespace-pre-wrap">{children}</div>
    </div>
  );
}

function DetailList({ items, tone }: { items: string[]; tone?: 'amber' }) {
  return (
    <ul className={`list-disc pl-4 space-y-0.5 ${tone === 'amber' ? 'text-amber-200/80' : 'text-white/60'}`}>
      {items.map((s, i) => <li key={i}>{s}</li>)}
    </ul>
  );
}
