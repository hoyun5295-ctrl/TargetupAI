/**
 * 알림톡/브랜드메시지 관련 배치 작업
 *
 * ALIMTALK-DESIGN.md §5-7 기준. 스케줄러 3종.
 *
 *   1) syncCategoriesJob       — 매일 03:00 KST, 발신프로필/템플릿 카테고리 캐시 갱신
 *   2) syncPendingTemplatesJob — 5분 주기, 검수중/승인대기 상태 폴링 (웹훅 누락 시 fallback)
 *   3) syncSenderStatusJob     — 1시간 주기, 발신프로필 상태 폴링
 *
 * 운영 원칙:
 *   - IMC env(API_KEY/BASE_URL) 미설정 시 전부 no-op (Phase 0 대응)
 *   - 개별 호출 실패는 로그만 남기고 다음 주기 계속 (배치 전체가 중단되지 않도록)
 *   - 기존 `auto-campaign-worker.ts` / `spam-test-queue.ts` 패턴(setInterval 기반) 준수
 */

import { query } from '../config/database';
import * as imc from './alimtalk-api';
import { getAuthSmsTable, bulkInsertSmsQueue } from './sms-queue';
// ★ 2026-06-13: 검수 진입 시 발급되는 IMC 템플릿코드를 상태 동기화 때 함께 반영 (반려 템플릿 코드 미반영 구멍 fix)
import { syncSingleTemplateCode } from './kakao-template-sync';
import { buildTemplateInspectionNotifyMessage } from './auto-notify-message';

// ════════════════════════════════════════════════════════════
// 공통 유틸
// ════════════════════════════════════════════════════════════

function envReady(): boolean {
  const env = process.env.IMC_ENV || 'STG';
  const key =
    env === 'PRD' ? process.env.IMC_API_KEY : process.env.IMC_API_KEY_SANDBOX;
  const url =
    env === 'PRD' ? process.env.IMC_BASE_URL_PRD : process.env.IMC_BASE_URL_STG;
  return !!key && !!url;
}

function log(tag: string, ...args: any[]) {
  console.log(`[alimtalk-jobs][${tag}]`, ...args);
}

function logErr(tag: string, err: any) {
  console.error(`[alimtalk-jobs][${tag}] 실패`, err?.message || err);
}

// ════════════════════════════════════════════════════════════
// 1) 카테고리 일일 동기화 (매일 03:00 KST)
// ════════════════════════════════════════════════════════════

/**
 * IMC 응답에서 실제 데이터 배열 추출.
 * 실측된 운영 IMC 응답 구조 (2026-04-18):
 *   GET /sender/category  → { code:'0000', data: { code:200, data: [...] } }   — 이중 래핑
 *   GET /alimtalk/template/category → (동일 구조 가능성 있음, 안전하게 동일 처리)
 * 우리 백엔드 타입은 data가 배열이라 가정했지만 실제는 객체로 래핑되어 있어
 * `Array.isArray(res.data)` 만으로는 silent skip되던 버그를 흡수.
 */
function extractImcList(res: any): any[] {
  if (Array.isArray(res?.data?.data)) return res.data.data;
  if (Array.isArray(res?.data)) return res.data;
  if (Array.isArray(res?.data?.list)) return res.data.list;
  return [];
}

