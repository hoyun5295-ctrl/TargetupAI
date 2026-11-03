/**
 * sync-unsubscribes.ts — 싱크 경로 수신거부 원장 대조 컨트롤타워(★ 2026-11-04 routes/sync.ts 에서 옮김 · 원문 그대로)
 *
 * 옮긴 이유 = 같은 번호 수신동의 세대 공개(설계서 docs/2026-11-03-sync-duplicate-phone-consent-design.md §3-0 · §3-2 ④)와
 *   슈퍼관리자 에이전트 폐기가 같은 대조를 써야 한다(라우트 파일 함수는 다른 라우트가 부를 수 없다 · 복사 = 두 벌 금지).
 * ⛔ unsubscribes 에 source 'sync' 로 넣거나 지우는 SQL 은 이 파일에만 둔다(계약 시험 same-phone-consent-contract-1104 C2).
 */
import { query, type TxRun } from '../config/database';
import { ensureSystemSyncUser } from './system-sync-user';
import { registerBulkCompanyUserUnsubscribes, registerCompanyUserUnsubscribesFor } from './unsubscribe-helper';
import { recordUnsubscribeDeleted } from './change-audit';

/**
 * sms_opt_in 양방향 동기화 — unsubscribes 자동 등록/해제 (싱크 경로 유일 진입점).
 * ★ 2026-06-15 버그2 fix: 기존엔 false→등록만 하고 동의 전환(false→true) 해제가 없어
 *   재동의 고객이 계속 거부로 노출됐다(인비토02 실측 = sms_opt_in=true인데 unsubscribes sync 4건 잔존).
 *   발송/표시 자격 = `sms_opt_in=true AND NOT EXISTS unsubscribes`라 한 방향만 처리하면 비대칭 사고.
 *   이제 한 사이클에서 등록(false)과 해제(true)를 모두 처리한다.
 *
 * [등록] sms_opt_in=false 고객 → unsubscribes 3단 배정 (upload.ts admin 경로 :829-889 패턴):
 *   1. 시스템 가상 user (is_system=true)에게 INSERT
 *   2. 회사의 admin user들에게 INSERT (관리 가시성)
 *   3. store_code 담당 company_user들에게 INSERT (브랜드별 필터링)
 * [해제] sms_opt_in=true 고객 → source='sync' unsubscribes 제거 (등록의 짝).
 *   ★ source='sync'(sms_opt_in 파생)만 삭제 — 능동 수신거부(manual/upload/legacy_migration)는 보존.
 *   명시 opt-out 우선(정보통신망법): 고객이 직접 거부했거나 옛 이관 거부분은 동의 동기화로 덮지 않는다.
 *   ★ 2026-10-04 해제는 **이 배치에서 원본(ERP)이 동의라고 보낸 번호**만(optInPhones). 옛: 고객 행 sms_opt_in=true 전원이었다 —
 *     그 칸은 싱크만 쓰는 칸이 아니라(자사몰 식별 · 화면 수정 · 업로드) 다른 문이 true 로 올리면 원본이 아직 거부인데도
 *     싱크 수신거부가 지워졌다(싱크·자사몰 전수점검 S16 · 결정 ④ 철회 우선). 등록 쪽은 회사 전체 그대로(빠짐 0).
 *
 * ⚠️ 이 로직은 sync.ts 외부에서 복제 금지. 싱크 경로의 유일한 수신거부 진입점.
 */
