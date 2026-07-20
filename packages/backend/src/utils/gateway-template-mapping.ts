/**
 * gateway-template-mapping.ts — 게이트웨이 알림톡 매핑 클라이언트 CT (Track C M2, 2026-07-20)
 *
 * 계약 원천 = docs/2026-07-14-template-migration-track-bc-design.md §4-0(API 계약 전문)·§4-0-1(0720 실측·결함 회피)·§4-9(M2 설계).
 * 강문희 「카카오 템플릿관리 API정의서」(큐테크놀로지 2026-07-20) 기준.
 *
 * 역할:
 *   - PUT(upsert)/GET(조회) HTTP 클라이언트 — 서버(54/58)별 엔드포인트 분기
 *   - payload 빌더: 트림·필수 검증·★tran_tmplcd 빈 값 전송 절대 금지(빈 값이면 tmplcd 복사 — 0720 서버 결함 회피 유지)
 *   - 응답코드 매핑: 00/01/02=성공, 21/24/27=영구 오류, 22/23=재시도 가능
 *   - 직렬 레이트리밋: 호출 간 최소 200ms(5/s ≪ 서버 한계 500/s — 초과 시 무응답 reject)
 *   - 효과 검증(6원칙 ②): upsert 응답만 믿지 않음 — GET 재조회로 tmplcd 실존+필드 일치 확인
 *
 * 불변 규칙(§4-9-C, 계약 테스트 gateway-template-mapping.test.ts로 고정):
 *   1. tran_tmplcd 빈 값 전송 절대 금지  2. billid 리터럴 보존(병기 분해 금지)
 *   3. 54 게이트는 워커/라우트가 판정(GATEWAY_TMPL_54_ENABLED)  4. 삭제 API 없음 — 이 CT에 DELETE 없음
 *   5. 재시도는 항상 멱등(upsert)  6. 발송 경로 무접촉
 *
 * DB import 0 — 순수 함수 + 네트워크만. (config/database import 시 순수 테스트가 죽는 함정 회피 — LESSONS_BACKEND)
 */

import axios from 'axios';

export type GatewayServer = '54' | '58';

/** 게이트웨이 upsert payload 6필드 (§4-0 필수 4 + 선택 2) */
export interface GatewayMappingPayload {
  billid: string;
  billnm: string;
  senderkey: string;
  usemod: string;
  tmplcd: string;
  tran_tmplcd: string;
}

export interface GatewayMappingInput {
  billid: string;
  senderkey: string;
  usemod: string;
  tmplcd: string;
  tran_tmplcd?: string | null;
  billnm?: string | null;
}

export type BuildPayloadResult =
  | { ok: true; payload: GatewayMappingPayload }
  | { ok: false; error: string };

/** 레이트리밋: 호출 간 최소 간격 (1초 500회 초과 = 공격 간주 무응답 reject — §4-0) */
export const MIN_CALL_INTERVAL_MS = 200;

/** 푸시 재시도 상한 — 초과 시 failed 확정 + 알림 (§4-9-B) */
export const MAX_PUSH_ATTEMPTS = 8;

/** HTTP 타임아웃 — 레이트리밋 위반/장애 시 무응답 reject이므로 타임아웃이 유일한 복구 경로 (§4-9-C 8) */
const HTTP_TIMEOUT_MS = 20 * 1000;

/** 백오프 스케줄: 1m→5m→30m→2h→6h (§4-9-B) */
const BACKOFF_SCHEDULE_MS = [
  60 * 1000,
  5 * 60 * 1000,
  30 * 60 * 1000,
  2 * 60 * 60 * 1000,
  6 * 60 * 60 * 1000,
];

// ────────────────────────────────────────────────────────────
// 순수 함수 (계약 테스트 대상)
// ────────────────────────────────────────────────────────────

/**
 * payload 빌더 — 트림 + 필수 검증 + ★tran_tmplcd 빈 값 금지(빈 값이면 tmplcd 복사).
 * billid는 리터럴 보존: 병기('P0042;R0003')·소문자 잔재(b0067) 그대로 — 분해·대문자화 금지 (§4-9-C 2).
 */