export async function syncCategoriesJob(): Promise<void> {
  if (!envReady()) {
    log('categorySync', 'env 미설정 — skip');
    return;
  }

  // ── 발신프로필 카테고리 (3단 트리, code 11자리)
  //    IMC 실제 응답: flat 배열 { code:"00100010001", name:"건강,병원,종합병원" }
  //    code = 3(대) + 4(중) + 4(소). name = "대,중,소" 콤마 구분.
  //    우리 DB(kakao_sender_categories)는 3단 트리(parent_code + level)를 기대 → 자체 재구성.
  try {
    const senderRes = (await imc.listSenderCategories()) as any;
    const leafs = extractImcList(senderRes);
    if (senderRes?.code === '0000' && leafs.length > 0) {
      const seen = new Set<string>();
      let leafCount = 0;
      let ancestorCount = 0;
      for (const leaf of leafs) {
        const code: string = String(leaf?.code || '');
        const nameRaw: string = String(leaf?.name || '');
        if (code.length !== 11) continue;

        const parts = nameRaw.split(',').map((s) => s.trim()).filter(Boolean);
        // name이 "대,중,소" 3분할 안 되면 통째로 소분류 이름으로만 쓰고 부모 이름은 code 기반 placeholder
        const [l1Name = `대분류${code.slice(0, 3)}`, l2Name = `중분류${code.slice(3, 7)}`, l3Name = nameRaw] = parts.length >= 3
          ? parts
          : [undefined, undefined, nameRaw];

        const l1Code = code.slice(0, 3);
        const l2Code = code.slice(0, 7);
        const l3Code = code;

        // Level 1 (대분류) — 처음 본 코드만 INSERT
        if (!seen.has(l1Code)) {
          seen.add(l1Code);
          await query(
            `INSERT INTO kakao_sender_categories (category_code, parent_code, level, name, active_yn, synced_at)
             VALUES ($1, NULL, 1, $2, 'Y', now())
             ON CONFLICT (category_code) DO UPDATE SET
               parent_code = EXCLUDED.parent_code,
               level       = EXCLUDED.level,
               name        = EXCLUDED.name,
               active_yn   = 'Y',
               synced_at   = now()`,
            [l1Code, l1Name],
          );
          ancestorCount++;
        }
        // Level 2 (중분류)
        if (!seen.has(l2Code)) {
          seen.add(l2Code);
          await query(
            `INSERT INTO kakao_sender_categories (category_code, parent_code, level, name, active_yn, synced_at)
             VALUES ($1, $2, 2, $3, 'Y', now())
             ON CONFLICT (category_code) DO UPDATE SET
               parent_code = EXCLUDED.parent_code,
               level       = EXCLUDED.level,
               name        = EXCLUDED.name,
               active_yn   = 'Y',
               synced_at   = now()`,
            [l2Code, l1Code, l2Name],
          );
          ancestorCount++;
        }
        // Level 3 (소분류) — leaf는 항상 INSERT
        await query(
          `INSERT INTO kakao_sender_categories (category_code, parent_code, level, name, active_yn, synced_at)
           VALUES ($1, $2, 3, $3, 'Y', now())
           ON CONFLICT (category_code) DO UPDATE SET
             parent_code = EXCLUDED.parent_code,
             level       = EXCLUDED.level,
             name        = EXCLUDED.name,
             active_yn   = 'Y',
             synced_at   = now()`,
          [l3Code, l2Code, l3Name],
        );
        leafCount++;
      }
      log(
        'categorySync',
        `sender 카테고리 L3 ${leafCount}건 + L1/L2 ${ancestorCount}건 동기화 (총 ${leafCount + ancestorCount}건)`,
      );
    } else {
      logErr(
        'categorySync-sender',
        new Error(
          `응답 구조 불일치 or 빈 배열 — code=${senderRes?.code}, leafCount=${leafs.length}, keys=${
            senderRes?.data ? Object.keys(senderRes.data).slice(0, 5).join(',') : 'n/a'
          }`,
        ),
      );
    }
  } catch (err) {
    logErr('categorySync-sender', err);
  }

  // ── 템플릿 카테고리 (flat, code 6자리 + groupName 대분류)
  //    IMC 실측 응답 (2026-04-21): { code, name, groupName, inclusion, exclusion }
  //    동일 IMC 이중 래핑 가능성은 extractImcList()로 흡수.
  try {
    const tplRes = (await imc.listTemplateCategories()) as any;
    const list = extractImcList(tplRes);
    if (tplRes?.code === '0000' && list.length > 0) {
      for (const c of list) {
        if (!c?.code) continue;
        await query(
          `INSERT INTO kakao_template_categories
             (category_code, name, group_name, inclusion, exclusion, active_yn, synced_at)
           VALUES ($1, $2, $3, $4, $5, 'Y', now())
           ON CONFLICT (category_code) DO UPDATE SET
             name       = EXCLUDED.name,
             group_name = EXCLUDED.group_name,
             inclusion  = EXCLUDED.inclusion,
             exclusion  = EXCLUDED.exclusion,
             active_yn  = 'Y',
             synced_at  = now()`,
          [
            String(c.code),
            String(c.name || ''),
            c.groupName ? String(c.groupName) : null,
            c.inclusion ? String(c.inclusion) : null,
            c.exclusion ? String(c.exclusion) : null,
          ],
        );
      }
      log('categorySync', `template 카테고리 ${list.length}건 동기화 (groupName 포함)`);
    } else {
      logErr(
        'categorySync-template',
        new Error(
          `응답 구조 불일치 or 빈 배열 — code=${tplRes?.code}, list=${list.length}`,
        ),
      );
    }
  } catch (err) {
    logErr('categorySync-template', err);
  }
}

