/**
 * Heartbeat 5 단계 진단 (§5 #8).
 * sdk_loaded → config_loaded → domain_matched → first_pageview_sent → first_event_accepted.
 * 백오피스 진단 화면 안 5/10/30분 단계별 상태 표시 흐름 (v0.3.5-b 진입).
 */

export const HEARTBEAT_STAGES = [
  'sdk_loaded',
  'config_loaded',
  'domain_matched',
  'first_pageview_sent',
  'first_event_accepted',
] as const;

export type HeartbeatStage = (typeof HEARTBEAT_STAGES)[number];

export type HeartbeatSnapshot = {
  [K in HeartbeatStage]: number | null;
};

export class Heartbeat {
  private stages: HeartbeatSnapshot;
  private emit: (stage: HeartbeatStage) => void;

  constructor(emit: (stage: HeartbeatStage) => void) {
    this.emit = emit;
    this.stages = HEARTBEAT_STAGES.reduce((acc, s) => {
      acc[s] = null;
      return acc;
    }, {} as HeartbeatSnapshot);
  }

  mark(stage: HeartbeatStage): void {
    if (this.stages[stage] !== null) return;
    this.stages[stage] = Date.now();
    this.emit(stage);
  }

  snapshot(): HeartbeatSnapshot {
    return { ...this.stages };
  }

  isStageComplete(stage: HeartbeatStage): boolean {
    return this.stages[stage] !== null;
  }
}
