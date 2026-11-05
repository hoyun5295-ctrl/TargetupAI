// 그리는 부품 사본 만들기(★ 2026-11-05 인앱 포스터 재구성 설계서 §3-7 · 계약 시험 CT-IA5)
// 원본 = packages/sdk-js/src/poster-frame.ts · 사본 = src/components/inapp/generated/poster-frame.ts(머리 한 줄 + 원본 글자 그대로)
// 실행: node scripts/sync-poster-frame.mjs (원본을 고친 뒤 · 사본을 직접 고치지 않는다)
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const src = resolve(here, '../../sdk-js/src/poster-frame.ts');
const out = resolve(here, '../src/components/inapp/generated/poster-frame.ts');
export const POSTER_FRAME_COPY_HEADER = '// 자동 복사본 · 직접 고치지 않는다 · 원본 packages/sdk-js/src/poster-frame.ts · node scripts/sync-poster-frame.mjs\n';
writeFileSync(out, POSTER_FRAME_COPY_HEADER + readFileSync(src, 'utf8'));
console.log(`복사: ${src} -> ${out}`);
