// 오늘의 추천 — 의사결정 카드 (2026-06-27)
// 버리는 데이터 0: proposal_json(orchestrate 결과 전체)을 위계로 렌더한다.
//   히어로(기대 매출·ROI) → 근거(왜 지금·등급별 전환·안전·채널) → 보조(변형·인사이트·전략·리스크·비용·통합 분석).
import { ReactNode } from 'react';
import {
  X, ChevronDown, ChevronUp, Target, ShieldCheck,
  Send, GitMerge, MessageSquare, AlertCircle,
} from 'lucide-react';
import { OperatorProposal, ProposalVariant, BanditRecommendation, won } from './types';
import StatusBadge from './StatusBadge';

interface Props {
  proposal: OperatorProposal;
  featured?: boolean;
  expanded: boolean;
  variantData?: { variants: ProposalVariant[]; recommendation: BanditRecommendation | null };
  busy?: boolean;
  onToggleExpand: () => void;
  onApprove: () => void;
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

  const bestIdx = recommendedIdx != null && messages[recommendedIdx] ? recommendedIdx : 0;
  const bestMsg = messages[bestIdx];

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

  const messagePreview = bestMsg && (
    <div className="mt-3 rounded-lg border border-white/10 bg-slate-950/40 px-3 py-2.5">
      <div className="text-[10px] text-white/40 mb-1">
        발송 문안 · 변형 {variantLetter(bestIdx)}{(bestMsg.byteCount || bestMsg.byte_count) ? ` · ${bestMsg.byteCount || bestMsg.byte_count}byte` : ''}
      </div>
      <div className="text-[13px] text-white/80 leading-relaxed whitespace-pre-wrap">{bestMsg.body || bestMsg.message || ''}</div>
    </div>
  );

  const actions = (showToggle: boolean) => (
    <div className="mt-4 flex items-center gap-2 flex-wrap">
      {canApprove && (
        <>
          <button onClick={onApprove} disabled={busy} className="inline-flex items-center gap-1.5 bg-indigo-500/40 hover:bg-indigo-500/60 disabled:opacity-40 text-indigo-50 text-sm font-semibold px-4 py-2 rounded-lg transition-colors">
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
          <div className="font-medium text-white/70 mb-1.5">메시지 {messages.length}안</div>
          <div className="space-y-1.5">
            {messages.map((m, i) => {
              const v = variantData?.variants?.[i];
              const rec = recommendedIdx === i;
              return (
                <div key={i} className={`rounded-lg border px-2.5 py-2 ${rec ? 'bg-indigo-500/10 border-indigo-400/30' : 'bg-white/5 border-white/10'}`}>
                  <div className="flex items-center gap-2 flex-wrap mb-1">
                    <span className="text-white/80 font-medium">{m.variantName || `변형 ${variantLetter(i)}`}</span>
                    {(m.byteCount || m.byte_count) ? <span className="text-[10px] text-white/40">{m.byteCount || m.byte_count}byte</span> : null}
                    {rec && <span className="text-[10px] bg-indigo-600 text-white px-1.5 py-0.5 rounded-full">Bandit 추천</span>}
                    {v && <span className="text-[10px] text-white/40">발송 {v.sentCount} · 클릭 {v.clickCount} · 전환 {v.conversionCount}</span>}
                  </div>
                  <div className="text-white/70 whitespace-pre-wrap leading-relaxed">{m.body || m.message || ''}</div>
                </div>
              );
            })}
          </div>
          {variantData?.recommendation && (
            <div className="mt-2 rounded-lg bg-indigo-500/10 border border-indigo-400/30 px-2.5 py-2 text-indigo-200 text-[11px]">
              <span className="font-medium">자동 최적화 추천:</span> {variantData.recommendation.reasoning}
              <div className="text-indigo-200/70 mt-0.5">AI 추천은 참고이며, 발송은 담당자가 고른 변형으로 진행됩니다.</div>
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
