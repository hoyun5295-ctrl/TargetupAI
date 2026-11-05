// ★ 2026-11-05 C107 G5 · 뿌리 R62 — 비토 게이트웨이 실패 코드 대역(한줄로 에이전트 = failure_code_policy mapped) 라벨 생성.
//
// 원천 = 게이트웨이 standard_result_code(게이트웨이 저장소 migrations 를 얹은 DB) · 대역 규칙 = 게이트웨이 scripts/gw/customer-failure-codes-hanjul.sql 과 같은 글자:
//   앞머리(KAKAO · LMSMMS · SMS · V) + 숫자 n(1~4자리) → 20000+n · 30000+n · 40000+n · 50000+n · 실패 코드만(성공 · 대기 · 접수 계열 빼기).
// 쓰기: node scripts/gen-result-code-hanjul-band.mjs <게이트웨이 DB 접속 주소>   → src/utils/result-code-hanjul-band.generated.ts 를 다시 쓴다.
//   접속 주소 = 시험 그릇의 t_ DB(게이트웨이 migrations 적용본) · 운영 DB 에 붙지 않는다(운영 표에 새 코드가 생기면 대역 기본 라벨이 덮는다).
import pg from 'pg';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const dsn = process.argv[2];
if (!dsn) {
  console.error('쓰기: node scripts/gen-result-code-hanjul-band.mjs <게이트웨이 DB 접속 주소>');
  process.exit(1);
}
const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'utils', 'result-code-hanjul-band.generated.ts');

const client = new pg.Client({ connectionString: dsn });
await client.connect();
const { rows } = await client.query(`
  SELECT src.standard_code, src.title_ko, m[1] AS family,
         (CASE m[1] WHEN 'KAKAO' THEN 20000 WHEN 'LMSMMS' THEN 30000 WHEN 'SMS' THEN 40000 WHEN 'V' THEN 50000 END + m[2]::int) AS band
  FROM standard_result_code src
  CROSS JOIN LATERAL regexp_match(src.standard_code, '^(KAKAO|LMSMMS|SMS|V)_?([0-9]{1,4})(?:_|$)') AS m
  WHERE src.is_active = TRUE AND src.is_success = FALSE AND src.status_class NOT IN ('pending', 'accepted') AND m IS NOT NULL
  ORDER BY band`);
await client.end();

const seen = new Set();
const lines = rows.map((r) => {
  if (seen.has(r.band)) throw new Error(`대역 코드 겹침 ${r.band}`);
  seen.add(r.band);
  if (r.band < 20000 || r.band > 59999) throw new Error(`대역 밖 ${r.band}`);
  return `  ${r.band}: { standard: ${JSON.stringify(r.standard_code)}, title: ${JSON.stringify(String(r.title_ko || '').trim())} },`;
});
if (lines.length === 0) throw new Error('뽑힌 실패 코드 0');

writeFileSync(OUT, `// 생성 파일 — 손대지 않는다. 다시 만들기 = node scripts/gen-result-code-hanjul-band.mjs <게이트웨이 DB>(★ 2026-11-05 C107 G5 · R62).
// 비토 게이트웨이가 한줄로 에이전트에 돌려주는 실패 코드(대역) → 그 표준 코드 · 제목. 라벨 조립 = sms-result-map.ts bandStatusInfo.
export const HANJUL_BAND_CODES: Readonly<Record<number, { standard: string; title: string }>> = {
${lines.join('\n')}
};
`, 'utf8');
console.log(`ok ${lines.length} → ${OUT}`);
