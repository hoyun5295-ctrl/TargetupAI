/**
 * kakao-bulk-migration.ts — 카카오 템플릿 일괄 이관 CT (Track B M5, 2026-07-20)
 *
 * 설계 원천 = docs/2026-07-14-template-migration-track-bc-design.md §4-9-H(런북)·§3 B-1(import 2종).
 *
 * 역할: 게이트웨이 매핑(시드)이 아는 "회사 ↔ 납입자ID ↔ senderKey ↔ 템플릿코드" 관계를
 *       IMC 실목록과 맞춰 이관 계획을 세우고, 이관 후 빠진 코드를 사유별로 분류한다.
 *
 * 이 CT가 존재하는 이유(0720 실측):
 *   0715 아난티 pull은 failed 0 / 재카운트 일치로 "완료" 보고됐지만, 게이트웨이가 실제로 라우팅하는
 *   B_ 코드 62개가 한줄로에 없었다. 원인 = 아난티 senderKey 2개 중 1개만 연결 → 그 키의 템플릿이
 *   pull 대상에 아예 들어오지 않음. pull 경로가 "자기가 만든 수"만 세고 게이트웨이 기준과
 *   맞춰보지 않으면 이 유형은 영원히 안 보인다. → 대조는 반드시 게이트웨이 코드 집합 기준 차집합.
 *
 * 대조 계약(0720 아난티 실측으로 확정):
 *   - 기준 = 행수가 아니라 distinct 템플릿코드 (bill 2개 회사는 같은 코드가 54·58 양쪽에 등록돼 행이 2배)
 *   - 판정 = 등호가 아니라 포함 관계 (아난티 시드 B_ 559코드 vs IMC pull 847건 — IMC가 더 많은 게 정상)
 *   - 통과 조건 = 게이트웨이 B_ 코드 집합 − 한줄로 보유 집합 = 공집합
 *
 * DB·네트워크 import 0 — 순수 함수만 (config/database import 시 순수 테스트가 죽는 함정 회피).
 */

/** 휴머스온(IMC) 계열 템플릿코드 접두 — 0720 실측: split_part(tmplcd,'_',1)='B' 3,353행 전량이 `B_` 형식 */
export const B_SERIES_PREFIX = 'B_';

/**
 * IMC pull 대상 판정 — B_ 계열만.
 * bizp_(다우 797) · 업체지정(SJT/ACS/ANH/APS/APH/SJB/ANT 등) · 자사코드류는 IMC에 없어 pull 금지.
 * 발송은 게이트웨이 기존 매핑이 계속 담당하고, 새 템플릿부터 한줄로에서 등록한다(§7).
 */
export function isBSeriesCode(code: string | null | undefined): boolean {
  return String(code ?? '').trim().startsWith(B_SERIES_PREFIX);
}

/**
 * IMC 목록 item에서 senderKey 추출.
 * 2026-07-15 probe 실측: item.senderKey + item.profile.senderKey 양쪽 존재.
 * 외부 API 응답 구조 추측 금지(D217+) — 실측된 키만 순서대로 본다.
 */
export function extractImcSenderKey(item: any): string | null {
  const raw = item?.senderKey ?? item?.profile?.senderKey ?? item?.sender_key;
  const key = String(raw ?? '').trim();
  return key || null;
}

/** IMC 목록 item에서 템플릿코드 추출 (code 우선, 없으면 key — 기존 import 경로와 동일 규약) */
export function extractImcTemplateCode(item: any): string | null {
  const code = String(item?.templateCode ?? '').trim();
  if (code) return code;
  const key = String(item?.templateKey ?? '').trim();
  return key || null;
}

/** IMC 전량 스캔 결과 → senderKey별 그룹. senderKey 없는 item은 별도 카운트(매칭 결함 조기 발견용) */
export interface ImcIndex {
  bySender: Map<string, any[]>;
  /** 계정 전체 템플릿코드 집합 — "IMC 어디에도 없음" 판정용 */
  allCodes: Set<string>;
  /** senderKey를 못 읽은 item 수 — 0이 아니면 응답 구조 변화 의심 */
  senderKeyMissing: number;
  total: number;
}

export function indexImcTemplates(items: any[]): ImcIndex {
  const bySender = new Map<string, any[]>();
  const allCodes = new Set<string>();
  let senderKeyMissing = 0;

  for (const item of items) {
    const code = extractImcTemplateCode(item);
    if (code) allCodes.add(code);
    const key = extractImcSenderKey(item);
    if (!key) {
      senderKeyMissing += 1;
      continue;
    }
    const bucket = bySender.get(key);
    if (bucket) bucket.push(item);
    else bySender.set(key, [item]);
  }

  return { bySender, allCodes, senderKeyMissing, total: items.length };
}

