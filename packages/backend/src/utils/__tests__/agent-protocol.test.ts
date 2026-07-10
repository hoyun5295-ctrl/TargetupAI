/**
 * agent-protocol.test.ts — 싱크에이전트 명령 큐 정책 CT 순수 테스트 (2026-07-10 원격 관리 P1)
 * 정책: v1.6.1+ At-Least-Once(ACK 삭제·상한 만료) / 구버전 At-Most-Once 불변 / 결과 용량 가드.
 */
import { describe, it, expect } from 'vitest';
import {
  isAgentVersionGte,
  applyCommandAcks,
  markCommandsDelivered,
  capResultData,
  COMMAND_MAX_ATTEMPTS,
  COMMAND_RESULTS_MAX,
  RESULT_DATA_MAX_BYTES,
  ACK_MIN_AGENT_VERSION,
  QueuedAgentCommand,
  StoredCommandResult,
} from '../agent-protocol';

const NOW = '2026-07-10T12:00:00.000Z';

describe('isAgentVersionGte', () => {
  it('기본 비교 — 1.6.1 기준', () => {
    expect(isAgentVersionGte('1.6.1', ACK_MIN_AGENT_VERSION)).toBe(true);
    expect(isAgentVersionGte('1.6.2', '1.6.1')).toBe(true);
    expect(isAgentVersionGte('1.7.0', '1.6.1')).toBe(true);
    expect(isAgentVersionGte('2.0.0', '1.6.1')).toBe(true);
    expect(isAgentVersionGte('1.6.0', '1.6.1')).toBe(false);
    expect(isAgentVersionGte('1.5.7', '1.6.1')).toBe(false); // 이새 현행 — 구버전 취급
  });
  it('v 접두·패치 생략 허용, 파싱 불가/빈 값 = false(보수적)', () => {
    expect(isAgentVersionGte('v1.6.1', '1.6.1')).toBe(true);
    expect(isAgentVersionGte('1.7', '1.6.1')).toBe(true);
    expect(isAgentVersionGte(null, '1.6.1')).toBe(false);
    expect(isAgentVersionGte(undefined, '1.6.1')).toBe(false);
    expect(isAgentVersionGte('unknown', '1.6.1')).toBe(false);
  });
});

describe('applyCommandAcks — ACK 수신 시에만 큐 제거 + 결과 기록', () => {
  const queue: QueuedAgentCommand[] = [
    { id: 'a', type: 'full_sync', attempts: 1 },
    { id: 'b', type: 'test_connection', attempts: 1 },
  ];
  it('ACK된 명령만 제거·미ACK 유지 + 결과 기록', () => {
    const r = applyCommandAcks(queue, [], [{ commandId: 'a', type: 'full_sync', ok: true, message: '완료', completedAt: NOW }], NOW);
    expect(r.queue.map((c) => c.id)).toEqual(['b']);
    expect(r.results).toHaveLength(1);
    expect(r.results[0]).toMatchObject({ commandId: 'a', ok: true, message: '완료', recordedAt: NOW });
  });
  it('큐에 없는 commandId ACK(만료 후 지연 도착 등)도 결과는 기록', () => {
    const r = applyCommandAcks([], [], [{ commandId: 'zzz', type: 'restart', ok: true }], NOW);
    expect(r.results).toHaveLength(1);
    expect(r.results[0].commandId).toBe('zzz');
  });
  it('같은 commandId 중복 ACK("재전달 무시" 재-ACK)는 최초 결과 유지', () => {
    const existing: StoredCommandResult[] = [
      { commandId: 'a', type: 'full_sync', ok: true, message: '원 결과', completedAt: NOW, recordedAt: NOW },
    ];
    const r = applyCommandAcks(queue, existing, [{ commandId: 'a', ok: true, message: '이미 실행된 명령 (재전달 무시)' }], NOW);
    expect(r.results.find((x) => x.commandId === 'a')?.message).toBe('원 결과');
    expect(r.queue.map((c) => c.id)).toEqual(['b']); // 큐 제거는 수행
  });
  it('결과 보관 상한 유지 (최근 N건)', () => {
    const existing: StoredCommandResult[] = Array.from({ length: COMMAND_RESULTS_MAX }, (_, i) => ({
      commandId: `old-${i}`, type: 't', ok: true, completedAt: NOW, recordedAt: NOW,
    }));
    const r = applyCommandAcks([], existing, [{ commandId: 'new', ok: true }], NOW);
    expect(r.results).toHaveLength(COMMAND_RESULTS_MAX);
    expect(r.results[r.results.length - 1].commandId).toBe('new');
    expect(r.results.some((x) => x.commandId === 'old-0')).toBe(false);
  });
  it('commandId 없는 항목은 무시·빈 ACK는 무변경', () => {
    const r = applyCommandAcks(queue, [], [{ commandId: '' } as any], NOW);
    expect(r.queue).toBe(queue);
    expect(r.results).toEqual([]);
  });
});

