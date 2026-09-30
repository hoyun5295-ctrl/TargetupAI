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

import { MessageSquare, Clock, GitBranch, ArrowDown, Users, Send, MousePointerClick, Flag } from 'lucide-react';
// ★ 2026-09-29 여정 V2 0차 ⑤ — 시간 표기 · 흐름 색은 공용 유틸 한 곳(화면마다 다른 말 금지).
import { formatDelayAfter, funnelBarClass } from '../../utils/journey-labels';

interface StepRow {
  id: string;
  step_order: number;
  step_type: string;
  delay_hours: number;
  channel: string | null;
  message_template: string | null;
  is_ad: boolean;
  /** ★ 2026-09-29 V2 0차 ⑤ — 조건 미충족 시 이동할 칸(없으면 여정 끝). 상세 응답(SELECT *)에 이미 있다. */
  not_met_goto?: number | null;
  /** ★ 2026-09-29 V2 0차 ⑤ — 사건 대기(설정 시 사건이 오면 바로 · 최대 대기 뒤 다음 칸). */
  wait_event_name?: string | null;
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
  // ★ 2026-09-30 V2 4차 — 끝 칸(발송 0 · 이 갈래를 여기서 마침)
  end: { icon: Flag, label: '끝 · 이 갈래를 여기서 마침', accent: 'slate' },
};

const ACCENT_CLASSES: Record<string, { bg: string; border: string; text: string; iconBg: string; iconText: string }> = {
  slate: {
    bg: 'bg-white',
    border: 'border-slate-300',
    text: 'text-slate-600',
    iconBg: 'bg-slate-100',
    iconText: 'text-slate-600',
  },
  violet: {
    bg: 'bg-violet-50',
    border: 'border-violet-300',
    text: 'text-violet-900',
    iconBg: 'bg-violet-100',
    iconText: 'text-violet-800',
  },
  amber: {
    bg: 'bg-amber-50',
    border: 'border-amber-300',
    text: 'text-amber-900',
    iconBg: 'bg-amber-100',
    iconText: 'text-amber-800',
  },
  cyan: {
    bg: 'bg-cyan-50',
    border: 'border-cyan-300',
    text: 'text-cyan-900',
    iconBg: 'bg-cyan-100',
    iconText: 'text-cyan-800',
  },
};