// ────────────────────────────────────────────────────────────
// 회사 단위 이관 대상 구성
// ────────────────────────────────────────────────────────────

/** 게이트웨이 매핑 1행 (회사 연결분 조회 결과) */
export interface GatewayMappingRow {
  company_id: string;
  company_name?: string | null;
  bill_id: string;
  senderkey: string;
  tmplcd: string;
  source?: string | null;
  sync_status?: string | null;
}

export interface CompanyMigrationTarget {
  companyId: string;
  companyName: string;
  /** 이 회사에 연결된 납입자ID 전부 (54·58 양쪽 가능) */
  billIds: string[];
  /**
   * senderKey 합집합 — ★bill 단위가 아니라 회사 단위로 묶는 이유:
   * 마리오아울렛(P0013·R0041)처럼 한 회사가 두 bill을 가지면 bill별로 돌 때 같은 회사에 pull이
   * 두 번 걸린다. 반대로 아난티처럼 한 bill 안에 senderKey가 2개면 하나만 연결돼 조용히 누락된다.
   * 회사 단위 합집합이 두 결함을 동시에 막는 유일한 구성이다(0720 실측 근거).
   */
  senderKeys: string[];
  /** 게이트웨이가 라우팅 중인 B_ 코드 (distinct) — 대조 기준 그 자체 */
  seedBCodes: string[];
  /** 코드 → 그 코드가 붙은 senderKey (누락 사유 분류용) */
  codeSenderKey: Map<string, string>;
  /** B_ 아닌 행 수 (bizp_·업체지정 — pull 제외분. 0건 회사의 "정상 0"을 설명하는 근거) */
  nonBRows: number;
}

/**
 * 게이트웨이 매핑 행 → 회사 단위 이관 대상.
 * 정렬 = seedBCodes 오름차순(소규모부터), 동수면 회사명 — 더화이트(1,687코드·senderKey 141)가 자동으로 마지막.
 */
export function buildCompanyTargets(rows: GatewayMappingRow[]): CompanyMigrationTarget[] {
  const byCompany = new Map<string, CompanyMigrationTarget>();

  for (const row of rows) {
    const companyId = String(row?.company_id ?? '').trim();
    if (!companyId) continue;
    const billId = String(row?.bill_id ?? '').trim();
    const senderKey = String(row?.senderkey ?? '').trim();
    const tmplcd = String(row?.tmplcd ?? '').trim();

    let target = byCompany.get(companyId);
    if (!target) {
      target = {
        companyId,
        companyName: String(row?.company_name ?? '').trim(),
        billIds: [],
        senderKeys: [],
        seedBCodes: [],
        codeSenderKey: new Map<string, string>(),
        nonBRows: 0,
      };
      byCompany.set(companyId, target);
    }

    if (billId && !target.billIds.includes(billId)) target.billIds.push(billId);
    if (senderKey && !target.senderKeys.includes(senderKey)) target.senderKeys.push(senderKey);

    if (!tmplcd) continue;
    if (isBSeriesCode(tmplcd)) {
      if (!target.codeSenderKey.has(tmplcd)) {
        target.codeSenderKey.set(tmplcd, senderKey);
        target.seedBCodes.push(tmplcd);
      }
    } else {
      target.nonBRows += 1;
    }
  }

  const targets = [...byCompany.values()];
  for (const t of targets) {
    t.billIds.sort();
    t.senderKeys.sort();
    t.seedBCodes.sort();
  }
  targets.sort(
    (a, b) => a.seedBCodes.length - b.seedBCodes.length || a.companyName.localeCompare(b.companyName),
  );
  return targets;
}

// ────────────────────────────────────────────────────────────
// 누락 분류 (대조 = 이관 검증 그 자체)
// ────────────────────────────────────────────────────────────

/**
 * 누락 사유:
 *   sender_not_connected — senderKey가 한줄로에 연결되지 않음(IMC 미조회/타사 선점 등). 0715 아난티 62건이 이 유형
 *   not_in_imc          — IMC 계정 어디에도 없는 코드. 게이트웨이에만 남은 고아 → 사람이 판단(자동 삭제 금지)
 *   imc_sender_mismatch — IMC에는 있는데 그 senderKey 그룹에 안 잡힘. 응답 구조·귀속 불일치 = 코드 결함 신호
 *   insert_failed       — IMC 해당 그룹에 있고 대상에도 올랐는데 행이 안 생김. INSERT 실패
 */
