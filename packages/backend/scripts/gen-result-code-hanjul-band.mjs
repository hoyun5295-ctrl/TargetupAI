// ★ 2026-11-05 C107 G5 · 뿌리 R62 — 비토 게이트웨이 실패 코드 대역(한줄로 에이전트 = failure_code_policy mapped) 라벨 생성.
//
// 원천 = 게이트웨이 standard_result_code(게이트웨이 저장소 migrations 를 얹은 DB) · 대역 규칙 = 게이트웨이 scripts/gw/customer-failure-codes-hanjul.sql 과 같은 글자:
//   앞머리(KAKAO · LMSMMS · SMS · V) + 숫자 n(1~4자리) → 20000+n · 30000+n · 40000+n · 50000+n · 실패 코드만(성공 · 대기 · 접수 계열 빼기).
// 쓰기: node scripts/gen-result-code-hanjul-band.mjs <게이트웨이 DB 접속 주소>   → src/utils/result-code-hanjul-band.generated.ts 를 다시 쓴다.
//   접속 주소 = 시험 그릇의 t_ DB(게이트웨이 migrations 적용본).
// ★ 2026-11-06 비토엔진 오류접수(결과코드 매핑 · D-A6) — 운영 표(마이그레이션 밖 DML 로 늘어난 표준 코드 포함 · 1106 젬텍 재매핑 18)가 진실이다.
//   쓰기 2: node scripts/gen-result-code-hanjul-band.mjs --tsv <파일>   (파일 = 아래 BAND_SQL 을 운영 게이트웨이 DB 에서
//   COPY (…) TO STDOUT 으로 뽑은 것 = COPY text 꼴 · 줄 = 대역 \t 표준 코드 \t 제목 · 머리 줄 없음 · 제목 안 줄바꿈 · 탭 · 역슬래시는 \n \t \\ 로 온다).
//   게이트웨이 표준 코드를 바꾸면 다시 만든다(한줄로 감시 워커가 라벨 없는 대역을 알린다).
import pg from 'pg';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const BAND_SQL = `
  SELECT (CASE m[1] WHEN 'KAKAO' THEN 20000 WHEN 'LMSMMS' THEN 30000 WHEN 'SMS' THEN 40000 WHEN 'V' THEN 50000 END + m[2]::int) AS band,
         src.standard_code, src.title_ko
  FROM standard_result_code src
  CROSS JOIN LATERAL regexp_match(src.standard_code, '^(KAKAO|LMSMMS|SMS|V)_?([0-9]{1,4})(?:_|$)') AS m
  WHERE src.is_active = TRUE AND src.is_success = FALSE AND src.status_class NOT IN ('pending', 'accepted') AND m IS NOT NULL
  ORDER BY band`;

const arg = process.argv[2];
if (!arg) {
  console.error('쓰기: node scripts/gen-result-code-hanjul-band.mjs <게이트웨이 DB 접속 주소> | --tsv <파일>');
  process.exit(1);
}
const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'utils', 'result-code-hanjul-band.generated.ts');

let rows;
if (arg === '--tsv') {
  const file = process.argv[3];
  if (!file) throw new Error('--tsv 뒤에 파일');
  // COPY text 꼴 칸 풀기(\\ · \n · \r · \t).
  const unescape = (s) => s.replace(/\\(.)/g, (_, c) => ({ n: '\n', r: '\r', t: '\t' })[c] ?? c);
  rows = readFileSync(file, 'utf8').split(/\r?\n/).filter((l) => l.trim()).map((l) => {
    const cols = l.split('\t');
    if (cols.length !== 3 || !/^\d{5}$/.test(cols[0]) || !cols[1]) throw new Error(`표 파일 줄 꼴이 아니다: ${l}`);
    return { band: Number(cols[0]), standard_code: unescape(cols[1]), title_ko: unescape(cols[2]) };
  }).sort((a, b) => a.band - b.band);
} else {
  const client = new pg.Client({ connectionString: arg });
  await client.connect();
  ({ rows } = await client.query(BAND_SQL));
  await client.end();
}

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