export function buildMappingPayload(input: GatewayMappingInput): BuildPayloadResult {
  const billid = String(input.billid ?? '').trim();
  const senderkey = String(input.senderkey ?? '').trim();
  const usemod = String(input.usemod ?? '').trim();
  const tmplcd = String(input.tmplcd ?? '').trim();
  const tranRaw = String(input.tran_tmplcd ?? '').trim();
  const billnm = String(input.billnm ?? '').trim();

  for (const [field, value] of [
    ['billid', billid],
    ['senderkey', senderkey],
    ['usemod', usemod],
    ['tmplcd', tmplcd],
  ] as const) {
    if (!value) return { ok: false, error: `필수 필드 누락: ${field}` };
  }

  return {
    ok: true,
    payload: {
      billid,
      billnm,
      senderkey,
      usemod,
      tmplcd,
      // ★0720 서버 결함 회피 유지: 빈 tran_tmplcd 전송 시 tmplcd까지 유실되던 결함(당일 수정됨)의
      //   회귀 방어 — 항상 채워 보낸다. 실등록 4,681행 전부 tran=tmplcd라 정책 비용 0 (§4-0-2).
      tran_tmplcd: tranRaw || tmplcd,
    },
  };
}

/**
 * billid 접두로 서버 추론 — P=54 / R=58 (서팀장 0720 확정).
 * 병기(세미콜론)·B 잔재·기타는 추론 불가 null — 저장된 등록서버(server 컬럼) 값을 쓴다.
 * 신규 등록 시 참고용이며, 기존 행은 항상 server 컬럼이 진실.
 */
export function inferServerFromBillId(billId: string): GatewayServer | null {
  const id = String(billId ?? '').trim();
  if (!id || id.includes(';')) return null;
  if (id.startsWith('P')) return '54';
  if (id.startsWith('R')) return '58';
  return null;
}

/**
 * server → 엔드포인트. 54=58.227.193.54 / 58=58.227.193.58 (동일 IDC 내부 구간 — 평문 HTTP 수용, Harold 0720).
 * env GATEWAY_TMPL_54_URL / GATEWAY_TMPL_58_URL로 오버라이드 가능.
 */
export function resolveGatewayEndpoint(server: GatewayServer): string {
  if (server === '54') {
    return String(process.env.GATEWAY_TMPL_54_URL || '').trim() || 'http://58.227.193.54:25230/tmpl-mgr';
  }
  return String(process.env.GATEWAY_TMPL_58_URL || '').trim() || 'http://58.227.193.58:25230/tmpl-mgr';
}

export interface GatewayResponseClass {
  ok: boolean;
  kind: 'query_ok' | 'updated' | 'inserted' | 'error';
  code: string;
  /** false = 영구 오류(인증/body/필수 공백 — 재시도 무의미, payload/설정 결함) */
  retryable: boolean;
  message: string;
}

/** 응답코드 매핑 (§4-0): 00 조회 / 01 update / 02 insert / 21 인증 / 22 DB / 23 시스템 / 24 body 없음 / 27 필수 공백 */
export function classifyGatewayResponse(body: any): GatewayResponseClass {
  const code = String(body?.req_result ?? '').trim();
  const serverMsg = String(body?.resultmessage ?? '').trim();
  switch (code) {
    case '00':
      return { ok: true, kind: 'query_ok', code, retryable: false, message: serverMsg || '조회 성공' };
    case '01':
      return { ok: true, kind: 'updated', code, retryable: false, message: serverMsg || 'update' };
    case '02':
      return { ok: true, kind: 'inserted', code, retryable: false, message: serverMsg || 'insert' };
    case '21':
      return { ok: false, kind: 'error', code, retryable: false, message: `인증 오류(21) ${serverMsg}`.trim() };
    case '24':
      return { ok: false, kind: 'error', code, retryable: false, message: `body 없음(24) ${serverMsg}`.trim() };
    case '27':
      return { ok: false, kind: 'error', code, retryable: false, message: `필수 필드 공백(27) ${serverMsg}`.trim() };
    case '22':
      return { ok: false, kind: 'error', code, retryable: true, message: `DB 오류(22) ${serverMsg}`.trim() };
    case '23':
      return { ok: false, kind: 'error', code, retryable: true, message: `시스템 오류(23) ${serverMsg}`.trim() };
    default:
      // 미지 코드·빈 응답·무응답(레이트리밋 reject 포함) = 재시도 가능으로 분류 — 멱등 upsert라 안전
      return { ok: false, kind: 'error', code: code || 'none', retryable: true, message: `미지 응답 ${serverMsg}`.trim() };
  }
}

