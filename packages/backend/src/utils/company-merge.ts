/**
 * company-merge.ts — 회사 병합 CT (2026-07-29)
 *
 * 기원: 레거시 템플릿관리자 이관 때 계정명이 달라 같은 업체가 한줄로에 회사 2개로 생성됐다.
 * 서수란 팀장 점검표 회신(0729 접수 cms5nngsp00br6ueonlsup1ba) = 쎌렉박스→마트스마트 ·
 * topcleaningup→베터라이프 · 아이올리(더에이몰)→제이씨패밀리. 옛 회사는 이미 terminated인데
 * 발신프로필·템플릿·게이트웨이 bill이 거기 남아 있어, 신규 승인분 자동 등록(auto_push)이
 * 해지된 회사 축으로 돈다.
 *
 * ── 설계 원칙 ──
 * 1) 이동 축은 이 파일의 표(COMPANY_MERGE_AXES)에서만 정의한다. 라우트에 UPDATE를 나열하면
 *    축이 늘 때마다 빠뜨림이 곧 고아 행이 된다(no_inline_duplication).
 * 2) 표에 없는 축에 옛 회사 행이 있으면 중단한다(fail-closed). 고객·캠페인처럼 중복 판단이
 *    필요한 데이터를 자동으로 옮기느니 사람이 판단하게 한다.
 * 3) UNIQUE 충돌 축을 손으로 고르지 않는다 — `pg_index`에서 전수 파생한다.
 *    ★ 이 규칙의 기원(0729 Codex 적대검증): yellow_id·template_key만 손으로 골랐다가
 *      `kakao_sender_profiles(company_id, profile_key)`와 `brand_message_templates(company_id,
 *      template_key)` 두 축을 빠뜨렸다. 손으로 고르는 방식 자체가 원인이라 방식을 바꿨다.
 * 4) `company_id`가 없는 간접 참조도 전수 탐지한다 — 이동 테이블을 FK로 가리키면서 자신은
 *    이동 축이 아닌 테이블은 회사가 엇갈린 연결을 만든다(`user_sender_profiles` 실측).
 *    탐지된 것이 등재돼 있지 않으면 중단한다.
 * 5) 이동 후 잔존 0을 트랜잭션 안에서 재카운트하고, 커밋 뒤에 한 번 더 센다(6원칙 ②).
 *    keep 축이 남는 것은 정상이므로 "옛 회사 전체 잔존 0"을 성공 조건으로 쓰면 안 된다.
 *
 * ── 동시 쓰기에 대한 한계(명시) ──
 * 게이트웨이 적재 워커는 이 잠금을 잡지 않고 5분 주기로 `gateway_template_mappings`에 넣는다
 * (INSERT ... JOIN gateway_bill_mappings b ON b.company_id = t.company_id). 워커가 옛 상태를
 * 읽은 직후 병합이 커밋되면 그 1행만 옛 `company_id`로 남는다. 발송은 `bill_id`·`tmplcd`로
 * 돌기 때문에 라우팅은 깨지지 않는다. 이 도구는 멱등이라 **재실행하면 늦게 들어온 행이 흡수된다.**
 * 커밋 후 재검증이 그 행을 보고하므로 조용히 지나가지 않는다. 워커·일반 라우트 전체에 분산
 * 잠금을 도입하는 것은 발송 인접 코드를 이 도구 하나 때문에 건드리는 일이라 하지 않는다.
 *
 * 옛 회사는 삭제하지 않는다 — companies를 지우면 FK CASCADE로 프로필·템플릿·발송ID가 딸려
 * 지워진다. terminated 상태로 남겨 이력을 보존한다.
 */

import pool, { query } from '../config/database';

export type MergeAxisAction = 'move' | 'keep';

export interface MergeAxis {
  table: string;
  action: MergeAxisAction;
  reason: string;
}

/**
 * 병합 축 표 — 여기 없는 테이블에 옛 회사 행이 있으면 병합은 차단된다.
 *
 * move = 그 회사가 "보유한 자산". 병합 대상이 이어받아야 발송·등록이 계속 돈다.
 * keep = 그 회사가 "겪은 이력"과 "고유 상태". 옮기면 병합 대상의 사실을 오염시킨다.
 */
export const COMPANY_MERGE_AXES: readonly MergeAxis[] = [
  { table: 'kakao_sender_profiles', action: 'move', reason: '카카오 발신프로필: 이관 자산 본체' },
  { table: 'kakao_templates', action: 'move', reason: '알림톡 템플릿: 프로필과 같은 회사에 있어야 한다' },
  { table: 'brand_message_templates', action: 'move', reason: '브랜드메시지 템플릿: 프로필 종속' },
  { table: 'gateway_bill_mappings', action: 'move', reason: '게이트웨이 납입자ID 연결: auto_push가 이 축으로 돈다' },
  { table: 'gateway_template_mappings', action: 'move', reason: '게이트웨이 매핑: company_id가 채워진 행만(시드 행은 bill_id 축이라 NULL)' },
  { table: 'company_agent_ids', action: 'move', reason: 'PAY 발송ID: 발송결과·정산이 이 축을 읽는다' },

  // ★ 2026-08-16 마케팅 진단(설계서 §4-7) — 미등재면 진단 행 있는 회사의 병합이 통째로 차단된다.
  { table: 'marketing_diagnoses', action: 'move', reason: '진단·리드 원장: 관리 파이프라인 연속성. funnel A 부분 UNIQUE가 겹치면(양쪽 다 진단 완료) 충돌 차단 = 사람 판단' },
  { table: 'diagnosis_trial_grants', action: 'keep', reason: '진단 체험 지급 이력(1회 한정 원장): 병합 대상 자신의 지급 상태를 유지한다(선행 행 유지 §4-7). 옛 회사에 진단 행이 함께 있으면 간접 축이 차단한다' },
  { table: 'diagnosis_invites', action: 'keep', reason: '초대 표시 기록: UX 상태이지 자산이 아니다. 병합 대상 상태 유지(모달 1회 재노출은 무해)' },

  { table: 'users', action: 'keep', reason: '계정: 실사용 계정은 병합 대상에 이미 있고 옛 계정은 status로 로그인 차단된다' },
  { table: 'company_plan_changes', action: 'keep', reason: '요금제 이력: 옮기면 병합 대상이 겪지 않은 변경이 이력에 생긴다' },
  { table: 'company_settings', action: 'keep', reason: '회사 설정: 옮기면 병합 대상의 현재 설정을 옛 값으로 덮는다' },
  { table: 'customer_code_sequences', action: 'keep', reason: '고객코드 채번 상태: 회사 고유값이라 합칠 수 없다' },
];