export type MissingReason =
  | 'sender_not_connected'
  | 'not_in_imc'
  | 'imc_sender_mismatch'
  | 'insert_failed';

export interface MissingCode {
  tmplcd: string;
  senderkey: string;
  reason: MissingReason;
}

export interface ClassifyMissingParams {
  /** 게이트웨이가 라우팅 중인 B_ 코드 (대조 기준) */
  seedBCodes: string[];
  /** 코드 → senderKey */
  codeSenderKey: Map<string, string>;
  /** 한줄로가 보유한 템플릿코드(template_code·template_key 합집합) — 이번 생성분 포함 */
  presentCodes: Set<string>;
  /** 연결 완료된 senderKey (기존 연결 + 이번 회차 연결분) */
  connectedSenderKeys: Set<string>;
  /** IMC 전량 스캔 index */
  imc: ImcIndex;
}

/**
 * 대조 — 게이트웨이 B_ 코드 집합에서 한줄로 보유분을 뺀 차집합을 사유별로 분류.
 * 이 함수의 반환이 빈 배열일 때만 그 회사를 이관 통과로 표시한다(6원칙 ② 효과 검증).
 */
export function classifyMissingSeedCodes(params: ClassifyMissingParams): MissingCode[] {
  const missing: MissingCode[] = [];

  for (const tmplcd of params.seedBCodes) {
    if (params.presentCodes.has(tmplcd)) continue;

    const senderkey = params.codeSenderKey.get(tmplcd) || '';
    let reason: MissingReason;

    if (!params.connectedSenderKeys.has(senderkey)) {
      reason = 'sender_not_connected';
    } else if (params.imc.bySender.get(senderkey)?.some((it) => extractImcTemplateCode(it) === tmplcd)) {
      reason = 'insert_failed';
    } else if (params.imc.allCodes.has(tmplcd)) {
      reason = 'imc_sender_mismatch';
    } else {
      reason = 'not_in_imc';
    }

    missing.push({ tmplcd, senderkey, reason });
  }

  return missing;
}

/** 사유별 집계 — 응답·로그용 */
export function summarizeMissing(missing: MissingCode[]): Record<MissingReason, number> {
  const out: Record<MissingReason, number> = {
    sender_not_connected: 0,
    not_in_imc: 0,
    imc_sender_mismatch: 0,
    insert_failed: 0,
  };
  for (const m of missing) out[m.reason] += 1;
  return out;
}

// ────────────────────────────────────────────────────────────
// 알림 억제 (이관분이 검수 알림·폴링 루프에 들어가지 않게)
// ────────────────────────────────────────────────────────────

/**
 * 이관 INSERT 시 기록할 alarm_notified_status.
 *
 * ★0720 실측 근거: syncPendingTemplatesJob(5분)의 조회 조건이
 *   `status IN ('APPROVED','REJECTED','KREJ') AND alarm_notified_status IS NULL`
 * 인데, 알림 수신자(kakao_alarm_users)가 0명이면 count=0이라 상태를 표시하지 않고 다음 주기에 재시도한다.
 * 0715 아난티 이관분 847건이 그대로 이 조건에 걸려 5일째 5분마다 IMC를 헛조회 중이었다(폴링 대상 747 = 전량 아난티).
 * 여기에 3,262건을 같은 상태로 넣으면 4배가 되고, 실제 검수 중인 고객사 템플릿의 상태 반영이 밀린다.
 * 반대로 알림 수신자가 등록된 회사면 과거 승인 건이 승인 알림 LMS로 실발송된다.
 *
 * 이관분은 "지금 막 검수가 끝난 건"이 아니라 과거 확정분이므로 알림 대상이 아니다 → 종결 상태를 미리 기록해 억제.
 * 비종결(REQUESTED·KREQ 등)은 null 유지 — 정상 폴링·알림 흐름을 그대로 탄다.
 */
export function importedAlarmNotifiedStatus(status: string | null | undefined): string | null {
  const s = String(status ?? '').toUpperCase().trim();
  if (s === 'APR' || s === 'APPROVED') return 'APPROVED';
  if (s === 'REJ' || s === 'REJECTED' || s === 'KREJ') return 'REJECTED';
  return null;
}