/** 백오프: attempts(누적 실패 횟수) → 다음 재시도까지 ms. MAX_PUSH_ATTEMPTS 초과 = null(failed 확정) */
export function computeBackoffMs(attempts: number): number | null {
  if (attempts > MAX_PUSH_ATTEMPTS) return null;
  const idx = Math.max(0, Math.min(attempts - 1, BACKOFF_SCHEDULE_MS.length - 1));
  return BACKOFF_SCHEDULE_MS[idx];
}

/** 직렬 레이트리밋: 직전 호출 시각 기준 잔여 대기 ms (음수 없음) */
export function computeRateDelayMs(nowMs: number, lastCallMs: number | null): number {
  if (lastCallMs === null || lastCallMs === undefined) return 0;
  return Math.max(0, lastCallMs + MIN_CALL_INTERVAL_MS - nowMs);
}

/**
 * 신규 납입자ID 기본 usemod — 서팀장 구두(54=HM 3개/58=HM 6개) + 시드 실데이터 최빈값과 일치 확정(0720).
 * 기존 행에는 절대 적용 금지(§4-9-C 3 — 기존 usemod 불변). 신규 bill 등록 시 미지정 기본값 전용.
 */
export function defaultUsemodForServer(server: GatewayServer): string {
  return server === '54'
    ? 'DPK_HM1;DPK_HM2;DPK_HM3'
    : 'DPK_HM1;DPK_HM2;DPK_HM3;DPK_HM4;DPK_HM5;DPK_HM6';
}

/**
 * bill_id → 회사 코드 파생 (일괄 회사 생성용 — 2026-07-20 Harold 확정).
 * 원형 유지(대소문자 불변 — 기존 R0023 관례 실측 정합), 비영숫자(병기 세미콜론 등)만 '-' 치환.
 * 예: P0032→P0032 / 'P0042;R0003'→'P0042-R0003'. 게이트웨이 payload의 billid 리터럴 보존과는 별개 축.
 */
export function deriveCompanyCodeFromBillId(billId: string): string {
  return String(billId ?? '').trim().replace(/[^0-9A-Za-z]+/g, '-');
}

export interface MappingDiffFields {
  tmplcd: string;
  tran_tmplcd: string;
  usemod: string;
  billnm: string;
}

/**
 * 대조 diff — tmplcd·tran_tmplcd·usemod·billnm 4필드만.
 * GET 응답에 senderkey가 없어(§4-9-E) senderkey 정합은 upsert 응답 + M4 실발송으로 검증한다.
 * usemod는 행 단위 값(§4-0-2 — 서버 상수 아님)이라 상시 대조 항목에 포함.
 */
export function diffMappingFields(desired: MappingDiffFields, remote: any): string[] {
  const mismatches: string[] = [];
  for (const field of ['tmplcd', 'tran_tmplcd', 'usemod', 'billnm'] as const) {
    const d = String(desired[field] ?? '').trim();
    const r = String(remote?.[field] ?? '').trim();
    if (d !== r) mismatches.push(field);
  }
  return mismatches;
}

// ────────────────────────────────────────────────────────────
// 시드 임포트 준비 (§4-9-D-2 — 엑셀→JSON 4,681행 검증·중복 정리·bill 집계)
// ────────────────────────────────────────────────────────────

export interface SeedRowInput {
  server?: any;
  bill_id?: any;
  billid?: any;
  billnm?: any;
  senderkey?: any;
  usemod?: any;
  tran_tmplcd?: any;
  tmplcd?: any;
}

export interface PreparedSeedRow {
  server: GatewayServer;
  payload: GatewayMappingPayload;
}

export interface PreparedSeedBill {
  billId: string;
  server: GatewayServer;
  billName: string;
  defaultUsemod: string;
}

