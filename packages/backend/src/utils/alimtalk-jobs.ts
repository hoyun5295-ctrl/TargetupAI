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
    template_name: string;
    profile_name: string | null;
    status: string;
    alarm_notified_status: string | null;
  }> = [];

  try {
    const res = await query(
      `SELECT t.id,
              t.company_id,
              p.profile_key,
              p.profile_name,
              t.template_code,
              t.template_name,
              t.status,
              t.alarm_notified_status
         FROM kakao_templates t
         JOIN kakao_sender_profiles p ON p.id = t.profile_id
        WHERE t.status IN ('REQUESTED','REVIEWING','REQ','REV')
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
      const res = await imc.getAlimtalkTemplate(
        row.profile_key,
        row.template_code,
      );
      if (res.code !== '0000' || !res.data) continue;

      const latestStatus = (res.data as any).status;
      if (!latestStatus) continue;

      const rejectReason = (res.data as any).rejectReason ?? null;

      await query(
        `UPDATE kakao_templates
            SET status          = $1,
                reject_reason   = $2,
                last_synced_at  = now(),
                updated_at      = now()
          WHERE id = $3`,
        [latestStatus, rejectReason, row.id],
      );
      updated++;

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
          await query(
            `UPDATE kakao_templates SET alarm_notified_status = $1 WHERE id = $2`,
            [terminal, row.id],
          );
          if (count > 0) notified += count;
          log(
            'pendingTemplateSync',
            `alarmNotify ${terminal} ${row.template_name} → ${count}명`,
          );
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
 * 검수 진행 중(REQUESTED/REVIEWING/REQ/REV) 또는 기타 상태는 null 반환 (알림 대상 아님).
 */
function toTerminalStatus(status: string): 'APPROVED' | 'REJECTED' | null {
  const s = String(status || '').toUpperCase();
  if (s === 'APR' || s === 'APPROVED') return 'APPROVED';
  if (s === 'REJ' || s === 'REJECTED') return 'REJECTED';
  return null;
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
  const profRes = await query(
    `SELECT admin_phone_number FROM kakao_sender_profiles WHERE profile_key = $1 LIMIT 1`,
    [params.profileKey],
  );
  const callback = String(profRes.rows[0]?.admin_phone_number || '').replace(/\D/g, '');
  if (!callback) {
    // callback 미등록 시 발송 불가. 로그만 남기고 스킵 (기간계 안정성 우선)
    logErr(
      'notifyTemplateInspectionResult',
      new Error(`profile.admin_phone_number 없음 — profile_key=${params.profileKey}`),
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
  for (const row of rows) {
    try {
      const res = await imc.getSender(row.profile_key);
      if (res.code !== '0000' || !res.data) continue;

      const latestStatus = res.data.status;
      const latestUuid = res.data.uuid;

      const statusChanged = latestStatus && latestStatus !== row.status;
      const uuidChanged = latestUuid && latestUuid !== row.yellow_id;
      if (!statusChanged && !uuidChanged) continue;

      await query(
        `UPDATE kakao_sender_profiles
            SET status     = COALESCE($1, status),
                yellow_id  = COALESCE($2, yellow_id),
                updated_at = now()
          WHERE id = $3`,
        [latestStatus || null, latestUuid || null, row.id],
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
