import { defineConfig } from 'vitest/config';
import PgReporter from './src/utils/__tests__/pg/reporter';

// 실 PG 시험층(★ 2026-10-27 설계서 docs/2026-10-27-real-pg-test-deploy-ledger-design.md §2)
//   실행 = npm run test:pg(실행기 scripts/test-pg.mjs 가 env · cwd · 우선순위를 소유 · 이 파일을 바로 부르면 안전문에서 멈춘다)
//   그릇 · 포트 · 암호 · 기동 명령 = scripts/test-pg-env.mjs 머리
//   대상 = 시험의 주장이 PG 의미론(잠금 · 동시성 / 충돌 · 제약 / 타입 추론 · 드라이버 / pg-mem 이 못 읽는 문법)에 기대는 것만(§2-7)
//   다음 이관 후보(의무 아님 · 기계 신호 = SQL .replace( · registerFunction · 「pg-mem … 못」 주석) =
//     consent-rfm-sql-1004 · mall-hardening-1027 · v2-round5-0929 · brand-membership-1001 · brand-refusal-copy-1001 · trial-downgrade-sql
export default defineConfig({
  root: __dirname,   // 실행기 cwd = src(.env 없음)라 root 를 이 파일 자리(packages/backend)로 둔다
  envDir: false,     // vite 가 root 의 .env 파일을 읽지 않게(운영 접속 값이 들어올 길 · 안전문 조건 1 · 4 와 짝)
  test: {
    include: ['src/**/*.pg.test.ts'],
    environment: 'node',
    globalSetup: ['./src/utils/__tests__/pg/global-setup.ts'],
    setupFiles: ['./src/utils/__tests__/pg/setup-file.ts'],
    maxWorkers: 2,
    testTimeout: 60000,
    hookTimeout: 60000,
    reporters: ['default', new PgReporter()],
  },
});
