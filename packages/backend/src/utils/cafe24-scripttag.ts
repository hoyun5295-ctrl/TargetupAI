/**
 * ★ CT: 카페24 scripttags 자동삽입 — 연동 = 행동 수집(SDK) 개통 (2026-07-03 B-2)
 *
 * OAuth 연동 성공 직후 몰에 한줄로 SDK <script>를 자동 등록(scripttags Admin API).
 * 설치 담당자 추가 작업 0 — 몰 1클릭 연동만으로 page_view/click 수집이 켜진다.
 *
 * 멱등: 기존 등록 여부를 GET으로 확인 후 없을 때만 POST. script_no는 company_integrations.meta에 보관.
 * fire-and-forget: 실패해도 연동 자체엔 영향 없음(로그만) — 호출부가 .catch로 삼킨다.
 *
 * ⚠ scripttags Admin API 필드(display_location 허용값·응답 script_no·요청 wrapper)는
 *   gyunoo83 재연동 실측의 raw 응답 로그(`[Cafe24 ScriptTag] 등록 응답(raw)`)로 최종 확정한다.
 *   mall.write_application scope(B-1) 필요 — 기존 연동 몰은 재동의 후에만 등록 성공.
 */

import { query } from '../config/database';
import { getCafe24Integration, cafe24ApiCall, getCafe24ByoCredentials } from './cafe24-client';
import { issueCdpKeyPair } from './cdp-auth';

// 카페24 scripttag src는 CORS(Access-Control-Allow-Origin: *)가 필수 → backend CORS 서빙 경로 사용.
//   (nginx 정적 /sdk/ 엔 CORS 헤더 없음 — 422 방지.) ?k= 로 공개 키 전달(SDK v0.3.8+ fallback).
const SDK_SRC_BASE = 'https://app.hanjul.ai/api/cafe24/sdk/v0.3.9/hanjul.min.js';

/** 회사 CDP public key 확보 — 있으면 재사용(기존 SDK 설치 보호), 없을 때만 신규 발급. */
async function ensureCompanyPublicKey(companyId: string): Promise<string | null> {
  const r = await query(`SELECT cdp_api_key FROM companies WHERE id = $1::uuid`, [companyId]);
  const existing = r.rows[0]?.cdp_api_key as string | undefined;
  if (existing) return existing;
  const issued = await issueCdpKeyPair(companyId);
  return issued.cdpApiKey;
}

function buildSdkSrc(publicKey: string): string {
  return `${SDK_SRC_BASE}?k=${encodeURIComponent(publicKey)}`;
}

async function mergeIntegrationMeta(companyId: string, mallId: string, patch: Record<string, unknown>): Promise<void> {
  await query(
    `UPDATE company_integrations
     SET meta = COALESCE(meta, '{}'::jsonb) || $3::jsonb, updated_at = NOW()
     WHERE company_id = $1::uuid AND provider = 'cafe24' AND mall_id = $2`,
    [companyId, mallId, JSON.stringify(patch)]
  );
}

/**
 * 몰에 한줄로 SDK scripttag를 멱등 등록. 연동 성공 직후 fire-and-forget 호출.
 */