/**
 * 간접 참조 축 — `company_id`가 없어서 회사 축 열거에 안 잡히는 연결 테이블.
 * 이동 테이블을 FK로 가리키는데 자신은 이동 축이 아니면, 프로필은 옮겨가고 상대(계정 등)는
 * 남아 회사가 엇갈린 연결이 된다. 전수 탐지에서 나온 테이블은 여기 등재돼야 진행된다.
 */
/**
 * FK 서명 — 테이블명만으로 등재하면, 그 테이블에 다른 이동 테이블을 향한 FK가 하나 더 생겼을 때
 * 새 축이 기존 등재로 오인돼 검사 없이 통과한다(★0729 Codex 2R 지적 ①). 자식 컬럼과 부모까지
 * 서명에 넣어 대조한다.
 */
export interface IndirectFkRef {
  childTable: string;
  childColumns: string[];
  parentTable: string;
  parentColumns: string[];
}

export interface IndirectAxis {
  childTable: string;
  childColumns: string[];
  parentTable: string;
  /** 지금은 전부 block — 가리키는 행이 있으면 사람이 판단한다. 정책이 정해지면 축을 넓힌다. */
  action: 'block';
  reason: string;
}

/**
 * 등재된 간접 축 — 0729 실측으로 이동 테이블을 가리키는 FK는 넷이다.
 * count 쿼리는 손으로 쓰지 않는다(설계 원칙 3과 같은 이유) — FK 서명에서 파생한다.
 * 판정 기준은 하나로 통일했다: **옮길 행을 가리키는 다른 테이블 행이 있으면 차단.**
 */
export const COMPANY_MERGE_INDIRECT_AXES: readonly IndirectAxis[] = [
  {
    childTable: 'user_sender_profiles',
    childColumns: ['profile_id'],
    parentTable: 'kakao_sender_profiles',
    action: 'block',
    reason: '사용자-발신프로필 연결. 프로필은 옮겨가고 계정은 남으므로 회사가 엇갈린 연결이 된다',
  },
  {
    childTable: 'billing_items',
    childColumns: ['agent_id'],
    parentTable: 'company_agent_ids',
    action: 'block',
    reason: '청구 항목이 발송ID를 가리킨다. 청구는 돈 이력이라 옮길 수 없고, 발송ID만 옮기면 지난 청구가 다른 회사 자산을 가리킨다',
  },
  {
    childTable: 'campaigns',
    childColumns: ['kakao_profile_id'],
    parentTable: 'kakao_sender_profiles',
    action: 'block',
    reason: '캠페인은 자기 회사에 남는데 발신프로필이 옮겨간다. 지난 발송이 다른 회사 프로필을 가리킨다',
  },
  {
    childTable: 'campaigns',
    childColumns: ['kakao_template_id'],
    parentTable: 'kakao_templates',
    action: 'block',
    reason: '캠페인은 자기 회사에 남는데 템플릿이 옮겨간다. 지난 발송이 다른 회사 템플릿을 가리킨다',
  },
  // ★ 2026-08-16 마케팅 진단(설계서 §4-7)
  {
    childTable: 'diagnosis_trial_grants',
    childColumns: ['diagnosis_id'],
    parentTable: 'marketing_diagnoses',
    action: 'block',
    reason: '지급 이력(keep)이 진단 행(move)을 가리킨다. 함께 있으면 회사가 엇갈린 연결이 된다. 옛 회사 지급·진단을 정리한 뒤 진행한다',
  },
];

export interface AxisCount {
  table: string;
  action: MergeAxisAction;
  rows: number;
}

export type MergeBlockerKind =
  | 'company_not_found'
  | 'same_company'
  | 'source_not_terminated'
  | 'source_has_active_user'
  | 'destination_not_active'
  | 'unregistered_axis'
  | 'unregistered_indirect_axis'
  | 'indirect_axis_rows'
  | 'unique_conflict'
  | 'unsupported_unique_index'
  | 'pair_confirmation_required'
  | 'pair_confirmation_mismatch';

/**
 * 실행 확인 — 실행하는 사람이 "무엇을 무엇에 합치는지"를 회사코드로 함께 적게 하고 서버가 DB 값과
 * 대조한다. terminated·active 게이트만으로는 서로 무관한 두 회사도 통과하므로, uuid를 잘못 넣은
 * 실행이 다른 테넌트로 자산을 옮기는 것을 이 대조가 막는다(★0729 Codex 2R 지적 ② 수용).
 * 확인 토큰·사전 승인 레코드 대신 코드 대조를 쓰는 이유는 새 상태를 만들지 않기 때문이다.
 */
export interface MergeConfirm {
  fromCompanyCode: string;
  toCompanyCode: string;
}

export interface MergeBlocker {
  kind: MergeBlockerKind;
  detail: string;
}

export interface CompanyBrief {
  id: string;
  name: string | null;
  companyCode: string | null;
  status: string | null;
  usageType: string | null;
}

