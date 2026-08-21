/**
 * JourneyFlowDiagram.tsx — D211+ Phase A 4번 (2026-05-23 Harold 명시)
 *
 * 본질: journey 흐름 다이어그램 시각화
 *   - step별 박스 (step_type + channel + delay_hours)
 *   - step 간 ArrowDown 영역
 *   - funnel 영역 색상 (statsMap funnelPercentage 활용)
 *   - 실시간 active count 영역 (livePositions 활용)
 *   - condition step 분기 시각화 (옛 condition step type 3 매트릭스)
 *
 * 다크 톤 정합 (bg-slate-900 + border-white/10 + violet 액센트)
 */

import { MessageSquare, Clock, GitBranch, ArrowDown, Users, Send, MousePointerClick } from 'lucide-react';

interface StepRow {
  id: string;
  step_order: number;
  step_type: string;
  delay_hours: number;
  channel: string | null;
  message_template: string | null;
  is_ad: boolean;
}

interface StepFunnelStat {
  stepId: string;
  funnelPercentage: number;
  enteredCount: number;
  sentCount: number;
  clickCount: number;
}

interface StepLivePosition {
  stepId: string;
  activeCount: number;
  avgDwellMinutes: number;
}

interface Props {
  steps: StepRow[];
  funnelStats?: StepFunnelStat[];
  livePositions?: StepLivePosition[];
}

const STEP_TYPE_CONFIG: Record<string, { icon: typeof MessageSquare; label: string; accent: string }> = {
  message: { icon: MessageSquare, label: '메시지 발송', accent: 'violet' },
  wait: { icon: Clock, label: '대기', accent: 'amber' },
  condition: { icon: GitBranch, label: '조건 분기', accent: 'cyan' },
};

const ACCENT_CLASSES: Record<string, { bg: string; border: string; text: string; iconBg: string; iconText: string }> = {
  violet: {
    bg: 'bg-violet-500/10',
    border: 'border-violet-400/40',
    text: 'text-violet-100',
    iconBg: 'bg-violet-500/30',
    iconText: 'text-violet-200',
  },
  amber: {
    bg: 'bg-amber-500/10',
    border: 'border-amber-400/40',
    text: 'text-amber-100',
    iconBg: 'bg-amber-500/30',
    iconText: 'text-amber-200',
  },
  cyan: {
    bg: 'bg-cyan-500/10',
    border: 'border-cyan-400/40',
    text: 'text-cyan-100',
    iconBg: 'bg-cyan-500/30',
    iconText: 'text-cyan-200',
  },
};

function getFunnelColor(pct: number): string {
  if (pct > 70) return 'bg-emerald-400';
  if (pct > 40) return 'bg-amber-400';
  return 'bg-rose-400';
}

