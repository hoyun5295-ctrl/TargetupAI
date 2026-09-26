/**
 * 대행 메일 접수 워커 — DB 연결을 못 얻어도 실행 표시가 풀린다 (★2026-09-26 한줄로 V2 R1-07)
 *
 * `running = true` 뒤 `pool.connect()`가 try 밖이라, 연결을 한 번 못 얻으면(풀 고갈·DB 재시작) 예외가 finally를 타지 않아
 * `running`이 true로 남았다 → 프로세스 재시작 전까지 이메일 대행 접수가 영구 정지.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const connectMock = vi.fn();
vi.mock('../../config/database', () => ({
  default: { connect: (...a: any[]) => (connectMock as any)(...a), query: vi.fn() },
  query: vi.fn(),
}));

beforeEach(() => {
  connectMock.mockReset();
  process.env.AGENCY_MAIL_ENABLED = 'true';
  process.env.AGENCY_MAIL_USER = 'intake@example.invalid';
  process.env.AGENCY_MAIL_PASS = 'test-not-a-real-password';   // 도달 불가 시험값(메일함 연결 전에 끝난다)
});

describe('runAgencyMailTick 연결 실패', () => {
  it('연결 실패 뒤 다음 주기가 다시 연결을 시도한다(실행 표시가 풀렸다)', async () => {
    const { runAgencyMailTick } = await import('../agency-send-mail-worker');
    connectMock.mockRejectedValueOnce(new Error('pool exhausted'));
    await runAgencyMailTick().catch(() => undefined);
    connectMock.mockRejectedValueOnce(new Error('pool exhausted'));
    await runAgencyMailTick().catch(() => undefined);
    expect(connectMock).toHaveBeenCalledTimes(2);
    // 워커 모듈을 본문에서 불러오므로 전체 실행 부하에서는 로드만 5초를 넘길 수 있다(0926 전수 1회 5,012ms) — 로드 시간을 넉넉히
  }, 20000);
});