// ════════════════════════════════════════════════════════════
// 2) 검수중 템플릿 상태 폴링 (5분 주기, 웹훅 누락 fallback)
// ════════════════════════════════════════════════════════════

export async function syncPendingTemplatesJob(): Promise<void> {
  if (!envReady()) {
    log('pendingTemplateSync', 'env 미설정 — skip');
    return;
  }

  let rows: Array<{
    id: string;
    company_id: string;
    profile_key: string;
    template_code: string;
    template_key: string | null;
    template_name: string;
    profile_name: string | null;
    status: string;
    alarm_notified_status: string | null;
  }> = [];

  try {
    // ★ D152-4 Harold님 핵심 지시 (2026-05-12): IMC 6단계 정합 — KREQ 누락이 D135부터 4주 반복 사고의 진짜 root cause.
    //   IMC 흐름: REG(등록) → REQ(검수요청, 한줄로→IMC) → HREJ(내부 반려) | KREQ(카카오 검수요청, 내부 검수 통과)
    //                                                          → KREJ(카카오 반려) | APR(승인완료)
    //   기존: REQUESTED/REVIEWING/REQ/REV 4종만 폴링 → KREQ 단계가 폴링 대상에서 빠져 영원히 동기화 X
    //   수정: IMC 진행 중 상태 5종(REG/REQ/REV/KREQ + 한줄로 풀네임 REQUESTED/REVIEWING) 전부 포함.
    //         REG는 검수요청 전 상태지만 IMC 측 변경(승인 자동 진행 등) 대비 포함.
    const res = await query(
      `SELECT t.id,
              t.company_id,
              p.profile_key,
              p.profile_name,
              t.template_code,
              t.template_key,
              t.template_name,
              t.status,
              t.alarm_notified_status
         FROM kakao_templates t
         JOIN kakao_sender_profiles p ON p.id = t.profile_id
        WHERE (
          t.status IN ('REQUESTED','REVIEWING','REG','REQ','REV','KREQ')
          OR (t.status IN ('APPROVED','REJECTED','KREJ') AND t.alarm_notified_status IS NULL)
        )
          AND (t.last_synced_at IS NULL OR t.last_synced_at < now() - INTERVAL '5 minutes')
        LIMIT 100`,
    );
    rows = res.rows;
  } catch (err) {
    logErr('pendingTemplateSync-fetch', err);
    return;
  }

  if (rows.length === 0) return;

  let updated = 0;
  let notified = 0;
  for (const row of rows) {
    try {
      // ★ 2026-06-10 정정: IMC GET 경로 파라미터 = templateKey.
      //   D217이 template_code를 진짜 카카오 코드(B_XX_...)로 바꾼 뒤로는 code로 호출하면
      //   4013(찾을 수 없음)으로 조용히 실패해 동기화가 죽어 있었다. template_key 우선, 없으면 code.
      const res = await imc.getAlimtalkTemplate(
        row.profile_key,
        row.template_key || row.template_code,
      );
      if (res.code !== '0000' || !res.data) continue;

      // ★ D152-4 추가 fix (2026-05-12 자기검증) — D135부터 4주 반복의 진짜 진짜 root cause.
      //   kakao_alimtalk.md 매뉴얼 정독 결과 IMC 응답 스펙:
      //     - `inspectionStatus` (string enum): 검수 상태 (REG/REQ/HREJ/KREQ/KREJ/APR) ← 한줄로 모니터링 대상
      //     - `status` (string enum): 템플릿 상태 (별도 — 활성/비활성)
      //   기존 코드: `(res.data as any).status` → 잘못된 필드 읽음 → 검수 결과 영원히 미반영.
      //   수정: inspectionStatus 우선, fallback으로 status (구버전 호환).
      const rawLatestStatus =
        (res.data as any).inspectionStatus ??
        (res.data as any).status;
      if (!rawLatestStatus) continue;
      // ★ D143 (2026-04-30): IMC 약어(REQ/REV/APR/REJ) → 풀네임 정규화.
      // ★ D152-4 (2026-05-12): IMC 6단계 raw(REG/HREJ/KREQ/KREJ) 그대로 통과 (DB CHECK 12개 허용).
      const latestStatus = normalizeImcTemplateStatus(rawLatestStatus);

      const rejectReason = (res.data as any).rejectReason ?? null;
      // ★ 2026-06-10: IMC 템플릿 활성상태(A/R/S/D)도 함께 기록 — 검수 APR + 활성 R(발송 불가 7300) 식별용
      const imcTemplateStatus = (res.data as any).status ? String((res.data as any).status) : null;

      // ★ 2026-06-13: 검수 종결(승인/반려) 도착 시 reviewed_at 기록 — 변경 이력에는 남는데
      //   본 컬럼이 영구 NULL이던 구멍(인비토 반려 건 실측). 최초 도착 시각만 보존(COALESCE).
      // ★ 2026-07-02: 42P08 차단 — `SET status = $1`(varchar 추론)과 CASE 비교(text 추론)가
      //   같은 param을 두 타입으로 추론해 5분 주기 sync가 반복 실패하던 결함.
      //   비교용 param을 분리 + 명시 캐스트 (0701 ensureSystemSyncUser와 동일 처방).
      const reviewedAtExprFor = (p: string) => `CASE WHEN ${p}::text IN ('APPROVED','REJECTED','KREJ','HREJ')
                                   THEN COALESCE(reviewed_at, now()) ELSE reviewed_at END`;
      try {
        await query(
          `UPDATE kakao_templates
              SET status              = $1,
                  reject_reason       = $2,
                  imc_template_status = $3,
                  reviewed_at         = ${reviewedAtExprFor('$5')},
                  last_synced_at      = now(),
                  updated_at          = now()
            WHERE id = $4`,
          [latestStatus, rejectReason, imcTemplateStatus, row.id, latestStatus],
        );
      } catch (colErr: any) {
        const msg = colErr?.message || '';
        if (msg.includes('column') && msg.includes('does not exist')) {
          // imc_template_status ALTER 전 — 기존 컬럼만 갱신 (기능 저하 없이 동작 유지)
          await query(
            `UPDATE kakao_templates
                SET status          = $1,
                    reject_reason   = $2,
                    reviewed_at     = ${reviewedAtExprFor('$4')},
                    last_synced_at  = now(),
                    updated_at      = now()
              WHERE id = $3`,
            [latestStatus, rejectReason, row.id, latestStatus],
          );
        } else {
          throw colErr;
        }
      }
      updated++;

      // ★ 2026-06-13: 카카오 검수 진입 시 IMC가 발급한 진짜 템플릿코드(B_XX_...)를 상태 동기화 때 함께 반영.
      //   기존 코드 백필(syncTemplateCodes)은 승인 상태만 스캔해 반려(KREJ) 템플릿이 내부 키(Tmp...)로
      //   영구 잔존하던 구멍(인비토 B_IV_013_02_80287 실측). 단건 GET 응답을 그대로 재사용 — 추가 IMC 호출 0.
      try {
        await syncSingleTemplateCode(row.id, res.data);
      } catch (codeErr: any) {
        console.log(`[alimtalk-jobs] 템플릿코드 동기화 생략(${row.template_name}): ${codeErr?.message || codeErr}`);
      }

      // ★ D135+: 검수 상태 종결 전환 감지 → 담당자 SMS 자동 알림
      //   IMC createAlarmUser 권한 없음(4032) → 한줄로가 직접 kakao_alarm_users + QTmsg 인증 라인으로 발송.
      //   alarm_notified_status 컬럼으로 중복 알림 차단 (동일 상태 재발송 X).
      const terminal = toTerminalStatus(latestStatus);
      if (terminal && row.alarm_notified_status !== terminal) {
        try {
          const count = await notifyTemplateInspectionResult({
            companyId: row.company_id,
            profileKey: row.profile_key,
            templateName: row.template_name,
            profileName: row.profile_name,
            status: terminal,
            rejectReason,
          });
          // ★ D188 (2026-05-21) 영업팀장 신고 #1 추가 fix: count > 0 시에만 alarm_notified_status UPDATE.
          //   기존 = callback 빈 영역(admin_phone_number 미등록 + sender_registrations 0건)에서 return 0 됐는데
          //   UPDATE는 강제 실행 → alarm_notified_status='APPROVED' 영구 잔존 + 다음 cron 재시도 0 사고.
          //   영구 정합 = count > 0 시에만 UPDATE 실행 → callback 미등록 회사가 admin_phone_number 등록한 직후
          //   5분 cron에서 재시도 가능 + SMS 발화 정합.
          if (count > 0) {
            await query(
              `UPDATE kakao_templates SET alarm_notified_status = $1 WHERE id = $2`,
              [terminal, row.id],
            );
            notified += count;
            log(
              'pendingTemplateSync',
              `alarmNotify ${terminal} ${row.template_name} → ${count}명`,
            );
          } else {
            log(
              'pendingTemplateSync',
              `alarmNotify skip ${terminal} ${row.template_name} — count=0 (callback 미등록 가능성, alarm_notified_status 유지 = 다음 cron 재시도)`,
            );
          }
        } catch (notifyErr) {
          logErr(`pendingTemplateSync-alarmNotify-${row.template_code}`, notifyErr);
        }
      }
    } catch (err) {
      logErr(`pendingTemplateSync-${row.template_code}`, err);
      // 개별 템플릿 실패해도 계속
    }
  }
  log(
    'pendingTemplateSync',
    `${updated}/${rows.length}건 상태 갱신 (담당자 알림 ${notified}건)`,
  );
}