export default function JourneyFlowDiagram({ steps, funnelStats, livePositions }: Props) {
  if (steps.length === 0) {
    return (
      <div className="p-6 bg-slate-950/60 border border-dashed border-white/10 rounded-xl text-center">
        <span className="text-[12px] text-white/40">step 영역 없음: 흐름 시각화 X</span>
      </div>
    );
  }

  const funnelMap = new Map(funnelStats?.map((s) => [s.stepId, s]) || []);
  const liveMap = new Map(livePositions?.map((p) => [p.stepId, p]) || []);
  const sortedSteps = [...steps].sort((a, b) => a.step_order - b.step_order);

  return (
    <div className="p-4 bg-slate-950/60 border border-white/10 rounded-xl">
      <div className="flex items-center gap-2 mb-3">
        <GitBranch className="w-4 h-4 text-violet-300" />
        <span className="text-sm font-semibold text-white/90">여정 흐름 다이어그램</span>
        <span className="ml-auto text-[10px] text-white/40">{sortedSteps.length}개 단계</span>
      </div>

      <div className="space-y-2">
        {sortedSteps.map((step, idx) => {
          const config = STEP_TYPE_CONFIG[step.step_type] || STEP_TYPE_CONFIG.message;
          const accent = ACCENT_CLASSES[config.accent];
          const Icon = config.icon;
          const funnel = funnelMap.get(step.id);
          const live = liveMap.get(step.id);
          const isLast = idx === sortedSteps.length - 1;

          return (
            <div key={step.id}>
              <div className={`${accent.bg} ${accent.border} border rounded-xl p-3`}>
                <div className="flex items-start gap-3">
                  {/* step 번호 + 아이콘 */}
                  <div className="flex flex-col items-center gap-1 flex-shrink-0">
                    <div className={`w-9 h-9 rounded-lg ${accent.iconBg} flex items-center justify-center`}>
                      <Icon className={`w-4 h-4 ${accent.iconText}`} />
                    </div>
                    <span className="text-[10px] text-white/40 font-mono">#{step.step_order}</span>
                  </div>

                  {/* step 내용 */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center flex-wrap gap-2 mb-1">
                      <span className={`text-[12px] font-semibold ${accent.text}`}>{config.label}</span>
                      {step.step_type === 'message' && step.channel && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-white/10 text-white/70 font-mono">
                          {step.channel.toUpperCase()}
                          {step.is_ad && ' · 광고'}
                        </span>
                      )}
                      {step.delay_hours > 0 && (
                        <span className="text-[10px] text-white/50 font-mono">
                          <Clock className="w-2.5 h-2.5 inline mr-0.5" />
                          {step.delay_hours}h 후
                        </span>
                      )}
                    </div>

                    {step.message_template && (
                      <div className="text-[11px] text-white/60 line-clamp-2 leading-relaxed">
                        {step.message_template}
                      </div>
                    )}

                    {/* funnel + 실시간 위치 영역 */}
                    {(funnel || live) && (
                      <div className="mt-2 pt-2 border-t border-white/10 space-y-1">
                        {funnel && funnel.enteredCount > 0 && (
                          <div className="flex items-center gap-2">
                            <span className="text-[10px] text-white/40 w-12">funnel</span>
                            <div className="flex-1 h-1.5 bg-white/10 rounded-full overflow-hidden">
                              <div
                                className={`h-full ${getFunnelColor(funnel.funnelPercentage)}`}
                                style={{ width: `${Math.min(100, Math.max(2, funnel.funnelPercentage))}%` }}
                              />
                            </div>
                            <span className="text-[10px] text-white/60 font-mono w-16 text-right">
                              {funnel.enteredCount.toLocaleString()} ({funnel.funnelPercentage.toFixed(0)}%)
                            </span>
                          </div>
                        )}
                        {funnel && funnel.sentCount > 0 && (
                          <div className="flex items-center gap-3 text-[10px] text-white/50">
                            <span><Send className="w-2.5 h-2.5 inline text-violet-300" /> 발송 {funnel.sentCount.toLocaleString()}</span>
                            <span><MousePointerClick className="w-2.5 h-2.5 inline text-cyan-300" /> 클릭 {funnel.clickCount.toLocaleString()}</span>
                          </div>
                        )}
                        {live && live.activeCount > 0 && (
                          <div className="flex items-center gap-2 text-[10px]">
                            <Users className="w-2.5 h-2.5 text-emerald-300" />
                            <span className="text-emerald-200/90 font-semibold">실시간 {live.activeCount.toLocaleString()}명 대기</span>
                            {live.avgDwellMinutes > 0 && (
                              <span className="text-white/40">평균 {live.avgDwellMinutes}분 체류</span>
                            )}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* step 간 화살표 (condition step = 분기 영역 시각화) */}
              {!isLast && (
                <div className="flex justify-center py-1">
                  {step.step_type === 'condition' ? (
                    <div className="flex items-center gap-3">
                      <div className="flex flex-col items-center">
                        <ArrowDown className="w-4 h-4 text-emerald-300" />
                        <span className="text-[9px] text-emerald-200/70">조건 충족</span>
                      </div>
                      <div className="w-4 h-px bg-white/20" />
                      <div className="flex flex-col items-center">
                        <ArrowDown className="w-4 h-4 text-rose-300" />
                        <span className="text-[9px] text-rose-200/70">조건 미충족 (skip)</span>
                      </div>
                    </div>
                  ) : (
                    <ArrowDown className="w-4 h-4 text-white/30" />
                  )}
                </div>
              )}
            </div>
          );
        })}

        {/* 완료 영역 */}
        <div className="flex justify-center py-1">
          <ArrowDown className="w-4 h-4 text-white/30" />
        </div>
        <div className="p-2.5 bg-emerald-500/10 border border-emerald-400/30 rounded-lg text-center">
          <span className="text-[11px] font-semibold text-emerald-200">여정 완료</span>
        </div>
      </div>
    </div>
  );
}