export interface UniqueIndexInfo {
  table: string;
  indexName: string;
  /** 키 컬럼 (company_id 포함) */
  columns: string[];
  predicate: string | null;
  nullsNotDistinct: boolean;
}

export interface MergePlan {
  from: CompanyBrief | null;
  to: CompanyBrief | null;
  axes: AxisCount[];
  /** 표에 없는데 옛 회사 행이 있는 테이블 */
  unregistered: AxisCount[];
  /** 표에는 있으나 DB에 없는 테이블 (DDL 미실행 등) — 건너뛴다 */
  missingTables: string[];
  /** pg_index에서 파생한 회사 축 UNIQUE 인덱스와 충돌 건수 */
  uniqueChecks: Array<{ table: string; indexName: string; conflicts: number }>;
  /** 간접 참조 — 탐지된 FK 서명과 등재 축의 실제 행 수 */
  indirect: Array<{ signature: string; childTable: string; registered: boolean; rows: number | null }>;
  blockers: MergeBlocker[];
}

export interface MergeResult {
  from: CompanyBrief | null;
  to: CompanyBrief | null;
  moved: AxisCount[];
  missingTables: string[];
  /** 커밋 후 다시 센 이동 축 잔존 — 동시 쓰기로 늦게 들어온 행이 여기 잡힌다(재실행으로 흡수) */
  postCommitResidue: AxisCount[];
  verified: boolean;
}

/** 병합이 차단됐다 — 라우트가 409로 변환한다. */
export class CompanyMergeBlockedError extends Error {
  constructor(public readonly plan: MergePlan) {
    super('회사 병합이 차단되었습니다.');
    this.name = 'CompanyMergeBlockedError';
  }
}

/** 이동 후 잔존이 0이 아니다 — 트랜잭션을 되돌린다(6원칙 ②). */
export class CompanyMergeResidueError extends Error {
  constructor(public readonly residue: AxisCount[]) {
    super(`이동 후 잔존이 남았습니다: ${residue.map((r) => `${r.table}=${r.rows}`).join(', ')}`);
    this.name = 'CompanyMergeResidueError';
  }
}

/**
 * ★2026-08-16 마케팅 진단 지급 결합 카운트(§4-7 보강 — Codex 적대 수용).
 * 지급(keep) 행이 옛 회사의 진단(소유 move 또는 연결 relink 대상)을 가리키면 병합 후 귀속이 갈라진다.
 * pg-mem 픽스처 테스트가 이 SQL 자체를 실행해 의미를 고정한다.
 */
export const DIAGNOSIS_GRANT_SPLIT_SQL = `
  SELECT count(*)::int AS cnt
    FROM diagnosis_trial_grants g
    JOIN marketing_diagnoses d ON d.id = g.diagnosis_id
   WHERE g.company_id = $1::uuid
      OR d.company_id = $1::uuid
      OR d.linked_company_id = $1::uuid`;

// ===== 순수 함수 (계약 테스트 대상) =====

export function moveTables(): string[] {
  return COMPANY_MERGE_AXES.filter((a) => a.action === 'move').map((a) => a.table);
}

export function keepTables(): string[] {
  return COMPANY_MERGE_AXES.filter((a) => a.action === 'keep').map((a) => a.table);
}

export function registeredTables(): string[] {
  return COMPANY_MERGE_AXES.map((a) => a.table);
}

/** 표에 없는 테이블만 골라낸다 — 미등록 축 차단 게이트의 판정부. */
export function findUnregisteredTables(tablesWithCompanyId: string[]): string[] {
  const known = new Set(registeredTables());
  return tablesWithCompanyId.filter((t) => !known.has(t));
}

/** FK 서명 — 자식 테이블·자식 컬럼·부모 테이블 셋으로 축을 식별한다. */
export function indirectSignature(ref: {
  childTable: string;
  childColumns: string[];
  parentTable: string;
}): string {
  return `${ref.childTable}(${[...ref.childColumns].sort().join(',')})->${ref.parentTable}`;
}

/**
 * 파생 가능한 FK 모양인지 — 단일 컬럼이 부모 `id`를 가리키는 형태만 count 쿼리를 만들 수 있다.
 * 복합 FK나 `id`가 아닌 컬럼을 가리키면 계산하지 않고 차단한다(fail-closed).
 */
export function isIndirectRefSupported(ref: IndirectFkRef): boolean {
  if (ref.childColumns.length !== 1 || ref.parentColumns.length !== 1) return false;
  if (ref.parentColumns[0] !== 'id') return false;
  return (
    isSafeIdentifier(ref.childTable) && isSafeIdentifier(ref.parentTable) && isSafeIdentifier(ref.childColumns[0])
  );
}

/**
 * 간접 참조 건수 쿼리 — 옮길 행(부모)을 가리키는 자식 행 수. FK 서명에서 파생한다.
 * $1 = 옛 회사 id.
 */
export function buildIndirectCountQuery(ref: IndirectFkRef): string {
  if (!isIndirectRefSupported(ref)) throw new Error(`파생할 수 없는 FK 서명: ${indirectSignature(ref)}`);
  return `SELECT count(*)::int AS cnt
            FROM "${ref.childTable}" ch
            JOIN "${ref.parentTable}" p ON p.id = ch."${ref.childColumns[0]}"
           WHERE p.company_id = $1::uuid`;
}

/** 탐지된 간접 참조 중 등재되지 않은 서명 — 있으면 차단한다. */
export function findUnregisteredIndirect(detected: IndirectFkRef[]): string[] {
  const known = new Set(COMPANY_MERGE_INDIRECT_AXES.map((a) => indirectSignature(a)));
  const seen = new Set<string>();
  const out: string[] = [];
  for (const ref of detected) {
    const sig = indirectSignature(ref);
    if (known.has(sig) || seen.has(sig)) continue;
    seen.add(sig);
    out.push(sig);
  }
  return out;
}

