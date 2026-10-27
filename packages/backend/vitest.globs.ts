import { configDefaults } from 'vitest/config';

// 기본 시험(npm test · push 전)이 모으는 파일 · 한 곳(★ 2026-10-27 vitest.config.ts 와 스탬프 계약 pg-test-stamp.test.ts 가 같은 글로브를 쓴다)
// 실 PG 시험(*.pg.test.ts)은 npm run test:pg 로만 돈다 · exclude 를 두면 기본 제외 목록을 덮으므로 펼친다.
export const UNIT_INCLUDE = ['src/**/*.test.ts'];
export const UNIT_EXCLUDE = [...configDefaults.exclude, 'src/**/*.pg.test.ts'];
