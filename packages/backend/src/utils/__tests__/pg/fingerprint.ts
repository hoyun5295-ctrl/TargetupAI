/**
 * 정의 해시(★ 2026-10-27 설계서 §2-6) — 운영과 로컬이 이 글자를 그대로 돈다(원장 DDL 항목의 「확인 한 줄」에 AI 가 그대로 옮긴다).
 * public 스키마의 칸(형 = format_type 이라 정밀도 · 자릿수 · 길이 포함 · NOT NULL · 기본값 · 생성 · identity) · 제약 · 색인 정의를
 * 이름 순으로 이어 붙인 md5 하나. 위치 번호(attnum)는 넣지 않는다. pg_catalog 만 읽어 권한에 따라 보이는 칸이 달라지지 않는다(Codex 구현 R1 #3).
 * 기본 search_path 연결에서 돌린다(덤프 적재 연결은 search_path 를 비워 이름이 schema 까지 붙는다).
 * "char" 칸(relkind · attgenerated · attidentity)은 ::text 로 잇는다 — PG 15 에서 text || "char" 는 연산자를 못 고른다(1027 운영 덤프 ② 42725).
 * 정렬 = C(이름 칸의 정렬 · 글로 고정).
 */

/*
 * 덤프 왕복이 바꾸는 표기 하나를 맞춘 뒤 센다(1028 첫 덤프 · 5,167줄 중 94줄이 이 꼴뿐): varchar 칸 IN 목록의 CHECK · 부분 색인 정의가
 *   운영 = ANY ((ARRAY['a'::character varying, …])::text[]) · 복원 = ANY (ARRAY[('a'::character varying)::text, …]) → 둘 다 ANY (ARRAY['a'::character varying, …]).
 * 식 칸 셋(기본값 · 제약 · 색인 정의)에만 건다. 두 정규식 모두 맨 앞 갈래가 문자열 상수 '…' · 따옴표 이름 "…" 하나를 통째로 잡아 그대로 돌려준다 —
 *   왼쪽부터 읽으며 문자열을 만나면 끝까지 건너뛰므로 문자열 안 글자는 바꾸는 갈래에 닿지 않는다(Codex R2 · R3 = 다른 기본값이 같은 해시로 모임).
 * 바꾸는 갈래는 「= ANY (…)」 구문 하나가 통째로 그 꼴일 때만 잡는다 — 운영 꼴은 배열 전체를 한 번에 · 복원 꼴 원소는 앞뒤 원소가 모두
 *   같은 꼴이고 「= ANY (ARRAY[」 로 열려 「])」 로 닫힐 때만(앞 · 뒤 살핌) · 그 밖의 식(예: pg_typeof(ARRAY[('a'::varchar)::text]))은 그대로(Codex R4).
 * 다른 꼴의 표기 차이가 생기면 지금처럼 해시가 달라 test:pg 가 멈춘다(조용히 통과하지 않음).
 */
const LIT = `''(?:[^'']|'''')*''`;
const DQ = `"(?:[^"]|"")*"`;
const normExpr = (e: string): string =>
  `regexp_replace(regexp_replace(${e}, '(${LIT})|(${DQ})|(= ANY \\()\\((ARRAY\\[(?:${LIT}::character varying(?:, )?)+\\])\\)::text\\[\\](\\))', '\\1\\2\\3\\4\\5', 'g'),` +
  ` '(${LIT})|(${DQ})|(?<== ANY \\(ARRAY\\[(?:\\(${LIT}::character varying\\)::text, )*)\\((${LIT}::character varying)\\)::text(?=(?:, \\(${LIT}::character varying\\)::text)*\\]\\))', '\\1\\2\\3', 'g')`;

export const SCHEMA_FINGERPRINT_SQL = `SELECT md5(string_agg(x, E'\\n' ORDER BY x COLLATE "C")) AS fingerprint FROM (
  SELECT 'c|' || c.relname || '|' || c.relkind::text || '|' || a.attname || '|' || format_type(a.atttypid, a.atttypmod) || '|' || a.attnotnull::text
         || '|' || COALESCE(${normExpr('pg_get_expr(d.adbin, d.adrelid)')}, '') || '|' || a.attgenerated::text || '|' || a.attidentity::text AS x
    FROM pg_attribute a
    JOIN pg_class c ON c.oid = a.attrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
    LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
   WHERE a.attnum > 0 AND NOT a.attisdropped AND c.relkind IN ('r', 'p', 'v', 'm', 'f')
  UNION ALL
  SELECT 'k|' || COALESCE(conrelid::regclass::text, '') || '|' || conname || '|' || ${normExpr('pg_get_constraintdef(oid)')}
    FROM pg_constraint WHERE connamespace = 'public'::regnamespace
  UNION ALL
  SELECT 'i|' || tablename || '|' || indexname || '|' || ${normExpr('indexdef')}
    FROM pg_indexes WHERE schemaname = 'public'
) s`;

/** 덤프 받는 창의 머리 SELECT 한 번(출력 한 줄 = schema.meta.json 그대로) */
export const SCHEMA_META_SQL = `SELECT json_build_object(
  'server_version', current_setting('server_version'),
  'datcollate', (SELECT datcollate FROM pg_database WHERE datname = current_database()),
  'timezone', current_setting('TimeZone'),
  'at', now(),
  'fingerprint', (${SCHEMA_FINGERPRINT_SQL})
)::text AS meta`;