describe('markCommandsDelivered — At-Least-Once vs 구버전 At-Most-Once', () => {
  it('구버전(supportsAck=false) = 전달 즉시 큐 비움(기존 동작 불변 — 이새 1.5.7 비범위)', () => {
    const queue: QueuedAgentCommand[] = [{ id: 'a', type: 'full_sync' }];
    const r = markCommandsDelivered(queue, [], false, NOW);
    expect(r.deliver).toHaveLength(1);
    expect(r.queue).toEqual([]);
    expect(r.results).toEqual([]);
    expect(r.expiredCount).toBe(0);
  });
  it('v1.6.1+ = 전달해도 큐 유지 + attempts·delivered_at 스탬프', () => {
    const queue: QueuedAgentCommand[] = [{ id: 'a', type: 'full_sync' }];
    const r = markCommandsDelivered(queue, [], true, NOW);
    expect(r.deliver).toHaveLength(1);
    expect(r.queue).toHaveLength(1);
    expect(r.queue[0]).toMatchObject({ id: 'a', attempts: 1, delivered_at: NOW });
  });
  it(`상한(${COMMAND_MAX_ATTEMPTS}회) 초과 = 실패 기록 후 큐 제거(무한 재전송 차단)`, () => {
    const queue: QueuedAgentCommand[] = [{ id: 'a', type: 'update_config', attempts: COMMAND_MAX_ATTEMPTS }];
    const r = markCommandsDelivered(queue, [], true, NOW);
    expect(r.deliver).toEqual([]);
    expect(r.queue).toEqual([]);
    expect(r.expiredCount).toBe(1);
    expect(r.results[0]).toMatchObject({ commandId: 'a', ok: false });
    expect(r.results[0].message).toContain('만료');
  });
  it('빈 큐 = 무변경·무전달', () => {
    const r = markCommandsDelivered([], [], true, NOW);
    expect(r.deliver).toEqual([]);
    expect(r.expiredCount).toBe(0);
  });
});

describe('capResultData — config jsonb 비대 차단', () => {
  it('상한 이하 데이터 = 그대로', () => {
    const d = { lines: ['a', 'b'] };
    expect(capResultData(d)).toBe(d);
  });
  it('lines 배열 초과 = 앞(오래된) 줄부터 버리고 truncated 마커', () => {
    const line = 'x'.repeat(2000);
    const lines = Array.from({ length: 400 }, (_, i) => `${i}:${line}`); // ~800KB
    const capped = capResultData({ file: 'sync.log', lines }) as any;
    expect(capped.truncated).toBe(true);
    expect(capped.lines.length).toBeLessThan(400);
    expect(JSON.stringify(capped).length).toBeLessThanOrEqual(RESULT_DATA_MAX_BYTES + 2000);
    // 최신(마지막) 줄이 보존된다
    expect(capped.lines[capped.lines.length - 1]).toBe(lines[lines.length - 1]);
  });
  it('lines 없는 대형 데이터 = truncated 안내로 대체', () => {
    const capped = capResultData({ blob: 'y'.repeat(RESULT_DATA_MAX_BYTES + 10) }) as any;
    expect(capped.truncated).toBe(true);
    expect(typeof capped.note).toBe('string');
  });
  it('null/undefined = 그대로', () => {
    expect(capResultData(null)).toBeNull();
    expect(capResultData(undefined)).toBeUndefined();
  });
});
