/**
 * CT-91 kakao-template-sync.ts (D217+ 2026-05-26 Harold 명시 진단 영역 정정)
 *
 * 옛 D147 영역 = 카카오 알림톡 등록 시점 = IMC 응답 templateCode = null 영역 정상 동작 →
 * 한줄로 자체 templateKey (Tmp_xxx) 영역 = `kakao_templates.template_code` 영역 영구 저장.
 *
 * 사고 영역 = 옛 D135~D147 영역 = 검수 통과 후 시점 = IMC 안 진정 카카오 templateCode
 * (B_XX_xxx_xx_xxxxx) 영역 영구 발급 영역 → 한줄로 안 동기화 영역 영구 누락 = 운영 환경
 * 8건 100% 사고 (Harold 명시 SQL 결과 2026-05-26).
 *
 * 본 컨트롤타워 영역 = 옛 사고 + 향후 영역 영구 정정:
 *   1) syncTemplateCodes — 한 번 호출 = 모든 회사 안 Tmp_xxx 영역 = 진정 카카오 templateCode 영역 정정
 *   2) Phase 1 (admin endpoint) + Phase 3 (cron worker) 공용 영역 정합
 *   3) idempotent — 옛 정정 영역 영구 안전 (이미 카카오 코드 영역 = skip)
 *
 * 영구 원칙 정합:
 *   - 옛 D147 영역 = template_key 영역 영구 보존 (IMC 안 식별 영역 영구 정합)
 *   - 신규 template_code 영역 = 진정 카카오 templateCode 영구 정정 (사용자 노출 + 통계 영역 정합)
 *   - 회사 격리 영역 영구 보존 (IMC 안 = 전역 영역 단 한줄로 안 = company_id 영역 영구 격리)
 */

import { query } from '../config/database';
import * as imc from './alimtalk-api';
// ★ 2026-09-12 검수상태 정규화는 5분 폴링과 **같은 함수**를 쓴다 — 두 경로가 다른 어휘를 쓰면 갈린다
import { normalizeImcTemplateStatus } from './alimtalk-jobs';

/** IMC 검수 진행 중 상태 — 이 상태의 행만 목록 안전망이 건드린다(종결 행 뒤집기 금지) */
const IMC_IN_PROGRESS_STATUSES = new Set(['REQUESTED', 'REVIEWING', 'REG', 'REQ', 'REV', 'KREQ']);

export interface SyncResult {
  scanned: number;       // 옛 Tmp_xxx 영역 조회 영역 (스캔 영역)
  matched: number;       // IMC 안 templateKey 매칭 영역
  updated: number;       // UPDATE 영구 정정 영역
  skipped: number;       // IMC 안 templateCode 영역 영구 미발급 영역 (검수 진행 영역 가능)
  failed: number;        // 오류 영역
  details: Array<{
    id: string;
    company_id: string;
    template_name: string;
    old_code: string;
    new_code: string | null;
    status: 'updated' | 'skipped_no_code' | 'skipped_same' | 'failed';
    error?: string;
  }>;
}

// ★ D217+ fix v2 (2026-05-26 Harold 명시 진단): IMC API 영역 안 count 영역 = 100 영역 정합
//   옛 routes/alimtalk.ts:706 D135+ B3 영역 = `count: 100` 영역 영구 작동 영역 정합 = 본 영역 영구 정합.
//   옛 500 영역 = IMC API 영역 영구 영역 영영 X 가능성 영역 = 영구 정정.
const IMC_PAGE_SIZE = 100;
const IMC_MAX_PAGES = 100;  // 최대 10,000건 영역 (운영 영역 영구 안전)

/**
 * 한줄로 안 옛 Tmp_xxx 영역 = 진정 카카오 templateCode 영역 영구 정정.
 *
 * 흐름:
 *   1. PG 안 APPROVED + template_code LIKE 'Tm%' 영역 조회
 *   2. IMC 안 listAlimtalkTemplates 페이지네이션 영역 안 templateKey 영역 영구 매칭
 *   3. IMC 안 진정 templateCode 영역 = `kakao_templates.template_code` UPDATE
 *   4. 결과 상세 보고
 *
 * @param options.dryRun = true 시 UPDATE 실행 X (시뮬레이션 영역)
 * @param options.companyId = 지정 시 본 회사 영역만 sync (admin endpoint 영역 영구 정합)
 */
