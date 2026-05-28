import { describe, it, expect, beforeEach } from 'vitest';
import { Heartbeat, HEARTBEAT_STAGES } from '../heartbeat';

describe('Heartbeat 5 단계 진단 (§5 #8)', () => {
  let captured: Array<{ stage: string; timestamp: number }>;
  let hb: Heartbeat;

  beforeEach(() => {
    captured = [];
    hb = new Heartbeat((stage) => captured.push({ stage, timestamp: Date.now() }));
  });

  it('HEARTBEAT_STAGES = 5 단계 정의', () => {
    expect(HEARTBEAT_STAGES).toEqual([
      'sdk_loaded',
      'config_loaded',
      'domain_matched',
      'first_pageview_sent',
      'first_event_accepted',
    ]);
  });

  it('mark() 호출 시 해당 단계 emit', () => {
    hb.mark('sdk_loaded');
    expect(captured.length).toBe(1);
    expect(captured[0].stage).toBe('sdk_loaded');
  });

  it('같은 단계 두 번 mark() 호출 시 두 번째 emit X (중복 차단)', () => {
    hb.mark('sdk_loaded');
    hb.mark('sdk_loaded');
    expect(captured.length).toBe(1);
  });

  it('5 단계 sequential mark — 모두 emit', () => {
    HEARTBEAT_STAGES.forEach((stage) => hb.mark(stage));
    expect(captured.length).toBe(5);
    expect(captured.map((c) => c.stage)).toEqual([
      'sdk_loaded',
      'config_loaded',
      'domain_matched',
      'first_pageview_sent',
      'first_event_accepted',
    ]);
  });

  it('snapshot() — 5 단계 + timestamp + completed 여부', () => {
    hb.mark('sdk_loaded');
    hb.mark('config_loaded');
    const snap = hb.snapshot();
    expect(snap.sdk_loaded).toBeGreaterThan(0);
    expect(snap.config_loaded).toBeGreaterThan(0);
    expect(snap.domain_matched).toBeNull();
  });
});