export async function ensureCafe24ScriptTag(companyId: string, mallId: string): Promise<void> {
  const integration = await getCafe24Integration(companyId, mallId);
  if (!integration) {
    console.log('[Cafe24 ScriptTag] 연동 정보 없음 — skip:', mallId);
    return;
  }

  const publicKey = await ensureCompanyPublicKey(companyId);
  if (!publicKey) {
    console.log('[Cafe24 ScriptTag] public key 확보 실패 — skip:', mallId);
    return;
  }
  const src = buildSdkSrc(publicKey);
  const byoCreds = await getCafe24ByoCredentials(companyId, mallId);

  // 멱등 — 이미 **지금 주소(키·SDK 판)** 태그가 있으면 script_no만 meta에 갱신하고 남은 옛 태그를 정리한 뒤 종료
  // ★ 2026-09-26 한줄로 V2 R1-30 — 옛: 우리 태그가 있기만 하면 끝이라 키 재발급 뒤에도 옛 키(?k=)를 계속 써서 수집이 401.
  //   이제 주소까지 같아야 "등록됨"이다. 다르면 아래에서 새 태그를 **먼저** 올리고 옛 태그를 지운다
  //   (먼저 지우면 올리기 실패 시 수집이 끊긴다 · 옛 키 태그는 이미 폐기된 키라 겹쳐 있어도 이중 수집이 없다).
  let staleTags: any[] = [];
  try {
    const list = await cafe24ApiCall<any>(integration, '/scripttags', { method: 'GET' }, byoCreds);
    const tags = Array.isArray(list?.scripttags) ? list.scripttags : [];
    const mineAll = tags.filter(
      (s: any) => typeof s?.src === 'string' && s.src.includes('/sdk/') && s.src.includes('hanjul') && s?.script_no,
    );
    const current = mineAll.find((s: any) => s.src === src);
    staleTags = mineAll.filter((s: any) => s !== current);
    if (current) {
      console.log('[Cafe24 ScriptTag] 이미 등록됨 script_no=', current.script_no, 'mall=', mallId);
      await mergeIntegrationMeta(companyId, mallId, { scripttag_no: current.script_no, scripttag_src: current.src });
      await deleteStaleScriptTags(integration, byoCreds, staleTags, mallId);
      return;
    }
  } catch (e: any) {
    console.log('[Cafe24 ScriptTag] 기존 목록 조회 실패(신규 등록 진행):', e?.message || e);
  }

  // 신규 등록 — 요청 wrapper·display_location은 raw 응답 로그로 실측 확정
  const body = {
    shop_no: 1,
    request: {
      src,
      display_location: ['ALL'],
    },
  };
  const res = await cafe24ApiCall<any>(integration, '/scripttags', { method: 'POST', body }, byoCreds);
  console.log('[Cafe24 ScriptTag] 등록 응답(raw):', JSON.stringify(res).slice(0, 800));
  const scriptNo = res?.scripttag?.script_no ?? res?.scripttags?.[0]?.script_no ?? null;
  await mergeIntegrationMeta(companyId, mallId, { scripttag_no: scriptNo, scripttag_src: src });
  console.log('[Cafe24 ScriptTag] 등록 완료 script_no=', scriptNo, 'mall=', mallId);
  // 새 태그가 올라간 뒤에만 옛 주소 태그를 지운다
  await deleteStaleScriptTags(integration, byoCreds, staleTags, mallId);
}

/** 옛 주소(폐기된 키·옛 SDK 판) 우리 태그 정리 — 하나 실패해도 나머지는 계속(로그만). */
async function deleteStaleScriptTags(integration: any, byoCreds: any, staleTags: any[], mallId: string): Promise<void> {
  for (const t of staleTags) {
    try {
      await cafe24ApiCall<any>(integration, `/scripttags/${t.script_no}`, { method: 'DELETE' }, byoCreds);
      console.log('[Cafe24 ScriptTag] 옛 주소 태그 제거 script_no=', t.script_no, 'mall=', mallId);
    } catch (e: any) {
      console.log('[Cafe24 ScriptTag] 옛 주소 태그 제거 실패(무시 · 폐기된 키라 수집 영향 없음) script_no=', t.script_no, e?.message || e);
    }
  }
}

/**
 * ★ 2026-09-26 한줄로 V2 R1-30 — 회사 공개 키가 바뀐 뒤(CDP 키 재발급) 그 회사 카페24 몰 전부의 태그를 지금 키로 맞춘다.
 * fire-and-forget — 몰 하나 실패해도 나머지는 계속, 호출부(재발급 응답)에는 영향 없음.
 */
export async function resyncCafe24ScriptTagsForCompany(companyId: string): Promise<void> {
  const r = await query(
    `SELECT mall_id FROM company_integrations WHERE company_id = $1::uuid AND provider = 'cafe24' AND mall_id IS NOT NULL`,
    [companyId],
  );
  for (const row of r.rows) {
    await ensureCafe24ScriptTag(companyId, String(row.mall_id)).catch((e: any) =>
      console.log('[Cafe24 ScriptTag] 키 재발급 뒤 태그 맞춤 실패(무시) mall=', row.mall_id, e?.message || e),
    );
  }
}

/**
 * 연동 해제 시 등록했던 scripttag 제거. fire-and-forget(실패 무시).
 */
export async function removeCafe24ScriptTag(companyId: string, mallId: string): Promise<void> {
  try {
    const r = await query(
      `SELECT meta FROM company_integrations
       WHERE company_id = $1::uuid AND provider = 'cafe24' AND mall_id = $2 LIMIT 1`,
      [companyId, mallId],
    );
    const scriptNo = (r.rows[0]?.meta || {})?.scripttag_no;
    if (!scriptNo) return;

    const integration = await getCafe24Integration(companyId, mallId);
    if (!integration) return;
    const byoCreds = await getCafe24ByoCredentials(companyId, mallId);

    await cafe24ApiCall<any>(integration, `/scripttags/${scriptNo}`, { method: 'DELETE' }, byoCreds);
    await mergeIntegrationMeta(companyId, mallId, { scripttag_no: null });
    console.log('[Cafe24 ScriptTag] 제거 완료 script_no=', scriptNo, 'mall=', mallId);
  } catch (e: any) {
    console.log('[Cafe24 ScriptTag] 제거 실패(무시):', e?.message || e);
  }
}