/**
 * IMC status 값을 내부 terminal 상태(APPROVED/REJECTED)로 정규화.
 *
 * ★ D152-4 Harold님 지시 (2026-05-12): IMC 6단계 정합 (kakao_alimtalk.md 매뉴얼).
 *   - APR / APPROVED → 'APPROVED' (승인완료, 발송 가능 = 종결)
 *   - REJ / REJECTED / KREJ → 'REJECTED' (카카오 반려 = 종결, 재검수 가능하지만 알림 발송 시점)
 *   - HREJ → null (내부 반려 = 비종결 — 재검수 가능, 알림 발송 X)
 *   - REG / REQ / REV / KREQ / REQUESTED / REVIEWING → null (진행 중)
 */
function toTerminalStatus(status: string): 'APPROVED' | 'REJECTED' | null {
  const s = String(status || '').toUpperCase();
  if (s === 'APR' || s === 'APPROVED') return 'APPROVED';
  if (s === 'REJ' || s === 'REJECTED' || s === 'KREJ') return 'REJECTED';
  return null;
}

/**
 * ★ D143 (2026-04-30): IMC 약어 → 한줄로 풀네임 정규화.
 * ★ D152-4 Harold님 지시 (2026-05-12): IMC 6단계 정합 — KREQ/HREJ/KREJ 추가.
 *
 *  IMC 정의 6단계 (kakao_alimtalk.md 매뉴얼):
 *    REG  → 요청등록 (검수 전)
 *    REQ  → 검수요청 (한줄로 → IMC)
 *    HREJ → 내부 반려 (재검수 가능)
 *    KREQ → 카카오 검수요청 (내부 검수 통과 후)
 *    KREJ → 카카오 반려 (재검수 가능)
 *    APR  → 승인완료
 *
 *  기존 풀네임 4종(REQUESTED/REVIEWING/APPROVED/REJECTED)은 호환 유지.
 *  신규 6단계 raw IMC code(REG/HREJ/KREQ/KREJ)는 그대로 통과 — DB CHECK에 ALTER 추가 필요.
 *
 *  D135부터 D152-1까지 4주 반복 "검수 결과 미반영" 사고 = 이 함수가 KREQ를 받으면 그대로 통과시키지만
 *  syncPendingTemplatesJob SELECT가 KREQ를 폴링 대상에 포함하지 않아 영원히 동기화 안 됨 = root cause.
 */
