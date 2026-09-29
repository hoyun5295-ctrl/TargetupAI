import { defineConfig } from 'vitest/config';

// 순수 유닛 테스트 전용 — DB/네트워크 의존 없는 함수만 대상.
// backend는 운영 ts-node/tsc OOM 이력이 있어, vitest(esbuild 기반)로 가볍게 분리한다.
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
    // ★ 2026-09-29 테스트 안에서 모듈을 그 자리에서 불러오는(await import) 파일이 43개 — 불러오는 시간이 제한 시간에 들어간다.
    //   혼자 돌리면 1초대인 테스트(tier2-rest-0927 R372)가 push 전 전체 병렬 실행 부하에서 기본 5초를 넘어 push 가 막혔다.
    //   개별로 20~30초를 준 테스트(agency-mail-tick-connect · agency-parse-isolated)와 같은 기준으로 기본값을 올린다.
    testTimeout: 20000,
  },
});