/**
 * 식별자 방어 — 테이블·컬럼명은 이 파일의 상수와 pg_catalog에서만 오지만,
 * 문자열을 SQL에 끼워 넣는 자리라 형식을 한 번 더 좁힌다.
 */
export function isSafeIdentifier(name: string): boolean {
  return /^[a-z_][a-z0-9_]*$/.test(name);
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_RE.test(value);
}

/**
 * 잠금 키 정규화 — 대문자 uuid와 소문자 uuid는 PG에서 같은 행을 가리키는데
 * `hashtext(원문)`은 서로 다른 잠금을 잡는다. 소문자로 낮추고 정렬해 항상 같은 순서로 잡는다
 * (반대 방향 병합이 동시에 와도 교착 없음). ★0729 Codex 지적 ② 수용.
 */
export function normalizeLockOrder(a: string, b: string): [string, string] {
  const [x, y] = [a.toLowerCase(), b.toLowerCase()].sort();
  return [x, y];
}

/**
 * UNIQUE 인덱스가 이 CT가 다룰 수 있는 모양인지 — 표현식 인덱스·INCLUDE 컬럼이 섞이면
 * 키 컬럼을 정확히 알 수 없어 충돌 계산이 틀린다. 그때는 통과시키지 않고 차단한다(fail-closed).
 */
export function isUniqueIndexSupported(columns: string[], keyAttCount: number): boolean {
  if (columns.length === 0) return false;
  if (columns.length !== keyAttCount) return false;
  return columns.every((c) => isSafeIdentifier(c));
}

/**
 * 부분 인덱스 술어가 company_id를 참조하는지 — PG는 UPDATE 후 행이 술어를 만족하는지로 UNIQUE를
 * 적용하므로, 그런 술어는 이동 전 값으로 한 사전검사가 빗나간다. 계산하지 않고 차단한다.
 */
export function predicateReferencesCompanyId(predicate: string | null): boolean {
  return predicate !== null && /\bcompany_id\b/.test(predicate);
}

/**
 * 충돌 건수 쿼리 — 회사 축 UNIQUE 인덱스 하나에 대해 옛 회사와 병합 대상이 같은 키를 갖는 수.
 *
 * INTERSECT를 쓰는 이유: 키 컬럼이 여러 개여도 같은 문장으로 처리된다.
 * NULL 처리: PG 기본 UNIQUE는 NULL을 서로 다른 값으로 보므로 키 컬럼이 NULL인 행은 충돌할 수
 * 없다 → 각 키 컬럼에 IS NOT NULL을 건다. `NULLS NOT DISTINCT` 인덱스는 그 반대라 걸지 않는다.
 * 부분 인덱스는 그 술어를 양쪽에 그대로 붙인다(술어 밖 행은 인덱스에 없으니 충돌도 없다).
 * $1 = 옛 회사, $2 = 병합 대상.
 */
export function buildConflictQuery(ix: UniqueIndexInfo): string {
  if (!isSafeIdentifier(ix.table)) throw new Error(`허용되지 않는 테이블명: ${ix.table}`);
  const others = ix.columns.filter((c) => c !== 'company_id');
  for (const c of others) {
    if (!isSafeIdentifier(c)) throw new Error(`허용되지 않는 컬럼명: ${c}`);
  }
  const pred = ix.predicate ? ` AND (${ix.predicate})` : '';

  // company_id 단독 UNIQUE = 회사당 1행 — 양쪽에 행이 있으면 그 자체가 충돌이다.
  if (others.length === 0) {
    return `SELECT LEAST(
              (SELECT count(*) FROM "${ix.table}" WHERE company_id = $1::uuid${pred}),
              (SELECT count(*) FROM "${ix.table}" WHERE company_id = $2::uuid${pred})
            )::int AS cnt`;
  }

  const cols = others.map((c) => `"${c}"`).join(', ');
  const notNull = ix.nullsNotDistinct ? '' : others.map((c) => ` AND "${c}" IS NOT NULL`).join('');
  return `SELECT count(*)::int AS cnt FROM (
            SELECT ${cols} FROM "${ix.table}" WHERE company_id = $1::uuid${notNull}${pred}
            INTERSECT
            SELECT ${cols} FROM "${ix.table}" WHERE company_id = $2::uuid${notNull}${pred}
          ) x`;
}

// ===== DB 접근 =====

type Queryable = { query: (text: string, params?: any[]) => Promise<any> };

async function listCompanyIdTables(client: Queryable): Promise<string[]> {
  const r = await client.query(
    `SELECT c.table_name
       FROM information_schema.columns c
       JOIN information_schema.tables t
         ON t.table_schema = c.table_schema
        AND t.table_name = c.table_name
        AND t.table_type = 'BASE TABLE'
      WHERE c.table_schema = 'public'
        AND c.column_name = 'company_id'
      ORDER BY 1`,
  );
  return r.rows.map((row: any) => String(row.table_name));
}

/**
 * 회사 행 수 — company_id 타입이 테이블마다 다를 수 있어 text로 비교한다.
 * (등록 축은 전부 uuid FK지만 미등록 축 스캔은 아무 테이블이나 만날 수 있다)
 */
async function countRows(client: Queryable, table: string, companyId: string): Promise<number> {
  if (!isSafeIdentifier(table)) throw new Error(`허용되지 않는 테이블명: ${table}`);
  const r = await client.query(
    `SELECT count(*)::int AS cnt FROM "${table}" WHERE company_id::text = $1::text`,
    [companyId],
  );
  return Number(r.rows[0]?.cnt ?? 0);
}