export function normalizeImcTemplateStatus(status: string): string {
  const u = String(status || '').toUpperCase().trim();
  // 기존 약어 → 풀네임 (D143 호환)
  if (u === 'REQ') return 'REQUESTED';
  if (u === 'REV') return 'REVIEWING';
  if (u === 'APR') return 'APPROVED';
  if (u === 'REJ') return 'REJECTED';
  // ★ D152-4 신규: IMC 6단계 raw code 그대로 통과 (DB CHECK에 KREQ/HREJ/KREJ 허용 필요)
  if (u === 'REG' || u === 'HREJ' || u === 'KREQ' || u === 'KREJ') return u;
  return u;
}

/**
 * 템플릿 검수 결과 담당자 알림 SMS 발송.
 *
 * 동작:
 *   1) kakao_alarm_users에서 해당 회사의 active_yn='Y' 수신자 조회
 *   2) 한 명도 없으면 0 반환 (정상 종료)
 *   3) 발송 callback은 해당 발신프로필의 admin_phone_number 사용
 *      (관리자가 카톡 인증으로 본인확인한 번호 — 회신 들어와도 본인에게 감)
 *   4) getAuthSmsTable() 인증 라인에 bulkInsertSmsQueue로 LMS 발송
 *
 * 반환: 실제 발송 대상 수신자 수.
 */
