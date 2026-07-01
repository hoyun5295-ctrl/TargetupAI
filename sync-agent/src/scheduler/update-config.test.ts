/**
 * Scheduler — 원격 update_config 명령 처리 (2026-07-01)
 *
 * 슈퍼관리자가 매핑을 내려보내면(update_config), 재시작 없이:
 *   1. engine 런타임 매핑 교체(engine.updateMapping)
 *   2. config.enc 영구 저장(주입된 persist 핸들러 — 파일 I/O는 scheduler가 몰라도 되게 콜백 분리)
 *   3. 이어서 full_sync(고객→구매)로 새 매핑 재적재
 *
 * 서버 명령 필드가 payload/params 두 형태로 올 수 있어(admin-sync는 과거 params 사용) 둘 다 수용.
 */
import { describe, it, expect, vi } from 'vitest';
import { Scheduler } from './index';
import type { SyncEngine } from '../sync/engine';
import type { QueueManager } from '../queue';

function makeEngineStub() {
  return {
    updateMapping: vi.fn(),
    runFull: vi.fn().mockResolvedValue({ totalCount: 0, successCount: 0, failCount: 0, durationMs: 1, errors: [] }),
    runIncremental: vi.fn(),
  };
}

const flush = () => new Promise((r) => setTimeout(r, 20));

function makeScheduler(engine: ReturnType<typeof makeEngineStub>) {
  return new Scheduler(
    engine as unknown as SyncEngine,
    null,
    {} as unknown as QueueManager,
    null,
    { customerIntervalMin: 60, purchaseIntervalMin: 30 },
  );
}

describe('Scheduler update_config 원격 명령', () => {
  it('매핑을 engine에 반영하고 persist 핸들러 호출 후 full_sync를 실행한다', async () => {
    const engine = makeEngineStub();
    const scheduler = makeScheduler(engine);
    const persisted: Array<Record<string, unknown>> = [];
    scheduler.setMappingUpdateHandler(async (m) => { persisted.push(m); });

    scheduler.applyRemoteConfig({
      commands: [
        { id: 'c1', type: 'update_config', payload: { mapping: { customers: { HP: 'phone', REG_DT: 'custom_1' } } } },
      ],
    });
    await flush();

    expect(engine.updateMapping).toHaveBeenCalledWith({ customers: { HP: 'phone', REG_DT: 'custom_1' }, purchases: undefined });
    expect(persisted).toHaveLength(1);
    expect(persisted[0]).toEqual({ customers: { HP: 'phone', REG_DT: 'custom_1' } });
    expect(engine.runFull).toHaveBeenCalledWith('customers');
    // 고객 매핑만 바뀌었으면 구매(수백만건)는 재적재하지 않는다
    expect(engine.runFull).not.toHaveBeenCalledWith('purchases');
  });

  it('params 필드(서버 하위호환)로 와도 동일하게 처리한다', async () => {
    const engine = makeEngineStub();
    const scheduler = makeScheduler(engine);

    scheduler.applyRemoteConfig({
      commands: [
        { id: 'c2', type: 'update_config', params: { mapping: { purchases: { BUY_DT: 'purchase_date' } } } } as never,
      ],
    });
    await flush();

    expect(engine.updateMapping).toHaveBeenCalledWith({ customers: undefined, purchases: { BUY_DT: 'purchase_date' } });
    expect(engine.runFull).toHaveBeenCalledWith('purchases');
    expect(engine.runFull).not.toHaveBeenCalledWith('customers');
  });

  it('mapping이 없는 update_config는 매핑 교체 없이 무시한다(빈 명령 방어)', async () => {
    const engine = makeEngineStub();
    const scheduler = makeScheduler(engine);

    scheduler.applyRemoteConfig({
      commands: [{ id: 'c3', type: 'update_config', payload: {} }],
    });
    await flush();

    expect(engine.updateMapping).not.toHaveBeenCalled();
  });
});
