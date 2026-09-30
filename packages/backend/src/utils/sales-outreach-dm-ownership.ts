/**
 * ★ 2026-10-01 AI 영업 DM 소유 판정 CT (서수란 접수 2건 · 삭제 건 DM 숨김 + 미리 만든 DM 불러오기)
 *
 * 「이 영업 건이 직접 만든 DM 인가」를 한 곳이 소유한다. 영업 건의 DM 기록(sales_outreach_assets kind='dm')에는
 * AI 가 만든 DM(dmId · 카탈로그 짝 catalogDmId)과, 담당자가 불러온 지원팀 DM(payload.imported = true)이 함께 쌓일 수 있다.
 * 불러온 DM 은 지원팀 자산이라 아래 세 곳 모두에서 빠져야 한다. 세 곳이 판정을 각자 쓰면 한 곳만 고쳐져 지원팀 DM 이 꺼진다.
 *   ① 옛 DM 중지(sales-outreach-jobs.ts stopSupersededDms)
 *   ② 파기(sales-outreach-purge.ts purgeOutreachJobArtifacts · 사람 삭제·만료 공용)
 *   ③ mobile 계정 내 DM 목록 숨김(dm-builder.ts getDmList · 호출부 routes/dm.ts 목록)
 *
 * ⛔ 이 파일은 아무것도 import 하지 않는다. dm-builder 가 읽고, 영업 파일들은 dm-builder 를 읽는다(순환 금지).
 */

/** DM 기록 한 건(payload)이 지원팀에서 불러온 것인가. */
export function isImportedOutreachDmAsset(payload: unknown): boolean {
  return !!payload && typeof payload === 'object' && (payload as { imported?: unknown }).imported === true;
}

/** 이 영업 건이 직접 만든 DM 번호(카탈로그 짝 포함 · 불러온 기록이면 빈 배열). 중지·파기가 이 목록만 건드린다. */
export function ownedOutreachDmIds(payload: unknown): string[] {
  if (!payload || typeof payload !== 'object' || isImportedOutreachDmAsset(payload)) return [];
  const p = payload as { dmId?: unknown; catalogDmId?: unknown };
  return [String(p.dmId || ''), String(p.catalogDmId || '')].filter(Boolean);
}

/**
 * 내 DM 목록 조건 — 파기된 영업 건(purged_at)이 직접 만든 DM 을 뺀다.
 * 행은 지우지 않는다: 지우면 제안 메일을 받은 사람이 링크를 열 때 「종료된 페이지입니다」가 「존재하지 않는 DM입니다」로
 * 바뀐다(routes/dm.ts 공개 뷰어 · 0806 서수란 접수로 두 문구를 나눴다). 파기는 이미 DM 을 중지하고 이미지 파일을 지운 상태라
 * 목록에 남으면 이미지가 깨진 「중지」 카드가 된다(1001 서수란 접수 · 토니모리 · 금강제화 · 바이와이제이).
 * 바깥 쿼리의 dm_pages 를 별칭 없이 가리킨다(getDmList 의 FROM dm_pages).
 */
/**
 * 불러오기 후보·관문 조건 — 어느 영업 건이든 직접 만든 DM(AI DM · 카탈로그 짝)인가(불러온 기록은 제외). 바깥 dm_pages 별칭 = d.
 * AI 영업이 만든 DM 을 「불러온 DM」으로 다시 넣으면 파기·중지 대상에서 빠져 영원히 남는다 — 후보에서 빼고 관문에서 거절한다.
 */
export const OUTREACH_MADE_DM_SQL = `EXISTS (
         SELECT 1 FROM sales_outreach_assets oa
          WHERE oa.kind = 'dm'
            AND COALESCE(oa.payload->>'imported', '') <> 'true'
            AND (oa.payload->>'dmId' = d.id::text OR oa.payload->>'catalogDmId' = d.id::text))`;

export const EXCLUDE_PURGED_OUTREACH_DMS_SQL = `NOT EXISTS (
         SELECT 1 FROM sales_outreach_assets oa
           JOIN sales_outreach_jobs oj ON oj.id = oa.job_id
          WHERE oj.purged_at IS NOT NULL
            AND oa.kind = 'dm'
            AND COALESCE(oa.payload->>'imported', '') <> 'true'
            AND (oa.payload->>'dmId' = dm_pages.id::text OR oa.payload->>'catalogDmId' = dm_pages.id::text))`;
