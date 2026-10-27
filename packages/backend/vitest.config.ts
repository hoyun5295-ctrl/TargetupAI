import { defineConfig } from 'vitest/config';
import { UNIT_INCLUDE, UNIT_EXCLUDE } from './vitest.globs';

// 순수 유닛 테스트 전용 — DB/네트워크 의존 없는 함수만 대상.
// backend는 운영 ts-node/tsc OOM 이력이 있어, vitest(esbuild 기반)로 가볍게 분리한다.
// ★ 2026-10-27 실 PG 시험(*.pg.test.ts)은 npm run test:pg 로만 돈다(vitest.pg.config.ts · push 전 시험에 안 든다 · 글로브 = vitest.globs.ts).
export default defineConfig({
  test: {
    include: UNIT_INCLUDE,
    exclude: UNIT_EXCLUDE,
    environment: 'node',
    // ★ 2026-09-29 테스트 안에서 모듈을 그 자리에서 불러오는(await import) 파일이 43개 — 불러오는 시간이 제한 시간에 들어간다.
    //   혼자 돌리면 1초대인 테스트(tier2-rest-0927 R372)가 push 전 전체 병렬 실행 부하에서 기본 5초를 넘어 push 가 막혔다.
    //   개별로 20~30초를 준 테스트(agency-mail-tick-connect · agency-parse-isolated)와 같은 기준으로 기본값을 올린다.
    // ★ 2026-10-26 같은 뿌리 재발 — 준비 단계(beforeEach)에서 불러오는 시간은 hookTimeout(기본 10초)에 들어가는데 그 값은 그대로였다.
    //   push 전 전체 실행 부하(불러오기 합계 1,170초)에서 journey-v3-credit-out-1020(준비 10초) · oneline-content-1021(시험 20초)이 넘겨 push 가 막혔다
    //   (둘 다 혼자 돌리면 통과). 두 제한을 같게 두고 실측 20초 초과의 3배로 올린다. 정말 멈춘 시험은 60초 뒤 실패로 잡힌다.
    testTimeout: 60000,
    hookTimeout: 60000,
  },
});