async function fetchCompany(client: Queryable, companyId: string): Promise<CompanyBrief | null> {
  const r = await client.query(
    `SELECT id, name, company_code, status, usage_type FROM companies WHERE id = $1::uuid`,
    [companyId],
  );
  if (r.rows.length === 0) return null;
  const row = r.rows[0];
  return {
    id: String(row.id),
    name: row.name ?? null,
    companyCode: row.company_code ?? null,
    status: row.status ?? null,
    usageType: row.usage_type ?? null,
  };
}

/** 옛 회사에 아직 로그인 가능한 실계정이 있는지 — 있으면 병합 대상이 아니다. */
async function countActiveRealUsers(client: Queryable, companyId: string): Promise<number> {
  const r = await client.query(
    `SELECT count(*)::int AS cnt
       FROM users
      WHERE company_id = $1::uuid
        AND COALESCE(is_system, false) = false
        AND COALESCE(is_active, false) = true
        AND status = 'active'`,
    [companyId],
  );
  return Number(r.rows[0]?.cnt ?? 0);
}

/**
 * 이동 테이블의 회사 축 UNIQUE 인덱스 전수 — 손으로 고르지 않는다(설계 원칙 3).
 *
 * ★0729 Codex 2R 지적 ③ 반영 — `indkey`는 키 컬럼과 INCLUDE 컬럼을 함께 담고 표현식 자리를 0으로
 * 표시한다. 그래서 `attnum = ANY(indkey)`로 뭉쳐 세면 `UNIQUE(company_id, lower(code)) INCLUDE(extra)`가
 * `[company_id, extra]`로 잡혀 개수까지 맞아 통과한다(실제 키가 아닌 컬럼을 비교하게 된다).
 * 0-based 첨자로 **앞 `indnkeyatts`개만** 순서대로 뽑고, 표현식 자리는 이름이 없어 '(expr)'로 남아
 * 식별자 검사에서 걸러진다 = 차단.
 *
 * `nullsNotDistinct`는 `pg_get_indexdef` 문자열로 판정한다. 카탈로그 컬럼 `indnullsnotdistinct`는
 * PG15+에만 있어 운영 DB 버전을 확인하지 않은 상태로 읽으면 이 도구 자체가 42703으로 죽는다.
 */
async function listCompanyScopedUniqueIndexes(
  client: Queryable,
  tables: string[],
): Promise<{
  indexes: UniqueIndexInfo[];
  unsupported: Array<{ table: string; indexName: string; why: string }>;
}> {
  if (tables.length === 0) return { indexes: [], unsupported: [] };
  const r = await client.query(
    `SELECT c.relname AS table_name,
            ir.relname AS index_name,
            i.indnkeyatts AS key_att_count,
            -- ★ ::text 캐스팅 필수 — attname은 name 타입이라 array_agg 결과가 name[]이 되고
            --   node-pg가 그 타입을 배열로 파싱하지 않아 문자열로 온다(0729 실측 TypeError).
            array_agg(COALESCE(a.attname::text, '(expr)') ORDER BY g.pos) AS key_cols,
            pg_get_expr(i.indpred, i.indrelid) AS predicate,
            pg_get_indexdef(i.indexrelid) AS indexdef
       FROM pg_index i
       JOIN pg_class c ON c.oid = i.indrelid
       JOIN pg_class ir ON ir.oid = i.indexrelid
       JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
       CROSS JOIN generate_series(0, i.indnkeyatts - 1) AS g(pos)
       LEFT JOIN pg_attribute a
         ON a.attrelid = i.indrelid
        AND a.attnum = i.indkey[g.pos]
        AND NOT a.attisdropped
      WHERE i.indisunique
        AND i.indislive
        AND c.relname = ANY($1::text[])
      GROUP BY c.relname, ir.relname, i.indnkeyatts, i.indpred, i.indrelid, i.indexrelid
      ORDER BY 1, 2`,
    [tables],
  );

  const indexes: UniqueIndexInfo[] = [];
  const unsupported: Array<{ table: string; indexName: string; why: string }> = [];
  for (const row of r.rows) {
    const cols: string[] = (row.key_cols ?? []).map((c: any) => String(c));
    // 회사 축이 아닌 UNIQUE(전역 UNIQUE — bill_id·agent_send_id 등)는 회사를 옮겨도 안 깨진다.
    if (!cols.includes('company_id')) continue;
    const table = String(row.table_name);
    const indexName = String(row.index_name);
    if (!isUniqueIndexSupported(cols, Number(row.key_att_count))) {
      unsupported.push({ table, indexName, why: `키 컬럼을 확정할 수 없다(${cols.join(', ')})` });
      continue;
    }
    const predicate = row.predicate ? String(row.predicate) : null;
    // ★0729 Codex 2R 지적 ④ — 이동 전 값으로 한 사전검사가 빗나가는 술어는 차단한다.
    if (predicateReferencesCompanyId(predicate)) {
      unsupported.push({ table, indexName, why: `부분 인덱스 술어가 company_id를 참조한다(${predicate})` });
      continue;
    }
    indexes.push({
      table,
      indexName,
      columns: cols,
      predicate,
      nullsNotDistinct: String(row.indexdef ?? '').toUpperCase().includes('NULLS NOT DISTINCT'),
    });
  }
  return { indexes, unsupported };
}

/**
 * 간접 참조 전수 탐지 — 이동 테이블을 FK로 가리키면서 자신은 이동 축이 아닌 테이블.
 * `company_id`가 있든 없든 잡는다(있으면 미등록 축 게이트가 이중으로 잡는다).
 */
