// 프론트 크레딧 상수 파일 다시 만들기(★ 2026-11-01 설계서 §16-2 · D1) — packages/backend 에서 `npx ts-node scripts/gen-credit-constants.ts`
import { writeFileSync } from 'fs';
import { GENERATED_PATH, renderFrontendCreditConstants } from './credit-constants-lib';

writeFileSync(GENERATED_PATH, renderFrontendCreditConstants(), 'utf8');
console.log(`[gen-credit-constants] ${GENERATED_PATH}`);