export interface PreparedSeed {
  invalid: { index: number; error: string }[];
  /** (bill_id, tmplcd) 중복 정리 후 — 최신행(뒤 행) 우선 (§4-9-D-2) */
  deduped: PreparedSeedRow[];
  dupWithinPayload: number;
  /** bill_id별 1행 — 최빈 usemod = default_usemod(신규 행 전용), 대표 billnm = 최빈 비공백 */
  bills: PreparedSeedBill[];
  /** 같은 bill_id가 두 서버에 걸침 — 실등록 데이터엔 0건이 정상(§4-0-2), 발견 시 시드 중단 사유 */
  serverConflicts: string[];
}

export function prepareSeedImport(rows: SeedRowInput[]): PreparedSeed {
  const invalid: { index: number; error: string }[] = [];
  const normalized: PreparedSeedRow[] = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const server = String(row?.server ?? '').trim();
    if (server !== '54' && server !== '58') {
      invalid.push({ index: i, error: `server는 '54'|'58'만 (수신: ${server || '없음'})` });
      continue;
    }
    const built = buildMappingPayload({
      billid: row?.bill_id ?? row?.billid,
      senderkey: row?.senderkey,
      usemod: row?.usemod,
      tmplcd: row?.tmplcd,
      tran_tmplcd: row?.tran_tmplcd,
      billnm: row?.billnm,
    });
    if (!built.ok) {
      invalid.push({ index: i, error: built.error });
      continue;
    }
    normalized.push({ server: server as GatewayServer, payload: built.payload });
  }

  // (bill_id, tmplcd) 중복 = 최신행(뒤 행) 우선 — Map 덮어쓰기가 그 규칙 그 자체
  const byKey = new Map<string, PreparedSeedRow>();
  for (const n of normalized) byKey.set(`${n.payload.billid} ${n.payload.tmplcd}`, n);
  const deduped = [...byKey.values()];

  // bill 집계
  const agg = new Map<string, { servers: Set<string>; usemod: Map<string, number>; billnm: Map<string, number> }>();
  for (const n of deduped) {
    let a = agg.get(n.payload.billid);
    if (!a) {
      a = { servers: new Set(), usemod: new Map(), billnm: new Map() };
      agg.set(n.payload.billid, a);
    }
    a.servers.add(n.server);
    a.usemod.set(n.payload.usemod, (a.usemod.get(n.payload.usemod) || 0) + 1);
    if (n.payload.billnm) a.billnm.set(n.payload.billnm, (a.billnm.get(n.payload.billnm) || 0) + 1);
  }

  const pickTop = (m: Map<string, number>): string => {
    let best = '';
    let bestN = -1;
    for (const [k, cnt] of m) {
      if (cnt > bestN) { best = k; bestN = cnt; }
    }
    return best;
  };

  const serverConflicts: string[] = [];
  const bills: PreparedSeedBill[] = [];
  for (const [billId, a] of agg) {
    if (a.servers.size > 1) {
      serverConflicts.push(`${billId}: 서버 ${[...a.servers].sort().join(',')} 혼재`);
      continue;
    }
    bills.push({
      billId,
      server: [...a.servers][0] as GatewayServer,
      billName: pickTop(a.billnm),
      defaultUsemod: pickTop(a.usemod),
    });
  }

  return {
    invalid,
    deduped,
    dupWithinPayload: normalized.length - deduped.length,
    bills,
    serverConflicts,
  };
}

// ────────────────────────────────────────────────────────────
// 네트워크 클라이언트 (직렬 레이트리밋 내장)
// ────────────────────────────────────────────────────────────

function getApiToken(): string {
  const token = String(process.env.GATEWAY_TMPL_API_TOKEN || '').trim();
  if (!token) {
    throw new Error('GATEWAY_TMPL_API_TOKEN 미설정 — 게이트웨이 매핑 호출 불가 (.env 등록 필요)');
  }
  return token;
}

let _lastCallAtMs: number | null = null;