export async function syncTemplateCodes(
  options: { dryRun?: boolean; companyId?: string } = {},
): Promise<SyncResult> {
  const result: SyncResult = {
    scanned: 0,
    matched: 0,
    updated: 0,
    skipped: 0,
    failed: 0,
    details: [],
  };

  // 1) PG에서 내부 키(Tmp...) 상태인 템플릿 조회
  // ★ 2026-06-13: 승인 한정 → 검수 진행/반려 상태까지 확대.
  //   IMC 템플릿코드는 카카오 검수 진입 시점에 발급되므로(직원 실측: 반려 템플릿도 B_IV_013_02_80287 발급됨)
  //   승인만 스캔하면 반려(KREJ)·검수중 템플릿이 내부 키로 영구 잔존한다. 코드 미발급이면 skipped_no_code로
  //   안전 통과(idempotent)라 확대해도 부작용 없음.
  const whereParts: string[] = [
    `status IN ('APPROVED', 'APPROVAL', 'REQUESTED', 'REVIEWING', 'REG', 'REQ', 'REV', 'KREQ', 'KREJ', 'REJECTED', 'HREJ')`,
    // ★ 2026-06-15 버그5: 'Tmp%'→'Tm%' — 카카오 templateKey는 Tmp/Tmo/Tmq 등 Tm+가변문자라
    //   'Tmp'만 스캔하면 Tmq(버튼3개 부가정보형) 등 비-Tmp 키 템플릿이 백필에서 통째 제외됐다(진짜 코드=B_).
    `template_code LIKE 'Tm%'`,
  ];
  const params: any[] = [];
  if (options.companyId) {
    whereParts.push(`company_id = $1::uuid`);
    params.push(options.companyId);
  }
  const pgRows = await query(
    `SELECT id, company_id, template_name, template_code, template_key
       FROM kakao_templates
      WHERE ${whereParts.join(' AND ')}`,
    params,
  );
  result.scanned = pgRows.rows.length;
  if (result.scanned === 0) return result;

  // 2) IMC 안 전체 목록 조회 (페이지네이션 영역)
  const imcByKey = new Map<string, any>();
  console.log(`[kakao-template-sync] IMC listAlimtalkTemplates 호출 영역 영구 시작 — count=${IMC_PAGE_SIZE} max_pages=${IMC_MAX_PAGES}`);
  for (let page = 0; page < IMC_MAX_PAGES; page++) {
    let r;
    try {
      r = await imc.listAlimtalkTemplates({ page, count: IMC_PAGE_SIZE });
    } catch (err: any) {
      // ★ D217+ fix v2: stderr 영역 영구 X — console.log 영구 영역 영구 진단 영역
      console.log(
        `[kakao-template-sync] IMC list page ${page} 오류 — name=${err?.name || '(X)'} code=${err?.code || '(X)'} message=${err?.message || String(err)} httpStatus=${err?.httpStatus || '(X)'}`,
      );
      break;
    }
    // ★ D217+ fix v2: 응답 영역 영구 영역 영구 출력 (모든 페이지 영역 영구 영역)
    console.log(
      `[kakao-template-sync] IMC 응답 page=${page} r.code=${r.code} r.message=${(r.message || '').slice(0, 80)}`,
    );
    if (r.code !== '0000') {
      console.log(`[kakao-template-sync] IMC list page ${page} code=${r.code} ≠ 0000 — break 영역`);
      break;
    }
    // ★ D217+ fix v3 (2026-05-26 Harold 명시 진단 영역 확정): IMC 안 응답 필드명 = `templateList` 영구 정합
    //   Harold raw 정독 결과 = r.data 최상위 키 = [hasNext, total, templateList] 영역 영구 정합
    //   옛 sync = `list` / `data.list` / `templates` 영역 영구 X = 빈 배열 영역 = matched=0 사고 진정 root cause.
    //   IMC 안 total = 4,849건 영구 전체 = templateList 영역 영구 정합 + hasNext 영역 영구 페이지네이션 영역.
    const items: any[] =
      (r.data as any)?.templateList ||   // ★ 진정 IMC 영역 영구 정합 (우선)
      (r.data as any)?.list ||
      (r.data as any)?.data?.list ||
      (r.data as any)?.data?.templateList ||
      (r.data as any)?.templates ||
      (Array.isArray(r.data) ? (r.data as any) : null) ||
      [];
    if (page === 0) {
      const rawKeys = r.data ? Object.keys(r.data) : [];
      const firstItem = items[0] || null;
      const firstItemKeys = firstItem ? Object.keys(firstItem) : [];
      console.log(
        `[kakao-template-sync][디버그] page=0 r.code=${r.code} r.data 최상위 키=[${rawKeys.join(',')}] items.length=${items.length} 첫 item 키=[${firstItemKeys.join(',')}]`,
      );
      if (firstItem) {
        // 첫 item 영역 = templateKey + templateCode + templateName 영역 영구 확인
        console.log(
          `[kakao-template-sync][디버그] 첫 item 영역 = templateKey=${firstItem.templateKey || firstItem.template_key || '(X)'} templateCode=${firstItem.templateCode || firstItem.template_code || '(X)'} templateName=${firstItem.templateName || firstItem.template_name || '(X)'}`,
        );
      } else if (items.length === 0) {
        // items 영역 0건 시 = r.data raw 영역 영구 출력 (영구 진단)
        const rawSnippet = JSON.stringify(r.data).slice(0, 500);
        console.log(`[kakao-template-sync][디버그] items 0건 — r.data raw (500자): ${rawSnippet}`);
      }
    }
    if (items.length === 0) break;
    for (const item of items) {
      // 옛 templateKey + 신규 template_key 영역 영구 둘 다 영구 매핑
      const key = item?.templateKey || item?.template_key;
      if (key) {
        imcByKey.set(String(key), item);
      }
    }
    if (items.length < IMC_PAGE_SIZE) break;
  }
  console.log(`[kakao-template-sync][디버그] IMC 안 영구 매핑 영역 총 ${imcByKey.size}건`);

  // 3) 매칭 + UPDATE
  for (const row of pgRows.rows) {
    const templateKey: string = row.template_key || row.template_code;
    const imcItem = imcByKey.get(templateKey);
    if (!imcItem) {
      result.failed++;
      // ★ D217+ fix (2026-05-26 Harold 명시 진단): 매칭 X 첫 3건 = IMC 안 가장 유사 영역 영구 출력
      if (result.failed <= 3) {
        const imcKeys = Array.from(imcByKey.keys()).slice(0, 5);
        console.warn(
          `[kakao-template-sync][디버그] 매칭 X — 한줄로 templateKey=${templateKey} (${row.template_name}) / IMC 안 영구 처음 5건 = [${imcKeys.join(',')}]`,
        );
      }
      result.details.push({
        id: row.id,
        company_id: row.company_id,
        template_name: row.template_name,
        old_code: row.template_code,
        new_code: null,
        status: 'failed',
        error: `IMC 안 templateKey=${templateKey} 영역 매칭 X (IMC 안 총 ${imcByKey.size}건)`,
      });
      continue;
    }
    result.matched++;

    const imcCode: string | null = imcItem.templateCode || null;
    if (!imcCode) {
      // IMC 안 templateCode 영역 영구 미발급 영역 (검수 진행 영역 또는 발급 영역 X)
      result.skipped++;
      result.details.push({
        id: row.id,
        company_id: row.company_id,
        template_name: row.template_name,
        old_code: row.template_code,
        new_code: null,
        status: 'skipped_no_code',
      });
      continue;
    }
    if (imcCode === row.template_code) {
      // 옛 영역 = 동일 = skip (이미 정정 영역)
      result.skipped++;
      result.details.push({
        id: row.id,
        company_id: row.company_id,
        template_name: row.template_name,
        old_code: row.template_code,
        new_code: imcCode,
        status: 'skipped_same',
      });
      continue;
    }

    // UPDATE 진입
    if (options.dryRun) {
      result.updated++;
      result.details.push({
        id: row.id,
        company_id: row.company_id,
        template_name: row.template_name,
        old_code: row.template_code,
        new_code: imcCode,
        status: 'updated',
      });
      continue;
    }
    try {
      await query(
        `UPDATE kakao_templates
            SET template_code = $1,
                last_synced_at = now(),
                updated_at = now()
          WHERE id = $2::uuid`,
        [imcCode, row.id],
      );
      result.updated++;
      result.details.push({
        id: row.id,
        company_id: row.company_id,
        template_name: row.template_name,
        old_code: row.template_code,
        new_code: imcCode,
        status: 'updated',
      });
      console.log(
        `[kakao-template-sync] UPDATE 정합 — id=${row.id} ${row.template_code} → ${imcCode} (${row.template_name})`,
      );
    } catch (err: any) {
      result.failed++;
      result.details.push({
        id: row.id,
        company_id: row.company_id,
        template_name: row.template_name,
        old_code: row.template_code,
        new_code: imcCode,
        status: 'failed',
        error: err?.message || String(err),
      });
      console.error(
        `[kakao-template-sync] UPDATE 실패 — id=${row.id}:`,
        err?.message || err,
      );
    }
  }

  return result;
}