export default function JourneyFlowDiagram({ steps, funnelStats, livePositions }: Props) {
  if (steps.length === 0) {
    return (
      <div className="p-6 bg-slate-100 border border-dashed border-slate-200 rounded-xl text-center">
        <span className="text-[12px] text-slate-400">아직 칸이 없어요. 칸을 추가하면 흐름이 여기에 그려집니다.</span>
      </div>
    );
  }

  const funnelMap = new Map(funnelStats?.map((s) => [s.stepId, s]) || []);
  const liveMap = new Map(livePositions?.map((p) => [p.stepId, p]) || []);
  const sortedSteps = [...steps].sort((a, b) => a.step_order - b.step_order);

  return (
    <div className="p-4 bg-slate-100 border border-slate-200 rounded-xl">
      <div className="flex items-center gap-2 mb-3">
        <GitBranch className="w-4 h-4 text-violet-700" />
        <span className="text-sm font-semibold text-slate-800">여정 흐름 다이어그램</span>
        <span className="ml-auto text-[10px] text-slate-400">{sortedSteps.length}개 단계</span>
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
                    <span className="text-[11px] text-slate-400">{step.step_order}번째</span>
                  </div>

                  {/* step 내용 */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center flex-wrap gap-2 mb-1">
                      <span className={`text-[12px] font-semibold ${accent.text}`}>{config.label}</span>
                      {step.step_type === 'message' && step.channel && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 font-mono">
                          {step.channel.toUpperCase()}
                          {step.is_ad && ' · 광고'}
                        </span>
                      )}
                      {step.delay_hours > 0 && (
                        <span className="text-[11px] text-slate-500">
                          <Clock className="w-2.5 h-2.5 inline mr-0.5" />
                          앞 칸 {formatDelayAfter(step.delay_hours)}
                        </span>
                      )}
                      {step.step_type === 'wait' && step.wait_event_name && (
                        <span className="text-[11px] text-slate-500">사건이 오면 바로 다음 칸</span>
                      )}
                    </div>

                    {step.message_template && (
                      <div className="text-[11px] text-slate-500 line-clamp-2 leading-relaxed">
                        {step.message_template}
                      </div>
                    )}

                    {/* funnel + 실시간 위치 영역 */}
                    {(funnel || live) && (
                      <div className="mt-2 pt-2 border-t border-slate-200 space-y-1">
                        {funnel && funnel.enteredCount > 0 && (
                          <div className="flex items-center gap-2">
                            <span className="text-[11px] text-slate-400 w-12">도착</span>
                            <div className="flex-1 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                              <div
                                className={`h-full ${funnelBarClass(funnel.funnelPercentage)}`}
                                style={{ width: `${Math.min(100, Math.max(2, funnel.funnelPercentage))}%` }}
                              />
                            </div>
                            <span className="text-[10px] text-slate-500 font-mono w-16 text-right">
                              {funnel.enteredCount.toLocaleString()} ({funnel.funnelPercentage.toFixed(0)}%)
                            </span>
                          </div>
                        )}
                        {funnel && funnel.sentCount > 0 && (
                          <div className="flex items-center gap-3 text-[10px] text-slate-500">
                            <span><Send className="w-2.5 h-2.5 inline text-violet-700" /> 발송 {funnel.sentCount.toLocaleString()}</span>
                            <span><MousePointerClick className="w-2.5 h-2.5 inline text-cyan-700" /> 클릭 {funnel.clickCount.toLocaleString()}</span>
                          </div>
                        )}
                        {live && live.activeCount > 0 && (
                          <div className="flex items-center gap-2 text-[10px]">
                            <Users className="w-2.5 h-2.5 text-emerald-700" />
                            <span className="text-emerald-800 font-semibold">실시간 {live.activeCount.toLocaleString()}명 대기</span>
                            {live.avgDwellMinutes > 0 && (
                              <span className="text-slate-400">평균 {live.avgDwellMinutes}분 체류</span>
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
                  {step.step_type === 'end' ? (
                    // ★ 2026-09-30 V2 4차 — 끝 칸 뒤 칸은 조건의 "아니면"으로만 닿는다(흐름이 이어지지 않는다).
                    <span className="text-[11px] text-slate-400">아래 칸은 앞 조건의 "아니면" 갈래로만 닿아요</span>
                  ) : step.step_type === 'condition' ? (
                    <div className="flex items-center gap-3">
                      <div className="flex flex-col items-center">
                        <ArrowDown className="w-4 h-4 text-emerald-700" />
                        <span className="text-[11px] text-emerald-800">맞으면 다음 칸</span>
                      </div>
                      <div className="w-4 h-px bg-slate-200" />
                      <div className="flex flex-col items-center">
                        <ArrowDown className="w-4 h-4 text-rose-700" />
                        {/* ★ 2026-09-29 V2 0차 ⑤ — 옛 "조건 미충족 (skip)"은 실행기와 반대였다. 미충족 = 지정한 칸으로 이동 · 없으면 여정 끝(journey-executor.ts). */}
                        <span className="text-[11px] text-rose-800">
                          {step.not_met_goto != null && step.not_met_goto > step.step_order ? `아니면 ${step.not_met_goto}번째 칸으로` : '아니면 여정 끝'}
                        </span>
                      </div>
                    </div>
                  ) : (
                    <ArrowDown className="w-4 h-4 text-slate-400" />
                  )}
                </div>
              )}
            </div>
          );
        })}

        {/* 완료 영역 */}
        <div className="flex justify-center py-1">
          <ArrowDown className="w-4 h-4 text-slate-400" />
        </div>
        <div className="p-2.5 bg-emerald-50 border border-emerald-200 rounded-lg text-center">
          <span className="text-[11px] font-semibold text-emerald-800">여정 완료</span>
        </div>
      </div>
    </div>
  );
}