async function respectRateLimit(): Promise<void> {
  const delay = computeRateDelayMs(Date.now(), _lastCallAtMs);
  if (delay > 0) await new Promise((r) => setTimeout(r, delay));
  _lastCallAtMs = Date.now();
}

export interface GatewayCallResult {
  classified: GatewayResponseClass;
  /** GET일 때 data 배열 (실측: 미등록 billid = 에러 아닌 빈 배열 — §4-0-1 [0]) */
  rows: any[];
  raw: any;
}

/** PUT = 등록·수정(upsert). 키 = billid + tmplcd — 기존 키를 치면 덮어씀(멱등) */
export async function putGatewayMapping(
  server: GatewayServer,
  payload: GatewayMappingPayload,
): Promise<GatewayCallResult> {
  await respectRateLimit();
  const res = await axios.put(resolveGatewayEndpoint(server), payload, {
    headers: { Authorization: getApiToken(), 'Content-Type': 'application/json' },
    timeout: HTTP_TIMEOUT_MS,
    // 게이트웨이는 오류도 200 + req_result 코드로 반환 — HTTP 상태로 throw하지 않고 코드로 판정
    validateStatus: () => true,
  });
  const classified = classifyGatewayResponse(res.data);
  return { classified, rows: Array.isArray(res.data?.data) ? res.data.data : [], raw: res.data };
}

/** GET = 조회 (body에 billid 동봉 — 정의서 계약, 0720 62서버 실측 통과) */
export async function getGatewayMappings(
  server: GatewayServer,
  billid: string,
): Promise<GatewayCallResult> {
  await respectRateLimit();
  const res = await axios.request({
    method: 'GET',
    url: resolveGatewayEndpoint(server),
    data: { billid: String(billid ?? '').trim() },
    headers: { Authorization: getApiToken(), 'Content-Type': 'application/json' },
    timeout: HTTP_TIMEOUT_MS,
    validateStatus: () => true,
  });
  const classified = classifyGatewayResponse(res.data);
  return { classified, rows: Array.isArray(res.data?.data) ? res.data.data : [], raw: res.data };
}

export interface UpsertVerifyResult {
  /** upsert 응답 성공 + GET 재조회에서 tmplcd 실존 + 4필드 일치 */
  verified: boolean;
  upsert: GatewayResponseClass;
  found: boolean;
  mismatches: string[];
  error?: string;
}

/**
 * 효과 검증 게이트(6원칙 ②): upsert 응답만 믿지 않음 — GET 재조회로 해당 tmplcd 실존+필드 일치 확인.
 * 0720 실증: 정의서 문구와 실동작 불일치(tran_tmplcd 결함)를 잡은 유일한 장치가 이 왕복이다 (§7 리스크).
 */
export async function upsertMappingWithVerify(
  server: GatewayServer,
  payload: GatewayMappingPayload,
): Promise<UpsertVerifyResult> {
  const put = await putGatewayMapping(server, payload);
  if (!put.classified.ok) {
    return { verified: false, upsert: put.classified, found: false, mismatches: [], error: put.classified.message };
  }

  const get = await getGatewayMappings(server, payload.billid);
  if (!get.classified.ok) {
    return {
      verified: false,
      upsert: put.classified,
      found: false,
      mismatches: [],
      error: `효과 검증 조회 실패: ${get.classified.message}`,
    };
  }

  const remote = get.rows.find((r) => String(r?.tmplcd ?? '').trim() === payload.tmplcd);
  if (!remote) {
    return {
      verified: false,
      upsert: put.classified,
      found: false,
      mismatches: [],
      error: `효과 검증 실패: upsert ${put.classified.code} 응답 후 조회에 tmplcd=${payload.tmplcd} 부재`,
    };
  }

  const mismatches = diffMappingFields(
    { tmplcd: payload.tmplcd, tran_tmplcd: payload.tran_tmplcd, usemod: payload.usemod, billnm: payload.billnm },
    remote,
  );
  if (mismatches.length > 0) {
    return {
      verified: false,
      upsert: put.classified,
      found: true,
      mismatches,
      error: `효과 검증 실패: 필드 불일치 [${mismatches.join(', ')}]`,
    };
  }

  return { verified: true, upsert: put.classified, found: true, mismatches: [] };
}