/**
 * ★ 2026-06-10 신설 — IMC 템플릿 "활성상태(status A/R/S/D)" 동기화.
 *
 * 배경: 강조표기형 7300 추적 종결 — IMC에는 검수상태(inspectionStatus)와 별개로
 * 템플릿 활성상태(status)가 있고, 검수 APR이어도 status가 R(활성 대기)이면 카카오가
 * 모든 발송을 7300으로 거부한다. 한줄로는 이 값을 저장하지 않아 화면은 "승인"으로
 * 보이는데 발송만 계속 실패하는 상태를 만들 수 있었다 (B_IV_013_02_79738 실사례).
 *
 * 동작: IMC 전체 목록(이미 검증된 templateList 페이지네이션)을 받아 template_key로
 * 매칭, imc_template_status·reject_reason 변경분만 UPDATE.
 * kakao_templates.imc_template_status 컬럼 미마이그레이션(ALTER 전)이면 안내 로그 후 skip.
 */
export async function syncTemplateStatuses(): Promise<{
  scanned: number;
  updated: number;
  skipped: boolean;
}> {
  // 0) 현재 값 로드
  //
  // ⛔ 활성상태 컬럼 하나가 함수를 통째로 멈추게 두지 않는다 (★2026-09-12 직원 접수 4번 재발 방지)
  //   옛 코드는 첫 SELECT에 `imc_template_status`를 넣어, 그 컬럼이 없으면 **검수상태·반려사유
  //   동기화까지 함께 멎었다**. 로그는 "활성상태 동기화 skip"이라 적어 축소 보고했고,
  //   그래서 단건 조회가 4011로 죽은 6일 동안 이 안전망이 한 번도 돌지 않았다.
  //   이제 컬럼은 별도로 시도하고, 없으면 **활성상태 갱신만** 건너뛴다.
  let pgRows;
  let hasActiveCol = true;
  try {
    pgRows = await query(
      `SELECT id, template_key, template_code, status, imc_template_status, reject_reason
         FROM kakao_templates
        WHERE template_key IS NOT NULL`
    );
  } catch (err: any) {
    const msg = err?.message || '';
    if (!(msg.includes('column') && msg.includes('does not exist'))) throw err;
    hasActiveCol = false;
    console.log('[kakao-template-sync] imc_template_status 컬럼 없음 — 활성상태만 빼고 검수상태 동기화는 계속한다');
    pgRows = await query(
      `SELECT id, template_key, template_code, status, reject_reason
         FROM kakao_templates
        WHERE template_key IS NOT NULL`
    );
  }
  if (pgRows.rows.length === 0) return { scanned: 0, updated: 0, skipped: false };

  // 1) IMC 전체 목록 → templateKey 매핑 (syncTemplateCodes와 동일 페이지네이션 패턴)
  const imcByKey = new Map<string, any>();
  for (let page = 0; page < IMC_MAX_PAGES; page++) {
    let r;
    try {
      r = await imc.listAlimtalkTemplates({ page, count: IMC_PAGE_SIZE });
    } catch (err: any) {
      console.log(`[kakao-template-sync][status] IMC list page ${page} 오류 — ${err?.message || err}`);
      break;
    }
    if (r.code !== '0000') break;
    const items: any[] = (r.data as any)?.templateList || (r.data as any)?.list || [];
    if (items.length === 0) break;
    for (const item of items) {
      const key = item?.templateKey || item?.template_key;
      if (key) imcByKey.set(String(key), item);
    }
    if (items.length < IMC_PAGE_SIZE) break;
  }
  if (imcByKey.size === 0) return { scanned: pgRows.rows.length, updated: 0, skipped: false };

  // 2) 변경분만 UPDATE
  let updated = 0;
  for (const row of pgRows.rows) {
    const item = imcByKey.get(String(row.template_key));
    if (!item) continue;
    const imcStatus: string | null = item.status ? String(item.status) : null;
    const imcReject: string | null = item.rejectReason ? String(item.rejectReason) : null;

    /**
     * ★ 2026-09-12 목록으로 **검수상태**도 메운다(직원 접수 4번 재발 방지).
     *   옛 코드는 활성상태(`item.status`)만 읽고 검수상태(`item.inspectionStatus`)를 읽지 않아,
     *   단건 조회가 죽으면 검수 결과가 영원히 미반영이었다. 5분 폴링이 2026-05-12에 고친 것과 같은 축이다.
     *
     * ⛔ **진행 중인 행만** 바꾼다. 이미 종결(승인·반려)된 행을 목록이 뒤집지 않는다 —
     *   이 경로는 단건이 못 고친 것을 메우는 안전망이지 판정의 주인이 아니다.
     *   `status`는 발송 가능 여부를 가르는 값이라, 뒤집히면 멀쩡한 템플릿의 발송이 막힌다.
     */
    const rawInspection = (item as any).inspectionStatus ?? null;
    const inProgress = IMC_IN_PROGRESS_STATUSES.has(String(row.status || '').toUpperCase());
    const nextStatus = rawInspection && inProgress
      ? normalizeImcTemplateStatus(String(rawInspection))
      : null;
    const inspectionChanged = !!nextStatus && nextStatus !== String(row.status || '');

    const statusChanged = hasActiveCol && imcStatus !== (row.imc_template_status || null);
    const rejectChanged = !!imcReject && imcReject !== (row.reject_reason || null);
    if (!statusChanged && !rejectChanged && !inspectionChanged) continue;

    // 컬럼 부재·검수상태 미변경에 따라 SET 절을 조립한다 — 없는 컬럼을 쓰지 않고, 종결 행을 뒤집지 않는다
    const sets: string[] = [];
    const params: any[] = [];
    if (inspectionChanged) {
      params.push(nextStatus);
      sets.push(`status = $${params.length}`);
      params.push(nextStatus);
      sets.push(`reviewed_at = CASE WHEN $${params.length}::text IN ('APPROVED','REJECTED','KREJ','HREJ') THEN COALESCE(reviewed_at, now()) ELSE reviewed_at END`);
    }
    if (statusChanged) {
      params.push(imcStatus);
      sets.push(`imc_template_status = $${params.length}`);
    }
    if (rejectChanged) {
      params.push(imcReject);
      sets.push(`reject_reason = COALESCE($${params.length}, reject_reason)`);
    }
    sets.push('last_synced_at = now()', 'updated_at = now()');
    params.push(row.id);
    let where = `id = $${params.length}::uuid`;
    /**
     * ⛔ 진행 중 조건을 **UPDATE 시점에도** 건다 (Codex 1R high 수용).
     *   진행 여부는 목록 페이지를 돌기 전 SELECT 값으로 정했다. 그 사이 몇 분 동안 5분 폴링이
     *   승인을 저장했으면, id만 보고 덮어쓰는 순간 승인된 템플릿이 다시 진행 중으로 돌아가
     *   발송이 막힌다. 조건에 걸려 0행이면 그대로 두는 것이 맞다 — 이 경로는 안전망이지 주인이 아니다.
     */
    if (inspectionChanged) {
      params.push(row.status);
      where += ` AND status = $${params.length}`;
    }

    try {
      const res = await query(`UPDATE kakao_templates SET ${sets.join(', ')} WHERE ${where}`, params);
      if (inspectionChanged && (res.rowCount ?? (res.rows?.length || 0)) === 0) {
        console.log(`[kakao-template-sync][status] ${row.template_code} 그 사이 상태가 바뀌어 건너뜀 (안전망이 주인을 덮지 않는다)`);
        continue;
      }
      updated++;
      if (inspectionChanged) {
        console.log(`[kakao-template-sync][status] ${row.template_code} 검수상태 ${row.status || '(없음)'} → ${nextStatus} (목록 안전망)`);
      }
      if (statusChanged) {
        console.log(`[kakao-template-sync][status] ${row.template_code} 활성상태 ${row.imc_template_status || '(없음)'} → ${imcStatus || '(없음)'}`);
      }
    } catch (err: any) {
      console.log(`[kakao-template-sync][status] UPDATE 실패 id=${row.id}: ${err?.message || err}`);
    }
  }
  return { scanned: pgRows.rows.length, updated, skipped: false };
}