async function detectIndirectFkRefs(client: Queryable, moveTableNames: string[]): Promise<IndirectFkRef[]> {
  if (moveTableNames.length === 0) return [];
  const r = await client.query(
    `SELECT ch.relname AS child_table,
            pt.relname AS parent_table,
            -- ::text 캐스팅 이유는 위 UNIQUE 인덱스 쿼리와 같다(name[]은 드라이버가 파싱하지 않는다).
            (SELECT array_agg(ca.attname::text ORDER BY ck.ord)
               FROM unnest(con.conkey) WITH ORDINALITY ck(attnum, ord)
               JOIN pg_attribute ca ON ca.attrelid = con.conrelid AND ca.attnum = ck.attnum) AS child_columns,
            (SELECT array_agg(pa.attname::text ORDER BY pk.ord)
               FROM unnest(con.confkey) WITH ORDINALITY pk(attnum, ord)
               JOIN pg_attribute pa ON pa.attrelid = con.confrelid AND pa.attnum = pk.attnum) AS parent_columns
       FROM pg_constraint con
       JOIN pg_class ch ON ch.oid = con.conrelid
       JOIN pg_class pt ON pt.oid = con.confrelid
       JOIN pg_namespace n ON n.oid = ch.relnamespace AND n.nspname = 'public'
      WHERE con.contype = 'f'
        AND pt.relname = ANY($1::text[])
        AND NOT (ch.relname = ANY($1::text[]))
      ORDER BY 1, 2`,
    [moveTableNames],
  );
  return r.rows.map((row: any) => ({
    childTable: String(row.child_table),
    childColumns: (row.child_columns ?? []).map((c: any) => String(c)),
    parentTable: String(row.parent_table),
    parentColumns: (row.parent_columns ?? []).map((c: any) => String(c)),
  }));
}

/** dryRun과 실행이 같은 판정을 쓰도록 계획 산출을 한 곳에 둔다. */
async function buildMergePlan(
  client: Queryable,
  fromId: string,
  toId: string,
  confirm?: MergeConfirm,
): Promise<MergePlan> {
  const blockers: MergeBlocker[] = [];

  const from = await fetchCompany(client, fromId);
  const to = await fetchCompany(client, toId);
  if (!from) blockers.push({ kind: 'company_not_found', detail: `옛 회사 ${fromId}를 찾을 수 없습니다.` });
  if (!to) blockers.push({ kind: 'company_not_found', detail: `병합 목적지 ${toId}를 찾을 수 없습니다.` });
  if (fromId.toLowerCase() === toId.toLowerCase()) {
    blockers.push({ kind: 'same_company', detail: '같은 회사끼리는 병합할 수 없습니다.' });
  }

  const plan: MergePlan = {
    from,
    to,
    axes: [],
    unregistered: [],
    missingTables: [],
    uniqueChecks: [],
    indirect: [],
    blockers,
  };
  if (!from || !to || fromId.toLowerCase() === toId.toLowerCase()) return plan;

  // ── 실행 조건 게이트 (★0729 Codex 지적 ③ 후반 수용) ──
  // 이 셋은 "살아 있는 회사에서 자산을 빼앗지 않는다"만 보증한다. 서로 무관한 두 회사가
  // 조건을 통과하는 것은 막지 못하므로, 짝이 맞는지는 실행 확인(MergeConfirm) 대조가 담당한다.
  if (from.status !== 'terminated') {
    blockers.push({
      kind: 'source_not_terminated',
      detail: `옛 회사 상태가 '${from.status}'입니다. 병합 전에 해지(terminated) 처리를 먼저 해야 합니다.`,
    });
  }
  if (to.status !== 'active') {
    blockers.push({
      kind: 'destination_not_active',
      detail: `병합 목적지 상태가 '${to.status}'입니다. 살아 있는 회사로만 합칠 수 있습니다.`,
    });
  }
  const activeUsers = await countActiveRealUsers(client, fromId);
  if (activeUsers > 0) {
    blockers.push({
      kind: 'source_has_active_user',
      detail: `옛 회사에 로그인 가능한 실계정 ${activeUsers}개가 남아 있습니다. 계정 정리 후 진행합니다.`,
    });
  }

  const existing = new Set(await listCompanyIdTables(client));

  for (const axis of COMPANY_MERGE_AXES) {
    if (!existing.has(axis.table)) {
      plan.missingTables.push(axis.table);
      continue;
    }
    plan.axes.push({ table: axis.table, action: axis.action, rows: await countRows(client, axis.table, fromId) });
  }

  // ── 표에 없는 회사 축 — 행이 1건이라도 있으면 차단 ──
  for (const table of findUnregisteredTables([...existing])) {
    const rows = await countRows(client, table, fromId);
    if (rows > 0) {
      plan.unregistered.push({ table, action: 'keep', rows });
      blockers.push({
        kind: 'unregistered_axis',
        detail: `${table} ${rows}행. 병합 축 표에 없는 테이블입니다. 이동/잔류를 정해 COMPANY_MERGE_AXES에 등재해야 진행됩니다.`,
      });
    }
  }

  // ── 회사 축 UNIQUE 충돌 전수 (설계 원칙 3) ──
  const liveMoveTables = moveTables().filter((t) => existing.has(t));
  const { indexes, unsupported } = await listCompanyScopedUniqueIndexes(client, liveMoveTables);
  for (const u of unsupported) {
    blockers.push({
      kind: 'unsupported_unique_index',
      detail: `${u.table}.${u.indexName}: ${u.why}. 충돌을 계산할 수 없어 진행하지 않습니다.`,
    });
  }
  for (const ix of indexes) {
    const r = await client.query(buildConflictQuery(ix), [fromId, toId]);
    const conflicts = Number(r.rows[0]?.cnt ?? 0);
    plan.uniqueChecks.push({ table: ix.table, indexName: ix.indexName, conflicts });
    if (conflicts > 0) {
      blockers.push({
        kind: 'unique_conflict',
        detail: `${ix.table} ${ix.indexName}(${ix.columns.join(', ')}) 키가 병합 목적지와 ${conflicts}건 겹칩니다.`,
      });
    }
  }

  // ── 간접 참조 전수 탐지 (설계 원칙 4) ──
  // 탐지는 FK 서명 단위로 대조한다. 등재된 축의 실제 행 수는 탐지 결과와 무관하게,
  // 그 테이블이 존재하면 항상 센다 — 탐지에 의존하면 FK가 사라진 스키마에서 검사가 조용히 꺼진다.
  const detected = await detectIndirectFkRefs(client, liveMoveTables);
  const unregisteredSignatures = new Set(findUnregisteredIndirect(detected));
  const axisBySignature = new Map(COMPANY_MERGE_INDIRECT_AXES.map((a) => [indirectSignature(a), a]));
  for (const ref of detected) {
    const signature = indirectSignature(ref);
    if (unregisteredSignatures.has(signature)) {
      plan.indirect.push({ signature, childTable: ref.childTable, registered: false, rows: null });
      blockers.push({
        kind: 'unregistered_indirect_axis',
        detail: `${signature}. 이동 테이블을 FK로 가리키는데 병합 정책이 등재되지 않았습니다. COMPANY_MERGE_INDIRECT_AXES에 등재해야 진행됩니다.`,
      });
      continue;
    }
    if (!isIndirectRefSupported(ref)) {
      plan.indirect.push({ signature, childTable: ref.childTable, registered: true, rows: null });
      blockers.push({
        kind: 'unregistered_indirect_axis',
        detail: `${signature}. 복합 FK이거나 부모 id가 아닌 컬럼을 가리켜 건수를 계산할 수 없습니다. 사람이 확인해야 합니다.`,
      });
      continue;
    }
    const r = await client.query(buildIndirectCountQuery(ref), [fromId]);
    const rows = Number(r.rows[0]?.cnt ?? 0);
    plan.indirect.push({ signature, childTable: ref.childTable, registered: true, rows });
    if (rows > 0) {
      const axis = axisBySignature.get(signature);
      blockers.push({
        kind: 'indirect_axis_rows',
        detail: `${signature} ${rows}행: ${axis?.reason ?? '옮길 행을 가리키는 다른 테이블 행이 있습니다'}. 이 연결을 정리한 뒤 진행합니다.`,
      });
    }
  }

  // ── ★2026-08-16 마케팅 진단 지급 결합 차단 (Codex 적대 수용 — §4-7 보강) ──
  // 퍼널 B 진단은 company_id가 NULL이고 linked_company_id가 회사다. 공용 간접 축 카운트는
  // parent를 company_id로만 세어 이 결합을 0건으로 오판한다. 지급(keep)이 소유(company_id)·
  // 연결(linked_company_id) 어느 축으로든 옛 회사의 진단을 가리키면 병합 후 귀속이 갈라지므로 차단한다.
  if (existing.has('diagnosis_trial_grants') && existing.has('marketing_diagnoses')) {
    const r = await client.query(DIAGNOSIS_GRANT_SPLIT_SQL, [fromId]);
    const rows = Number(r.rows[0]?.cnt ?? 0);
    if (rows > 0) {
      blockers.push({
        kind: 'indirect_axis_rows',
        detail: `diagnosis_trial_grants→marketing_diagnoses ${rows}건. 옛 회사의 진단 체험 지급 결합입니다. 지급·진단을 정리한 뒤 진행합니다.`,
      });
    }
  }

  // ── 실행 확인 대조 (dryRun은 확인 없이 볼 수 있다) ──
  if (confirm) {
    const norm = (v: string | null | undefined) => String(v ?? '').trim().toLowerCase();
    if (norm(confirm.fromCompanyCode) !== norm(from.companyCode) || norm(confirm.toCompanyCode) !== norm(to.companyCode)) {
      blockers.push({
        kind: 'pair_confirmation_mismatch',
        detail: `실행 확인 회사코드가 DB 값과 다릅니다: 보낸 값 ${confirm.fromCompanyCode}→${confirm.toCompanyCode} / DB 값 ${from.companyCode}→${to.companyCode}.`,
      });
    }
  }

  return plan;
}