async function notifyTemplateInspectionResult(params: {
  companyId: string;
  profileKey: string;
  templateName: string;
  profileName: string | null;
  status: 'APPROVED' | 'REJECTED';
  rejectReason: string | null;
}): Promise<number> {
  // 1) 활성 수신자 조회
  const usersRes = await query(
    `SELECT name, phone_number
       FROM kakao_alarm_users
      WHERE company_id = $1 AND COALESCE(active_yn, 'Y') = 'Y'`,
    [params.companyId],
  );
  const users = usersRes.rows || [];
  if (users.length === 0) return 0;

  // 2) 해당 발신프로필 관리자 번호 조회 (callback으로 사용)
  // ★ D188 (2026-05-21) 영업팀장 신고 #1: 인비토 채널 검수 알림 0건 사고 영구 종결.
  //   기존 admin_phone_number 빈 영역 → return 0 = 영영 알림 X. 인비토 같이 발신프로필 등록 시 admin_phone_number 누락된 회사의
  //   알림 영구 발화 0 사고. 영구 정합 = sender_registrations 첫 approved.phone fallback 적용.
  //   회신 사고 위험 최소화 = 회사 본인 검증된 phone 영역만 사용 (외부 phone 사용 X).
  const profRes = await query(
    `SELECT admin_phone_number FROM kakao_sender_profiles WHERE profile_key = $1 LIMIT 1`,
    [params.profileKey],
  );
  let callback = String(profRes.rows[0]?.admin_phone_number || '').replace(/\D/g, '');

  // Fallback 1: 회사의 첫 approved sender_registrations.phone (회사 검증된 발신번호 = 회신 안전)
  if (!callback) {
    try {
      const srRes = await query(
        `SELECT phone FROM sender_registrations
          WHERE company_id = $1 AND status = 'approved'
          ORDER BY reviewed_at DESC NULLS LAST, id DESC
          LIMIT 1`,
        [params.companyId],
      );
      callback = String(srRes.rows[0]?.phone || '').replace(/\D/g, '');
      if (callback) {
        log(
          'notifyTemplateInspectionResult',
          `admin_phone_number 빈 영역 → sender_registrations fallback 사용 (profile_key=${params.profileKey}, callback=${callback})`,
        );
      }
    } catch (fallbackErr) {
      logErr('notifyTemplateInspectionResult-fallback', fallbackErr);
    }
  }

  // Fallback 2: 회사의 첫 활성 kakao_alarm_users.phone_number (회사 검증 phone — 회신 안전)
  // ★ D218+ (2026-05-26) PDF 신고 #1 사고 영구 차단: 인비토 발신프로필 admin_phone_number 누락 +
  //   sender_registrations approved 0건 회사도 알림 발화 정합. kakao_alarm_users는
  //   회사 admin이 직접 등록한 본인 검증 수신자 phone — 회신 안전 + 회사당 3명 제한.
  if (!callback) {
    try {
      const auRes = await query(
        `SELECT phone_number FROM kakao_alarm_users
          WHERE company_id = $1 AND COALESCE(active_yn, 'Y') = 'Y'
          ORDER BY created_at ASC
          LIMIT 1`,
        [params.companyId],
      );
      callback = String(auRes.rows[0]?.phone_number || '').replace(/\D/g, '');
      if (callback) {
        log(
          'notifyTemplateInspectionResult',
          `admin_phone_number + sender_registrations 둘 다 비어있어 kakao_alarm_users fallback 사용 (profile_key=${params.profileKey}, callback=${callback})`,
        );
      }
    } catch (fallback2Err) {
      logErr('notifyTemplateInspectionResult-fallback2', fallback2Err);
    }
  }

  if (!callback) {
    // 모든 fallback 실패 시 발송 불가. 로그만 남기고 스킵 (기간계 안정성 우선)
    logErr(
      'notifyTemplateInspectionResult',
      new Error(
        `admin_phone_number + sender_registrations + kakao_alarm_users fallback 모두 비어있음 — ` +
          `profile_key=${params.profileKey}, company_id=${params.companyId}. ` +
          `회사 admin에게 발신프로필 admin_phone_number 등록 또는 발신번호 승인 또는 검수 알림 수신자 등록 안내 필요.`,
      ),
    );
    return 0;
  }

  // 3) 메시지 빌드
  const notifyMessage = buildTemplateInspectionNotifyMessage({
    templateName: params.templateName,
    profileName: params.profileName,
    status: params.status,
    rejectReason: params.rejectReason,
  });
  const titleStr = `[알림톡 ${params.status === 'APPROVED' ? '승인' : '반려'}] ${params.templateName}`.slice(0, 40);

  // 4) 인증 라인 bulk INSERT (LMS, useNow=true)
  const authTable = await getAuthSmsTable();
  const rows: any[][] = [];
  for (const u of users) {
    const cleanPhone = String(u.phone_number || '').replace(/\D/g, '');
    if (!/^01\d{8,9}$/.test(cleanPhone)) continue;
    rows.push([
      cleanPhone,        // dest_no
      callback,          // call_back
      notifyMessage,     // msg_contents
      'L',               // msg_type (LMS)
      titleStr,          // title_str
      null,              // sendreq_time (useNow=true로 NOW() 사용)
      '',                // app_etc1
      params.companyId,  // app_etc2
      '',                // file_name1
      '',                // file_name2
      '',                // file_name3
    ]);
  }
  if (rows.length === 0) return 0;

  await bulkInsertSmsQueue([authTable], rows, true);
  return rows.length;
}