/**
 * 단일 templateKey 영역 정정 (Phase 2 getAlimtalkTemplate 영역 안 호출 영역 정합).
 *
 * 옛 endpoint = IMC 응답 안 `r.data.templateCode` 영역 = 진정 카카오 코드 영역 영구 받음 →
 * 본 함수 = `kakao_templates.template_code` 영역 = 옛 Tmp_xxx 영역 → 진정 카카오 코드 영구 정정.
 *
 * @returns 정정 영역 시 true, 정정 영역 X (이미 정합 / IMC 코드 X / 동일) 시 false
 */
export async function syncSingleTemplateCode(
  templateId: string,
  imcResponseData: any,
): Promise<{ updated: boolean; oldCode?: string; newCode?: string }> {
  const imcCode: string | null = imcResponseData?.templateCode || null;
  if (!imcCode) return { updated: false };
  if (imcCode.startsWith('Tm')) return { updated: false }; // ★ 버그5: IMC 응답도 Tm* 키(Tmp/Tmo/Tmq)면 진짜 카카오 코드 아님 — 저장 X (실코드=B_)

  const cur = await query(
    `SELECT template_code FROM kakao_templates WHERE id = $1::uuid LIMIT 1`,
    [templateId],
  );
  if (cur.rows.length === 0) return { updated: false };
  const oldCode: string = cur.rows[0].template_code;
  if (oldCode === imcCode) return { updated: false };
  if (!oldCode.startsWith('Tm')) return { updated: false }; // ★ 버그5: 로컬 코드가 Tm* 키가 아니면 이미 실코드(B_) = skip (Tmq도 backfill 대상)

  try {
    await query(
      `UPDATE kakao_templates
          SET template_code = $1,
              last_synced_at = now(),
              updated_at = now()
        WHERE id = $2::uuid`,
      [imcCode, templateId],
    );
    console.log(
      `[kakao-template-sync] 단일 정합 — id=${templateId} ${oldCode} → ${imcCode}`,
    );
    return { updated: true, oldCode, newCode: imcCode };
  } catch (err: any) {
    console.error(`[kakao-template-sync] 단일 UPDATE 실패 — id=${templateId}:`, err?.message || err);
    return { updated: false };
  }
}