/** dryRun — 아무것도 바꾸지 않고 이동 계획과 차단 사유만 낸다. */
export async function previewCompanyMerge(fromId: string, toId: string): Promise<MergePlan> {
  return buildMergePlan({ query: (text, params) => query(text, params) }, fromId, toId);
}

/**
 * 실행 — 단일 트랜잭션.
 * 계획을 트랜잭션 안에서 다시 산출해, dryRun 이후 상태가 바뀌었어도 그 시점 사실로 판정한다.
 * 멱등이다 — 이미 옮긴 뒤 다시 불러도 0행 이동으로 끝나고, 늦게 들어온 행은 그때 흡수된다.
 */
export async function executeCompanyMerge(
  fromId: string,
  toId: string,
  confirm: MergeConfirm,
): Promise<MergeResult> {
  const client = await pool.connect();
  let plan: MergePlan;
  let moved: AxisCount[];
  try {
    await client.query('BEGIN');

    const [lockA, lockB] = normalizeLockOrder(fromId, toId);
    await client.query(`SELECT pg_advisory_xact_lock(hashtext($1::text), hashtext('company_merge'))`, [lockA]);
    await client.query(`SELECT pg_advisory_xact_lock(hashtext($1::text), hashtext('company_merge'))`, [lockB]);

    plan = await buildMergePlan(client, fromId, toId, confirm);
    if (plan.blockers.length > 0) throw new CompanyMergeBlockedError(plan);

    const skipped = new Set(plan.missingTables);
    moved = [];
    for (const axis of COMPANY_MERGE_AXES) {
      if (axis.action !== 'move' || skipped.has(axis.table)) continue;
      if (!isSafeIdentifier(axis.table)) throw new Error(`허용되지 않는 테이블명: ${axis.table}`);
      const r = await client.query(
        `UPDATE "${axis.table}" SET company_id = $2::uuid WHERE company_id = $1::uuid`,
        [fromId, toId],
      );
      moved.push({ table: axis.table, action: 'move', rows: r.rowCount ?? 0 });
    }

    // ★ 2026-08-16 마케팅 진단(설계서 §4-7) — linked_company_id는 회사 축인데 컬럼명이 달라
    //   company_id 축 열거·이동에 안 잡힌다. 옛 회사를 가리키던 리드 연결을 병합 대상으로 승계한다.
    //   (옛 회사 행은 terminated로 남으므로 방치해도 깨진 FK는 아니지만, 관리 화면이 죽은 회사를
    //    가리키게 된다 — 승계가 §4-7 확정 정책이다. 테이블 미생성 배포 구간이면 건너뛴다.)
    if (!skipped.has('marketing_diagnoses')) {
      const relink = await client.query(
        `UPDATE marketing_diagnoses SET linked_company_id = $2::uuid, updated_at = NOW()
          WHERE linked_company_id = $1::uuid`,
        [fromId, toId],
      );
      if ((relink.rowCount ?? 0) > 0) {
        moved.push({ table: 'marketing_diagnoses(linked_company_id)', action: 'move', rows: relink.rowCount ?? 0 });
      }
    }

    // 효과 검증 — move 축 잔존 0을 재카운트하고 나서야 커밋한다(6원칙 ②).
    const residue: AxisCount[] = [];
    for (const axis of COMPANY_MERGE_AXES) {
      if (axis.action !== 'move' || skipped.has(axis.table)) continue;
      const rows = await countRows(client, axis.table, fromId);
      if (rows > 0) residue.push({ table: axis.table, action: 'move', rows });
    }
    // ★2026-08-16 linked_company_id 승계도 잔존 0을 검증한다(Codex 적대 수용 — 특수 UPDATE만
    //   있고 재카운트가 없으면 경쟁 재연결이 남아도 verified=true가 된다).
    if (!skipped.has('marketing_diagnoses')) {
      const linkedLeft = await client.query(
        `SELECT count(*)::int AS cnt FROM marketing_diagnoses WHERE linked_company_id = $1::uuid`,
        [fromId],
      );
      const cnt = Number(linkedLeft.rows[0]?.cnt ?? 0);
      if (cnt > 0) residue.push({ table: 'marketing_diagnoses(linked_company_id)', action: 'move', rows: cnt });
    }
    // ★2026-08-16 지급 결합 재검사(Codex 적대 2R 수용) — 계획 단계 검사와 이동 사이에 수동 지급이
    //   끼어들 수 있다(지급 tx가 진단 행을 잠근 채 커밋하면, 위 relink가 그 잠금 뒤에 실행되며
    //   결합이 계획 검사 이후에 생긴다). 이동이 끝난 시점에 같은 SQL로 다시 세서 결합이 보이면
    //   커밋하지 않는다. g.company_id 축은 relink 후에도 옛 회사를 가리키므로 재검사에 걸린다.
    if (!skipped.has('diagnosis_trial_grants') && !skipped.has('marketing_diagnoses')) {
      const split = await client.query(DIAGNOSIS_GRANT_SPLIT_SQL, [fromId]);
      const cnt = Number(split.rows[0]?.cnt ?? 0);
      if (cnt > 0) residue.push({ table: 'diagnosis_trial_grants→marketing_diagnoses(결합)', action: 'keep', rows: cnt });
    }
    if (residue.length > 0) throw new CompanyMergeResidueError(residue);

    await client.query('COMMIT');
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch {
      /* 아래 전파에 포함 */
    }
    throw err;
  } finally {
    client.release();
  }

  // 커밋 후 재검증 — 트랜잭션 밖에서 한 번 더 센다. 워커가 옛 상태를 읽고 늦게 넣은 행이
  // 있으면 여기 잡힌다(조용히 지나가지 않는다). 재실행하면 흡수된다.
  const postCommitResidue: AxisCount[] = [];
  const skippedAfter = new Set(plan.missingTables);
  for (const axis of COMPANY_MERGE_AXES) {
    if (axis.action !== 'move' || skippedAfter.has(axis.table)) continue;
    const rows = await countRows({ query: (text, params) => query(text, params) }, axis.table, fromId);
    if (rows > 0) postCommitResidue.push({ table: axis.table, action: 'move', rows });
  }
  // linked_company_id 승계 잔존도 커밋 후 재검증에 포함(늦게 들어온 재연결 행 = 재실행으로 흡수)
  if (!skippedAfter.has('marketing_diagnoses')) {
    const r = await query(
      `SELECT count(*)::int AS cnt FROM marketing_diagnoses WHERE linked_company_id = $1::uuid`,
      [fromId],
    );
    const cnt = Number(r.rows[0]?.cnt ?? 0);
    if (cnt > 0) postCommitResidue.push({ table: 'marketing_diagnoses(linked_company_id)', action: 'move', rows: cnt });
  }
  // 지급 결합도 커밋 후 한 번 더 — 병합 커밋 직후 끼어든 지급은 재실행으로 흡수되지 않으므로
  // verified=false로 드러내 사람이 처리하게 한다(조용히 지나가지 않는다).
  if (!skippedAfter.has('diagnosis_trial_grants') && !skippedAfter.has('marketing_diagnoses')) {
    const split = await query(DIAGNOSIS_GRANT_SPLIT_SQL, [fromId]);
    const splitCnt = Number(split.rows[0]?.cnt ?? 0);
    if (splitCnt > 0) postCommitResidue.push({ table: 'diagnosis_trial_grants→marketing_diagnoses(결합)', action: 'keep', rows: splitCnt });
  }

  return {
    from: plan.from,
    to: plan.to,
    moved,
    missingTables: plan.missingTables,
    postCommitResidue,
    verified: postCommitResidue.length === 0,
  };
}