// ════════════════════════════════════════════════════════════
// 3) 발신프로필 상태 폴링 (1시간 주기)
// ════════════════════════════════════════════════════════════

export async function syncSenderStatusJob(): Promise<void> {
  if (!envReady()) {
    log('senderStatusSync', 'env 미설정 — skip');
    return;
  }

  // D131: yellow_id / category_name_cache 도 함께 동기화 (IMC uuid → yellow_id)
  let rows: Array<{
    id: string;
    profile_key: string;
    status: string | null;
    yellow_id: string | null;
  }> = [];
  try {
    const res = await query(
      `SELECT id, profile_key, status, yellow_id
         FROM kakao_sender_profiles
        WHERE profile_key IS NOT NULL
          AND COALESCE(status, 'PENDING') NOT IN ('DELETED')
        LIMIT 200`,
    );
    rows = res.rows;
  } catch (err) {
    logErr('senderStatusSync-fetch', err);
    return;
  }

  if (rows.length === 0) return;

  let updated = 0;
  let rawLogged = false;
  for (const row of rows) {
    try {
      const res = await imc.getSender(row.profile_key);
      if (res.code !== '0000' || !res.data) continue;
      const d = res.data;

      // ★ 2026-06-17: IMC 발신프로필 응답 raw 1회 로그 — block/dormant/brandMessage/createdAt
      //   실제 필드·포맷을 직접 확인하기 위함 (외부 API 응답 추측 금지, D217+ 알림톡 18일 누락 사고 방지).
      //   값·포맷 검증 종결 후 제거 가능.
      if (!rawLogged) {
        rawLogged = true;
        log(
          'senderStatusSync-raw',
          `keys=[${Object.keys(d).join(',')}] status=${d.status} block=${d.block} dormant=${d.dormant} brandMessage=${d.brandMessage} createdAt=${d.createdAt}`,
        );
      }

      // IMC status(A 등) + block/dormant boolean + brandMessage + 채널 생성일을 함께 저장.
      //   휴면/차단은 status만으론 구분 불가 → block/dormant boolean 필수.
      const blockYn = d.block === true ? 'Y' : 'N';
      const dormantYn = d.dormant === true ? 'Y' : 'N';
      const brandYn = d.brandMessage === true ? 'Y' : 'N';
      const channelCreatedAt = d.createdAt || null;

      await query(
        `UPDATE kakao_sender_profiles
            SET status             = COALESCE($1, status),
                yellow_id          = COALESCE($2, yellow_id),
                block_yn           = $3,
                dormant_yn         = $4,
                brand_message_yn   = $5,
                channel_created_at = COALESCE($6, channel_created_at),
                updated_at         = now()
          WHERE id = $7`,
        [d.status || null, d.uuid || null, blockYn, dormantYn, brandYn, channelCreatedAt, row.id],
      );
      updated++;
    } catch (err) {
      logErr(`senderStatusSync-${row.profile_key}`, err);
    }
  }
  log('senderStatusSync', `${updated}/${rows.length}건 상태 갱신`);
}

