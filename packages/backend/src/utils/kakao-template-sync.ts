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

const IMC_PAGE_SIZE = 500;
const IMC_MAX_PAGES = 20;  // 최대 10,000건 영역 (운영 영역 영구 안전)

/**
 * 한줄로 안 옛 Tmp_xxx 영역 = 진정 카카오 templateCode 영역 영구 정정.
 *
 * 흐름:
 *   1. PG 안 APPROVED + template_code LIKE 'Tmp%' 영역 조회
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

  // 1) PG 안 옛 Tmp_xxx 영역 조회
  const whereParts: string[] = [
    `status IN ('APPROVED', 'APPROVAL')`,
    `template_code LIKE 'Tmp%'`,
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
  for (let page = 0; page < IMC_MAX_PAGES; page++) {
    let r;
    try {
      r = await imc.listAlimtalkTemplates({ page, count: IMC_PAGE_SIZE });
    } catch (err: any) {
      console.error(`[kakao-template-sync] IMC list page ${page} 오류:`, err?.message || err);
      break;
    }
    if (r.code !== '0000') {
      console.warn(`[kakao-template-sync] IMC list page ${page} code=${r.code} msg=${r.message}`);
      break;
    }
    // ★ D217+ fix (2026-05-26 Harold 명시 진단): IMC 응답 영역 구조 영역 영구 디버그 로그
    //   옛 sync = matched=0 failed=8 사고 = 응답 안 templateKey 영역 영구 X 또는 응답 구조 영역 영구 다른 영역.
    //   첫 페이지 + 첫 사이클 시점 = raw 영역 영구 출력 + items 영역 영구 분석.
    const items: any[] =
      (r.data as any)?.list ||
      (r.data as any)?.data?.list ||
      (r.data as any)?.templates ||      // 옛 영역 = 다른 필드명 영역 가능
      (Array.isArray(r.data) ? (r.data as any) : null) ||  // r.data 자체 = 배열 영역 가능
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
  if (imcCode.startsWith('Tmp')) return { updated: false }; // IMC 안도 Tmp 영역 = 진정 카카오 코드 영구 X

  const cur = await query(
    `SELECT template_code FROM kakao_templates WHERE id = $1::uuid LIMIT 1`,
    [templateId],
  );
  if (cur.rows.length === 0) return { updated: false };
  const oldCode: string = cur.rows[0].template_code;
  if (oldCode === imcCode) return { updated: false };
  if (!oldCode.startsWith('Tmp')) return { updated: false }; // 옛 영역 = 이미 카카오 코드 영역 = skip

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