export async function reconcileSyncUnsubscribes(companyId: string, companyName: string | undefined, optInPhones: string[]): Promise<void> {
  try {
    // 1. 시스템 user 조회/생성 — CT (42P08 타입 고정: $1::uuid + $2::text)
    let systemUserId: string | null = null;
    try {
      systemUserId = await ensureSystemSyncUser(companyId);
    } catch (sysErr) {
      console.error('[Sync] 시스템 user 조회/생성 실패:', sysErr);
    }

    // 2. 시스템 user에게 INSERT (source='sync')
    if (systemUserId) {
      const r1 = await query(
        `INSERT INTO unsubscribes (company_id, user_id, phone, source)
         SELECT $1, $2, phone, 'sync'
         FROM customers
         WHERE company_id = $1 AND sms_opt_in = false AND is_active = true
           AND NOT EXISTS (SELECT 1 FROM unsubscribes u WHERE u.user_id = $2 AND u.phone = customers.phone)
         ON CONFLICT (user_id, phone) DO NOTHING`,
        [companyId, systemUserId]
      );
      if (r1.rowCount && r1.rowCount > 0) {
        console.log(`[Sync] 수신거부 자동등록(system): ${r1.rowCount}건 (company: ${companyName})`);
      }
    }

    // 3. 회사 admin user들에게 INSERT (관리 가시성)
    const r2 = await query(
      `INSERT INTO unsubscribes (company_id, user_id, phone, source)
       SELECT c.company_id, u.id, c.phone, 'sync'
       FROM customers c
       JOIN users u ON u.company_id = c.company_id AND u.user_type = 'admin' AND COALESCE(u.is_system, false) = false
       WHERE c.company_id = $1 AND c.sms_opt_in = false AND c.is_active = true
       ON CONFLICT (user_id, phone) DO NOTHING`,
      [companyId]
    );
    if (r2.rowCount && r2.rowCount > 0) {
      console.log(`[Sync] 수신거부 자동등록(admin): ${r2.rowCount}건 (company: ${companyName})`);
    }

    // 4. company_user들에게 INSERT — CT-03 registerBulkCompanyUserUnsubscribes
    // ★ D136 (2026-04-22): sync.ts + upload.ts + unsubscribe-helper.ts 3곳에 분산된
    //   동일 SQL 패턴을 CT-03 컨트롤타워 함수로 통합. getStoreScope 4단계 판정 이식.
    const r3Count = await registerBulkCompanyUserUnsubscribes(companyId, 'sync');
    if (r3Count > 0) {
      console.log(`[Sync] 수신거부 자동등록(company_user, CT-03): ${r3Count}건 (company: ${companyName})`);
    }

    // ===== [해제] sms_opt_in=true 전환분 → source='sync' unsubscribes 제거 (등록의 짝) =====
    // ★ 2026-06-15 버그2 fix: 거부→동의 재동의 고객이 옛 sync 수신거부 잔존으로 계속 거부로 노출되던 비대칭 차단.
    //   source='sync'(sms_opt_in 파생)만 삭제 — manual/upload/legacy_migration(능동 opt-out)은 보존(정보통신망법).
    //   EXISTS로 unsubscribes(작은 집합) 기준 스캔 → 동의 전환분만 정확히 해제. 변경 없으면 0건.
    if (optInPhones.length === 0) return;
    const reEnable = await query(
      `DELETE FROM unsubscribes u
       WHERE u.company_id = $1 AND u.source = 'sync'
         AND u.phone = ANY($2::text[])
         AND EXISTS (
           SELECT 1 FROM customers c
           WHERE c.company_id = $1 AND c.phone = u.phone
             AND c.sms_opt_in = true AND c.is_active = true
         )`,
      [companyId, optInPhones]
    );
    if (reEnable.rowCount && reEnable.rowCount > 0) {
      console.log(`[Sync] 수신거부 자동해제(동의 전환): ${reEnable.rowCount}건 (company: ${companyName})`);
      // ★2026-10-21 실사 준비 S1(D-24) — 동기화가 지운 수신거부도 감사 기록에(건수 · 경로만 · 0건이면 안 남김)
      await recordUnsubscribeDeleted({ actorUserId: null, companyId, count: reEnable.rowCount, via: 'sync' });
    }
  } catch (unsubError) {
    console.error('[Sync] 수신거부 동기화 실패:', unsubError);
  }
}

/**
 * ★ 2026-11-04 같은 대조 · 주어진 번호만 · 부르는 쪽 트랜잭션 연결(run)에서 · 실패를 던진다(묶음 통째 되돌림 = 다음 complete 가 다시 · 설계서
 *   docs/2026-11-03-sync-duplicate-phone-consent-design.md §3-2 ④ · Codex 설계 1R #6). 쓰는 곳 = 세대 공개 2단계 · 에이전트 폐기.
 * 등록 = 위 함수 2 · 3 · 4 와 같은 대상(고객 행 미동의 · 활성) · 해제 = 위 해제와 같은 조건(source sync 만 · 고객 행 동의 · 활성 · P4).
 * 시스템 사용자 id 는 트랜잭션 밖에서 미리 구한다(ensureSystemSyncUser 는 전역 연결 · 없으면 시스템 행 등록만 건너뜀 = 위 함수와 같음).
 * 반환 = 지운 번호(감사 기록 = 커밋 뒤 부르는 쪽 · recordUnsubscribeDeleted).
 */
export async function reconcileSyncUnsubscribesFor(
  run: TxRun,
  companyId: string,
  systemUserId: string | null,
  phones: string[],
): Promise<string[]> {
  if (phones.length === 0) return [];
  if (systemUserId) {
    await run(
      `INSERT INTO unsubscribes (company_id, user_id, phone, source)
       SELECT $1, $2, phone, 'sync'
       FROM customers
       WHERE company_id = $1 AND phone = ANY($3::text[]) AND sms_opt_in = false AND is_active = true
         AND NOT EXISTS (SELECT 1 FROM unsubscribes u WHERE u.user_id = $2 AND u.phone = customers.phone)
       ON CONFLICT (user_id, phone) DO NOTHING`,
      [companyId, systemUserId, phones],
    );
  }
  await run(
    `INSERT INTO unsubscribes (company_id, user_id, phone, source)
     SELECT c.company_id, u.id, c.phone, 'sync'
     FROM customers c
     JOIN users u ON u.company_id = c.company_id AND u.user_type = 'admin' AND COALESCE(u.is_system, false) = false
     WHERE c.company_id = $1 AND c.phone = ANY($2::text[]) AND c.sms_opt_in = false AND c.is_active = true
     ON CONFLICT (user_id, phone) DO NOTHING`,
    [companyId, phones],
  );
  await registerCompanyUserUnsubscribesFor(run, companyId, 'sync', phones);
  const reEnable = await run(
    `DELETE FROM unsubscribes u
     WHERE u.company_id = $1 AND u.source = 'sync'
       AND u.phone = ANY($2::text[])
       AND EXISTS (
         SELECT 1 FROM customers c
         WHERE c.company_id = $1 AND c.phone = u.phone
           AND c.sms_opt_in = true AND c.is_active = true
       )
     RETURNING u.phone`,
    [companyId, phones],
  );
  return reEnable.rows.map((r: any) => String(r.phone));
}