// ════════════════════════════════════════════════════════════
// 스케줄러 부트스트랩
// ════════════════════════════════════════════════════════════

let _scheduled = false;
let _categoryTimer: NodeJS.Timeout | null = null;
let _templateTimer: NodeJS.Timeout | null = null;
let _senderTimer: NodeJS.Timeout | null = null;

function nextKst03(): number {
  // 지금(UTC) → KST(+9h) → 다음 03:00 KST까지 ms
  const now = new Date();
  const kstNow = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const targetKst = new Date(kstNow);
  targetKst.setUTCHours(3, 0, 0, 0);
  if (targetKst.getTime() <= kstNow.getTime()) {
    targetKst.setUTCDate(targetKst.getUTCDate() + 1);
  }
  return targetKst.getTime() - kstNow.getTime();
}

function scheduleCategorySync() {
  const wait = nextKst03();
  _categoryTimer = setTimeout(async () => {
    try {
      await syncCategoriesJob();
    } catch (err) {
      logErr('categorySync-tick', err);
    }
    // 이후 24h 주기
    _categoryTimer = setInterval(() => {
      syncCategoriesJob().catch((e) => logErr('categorySync-interval', e));
    }, 24 * 60 * 60 * 1000);
  }, wait);
}

/**
 * 알림톡 배치 스케줄러 시작. app.ts listen 콜백에서 1회 호출.
 */
export function startAlimtalkScheduler(): void {
  if (_scheduled) return;
  _scheduled = true;

  // 1) 카테고리 — 다음 03:00 KST 첫 실행 + 이후 24h
  scheduleCategorySync();

  // 2) 검수중 템플릿 — 5분 주기
  _templateTimer = setInterval(() => {
    syncPendingTemplatesJob().catch((e) =>
      logErr('pendingTemplateSync-interval', e),
    );
  }, 5 * 60 * 1000);

  // 3) 발신프로필 — 1시간 주기
  _senderTimer = setInterval(() => {
    syncSenderStatusJob().catch((e) => logErr('senderStatusSync-interval', e));
  }, 60 * 60 * 1000);

  log('scheduler', 'started (category=daily 03:00 KST, template=5m, sender=1h)');
}

/** 테스트/재시작용 */
export function stopAlimtalkScheduler(): void {
  if (_categoryTimer) clearTimeout(_categoryTimer);
  if (_categoryTimer) clearInterval(_categoryTimer as any);
  if (_templateTimer) clearInterval(_templateTimer);
  if (_senderTimer) clearInterval(_senderTimer);
  _categoryTimer = _templateTimer = _senderTimer = null;
  _scheduled = false;
}
