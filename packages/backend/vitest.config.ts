import { defineConfig } from 'vitest/config';

// 순수 유닛 테스트 전용 — DB/네트워크 의존 없는 함수만 대상.
// backend는 운영 ts-node/tsc OOM 이력이 있어, vitest(esbuild 기반)로 가볍게 분리한다.
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
});
